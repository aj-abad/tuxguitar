import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { _electron } from 'playwright';
import { unzipSync } from 'fflate';
import { notationStudy } from '../fixtures/notation-study.mjs';

mkdirSync('.cache', { recursive: true });
const output = mkdtempSync(resolve('.cache/engraving-e2e-'));
const original = join(output, 'Rhythm and techniques.tg'), saved = join(output, 'Edited techniques.tg');
writeFileSync(original, notationStudy());
const xml = path => new TextDecoder().decode(unzipSync(readFileSync(path))['content.xml']);
const effects = source => [...source.matchAll(/<(bend|hammer|slide)\b[^>]*(?:\/>|>.*?<\/\1>)/gs)].map(m => m[0]);
const app = await _electron.launch({ args: [resolve('.'), `--user-data-dir=${join(output, 'profile')}`], env: { ...process.env, TG_HEADLESS: '1' } });
let page;
const errors = [];
async function field(id, value) {
  await page.waitForFunction(({ id, value }) => document.getElementById(id)?.value === String(value), { id, value }, { polling: 25 });
}
async function key(key) {
  await page.getByRole('region', { name: 'Tablature editor', exact: true }).focus();
  await page.keyboard.press(key);
}
async function native(id) {
  await app.evaluate(({ Menu }, id) => { const item = Menu.getApplicationMenu().getMenuItemById(id); item.click(item, undefined, {}); }, id);
}
async function dirty(value) {
  await page.waitForFunction(value => [...document.querySelectorAll('[role="status"]')].some(e => e.textContent === 'Unsaved') === value, value, { polling: 25 });
}
async function showMeasure(measure) {
  // Wrapped systems are virtualized; visit them by scrolling rather than relying
  // on an offscreen DOM node existing. Await native scroll delivery: hidden
  // Chromium windows can otherwise batch many scrolls into one animation frame.
  const scroll = reset => page.locator('.tab-workspace').evaluate((e, reset) => new Promise(resolve => {
    const before = `${e.scrollTop}:${e.scrollLeft}`;
    const finished = () => { e.removeEventListener('scroll', finished); queueMicrotask(resolve); };
    e.addEventListener('scroll', finished, { once: true });
    if (reset) { e.scrollTop = 0; e.scrollLeft = 0; }
    else e.scrollTop += e.clientHeight * .7;
    if (`${e.scrollTop}:${e.scrollLeft}` === before) finished();
  }), reset);
  await scroll(true);
  const target = page.locator(`[data-column-id][data-measure="${measure}"]`).first();
  for (let i = 0; i < 20 && !await target.count(); i++) {
    await scroll(false);
  }
  await target.scrollIntoViewIfNeeded();
}
async function point(measure, beat, string) {
  return page.evaluate(({ measure, beat, string }) => {
    const column = document.querySelector(`[data-column-id][data-measure="${measure}"][data-beat="${beat}"]`);
    const guide = column.querySelector('.tab-guide'), row = column.closest('[data-testid="tab-system"]');
    const line = row.querySelectorAll('.tab-string')[string - 1];
    const p = new DOMPoint(Number(guide.getAttribute('x1')), Number(line.getAttribute('y1'))).matrixTransform(column.ownerSVGElement.getScreenCTM());
    return { x: p.x, y: p.y };
  }, { measure, beat, string });
}
try {
  page = await app.firstWindow();
  page.on('pageerror', e => errors.push(e.stack));
  await app.evaluate(({ dialog }, values) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [values.original] });
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: values.saved });
    dialog.showMessageBox = async () => ({ response: 1 });
  }, { original, saved });
  await page.getByRole('button', { name: 'Open file', exact: true }).click();
  await field('note-fret', 5);
  await page.locator('[data-technique="hammer-on"]').first().waitFor();
  assert.ok(await page.locator('[data-beam-level="1"]').count() >= 4);
  assert.ok(await page.locator('[data-technique="pull-off"]').count() > 0);
  assert.ok(await page.locator('[data-technique="tie"]').count() > 0);
  assert.equal(await page.locator('.tab-notice').count(), 0);
  assert.ok(await page.getByTestId('tab-rhythm-slash').count() > 0);
  assert.equal(await page.locator('.tab-rhythm ellipse').count(), 0);
  await page.screenshot({ path: join(output, 'legato-and-beams.png') });
  const originalSource = await page.locator('[data-technique="hammer-on"]').first().getAttribute('data-technique-source');
  await key('ArrowRight');
  await key('3');
  await field('note-fret', 3);
  await page.locator(`[data-technique-source="${originalSource}"][data-technique="pull-off"]`).waitFor();
  await native('undo');
  await field('note-fret', 7);
  await page.locator(`[data-technique-source="${originalSource}"][data-technique="hammer-on"]`).waitFor();
  await dirty(false);
  await key('End');
  await key('ArrowDown');
  await key('ArrowDown');
  await field('note-fret', 9);
  const tiedFret = page.locator('[data-measure="0"][data-beat="7"] .tab-fret');
  assert.equal(await tiedFret.textContent(), '(9)');
  const tiedBounds = await tiedFret.boundingBox(), caretBounds = await page.getByTestId('note-selection').boundingBox();
  assert.ok(caretBounds.x <= tiedBounds.x && caretBounds.x + caretBounds.width >= tiedBounds.x + tiedBounds.width);
  assert.ok(caretBounds.height < 26);
  console.log('PASS: metric beams, H/P direction, ties, fret edits and undo retain stable technique anchors');

  await showMeasure(1);
  assert.ok(await page.locator('[data-technique="bend"]').count() >= 4);
  const stringGaps = await page.locator('[data-testid="tab-system"]').evaluateAll(rows => rows.flatMap(row => {
    const y = [...row.querySelectorAll('.tab-string')].map(line => Number(line.getAttribute('y1')));
    return y.slice(1).map((value, index) => value - y[index]);
  }));
  assert.ok(stringGaps.every(gap => gap === 18), JSON.stringify(stringGaps));
  await page.screenshot({ path: join(output, 'bends-and-releases.png') });
  await page.getByLabel('Tab zoom', { exact: true }).selectOption('1.5');
  await page.getByLabel('Tab spacing', { exact: true }).selectOption('0.85');
  await showMeasure(1);
  const secondString = await point(1, 1, 2);
  await page.mouse.click(secondString.x, secondString.y);
  await field('note-string', 2);
  await field('note-fret', 8);
  assert.ok((await page.getByTestId('note-selection').boundingBox()).height < 40);
  await key('9');
  await field('note-fret', 9);
  await page.getByRole('button', { name: 'Save As…', exact: true }).click();
  await dirty(false);
  assert.deepEqual(effects(xml(saved)), effects(xml(original)));
  assert.equal([...xml(saved).matchAll(/future="retain"/g)].length, [...xml(original).matchAll(/future="retain"/g)].length);
  await page.getByLabel('Tab zoom', { exact: true }).selectOption('1');
  await page.getByLabel('Tab spacing', { exact: true }).selectOption('1');
  console.log('PASS: bend spacing, scaled string hit regions and source-preserving save');

  await showMeasure(2);
  await page.locator('[data-technique="slide"][data-continuation="end"]').waitFor();
  assert.ok(await page.locator('[data-beam-hook="true"]').count() > 0);
  await page.screenshot({ path: join(output, 'wrapped-slide.png') });
  await showMeasure(3);
  await page.locator('[data-technique="tie"][data-continuation="end"]').waitFor();
  await page.screenshot({ path: join(output, 'compound-meter-and-tie.png') });
  await showMeasure(4);
  assert.ok(await page.getByTestId('tab-tuplet').count() >= 2);
  await page.screenshot({ path: join(output, 'tuplets-and-hooks.png') });
  await showMeasure(8);
  assert.equal(await page.locator('[data-testid="tab-tuplet"][data-bracket="true"]').count(), 2);
  await page.screenshot({ path: join(output, 'bracketed-tuplets.png') });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(800, 760));
  await page.waitForFunction(() => innerWidth <= 800);
  await showMeasure(2);
  await page.screenshot({ path: join(output, 'narrow.png') });
  await page.getByLabel('Tab layout', { exact: true }).selectOption('continuous');
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="tab-system"]').length === 1);
  assert.equal(await page.locator('[data-continuation="start"], [data-continuation="end"]').count(), 0);
  assert.ok(await page.locator('[data-technique="slide"]').count() >= 3);
  assert.equal(await page.locator('.tab-workspace').evaluate(e => e.scrollWidth > e.clientWidth), true);
  await page.getByLabel('Renderer', { exact: true }).selectOption('alphatab');
  await page.locator('.at-surface svg').first().waitFor();
  await page.getByLabel('Renderer', { exact: true }).selectOption('tabbycat');
  await page.getByTestId('tab-system').first().waitFor();
  await app.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }); }, saved);
  await page.getByRole('button', { name: 'Open file', exact: true }).click();
  await field('note-fret', 5);
  assert.ok(await page.locator('[data-technique="bend"]').count() >= 4);
  assert.equal(await page.getByRole('button', { name: 'Undo edit', exact: true }).isDisabled(), true);
  await dirty(false);
  assert.deepEqual(errors, []);
  console.log('PASS: wrapped continuations, tuplets, partial beams, narrow/continuous layouts and comparison view');
  console.log(`Study file and screenshots: ${output}`);
} catch (error) {
  if (page && !page.isClosed()) {
    await page.screenshot({ path: join(output, 'failure.png') }).catch(() => {});
    console.error((await page.locator('body').innerText()).slice(0, 2500));
  }
  console.error(`Evidence: ${output}`);
  throw error;
} finally {
  await app.evaluate(({ app }) => app.exit()).catch(() => {});
}

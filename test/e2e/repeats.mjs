import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { _electron } from 'playwright';
import { unzipSync } from 'fflate';
import { repeatStudy } from '../fixtures/repeat-study.mjs';

mkdirSync('.cache', { recursive: true });
const output = mkdtempSync(resolve('.cache/repeats-e2e-'));
const original = join(output, 'Repeats and endings.tg'), saved = join(output, 'Edited repeats.tg');
writeFileSync(original, repeatStudy());
const headers = path => new TextDecoder().decode(unzipSync(readFileSync(path))['content.xml'])
  .match(/<TGMeasureHeader>.*?<\/TGMeasureHeader>/gs);
const app = await _electron.launch({ args: [resolve('.'), `--user-data-dir=${join(output, 'profile')}`],
  env: { ...process.env, TG_HEADLESS: '1' } });
let page;
const errors = [];
async function field(id, value) {
  await page.waitForFunction(({ id, value }) => document.getElementById(id)?.value === String(value), { id, value }, { polling: 25 });
}
async function showMeasure(measure) {
  const scroll = reset => page.locator('.tab-workspace').evaluate((element, reset) => new Promise(resolve => {
    const before = `${element.scrollTop}:${element.scrollLeft}`;
    const done = () => { element.removeEventListener('scroll', done); queueMicrotask(resolve); };
    element.addEventListener('scroll', done, { once: true });
    if (reset) { element.scrollTop = 0; element.scrollLeft = 0; }
    else element.scrollTop += element.clientHeight * .7;
    if (`${element.scrollTop}:${element.scrollLeft}` === before) done();
  }), reset);
  await scroll(true);
  const target = page.locator(`[data-column-id][data-measure="${measure}"]`).first();
  for (let i = 0; i < 20 && !await target.count(); i++) await scroll(false);
  await target.scrollIntoViewIfNeeded();
}
async function key(value) {
  await page.getByRole('region', { name: 'Tablature editor', exact: true }).focus();
  await page.keyboard.press(value);
}
async function checkLanes() {
  const collisions = await page.getByTestId('tab-system').evaluateAll(rows => rows.flatMap(row => {
    const top = Number(row.querySelector('.tab-string').getAttribute('y1'));
    const annotations = [...row.querySelectorAll('[data-column-id] > text')].map(e => e.getBBox());
    const endings = [...row.querySelectorAll('[data-testid="tab-ending"]')].map(e => e.getBBox());
    const counts = [...row.querySelectorAll('[data-testid="tab-repeat-count"]')].map(e => e.getBBox());
    return [
      ...endings.filter(box => box.y + box.height >= top - 24 || annotations.some(a => a.y + a.height >= box.y)),
      ...counts.filter(box => box.y + box.height >= top - 24 || endings.some(e => e.y + e.height >= box.y)),
    ].map(box => ({ row: row.dataset.system, x: box.x, y: box.y }));
  }));
  assert.deepEqual(collisions, []);
}

try {
  page = await app.firstWindow();
  page.on('pageerror', e => errors.push(e.stack));
  await app.evaluate(({ dialog, BrowserWindow }, files) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [files.original] });
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: files.saved });
    dialog.showMessageBox = async () => ({ response: 1 });
    BrowserWindow.getAllWindows()[0].setSize(1280, 960);
  }, { original, saved });
  await page.getByRole('button', { name: 'Open file', exact: true }).click();
  await field('note-fret', 5);
  await page.locator('[data-barline="repeat-start"]').first().waitFor();
  assert.equal(await page.locator('.tab-notice').count(), 0);
  await checkLanes();
  await page.screenshot({ path: join(output, 'repeat-start-and-ending.png') });

  await showMeasure(2);
  const continued = page.locator('[data-testid="tab-ending"][data-ending-start="1"][data-continuation="end"]');
  await continued.waitFor();
  assert.equal(await continued.locator('text').textContent(), '(1.)');
  await checkLanes();
  await page.screenshot({ path: join(output, 'ending-continuation.png') });
  await showMeasure(3);
  assert.ok((await page.getByTestId('tab-ending').locator('text').allTextContents()).includes('2, 3.'));
  console.log('PASS: implicit multi-measure endings, wrapped labels and separate structure lanes');

  await page.getByLabel('Tab layout', { exact: true }).selectOption('continuous');
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="tab-system"]').length === 1);
  assert.equal(await page.getByTestId('tab-barline').count(), 10);
  assert.equal(await page.locator('[data-barline="repeat-both"]').count(), 1);
  assert.equal(await page.locator('[data-barline="repeat-both"] circle').count(), 4);
  assert.deepEqual(await page.getByTestId('tab-ending').locator('text').allTextContents(), ['1.', '2, 3.', '4.']);
  assert.equal(await page.getByTestId('tab-repeat-count').locator('title').textContent(), 'Play 3 times');
  await checkLanes();
  await page.locator('[data-barline="repeat-both"]').scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(output, 'combined-repeat.png') });

  await page.getByLabel('Tab layout', { exact: true }).selectOption('wrap');
  await page.getByLabel('Tab zoom', { exact: true }).selectOption('1.5');
  await page.getByLabel('Tab spacing', { exact: true }).selectOption('0.85');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(800, 760));
  await page.waitForFunction(() => innerWidth <= 800);
  await showMeasure(1);
  await checkLanes();
  const point = await page.evaluate(() => {
    const column = document.querySelector('[data-column-id][data-measure="1"][data-beat="0"]');
    const x = Number(column.querySelector('.tab-guide').getAttribute('x1'));
    const y = Number(column.closest('[data-testid="tab-system"]').querySelector('.tab-string').getAttribute('y1'));
    const point = new DOMPoint(x, y).matrixTransform(column.ownerSVGElement.getScreenCTM());
    return { x: point.x, y: point.y };
  });
  await page.mouse.click(point.x, point.y);
  await field('note-fret', 7);
  await field('note-string', 1);
  await key('9');
  await field('note-fret', 9);
  await page.locator('[data-testid="tab-ending"][data-ending-start="1"][data-continuation="start"]').scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(output, 'narrow-scaled-ending.png') });
  await page.getByRole('button', { name: 'Save As…', exact: true }).click();
  await page.waitForFunction(() => ![...document.querySelectorAll('[role="status"]')].some(e => e.textContent === 'Unsaved'));
  assert.deepEqual(headers(saved), headers(original));
  console.log('PASS: combined repeat, total-play count, narrow/zoomed note hits and source-preserving save');

  await app.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }); }, saved);
  await page.getByRole('button', { name: 'Open file', exact: true }).click();
  await field('note-fret', 5);
  await key('End');
  await key('ArrowRight');
  await field('note-fret', 9);
  assert.ok(await page.getByTestId('tab-ending').count() > 0);
  assert.equal(await page.getByRole('button', { name: 'Undo edit', exact: true }).isDisabled(), true);
  assert.deepEqual(errors, []);
  console.log(`PASS: edited note and repeat structure reopen intact\nStudy file and screenshots: ${output}`);
} catch (error) {
  if (page && !page.isClosed()) {
    await page.screenshot({ path: join(output, 'failure.png') }).catch(() => {});
    console.error((await page.locator('body').innerText()).slice(0, 2000));
  }
  console.error(`Evidence: ${output}`);
  throw error;
} finally {
  await app.evaluate(({ app }) => app.exit()).catch(() => {});
}

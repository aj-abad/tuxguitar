import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { _electron } from 'playwright';
import { unzipSync, zipSync } from 'fflate';
import { XMLParser } from 'fast-xml-parser';

mkdirSync('.cache', { recursive: true });
const output = mkdtempSync(resolve('.cache/tab-engine-e2e-'));
const original = join(output, 'column study.tg'), saved = join(output, 'edited columns.tg'), large = join(output, '500 measures.tg');
const entries = unzipSync(readFileSync('china.tg'));
let xml = new TextDecoder().decode(entries['content.xml']);
const firstMeasure = xml.match(/<TGMeasure>.*?<\/TGMeasure>/s)[0];
const secondStart = xml.lastIndexOf('<TGMeasure>');
const secondEnd = xml.indexOf('</TGMeasure>', secondStart) + '</TGMeasure>'.length;
const bars = [7, 9, null, null].map((fret, i) => `<TGBeat><preciseStart>${14414400 + i * 2882880}</preciseStart><voice empty="false"><duration value="4"><divisionType enters="1" times="1"/></duration>${fret === null ? '' : `<note string="1" value="${fret}" velocity="95" future="preserve"/>`}</voice><voice empty="true"><duration value="4"><divisionType enters="1" times="1"/></duration></voice></TGBeat>`).join('');
xml = xml.slice(0, secondStart) + `<TGMeasure>${bars}</TGMeasure>` + xml.slice(secondEnd);
entries['content.xml'] = new TextEncoder().encode(xml);
writeFileSync(original, zipSync(entries));
let bigXml = xml.replace(/<TGMeasureHeader>.*?<\/TGMeasureHeader>/gs, '').replace('<TGTrack', '<TGMeasureHeader><timeSignature denominator="4" numerator="4"/><tempo>120</tempo></TGMeasureHeader>'.repeat(500) + '<TGTrack');
const bigMeasures = Array.from({ length: 500 }, (_, i) => firstMeasure.replace(/<preciseStart>(\d+)<\/preciseStart>/g, (_, n) => `<preciseStart>${Number(n) + i * 11531520}</preciseStart>`)).join('');
bigXml = bigXml.replace(/<TGMeasure>.*?<\/TGMeasure>/gs, '').replace('</TGTrack>', bigMeasures + '</TGTrack>');
entries['content.xml'] = new TextEncoder().encode(bigXml);
writeFileSync(large, zipSync(entries));
const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@', isArray: name => ['TGTrack', 'TGMeasure', 'TGBeat', 'voice', 'note'].includes(name) });
const savedColumns = () => parser.parse(new TextDecoder().decode(unzipSync(readFileSync(saved))['content.xml']))
  .TuxGuitarFile.TGSong.TGTrack[0].TGMeasure[1].TGBeat.filter(b => b.voice[0]['@empty'] !== 'true');
const app = await _electron.launch({ args: [resolve('.'), `--user-data-dir=${join(output, 'profile')}`], env: { ...process.env, TG_HEADLESS: '1' } });
let page;
const errors = [], performanceResults = {};
async function dialogs(open = original) {
  await app.evaluate(({ dialog }, values) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [values.open] });
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: values.saved });
    dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
  }, { open, saved });
}
async function field(id, value) {
  await page.waitForFunction(({ id, value }) => document.getElementById(id)?.value === String(value), { id, value }, { polling: 25 });
}
async function dirty(value) {
  await page.waitForFunction(value => [...document.querySelectorAll('[role="status"]')].some(e => e.textContent === 'Unsaved') === value, value, { polling: 25 });
}
async function key(value) {
  await page.getByRole('region', { name: 'Tablature editor', exact: true }).focus();
  await page.keyboard.press(value);
}
async function native(id) {
  await app.evaluate(({ Menu }, id) => {
    const item = Menu.getApplicationMenu().getMenuItemById(id);
    if (!item?.enabled) throw new Error(`Disabled menu: ${id}`);
    item.click(item, undefined, {});
  }, id);
}
async function columnId(measure, beat) {
  return page.locator(`[data-column-id][data-measure="${measure}"][data-beat="${beat}"]`).getAttribute('data-column-id');
}
async function point(measure, beat, string) {
  return page.evaluate(({ measure, beat, string }) => {
    const column = document.querySelector(`[data-column-id][data-measure="${measure}"][data-beat="${beat}"]`);
    const guide = column.querySelector('.tab-guide');
    const system = column.closest('[data-testid="tab-system"]');
    const lines = system.querySelectorAll('.tab-string');
    const p = new DOMPoint(Number(guide.getAttribute('x1')), Number(lines[string - 1].getAttribute('y1'))).matrixTransform(column.ownerSVGElement.getScreenCTM());
    return { x: p.x, y: p.y };
  }, { measure, beat, string });
}
try {
  page = await app.firstWindow();
  page.on('pageerror', error => { errors.push(error.stack); console.error(error.stack); });
  await page.getByRole('button', { name: 'Open file', exact: true }).waitFor();
  await dialogs();
  await page.getByRole('button', { name: 'Open file', exact: true }).click();
  await field('note-fret', 15);
  await page.getByTestId('tab-system').first().waitFor();
  await key('ArrowUp');
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const occupied = await page.getByTestId('note-selection').boundingBox();
  await key('ArrowDown');
  await field('note-fret', '');
  const empty = await page.getByTestId('note-selection').boundingBox();
  assert.ok(empty.height < 30);
  assert.ok(Math.abs(empty.height - occupied.height) < .1, JSON.stringify({ occupied, empty }));
  assert.ok(Math.abs(empty.y - occupied.y - 26) < .1, JSON.stringify({ occupied, empty }));
  await page.getByLabel('Tab zoom', { exact: true }).selectOption('1.5');
  const target = await point(0, 0, 3);
  await page.mouse.click(target.x, target.y);
  await field('note-string', 3);
  await field('note-fret', '');
  await key('5');
  await field('note-fret', 5);
  await native('undo');
  await field('note-fret', '');
  await dirty(false);
  await page.getByLabel('Tab zoom', { exact: true }).selectOption('1');
  await page.getByLabel('Tab spacing', { exact: true }).selectOption('1.25');
  const spaced = await point(0, 0, 2);
  await page.mouse.click(spaced.x, spaced.y);
  await field('note-string', 2);
  await dirty(false);
  await page.getByLabel('Tab spacing', { exact: true }).selectOption('1');
  console.log('PASS: per-string empty-cell highlight, scaled hit testing, spacing and note entry');

  await key('ArrowUp');
  await key('End');
  await key('ArrowRight');
  await field('note-fret', 7);
  const originalId = await columnId(1, 0);
  await key('Alt+ArrowRight');
  await field('note-fret', 7);
  await page.getByText('Measure 2 · Beat 2 · Voice 1', { exact: true }).waitFor();
  assert.equal(await columnId(1, 1), originalId);
  await key('Alt+Shift+ArrowLeft');
  await field('note-fret', 7);
  const copyId = await columnId(1, 1);
  assert.notEqual(copyId, originalId);
  assert.equal(await columnId(1, 2), originalId);
  await native('undo');
  await native('undo');
  await dirty(false);
  await field('note-fret', 7);

  // A rectangle spans two columns and two strings; Delete is one transaction.
  const from = await point(1, 0, 1), to = await point(1, 1, 2);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 6 });
  await page.mouse.up();
  assert.equal(await page.getByTestId('tab-selection-range').count(), 4);
  await key('Delete');
  await dirty(true);
  await native('undo');
  await dirty(false);
  await key('Escape');
  await key('Home');
  await key('ArrowUp');
  await field('note-fret', 7);
  await key('Shift+ArrowRight');
  await key('Alt+Shift+ArrowRight');
  await field('note-fret', 9);
  await page.getByRole('button', { name: 'Save As…', exact: true }).click();
  await dirty(false);
  assert.deepEqual(savedColumns().map(b => Number(b.voice[0].note[0]['@value'])), [7, 9, 7, 9]);
  assert.equal(savedColumns().filter(b => b.voice[0].note[0]['@future'] === 'preserve').length, 4);
  await key('Alt+Shift+ArrowRight');
  await page.getByRole('alert').filter({ hasText: /trailing rest space/ }).waitFor();
  await dirty(false);
  await page.getByRole('button', { name: 'Dismiss error' }).click();
  await native('undo');
  await native('save');
  await dirty(false);
  assert.deepEqual(savedColumns().map(b => b.voice[0].note?.[0]?.['@value'] ?? null), ['7', '9', null, null]);
  await native('redo');
  await native('save');
  await dirty(false);
  await dialogs(saved);
  await page.getByRole('button', { name: 'Open file', exact: true }).click();
  await field('note-fret', 15);
  await key('End');
  await key('ArrowRight');
  await field('note-fret', 7);
  assert.equal(await page.getByRole('button', { name: 'Undo edit', exact: true }).isDisabled(), true);
  await page.screenshot({ path: join(output, 'custom-tab.png') });
  console.log('PASS: native Alt moves/copies, stable selection, rectangular delete, atomic history, source preservation and reopen');

  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(800, 760));
  await page.waitForFunction(() => window.innerWidth <= 800);
  await page.getByLabel('Tab layout', { exact: true }).selectOption('wrap');
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="tab-system"]').length > 1);
  await page.screenshot({ path: join(output, 'custom-tab-narrow.png') });
  await page.getByLabel('Tab layout', { exact: true }).selectOption('continuous');
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="tab-system"]').length === 1);
  assert.equal(await page.locator('.tab-workspace').evaluate(e => e.scrollWidth > e.clientWidth), true);

  await dialogs(large);
  const loadStart = performance.now();
  await page.getByRole('button', { name: 'Open file', exact: true }).click();
  await page.getByLabel('Tab layout', { exact: true }).selectOption('wrap');
  await page.locator('[data-layout-columns="4500"]').waitFor();
  performanceResults.open500MeasuresMs = performance.now() - loadStart;
  performanceResults.mountedSystems = await page.getByTestId('tab-system').count();
  assert.ok(performanceResults.mountedSystems < 8);
  // Measure DOM updates, not animation frames: hidden Electron windows can
  // throttle paint/RAF even when WebContents background throttling is disabled.
  performanceResults.navigationDomMs = await page.evaluate(async () => {
    const surface = document.querySelector('.tab-document');
    surface.focus();
    const values = [];
    for (let i = 0; i < 10; i++) {
      const caret = document.querySelector('[data-testid="note-selection"]');
      const position = () => `${caret.getAttribute('x')},${caret.getAttribute('y')}`;
      const before = position();
      const updated = new Promise(resolve => {
        const observer = new MutationObserver(() => {
          if (position() !== before) { observer.disconnect(); resolve(); }
        });
        observer.observe(caret, { attributes: true });
      });
      const start = performance.now();
      surface.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
      await updated;
      values.push(performance.now() - start);
    }
    return values;
  });
  await key('Home');
  await field('note-fret', 15);
  performanceResults.editDomMs = await page.evaluate(async () => {
    const updated = new Promise(resolve => {
      const observer = new MutationObserver(() => {
        const fret = document.querySelector('[data-measure="1"][data-beat="0"] .tab-fret');
        if (fret?.textContent === '0') { observer.disconnect(); resolve(); }
      });
      observer.observe(document.querySelector('.tab-drawing'), { subtree: true, childList: true, characterData: true });
    });
    const start = performance.now();
    document.querySelector('.tab-document').dispatchEvent(new KeyboardEvent('keydown', { key: '0', bubbles: true }));
    await updated;
    return performance.now() - start;
  });
  await field('note-fret', 0);
  await native('undo');
  await dirty(false);
  await page.locator('.tab-workspace').evaluate(e => { e.scrollTop = e.scrollHeight; });
  await page.locator('[data-column-id][data-measure="499"][data-beat="0"]').waitFor();
  const lastBar = await point(499, 0, 4);
  await page.mouse.click(lastBar.x, lastBar.y);
  await page.getByText('Measure 500 · Beat 1 · Voice 1', { exact: true }).waitFor();
  await key('ArrowLeft');
  await page.getByText('Measure 499 · Beat 9 · Voice 1', { exact: true }).waitFor();
  const lastCaret = await page.getByTestId('note-selection').boundingBox();
  const viewport = await page.locator('.tab-workspace').boundingBox();
  assert.ok(lastCaret.y >= viewport.y && lastCaret.y + lastCaret.height <= viewport.y + viewport.height);
  await page.getByLabel('Renderer', { exact: true }).selectOption('alphatab');
  await page.locator('.at-surface svg').first().waitFor();
  await page.getByLabel('Renderer', { exact: true }).selectOption('tabbycat');
  await page.getByTestId('tab-system').first().waitFor();
  await dirty(false);
  assert.deepEqual(errors, []);
  writeFileSync(join(output, 'performance.json'), JSON.stringify(performanceResults, null, 2));
  console.log('PASS: wrapped/continuous layout, viewport rendering of 500 measures, comparison renderer and no renderer exceptions');
  console.log(JSON.stringify(performanceResults));
  console.log(`Evidence: ${output}`);
} catch (error) {
  if (page && !page.isClosed()) {
    await page.screenshot({ path: join(output, 'failure.png') }).catch(() => {});
    console.error((await page.locator('body').innerText()).slice(0, 3000));
  }
  console.error(`Evidence: ${output}`);
  throw error;
} finally {
  await app.evaluate(({ app }) => app.exit()).catch(() => {});
}

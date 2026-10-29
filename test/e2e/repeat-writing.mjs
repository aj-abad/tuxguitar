import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { _electron } from 'playwright';
import { unzipSync } from 'fflate';
import { XMLParser } from 'fast-xml-parser';
import { repeatStudy } from '../fixtures/repeat-study.mjs';

mkdirSync('.cache', { recursive: true });
const output = mkdtempSync(resolve('.cache/repeat-writing-e2e-'));
const original = join(output, 'Repeat writing.tg'), saved = join(output, 'Written repeats.tg');
writeFileSync(original, repeatStudy({ repeats: false }));
const xml = path => new TextDecoder().decode(unzipSync(readFileSync(path))['content.xml']);
const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@', isArray: name => ['TGMeasureHeader', 'alternative'].includes(name) });
const headers = () => parser.parse(xml(saved)).TuxGuitarFile.TGSong.TGMeasureHeader;
const tracks = text => text.match(/<TGTrack\b.*?<\/TGTrack>/gs);
const app = await _electron.launch({ args: [resolve('.'), `--user-data-dir=${join(output, 'profile')}`], env: { ...process.env, TG_HEADLESS: '1' } });
let page;
const errors = [];
const control = kind => page.locator(`[data-repeat-command="repeat.${kind}"]`);
async function key(value) {
  await page.getByRole('region', { name: 'Tablature editor', exact: true }).focus();
  await page.keyboard.press(value);
}
async function pressed(kind, value) {
  await page.waitForFunction(({ kind, value }) => document.querySelector(`[data-repeat-command="repeat.${kind}"]`)?.getAttribute('aria-pressed') === String(value), { kind, value }, { polling: 25 });
}
async function field(id, value) {
  await page.waitForFunction(({ id, value }) => document.getElementById(id)?.value === String(value), { id, value }, { polling: 25 });
}
async function native(id) {
  await app.evaluate(({ Menu }, id) => { const item = Menu.getApplicationMenu().getMenuItemById(id); item.click(item, undefined, {}); }, id);
}
async function dirty(value) {
  await page.waitForFunction(value => [...document.querySelectorAll('[role="status"]')].some(e => e.textContent === 'Unsaved') === value, value, { polling: 25 });
}
async function nextMeasure() { await key('End'); await key('ArrowRight'); }
async function plays(value) { await page.locator('#repeat-plays').fill(String(value)); await page.locator('#repeat-plays').press('Enter'); }

try {
  page = await app.firstWindow();
  page.on('pageerror', e => errors.push(e.stack));
  await app.evaluate(({ dialog }, files) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [files.original] });
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: files.saved });
    dialog.showMessageBox = async () => ({ response: 1 });
  }, { original, saved });
  await page.getByRole('button', { name: 'Open file', exact: true }).click();
  await field('note-fret', 5);
  assert.equal(await control('start').locator('kbd').textContent(), '[');
  assert.equal(await control('end').locator('kbd').textContent(), ']');
  assert.equal(await control('ending').locator('kbd').textContent(), 'E');

  await page.getByRole('region', { name: 'Tablature editor', exact: true }).focus();
  await page.keyboard.down('['); await page.keyboard.down('['); await page.keyboard.up('[');
  await pressed('start', true); await dirty(true);
  await page.locator('[data-barline="repeat-start"]').first().waitFor();
  await page.getByRole('button', { name: 'Save As…', exact: true }).click();
  await dirty(false);
  assert.ok(Object.hasOwn(headers()[0], 'repeatOpen'));
  await native('undo'); await pressed('start', false); await dirty(true);
  await native('redo'); await pressed('start', true); await dirty(false);
  assert.deepEqual(tracks(xml(saved)), tracks(xml(original)));
  console.log('PASS: repeat-only edits mark the document dirty, save, and undo/redo around the saved state');

  await nextMeasure();
  await key('e'); await pressed('ending', true);
  assert.equal(await page.getByRole('checkbox', { name: 'Ending 1', exact: true }).isChecked(), true);
  await page.getByRole('checkbox', { name: 'Ending 2', exact: true }).check();
  await nextMeasure();
  await pressed('ending', false);
  await page.getByTestId('inherited-ending').filter({ hasText: 'Ending 1, 2 continues from measure 2.' }).waitFor();
  await key(']'); await pressed('end', true); await field('repeat-plays', 2);
  await plays(3); await field('repeat-plays', 3);
  await native('undo'); await field('repeat-plays', 2);
  await native('redo'); await field('repeat-plays', 3);
  await page.getByTestId('tab-repeat-count').locator('title').filter({ hasText: 'Play 3 times' }).waitFor({ state: 'attached' });
  await page.getByRole('region', { name: 'Measure repeats', exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(output, 'repeat-count-controls.png') });

  await nextMeasure();
  await control('ending').click(); await pressed('ending', true);
  await page.getByRole('checkbox', { name: 'Ending 3', exact: true }).check();
  await page.getByRole('checkbox', { name: 'Ending 1', exact: true }).uncheck();
  await page.getByRole('region', { name: 'Measure repeats', exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(output, 'ending-number-controls.png') });
  await native('save'); await dirty(false);
  let written = headers();
  assert.ok(Object.hasOwn(written[0], 'repeatOpen'));
  assert.deepEqual(written[1].repeatAlternative.alternative, [1, 2]);
  assert.equal(written[2].repeatClose, 2);
  assert.deepEqual(written[3].repeatAlternative.alternative, [3]);
  assert.deepEqual(tracks(xml(saved)), tracks(xml(original)));
  assert.equal((xml(saved).match(/<futureStructure value="retain"\/>/g) ?? []).length, 9);
  console.log('PASS: shortcuts and buttons author multi-measure endings, multiple pass numbers and total-play counts');

  await key('Home'); await key('Shift+ArrowLeft');
  assert.equal(await control('start').isDisabled(), true);
  await key('[');
  await page.getByRole('alert').filter({ hasText: 'within one measure' }).waitFor();
  await dirty(false);
  await page.getByRole('button', { name: 'Dismiss error', exact: true }).click();
  await key('Escape');
  await field('repeat-plays', 3);
  await page.locator('#repeat-plays').focus();
  await page.keyboard.press('['); await page.keyboard.press(']'); await page.keyboard.press('e');
  await pressed('start', false); await pressed('end', true); await pressed('ending', false); await dirty(false);
  await plays(3);
  await plays(1);
  await page.getByRole('alert').filter({ hasText: 'total plays from 2 to 101' }).waitFor();
  await field('repeat-plays', 3); await dirty(false);
  await page.getByRole('button', { name: 'Dismiss error', exact: true }).click();
  console.log('PASS: input focus, held keys, invalid counts and cross-measure ranges are guarded');

  await app.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }); }, saved);
  await page.getByRole('button', { name: 'Open file', exact: true }).click();
  await field('note-fret', 5); await pressed('start', true);
  assert.equal(await page.getByRole('button', { name: 'Undo edit', exact: true }).isDisabled(), true);
  await nextMeasure(); await pressed('ending', true);
  assert.equal(await page.getByRole('checkbox', { name: 'Ending 2', exact: true }).isChecked(), true);
  await page.getByRole('button', { name: 'Clear measure repeats', exact: true }).click();
  await pressed('ending', false); await dirty(true);
  await native('save'); await dirty(false);
  assert.equal(Object.hasOwn(headers()[1], 'repeatAlternative'), false);
  await native('undo'); await native('save'); await dirty(false);
  assert.deepEqual(headers()[1].repeatAlternative.alternative, [1, 2]);
  await page.getByLabel('Renderer', { exact: true }).selectOption('alphatab');
  await page.locator('.at-surface svg').first().waitFor();
  await page.getByRole('region', { name: /^Tablature editor/ }).focus();
  await page.keyboard.press('e'); await pressed('ending', false);
  await native('undo'); await pressed('ending', true); await dirty(false);
  await page.getByLabel('Renderer', { exact: true }).selectOption('tabbycat');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(800, 760));
  await page.waitForFunction(() => innerWidth <= 800);
  await page.getByRole('region', { name: 'Measure repeats', exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(output, 'narrow-repeat-controls.png') });
  assert.deepEqual(errors, []);
  console.log('PASS: authored repeats reopen, clear/save/undo/save preserves headers, and comparison shortcuts work');
  console.log(`Evidence: ${output}`);
} catch (error) {
  if (page && !page.isClosed()) {
    await page.screenshot({ path: join(output, 'failure.png') }).catch(() => {});
    console.error((await page.locator('body').innerText()).slice(0, 3000));
  }
  console.error(`Evidence: ${output}`);
  throw error;
} finally { await app.evaluate(({ app }) => app.exit()).catch(() => {}); }

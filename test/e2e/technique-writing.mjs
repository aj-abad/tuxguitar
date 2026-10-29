import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { _electron } from 'playwright';
import { unzipSync } from 'fflate';
import { XMLParser } from 'fast-xml-parser';
import { notationStudy } from '../fixtures/notation-study.mjs';

mkdirSync('.cache', { recursive: true });
const output = mkdtempSync(resolve('.cache/technique-writing-e2e-'));
const original = join(output, 'Technique writing.tg'), saved = join(output, 'Written techniques.tg');
writeFileSync(original, notationStudy({ techniques: false }));
const xml = path => new TextDecoder().decode(unzipSync(readFileSync(path))['content.xml']);
const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@', isArray: n => ['TGTrack', 'TGMeasure', 'TGBeat', 'voice', 'note', 'point'].includes(n) });
const savedNotes = () => parser.parse(xml(saved)).TuxGuitarFile.TGSong.TGTrack[0].TGMeasure[0].TGBeat.map(b => b.voice[0].note?.[0]);
const app = await _electron.launch({ args: [resolve('.'), `--user-data-dir=${join(output, 'profile')}`], env: { ...process.env, TG_HEADLESS: '1' } });
let page;
const errors = [];
const control = kind => page.locator(`[data-technique-command="${kind}"]`);
async function key(value) {
  await page.getByRole('region', { name: 'Tablature editor', exact: true }).focus();
  await page.keyboard.press(value);
}
async function pressed(kind, value) {
  await page.waitForFunction(({ kind, value }) => document.querySelector(`[data-technique-command="${kind}"]`)?.getAttribute('aria-pressed') === String(value), { kind, value }, { polling: 25 });
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
  assert.equal(await control('pull-off').isDisabled(), true);
  assert.equal(await control('tie').isDisabled(), true);
  assert.equal(await control('hammer-on').locator('kbd').textContent(), 'H');
  await page.screenshot({ path: join(output, 'technique-controls.png') });

  await page.getByRole('region', { name: 'Tablature editor', exact: true }).focus();
  await page.keyboard.down('h'); await page.keyboard.down('h'); await page.keyboard.up('h');
  await pressed('hammer-on', true);
  await key('s');
  await pressed('slide', true); await pressed('hammer-on', false);
  await native('undo');
  await pressed('hammer-on', true); await pressed('slide', false);
  await key('ArrowRight');
  await key('p'); await pressed('pull-off', true);
  await key('ArrowRight');
  await control('slide').click(); await pressed('slide', true);
  await key('ArrowRight');
  await key('b'); await pressed('bend', true);
  await page.getByLabel('Bend shape', { exact: true }).selectOption('prebend-release');
  await page.getByLabel('Bend amount', { exact: true }).selectOption('2');
  await page.getByRole('button', { name: 'Apply bend', exact: true }).click();
  await page.locator('[data-technique="bend"] title').filter({ hasText: 'Pre-bend ½ and release' }).waitFor({ state: 'attached' });
  await native('undo');
  await page.waitForFunction(() => document.querySelector('[aria-label="Bend amount"]').value === '4', null, { polling: 25 });
  await native('redo');
  await page.waitForFunction(() => document.querySelector('[aria-label="Bend amount"]').value === '2', null, { polling: 25 });
  await page.screenshot({ path: join(output, 'bend-settings.png') });
  console.log('PASS: buttons and B/S/H/P author techniques, replacement and bend presets are atomic, repeat is ignored');

  await key('End'); await key('ArrowDown'); await key('ArrowDown');
  await field('note-fret', 9);
  await key('t'); await pressed('tie', true);
  await page.locator('[data-technique="tie"]').first().waitFor();
  await page.getByRole('button', { name: 'Save As…', exact: true }).click();
  await dirty(false);
  let notes = savedNotes();
  assert.ok(Object.hasOwn(notes[0], 'hammer') && Object.hasOwn(notes[1], 'hammer') && Object.hasOwn(notes[2], 'slide'));
  assert.deepEqual(notes[3].bend.point.map(p => [Number(p['@position']), Number(p['@value'])]), [[0, 2], [6, 2], [12, 0]]);
  assert.equal(notes[7]['@tiedNote'], 'true');
  assert.equal([...xml(saved).matchAll(/future="retain"/g)].length, [...xml(original).matchAll(/future="retain"/g)].length);
  await native('undo'); await dirty(true);
  await native('redo'); await dirty(false);

  await page.locator('#note-fret').focus();
  await page.keyboard.press('t');
  await pressed('tie', true); await dirty(false);
  await page.locator('#note-string').focus();
  await page.keyboard.press('b');
  await pressed('tie', true); await dirty(false);
  await key('ArrowDown');
  assert.equal(await control('bend').isDisabled(), true);
  await key('b');
  await page.getByRole('alert').filter({ hasText: 'Select a note' }).waitFor();
  await dirty(false);
  await page.getByRole('button', { name: 'Dismiss error' }).click();
  await key('ArrowUp'); await key('Shift+ArrowLeft');
  assert.equal(await control('tie').isDisabled(), true);
  await key('Escape');
  console.log('PASS: T creates a sustained tie; input focus, empty cells and ranges cannot accidentally edit techniques');

  await app.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }); }, saved);
  await page.getByRole('button', { name: 'Open file', exact: true }).click();
  await field('note-fret', 5); await pressed('hammer-on', true);
  assert.equal(await page.getByRole('button', { name: 'Undo edit', exact: true }).isDisabled(), true);
  await page.getByRole('button', { name: 'Clear techniques', exact: true }).click();
  await pressed('hammer-on', false);
  await native('undo'); await pressed('hammer-on', true); await dirty(false);
  await key('ArrowRight'); await key('ArrowRight'); await key('ArrowRight');
  await page.getByRole('button', { name: 'Clear techniques', exact: true }).click();
  await pressed('bend', false);
  await native('save'); await dirty(false);
  notes = savedNotes();
  assert.equal(Object.hasOwn(notes[3], 'bend'), false);
  assert.ok(Object.hasOwn(notes[0], 'hammer') && notes[7]['@tiedNote'] === 'true');
  await native('undo'); await native('save'); await dirty(false);
  assert.ok(savedNotes()[3].bend);
  await page.getByLabel('Renderer', { exact: true }).selectOption('alphatab');
  await page.locator('.at-surface svg').first().waitFor();
  await page.getByRole('region', { name: /^Tablature editor/ }).focus();
  await page.keyboard.press('b'); await pressed('bend', false);
  await native('undo'); await pressed('bend', true); await dirty(false);
  await page.getByLabel('Renderer', { exact: true }).selectOption('tabbycat');
  await page.locator('[data-technique="bend"]').first().waitFor();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(800, 760));
  await page.waitForFunction(() => innerWidth <= 800);
  await page.getByLabel('Bend shape', { exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(output, 'narrow-controls.png') });
  assert.deepEqual(errors, []);
  console.log('PASS: authored techniques save/reopen, removal persists, undo restores, unrelated source attributes survive');
  console.log(`Evidence: ${output}`);
} catch (error) {
  if (page && !page.isClosed()) {
    await page.screenshot({ path: join(output, 'failure.png') }).catch(() => {});
    console.error((await page.locator('body').innerText()).slice(0, 3000));
  }
  console.error(`Evidence: ${output}`);
  throw error;
} finally { await app.evaluate(({ app }) => app.exit()).catch(() => {}); }

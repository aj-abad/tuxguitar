import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { _electron } from 'playwright';
import { unzipSync, zipSync } from 'fflate';
import { XMLParser } from 'fast-xml-parser';
import { audioTarget } from '../../scripts/audio-target.mjs';

mkdirSync('.cache', { recursive: true });
const output = mkdtempSync(resolve('.cache/rhythm-e2e-'));
const original = join(output, 'silent source.tg');
const saved = join(output, 'new riff.tg');
const archive = unzipSync(readFileSync('china.tg'));
// Exercise the real audio device without making the automated test audible.
archive['content.xml'] = new TextEncoder().encode(new TextDecoder().decode(archive['content.xml'])
  .replaceAll('<volume>127</volume>', '<volume>0</volume>')
  .replaceAll('<tempo>120</tempo>', '<tempo>30</tempo>'));
writeFileSync(original, zipSync(archive));
const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@',
  isArray: name => ['TGTrack', 'TGMeasure', 'TGBeat', 'voice', 'note'].includes(name) });
const savedBeats = () => parser.parse(new TextDecoder().decode(unzipSync(readFileSync(saved))['content.xml']))
  .TuxGuitarFile.TGSong.TGTrack[0].TGMeasure[1].TGBeat.filter(beat => beat.voice[0]['@empty'] !== 'true');
const packagedApp = process.env.TG_TEST_PACKAGED_APP;
const app = await _electron.launch({
  ...(packagedApp ? { executablePath: resolve(packagedApp) } : {}),
  args: [...(packagedApp ? [] : [resolve('.')]), `--user-data-dir=${join(output, 'profile')}`],
  env: { ...process.env, TG_HEADLESS: '1' },
});
let page;
const errors = [];
async function screenshot(name) {
  // Behavioral assertions run for both builds. Hidden packaged windows can
  // suspend screenshot capture; the development run retains visual evidence.
  if (!packagedApp) await page.screenshot({ path: join(output, name) });
}
async function dialogs(open = original) {
  await app.evaluate(({ dialog }, { open, saved }) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [open] });
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: saved });
    dialog.showMessageBox = async () => ({ response: 2, checkboxChecked: false });
  }, { open, saved });
}
async function field(id, value) {
  await page.waitForFunction(({ id, value }) => document.getElementById(id)?.value === String(value), { id, value });
}
async function dirty(value) {
  await page.waitForFunction(value => [...document.querySelectorAll('[role="status"]')]
    .some(el => el.textContent === 'Unsaved') === value, value);
}
async function rendered() {
  await page.locator('[data-testid="score-surface"][data-rendering="false"]').waitFor();
  await page.getByTestId('note-selection').first().waitFor();
}
async function nativeCommand(id) {
  await app.evaluate(({ Menu }, id) => {
    const item = Menu.getApplicationMenu().getMenuItemById(id);
    if (!item?.enabled) throw new Error(`Menu item disabled: ${id}`);
    item.click(item, undefined, {});
  }, id);
}
async function key(key) {
  await page.getByRole('region', { name: /^Tablature editor/ }).focus();
  await page.keyboard.press(key);
}
try {
  page = await app.firstWindow();
  page.on('pageerror', error => { errors.push(error.stack ?? error.message); console.error(error.stack ?? error.message); });
  await page.getByRole('button', { name: 'Open file', exact: true }).waitFor();
  await dialogs();
  await page.getByRole('button', { name: 'Open file', exact: true }).click();
  await field('note-fret', 15);
  await rendered();
  await key('End');
  await key('ArrowRight');
  await field('note-fret', '');
  await field('note-duration', 1);
  await page.getByText('Measure 2 · Beat 1 · Voice 1', { exact: true }).waitFor();
  await rendered();
  const restBox = await page.getByTestId('note-selection').last().boundingBox();
  await key('ArrowLeft');
  await field('note-fret', 13);
  await page.mouse.click(restBox.x + restBox.width / 2, restBox.y + restBox.height / 2);
  await field('note-fret', '');
  await field('note-duration', 1);

  await page.getByLabel('Duration', { exact: true }).selectOption('4');
  await key('7');
  await field('note-fret', 7);
  await key('ArrowDown');
  await field('note-string', 2);
  await field('note-fret', '');
  await key('5');
  await field('note-fret', 5);
  await key('Delete');
  await field('note-fret', '');
  await nativeCommand('undo');
  await field('note-fret', 5);
  await key('r');
  await field('note-fret', '');
  await nativeCommand('undo');
  await field('note-fret', 5);

  // Lengthen the chord into neighboring rest space, preserving the bar length.
  await key('=');
  await field('note-duration', 2);
  await key('ArrowRight');
  await field('note-fret', '');
  await field('note-duration', 2);
  await page.getByLabel('Duration', { exact: true }).selectOption('4');
  await key('9');
  await field('note-fret', 9);
  await key('ArrowLeft');
  await field('note-fret', 5);
  await page.getByLabel('Dots', { exact: true }).selectOption('1');
  await page.getByRole('alert').filter({ hasText: /overlap another note/ }).waitFor();
  await field('note-dots', 0);
  await field('note-duration', 2);
  await page.getByRole('button', { name: 'Dismiss error' }).click();
  await key('ArrowRight');
  await field('note-fret', 9);
  await key('.');
  await field('note-dots', 1);
  await rendered();
  await screenshot('rhythm.png');
  console.log('PASS: click rest, enter notes/chords, delete, rest, undo, duration, dots and collision recovery');

  await page.getByRole('button', { name: 'Save As…', exact: true }).click();
  await dirty(false);
  let beats = savedBeats();
  assert.deepEqual(beats.map(b => Number(b.voice[0].duration['@value'])), [2, 4, 8]);
  assert.deepEqual(beats.map(b => b.preciseStart), [14414400, 20180160, 24504480]);
  assert.deepEqual(beats[0].voice[0].note.map(n => [Number(n['@string']), Number(n['@value'])]), [[1, 7], [2, 5]]);
  assert.equal(Number(beats[1].voice[0].note[0]['@value']), 9);
  assert.equal(beats[1].voice[0].duration['@dotted'], 'dotted');
  assert.equal(beats[2].voice[0].note, undefined);
  await nativeCommand('undo');
  await field('note-dots', 0);
  await dirty(true);
  await nativeCommand('save');
  await dirty(false);
  assert.deepEqual(savedBeats().map(b => Number(b.voice[0].duration['@value'])), [2, 4, 4]);
  await nativeCommand('redo');
  await field('note-dots', 1);
  await nativeCommand('save');
  await dirty(false);
  await dialogs(saved);
  await page.getByRole('button', { name: 'Open file', exact: true }).click();
  await field('note-fret', 15);
  assert.equal(await page.getByRole('button', { name: 'Undo edit', exact: true }).isDisabled(), true);
  await key('End');
  await key('ArrowRight');
  await field('note-fret', 7);
  await field('note-duration', 2);
  await key('ArrowDown');
  await field('note-fret', 5);
  await key('ArrowRight');
  await field('note-fret', 9);
  await field('note-duration', 4);
  await field('note-dots', 1);
  console.log('PASS: structural Save As, undo-save-redo-save and reopen through the real document IPC');

  // A live sidecar tick (not only UI interpolation) must reach the edited bar.
  const target = audioTarget();
  const binary = packagedApp
    ? join(await app.evaluate(() => process.resourcesPath), 'sidecar', target.binary)
    : join('sidecar/bin', target.folder, target.binary);
  if (packagedApp) assert.ok(existsSync(binary), 'The packaged application must contain its audio sidecar.');
  if (existsSync(binary)) {
    await page.waitForFunction(async () => await window.tg.getSidecarStatus() === 'ready');
    await page.evaluate(() => {
      window.rhythmTicks = [];
      window.rhythmTickOff = window.tg.onTick(event => window.rhythmTicks.push(event));
    });
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await page.waitForFunction(() => window.rhythmTicks.some(event => event.tick > 14414400), undefined, { polling: 50 });
    assert.ok(Number(await page.getByRole('progressbar', { name: 'Playback progress' }).getAttribute('aria-valuenow')) > 0);
    // A vertical SVG line has a zero-width geometry box despite its visible stroke.
    await page.locator('.tab-playhead').waitFor({ state: 'attached' });
    const playheadX = await page.locator('.tab-playhead').getAttribute('x1');
    await page.waitForFunction(x => {
      const line = document.querySelector('.tab-playhead');
      return line && line.getAttribute('x1') !== x && getComputedStyle(line).stroke !== 'none' && line.getBoundingClientRect().height > 0;
    }, playheadX, { polling: 50 });
    await screenshot('playhead.png');
    await page.getByRole('button', { name: 'Stop playback', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('[aria-label="Stop playback"]').disabled);
    assert.equal(await page.locator('.tab-playhead').count(), 0);
    await page.evaluate(() => window.rhythmTickOff());
    assert.equal(await page.getByRole('alert').count(), 0);
    console.log('PASS: native audio device clock plays through the edited measure and stops (silent fixture)');
  } else console.log('SKIP: native playback requires pnpm sidecar:build');

  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(800, 700));
  await page.waitForFunction(() => window.innerWidth <= 800);
  await page.waitForTimeout(250);
  await rendered();
  await screenshot('rhythm-narrow.png');
  assert.deepEqual(errors, []);
  console.log(`Evidence: ${output}`);
} catch (error) {
  if (page && !page.isClosed()) {
    await screenshot('failure.png').catch(() => {});
    console.error((await page.locator('body').innerText()).slice(0, 3000));
  }
  console.error(`Evidence: ${output}`);
  throw error;
} finally {
  await app.evaluate(({ app }) => app.exit()).catch(() => {});
}

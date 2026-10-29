import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { _electron } from 'playwright';
import { notationStudy } from '../fixtures/notation-study.mjs';

mkdirSync('.cache', { recursive: true });
const output = mkdtempSync(resolve('.cache/articulation-playback-e2e-'));
const original = join(output, 'Articulation playback.tg');
writeFileSync(original, notationStudy({ silent: true }));
const app = await _electron.launch({ args: [resolve('.'), `--user-data-dir=${join(output, 'profile')}`],
  env: { ...process.env, TG_HEADLESS: '1' } });
let page;
const errors = [];
async function key(value) {
  await page.getByRole('region', { name: 'Tablature editor', exact: true }).focus();
  await page.keyboard.press(value);
}
async function stopped() {
  await page.waitForFunction(() => document.querySelector('[aria-label="Stop playback"]').disabled);
  assert.equal(await page.locator('.tab-playhead').count(), 0);
}
try {
  page = await app.firstWindow();
  page.on('pageerror', error => errors.push(error.stack));
  await app.evaluate(({ dialog }, original) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [original] });
    dialog.showMessageBox = async () => ({ response: 1 });
  }, original);
  await page.getByRole('button', { name: 'Open file', exact: true }).click();
  await page.waitForFunction(() => document.getElementById('note-fret')?.value === '5');
  await page.waitForFunction(async () => await window.tg.getSidecarStatus() === 'ready');
  await page.evaluate(() => {
    window.articulationTicks = [];
    window.articulationUnsubscribe = window.tg.onTick(event => window.articulationTicks.push(event));
  });
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  // Cross the H/P and slide passages, chord bends, and the cross-bar tie.
  await page.waitForFunction(() => window.articulationTicks.some(event => event.tick > 2882880 + 15 * 960 * 3003),
    undefined, { timeout: 20000, polling: 50 });
  await page.locator('.tab-playhead').waitFor({ state: 'attached' });
  await page.getByRole('button', { name: 'Stop playback', exact: true }).click();
  await stopped();
  await page.screenshot({ path: join(output, 'articulation-score.png') });

  // Change the current score, play it, then undo during playback and restart.
  await key('b');
  assert.equal(await page.locator('[data-technique-command="bend"]').getAttribute('aria-pressed'), 'true');
  await page.evaluate(() => { window.articulationTicks = []; });
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.waitForFunction(() => window.articulationTicks.some(event => event.tick > 2882880), undefined, { polling: 50 });
  await page.getByRole('button', { name: 'Undo edit', exact: true }).click();
  await stopped();
  assert.equal(await page.locator('[data-technique-command="bend"]').getAttribute('aria-pressed'), 'false');
  await page.evaluate(() => { window.articulationTicks = []; });
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.waitForFunction(() => window.articulationTicks.some(event => event.tick > 2882880), undefined, { polling: 50 });
  await page.getByRole('button', { name: 'Stop playback', exact: true }).click();
  await stopped();
  await page.evaluate(() => window.articulationUnsubscribe());
  assert.equal(await page.getByRole('alert').count(), 0);
  assert.deepEqual(errors, []);
  console.log('PASS: native playback crosses articulations and ties; edit, stop, undo and replay work (silent fixture)');
  console.log(`Evidence: ${output}`);
} catch (error) {
  if (page && !page.isClosed()) await page.screenshot({ path: join(output, 'failure.png') }).catch(() => {});
  console.error(`Evidence: ${output}`);
  throw error;
} finally {
  await app.evaluate(({ app }) => app.exit()).catch(() => {});
}

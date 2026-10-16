import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { _electron } from 'playwright';
import { unzipSync } from 'fflate';

mkdirSync('.cache', { recursive: true });
const output = mkdtempSync(resolve('.cache/editor-e2e-'));
const original = join(output, 'original.tg');
const saved = join(output, 'saved riff.tg');
const recovered = join(output, 'recovered.tg');
const invalid = join(output, 'invalid.tg');
const dropped = join(output, 'Drop – 日本語.TG');
const unsupported = join(output, 'unsupported.gp5');
const folder = join(output, 'folder.tg');
writeFileSync(original, readFileSync('china.tg'));
writeFileSync(dropped, readFileSync('china.tg'));
writeFileSync(unsupported, readFileSync('china.tg'));
writeFileSync(invalid, 'not a song');
mkdirSync(folder);
const xml = path => new TextDecoder().decode(unzipSync(readFileSync(path))['content.xml']);
const app = await _electron.launch({ args: [resolve('.'), `--user-data-dir=${join(output, 'profile')}`], env: { ...process.env, TG_HEADLESS: '1' } });
let page;
let cdp;
const errors = [];
async function dialogs({ open = original, save = saved, answer = 2, cancelSave = false, cancelOpen = false } = {}) {
  await app.evaluate(({ dialog }, values) => {
    globalThis.editorDialogCalls = { open: 0, confirm: 0 };
    dialog.showOpenDialog = async () => {
      globalThis.editorDialogCalls.open++;
      return { canceled: values.cancelOpen, filePaths: [values.open] };
    };
    dialog.showSaveDialog = async () => ({ canceled: values.cancelSave, filePath: values.save });
    dialog.showMessageBox = async () => {
      globalThis.editorDialogCalls.confirm++;
      return { response: values.answer, checkboxChecked: false };
    };
  }, { open, save, answer, cancelSave, cancelOpen });
}
async function fret(value) {
  await page.waitForFunction(expected => document.getElementById('note-fret')?.value === String(expected), value);
}
async function dirty(expected) {
  await page.waitForFunction(expected => [...document.querySelectorAll('[role="status"]')]
    .some(el => el.textContent === 'Unsaved') === expected, expected);
}
async function rendered() {
  await page.locator('[data-testid="score-surface"][data-rendering="false"]').waitFor();
  await page.locator('.at-surface svg').first().waitFor();
}
async function nativeCommand(id) {
  await app.evaluate(({ Menu }, id) => {
    const menu = Menu.getApplicationMenu();
    const item = menu.getMenuItemById(id);
    if (!item.enabled) throw new Error(`Menu item disabled: ${id}`);
    item.click(item, undefined, {});
  }, id);
}
async function nativeDrop(paths, target = 'main', screenshot) {
  const box = await page.locator(target).boundingBox();
  const event = { x: box.x + box.width / 2, y: box.y + box.height / 2,
    data: { items: [], files: paths, dragOperationsMask: 1 } };
  // CDP supplies native, disk-backed File objects through Chromium's real
  // drag pipeline. No path stubs or replacement preload APIs are involved.
  await cdp.send('Input.dispatchDragEvent', { type: 'dragEnter', ...event });
  await cdp.send('Input.dispatchDragEvent', { type: 'dragOver', ...event });
  await page.getByTestId('file-drop-overlay').waitFor();
  if (screenshot) await page.screenshot({ path: join(output, screenshot) });
  await cdp.send('Input.dispatchDragEvent', { type: 'drop', ...event });
  await page.getByTestId('file-drop-overlay').waitFor({ state: 'hidden' });
  await page.waitForFunction(() => !document.querySelector('[aria-label="Open file"]')?.disabled);
}
try {
  page = await app.firstWindow();
  page.on('pageerror', error => errors.push(error.message));
  await page.getByRole('button', { name: 'Open file', exact: true }).waitFor();
  cdp = await page.context().newCDPSession(page);

  await dialogs({ open: invalid });
  await nativeDrop([dropped], 'main', 'file-drop.png');
  await fret(15);
  await page.getByLabel('Renderer', { exact: true }).selectOption('alphatab');
  await rendered();
  assert.equal((await app.evaluate(() => globalThis.editorDialogCalls)).open, 0);
  await page.getByTitle('Drop – 日本語.TG', { exact: true }).waitFor();

  // Dropping over the inspector commits a focused fret before the dirty guard.
  await page.getByLabel('Fret', { exact: true }).fill('11');
  await dialogs({ answer: 2 });
  await nativeDrop([original], 'aside');
  await fret(11);
  await dirty(true);
  assert.equal((await app.evaluate(() => globalThis.editorDialogCalls)).confirm, 1);
  await page.getByTitle('Drop – 日本語.TG', { exact: true }).waitFor();

  for (const [paths, message] of [
    [[unsupported], /Unsupported file type/],
    [[original, dropped], /Drop one file at a time/],
    [[folder], /Folders cannot be opened/],
    [[invalid], /.+/],
  ]) {
    await dialogs({ answer: 1 });
    await nativeDrop(paths, 'footer');
    await page.getByRole('alert').filter({ hasText: message }).waitFor();
    await fret(11);
    await dirty(true);
    await page.getByTitle('Drop – 日本語.TG', { exact: true }).waitFor();
    if (paths.length > 1 || paths[0] === unsupported) {
      assert.equal((await app.evaluate(() => globalThis.editorDialogCalls)).confirm, 0);
    }
    assert.equal(page.url(), 'app://bundle/');
    await page.getByRole('button', { name: 'Dismiss error' }).click();
  }

  // Save must write the previous document before replacing it with the drop.
  await dialogs({ answer: 0 });
  await nativeDrop([original]);
  await fret(15);
  await dirty(false);
  assert.equal(xml(dropped), xml(original).replace('value="15"', 'value="11"'));
  await page.getByLabel('Fret', { exact: true }).fill('9');
  await dialogs({ answer: 1 });
  await nativeDrop([dropped]);
  await fret(11);
  await dirty(false);
  assert.deepEqual(readFileSync(original), readFileSync('china.tg'));
  assert.equal(await page.getByRole('button', { name: 'Undo edit', exact: true }).isDisabled(), true);

  // A synthetic File cannot smuggle an arbitrary filesystem path across IPC.
  await page.evaluate(() => {
    const transfer = new DataTransfer();
    transfer.items.add(new File(['not on disk'], 'memory.tg'));
    document.body.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }));
  });
  await page.getByRole('alert').filter({ hasText: 'Drop a file from your computer.' }).waitFor();
  await fret(11);
  await page.getByRole('button', { name: 'Dismiss error' }).click();

  // Moving across child elements must not flicker the target; Escape clears it.
  const drag = await page.evaluateHandle(() => {
    const data = new DataTransfer();
    data.items.add(new File([], 'example.tg'));
    return data;
  });
  await page.dispatchEvent('main', 'dragenter', { dataTransfer: drag });
  await page.dispatchEvent('aside', 'dragenter', { dataTransfer: drag });
  await page.dispatchEvent('aside', 'dragleave', { dataTransfer: drag });
  assert.equal(await page.getByTestId('file-drop-overlay').isVisible(), true);
  await page.keyboard.press('Escape');
  await page.getByTestId('file-drop-overlay').waitFor({ state: 'hidden' });
  await drag.dispose();
  const urlDropPrevented = await page.evaluate(() => {
    const data = new DataTransfer();
    data.setData('text/uri-list', 'https://example.com/');
    const event = new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: data });
    document.body.dispatchEvent(event);
    return event.defaultPrevented;
  });
  assert.equal(urlDropPrevented, true);
  assert.equal(page.url(), 'app://bundle/');
  console.log('PASS: native file drops, uppercase/Unicode paths, focused edits, Save/Discard/Cancel, invalid/multiple files and drag cleanup');

  await dialogs();
  await page.getByRole('button', { name: 'Open file', exact: true }).click();
  await fret(15);
  const score = page.getByRole('region', { name: /^Tablature editor/ });
  // Named section is an implicit region, and the real alphaTab render must
  // produce bounds before the editing assertions begin.
  await page.locator('[data-testid="note-selection"]').first().waitFor();
  await rendered();
  await page.screenshot({ path: join(output, 'initial.png') });
  await score.focus();
  await page.keyboard.type('12');
  await fret(12);
  await dirty(true);
  await nativeCommand('undo');
  await fret(15);
  await dirty(false);
  await nativeCommand('redo');
  await fret(12);
  await rendered();
  const firstBox = await page.locator('[data-testid="note-selection"]').last().boundingBox();
  await score.focus();
  await page.keyboard.press('ArrowRight');
  await fret(15);
  await page.keyboard.type('7');
  await fret(7);
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z');
  await fret(15);
  await rendered();
  await page.mouse.click(firstBox.x + firstBox.width / 2, firstBox.y + firstBox.height / 2);
  await fret(12);
  await page.screenshot({ path: join(output, 'editor.png') });
  console.log('PASS: rendered note selection, keyboard fret input, undo/redo, navigation and click selection');

  await dialogs({ cancelSave: true });
  await page.getByRole('button', { name: 'Save As…', exact: true }).click();
  await dirty(true);
  await dialogs();
  await page.getByRole('button', { name: 'Save As…', exact: true }).click();
  await dirty(false);
  assert.equal(xml(saved), xml(original).replace('value="15"', 'value="12"'));
  assert.deepEqual(readFileSync(original), readFileSync('china.tg'));

  // Native Save must commit a still-focused inspector field before writing.
  await page.getByLabel('Fret', { exact: true }).fill('11');
  await nativeCommand('save');
  await fret(11);
  await dirty(false);
  assert.equal(xml(saved), xml(original).replace('value="15"', 'value="11"'));
  await nativeCommand('undo');
  await fret(12);
  await nativeCommand('save');
  await dirty(false);

  // Reopen the saved file through the actual main-process reader and IPC.
  await dialogs({ open: saved });
  await page.getByRole('button', { name: 'Open file', exact: true }).click();
  await fret(12);
  assert.equal(await page.getByRole('button', { name: 'Undo edit', exact: true }).isDisabled(), true);
  console.log('PASS: cancel Save As, save without changing source, reopen with cleared history');

  await score.focus();
  await page.keyboard.type('9');
  await fret(9);
  await dialogs({ open: original, answer: 2 });
  await page.getByRole('button', { name: 'Open file', exact: true }).click();
  await fret(9);
  await dirty(true);
  await dialogs({ open: invalid, answer: 1 });
  await page.getByRole('button', { name: 'Open file', exact: true }).click();
  await page.getByRole('alert').first().waitFor();
  await fret(9);
  await dirty(true);
  await page.getByRole('button', { name: 'Dismiss error' }).click();

  writeFileSync(saved, 'external change');
  await page.getByRole('button', { name: 'Save file', exact: true }).click();
  await page.getByText(/changed outside Tabbycat/).waitFor();
  await dirty(true);
  assert.equal(readFileSync(saved, 'utf8'), 'external change');
  await dialogs({ save: recovered });
  await page.getByRole('button', { name: 'Save As…', exact: true }).click();
  await dirty(false);
  assert.equal(xml(recovered), xml(original).replace('value="15"', 'value="9"'));
  console.log('PASS: cancel/discard guards, invalid-file recovery and external-change protection');

  // Validate a narrow desktop window, including editor keyboard focus.
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(800, 700));
  await page.waitForFunction(() => window.innerWidth <= 800);
  // Wait for the score's ResizeObserver and alphaTab render to settle.
  await page.waitForTimeout(250);
  await rendered();
  const geometry = await page.evaluate(() => {
    const el = document.querySelector('[data-testid="score-surface"]');
    return { surface: el.clientWidth, parent: el.parentElement.clientWidth, viewport: el.closest('[data-reka-scroll-area-viewport]')?.clientWidth };
  });
  assert.ok(geometry.surface <= geometry.viewport, `Score did not shrink: ${JSON.stringify(geometry)}`);
  await page.screenshot({ path: join(output, 'narrow.png') });
  await score.focus();
  await page.keyboard.type('8');
  await fret(8);
  await dialogs({ answer: 2 });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
  await page.waitForFunction(() => document.getElementById('note-fret')?.value === '8');
  await dirty(true);
  assert.equal(app.windows().length, 1);
  await dialogs({ answer: 0 });
  const closed = page.waitForEvent('close');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
  await closed;
  assert.equal(xml(recovered), xml(original).replace('value="15"', 'value="8"'));
  assert.deepEqual(errors, []);
  console.log('PASS: native window-close Cancel and Save, no renderer exceptions');
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

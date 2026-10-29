import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { release } from 'node:os';
import { _electron } from 'playwright';
import { unzipSync, zipSync } from 'fflate';

mkdirSync('.cache', { recursive: true });
const output = mkdtempSync(resolve('.cache/tab-design-e2e-'));
const original = join(output, 'Page design study.tg'), saved = join(output, 'Designed study.tgx');
const entries = unzipSync(readFileSync('china.tg'));
const patterns = [[4, 4, 4, 4], [4, 4, 4, 4], [16, 16, 8, 2, 4], [8, 8, 8, 8, 8, 8, 8, 8], [4, 4, 4, 4], [4, 4, 4, 4], [8, 8, 4, 4, 4], [2, 2]];
let time = 2882880;
const measures = patterns.map((pattern, bar) => '<TGMeasure><clef>treble</clef><keySignature>0</keySignature>' + pattern.map((value, index) => {
  const start = time; time += 11531520 / value;
  return `<TGBeat><preciseStart>${start}</preciseStart><voice empty="false"><duration value="${value}"/><note string="${index % 6 + 1}" value="${5 + (index + bar) % 10}" velocity="95" future="retain"/></voice><voice empty="true"><duration value="4"/></voice></TGBeat>`;
}).join('') + '</TGMeasure>');
let xml = new TextDecoder().decode(entries['content.xml']).replace('<TGSong><name/>', '<TGSong><name>Page design study</name>')
  .replace(/<TGMeasureHeader>.*?<\/TGMeasureHeader>/gs, '').replace('<TGTrack', '<TGMeasureHeader><timeSignature numerator="4" denominator="4"/><tempo>120</tempo></TGMeasureHeader>'.repeat(patterns.length) + '<TGTrack')
  .replace(/<TGMeasure>.*?<\/TGMeasure>/gs, '').replace('</TGTrack>', measures.join('') + '</TGTrack>');
entries['content.xml'] = new TextEncoder().encode(xml);
writeFileSync(original, zipSync(entries));
const app = await _electron.launch({ args: [resolve('.'), `--user-data-dir=${join(output, 'profile')}`], env: { ...process.env, TG_HEADLESS: '1' } });
let page;
const errors = [];
const dirty = value => page.waitForFunction(value => [...document.querySelectorAll('[role="status"]')].some(e => e.textContent === 'Unsaved') === value, value);
const rows = () => page.getByTestId('tab-system').evaluateAll(systems => systems.map(system => [...new Set([...system.querySelectorAll('[data-measure]')].map(column => Number(column.dataset.measure)))]));
const width = () => page.getByLabel('Bar width', { exact: true }).inputValue().then(Number);
async function native(id) {
  await app.evaluate(({ Menu }, id) => { const item = Menu.getApplicationMenu().getMenuItemById(id); item.click(item, undefined, {}); }, id);
}
try {
  page = await app.firstWindow();
  page.setDefaultTimeout(15_000);
  page.on('pageerror', e => errors.push(e.stack));
  await app.evaluate(({ BrowserWindow, dialog }, paths) => {
    BrowserWindow.getAllWindows()[0].setSize(1600, 1000);
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [paths.original] });
    dialog.showSaveDialog = async (_window, options) => {
      if (!options.defaultPath.endsWith('.tgx')) throw new Error('Design save must suggest TGX');
      return { canceled: false, filePath: paths.saved };
    };
    dialog.showMessageBox = async () => ({ response: 1 });
  }, { original, saved });
  await page.getByRole('button', { name: 'Open file', exact: true }).click();
  await page.getByTestId('tab-system').first().waitFor();
  if (process.platform === 'win32' && Number(release().split('.')[2]) >= 22621) {
    const hwnd = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getNativeWindowHandle().readBigUInt64LE().toString());
    const material = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', resolve('test/e2e/windows-backdrop.ps1'), '-WindowHandle', hwnd], { encoding: 'utf8', windowsHide: true });
    assert.equal(Number(material.trim()), 3, 'DWM must report Desktop Acrylic');
    console.log('PASS: Windows DWM reports native acrylic');
  }
  const paper = await page.locator('.tab-document').boundingBox(), canvas = await page.locator('.tab-workspace').boundingBox();
  assert.equal(Math.round(paper.width), 860);
  assert.ok(Math.abs(paper.x + paper.width / 2 - (canvas.x + canvas.width / 2)) < 12, 'Page must be centered');
  await page.screenshot({ path: join(output, 'page.png') });
  await page.getByRole('button', { name: 'Design mode', exact: true }).click();
  const initialRows = await rows(), initialWidth = await width();
  const handle = page.getByRole('slider', { name: 'Resize bars 1 and 2', exact: true });
  const box = await handle.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down(); await page.mouse.move(box.x + box.width / 2 + 48, box.y + box.height / 2, { steps: 8 }); await page.mouse.up();
  await dirty(true);
  assert.ok(Math.abs(await width() - initialWidth - 48) <= 1);
  assert.deepEqual(await rows(), initialRows);
  // A canceled drag has no history entry and restores the committed widths.
  const afterDrag = await width(), nextBox = await handle.boundingBox();
  await page.mouse.move(nextBox.x + nextBox.width / 2, nextBox.y + nextBox.height / 2);
  await page.mouse.down(); await page.mouse.move(nextBox.x + nextBox.width / 2 + 20, nextBox.y + nextBox.height / 2);
  await page.keyboard.press('Escape'); await page.mouse.up();
  assert.equal(await width(), afterDrag);
  await native('undo'); await dirty(false); assert.equal(await width(), initialWidth);
  await native('redo'); await dirty(true);
  await page.getByRole('button', { name: 'Break after bar', exact: true }).click();
  assert.deepEqual((await rows())[0], [0]);
  assert.equal((await rows())[1][0], 1);
  await page.getByRole('button', { name: 'Pull bar from next row', exact: true }).click();
  assert.deepEqual((await rows())[0], [0, 1]);
  await page.getByRole('slider', { name: 'Resize bars 1 and 2', exact: true }).focus();
  const beforeKey = await width();
  await page.keyboard.press('ArrowRight');
  assert.equal(await width(), beforeKey + 4);
  await page.screenshot({ path: join(output, 'design-mode.png') });
  // Zoom and window resizing must never reflow an explicitly designed row.
  const rowBeforeZoom = (await rows())[0];
  await page.getByLabel('Tab zoom', { exact: true }).selectOption('1.5');
  const zoomHandle = page.getByRole('slider', { name: 'Resize bars 1 and 2', exact: true });
  const zoomBox = await zoomHandle.boundingBox(), beforeZoomDrag = await width();
  await page.mouse.move(zoomBox.x + zoomBox.width / 2, zoomBox.y + zoomBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(zoomBox.x + zoomBox.width / 2 + 30, zoomBox.y + zoomBox.height / 2, { steps: 5 });
  await page.mouse.up();
  assert.ok(Math.abs(await width() - beforeZoomDrag - 20) <= 1, 'A 30-pixel drag at 150% must resize by 20 document units');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(950, 800));
  assert.deepEqual((await rows())[0], rowBeforeZoom);
  assert.equal(Math.round((await page.locator('.tab-document').boundingBox()).width), 1290);
  await page.locator('.tab-workspace').evaluate(e => { e.scrollTop = 0; e.scrollLeft = 0; });
  await page.screenshot({ path: join(output, 'narrow-zoom.png') });
  await page.getByLabel('Tab zoom', { exact: true }).selectOption('1');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1600, 1000));
  await page.locator('[data-design-measure="1"]').click();
  await page.getByText('Measure 2 · Beat 1 · Voice 1', { exact: true }).waitFor();
  await page.locator('[data-design-measure="0"]').click();
  await page.getByRole('button', { name: 'Save file', exact: true }).click();
  await dirty(false);
  const persisted = JSON.parse(readFileSync(saved, 'utf8'));
  assert.equal(persisted.v, 2);
  assert.equal(persisted.song.tracks[0].tabLayout.rows.flat().length, patterns.length);
  assert.equal(persisted.song.tracks[0].tabLayout.rows[0].length, 2);
  assert.ok(persisted.sourceTg);
  const sourceXml = new TextDecoder().decode(unzipSync(Buffer.from(persisted.sourceTg, 'base64'))['content.xml']);
  assert.ok(sourceXml.includes('future="retain"'));
  await app.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }); }, saved);
  await page.getByRole('button', { name: 'Open file', exact: true }).click();
  await dirty(false);
  assert.deepEqual((await rows())[0], [0, 1]);
  assert.equal(await width(), Math.round(persisted.song.tracks[0].tabLayout.rows[0][0]));
  await page.getByRole('button', { name: 'Design mode', exact: true }).click();
  await page.getByRole('region', { name: 'Tablature editor', exact: true }).focus();
  await page.keyboard.press('9');
  await dirty(true);
  await page.getByRole('button', { name: 'Save file', exact: true }).click(); await dirty(false);
  assert.equal(JSON.parse(readFileSync(saved, 'utf8')).song.tracks[0].measures[0].beats[0].voices[0].notes[0].value, 9);
  assert.deepEqual(JSON.parse(readFileSync(saved, 'utf8')).song.tracks[0].tabLayout, persisted.song.tracks[0].tabLayout);
  await page.getByRole('button', { name: 'Design mode', exact: true }).click();
  await page.getByRole('button', { name: 'Automatic layout', exact: true }).click(); await dirty(true);
  await native('undo'); await dirty(false);
  assert.deepEqual(errors, []);
  console.log('PASS: centered page, drag/keyboard sizing, manual rows, zoom, undo/redo, TGX save/reopen/edit/save and reset');
  console.log(`Evidence: ${output}`);
} catch (error) {
  if (page && !page.isClosed()) { await page.screenshot({ path: join(output, 'failure.png') }).catch(() => {}); console.error((await page.locator('body').innerText()).slice(0, 2500)); }
  console.error(`Evidence: ${output}`); throw error;
} finally { await app.evaluate(({ app }) => app.exit()).catch(() => {}); }

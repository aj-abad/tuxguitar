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
async function clickCell(measure, beat, string, modifier) {
  const p = await point(measure, beat, string);
  if (modifier) await page.keyboard.down(modifier);
  await page.mouse.click(p.x, p.y);
  if (modifier) await page.keyboard.up(modifier);
}
async function expectCells(cells, selected = true) {
  await page.waitForFunction(({ cells, selected }) => {
    const rectangles = [...document.querySelectorAll('[data-testid="tab-selection-range"], [data-testid="note-selection"]')]
      .map(r => Object.fromEntries(['x', 'y', 'width', 'height'].map(key => [key, Number(r.getAttribute(key))])));
    return cells.every(([measure, beat, string]) => {
      const column = document.querySelector(`[data-column-id][data-measure="${measure}"][data-beat="${beat}"]`);
      const line = column?.closest('[data-testid="tab-system"]').querySelectorAll('.tab-string')[string - 1];
      if (!column || !line) return false;
      const x = Number(column.querySelector('.tab-guide').getAttribute('x1')), y = Number(line.getAttribute('y1'));
      return rectangles.some(r => x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height) === selected;
    });
  }, { cells, selected });
}
try {
  page = await app.firstWindow();
  page.setDefaultTimeout(15_000);
  page.on('pageerror', error => { errors.push(error.stack); console.error(error.stack); });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1600, 1100));
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
  assert.ok(Math.abs(empty.y - occupied.y - 18) < .1, JSON.stringify({ occupied, empty }));
  await page.getByLabel('Tab zoom', { exact: true }).selectOption('1.5');
  const target = await point(0, 0, 3);
  const nextTarget = await point(0, 1, 3);
  await page.mouse.click(target.x + (nextTarget.x - target.x) * .6, target.y + 2);
  await page.getByText('Measure 1 · Beat 2 · Voice 1', { exact: true }).waitFor();
  await field('note-string', 3);
  await field('note-fret', '');
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

  // A drag can start on the heading/padding, without selecting document text.
  await page.locator('.tab-workspace').evaluate(e => { e.scrollTop = 0; e.scrollLeft = 0; });
  const paper = await page.locator('.tab-document').boundingBox();
  const headingStart = { x: paper.x + 16, y: paper.y + 16 }, headingEnd = await point(0, 1, 2);
  await page.mouse.move(headingStart.x, headingStart.y); await page.mouse.down();
  await page.mouse.move(headingStart.x + 1, headingStart.y + 1);
  assert.equal(await page.getByTestId('tab-selection-marquee').count(), 0, 'A small click movement must not start a marquee');
  await page.mouse.move(headingEnd.x, headingEnd.y, { steps: 8 });
  const marqueeBox = await page.getByTestId('tab-selection-marquee').boundingBox();
  assert.ok(Math.abs(marqueeBox.x - headingStart.x) < 1 && Math.abs(marqueeBox.y - headingStart.y) < 1);
  assert.ok(Math.abs(marqueeBox.width - (headingEnd.x - headingStart.x)) < 1);
  assert.ok(Math.abs(marqueeBox.height - (headingEnd.y - headingStart.y)) < 1);
  assert.equal(await page.evaluate(() => window.getSelection()?.toString()), '');
  await page.screenshot({ path: join(output, 'document-marquee.png') });
  await page.mouse.up();
  assert.equal(await page.getByTestId('tab-selection-marquee').count(), 0);
  assert.equal(await page.getByTestId('tab-selection-range').count(), 1);
  await expectCells([[0, 0, 1], [0, 0, 6], [0, 1, 1], [0, 1, 6]]);
  await dirty(false);

  // Clicks in the margin and above/below the tab focus cells, including empty ones.
  const emptyMargin = await point(0, 0, 3), firstString = await point(0, 0, 1);
  await page.mouse.click(paper.x + 8, emptyMargin.y);
  await field('note-string', 3); await field('note-fret', '');
  await page.getByText('Measure 1 · Beat 1 · Voice 1', { exact: true }).waitFor();
  assert.equal(await page.getByTestId('note-selection').count(), 1);
  await page.mouse.click(firstString.x, firstString.y - 24);
  await field('note-string', 1);
  assert.equal(await page.getByTestId('tab-selection-range').count(), 0);

  // The rectangle augments the wrapped range; notes outside its horizontal
  // extent remain selected by the musical range.
  const crossStart = await point(0, 6, 1), crossEnd = await point(1, 1, 6);
  const outside = await point(0, 8, 1);
  assert.ok(outside.x > Math.max(crossStart.x, crossEnd.x));
  const outsideNotes = page.locator('[data-measure="0"][data-beat="8"] .tab-fret');
  const outsideCount = await outsideNotes.count();
  assert.ok(outsideCount > 0);
  await page.mouse.move(crossStart.x, crossStart.y); await page.mouse.down();
  await page.mouse.move(crossEnd.x, crossEnd.y, { steps: 10 });
  await expectCells([[0, 4, 1], [0, 4, 6], [0, 5, 1], [0, 8, 1], [1, 0, 1], [1, 1, 6]]);
  assert.equal(await page.getByTestId('tab-selection-range').count(), 2);
  await page.screenshot({ path: join(output, 'continuous-range-marquee.png') });
  await page.mouse.up();
  const forwardRanges = await page.getByTestId('tab-selection-range').evaluateAll(rects => rects.map(r => r.outerHTML));
  await page.mouse.move(crossEnd.x, crossEnd.y); await page.mouse.down();
  await page.mouse.move(crossStart.x, crossStart.y, { steps: 10 }); await page.mouse.up();
  assert.deepEqual(await page.getByTestId('tab-selection-range').evaluateAll(rects => rects.map(r => r.outerHTML)), forwardRanges);
  await key('Delete'); await dirty(true);
  assert.equal(await outsideNotes.count(), 0);
  assert.equal(await page.locator('[data-measure="1"][data-beat="0"] .tab-fret').count(), 0);
  await native('undo'); await dirty(false);
  assert.equal(await outsideNotes.count(), outsideCount);

  // Escape terminates a captured drag, and releasing outside the page cleans it up.
  await page.mouse.move(headingStart.x, headingStart.y); await page.mouse.down();
  await page.mouse.move(headingEnd.x, headingEnd.y);
  await page.keyboard.press('Escape');
  await page.mouse.move(headingEnd.x + 24, headingEnd.y + 24); await page.mouse.up();
  assert.equal(await page.getByTestId('tab-selection-marquee').count(), 0);
  assert.equal(await page.getByTestId('tab-selection-range').count(), 0);
  await page.mouse.move(emptyMargin.x, emptyMargin.y); await page.mouse.down();
  await page.mouse.move(paper.x - 10, emptyMargin.y + 18); await page.mouse.up();
  assert.equal(await page.getByTestId('tab-selection-marquee').count(), 0);

  // Start in the white footer below the SVG, then drag back toward a measure.
  await page.locator('.tab-workspace').evaluate(e => { e.scrollTop = e.scrollHeight; });
  const footerPaper = await page.locator('.tab-document').boundingBox(), footerEnd = await point(1, 1, 3);
  await page.mouse.move(footerPaper.x + footerPaper.width - 12, footerPaper.y + footerPaper.height - 12);
  await page.mouse.down(); await page.mouse.move(footerEnd.x, footerEnd.y, { steps: 8 });
  assert.equal(await page.getByTestId('tab-selection-marquee').count(), 1);
  await page.mouse.up(); await field('note-string', 3);
  await page.getByText('Measure 2 · Beat 2 · Voice 1', { exact: true }).waitFor();
  await dirty(false);
  await page.locator('.tab-workspace').evaluate(e => { e.scrollTop = 0; });
  const reset = await point(0, 0, 2); await page.mouse.click(reset.x, reset.y);
  console.log('PASS: document-wide marquee, nearest empty cells, continuous wrapped ranges, reverse drag, cancellation and footer selection');

  // Regression: bottom-left to top-right must include frets to the left of the
  // pointer inside the rectangle, including a partially overlapped fret number.
  await clickCell(0, 4, 1);
  const touchedFret = await page.locator('[data-measure="0"][data-beat="2"] .tab-fret').boundingBox();
  const lower = await point(1, 0, 4), upper = await point(0, 4, 1);
  const lassoStart = { x: touchedFret.x + touchedFret.width - 1, y: lower.y };
  const lassoEnd = { x: upper.x + 10, y: upper.y - 9 };
  await page.mouse.move(lassoStart.x, lassoStart.y); await page.mouse.down();
  await page.mouse.move(lassoEnd.x, lassoEnd.y, { steps: 8 });
  await expectCells([[0, 2, 1], [0, 2, 6], [0, 3, 1], [0, 3, 6], [0, 4, 1], [0, 8, 1]]);
  await expectCells([[0, 1, 1]], false);
  // Move across the fret's vertical edge without changing the nearest string or beat.
  await page.mouse.move(lassoEnd.x, upper.y + 8);
  await page.getByText('Measure 1 · Beat 5 · Voice 1', { exact: true }).waitFor(); await field('note-string', 1);
  await expectCells([[0, 2, 1], [0, 2, 6], [0, 3, 1], [0, 3, 6]], false); await expectCells([[0, 4, 1], [0, 8, 6]]);
  await page.mouse.move(lassoEnd.x, lassoEnd.y);
  await expectCells([[0, 2, 1], [0, 2, 6], [0, 3, 1], [0, 3, 6]]);
  await page.screenshot({ path: join(output, 'rectangle-plus-wrapped-selection.png') });
  await page.mouse.up(); await key('Delete'); await dirty(true);
  for (const beat of [2, 3, 4, 8]) assert.equal(await page.locator(`[data-measure="0"][data-beat="${beat}"] .tab-fret`).count(), 0);
  assert.equal(await page.locator('[data-measure="0"][data-beat="1"] .tab-fret').count(), 1);
  await native('undo'); await dirty(false);
  await expectCells([[0, 2, 1], [0, 3, 1], [0, 8, 1]]);
  console.log('PASS: upward-right marquee includes whole columns for overlapping frets, keeps wrapped coverage, shrinks within a snapped cell and handles Delete/undo');

  // Both endpoint rows and same-row drags include every string, even through empty cells.
  const wrapAnchor = await point(0, 5, 3), wrapEnd = await point(1, 1, 1), shrink = await point(0, 7, 4);
  await page.mouse.move(wrapAnchor.x, wrapAnchor.y); await page.mouse.down();
  await page.mouse.move(wrapEnd.x, wrapEnd.y, { steps: 8 });
  await expectCells([[0, 5, 1], [0, 6, 6], [0, 8, 6], [1, 0, 1], [1, 0, 6], [1, 1, 1], [1, 1, 6]]);
  await expectCells([[0, 4, 1], [1, 2, 1]], false);
  await page.screenshot({ path: join(output, 'whole-column-wrapped-selection.png') });
  await page.mouse.move(shrink.x, shrink.y, { steps: 8 });
  await expectCells([[0, 5, 1], [0, 5, 6], [0, 6, 6], [0, 7, 1], [0, 7, 6]]);
  await expectCells([[0, 8, 4], [1, 0, 1]], false);
  await page.mouse.move(wrapAnchor.x, wrapAnchor.y); await page.mouse.up();
  await expectCells([[0, 5, 1], [0, 5, 6]]); await expectCells([[0, 6, 3]], false);
  const upAnchor = await point(1, 1, 2), upEnd = await point(0, 7, 5);
  await page.mouse.move(upAnchor.x, upAnchor.y); await page.mouse.down();
  await page.mouse.move(upEnd.x, upEnd.y, { steps: 8 }); await page.mouse.up();
  await expectCells([[1, 0, 1], [1, 1, 6], [0, 7, 1], [0, 7, 6], [0, 8, 6]]);
  await expectCells([[0, 6, 6]], false);
  await dirty(false);

  // Pointer modifiers have no selection behavior, before or during a drag.
  const liveStart = await point(0, 1, 3), liveEnd = await point(0, 2, 4);
  const wholeColumns = [[0, 1, 1], [0, 1, 6], [0, 2, 1], [0, 2, 6]];
  for (const modifier of ['Shift', 'Control', 'Alt']) {
    await clickCell(0, 0, 1);
    await clickCell(0, 2, 6, modifier);
    await expectCells([[0, 2, 6]]); await expectCells([[0, 0, 1], [0, 2, 1]], false);
    assert.equal(await page.getByTestId('note-selection').count(), 1);
    await clickCell(0, 0, 1);
    await page.keyboard.down(modifier);
    await page.mouse.move(liveStart.x, liveStart.y); await page.mouse.down();
    await page.mouse.move(liveEnd.x, liveEnd.y, { steps: 5 });
    await expectCells(wholeColumns); await expectCells([[0, 0, 1]], false);
    await page.keyboard.up(modifier);
    await expectCells(wholeColumns); await expectCells([[0, 0, 1]], false);
    for (const liveModifier of ['Shift', 'Control', 'Alt']) {
      await page.keyboard.down(liveModifier);
      await expectCells(wholeColumns); await expectCells([[0, 0, 1]], false);
    }
    for (const liveModifier of ['Shift', 'Control', 'Alt']) {
      await page.keyboard.up(liveModifier);
      await expectCells(wholeColumns); await expectCells([[0, 0, 1]], false);
    }
    await page.mouse.up();
    assert.equal(await page.getByTestId('selection-edit-reason').count(), 0);
  }
  await page.screenshot({ path: join(output, 'same-row-whole-columns.png') });
  await dirty(false);
  await clickCell(0, 0, 2);
  console.log('PASS: whole columns on every row, shrinking ranges and no Shift/Ctrl/Alt pointer selection modifiers');

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

  // A short rectangle selects both complete columns; Delete is one transaction.
  const from = await point(1, 0, 1), to = await point(1, 1, 2);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 6 });
  await page.mouse.up();
  assert.equal(await page.getByTestId('tab-selection-range').count(), 1);
  assert.equal(await page.getByTestId('note-selection').count(), 0);
  const rangeBox = await page.getByTestId('tab-selection-range').boundingBox();
  assert.ok(rangeBox.x < from.x && rangeBox.x + rangeBox.width > to.x);
  assert.ok(rangeBox.y < from.y && rangeBox.y + rangeBox.height > to.y);
  await expectCells([[1, 0, 1], [1, 0, 6], [1, 1, 1], [1, 1, 6]]);
  await page.screenshot({ path: join(output, 'single-selection-box.png') });
  await page.mouse.move(to.x, to.y);
  await page.mouse.down();
  await page.mouse.move(from.x, from.y, { steps: 6 });
  await page.mouse.up();
  assert.equal(await page.getByTestId('tab-selection-range').count(), 1);
  const reverseBox = await page.getByTestId('tab-selection-range').boundingBox();
  assert.deepEqual(reverseBox, rangeBox);
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
  console.log('PASS: native Alt moves/copies and Shift-arrow ranges, stable selection, whole-column delete, atomic history, source preservation and reopen');

  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(800, 760));
  await page.waitForFunction(() => window.innerWidth <= 800);
  await page.getByLabel('Tab layout', { exact: true }).selectOption('wrap');
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="tab-system"]').length > 1);
  await page.screenshot({ path: join(output, 'custom-tab-narrow.png') });
  await key('Shift+ArrowLeft');
  assert.equal(await page.getByTestId('tab-selection-range').count(), 2);
  assert.equal(await page.getByTestId('note-selection').count(), 0);
  await page.screenshot({ path: join(output, 'wrapped-selection.png') });
  await key('Escape');
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
  await page.locator('.tab-workspace').evaluate(e => { e.scrollTop = 0; e.scrollLeft = 0; });
  await page.locator('[data-column-id][data-measure="0"][data-beat="0"]').waitFor();
  const scrollStart = await point(0, 0, 1), scrollCanvas = await page.locator('.tab-workspace').boundingBox();
  await page.mouse.move(scrollStart.x, scrollStart.y); await page.mouse.down();
  await page.mouse.move(scrollStart.x + 40, scrollCanvas.y + scrollCanvas.height - 4, { steps: 8 });
  await page.waitForFunction(() => document.querySelector('.tab-workspace').scrollTop > 100);
  const scrollMarquee = await page.getByTestId('tab-selection-marquee').boundingBox();
  const scrolledPaper = await page.locator('.tab-document').boundingBox();
  const originalPaperY = scrollCanvas.y + 28;
  assert.ok(Math.abs(scrollMarquee.y - scrolledPaper.y - (scrollStart.y - originalPaperY)) < 2, 'Marquee origin must stay attached to the document while scrolling');
  await page.mouse.up();
  assert.equal(await page.getByTestId('tab-selection-marquee').count(), 0);
  await dirty(false);
  console.log('PASS: captured marquee auto-scrolls across virtualized rows without changing the song');
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

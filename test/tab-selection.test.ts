import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createIdentities } from '../shared/editor-identities';
import { clearRepeats, clearTechniques, createEditor, cursorKey, cursorNote, deleteNote, rearrangeColumns, redoEdit,
  repeatSelectionReason, selectedCells, selectEditorCells, selectEditorCursor, selectionEditReason, setBend, setDuration,
  setEndingNumbers, setFret, setRepeatPlays, setRest, toggleRepeat, toggleTechnique, undoEdit, type EditorCursor, type EditorState } from '../shared/editor';
import { cellBounds, layoutTab } from '../shared/tab-layout';
import { includeMarqueeColumns, tabCellSelectionRects, wrappedTabCells } from '../shared/tab-selection';
import { parseTgFile } from '../shared/tg-reader';
import { writeTgFile } from '../shared/tg-writer';
import { WHOLE_PRECISE_DURATION } from '../shared/model';

const source = new Uint8Array(readFileSync('china.tg'));
function layout(strings = 6, rows = 2) {
  const song = parseTgFile(source);
  song.tracks[0].strings = Array.from({ length: strings }, (_, index) => ({ number: index + 1, value: 64 - index * 5 }));
  if (rows > 2) {
    song.measureHeaders = Array.from({ length: rows }, () => structuredClone(song.measureHeaders[0]));
    song.tracks[0].measures = Array.from({ length: rows }, (_, index) => {
      const measure = structuredClone(song.tracks[0].measures[0]);
      for (const beat of measure.beats) beat.preciseStart += index * WHOLE_PRECISE_DURATION;
      return measure;
    });
  }
  return layoutTab(song, 0, 0, createIdentities(song), { width: 430 });
}

describe('string selection with whole columns across rows', () => {
  it.each([4, 6, 8])('selects all %s strings on both endpoint rows', count => {
    const view = layout(count), first = view.systems[0], next = view.systems[1];
    const anchor = { ...first.columns[0].address, string: 3 }, focus = { ...next.columns[0].address, string: 1 };
    const selected = wrappedTabCells(view, anchor, focus);
    expect(selected.filter(c => c.measure === 0)).toHaveLength(first.columns.length * count);
    expect(selected.filter(c => c.measure === 1).map(c => c.string)).toEqual(Array.from({ length: count }, (_, i) => i + 1));
    expect(wrappedTabCells(view, focus, anchor)).toEqual(selected);
  });

  it('includes the top and bottom strings on the final row of upward drags', () => {
    const view = layout(), first = view.systems[0], next = view.systems[1];
    const anchor = { ...next.columns[0].address, string: 2 }, focus = { ...first.columns.at(-1)!.address, string: 5 };
    const selected = wrappedTabCells(view, anchor, focus);
    expect(selected.filter(c => c.measure === 1)).toHaveLength(6);
    expect(selected.filter(c => c.measure === 0).map(c => c.string)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('selects only the endpoint string range within one row, in either drag direction', () => {
    const view = layout(), row = view.systems[0];
    const from = { ...row.columns[1].address, string: 2 }, to = { ...row.columns[3].address, string: 4 };
    const forward = wrappedTabCells(view, from, to), backward = wrappedTabCells(view, to, from);
    expect(forward).toHaveLength(9);
    expect(forward).toEqual(backward);
    expect(forward.every(c => c.beat >= 1 && c.beat <= 3 && c.string >= 2 && c.string <= 4)).toBe(true);
    const bottom = wrappedTabCells(view, { ...from, string: 6 }, { ...to, string: 6 });
    expect(bottom).toHaveLength(3);
    expect(bottom.every(c => c.string === 6)).toBe(true);
  });

  it('shrinks rows and columns when dragging back, retaining every string even in a single column', () => {
    const view = layout(6, 3), [first, middle, last] = view.systems;
    const anchor = { ...first.columns[2].address, string: 3 };
    const far = wrappedTabCells(view, anchor, { ...last.columns[1].address, string: 2 });
    expect(far.filter(c => c.measure === 0)).toHaveLength((first.columns.length - 2) * 6);
    expect(far.filter(c => c.measure === 1)).toHaveLength(middle.columns.length * 6);
    expect(far.filter(c => c.measure === 2)).toHaveLength(12);
    const back = wrappedTabCells(view, anchor, { ...middle.columns[0].address, string: 1 });
    expect(back.some(c => c.measure === 2)).toBe(false);
    expect(back.filter(c => c.measure === 1)).toHaveLength(6);
    const home = wrappedTabCells(view, anchor, { ...first.columns[3].address, string: 4 });
    expect(home).toHaveLength(12);
    expect(home.every(c => c.measure === 0 && [2, 3].includes(c.beat))).toBe(true);
    expect(wrappedTabCells(view, anchor, anchor).map(c => c.string)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('does not paint highlights over unselected columns or strings', () => {
    const view = layout(), row = view.systems[0];
    const anchor = { ...row.columns[0].address, string: 1 }, focus = { ...row.columns[3].address, string: 3 };
    const full = wrappedTabCells(view, anchor, focus);
    const gaps = [{ ...anchor, beat: 1, string: 2 }, ...[1, 2, 3, 4, 5, 6].map(string => ({ ...anchor, beat: 2, string }))];
    const excluded = new Set(gaps.map(cursorKey));
    const cells = full.filter(cursor => !excluded.has(cursorKey(cursor))), boxes = tabCellSelectionRects(view, cells);
    const contains = (cursor: EditorCursor) => {
      const cell = cellBounds(view, cursor)!, x = cell.x + cell.w / 2, y = cell.y + cell.h / 2;
      return boxes.some(box => x >= box.x && x <= box.x + box.w && y >= box.y && y <= box.y + box.h);
    };
    expect(cells.every(contains)).toBe(true);
    expect(gaps.some(contains)).toBe(false);
    expect(tabCellSelectionRects(view, cells, [view.systems[1]])).toEqual([]);
  });

});

describe('marquee and wrapped coverage together', () => {
  const has = (cells: EditorCursor[], measure: number, beat: number, string = 1) => cells.some(c => c.measure === measure && c.beat === beat && c.string === string);
  function gesture() {
    const view = layout(), [upper, lower] = view.systems;
    const start = { x: upper.columns[2].x - 4, y: lower.strings[3].y };
    const end = { x: upper.columns[4].x + 14, y: upper.top - 8 };
    return { view, upper, lower, start, end, rectangle: { x: start.x, y: end.y, w: end.x - start.x, h: start.y - end.y },
      first: { ...lower.columns[0].address, string: 4 }, last: { ...upper.columns[4].address, string: 1 } };
  }

  it.each([false, true])('includes whole columns for touched frets and retains wrapped columns outside the rectangle (reversed=%s)', reversed => {
    const { view, first, last, rectangle } = gesture();
    const wrapped = wrappedTabCells(view, reversed ? last : first, reversed ? first : last);
    expect(has(wrapped, 0, 2)).toBe(false);
    expect(has(wrapped, 0, 3)).toBe(false);
    const selected = includeMarqueeColumns(view, wrapped, rectangle);
    for (const beat of [2, 3, 4, 8]) for (const string of [1, 2, 3, 4, 5, 6]) expect(has(selected, 0, beat, string)).toBe(true);
    expect(has(selected, 0, 1)).toBe(false);
    expect(selectionEditReason(selectEditorCells(createEditor('test', 'song.tg', parseTgFile(source)), selected, last))).toBeNull();
  });

  it('drops rectangle-only columns when the rectangle shrinks, even with the same snapped endpoints', () => {
    const { view, upper, first, last, rectangle } = gesture(), wrapped = wrappedTabCells(view, first, last);
    expect(has(includeMarqueeColumns(view, wrapped, rectangle), 0, 2)).toBe(true);
    const top = upper.top + 8;
    const shrunk = includeMarqueeColumns(view, wrapped, { ...rectangle, y: top, h: rectangle.y + rectangle.h - top });
    expect(has(shrunk, 0, 2)).toBe(false);
    expect(has(shrunk, 0, 3)).toBe(false);
    expect(has(shrunk, 0, 4)).toBe(true);
    expect(has(shrunk, 0, 8)).toBe(true);
  });

  it('includes a partial fret overlap without requiring the fret center to be inside', () => {
    const { view, upper, first, last, rectangle } = gesture(), wrapped = wrappedTabCells(view, first, last);
    const right = rectangle.x + rectangle.w, left = upper.columns[2].x + 7;
    const touching = includeMarqueeColumns(view, wrapped, { ...rectangle, x: left, w: right - left });
    expect(has(touching, 0, 2)).toBe(true);
    expect(has(touching, 0, 2, 6)).toBe(true);
    const outside = includeMarqueeColumns(view, wrapped, { ...rectangle, x: left + 3, w: right - left - 3 });
    expect(has(outside, 0, 2)).toBe(false);
  });

  it('deduplicates overlapping columns and deletes their notes across strings with undo', () => {
    const { view, first, last, rectangle } = gesture();
    const candidates = includeMarqueeColumns(view, wrappedTabCells(view, first, last), rectangle);
    expect(new Set(candidates.map(cursorKey)).size).toBe(candidates.length);
    const state = createEditor('test', 'song.tg', parseTgFile(source));
    const notes = state.song.tracks[0].measures[0].beats[2].voices[0].notes;
    notes.push({ ...notes[0], string: 6, value: 7 });
    const selected = selectEditorCells(state, candidates, first);
    const changed = deleteNote(selected);
    for (const cursor of candidates) expect(cursorNote(changed.song, cursor)).toBeUndefined();
    expect(cursorNote(changed.song, { ...last, beat: 1 })).toEqual(cursorNote(selected.song, { ...last, beat: 1 }));
    expect(undoEdit(changed).cellSelection).toEqual(selected.cellSelection);
    expect(undoEdit(changed).song).toEqual(selected.song);
  });
});

describe('selection edits and history', () => {
  const cell: EditorCursor = { track: 0, measure: 0, beat: 0, voice: 0, string: 1 };
  const base = () => createEditor('test', 'selection.tg', parseTgFile(source));
  const gapped = () => selectEditorCells(base(), [0, 2, 4].flatMap(beat =>
    [1, 2, 3, 4, 5, 6].map(string => ({ ...cell, beat, string }))));
  const quarter = { value: 4, dotted: false, doubleDotted: false, division: { enters: 1, times: 1 } };

  it('deletes exactly the selected cells in one undo step and saves the same notes', () => {
    const state = gapped(), changed = deleteNote(state);
    for (const cursor of selectedCells(state)) expect(cursorNote(changed.song, cursor)).toBeUndefined();
    for (const beat of [1, 3, 5]) expect(cursorNote(changed.song, { ...cell, beat })).toEqual(cursorNote(state.song, { ...cell, beat }));
    expect(changed.past).toHaveLength(1);
    expect(changed.cellSelection).toEqual(state.cellSelection);
    expect(parseTgFile(writeTgFile(source, changed.edits))).toEqual(changed.song);
    const restored = undoEdit(changed);
    expect(restored.song).toEqual(state.song);
    expect(restored.cellSelection).toEqual(state.cellSelection);
    expect(restored.signature).toBe(restored.savedSignature);
    expect(redoEdit(restored).song).toEqual(changed.song);
    expect(redoEdit(restored).cellSelection).toEqual(changed.cellSelection);
  });

  it('keeps a string hole intact while deleting both surrounding strings of a chord', () => {
    const state = base(), notes = state.song.tracks[0].measures[0].beats[0].voices[0].notes;
    notes.push({ ...notes[0], string: 2, value: 7 }, { ...notes[0], string: 3, value: 9 });
    const selected = selectEditorCells(state, [cell, { ...cell, string: 3 }]);
    expect(selectionEditReason(selected)).toContain('Delete only');
    const changed = deleteNote(selected);
    expect(changed.song.tracks[0].measures[0].beats[0].voices[0].notes.map(note => note.string)).toEqual([2]);
    expect(undoEdit(changed).song).toEqual(state.song);
  });

  const restricted: [string, (state: EditorState) => unknown][] = [
    ['fret', state => setFret(state, 4)], ['duration', state => setDuration(state, quarter)], ['rest', setRest],
    ['move', state => rearrangeColumns(state, 1)], ['duplicate', state => rearrangeColumns(state, 1, true)],
    ['repeat toggle', state => toggleRepeat(state, 'start')], ['repeat count', state => setRepeatPlays(state, 3)],
    ['ending', state => setEndingNumbers(state, [1])], ['clear repeats', clearRepeats],
    ['technique', state => toggleTechnique(state, 'slide')], ['bend', state => setBend(state, null)], ['clear techniques', clearTechniques],
  ];
  it.each(restricted)('rejects %s for a gapped selection without changing the song or history', (_name, change) => {
    const state = gapped();
    expect(() => change(state)).toThrow('Selections with gaps support Delete only');
    expect(state.past).toEqual([]);
    expect(state.song).toBe(state.original);
  });

  it('does not treat a gapped set of columns as contiguous just because it has an anchor', () => {
    const state = gapped(), anchored = selectEditorCells(state, state.cellSelection!, cell, cell);
    expect(selectionEditReason(anchored)).toContain('Delete only');
    expect(() => setRest(anchored)).toThrow('Selections with gaps support Delete only');
  });

  it('disables empty selections without editing the previous focus, and allows a normal click to resume', () => {
    const empty = selectEditorCells(base(), []);
    expect(selectionEditReason(empty)).toBe('Select a cell or range to edit.');
    expect(deleteNote(empty)).toBe(empty);
    for (const [, change] of restricted) expect(() => change(empty)).toThrow('Select a cell or range');
    expect(setFret(selectEditorCursor(empty, cell), 4).signature).not.toBe('[]');
  });

  it('accepts filled rectangles and regular wrapped ranges but retains technique and measure limits', () => {
    const full = [cell, { ...cell, string: 2 }, { ...cell, beat: 1 }, { ...cell, beat: 1, string: 2 }];
    const rectangle = selectEditorCells(base(), full);
    expect(selectionEditReason(rectangle)).toBeNull();
    expect(() => toggleTechnique(rectangle, 'slide')).toThrow('Select one string cell');
    expect(setFret(rectangle, 4).cellSelection).toBeNull();
    const view = layout(), focus = { ...view.systems[1].columns[0].address, string: 1 };
    const wrapped = selectEditorCells(base(), wrappedTabCells(view, cell, focus), focus);
    expect(selectionEditReason(wrapped)).toBeNull();
    expect(repeatSelectionReason(wrapped)).toContain('one measure');
    const allStrings = view.columns.flatMap(column => view.systems[0].strings.map(string => ({ ...column.address, string: string.number })));
    expect(repeatSelectionReason(selectEditorCells(base(), allStrings))).toContain('one measure');
  });

  it('remaps explicit cells onto moved and duplicated columns and restores them through undo', () => {
    const start = { ...cell, measure: 1 };
    let state = setFret(setDuration(selectEditorCursor(base(), start), quarter), 7);
    state = setFret(selectEditorCursor(state, { ...start, beat: 1 }), 9);
    state = selectEditorCells(state, [start, { ...start, beat: 1 }], { ...start, beat: 1 }, start);
    const moved = rearrangeColumns(state, 1);
    expect(selectedCells(moved).map(cursor => cursor.beat)).toEqual([1, 2]);
    expect(selectedCells(moved).map(cursor => cursorNote(moved.song, cursor)?.value)).toEqual([7, 9]);
    expect(undoEdit(moved).cellSelection).toEqual(state.cellSelection);
    const copied = rearrangeColumns(state, 1, true);
    const activeBeats = copied.song.tracks[0].measures[1].beats.flatMap((beat, index) => beat.voices[0].empty ? [] : [index]);
    expect(selectedCells(copied).map(cursor => cursor.beat)).toEqual(activeBeats.slice(2));
    expect(selectedCells(copied).map(cursor => cursorNote(copied.song, cursor)?.value)).toEqual([7, 9]);
    expect(redoEdit(undoEdit(copied)).cellSelection).toEqual(copied.cellSelection);
    const clean = selectEditorCells(createEditor('rebased', 'selection.tg', state.song), state.cellSelection!, state.selection!, state.anchor);
    const back = rearrangeColumns(rearrangeColumns(clean, 1), -1);
    expect(back.signature).toBe('[]');
    expect(back.cellSelection).toEqual(clean.cellSelection);
    expect(selectedCells(back).map(cursor => cursorNote(back.song, cursor)?.value)).toEqual([7, 9]);
  });
});

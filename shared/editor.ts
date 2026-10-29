import type { TGDuration, TGEffectPoints, TGSong, TGTabLayout } from "./model";
import { modelSignature } from "./model-signature";
import { applySongEdits, beatAddresses, beatKey, cursorKey, voiceAt, validateCursor,
  type BeatAddress, type EditorCursor, type SongEdit } from "./score-edits";
import { createIdentities, findColumn, patchIdentities, type EditorIdentities } from "./editor-identities";
import { TECHNIQUES, inspectTechniques, makeBend, DEFAULT_BEND, type Technique, type TechniqueState } from './technique-edits';
import { endingNumbers } from './repeat-edits';
import { resolveEndings } from './tab-structure';
export * from "./score-edits";

interface EditorSnapshot {
  song: TGSong;
  selection: EditorCursor | null;
  anchor: EditorCursor | null;
  selectionMode: "cell" | "columns";
  /** Explicit coverage for document marquee selections, including gaps between columns. */
  cellSelection: EditorCursor[] | null;
  identities: EditorIdentities;
  edits: SongEdit[];
  signature: string;
}
interface EditCommand { id: string; before: EditorSnapshot; after: EditorSnapshot; group?: string }
export interface EditorState extends EditorSnapshot {
  id: string;
  fileName: string;
  original: TGSong;
  past: EditCommand[];
  future: EditCommand[];
  savedSignature: string;
}

/** Compare changed headers/measures; undo and manual reversions share a dirty state. */
export function editSignature(original: TGSong, song: TGSong): string {
  const changes: unknown[] = [];
  song.tracks.forEach((track, index) => {
    if (modelSignature(track.tabLayout ?? null) !== modelSignature(original.tracks[index]?.tabLayout ?? null)) changes.push(['layout', index, track.tabLayout ?? null]);
  });
  song.measureHeaders.forEach((header, index) => {
    const before = original.measureHeaders[index];
    if (before !== header && modelSignature(before) !== modelSignature(header)) changes.push(['header', index, header]);
  });
  song.tracks.forEach((track, ti) => track.measures.forEach((measure, mi) => {
    const before = original.tracks[ti]!.measures[mi];
    if (before !== measure && modelSignature(before) !== modelSignature(measure)) changes.push([ti, mi, measure]);
  }));
  return modelSignature(changes);
}

function snapshot(state: EditorState): EditorSnapshot {
  return { song: state.song, selection: state.selection, anchor: state.anchor, selectionMode: state.selectionMode, cellSelection: state.cellSelection,
    identities: state.identities, edits: state.edits, signature: state.signature };
}

function firstCursor(song: TGSong): EditorCursor | null {
  const address = beatAddresses(song).find(a => song.tracks[a.track]!.strings.length);
  if (!address) return null;
  return { ...address, string: voiceAt(song, address).notes[0]?.string ?? song.tracks[address.track]!.strings[0]!.number };
}

export function createEditor(id: string, fileName: string, song: TGSong): EditorState {
  return { id, fileName, original: song, song, selection: firstCursor(song),
    anchor: null, selectionMode: "cell", cellSelection: null, identities: createIdentities(song),
    edits: [], signature: "[]", past: [], future: [], savedSignature: "[]" };
}

function commit(state: EditorState, edits: SongEdit[], id: string, group?: string): EditorState {
  let identities = state.identities;
  let copiedSelection: EditorCursor | null = null;
  let copiedAnchor: EditorCursor | null = null;
  let copiedCells: EditorCursor[] | null = null;
  let song = applySongEdits(state.song, edits, patch => {
    identities = patchIdentities(identities, patch);
    if (patch.kind === "measure.columns" && edits.some(e => "kind" in e && e.kind === "column.duplicate")) {
      const copy = (cursor: EditorCursor | null) => {
        if (!cursor) return null;
        const beat = patch.columns.findIndex(c => c.clone && c.source === cursor.beat);
        return beat < 0 ? null : { ...cursor, beat };
      };
      copiedSelection = copy(state.selection);
      copiedAnchor = copy(state.anchor);
      copiedCells = state.cellSelection?.map(copy).filter((cursor): cursor is EditorCursor => cursor !== null) ?? null;
    }
  });
  if (song === state.song) return state;
  const signature = editSignature(state.original, song);
  const remap = (cursor: EditorCursor | null) => {
    if (!cursor) return null;
    const address = findColumn(identities, state.identities.columns[beatKey(cursor)]);
    return address ? { ...address, string: cursor.string } : cursor;
  };
  const selection = copiedSelection ?? remap(state.selection);
  const collapse = edits.some(e => "kind" in e && (e.kind === "note.set" || e.kind === "duration.set"));
  const anchor = collapse ? null : copiedAnchor ?? remap(state.anchor);
  const cellSelection = collapse ? null : copiedCells ?? state.cellSelection?.map(cursor => remap(cursor)!) ?? null;
  if (signature === "[]") { song = state.original; identities = createIdentities(song); }
  const after: EditorSnapshot = { song, selection, anchor, cellSelection, selectionMode: collapse ? "cell" : state.selectionMode, identities, signature,
    edits: signature === "[]" ? [] : [...state.edits, ...edits] };
  const last = state.past.at(-1);
  const merge = !!group && last?.group === group && last.id === id && !state.future.length &&
    last.after.selection && state.selection && cursorKey(last.after.selection) === cursorKey(state.selection);
  const command: EditCommand = { id, before: merge ? last.before : snapshot(state), after, group };
  return { ...state, ...after, past: [...(merge ? state.past.slice(0, -1) : state.past), command], future: [] };
}

export function setFret(state: EditorState, fret: number, group?: string): EditorState {
  requireEditableSelection(state);
  return state.selection ? commit(state, [{ kind: "note.set", cursor: state.selection, fret }], "action.note.general.change", group) : state;
}

export function setTabDesign(state: EditorState, track: number, layout: TGTabLayout | null): EditorState {
  return commit(state, [{ kind: 'layout.set', track, layout }], 'layout.set');
}

export function deleteNote(state: EditorState): EditorState {
  const edits: SongEdit[] = selectedCells(state).filter(cursor => voiceAt(state.song, cursor).notes.some(note => note.string === cursor.string))
    .map(cursor => ({ kind: 'note.remove', cursor }));
  return commit(state, edits, "action.beat.general.delete-note");
}

export function setRest(state: EditorState): EditorState {
  requireEditableSelection(state);
  return commit(state, selectedColumns(state).map(address => ({ kind: "voice.rest", address })), "action.beat.general.insert-rest");
}

export function setDuration(state: EditorState, duration: TGDuration): EditorState {
  requireEditableSelection(state);
  return state.selection ? commit(state, [{ kind: "duration.set", address: state.selection, duration }], "action.note.duration.set-duration") : state;
}

/** A marquee can add isolated columns; only complete ranges allow edits beyond Delete. */
export function selectionEditReason(state: EditorState | null): string | null {
  if (!state || state.cellSelection === null) return null;
  const cells = state.cellSelection;
  if (!cells.length) return 'Select a cell or range to edit.';
  const first = cells[0], last = cells.at(-1)!;
  const strings = new Set(cells.map(cursor => cursor.string));
  const low = Math.min(...strings), high = Math.max(...strings);
  const stringCount = state.song.tracks[first.track].strings.filter(string => string.number >= low && string.number <= high).length;
  let columnCount = 0;
  const measures = state.song.tracks[first.track].measures;
  for (let measure = first.measure; measure <= last.measure; measure++) {
    const beats = measures[measure].beats;
    const start = measure === first.measure ? first.beat : 0, end = measure === last.measure ? last.beat : beats.length - 1;
    for (let beat = start; beat <= end; beat++) {
      const voice = beats[beat].voices[first.voice];
      if (voice && !voice.empty) columnCount++;
    }
  }
  return cells.length === columnCount * stringCount ? null
    : 'Selections with gaps support Delete only. Select a cell or regular range for other edits.';
}

function requireEditableSelection(state: EditorState) {
  const reason = selectionEditReason(state);
  if (reason) throw new Error(reason);
}

export function repeatSelectionReason(state: EditorState | null): string | null {
  if (!state?.selection) return 'Select a note or rest in the measure.';
  const reason = selectionEditReason(state);
  if (reason) return reason;
  if (selectedColumns(state).some(column => column.measure !== state.selection!.measure)) return 'Select within one measure to edit repeats.';
  return null;
}

export function repeatState(state: EditorState | null) {
  const measure = state?.selection?.measure;
  const header = measure === undefined ? undefined : state!.song.measureHeaders[measure];
  const span = header ? resolveEndings(state!.song.measureHeaders).find(ending => measure! >= ending.start && measure! <= ending.end) : undefined;
  return { reason: repeatSelectionReason(state), measure, start: !!header?.repeatOpen, end: !!header?.repeatClose,
    plays: header?.repeatClose ? header.repeatClose + 1 : 2, numbers: endingNumbers(header?.repeatAlternative ?? 0),
    inherited: span && span.start !== measure ? { measure: span.start, label: span.label } : undefined };
}

function repeatMeasure(state: EditorState): number {
  const reason = repeatSelectionReason(state);
  if (reason) throw new Error(reason);
  return state.selection!.measure;
}

export function setRepeatPlays(state: EditorState, plays: number | null): EditorState {
  return commit(state, [{ kind: 'repeat.end', measure: repeatMeasure(state), plays }], 'repeat.end');
}

export function setEndingNumbers(state: EditorState, numbers: number[]): EditorState {
  return commit(state, [{ kind: 'repeat.ending', measure: repeatMeasure(state), numbers: [...numbers] }], 'repeat.ending');
}

export function toggleRepeat(state: EditorState, kind: 'start' | 'end' | 'ending'): EditorState {
  const measure = repeatMeasure(state), header = state.song.measureHeaders[measure];
  if (kind === 'end') return setRepeatPlays(state, header.repeatClose ? null : 2);
  if (kind === 'ending') return setEndingNumbers(state, header.repeatAlternative ? [] : [1]);
  return commit(state, [{ kind: 'repeat.start', measure, enabled: !header.repeatOpen }], 'repeat.start');
}

export function clearRepeats(state: EditorState): EditorState {
  const measure = repeatMeasure(state);
  return commit(state, [{ kind: 'repeat.start', measure, enabled: false }, { kind: 'repeat.end', measure, plays: null },
    { kind: 'repeat.ending', measure, numbers: [] }], 'repeat.clear');
}

function techniqueSelectionReason(state: EditorState | null): string | null {
  if (!state?.selection) return 'Select a note first.';
  const reason = selectionEditReason(state);
  if (reason) return reason;
  if (state.selectionMode !== 'cell' || state.anchor && cursorKey(state.anchor) !== cursorKey(state.selection) ||
    state.cellSelection !== null && state.cellSelection.length !== 1) {
    return 'Select one string cell to edit techniques.';
  }
  return null;
}

export function techniqueStates(state: EditorState | null): Record<Technique, TechniqueState> {
  const reason = techniqueSelectionReason(state);
  return reason ? Object.fromEntries(TECHNIQUES.map(kind => [kind, { active: false, reason }])) as Record<Technique, TechniqueState>
    : inspectTechniques(state!.song, state!.selection!);
}

export function setBend(state: EditorState, bend: TGEffectPoints | null): EditorState {
  const reason = techniqueSelectionReason(state);
  if (reason) throw new Error(reason);
  const owned = bend ? { points: bend.points.map(p => ({ position: p.position, value: p.value })) } : null;
  return commit(state, [{ kind: 'technique.set', cursor: state.selection!, technique: 'bend', bend: owned }], 'technique.bend');
}

export function toggleTechnique(state: EditorState, technique: Technique): EditorState {
  const status = techniqueStates(state)[technique];
  if (status.reason) throw new Error(status.reason);
  if (technique === 'bend') return setBend(state, status.active ? null : makeBend(DEFAULT_BEND.shape, DEFAULT_BEND.amount));
  return commit(state, [{ kind: 'technique.set', cursor: state.selection!, technique, enabled: !status.active }], `technique.${technique}`);
}

export function clearTechniques(state: EditorState): EditorState {
  const reason = techniqueSelectionReason(state);
  if (reason) throw new Error(reason);
  return commit(state, [
    { kind: 'technique.set', cursor: state.selection!, technique: 'bend', bend: null },
    ...(['slide', 'hammer-on', 'tie'] as const).map(technique => ({ kind: 'technique.set' as const, cursor: state.selection!, technique, enabled: false })),
  ], 'technique.clear');
}

export function undoEdit(state: EditorState): EditorState {
  const command = state.past.at(-1);
  return command ? { ...state, ...command.before, past: state.past.slice(0, -1), future: [...state.future, command] } : state;
}

export function redoEdit(state: EditorState): EditorState {
  const command = state.future.at(-1);
  return command ? { ...state, ...command.after, past: [...state.past, command], future: state.future.slice(0, -1) } : state;
}

export function selectEditorCursor(state: EditorState, cursor: EditorCursor, extend = false, mode: "cell" | "columns" = "cell"): EditorState {
  validateCursor(state.song, cursor);
  const compatible = state.selection?.track === cursor.track && state.selection.voice === cursor.voice;
  return { ...state, selection: cursor, anchor: extend && compatible ? state.anchor ?? state.selection : null,
    selectionMode: extend && compatible ? state.selectionMode : mode, cellSelection: null };
}

export function selectEditorCells(state: EditorState, cells: readonly EditorCursor[], focus?: EditorCursor, anchor: EditorCursor | null = null): EditorState {
  const unique = new Map<string, EditorCursor>();
  for (const cursor of cells) {
    validateCursor(state.song, cursor);
    if (cursor.track !== state.selection?.track || cursor.voice !== state.selection.voice) throw new Error('Select within one track and voice.');
    unique.set(cursorKey(cursor), { ...cursor });
  }
  const cellSelection = [...unique.values()].sort((a, b) => a.measure - b.measure || a.beat - b.beat || a.string - b.string);
  const selection = focus && unique.has(cursorKey(focus)) ? { ...focus }
    : state.selection && unique.has(cursorKey(state.selection)) ? state.selection : cellSelection.at(-1) ?? state.selection;
  if (anchor) validateCursor(state.song, anchor);
  const sameCursor = (a: EditorCursor | null, b: EditorCursor | null) => a === b || !!a && !!b && cursorKey(a) === cursorKey(b);
  if (state.selectionMode === 'cell' && sameCursor(state.selection, selection) && sameCursor(state.anchor, anchor) &&
    state.cellSelection?.length === cellSelection.length && state.cellSelection.every((cursor, index) => cursorKey(cursor) === cursorKey(cellSelection[index]))) return state;
  return { ...state, selection, anchor, selectionMode: 'cell', cellSelection };
}

export function selectedCells(state: EditorState): EditorCursor[] {
  if (state.cellSelection !== null) return state.cellSelection;
  if (!state.selection) return [];
  const focus = state.selection, anchor = state.anchor ?? focus;
  const strings = state.song.tracks[focus.track].strings.filter(string => state.selectionMode === 'columns' ||
    string.number >= Math.min(anchor.string, focus.string) && string.number <= Math.max(anchor.string, focus.string));
  return selectedColumns(state).flatMap(address => strings.map(string => ({ ...address, string: string.number })));
}

export function selectedColumns(state: EditorState): BeatAddress[] {
  if (state.cellSelection !== null) return [...new Map(state.cellSelection.map(({ string, ...address }) => [beatKey(address), address])).values()];
  const focus = state.selection;
  if (!focus) return [];
  const anchor = state.anchor ?? focus;
  const order = (a: BeatAddress, b: BeatAddress) => a.measure - b.measure || a.beat - b.beat;
  const [first, last] = order(anchor, focus) <= 0 ? [anchor, focus] : [focus, anchor];
  const result: BeatAddress[] = [];
  const measures = state.song.tracks[focus.track].measures;
  for (let measure = first.measure; measure <= last.measure; measure++) {
    const beats = measures[measure].beats;
    const start = measure === first.measure ? first.beat : 0;
    const end = measure === last.measure ? last.beat : beats.length - 1;
    for (let beat = start; beat <= end; beat++) {
      const voice = beats[beat].voices[focus.voice];
      if (voice && !voice.empty) result.push({ track: focus.track, measure, beat, voice: focus.voice });
    }
  }
  return result;
}

export function rearrangeColumns(state: EditorState, direction: -1 | 1, duplicate = false): EditorState {
  requireEditableSelection(state);
  const columns = selectedColumns(state);
  if (!columns.length) return state;
  const first = columns[0], last = columns.at(-1)!;
  if (first.measure !== last.measure) throw new Error("Select columns within one measure to move or duplicate.");
  return commit(state, [{ kind: duplicate ? "column.duplicate" : "column.move", address: first, lastBeat: last.beat, direction }],
    duplicate ? "action.column.duplicate" : "action.column.move");
}

export function moveSelection(state: EditorState, direction: string): EditorCursor | null {
  const a = state.selection;
  if (!a) return firstCursor(state.song);
  if (direction === "ArrowUp" || direction === "ArrowDown") {
    const strings = [...state.song.tracks[a.track]!.strings].sort((x, y) => x.number - y.number);
    const index = strings.findIndex(s => s.number === a.string);
    return { ...a, string: strings[index + (direction === "ArrowUp" ? -1 : 1)]?.number ?? a.string };
  }
  if (!["Home", "End", "ArrowLeft", "ArrowRight"].includes(direction)) return a;
  const measures = state.song.tracks[a.track].measures;
  const withinMeasure = direction === "Home" || direction === "End";
  const step = direction === "Home" || direction === "ArrowRight" ? 1 : -1;
  let measure = a.measure;
  let beat = withinMeasure ? (step > 0 ? 0 : measures[measure].beats.length - 1) : a.beat + step;
  while (measure >= 0 && measure < measures.length) {
    const beats = measures[measure].beats;
    for (; beat >= 0 && beat < beats.length; beat += step) {
      const voice = beats[beat].voices[a.voice];
      if (voice && !voice.empty) return { ...a, measure, beat };
    }
    if (withinMeasure) break;
    measure += step;
    beat = step > 0 ? 0 : (measures[measure]?.beats.length ?? 0) - 1;
  }
  return a;
}

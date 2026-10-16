import type { TGDuration, TGSong } from "./model";
import { modelSignature } from "./model-signature";
import { applySongEdits, beatAddresses, beatKey, cursorKey, voiceAt, validateCursor,
  type BeatAddress, type EditorCursor, type SongEdit } from "./score-edits";
import { createIdentities, findColumn, patchIdentities, type EditorIdentities } from "./editor-identities";
export * from "./score-edits";

interface EditorSnapshot {
  song: TGSong;
  selection: EditorCursor | null;
  anchor: EditorCursor | null;
  selectionMode: "cell" | "columns";
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

/** Compare changed measures only; undo and manual reversions share a dirty state. */
export function editSignature(original: TGSong, song: TGSong): string {
  const changes: unknown[] = [];
  song.tracks.forEach((track, ti) => track.measures.forEach((measure, mi) => {
    const before = original.tracks[ti]!.measures[mi];
    if (before !== measure && modelSignature(before) !== modelSignature(measure)) changes.push([ti, mi, measure]);
  }));
  return modelSignature(changes);
}

function snapshot(state: EditorState): EditorSnapshot {
  return { song: state.song, selection: state.selection, anchor: state.anchor, selectionMode: state.selectionMode,
    identities: state.identities, edits: state.edits, signature: state.signature };
}

function firstCursor(song: TGSong): EditorCursor | null {
  const address = beatAddresses(song).find(a => song.tracks[a.track]!.strings.length);
  if (!address) return null;
  return { ...address, string: voiceAt(song, address).notes[0]?.string ?? song.tracks[address.track]!.strings[0]!.number };
}

export function createEditor(id: string, fileName: string, song: TGSong): EditorState {
  return { id, fileName, original: song, song, selection: firstCursor(song),
    anchor: null, selectionMode: "cell", identities: createIdentities(song),
    edits: [], signature: "[]", past: [], future: [], savedSignature: "[]" };
}

function commit(state: EditorState, edits: SongEdit[], id: string, group?: string): EditorState {
  let identities = state.identities;
  let copiedSelection: EditorCursor | null = null;
  let copiedAnchor: EditorCursor | null = null;
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
  if (signature === "[]") { song = state.original; identities = createIdentities(song); }
  const after: EditorSnapshot = { song, selection, anchor, selectionMode: collapse ? "cell" : state.selectionMode, identities, signature,
    edits: signature === "[]" ? [] : [...state.edits, ...edits] };
  const last = state.past.at(-1);
  const merge = !!group && last?.group === group && last.id === id && !state.future.length &&
    last.after.selection && state.selection && cursorKey(last.after.selection) === cursorKey(state.selection);
  const command: EditCommand = { id, before: merge ? last.before : snapshot(state), after, group };
  return { ...state, ...after, past: [...(merge ? state.past.slice(0, -1) : state.past), command], future: [] };
}

export function setFret(state: EditorState, fret: number, group?: string): EditorState {
  return state.selection ? commit(state, [{ kind: "note.set", cursor: state.selection, fret }], "action.note.general.change", group) : state;
}

export function deleteNote(state: EditorState): EditorState {
  const columns = selectedColumns(state);
  if (!state.selection) return state;
  const strings = state.song.tracks[state.selection.track].strings.map(s => s.number);
  const firstString = state.selectionMode === "columns" ? Math.min(...strings) : Math.min(state.selection.string, state.anchor?.string ?? state.selection.string);
  const lastString = state.selectionMode === "columns" ? Math.max(...strings) : Math.max(state.selection.string, state.anchor?.string ?? state.selection.string);
  const edits: SongEdit[] = columns.flatMap(a => voiceAt(state.song, a).notes.filter(n => n.string >= firstString && n.string <= lastString)
    .map(n => ({ kind: "note.remove" as const, cursor: { ...a, string: n.string } })));
  return commit(state, edits, "action.beat.general.delete-note");
}

export function setRest(state: EditorState): EditorState {
  return commit(state, selectedColumns(state).map(address => ({ kind: "voice.rest", address })), "action.beat.general.insert-rest");
}

export function setDuration(state: EditorState, duration: TGDuration): EditorState {
  return state.selection ? commit(state, [{ kind: "duration.set", address: state.selection, duration }], "action.note.duration.set-duration") : state;
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
    selectionMode: extend && compatible ? state.selectionMode : mode };
}

export function selectedColumns(state: EditorState): BeatAddress[] {
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

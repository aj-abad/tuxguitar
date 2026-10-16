import { computed } from "vue";
import {
  createEditor, moveSelection, noteAt, cursorNote, cursorKey, voiceAt,
  redoEdit, setFret, undoEdit, deleteNote, setRest, setDuration, selectEditorCursor, rearrangeColumns, beatAddresses, selectedColumns,
  type EditorState, type NoteAddress, type EditorCursor, type BeatAddress,
} from "~~/shared/editor";
import type { TGDuration } from "~~/shared/model";
import type { DocumentCommand, DocumentEdits } from "~~/shared/ipc";
import type { TabCommandId } from "~~/shared/tab-commands";

let digitEntry: { key: string; text: string; time: number; group: string } | null = null;

export function useSong() {
  const editor = useState<EditorState | null>("editor", () => null);
  const loading = useState("songLoading", () => false);
  const error = useState<string | null>("songError", () => null);
  const allowDocumentUnload = useState("allowDocumentUnload", () => false);
  const song = computed(() => editor.value?.song ?? null);
  const selection = computed(() => editor.value?.selection ?? null);
  const selectedNote = computed(() => song.value && selection.value ? cursorNote(song.value, selection.value) : null);
  const selectedVoice = computed(() => song.value && selection.value ? voiceAt(song.value, selection.value) : null);
  const hasSelectedNotes = computed(() => {
    const state = editor.value, cursor = selection.value;
    if (!state || !cursor) return false;
    const first = Math.min(cursor.string, state.anchor?.string ?? cursor.string);
    const last = Math.max(cursor.string, state.anchor?.string ?? cursor.string);
    return selectedColumns(state).some(a => voiceAt(state.song, a).notes.some(n => state.selectionMode === 'columns' || (n.string >= first && n.string <= last)));
  });
  const selectedColumnsHaveNotes = computed(() => editor.value && selectedColumns(editor.value).some(a => voiceAt(editor.value!.song, a).notes.length > 0));
  const dirty = computed(() => !!editor.value && editor.value.signature !== editor.value.savedSignature);
  const canUndo = computed(() => !!editor.value?.past.length);
  const canRedo = computed(() => !!editor.value?.future.length);
  const fileName = computed(() => editor.value?.fileName ?? "");

  function snapshot(): DocumentEdits {
    if (!editor.value) throw new Error("Open a song first.");
    // IPC's structured clone cannot serialize Vue proxies.
    return JSON.parse(JSON.stringify({ id: editor.value.id, edits: editor.value.edits }));
  }

  function reportError(e: unknown) {
    error.value = e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': Error: /, "") : String(e);
  }

  async function saveDocument(saveAs = false): Promise<boolean> {
    if (!editor.value || !window.tg) return false;
    const result = await window.tg.saveFile(snapshot(), saveAs);
    if (!result) return false;
    editor.value = { ...editor.value, fileName: result.fileName, savedSignature: editor.value.signature };
    return true;
  }

  async function mayLeave(): Promise<boolean> {
    if (!dirty.value) return true;
    const answer = await window.tg.confirmChanges();
    return answer === "discard" || (answer === "save" && await saveDocument());
  }

  /** One operation owns the document while a native dialog/write is in flight. */
  async function runDocumentCommand(command: DocumentCommand, droppedFile?: File): Promise<void> {
    if (typeof window === "undefined" || !window.tg || loading.value) return;
    if (command === "undo") { undo(); return; }
    if (command === "redo") { redo(); return; }
    // Native commands and file drops can arrive while the inspector still has
    // focus. Commit that edit before checking dirty state or saving the song.
    const active = window.document.activeElement;
    if (active instanceof HTMLInputElement) active.blur();
    digitEntry = null;
    loading.value = true;
    error.value = null;
    try {
      if (command === "save" || command === "saveAs") {
        await saveDocument(command === "saveAs");
      } else if (await mayLeave()) {
        if (command === "open") {
          const result = droppedFile ? await window.tg.openDroppedFile(droppedFile) : await window.tg.openFileDialog();
          if (result) editor.value = createEditor(result.id, result.fileName, result.song);
        } else if (command === "close" || command === "reload") {
          allowDocumentUnload.value = true;
          if (command === "close") window.tg.closeWindow();
          else window.tg.reloadWindow();
        }
      }
    } catch (e) { reportError(e); }
    finally { loading.value = false; }
  }

  function selectNote(address: NoteAddress) {
    if (!editor.value || loading.value) return;
    const note = noteAt(editor.value.song, address);
    selectCursor({ track: address.track, measure: address.measure, beat: address.beat, voice: address.voice, string: note.string });
  }

  function selectCursor(cursor: EditorCursor, extend = false, mode: "cell" | "columns" = "cell") {
    if (!editor.value || loading.value) return;
    const active = window.document.activeElement;
    if (active instanceof HTMLInputElement) active.blur();
    digitEntry = null;
    editor.value = selectEditorCursor(editor.value, cursor, extend, mode);
  }

  function selectBeat(address: BeatAddress) {
    if (!song.value) return;
    const string = selection.value?.track === address.track ? selection.value.string : song.value.tracks[address.track]?.strings[0]?.number;
    if (string) selectCursor({ ...address, string });
  }

  function changeStructure(action: (state: EditorState) => EditorState) {
    if (!editor.value || loading.value) return;
    digitEntry = null;
    error.value = null;
    try { editor.value = action(editor.value); }
    catch (e) { reportError(e); }
  }

  function changeDuration(duration: TGDuration) {
    changeStructure(state => setDuration(state, duration));
  }

  function stepDuration(shorter: boolean) {
    const duration = selectedVoice.value?.duration;
    if (duration) changeDuration({ ...duration, value: Math.max(1, Math.min(64, duration.value * (shorter ? 2 : 0.5))) });
  }

  function toggleDot() {
    const duration = selectedVoice.value?.duration;
    if (duration) changeDuration({ ...duration, dotted: !duration.dotted, doubleDotted: false });
  }

  function changeFret(fret: number, group?: string) {
    if (!editor.value || loading.value) return;
    if (!group) digitEntry = null;
    error.value = null;
    try { editor.value = setFret(editor.value, fret, group); }
    catch (e) { reportError(e); }
  }

  function enterDigit(digit: string) {
    if (!editor.value || !selection.value || loading.value) return;
    const key = cursorKey(selection.value);
    const time = performance.now();
    const max = song.value!.tracks[selection.value.track]!.maxFret;
    const append = digitEntry?.key === key && time - digitEntry.time < 1000 &&
      digitEntry.text.length === 1 && Number(digitEntry.text + digit) <= max;
    digitEntry = append ? { ...digitEntry!, text: digitEntry!.text + digit, time }
      : { key, text: digit, time, group: crypto.randomUUID() };
    changeFret(Number(digitEntry.text), digitEntry.group);
  }

  function undo() {
    digitEntry = null;
    if (editor.value && !loading.value) editor.value = undoEdit(editor.value);
  }
  function redo() {
    digitEntry = null;
    if (editor.value && !loading.value) editor.value = redoEdit(editor.value);
  }
  function navigate(direction: string, extend = false) {
    if (!editor.value || loading.value) return;
    const next = moveSelection(editor.value, direction);
    if (next) selectCursor(next, extend);
  }

  function selectTrack(track: number) {
    if (!song.value) return;
    const address = beatAddresses(song.value).find(a => a.track === track);
    const string = song.value.tracks[track]?.strings[0]?.number;
    if (address && string) selectCursor({ ...address, string });
  }

  function runTabCommand(id: TabCommandId) {
    const actions: Record<TabCommandId, () => void> = {
      "column.left": () => changeStructure(state => rearrangeColumns(state, -1)),
      "column.right": () => changeStructure(state => rearrangeColumns(state, 1)),
      "column.copyLeft": () => changeStructure(state => rearrangeColumns(state, -1, true)),
      "column.copyRight": () => changeStructure(state => rearrangeColumns(state, 1, true)),
      "note.delete": () => changeStructure(deleteNote), "voice.rest": () => changeStructure(setRest),
      "duration.longer": () => stepDuration(false), "duration.shorter": () => stepDuration(true), "duration.dot": toggleDot,
    };
    actions[id]();
  }

  return { editor, song, selection, selectedNote, selectedVoice, hasSelectedNotes, selectedColumnsHaveNotes, fileName, dirty, canUndo, canRedo,
    loading, error, allowDocumentUnload, snapshot, reportError, runDocumentCommand,
    openFile: () => runDocumentCommand("open"), save: () => runDocumentCommand("save"),
    openDroppedFile: (file: File) => runDocumentCommand("open", file),
    saveAs: () => runDocumentCommand("saveAs"), selectNote, selectBeat, selectCursor,
    removeNote: () => changeStructure(deleteNote), makeRest: () => changeStructure(setRest),
    changeDuration, stepDuration, toggleDot, changeFret, enterDigit, undo, redo, navigate, runTabCommand, selectTrack };
}

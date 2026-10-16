import { onMounted, onUnmounted, watch } from "vue";
import type { DocumentCommand } from "~~/shared/ipc";

/** Mounted once by the app, so shortcuts and native menu actions never multiply. */
export function useEditorBindings() {
  const document = useSong();
  const playback = usePlayback();
  let unsubscribe: (() => void) | undefined;

  function keydown(event: KeyboardEvent) {
    const target = event.target as HTMLElement | null;
    const editable = !!target?.closest("input, textarea, select, [contenteditable=true]");
    const modifier = event.metaKey || event.ctrlKey;
    const key = event.key.toLowerCase();
    let command: DocumentCommand | undefined;
    // Native Electron accelerators own Cmd/Ctrl+O/S/Z. Browser previews use
    // this fallback; Electron does not also dispatch their keydown events.
    if (modifier && !editable) {
      if (key === "o") command = "open";
      if (key === "s") command = event.shiftKey ? "saveAs" : "save";
      if (key === "z") command = event.shiftKey ? "redo" : "undo";
      if (key === "y") command = "redo";
    }
    if (command) {
      event.preventDefault();
      if (!event.repeat) void document.runDocumentCommand(command);
    } else if (event.code === "Space" && !editable && !modifier && !event.altKey && !target?.closest("button")) {
      event.preventDefault();
      if (!event.repeat) {
        if (playback.isPlaying.value || playback.isStarting.value) playback.stop();
        else void playback.play();
      }
    }
  }

  function beforeUnload(event: BeforeUnloadEvent) {
    if ((document.dirty.value || document.loading.value) && !document.allowDocumentUnload.value) {
      event.preventDefault();
      event.returnValue = "";
    }
  }

  onMounted(() => {
    unsubscribe = window.tg?.onDocumentCommand(command => {
      void document.runDocumentCommand(command);
    });
    window.addEventListener("keydown", keydown);
    window.addEventListener("beforeunload", beforeUnload);
  });
  onUnmounted(() => {
    unsubscribe?.();
    window.removeEventListener("keydown", keydown);
    window.removeEventListener("beforeunload", beforeUnload);
    playback.dispose();
  });
  watch(document.song, () => playback.stop(), { flush: "sync" });
  watch([document.song, document.dirty, document.canUndo, document.canRedo, document.loading, document.fileName], () => {
    window.tg?.updateMenu({ hasSong: !!document.song.value, dirty: document.dirty.value,
      canUndo: document.canUndo.value, canRedo: document.canRedo.value, busy: document.loading.value });
  }, { immediate: true, flush: "sync" });
}

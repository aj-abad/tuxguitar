import { onMounted, onUnmounted, readonly, ref } from "vue";
import { isSupportedSongFile, SONG_FILE_FORMATS } from "~~/shared/file-formats";

/** One window-wide drop target, including the toolbar, score and inspector. */
export function useFileDrop() {
  const { loading, openDroppedFile, reportError } = useSong();
  const draggingFile = ref(false);
  let depth = 0;

  function hasFiles(event: DragEvent): boolean {
    return event.dataTransfer?.types.includes("Files") ?? false;
  }

  function reset() {
    depth = 0;
    draggingFile.value = false;
  }

  function enter(event: DragEvent) {
    if (!hasFiles(event)) return;
    event.preventDefault();
    depth++;
    draggingFile.value = !loading.value;
  }

  function over(event: DragEvent) {
    // Always suppress Chromium's default file/URL navigation on a drop.
    event.preventDefault();
    const accept = hasFiles(event) && !loading.value;
    if (event.dataTransfer) event.dataTransfer.dropEffect = accept ? "copy" : "none";
    draggingFile.value = accept;
  }

  function leave(event: DragEvent) {
    if (!hasFiles(event)) return;
    depth = Math.max(0, depth - 1);
    if (depth === 0) reset();
  }

  function drop(event: DragEvent) {
    event.preventDefault();
    event.stopPropagation();
    reset();
    if (!hasFiles(event) || loading.value) return;
    const files = Array.from(event.dataTransfer?.files ?? []);
    if (files.length !== 1) {
      reportError(new Error("Drop one file at a time."));
    } else if (!isSupportedSongFile(files[0]!.name)) {
      reportError(new Error(`Unsupported file type. Supported format: ${SONG_FILE_FORMATS}.`));
    } else if (!window.tg) {
      reportError(new Error("File dropping is available in the desktop app."));
    } else {
      void openDroppedFile(files[0]!);
    }
  }

  function keydown(event: KeyboardEvent) {
    if (event.key === "Escape") reset();
  }

  onMounted(() => {
    window.addEventListener("dragenter", enter, true);
    window.addEventListener("dragover", over, true);
    window.addEventListener("dragleave", leave, true);
    window.addEventListener("drop", drop, true);
    window.addEventListener("dragend", reset);
    window.addEventListener("blur", reset);
    window.addEventListener("keydown", keydown);
  });
  onUnmounted(() => {
    window.removeEventListener("dragenter", enter, true);
    window.removeEventListener("dragover", over, true);
    window.removeEventListener("dragleave", leave, true);
    window.removeEventListener("drop", drop, true);
    window.removeEventListener("dragend", reset);
    window.removeEventListener("blur", reset);
    window.removeEventListener("keydown", keydown);
  });

  return { draggingFile: readonly(draggingFile) };
}

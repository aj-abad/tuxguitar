import { onMounted, onUnmounted } from "vue";
import type { TGSong } from "~~/shared/model";

export function useSong() {
  const song = useState<TGSong | null>("song", () => null);
  const loading = useState("songLoading", () => false);
  const error = useState<string | null>("songError", () => null);

  async function openFile() {
    if (typeof window === "undefined" || !window.tg) return;
    if (loading.value) return; // dialog already open — don't stack another
    loading.value = true;
    error.value = null;
    try {
      const result = await window.tg.openFileDialog();
      if (result) song.value = result;
    } catch (e) {
      error.value = String(e);
    } finally {
      loading.value = false;
    }
  }

  // Listen for File > Open… triggered from the native macOS menu bar
  if (typeof window !== "undefined" && window.tg) {
    const unsub = window.tg.onMenuTriggerOpen(() => void openFile());
    onUnmounted(unsub);
  }

  return { song, loading, error, openFile };
}

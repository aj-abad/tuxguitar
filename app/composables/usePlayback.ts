import {
  PRECISE_FACTOR,
  PRECISE_STARTING_POINT,
  WHOLE_PRECISE_DURATION,
} from "~~/shared/model";
import { songEndTick } from "~~/shared/midi-export";

// ---- module-level singletons -----------------------------------------------
// Playback is a single global activity: one sidecar, one cursor. The imperative
// interpolation state and the sidecar listeners must be shared across every
// component, not recreated per usePlayback() call. Reactive state lives in
// useState (shared by key); the rest lives here at module scope.

let lastTickPrecise = PRECISE_STARTING_POINT;
let lastTickMs = 0;
let currentBpm = 120;
let songEndPrecise = PRECISE_STARTING_POINT;
let rafId: ReturnType<typeof requestAnimationFrame> | null = null;
let listenersBound = false;

export function usePlayback() {
  const { song } = useSong();

  // Shared reactive state — same refs for every component (keyed singletons).
  const isPlaying = useState("pb:isPlaying", () => false);
  const currentMeasure = useState("pb:currentMeasure", () => 1);
  const playbackProgress = useState("pb:progress", () => 0);

  function measureFromPrecise(tick: number): number {
    const headers = song.value?.measureHeaders ?? [];
    let m = 1;
    for (const h of headers) {
      if (tick >= h.start * PRECISE_FACTOR) m = h.number;
      else break;
    }
    return m;
  }

  function stopRaf() {
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  }

  function startRaf() {
    stopRaf();
    const frame = () => {
      if (!isPlaying.value) return;
      const elapsed = performance.now() - lastTickMs;
      // ticks per ms = (whole note ticks) * bpm / (4 beats * 60000 ms/min)
      const ticksPerMs = (WHOLE_PRECISE_DURATION * currentBpm) / (4 * 60_000);
      const interpolated = lastTickPrecise + elapsed * ticksPerMs;

      currentMeasure.value = measureFromPrecise(interpolated);
      const span = songEndPrecise - PRECISE_STARTING_POINT;
      playbackProgress.value = span > 0
        ? Math.min(1, (interpolated - PRECISE_STARTING_POINT) / span)
        : 0;

      rafId = requestAnimationFrame(frame);
    };
    rafId = requestAnimationFrame(frame);
  }

  // Bind sidecar tick/end listeners exactly once (client only). They persist for
  // the app lifetime and always drive the shared state — never per-component.
  function ensureListeners() {
    if (listenersBound || typeof window === "undefined" || !window.tg) return;
    listenersBound = true;

    window.tg.onTick((event) => {
      lastTickPrecise = event.tick;
      lastTickMs = performance.now();
      currentBpm = event.bpm;
    });

    window.tg.onPlaybackEnded(() => {
      isPlaying.value = false;
      playbackProgress.value = 1;
      stopRaf();
    });
  }

  function play() {
    if (typeof window === "undefined" || !window.tg || !song.value) return;
    ensureListeners();

    // Song end = last tick at which a note still sounds, from the same event
    // stream the sidecar plays. This tracks audible playback — it ignores
    // trailing empty measures (which would otherwise inflate the denominator)
    // and honours let-ring/tied durations. Fall back to the measure-header end
    // for a song with no notes.
    const endTick = songEndTick(song.value);
    if (endTick > 0) {
      songEndPrecise = PRECISE_STARTING_POINT + endTick * PRECISE_FACTOR;
    } else {
      const headers = song.value.measureHeaders;
      const lastHeader = headers[headers.length - 1];
      songEndPrecise = lastHeader
        ? lastHeader.start * PRECISE_FACTOR +
          (lastHeader.timeSignature.numerator * WHOLE_PRECISE_DURATION) /
            lastHeader.timeSignature.denominator
        : PRECISE_STARTING_POINT;
    }

    // Reset interpolation to the start.
    lastTickPrecise = PRECISE_STARTING_POINT;
    lastTickMs = performance.now();
    currentBpm = song.value.measureHeaders[0]?.tempo ?? 120;

    isPlaying.value = true;
    currentMeasure.value = 1;
    playbackProgress.value = 0;

    startRaf();
    void window.tg.play();
  }

  function stop() {
    if (typeof window === "undefined" || !window.tg) return;
    isPlaying.value = false;
    playbackProgress.value = 0;
    currentMeasure.value = 1;
    stopRaf();
    void window.tg.stop();
  }

  return { isPlaying, currentMeasure, playbackProgress, play, stop };
}

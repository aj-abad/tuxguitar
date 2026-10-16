import type { TGSong } from "../shared/model";
import type { SidecarStatus } from "../shared/ipc";
import { exportMidi, TPQ, type MidiEvent } from "../shared/midi-export";

interface AudioOutput {
  readonly status: SidecarStatus;
  stop(): Promise<void>;
  load(events: MidiEvent[], tpq: number): Promise<void>;
  play(fromTick: number): Promise<void>;
}

/** Always load the edited score before play; Stop cancels a pending start. */
export class PlaybackSession {
  private epoch = 0;
  constructor(private audio: AudioOutput, private onSong: (song: TGSong) => void) {}

  async play(song: TGSong): Promise<void> {
    const epoch = ++this.epoch;
    if (this.audio.status !== "ready") {
      throw new Error("Audio is unavailable. Build the audio sidecar and restart Tabbycat.");
    }
    await this.audio.stop();
    if (epoch !== this.epoch) return;
    await this.audio.load(exportMidi(song), TPQ);
    if (epoch !== this.epoch) return;
    this.onSong(song);
    await this.audio.play(0);
  }

  async stop(): Promise<void> {
    this.epoch++;
    if (this.audio.status === "ready") await this.audio.stop();
  }
}

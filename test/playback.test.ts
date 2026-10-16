import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { PlaybackSession } from "../electron/playback";
import { parseTgFile } from "../shared/tg-reader";
import { applyFretEdits } from "../shared/editor";
import { TPQ } from "../shared/midi-export";
import type { SidecarStatus } from "../shared/ipc";

const original = parseTgFile(readFileSync(resolve(__dirname, "../china.tg")));
const address = { track: 0, measure: 0, beat: 0, voice: 0, note: 0 };
const audio = () => ({ status: "ready" as SidecarStatus,
  stop: vi.fn(async () => {}), load: vi.fn(async (..._args: unknown[]) => {}), play: vi.fn(async (_tick: number) => {}) });

describe("edited playback", () => {
  it("loads the edited pitch before starting, then loads the original after undo", async () => {
    const output = audio();
    const onSong = vi.fn();
    const session = new PlaybackSession(output, onSong);
    const changed = applyFretEdits(original, [{ address, fret: 4 }]);
    await session.play(changed);
    const [events, tpq] = output.load.mock.calls[0] as [Array<{ type: string; note?: number }>, number];
    expect(tpq).toBe(TPQ);
    expect(events.find(e => e.type === "note_on")?.note).toBe(68); // high E 64 + fret 4
    expect(output.stop.mock.invocationCallOrder[0]).toBeLessThan(output.load.mock.invocationCallOrder[0]!);
    expect(output.load.mock.invocationCallOrder[0]).toBeLessThan(output.play.mock.invocationCallOrder[0]!);
    expect(onSong).toHaveBeenLastCalledWith(changed);
    await session.play(original);
    const restored = output.load.mock.calls[1]![0] as Array<{ type: string; note?: number }>;
    expect(restored.find(e => e.type === "note_on")?.note).toBe(79);
  });

  it("does not restart after Stop interrupts an in-flight load", async () => {
    const output = audio();
    let finish!: () => void;
    output.load.mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
    const session = new PlaybackSession(output, vi.fn());
    const starting = session.play(original);
    await vi.waitFor(() => expect(output.load).toHaveBeenCalled());
    await session.stop();
    finish();
    await starting;
    expect(output.play).not.toHaveBeenCalled();
  });

  it("surfaces unavailable audio and load failures without pretending to play", async () => {
    const output = audio();
    output.status = "not-found";
    const session = new PlaybackSession(output, vi.fn());
    await expect(session.play(original)).rejects.toThrow("Audio is unavailable");
    expect(output.play).not.toHaveBeenCalled();
    output.status = "ready";
    output.load.mockRejectedValue(new Error("synth failed"));
    await expect(session.play(original)).rejects.toThrow("synth failed");
    expect(output.play).not.toHaveBeenCalled();
  });
});

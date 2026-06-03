import { ChildProcess, spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { MidiEvent } from "../shared/midi-export";
import type { SidecarStatus } from "../shared/ipc";

interface PendingRequest {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
}

interface SidecarMessage {
  id?: number;
  event?: string;
  result?: unknown;
  error?: string;
  // tick event fields
  qtick?: number;
  bpm?: number;
}

export class SidecarManager extends EventEmitter {
  private process: ChildProcess | null = null;
  private _status: SidecarStatus = "not-found";
  private pending = new Map<number, PendingRequest>();
  private nextId = 1;
  private lineBuf = "";

  get status(): SidecarStatus {
    return this._status;
  }

  private static binaryCandidates(): string[] {
    return [
      join(__dirname, "../sidecar/bin/tuxguitar-sidecar"),
      join(__dirname, "../../sidecar/bin/tuxguitar-sidecar"),
    ];
  }

  private static soundfontCandidates(): string[] {
    return [
      join(__dirname, "../sidecar/bin/GeneralUser.sf2"),
      join(__dirname, "../../sidecar/bin/GeneralUser.sf2"),
    ];
  }

  private launcher(): [string, string[]] | null {
    const bin = SidecarManager.binaryCandidates().find(existsSync);
    if (!bin) return null;
    const sf = SidecarManager.soundfontCandidates().find(existsSync) ?? "";
    return [bin, sf ? [sf] : []];
  }

  start(): void {
    const launch = this.launcher();
    if (!launch) {
      this._status = "not-found";
      console.log("[sidecar] no binary found — skipping");
      return;
    }
    const [cmd, args] = launch;
    console.log(`[sidecar] launching: ${cmd} ${args.join(" ")}`);
    this._status = "starting";
    this.process = spawn(cmd, args, { stdio: ["pipe", "pipe", "inherit"] });

    this.process.stdout!.on("data", (chunk: Buffer) => this.handleData(chunk));
    this.process.on("exit", (code) => {
      console.log(`[sidecar] exited (code=${code})`);
      this._status = "error";
      this.emit("status", this._status);
    });
    this.process.on("error", (err) => {
      console.error(`[sidecar] spawn error: ${err.message}`);
      this._status = "error";
      this.emit("status", this._status);
    });
  }

  private handleData(chunk: Buffer): void {
    this.lineBuf += chunk.toString("utf8");
    const lines = this.lineBuf.split("\n");
    this.lineBuf = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const msg = JSON.parse(trimmed) as SidecarMessage;
        if (msg.event === "ready") {
          this._status = "ready";
          this.emit("status", this._status);
        } else if (msg.event === "tick") {
          this.emit("tick", { qtick: msg.qtick ?? 0, bpm: msg.bpm ?? 120 });
        } else if (msg.event === "playbackEnded") {
          this.emit("playbackEnded");
        } else if (msg.id != null) {
          const req = this.pending.get(msg.id);
          if (req) {
            this.pending.delete(msg.id);
            if (msg.error) req.reject(new Error(msg.error));
            else req.resolve(msg.result);
          }
        }
      } catch {
        console.error(`[sidecar] bad JSON on stdout: ${trimmed}`);
      }
    }
  }

  private call<T>(method: string, params?: unknown): Promise<T> {
    if (!this.process?.stdin || this._status !== "ready") {
      return Promise.reject(new Error(`sidecar not ready (status=${this._status})`));
    }
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: resolve as (v: unknown) => void,
        reject,
      });
      const msg = params !== undefined
        ? JSON.stringify({ id, method, params })
        : JSON.stringify({ id, method });
      this.process!.stdin!.write(msg + "\n");
    });
  }

  load(events: MidiEvent[], tpq: number): Promise<void> {
    return this.call("synth.load", { events, tpq });
  }

  play(fromTick = 0): Promise<void> {
    return this.call("synth.play", { from_tick: fromTick });
  }

  stop(): Promise<void> {
    return this.call("synth.stop");
  }

  seek(tick: number): Promise<void> {
    return this.call("synth.seek", { tick });
  }

  kill(): void {
    this.process?.kill();
    this.process = null;
    this._status = "not-found";
  }
}

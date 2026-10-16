import { closeSync, existsSync, fsyncSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { basename, dirname, join, resolve } from "node:path";
import { applySongEdits, type SongEdit } from "../shared/editor";
import { parseTgFile, validateFirstBeatPreciseStart } from "../shared/tg-reader";
import { writeTgFile } from "../shared/tg-writer";

/** Main-process ownership keeps paths and original archive bytes out of the renderer. */
export class SongDocument {
  readonly id = randomUUID();
  readonly source: Uint8Array;
  readonly song;
  private diskBytes: Buffer;
  path: string;

  constructor(path: string) {
    this.path = resolve(path);
    this.diskBytes = readFileSync(this.path);
    this.source = new Uint8Array(this.diskBytes);
    this.song = parseTgFile(this.source);
    validateFirstBeatPreciseStart(this.song);
  }

  snapshot() {
    return { id: this.id, fileName: basename(this.path), song: this.song };
  }

  editedSong(edits: SongEdit[]) {
    return applySongEdits(this.song, edits);
  }

  save(path: string, edits: SongEdit[]) {
    const target = resolve(path);
    const bytes = writeTgFile(this.source, edits);
    const samePath = process.platform === "win32" ? target.toLowerCase() === this.path.toLowerCase() : target === this.path;
    if (samePath && (!existsSync(target) || !readFileSync(target).equals(this.diskBytes))) {
      throw new Error("This file changed outside Tabbycat. Use Save As to keep both versions.");
    }
    atomicWrite(target, bytes);
    this.path = target;
    this.diskBytes = Buffer.from(bytes);
    return { fileName: basename(target) };
  }
}

export function atomicWrite(path: string, bytes: Uint8Array): void {
  const temporary = join(dirname(path), `.${basename(path)}.${randomUUID()}.tmp`);
  let fd: number | undefined;
  try {
    fd = openSync(temporary, "wx");
    writeFileSync(fd, bytes);
    fsyncSync(fd);
    closeSync(fd);
    fd = undefined;
    // Same-directory rename is atomic. Never delete the destination first.
    renameSync(temporary, path);
  } finally {
    if (fd !== undefined) closeSync(fd);
    if (existsSync(temporary)) unlinkSync(temporary);
  }
}

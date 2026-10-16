import { mkdtempSync, readFileSync, writeFileSync, readdirSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SongDocument, atomicWrite } from "../electron/documents";
import { parseTgFile } from "../shared/tg-reader";
import { noteAt } from "../shared/editor";

const sample = readFileSync(resolve(__dirname, "../china.tg"));
const folders: string[] = [];
const address = { track: 0, measure: 0, beat: 0, voice: 0, note: 0 };
function fixture() {
  const folder = mkdtempSync(join(tmpdir(), "tabbycat-test-"));
  folders.push(folder);
  const path = join(folder, "original.tg");
  writeFileSync(path, sample);
  return { folder, path, document: new SongDocument(path) };
}
afterEach(() => {
  for (const folder of folders.splice(0)) {
    const target = resolve(folder);
    if (dirname(target) !== resolve(tmpdir()) || !basename(target).startsWith("tabbycat-test-")) {
      throw new Error("Refusing to remove a directory outside this test's temporary folders.");
    }
    rmSync(target, { recursive: true, force: true });
  }
});

describe("document saving", () => {
  it("saves, reopens, then saves an undo to the original song", () => {
    const { folder, path, document } = fixture();
    document.save(path, [{ address, fret: 5 }]);
    expect(noteAt(new SongDocument(path).song, address).value).toBe(5);
    document.save(path, []);
    expect(parseTgFile(readFileSync(path))).toEqual(document.song);
    expect(readdirSync(folder)).toEqual(["original.tg"]);
  });
  it("Save As leaves the original file untouched and updates the document path", () => {
    const { folder, path, document } = fixture();
    const target = join(folder, "edited.tg");
    expect(document.save(target, [{ address, fret: 8 }])).toEqual({ fileName: "edited.tg" });
    expect(document.path).toBe(target);
    expect(readFileSync(path)).toEqual(sample);
    expect(noteAt(new SongDocument(target).song, address).value).toBe(8);
  });
  it("refuses to overwrite an externally changed file", () => {
    const { path, document } = fixture();
    writeFileSync(path, "external changes");
    expect(() => document.save(path, [{ address, fret: 5 }])).toThrow("changed outside");
    expect(readFileSync(path, "utf8")).toBe("external changes");
  });
  it("cleans the temporary file when replacing the destination fails", () => {
    const { folder } = fixture();
    const target = join(folder, "directory.tg");
    mkdirSync(target);
    expect(() => atomicWrite(target, sample)).toThrow();
    expect(readdirSync(folder).sort()).toEqual(["directory.tg", "original.tg"]);
  });
});

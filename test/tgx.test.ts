import { readFileSync, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseTgxFile, writeTgxFile } from '../shared/tgx';
import { parseTgFile } from '../shared/tg-reader';
import { SongDocument } from '../electron/documents';
import { createEditor, setTabDesign, setFret, undoEdit } from '../shared/editor';
import { layoutTab } from '../shared/tab-layout';
import { captureTabDesign } from '../shared/tab-design';
import { isSupportedSongFile } from '../shared/file-formats';

const source = readFileSync('china.tg');
const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
describe('TGX v2 documents', () => {
  it('round-trips the full song, track design, and original source bytes', () => {
    const song = parseTgFile(source);
    song.tracks[0].tabLayout = { rows: [[600], [736]] };
    const parsed = parseTgxFile(writeTgxFile(song, source));
    expect(parsed.song).toEqual(song);
    expect(parsed.sourceTg).toEqual(new Uint8Array(source));
    expect(isSupportedSongFile('Song.TGX')).toBe(true);
  });
  it('opens native TGX without an imported TG archive', () => {
    const song = parseTgFile(source);
    expect(parseTgxFile(writeTgxFile(song))).toEqual({ song, sourceTg: undefined });
  });
  it('saves, reopens, edits, saves again and saves an undo without losing layout or source', () => {
    mkdirSync('.cache', { recursive: true });
    const folder = mkdtempSync(resolve('.cache/tgx-test-')), imported = join(folder, 'original.tg'), path = join(folder, 'designed.tgx');
    writeFileSync(imported, source);
    const document = new SongDocument(imported);
    const original = createEditor(document.id, 'original.tg', document.song);
    const design = captureTabDesign(layoutTab(original.song, 0, 0, original.identities));
    const edited = setFret(setTabDesign(original, 0, design), 12);
    expect(document.requiresTgx(edited.edits)).toBe(true);
    expect(() => document.save(imported, edited.edits)).toThrow('Save as .tgx');
    document.save(path, edited.edits);
    expect(readFileSync(imported)).toEqual(source);
    const reopened = new SongDocument(path);
    expect(reopened.song).toEqual(edited.song);
    const again = setFret(createEditor(reopened.id, 'designed.tgx', reopened.song), 9);
    reopened.save(path, again.edits);
    expect(new SongDocument(path).song).toEqual(again.song);
    reopened.save(path, undoEdit(again).edits);
    expect(new SongDocument(path).song).toEqual(edited.song);
    writeFileSync(path, 'external');
    expect(() => reopened.save(path, [])).toThrow('changed outside');
  });
  it('rejects malformed/unsupported files and inconsistent preserved source before opening', () => {
    expect(() => parseTgxFile(encode({ v: 1, tracks: [] }))).toThrow('Reconvert');
    expect(() => parseTgxFile(encode({ v: 2, song: {} }))).toThrow('Invalid');
    const song = parseTgFile(source);
    song.tracks[0].tabLayout = { rows: [[-1, 200]] };
    expect(() => parseTgxFile(encode({ v: 2, song }))).toThrow('Invalid tab layout');
    delete song.tracks[0].tabLayout;
    const document = JSON.parse(new TextDecoder().decode(writeTgxFile(song, source)));
    document.song.tracks[0].measures[0].beats[0].voices[0].notes[0].value++;
    expect(() => parseTgxFile(encode(document))).toThrow('disagree');
  });
});

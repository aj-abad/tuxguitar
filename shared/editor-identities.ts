import type { TGSong } from "./model";
import { beatKey, noteKey, type BeatAddress, type ScorePatch } from "./score-edits";

export interface EditorIdentities { next: number; columns: Record<string, string>; notes: Record<string, string> }
export function createIdentities(song: TGSong): EditorIdentities {
  const ids: EditorIdentities = { next: 0, columns: {}, notes: {} };
  song.tracks.forEach((t, track) => t.measures.forEach((m, measure) => m.beats.forEach((b, beat) => b.voices.forEach((v, voice) => {
    const address = { track, measure, beat, voice };
    ids.columns[beatKey(address)] = `c${ids.next++}`;
    v.notes.forEach((_, note) => { ids.notes[noteKey({ ...address, note })] = `n${ids.next++}`; });
  }))));
  return ids;
}

/** Update index-to-identity maps alongside the reducer's validated patches. */
export function patchIdentities(before: EditorIdentities, patch: ScorePatch): EditorIdentities {
  if (["note.fret", "note.untie", "voice.duration", "voice.empty"].includes(patch.kind)) return before;
  const ids = { next: before.next, columns: { ...before.columns }, notes: { ...before.notes } };
  const a = patch.address;
  const prefix = `${a.track}:${a.measure}:`;
  if (patch.kind === "measure.columns") {
    for (const key of Object.keys(ids.columns)) if (key.startsWith(prefix)) delete ids.columns[key];
    for (const key of Object.keys(ids.notes)) if (key.startsWith(prefix)) delete ids.notes[key];
    patch.columns.forEach((c, beat) => c.beat.voices.forEach((v, voice) => {
      const old = { ...a, beat: c.source, voice };
      const current = { ...a, beat, voice };
      ids.columns[beatKey(current)] = !c.clone && before.columns[beatKey(old)] || `c${ids.next++}`;
      v.notes.forEach((_, note) => {
        ids.notes[noteKey({ ...current, note })] = !c.clone && before.notes[noteKey({ ...old, note })] || `n${ids.next++}`;
      });
    }));
    return ids;
  }
  const shift = (key: string): string | null => {
    const parts = key.split(":").map(Number);
    if (parts[0] !== a.track || parts[1] !== a.measure) return key;
    if (patch.kind === "beat.add" && parts[2] >= a.beat) parts[2]++;
    if (patch.kind === "voice.add" && parts[2] === a.beat && parts[3] >= a.voice) parts[3]++;
    if ((patch.kind === "note.add" || patch.kind === "note.remove") && parts.length === 5 && parts[2] === a.beat && parts[3] === a.voice) {
      if (patch.kind === "note.remove" && parts[4] === patch.address.note) return null;
      if (parts[4] >= patch.address.note) parts[4] += patch.kind === "note.add" ? 1 : -1;
    }
    return parts.join(":");
  };
  for (const field of ["columns", "notes"] as const) {
    ids[field] = {};
    for (const [key, id] of Object.entries(before[field])) { const next = shift(key); if (next) ids[field][next] = id; }
  }
  if (patch.kind === "note.add") ids.notes[noteKey(patch.address)] = `n${ids.next++}`;
  if (patch.kind === "voice.add") ids.columns[beatKey(a)] = `c${ids.next++}`;
  if (patch.kind === "beat.add") patch.beat.voices.forEach((v, voice) => {
    const address = { ...a, voice };
    ids.columns[beatKey(address)] = `c${ids.next++}`;
    v.notes.forEach((_, note) => { ids.notes[noteKey({ ...address, note })] = `n${ids.next++}`; });
  });
  return ids;
}

export function findColumn(ids: EditorIdentities, id: string): BeatAddress | undefined {
  const key = Object.keys(ids.columns).find(key => ids.columns[key] === id);
  if (!key) return undefined;
  const [track, measure, beat, voice] = key.split(":").map(Number);
  return { track, measure, beat, voice };
}

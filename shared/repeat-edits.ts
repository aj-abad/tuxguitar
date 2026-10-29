import type { TGSong } from './model';
import type { ScorePatch } from './score-edits';

export const MAX_REPEAT_PLAYS = 101; // Native TG allows up to 100 additional repeats.
export type RepeatEdit =
  | { kind: 'repeat.start'; measure: number; enabled: boolean }
  | { kind: 'repeat.end'; measure: number; plays: number | null }
  | { kind: 'repeat.ending'; measure: number; numbers: number[] };

export function endingNumbers(mask: number): number[] {
  return Array.from({ length: 8 }, (_, index) => index + 1).filter(number => Math.floor(mask / 2 ** (number - 1)) % 2 === 1);
}

/** Header edits are global to every track. Validate again when replayed in main. */
export function repeatPatches(song: TGSong, edit: RepeatEdit): ScorePatch[] {
  if (!Number.isInteger(edit.measure) || edit.measure < 0 || !song.measureHeaders[edit.measure]) {
    throw new Error('Select an existing measure to edit repeats.');
  }
  const header = song.measureHeaders[edit.measure];
  let patch: Extract<ScorePatch, { kind: 'header.repeat' }>;
  if (edit.kind === 'repeat.start') {
    if (typeof edit.enabled !== 'boolean') throw new Error('Invalid repeat start.');
    patch = { kind: 'header.repeat', measure: edit.measure, field: 'repeatOpen', value: edit.enabled };
  } else if (edit.kind === 'repeat.end') {
    if (edit.plays !== null && (!Number.isInteger(edit.plays) || edit.plays < 2 || edit.plays > MAX_REPEAT_PLAYS)) {
      throw new Error(`Enter total plays from 2 to ${MAX_REPEAT_PLAYS}.`);
    }
    patch = { kind: 'header.repeat', measure: edit.measure, field: 'repeatClose', value: edit.plays === null ? 0 : edit.plays - 1 };
  } else {
    if (!Array.isArray(edit.numbers) || edit.numbers.length > 8 ||
      edit.numbers.some(n => !Number.isInteger(n) || n < 1 || n > 8) || new Set(edit.numbers).size !== edit.numbers.length) {
      throw new Error('Choose ending numbers from 1 to 8, without duplicates.');
    }
    patch = { kind: 'header.repeat', measure: edit.measure, field: 'repeatAlternative',
      value: edit.numbers.reduce((mask, n) => mask + 2 ** (n - 1), 0) };
  }
  return header[patch.field] === patch.value ? [] : [patch];
}

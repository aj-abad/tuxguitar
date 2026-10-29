// Convert a native TG archive to the same TGX v2 document the editor opens.
// Usage: node scripts/ai/run.mjs [input.tg] [bars-to-add]
import { readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseTgFile } from '../../shared/tg-reader.ts';
import { writeTgxFile } from '../../shared/tgx.ts';

const here = dirname(fileURLToPath(import.meta.url));
const [input = 'china.tg', count = '2'] = process.argv.slice(2);
const path = resolve(here, '../..', input), base = basename(path).replace(/\.tg$/i, '');
const source = readFileSync(path), song = parseTgFile(source);
const bars = Math.max(1, Math.min(64, Math.floor(Number(count)) || 2));
writeFileSync(join(here, `${base}.tgx`), writeTgxFile(song, source));
// The archive is preservation data, not useful AI context. Send only the model.
const prompt = `Extend the first track by ${bars} bars. Preserve its tuning, meter, key and feel.
Return proposed measure headers and measures as JSON using the exact supplied model shape.
Use existing duration objects; preciseStart uses 11531520 units per whole note.
Keep frets in range, one note per string, and physically playable hand spans.
Do not alter existing notes or manual layout rows. New layout rows must be assigned
by the editor after the proposed musical changes are reviewed.

SONG MODEL (TGX v2)
${JSON.stringify(song, null, 2)}
`;
writeFileSync(join(here, `${base}-extend-prompt.txt`), prompt);
console.log(`Wrote scripts/ai/${base}.tgx (TGX v2) and ${base}-extend-prompt.txt`);

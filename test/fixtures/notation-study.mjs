import { readFileSync } from 'node:fs';
import { unzipSync, zipSync } from 'fflate';

const bend = points => `<bend>${points.map(([position, value]) => `<point position="${position}" value="${value}"/>`).join('')}</bend>`;
const note = (fret, string = 1, effect = '', tied = false) => `<note value="${fret}" string="${string}" velocity="95" future="retain"${tied ? ' tiedNote="true"' : ''}>${effect}</note>`;
const n = (fret = 5, string = 1, effect = '', value = 8, extra = {}) => ({ value, notes: note(fret, string, effect), ...extra });
const rest = value => ({ value, notes: '' });
const repeat = (count, value = 8) => Array.from({ length: count }, (_, index) => n([5, 7, 9, 7][index % 4], 1, '', value));

/** Real v2 XML for both desktop regression coverage and an interactive study file. */
export function notationStudy({ silent = false, techniques = true } = {}) {
  const bars = [
    { meter: [4, 4], beats: [n(5, 1, '<hammer/>'), n(7, 1, '<hammer/>'), n(5, 1, '<slide/>'), n(9),
      n(7, 2, '<slide/>'), n(5, 2), n(9, 3), { value: 8, notes: note(9, 3, '', true) }] },
    { meter: [4, 4], beats: [n(7, 1, bend([[0, 0], [6, 4], [12, 4]]), 4),
      n(8, 2, bend([[0, 2], [4, 2], [12, 0]]), 4),
      { value: 4, notes: note(5, 1, bend([[0, 0], [6, 2], [12, 2]])) + note(7, 2, bend([[0, 0], [6, 4], [12, 0]])) },
      n(9, 3, '<slide/>', 4)] },
    { meter: [4, 4], break: true, beats: [n(12, 3, '<hammer/>'), n(14, 3, '<hammer/>', 16), n(12, 3, '', 16),
      n(5, 1, '', 8, { dotted: true }), n(7, 1, '', 16), rest(4), n(7, 2), { value: 8, notes: note(7, 2, '', true) }] },
    { meter: [6, 8], break: true, beats: [{ value: 8, notes: note(7, 2, '', true) }, ...[9, 7, 5, 7, 9].map(f => n(f, 2))] },
    { meter: [4, 4], beats: [...repeat(3).map(b => ({ ...b, ratio: [3, 2] })), rest(4),
      ...repeat(5, 16).map(b => ({ ...b, ratio: [5, 4] })), n(8, 1, bend([[0, 0], [4, 4], [6, 2], [10, 6], [12, 6]]), 4)] },
    { meter: [7, 8], beats: repeat(7) },
    { meter: [4, 4], beats: [...repeat(16, 32), ...repeat(8, 16)] },
    { meter: [4, 4], beats: [n(5, 1, '', 64), n(7, 1, '', 64), n(9, 1, '', 32), n(7, 1, '', 16), rest(8),
      n(7, 1, bend([[0, 2], [12, 2]]), 4), rest(2)] },
    { meter: [4, 4], beats: [{ ...n(), ratio: [3, 2] }, { ...rest(8), ratio: [3, 2] }, { ...n(7), ratio: [3, 2] },
      { ...n(5, 1, '', 4), ratio: [3, 2] }, { ...n(7), ratio: [3, 2] }, rest(2)] },
  ];
  let position = 2882880;
  const measures = bars.map(bar => {
    const start = position;
    const beats = bar.beats.map(beat => {
      const [enters, times] = beat.ratio ?? [1, 1];
      const xml = `<TGBeat><preciseStart>${position}</preciseStart><voice empty="false"><duration value="${beat.value}"${beat.dotted ? ' dotted="dotted"' : ''}><divisionType enters="${enters}" times="${times}"/></duration>${beat.notes}</voice><voice empty="true"><duration value="4"/></voice></TGBeat>`;
      position += 11531520 / beat.value * (beat.dotted ? 1.5 : 1) * times / enters;
      return xml;
    });
    if (position - start !== 11531520 * bar.meter[0] / bar.meter[1]) throw new Error('Study measure does not fill its meter');
    return `<TGMeasure><clef>treble</clef><keySignature>0</keySignature>${beats.join('')}</TGMeasure>`;
  });
  const entries = unzipSync(readFileSync(new URL('../../china.tg', import.meta.url)));
  const headers = bars.map(bar => `<TGMeasureHeader><timeSignature numerator="${bar.meter[0]}" denominator="${bar.meter[1]}"/><tempo>100</tempo>${bar.break ? '<lineBreak/>' : ''}</TGMeasureHeader>`).join('');
  let xml = new TextDecoder().decode(entries['content.xml']).replace('<TGSong><name/>', '<TGSong><name>Rhythm &amp; techniques</name>')
    .replace(/<TGMeasureHeader>.*?<\/TGMeasureHeader>/gs, '').replace('<TGTrack', headers + '<TGTrack')
    .replace(/<TGMeasure>.*?<\/TGMeasure>/gs, '').replace('</TGTrack>', measures.join('') + '</TGTrack>');
  if (silent) xml = xml.replaceAll('<volume>127</volume>', '<volume>0</volume>');
  if (!techniques) xml = xml.replace(/<(?:hammer|slide)\/>|<bend>.*?<\/bend>| tiedNote="true"/gs, '');
  entries['content.xml'] = new TextEncoder().encode(xml);
  return zipSync(entries);
}

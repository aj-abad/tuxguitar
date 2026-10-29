import { unzipSync, zipSync } from 'fflate';
import { notationStudy } from './notation-study.mjs';

/** Ending starts intentionally leave following measures unmarked, as TG does. */
export function repeatStudy({ repeats = true } = {}) {
  const entries = unzipSync(notationStudy());
  const structure = [
    '<repeatOpen/>',
    '<repeatAlternative><alternative>1</alternative></repeatAlternative>',
    '<repeatClose>1</repeatClose>',
    '<repeatAlternative><alternative>2</alternative><alternative>3</alternative></repeatAlternative>',
    '<repeatClose>1</repeatClose>',
    '<repeatAlternative><alternative>4</alternative></repeatAlternative>',
    '<repeatOpen/><repeatClose>2</repeatClose>',
    '<repeatOpen/>',
    '<repeatClose>1</repeatClose>',
  ];
  let index = 0;
  const xml = new TextDecoder().decode(entries['content.xml'])
    .replace('<name>Rhythm &amp; techniques</name>', '<name>Repeats &amp; endings</name>')
    .replace('</preciseStart>', '</preciseStart><text>Intro</text>')
    .replace(/<TGMeasureHeader>.*?<\/TGMeasureHeader>/gs, header =>
      header.replace('</TGMeasureHeader>', (repeats ? structure[index++] : '') + '<futureStructure value="retain"/></TGMeasureHeader>'));
  entries['content.xml'] = new TextEncoder().encode(xml);
  return zipSync(entries);
}

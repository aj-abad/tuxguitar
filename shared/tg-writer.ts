import { unzipSync, zipSync } from "fflate";
import { applySongEdits, noteKey, type ScorePatch, type SongEdit } from "./score-edits";
import type { TGBeat, TGDuration, TGNote, TGVoice } from "./model";
import { parseTgFile } from "./tg-reader";
import { modelSignature } from "./model-signature";
import { parseXmlSource, sourceElement, SourceElement } from "./xml-source";
import { endingNumbers } from './repeat-edits';

function setNumberText(node: SourceElement, value: number): void {
  if (/\/>$/.test(node.opening)) {
    node.opening = node.opening.replace(/\/>$/, '>');
    node.closing = `</${node.name}>`;
  }
  // The numeric value changes; extension elements, comments and attributes stay.
  node.content = [String(value), ...node.content.filter(item => item instanceof SourceElement || /^\s*<(?:!--|\?)/.test(item))];
}

function patchRepeat(song: SourceElement, patch: Extract<ScorePatch, { kind: 'header.repeat' }>): void {
  const header = song.child('TGMeasureHeader', patch.measure), existing = header.elements(patch.field);
  if (!patch.value) { existing.forEach(node => header.remove(node)); return; }
  const node = existing[0] ?? sourceElement(patch.field);
  if (patch.field === 'repeatClose') setNumberText(node, patch.value);
  else if (patch.field === 'repeatAlternative') {
    const alternatives = node.elements('alternative');
    node.replaceElements('alternative', endingNumbers(patch.value).map((number, index) => {
      const alternative = alternatives[index]?.clone() ?? sourceElement('alternative');
      setNumberText(alternative, number);
      return alternative;
    }));
  }
  if (!existing.length) header.insert(node);
  for (const duplicate of existing.slice(1)) header.remove(duplicate);
}

function durationNode(duration: TGDuration): SourceElement {
  const node = sourceElement("duration");
  updateDuration(node, duration);
  return node;
}
function updateDuration(node: SourceElement, duration: TGDuration): void {
  node.attribute("value", duration.value);
  node.attribute("dotted", duration.doubleDotted ? "doubleDotted" : duration.dotted ? "dotted" : null);
  const existing = node.elements("divisionType")[0];
  if (duration.division) {
    const division = existing ?? sourceElement("divisionType");
    division.attribute("enters", duration.division.enters);
    division.attribute("times", duration.division.times);
    if (!existing) node.insert(division);
  } else if (existing) node.remove(existing);
}
function noteNode(note: TGNote): SourceElement {
  // New notes start plain. Existing notes and their effects are never rebuilt.
  return sourceElement("note", { string: note.string, value: note.value, velocity: note.velocity });
}
function voiceNode(voice: TGVoice): SourceElement {
  const node = sourceElement("voice", { empty: voice.empty, direction: voice.direction === 2 ? "down" : "up" });
  node.insert(durationNode(voice.duration));
  for (const note of voice.notes) node.insert(noteNode(note));
  return node;
}
function beatNode(beat: TGBeat): SourceElement {
  const node = sourceElement("TGBeat");
  const start = new SourceElement("preciseStart", "<preciseStart>", "</preciseStart>", [String(beat.preciseStart)]);
  node.insert(start);
  for (const voice of beat.voices) node.insert(voiceNode(voice));
  return node;
}
function patchXml(song: SourceElement, patch: ScorePatch): void {
  if (patch.kind === 'track.layout') throw new Error('Save as .tgx to keep the tab design.');
  if (patch.kind === 'header.repeat') { patchRepeat(song, patch); return; }
  const a = patch.address;
  const measure = song.child("TGTrack", a.track).child("TGMeasure", a.measure);
  if (patch.kind === "measure.columns") {
    const originals = measure.elements("TGBeat");
    measure.replaceElements("TGBeat", patch.columns.map(column => {
      const node = originals[column.source].clone();
      node.child("preciseStart").content = [String(column.beat.preciseStart)];
      const value = column.beat.voices[a.voice];
      if (value) {
        const voice = node.child("voice", a.voice);
        voice.attribute("empty", value.empty);
        const duration = voice.elements("duration")[0] ?? durationNode(value.duration);
        if (!voice.elements("duration").length) voice.insert(duration);
        updateDuration(duration, value.duration);
      }
      return node;
    }));
    return;
  }
  if (patch.kind === "beat.add") { measure.insert(beatNode(patch.beat), a.beat); return; }
  const beat = measure.child("TGBeat", a.beat);
  if (patch.kind === "voice.add") { beat.insert(voiceNode(patch.voice), a.voice); return; }
  const voice = beat.child("voice", a.voice);
  switch (patch.kind) {
    case "voice.empty": voice.attribute("empty", patch.empty); break;
    case "voice.duration": {
      let duration = voice.elements("duration")[0];
      if (!duration) { duration = sourceElement("duration"); voice.insert(duration, 0); }
      updateDuration(duration, patch.duration);
      break;
    }
    case "note.add": voice.insert(noteNode(patch.note), patch.address.note); break;
    case "note.remove": voice.remove(voice.child("note", patch.address.note)); break;
    case "note.fret": voice.child("note", patch.address.note).attribute("value", patch.fret); break;
    case "note.untie": voice.child("note", patch.address.note).attribute("tiedNote", null); break;
    case "note.tie": voice.child("note", patch.address.note).attribute("tiedNote", patch.tied ? true : null); break;
    case "note.effect": {
      const note = voice.child('note', patch.address.note), existing = note.elements(patch.effect);
      if (!patch.value) existing.forEach(node => note.remove(node));
      else if (!existing.length) note.insert(sourceElement(patch.effect));
      break;
    }
    case "note.bend": {
      const note = voice.child('note', patch.address.note), existing = note.elements('bend');
      if (!patch.bend) existing.forEach(node => note.remove(node));
      else {
        const bend = existing[0] ?? sourceElement('bend');
        const points = bend.elements('point');
        bend.replaceElements('point', patch.bend.points.map((point, index) => {
          const node = points[index]?.clone() ?? sourceElement('point');
          node.attribute('position', point.position); node.attribute('value', point.value);
          return node;
        }));
        if (!existing.length) note.insert(bend);
        for (const duplicate of existing.slice(1)) note.remove(duplicate);
      }
      break;
    }
  }
}

/** Apply validated edits to original XML tokens, preserving unrelated data. */
export function writeTgFile(source: Uint8Array, edits: SongEdit[]): Uint8Array {
  const original = parseTgFile(source);
  if (!Array.isArray(edits)) throw new Error("Invalid song edits.");
  // Legacy direct fret patches are an unordered set; command sequences can
  // intentionally revisit the same note as the document structure changes.
  if (edits.every(edit => edit && !("kind" in edit))) {
    const keys = edits.map(edit => noteKey((edit as import("./score-edits").FretEdit).address));
    if (new Set(keys).size !== keys.length) throw new Error("Duplicate fret edit.");
  }
  if (!edits.length) return source.slice();
  const entries = unzipSync(source);
  const xml = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(entries["content.xml"]);
  const tree = parseXmlSource(xml);
  const song = tree.child("TuxGuitarFile").child("TGSong");
  const expected = applySongEdits(original, edits, patch => patchXml(song, patch));
  const output = tree.toString();
  if (output === xml) return source.slice();
  entries["content.xml"] = new TextEncoder().encode(output);
  const result = zipSync(entries);
  if (modelSignature(parseTgFile(result)) !== modelSignature(expected)) {
    throw new Error("Save verification failed. The original file has not been changed.");
  }
  return result;
}

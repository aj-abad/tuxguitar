import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { unzipSync, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { writeTgFile } from "../../shared/tg-writer";
import { parseTgFile } from "../../shared/tg-reader";
import { applyFretEdits, type FretEdit } from "../../shared/editor";

const source = new Uint8Array(readFileSync(resolve(__dirname, "../../china.tg")));
const edit: FretEdit = { address: { track: 0, measure: 0, beat: 0, voice: 0, note: 0 }, fret: 7 };
const text = (bytes: Uint8Array) => new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes);

describe("source-preserving .tg writer", () => {
  it("round trips a fret edit with every other model field intact", () => {
    const result = writeTgFile(source, [edit]);
    expect(parseTgFile(result)).toEqual(applyFretEdits(parseTgFile(source), [edit]));
    const before = unzipSync(source);
    const after = unzipSync(result);
    expect(text(after["content.xml"]!)).toBe(text(before["content.xml"]!).replace('value="15"', 'value="7"'));
    expect(after["version.txt"]).toEqual(before["version.txt"]);
  });

  it("returns an unchanged file byte for byte when there are no edits", () => {
    expect(writeTgFile(source, [])).toEqual(source);
  });

  it.each(["\n", "\r\n", "\r"])("preserves unknown data, UTF-8, CDATA, quotes and %j line endings", newline => {
    const entries = unzipSync(source);
    let xml = text(entries["content.xml"]!);
    xml = "\uFEFF" + xml.replace(/></g, ">" + newline + "<")
      .replace("<comments/>", '<comments><![CDATA[  café & <note value="99"/>  ]]></comments>')
      .replace('<note string="1" value="15" velocity="95"/>',
        `<note extra="quoted > value='88'" string='1' value = '15' velocity='95'><bend><point position="0" value="2"/></bend><palmMute/><future effect="keep &amp; retain"/></note>`)
      .replace("</TGTrack>", '<future><note value="33"/></future><!-- <note value="44"/> --></TGTrack>');
    entries["content.xml"] = new TextEncoder().encode(xml);
    entries["attachments/opaque.bin"] = new Uint8Array([0, 255, 1, 128, 33]);
    const result = unzipSync(writeTgFile(zipSync(entries), [edit]));
    expect(text(result["content.xml"]!)).toBe(xml.replace("value = '15'", "value = '7'"));
    expect(result["attachments/opaque.bin"]).toEqual(entries["attachments/opaque.bin"]);
  });

  it("applies edits with different digit lengths without shifting later offsets", () => {
    const edits = [edit, { address: { ...edit.address, beat: 4 }, fret: 29 },
      { address: { ...edit.address, beat: 8 }, fret: 0 }];
    expect(parseTgFile(writeTgFile(source, edits))).toEqual(applyFretEdits(parseTgFile(source), edits));
  });

  it("rejects malformed or out-of-range changes before writing", () => {
    expect(() => writeTgFile(source, [{ ...edit, fret: 99 }])).toThrow();
    expect(() => writeTgFile(source, [{ ...edit, address: { ...edit.address, note: 99 } }])).toThrow();
    expect(() => writeTgFile(source, [edit, edit])).toThrow("Duplicate");
  });
});

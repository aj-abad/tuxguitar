# TGX v2

`.tgx` is Tabbycat's editable JSON document format. Open, drop, Save and Save As use the same codec (`shared/tgx.ts`). Version 2 replaces the earlier, lossy v1 AI projection. Reconvert the original `.tg` with `pnpm ai:tgx` to update a v1 file.

```json
{
  "v": 2,
  "song": {
    "name": "Study",
    "tracks": [
      {
        "name": "Guitar",
        "tabLayout": { "rows": [[360, 376], [240, 248, 248]] }
      }
    ]
  },
  "sourceTg": "optional base64 TG archive"
}
```

The example omits musical fields for clarity. `song` is the complete `TGSong` model in `shared/model.ts`: all metadata, channels, measure headers, tracks, beats, voices, notes, durations and effects. Timing uses the original TG precise units. Stored note data is independent of visual spacing.

Each track's optional `tabLayout.rows` lists bar widths, in order, in unzoomed document units. Every bar appears exactly once. The row lengths define explicit breaks; they override imported `lineBreak` hints. Widths do not change with zoom, window size, or density. Omitting `tabLayout` restores automatic layout and the imported break hints. Layout commands are part of normal dirty state and undo/redo.

The normal page is 860 units wide with 32-unit document margins. Dragging an internal barline redistributes space between its two neighboring bars and keeps row edges fixed. Break-after and pull-from-next-row are explicit operations. Pulling refuses rows that cannot fit legibly. If later musical edits exceed a saved bar's notation minimum, rendering expands that bar and reports it without moving bars between rows or rewriting the saved widths. Oversized rows remain scrollable on a wider sheet; ordinary page width stays fixed.

Automatic spacing uses duration-weighted intervals and grows dense bars up to the page budget. Within a fixed bar width, long intervals compress first while fret numbers, bends and repeat symbols keep their minimum space. Playback uses the exact musical clock and crosses note centers at their onsets.

`sourceTg` preserves unknown XML and archive entries from imported TG files. It is updated through the source-preserving writer on save and verified against the musical model on reopen. Native TGX documents can omit it. If hand-editing the musical JSON, remove `sourceTg` to avoid a stale-source mismatch; editing only `tabLayout` does not invalidate it. The AI converter omits this preservation payload from prompt context.

Save verifies the document before an atomic disk write and checks for external file changes. A TG import with a manual layout prompts for a `.tgx` destination; the original `.tg` is retained. Legacy `.tg` saving is available when there is a preserved source and no manual layout. TGX does not serialize runtime selection, note identities, undo history, zoom, or design-mode visibility.

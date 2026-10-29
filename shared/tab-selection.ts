import { beatKey, type EditorCursor } from './score-edits';
import { cellBounds, type Rect, type TabLayout, type TabSystem } from './tab-layout';
import { noteText } from './tab-techniques';

/** Every drag selects all strings in its musical column interval, in either direction. */
export function wrappedTabCells(layout: TabLayout, anchor: EditorCursor, focus: EditorCursor): EditorCursor[] {
  const from = layout.byAddress.get(beatKey(anchor)), to = layout.byAddress.get(beatKey(focus));
  if (!from || !to) return [];
  const firstColumn = layout.columns.indexOf(from.column), lastColumn = layout.columns.indexOf(to.column);
  return layout.columns.slice(Math.min(firstColumn, lastColumn), Math.max(firstColumn, lastColumn) + 1).flatMap(column => {
    const system = layout.byAddress.get(beatKey(column.address))!.system;
    return system.strings.map(string => ({ ...column.address, string: string.number }));
  });
}

/** Touching any part of a fret adds its whole column, even outside the wrapped interval. */
export function includeMarqueeColumns(layout: TabLayout, range: readonly EditorCursor[], rectangle: Rect): EditorCursor[] {
  const selected = new Set(range.map(beatKey));
  const right = rectangle.x + rectangle.w, bottom = rectangle.y + rectangle.h;
  const halfHeight = layout.fretSize * .55;
  for (const system of layout.systems) {
    if (system.top - halfHeight > bottom || system.bottom + halfHeight < rectangle.y) continue;
    for (const column of system.columns) for (const item of column.notes) {
      // Use the fret text extent, without the white string-line knockout padding.
      const halfWidth = noteText(item.note).length * layout.fretSize * .62 / 2;
      if (column.x - halfWidth <= right && column.x + halfWidth >= rectangle.x &&
        item.y - halfHeight <= bottom && item.y + halfHeight >= rectangle.y) {
        selected.add(beatKey(column.address));
      }
    }
  }
  return layout.columns.filter(column => selected.has(beatKey(column.address))).flatMap(column =>
    layout.byAddress.get(beatKey(column.address))!.system.strings.map(string => ({ ...column.address, string: string.number })));
}

/** Join neighboring cells into bands without painting over gaps. */
export function tabCellSelectionRects(layout: TabLayout, cells: readonly EditorCursor[], systems: readonly TabSystem[] = layout.systems): Rect[] {
  const selected = new Map<string, Set<number>>();
  for (const cursor of cells) {
    const key = beatKey(cursor);
    if (!selected.has(key)) selected.set(key, new Set());
    selected.get(key)!.add(cursor.string);
  }
  const rectangles: Rect[] = [];
  for (const system of systems) {
    let previous = new Map<string, Rect>();
    for (const column of system.columns) {
      const strings = selected.get(beatKey(column.address)), current = new Map<string, Rect>();
      for (let first = 0; first < system.strings.length; first++) {
        if (!strings?.has(system.strings[first].number)) continue;
        let last = first;
        while (last + 1 < system.strings.length && strings.has(system.strings[last + 1].number)) last++;
        const bounds = system.strings.slice(first, last + 1).map(string => cellBounds(layout, { ...column.address, string: string.number })!);
        const left = Math.min(...bounds.map(b => b.x)), right = Math.max(...bounds.map(b => b.x + b.w));
        const key = `${first}:${last}`, existing = previous.get(key);
        if (existing) { existing.w = right - existing.x; current.set(key, existing); }
        else {
          const rectangle = { x: left, y: bounds[0].y, w: right - left, h: bounds.at(-1)!.y + bounds.at(-1)!.h - bounds[0].y };
          rectangles.push(rectangle); current.set(key, rectangle);
        }
        first = last;
      }
      previous = current;
    }
  }
  return rectangles;
}

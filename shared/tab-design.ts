import type { TGTabLayout } from './model';
import type { TabLayout } from './tab-layout';

/** Own the input: neither IPC callers nor drag previews may mutate history. */
export function validateTabDesign(value: unknown, measures: number): TGTabLayout {
  const rows = (value as TGTabLayout | null)?.rows;
  if (!Array.isArray(rows) || !rows.length || rows.length > measures ||
      rows.some(row => !Array.isArray(row) || !row.length || row.some(w => !Number.isFinite(w) || w < 48 || w > 100_000)) ||
      rows.reduce((sum, row) => sum + row.length, 0) !== measures) {
    throw new Error('Invalid tab layout: each bar needs one readable width in one row.');
  }
  return { rows: rows.map(row => [...row]) };
}

export function captureTabDesign(layout: TabLayout): TGTabLayout {
  return { rows: layout.systems.map(row => row.measures.map(bar => bar.width)) };
}

/** Distribute a fixed budget without ever taking space needed by notation. */
export function fitBarWidths(preferred: number[], minimum: number[], total: number): number[] {
  const floor = minimum.reduce((sum, width) => sum + width, 0);
  if (total < floor - .01) throw new Error('These bars cannot fit in one row at a readable size.');
  const weights = preferred.map((width, i) => Math.max(0, width - minimum[i]));
  const sum = weights.reduce((a, b) => a + b, 0);
  return minimum.map((width, i) => width + Math.max(0, total - floor) * (sum ? weights[i] / sum : 1 / minimum.length));
}

export function resizeTabBoundary(layout: TabLayout, rowIndex: number, barIndex: number, delta: number): TGTabLayout {
  if (!Number.isFinite(delta)) throw new Error('Invalid bar width.');
  const row = layout.systems[rowIndex], before = row?.measures[barIndex], after = row?.measures[barIndex + 1];
  if (!before || !after) throw new Error('Drag a barline between two bars.');
  const design = captureTabDesign(layout);
  const change = Math.max(before.minWidth - before.width, Math.min(after.width - after.minWidth, delta));
  design.rows[rowIndex][barIndex] += change;
  design.rows[rowIndex][barIndex + 1] -= change;
  return design;
}

export function breakTabRow(layout: TabLayout, measure: number): TGTabLayout {
  const index = layout.systems.findIndex(row => row.measures.some(bar => bar.index === measure));
  const row = layout.systems[index], split = row?.measures.findIndex(bar => bar.index === measure) ?? -1;
  if (!row || split < 0 || split === row.measures.length - 1) throw new Error('This bar already ends its row.');
  const design = captureTabDesign(layout), bars = row.measures;
  const total = bars.reduce((sum, bar) => sum + bar.width, 0);
  const fitted = (part: typeof bars) => fitBarWidths(part.map(b => b.width), part.map(b => b.minWidth), total);
  design.rows.splice(index, 1, fitted(bars.slice(0, split + 1)), fitted(bars.slice(split + 1)));
  return design;
}

export function absorbTabRow(layout: TabLayout, rowIndex: number): TGTabLayout {
  const row = layout.systems[rowIndex], next = layout.systems[rowIndex + 1];
  if (!row || !next?.measures.length) throw new Error('There is no following row.');
  const design = captureTabDesign(layout), bars = [...row.measures, next.measures[0]];
  const total = row.measures.reduce((sum, bar) => sum + bar.width, 0);
  design.rows[rowIndex] = fitBarWidths(bars.map(b => b.width), bars.map(b => b.minWidth), total);
  const rest = next.measures.slice(1);
  if (rest.length) design.rows[rowIndex + 1] = fitBarWidths(rest.map(b => b.width), rest.map(b => b.minWidth), next.measures.reduce((sum, b) => sum + b.width, 0));
  else design.rows.splice(rowIndex + 1, 1);
  return design;
}

import type { Technique } from './technique-edits';

/** Stable command IDs are independent of bindings and UI placement. */
export const TAB_COMMANDS = [
  { id: 'column.left', label: 'Move columns left' }, { id: 'column.right', label: 'Move columns right' },
  { id: 'column.copyLeft', label: 'Duplicate columns left' }, { id: 'column.copyRight', label: 'Duplicate columns right' },
  { id: 'note.delete', label: 'Delete notes' }, { id: 'voice.rest', label: 'Make rest' },
  { id: 'duration.longer', label: 'Longer duration' }, { id: 'duration.shorter', label: 'Shorter duration' },
  { id: 'duration.dot', label: 'Toggle dot' },
  { id: 'technique.bend', label: 'Bend' }, { id: 'technique.slide', label: 'Slide' },
  { id: 'technique.hammer-on', label: 'Hammer-on' }, { id: 'technique.pull-off', label: 'Pull-off' },
  { id: 'technique.tie', label: 'Tie to previous' }, { id: 'technique.clear', label: 'Clear techniques' },
  { id: 'repeat.start', label: 'Repeat start' }, { id: 'repeat.end', label: 'Repeat end' },
  { id: 'repeat.ending', label: 'Alternate ending' }, { id: 'repeat.clear', label: 'Clear measure repeats' },
] as const;
export type TabCommandId = typeof TAB_COMMANDS[number]['id'];
export type TechniqueCommandId = `technique.${Technique}`;
export const TECHNIQUE_COMMANDS = TAB_COMMANDS.filter((c): c is Extract<typeof TAB_COMMANDS[number], { id: TechniqueCommandId }> =>
  c.id.startsWith('technique.') && c.id !== 'technique.clear');
export type RepeatCommandId = 'repeat.start' | 'repeat.end' | 'repeat.ending';
export const REPEAT_COMMANDS = TAB_COMMANDS.filter((c): c is Extract<typeof TAB_COMMANDS[number], { id: RepeatCommandId }> =>
  c.id.startsWith('repeat.') && c.id !== 'repeat.clear');

export interface TabKeyChord { key: string; alt?: boolean; ctrl?: boolean; meta?: boolean; shift?: boolean }
export interface TabBinding extends TabKeyChord { command: TabCommandId }
/** An empty array unbinds a command; omission retains its defaults. */
export type TabKeymapOverrides = Partial<Record<TabCommandId, readonly TabKeyChord[]>>;
const chord = (command: TabCommandId, key: string, modifiers: Omit<TabKeyChord, 'key'> = {}): TabBinding => ({ command, key, ...modifiers });
export const DEFAULT_TAB_BINDINGS: readonly TabBinding[] = [
  chord('column.left', 'ArrowLeft', { alt: true }), chord('column.right', 'ArrowRight', { alt: true }),
  chord('column.copyLeft', 'ArrowLeft', { alt: true, shift: true }), chord('column.copyRight', 'ArrowRight', { alt: true, shift: true }),
  chord('note.delete', 'Delete'), chord('note.delete', 'Backspace'), chord('voice.rest', 'r'),
  chord('duration.longer', '+', { shift: true }), chord('duration.longer', '+'), chord('duration.longer', '='),
  chord('duration.shorter', '-'), chord('duration.dot', '.'),
  chord('technique.bend', 'b'), chord('technique.slide', 's'), chord('technique.hammer-on', 'h'),
  chord('technique.pull-off', 'p'), chord('technique.tie', 't'),
  chord('repeat.start', '['), chord('repeat.end', ']'), chord('repeat.ending', 'e'),
];
const navigation = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'];
const signature = (c: TabKeyChord) => `${+!!c.alt}${+!!c.ctrl}${+!!c.meta}${+!!c.shift}:${c.key.toLowerCase()}`;

/** Validate a complete proposed configuration before replacing the active map. */
export function createTabBindings(overrides: TabKeymapOverrides = {}): readonly TabBinding[] {
  if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) throw new Error('Invalid shortcut overrides.');
  for (const [id, keys] of Object.entries(overrides)) {
    if (!TAB_COMMANDS.some(c => c.id === id) || !Array.isArray(keys)) throw new Error(`Invalid shortcut command: ${id}.`);
  }
  const bindings = TAB_COMMANDS.flatMap(c => Object.hasOwn(overrides, c.id)
    ? overrides[c.id]!.map(key => ({ ...key, command: c.id })) : DEFAULT_TAB_BINDINGS.filter(b => b.command === c.id));
  const used = new Map<string, TabCommandId>();
  for (const b of bindings) {
    if (typeof b.key !== 'string' || !b.key || b.key.trim() !== b.key ||
      Object.keys(b).some(k => !['command', 'key', 'alt', 'ctrl', 'meta', 'shift'].includes(k)) ||
      ['alt', 'ctrl', 'meta', 'shift'].some(k => k in b && typeof b[k as keyof TabKeyChord] !== 'boolean')) throw new Error('Invalid shortcut chord.');
    const logicalKey = b.key.toLowerCase();
    // Keep note entry/navigation, native document commands and AltGr available.
    if ((!b.alt && !b.ctrl && !b.meta && (/^[0-9]$/.test(logicalKey) || navigation.some(n => n.toLowerCase() === logicalKey) || logicalKey === 'escape')) ||
      ['space', 'tab', 'enter', 'dead', 'process', 'unidentified', 'control', 'alt', 'meta', 'shift'].includes(logicalKey) ||
      b.ctrl && b.alt || (b.ctrl || b.meta) && ['o', 's', 'z', 'y', 'r', 'w', 'q'].includes(logicalKey)) {
      throw new Error(`${formatTabChord(b)} is reserved.`);
    }
    if ([...b.key].length !== 1 && ![...navigation, 'Delete', 'Backspace', 'Escape', 'PageUp', 'PageDown', 'Insert'].some(n => n.toLowerCase() === logicalKey) &&
      !/^f([1-9]|1[0-9]|2[0-4])$/.test(logicalKey)) throw new Error('Invalid shortcut key.');
    const key = signature(b), existing = used.get(key);
    if (existing) throw new Error(`${formatTabChord(b)} is already assigned to ${TAB_COMMANDS.find(c => c.id === existing)!.label}.`);
    used.set(key, b.command);
  }
  return bindings;
}

export function formatTabChord(c: TabKeyChord): string {
  const labels: Record<string, string> = { ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓' };
  return [c.ctrl && 'Ctrl', c.meta && 'Cmd', c.alt && 'Alt', c.shift && c.key !== '+' && 'Shift', labels[c.key] ?? (c.key.length === 1 ? c.key.toUpperCase() : c.key)].filter(Boolean).join('+');
}
export function tabShortcut(id: TabCommandId, bindings: readonly TabBinding[] = DEFAULT_TAB_BINDINGS): string {
  const binding = bindings.find(b => b.command === id);
  return binding ? formatTabChord(binding) : '';
}

export type TabKeyAction = { kind: 'command'; id: TabCommandId } | { kind: 'digit'; digit: string }
  | { kind: 'navigate'; direction: string; extend: boolean } | { kind: 'collapse' };
export function resolveTabKey(event: Pick<KeyboardEvent, 'key' | 'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'isComposing'>,
  bindings: readonly TabBinding[] = DEFAULT_TAB_BINDINGS): TabKeyAction | null {
  if (event.isComposing || event.ctrlKey && event.altKey) return null;
  const key = signature({ key: event.key, alt: event.altKey, ctrl: event.ctrlKey, meta: event.metaKey, shift: event.shiftKey });
  const binding = bindings.find(b => signature(b) === key);
  if (binding) return { kind: 'command', id: binding.command };
  if (event.altKey || event.ctrlKey || event.metaKey) return null;
  if (/^[0-9]$/.test(event.key)) return { kind: 'digit', digit: event.key };
  if (navigation.includes(event.key)) return { kind: 'navigate', direction: event.key, extend: event.shiftKey };
  if (event.key === 'Escape') return { kind: 'collapse' };
  return null;
}

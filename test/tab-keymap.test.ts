import { describe, expect, it } from 'vitest';
import { createTabBindings, resolveTabKey, tabShortcut, type TabKeymapOverrides } from '../shared/tab-commands';

const key = (value: string, extra = {}, overrides: TabKeymapOverrides = {}) => resolveTabKey({ key: value, altKey: false,
  ctrlKey: false, metaKey: false, shiftKey: false, isComposing: false, ...extra }, createTabBindings(overrides));
describe('configurable command bindings', () => {
  it.each([['[', 'start'], [']', 'end'], ['e', 'ending']])('maps %s to repeat %s with configurable hints', (value, command) => {
    expect(key(value)).toEqual({ kind: 'command', id: `repeat.${command}` });
    expect(key(value, { ctrlKey: true })).toBeNull();
    expect(key(value, { isComposing: true })).toBeNull();
  });
  it('supports replacing and unbinding repeat shortcuts without changing note entry', () => {
    const overrides: TabKeymapOverrides = { 'repeat.start': [{ key: 'F6' }], 'repeat.end': [], 'repeat.ending': [{ key: 'e', alt: true }] };
    expect(key('[', {}, overrides)).toBeNull();
    expect(key(']', {}, overrides)).toBeNull();
    expect(key('e', {}, overrides)).toBeNull();
    expect(key('F6', {}, overrides)).toEqual({ kind: 'command', id: 'repeat.start' });
    expect(key('e', { altKey: true }, overrides)).toEqual({ kind: 'command', id: 'repeat.ending' });
    expect(tabShortcut('repeat.ending', createTabBindings(overrides))).toBe('Alt+E');
    expect(() => createTabBindings({ 'repeat.start': [{ key: 'b' }] })).toThrow('already assigned');
    expect(key('1', {}, overrides)).toEqual({ kind: 'digit', digit: '1' });
  });
  it.each([['b', 'bend'], ['s', 'slide'], ['h', 'hammer-on'], ['p', 'pull-off'], ['t', 'tie']])('maps %s to %s', (letter, technique) => {
    expect(key(letter)).toEqual({ kind: 'command', id: `technique.${technique}` });
    expect(key(letter.toUpperCase())).toEqual(key(letter));
    expect(key(letter, { ctrlKey: true })).toBeNull();
    expect(key(letter, { metaKey: true })).toBeNull();
    expect(key(letter, { isComposing: true })).toBeNull();
  });
  it('replaces bindings, supports aliases and unbinding, and derives hints from the active map', () => {
    const overrides: TabKeymapOverrides = { 'technique.bend': [{ key: 'j', alt: true }, { key: 'F8' }], 'technique.slide': [] };
    expect(key('b', {}, overrides)).toBeNull();
    expect(key('s', {}, overrides)).toBeNull();
    expect(key('j', { altKey: true }, overrides)).toEqual({ kind: 'command', id: 'technique.bend' });
    expect(key('j', {}, overrides)).toBeNull();
    expect(key('F8', {}, overrides)).toEqual({ kind: 'command', id: 'technique.bend' });
    expect(tabShortcut('technique.bend', createTabBindings(overrides))).toBe('Alt+J');
    expect(tabShortcut('technique.slide', createTabBindings(overrides))).toBe('');
    expect(tabShortcut('technique.bend', createTabBindings())).toBe('B');
  });
  it('rejects collisions, reserved editor/document keys and malformed overrides', () => {
    expect(() => createTabBindings({ 'technique.bend': [{ key: 's' }] })).toThrow('already assigned');
    for (const chord of [{ key: '1' }, { key: 'ArrowLeft' }, { key: 'arrowleft' }, { key: 'Escape' }, { key: 'escape' }, { key: 's', ctrl: true }, { key: 'z', meta: true }, { key: 'b', ctrl: true, alt: true }]) {
      expect(() => createTabBindings({ 'technique.bend': [chord] })).toThrow('reserved');
    }
    expect(() => createTabBindings({ unknown: [] } as TabKeymapOverrides)).toThrow('Invalid shortcut command');
    expect(() => createTabBindings({ 'technique.bend': [{ key: '', alt: true }] })).toThrow('Invalid shortcut chord');
    expect(key('b')).toEqual({ kind: 'command', id: 'technique.bend' });
  });
  it('keeps navigation/digit entry and exact modifiers separate from commands', () => {
    expect(key('h', { shiftKey: true })).toBeNull();
    expect(key('h', { ctrlKey: true, altKey: true })).toBeNull();
    expect(key('ArrowRight', { shiftKey: true })).toEqual({ kind: 'navigate', direction: 'ArrowRight', extend: true });
    expect(key('7')).toEqual({ kind: 'digit', digit: '7' });
    expect(key('+', { shiftKey: true })).toEqual({ kind: 'command', id: 'duration.longer' });
  });
});

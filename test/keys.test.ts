import { describe, expect, it, vi } from 'vitest';
import { comboOf, displayCombo } from '../src/renderer/src/keys';

vi.mock('electron', () => ({}));
const { normaliseSettings, DEFAULT_SETTINGS } = await import('../src/main/config');

function key(k: string, mods: Partial<{ ctrl: boolean; alt: boolean; shift: boolean; meta: boolean }> = {}) {
  return { key: k, ctrlKey: !!mods.ctrl, altKey: !!mods.alt, shiftKey: !!mods.shift, metaKey: !!mods.meta };
}

describe('key combos', () => {
  it('builds combos with modifiers', () => {
    expect(comboOf(key('d'))).toBe('D');
    expect(comboOf(key('D', { shift: true }))).toBe('Shift+D');
    expect(comboOf(key('j', { ctrl: true, shift: true }))).toBe('Ctrl+Shift+J');
    expect(comboOf(key('F11'))).toBe('F11');
    expect(comboOf(key('PageDown', { alt: true }))).toBe('Alt+PageDown');
    expect(comboOf(key('!', { shift: true }))).toBe('!');
    expect(comboOf(key(' '))).toBe('Space');
    expect(comboOf(key('Shift', { shift: true }))).toBeNull();
  });

  it('shows short names', () => {
    expect(displayCombo('PageDown')).toBe('PgDn');
    expect(displayCombo('Escape')).toBe('Esc');
  });
});

describe('key settings', () => {
  it('keeps custom keys, fills missing actions and pins tile selection to 1–9', () => {
    const settings = normaliseSettings({ keys: { deny: { enabled: false, key: 'Ctrl+D' }, selectTile: { enabled: true, key: 'X' } } });
    expect(settings.keys.deny).toEqual({ enabled: false, key: 'Ctrl+D' });
    expect(settings.keys.selectTile).toEqual({ enabled: true, key: '1-9' });
    expect(settings.keys.fullscreen).toEqual(DEFAULT_SETTINGS.keys.fullscreen);
  });
});

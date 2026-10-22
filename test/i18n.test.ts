import { describe, expect, it } from 'vitest';
import { LOCALES, resolveLocale, translate, translator } from '../src/core/i18n';
import { en } from '../src/core/i18n/en';
import { activityText, durationText, stateText } from '../src/core/i18n/view';

/** Dot paths of every message (plural objects count as one message). */
function keys(node: unknown, prefix = ''): string[] {
  if (typeof node === 'string' || (node && typeof node === 'object' && 'other' in node)) return [prefix.slice(0, -1)];
  return Object.entries(node as Record<string, unknown>).flatMap(([k, v]) => keys(v, `${prefix}${k}.`));
}

describe('i18n', () => {
  it('fills placeholders and keeps unknown ones visible', () => {
    expect(translate('en', 'toast.ready', { name: 'Demo' })).toBe('Demo · ready');
    expect(translate('en', 'toast.ready')).toBe('{name} · ready');
  });

  it('picks the plural form from count', () => {
    expect(translate('en', 'toast.moreQuestions', { text: 'Q', count: 1 })).toBe('Q (+1 more)');
  });

  it('resolves the system language by its primary subtag and falls back to English', () => {
    expect(resolveLocale('en', ['de-DE'])).toBe('en');
    expect(resolveLocale('system', ['en-GB'])).toBe('en');
    expect(resolveLocale('system', ['xx-YY'])).toBe('en');
    expect(resolveLocale('system', [])).toBe('en');
  });

  it('gives every locale exactly the English keys', () => {
    const english = keys(en).sort();
    for (const [name, messages] of Object.entries(LOCALES)) expect(keys(messages).sort(), name).toEqual(english);
  });

  it('keeps the placeholders of the English message in every locale', () => {
    const placeholders = (text: string): string[] => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!).sort();
    for (const [name, messages] of Object.entries(LOCALES)) {
      for (const key of keys(en)) {
        const t = (root: unknown): string =>
          JSON.stringify(key.split('.').reduce((node, part) => (node as Record<string, unknown>)[part], root));
        expect(placeholders(t(messages)), `${name} ${key}`).toEqual(placeholders(t(en)));
      }
    }
  });

  it('turns core states, activities and durations into text', () => {
    const t = translator('en');
    expect(stateText('planReady', t)).toBe('plan ready');
    expect(activityText({ kind: 'failed', text: 'Grep: x' }, t)).toBe('Grep: x failed');
    expect(activityText({ kind: 'text', text: 'Bash: ls' }, t)).toBe('Bash: ls');
    expect(activityText(null, t)).toBeNull();
    expect(durationText(45_000, t)).toBe('45s');
    expect(durationText(125 * 60_000, t)).toBe('2h 5m');
    expect(durationText(28 * 3_600_000, t)).toBe('1d 4h');
  });
});

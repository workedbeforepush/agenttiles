import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({}));
const { DEFAULT_SETTINGS, normaliseSettings } = await import('../src/main/config');

describe('settings normalisation', () => {
  it('fills sound cues per state and keeps valid values', () => {
    const settings = normaliseSettings({ sounds: { done: false, error: 'yes' }, tileSize: 'L' });
    expect(settings.sounds).toEqual({ needsApproval: true, needsInput: true, done: false, error: true, limitHit: true, contextFull: true });
    expect(settings.tileSize).toBe('L');
  });

  it('falls back to defaults for unknown or broken values', () => {
    expect(normaliseSettings({ sounds: 'loud', tileSize: 'XL', theme: 'neon' })).toEqual(DEFAULT_SETTINGS);
  });
});

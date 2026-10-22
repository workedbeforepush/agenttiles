import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({}));
const { ConfigStore, DEFAULT_SETTINGS, normaliseSettings } = await import('../src/main/config');

describe('settings normalisation', () => {
  it('fills sound cues per state and keeps valid values', () => {
    const settings = normaliseSettings({ sounds: { done: false, error: 'yes' }, tileSize: 'L' });
    expect(settings.sounds).toEqual({ needsApproval: true, needsInput: true, done: false, error: true, limitHit: true, contextFull: true });
    expect(settings.tileSize).toBe('L');
  });

  it('falls back to defaults for unknown or broken values', () => {
    expect(normaliseSettings({ sounds: 'loud', tileSize: 'XL', theme: 'neon', language: 'xx' })).toEqual(DEFAULT_SETTINGS);
  });
});

describe('config store', () => {
  it('remembers the version an update toast announced across restarts', () => {
    const dir = mkdtempSync(join(tmpdir(), 'agenttiles-config-'));
    try {
      const store = new ConfigStore(dir);
      expect(store.config.updateAnnounced).toBeNull();
      store.save();
      expect(new ConfigStore(dir).config.updateAnnounced).toBeNull();
      store.config.updateAnnounced = '0.3.0';
      store.save();
      expect(new ConfigStore(dir).config.updateAnnounced).toBe('0.3.0');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

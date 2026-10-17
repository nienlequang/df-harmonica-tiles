import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Settings } from './settings';
import { useToasts } from './toast';
import {
  DEFAULT_SETTINGS,
  SETTINGS_STORAGE_KEY,
  SETTINGS_VERSION,
  getSettings,
  migrateSettings,
  pickSettings,
  sanitizeSettings,
  useSettings,
} from './settings';

const SETTING_KEYS = Object.keys(DEFAULT_SETTINGS).sort();

function stored(): { state: Record<string, unknown>; version: number } | null {
  const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
  return raw ? (JSON.parse(raw) as { state: Record<string, unknown>; version: number }) : null;
}

beforeEach(() => {
  useSettings.getState().reset();
  localStorage.clear();
});

describe('defaults', () => {
  it('has the documented defaults', () => {
    expect(DEFAULT_SETTINGS).toEqual({
      theme: 'dark',
      language: 'vi',
      tileScale: 1,
      subLabel: 'none',
      audioEnabled: false,
      clickSound: false,
      timbre: 'harmonica',
      musicVolume: 0.8,
      clickVolume: 0.6,
      baseOctave: 4,
      lookahead: 6,
      countIn: true,
      metronome: false,
      startDelaySec: 3,
      practiceMode: 'score',
      practiceFeedback: false,
      midiEnabled: false,
      midiInputId: null,
      midiTransposeSemitones: 0,
      midiTransposeOctaves: 0,
      midiPitchClassOnly: false,
      controlScheme: 'pc',
      mobileSemitone: 'toggle',
      labelOverrides: { left: '', right: '', natural: '', scroll: '' },
    });
    expect(SETTINGS_VERSION).toBe(5);
  });

  it('store starts at defaults and getSettings returns plain data', () => {
    const s = getSettings();
    expect(s).toEqual(DEFAULT_SETTINGS);
    expect(Object.keys(s).sort()).toEqual(SETTING_KEYS);
  });

  it('sanitize is idempotent on defaults', () => {
    expect(sanitizeSettings(DEFAULT_SETTINGS)).toEqual(DEFAULT_SETTINGS);
  });

  it.each([undefined, null, 'x', 42, true, []])('non-object input %j → defaults', (raw) => {
    expect(sanitizeSettings(raw)).toEqual(DEFAULT_SETTINGS);
  });
});

describe('sanitizeSettings', () => {
  it('clamps numbers into range', () => {
    expect(sanitizeSettings({ tileScale: 9 }).tileScale).toBe(1.5);
    expect(sanitizeSettings({ tileScale: 0.1 }).tileScale).toBe(0.75);
    expect(sanitizeSettings({ lookahead: 2 }).lookahead).toBe(4);
    expect(sanitizeSettings({ lookahead: 99 }).lookahead).toBe(12);
    expect(sanitizeSettings({ musicVolume: -1 }).musicVolume).toBe(0);
    expect(sanitizeSettings({ clickVolume: 3 }).clickVolume).toBe(1);
    expect(sanitizeSettings({ baseOctave: 1 }).baseOctave).toBe(2);
    expect(sanitizeSettings({ baseOctave: 10 }).baseOctave).toBe(6);
  });

  it('rounds integer settings', () => {
    expect(sanitizeSettings({ baseOctave: 4.6 }).baseOctave).toBe(5);
    expect(sanitizeSettings({ baseOctave: 3.2 }).baseOctave).toBe(3);
    expect(sanitizeSettings({ lookahead: 7.4 }).lookahead).toBe(7);
  });

  it('rejects non-finite / wrong-typed numbers', () => {
    const s = sanitizeSettings({
      tileScale: Number.NaN,
      lookahead: Number.POSITIVE_INFINITY,
      musicVolume: '0.5',
      baseOctave: null,
    });
    expect(s.tileScale).toBe(DEFAULT_SETTINGS.tileScale);
    expect(s.lookahead).toBe(DEFAULT_SETTINGS.lookahead);
    expect(s.musicVolume).toBe(DEFAULT_SETTINGS.musicVolume);
    expect(s.baseOctave).toBe(DEFAULT_SETTINGS.baseOctave);
  });

  it('rejects values outside the enums', () => {
    expect(sanitizeSettings({ theme: 'neon' }).theme).toBe('dark');
    expect(sanitizeSettings({ language: 'fr' }).language).toBe('vi');
    expect(sanitizeSettings({ subLabel: 'roman' }).subLabel).toBe('none');
    expect(sanitizeSettings({ subLabel: 'solfege' }).subLabel).toBe('solfege');
    expect(sanitizeSettings({ timbre: 'piano' }).timbre).toBe('harmonica');
  });

  it('rejects non-boolean flags', () => {
    const s = sanitizeSettings({ audioEnabled: 0, countIn: null, metronome: 1 });
    // mặc định v3: âm thanh tắt
    expect(s.audioEnabled).toBe(false);
    expect(s.countIn).toBe(true);
    expect(s.metronome).toBe(false);
  });

  it('keeps valid values and drops unknown fields', () => {
    const valid: Settings = {
      theme: 'light',
      language: 'en',
      tileScale: 1.25,
      subLabel: 'number',
      audioEnabled: false,
      clickSound: true,
      timbre: 'sine',
      musicVolume: 0.3,
      clickVolume: 0,
      baseOctave: 3,
      lookahead: 12,
      countIn: false,
      metronome: true,
      startDelaySec: 5,
      practiceMode: 'wait',
      practiceFeedback: true,
      midiEnabled: true,
      midiInputId: 'input-1',
      midiTransposeSemitones: -2,
      midiTransposeOctaves: 1,
      midiPitchClassOnly: true,
      controlScheme: 'mobile',
      mobileSemitone: 'oneShot',
      labelOverrides: { left: 'Hạ', right: 'Lên', natural: 'Thường', scroll: '#' },
    };
    const s = sanitizeSettings({ ...valid, extra: 'x', set: () => undefined });
    expect(s).toEqual(valid);
    expect(Object.keys(s).sort()).toEqual(SETTING_KEYS);
  });
});

describe('migrateSettings', () => {
  it('migrates a version-0 legacy object with missing / garbage fields', () => {
    const legacy = {
      theme: 'light',
      language: 'en',
      tileScale: '1.2', // chuỗi → mặc định
      musicVolume: 0.35,
      clickVolume: 7, // → clamp 1
      baseOctave: 4.6, // → 5
      scrollDir: -1, // trường đã bỏ (v4) → loại
      lookahead: 2, // → 4
      showLyrics: false, // trường đã bỏ (v4) → loại
      timbre: 'kazoo', // → mặc định
      // thiếu: subLabel, audioEnabled, countIn, metronome
      legacyField: { nested: true },
    };
    const s = migrateSettings(legacy, 0);
    expect(s).toEqual({
      ...DEFAULT_SETTINGS,
      theme: 'light',
      language: 'en',
      musicVolume: 0.35,
      clickVolume: 1,
      baseOctave: 5,
      lookahead: 4,
    });
    expect(Object.keys(s).sort()).toEqual(SETTING_KEYS);
  });

  it('handles empty / broken persisted state', () => {
    expect(migrateSettings(undefined, 0)).toEqual(DEFAULT_SETTINGS);
    expect(migrateSettings(null, 0)).toEqual(DEFAULT_SETTINGS);
    expect(migrateSettings('garbage', 0)).toEqual(DEFAULT_SETTINGS);
  });

  it('accepts data from a newer version (downgrade) by sanitizing', () => {
    const s = migrateSettings({ theme: 'light', futureOption: 1 }, SETTINGS_VERSION + 1);
    expect(s).toEqual({ ...DEFAULT_SETTINGS, theme: 'light' });
  });
});

describe('store + persistence', () => {
  it('set() merges and sanitizes patches', () => {
    useSettings.getState().set({ theme: 'light', tileScale: 9, lookahead: 2 });
    const s = getSettings();
    expect(s.theme).toBe('light');
    expect(s.tileScale).toBe(1.5);
    expect(s.lookahead).toBe(4);
    expect(s.language).toBe('vi');
  });

  it('writes only settings data with the current version', () => {
    useSettings.getState().set({ theme: 'light', baseOctave: 3 });
    const blob = stored();
    expect(blob?.version).toBe(SETTINGS_VERSION);
    expect(Object.keys(blob?.state ?? {}).sort()).toEqual(SETTING_KEYS);
    expect(blob?.state.theme).toBe('light');
    expect(blob?.state.baseOctave).toBe(3);
  });

  it('round-trips through localStorage via rehydrate()', async () => {
    useSettings
      .getState()
      .set({ theme: 'light', language: 'en', tileScale: 1.25, startDelaySec: 0 });
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    expect(raw).not.toBeNull();

    useSettings.getState().reset();
    expect(getSettings()).toEqual(DEFAULT_SETTINGS);

    localStorage.setItem(SETTINGS_STORAGE_KEY, raw ?? '');
    await useSettings.persist.rehydrate();
    expect(getSettings()).toEqual({
      ...DEFAULT_SETTINGS,
      theme: 'light',
      language: 'en',
      tileScale: 1.25,
      startDelaySec: 0,
    });
    // action vẫn còn sau merge
    expect(typeof useSettings.getState().set).toBe('function');
    expect(typeof useSettings.getState().reset).toBe('function');
  });

  it('rehydrate migrates a version-0 blob and rewrites it at the current version', async () => {
    localStorage.setItem(
      SETTINGS_STORAGE_KEY,
      JSON.stringify({ state: { theme: 'light', tileScale: 9, language: 'xx' }, version: 0 }),
    );
    await useSettings.persist.rehydrate();
    expect(getSettings()).toEqual({ ...DEFAULT_SETTINGS, theme: 'light', tileScale: 1.5 });
    const blob = stored();
    expect(blob?.version).toBe(SETTINGS_VERSION);
    expect(blob?.state.tileScale).toBe(1.5);
    expect(blob?.state.language).toBe('vi');
  });

  it('rehydrate sanitizes a current-version blob edited by hand', async () => {
    localStorage.setItem(
      SETTINGS_STORAGE_KEY,
      JSON.stringify({
        state: { theme: 'neon', lookahead: 2, baseOctave: 4.6, subLabel: 'roman' },
        version: SETTINGS_VERSION,
      }),
    );
    await useSettings.persist.rehydrate();
    const s = getSettings();
    expect(s.theme).toBe('dark');
    expect(s.lookahead).toBe(4);
    expect(s.baseOctave).toBe(5);
    expect(s.subLabel).toBe('none');
  });

  it('corrupt JSON in storage does not throw and keeps the current values', async () => {
    useSettings.getState().set({ theme: 'light' });
    localStorage.setItem(SETTINGS_STORAGE_KEY, '{not json');
    await expect(useSettings.persist.rehydrate()).resolves.toBeUndefined();
    expect(getSettings().theme).toBe('light');
  });

  it('reset() restores defaults and persists them', () => {
    useSettings.getState().set({
      theme: 'light',
      language: 'en',
      audioEnabled: false,
      musicVolume: 0.1,
      lookahead: 5,
      metronome: true,
    });
    useSettings.getState().reset();
    expect(getSettings()).toEqual(DEFAULT_SETTINGS);
    expect(stored()?.state).toEqual({ ...DEFAULT_SETTINGS });
  });

  it('pickSettings strips store actions', () => {
    const picked = pickSettings(useSettings.getState());
    expect(Object.keys(picked).sort()).toEqual(SETTING_KEYS);
  });

  it('storage full (quota): set() does not throw, applies in memory, shows one toast', () => {
    useToasts.setState({ toasts: [] });
    useSettings.getState().set({ language: 'en' });
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('exceeded the quota', 'QuotaExceededError');
    });
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(() => useSettings.getState().set({ theme: 'light' })).not.toThrow();
    expect(() => useSettings.getState().set({ tileScale: 1.2 })).not.toThrow();
    expect(getSettings().theme).toBe('light');
    expect(getSettings().tileScale).toBe(1.2);
    expect(setItem).toHaveBeenCalled();
    const errors = useToasts.getState().toasts.filter((t) => t.kind === 'error');
    expect(errors.map((t) => t.text)).toEqual([
      'Could not save settings (browser storage full or blocked) — changes last until the page is reloaded',
    ]);
  });
});

describe('settings v2 (practice + MIDI)', () => {
  it('migrates a v1 blob: keeps old fields, fills new ones with defaults', () => {
    const v1 = { theme: 'light', lookahead: 10, countIn: false, metronome: true };
    const s = migrateSettings(v1, 1);
    expect(s.theme).toBe('light');
    expect(s.lookahead).toBe(10);
    expect(s.countIn).toBe(false);
    expect(s.practiceMode).toBe('score');
    expect(s.midiEnabled).toBe(false);
    expect(s.midiInputId).toBeNull();
    // v4: đếm ngược mặc định 3 giây
    expect(s.startDelaySec).toBe(3);
  });

  it('sanitizes practice mode and MIDI fields', () => {
    const s = sanitizeSettings({
      practiceMode: 'nope',
      midiInputId: '',
      midiTransposeSemitones: 30,
      midiTransposeOctaves: -2.6,
      startDelaySec: 99,
    });
    expect(s.practiceMode).toBe('score');
    expect(s.midiInputId).toBeNull();
    expect(s.midiTransposeSemitones).toBe(11);
    expect(s.midiTransposeOctaves).toBe(-3);
    expect(s.startDelaySec).toBe(10);
  });
});

describe('settings v3 (control scheme, labels, audio off by default)', () => {
  it('v2 → v3 forces sound off once and adds the new fields', () => {
    const v2 = { audioEnabled: true, metronome: true, theme: 'light', practiceMode: 'wait' };
    const s = migrateSettings(v2, 2);
    expect(s.audioEnabled).toBe(false);
    expect(s.clickSound).toBe(false);
    expect(s.metronome).toBe(true);
    expect(s.theme).toBe('light');
    expect(s.practiceMode).toBe('wait');
    expect(s.controlScheme).toBe('pc');
    expect(s.labelOverrides).toEqual({ left: '', right: '', natural: '', scroll: '' });
  });

  it('v2 → v3 also turns practice feedback off (v2 audioEnabled was the master switch for it)', () => {
    // v2: audio off + feedback on = im lặng (previewMidi thoát sớm khi !audioEnabled); v3 tách feedback ra
    // khỏi audioEnabled nên phải tắt luôn để config im ở v2 vẫn im sau migrate.
    const silentV2 = { audioEnabled: false, practiceFeedback: true, practiceMode: 'wait' };
    expect(migrateSettings(silentV2, 2).practiceFeedback).toBe(false);
    const loudV2 = { audioEnabled: true, practiceFeedback: true };
    expect(migrateSettings(loudV2, 2).practiceFeedback).toBe(false);
    expect(migrateSettings({ practiceFeedback: true }, 1).practiceFeedback).toBe(false);
  });

  it('a v3 blob keeps an explicitly enabled sound', () => {
    const s = migrateSettings({ audioEnabled: true, clickSound: true, practiceFeedback: true }, 3);
    expect(s.audioEnabled).toBe(true);
    expect(s.clickSound).toBe(true);
    expect(s.practiceFeedback).toBe(true);
  });

  it('sanitizes control scheme and label overrides', () => {
    const s = sanitizeSettings({
      controlScheme: 'console',
      mobileSemitone: 'hold',
      labelOverrides: { left: '  Hạ\nquãng ', right: 42, natural: 'x'.repeat(40) },
    });
    expect(s.controlScheme).toBe('pc');
    expect(s.mobileSemitone).toBe('toggle');
    expect(s.labelOverrides.left).toBe('Hạ quãng');
    expect(s.labelOverrides.right).toBe('');
    expect(s.labelOverrides.natural).toHaveLength(24);
    expect(s.labelOverrides.scroll).toBe('');
  });
});

describe('settings v4 (góp ý 2026-10-15: no lyrics, Nửa Cung fixed sharp, mouse-only practice)', () => {
  it('defaults: 3-second countdown, sub-label hidden, removed fields gone', () => {
    expect(DEFAULT_SETTINGS.startDelaySec).toBe(3);
    expect(DEFAULT_SETTINGS.subLabel).toBe('none');
    for (const k of ['showLyrics', 'scrollDir', 'practiceKeys']) {
      expect(DEFAULT_SETTINGS).not.toHaveProperty(k);
    }
  });

  it('v3 → v4 drops showLyrics / scrollDir / practiceKeys, 0 s countdown → 3 s, sub-label → none', () => {
    const v3 = {
      theme: 'light',
      showLyrics: false,
      scrollDir: -1,
      practiceKeys: { left: 'KeyQ', right: 'Alt', scroll: 'Shift' },
      startDelaySec: 0,
      subLabel: 'solfege',
      lookahead: 10,
    };
    const s = migrateSettings(v3, 3);
    expect(s).toEqual({ ...DEFAULT_SETTINGS, theme: 'light', lookahead: 10 });
    expect(Object.keys(s).sort()).toEqual(SETTING_KEYS);
    for (const k of ['showLyrics', 'scrollDir', 'practiceKeys']) expect(s).not.toHaveProperty(k);
  });

  it('v3 → v4 keeps a non-zero countdown the owner picked', () => {
    expect(migrateSettings({ startDelaySec: 5, subLabel: 'number' }, 3)).toMatchObject({
      startDelaySec: 5,
      subLabel: 'none',
    });
  });

  it('a v4 blob keeps 0 s countdown and a visible sub-label (explicit choices after v4)', () => {
    const s = migrateSettings({ startDelaySec: 0, subLabel: 'solfege' }, 4);
    expect(s.startDelaySec).toBe(0);
    expect(s.subLabel).toBe('solfege');
  });

  it('rehydrate migrates a v3 blob and rewrites it at the current version without the removed keys', async () => {
    localStorage.setItem(
      SETTINGS_STORAGE_KEY,
      JSON.stringify({
        state: { scrollDir: -1, showLyrics: false, practiceKeys: {}, startDelaySec: 0 },
        version: 3,
      }),
    );
    await useSettings.persist.rehydrate();
    expect(getSettings()).toEqual(DEFAULT_SETTINGS);
    const blob = stored();
    expect(blob?.version).toBe(SETTINGS_VERSION);
    expect(Object.keys(blob?.state ?? {}).sort()).toEqual(SETTING_KEYS);
    expect(blob?.state.startDelaySec).toBe(3);
  });
});

describe('settings v5 (góp ý 2026-10-16: lookahead 6 beats by default)', () => {
  it('default lookahead is 6 beats', () => {
    expect(DEFAULT_SETTINGS.lookahead).toBe(6);
    expect(sanitizeSettings({}).lookahead).toBe(6);
  });

  it('v4 → v5: the old default 8 becomes 6, other picks are kept, everything else untouched', () => {
    const v4 = { theme: 'light', lookahead: 8, startDelaySec: 0, subLabel: 'solfege' };
    expect(migrateSettings(v4, 4)).toEqual({
      ...DEFAULT_SETTINGS,
      theme: 'light',
      lookahead: 6,
      startDelaySec: 0,
      subLabel: 'solfege',
    });
    for (const n of [4, 5, 7, 10, 12]) {
      expect(migrateSettings({ lookahead: n }, 4).lookahead).toBe(n);
    }
    // Không có lookahead (blob thiếu trường) → mặc định mới.
    expect(migrateSettings({ theme: 'light' }, 4).lookahead).toBe(6);
  });

  it('older blobs (v0..v3) with 8 also land on 6', () => {
    for (const v of [0, 1, 2, 3]) expect(migrateSettings({ lookahead: 8 }, v).lookahead).toBe(6);
  });

  it('a v5 blob keeps an explicit 8 (picked on the player transport bar after v5)', () => {
    expect(migrateSettings({ lookahead: 8 }, 5).lookahead).toBe(8);
  });

  it('rehydrate migrates a v4 blob with lookahead 8 and rewrites it at v5 with 6', async () => {
    localStorage.setItem(
      SETTINGS_STORAGE_KEY,
      JSON.stringify({ state: { lookahead: 8, theme: 'light' }, version: 4 }),
    );
    await useSettings.persist.rehydrate();
    expect(getSettings().lookahead).toBe(6);
    expect(getSettings().theme).toBe('light');
    const blob = stored();
    expect(blob?.version).toBe(5);
    expect(blob?.state.lookahead).toBe(6);
  });
});

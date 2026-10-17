import { describe, expect, it } from 'vitest';
import { noteMidi } from '../core/keys';
import { DEFAULT_SETTINGS } from '../ui/settings';
import { mapMidiNote, midiMapOptionsFromSettings, modifierCount, transposeMidi } from './mapping';
import type { MidiMapOptions } from './mapping';

const base: MidiMapOptions = {
  baseOctave: 4,
  scrollDir: 1,
  transposeSemitones: 0,
  transposeOctaves: 0,
};
const opts = (o: Partial<MidiMapOptions>): MidiMapOptions => ({ ...base, ...o });

describe('transposeMidi', () => {
  it('adds semitones and 12 × octaves', () => {
    expect(transposeMidi(60, { transposeSemitones: 0, transposeOctaves: 0 })).toBe(60);
    expect(transposeMidi(60, { transposeSemitones: 3, transposeOctaves: 0 })).toBe(63);
    expect(transposeMidi(60, { transposeSemitones: -2, transposeOctaves: 1 })).toBe(70);
    expect(transposeMidi(36, { transposeSemitones: 0, transposeOctaves: 2 })).toBe(60);
    expect(transposeMidi(80, { transposeSemitones: 11, transposeOctaves: -3 })).toBe(55);
  });
});

describe('mapMidiNote', () => {
  it('maps the natural notes of the normal octave without modifiers', () => {
    expect(mapMidiNote(60, base)).toEqual({ key: 'Z', octave: 0, sharp: false });
    expect(mapMidiNote(62, base)).toEqual({ key: 'X', octave: 0, sharp: false });
    expect(mapMidiNote(67, base)).toEqual({ key: 'B', octave: 0, sharp: false });
    expect(mapMidiNote(71, base)).toEqual({ key: 'M', octave: 0, sharp: false });
  });

  it('prefers the choice with fewest modifiers (C5 = "," not Z + right)', () => {
    expect(mapMidiNote(72, base)).toEqual({ key: ',', octave: 0, sharp: false });
    // C#5: , + scroll (1 modifier) thắng Z + phải + scroll (2)
    expect(mapMidiNote(73, base)).toEqual({ key: ',', octave: 0, sharp: true });
  });

  it('uses left / right / scroll modifiers at the range edges', () => {
    expect(mapMidiNote(48, base)).toEqual({ key: 'Z', octave: -1, sharp: false });
    expect(mapMidiNote(84, base)).toEqual({ key: ',', octave: 1, sharp: false });
    expect(mapMidiNote(83, base)).toEqual({ key: 'M', octave: 1, sharp: false });
    expect(mapMidiNote(49, base)).toEqual({ key: 'Z', octave: -1, sharp: true });
  });

  it('sharp follows scrollDir (+1 vs -1)', () => {
    expect(mapMidiNote(61, base)).toEqual({ key: 'Z', octave: 0, sharp: true });
    expect(mapMidiNote(61, opts({ scrollDir: -1 }))).toEqual({ key: 'X', octave: 0, sharp: true });
    expect(mapMidiNote(70, opts({ scrollDir: -1 }))).toEqual({ key: 'M', octave: 0, sharp: true });
    // scrollDir -1: B2 (47) vẫn ngoài tầm C3..C6 dù bấm được Z-1 + scroll
    expect(mapMidiNote(47, opts({ scrollDir: -1 }))).toBeNull();
  });

  it('applies transpose offsets before mapping', () => {
    // keyboard 49 phím: C2 + 2 quãng = C4
    expect(mapMidiNote(36, opts({ transposeOctaves: 2 }))).toEqual({
      key: 'Z',
      octave: 0,
      sharp: false,
    });
    // bài cung Db: lùi 1 bán cung để Db → C
    expect(mapMidiNote(61, opts({ transposeSemitones: -1 }))).toEqual({
      key: 'Z',
      octave: 0,
      sharp: false,
    });
    // kết hợp: 49 - 1 + 12 = 60
    expect(mapMidiNote(49, opts({ transposeSemitones: -1, transposeOctaves: 1 }))).toEqual({
      key: 'Z',
      octave: 0,
      sharp: false,
    });
    // offset đẩy ra ngoài tầm
    expect(mapMidiNote(80, opts({ transposeOctaves: 1 }))).toBeNull();
  });

  it('returns null outside the playable range C3..C6', () => {
    expect(mapMidiNote(47, base)).toBeNull();
    expect(mapMidiNote(85, base)).toBeNull();
    expect(mapMidiNote(0, base)).toBeNull();
    expect(mapMidiNote(127, base)).toBeNull();
    // offset kéo nốt ngoài tầm vào trong
    expect(mapMidiNote(96, opts({ transposeOctaves: -2 }))).toEqual({
      key: ',',
      octave: 0,
      sharp: false,
    });
  });

  it('follows baseOctave', () => {
    const o3 = opts({ baseOctave: 3 });
    expect(mapMidiNote(48, o3)).toEqual({ key: 'Z', octave: 0, sharp: false });
    expect(mapMidiNote(36, o3)).toEqual({ key: 'Z', octave: -1, sharp: false });
    expect(mapMidiNote(72, o3)).toEqual({ key: ',', octave: 1, sharp: false });
    expect(mapMidiNote(73, o3)).toBeNull();
    expect(mapMidiNote(35, o3)).toBeNull();
  });

  it('rejects non-integer or non-finite pitches', () => {
    expect(mapMidiNote(60.5, base)).toBeNull();
    expect(mapMidiNote(Number.NaN, base)).toBeNull();
    expect(mapMidiNote(Number.POSITIVE_INFINITY, base)).toBeNull();
  });

  it('every in-range pitch maps back to itself with minimal modifiers', () => {
    for (const scrollDir of [1, -1] as const) {
      for (let midi = 48; midi <= 84; midi++) {
        const c = mapMidiNote(midi, opts({ scrollDir }));
        expect(c).not.toBeNull();
        if (!c) continue;
        expect(noteMidi(c.key, c.octave, c.sharp, 4, scrollDir)).toBe(midi);
        // trong quãng thường (C4..C5) không bao giờ cần giữ chuột
        if (midi >= 60 && midi <= 72) expect(c.octave).toBe(0);
        expect(modifierCount(c)).toBeLessThanOrEqual(2);
      }
    }
  });
});

describe('midiMapOptionsFromSettings', () => {
  it('reads base octave and MIDI transpose from settings; Nửa Cung is always sharp (+1)', () => {
    expect(midiMapOptionsFromSettings(DEFAULT_SETTINGS)).toEqual(base);
    expect(
      midiMapOptionsFromSettings({
        ...DEFAULT_SETTINGS,
        baseOctave: 3,
        midiTransposeSemitones: 2,
        midiTransposeOctaves: -1,
      }),
    ).toEqual({ baseOctave: 3, scrollDir: 1, transposeSemitones: 2, transposeOctaves: -1 });
  });
});

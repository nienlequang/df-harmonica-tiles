import { describe, expect, it } from 'vitest';
import type { MelodyCandidate } from './melodySuggest';
import {
  MELODY_DENSITY_BAND,
  densityInBand,
  melodyCost,
  melodyNameHint,
  monophonicRatio,
  notesPerBeat,
  notesPerMinute,
  pickMelody,
} from './melodySuggest';

const cand = (over: Partial<MelodyCandidate> = {}): MelodyCandidate => ({
  noteCount: 100,
  notesPerBeat: 1,
  monophonicRatio: 1,
  avgMidi: 70,
  name: '',
  ...over,
});

describe('notesPerBeat / notesPerMinute', () => {
  it('density = notes / span in beats; ≡ notes per minute ÷ BPM', () => {
    expect(notesPerBeat(64, 64)).toBe(1);
    expect(notesPerBeat(32, 64)).toBe(0.5);
    // 128 nốt trong 64 beat ở 90 BPM = 180 nốt/phút = 2 × BPM
    expect(notesPerMinute(notesPerBeat(128, 64), 90)).toBe(180);
    expect(notesPerMinute(0.987, 120)).toBe(118);
  });

  it('no notes → 0; span under one beat (or invalid) counts as one beat', () => {
    expect(notesPerBeat(0, 10)).toBe(0);
    expect(notesPerBeat(3, 0)).toBe(3);
    expect(notesPerBeat(3, 0.25)).toBe(3);
    expect(notesPerBeat(3, Number.NaN)).toBe(3);
  });

  it('band 0.4–2.5 is symmetric in log2', () => {
    expect(MELODY_DENSITY_BAND.min * MELODY_DENSITY_BAND.max).toBeCloseTo(1);
    expect(densityInBand(1)).toBe(true);
    expect(densityInBand(0.4)).toBe(true);
    expect(densityInBand(2.5)).toBe(true);
    expect(densityInBand(0.3)).toBe(false);
    expect(densityInBand(3)).toBe(false);
  });
});

describe('melodyNameHint', () => {
  it.each([
    'Melody',
    'Main Melody',
    'Lead Vocal',
    'vocals',
    'Voice',
    'Solo Flute',
    'Singer',
    'Giai điệu',
    'giai dieu chinh',
    'Giọng hát',
    '主旋律',
    '人声',
    'ボーカル',
    '멜로디',
  ])('"%s" → melody', (name) => {
    expect(melodyNameHint(name)).toBe(1);
  });

  it.each([
    'Bass',
    'Chords',
    'Piano (chord)',
    'Pad',
    'Strings Pad',
    'Đệm',
    'Hợp âm',
    '伴奏',
    '贝斯',
  ])('"%s" → accompaniment', (name) => {
    expect(melodyNameHint(name)).toBe(-1);
  });

  it.each(['', '   ', 'Track 3', 'Piano', 'Flute', 'Harmonica', 'Melodeon?'])(
    '"%s" → 0',
    (name) => {
      expect(melodyNameHint(name)).toBe(0);
    },
  );

  it('melody words win over accompaniment words in the same name', () => {
    expect(melodyNameHint('Lead (over chords)')).toBe(1);
  });
});

describe('melodyCost', () => {
  it('excludes drums, empty tracks and zero density', () => {
    expect(melodyCost(cand({ isDrum: true }))).toBe(Infinity);
    expect(melodyCost(cand({ noteCount: 0 }))).toBe(Infinity);
    expect(melodyCost(cand({ notesPerBeat: 0 }))).toBe(Infinity);
  });

  it('is lowest around 1 note per beat and grows symmetrically in log2', () => {
    const at = (d: number) => melodyCost(cand({ notesPerBeat: d }));
    expect(at(1)).toBeLessThan(at(1.5));
    expect(at(1)).toBeLessThan(at(0.7));
    expect(at(2)).toBeCloseTo(at(0.5));
    expect(at(4)).toBeCloseTo(at(0.25));
    // ngoài dải phạt dốc hơn: bước 2 → 4 tốn hơn bước 1 → 2
    expect(at(4) - at(2)).toBeGreaterThan(at(2) - at(1));
  });

  it('penalizes polyphony and bass register, rewards a higher register a little', () => {
    const base = melodyCost(cand());
    expect(melodyCost(cand({ monophonicRatio: 0.2 }))).toBeGreaterThan(base + 2);
    expect(melodyCost(cand({ avgMidi: 40 }))).toBeGreaterThan(base + 2);
    expect(melodyCost(cand({ avgMidi: 76 }))).toBeLessThan(base);
    expect(base - melodyCost(cand({ avgMidi: 84 }))).toBeLessThanOrEqual(0.3);
  });

  it('name hints and sung parts shift the score', () => {
    const base = melodyCost(cand());
    expect(melodyCost(cand({ name: 'Vocal' }))).toBeCloseTo(base - 0.75);
    expect(melodyCost(cand({ name: 'Bass' }))).toBeCloseTo(base + 0.5);
    expect(melodyCost(cand({ sung: true }))).toBeCloseTo(base - 1);
  });

  it('tolerates NaN monophonic ratio / pitch', () => {
    expect(Number.isFinite(melodyCost(cand({ monophonicRatio: Number.NaN })))).toBe(true);
    expect(Number.isFinite(melodyCost(cand({ avgMidi: Number.NaN })))).toBe(true);
  });
});

describe('pickMelody', () => {
  it('a melody at ~1 note per beat beats a chordal piano with many more notes', () => {
    expect(
      pickMelody([
        // piano đánh hợp âm 4 nốt mỗi phách: nhiều nốt nhất, đa âm
        cand({
          name: 'Piano',
          noteCount: 1024,
          notesPerBeat: 4,
          monophonicRatio: 0.05,
          avgMidi: 62,
        }),
        cand({
          name: 'Flute',
          noteCount: 250,
          notesPerBeat: 0.98,
          monophonicRatio: 1,
          avgMidi: 74,
        }),
      ]),
    ).toBe(1);
  });

  it('a bass line at the same density loses to the melody (register)', () => {
    expect(
      pickMelody([
        cand({ name: 'Track 1', notesPerBeat: 1, avgMidi: 40 }),
        cand({ name: 'Track 2', notesPerBeat: 1.1, avgMidi: 71 }),
      ]),
    ).toBe(1);
  });

  it('a sparse pad (one long note every two bars) is not the melody', () => {
    expect(
      pickMelody([
        cand({ name: 'Pad', noteCount: 16, notesPerBeat: 0.125, monophonicRatio: 1, avgMidi: 72 }),
        cand({
          name: 'Track',
          noteCount: 110,
          notesPerBeat: 0.86,
          monophonicRatio: 0.95,
          avgMidi: 67,
        }),
      ]),
    ).toBe(1);
  });

  it('a dense arpeggio (4 notes per beat, monophonic) loses to a 1-note-per-beat line', () => {
    expect(
      pickMelody([
        cand({ name: 'Arp', notesPerBeat: 4, monophonicRatio: 1, avgMidi: 72 }),
        cand({ name: 'Lead', notesPerBeat: 1.2, monophonicRatio: 0.97, avgMidi: 69 }),
      ]),
    ).toBe(1);
  });

  it('two similar lines: the higher one wins; ties keep the first', () => {
    expect(pickMelody([cand({ avgMidi: 64 }), cand({ avgMidi: 72 }), cand({ avgMidi: 72 })])).toBe(
      1,
    );
  });

  it('nothing in band → still the least bad track (sensible fallback)', () => {
    expect(
      pickMelody([
        cand({ notesPerBeat: 6, monophonicRatio: 0.1, avgMidi: 60 }), // hợp âm dày
        cand({ notesPerBeat: 0.15, monophonicRatio: 1, avgMidi: 70 }), // nốt ngân thưa
        cand({ notesPerBeat: 3.2, monophonicRatio: 0.9, avgMidi: 70 }), // gần dải nhất
      ]),
    ).toBe(2);
  });

  it('one track only → that track; only drums / nothing → -1', () => {
    expect(pickMelody([cand({ notesPerBeat: 7, monophonicRatio: 0, avgMidi: 30 })])).toBe(0);
    expect(pickMelody([cand({ isDrum: true }), cand({ isDrum: true })])).toBe(-1);
    expect(pickMelody([])).toBe(-1);
    expect(pickMelody([cand({ noteCount: 0 })])).toBe(-1);
  });
});

describe('monophonicRatio', () => {
  const n = (start: number, dur: number) => ({ start, dur });

  it('a single line is fully monophonic; empty / zero-length → 1', () => {
    expect(monophonicRatio([n(0, 1), n(1, 1), n(2, 2)], 0)).toBe(1);
    expect(monophonicRatio([], 0)).toBe(1);
    expect(monophonicRatio([n(0, 0)], 0)).toBe(1);
  });

  it('block chords are not monophonic', () => {
    const chords = [n(0, 4), n(0, 4), n(0, 4), n(4, 4), n(4, 4), n(4, 4)];
    expect(monophonicRatio(chords, 0)).toBe(0);
  });

  it('legato tails within the tolerance are not overlaps', () => {
    const legato = [n(0, 1.1), n(1, 1.1), n(2, 1)];
    expect(monophonicRatio(legato, 0.125)).toBe(1);
    expect(monophonicRatio(legato, 0)).toBeLessThan(1);
  });

  it('half the time doubled → ratio 0', () => {
    // hai nốt chồng trọn: mọi thời lượng đều bị chồng
    expect(monophonicRatio([n(0, 2), n(0, 2)], 0)).toBe(0);
    // 1 nốt dài + 1 nốt ngắn chồng 1/3 thời lượng tổng
    expect(monophonicRatio([n(0, 2), n(1, 1)], 0)).toBeCloseTo(1 - 2 / 3);
  });
});

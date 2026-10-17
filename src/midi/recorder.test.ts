import { describe, expect, it } from 'vitest';
import { MelodyRecorder, recordingToMonoNotes } from './recorder';
import type { RecordedNote } from './recorder';
import type { LiveMidiEvent } from './types';

const on = (midi: number, t: number, velocity = 100): LiveMidiEvent => ({
  type: 'on',
  midi,
  velocity,
  timeStamp: t,
  inputId: 'kbd',
});
const off = (midi: number, t: number): LiveMidiEvent => ({
  type: 'off',
  midi,
  velocity: 0,
  timeStamp: t,
  inputId: 'kbd',
});

describe('MelodyRecorder', () => {
  it('records note on/off pairs with their timestamps', () => {
    const r = new MelodyRecorder();
    expect(r.recording).toBe(false);
    r.start(1000);
    expect(r.recording).toBe(true);
    expect(r.beatZeroMs).toBe(1000);
    r.handle(on(60, 1000));
    r.handle(off(60, 1400));
    r.handle(on(62, 1500));
    r.handle(off(62, 1900));
    expect(r.notes).toEqual([
      { midi: 60, onMs: 1000, offMs: 1400 },
      { midi: 62, onMs: 1500, offMs: 1900 },
    ]);
    expect(r.stop(2000)).toEqual([
      { midi: 60, onMs: 1000, offMs: 1400 },
      { midi: 62, onMs: 1500, offMs: 1900 },
    ]);
    expect(r.recording).toBe(false);
  });

  it('ignores events while not recording and stray note offs', () => {
    const r = new MelodyRecorder();
    r.handle(on(60, 0));
    r.handle(off(60, 100));
    r.start(500);
    r.handle(off(64, 600));
    r.handle(on(65, Number.NaN));
    expect(r.stop(1000)).toEqual([]);
    r.handle(on(67, 1100));
    expect(r.notes).toEqual([]);
  });

  it('ends notes still held at stop time, sorted by note on', () => {
    const r = new MelodyRecorder();
    r.start(0);
    r.handle(on(67, 100));
    r.handle(on(60, 50));
    r.handle(on(64, 300));
    r.handle(off(64, 400));
    expect(r.stop(900)).toEqual([
      { midi: 60, onMs: 50, offMs: 900 },
      { midi: 67, onMs: 100, offMs: 900 },
      { midi: 64, onMs: 300, offMs: 400 },
    ]);
  });

  it('closes a re-triggered note (on, on without off)', () => {
    const r = new MelodyRecorder();
    r.start(0);
    r.handle(on(60, 0));
    r.handle(on(60, 500));
    r.handle(off(60, 800));
    expect(r.stop(1000)).toEqual([
      { midi: 60, onMs: 0, offMs: 500 },
      { midi: 60, onMs: 500, offMs: 800 },
    ]);
  });

  it('start() clears the previous take', () => {
    const r = new MelodyRecorder();
    r.start(0);
    r.handle(on(60, 0));
    r.stop(100);
    r.start(5000);
    r.handle(on(62, 5000));
    expect(r.stop(5200)).toEqual([{ midi: 62, onMs: 5000, offMs: 5200 }]);
  });
});

describe('recordingToMonoNotes (quantize record)', () => {
  // 120 bpm → 500 ms / beat
  const bpm = 120;
  const startMs = 10_000;
  const at = (beat: number, jitterMs = 0): number => startMs + beat * 500 + jitterMs;

  it('quantizes jittered quarter notes to 1/4 beat', () => {
    const take: RecordedNote[] = [
      { midi: 60, onMs: at(0, 18), offMs: at(0.85, -10) },
      { midi: 62, onMs: at(1, -27), offMs: at(1.9, 12) },
      { midi: 64, onMs: at(2, 31), offMs: at(2.45, 5) },
      { midi: 65, onMs: at(2.5, -22), offMs: at(3.95, 20) },
    ];
    const out = recordingToMonoNotes(take, { bpm, startMs, grid: 0.25, overlap: 'highest' });
    expect(out).toEqual([
      { startBeat: 0, beats: 1, midi: 60 },
      { startBeat: 1, beats: 1, midi: 62 },
      { startBeat: 2, beats: 0.5, midi: 64 },
      { startBeat: 2.5, beats: 1.5, midi: 65 },
    ]);
  });

  it('quantizes to 1/8 and to triplets (1/3)', () => {
    const eighths: RecordedNote[] = [
      { midi: 60, onMs: at(0, 9), offMs: at(0.5, -15) },
      { midi: 62, onMs: at(0.5, -12), offMs: at(0.875, 3) },
      { midi: 64, onMs: at(0.875, 14), offMs: at(1.5, -8) },
    ];
    expect(
      recordingToMonoNotes(eighths, { bpm, startMs, grid: 0.125, overlap: 'highest' }),
    ).toEqual([
      { startBeat: 0, beats: 0.5, midi: 60 },
      { startBeat: 0.5, beats: 0.375, midi: 62 },
      { startBeat: 0.875, beats: 0.625, midi: 64 },
    ]);

    const triplets: RecordedNote[] = [0, 1, 2].map((k) => ({
      midi: 60 + 2 * k,
      onMs: at(k / 3, k === 1 ? 15 : -10),
      offMs: at((k + 1) / 3, -25),
    }));
    const out = recordingToMonoNotes(triplets, { bpm, startMs, grid: 1 / 3, overlap: 'highest' });
    expect(out.map((n) => n.midi)).toEqual([60, 62, 64]);
    out.forEach((n, k) => {
      expect(n.startBeat).toBeCloseTo(k / 3, 9);
      expect(n.beats).toBeCloseTo(1 / 3, 9);
    });
  });

  it('keeps a slightly early first note (moved to beat 0), drops count-in noodling', () => {
    const take: RecordedNote[] = [
      { midi: 55, onMs: at(-3), offMs: at(-2.5) }, // trong count-in
      { midi: 57, onMs: at(-1), offMs: at(0.5) }, // bấm quá sớm, kéo vào beat 0 → bỏ
      { midi: 60, onMs: at(0, -80), offMs: at(1, -20) }, // sớm 80 ms (0.16 beat) → giữ
      { midi: 62, onMs: at(1), offMs: at(2) },
    ];
    expect(recordingToMonoNotes(take, { bpm, startMs, grid: 0.25, overlap: 'highest' })).toEqual([
      { startBeat: 0, beats: 1, midi: 60 },
      { startBeat: 1, beats: 1, midi: 62 },
    ]);
    // grid tắt: nốt sớm bị kẹp về 0
    const raw = recordingToMonoNotes(take.slice(2, 3), {
      bpm,
      startMs,
      grid: 0,
      overlap: 'highest',
    });
    expect(raw).toHaveLength(1);
    expect(raw[0].startBeat).toBe(0);
    expect(raw[0].beats).toBeCloseTo(0.96, 9);
  });

  it('treats live legato overlap as the next note even when descending (highest)', () => {
    // nhấn phím mới trước khi nhả phím cũ ~100 ms (0.2 beat)
    const take: RecordedNote[] = [
      { midi: 67, onMs: at(0), offMs: at(1, 100) },
      { midi: 65, onMs: at(1), offMs: at(2, 90) },
      { midi: 64, onMs: at(2), offMs: at(3) },
    ];
    expect(recordingToMonoNotes(take, { bpm, startMs, grid: 0.25, overlap: 'highest' })).toEqual([
      { startBeat: 0, beats: 1, midi: 67 },
      { startBeat: 1, beats: 1, midi: 65 },
      { startBeat: 2, beats: 1, midi: 64 },
    ]);
  });

  it('a chord pressed slightly unevenly keeps one note by policy', () => {
    const chord = (first: number[], gapMs: number): RecordedNote[] =>
      first.map((midi, k) => ({ midi, onMs: at(0, k * gapMs), offMs: at(1) }));
    const opts = { bpm, startMs, grid: 0.25 } as const;
    expect(recordingToMonoNotes(chord([60, 64, 67], 20), { ...opts, overlap: 'highest' })).toEqual([
      { startBeat: 0, beats: 1, midi: 67 },
    ]);
    expect(recordingToMonoNotes(chord([67, 64, 60], 20), { ...opts, overlap: 'highest' })).toEqual([
      { startBeat: 0, beats: 1, midi: 67 },
    ]);
    expect(recordingToMonoNotes(chord([67, 64, 60], 20), { ...opts, overlap: 'lowest' })).toEqual([
      { startBeat: 0, beats: 1, midi: 60 },
    ]);
    // grid tắt: nốt bị cắt còn 20 ms (< 40 ms) bị bỏ
    expect(
      recordingToMonoNotes(chord([60, 67], 20), { ...opts, grid: 0, overlap: 'highest' }).map(
        (n) => n.midi,
      ),
    ).toEqual([67]);
  });

  it('keeps short staccato notes (extended to one grid cell)', () => {
    const take: RecordedNote[] = [0, 1, 2, 3].map((k) => ({
      midi: 60,
      onMs: at(k, k % 2 === 0 ? -25 : 25),
      offMs: at(k, k % 2 === 0 ? 45 : 95),
    }));
    expect(recordingToMonoNotes(take, { bpm, startMs, grid: 0.25, overlap: 'highest' })).toEqual([
      { startBeat: 0, beats: 0.25, midi: 60 },
      { startBeat: 1, beats: 0.25, midi: 60 },
      { startBeat: 2, beats: 0.25, midi: 60 },
      { startBeat: 3, beats: 0.25, midi: 60 },
    ]);
  });

  it('does not merge repeated presses of the same key', () => {
    const take: RecordedNote[] = [
      { midi: 60, onMs: at(0), offMs: at(1, -5) },
      { midi: 60, onMs: at(1), offMs: at(2) },
    ];
    expect(recordingToMonoNotes(take, { bpm, startMs, grid: 0.25, overlap: 'highest' })).toEqual([
      { startBeat: 0, beats: 1, midi: 60 },
      { startBeat: 1, beats: 1, midi: 60 },
    ]);
  });

  it('end to end: recorder → mono notes', () => {
    const r = new MelodyRecorder();
    r.start(startMs);
    r.handle(on(72, at(0, 12)));
    r.handle(on(74, at(1, -30))); // legato
    r.handle(off(72, at(1, 40)));
    r.handle(off(74, at(2, -60)));
    r.handle(on(76, at(2, 20)));
    const take = r.stop(at(3, 10)); // 76 còn giữ lúc dừng
    expect(recordingToMonoNotes(take, { bpm, startMs, grid: 0.25, overlap: 'highest' })).toEqual([
      { startBeat: 0, beats: 1, midi: 72 },
      { startBeat: 1, beats: 1, midi: 74 },
      { startBeat: 2, beats: 1, midi: 76 },
    ]);
  });

  it('returns nothing for an invalid bpm or empty take', () => {
    const take: RecordedNote[] = [{ midi: 60, onMs: at(0), offMs: at(1) }];
    expect(recordingToMonoNotes(take, { bpm: 0, startMs, grid: 0.25, overlap: 'highest' })).toEqual(
      [],
    );
    expect(
      recordingToMonoNotes(take, { bpm: Number.NaN, startMs, grid: 0.25, overlap: 'highest' }),
    ).toEqual([]);
    expect(recordingToMonoNotes([], { bpm, startMs, grid: 0.25, overlap: 'highest' })).toEqual([]);
  });
});

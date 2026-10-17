/**
 * PracticeSession + bàn chạm Mobile ('tap-down' mang sẵn key / octave / sharp đã chốt, SPEC Phase 4m C),
 * `expectedNoteAt` (nốt lẽ ra phải bấm sau một lần sai) và `nextNoteIndex`.
 */
import { describe, expect, it } from 'vitest';
import { buildTimeline } from '../core/timeline';
import type { Note, NoteKey, Octave, Song, Timeline } from '../core/types';
import { PRACTICE_NOTE_STATE, PracticeSession } from './practice';
import type { InputContext } from './practice';
import type { PracticeInputEvent } from './practice.types';

const n = (key: NoteKey, octave: Octave = 0, sharp = false): Note => ({
  kind: 'note',
  key,
  octave,
  sharp,
  beats: 1,
});
const song = (notes: Note[]): Song => ({
  id: 't',
  title: 'T',
  bpm: 120,
  timeSig: { num: 4, den: 4 },
  scrollDir: 1,
  sections: [{ name: 'Main', lines: [{ units: notes }] }],
});
// Z (0) · R:N (1) · S:V (2) · LS:C (3)
const TL: Timeline = buildTimeline(song([n('Z'), n('N', 1), n('V', 0, true), n('C', -1, true)]));

// 120 bpm: 1 beat = 500 ms; timeStamp (ms) = beat × 500.
const ctx: InputContext = { beatAt: (t) => t / 500, bpm: 120 };
const at = (beat: number, offsetMs = 0): number => beat * 500 + offsetMs;

const tap = (
  key: NoteKey,
  octave: Octave,
  sharp: boolean,
  timeStamp: number,
  type: 'tap-down' | 'tap-up' = 'tap-down',
): PracticeInputEvent => ({ type, key, octave, sharp, source: 'touch', pointerId: 1, timeStamp });

describe('PracticeSession — bàn chạm (tap-down)', () => {
  it('chấm theo (key, octave, sharp) của lần chạm, không theo modifier đang giữ', () => {
    const s = new PracticeSession(TL, { mode: 'score' });
    // Modifier PC đang giữ (vd. phím thay thế) không ảnh hưởng lần chạm.
    s.handleInput({ type: 'mod-down', modifier: 'right', source: 'keyboard', timeStamp: 0 }, ctx);
    expect(s.handleInput(tap('Z', 0, false, at(0, 30)), ctx).judgement).toMatchObject({
      noteIndex: 0,
      grade: 'perfect',
      deltaMs: 30,
    });
    expect(s.handleInput(tap('N', 1, false, at(1, -150)), ctx).judgement?.grade).toBe('good');
    expect(s.handleInput(tap('V', 0, true, at(2)), ctx).judgement?.grade).toBe('perfect');
    expect(s.handleInput(tap('C', -1, true, at(3)), ctx).judgement?.grade).toBe('perfect');
    expect(s.score()).toMatchObject({ perfect: 3, good: 1, combo: 4, miss: 0 });
    expect(s.noteStates[1]).toBe(PRACTICE_NOTE_STATE.good);
  });

  it('sai chế độ = bấm sai (mất combo); tap-up không làm gì', () => {
    const s = new PracticeSession(TL, { mode: 'score' });
    s.handleInput(tap('Z', 0, false, at(0)), ctx);
    expect(s.handleInput(tap('N', 0, false, at(1)), ctx)).toEqual({ judgement: null, wrong: true });
    expect(s.handleInput(tap('V', 0, false, at(2)), ctx).wrong).toBe(true);
    expect(s.handleInput(tap('C', -1, false, at(3)), ctx).wrong).toBe(true);
    expect(s.wrongPresses).toBe(3);
    expect(s.score().combo).toBe(0);
    expect(s.handleInput(tap('Z', 0, false, at(0), 'tap-up'), ctx)).toEqual({
      judgement: null,
      wrong: false,
    });
  });

  it('chế độ chờ: chỉ nốt mục tiêu, đúng cả chế độ', () => {
    const s = new PracticeSession(TL, { mode: 'wait' });
    s.waitTarget(0);
    expect(s.handleInput(tap('Z', 1, false, at(0)), ctx).wrong).toBe(true);
    expect(s.handleInput(tap('Z', 0, false, at(0)), ctx).judgement?.grade).toBe('perfect');
  });
});

describe('PracticeSession.expectedNoteAt / nextNoteIndex', () => {
  it('chấm điểm: nốt chưa chấm gần nhất trong cửa sổ good (hòa → sớm hơn); ngoài cửa sổ → -1', () => {
    const s = new PracticeSession(TL, { mode: 'score' });
    expect(s.nextNoteIndex).toBe(0);
    expect(s.expectedNoteAt(1.1, 120)).toBe(1);
    expect(s.expectedNoteAt(1.5, 120)).toBe(-1); // 250 ms tới cả hai nốt
    expect(s.expectedNoteAt(1.4, 120)).toBe(1); // 200 ms sau nốt 1, 300 ms trước nốt 2
    s.handleInput(tap('Z', 0, false, at(0)), ctx);
    expect(s.nextNoteIndex).toBe(1);
    expect(s.expectedNoteAt(0.05, 120)).toBe(-1); // nốt 0 đã chấm
    expect(s.expectedNoteAt(Number.NaN, 120)).toBe(-1);
    expect(s.expectedNoteAt(2, Number.NaN)).toBe(2); // bpm lỗi → bpm của bài
  });

  it('chờ: nốt mục tiêu; hết bài → -1', () => {
    const s = new PracticeSession(TL, { mode: 'wait' });
    expect(s.expectedNoteAt(-10, 120)).toBe(0);
    for (const [k, o, sh, b] of [
      ['Z', 0, false, 0],
      ['N', 1, false, 1],
      ['V', 0, true, 2],
      ['C', -1, true, 3],
    ] as const) {
      s.waitTarget(b);
      s.handleInput(tap(k, o, sh, at(b)), ctx);
    }
    expect(s.finished).toBe(true);
    expect(s.nextNoteIndex).toBe(-1);
    expect(s.expectedNoteAt(3, 120)).toBe(-1);
  });
});

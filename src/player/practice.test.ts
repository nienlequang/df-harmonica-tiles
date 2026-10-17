import { describe, expect, it } from 'vitest';
import { buildTimeline } from '../core/timeline';
import type { Line, Note, NoteKey, Octave, Rest, Slur, Song, Timeline, Unit } from '../core/types';
import { PRACTICE_NOTE_STATE, PracticeSession, keyboardPress } from './practice';
import type { InputContext, PracticeOptions } from './practice';
import type { PracticeInputEvent, PracticeModifier } from './practice.types';
import { NoteState } from './renderer';

// ── Model dựng tay (không phụ thuộc parser) ──
const n = (key: NoteKey, beats = 1, octave: Octave = 0, sharp = false): Note => ({
  kind: 'note',
  key,
  octave,
  sharp,
  beats,
});
const rest = (beats = 1): Rest => ({ kind: 'rest', beats });
const slur = (...notes: Note[]): Slur => ({ kind: 'slur', notes });
const song = (units: Unit[], bpm = 120): Song => ({
  id: 't',
  title: 'Test',
  bpm,
  timeSig: { num: 4, den: 4 },
  scrollDir: 1,
  sections: [{ name: 'Main', lines: [{ units } satisfies Line] }],
});
const tl = (...units: Unit[]): Timeline => buildTimeline(song(units));

// 120 bpm: 1 beat = 500 ms; timeStamp (ms) = beat × 500.
const MS_PER_BEAT = 500;
const ctx: InputContext = { beatAt: (t) => t / MS_PER_BEAT, bpm: 120 };
const at = (beat: number, offsetMs = 0): number => beat * MS_PER_BEAT + offsetMs;

const session = (t: Timeline, opts: Partial<PracticeOptions> = {}): PracticeSession =>
  new PracticeSession(t, { mode: 'score', ...opts });

const keyDown = (key: NoteKey, timeStamp: number): PracticeInputEvent => ({
  type: 'key-down',
  key,
  source: 'keyboard',
  timeStamp,
});
const keyUp = (key: NoteKey, timeStamp: number): PracticeInputEvent => ({
  type: 'key-up',
  key,
  source: 'keyboard',
  timeStamp,
});
const mod = (
  type: 'mod-down' | 'mod-up',
  modifier: PracticeModifier,
  source: 'keyboard' | 'mouse' = 'keyboard',
): PracticeInputEvent => ({ type, modifier, source, timeStamp: 0 });
const midiOn = (midi: number, timeStamp: number, velocity = 100): PracticeInputEvent => ({
  type: 'midi-on',
  midi,
  velocity,
  source: 'midi',
  timeStamp,
});

const press = (s: PracticeSession, key: NoteKey, timeStamp: number) =>
  s.handleInput(keyDown(key, timeStamp), ctx);

describe('PRACTICE_NOTE_STATE', () => {
  it('khớp NoteState của renderer', () => {
    expect(PRACTICE_NOTE_STATE).toEqual(NoteState);
  });
});

describe('keyboardPress', () => {
  const held = (left = false, right = false, scroll = false) => ({ left, right, scroll });
  it('trái → -1, phải → +1, scroll → nửa cung', () => {
    expect(keyboardPress('Z', held())).toEqual({ key: 'Z', octave: 0, sharp: false });
    expect(keyboardPress('X', held(true))).toEqual({ key: 'X', octave: -1, sharp: false });
    expect(keyboardPress('C', held(false, true))).toEqual({ key: 'C', octave: 1, sharp: false });
    expect(keyboardPress('V', held(false, false, true))).toEqual({
      key: 'V',
      octave: 0,
      sharp: true,
    });
    expect(keyboardPress('B', held(true, false, true))).toEqual({
      key: 'B',
      octave: -1,
      sharp: true,
    });
  });
  it('giữ cả trái lẫn phải → null (không hợp lệ)', () => {
    expect(keyboardPress('Z', held(true, true))).toBeNull();
    expect(keyboardPress('Z', held(true, true, true))).toBeNull();
  });
});

describe('PracticeSession — cửa sổ chấm điểm (score)', () => {
  // Nốt Z ở beat 2 (1000 ms).
  const cases: [number, 'perfect' | 'good' | null][] = [
    [0, 'perfect'],
    [99, 'perfect'],
    [100, 'perfect'],
    [101, 'good'],
    [219, 'good'],
    [220, 'good'],
    [221, null],
    [-99, 'perfect'],
    [-100, 'perfect'],
    [-101, 'good'],
    [-219, 'good'],
    [-220, 'good'],
    [-221, null],
  ];
  it.each(cases)('lệch %i ms → %s', (offset, grade) => {
    const s = session(tl(rest(2), n('Z')));
    const r = press(s, 'Z', at(2, offset));
    if (grade === null) {
      expect(r).toEqual({ judgement: null, wrong: true });
      expect(s.noteStates[0]).toBe(NoteState.none);
      expect(s.score().judged).toBe(0);
    } else {
      expect(r.wrong).toBe(false);
      expect(r.judgement?.noteIndex).toBe(0);
      expect(r.judgement?.grade).toBe(grade);
      expect(r.judgement?.deltaMs).toBeCloseTo(offset, 6);
      expect(s.noteStates[0]).toBe(grade === 'perfect' ? NoteState.perfect : NoteState.good);
    }
  });

  it('đổi lệch beat → ms theo bpm phát thực tế (ctx.bpm), không theo bpm bài', () => {
    // BPM override 60: 1 beat = 1000 ms. Bấm muộn 0.15 beat = 150 ms → good.
    const s = session(tl(rest(2), n('Z')));
    const slow: InputContext = { beatAt: (t) => t / 1000, bpm: 60 };
    const r = s.handleInput(keyDown('Z', 2150), slow);
    expect(r.judgement?.grade).toBe('good');
    expect(r.judgement?.deltaMs).toBeCloseTo(150, 6);
  });

  it('bpm không hợp lệ → dùng bpm của timeline', () => {
    const s = session(tl(rest(2), n('Z')));
    const r = s.handleInput(keyDown('Z', at(2, 150)), { beatAt: ctx.beatAt, bpm: 0 });
    expect(r.judgement?.deltaMs).toBeCloseTo(150, 6);
  });

  it('beat không hữu hạn → bỏ qua (không chấm, không sai)', () => {
    const s = session(tl(n('Z')));
    const r = s.handleInput(keyDown('Z', 0), { beatAt: () => Number.NaN, bpm: 120 });
    expect(r).toEqual({ judgement: null, wrong: false });
    expect(s.wrongPresses).toBe(0);
  });

  it('dùng timeStamp của event (không phải thời điểm xử lý)', () => {
    const seen: number[] = [];
    const s = session(tl(rest(2), n('Z')));
    s.handleInput(keyDown('Z', 1050), {
      beatAt: (t) => {
        seen.push(t);
        return t / MS_PER_BEAT;
      },
      bpm: 120,
    });
    expect(seen).toEqual([1050]);
  });
});

describe('PracticeSession — miss qua tick (score)', () => {
  it('đúng 220 ms chưa miss, quá 220 ms → miss (deltaMs null), mất combo', () => {
    const s = session(tl(n('Z'), rest(3), n('X'), rest(3), n('C')));
    expect(press(s, 'Z', at(0)).judgement?.grade).toBe('perfect');
    expect(s.score().combo).toBe(1);
    expect(s.tick(4 + 220 / MS_PER_BEAT, 120)).toEqual([]);
    expect(s.noteStates[1]).toBe(NoteState.none);
    const misses = s.tick(4 + 221 / MS_PER_BEAT, 120);
    expect(misses).toEqual([{ noteIndex: 1, grade: 'miss', deltaMs: null }]);
    expect(s.noteStates[1]).toBe(NoteState.miss);
    expect(s.score()).toMatchObject({ miss: 1, combo: 0, maxCombo: 1, judged: 2 });
    // Đã miss thì không miss lại, không chấm lại (bấm muộn → sai).
    expect(s.tick(5, 120)).toEqual([]);
    expect(press(s, 'X', at(4, 200))).toEqual({ judgement: null, wrong: true });
    expect(s.noteStates[1]).toBe(NoteState.miss);
  });

  it('một tick có thể miss nhiều nốt, theo thứ tự', () => {
    const s = session(tl(n('Z'), n('X'), n('C'), n('V')));
    // 2.3 beat: Z, X quá cửa sổ; C mới lệch 150 ms → chưa miss.
    const misses = s.tick(2.3, 120);
    expect(misses.map((j) => j.noteIndex)).toEqual([0, 1]);
    expect(s.finished).toBe(false);
    expect(s.tick(10, 120).map((j) => j.noteIndex)).toEqual([2, 3]);
    expect(s.finished).toBe(true);
  });

  it('tick dùng bpm truyền vào; beat không hữu hạn → []', () => {
    const s = session(tl(n('Z')));
    // 60 bpm: 0.21 beat = 210 ms → chưa miss; 0.23 beat = 230 ms → miss.
    expect(s.tick(0.21, 60)).toEqual([]);
    expect(s.tick(Number.NaN, 60)).toEqual([]);
    expect(s.tick(0.23, 60)).toHaveLength(1);
  });

  it('bỏ qua nốt đã chấm khi quét miss (chấm không theo thứ tự)', () => {
    // Hai nốt Z sát nhau (0.25 beat = 125 ms): bấm ở 100 ms gần nốt 1 hơn → nốt 0 bị miss sau.
    const s = session(tl(n('Z', 0.25), n('Z', 0.25), n('X')));
    const r = press(s, 'Z', at(0, 100));
    expect(r.judgement).toMatchObject({ noteIndex: 1, grade: 'perfect' });
    expect(r.judgement?.deltaMs).toBeCloseTo(-25, 6);
    expect(s.tick(at(0, 230) / MS_PER_BEAT, 120).map((j) => j.noteIndex)).toEqual([0]);
    expect(s.noteStates[1]).toBe(NoteState.perfect);
  });
});

describe('PracticeSession — combo và accuracy', () => {
  it('perfect / good / miss / perfect → combo, maxCombo, accuracy', () => {
    const s = session(tl(n('Z'), n('X'), n('C'), n('V'), n('B')));
    press(s, 'Z', at(0, 10)); // perfect
    press(s, 'X', at(1, -150)); // good
    expect(s.score()).toMatchObject({ combo: 2, maxCombo: 2, perfect: 1, good: 1 });
    s.tick(2.5, 120); // C miss
    expect(s.score()).toMatchObject({ combo: 0, maxCombo: 2, miss: 1 });
    press(s, 'V', at(3)); // perfect
    expect(s.score()).toEqual({
      total: 5,
      judged: 4,
      perfect: 2,
      good: 1,
      miss: 1,
      combo: 1,
      maxCombo: 2,
      accuracy: ((2 + 0.5) / 5) * 100,
    });
    press(s, 'B', at(4));
    expect(s.score().accuracy).toBeCloseTo(70, 9);
    expect(s.finished).toBe(true);
  });

  it('100% khi toàn perfect; 0 nốt → accuracy 0 và finished', () => {
    const s = session(tl(n('Z'), n('X')));
    press(s, 'Z', at(0));
    press(s, 'X', at(1));
    expect(s.score().accuracy).toBe(100);
    const empty = session(tl(rest(4)));
    expect(empty.score()).toMatchObject({ total: 0, accuracy: 0 });
    expect(empty.finished).toBe(true);
    expect(press(empty, 'Z', 0)).toEqual({ judgement: null, wrong: false });
  });

  it('bấm sai phá combo nhưng không chấm nốt nào', () => {
    const s = session(tl(n('Z'), n('X'), n('C')));
    press(s, 'Z', at(0));
    press(s, 'X', at(1));
    expect(s.score().combo).toBe(2);
    // Sai phím ngay tại nốt C.
    expect(press(s, 'V', at(2))).toEqual({ judgement: null, wrong: true });
    expect(s.score()).toMatchObject({ combo: 0, maxCombo: 2, judged: 2 });
    expect(s.noteStates[2]).toBe(NoteState.none);
    expect(s.wrongPresses).toBe(1);
    // Vẫn chấm được C sau đó.
    expect(press(s, 'C', at(2, 50)).judgement?.grade).toBe('perfect');
    expect(s.score().combo).toBe(1);
  });

  it('bấm khi không có nốt nào gần → sai', () => {
    const s = session(tl(n('Z'), rest(4), n('X')));
    expect(press(s, 'X', at(2))).toEqual({ judgement: null, wrong: true });
    expect(s.wrongPresses).toBe(1);
  });

  it('bấm thêm sau khi chấm xong không đổi gì (không phá combo cuối bài)', () => {
    const s = session(tl(n('Z')));
    press(s, 'Z', at(0));
    expect(s.finished).toBe(true);
    expect(press(s, 'X', at(0, 50))).toEqual({ judgement: null, wrong: false });
    expect(s.score().combo).toBe(1);
    expect(s.wrongPresses).toBe(0);
  });

  it('key-up / midi-off không ảnh hưởng điểm', () => {
    const s = session(tl(n('Z')));
    expect(s.handleInput(keyUp('Z', at(0)), ctx)).toEqual({ judgement: null, wrong: false });
    expect(
      s.handleInput(
        { type: 'midi-off', midi: 60, velocity: 0, source: 'midi', timeStamp: at(0) },
        ctx,
      ),
    ).toEqual({ judgement: null, wrong: false });
    expect(s.score().judged).toBe(0);
  });
});

describe('PracticeSession — modifier', () => {
  it('trái / phải / scroll và tổ hợp quyết định (octave, sharp)', () => {
    const s = session(
      tl(n('Z', 1, -1), n('X', 1, 1), n('C', 1, 0, true), n('V', 1, -1, true), n('B', 1, 1, true)),
    );
    // Không giữ gì → sai cho nốt cần trái.
    expect(press(s, 'Z', at(0)).wrong).toBe(true);
    s.handleInput(mod('mod-down', 'left'), ctx);
    expect(s.heldModifiers).toEqual({ left: true, right: false, scroll: false });
    expect(press(s, 'Z', at(0, 20)).judgement?.noteIndex).toBe(0);
    s.handleInput(mod('mod-up', 'left'), ctx);

    s.handleInput(mod('mod-down', 'right', 'mouse'), ctx);
    expect(press(s, 'X', at(1)).judgement?.noteIndex).toBe(1);
    s.handleInput(mod('mod-up', 'right', 'mouse'), ctx);

    s.handleInput(mod('mod-down', 'scroll'), ctx);
    expect(press(s, 'C', at(2)).judgement?.noteIndex).toBe(2);
    // Nốt kế cần trái + scroll: chỉ scroll → sai.
    expect(press(s, 'V', at(3)).wrong).toBe(true);
    s.handleInput(mod('mod-down', 'left', 'mouse'), ctx);
    expect(press(s, 'V', at(3)).judgement?.noteIndex).toBe(3);
    s.handleInput(mod('mod-up', 'left', 'mouse'), ctx);
    s.handleInput(mod('mod-down', 'right'), ctx);
    expect(press(s, 'B', at(4)).judgement?.noteIndex).toBe(4);
  });

  it('giữ cả trái lẫn phải → sai dù phím đúng', () => {
    const s = session(tl(n('Z', 1, -1)));
    s.handleInput(mod('mod-down', 'left'), ctx);
    s.handleInput(mod('mod-down', 'right', 'mouse'), ctx);
    expect(press(s, 'Z', at(0))).toEqual({ judgement: null, wrong: true });
    s.handleInput(mod('mod-up', 'right', 'mouse'), ctx);
    expect(press(s, 'Z', at(0, 30)).judgement?.grade).toBe('perfect');
  });

  it('modifier đang giữ thừa → sai (nốt thường)', () => {
    const s = session(tl(n('Z')));
    s.handleInput(mod('mod-down', 'scroll'), ctx);
    expect(press(s, 'Z', at(0)).wrong).toBe(true);
  });

  it('cùng modifier từ chuột và bàn phím: chỉ thả khi cả hai nhả', () => {
    const s = session(tl(n('Z')));
    s.handleInput(mod('mod-down', 'left', 'mouse'), ctx);
    s.handleInput(mod('mod-down', 'left', 'keyboard'), ctx);
    s.handleInput(mod('mod-up', 'left', 'keyboard'), ctx);
    expect(s.heldModifiers.left).toBe(true);
    s.handleInput(mod('mod-up', 'left', 'mouse'), ctx);
    expect(s.heldModifiers.left).toBe(false);
  });

  it('mod-down/up không chấm điểm; releaseModifiers thả hết; reset giữ modifier', () => {
    const s = session(tl(n('Z')));
    expect(s.handleInput(mod('mod-down', 'left'), ctx)).toEqual({ judgement: null, wrong: false });
    s.handleInput(mod('mod-down', 'scroll', 'mouse'), ctx);
    s.reset();
    expect(s.heldModifiers).toEqual({ left: true, right: false, scroll: true });
    s.releaseModifiers();
    expect(s.heldModifiers).toEqual({ left: false, right: false, scroll: false });
  });
});

describe('PracticeSession — luyến và phím lặp', () => {
  it('mỗi nốt trong luyến được chấm riêng', () => {
    // Luyến X-C mỗi nốt 0.5 beat (250 ms), có modifier khác nhau trong luyến.
    const s = session(tl(slur(n('X', 0.5), n('C', 0.5, 1)), n('Z')));
    expect(press(s, 'X', at(0)).judgement?.noteIndex).toBe(0);
    s.handleInput(mod('mod-down', 'right'), ctx);
    expect(press(s, 'C', at(0.5, 30)).judgement).toMatchObject({ noteIndex: 1, grade: 'perfect' });
    s.handleInput(mod('mod-up', 'right'), ctx);
    expect(press(s, 'Z', at(1)).judgement?.noteIndex).toBe(2);
    expect(s.score()).toMatchObject({ perfect: 3, combo: 3 });
  });

  it('một lần bấm chỉ chấm một nốt trong luyến', () => {
    const s = session(tl(slur(n('Z', 0.25), n('X', 0.25))));
    press(s, 'Z', at(0));
    expect(s.score().judged).toBe(1);
    expect(s.tick(1, 120).map((j) => j.noteIndex)).toEqual([1]);
  });

  it('cùng phím lặp: mỗi lần bấm chấm một nốt, gần nhất trước', () => {
    // Z Z Z mỗi nốt 0.5 beat = 250 ms.
    const s = session(tl(n('Z', 0.5), n('Z', 0.5), n('Z', 0.5)));
    expect(press(s, 'Z', at(0, 20)).judgement?.noteIndex).toBe(0);
    // Bấm lại ngay (nốt 0 đã chấm): nốt 1 cách 210 ms → good.
    expect(press(s, 'Z', at(0, 40)).judgement).toMatchObject({ noteIndex: 1, grade: 'good' });
    expect(press(s, 'Z', at(1, -10)).judgement).toMatchObject({ noteIndex: 2, grade: 'perfect' });
    // Hết nốt → bấm thêm không làm gì.
    expect(press(s, 'Z', at(1, 10))).toEqual({ judgement: null, wrong: false });
  });

  it('nốt cùng phím nhưng khác modifier không bị chấm nhầm', () => {
    const s = session(tl(n('Z', 0.25), n('Z', 0.25, 1)));
    // Giữ phải, bấm sát nốt 0 → khớp nốt 1 (vẫn trong cửa sổ) chứ không phải nốt 0.
    s.handleInput(mod('mod-down', 'right'), ctx);
    const r = press(s, 'Z', at(0, 10));
    expect(r.judgement).toMatchObject({ noteIndex: 1 });
    expect(r.judgement?.deltaMs).toBeCloseTo(-115, 6);
  });
});

describe('PracticeSession — MIDI', () => {
  // Z thường = 60, Z trái = 48, Z phải = 72, Z scroll = 61 (scrollDir 1).
  it('so cao độ tuyệt đối', () => {
    const s = session(tl(n('Z'), n('Z', 1, 1), n('Z', 1, 0, true)));
    expect(s.handleInput(midiOn(72, at(0)), ctx).wrong).toBe(true);
    expect(s.handleInput(midiOn(60, at(0, 20)), ctx).judgement?.noteIndex).toBe(0);
    expect(s.handleInput(midiOn(72, at(1)), ctx).judgement?.noteIndex).toBe(1);
    expect(s.handleInput(midiOn(60, at(2)), ctx).wrong).toBe(true);
    expect(s.handleInput(midiOn(61, at(2)), ctx).judgement?.noteIndex).toBe(2);
  });

  it('MIDI bỏ qua modifier đang giữ', () => {
    const s = session(tl(n('Z')));
    s.handleInput(mod('mod-down', 'left'), ctx);
    s.handleInput(mod('mod-down', 'right'), ctx);
    expect(s.handleInput(midiOn(60, at(0)), ctx).judgement?.grade).toBe('perfect');
  });

  it('pitch class: chỉ cần đúng tên nốt, bỏ qua quãng', () => {
    const s = session(tl(n('Z'), n('X')), { midiPitchClassOnly: true });
    expect(s.handleInput(midiOn(84, at(0)), ctx).judgement?.noteIndex).toBe(0);
    expect(s.handleInput(midiOn(50, at(1)), ctx).judgement?.noteIndex).toBe(1); // D3 ~ X (D4)
    const t = session(tl(n('Z'), n('X')));
    t.setMidiPitchClassOnly(true);
    expect(t.handleInput(midiOn(48, at(0)), ctx).judgement?.noteIndex).toBe(0);
    t.setMidiPitchClassOnly(false);
    expect(t.handleInput(midiOn(50, at(1)), ctx).wrong).toBe(true);
  });

  it('velocity 0 = note off: bỏ qua', () => {
    const s = session(tl(n('Z')));
    expect(s.handleInput(midiOn(60, at(0), 0), ctx)).toEqual({ judgement: null, wrong: false });
    expect(s.score().judged).toBe(0);
  });

  it('cửa sổ chấm điểm như bàn phím', () => {
    const s = session(tl(rest(2), n('Z'), rest(2), n('X')));
    expect(s.handleInput(midiOn(60, at(2, 150)), ctx).judgement?.grade).toBe('good');
    expect(s.handleInput(midiOn(62, at(5, -221)), ctx).wrong).toBe(true);
  });
});

describe('PracticeSession — chế độ chờ', () => {
  const wait = (t: Timeline) => session(t, { mode: 'wait' });

  it('waitTarget: -1 trước nốt, index + waiting khi tới nốt', () => {
    const s = wait(tl(rest(1), n('Z'), n('X')));
    expect(s.mode).toBe('wait');
    expect(s.waitTarget(0.5)).toBe(-1);
    expect(s.noteStates[0]).toBe(NoteState.none);
    expect(s.waitTarget(1 - 1e-12)).toBe(0); // sai số float
    expect(s.noteStates[0]).toBe(NoteState.waiting);
    expect(s.waitTarget(1.7)).toBe(0); // vẫn là nốt 0 tới khi bấm đúng
  });

  it('bấm đúng → perfect, chuyển mục tiêu; bấm sai không đổi combo', () => {
    const s = wait(tl(n('Z'), n('X')));
    expect(s.waitTarget(0)).toBe(0);
    expect(press(s, 'C', at(0))).toEqual({ judgement: null, wrong: true });
    expect(s.score().combo).toBe(0);
    expect(press(s, 'Z', at(0, 5000)).judgement).toMatchObject({ noteIndex: 0, grade: 'perfect' });
    expect(s.noteStates[0]).toBe(NoteState.perfect);
    expect(s.score().combo).toBe(1);
    expect(press(s, 'C', at(1))).toEqual({ judgement: null, wrong: true });
    expect(s.score().combo).toBe(1);
    expect(s.wrongPresses).toBe(2);
    expect(s.waitTarget(0.5)).toBe(-1);
    expect(s.waitTarget(1)).toBe(1);
    expect(press(s, 'X', at(1)).judgement?.grade).toBe('perfect');
    expect(s.finished).toBe(true);
    expect(s.score()).toMatchObject({ perfect: 2, combo: 2, maxCombo: 2, accuracy: 100 });
    expect(s.waitTarget(5)).toBe(-1);
  });

  it('bấm sớm hơn 220 ms trước nốt → sai; trong 220 ms → perfect', () => {
    const s = wait(tl(rest(2), n('Z')));
    expect(press(s, 'Z', at(2, -221)).wrong).toBe(true);
    const r = press(s, 'Z', at(2, -220));
    expect(r.judgement?.grade).toBe('perfect');
    expect(r.judgement?.deltaMs).toBeCloseTo(-220, 6);
  });

  it('modifier và MIDI cũng áp dụng; giữ L+R → sai', () => {
    const s = wait(tl(n('Z', 1, -1), n('X')));
    s.handleInput(mod('mod-down', 'left'), ctx);
    s.handleInput(mod('mod-down', 'right'), ctx);
    expect(press(s, 'Z', at(0)).wrong).toBe(true);
    s.handleInput(mod('mod-up', 'right'), ctx);
    expect(press(s, 'Z', at(0)).judgement?.noteIndex).toBe(0);
    s.handleInput(mod('mod-up', 'left'), ctx);
    expect(s.handleInput(midiOn(62, at(1)), ctx).judgement?.noteIndex).toBe(1);
  });

  it('không có miss: tick luôn []', () => {
    const s = wait(tl(n('Z')));
    expect(s.tick(100, 120)).toEqual([]);
    expect(s.score().miss).toBe(0);
  });

  it('chỉ nốt chưa chấm kế tiếp là mục tiêu (bỏ qua nốt sau dù trùng phím)', () => {
    const s = wait(tl(n('Z'), n('X')));
    s.waitTarget(0);
    expect(press(s, 'X', at(0)).wrong).toBe(true);
    expect(s.score().judged).toBe(0);
  });

  it('lùi playhead bỏ đánh dấu waiting; setMode bỏ waiting, giữ kết quả', () => {
    const s = wait(tl(n('Z'), n('X')));
    s.waitTarget(0);
    press(s, 'Z', at(0));
    expect(s.waitTarget(1)).toBe(1);
    expect(s.waitTarget(0.5)).toBe(-1);
    expect(s.noteStates[1]).toBe(NoteState.none);
    expect(s.waitTarget(1)).toBe(1);
    s.setMode('score');
    expect(s.mode).toBe('score');
    expect(s.noteStates[1]).toBe(NoteState.none);
    expect(s.noteStates[0]).toBe(NoteState.perfect);
    expect(s.waitTarget(1)).toBe(-1);
    expect(s.score().perfect).toBe(1);
    // Chế độ score: tick sinh miss cho nốt còn lại.
    expect(s.tick(2, 120).map((j) => j.noteIndex)).toEqual([1]);
    s.setMode('score'); // không đổi → không làm gì
    expect(s.score().miss).toBe(1);
  });
});

describe('PracticeSession — reset(fromBeat)', () => {
  it('nốt trước fromBeat bị bỏ qua: không tính tổng, không miss, không chấm', () => {
    const s = session(tl(n('Z'), n('X'), n('C'), n('V')));
    press(s, 'Z', at(0));
    s.tick(10, 120);
    expect(s.finished).toBe(true);
    s.reset(2);
    expect(Array.from(s.noteStates)).toEqual([0, 0, 0, 0]);
    expect(s.score()).toEqual({
      total: 2,
      judged: 0,
      perfect: 0,
      good: 0,
      miss: 0,
      combo: 0,
      maxCombo: 0,
      accuracy: 0,
    });
    expect(s.wrongPresses).toBe(0);
    expect(s.finished).toBe(false);
    // Nốt X (beat 1) đã bị bỏ: bấm X lúc đó là sai, tick không miss X.
    expect(press(s, 'X', at(1)).wrong).toBe(true);
    expect(s.tick(2, 120)).toEqual([]);
    // Nốt đúng tại fromBeat được tính.
    expect(press(s, 'C', at(2)).judgement?.noteIndex).toBe(2);
    expect(s.tick(10, 120).map((j) => j.noteIndex)).toEqual([3]);
    expect(s.score()).toMatchObject({ total: 2, perfect: 1, miss: 1, accuracy: 50 });
  });

  it('chế độ chờ: mục tiêu đầu tiên là nốt tại/sau fromBeat', () => {
    const s = session(tl(n('Z'), n('X'), n('C')), { mode: 'wait' });
    s.reset(1);
    expect(s.waitTarget(0.5)).toBe(-1);
    expect(s.waitTarget(1)).toBe(1);
    expect(press(s, 'X', at(1)).judgement?.noteIndex).toBe(1);
  });

  it('reset() mặc định từ 0; fromBeat không hữu hạn coi như 0; noteStates giữ nguyên mảng', () => {
    const s = session(tl(n('Z'), n('X')));
    const arr = s.noteStates;
    press(s, 'Z', at(0));
    s.reset();
    expect(s.noteStates).toBe(arr);
    expect(s.score().total).toBe(2);
    s.reset(Number.NaN);
    expect(s.score().total).toBe(2);
    s.reset(99);
    expect(s.score().total).toBe(0);
    expect(s.finished).toBe(true);
  });
});

describe('PracticeSession — loop wrap (bấm vắt qua điểm quay về)', () => {
  // Loop [0, 4): Z X C V (mỗi nốt 1 beat = 500 ms), sau loop end là B (vòng này không phát tới).
  const loop = { start: 0, end: 4 };
  const lctx: InputContext = { ...ctx, loop };
  const lpress = (s: PracticeSession, key: NoteKey, timeStamp: number) =>
    s.handleInput(keyDown(key, timeStamp), lctx);
  const lapTl = () => tl(n('Z'), n('X'), n('C'), n('V'), n('B'));
  const playLap = (s: PracticeSession) => {
    for (const [i, k] of (['Z', 'X', 'C', 'V'] as const).entries()) lpress(s, k, at(i));
  };

  it('bấm sớm cho nốt đầu vòng kế: không sai, chấm trước rồi tính vào lượt mới khi wrap', () => {
    const s = session(lapTl());
    playLap(s);
    expect(s.score()).toMatchObject({ perfect: 4, combo: 4 });
    const r = lpress(s, 'Z', at(4, -50));
    expect(r).toMatchObject({ judgement: { noteIndex: 0, grade: 'perfect' }, wrong: false });
    expect(r.lap).toBe('next');
    expect(r.judgement?.deltaMs).toBeCloseTo(-50, 6);
    // Vòng hiện tại không đổi.
    expect(s.score()).toMatchObject({ perfect: 4, combo: 4, judged: 4 });
    expect(s.wrongPresses).toBe(0);
    const carried = s.wrapLoop(loop, 120);
    expect(carried).toEqual([r.judgement]);
    expect(s.score()).toMatchObject({ total: 5, judged: 1, perfect: 1, combo: 1 });
    expect(s.noteStates[0]).toBe(NoteState.perfect);
    // Sau wrap (beat 0.3): Z không bị miss.
    expect(s.tick(0.3, 120)).toEqual([]);
  });

  it('good khi sớm 101..220 ms; sớm hơn 220 ms hoặc sai phím ở cả hai vòng → sai ngay', () => {
    const s = session(lapTl());
    playLap(s);
    expect(lpress(s, 'Z', at(4, -221)).wrong).toBe(true);
    expect(lpress(s, 'M', at(4, -50)).wrong).toBe(true);
    expect(s.wrongPresses).toBe(2);
    expect(s.score().combo).toBe(0);
    const r = lpress(s, 'Z', at(4, -150));
    expect(r.lap).toBe('next');
    expect(r.judgement?.grade).toBe('good');
    // Hai lần bấm sớm: nốt đã chấm trước không bị chấm lại; nốt kế (X ở beat 1) quá xa → sai.
    expect(lpress(s, 'Z', at(4, -20)).wrong).toBe(true);
    expect(s.wrapLoop(loop, 120).map((j) => [j.noteIndex, j.grade])).toEqual([[0, 'good']]);
  });

  it('có loop: nốt từ loop end trở đi không được chấm ở vòng này', () => {
    const s = session(lapTl());
    playLap(s);
    // B (beat 4) nằm sau loop end: vòng này không phát tới → không chấm, cũng không phải vòng kế.
    expect(lpress(s, 'B', at(4, -10)).wrong).toBe(true);
    expect(s.noteStates[4]).toBe(NoteState.none);
    // Không loop thì vẫn chấm B như thường.
    const t = session(lapTl());
    expect(press(t, 'B', at(4, -10)).judgement?.noteIndex).toBe(4);
  });

  it('vòng hiện tại đã chấm hết (loop là đoạn cuối bài) vẫn nhận bấm sớm cho vòng kế', () => {
    const s = session(tl(n('Z'), n('X')));
    const end: InputContext = { ...ctx, loop: { start: 0, end: 2 } };
    s.handleInput(keyDown('Z', at(0)), end);
    s.handleInput(keyDown('X', at(1)), end);
    expect(s.finished).toBe(true);
    expect(s.handleInput(keyDown('Z', at(2, -30)), end).lap).toBe('next');
    // Không khớp gì → vẫn "không làm gì" như khi đã chấm hết.
    expect(s.handleInput(keyDown('C', at(2, -30)), end)).toEqual({ judgement: null, wrong: false });
    expect(s.wrapLoop({ start: 0, end: 2 }, 120)).toHaveLength(1);
    expect(s.score()).toMatchObject({ total: 2, judged: 1, perfect: 1 });
  });

  it('bấm muộn sau wrap cho nốt cuối vòng trước: nháy kết quả, không sai, không đổi lượt mới', () => {
    // Nốt cuối vòng ngắn: B ở beat 3.75 (0.25 beat).
    const s = session(tl(n('Z'), n('X'), n('C'), n('V', 0.75), n('B', 0.25), n('M')));
    expect(s.tick(3.7, 120)).toHaveLength(4); // Z X C V miss, B còn trong cửa sổ
    expect(s.wrapLoop(loop, 120)).toEqual([]);
    expect(s.score()).toMatchObject({ judged: 0, combo: 0 });
    // beat 0.05 của vòng mới = 150 ms sau B của vòng trước.
    const r = lpress(s, 'B', at(0.05));
    expect(r.lap).toBe('previous');
    expect(r.judgement).toMatchObject({ noteIndex: 4, grade: 'good' });
    expect(r.judgement?.deltaMs).toBeCloseTo(150, 6);
    expect(s.wrongPresses).toBe(0);
    expect(s.score()).toMatchObject({ judged: 0, perfect: 0, good: 0 });
    expect(s.noteStates[4]).toBe(NoteState.none);
    // Chỉ một lần; quá cửa sổ thì là bấm sai như thường.
    expect(lpress(s, 'B', at(0.06)).wrong).toBe(true);
  });

  it('wrapLoop chỉ áp lần bấm của đúng loop đó; dropLoopCarry / reset / setMode bỏ hết', () => {
    const s = session(lapTl());
    playLap(s);
    expect(lpress(s, 'Z', at(4, -30)).lap).toBe('next');
    // Wrap theo loop khác (đổi loop giữa chừng) → không áp.
    expect(s.wrapLoop({ start: 1, end: 4 }, 120)).toEqual([]);

    const t = session(lapTl());
    playLap(t);
    lpress(t, 'Z', at(4, -30));
    t.dropLoopCarry();
    expect(t.wrapLoop(loop, 120)).toEqual([]);
    expect(t.score().judged).toBe(0);

    const u = session(lapTl());
    playLap(u);
    lpress(u, 'Z', at(4, -30));
    u.setMode('wait');
    expect(u.wrapLoop(loop, 120)).toEqual([]);
  });

  it('chế độ chờ: bấm sớm nốt đầu vòng kế (nốt mục tiêu đang ở sau loop end)', () => {
    const s = session(lapTl(), { mode: 'wait' });
    playLap(s);
    expect(s.waitTarget(3.9)).toBe(-1); // B ở beat 4 chưa tới
    const r = lpress(s, 'Z', at(4, -50));
    expect(r.lap).toBe('next');
    expect(r.judgement?.grade).toBe('perfect');
    expect(s.wrongPresses).toBe(0);
    s.wrapLoop(loop, 120);
    expect(s.waitTarget(0)).toBe(-1); // Z đã chấm → mục tiêu là X
    expect(s.waitTarget(1)).toBe(1);
  });
});

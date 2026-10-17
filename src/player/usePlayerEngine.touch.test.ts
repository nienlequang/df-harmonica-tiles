/**
 * PlayerEngine + bàn chạm kiểu game Mobile (SPEC Phase 4m C): 'tap-down' mang (key, octave, sharp) đã
 * chốt được chấm tại timeStamp của lần chạm (trục performance.now), cả chế độ chấm điểm lẫn chờ; kết quả
 * trả về cho bàn nút (nốt lẽ ra phải bấm khi sai chế độ); phím đang giữ; tiếng phản hồi chỉ khi bật; canvas
 * dùng `lanePadding: 'pad'` khi engine có `mobilePad` và Kiểu điều khiển = Mobile.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getAudioEngine } from '../audio/engine';
import { FakeAudioContext } from '../audio/fakeAudioContext';
import { noteMidi } from '../core/keys';
import { buildTimeline } from '../core/timeline';
import type { Note, NoteKey, Octave, Song, Timeline } from '../core/types';
import { useSettings } from '../ui/settings';
import { useToasts } from '../ui/toast';
import { createManualClock } from './clock';
import type { ManualClock } from './clock';
import type { PracticeInputEvent } from './practice.types';
import { TilesRenderer } from './renderer';
import { PlayerEngine } from './usePlayerEngine';
import type { PlayerEngineOptions } from './usePlayerEngine';

// 120 BPM (0.5 s/beat): Z (beat 0) · R:N (beat 1, quãng trên) · S:V (beat 2, Nửa Cung) · Z (beat 3).
const n = (key: NoteKey, octave: Octave = 0, sharp = false): Note => ({
  kind: 'note',
  key,
  octave,
  sharp,
  beats: 1,
});
const SONG: Song = {
  id: 't',
  title: 'T',
  bpm: 120,
  timeSig: { num: 4, den: 4 },
  scrollDir: 1,
  sections: [{ name: 'A', lines: [{ units: [n('Z'), n('N', 1), n('V', 0, true), n('Z')] }] }],
};
const TL: Timeline = buildTimeline(SONG);

/** performance.now() cố định → tuổi của lần chạm = NOW − timeStamp. */
const NOW = 50_000;

let frames = new Map<number, FrameRequestCallback>();
let nextFrame = 1;
let clock: ManualClock;
let engines: PlayerEngine[] = [];
let stage: HTMLDivElement;

function flushFrames(): void {
  const list = Array.from(frames.values());
  frames.clear();
  for (const cb of list) cb(0);
}

function makeEngine(opts: PlayerEngineOptions = {}, canvas: HTMLCanvasElement | null = null) {
  const e = new PlayerEngine(TL, SONG.bpm, { clock, ...opts });
  engines.push(e);
  e.attach({ canvas, stage });
  return e;
}

/** Clock tới `sec` giây sau lúc Play (mốc 100) rồi chạy 1 frame. */
function at(sec: number): void {
  clock.set(100 + sec);
  flushFrames();
}

/** Lần chạm nốt `agoMs` mili-giây trước "bây giờ". */
const tapDown = (
  key: NoteKey,
  octave: Octave = 0,
  sharp = false,
  agoMs = 0,
  pointerId = 1,
): PracticeInputEvent => ({
  type: 'tap-down',
  key,
  octave,
  sharp,
  source: 'touch',
  pointerId,
  timeStamp: NOW - agoMs,
});
const tapUp = (key: NoteKey, pointerId = 1): PracticeInputEvent => ({
  type: 'tap-up',
  key,
  octave: 0,
  sharp: false,
  source: 'touch',
  pointerId,
  timeStamp: NOW,
});

const practice = (e: PlayerEngine) => {
  const p = e.getState().practice;
  if (!p) throw new Error('practice is off');
  return p;
};

beforeEach(() => {
  frames = new Map();
  nextFrame = 1;
  vi.stubGlobal(
    'requestAnimationFrame',
    vi.fn((cb: FrameRequestCallback) => {
      const id = nextFrame++;
      frames.set(id, cb);
      return id;
    }),
  );
  vi.stubGlobal(
    'cancelAnimationFrame',
    vi.fn((id: number) => frames.delete(id)),
  );
  vi.spyOn(performance, 'now').mockReturnValue(NOW);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => null);
  useSettings.getState().reset();
  useSettings.getState().set({
    audioEnabled: false,
    countIn: false,
    controlScheme: 'mobile',
    // mặc định v4 đếm ngược 3 giây — test cần phát ngay
    startDelaySec: 0,
  });
  useToasts.setState({ toasts: [] });
  clock = createManualClock(100);
  stage = document.createElement('div');
  document.body.appendChild(stage);
});

afterEach(() => {
  for (const e of engines) e.detach();
  engines = [];
  stage.remove();
  getAudioEngine().dispose();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('bàn chạm — chấm điểm', () => {
  it('chấm tại timeStamp của lần chạm, đúng (key, octave, sharp) đã chốt', () => {
    const e = makeEngine();
    e.setPractice(true);
    expect(practice(e).next).toBe(0);
    e.play();
    at(0.02); // beat 0.04
    expect(e.handlePracticeInput(tapDown('Z', 0, false, 20))).toEqual({
      kind: 'perfect',
      expected: null,
    });
    expect(practice(e).last).toMatchObject({ kind: 'perfect', key: 'Z' });
    expect(practice(e).last?.deltaMs).toBeCloseTo(0, 6);
    // Nốt kế tiếp (bàn chạm nhắc nút chế độ trước nó): R:N.
    expect(practice(e).next).toBe(1);
    // Ngẩng Lên đã chốt: R:N ở beat 1 (giây 0.5); chạm muộn 150 ms → Good.
    at(0.65);
    expect(e.handlePracticeInput(tapDown('N', 1))?.kind).toBe('good');
    expect(practice(e).last?.deltaMs).toBeCloseTo(150, 6);
    // Nửa Cung đã chốt: S:V ở beat 2 (giây 1.0); chạm sớm 60 ms, sự kiện tới trễ 30 ms → Perfect −60.
    at(0.97);
    expect(e.handlePracticeInput(tapDown('V', 0, true, 30))?.kind).toBe('perfect');
    expect(practice(e).last?.deltaMs).toBeCloseTo(-60, 6);
    expect(practice(e).score).toMatchObject({ perfect: 2, good: 1, combo: 3 });
    expect(practice(e).next).toBe(3);
  });

  it('sai chế độ: tính sai, trả nốt lẽ ra phải bấm (để chỉ nút chế độ), cột = phím vừa chạm', () => {
    const e = makeEngine();
    e.setPractice(true);
    e.play();
    at(0.5);
    const out = e.handlePracticeInput(tapDown('N', 0));
    expect(out?.kind).toBe('wrong');
    expect(out?.expected).toBe(TL.notes[1]);
    expect(practice(e).wrong).toBe(1);
    // Đúng phím, sai chế độ → bàn chạm ghi "SAI CHẾ ĐỘ" (rightKey).
    expect(practice(e).last).toMatchObject({ kind: 'wrong', key: 'N', rightKey: true });
    // Đúng phím + đúng quãng nhưng thiếu Nửa Cung.
    at(1.0);
    const out2 = e.handlePracticeInput(tapDown('V', 0, false));
    expect(out2).toEqual({ kind: 'wrong', expected: TL.notes[2] });
    expect(practice(e).last?.rightKey).toBe(true);
    // Sai phím (nốt lẽ ra là V) → "SAI PHÍM".
    expect(e.handlePracticeInput(tapDown('B', 0, true))?.kind).toBe('wrong');
    expect(practice(e).last).toMatchObject({ kind: 'wrong', key: 'B' });
    expect(practice(e).last?.rightKey).toBeUndefined();
    // Xa mọi nốt (giữa hai nốt, ngoài cửa sổ good): không có nốt "lẽ ra".
    at(1.25);
    expect(e.handlePracticeInput(tapDown('M'))).toEqual({ kind: 'wrong', expected: null });
    expect(practice(e).last?.rightKey).toBeUndefined();
  });

  it('nốt quá cửa sổ không ai chạm → MISS ở cột của nốt đó', () => {
    const e = makeEngine();
    e.setPractice(true);
    e.play();
    at(0.4);
    expect(practice(e).last).toMatchObject({ kind: 'miss', key: 'Z' });
  });

  it('ngoài lượt chơi / practice tắt: không chấm (null); tap-up không là lần bấm', () => {
    const e = makeEngine();
    expect(e.handlePracticeInput(tapDown('Z'))).toBeNull();
    e.setPractice(true);
    expect(e.handlePracticeInput(tapDown('Z'))).toBeNull(); // chưa phát
    expect(practice(e).wrong).toBe(0);
    e.play();
    at(0.01);
    expect(e.handlePracticeInput(tapUp('Z'))).toBeNull();
  });

  it('phím đang chạm hiện trong pressed (đa chạm), thả thì bỏ', () => {
    const e = makeEngine();
    e.setPractice(true);
    e.handlePracticeInput(tapDown('C', 0, false, 0, 1));
    e.handlePracticeInput(tapDown('Z', 1, false, 0, 2));
    expect(e.getState().pressed.keys).toEqual(['Z', 'C']);
    e.handlePracticeInput(tapUp('C', 1));
    expect(e.getState().pressed.keys).toEqual(['Z']);
    e.setPractice(false);
    expect(e.getState().pressed.keys).toEqual([]);
  });
});

describe('bàn chạm — chế độ chờ', () => {
  it('giữ ở nốt chờ tới khi chạm đúng cả chế độ', () => {
    useSettings.getState().set({ practiceMode: 'wait' });
    const e = makeEngine();
    e.setPractice(true);
    e.play();
    at(0.01);
    expect(practice(e).waiting).toBe(true);
    expect(e.handlePracticeInput(tapDown('Z'))?.kind).toBe('perfect');
    expect(practice(e).waiting).toBe(false);
    at(0.6);
    expect(practice(e).waiting).toBe(true);
    // Quên chạm Ngẩng Lên: sai, nốt chờ là R:N.
    expect(e.handlePracticeInput(tapDown('N', 0))).toEqual({
      kind: 'wrong',
      expected: TL.notes[1],
    });
    expect(practice(e).waiting).toBe(true);
    expect(e.handlePracticeInput(tapDown('N', 1))?.kind).toBe('perfect');
    expect(practice(e).waiting).toBe(false);
  });
});

describe('bàn chạm — tiếng phản hồi', () => {
  it('im lặng mặc định; bật "tiếng khi bấm" thì phát đúng cao độ đã chốt', () => {
    vi.stubGlobal('AudioContext', FakeAudioContext);
    const preview = vi.spyOn(getAudioEngine(), 'playPreview');
    const e = makeEngine();
    e.setPractice(true);
    e.handlePracticeInput(tapDown('N', 1, false));
    expect(preview).not.toHaveBeenCalled();
    useSettings.getState().set({ practiceFeedback: true });
    e.handlePracticeInput(tapDown('V', -1, true, 0, 2));
    expect(preview).toHaveBeenCalledTimes(1);
    expect(preview.mock.calls[0][0]).toBe(noteMidi('V', -1, true, TL.baseOctave, TL.scrollDir));
  });
});

describe('canvas: bàn nút kiểu game', () => {
  const lastPadding = (spy: ReturnType<typeof vi.spyOn>) => {
    const calls = spy.mock.calls as unknown as [Partial<{ lanePadding: string }>][];
    return calls[calls.length - 1]?.[0]?.lanePadding;
  };

  it("mobilePad + Mobile → 'pad'; đổi sang PC → 'normal'; không mobilePad thì không đụng", () => {
    const setOptions = vi.spyOn(TilesRenderer.prototype, 'setOptions');
    const e = makeEngine({ mobilePad: true }, document.createElement('canvas'));
    const renderer = (e as unknown as { renderer: TilesRenderer }).renderer;
    expect(renderer.options.lanePadding).toBe('pad');
    useSettings.getState().set({ controlScheme: 'pc' });
    expect(lastPadding(setOptions)).toBe('normal');
    expect(renderer.options.lanePadding).toBe('normal');
    useSettings.getState().set({ controlScheme: 'mobile' });
    expect(renderer.options.lanePadding).toBe('pad');

    const plain = makeEngine({}, document.createElement('canvas'));
    const r2 = (plain as unknown as { renderer: TilesRenderer }).renderer;
    expect(r2.options.lanePadding).toBe('normal');
    // Cửa sổ nổi (lanePadding cố định 'none' + mobilePad): Mobile → bàn nút 'pad' (vòng "CHẠM" đáp đồng tâm
    // lên nút chế độ — vòng R7); PC → 'none' cố định của nó.
    const pip = makeEngine(
      { mobilePad: true, rendererOptions: { lanePadding: 'none' } },
      document.createElement('canvas'),
    );
    const r3 = (pip as unknown as { renderer: TilesRenderer }).renderer;
    expect(r3.options.lanePadding).toBe('pad');
    useSettings.getState().set({ controlScheme: 'pc' });
    expect(r3.options.lanePadding).toBe('none');
    // Không mobilePad: lanePadding cố định đè lên kể cả kiểu Mobile.
    useSettings.getState().set({ controlScheme: 'mobile' });
    const fixedRenderer = makeEngine(
      { rendererOptions: { lanePadding: 'none' } },
      document.createElement('canvas'),
    );
    expect(
      (fixedRenderer as unknown as { renderer: TilesRenderer }).renderer.options.lanePadding,
    ).toBe('none');
  });
});

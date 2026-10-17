/**
 * Vòng R7-3 "khựng lúc nốt đầu bắt đầu rơi": trong lúc đếm ngược (và chờ mở khóa âm thanh) canvas vẽ ĐÚNG
 * frame đầu của đếm vào (`preRoll`) — hết đếm ngược ô chỉ việc chạy từ đó, không nhảy lùi.
 * Cùng với: Space / Esc hủy, tua / chơi lại trong lúc đếm, phát tiếp giữa bài, đứng ở cuối bài, đếm vào tắt,
 * thứ tự thông báo lúc hết đếm, hình làm nóng glow chỉ vẽ lúc ô đứng yên.
 * v1.0.1: đếm vào rút còn 65 % quãng dẫn vào (leadIn.ts) — bài này có nốt ở mọi beat nên đếm vào = 0,65 ô nhịp
 * = 2,6 beat (`CI`).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockInstance } from 'vitest';
import { getAudioEngine } from '../audio/engine';
import { buildTimeline } from '../core/timeline';
import type { Note, NoteKey, Song } from '../core/types';
import { useSettings } from '../ui/settings';
import { useToasts } from '../ui/toast';
import { createManualClock } from './clock';
import type { ManualClock } from './clock';
import type * as GlowWarmup from './glowWarmup';
import { PRE_ROLL_GLIDE_SEC } from './preRollGlide';
import type { RenderFrame } from './renderer';
import { TilesRenderer } from './renderer';
import { GLOW_WARMUP_FRAMES, PlayerEngine } from './usePlayerEngine';

const warm = vi.hoisted(() => vi.fn((_canvas: HTMLCanvasElement, _layout: unknown) => true));
vi.mock('./glowWarmup', async (importOriginal) => ({
  ...(await importOriginal<typeof GlowWarmup>()),
  warmTileGlow: warm,
}));

const n = (key: NoteKey, beats = 1): Note => ({
  kind: 'note',
  key,
  octave: 0,
  sharp: false,
  beats,
});

/** 120 BPM (0.5 s/beat), 4/4, 3 dòng × 4 beat = 12 beat. */
const SONG: Song = {
  id: 'p',
  title: 'P',
  bpm: 120,
  timeSig: { num: 4, den: 4 },
  scrollDir: 1,
  sections: [
    {
      name: 'A',
      lines: [
        { units: [n('Z'), n('X'), n('C'), n('V')] },
        { units: [n('B'), n('N'), n('M'), n('Z')] },
        { units: [n('X', 4)] },
      ],
    },
  ],
};
const TL = buildTimeline(SONG);
/** Đếm vào của bài này từ một beat nguyên: 0,65 × 4 beat (nốt đầu ngay tại điểm bắt đầu). */
const CI = 2.6;

let frames = new Map<number, FrameRequestCallback>();
let nextFrame = 1;
function flushFrames(count = 1): void {
  for (let i = 0; i < count; i++) {
    const list = Array.from(frames.values());
    frames.clear();
    for (const cb of list) cb(0);
  }
}

let clock: ManualClock;
let engines: PlayerEngine[] = [];
let render: MockInstance<(frame: RenderFrame) => void>;
const lastFrame = (): RenderFrame => {
  const f = render.mock.calls.at(-1)?.[0];
  if (!f) throw new Error('chưa vẽ frame nào');
  return f;
};
/** Vẽ khung kế, chờ hết trượt pre-roll (PRE_ROLL_GLIDE_SEC, D-389) rồi vẽ khung cuối. */
function settle(): void {
  flushFrames();
  clock.advance(PRE_ROLL_GLIDE_SEC);
  flushFrames();
}

function makeEngine(opts: { initialBeat?: number } = {}): PlayerEngine {
  const e = new PlayerEngine(TL, SONG.bpm, { clock, initialBeat: opts.initialBeat });
  engines.push(e);
  e.attach({ canvas: document.createElement('canvas') });
  flushFrames();
  return e;
}

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
    vi.fn((id: number) => {
      frames.delete(id);
    }),
  );
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => null);
  render = vi.spyOn(TilesRenderer.prototype, 'render');
  useSettings.getState().reset();
  useSettings
    .getState()
    .set({ audioEnabled: false, clickSound: false, countIn: true, startDelaySec: 3 });
  useToasts.setState({ toasts: [] });
  clock = createManualClock(100);
});

afterEach(() => {
  for (const e of engines) e.detach();
  engines = [];
  getAudioEngine().dispose();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('PlayerEngine — frame đầu đếm vào trong lúc đếm ngược (R7-3)', () => {
  it('đếm ngược vẽ ô đứng yên đúng ở frame đầu đếm vào; hết đếm ô chạy tiếp từ đó, không nhảy', () => {
    const e = makeEngine();
    expect(lastFrame().beat).toBe(0);
    expect(e.preRoll).toBeNull();
    e.play();
    expect(e.getState().countdown).toBe(3);
    expect(e.transport.playing).toBe(false);
    expect(e.preRoll).toEqual({ start: -CI, end: 0 });
    flushFrames();
    // Khung đầu sau khi bấm = khung đứng yên (D-389: không nhảy), rồi trượt mượt về đầu đoạn đếm vào trong
    // PRE_ROLL_GLIDE_SEC.
    expect(lastFrame()).toMatchObject({ beat: 0, countIn: { start: -CI, end: 0 } });
    clock.advance(PRE_ROLL_GLIDE_SEC / 2);
    flushFrames();
    expect(lastFrame().beat).toBeCloseTo(-CI / 2, 9);
    clock.advance(PRE_ROLL_GLIDE_SEC / 2);
    flushFrames();
    expect(lastFrame()).toMatchObject({
      beat: -CI,
      countIn: { start: -CI, end: 0 },
      countInRemaining: CI,
    });
    // UI (game bar, banner, tiến độ) vẫn ở điểm bắt đầu — chỉ canvas lùi về đầu ô nhịp đếm vào.
    expect(e.getState().beat).toBe(0);
    expect(e.getState().countingIn).toBe(false);

    // Hai giây đầu: ô đứng yên (không có frame chạy), số vẫn đếm.
    flushFrames();
    vi.advanceTimersByTime(2000);
    clock.advance(2 - PRE_ROLL_GLIDE_SEC);
    expect(e.getState().countdown).toBe(1);
    expect(frames.size).toBe(0);
    expect(lastFrame().beat).toBe(-CI);

    // Hết đếm: transport chạy từ đúng frame đó.
    clock.advance(1);
    vi.advanceTimersByTime(1000);
    expect(e.getState().countdown).toBeNull();
    expect(e.transport.playing).toBe(true);
    expect(e.preRoll).toBeNull();
    flushFrames();
    expect(lastFrame().beat).toBe(-CI);
    expect(lastFrame().countIn).toEqual({ start: -CI, end: 0 });
    clock.advance(0.25);
    flushFrames();
    expect(lastFrame().beat).toBeCloseTo(-CI + 0.5, 9);
    clock.advance(2);
    flushFrames();
    expect(lastFrame().beat).toBeCloseTo(-CI + 4.5, 9);
    expect(lastFrame().countIn).toBeNull();
  });

  it('không lúc nào engine báo "hết đếm ngược" mà chưa phát và không có frame đầu đếm vào', () => {
    const e = makeEngine();
    const seen: { countdown: number | null; playing: boolean; pre: boolean }[] = [];
    e.subscribe(() =>
      seen.push({
        countdown: e.getState().countdown,
        playing: e.transport.playing,
        pre: e.preRoll !== null,
      }),
    );
    e.play();
    clock.advance(3);
    vi.advanceTimersByTime(3000);
    expect(e.transport.playing).toBe(true);
    expect(seen.length).toBeGreaterThan(0);
    for (const s of seen) expect(s.playing || s.pre || s.countdown !== null).toBe(true);
  });

  it('Space / Esc (pause) hủy đếm ngược → trượt về vị trí đang đứng', () => {
    const e = makeEngine();
    e.play();
    settle();
    expect(lastFrame().beat).toBe(-CI);
    e.pause();
    expect(e.getState().countdown).toBeNull();
    expect(e.preRoll).toBeNull();
    flushFrames();
    // Khung đầu sau khi hủy vẫn là khung pre-roll (không nhảy), rồi trượt về chỗ đứng.
    expect(lastFrame()).toMatchObject({ beat: -CI, countIn: null });
    clock.advance(PRE_ROLL_GLIDE_SEC);
    flushFrames();
    expect(lastFrame()).toMatchObject({ beat: 0, countIn: null });
    expect(frames.size).toBe(0);
    // toggle cũng hủy được; cancelCountdown (Esc) cũng vậy.
    e.toggle();
    settle();
    expect(lastFrame().beat).toBe(-CI);
    e.cancelCountdown();
    settle();
    expect(lastFrame().beat).toBe(0);
    vi.advanceTimersByTime(5000);
    expect(e.transport.playing).toBe(false);
  });

  it('tua trong lúc đếm ngược: frame đầu đếm vào theo điểm mới, rồi phát từ đó', () => {
    const e = makeEngine();
    e.play();
    e.seek(4);
    expect(e.getState().countdown).toBe(3);
    expect(e.preRoll).toEqual({ start: 4 - CI, end: 4 });
    settle();
    expect(lastFrame()).toMatchObject({ beat: 4 - CI, countIn: { start: 4 - CI, end: 4 } });
    vi.advanceTimersByTime(3000);
    expect(e.transport.playing).toBe(true);
    expect(e.transport.countIn).toEqual({ start: 4 - CI, end: 4 });
    flushFrames();
    expect(lastFrame().beat).toBe(4 - CI);
  });

  it('phát tiếp giữa bài: frame đầu đếm vào lùi đúng quãng dẫn vào (65 %) tính tới nốt kế', () => {
    const e = makeEngine({ initialBeat: 5.5 });
    e.play();
    // Nốt kế ở beat 6 (khoảng lặng 0,5): đếm vào 0,65 × 4 − 0,35 × 0,5 = 2,425 → nốt kế đi 0,65 × 4,5 beat.
    expect(e.preRoll).toEqual({ start: 3.075, end: 5.5 });
    flushFrames();
    expect(lastFrame().beat).toBe(5.5);
    settle();
    // Nốt kết thúc trước điểm bắt đầu vẽ mờ như lúc đếm vào thật (renderer nhận cùng countIn).
    expect(lastFrame()).toMatchObject({ beat: 3.075, countIn: { start: 3.075, end: 5.5 } });
  });

  it('đứng ở cuối bài → Phát chạy lại từ đầu: frame đầu đếm vào là [-2.6, 0)', () => {
    const e = makeEngine({ initialBeat: TL.totalBeats });
    expect(e.getState().ended).toBe(true);
    e.play();
    expect(e.preRoll).toEqual({ start: -CI, end: 0 });
    vi.advanceTimersByTime(3000);
    expect(e.transport.getBeat()).toBe(-CI);
  });

  it('Chơi lại (R) khi đang phát: đếm ngược với frame đầu đếm vào từ đầu bài', () => {
    const e = makeEngine();
    useSettings.getState().set({ startDelaySec: 0 });
    e.play();
    clock.advance(4);
    flushFrames();
    expect(e.transport.getBeat()).toBeGreaterThan(2);
    useSettings.getState().set({ startDelaySec: 3 });
    e.restart();
    expect(e.transport.playing).toBe(false);
    expect(e.preRoll).toEqual({ start: -CI, end: 0 });
    flushFrames();
    expect(lastFrame().beat).toBe(-CI);
  });

  it('đếm vào tắt: đếm ngược vẽ đúng vị trí bắt đầu (không có frame đầu đếm vào)', () => {
    useSettings.getState().set({ countIn: false });
    const e = makeEngine({ initialBeat: 4 });
    e.play();
    expect(e.preRoll).toBeNull();
    flushFrames();
    expect(lastFrame()).toMatchObject({ beat: 4, countIn: null });
    vi.advanceTimersByTime(3000);
    flushFrames();
    expect(lastFrame().beat).toBe(4);
  });

  it('bật đếm vào trong lúc đếm ngược → frame đầu đếm vào theo ngay', () => {
    useSettings.getState().set({ countIn: false });
    const e = makeEngine();
    e.play();
    flushFrames();
    expect(lastFrame().beat).toBe(0);
    useSettings.getState().set({ countIn: true });
    settle();
    expect(lastFrame().beat).toBe(-CI);
  });

  it('đếm ngược = Tắt, đếm vào bật (R7C-1): khung đầu sau khi bấm = khung đứng yên, phần bù mờ dần trên beat đang chạy; transport đúng giờ', () => {
    useSettings.getState().set({ startDelaySec: 0 });
    const e = makeEngine();
    expect(lastFrame().beat).toBe(0);
    e.play();
    expect(e.transport.playing).toBe(true);
    flushFrames();
    expect(lastFrame()).toMatchObject({ beat: 0, countIn: { start: -CI, end: 0 } });
    // 120 BPM: transport chạy 2 beat / s từ -CI (nốt đầu / âm thanh không trễ).
    clock.advance(PRE_ROLL_GLIDE_SEC / 2);
    flushFrames();
    const t = e.transport.getBeat();
    expect(t).toBeCloseTo(-CI + PRE_ROLL_GLIDE_SEC, 9);
    expect(lastFrame().beat).toBeCloseTo(t + CI / 2, 9);
    clock.advance(PRE_ROLL_GLIDE_SEC / 2);
    flushFrames();
    expect(lastFrame().beat).toBeCloseTo(e.transport.getBeat(), 9);
    expect(lastFrame().beat).toBeCloseTo(-CI + 2 * PRE_ROLL_GLIDE_SEC, 9);
  });

  it('khung trượt đơn điệu: không khung nào vọt qua đích hay quay đầu', () => {
    const e = makeEngine();
    e.play();
    const beats: number[] = [];
    for (let i = 0; i < 30; i++) {
      flushFrames();
      beats.push(lastFrame().beat);
      clock.advance(1 / 60);
    }
    expect(beats[0]).toBe(0);
    expect(beats.at(-1)).toBe(-CI);
    for (let i = 1; i < beats.length; i++) {
      expect(beats[i]).toBeLessThanOrEqual(beats[i - 1]);
      expect(beats[i - 1] - beats[i]).toBeLessThan(0.5);
    }
  });

  it('preRoll giữ cùng object khi không đổi (overlay / renderer so tham chiếu)', () => {
    const e = makeEngine();
    e.play();
    const a = e.preRoll;
    expect(e.preRoll).toBe(a);
  });
});

describe('PlayerEngine — làm nóng glow (glowWarmup.ts)', () => {
  it('chỉ vẽ lúc ô đứng yên, tối đa GLOW_WARMUP_FRAMES frame mỗi lần attach, không vẽ khi đang chạy', () => {
    warm.mockClear();
    useSettings.getState().set({ startDelaySec: 0, countIn: false });
    const e = makeEngine();
    const atAttach = warm.mock.calls.length;
    expect(atAttach).toBeGreaterThan(0);
    expect(warm.mock.calls[0][0]).toBeInstanceOf(HTMLCanvasElement);
    e.play();
    for (let i = 0; i < 5; i++) {
      clock.advance(0.1);
      flushFrames();
    }
    expect(warm.mock.calls.length).toBe(atAttach);
    e.pause();
    for (let i = 0; i < 20; i++) {
      e.seek(i % 4);
      flushFrames();
    }
    expect(warm.mock.calls.length).toBe(GLOW_WARMUP_FRAMES);
    // Gắn lại (StrictMode / đổi canvas) → làm nóng lại cho canvas mới.
    e.detach();
    const canvas = document.createElement('canvas');
    e.attach({ canvas });
    expect(warm.mock.calls.length).toBe(GLOW_WARMUP_FRAMES + 1);
    expect(warm.mock.calls.at(-1)?.[0]).toBe(canvas);
  });
});

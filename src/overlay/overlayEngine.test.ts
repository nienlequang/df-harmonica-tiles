import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockInstance } from 'vitest';
import { parseHarm } from '../core/parser';
import { buildTimeline } from '../core/timeline';
import type { Timeline } from '../core/types';
import { createManualClock } from '../player/clock';
import type { ManualClock } from '../player/clock';
import { DOM_WARMUP_CLASS, DOM_WARMUP_MS } from '../player/glowWarmup';
import { PRE_ROLL_GLIDE_SEC } from '../player/preRollGlide';
import type { RenderFrame } from '../player/renderer';
import { TilesRenderer } from '../player/renderer';
import { OverlayEngine } from './overlayEngine';
import type { OverlayEngineOptions } from './overlayEngine';

/** 120 BPM: 1 beat = 0.5 s. 2 dòng × 4 nốt (8 beat = 4 s), dòng 2 giữ chuột phải. */
const SOURCE = '@bpm 120\nmột hai ba bốn: Z X C V\n[giữ chuột phải] B N M , [thả chuột phải]';

function timeline(): Timeline {
  return buildTimeline(parseHarm(SOURCE).song);
}

/** Đếm vào từ một beat nguyên của bài này (nốt ở mọi beat): 0,65 ô nhịp = 2,6 beat (src/player/leadIn.ts, v1.0.1). */
const CI = 2.6;

let frames = new Map<number, FrameRequestCallback>();
let nextFrame = 1;

/** Chạy mọi rAF đang chờ (một lượt). */
function flushFrames(): void {
  const pending = [...frames.values()];
  frames = new Map();
  for (const cb of pending) cb(0);
}

let clock: ManualClock;
const engines: OverlayEngine[] = [];

function make(opts: Partial<OverlayEngineOptions> = {}): OverlayEngine {
  const e = new OverlayEngine(timeline(), {
    bpm: 120,
    countIn: false,
    loop: false,
    delaySec: 0,
    scheme: 'pc',
    mobileSemitone: 'toggle',
    clock,
    ...opts,
  });
  e.attach({ canvas: null });
  engines.push(e);
  return e;
}

/** Tiến đồng hồ rồi chạy một frame. */
function advance(sec: number): void {
  clock.advance(sec);
  flushFrames();
}

/** Vẽ khung kế, chờ hết trượt pre-roll (PRE_ROLL_GLIDE_SEC, D-389) rồi vẽ khung cuối. */
function settle(): void {
  flushFrames();
  advance(PRE_ROLL_GLIDE_SEC);
}

const AudioCtor = vi.fn();

beforeEach(() => {
  frames = new Map();
  nextFrame = 1;
  clock = createManualClock(100);
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    const id = nextFrame++;
    frames.set(id, cb);
    return id;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => {
    frames.delete(id);
  });
  AudioCtor.mockClear();
  vi.stubGlobal('AudioContext', AudioCtor);
  vi.stubGlobal('webkitAudioContext', AudioCtor);
});

afterEach(() => {
  for (const e of engines.splice(0)) e.detach();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('OverlayEngine', () => {
  it('khởi đầu: đứng ở beat 0, nốt đầu ở hit line, chưa chạy', () => {
    const e = make();
    expect(e.getState()).toMatchObject({
      playing: false,
      started: false,
      ended: false,
      countdown: null,
      noteIndex: 0,
      lineIndex: 0,
    });
  });

  it('play: chạy theo đồng hồ, cập nhật nốt / run / dòng', () => {
    const e = make();
    e.play();
    expect(e.getState()).toMatchObject({ playing: true, started: true });
    advance(1.1); // 2.2 beat
    expect(e.getState()).toMatchObject({
      noteIndex: 2,
      lineIndex: 0,
      runIndex: -1,
    });
    advance(1); // 4.2 beat: dòng 2, đang giữ chuột phải
    expect(e.getState()).toMatchObject({ noteIndex: 4, lineIndex: 1, runIndex: 0 });
  });

  it('hết bài (không loop): dừng ở cuối, ended', () => {
    const e = make();
    e.play();
    advance(5);
    expect(e.getState()).toMatchObject({ playing: false, ended: true, loops: 0 });
    expect(e.transport.playing).toBe(false);
  });

  it('loop=1: hết bài chạy lại từ đầu, không đếm ngược', () => {
    const e = make({ loop: true, delaySec: 5 });
    e.restart();
    vi.advanceTimersByTime(5000);
    expect(e.transport.playing).toBe(true);
    advance(4.2); // qua cuối bài (8 beat = 4 s)
    expect(e.getState()).toMatchObject({ playing: true, loops: 1, countdown: null });
    expect(e.transport.getBeat()).toBeLessThan(0.5);
    advance(4.2);
    expect(e.getState().loops).toBe(2);
  });

  it('countin=1: đếm vào bằng hình (0,65 ô nhịp — v1.0.1); nốt ở hit line là nốt tại điểm bắt đầu', () => {
    const e = make({ countIn: true });
    e.play();
    expect(e.transport.countIn).toEqual({ start: -CI, end: 0 });
    expect(e.getState()).toMatchObject({ countingIn: true, noteIndex: 0 });
    advance(1); // 2 beat của 2,6 beat đếm vào
    expect(e.getState().countingIn).toBe(true);
    // Tạm dừng giữa lúc đếm → về đúng điểm bắt đầu.
    e.pause();
    expect(e.transport.getBeat()).toBe(0);
    e.play();
    advance(CI / 2 + 0.1);
    expect(e.getState()).toMatchObject({ countingIn: false, noteIndex: 0 });
    // Loop chạy lại cũng có đếm vào.
  });

  it('delay: đếm ngược N…1 rồi mới chạy; Space trong lúc đếm = hủy', () => {
    const e = make({ delaySec: 3 });
    e.play();
    expect(e.getState()).toMatchObject({ countdown: 3, playing: true, started: true });
    expect(e.transport.playing).toBe(false);
    vi.advanceTimersByTime(1000);
    expect(e.getState().countdown).toBe(2);
    e.toggle(); // hủy
    expect(e.getState()).toMatchObject({ countdown: null, playing: false });
    vi.advanceTimersByTime(5000);
    expect(e.transport.playing).toBe(false);

    e.play();
    vi.advanceTimersByTime(3000);
    expect(e.getState()).toMatchObject({ countdown: null, playing: true });
    expect(e.transport.playing).toBe(true);
  });

  it('restart: về beat 0 kể cả khi đang chạy; có delay thì đếm ngược lại', () => {
    const e = make();
    e.play();
    advance(1.5);
    e.restart();
    expect(e.transport.getBeat()).toBe(0);
    expect(e.transport.playing).toBe(true);

    const d = make({ delaySec: 2 });
    d.play();
    vi.advanceTimersByTime(2000);
    advance(1);
    d.restart();
    expect(d.transport.playing).toBe(false);
    expect(d.transport.getBeat()).toBe(0);
    expect(d.getState().countdown).toBe(2);
    vi.advanceTimersByTime(2000);
    expect(d.transport.playing).toBe(true);
  });

  it('→ / ←: nhảy dòng như Player', () => {
    const e = make();
    e.nextLine();
    expect(e.transport.getBeat()).toBe(4);
    e.nextLine(); // dòng cuối: không nhảy
    expect(e.transport.getBeat()).toBe(4);
    e.prevLine();
    expect(e.transport.getBeat()).toBe(0);
  });

  it('bài không có nốt: play / restart không làm gì', () => {
    const e = new OverlayEngine(buildTimeline(parseHarm('@bpm 100\n_ _').song), {
      bpm: 100,
      countIn: false,
      loop: true,
      delaySec: 0,
      scheme: 'pc',
      mobileSemitone: 'toggle',
      clock,
    });
    e.attach({ canvas: null });
    engines.push(e);
    e.play();
    e.restart();
    expect(e.getState()).toMatchObject({ playing: false, started: false });
  });

  it('scheme mobile + loop=1 / R: lượt mới nhắc chạm Ngẩng Tự Nhiên ở nốt 0 (game giữ Ngẩng Lên)', () => {
    const e = make({ scheme: 'mobile', loop: true });
    const cues = () => (e.getState().mobile?.nextCues ?? []).map((c) => [c.beat, c.noteIndex]);
    e.play();
    expect(cues()).toEqual([[4, 4]]);
    advance(3.9); // beat 7.8 — dòng 2 ở Ngẩng Lên
    expect(e.getState().mobile?.mode).toBe(1);
    advance(0.1); // hết bài → chạy lại từ 0
    expect(e.getState().loops).toBe(1);
    expect(e.getState().mobile).toMatchObject({ mode: 1, cueSoon: true });
    expect(cues()).toEqual([[0, 0]]);
    expect(e.getState().mobile?.nextCues[0]).toMatchObject({ kind: 'octave', mode: 0 });
    advance(0.25);
    expect(e.getState().mobile?.mode).toBe(0);
    expect(cues()).toEqual([[4, 4]]);
    advance(2); // beat 4.5 — Ngẩng Lên
    e.restart();
    expect(e.getState().mobile?.mode).toBe(1);
    expect(cues()).toEqual([[0, 0]]);
  });

  it('scheme mobile: state.mobile có chế độ tại hit line', () => {
    const e = make({ scheme: 'mobile' });
    expect(e.getState().mobile).not.toBeNull();
    expect(make().getState().mobile).toBeNull();
  });

  it('detach: hủy đếm ngược, rAF, dừng transport; attach lại được', () => {
    const e = make({ delaySec: 2 });
    e.play();
    e.detach();
    vi.advanceTimersByTime(5000);
    expect(e.transport.playing).toBe(false);
    expect(e.getState().countdown).toBeNull();
    expect(frames.size).toBe(0);
    e.attach({ canvas: null });
    e.play();
    vi.advanceTimersByTime(2000);
    expect(e.transport.playing).toBe(true);
  });

  it('setRendererOptions đổi layout (tileScale) → --lane-left / --lane-right theo lane mới ngay', () => {
    // Trang mini (MINI_RENDERER_OPTIONS, PC): gắn ở tileScale 1, rồi useLaneScale gửi 0.6 cho khung 300 px —
    // sau khi ResizeObserver của engine đã chạy; biến CSS cũ làm keycap lệch lane tới ~0.6 lane.
    const canvas = document.createElement('canvas');
    Object.defineProperty(canvas, 'clientWidth', { value: 300, configurable: true });
    Object.defineProperty(canvas, 'clientHeight', { value: 226, configurable: true });
    const ctx = new Proxy({} as Record<string, unknown>, {
      get: (_t, prop) => (prop === 'measureText' ? () => ({ width: 7 }) : () => undefined),
      set: () => true,
    });
    Object.defineProperty(canvas, 'getContext', { value: () => ctx, configurable: true });
    const stage = document.createElement('div');
    const e = make();
    e.attach({
      canvas,
      stage,
      renderer: {
        orientation: 'vertical',
        hitLinePos: 0.88,
        lanePadding: 'none',
        showRibbons: true,
        showSectionLabels: false,
        tileScale: 1,
      },
    });
    const gutter = (): number => {
      const L = e.tilesRenderer?.layout;
      if (!L) throw new Error('no layout');
      return Math.round(L.width - L.laneArea.x - L.laneArea.w);
    };
    expect(stage.style.getPropertyValue('--lane-right')).toBe(`${gutter()}px`);
    expect(gutter()).toBe(56);
    e.setRendererOptions({ tileScale: 0.6 });
    expect(gutter()).toBe(34);
    expect(stage.style.getPropertyValue('--lane-right')).toBe('34px');
    expect(stage.style.getPropertyValue('--lane-left')).toBe('0px');
  });

  it('setScheme: đổi PC ↔ Mobile tại chỗ (theo Player chính)', () => {
    const e = make();
    expect(e.getState().mobile).toBeNull();
    e.setScheme('mobile', 'oneShot');
    expect(e.getState().mobile).not.toBeNull();
    e.setScheme('pc', 'toggle');
    expect(e.getState().mobile).toBeNull();
  });

  it('không bao giờ tạo AudioContext', () => {
    const e = make({ countIn: true, loop: true, delaySec: 1 });
    e.play();
    vi.advanceTimersByTime(1000);
    advance(10);
    e.restart();
    e.toggle();
    expect(AudioCtor).not.toHaveBeenCalled();
  });
});

describe('OverlayEngine: theo Player chính (applyFollow)', () => {
  /** Đồng hồ chung (epoch ms) chạy cùng ManualClock của transport. */
  let nowMs = 1_000_000;

  function follower(opts: Partial<OverlayEngineOptions> = {}): OverlayEngine {
    return make({ now: () => nowMs, ...opts });
  }

  function tick(sec: number): void {
    nowMs += sec * 1000;
    advance(sec);
  }

  const base = {
    playing: true,
    beat: 0,
    bpm: 120,
    sentAt: 0,
    loop: null,
    countdownEndsAt: null,
    countIn: null,
  };

  beforeEach(() => {
    nowMs = 1_000_000;
  });

  it('phát ở beat mong đợi (bù độ trễ của tin), tự chạy theo tempo giữa hai tin', () => {
    const e = follower();
    e.applyFollow({ ...base, beat: 2, sentAt: nowMs - 500 });
    expect(e.isFollowing).toBe(true);
    expect(e.transport.playing).toBe(true);
    expect(e.transport.getBeat()).toBeCloseTo(3, 9);
    expect(e.getState()).toMatchObject({ playing: true, started: true, noteIndex: 3 });
    tick(0.5);
    expect(e.transport.getBeat()).toBeCloseTo(4, 9);
  });

  it('lệch ≤ 0.05 beat: để yên (không giật mỗi heartbeat); lệch hơn → nhảy tới đúng chỗ', () => {
    const e = follower();
    e.applyFollow({ ...base, beat: 1, sentAt: nowMs });
    const epoch = e.transport.epoch;
    tick(0.5); // local 2
    e.applyFollow({ ...base, beat: 2.03, sentAt: nowMs });
    expect(e.transport.epoch).toBe(epoch);
    expect(e.transport.getBeat()).toBeCloseTo(2, 9);
    e.applyFollow({ ...base, beat: 2.2, sentAt: nowMs });
    expect(e.transport.epoch).not.toBe(epoch);
    expect(e.transport.getBeat()).toBeCloseTo(2.2, 9);
  });

  it('dừng / tua khi dừng / tempo / hết bài', () => {
    const e = follower();
    e.applyFollow({ ...base, beat: 1, sentAt: nowMs });
    tick(0.5);
    e.applyFollow({ ...base, playing: false, beat: 2, sentAt: nowMs });
    expect(e.transport.playing).toBe(false);
    expect(e.transport.getBeat()).toBe(2);
    expect(e.getState().playing).toBe(false);
    e.applyFollow({ ...base, playing: false, beat: 4, bpm: 90, sentAt: nowMs });
    expect(e.transport.getBeat()).toBe(4);
    expect(e.transport.bpm).toBe(90);
    expect(e.getState().lineIndex).toBe(1);
    // Đang phát mà beat mong đợi đã qua cuối bài (8 beat) → đứng ở cuối.
    e.applyFollow({ ...base, beat: 7, sentAt: nowMs - 2000 });
    expect(e.transport.playing).toBe(false);
    expect(e.transport.getBeat()).toBe(8);
  });

  it('đếm vào: chép ô nhịp đếm của Player (vạch đếm vào của canvas theo đúng điểm bắt đầu)', () => {
    const e = follower();
    e.applyFollow({ ...base, beat: -3, sentAt: nowMs, countIn: { startBeat: -4, endBeat: 0 } });
    expect(e.transport.getBeat()).toBeCloseTo(-3, 9);
    expect(e.transport.countIn?.end).toBe(0);
    expect(e.getState()).toMatchObject({ countingIn: true, noteIndex: 0 });
    tick(1); // −1
    const epoch = e.transport.epoch;
    e.applyFollow({ ...base, beat: -1, sentAt: nowMs, countIn: { startBeat: -4, endBeat: 0 } });
    expect(e.transport.epoch).toBe(epoch);
    tick(1); // +1: hết đếm vào
    expect(e.getState().countingIn).toBe(false);
    e.applyFollow({ ...base, beat: 1, sentAt: nowMs, countIn: { startBeat: -4, endBeat: 0 } });
    expect(e.transport.epoch).toBe(epoch);
  });

  it('đếm ngược tới countdownEndsAt của Player: 3…2…1 rồi hết', () => {
    const e = follower();
    e.applyFollow({ ...base, playing: false, sentAt: nowMs, countdownEndsAt: nowMs + 3000 });
    expect(e.getState()).toMatchObject({ countdown: 3, playing: true });
    expect(e.transport.playing).toBe(false);
    nowMs += 1000;
    vi.advanceTimersByTime(1000);
    expect(e.getState().countdown).toBe(2);
    nowMs += 1000;
    vi.advanceTimersByTime(1000);
    expect(e.getState().countdown).toBe(1);
    nowMs += 1000;
    vi.advanceTimersByTime(1000);
    expect(e.getState().countdown).toBeNull();
    // Hủy đếm ngược ở Player.
    e.applyFollow({ ...base, playing: false, sentAt: nowMs, countdownEndsAt: nowMs + 5000 });
    expect(e.getState().countdown).toBe(5);
    e.applyFollow({ ...base, playing: false, sentAt: nowMs, countdownEndsAt: null });
    expect(e.getState().countdown).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('loop A-B của Player: overlay tự quay vòng giữa hai tin; hết bài không tự chạy lại (loop cả bài chỉ khi tự chạy)', () => {
    const e = follower({ loop: true });
    e.applyFollow({ ...base, beat: 0, sentAt: nowMs, loop: { startBeat: 0, endBeat: 4 } });
    expect(e.transport.loop).toEqual({ start: 0, end: 4 });
    tick(2.2); // 4.4 → quay về 0.4
    expect(e.transport.getBeat()).toBeCloseTo(0.4, 6);
    e.applyFollow({ ...base, beat: 0.4, sentAt: nowMs, loop: null });
    expect(e.transport.loop).toBeNull();
    tick(4.2); // qua cuối bài
    expect(e.transport.playing).toBe(false);
    expect(e.getState().loops).toBe(0);
  });

  it('theo Player thì hủy đếm ngược riêng của overlay (đang tự chạy dở)', () => {
    const e = follower({ delaySec: 3 });
    e.play();
    expect(e.getState().countdown).toBe(3);
    e.applyFollow({ ...base, playing: false, beat: 2, sentAt: nowMs });
    expect(e.getState().countdown).toBeNull();
    vi.advanceTimersByTime(5000);
    expect(e.transport.playing).toBe(false);
  });

  it('followPause (mất Player): dừng tại chỗ, bỏ đếm ngược', () => {
    const e = follower();
    e.applyFollow({ ...base, beat: 1, sentAt: nowMs, countdownEndsAt: null });
    tick(0.5);
    e.followPause();
    expect(e.transport.playing).toBe(false);
    expect(e.transport.getBeat()).toBeCloseTo(2, 9);
    e.applyFollow({ ...base, playing: false, sentAt: nowMs, countdownEndsAt: nowMs + 2000 });
    e.followPause();
    expect(e.getState().countdown).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('OverlayEngine: frame đầu đếm vào trong lúc đếm ngược (R7-3)', () => {
  let render: MockInstance<(frame: RenderFrame) => void>;
  const last = (): RenderFrame => {
    const f = render.mock.calls.at(-1)?.[0];
    if (!f) throw new Error('chưa vẽ frame nào');
    return f;
  };
  let nowMs = 1_000_000;
  const base = {
    playing: true,
    beat: 0,
    bpm: 120,
    sentAt: 0,
    loop: null,
    countdownEndsAt: null,
    countIn: null,
  };

  /** Engine có canvas (renderer thật, context null) để đọc frame được vẽ. */
  function drawn(opts: Partial<OverlayEngineOptions> = {}): OverlayEngine {
    const e = new OverlayEngine(timeline(), {
      bpm: 120,
      countIn: true,
      loop: false,
      delaySec: 3,
      scheme: 'pc',
      mobileSemitone: 'toggle',
      clock,
      now: () => nowMs,
      ...opts,
    });
    e.attach({ canvas: document.createElement('canvas') });
    engines.push(e);
    flushFrames();
    return e;
  }

  beforeEach(() => {
    nowMs = 1_000_000;
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => null);
    render = vi.spyOn(TilesRenderer.prototype, 'render');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('tự chạy (link cũ): đếm ngược vẽ frame đầu đếm vào; hết đếm chạy tiếp từ đó; data-beat = beat đang vẽ', () => {
    const e = new OverlayEngine(timeline(), {
      bpm: 120,
      countIn: true,
      loop: false,
      delaySec: 3,
      scheme: 'pc',
      mobileSemitone: 'toggle',
      clock,
    });
    const stage = document.createElement('div');
    e.attach({ canvas: document.createElement('canvas'), stage });
    engines.push(e);
    flushFrames();
    expect(last().beat).toBe(0);
    e.play();
    expect(e.preRoll).toEqual({ start: -CI, end: 0 });
    flushFrames();
    // Khung đầu = khung đứng yên (không nhảy), rồi trượt mượt về frame đầu đếm vào (D-389).
    expect(last()).toMatchObject({ beat: 0, countIn: { start: -CI, end: 0 } });
    expect(stage.dataset.beat).toBe('0.000');
    advance(PRE_ROLL_GLIDE_SEC / 2);
    expect(Number(stage.dataset.beat)).toBeCloseTo(-CI / 2, 2);
    advance(PRE_ROLL_GLIDE_SEC / 2);
    expect(last()).toMatchObject({
      beat: -CI,
      countIn: { start: -CI, end: 0 },
      countInRemaining: CI,
    });
    expect(stage.dataset.beat).toBe('-2.600');
    expect(frames.size).toBe(0);
    expect(e.getState()).toMatchObject({ countdown: 3, noteIndex: 0, countingIn: false });
    vi.advanceTimersByTime(3000);
    expect(e.transport.playing).toBe(true);
    expect(e.preRoll).toBeNull();
    flushFrames();
    expect(last().beat).toBe(-CI);
    advance(0.5);
    expect(last().beat).toBeCloseTo(-CI + 1, 9);
  });

  it('Space trong lúc đếm ngược hủy → trượt về vị trí đứng; chạy lại (R) từ giữa bài → frame đầu đếm vào từ 0', () => {
    const e = drawn();
    e.play();
    settle();
    expect(last().beat).toBe(-CI);
    e.toggle(); // hủy đếm ngược
    expect(e.preRoll).toBeNull();
    flushFrames();
    expect(last().beat).toBe(-CI);
    advance(PRE_ROLL_GLIDE_SEC);
    expect(last()).toMatchObject({ beat: 0, countIn: null });
    e.nextLine(); // beat 4
    flushFrames();
    expect(last().beat).toBe(4);
    e.restart();
    expect(e.preRoll).toEqual({ start: -CI, end: 0 });
    // Từ giữa bài về đầu bài: xa hơn đoạn đếm vào → nhảy thẳng (chơi lại là nhảy có chủ ý).
    flushFrames();
    expect(last().beat).toBe(-CI);
    // Phát tiếp từ giữa bài: lùi đúng đoạn dẫn vào (65 %).
    e.pause();
    e.nextLine();
    e.play();
    expect(e.preRoll).toEqual({ start: 4 - CI, end: 4 });
  });

  it('countin=0: đếm ngược vẽ đúng vị trí bắt đầu', () => {
    const e = drawn({ countIn: false });
    e.play();
    expect(e.preRoll).toBeNull();
    flushFrames();
    expect(last()).toMatchObject({ beat: 0, countIn: null });
  });

  it('trang mini (prepare): đếm ngược của bộ điều khiển ngoài vẽ frame đầu đếm vào; play / restart / hủy', () => {
    const e = drawn({ delaySec: 0 });
    e.prepare('play');
    expect(e.preRoll).toEqual({ start: -CI, end: 0 });
    flushFrames();
    expect(last().beat).toBe(0);
    advance(PRE_ROLL_GLIDE_SEC);
    expect(last().beat).toBe(-CI);
    e.prepare(null);
    settle();
    expect(last().beat).toBe(0);
    // Đang ở giữa bài, chờ chơi lại từ đầu.
    e.nextLine();
    flushFrames();
    e.prepare('restart');
    expect(e.preRoll).toEqual({ start: -CI, end: 0 });
    e.restart(); // hết đếm của trang mini → chạy ngay (delaySec 0), từ đúng frame đó
    expect(e.preRoll).toBeNull();
    flushFrames();
    expect(last().beat).toBe(-CI);
    // Đang chạy: prepare bỏ qua.
    e.prepare('play');
    expect(e.preRoll).toBeNull();
  });

  it('theo Player: tin chưa phát kèm countIn (Player đang đếm ngược) → vẽ frame đầu đếm vào; Player phát → chạy từ đó', () => {
    const e = drawn({ delaySec: 0 });
    e.applyFollow({
      ...base,
      playing: false,
      beat: 0,
      sentAt: nowMs,
      countdownEndsAt: nowMs + 3000,
      countIn: { startBeat: -4, endBeat: 0 },
    });
    expect(e.getState().countdown).toBe(3);
    expect(e.preRoll).toEqual({ start: -4, end: 0 });
    // Trượt mượt như Player (stream không thấy cú nhảy lúc streamer bấm Phát).
    flushFrames();
    expect(last().beat).toBe(0);
    advance(PRE_ROLL_GLIDE_SEC);
    expect(last()).toMatchObject({ beat: -4, countIn: { start: -4, end: 0 } });
    // Player hết đếm ngược → phát kèm đếm vào.
    nowMs += 3000;
    vi.advanceTimersByTime(3000);
    e.applyFollow({ ...base, beat: -4, sentAt: nowMs, countIn: { startBeat: -4, endBeat: 0 } });
    expect(e.preRoll).toBeNull();
    flushFrames();
    expect(last().beat).toBe(-4);
    nowMs += 500;
    advance(0.5);
    expect(last().beat).toBeCloseTo(-3, 9);
    // Player dừng giữa lúc đếm vào (về điểm bắt đầu) → trượt về chỗ dừng như Player, không còn frame đầu đếm vào.
    e.applyFollow({ ...base, playing: false, beat: 0, sentAt: nowMs });
    flushFrames();
    expect(e.preRoll).toBeNull();
    expect(last().beat).toBeCloseTo(-3, 9);
    advance(PRE_ROLL_GLIDE_SEC);
    expect(last().beat).toBe(0);
    // Mất Player giữa lúc nó đếm ngược → bỏ frame đầu đếm vào.
    e.applyFollow({
      ...base,
      playing: false,
      beat: 0,
      sentAt: nowMs,
      countdownEndsAt: nowMs + 3000,
      countIn: { startBeat: -4, endBeat: 0 },
    });
    expect(e.preRoll).not.toBeNull();
    e.followPause();
    expect(e.preRoll).toBeNull();
  });

  it('theo Player: sentAt ở tương lai (Player chờ output latency) → overlay chờ đúng chừng đó rồi mới chạy', () => {
    const e = drawn({ delaySec: 0 });
    e.applyFollow({
      ...base,
      beat: -4,
      sentAt: nowMs + 300,
      countIn: { startBeat: -4, endBeat: 0 },
    });
    expect(e.transport.playing).toBe(true);
    clock.advance(0.2);
    expect(e.transport.getBeat()).toBe(-4);
    clock.advance(0.35); // 0.25 s sau lúc Player bắt đầu chạy
    expect(e.transport.getBeat()).toBeCloseTo(-3.5, 9);
    // Tin kế (heartbeat) khớp → không nhảy.
    nowMs += 550;
    const epoch = e.transport.epoch;
    e.applyFollow({
      ...base,
      beat: -4,
      sentAt: nowMs - 250,
      countIn: { startBeat: -4, endBeat: 0 },
    });
    expect(e.transport.epoch).toBe(epoch);
  });
});

describe('OverlayEngine: làm nóng keycap sáng (player/glowWarmup.ts, v1.0.1)', () => {
  it('attach đặt keycap làm nóng vào stage, tự gỡ sau DOM_WARMUP_MS; detach gỡ sớm', () => {
    const real = window.getComputedStyle.bind(window);
    // jsdom không đọc player.css: giả keycap sáng có drop-shadow như theme tối.
    const spy = vi.spyOn(window, 'getComputedStyle').mockImplementation((el: Element) => {
      const st = real(el);
      return el.classList.contains(DOM_WARMUP_CLASS)
        ? ({ ...st, filter: 'drop-shadow(rgb(0, 0, 0) 0px 0px 9px)' } as CSSStyleDeclaration)
        : st;
    });
    const stage = document.createElement('div');
    const e = new OverlayEngine(timeline(), {
      bpm: 120,
      countIn: true,
      loop: false,
      delaySec: 0,
      scheme: 'pc',
      mobileSemitone: 'toggle',
      clock,
    });
    engines.push(e);
    e.attach({ canvas: null, stage });
    expect(stage.querySelector(`.${DOM_WARMUP_CLASS}`)).not.toBeNull();
    vi.advanceTimersByTime(DOM_WARMUP_MS);
    expect(stage.querySelector(`.${DOM_WARMUP_CLASS}`)).toBeNull();
    e.detach();
    e.attach({ canvas: null, stage });
    expect(stage.querySelector(`.${DOM_WARMUP_CLASS}`)).not.toBeNull();
    e.detach();
    expect(stage.querySelector(`.${DOM_WARMUP_CLASS}`)).toBeNull();
    spy.mockRestore();
  });
});

/**
 * PlayerEngine với `hostWindow` ("Cửa sổ nổi"): vòng render, đếm ngược, ResizeObserver, matchMedia,
 * phím practice và nhịp bơm scheduler phải chạy trên cửa sổ chủ — không phải window chính (tab gốc
 * bị ẩn sau game). Không truyền hostWindow: hành vi cũ (usePlayerEngine.test.tsx).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getAudioEngine } from '../audio/engine';
import { FakeAudioContext } from '../audio/fakeAudioContext';
import { buildTimeline } from '../core/timeline';
import type { Note, NoteKey, Song } from '../core/types';
import { createFakePipWindow } from '../pip/testing/fakePipWindow';
import type { FakePipWindow } from '../pip/testing/fakePipWindow';
import { useSettings } from '../ui/settings';
import { useToasts } from '../ui/toast';
import { createManualClock } from './clock';
import type { ManualClock } from './clock';
import type { TilesRenderer } from './renderer';
import { HOST_PUMP_MS, PlayerEngine } from './usePlayerEngine';

const n = (key: NoteKey, beats = 1): Note => ({
  kind: 'note',
  key,
  octave: 0,
  sharp: false,
  beats,
});

const SONG: Song = {
  id: 'h',
  title: 'H',
  bpm: 120,
  timeSig: { num: 4, den: 4 },
  scrollDir: 1,
  sections: [{ name: 'A', lines: [{ units: [n('Z'), n('X'), n('C'), n('V')] }] }],
};
const TL = buildTimeline(SONG);

let clock: ManualClock;
let host: FakePipWindow;
let engines: PlayerEngine[] = [];
const globalRaf = vi.fn(() => 1);
const globalCaf = vi.fn();

function makeEngine(
  opts: { canvas?: boolean; rendererOptions?: Parameters<typeof makeOpts>[0] } = {},
): PlayerEngine {
  const e = new PlayerEngine(TL, SONG.bpm, makeOpts(opts.rendererOptions));
  engines.push(e);
  const canvas = opts.canvas ? host.doc.createElement('canvas') : null;
  if (canvas) host.doc.body.append(canvas);
  e.attach({ canvas });
  return e;
}

function makeOpts(rendererOptions?: { lanePadding?: 'none' | 'normal'; hitLinePos?: number }) {
  return { clock, hostWindow: host.win, rendererOptions };
}

const rendererOf = (e: PlayerEngine): TilesRenderer =>
  (e as unknown as { renderer: TilesRenderer }).renderer;

beforeEach(() => {
  host = createFakePipWindow();
  globalRaf.mockClear();
  globalCaf.mockClear();
  vi.stubGlobal('requestAnimationFrame', globalRaf);
  vi.stubGlobal('cancelAnimationFrame', globalCaf);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => null);
  useSettings.getState().reset();
  useSettings.getState().set({ audioEnabled: false, countIn: false, startDelaySec: 0 });
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

describe('PlayerEngine — hostWindow', () => {
  it("drives the render loop with the host window's requestAnimationFrame only", () => {
    const e = makeEngine({ canvas: true });
    expect(e.hostWindow).toBe(host.win);
    e.play();
    expect(e.transport.playing).toBe(true);
    expect(host.raf).toHaveBeenCalled();
    expect(globalRaf).not.toHaveBeenCalled();
    clock.advance(0.5);
    host.flushFrames();
    expect(e.transport.getBeat()).toBeCloseTo(1, 5);
    expect(e.getState().noteIndex).toBe(1); // frame của cửa sổ chủ đã đẩy state (nốt X ở beat 1)
    // Đang phát → mỗi frame xin frame kế trên cửa sổ chủ.
    expect(host.frames.size).toBe(1);
    e.pause();
    host.flushFrames(2);
    expect(host.frames.size).toBe(0);
    expect(globalRaf).not.toHaveBeenCalled();
  });

  it('runs the start countdown on the host timers and setStartDelay overrides settings', () => {
    vi.useFakeTimers();
    useSettings.getState().set({ startDelaySec: 0 });
    const e = makeEngine();
    e.setStartDelay(3);
    e.play();
    expect(e.getState().countdown).toBe(3);
    expect(e.getState().playing).toBe(true);
    expect(e.transport.playing).toBe(false);
    expect(host.setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 1000);
    vi.advanceTimersByTime(1000);
    expect(e.getState().countdown).toBe(2);
    vi.advanceTimersByTime(2000);
    expect(e.getState().countdown).toBeNull();
    expect(e.transport.playing).toBe(true);
  });

  it('clamps the delay override and falls back to settings with null', () => {
    vi.useFakeTimers();
    const e = makeEngine();
    e.setStartDelay(99);
    e.play();
    expect(e.getState().countdown).toBe(10);
    e.pause(); // hủy đếm ngược
    expect(e.getState().countdown).toBeNull();
    useSettings.getState().set({ startDelaySec: 0 });
    e.setStartDelay(null);
    e.play();
    expect(e.getState().countdown).toBeNull();
    expect(e.transport.playing).toBe(true);
  });

  it("observes the canvas with the host's ResizeObserver and disconnects on detach", () => {
    const e = makeEngine({ canvas: true });
    const ro = host.resizeObservers.find((o) => o.targets.size > 0);
    expect(ro).toBeDefined();
    e.detach();
    expect(ro?.disconnected).toBe(true);
  });

  it("falls back to the host window's resize event without ResizeObserver", () => {
    host = createFakePipWindow({ resizeObserver: false });
    const add = vi.spyOn(window, 'addEventListener');
    const e = makeEngine({ canvas: true });
    expect(host.listenerCount('resize')).toBe(1);
    expect(add.mock.calls.some(([type]) => type === 'resize')).toBe(false);
    e.detach();
    expect(host.listenerCount('resize')).toBe(0);
  });

  it("watches the host's devicePixelRatio with its matchMedia and stops on detach", () => {
    const e = makeEngine({ canvas: true });
    const mql = host.mediaQueries.find((q) => q.listeners.size > 0);
    expect(mql?.media).toBe('(resolution: 1dppx)');
    // DPR đổi (kéo cửa sổ sang màn khác) → vẽ lại, đăng ký query mới.
    for (const l of Array.from(mql?.listeners ?? [])) {
      if (typeof l === 'function') l(new Event('change'));
    }
    expect(mql?.listeners.size).toBe(0);
    expect(host.mediaQueries.filter((q) => q.listeners.size > 0)).toHaveLength(1);
    e.detach();
    expect(host.mediaQueries.every((q) => q.listeners.size === 0)).toBe(true);
  });

  it('merges fixed renderer options over settings and keeps them when settings change', () => {
    const e = makeEngine({
      canvas: true,
      rendererOptions: { lanePadding: 'none', hitLinePos: 0.97 },
    });
    expect(rendererOf(e).options.lanePadding).toBe('none');
    expect(rendererOf(e).options.hitLinePos).toBeCloseTo(0.97);
    useSettings.getState().set({ theme: 'light', tileScale: 1.25 });
    expect(rendererOf(e).options.theme).toBe('light');
    expect(rendererOf(e).options.tileScale).toBe(1.25);
    expect(rendererOf(e).options.lanePadding).toBe('none');
    expect(rendererOf(e).options.hitLinePos).toBeCloseTo(0.97);
  });

  it('attaches practice keyboard listeners to the host window and removes them on detach', () => {
    const add = vi.spyOn(window, 'addEventListener');
    const e = makeEngine();
    e.setPractice(true);
    expect(host.listenerCount('keydown')).toBeGreaterThan(0);
    expect(add.mock.calls.some(([type]) => type === 'keydown')).toBe(false);
    e.detach();
    expect(host.listenerCount('keydown')).toBe(0);
    expect(host.listenerCount('keyup')).toBe(0);
  });

  it('cancels the pending host frame and leaves no timers on detach', () => {
    vi.useFakeTimers();
    const e = makeEngine({ canvas: true });
    e.setStartDelay(5);
    e.play();
    e.detach();
    expect(host.frames.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    expect(host.liveIntervals.size).toBe(0);
  });

  describe('audio', () => {
    class SuspendedCtx extends FakeAudioContext {
      constructor() {
        super({ state: 'suspended', resume: 'resolve' });
      }
    }

    it('creates no AudioContext when melody and clicks are off', () => {
      const e = makeEngine();
      e.play();
      expect(getAudioEngine().context).toBeNull();
      expect(e.getState().audio).toBe('off');
      expect(host.liveIntervals.size).toBe(0);
    });

    it('pumps the scheduler with a host interval only while playing with sound', async () => {
      vi.stubGlobal('AudioContext', SuspendedCtx);
      useSettings.getState().set({ audioEnabled: true });
      const e = makeEngine();
      e.play();
      await vi.waitFor(() => expect(e.audioActive).toBe(true));
      expect(e.transport.playing).toBe(true);
      expect(host.setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), HOST_PUMP_MS);
      expect(host.liveIntervals.size).toBe(1);
      const poke = vi.spyOn(
        (e as unknown as { scheduler: { poke: () => void } }).scheduler,
        'poke',
      );
      const pump = host.setIntervalSpy.mock.calls[0]?.[0] as () => void;
      pump();
      expect(poke).toHaveBeenCalled();
      e.pause();
      expect(host.liveIntervals.size).toBe(0);
      e.play();
      expect(host.liveIntervals.size).toBe(1);
      e.detach();
      expect(host.liveIntervals.size).toBe(0);
    });
  });
});

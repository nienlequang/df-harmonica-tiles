import { StrictMode, useRef } from 'react';
import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UNLOCK_TIMEOUT_MS, getAudioEngine } from '../audio/engine';
import { FakeAudioContext } from '../audio/fakeAudioContext';
import { ANDROID_UA, fakeUserAgent, installFakeAudioSession } from '../audio/fakePlaybackEnv';
import type { FakeAudioSessionHandle } from '../audio/fakePlaybackEnv';
import { buildTimeline } from '../core/timeline';
import type { Note, NoteKey, Octave, Song } from '../core/types';
import { useSettings } from '../ui/settings';
import { useToasts } from '../ui/toast';
import { createManualClock } from './clock';
import type { ManualClock } from './clock';
import type { PracticeInputEvent } from './practice.types';
import { PRE_ROLL_GLIDE_SEC } from './preRollGlide';
import { TilesRenderer } from './renderer';
import {
  AUDIO_RETRY_EVENTS,
  PlayerEngine,
  formatBpm,
  formatClock,
  lineStartFromParam,
  resetAudioHintForTests,
  usePlayerEngine,
  usePlayerState,
} from './usePlayerEngine';

// ---------------------------------------------------------------------------
// Bài test: 120 BPM (0.5 s/beat), 4/4.
//   A    line0 [0,4)  Z X C V             lời "do re mi fa" (karaoke từng chữ)
//        line1 [4,8)  R:N R:N _*2         lời "la la"   → hold run 0 = [4,6)
//   Rỗng (section không có dòng)
//   B    line2 [8,12) S:V Z*3                            → hold run 1 = [8,9)
// ---------------------------------------------------------------------------

const n = (key: NoteKey, beats = 1, octave: Octave = 0, sharp = false): Note => ({
  kind: 'note',
  key,
  octave,
  sharp,
  beats,
});

const SONG: Song = {
  id: 't',
  title: 'T',
  bpm: 120,
  timeSig: { num: 4, den: 4 },
  scrollDir: 1,
  sections: [
    {
      name: 'A',
      lines: [
        { units: [n('Z'), n('X'), n('C'), n('V')] },
        { units: [n('N', 1, 1), n('N', 1, 1), { kind: 'rest', beats: 2 }] },
      ],
    },
    { name: 'Rỗng', lines: [] },
    { name: 'B', lines: [{ units: [n('V', 1, 0, true), n('Z', 3)] }] },
  ],
};

const TL = buildTimeline(SONG);
/** Đếm vào từ một beat nguyên của bài này (nốt ở mọi beat): 0,65 ô nhịp = 2,6 beat (leadIn.ts, v1.0.1). */
const CI = 2.6;

// rAF giả: hàng đợi chạy tay.
let frames = new Map<number, FrameRequestCallback>();
let nextFrame = 1;
const raf = vi.fn((cb: FrameRequestCallback) => {
  const id = nextFrame++;
  frames.set(id, cb);
  return id;
});
const caf = vi.fn((id: number) => {
  frames.delete(id);
});
function flushFrames(count = 1): void {
  for (let i = 0; i < count; i++) {
    const list = Array.from(frames.values());
    frames.clear();
    for (const cb of list) cb(0);
  }
}

let clock: ManualClock;
let engines: PlayerEngine[] = [];

function makeEngine(opts: { initialBeat?: number; canvas?: HTMLCanvasElement | null } = {}) {
  const e = new PlayerEngine(TL, SONG.bpm, { clock, initialBeat: opts.initialBeat });
  engines.push(e);
  e.attach({ canvas: opts.canvas ?? null });
  return e;
}

/** Tiến clock rồi chạy 1 frame. */
function tick(engine: PlayerEngine, sec: number): void {
  clock.advance(sec);
  flushFrames();
  expect(engine.isAttached).toBe(true);
}

beforeEach(() => {
  frames = new Map();
  nextFrame = 1;
  raf.mockClear();
  caf.mockClear();
  vi.stubGlobal('requestAnimationFrame', raf);
  vi.stubGlobal('cancelAnimationFrame', caf);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => null);
  useSettings.getState().reset();
  // mặc định v4 đếm ngược 3 giây — các test transport cần phát ngay (test đếm ngược tự đặt giá trị)
  useSettings.getState().set({ audioEnabled: false, startDelaySec: 0 });
  useToasts.setState({ toasts: [] });
  resetAudioHintForTests();
  clock = createManualClock(100);
});

afterEach(() => {
  for (const e of engines) e.detach();
  engines = [];
  getAudioEngine().dispose();
  vi.unstubAllGlobals();
});

describe('helpers', () => {
  it('formatClock floors to m:ss; formatBpm trims', () => {
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(59.99)).toBe('0:59');
    expect(formatClock(61)).toBe('1:01');
    expect(formatClock(Number.NaN)).toBe('0:00');
    expect(formatBpm(76)).toBe('76');
    expect(formatBpm(76.5)).toBe('76.5');
  });

  it('lineStartFromParam reads a 0-based line index', () => {
    expect(lineStartFromParam(TL, '1')).toBe(4);
    expect(lineStartFromParam(TL, '2')).toBe(8);
    expect(lineStartFromParam(TL, '9')).toBe(0);
    expect(lineStartFromParam(TL, 'x')).toBe(0);
    expect(lineStartFromParam(TL, null)).toBe(0);
  });
});

describe('PlayerEngine — transport wiring', () => {
  it('starts paused at beat 0 with the first note at the hit line', () => {
    const e = makeEngine();
    const s = e.getState();
    expect(s.playing).toBe(false);
    expect(s.beat).toBe(0);
    expect(s.bpm).toBe(120);
    expect(s.noteIndex).toBe(0);
    expect(s.lineIndex).toBe(0);
    expect(s).not.toHaveProperty('syllableIndex');
    expect(s.sectionIndex).toBe(0);
    expect(s.audio).toBe('off');
    expect(e.transport.endBeat).toBe(12);
  });

  it('initialBeat positions the transport', () => {
    const e = makeEngine({ initialBeat: 8 });
    expect(e.transport.getBeat()).toBe(8);
    expect(e.getState().sectionIndex).toBe(2);
  });

  it('play counts in (0.65 bar lead-in, UI shows the start point), then runs', () => {
    const e = makeEngine();
    e.play();
    expect(e.transport.playing).toBe(true);
    expect(e.transport.countIn).toEqual({ start: -CI, end: 0 });
    let s = e.getState();
    expect(s.playing).toBe(true);
    expect(s.countingIn).toBe(true);
    expect(s.beat).toBe(0);
    expect(s.noteIndex).toBe(0); // nốt cần bấm đầu tiên
    expect(raf).toHaveBeenCalled();

    tick(e, 1); // beat -0.6
    expect(e.transport.getBeat()).toBeCloseTo(-CI + 2);
    expect(e.getState().countingIn).toBe(true);

    tick(e, 0.55); // beat 0.5
    s = e.getState();
    expect(s.countingIn).toBe(false);
    expect(s.noteIndex).toBe(0);
    expect(s.beat).toBeCloseTo(0.5);

    tick(e, 1); // beat 2.5
    expect(e.getState().noteIndex).toBe(2);
  });

  it('plays without count-in when the setting is off', () => {
    useSettings.getState().set({ countIn: false });
    const e = makeEngine();
    e.play();
    expect(e.transport.countIn).toBeNull();
    tick(e, 0.5);
    expect(e.transport.getBeat()).toBeCloseTo(1);
  });

  it('pausing during the count-in returns to the intended start, not into the count bar', () => {
    const e = makeEngine({ initialBeat: 4 });
    e.play();
    tick(e, 0.75); // beat 1.5 (đang đếm vào trước beat 4)
    e.pause();
    expect(e.transport.playing).toBe(false);
    expect(e.transport.getBeat()).toBe(4);
    expect(e.getState().countingIn).toBe(false);
    expect(e.getState().beat).toBe(4);
  });

  it('toggle / restart', () => {
    useSettings.getState().set({ countIn: false });
    const e = makeEngine();
    e.toggle();
    tick(e, 2); // beat 4
    e.toggle();
    expect(e.transport.playing).toBe(false);
    expect(e.transport.getBeat()).toBeCloseTo(4);
    e.restart();
    expect(e.transport.playing).toBe(true);
    expect(e.transport.getBeat()).toBe(0);
    useSettings.getState().set({ countIn: true });
    e.restart();
    expect(e.transport.getBeat()).toBe(-CI);
    expect(e.getState().beat).toBe(0);
  });

  it('end of song pauses at endBeat; the next play starts over', () => {
    useSettings.getState().set({ countIn: false });
    const e = makeEngine({ initialBeat: 11 });
    e.play();
    tick(e, 1); // beat 13 > 12
    expect(e.transport.playing).toBe(false);
    expect(e.getState().playing).toBe(false);
    expect(e.getState().beat).toBe(12);
    e.play();
    expect(e.transport.getBeat()).toBe(0);
  });

  it('←/→ seek by line, → never jumps past the last line', () => {
    const e = makeEngine();
    e.nextLine();
    expect(e.transport.getBeat()).toBe(4);
    e.nextLine();
    expect(e.transport.getBeat()).toBe(8);
    e.nextLine();
    expect(e.transport.getBeat()).toBe(8);
    e.prevLine(); // đúng đầu dòng → về dòng trước
    expect(e.transport.getBeat()).toBe(4);
    e.seek(5.5); // giữa dòng 1, quá ngưỡng ~0.6 s (1.2 beat) → về đầu dòng
    e.prevLine();
    expect(e.transport.getBeat()).toBe(4);
    e.prevLine();
    expect(e.transport.getBeat()).toBe(0);
    e.prevLine();
    expect(e.transport.getBeat()).toBe(0);
  });

  it('seeking while playing keeps playing; during count-in → is relative to the start', () => {
    const e = makeEngine();
    e.play(); // count-in [-4, 0)
    e.nextLine();
    expect(e.transport.playing).toBe(true);
    expect(e.transport.getBeat()).toBe(4);
    tick(e, 0.5);
    expect(e.transport.getBeat()).toBeCloseTo(5);
    e.seekSection(2);
    expect(e.transport.playing).toBe(true);
    expect(e.transport.getBeat()).toBe(8);
  });

  it('exposes the hold run and the note at the hit line', () => {
    const e = makeEngine();
    e.seek(4.5);
    expect(e.getState().noteIndex).toBe(4);
    expect(e.getState().runIndex).toBe(0);
    e.seek(6.5); // rest
    expect(e.getState().noteIndex).toBe(-1);
    expect(e.getState().runIndex).toBe(-1);
    expect(e.getState().lineIndex).toBe(1);
    e.seek(8.5);
    expect(e.getState().runIndex).toBe(1);
    expect(e.getState().sectionIndex).toBe(2);
  });

  it('L cycles A → A–B (loop on transport, order-independent) → off', () => {
    const e = makeEngine({ initialBeat: 4 });
    e.cycleLoop();
    expect(e.getState().loop).toEqual({ a: 1, b: null });
    expect(e.transport.loop).toBeNull();
    e.seek(1);
    e.cycleLoop();
    expect(e.getState().loop).toEqual({ a: 0, b: 1 });
    expect(e.transport.loop).toEqual({ start: 0, end: 8 });
    e.cycleLoop();
    expect(e.getState().loop).toBeNull();
    expect(e.transport.loop).toBeNull();
  });

  it('a loop wraps while playing', () => {
    useSettings.getState().set({ countIn: false });
    const e = makeEngine();
    e.cycleLoop();
    e.cycleLoop(); // loop dòng 0 = [0, 4)
    e.play();
    tick(e, 2.25); // 4.5 beat → wrap về 0.5
    expect(e.transport.playing).toBe(true);
    expect(e.transport.getBeat()).toBeCloseTo(0.5);
    expect(e.getState().lineIndex).toBe(0);
  });

  it('passes the count-in range and the wrapping loop to the renderer (ui-1 / ui-2)', () => {
    const render = vi.spyOn(TilesRenderer.prototype, 'render');
    const last = () => render.mock.calls[render.mock.calls.length - 1][0];
    const e = makeEngine({ canvas: document.createElement('canvas') });

    e.play(); // đếm vào [-2.6, 0)
    flushFrames();
    expect(last().countIn).toEqual({ start: -CI, end: 0 });
    // Khung đầu sau khi bấm = khung đứng yên (D-389), phần bù mờ dần trong PRE_ROLL_GLIDE_SEC.
    expect(last().beat).toBeCloseTo(0);
    tick(e, PRE_ROLL_GLIDE_SEC);
    expect(last().beat).toBeCloseTo(e.transport.getBeat(), 9);
    expect(last().countInRemaining).toBeCloseTo(CI - 2 * PRE_ROLL_GLIDE_SEC);
    tick(e, (CI + 0.5) / 2 - PRE_ROLL_GLIDE_SEC); // beat 0.5: hết đếm vào
    expect(last().countIn).toBeNull();
    expect(last().countInRemaining).toBeNull();
    expect(last().loop).toBeNull();
    e.pause();

    e.seek(1);
    e.cycleLoop();
    e.cycleLoop(); // loop dòng 0 = [0, 4); playhead 1 < loop end → transport sẽ wrap
    flushFrames();
    expect(last().loop).toEqual({ start: 0, end: 4 });

    // Phát từ loop end (đếm vào chạy trong [1.4, 4) nhưng transport không wrap): vẽ như không loop.
    e.seek(4);
    e.play();
    flushFrames();
    expect(e.transport.countIn).toEqual({ start: 4 - CI, end: 4 });
    expect(last().countIn).toEqual({ start: 4 - CI, end: 4 });
    expect(last().loop).toBeNull();
  });

  it('BPM override: [ ] step 2 within 40..200, back to the song tempo clears it', () => {
    const e = makeEngine();
    e.stepBpm(2);
    expect(e.transport.bpm).toBe(122);
    expect(e.getState().bpmOverride).toBe(122);
    e.stepBpm(-2);
    expect(e.transport.bpm).toBe(120);
    expect(e.getState().bpmOverride).toBeNull();
    e.setBpmOverride(500);
    expect(e.transport.bpm).toBe(200);
    e.stepBpm(2);
    expect(e.transport.bpm).toBe(200);
    e.setBpmOverride(10);
    expect(e.transport.bpm).toBe(40);
    e.stepBpm(-2);
    expect(e.transport.bpm).toBe(40);
    e.setBpmOverride(null);
    expect(e.transport.bpm).toBe(120);
    expect(e.getState().bpm).toBe(120);
  });

  it('changing BPM mid-play does not move the playhead', () => {
    useSettings.getState().set({ countIn: false });
    const e = makeEngine();
    e.play();
    tick(e, 1); // beat 2
    e.setBpmOverride(60);
    expect(e.transport.getBeat()).toBeCloseTo(2);
    tick(e, 1); // 60 BPM → +1 beat
    expect(e.transport.getBeat()).toBeCloseTo(3);
  });

  it('setSongBpm follows the song unless overridden', () => {
    const e = makeEngine();
    e.setSongBpm(90);
    expect(e.transport.bpm).toBe(90);
    e.setBpmOverride(100);
    e.setSongBpm(80);
    expect(e.transport.bpm).toBe(100);
  });

  it('setTimeline (base octave / scroll dir change) keeps the position', () => {
    const e = makeEngine({ initialBeat: 8.5 });
    const tl2 = buildTimeline(SONG, { scrollDir: -1, baseOctave: 3 });
    e.setTimeline(tl2);
    expect(e.timeline).toBe(tl2);
    expect(e.transport.getBeat()).toBe(8.5);
    expect(e.getState().runIndex).toBe(1);
  });

  it('progress reaches React at ~10 Hz, not 60 Hz', () => {
    useSettings.getState().set({ countIn: false });
    let ms = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => ms);
    const e = makeEngine();
    e.play();
    const listener = vi.fn();
    const unsub = e.subscribe(listener);
    for (let i = 0; i < 60; i++) {
      ms += 1000 / 60;
      clock.advance(1 / 60);
      flushFrames();
    }
    unsub();
    expect(e.transport.getBeat()).toBeCloseTo(2);
    // ~10 lần cập nhật tiến độ + vài lần đổi nốt/chữ (2 nốt) — xa dưới 60.
    expect(listener.mock.calls.length).toBeGreaterThanOrEqual(6);
    expect(listener.mock.calls.length).toBeLessThanOrEqual(16);
    expect(e.getState().beat).toBeGreaterThan(1.7);
  });

  it('does nothing for a song without notes', () => {
    const empty = buildTimeline({ ...SONG, sections: [{ name: 'Main', lines: [] }] });
    const e = new PlayerEngine(empty, 90, { clock });
    engines.push(e);
    e.attach({ canvas: null });
    e.play();
    e.restart();
    expect(e.transport.playing).toBe(false);
    e.cycleLoop();
    expect(e.getState().loop).toBeNull();
  });
});

describe('PlayerEngine — demo (instantStart), ended, mobile state', () => {
  it('instantStart ignores count-in and the start delay (Play and Restart start immediately)', () => {
    useSettings.getState().set({ countIn: true, startDelaySec: 5 });
    const e = new PlayerEngine(TL, SONG.bpm, { clock, instantStart: true });
    engines.push(e);
    e.attach({ canvas: null });
    e.play();
    expect(e.transport.playing).toBe(true);
    expect(e.transport.getBeat()).toBe(0);
    expect(e.getState().countdown).toBeNull();
    expect(e.getState().countingIn).toBe(false);
    tick(e, 1);
    e.restart();
    expect(e.transport.getBeat()).toBe(0);
    expect(e.getState().countdown).toBeNull();
    // Engine thường vẫn đếm ngược.
    const normal = makeEngine();
    normal.play();
    expect(normal.getState().countdown).toBe(5);
    expect(normal.transport.playing).toBe(false);
  });

  it('ended is true only while stopped at the end of the song', () => {
    useSettings.getState().set({ countIn: false });
    const e = makeEngine({ initialBeat: 11 });
    expect(e.getState().ended).toBe(false);
    e.play();
    expect(e.getState().ended).toBe(false);
    tick(e, 1);
    expect(e.getState().ended).toBe(true);
    e.seek(0);
    expect(e.getState().ended).toBe(false);
  });

  it('PC scheme: no mobile state', () => {
    const e = makeEngine();
    expect(e.getState().mobile).toBeNull();
  });

  it('mobile scheme: mode / Nửa Cung at the hit line latch across rests; cues soon ~1 beat ahead', () => {
    useSettings
      .getState()
      .set({ controlScheme: 'mobile', mobileSemitone: 'toggle', countIn: false });
    const e = makeEngine();
    const m = () => {
      const s = e.getState().mobile;
      if (!s) throw new Error('mobile state missing');
      return s;
    };
    expect(m().mode).toBe(0);
    expect(m().semitoneOn).toBe(false);
    expect(m().nextCues.map((c) => [c.beat, c.kind])).toEqual([[4, 'octave']]);
    expect(m().cueSoon).toBe(false);
    // Phát liền một mạch (120 BPM = 0.5 s / beat).
    e.play();
    tick(e, 1.75); // beat 3.5
    expect(m().cueSoon).toBe(true);
    tick(e, 0.25); // beat 4
    expect(m().mode).toBe(1);
    // Beat 8: về Ngẩng Tự Nhiên + bật Nửa Cung cùng lúc (quãng trước, Nửa Cung sau).
    expect(m().nextCues.map((c) => [c.beat, c.kind])).toEqual([
      [8, 'octave'],
      [8, 'semitone'],
    ]);
    tick(e, 1.25); // beat 6.5 — rest: chế độ vẫn giữ
    expect(m().mode).toBe(1);
    expect(m().cueSoon).toBe(false);
    tick(e, 0.35); // beat 7.2
    expect(m().cueSoon).toBe(true);
    tick(e, 0.4); // beat 8
    expect(m().mode).toBe(0);
    expect(m().semitoneOn).toBe(true);
    // Đổi về PC → null.
    useSettings.getState().set({ controlScheme: 'pc' });
    expect(e.getState().mobile).toBeNull();
  });

  describe('mobile: chế độ game giữ qua các lần phát (cue vào lại)', () => {
    // line0 [0,4) Z X C V tự nhiên · line1 [4,8) N M N M Cúi Xuống → hết bài ở Cúi Xuống.
    const DOWN: Song = {
      id: 'down',
      title: 'Down',
      bpm: 120,
      timeSig: { num: 4, den: 4 },
      scrollDir: 1,
      sections: [
        {
          name: 'A',
          lines: [
            { units: [n('Z'), n('X'), n('C'), n('V')] },
            { units: [n('N', 1, -1), n('M', 1, -1), n('N', 1, -1), n('M', 1, -1)] },
          ],
        },
      ],
    };
    const DOWN_TL = buildTimeline(DOWN);
    const cues = (e: PlayerEngine) =>
      (e.getState().mobile?.nextCues ?? []).map((c) => [
        c.beat,
        c.noteIndex,
        c.kind === 'octave' ? c.mode : c.on,
      ]);
    function mobileEngine() {
      useSettings.getState().set({
        controlScheme: 'mobile',
        mobileSemitone: 'toggle',
        countIn: false,
        startDelaySec: 0,
      });
      const e = new PlayerEngine(DOWN_TL, DOWN.bpm, { clock });
      engines.push(e);
      e.attach({ canvas: null });
      return e;
    }

    it('chạy lại / phát lại sau khi hết bài: nhắc chạm Ngẩng Tự Nhiên ở nốt 0', () => {
      for (const again of ['restart', 'play'] as const) {
        const e = mobileEngine();
        e.play();
        tick(e, 4.5); // hết bài, đang ở Cúi Xuống
        expect(e.getState().ended).toBe(true);
        expect(e.getState().mobile?.mode).toBe(-1);
        if (again === 'restart') e.restart();
        else e.play();
        expect(e.transport.getBeat()).toBe(0);
        // Người chơi vẫn đang chọn Cúi Xuống → lần chạm kế: Ngẩng Tự Nhiên tại nốt 0, ngay bây giờ.
        expect(e.getState().mobile).toMatchObject({ mode: -1, cueSoon: true });
        expect(cues(e)).toEqual([[0, 0, 0]]);
        tick(e, 0.25); // beat 0.5 — đã qua nốt 0
        expect(e.getState().mobile?.mode).toBe(0);
        expect(cues(e)).toEqual([[4, 4, -1]]);
      }
    });

    it('lần phát đầu từ beat 0: không có cue thừa (kế hoạch giả định Ngẩng Tự Nhiên)', () => {
      const e = mobileEngine();
      expect(e.getState().mobile).toMatchObject({ mode: 0, cueSoon: false });
      expect(cues(e)).toEqual([[4, 4, -1]]);
    });

    it('nhảy khi đang dừng: giữ chế độ đang chọn, nhắc chạm ở nốt đầu từ chỗ mới', () => {
      const e = mobileEngine();
      e.seek(4); // chưa chơi gì: vẫn Ngẩng Tự Nhiên
      expect(e.getState().mobile).toMatchObject({ mode: 0, cueSoon: true });
      expect(cues(e)).toEqual([[4, 4, -1]]);
      e.seek(6); // nhảy tiếp khi vẫn chưa chơi
      expect(e.getState().mobile?.mode).toBe(0);
      expect(cues(e)).toEqual([[6, 6, -1]]);
      e.play();
      tick(e, 0.25);
      expect(e.getState().mobile?.mode).toBe(-1);
      expect(cues(e)).toEqual([]);
      // Đang ở Cúi Xuống, quay về dòng đầu → chạm Ngẩng Tự Nhiên ở nốt 0.
      e.seek(0);
      expect(e.getState().mobile?.mode).toBe(-1);
      expect(cues(e)).toEqual([[0, 0, 0]]);
    });

    it('loop A-B: SẮP CHẠM không báo cue ngoài vòng; vòng sau nhắc về chế độ nốt đầu vòng', () => {
      const e = mobileEngine();
      e.cycleLoop();
      e.cycleLoop(); // loop dòng 0 = [0, 4); cue Cúi Xuống @4 nằm ngoài vòng
      e.play();
      tick(e, 1.75); // beat 3.5
      expect(e.getState().mobile).toMatchObject({ mode: 0, cueSoon: false });
      expect(cues(e)).toEqual([]);

      const f = mobileEngine();
      f.cycleLoop(); // A = dòng 0
      f.play();
      tick(f, 2.5); // beat 5
      f.cycleLoop(); // B = dòng 1 → loop [0, 8)
      tick(f, 1.25); // beat 7.5: vòng kế bắt đầu ở nốt 0 (tự nhiên) khi đang Cúi Xuống
      expect(f.getState().mobile).toMatchObject({ mode: -1, cueSoon: true });
      expect(cues(f)).toEqual([[0, 0, 0]]);
      tick(f, 0.25); // beat 8 → wrap về beat 0
      expect(f.transport.getBeat()).toBe(0);
      expect(f.getState().mobile?.mode).toBe(-1);
      expect(cues(f)).toEqual([[0, 0, 0]]);
      tick(f, 0.25);
      expect(f.getState().mobile?.mode).toBe(0);
      expect(cues(f)).toEqual([[4, 4, -1]]);
    });

    it('renderer nhận cue vào lại của lượt hiện tại', () => {
      const e = mobileEngine();
      const spy = vi.spyOn(TilesRenderer.prototype, 'render');
      e.detach();
      e.attach({ canvas: document.createElement('canvas') });
      e.play();
      tick(e, 4.5);
      e.restart();
      flushFrames();
      const frame = spy.mock.calls.at(-1)?.[0];
      expect(frame?.mobileEntry).toMatchObject({ beat: 0, noteIndex: 0, latch: { mode: -1 } });
      expect(frame?.mobileEntry?.cues.map((c) => c.kind)).toEqual(['octave']);
      spy.mockRestore();
    });
  });

  it('mobile state object is reused between frames when nothing changed', () => {
    useSettings.getState().set({ controlScheme: 'mobile', countIn: false });
    const e = makeEngine();
    e.play();
    const first = e.getState().mobile;
    tick(e, 0.25); // beat 0.5 — chưa tới vùng "sắp chạm"
    expect(e.getState().mobile).toBe(first);
  });
});

describe('PlayerEngine — lifecycle', () => {
  it('detach cancels the frame loop, removes listeners and can re-attach', () => {
    const add = vi.spyOn(window, 'addEventListener');
    const remove = vi.spyOn(window, 'removeEventListener');
    const canvas = document.createElement('canvas');
    const e = makeEngine({ canvas });
    e.play();
    expect(frames.size).toBe(1);
    const pending = Array.from(frames.keys())[0];
    e.detach();
    expect(caf).toHaveBeenCalledWith(pending);
    expect(frames.size).toBe(0);
    expect(e.transport.playing).toBe(false);
    const count = (spy: typeof add, type: string) =>
      spy.mock.calls.filter((c) => c[0] === type).length;
    expect(count(add, 'resize')).toBe(count(remove, 'resize'));

    // Sau detach: settings/transport không còn tác động.
    const listener = vi.fn();
    e.subscribe(listener);
    useSettings.getState().set({ lookahead: 10 });
    e.transport.seek(3);
    expect(listener).not.toHaveBeenCalled();
    expect(frames.size).toBe(0);

    // attach lại (StrictMode mount lần 2).
    e.attach({ canvas });
    expect(e.isAttached).toBe(true);
    e.seek(4);
    expect(e.getState().lineIndex).toBe(1);
  });

  it('uses ResizeObserver when available and disconnects it', () => {
    const observe = vi.fn();
    const disconnect = vi.fn();
    class FakeRO {
      constructor(public cb: ResizeObserverCallback) {}
      observe = observe;
      unobserve = vi.fn();
      disconnect = disconnect;
    }
    vi.stubGlobal('ResizeObserver', FakeRO);
    const canvas = document.createElement('canvas');
    const e = makeEngine({ canvas });
    expect(observe).toHaveBeenCalledWith(canvas);
    e.detach();
    expect(disconnect).toHaveBeenCalledTimes(1);
  });

  it('settings changes update renderer options live', () => {
    const setOptions = vi.spyOn(TilesRenderer.prototype, 'setOptions');
    makeEngine({ canvas: document.createElement('canvas') });
    useSettings.getState().set({ lookahead: 11, theme: 'light', tileScale: 1.25 });
    expect(setOptions).toHaveBeenLastCalledWith(
      expect.objectContaining({ lookahead: 11, theme: 'light', tileScale: 1.25 }),
    );
  });

  it('usePlayerEngine survives StrictMode double mount and cleans up on unmount', () => {
    function Harness() {
      const canvasRef = useRef<HTMLCanvasElement>(null);
      const engine = usePlayerEngine({ timeline: TL, songBpm: 120, canvasRef });
      const line = usePlayerState(engine, (s) => s.lineIndex);
      return (
        <>
          <canvas ref={canvasRef} />
          <button type="button" onClick={() => engine.nextLine()}>
            next
          </button>
          <output>{line}</output>
        </>
      );
    }
    const { getByRole, container, unmount } = render(
      <StrictMode>
        <Harness />
      </StrictMode>,
    );
    expect(container.querySelector('output')?.textContent).toBe('0');
    act(() => getByRole('button').click());
    expect(container.querySelector('output')?.textContent).toBe('1');
    unmount();
    expect(frames.size).toBe(0);
  });
});

describe('PlayerEngine — audio', () => {
  /** AudioContext giả bắt đầu ở trạng thái suspended như trình duyệt thật. */
  class SuspendedCtx extends FakeAudioContext {
    constructor() {
      super({ state: 'suspended', resume: 'resolve' });
    }
  }
  class BlockedCtx extends FakeAudioContext {
    constructor() {
      super({ state: 'suspended', resume: 'reject' });
    }
  }

  it('unlocks on the first Play gesture, switches to the audio clock and starts the scheduler', async () => {
    vi.stubGlobal('AudioContext', SuspendedCtx);
    useSettings.getState().set({ audioEnabled: true, countIn: false });
    const e = makeEngine();
    expect(e.getState().audio).toBe('idle');
    expect(getAudioEngine().context).toBeNull(); // chưa tạo AudioContext trước gesture
    e.play();
    // Chờ unlock rồi mới chạy transport (bắt đầu thẳng trên audio clock); UI đã hiện "đang phát".
    expect(e.transport.playing).toBe(false);
    expect(e.getState().playing).toBe(true);
    expect(e.getState().audio).toBe('starting');
    await vi.waitFor(() => expect(e.audioActive).toBe(true));
    expect(e.transport.clock.kind).toBe('audio');
    expect(e.transport.playing).toBe(true);
    expect(e.getState().audio).toBe('on');

    // Tắt âm thanh → về performance clock, giữ vị trí.
    const ctx = getAudioEngine().context as unknown as FakeAudioContext;
    ctx.advance(0.5);
    const before = e.transport.getBeat();
    e.setAudioEnabled(false);
    expect(e.audioActive).toBe(false);
    expect(e.transport.clock.kind).toBe('performance');
    expect(e.transport.getBeat()).toBeCloseTo(before);
    expect(e.getState().audio).toBe('off');
  });

  it('falls back to performance clock when the context gets suspended', async () => {
    vi.stubGlobal('AudioContext', SuspendedCtx);
    useSettings.getState().set({ audioEnabled: true });
    const e = makeEngine();
    e.play();
    await vi.waitFor(() => expect(e.audioActive).toBe(true));
    const ctx = getAudioEngine().context as unknown as FakeAudioContext;
    ctx.setState('suspended');
    expect(e.audioActive).toBe(false);
    expect(e.transport.clock.kind).toBe('performance');
    expect(e.transport.playing).toBe(true);
    expect(e.getState().audio).toBe('idle');
  });

  it('applies volumes / timbre from settings', () => {
    vi.stubGlobal('AudioContext', SuspendedCtx);
    useSettings.getState().set({ audioEnabled: true });
    makeEngine();
    const eng = getAudioEngine();
    const setMusic = vi.spyOn(eng, 'setMusicVolume');
    const setTimbre = vi.spyOn(eng, 'setTimbre');
    useSettings.getState().set({ musicVolume: 0.3, timbre: 'sine' });
    expect(setMusic).toHaveBeenCalledWith(0.3);
    expect(setTimbre).toHaveBeenCalledWith('sine');
  });

  it('blocked audio keeps visuals running and toasts only once', async () => {
    vi.stubGlobal('AudioContext', BlockedCtx);
    useSettings.getState().set({ audioEnabled: true, countIn: false });
    const e = makeEngine();
    e.play();
    await vi.waitFor(() => expect(e.getState().audio).toBe('blocked'));
    expect(e.transport.playing).toBe(true);
    expect(e.transport.clock.kind).toBe('performance');
    expect(useToasts.getState().toasts).toHaveLength(1);
    e.pause();
    e.play();
    await vi.waitFor(() => expect(e.getState().audio).toBe('blocked'));
    expect(useToasts.getState().toasts).toHaveLength(1);
  });

  it('reports unsupported when there is no Web Audio', () => {
    useSettings.getState().set({ audioEnabled: true });
    const e = makeEngine();
    e.play();
    expect(e.getState().audio).toBe('unsupported');
    expect(e.transport.playing).toBe(true);
  });

  describe('first Play / prewarm (fake timers)', () => {
    class HangingCtx extends FakeAudioContext {
      constructor() {
        super({ state: 'suspended', resume: 'hang' });
      }
    }
    class RunningCtx extends FakeAudioContext {
      constructor() {
        super({ state: 'running', outputLatency: 0.04, baseLatency: 0.01 });
      }
    }
    const idle = new Map<number, () => void>();
    let nextIdle = 1;

    beforeEach(() => {
      // Chỉ giả timeout/interval: rAF giữ stub ở trên (không tính vào getTimerCount).
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
      idle.clear();
      vi.stubGlobal(
        'requestIdleCallback',
        vi.fn((cb: () => void) => {
          const id = nextIdle++;
          idle.set(id, cb);
          return id;
        }),
      );
      vi.stubGlobal(
        'cancelIdleCallback',
        vi.fn((id: number) => idle.delete(id)),
      );
    });
    afterEach(() => {
      Reflect.deleteProperty(navigator, 'userActivation');
      vi.useRealTimers();
    });

    const runIdle = (): void => {
      const list = Array.from(idle.values());
      idle.clear();
      for (const cb of list) cb();
    };
    const activate = (): void => {
      Object.defineProperty(navigator, 'userActivation', {
        value: { hasBeenActive: true, isActive: false },
        configurable: true,
      });
    };
    /** Tiến AudioContext + timer giả (interval scheduler 25 ms). */
    const runAudio = (ctx: FakeAudioContext, sec: number): void => {
      for (let i = 0; i < Math.round(sec / 0.025); i++) {
        ctx.advance(0.025);
        vi.advanceTimersByTime(25);
      }
    };
    /** Click metronome (bỏ buffer 1 mẫu dùng để mở khóa iOS). */
    const clicksOf = (ctx: FakeAudioContext) =>
      ctx.bufferSources().filter((s) => (s.buffer?.length ?? 0) > 1);

    it('D-404: turning the melody on during the countdown unlocks inside that click (not later from the countdown timer)', async () => {
      vi.stubGlobal('AudioContext', SuspendedCtx);
      useSettings.getState().set({ audioEnabled: false, countIn: false, startDelaySec: 3 });
      const e = makeEngine();
      e.play();
      expect(e.getState().countdown).toBe(3);
      const unlock = vi.spyOn(getAudioEngine(), 'unlock');
      // "Tôi hiểu, bật" của nút loa trong lúc đếm ngược: mở khóa ĐỒNG BỘ trong cú bấm — hết đếm ngược thì
      // start() chạy từ hẹn giờ (không còn user activation, Safari / iOS chặn unlock ở đó).
      e.setAudioEnabled(true);
      expect(unlock).toHaveBeenCalledTimes(1);
      await vi.waitFor(() => expect(e.audioActive).toBe(true));
      await vi.advanceTimersByTimeAsync(3000);
      expect(e.getState().countdown).toBeNull();
      expect(e.transport.playing).toBe(true);
      expect(e.transport.clock.kind).toBe('audio');
      expect(e.getState().audio).toBe('on');
      expect(useToasts.getState().toasts).toEqual([]);
    });

    it('D-423: "Tôi hiểu, bật" while idle unlocks inside that click — the first Play then starts on the audio clock without waiting', async () => {
      vi.stubGlobal('AudioContext', SuspendedCtx);
      useSettings.getState().set({ audioEnabled: false, countIn: false });
      const e = makeEngine();
      const unlock = vi.spyOn(getAudioEngine(), 'unlock');
      e.setAudioEnabled(true);
      expect(unlock).toHaveBeenCalledTimes(1);
      await vi.waitFor(() => expect(e.audioActive).toBe(true));
      expect(e.getState().audio).toBe('on');
      e.play();
      expect(e.transport.playing).toBe(true); // không phải chờ unlock
      expect(e.transport.clock.kind).toBe('audio');
      expect(useToasts.getState().toasts).toEqual([]);
    });

    it('D-404 / D-423: Play waits for the unlock; turning the melody off starts the visual; on again unlocks in that click', () => {
      vi.stubGlobal('AudioContext', HangingCtx);
      useSettings.getState().set({ audioEnabled: false, countIn: false });
      const e = makeEngine();
      const unlock = vi.spyOn(getAudioEngine(), 'unlock');
      e.setAudioEnabled(true); // đứng yên: mở khóa ngay trong cú bấm (treo)
      expect(unlock).toHaveBeenCalledTimes(1);
      e.play(); // chờ unlock (treo) → playPending; cú bấm này cũng gọi resume() lại
      expect(unlock).toHaveBeenCalledTimes(2);
      expect(e.transport.playing).toBe(false);
      e.setAudioEnabled(false); // tắt → hình chạy ngay
      expect(e.transport.playing).toBe(true);
      e.setAudioEnabled(true); // đang phát → mở khóa lại trong cú bấm
      expect(unlock).toHaveBeenCalledTimes(3);
    });

    it('timing-1: the first Play keeps every count-in click (v1.0.1: 0.65 bar → beats -2, -1)', async () => {
      vi.stubGlobal('AudioContext', SuspendedCtx);
      useSettings
        .getState()
        .set({ audioEnabled: true, clickSound: true, countIn: true, timbre: 'sine' });
      const e = makeEngine();
      e.play();
      const ctx = getAudioEngine().context as unknown as FakeAudioContext;
      // Cả hai clock chạy tiếp ~20 ms trước khi unlock xong.
      clock.advance(0.02);
      ctx.advance(0.02);
      await vi.waitFor(() => expect(e.transport.playing).toBe(true));
      expect(e.transport.clock.kind).toBe('audio');
      expect(e.transport.getBeat()).toBe(-CI);
      const anchor = e.transport.snapshot().anchorTime;
      expect(anchor).toBeGreaterThan(ctx.currentTime); // chừa lead: click đầu ở tương lai
      runAudio(ctx, 2.2);
      const clicks = clicksOf(ctx);
      // Click ở beat nguyên -2, -1 (beat 0 là nốt đầu): anchor + 0,3 s, + 0,8 s.
      expect(clicks).toHaveLength(2);
      clicks.forEach((s, i) => expect(s.startTime).toBeCloseTo(anchor + (CI - 2) / 2 + i * 0.5, 9));
      const firstNote = ctx.oscillators()[0];
      expect(firstNote.frequency.value).toBeCloseTo(261.63, 1); // Z ở beat 0
      expect(firstNote.startTime).toBeCloseTo(anchor + CI / 2, 9);
    });

    it('timing-1: with count-in off the note at beat 0 is played on the first Play', async () => {
      vi.stubGlobal('AudioContext', SuspendedCtx);
      useSettings.getState().set({ audioEnabled: true, countIn: false, timbre: 'sine' });
      const e = makeEngine();
      e.play();
      clock.advance(0.02);
      await vi.waitFor(() => expect(e.transport.playing).toBe(true));
      const ctx = getAudioEngine().context as unknown as FakeAudioContext;
      runAudio(ctx, 0.3);
      const [first] = ctx.oscillators();
      expect(first.frequency.value).toBeCloseTo(261.63, 1);
      expect(first.startTime).toBeCloseTo(e.transport.beatToTime(0), 9);
    });

    it('audio gating: click sound only → count-in clicks (2 at 0.65 bar), no melody notes', async () => {
      vi.stubGlobal('AudioContext', SuspendedCtx);
      useSettings
        .getState()
        .set({ audioEnabled: false, clickSound: true, countIn: true, timbre: 'sine' });
      const e = makeEngine();
      expect(e.getState().audio).toBe('idle');
      e.play();
      await vi.waitFor(() => expect(e.transport.playing).toBe(true));
      expect(e.transport.clock.kind).toBe('audio');
      const ctx = getAudioEngine().context as unknown as FakeAudioContext;
      runAudio(ctx, 3);
      expect(clicksOf(ctx)).toHaveLength(2); // chỉ đếm vào (metronome suốt bài tắt)
      expect(ctx.oscillators()).toHaveLength(0); // không phát giai điệu
    });

    it('audio gating: melody only → notes play, no clicks (count-in is visual), metronome needs the click sound', async () => {
      vi.stubGlobal('AudioContext', SuspendedCtx);
      useSettings.getState().set({
        audioEnabled: true,
        clickSound: false,
        countIn: true,
        metronome: true,
        timbre: 'sine',
      });
      const e = makeEngine();
      e.play();
      await vi.waitFor(() => expect(e.transport.playing).toBe(true));
      expect(e.transport.getBeat()).toBe(-CI); // vẫn đếm vào (bằng hình)
      const anchor = e.transport.snapshot().anchorTime;
      const ctx = getAudioEngine().context as unknown as FakeAudioContext;
      runAudio(ctx, 3);
      expect(clicksOf(ctx)).toHaveLength(0);
      const [first] = ctx.oscillators();
      expect(first.frequency.value).toBeCloseTo(261.63, 1);
      expect(first.startTime).toBeCloseTo(anchor + CI / 2, 9);
    });

    it('audio gating: everything off → no AudioContext is ever created, the count-in still runs', () => {
      activate();
      const ctor = vi.fn();
      class Counted extends RunningCtx {
        constructor() {
          super();
          ctor();
        }
      }
      vi.stubGlobal('AudioContext', Counted);
      useSettings.getState().set({ audioEnabled: false, clickSound: false, countIn: true });
      const e = makeEngine();
      runIdle(); // không prewarm
      e.play();
      expect(ctor).not.toHaveBeenCalled();
      expect(getAudioEngine().context).toBeNull();
      expect(e.getState().audio).toBe('off');
      expect(e.transport.playing).toBe(true); // không chờ unlock
      expect(e.transport.clock.kind).toBe('performance');
      expect(e.getState().countingIn).toBe(true);
    });

    it('audio gating: turning the melody off mid-play keeps the clicks on the audio clock', async () => {
      vi.stubGlobal('AudioContext', SuspendedCtx);
      useSettings.getState().set({ audioEnabled: true, clickSound: true, countIn: false });
      const e = makeEngine();
      e.play();
      await vi.waitFor(() => expect(e.audioActive).toBe(true));
      useSettings.getState().set({ audioEnabled: false });
      expect(e.audioActive).toBe(true); // click vẫn cần audio clock
      expect(e.getState().audio).toBe('on');
      useSettings.getState().set({ clickSound: false });
      expect(e.audioActive).toBe(false);
      expect(e.getState().audio).toBe('off');
      expect(e.transport.playing).toBe(true);
    });

    it('pressing Space again while waiting for the unlock cancels that Play', async () => {
      vi.stubGlobal('AudioContext', HangingCtx);
      useSettings.getState().set({ audioEnabled: true });
      const e = makeEngine();
      e.toggle();
      expect(e.getState().playing).toBe(true);
      e.toggle();
      expect(e.getState().playing).toBe(false);
      await vi.advanceTimersByTimeAsync(UNLOCK_TIMEOUT_MS + 100); // unlock hết hạn → blocked
      expect(e.getState().audio).toBe('blocked');
      expect(e.transport.playing).toBe(false);
    });

    it('a hanging unlock starts the visual after the timeout; later Plays do not wait again', async () => {
      vi.stubGlobal('AudioContext', HangingCtx);
      useSettings.getState().set({ audioEnabled: true, countIn: false });
      const e = makeEngine();
      e.play();
      e.nextLine(); // seek trong lúc chờ → phát từ đó
      await vi.advanceTimersByTimeAsync(1100);
      expect(e.transport.playing).toBe(false); // iOS lần đầu có thể chậm: còn chờ tới UNLOCK_TIMEOUT_MS
      await vi.advanceTimersByTimeAsync(UNLOCK_TIMEOUT_MS);
      expect(e.transport.playing).toBe(true);
      expect(e.transport.clock.kind).toBe('performance');
      expect(e.transport.getBeat()).toBe(4);
      e.pause();
      e.play();
      expect(e.transport.playing).toBe(true); // không chờ thêm lần nữa
    });

    it('turning audio off while waiting starts the visual immediately', () => {
      vi.stubGlobal('AudioContext', HangingCtx);
      useSettings.getState().set({ audioEnabled: true });
      const e = makeEngine();
      e.play();
      expect(e.transport.playing).toBe(false);
      e.setAudioEnabled(false);
      expect(e.transport.playing).toBe(true);
      expect(e.transport.clock.kind).toBe('performance');
      expect(e.getState().audio).toBe('off');
    });

    describe('iPhone silent switch + mobile unlock (D-421 – D-423)', () => {
      let session: FakeAudioSessionHandle | null = null;
      let restoreUa: (() => void) | null = null;

      afterEach(() => {
        session?.restore();
        session = null;
        restoreUa?.();
        restoreUa = null;
      });

      const audioCtx = () => getAudioEngine().context as unknown as FakeAudioContext | null;
      const tap = (key: NoteKey): PracticeInputEvent => ({
        type: 'tap-down',
        key,
        octave: 0,
        sharp: false,
        source: 'touch',
        pointerId: 1,
        timeStamp: performance.now(),
      });
      /** `<audio>` do app tạo: jsdom không phát được media → giả play / pause / load, ghi lại phần tử. */
      const mediaSpies = () => {
        const played: HTMLMediaElement[] = [];
        const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(function (
          this: HTMLMediaElement,
        ) {
          played.push(this);
          Object.defineProperty(this, 'paused', { value: false, configurable: true });
          return Promise.resolve();
        });
        const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(function (
          this: HTMLMediaElement,
        ) {
          Object.defineProperty(this, 'paused', { value: true, configurable: true });
        });
        vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined);
        return { played, play, pause };
      };

      it('sound off (default): nothing audio-related runs — no AudioContext, no session change, no <audio>, no retry listener', () => {
        activate();
        session = installFakeAudioSession();
        restoreUa = fakeUserAgent();
        const media = mediaSpies();
        const ctor = vi.fn();
        class Counted extends SuspendedCtx {
          constructor() {
            super();
            ctor();
          }
        }
        vi.stubGlobal('AudioContext', Counted);
        // Mặc định: giai điệu, click, tiếng phản hồi đều tắt.
        useSettings
          .getState()
          .set({ audioEnabled: false, clickSound: false, practiceFeedback: false });
        const e = makeEngine();
        runIdle();
        e.play();
        e.setPractice(true);
        e.handlePracticeInput(tap('Z'));
        e.pause();
        e.setPractice(false);
        window.dispatchEvent(new Event('pointerup'));
        e.detach();
        expect(ctor).not.toHaveBeenCalled();
        expect(getAudioEngine().context).toBeNull();
        expect(session.log).toEqual([]);
        expect(media.play).not.toHaveBeenCalled();
        expect(e.audioRetryArmed).toBe(false);
      });

      it('Play with sound on: navigator.audioSession.type = "playback" inside the Play gesture, before resume(); melody + click off → "auto"', async () => {
        const resumeAtSet: number[] = [];
        session = installFakeAudioSession('auto', () => {
          resumeAtSet.push(audioCtx()?.resumeCalls ?? -1);
        });
        vi.stubGlobal('AudioContext', SuspendedCtx);
        useSettings.getState().set({ audioEnabled: true, clickSound: true, countIn: false });
        const e = makeEngine();
        expect(session.log).toEqual([]); // mount: chưa đụng (không có cú chạm)
        e.play();
        expect(session.type).toBe('playback'); // đồng bộ trong cú bấm
        expect(resumeAtSet).toEqual([0]); // trước resume()
        await vi.waitFor(() => expect(e.audioActive).toBe(true));
        useSettings.getState().set({ audioEnabled: false });
        expect(session.type).toBe('playback'); // click vẫn kêu
        useSettings.getState().set({ clickSound: false });
        expect(session.type).toBe('auto');
        expect(session.log).toEqual(['playback', 'auto']);
      });

      it('unmount (detach) restores "auto"; with the floating-window engine too, only the last one restores', async () => {
        session = installFakeAudioSession();
        vi.stubGlobal('AudioContext', SuspendedCtx);
        useSettings.getState().set({ audioEnabled: true, countIn: false });
        const main = makeEngine();
        const floating = makeEngine();
        main.play();
        await vi.waitFor(() => expect(main.audioActive).toBe(true));
        main.pause();
        floating.play();
        expect(session.type).toBe('playback');
        floating.detach();
        expect(session.type).toBe('playback');
        main.detach();
        expect(session.type).toBe('auto');
      });

      it('"Tôi hiểu, bật" of the speaker button while idle unlocks + holds the session in that click; off releases', async () => {
        session = installFakeAudioSession();
        vi.stubGlobal('AudioContext', SuspendedCtx);
        useSettings.getState().set({ audioEnabled: false });
        const e = makeEngine();
        e.setAudioEnabled(true);
        expect(session.type).toBe('playback');
        expect(audioCtx()?.resumeCalls).toBe(1);
        await vi.waitFor(() => expect(e.audioActive).toBe(true));
        e.setAudioEnabled(false);
        expect(session.type).toBe('auto');
      });

      it('context already running (prewarmed / unlocked in Settings): mount leaves the session alone; the Play gesture holds it', () => {
        activate();
        session = installFakeAudioSession();
        vi.stubGlobal('AudioContext', RunningCtx);
        useSettings.getState().set({ audioEnabled: true, countIn: false });
        const e = makeEngine();
        runIdle();
        expect(e.audioActive).toBe(true);
        expect(session.log).toEqual([]);
        e.play();
        expect(session.type).toBe('playback');
        expect(e.transport.playing).toBe(true);
      });

      it('iOS without the Audio Session API: a looping silent <audio> (data: WAV, not muted, ~0 volume, playsinline, not in the page) starts in the Play gesture; off → paused + released', async () => {
        restoreUa = fakeUserAgent(); // iPhone, không có navigator.audioSession
        const media = mediaSpies();
        vi.stubGlobal('AudioContext', SuspendedCtx);
        useSettings.getState().set({ audioEnabled: true, countIn: false });
        const e = makeEngine();
        expect(media.play).not.toHaveBeenCalled();
        e.play();
        expect(media.played).toHaveLength(1);
        const el = media.played[0] as HTMLAudioElement;
        expect(el.tagName).toBe('AUDIO');
        expect(el.loop).toBe(true);
        expect(el.muted).toBe(false);
        expect(el.volume).toBeLessThanOrEqual(0.01);
        expect(el.hasAttribute('playsinline')).toBe(true);
        expect(el.src.startsWith('data:audio/wav;base64,')).toBe(true);
        expect(el.isConnected).toBe(false);
        await vi.waitFor(() => expect(e.audioActive).toBe(true));
        e.pause();
        e.play(); // cú bấm sau: dùng lại phần tử đang phát
        expect(media.played).toHaveLength(1);
        e.setAudioEnabled(false);
        expect(media.pause).toHaveBeenCalled();
        expect(el.paused).toBe(true);
        expect(el.hasAttribute('src')).toBe(false);
      });

      it('Android / desktop (no API, not Apple): no <audio>, no session — media volume governs Web Audio', async () => {
        restoreUa = fakeUserAgent(ANDROID_UA);
        const media = mediaSpies();
        vi.stubGlobal('AudioContext', SuspendedCtx);
        useSettings.getState().set({ audioEnabled: true, countIn: false });
        const e = makeEngine();
        e.play();
        await vi.waitFor(() => expect(e.audioActive).toBe(true));
        expect(media.play).not.toHaveBeenCalled();
        expect(getAudioEngine().ready).toBe(true);
      });

      it('slow first unlock on iOS (running after 1.5 s): Play still waits and starts on the audio clock, no toast', async () => {
        class SlowCtx extends FakeAudioContext {
          constructor() {
            super({ state: 'suspended', resume: 'resolve', resumeDelayMs: 1500 });
          }
        }
        vi.stubGlobal('AudioContext', SlowCtx);
        useSettings.getState().set({ audioEnabled: true, countIn: false });
        const e = makeEngine();
        e.play();
        await vi.advanceTimersByTimeAsync(1100);
        expect(e.transport.playing).toBe(false);
        expect(e.getState().audio).toBe('starting');
        await vi.advanceTimersByTimeAsync(500);
        expect(e.transport.playing).toBe(true);
        expect(e.transport.clock.kind).toBe('audio');
        expect(e.getState().audio).toBe('on');
        expect(useToasts.getState().toasts).toEqual([]);
      });

      it("'interrupted' mid-play (call / Siri): visuals continue on the performance clock; the next tap anywhere resumes in that gesture — no toast", async () => {
        session = installFakeAudioSession();
        vi.stubGlobal('AudioContext', SuspendedCtx);
        useSettings.getState().set({ audioEnabled: true, countIn: false });
        const e = makeEngine();
        e.play();
        await vi.waitFor(() => expect(e.audioActive).toBe(true));
        const ctx = audioCtx() as FakeAudioContext;
        ctx.resumeBehavior = 'hang'; // không tự chạy lại
        ctx.setState('interrupted');
        expect(e.audioActive).toBe(false);
        expect(e.transport.playing).toBe(true);
        expect(e.transport.clock.kind).toBe('performance');
        expect(e.audioRetryArmed).toBe(true);
        expect(session.type).toBe('playback'); // gián đoạn không trả phiên
        ctx.resumeBehavior = 'resolve';
        const before = ctx.resumeCalls;
        window.dispatchEvent(new Event('pointerup'));
        expect(ctx.resumeCalls).toBe(before + 1); // resume() ngay trong cú chạm
        await vi.waitFor(() => expect(e.audioActive).toBe(true));
        expect(e.transport.clock.kind).toBe('audio');
        expect(e.transport.playing).toBe(true);
        expect(e.audioRetryArmed).toBe(false);
        expect(useToasts.getState().toasts).toEqual([]);
      });

      it('the context comes back by itself (iOS after the call) → audio clock re-attached without a tap', async () => {
        vi.stubGlobal('AudioContext', SuspendedCtx);
        useSettings.getState().set({ audioEnabled: true, countIn: false });
        const e = makeEngine();
        e.play();
        await vi.waitFor(() => expect(e.audioActive).toBe(true));
        const ctx = audioCtx() as FakeAudioContext;
        ctx.setState('interrupted');
        expect(e.audioActive).toBe(false);
        ctx.setState('running');
        expect(e.audioActive).toBe(true);
        expect(e.transport.clock.kind).toBe('audio');
        expect(e.getState().audio).toBe('on');
        expect(e.audioRetryArmed).toBe(false);
      });

      it('blocked: friendly hint once per page (iPhone: volume / Focus / side switch); a later tap anywhere retries and recovers', async () => {
        restoreUa = fakeUserAgent();
        mediaSpies();
        vi.stubGlobal('AudioContext', BlockedCtx);
        useSettings.getState().set({ audioEnabled: true, countIn: false });
        const e = makeEngine();
        e.play();
        await vi.waitFor(() => expect(e.getState().audio).toBe('blocked'));
        const toasts = useToasts.getState().toasts;
        expect(toasts).toHaveLength(1);
        expect(toasts[0].kind).toBe('error');
        expect(toasts[0].text).toContain('tăng âm lượng');
        expect(toasts[0].text).toContain('chế độ tập trung');
        expect(toasts[0].text).toContain('nút bên hông');
        // D-426: không bảo bấm nút loa — tiếng đang bật nên nút loa là TẮT tiếng; chạm bất cứ đâu là thử lại.
        expect(toasts[0].text).not.toContain('nút loa');
        expect(toasts[0].text).toContain('Chạm vào màn hình');
        expect(e.transport.playing).toBe(true); // hình vẫn chạy
        expect(e.audioRetryArmed).toBe(true);
        // Player khác (đổi bài = mount lại) cũng bị chặn → không nhắc lại trong trang này.
        const other = makeEngine();
        other.play();
        await vi.waitFor(() => expect(other.getState().audio).toBe('blocked'));
        expect(useToasts.getState().toasts).toHaveLength(1);
        other.detach();
        // Cú chạm kế tiếp ở bất cứ đâu: mở khóa được → gắn audio clock.
        (audioCtx() as FakeAudioContext).resumeBehavior = 'resolve';
        window.dispatchEvent(new Event('touchend'));
        await vi.waitFor(() => expect(e.audioActive).toBe(true));
        expect(e.transport.clock.kind).toBe('audio');
        expect(e.getState().audio).toBe('on');
        expect(e.audioRetryArmed).toBe(false);
        expect(useToasts.getState().toasts).toHaveLength(1);
      });

      it('blocked on Android / desktop: generic hint (no side-switch advice)', async () => {
        restoreUa = fakeUserAgent(ANDROID_UA);
        vi.stubGlobal('AudioContext', BlockedCtx);
        useSettings.getState().set({ audioEnabled: true, countIn: false });
        const e = makeEngine();
        e.play();
        await vi.waitFor(() => expect(e.getState().audio).toBe('blocked'));
        const [t] = useToasts.getState().toasts;
        expect(t.text).toContain('Bấm hoặc chạm vào trang lần nữa');
        expect(t.text).not.toContain('nút loa'); // D-426: nút loa lúc này là TẮT tiếng
        expect(t.text).not.toContain('bên hông');
      });

      it('D-426: the hint advice works — a click anywhere (not the speaker button) retries and keeps the sound on', async () => {
        restoreUa = fakeUserAgent(ANDROID_UA);
        vi.stubGlobal('AudioContext', BlockedCtx);
        useSettings.getState().set({ audioEnabled: true, countIn: false });
        const e = makeEngine();
        e.play();
        await vi.waitFor(() => expect(e.getState().audio).toBe('blocked'));
        (audioCtx() as FakeAudioContext).resumeBehavior = 'resolve';
        document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await vi.waitFor(() => expect(e.audioActive).toBe(true));
        expect(useSettings.getState().audioEnabled).toBe(true);
        expect(e.getState().audio).toBe('on');
      });

      it('retry listeners: removed when the sound is turned off and on detach; a tap after detach does nothing', async () => {
        vi.stubGlobal('AudioContext', BlockedCtx);
        useSettings.getState().set({ audioEnabled: true, countIn: false });
        const e = makeEngine();
        const remove = vi.spyOn(window, 'removeEventListener');
        e.play();
        await vi.waitFor(() => expect(e.audioRetryArmed).toBe(true));
        useSettings.getState().set({ audioEnabled: false });
        expect(e.audioRetryArmed).toBe(false);
        const removed = remove.mock.calls.map(([type]) => type);
        for (const type of AUDIO_RETRY_EVENTS) expect(removed).toContain(type);
        useSettings.getState().set({ audioEnabled: true });
        e.pause();
        e.play();
        await vi.waitFor(() => expect(e.audioRetryArmed).toBe(true));
        e.detach();
        expect(e.audioRetryArmed).toBe(false);
        const ctx = audioCtx() as FakeAudioContext;
        const calls = ctx.resumeCalls;
        window.dispatchEvent(new Event('pointerup'));
        expect(ctx.resumeCalls).toBe(calls);
      });

      it('practice feedback only (melody + click off): the first pad tap unlocks + holds the session and the note is scheduled; practice off releases', async () => {
        session = installFakeAudioSession();
        vi.stubGlobal('AudioContext', SuspendedCtx);
        useSettings.getState().set({
          audioEnabled: false,
          clickSound: false,
          practiceFeedback: true,
          controlScheme: 'mobile',
        });
        const e = makeEngine();
        e.setPractice(true);
        expect(session.log).toEqual([]);
        expect(getAudioEngine().context).toBeNull();
        e.handlePracticeInput(tap('Z'));
        expect(session.type).toBe('playback');
        const ctx = audioCtx() as FakeAudioContext;
        expect(ctx.resumeCalls).toBe(1);
        expect(getAudioEngine().ready).toBe(true);
        expect(ctx.oscillators().length).toBeGreaterThan(0); // tiếng phản hồi đã lên lịch
        expect(e.transport.clock.kind).toBe('performance'); // chỉ phản hồi: không gắn audio clock
        e.setPractice(false);
        expect(session.type).toBe('auto');
      });

      it('practice feedback: a blocked first tap arms the retry + hints once (D-426); more blocked taps do not spam; the next tap (touchend) unlocks', async () => {
        restoreUa = fakeUserAgent(ANDROID_UA);
        vi.stubGlobal('AudioContext', BlockedCtx);
        useSettings.getState().set({
          audioEnabled: false,
          clickSound: false,
          practiceFeedback: true,
          controlScheme: 'mobile',
        });
        const e = makeEngine();
        e.setPractice(true);
        e.handlePracticeInput(tap('Z'));
        await vi.waitFor(() => expect(e.audioRetryArmed).toBe(true));
        // Context vẫn không chạy sau lượt chờ → câu nhắc chung (REQUIRED 2 áp cho cả tiếng phản hồi), một lần.
        await vi.waitFor(() => expect(useToasts.getState().toasts).toHaveLength(1));
        expect(useToasts.getState().toasts[0].text).toContain('Bấm hoặc chạm vào trang');
        e.handlePracticeInput(tap('X'));
        window.dispatchEvent(new Event('touchend')); // vẫn bị chặn
        await vi.waitFor(() =>
          expect((audioCtx() as FakeAudioContext).resumeCalls).toBeGreaterThan(2),
        );
        await Promise.resolve();
        expect(useToasts.getState().toasts).toHaveLength(1);
        (audioCtx() as FakeAudioContext).resumeBehavior = 'resolve';
        window.dispatchEvent(new Event('touchend'));
        await vi.waitFor(() => expect(getAudioEngine().ready).toBe(true));
        await vi.waitFor(() => expect(e.audioRetryArmed).toBe(false));
        expect(useToasts.getState().toasts).toHaveLength(1);
      });

      for (const melody of [true, false]) {
        it(`pad tap starts the unlock on pointerdown (not a gesture on Safari / Chrome): the same tap's pointerup resumes again — no 3 s wait, no hint (${melody ? 'melody on' : 'feedback only'})`, async () => {
          session = installFakeAudioSession();
          vi.stubGlobal('AudioContext', HangingCtx);
          useSettings.getState().set({
            audioEnabled: melody,
            clickSound: false,
            practiceFeedback: true,
            controlScheme: 'mobile',
            countIn: false,
          });
          const e = makeEngine();
          e.setPractice(true);
          e.handlePracticeInput(tap('Z')); // pointerdown: resume() treo (không phải gesture)
          const ctx = audioCtx() as FakeAudioContext;
          expect(ctx.resumeCalls).toBeGreaterThan(0); // mở khóa + playPreview đều gọi resume()
          expect(getAudioEngine().ready).toBe(false);
          expect(e.audioRetryArmed).toBe(true); // chờ cú thả tay của chính lần chạm này
          expect(session.type).toBe('playback');
          ctx.resumeBehavior = 'resolve'; // pointerup = gesture
          const calls = ctx.resumeCalls;
          window.dispatchEvent(new Event('pointerup'));
          expect(ctx.resumeCalls).toBe(calls + 1); // resume() lại ngay trong cú thả tay
          await vi.waitFor(() => expect(getAudioEngine().ready).toBe(true));
          await vi.waitFor(() => expect(e.audioRetryArmed).toBe(false));
          if (melody) expect(e.audioActive).toBe(true);
          await vi.advanceTimersByTimeAsync(UNLOCK_TIMEOUT_MS + 100);
          expect(useToasts.getState().toasts).toEqual([]);
          expect(e.audioRetryArmed).toBe(false);
        });
      }
    });

    it('timing-2: with sticky activation the AudioContext is created when idle after mount, not in the Play keypress', () => {
      activate();
      const ctor = vi.fn();
      class Counted extends RunningCtx {
        constructor() {
          super();
          ctor();
        }
      }
      vi.stubGlobal('AudioContext', Counted);
      useSettings.getState().set({ audioEnabled: true, countIn: false });
      const e = makeEngine();
      expect(ctor).not.toHaveBeenCalled(); // không chặn lần vẽ đầu
      runIdle();
      expect(ctor).toHaveBeenCalledTimes(1);
      expect(e.audioActive).toBe(true);
      expect(e.transport.clock.kind).toBe('audio');
      expect(e.getState().audio).toBe('on');
      e.play();
      expect(ctor).toHaveBeenCalledTimes(1);
      expect(e.transport.playing).toBe(true); // không phải chờ unlock
    });

    it('timing-2: no prewarm without activation, with audio off, or after detach', () => {
      vi.stubGlobal('AudioContext', RunningCtx);
      useSettings.getState().set({ audioEnabled: true });
      makeEngine();
      runIdle();
      expect(getAudioEngine().context).toBeNull(); // chưa có user activation

      activate();
      useSettings.getState().set({ audioEnabled: false });
      makeEngine();
      runIdle();
      expect(getAudioEngine().context).toBeNull();

      useSettings.getState().set({ audioEnabled: true });
      const e = makeEngine();
      expect(idle.size).toBeGreaterThan(0);
      e.detach();
      for (const other of engines) other.detach();
      expect(idle.size).toBe(0); // lịch đã hủy
      runIdle();
      expect(getAudioEngine().context).toBeNull();
    });

    it('nit: the 25 ms scheduler interval sleeps while paused', () => {
      activate();
      vi.stubGlobal('AudioContext', RunningCtx);
      useSettings.getState().set({ audioEnabled: true, countIn: false });
      const e = makeEngine();
      runIdle();
      expect(e.audioActive).toBe(true);
      expect(vi.getTimerCount()).toBe(0); // pause: không interval
      e.play();
      expect(vi.getTimerCount()).toBe(1);
      e.pause();
      expect(vi.getTimerCount()).toBe(0);
      expect(e.audioActive).toBe(true);
    });
  });
});

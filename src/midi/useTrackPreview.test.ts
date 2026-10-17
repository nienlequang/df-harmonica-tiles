import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AudioEngine, getAudioEngine } from '../audio/engine';
import { FakeAudioContext } from '../audio/fakeAudioContext';
import { installFakeAudioSession } from '../audio/fakePlaybackEnv';
import { useSettings } from '../ui/settings';
import {
  PREVIEW_MAX_SEC,
  PREVIEW_TICK_MS,
  previewSchedule,
  TrackPreviewPlayer,
  useTrackPreview,
} from './useTrackPreview';

/** Stub AudioContext toàn cục bằng fake (context suspended, resume chạy). */
function installFakeAudio() {
  const created: FakeAudioContext[] = [];
  class Stub extends FakeAudioContext {
    constructor(opts?: unknown) {
      super({ state: 'suspended' }, opts);
      created.push(this);
    }
  }
  vi.stubGlobal('AudioContext', Stub);
  return created;
}

/** Oscillator nốt (sine: 1 oscillator mỗi voice). */
const noteOscs = (ctx: FakeAudioContext) => ctx.oscillators();

const SCALE = [60, 62, 64, 65, 67].map((midi, i) => ({ startBeat: 4 + i, beats: 1, midi }));

describe('previewSchedule', () => {
  it('đổi beat → giây theo bpm, tính từ nốt đầu, sắp theo thời điểm', () => {
    const ev = previewSchedule(
      [
        { startBeat: 6, beats: 2, midi: 64 },
        { startBeat: 4, beats: 1, midi: 60 },
        { startBeat: 4, beats: 1, midi: 55 },
      ],
      120,
    );
    expect(ev).toEqual([
      { midi: 55, at: 0, dur: 0.5 },
      { midi: 60, at: 0, dur: 0.5 },
      { midi: 64, at: 1, dur: 1 },
    ]);
  });

  it('chỉ lấy nốt bắt đầu trong 12 s đầu, cắt đuôi tại 12 s', () => {
    const notes = Array.from({ length: 40 }, (_, i) => ({ startBeat: i, beats: 4, midi: 60 }));
    const ev = previewSchedule(notes, 60);
    expect(ev).toHaveLength(PREVIEW_MAX_SEC);
    const last = ev[ev.length - 1];
    expect(last.at).toBe(11);
    expect(last.at + last.dur).toBe(PREVIEW_MAX_SEC);
  });

  it('bpm sai → 120; nốt hỏng bị bỏ; rỗng → []', () => {
    expect(previewSchedule([{ startBeat: 0, beats: 1, midi: 60 }], NaN)[0].dur).toBe(0.5);
    expect(
      previewSchedule(
        [
          { startBeat: 0, beats: 0, midi: 60 },
          { startBeat: 0, beats: 1, midi: 60.5 },
          { startBeat: NaN, beats: 1, midi: 60 },
          { startBeat: 0, beats: 1, midi: 200 },
        ],
        100,
      ),
    ).toEqual([]);
    expect(previewSchedule([], 100)).toEqual([]);
  });
});

describe('TrackPreviewPlayer', () => {
  let engine: AudioEngine;

  beforeEach(() => {
    vi.useFakeTimers();
    useSettings.getState().set({ timbre: 'sine', musicVolume: 0.5 });
  });

  afterEach(() => {
    engine?.dispose();
    getAudioEngine().dispose();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    useSettings.getState().reset();
  });

  it('phát trên bus nhạc, lên lịch dần theo lookahead, tự dọn khi hết', async () => {
    const created = installFakeAudio();
    engine = new AudioEngine();
    const onChange = vi.fn();
    const player = new TrackPreviewPlayer(onChange, () => engine);
    await expect(player.play('t1', SCALE, 120)).resolves.toBe('playing');
    const ctx = created[0];
    expect(engine.musicVolume).toBe(0.5);
    expect(onChange).toHaveBeenCalledWith('t1');
    expect(player.playingKey).toBe('t1');
    // nốt đầu ở 0.06 s; lookahead 0.5 s → mới có 1 nốt (0.56 s chưa tới)
    expect(noteOscs(ctx)).toHaveLength(1);

    ctx.advance(0.3);
    vi.advanceTimersByTime(PREVIEW_TICK_MS);
    expect(noteOscs(ctx)).toHaveLength(2);

    ctx.advance(3);
    vi.advanceTimersByTime(PREVIEW_TICK_MS);
    expect(noteOscs(ctx)).toHaveLength(5);
    expect(player.playingKey).toBeNull();
    expect(onChange).toHaveBeenLastCalledWith(null);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('stop(): dừng voice ngay, xóa timer; engine.stopAll() cũng dừng', async () => {
    const created = installFakeAudio();
    engine = new AudioEngine();
    const onChange = vi.fn();
    const player = new TrackPreviewPlayer(onChange, () => engine);
    await player.play('a', SCALE, 60);
    const ctx = created[0];
    const osc = noteOscs(ctx)[0];
    const plannedStop = osc.stopTime ?? 0;
    ctx.advance(0.2);
    player.stop();
    expect(osc.stopTime ?? Infinity).toBeLessThan(plannedStop);
    expect(onChange).toHaveBeenLastCalledWith(null);
    expect(vi.getTimerCount()).toBe(0);

    await player.play('b', SCALE, 60);
    expect(player.playingKey).toBe('b');
    engine.stopAll();
    expect(player.playingKey).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('không có AudioContext → blocked; không có nốt → empty; bị chen ngang → cancelled', async () => {
    vi.stubGlobal('AudioContext', undefined);
    engine = new AudioEngine();
    const onChange = vi.fn();
    const player = new TrackPreviewPlayer(onChange, () => engine);
    await expect(player.play('x', SCALE, 100)).resolves.toBe('blocked');
    expect(onChange).not.toHaveBeenCalled();

    installFakeAudio();
    engine = new AudioEngine();
    const p2 = new TrackPreviewPlayer(onChange, () => engine);
    await expect(p2.play('x', [], 100)).resolves.toBe('empty');
    const first = p2.play('y', SCALE, 100);
    p2.stop();
    await expect(first).resolves.toBe('cancelled');
    expect(p2.playingKey).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('iPhone (D-426): giữ phiên "playback" trước resume() chỉ trong lúc nghe thử — đổi bản không lật phiên; dừng / hết / bị chặn / không nốt → trả', async () => {
    const created = installFakeAudio();
    let resumesAtSet = -1;
    const session = installFakeAudioSession('auto', (type) => {
      if (type === 'playback') resumesAtSet = created[0]?.resumeCalls ?? -1;
    });
    try {
      engine = new AudioEngine();
      const player = new TrackPreviewPlayer(vi.fn(), () => engine);
      await expect(player.play('a', SCALE, 120)).resolves.toBe('playing');
      expect(session.type).toBe('playback');
      expect(resumesAtSet).toBe(0); // cùng cú bấm, trước resume()
      // Đổi sang bản khác trong lúc đang nghe: không 'auto' ↔ 'playback'.
      await expect(player.play('b', SCALE, 120)).resolves.toBe('playing');
      expect(session.log).toEqual(['playback']);
      player.stop();
      expect(session.type).toBe('auto');
      // Hết bản → trả.
      await player.play('c', SCALE, 120);
      expect(session.type).toBe('playback');
      created[0].advance(10);
      vi.advanceTimersByTime(PREVIEW_TICK_MS);
      expect(player.playingKey).toBeNull();
      expect(session.type).toBe('auto');
      // Không có nốt → không giữ.
      await expect(player.play('d', [], 120)).resolves.toBe('empty');
      expect(session.type).toBe('auto');
      // Bị chặn → trả.
      created[0].resumeBehavior = 'reject';
      await created[0].suspend();
      await expect(player.play('e', SCALE, 120)).resolves.toBe('blocked');
      expect(session.type).toBe('auto');
      expect(session.log).toEqual(['playback', 'auto', 'playback', 'auto', 'playback', 'auto']);
      // engine.stopAll() (Player khác) dừng nghe thử → trả.
      created[0].resumeBehavior = 'resolve';
      await player.play('f', SCALE, 120);
      expect(session.type).toBe('playback');
      engine.stopAll();
      expect(session.type).toBe('auto');
    } finally {
      session.restore();
    }
  });
});

describe('useTrackPreview', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useSettings.getState().set({ timbre: 'sine' });
  });

  afterEach(() => {
    getAudioEngine().dispose();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    useSettings.getState().reset();
  });

  it('toggle phát / dừng; unmount dừng và dọn timer', async () => {
    const created = installFakeAudio();
    const { result, unmount } = renderHook(() => useTrackPreview());
    await act(async () => {
      await expect(result.current.toggle('m', SCALE, 90)).resolves.toBe('playing');
    });
    expect(result.current.playingKey).toBe('m');
    await act(async () => {
      await expect(result.current.toggle('m', SCALE, 90)).resolves.toBe('stopped');
    });
    expect(result.current.playingKey).toBeNull();

    await act(async () => {
      await result.current.play('n', SCALE, 90);
    });
    expect(result.current.playingKey).toBe('n');
    const osc = noteOscs(created[0]).at(-1);
    const planned = osc?.stopTime ?? 0;
    unmount();
    expect(osc?.stopTime ?? Infinity).toBeLessThanOrEqual(planned);
    expect(vi.getTimerCount()).toBe(0);
  });
});

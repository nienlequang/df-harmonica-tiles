/**
 * Tích hợp AudioScheduler với Transport + audio clock thật (src/player).
 * Audio clock đọc thời điểm NGHE THẤY (currentTime - output latency): các test có latency kiểm tra
 * nốt được start() trên ctx đúng lúc hình chạm hit line — tức `start === beatToTime(beat)` trên
 * trục clock — ở mọi chỗ gián đoạn (play, seek, loop wrap, đổi tempo).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Timeline, TimelineNote } from '../core/types';
import { AUDIO_START_MARGIN_SEC, createAudioClock } from '../player/clock';
import { Transport } from '../player/transport';
import type { TransportSnapshot } from '../player/transport.types';
import { FakeAudioContext, asAudioNode } from './fakeAudioContext';
import type { FakeAudioContextOptions, FakeOscillatorNode } from './fakeAudioContext';
import { AudioScheduler, ONSET_CUT_SEC, TICK_MS } from './scheduler';
import type { SchedulerOptions, SchedulerSource } from './scheduler';

/** Nốt [startBeat, beats]; midi = 60 + index. */
function makeTl(spec: readonly (readonly [number, number])[], totalBeats?: number): Timeline {
  const notes: TimelineNote[] = spec.map(([start, beats], i) => ({
    index: i,
    key: 'Z',
    octave: 0,
    sharp: false,
    startBeat: start,
    endBeat: start + beats,
    midi: 60 + i,
    modifiers: { left: false, right: false, scroll: false },
    lineIndex: 0,
    sectionIndex: 0,
    unitIndex: i,
    slur: null,
    runIndex: null,
  }));
  const last = spec[spec.length - 1];
  return {
    bpm: 120,
    timeSig: { num: 4, den: 4 },
    beatsPerBar: 4,
    scrollDir: 1,
    baseOctave: 4,
    notes,
    lines: [],
    sections: [],
    holdRuns: [],
    totalBeats: totalBeats ?? (last ? last[0] + last[1] : 0),
  };
}

const everyBeat = (n: number): Timeline =>
  makeTl(Array.from({ length: n }, (_, i) => [i, 1] as const));

const midiOf = (o: FakeOscillatorNode): number =>
  Math.round(69 + 12 * Math.log2(o.frequency.value / 440));

function rig(
  tl: Timeline,
  ctxOpts: FakeAudioContextOptions = {},
  opts: SchedulerOptions = { metronome: false, timbre: 'sine' },
) {
  const ctx = new FakeAudioContext(ctxOpts);
  const music = ctx.createGain();
  const click = ctx.createGain();
  const transport = new Transport({
    clock: createAudioClock(ctx),
    bpm: 120,
    endBeat: tl.totalBeats,
  });
  const scheduler = new AudioScheduler({
    getContext: () => ctx.asAudioContext(),
    musicDestination: () => asAudioNode(music),
    clickDestination: () => asAudioNode(click),
  });
  // Transport phải thỏa mãn interface của scheduler (kiểm tra lúc typecheck).
  const source: SchedulerSource = transport;
  scheduler.start(
    source,
    () => tl,
    () => opts,
  );
  // Như PlayerEngine: mọi thay đổi của transport → poke() ngay.
  const snaps: TransportSnapshot[] = [];
  transport.subscribe((s) => {
    snaps.push(s);
    scheduler.poke();
  });
  const run = (sec: number) => {
    for (let i = 0; i < Math.round((sec * 1000) / TICK_MS); i++) {
      ctx.advance(TICK_MS / 1000);
      vi.advanceTimersByTime(TICK_MS);
    }
  };
  return { ctx, transport, scheduler, run, snaps };
}

describe('AudioScheduler + Transport', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('loop A-B: mỗi vòng phát lại từ loop.start, đúng giờ (lên lịch trước vòng sau)', () => {
    const r = rig(everyBeat(8));
    r.transport.setLoop({ start: 0, end: 2 });
    r.transport.play({ fromBeat: 0 });
    r.run(3.2);
    const oscs = r.ctx.oscillators();
    expect(oscs.map(midiOf)).toEqual([60, 61, 60, 61, 60, 61, 60]);
    const lead = AUDIO_START_MARGIN_SEC;
    oscs.forEach((o, i) => expect(o.startTime).toBeCloseTo(lead + i * 0.5, 9));
    r.scheduler.dispose();
  });

  it('count-in giữa bài: chỉ click trong lúc đếm, nốt bắt đầu từ fromBeat', () => {
    const r = rig(everyBeat(8));
    r.transport.play({ fromBeat: 4, countInBeats: 4 });
    r.run(2.6);
    const lead = AUDIO_START_MARGIN_SEC;
    const clicks = r.ctx.bufferSources().map((s) => s.startTime ?? -1);
    expect(clicks).toHaveLength(4);
    clicks.forEach((t, i) => expect(t).toBeCloseTo(lead + i * 0.5, 9));
    const oscs = r.ctx.oscillators();
    expect(oscs.map(midiOf)).toEqual([64, 65]);
    expect(oscs[0].startTime).toBeCloseTo(lead + 2, 9);
    r.scheduler.dispose();
  });

  it('pause rồi play tiếp: không phát lại nốt cũ, không mất nốt', () => {
    const r = rig(everyBeat(8));
    r.transport.play({ fromBeat: 0 });
    r.run(0.6); // nốt 0, 1 đã lên lịch
    r.transport.pause();
    r.run(1);
    expect(r.ctx.oscillators()).toHaveLength(2);
    r.transport.play();
    r.run(1.2);
    // pause ở beat ~1.15 → tiếp tục: nốt 2, 3 (nốt 1 đã bị cắt khi pause, không phát lại)
    expect(r.ctx.oscillators().map(midiOf)).toEqual([60, 61, 62, 63]);
    r.scheduler.dispose();
  });

  it('hết bài: transport dừng, scheduler im lặng, interval nghỉ', () => {
    const r = rig(everyBeat(2));
    r.transport.play({ fromBeat: 0 });
    r.run(2);
    expect(r.transport.playing).toBe(false);
    expect(r.ctx.oscillators()).toHaveLength(2);
    expect(r.scheduler.activeVoiceCount).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    r.scheduler.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });

  describe('có output latency', () => {
    const LATENCY = { outputLatency: 0.048, baseLatency: 0.01 };

    it('play: nốt đầu nghe đúng lúc hình chạm hit line, hình chờ khoảng latency', () => {
      const r = rig(everyBeat(8), { ...LATENCY, currentTime: 1 });
      r.transport.play({ fromBeat: 0 });
      const anchor = r.transport.snapshot().anchorTime;
      expect(anchor).toBeCloseTo(1 - 0.058 + 0.058 + AUDIO_START_MARGIN_SEC, 9);
      // Hình đứng ở beat 0 tới khi âm thanh kịp ra loa.
      r.ctx.advance(0.05);
      expect(r.transport.getBeat()).toBe(0);
      r.run(1);
      const oscs = r.ctx.oscillators();
      expect(oscs.map(midiOf)).toEqual([60, 61, 62]);
      oscs.forEach((o, i) => expect(o.startTime).toBeCloseTo(anchor + i * 0.5, 9));
      r.scheduler.dispose();
    });

    it('latency lớn (0.25 s): nốt ở điểm play không bị bỏ', () => {
      const r = rig(everyBeat(8), { outputLatency: 0.25, currentTime: 1 });
      r.transport.play({ fromBeat: 0 });
      r.run(0.6);
      const oscs = r.ctx.oscillators();
      expect(oscs.map(midiOf)).toEqual([60, 61]);
      expect(oscs[0].startTime).toBeCloseTo(r.transport.snapshot().anchorTime, 9);
      r.scheduler.dispose();
    });

    it('seek khi đang phát: nốt tại điểm seek đúng giờ', () => {
      const r = rig(everyBeat(8), LATENCY);
      r.transport.play({ fromBeat: 0 });
      r.run(0.5);
      r.transport.seek(5);
      const anchor = r.transport.snapshot().anchorTime;
      r.run(0.3);
      const after = r.ctx.oscillators().filter((o) => midiOf(o) >= 65);
      expect(after.map(midiOf)).toEqual([65]);
      expect(after[0].startTime).toBeCloseTo(anchor, 9);
      r.scheduler.dispose();
    });

    for (const [name, ctxOpts] of [
      ['48+10 ms', LATENCY],
      ['190+10 ms (Bluetooth)', { outputLatency: 0.19, baseLatency: 0.01 }],
    ] as const) {
      it(`loop wrap (${name}): nốt ở loop.start đúng giờ mọi vòng, không bị bỏ`, () => {
        const r = rig(everyBeat(8), ctxOpts);
        r.transport.setLoop({ start: 0, end: 2 });
        r.transport.play({ fromBeat: 0 });
        r.run(3.3);
        // snapshot phát từ beat 0: lần play rồi các lần wrap.
        const wraps = r.snaps.filter((s) => s.playing && s.anchorBeat === 0).slice(1);
        expect(wraps.length).toBeGreaterThanOrEqual(2);
        const oscs = r.ctx.oscillators();
        expect(oscs.map(midiOf)).toEqual([60, 61, 60, 61, 60, 61, 60]);
        const loopStarts = oscs.filter((o) => midiOf(o) === 60).slice(1);
        wraps.forEach((w, i) => expect(loopStarts[i].startTime).toBeCloseTo(w.anchorTime, 9));
        // Không voice nào bị cắt sớm ở chỗ wrap.
        for (const o of oscs) expect(o.stopCalls).toHaveLength(1);
        r.scheduler.dispose();
      });
    }

    it('loop + count-in: play từ loop end (hoặc sau đó) không wrap về loop start', () => {
      for (const from of [2, 3.5]) {
        const r = rig(everyBeat(8), LATENCY);
        r.transport.setLoop({ start: 0, end: 2 });
        r.transport.play({ fromBeat: from, countInBeats: 4 });
        r.run(3.4); // count-in 2 s + 1.4 s
        const midis = r.ctx.oscillators().map(midiOf);
        expect(midis[0]).toBe(60 + Math.ceil(from));
        expect(midis).not.toContain(60);
        expect(r.transport.getBeat()).toBeGreaterThan(from);
        r.scheduler.dispose();
      }
    });

    it('đổi bpm giữa nốt dài: không cắt nốt đang ngân, nốt sau theo tempo mới', () => {
      const r = rig(
        makeTl([
          [0, 4],
          [4, 1],
          [5, 1],
        ]),
        LATENCY,
      );
      r.transport.play({ fromBeat: 0 });
      r.run(1.2);
      const held = r.ctx.oscillators()[0];
      const naturalStop = held.stopTime;
      r.transport.setBpm(122);
      r.transport.setBpm(124);
      r.run(1.5);
      expect(held.stopCalls).toHaveLength(1);
      expect(held.stopTime).toBe(naturalStop);
      const oscs = r.ctx.oscillators();
      expect(oscs.map(midiOf)).toEqual([60, 61, 62]);
      expect(oscs[1].startTime).toBeCloseTo(r.transport.beatToTime(4), 9);
      expect(oscs[2].startTime).toBeCloseTo(r.transport.beatToTime(5), 9);
      r.scheduler.dispose();
    });

    it('đổi bpm ngay sau khi nốt start trên ctx (chưa nghe): không kích hai lần', () => {
      const r = rig(everyBeat(8), LATENCY);
      r.transport.play({ fromBeat: 0 });
      const startOf1 = r.transport.beatToTime(1);
      // Tới ngay sau lúc nốt 1 start trên ctx (người nghe còn ~58 ms nữa mới tới).
      while (r.ctx.currentTime < startOf1 + 0.008) r.run(0.025);
      r.transport.setBpm(122);
      r.run(0.6);
      const midis = r.ctx.oscillators().map(midiOf);
      expect(midis.filter((m) => m === 61)).toHaveLength(1);
      expect(midis.slice(0, 3)).toEqual([60, 61, 62]);
      r.scheduler.dispose();
    });

    it('pause khi nốt đã start trên ctx nhưng chưa nghe: cắt cực nhanh, play lại phát đúng 1 lần', () => {
      const r = rig(everyBeat(8), LATENCY);
      r.transport.play({ fromBeat: 0 });
      const startOf1 = r.transport.beatToTime(1);
      while (r.ctx.currentTime < startOf1 + 0.01) r.run(0.025);
      const upcoming = r.ctx.oscillators()[1];
      expect(midiOf(upcoming)).toBe(61);
      r.transport.pause(); // người nghe đang ở trước beat 1
      expect(r.transport.getBeat()).toBeLessThan(1);
      const now = r.ctx.currentTime;
      expect(upcoming.stopTime).toBeCloseTo(now + ONSET_CUT_SEC + 0.005, 9);
      r.transport.play();
      r.run(0.4);
      const replay = r.ctx.oscillators().slice(2);
      expect(replay.map(midiOf)).toEqual([61]);
      expect(replay[0].startTime).toBeCloseTo(r.transport.beatToTime(1), 9);
      r.scheduler.dispose();
    });
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { midiToFrequency } from '../core/keys';
import type { Timeline, TimelineNote } from '../core/types';
import type { TransportSnapshot } from '../player/transport.types';
import {
  FakeAudioContext,
  FakeBiquadFilterNode,
  FakeGainNode,
  asAudioNode,
} from './fakeAudioContext';
import type { FakeOscillatorNode } from './fakeAudioContext';
import {
  ARTICULATION,
  AudioScheduler,
  MAX_LATENESS_SEC,
  ONSET_CUT_SEC,
  TICK_MS,
  beatToTime,
  leadInClickEnd,
  planEvents,
  timeToBeat,
} from './scheduler';
import type { ClickEvent, NoteEvent, PlannedEvent, SchedulerOptions } from './scheduler';
import { QUICK_RELEASE } from './synth';

interface NoteSpec {
  start: number;
  beats: number;
  midi?: number;
  slur?: boolean;
}

function makeTimeline(specs: NoteSpec[], beatsPerBar = 4): Timeline {
  const notes: TimelineNote[] = specs.map((s, i) => ({
    index: i,
    key: 'Z',
    octave: 0,
    sharp: false,
    startBeat: s.start,
    endBeat: s.start + s.beats,
    midi: s.midi ?? 60 + (i % 24),
    modifiers: { left: false, right: false, scroll: false },
    lineIndex: 0,
    sectionIndex: 0,
    unitIndex: i,
    slur: s.slur ? { id: 0, pos: 0, count: 2 } : null,
    runIndex: null,
  }));
  const last = specs[specs.length - 1];
  return {
    bpm: 120,
    timeSig: { num: beatsPerBar, den: 4 },
    beatsPerBar,
    scrollDir: 1,
    baseOctave: 4,
    notes,
    lines: [],
    sections: [],
    holdRuns: [],
    totalBeats: last ? last.start + last.beats : 0,
  };
}

function snap(over: Partial<TransportSnapshot> = {}): TransportSnapshot {
  const anchorBeat = over.anchorBeat ?? 0;
  return {
    playing: true,
    anchorTime: 0,
    anchorBeat,
    bpm: 120,
    epoch: 1,
    loop: null,
    countIn: null,
    // Như transport: đoạn phát bắt đầu ở điểm play (sau count-in) / anchor.
    segmentStart: over.countIn ? over.countIn.end : anchorBeat,
    endBeat: 1000,
    ...over,
  };
}

const notesOf = (evs: PlannedEvent[]): NoteEvent[] =>
  evs.filter((e): e is NoteEvent => e.type === 'note');
const clicksOf = (evs: PlannedEvent[]): ClickEvent[] =>
  evs.filter((e): e is ClickEvent => e.type === 'click');

/** 16 nốt mỗi beat. */
const everyBeat = (n = 16) =>
  makeTimeline(Array.from({ length: n }, (_, i) => ({ start: i, beats: 1 })));

describe('beatToTime / timeToBeat', () => {
  it('bpm 120 → 0.5 s/beat quanh anchor', () => {
    const s = snap({ anchorTime: 10, anchorBeat: 4 });
    expect(beatToTime(s, 4)).toBe(10);
    expect(beatToTime(s, 6)).toBe(11);
    expect(beatToTime(s, 3)).toBe(9.5);
    expect(timeToBeat(s, 11.25)).toBe(6.5);
  });
});

describe('planEvents', () => {
  const opts = { metronome: false };

  it('chỉ lấy nốt có startBeat trong [from, to) (nửa mở)', () => {
    const tl = everyBeat(6);
    const evs = notesOf(planEvents(tl, snap(), 1, 3, opts));
    expect(evs.map((e) => e.beat)).toEqual([1, 2]);
    expect(evs.map((e) => e.noteIndex)).toEqual([1, 2]);
    expect(notesOf(planEvents(tl, snap(), 3, 3, opts))).toEqual([]);
    expect(notesOf(planEvents(tl, snap(), 2.5, 3, opts))).toEqual([]);
    expect(notesOf(planEvents(tl, snap(), 2.999, 3.001, opts)).map((e) => e.beat)).toEqual([3]);
  });

  it('các cửa sổ liền nhau: không trùng, không hở', () => {
    const tl = makeTimeline(
      Array.from({ length: 40 }, (_, i) => ({ start: i * 0.29 + (i % 3) / 70, beats: 0.2 })),
    );
    const cuts = [0, 0.13, 0.13, 1, 1.0000001, 2.5, 3.3333, 5, 7.77, 9, 10.5, 12];
    const all: PlannedEvent[] = [];
    for (let i = 1; i < cuts.length; i++) {
      all.push(...planEvents(tl, snap(), cuts[i - 1], cuts[i], { metronome: true }));
    }
    const notes = notesOf(all).map((e) => e.noteIndex);
    expect(notes).toEqual(tl.notes.map((n) => n.index));
    const clicks = clicksOf(all).map((e) => e.beat);
    expect(clicks).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  });

  it('bpm → thời gian và độ dài; nốt thường rút ngắn, nốt luyến giữ đủ', () => {
    const tl = makeTimeline([
      { start: 0, beats: 1, midi: 62 },
      { start: 1, beats: 0.5, slur: true },
      { start: 1.5, beats: 0.5, slur: true },
    ]);
    const s = snap({ anchorTime: 2, anchorBeat: 0, bpm: 120 });
    const evs = notesOf(planEvents(tl, s, 0, 4, opts));
    expect(evs[0]).toMatchObject({ type: 'note', midi: 62, time: 2 });
    expect(evs[0].duration).toBeCloseTo(0.5 * ARTICULATION);
    expect(evs[1].time).toBe(2.5);
    expect(evs[1].duration).toBe(0.25);
    expect(evs[2].time).toBe(2.75);
    expect(evs[2].duration).toBe(0.25);

    const slow = notesOf(planEvents(tl, snap({ bpm: 60 }), 0, 1, opts));
    expect(slow[0].duration).toBeCloseTo(1 * ARTICULATION);
  });

  it('dùng anchor của snapshot (sau seek/bpm override)', () => {
    const tl = everyBeat(16);
    const s = snap({ anchorTime: 100, anchorBeat: 8, bpm: 90 });
    const [first] = notesOf(planEvents(tl, s, 8, 10, opts));
    expect(first.beat).toBe(8);
    expect(first.time).toBe(100);
    const [, second] = notesOf(planEvents(tl, s, 8, 10, opts));
    expect(second.time).toBeCloseTo(100 + 60 / 90);
  });

  it('rest không sinh sự kiện', () => {
    const tl = makeTimeline([
      { start: 0, beats: 1 },
      { start: 4, beats: 1 },
    ]);
    expect(planEvents(tl, snap(), 1, 4, opts)).toEqual([]);
    expect(planEvents(makeTimeline([]), snap(), 0, 100, opts)).toEqual([]);
  });

  it('count-in: click mọi beat nguyên, accent chỉ ở đầu ô nhịp; không phát nốt trong vùng đếm', () => {
    const tl = everyBeat(8);
    const s = snap({ anchorBeat: -4, countIn: { start: -4, end: 0 } });
    const evs = planEvents(tl, s, -4, 1, opts);
    const clicks = clicksOf(evs);
    expect(clicks.map((c) => c.beat)).toEqual([-4, -3, -2, -1]);
    expect(clicks.map((c) => c.accent)).toEqual([true, false, false, false]);
    expect(clicks[0].time).toBe(0);
    expect(clicks[1].time).toBe(0.5);
    expect(notesOf(evs).map((e) => e.beat)).toEqual([0]);

    // Đếm vào giữa bài (từ beat 6, 4 beat): nốt 2..5 im lặng, accent ở đầu ô nhịp (beat 4)
    const mid = snap({ anchorBeat: 2, countIn: { start: 2, end: 6 } });
    const midEvs = planEvents(tl, mid, 2, 7, opts);
    expect(clicksOf(midEvs).map((c) => [c.beat, c.accent])).toEqual([
      [2, false],
      [3, false],
      [4, true],
      [5, false],
    ]);
    expect(notesOf(midEvs).map((e) => e.beat)).toEqual([6]);
  });

  it('count-in bắt đầu lẻ (v1.0.1: đếm vào ngắn hơn ô nhịp): click ở beat nguyên, accent chỉ ở đầu ô nhịp', () => {
    const s = snap({ anchorBeat: 1.5, countIn: { start: 1.5, end: 5.5 } });
    const clicks = clicksOf(planEvents(everyBeat(0), s, 1.5, 6, opts));
    expect(clicks.map((c) => [c.beat, c.accent])).toEqual([
      [2, false],
      [3, false],
      [4, true],
      [5, false],
    ]);
    // Bài vào ngay beat 0, đếm vào 0,65 ô nhịp = [-2.6, 0): còn 2 click (-2, -1), không accent.
    const short = snap({ anchorBeat: -2.6, countIn: { start: -2.6, end: 0 } });
    const evs = planEvents(everyBeat(4), short, -2.6, 1, opts);
    expect(clicksOf(evs).map((c) => [c.beat, c.accent])).toEqual([
      [-2, false],
      [-1, false],
    ]);
    expect(notesOf(evs).map((e) => e.beat)).toEqual([0]);
  });

  it('click dẫn vào đếm tiếp qua khoảng lặng đầu bài tới nốt đầu (Quốc ca: −1, 0, 1, 2 rồi nốt ở 2,75)', () => {
    const tl = makeTimeline([
      { start: 2.75, beats: 0.25 },
      { start: 3, beats: 1 },
    ]);
    expect(leadInClickEnd(tl, { end: 0 })).toBe(2.75);
    expect(leadInClickEnd(tl, { end: 3 })).toBe(3);
    expect(leadInClickEnd(tl, { end: 5 })).toBe(5);
    const s = snap({ anchorBeat: -1.6375, countIn: { start: -1.6375, end: 0 } });
    const evs = planEvents(tl, s, -1.6375, 4, opts);
    expect(clicksOf(evs).map((c) => [c.beat, c.accent])).toEqual([
      [-1, false],
      [0, true],
      [1, false],
      [2, false],
    ]);
    expect(notesOf(evs).map((e) => e.beat)).toEqual([2.75, 3]);
    // Count-in đã hết trên transport: AudioScheduler truyền lại count-in của đoạn phát → cửa sổ sau vẫn đếm.
    expect(clicksOf(planEvents(tl, s, 0.5, 2.5, opts)).map((c) => c.beat)).toEqual([1, 2]);
  });

  it('metronome 3/4: accent mỗi 3 beat, chỉ trong [0, endBeat)', () => {
    const tl = makeTimeline([{ start: 0, beats: 1 }], 3);
    const s = snap({ endBeat: 7 });
    const clicks = clicksOf(planEvents(tl, s, -2, 10, { metronome: true }));
    expect(clicks.map((c) => c.beat)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(clicks.filter((c) => c.accent).map((c) => c.beat)).toEqual([0, 3, 6]);
  });

  it('metronome tắt và không count-in → không click', () => {
    expect(clicksOf(planEvents(everyBeat(4), snap(), 0, 4, opts))).toEqual([]);
  });

  it('clicks: false (tiếng click tắt) → không click kể cả count-in / metronome; nốt vẫn có', () => {
    const tl = everyBeat(4);
    const s = snap({ anchorBeat: -4, countIn: { start: -4, end: 0 } });
    const evs = planEvents(tl, s, -4, 4, { metronome: true, clicks: false });
    expect(clicksOf(evs)).toEqual([]);
    expect(evs.filter((e) => e.type === 'note')).toHaveLength(4);
    // Bỏ trống = có click (tương thích cũ).
    expect(clicksOf(planEvents(tl, s, -4, 0, { metronome: false }))).toHaveLength(4);
  });

  it('kết quả sắp theo thời gian; cửa sổ rỗng/ngược trả []', () => {
    const tl = makeTimeline([
      { start: 0.5, beats: 1 },
      { start: 1, beats: 1 },
    ]);
    const evs = planEvents(tl, snap(), 0, 2, { metronome: true });
    const times = evs.map((e) => e.time);
    expect(times).toEqual([...times].sort((a, b) => a - b));
    expect(planEvents(tl, snap(), 2, 1, opts)).toEqual([]);
    expect(planEvents(tl, snap({ bpm: 0 }), 0, 2, opts)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// AudioScheduler
// ---------------------------------------------------------------------------

class FakeSource {
  snap: TransportSnapshot;
  updates = 0;
  constructor(s: TransportSnapshot) {
    this.snap = s;
  }
  snapshot(): TransportSnapshot {
    return this.snap;
  }
  update(): void {
    this.updates++;
  }
  set(over: Partial<TransportSnapshot>): void {
    this.snap = { ...this.snap, ...over };
  }
}

function rig(timeline: Timeline, s: TransportSnapshot, options?: Partial<SchedulerOptions>) {
  const ctx = new FakeAudioContext();
  const music = ctx.createGain();
  const click = ctx.createGain();
  const stopListeners = new Set<() => void>();
  const output = {
    getContext: () => ctx.asAudioContext(),
    musicDestination: () => asAudioNode(music),
    clickDestination: () => asAudioNode(click),
    addStopListener: (fn: () => void) => {
      stopListeners.add(fn);
      return () => stopListeners.delete(fn);
    },
  };
  const source = new FakeSource(s);
  const scheduler = new AudioScheduler(output);
  let tl: Timeline | null = timeline;
  const opts: SchedulerOptions = { metronome: false, timbre: 'sine', ...options };
  const start = () =>
    scheduler.start(
      source,
      () => tl,
      () => opts,
    );
  /** Tiến cả AudioContext lẫn timer giả theo bước 25 ms. */
  const run = (sec: number) => {
    const steps = Math.round((sec * 1000) / TICK_MS);
    for (let i = 0; i < steps; i++) {
      ctx.advance(TICK_MS / 1000);
      vi.advanceTimersByTime(TICK_MS);
    }
  };
  /** Oscillator nốt (sine) — mỗi voice sine đúng 1 oscillator. */
  const noteOscs = () => ctx.oscillators();
  const setTimeline = (next: Timeline | null) => {
    tl = next;
  };
  return {
    ctx,
    music,
    click,
    source,
    scheduler,
    start,
    run,
    noteOscs,
    opts,
    stopListeners,
    setTimeline,
  };
}

function freqToMidi(o: FakeOscillatorNode): number {
  return Math.round(69 + 12 * Math.log2(o.frequency.value / 440));
}

describe('AudioScheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('lên lịch mỗi nốt đúng 1 lần qua nhiều tick, đúng thời điểm', () => {
    const tl = everyBeat(16);
    const r = rig(tl, snap({ anchorTime: 0.05, endBeat: 16 }));
    r.start();
    r.run(9);
    const oscs = r.noteOscs();
    expect(oscs).toHaveLength(16);
    oscs.forEach((o, i) => {
      expect(o.startTime).toBeCloseTo(0.05 + i * 0.5, 9);
      expect(freqToMidi(o)).toBe(tl.notes[i].midi);
    });
    expect(r.source.updates).toBeGreaterThan(300);
    // Hết bài → mọi voice kết thúc và được bỏ khỏi tập
    expect(r.scheduler.activeVoiceCount).toBe(0);
    for (const n of r.ctx.nodes) {
      if (n !== r.ctx.destination && n !== r.music && n !== r.click) {
        expect(n.disconnected).toBe(true);
      }
    }
    r.scheduler.dispose();
  });

  it('chỉ lên lịch trước ~100 ms', () => {
    const r = rig(everyBeat(16), snap({ anchorTime: 0.3 }));
    r.start();
    expect(r.noteOscs()).toHaveLength(0);
    r.run(0.15); // now 0.15 → cửa sổ tới 0.25 s: nốt ở 0.3 s chưa vào
    expect(r.noteOscs()).toHaveLength(0);
    r.run(0.075); // now 0.225 → cửa sổ tới 0.325 s
    expect(r.noteOscs()).toHaveLength(1);
    expect(r.noteOscs()[0].startTime).toBeCloseTo(0.3);
    r.scheduler.dispose();
  });

  it('click metronome + count-in đi vào clickDestination', () => {
    const r = rig(everyBeat(4), snap({ anchorBeat: -4, countIn: { start: -4, end: 0 } }), {
      metronome: true,
    });
    r.start();
    // source → filter → gain → click bus (kiểm tra trước khi click kết thúc và tự ngắt)
    const filter = r.ctx.bufferSources()[0].connections[0];
    expect(filter).toBeInstanceOf(FakeBiquadFilterNode);
    const gain = (filter as FakeBiquadFilterNode).connections[0];
    expect(gain).toBeInstanceOf(FakeGainNode);
    expect((gain as FakeGainNode).connections).toEqual([r.click]);
    r.run(0.8); // now 0.8 → cửa sổ tới beat -2.2
    expect(r.ctx.bufferSources().map((s) => s.startTime)).toEqual([0, 0.5]);
    expect(r.noteOscs()).toHaveLength(0);
    r.scheduler.dispose();
  });

  it('count-in hết trên transport (cùng epoch): click dẫn vào vẫn đếm tới nốt đầu; đoạn mới thì thôi', () => {
    // Nốt đầu ở beat 2 (khoảng lặng 2 beat), count-in [-1, 0) — 120 BPM, anchorTime 0: beat b ở (b + 1) × 0.5 s.
    const tl = makeTimeline([
      { start: 2, beats: 1 },
      { start: 3, beats: 1 },
    ]);
    const r = rig(tl, snap({ anchorBeat: -1, countIn: { start: -1, end: 0 } }));
    r.start();
    r.run(0.6); // beat 0.2: transport đã qua count-in
    r.source.set({ countIn: null });
    r.run(1.6); // tới beat 3.4
    // Click ở beat -1, 0, 1 (beat 2 là nốt đầu → thôi đếm); nốt ở 2 và 3.
    expect(r.ctx.bufferSources().map((x) => x.startTime)).toEqual([0, 0.5, 1]);
    expect(r.noteOscs().map((o) => o.startTime)).toEqual([1.5, 2]);
    // Đoạn phát mới không đếm vào (vd. tua): không click nào nữa.
    r.source.set({ epoch: 2, anchorBeat: 0, anchorTime: 2.5, segmentStart: 0 });
    r.run(1.5);
    expect(r.ctx.bufferSources()).toHaveLength(3);
    r.scheduler.dispose();
  });

  it('nốt trễ ≤ 200 ms phát ngay (rút ngắn), trễ hơn thì bỏ', () => {
    const tl = makeTimeline([
      { start: 0, beats: 1 }, // trễ 1 s → bỏ
      { start: 1.5, beats: 0.5 }, // trễ 0.25 s → bỏ
      { start: 1.8, beats: 1 }, // trễ 0.1 s → phát ngay
      { start: 2, beats: 1 }, // đúng giờ
    ]);
    const r = rig(tl, snap({ anchorTime: 0, epoch: 7 }));
    r.ctx.currentTime = 1;
    r.start();
    const oscs = r.noteOscs();
    expect(oscs.map((o) => o.startTime)).toEqual([1, 1]);
    expect(oscs.map(freqToMidi)).toEqual([tl.notes[2].midi, tl.notes[3].midi]);
    // nốt trễ 0.1 s bị rút ngắn để kết thúc đúng chỗ: 0.5*0.92 - 0.1 (+ release)
    const lateEnd = oscs[0].stopTime ?? 0;
    expect(lateEnd).toBeCloseTo(1 + (0.5 * ARTICULATION - 0.1) + 0.12, 6);
    expect(MAX_LATENESS_SEC).toBe(0.2);
    r.scheduler.dispose();
  });

  it('pause: dừng mọi voice (release nhanh) và không lên lịch nữa', () => {
    const r = rig(everyBeat(16), snap());
    r.start();
    r.run(0.5);
    const before = r.noteOscs().length;
    expect(before).toBeGreaterThan(0);
    expect(r.scheduler.activeVoiceCount).toBeGreaterThan(0);
    r.source.set({ playing: false, anchorBeat: 1, anchorTime: r.ctx.currentTime, epoch: 2 });
    r.scheduler.poke();
    expect(r.scheduler.activeVoiceCount).toBe(0);
    const now = r.ctx.currentTime;
    for (const o of r.noteOscs()) {
      if (!o.ended) expect(o.stopTime).toBeLessThanOrEqual(Math.max(now + 0.03, o.startTime ?? 0));
    }
    r.run(2);
    expect(r.noteOscs()).toHaveLength(before);
    r.scheduler.dispose();
  });

  it('epoch đổi (seek): hủy voice chưa phát + đang kêu, chạy lại từ anchorBeat', () => {
    const tl = everyBeat(16);
    const r = rig(tl, snap({ anchorTime: 0.05 }));
    r.start();
    r.run(0.5); // now 0.5: nốt 0 (0.05) đang kêu, nốt 1 (0.55) đã lên lịch nhưng chưa phát
    const [sounding, pending] = r.noteOscs();
    expect(pending.startTime).toBeCloseTo(0.55);
    // seek tới beat 8 ngay bây giờ
    r.source.set({ anchorBeat: 8, anchorTime: 0.5, epoch: 2 });
    r.scheduler.poke();
    expect(sounding.stopCalls.length).toBe(2);
    expect(sounding.stopTime).toBeLessThan(0.55);
    expect(pending.stopCalls.length).toBe(2);
    expect(pending.stopTime).toBeCloseTo(0.55); // dừng đúng lúc start → im lặng
    const after = r.noteOscs().slice(2);
    expect(after.map(freqToMidi)).toEqual([tl.notes[8].midi]);
    expect(after[0].startTime).toBeCloseTo(0.5);
    r.run(1);
    expect(r.noteOscs().slice(2).map(freqToMidi)).toEqual([8, 9, 10].map((i) => tl.notes[i].midi));
    r.scheduler.dispose();
  });

  it('loop: không lên lịch nốt sau loop.end; vòng sau lên lịch trước, đúng giờ', () => {
    const tl = everyBeat(16);
    const r = rig(tl, snap({ anchorTime: 0, anchorBeat: 0, loop: { start: 0, end: 2 } }));
    r.start();
    r.run(0.85); // now 0.85: cửa sổ tới beat 1.9 — chưa chạm loop end
    expect(r.noteOscs().map(freqToMidi)).toEqual([0, 1].map((i) => tl.notes[i].midi));
    r.run(0.075); // now 0.925: cửa sổ vượt loop end → kẹp tại 2 (nốt 2 không bao giờ phát),
    // vòng sau (nốt 0 lúc 1.0) lên lịch trước
    const lap = r.noteOscs().slice(2);
    expect(lap.map(freqToMidi)).toEqual([tl.notes[0].midi]);
    expect(lap[0].startTime).toBeCloseTo(1, 9); // đúng giờ, không trễ
    r.run(0.15); // now 1.075 — transport (nghe trễ) chưa wrap: không gì thay đổi
    const sounding = lap[0];
    // Transport wrap đúng như dự đoán: neo tại loop.start, anchorTime = lúc chạm loop end.
    r.source.set({ anchorBeat: 0, anchorTime: 1, epoch: 2 });
    r.scheduler.poke();
    expect(sounding.stopCalls).toHaveLength(1); // không bị cắt
    expect(r.noteOscs()).toHaveLength(3); // không phát lại
    r.run(1);
    expect(r.noteOscs().slice(2).map(freqToMidi)).toEqual([0, 1, 0].map((i) => tl.notes[i].midi));
    expect(r.noteOscs().map((o) => o.startTime)).toEqual([0, 0.5, 1, 1.5, 2]);
    r.scheduler.dispose();
  });

  it('loop: wrap khác dự đoán (vd. bị treo) → coi là gián đoạn, chạy lại từ anchor', () => {
    const tl = everyBeat(16);
    const r = rig(tl, snap({ anchorTime: 0, anchorBeat: 0, loop: { start: 0, end: 2 } }));
    r.start();
    r.run(0.95); // vòng sau đã lên lịch (nốt 0 lúc 1.0)
    expect(r.noteOscs()).toHaveLength(3);
    const planned = r.noteOscs()[2];
    // Transport wrap với anchor khác dự đoán (vd. update() trễ nhiều vòng).
    r.source.set({ anchorBeat: 0, anchorTime: 0.95, epoch: 2 });
    r.scheduler.poke();
    expect(planned.stopCalls).toHaveLength(2);
    expect(r.noteOscs()[3].startTime).toBeCloseTo(0.95);
    r.scheduler.dispose();
  });

  it('loop: playhead bắt đầu từ loop.end trở đi (kể cả có count-in) thì không kẹp', () => {
    const tl = everyBeat(16);
    // Count-in 4 beat trước beat 2 (= loop end): anchorBeat -2 < loop end nhưng đoạn phát bắt đầu ở 2.
    const r = rig(
      tl,
      snap({ anchorBeat: -2, countIn: { start: -2, end: 2 }, loop: { start: 0, end: 2 } }),
    );
    r.start();
    r.run(2.6); // count-in 2 s rồi beat 2..3.2
    expect(r.noteOscs().map(freqToMidi)).toEqual([2, 3].map((i) => tl.notes[i].midi));
    expect(r.noteOscs()[0].startTime).toBeCloseTo(2);
    r.scheduler.dispose();
  });

  it('đặt loop khi cửa sổ đã vượt loop end mới: hủy phần vượt, lên lịch vòng sau', () => {
    const tl = everyBeat(16);
    const r = rig(tl, snap());
    r.start();
    r.run(0.95); // now 0.95: đã lên lịch nốt 0..2 (nốt 2 lúc 1.0 chưa phát)
    const third = r.noteOscs()[2];
    expect(third.startTime).toBeCloseTo(1);
    r.source.set({ loop: { start: 0, end: 2 }, segmentStart: 1.9 });
    r.scheduler.poke();
    expect(third.stopTime).toBeCloseTo(1); // hủy, không phát mẫu nào
    const lap = r.noteOscs().slice(3);
    expect(lap.map(freqToMidi)).toEqual([tl.notes[0].midi]);
    expect(lap[0].startTime).toBeCloseTo(1);
    r.scheduler.dispose();
  });

  it('tắt loop khi đã lên lịch vòng sau: cắt vòng sau, chạy tiếp sau loop end', () => {
    const tl = everyBeat(16);
    const loop = { start: 0, end: 2 };
    const r = rig(tl, snap({ loop }));
    r.start();
    r.run(0.95);
    const lapNote = r.noteOscs()[2];
    expect(freqToMidi(lapNote)).toBe(tl.notes[0].midi);
    r.source.set({ loop: null });
    r.scheduler.poke();
    expect(lapNote.stopTime).toBeCloseTo(1);
    const next = r.noteOscs().slice(3);
    expect(next.map(freqToMidi)).toEqual([tl.notes[2].midi]);
    expect(next[0].startTime).toBeCloseTo(1);
    r.scheduler.dispose();
  });

  it('đổi bpm (cùng epoch): giữ nốt đang ngân, không phát lại, nốt sau theo tempo mới', () => {
    const tl = makeTimeline([
      { start: 0, beats: 4 },
      { start: 4, beats: 1 },
      { start: 5, beats: 1 },
    ]);
    const r = rig(tl, snap({ endBeat: 6 }));
    r.start();
    r.run(1); // now 1.0, beat 2: nốt 0 (0..1.84 s) đang ngân
    const held = r.noteOscs()[0];
    const naturalStop = held.stopTime;
    // Re-anchor tại beat 2 lúc 1.0, tempo 60 (như Transport.setBpm, không tăng epoch).
    r.source.set({ anchorBeat: 2, anchorTime: 1, bpm: 60 });
    r.scheduler.poke();
    expect(held.stopCalls).toHaveLength(1);
    expect(held.stopTime).toBe(naturalStop);
    r.run(2.2); // beat 4 lúc 3.0 s ở 60 bpm
    const oscs = r.noteOscs();
    expect(oscs.map(freqToMidi)).toEqual(tl.notes.slice(0, 2).map((n) => n.midi));
    expect(oscs[1].startTime).toBeCloseTo(3);
    r.scheduler.dispose();
  });

  it('đổi bpm ngay sau khi nốt vừa start trên ctx: không kích nốt hai lần', () => {
    const tl = everyBeat(16);
    const r = rig(tl, snap());
    r.start();
    r.run(0.525); // nốt 1 (0.5) đã start trên ctx
    r.source.set({ anchorBeat: 0.9, anchorTime: 0.45, bpm: 122 });
    r.scheduler.poke();
    r.run(0.5);
    const midis = r.noteOscs().map(freqToMidi);
    expect(midis.filter((m) => m === tl.notes[1].midi)).toHaveLength(1);
    expect(midis).toEqual([0, 1, 2].map((i) => tl.notes[i].midi));
    r.scheduler.dispose();
  });

  it('loop: playhead đã qua loop.end thì không kẹp (chạy tới hết bài như transport)', () => {
    const tl = everyBeat(16);
    const r = rig(tl, snap({ anchorBeat: 4, loop: { start: 0, end: 2 } }));
    r.start();
    r.run(1);
    expect(r.noteOscs().map(freqToMidi)).toEqual([4, 5, 6].map((i) => tl.notes[i].midi));
    r.scheduler.dispose();
  });

  it('endBeat kẹp cửa sổ', () => {
    const tl = everyBeat(16);
    const r = rig(tl, snap({ endBeat: 2 }), { metronome: true });
    r.start();
    r.run(3);
    expect(r.noteOscs()).toHaveLength(2);
    expect(r.ctx.bufferSources()).toHaveLength(2);
    r.scheduler.dispose();
  });

  it('gọi source.update() trước khi đọc snapshot mỗi tick', () => {
    const tl = everyBeat(16);
    const r = rig(tl, snap({ anchorBeat: 0 }));
    // update() áp wrap ngay trong tick
    r.source.update = () => {
      r.source.updates++;
      if (r.source.updates === 1) r.source.set({ anchorBeat: 4, epoch: 5 });
    };
    r.start();
    expect(r.noteOscs().map(freqToMidi)).toEqual([tl.notes[4].midi]);
    r.scheduler.dispose();
  });

  it('timbre harmonica dùng 2 saw mỗi nốt', () => {
    const r = rig(everyBeat(1), snap(), { timbre: 'harmonica' });
    r.start();
    expect(r.noteOscs().filter((o) => o.type === 'sawtooth')).toHaveLength(2);
    r.scheduler.dispose();
  });

  it('context suspended: chờ, không reset; clock không phải audio: im lặng', () => {
    const tl = everyBeat(16);
    const r = rig(tl, snap());
    r.ctx.state = 'suspended';
    r.start();
    expect(r.noteOscs()).toHaveLength(0);
    r.ctx.state = 'running';
    r.run(0.025);
    expect(r.noteOscs().map(freqToMidi)).toEqual([tl.notes[0].midi]);
    r.scheduler.dispose();

    const p = rig(tl, snap());
    const perfSource = Object.assign(p.source, { clock: { kind: 'performance' as const } });
    p.scheduler.start(
      perfSource,
      () => tl,
      () => p.opts,
    );
    p.run(1);
    expect(p.noteOscs()).toHaveLength(0);
    p.scheduler.dispose();
  });

  it('timeline null → im lặng; đổi timeline giữa chừng → hủy nốt chưa phát', () => {
    const tl = everyBeat(16);
    const r = rig(tl, snap({ anchorTime: 0.05 }));
    r.setTimeline(null);
    r.start();
    r.run(0.1);
    expect(r.noteOscs()).toHaveLength(0);
    r.setTimeline(tl);
    r.run(0.5); // now 0.6: nốt 0 kêu, nốt 1 (0.55) kêu, nốt 2 (1.05) chưa
    r.run(0.4); // now 1.0: nốt 2 đã lên lịch
    const scheduled = r.noteOscs().length;
    const pending = r.noteOscs()[scheduled - 1];
    expect(pending.startTime).toBeCloseTo(1.05);
    const edited = makeTimeline(tl.notes.map((n) => ({ start: n.startBeat, beats: 1, midi: 80 })));
    r.setTimeline(edited);
    r.scheduler.poke();
    expect(pending.stopCalls.length).toBe(2);
    const fresh = r.noteOscs().slice(scheduled);
    expect(fresh.map(freqToMidi)).toEqual([80]);
    expect(fresh[0].startTime).toBeCloseTo(1.05);
    r.scheduler.dispose();
  });

  it('engine.stopAll() (stop listener) dừng voice; dispose hủy đăng ký', () => {
    const r = rig(everyBeat(16), snap());
    r.start();
    expect(r.scheduler.activeVoiceCount).toBe(1);
    expect(r.stopListeners.size).toBe(1);
    for (const fn of r.stopListeners) fn();
    expect(r.scheduler.activeVoiceCount).toBe(0);
    r.scheduler.dispose();
    expect(r.stopListeners.size).toBe(0);
  });

  it('stop()/dispose() xóa interval: không còn timer, không lên lịch thêm', () => {
    const r = rig(everyBeat(16), snap());
    r.start();
    expect(vi.getTimerCount()).toBe(1);
    expect(r.scheduler.running).toBe(true);
    r.run(0.2);
    r.scheduler.stop();
    expect(vi.getTimerCount()).toBe(0);
    expect(r.scheduler.running).toBe(false);
    expect(r.scheduler.activeVoiceCount).toBe(0);
    const n = r.noteOscs().length;
    r.run(2);
    r.scheduler.poke();
    expect(r.noteOscs()).toHaveLength(n);

    r.start();
    expect(vi.getTimerCount()).toBe(1);
    r.scheduler.dispose();
    expect(vi.getTimerCount()).toBe(0);
    const m = r.noteOscs().length;
    r.run(2);
    r.start(); // sau dispose: no-op
    expect(vi.getTimerCount()).toBe(0);
    expect(r.noteOscs()).toHaveLength(m);
  });

  it('start() hai lần không tạo hai interval', () => {
    const r = rig(everyBeat(16), snap());
    r.start();
    r.start();
    expect(vi.getTimerCount()).toBe(1);
    r.scheduler.dispose();
  });

  it('pause / hết bài: interval nghỉ (vẫn running); poke() khi phát lại thì chạy tiếp', () => {
    const tl = everyBeat(16);
    const r = rig(tl, snap({ playing: false }));
    r.start();
    expect(r.scheduler.running).toBe(true);
    expect(r.scheduler.timerActive).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    r.source.set({ playing: true, anchorTime: 0.1, epoch: 2 });
    r.scheduler.poke();
    expect(vi.getTimerCount()).toBe(1);
    r.run(0.6); // cửa sổ tới 0.7 s = beat 1.2
    expect(r.noteOscs()).toHaveLength(2);
    r.source.set({ playing: false, anchorBeat: 1, anchorTime: r.ctx.currentTime, epoch: 3 });
    r.scheduler.poke();
    expect(vi.getTimerCount()).toBe(0);
    expect(r.scheduler.running).toBe(true);
    r.scheduler.dispose();
  });

  it('pause: voice đã start trên ctx nhưng chưa nghe thấy (trong output latency) bị cắt cực nhanh', () => {
    const tl = everyBeat(16);
    const r = rig(tl, snap());
    let heard = 0;
    const source = Object.assign(r.source, {
      clock: { kind: 'audio' as const, now: () => heard },
    });
    r.scheduler.start(
      source,
      () => tl,
      () => r.opts,
    );
    r.run(0.525); // nốt 1 start lúc 0.5 trên ctx
    heard = 0.467; // output latency ~58 ms: người nghe chưa tới nốt 1
    const [first, second] = r.noteOscs();
    r.source.set({ playing: false, anchorBeat: 0.934, anchorTime: heard, epoch: 2 });
    r.scheduler.poke();
    const now = r.ctx.currentTime;
    expect(second.stopTime).toBeCloseTo(now + ONSET_CUT_SEC + 0.005, 9);
    expect(first.stopTime).toBeCloseTo(now + QUICK_RELEASE + 0.005, 9);
    r.scheduler.dispose();
  });

  it('dùng tần số đúng midi', () => {
    const r = rig(makeTimeline([{ start: 0, beats: 1, midi: 69 }]), snap());
    r.start();
    expect(r.noteOscs()[0].frequency.value).toBeCloseTo(midiToFrequency(69));
    r.scheduler.dispose();
  });
});

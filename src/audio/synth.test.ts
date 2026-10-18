import { describe, expect, it, vi } from 'vitest';
import { midiToFrequency } from '../core/keys';
import { FakeAudioContext, FakeAudioParam, FakeGainNode, asAudioNode } from './fakeAudioContext';
import { setHarmonicaBankForTest } from './harmonicaSamples';
import {
  ENVELOPE,
  HARMONICA,
  QUICK_RELEASE,
  SAMPLE_PEAK,
  SINE_PEAK,
  envelopeLevel,
  envelopePoints,
  scheduleVoice,
} from './synth';

function setup(currentTime = 0) {
  const ctx = new FakeAudioContext({ currentTime });
  const dest = ctx.createGain();
  return { ctx, dest, destNode: asAudioNode(dest) };
}

/** Gain envelope = gain node nối thẳng vào destination. */
function envelopeNode(ctx: FakeAudioContext, dest: FakeGainNode): FakeGainNode {
  const env = ctx.gains().find((g) => g.connections.includes(dest));
  if (!env) throw new Error('no envelope gain');
  return env;
}

describe('envelopePoints / envelopeLevel', () => {
  it('ADSR 10/80/0.7/120 ms cho nốt dài', () => {
    const pts = envelopePoints(1, 0.5, 1);
    expect(pts.map((p) => p.time)).toEqual([
      1,
      1 + ENVELOPE.attack,
      1 + ENVELOPE.attack + ENVELOPE.decay,
      1.5,
      1.5 + ENVELOPE.release,
    ]);
    expect(pts.map((p) => p.value)).toEqual([0, 1, 0.7, 0.7, 0]);
    expect(ENVELOPE).toEqual({ attack: 0.01, decay: 0.08, sustain: 0.7, release: 0.12 });
  });

  it('nốt ngắn hơn attack: release từ mức đang có', () => {
    const pts = envelopePoints(0, 0.005 + 0.015, 1); // 20 ms (MIN_DURATION) > attack
    expect(pts[0]).toEqual({ time: 0, value: 0 });
    // 20 ms nằm trong decay: 1 → 0.7 trong 80 ms
    const off = pts[pts.length - 2];
    expect(off.time).toBeCloseTo(0.02);
    expect(off.value).toBeCloseTo(1 - 0.3 * (0.01 / 0.08));
    expect(pts[pts.length - 1].value).toBe(0);
  });

  it('envelopeLevel nội suy và giữ hai đầu', () => {
    const pts = envelopePoints(0, 1, 1);
    expect(envelopeLevel(pts, -1)).toBe(0);
    expect(envelopeLevel(pts, 0.005)).toBeCloseTo(0.5);
    expect(envelopeLevel(pts, 0.5)).toBeCloseTo(0.7);
    expect(envelopeLevel(pts, 1.06)).toBeCloseTo(0.35);
    expect(envelopeLevel(pts, 5)).toBe(0);
    expect(envelopeLevel([], 1)).toBe(0);
  });
});

describe('scheduleVoice — harmonica', () => {
  it('graph: 2 saw detune ±6 → lowpass 2200 → env → destination, vibrato LFO 5 Hz', () => {
    const { ctx, dest, destNode } = setup();
    scheduleVoice(ctx.asAudioContext(), destNode, {
      midi: 69,
      when: 1,
      duration: 0.5,
      timbre: 'harmonica',
    });
    const oscs = ctx.oscillators();
    const saws = oscs.filter((o) => o.type === 'sawtooth');
    const lfos = oscs.filter((o) => o.type === 'sine');
    expect(saws).toHaveLength(2);
    expect(lfos).toHaveLength(1);
    expect(saws.map((o) => o.detune.value).sort((a, b) => a - b)).toEqual([-6, 6]);
    for (const s of saws) expect(s.frequency.value).toBeCloseTo(midiToFrequency(69));

    const [filter] = ctx.filters();
    expect(filter.type).toBe('lowpass');
    expect(filter.frequency.value).toBe(2200);
    expect(filter.Q.value).toBeCloseTo(0.7);
    for (const s of saws) expect(s.connections).toEqual([filter]);

    const env = envelopeNode(ctx, dest);
    expect(filter.connections).toEqual([env]);

    // LFO → depth gain → detune của cả hai saw
    const lfo = lfos[0];
    expect(lfo.frequency.value).toBe(HARMONICA.vibratoHz);
    const depth = lfo.connections[0];
    expect(depth).toBeInstanceOf(FakeGainNode);
    const depthNode = depth as FakeGainNode;
    expect(depthNode.connections).toEqual(expect.arrayContaining(saws.map((s) => s.detune)));
    const depthEvents = depthNode.gain.events;
    expect(depthEvents[0]).toEqual({ type: 'set', value: 0, time: 1 });
    expect(depthEvents[1].type).toBe('linear');
    expect(depthEvents[1].value).toBeGreaterThanOrEqual(5);
    expect(depthEvents[1].value).toBeLessThanOrEqual(8);
  });

  it('envelope và thời điểm start/stop', () => {
    const { ctx, dest, destNode } = setup();
    const v = scheduleVoice(ctx.asAudioContext(), destNode, {
      midi: 60,
      when: 2,
      duration: 1,
      timbre: 'harmonica',
    });
    expect(v.when).toBe(2);
    expect(v.end).toBeCloseTo(3 + ENVELOPE.release);
    const env = envelopeNode(ctx, dest);
    const p = HARMONICA.peak;
    expect(env.gain.events.map((e) => [e.type, e.time, e.value])).toEqual([
      ['set', 2, 0],
      ['linear', 2 + ENVELOPE.attack, p],
      ['linear', 2 + ENVELOPE.attack + ENVELOPE.decay, p * ENVELOPE.sustain],
      ['linear', 3, p * ENVELOPE.sustain],
      ['linear', 3 + ENVELOPE.release, 0],
    ]);
    for (const o of ctx.oscillators()) {
      expect(o.startTime).toBe(2);
      expect(o.stopTime).toBeCloseTo(v.end);
    }
  });

  it('when trong quá khứ bị kẹp về currentTime; gain nhân vào đỉnh', () => {
    const { ctx, dest, destNode } = setup(5);
    const v = scheduleVoice(ctx.asAudioContext(), destNode, {
      midi: 60,
      when: 4.9,
      duration: 0.2,
      timbre: 'harmonica',
      gain: 0.5,
    });
    expect(v.when).toBe(5);
    const env = envelopeNode(ctx, dest);
    expect(env.gain.events[1].value).toBeCloseTo(HARMONICA.peak * 0.5);
  });
});

describe('scheduleVoice — sine', () => {
  it('một oscillator sine, cùng envelope, không filter', () => {
    const { ctx, dest, destNode } = setup();
    scheduleVoice(ctx.asAudioContext(), destNode, {
      midi: 72,
      when: 0,
      duration: 0.5,
      timbre: 'sine',
    });
    const oscs = ctx.oscillators();
    expect(oscs).toHaveLength(1);
    expect(oscs[0].type).toBe('sine');
    expect(oscs[0].frequency.value).toBeCloseTo(midiToFrequency(72));
    expect(ctx.filters()).toHaveLength(0);
    const env = envelopeNode(ctx, dest);
    expect(oscs[0].connections).toEqual([env]);
    expect(env.gain.events[1]).toEqual({
      type: 'linear',
      time: ENVELOPE.attack,
      value: SINE_PEAK,
    });
  });
});

describe('Voice.stop()', () => {
  it('đang kêu: cancel lịch, release nhanh từ mức hiện tại, dừng oscillator sớm', () => {
    const { ctx, dest, destNode } = setup();
    const v = scheduleVoice(ctx.asAudioContext(), destNode, {
      midi: 60,
      when: 0,
      duration: 2,
      timbre: 'harmonica',
    });
    ctx.currentTime = 0.5;
    v.stop();
    const env = envelopeNode(ctx, dest);
    const tail = env.gain.events.slice(-3);
    expect(tail[0]).toEqual({ type: 'cancel', time: 0.5 });
    expect(tail[1].type).toBe('set');
    expect(tail[1].time).toBe(0.5);
    expect(tail[1].value).toBeCloseTo(HARMONICA.peak * ENVELOPE.sustain);
    expect(tail[2]).toEqual({ type: 'linear', time: 0.5 + QUICK_RELEASE, value: 0 });
    expect(v.end).toBeGreaterThan(0.5 + QUICK_RELEASE);
    expect(v.end).toBeLessThan(0.55);
    for (const o of ctx.oscillators()) {
      expect(o.stopCalls).toHaveLength(2);
      expect(o.stopTime).toBeCloseTo(v.end);
    }
  });

  it('chưa bắt đầu: không phát mẫu nào (stop tại when)', () => {
    const { ctx, dest, destNode } = setup();
    const v = scheduleVoice(ctx.asAudioContext(), destNode, {
      midi: 60,
      when: 0.08,
      duration: 0.5,
      timbre: 'sine',
    });
    ctx.currentTime = 0.01;
    v.stop();
    const env = envelopeNode(ctx, dest);
    expect(env.gain.activeEvents().every((e) => e.value === 0)).toBe(true);
    expect(v.end).toBeCloseTo(0.08);
    expect(ctx.oscillators()[0].stopTime).toBeCloseTo(0.08);
  });

  it('stop(at) trong tương lai; stop sau khi kết thúc là no-op', () => {
    const { ctx, destNode } = setup();
    const onEnded = vi.fn();
    const v = scheduleVoice(ctx.asAudioContext(), destNode, {
      midi: 60,
      when: 0,
      duration: 1,
      timbre: 'sine',
      onEnded,
    });
    v.stop(0.4);
    expect(ctx.oscillators()[0].stopTime).toBeCloseTo(0.4 + QUICK_RELEASE + 0.005);
    ctx.advance(1);
    expect(onEnded).toHaveBeenCalledTimes(1);
    const calls = ctx.oscillators()[0].stopCalls.length;
    v.stop();
    expect(ctx.oscillators()[0].stopCalls).toHaveLength(calls);
  });
});

describe('dọn node khi ended', () => {
  it('harmonica: mọi node bị disconnect, onEnded gọi đúng 1 lần', () => {
    const { ctx, dest, destNode } = setup();
    const onEnded = vi.fn();
    const v = scheduleVoice(ctx.asAudioContext(), destNode, {
      midi: 60,
      when: 0,
      duration: 0.3,
      timbre: 'harmonica',
      onEnded,
    });
    const created = ctx.nodes.filter((n) => n !== ctx.destination && n !== dest);
    expect(created).toHaveLength(6); // 2 saw + lfo + depth + filter + env
    ctx.advance(0.2);
    expect(onEnded).not.toHaveBeenCalled();
    ctx.advance(v.end);
    expect(onEnded).toHaveBeenCalledTimes(1);
    for (const n of created) expect(n.disconnected).toBe(true);
    ctx.oscillators()[0].fireEnded();
    expect(onEnded).toHaveBeenCalledTimes(1);
  });

  it('sine: osc + env bị disconnect', () => {
    const { ctx, dest, destNode } = setup();
    scheduleVoice(ctx.asAudioContext(), destNode, {
      midi: 60,
      when: 0,
      duration: 0.1,
      timbre: 'sine',
    });
    ctx.advance(1);
    const created = ctx.nodes.filter((n) => n !== ctx.destination && n !== dest);
    expect(created).toHaveLength(2);
    for (const n of created) expect(n.disconnected).toBe(true);
  });
});

describe('FakeAudioParam', () => {
  it('activeEvents bỏ phần trước cancel', () => {
    const p = new FakeAudioParam(0);
    p.setValueAtTime(1, 0).cancelScheduledValues(0).linearRampToValueAtTime(0, 1);
    expect(p.activeEvents()).toEqual([{ type: 'linear', value: 0, time: 1 }]);
  });
});

describe('scheduleVoice — harmonica thật (bộ mẫu đã tải)', () => {
  it('phát mẫu gần nhất với playbackRate đúng cao độ, không oscillator; nốt dài → lặp thân mẫu', () => {
    const { ctx, destNode } = setup(0);
    const ac = ctx.asAudioContext();
    const sample = ctx.createBuffer(1, 44100 * 3, 44100);
    setHarmonicaBankForTest(ac, new Map([[69, sample as unknown as AudioBuffer]]));
    scheduleVoice(ac, destNode, { midi: 70, when: 1, duration: 0.5, timbre: 'harmonica' });
    expect(ctx.oscillators()).toHaveLength(0);
    const [src] = ctx.bufferSources();
    expect(src?.buffer).toBe(sample);
    expect(src?.playbackRate.value).toBeCloseTo(Math.pow(2, 1 / 12), 6);
    expect(src?.loop).toBe(false);
    expect(src?.startTime).toBe(1);
    scheduleVoice(ac, destNode, { midi: 69, when: 2, duration: 4, timbre: 'harmonica' });
    expect(ctx.bufferSources()[1]?.loop).toBe(true);
    expect(SAMPLE_PEAK).toBeGreaterThan(1);
  });

  it('timbre sine vẫn là oscillator kể cả khi có bộ mẫu', () => {
    const { ctx, destNode } = setup(0);
    const ac = ctx.asAudioContext();
    setHarmonicaBankForTest(
      ac,
      new Map([[69, ctx.createBuffer(1, 100, 44100) as unknown as AudioBuffer]]),
    );
    scheduleVoice(ac, destNode, { midi: 69, when: 0, duration: 0.5, timbre: 'sine' });
    expect(ctx.bufferSources()).toHaveLength(0);
    expect(ctx.oscillators()).toHaveLength(1);
  });
});

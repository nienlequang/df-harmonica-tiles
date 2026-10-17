import { describe, expect, it, vi } from 'vitest';
import type { FakeGainNode } from './fakeAudioContext';
import { FakeAudioContext, FakeBiquadFilterNode, asAudioNode } from './fakeAudioContext';
import { CLICK_LENGTH, CLICK_SOUND, getClickBuffer, scheduleClick } from './metronome';

describe('getClickBuffer', () => {
  it('nhiễu ~30 ms, decay mũ, cache theo context', () => {
    const ctx = new FakeAudioContext({ sampleRate: 48000 });
    const buf = getClickBuffer(ctx.asAudioContext());
    expect(buf.length).toBe(Math.round(48000 * CLICK_LENGTH));
    expect(buf.duration).toBeGreaterThanOrEqual(0.025);
    expect(buf.duration).toBeLessThanOrEqual(0.035);
    const data = buf.getChannelData(0);
    const peakOf = (from: number, to: number) =>
      Math.max(...Array.from(data.subarray(from, to), (x) => Math.abs(x)));
    const n = data.length;
    expect(peakOf(0, n / 10)).toBeGreaterThan(0.5);
    expect(peakOf((n * 9) / 10, n)).toBeLessThan(0.02);
    for (const x of data) expect(Math.abs(x)).toBeLessThanOrEqual(1);

    expect(getClickBuffer(ctx.asAudioContext())).toBe(buf);
    const other = new FakeAudioContext();
    expect(getClickBuffer(other.asAudioContext())).not.toBe(buf);
  });
});

describe('scheduleClick', () => {
  function graph(ctx: FakeAudioContext) {
    const [src] = ctx.bufferSources();
    const filter = src.connections[0] as FakeBiquadFilterNode;
    const gain = filter.connections[0] as FakeGainNode;
    return { src, filter, gain };
  }

  it('buffer source → filter → gain → destination; accent sáng và to hơn', () => {
    const a = new FakeAudioContext();
    const destA = a.createGain();
    scheduleClick(a.asAudioContext(), asAudioNode(destA), 1, true);
    const ga = graph(a);
    expect(ga.src.buffer).toBe(getClickBuffer(a.asAudioContext()));
    expect(ga.filter).toBeInstanceOf(FakeBiquadFilterNode);
    expect(ga.gain.connections).toEqual([destA]);
    expect(ga.src.startTime).toBe(1);
    expect(ga.src.stopTime).toBeCloseTo(1 + CLICK_LENGTH);

    const b = new FakeAudioContext();
    scheduleClick(b.asAudioContext(), asAudioNode(b.createGain()), 1, false);
    const gb = graph(b);
    expect(ga.filter.frequency.value).toBeGreaterThan(gb.filter.frequency.value);
    expect(ga.gain.gain.value).toBeGreaterThan(gb.gain.gain.value);
    expect(ga.gain.gain.value).toBe(CLICK_SOUND.accent.gain);
    expect(gb.gain.gain.value).toBe(CLICK_SOUND.normal.gain);
  });

  it('disconnect khi ended, onEnded một lần', () => {
    const ctx = new FakeAudioContext();
    const onEnded = vi.fn();
    scheduleClick(ctx.asAudioContext(), asAudioNode(ctx.createGain()), 0.5, false, onEnded);
    const { src, filter, gain } = graph(ctx);
    ctx.advance(0.5);
    expect(onEnded).not.toHaveBeenCalled();
    ctx.advance(0.1);
    expect(onEnded).toHaveBeenCalledTimes(1);
    for (const n of [src, filter, gain]) expect(n.disconnected).toBe(true);
  });

  it('stop() trước khi phát → dừng tại start; đang phát → fade ngắn', () => {
    const ctx = new FakeAudioContext();
    const dest = asAudioNode(ctx.createGain());
    const pending = scheduleClick(ctx.asAudioContext(), dest, 0.05, true);
    pending.stop();
    expect(pending.end).toBe(0.05);
    expect(ctx.bufferSources()[0].stopTime).toBe(0.05);

    const playing = scheduleClick(ctx.asAudioContext(), dest, 0.1, true);
    ctx.currentTime = 0.11;
    playing.stop();
    expect(playing.end).toBeCloseTo(0.115);
    const g = graph(ctx);
    expect(g.src).toBe(ctx.bufferSources()[0]);
    const src2 = ctx.bufferSources()[1];
    expect(src2.stopTime).toBeCloseTo(0.115);
  });

  it('when trong quá khứ kẹp về currentTime', () => {
    const ctx = new FakeAudioContext({ currentTime: 3 });
    const v = scheduleClick(ctx.asAudioContext(), asAudioNode(ctx.createGain()), 2.9, false);
    expect(v.when).toBe(3);
    expect(ctx.bufferSources()[0].startTime).toBe(3);
  });
});

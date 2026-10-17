import { describe, expect, it, vi } from 'vitest';
import type { Clock } from './transport.types';
import type { AudioClockSource } from './clock';
import {
  AUDIO_START_MARGIN_SEC,
  createAudioClock,
  createManualClock,
  createPerformanceClock,
} from './clock';

// AudioContext thật phải truyền được vào createAudioClock (kiểm tra lúc typecheck).
const _acceptsRealContext: (ctx: AudioContext) => Clock = createAudioClock;
void _acceptsRealContext;

interface FakeCtx {
  currentTime: number;
  outputLatency?: number;
  baseLatency?: number;
  getOutputTimestamp?: () => AudioTimestamp;
}

function fake(init: FakeCtx): FakeCtx & AudioClockSource {
  return init;
}

describe('createPerformanceClock', () => {
  it('đổi performance.now() sang giây', () => {
    const spy = vi.spyOn(performance, 'now').mockReturnValue(1500);
    const c = createPerformanceClock();
    expect(c.kind).toBe('performance');
    expect(c.now()).toBeCloseTo(1.5, 12);
    spy.mockReturnValue(2750);
    expect(c.now()).toBeCloseTo(2.75, 12);
  });
});

describe('createAudioClock', () => {
  it('dùng getOutputTimestamp + ngoại suy performance.now()', () => {
    vi.spyOn(performance, 'now').mockReturnValue(1020);
    const ctx = fake({
      currentTime: 10,
      outputLatency: 0.05,
      baseLatency: 0.01,
      getOutputTimestamp: () => ({ contextTime: 9.9, performanceTime: 1000 }),
    });
    const c = createAudioClock(ctx);
    expect(c.kind).toBe('audio');
    expect(c.now()).toBeCloseTo(9.92, 12);
  });

  it('gọi getOutputTimestamp với this = ctx', () => {
    vi.spyOn(performance, 'now').mockReturnValue(1000);
    const ctx = {
      currentTime: 5,
      ts: { contextTime: 4.9, performanceTime: 1000 },
      getOutputTimestamp(this: { ts: AudioTimestamp }): AudioTimestamp {
        return this.ts;
      },
    };
    expect(createAudioClock(ctx).now()).toBeCloseTo(4.9, 12);
  });

  it('performanceTime = 0 → currentTime - outputLatency - baseLatency', () => {
    vi.spyOn(performance, 'now').mockReturnValue(5000);
    const ctx = fake({
      currentTime: 10,
      outputLatency: 0.05,
      baseLatency: 0.01,
      getOutputTimestamp: () => ({ contextTime: 0, performanceTime: 0 }),
    });
    expect(createAudioClock(ctx).now()).toBeCloseTo(9.94, 12);
  });

  it('không có getOutputTimestamp / latency → currentTime trừ phần có', () => {
    const ctx = fake({ currentTime: 3, outputLatency: 0.1 });
    expect(createAudioClock(ctx).now()).toBeCloseTo(2.9, 12);
    const bare = fake({ currentTime: 4 });
    expect(createAudioClock(bare).now()).toBe(4);
  });

  it('timestamp thiếu field hoặc getOutputTimestamp ném lỗi → fallback', () => {
    const partial = fake({ currentTime: 2, baseLatency: 0.02, getOutputTimestamp: () => ({}) });
    expect(createAudioClock(partial).now()).toBeCloseTo(1.98, 12);
    const throwing = fake({
      currentTime: 2,
      outputLatency: 0.03,
      getOutputTimestamp: () => {
        throw new Error('boom');
      },
    });
    expect(createAudioClock(throwing).now()).toBeCloseTo(1.97, 12);
  });

  it('kẹp <= currentTime', () => {
    const now = vi.spyOn(performance, 'now').mockReturnValue(1500);
    const ctx = fake({
      currentTime: 10,
      getOutputTimestamp: () => ({ contextTime: 9.9, performanceTime: 1000 }),
    });
    const c = createAudioClock(ctx);
    // 9.9 + 0.5 = 10.4 > currentTime
    expect(c.now()).toBe(10);
    now.mockReturnValue(1000);
    ctx.currentTime = 10.5;
    // 9.9 < giá trị trước (10) → giữ đơn điệu
    expect(c.now()).toBe(10);
  });

  it('đơn điệu không giảm khi latency nhảy', () => {
    const ctx = fake({ currentTime: 1, outputLatency: 0.01 });
    const c = createAudioClock(ctx);
    expect(c.now()).toBeCloseTo(0.99, 12);
    ctx.currentTime = 1.01;
    ctx.outputLatency = 0.2; // latency tăng đột ngột → giá trị thô lùi
    expect(c.now()).toBeCloseTo(0.99, 12);
    ctx.currentTime = 1.5;
    expect(c.now()).toBeCloseTo(1.3, 12);
  });

  it('lead() = output latency hiện tại + biên an toàn; performance clock không có lead', () => {
    const ctx = fake({ currentTime: 2, outputLatency: 0.048, baseLatency: 0.01 });
    const c = createAudioClock(ctx);
    expect(c.lead?.()).toBeCloseTo(0.058 + AUDIO_START_MARGIN_SEC, 12);
    // now() + lead() rơi vào tương lai trên trục ctx → sự kiện đầu lên lịch kịp.
    expect(c.now() + (c.lead?.() ?? 0)).toBeCloseTo(2 + AUDIO_START_MARGIN_SEC, 12);
    expect(createAudioClock(fake({ currentTime: 3 })).lead?.()).toBe(AUDIO_START_MARGIN_SEC);
    expect(createPerformanceClock().lead).toBeUndefined();
  });

  it('giá trị không hữu hạn → currentTime', () => {
    vi.spyOn(performance, 'now').mockReturnValue(Number.NaN);
    const ctx = fake({
      currentTime: 7,
      getOutputTimestamp: () => ({ contextTime: 6.9, performanceTime: 1000 }),
    });
    expect(createAudioClock(ctx).now()).toBe(7);
  });
});

describe('createManualClock', () => {
  it('advance / set, mặc định start 0 kind performance', () => {
    const c = createManualClock();
    expect(c.kind).toBe('performance');
    expect(c.now()).toBe(0);
    c.advance(1.25);
    c.advance(0.25);
    expect(c.now()).toBeCloseTo(1.5, 12);
    c.set(100);
    expect(c.now()).toBe(100);
  });

  it('nhận start và kind', () => {
    const c = createManualClock(42, 'audio');
    expect(c.kind).toBe('audio');
    expect(c.now()).toBe(42);
  });
});

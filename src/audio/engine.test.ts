import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AudioEngine, UNLOCK_TIMEOUT_MS, getAudioEngine, isAudioSupported } from './engine';
import { FakeAudioContext } from './fakeAudioContext';
import type { FakeAudioContextOptions, FakeResumeBehavior, FakeGainNode } from './fakeAudioContext';
import { FakeAudioElement, IPHONE_UA } from './fakePlaybackEnv';
import { PlaybackSession } from './playbackSession';
import type { SessionNavigator } from './playbackSession';

/** Stub `AudioContext` toàn cục bằng fake, đếm số lần khởi tạo. */
function installFake(
  resume: FakeResumeBehavior = 'resolve',
  key = 'AudioContext',
  extra: FakeAudioContextOptions = {},
) {
  const created: FakeAudioContext[] = [];
  class StubAudioContext extends FakeAudioContext {
    constructor(options?: unknown) {
      super({ state: 'suspended', resume, ...extra }, options);
      created.push(this);
    }
  }
  vi.stubGlobal(key, StubAudioContext);
  return created;
}

/** Gain nối vào destination = master; gain nối vào master = music/click. */
function buses(ctx: FakeAudioContext) {
  const gains = ctx.gains();
  const master = gains.find((g) => g.connections.includes(ctx.destination));
  if (!master) throw new Error('no master');
  const children = gains.filter((g) => g.connections.includes(master));
  return { master, children };
}

describe('AudioEngine', () => {
  let engine: AudioEngine | null = null;

  beforeEach(() => {
    engine = null;
  });

  afterEach(() => {
    engine?.dispose();
    getAudioEngine().dispose();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('không hỗ trợ (jsdom không có AudioContext) → unlock false, không throw', async () => {
    vi.stubGlobal('AudioContext', undefined);
    expect(isAudioSupported()).toBe(false);
    engine = new AudioEngine();
    await expect(engine.unlock()).resolves.toBe(false);
    expect(engine.context).toBeNull();
    expect(engine.ready).toBe(false);
    expect(engine.playPreview(60)).toBeNull();
  });

  it('không tạo AudioContext trước unlock() (kể cả khi set volume/timbre)', async () => {
    const created = installFake();
    expect(isAudioSupported()).toBe(true);
    engine = getAudioEngine();
    engine.setMusicVolume(0.3);
    engine.setClickVolume(0.25);
    engine.setTimbre('sine');
    expect(engine.playPreview(60)).toBeNull();
    engine.stopAll();
    expect(created).toHaveLength(0);
    expect(engine.context).toBeNull();
    expect(engine.musicDestination()).toBeNull();

    await expect(engine.unlock()).resolves.toBe(true);
    expect(created).toHaveLength(1);
    expect(created[0].ctorOptions).toEqual({ latencyHint: 'interactive' });
    expect(engine.ready).toBe(true);
    expect(engine.context).toBe(created[0]);

    // Giá trị lưu trước unlock được áp vào graph
    const { master, children } = buses(created[0]);
    expect(children).toHaveLength(2);
    expect(engine.musicDestination()).toBe(children.find((g) => g.gain.value === 0.3));
    expect(engine.clickDestination()).toBe(children.find((g) => g.gain.value === 0.25));
    expect(master.gain.value).toBeGreaterThan(0);

    // unlock lần nữa không tạo context mới
    await expect(engine.unlock()).resolves.toBe(true);
    expect(created).toHaveLength(1);
  });

  it('webkitAudioContext fallback', async () => {
    vi.stubGlobal('AudioContext', undefined);
    const created = installFake('resolve', 'webkitAudioContext');
    expect(isAudioSupported()).toBe(true);
    engine = new AudioEngine();
    await expect(engine.unlock()).resolves.toBe(true);
    expect(created).toHaveLength(1);
  });

  it('resume() bị từ chối → false; gọi lại sau vẫn thử được', async () => {
    const created = installFake('reject');
    engine = new AudioEngine();
    await expect(engine.unlock()).resolves.toBe(false);
    expect(engine.ready).toBe(false);
    created[0].resumeBehavior = 'resolve';
    await expect(engine.unlock()).resolves.toBe(true);
    expect(created).toHaveLength(1);
  });

  it('resume() treo → false sau timeout, không để lại timer', async () => {
    vi.useFakeTimers();
    installFake('hang');
    engine = new AudioEngine();
    const p = engine.unlock();
    // Gọi lại trong lúc chờ: resume() lại (cú chạm mới), lượt chờ riêng — cả hai hết hạn → false.
    const p2 = engine.unlock();
    await vi.advanceTimersByTimeAsync(UNLOCK_TIMEOUT_MS + 10);
    await expect(p).resolves.toBe(false);
    await expect(p2).resolves.toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('setMusicVolume/setClickVolume mượt bằng setTargetAtTime, kẹp 0..1', async () => {
    installFake();
    engine = new AudioEngine();
    await engine.unlock();
    engine.setMusicVolume(2);
    engine.setClickVolume(-1);
    expect(engine.musicVolume).toBe(1);
    expect(engine.clickVolume).toBe(0);
    const music = engine.musicDestination() as unknown as FakeGainNode;
    const click = engine.clickDestination() as unknown as FakeGainNode;
    expect(music.gain.events.at(-1)).toMatchObject({ type: 'target', value: 1 });
    expect(click.gain.events.at(-1)).toMatchObject({ type: 'target', value: 0 });
  });

  it('context mới: dựng sẵn bảng sóng sine / sawtooth + bộ lọc bằng constructor (v1.0.1), không tạo nốt nào', async () => {
    const created = installFake();
    const made: [string, unknown, unknown][] = [];
    class Osc {
      constructor(ctx: unknown, opts: unknown) {
        made.push(['osc', ctx, opts]);
      }
    }
    class Filter {
      constructor(ctx: unknown, opts: unknown) {
        made.push(['filter', ctx, opts]);
      }
    }
    vi.stubGlobal('OscillatorNode', Osc);
    vi.stubGlobal('BiquadFilterNode', Filter);
    engine = new AudioEngine();
    await engine.unlock();
    const ctx = created[0];
    expect(made).toEqual([
      ['osc', ctx, { type: 'sine' }],
      ['osc', ctx, { type: 'sawtooth' }],
      ['filter', ctx, { type: 'lowpass' }],
    ]);
    // Không qua createOscillator (không voice nào, không kêu).
    expect(ctx.oscillators()).toHaveLength(0);
    // Một lần cho mỗi context.
    await engine.unlock();
    expect(made).toHaveLength(3);
  });

  it('constructor node ném lỗi → vẫn mở khóa bình thường', async () => {
    const created = installFake();
    vi.stubGlobal(
      'OscillatorNode',
      class {
        constructor() {
          throw new Error('nope');
        }
      },
    );
    engine = new AudioEngine();
    await expect(engine.unlock()).resolves.toBe(true);
    expect(created).toHaveLength(1);
  });

  it('playPreview: phát qua music bus, đơn âm (nốt trước bị dừng)', async () => {
    const created = installFake();
    engine = new AudioEngine();
    await engine.unlock();
    engine.setTimbre('sine');
    const a = engine.playPreview(60);
    expect(a).not.toBeNull();
    const ctx = created[0];
    const [osc] = ctx.oscillators();
    expect(osc.type).toBe('sine');
    const env = osc.connections[0] as FakeGainNode;
    expect(env.connections).toEqual([engine.musicDestination()]);
    const b = engine.playPreview(64, 1);
    expect(b).not.toBeNull();
    expect(osc.stopCalls).toHaveLength(2);
    engine.stopAll();
    expect(ctx.oscillators()[1].stopCalls).toHaveLength(2);
  });

  it('stopAll() gọi stop listener; subscribe nhận thay đổi trạng thái', async () => {
    const created = installFake();
    engine = new AudioEngine();
    const onStop = vi.fn();
    const off = engine.addStopListener(onStop);
    const onChange = vi.fn();
    engine.subscribe(onChange);
    await engine.unlock();
    expect(onChange).toHaveBeenCalled();
    engine.stopAll();
    expect(onStop).toHaveBeenCalledTimes(1);
    off();
    engine.stopAll();
    expect(onStop).toHaveBeenCalledTimes(1);
    onChange.mockClear();
    await created[0].suspend();
    expect(onChange).toHaveBeenCalled();
    expect(engine.ready).toBe(false);
  });

  it('dispose() đóng context và reset singleton', async () => {
    const created = installFake();
    const first = getAudioEngine();
    expect(getAudioEngine()).toBe(first);
    await first.unlock();
    first.dispose();
    expect(created[0].closeCalls).toBe(1);
    expect(first.context).toBeNull();
    expect(first.ready).toBe(false);
    const second = getAudioEngine();
    expect(second).not.toBe(first);
    expect(second.context).toBeNull();
    expect(created).toHaveLength(1);
  });

  it('context bị đóng từ ngoài → unlock tạo context mới', async () => {
    const created = installFake();
    engine = new AudioEngine();
    await engine.unlock();
    await created[0].close();
    expect(engine.ready).toBe(false);
    await expect(engine.unlock()).resolves.toBe(true);
    expect(created).toHaveLength(2);
    expect(engine.context).toBe(created[1]);
  });
});

describe('AudioEngine — mở khóa trên mobile (D-422)', () => {
  let engine: AudioEngine | null = null;

  afterEach(() => {
    engine?.dispose();
    engine = null;
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('chờ tới UNLOCK_TIMEOUT_MS ≥ 3 s: iOS lần đầu chuyển running sau 1,5 s vẫn mở khóa được, không để lại timer', async () => {
    expect(UNLOCK_TIMEOUT_MS).toBeGreaterThanOrEqual(3000);
    vi.useFakeTimers();
    installFake('resolve', 'AudioContext', { resumeDelayMs: 1500 });
    engine = new AudioEngine();
    const p = engine.unlock();
    await vi.advanceTimersByTimeAsync(1000);
    expect(engine.ready).toBe(false); // trước đây (1 s) đã bỏ cuộc ở đây
    await vi.advanceTimersByTimeAsync(500);
    await expect(p).resolves.toBe(true);
    expect(engine.ready).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('context chuyển running muộn qua statechange (không phải từ promise của resume) → vẫn true', async () => {
    vi.useFakeTimers();
    const created = installFake('hang');
    engine = new AudioEngine();
    const p = engine.unlock();
    await vi.advanceTimersByTimeAsync(2000);
    created[0].setState('running');
    await expect(p).resolves.toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cú chạm sau gọi resume() lại (cú đầu không được tính là gesture): context chạy → cả hai lượt chờ đều true', async () => {
    vi.useFakeTimers();
    const created = installFake('hang');
    engine = new AudioEngine();
    const p = engine.unlock();
    expect(created[0].resumeCalls).toBe(1);
    await vi.advanceTimersByTimeAsync(2500); // cú đầu đã chờ gần hết hạn
    created[0].resumeBehavior = 'resolve';
    const p2 = engine.unlock();
    expect(created[0].resumeCalls).toBe(2);
    await expect(p).resolves.toBe(true);
    await expect(p2).resolves.toBe(true);
    expect(engine.ready).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cú chạm sau được trọn lượt chờ của nó (không bị cú đầu hết hạn kéo theo)', async () => {
    vi.useFakeTimers();
    const created = installFake('hang');
    engine = new AudioEngine();
    const p = engine.unlock();
    await vi.advanceTimersByTimeAsync(2500);
    created[0].resumeBehavior = 'resolve';
    created[0].resumeDelayMs = 1500; // cú sau: iOS chạy sau 1,5 s
    const p2 = engine.unlock();
    await vi.advanceTimersByTimeAsync(600);
    await expect(p).resolves.toBe(false); // cú đầu hết hạn ở 3 s
    await vi.advanceTimersByTimeAsync(1000);
    await expect(p2).resolves.toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('interrupted (iOS: cuộc gọi, Siri, app khác) như suspended: ready = false, unlock() resume lại → true', async () => {
    const created = installFake();
    engine = new AudioEngine();
    const onChange = vi.fn();
    engine.subscribe(onChange);
    await expect(engine.unlock()).resolves.toBe(true);
    onChange.mockClear();
    created[0].setState('interrupted');
    expect(onChange).toHaveBeenCalled();
    expect(engine.ready).toBe(false);
    await expect(engine.unlock()).resolves.toBe(true);
    expect(created[0].resumeCalls).toBe(2);
    expect(created).toHaveLength(1);
  });
});

describe('AudioEngine — phiên "playback" của iPhone (D-421)', () => {
  afterEach(() => {
    getAudioEngine().dispose();
    vi.unstubAllGlobals();
  });

  /** Engine với Audio Session API giả; mỗi lần đặt type ghi số lần resume() lúc đó. */
  function withSessionApi(created: FakeAudioContext[]) {
    const log: { type: string; resumeCalls: number }[] = [];
    let type = 'auto';
    const nav: SessionNavigator = {
      userAgent: IPHONE_UA,
      audioSession: {
        get type() {
          return type;
        },
        set type(v: string) {
          type = v;
          log.push({ type: v, resumeCalls: created[0]?.resumeCalls ?? -1 });
        },
      },
    };
    const engine = new AudioEngine({ session: new PlaybackSession({ navigator: () => nav }) });
    return { engine, log, type: () => type };
  }

  it('unlock({ playback }) đặt type = "playback" TRƯỚC resume(), cùng lần gọi (trong cú chạm)', async () => {
    const created = installFake();
    const { engine, log, type } = withSessionApi(created);
    const holder = {};
    const p = engine.unlock({ playback: holder });
    expect(type()).toBe('playback'); // đồng bộ, không chờ promise
    expect(log).toEqual([{ type: 'playback', resumeCalls: 0 }]);
    expect(created[0].resumeCalls).toBe(1);
    expect(engine.playbackHeld).toBe(true);
    await expect(p).resolves.toBe(true);
    engine.releasePlayback(holder);
    expect(type()).toBe('auto');
    expect(engine.playbackHeld).toBe(false);
    engine.dispose();
  });

  it('unlock() không có playback (Cài đặt, màn thu, Nghe thử) không đụng tới phiên', async () => {
    const created = installFake();
    const { engine, log } = withSessionApi(created);
    await expect(engine.unlock()).resolves.toBe(true);
    expect(log).toEqual([]);
    expect(engine.playbackHeld).toBe(false);
    engine.dispose();
    expect(log).toEqual([]); // dispose không giữ gì thì cũng không đặt gì
  });

  it('context đã chạy sẵn: unlock({ playback }) vẫn giữ phiên', async () => {
    const created = installFake();
    const { engine, type } = withSessionApi(created);
    await engine.unlock();
    expect(type()).toBe('auto');
    await expect(engine.unlock({ playback: {} })).resolves.toBe(true);
    expect(type()).toBe('playback');
    engine.dispose();
    expect(type()).toBe('auto'); // dispose trả phiên
  });

  it('đếm theo holder: holder cuối mới trả; trả holder lạ / hai lần không làm gì', () => {
    const created = installFake();
    const { engine, type, log } = withSessionApi(created);
    const a = {};
    const b = {};
    void engine.unlock({ playback: a });
    engine.holdPlayback(b);
    engine.releasePlayback({});
    engine.releasePlayback(a);
    expect(type()).toBe('playback');
    engine.releasePlayback(a);
    expect(type()).toBe('playback');
    engine.releasePlayback(b);
    expect(type()).toBe('auto');
    expect(log.map((e) => e.type)).toEqual(['playback', 'auto']);
    engine.dispose();
  });

  it('iOS cũ (không có API): phần tử im lặng cùng sample rate với AudioContext, dừng khi trả', () => {
    installFake('resolve', 'AudioContext', { sampleRate: 44100 });
    const made: FakeAudioElement[] = [];
    const engine = new AudioEngine({
      session: new PlaybackSession({
        navigator: () => ({ userAgent: IPHONE_UA }),
        createAudio: () => {
          const el = new FakeAudioElement();
          made.push(el);
          return el.asElement();
        },
      }),
    });
    const holder = {};
    void engine.unlock({ playback: holder });
    expect(made).toHaveLength(1);
    expect(made[0].playCalls).toBe(1);
    const bin = atob(made[0].src.split(',')[1]);
    const rate =
      bin.charCodeAt(24) |
      (bin.charCodeAt(25) << 8) |
      (bin.charCodeAt(26) << 16) |
      (bin.charCodeAt(27) << 24);
    expect(rate).toBe(44100);
    engine.releasePlayback(holder);
    expect(made[0].paused).toBe(true);
    engine.dispose();
  });

  it('không hỗ trợ Web Audio → unlock({ playback }) false, không giữ phiên', async () => {
    vi.stubGlobal('AudioContext', undefined);
    const { engine, log } = withSessionApi([]);
    await expect(engine.unlock({ playback: {} })).resolves.toBe(false);
    expect(log).toEqual([]);
    expect(engine.playbackHeld).toBe(false);
  });
});

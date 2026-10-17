/**
 * Phía Player của "overlay theo Player chính": transport thật trên ManualClock, state engine giả, kênh
 * BroadcastChannel giả, timer giả, đồng hồ chung (epoch ms) giả.
 */
import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LibraryEntry } from '../library/store';
import { createManualClock } from '../player/clock';
import type { ManualClock } from '../player/clock';
import { Transport } from '../player/transport';
import type { Clock } from '../player/transport.types';
import type { PlayerEngine } from '../player/usePlayerEngine';
import type { FollowDisplay, FollowMessage, FollowStateMessage } from './follow';
import { FOLLOW_CHANNEL, parseFollowMessage, songKeyOf } from './follow';
import { FollowBroadcaster, useFollowBroadcast } from './followBroadcast';
import type { FollowChannelLike, FollowSource } from './followBroadcast';

const relayed: FollowMessage[] = [];
vi.mock('./obsBridge', () => ({
  relayToObs: (m: FollowMessage) => {
    relayed.push(m);
  },
  isObsRelayActive: () => false,
}));

const SOURCE = '@title Bài\n@bpm 120\nZ X C V\nB N M ,';

const DISPLAY: FollowDisplay = {
  scheme: 'pc',
  mobileSemitone: 'toggle',
  labels: { left: '', right: '', natural: '', scroll: '' },
  lookahead: 8,
  tileScale: 1,
  subLabel: 'none',
  countIn: true,
  language: 'vi',
  theme: 'dark',
};

class FakeChannel implements FollowChannelLike {
  posted: FollowMessage[] = [];
  closed = false;
  private readonly listeners = new Set<(e: MessageEvent) => void>();
  postMessage(message: unknown): void {
    if (this.closed) throw new Error('closed');
    // Dữ liệu phải clone được (BroadcastChannel dùng structured clone).
    const copy = JSON.parse(JSON.stringify(message)) as unknown;
    const parsed = parseFollowMessage(copy);
    if (!parsed) throw new Error(`tin không hợp lệ: ${JSON.stringify(message)}`);
    this.posted.push(parsed);
  }
  addEventListener(_type: 'message', l: (e: MessageEvent) => void): void {
    this.listeners.add(l);
  }
  removeEventListener(_type: 'message', l: (e: MessageEvent) => void): void {
    this.listeners.delete(l);
  }
  close(): void {
    this.closed = true;
  }
  deliver(data: unknown): void {
    for (const l of Array.from(this.listeners)) l({ data } as MessageEvent);
  }
  get listenerCount(): number {
    return this.listeners.size;
  }
}

let clock: ManualClock;
let transport: Transport;
let ui: { countdown: number | null };
let engineListeners: Set<() => void>;
let source: FollowSource;
let channel: FakeChannel;
let nowMs: number;
let display: FollowDisplay;
let displayListeners: Set<() => void>;
let hidden: boolean;
let b: FollowBroadcaster | null;

function notify(): void {
  for (const l of Array.from(engineListeners)) l();
}

/** Tiến đồng hồ transport + đồng hồ chung + timer. */
function advance(ms: number): void {
  clock.advance(ms / 1000);
  nowMs += ms;
  vi.advanceTimersByTime(ms);
}

function make(opts: { channel?: FakeChannel | null; clock?: Clock } = {}): FollowBroadcaster {
  if (opts.clock) {
    transport = new Transport({ clock: opts.clock, bpm: 120, endBeat: 16 });
    transport.subscribe(() => notify());
    source = { ...source, transport };
  }
  b = new FollowBroadcaster(source, SOURCE, {
    channel: opts.channel === undefined ? channel : opts.channel,
    now: () => nowMs,
    senderId: 'tab-A',
    getDisplay: () => display,
    subscribeDisplay: (l) => {
      displayListeners.add(l);
      return () => displayListeners.delete(l);
    },
    isHidden: () => hidden,
    win: window,
  });
  return b;
}

const states = (list: FollowMessage[]) =>
  list.filter((m): m is FollowStateMessage => m.kind === 'state');

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] });
  relayed.length = 0;
  clock = createManualClock(100);
  transport = new Transport({ clock, bpm: 120, endBeat: 16 });
  ui = { countdown: null };
  engineListeners = new Set();
  // Như PlayerEngine: transport đổi → engine thông báo.
  transport.subscribe(() => notify());
  source = {
    transport,
    getState: () => ui,
    subscribe: (l) => {
      engineListeners.add(l);
      return () => engineListeners.delete(l);
    },
  };
  channel = new FakeChannel();
  nowMs = 1_000_000;
  display = DISPLAY;
  displayListeners = new Set();
  hidden = false;
  b = null;
});

afterEach(() => {
  b?.stop();
  vi.useRealTimers();
});

describe('FollowBroadcaster', () => {
  it('start: song + state ngay (kênh + relay OBS), trạng thái đúng — cause announce (mount không giành overlay)', () => {
    make().start();
    expect(channel.posted.map((m) => m.kind)).toEqual(['song', 'state']);
    expect(relayed.map((m) => m.kind)).toEqual(['song', 'state']);
    expect(channel.posted[0]).toMatchObject({
      from: 'tab-A',
      songKey: songKeyOf(SOURCE),
      source: SOURCE,
      cause: 'announce',
    });
    expect(channel.posted[1]).toMatchObject({
      kind: 'state',
      songKey: songKeyOf(SOURCE),
      sentAt: 1_000_000,
      playing: false,
      beat: 0,
      bpm: 120,
      countdownEndsAt: null,
      loop: null,
      countIn: null,
      hidden: false,
      display: DISPLAY,
      cause: 'announce',
    });
  });

  it('transport đổi → state ngay; thông báo không đổi gì thì không gửi; heartbeat mỗi giây', () => {
    make().start();
    channel.posted = [];
    transport.play();
    expect(states(channel.posted)).toHaveLength(1);
    expect(channel.posted[0]).toMatchObject({ playing: true, beat: 0, cause: 'change' });
    notify();
    notify();
    expect(channel.posted).toHaveLength(1);
    advance(1000);
    const hb = states(channel.posted);
    expect(hb).toHaveLength(2);
    expect(hb[1]).toMatchObject({ cause: 'tick', playing: true, beat: 2, sentAt: 1_001_000 });
    expect(hb[1].seq).toBeGreaterThan(hb[0].seq);
    transport.pause();
    transport.seek(8);
    transport.setBpm(90);
    transport.setLoop({ start: 4, end: 12 });
    const changes = states(channel.posted).filter((m) => m.cause === 'change');
    expect(changes.at(-1)).toMatchObject({
      playing: false,
      beat: 8,
      bpm: 90,
      loop: { startBeat: 4, endBeat: 12 },
    });
    expect(changes.length).toBeGreaterThanOrEqual(4);
  });

  it('heartbeat cả khi đang dừng; song nhắc lại mỗi 5 s', () => {
    make().start();
    channel.posted = [];
    advance(5000);
    expect(states(channel.posted)).toHaveLength(5);
    expect(channel.posted.filter((m) => m.kind === 'song')).toEqual([
      expect.objectContaining({ cause: 'tick', source: SOURCE }),
    ]);
  });

  it('hello của overlay → trả lời song + state (reply); tin khác bị bỏ qua', () => {
    make().start();
    channel.posted = [];
    channel.deliver({ v: 1, from: 'overlay-1', kind: 'hello' });
    expect(channel.posted.map((m) => [m.kind, 'cause' in m ? m.cause : null])).toEqual([
      ['song', 'reply'],
      ['state', 'reply'],
    ]);
    channel.posted = [];
    channel.deliver({ v: 1, from: 'tab-B', kind: 'bye' });
    channel.deliver({ v: 1, from: 'tab-A', kind: 'hello' });
    channel.deliver('rác');
    expect(channel.posted).toEqual([]);
  });

  it('đếm ngược: countdownEndsAt = lúc bắt đầu + N giây; hủy → null', () => {
    make().start();
    channel.posted = [];
    ui = { countdown: 3 };
    notify();
    expect(states(channel.posted).at(-1)?.countdownEndsAt).toBe(1_003_000);
    advance(1000);
    ui = { countdown: 2 };
    notify();
    expect(states(channel.posted).at(-1)?.countdownEndsAt).toBe(1_003_000);
    ui = { countdown: null };
    notify();
    expect(states(channel.posted).at(-1)?.countdownEndsAt).toBeNull();
  });

  it('R7: đang chờ phát → `countIn` = ô nhịp đếm vào sắp chạy (preRoll) dù chưa phát; phát rồi = đếm vào thật', () => {
    let preRoll: { start: number; end: number } | null = null;
    source = {
      ...source,
      get preRoll() {
        return preRoll;
      },
    };
    make().start();
    expect(states(channel.posted).at(-1)?.countIn).toBeNull();
    channel.posted = [];
    // Bắt đầu đếm ngược ở beat 2: Player vẽ frame đầu đếm vào [-2, 2).
    transport.seek(2);
    preRoll = { start: -2, end: 2 };
    ui = { countdown: 3 };
    notify();
    const waiting = states(channel.posted).at(-1);
    expect(waiting).toMatchObject({
      playing: false,
      beat: 2,
      countIn: { startBeat: -2, endBeat: 2 },
    });
    // Đổi preRoll (bật / tắt Đếm vào giữa lúc đếm ngược) → chữ ký đổi → gửi lại.
    channel.posted = [];
    preRoll = null;
    notify();
    expect(states(channel.posted).at(-1)?.countIn).toBeNull();
    preRoll = { start: -2, end: 2 };
    notify();
    // Hết đếm: transport phát kèm đếm vào → `countIn` của đoạn phát (playing), preRoll bỏ qua.
    channel.posted = [];
    preRoll = null;
    transport.play({ countInBeats: 4 });
    ui = { countdown: null };
    notify();
    const playing = states(channel.posted).at(-1);
    expect(playing).toMatchObject({ playing: true, countIn: { startBeat: -2, endBeat: 2 } });
    // Đang phát mà engine (lỗi) vẫn báo preRoll → không gửi preRoll.
    preRoll = { start: 10, end: 14 };
    advance(1000);
    expect(states(channel.posted).at(-1)?.countIn).toEqual({ startBeat: -2, endBeat: 2 });
  });

  it('Cài đặt hiển thị đổi → state; đổi thứ không liên quan → không gửi', () => {
    make().start();
    channel.posted = [];
    for (const l of displayListeners) l();
    expect(channel.posted).toEqual([]);
    display = { ...DISPLAY, scheme: 'mobile', labels: { ...DISPLAY.labels, scroll: 'Thăng' } };
    for (const l of displayListeners) l();
    expect(states(channel.posted)).toHaveLength(1);
    expect(channel.posted[0]).toMatchObject({
      display: { scheme: 'mobile', labels: { scroll: 'Thăng' } },
    });
  });

  it('tab ẩn / hiện → state kèm cờ hidden', () => {
    make().start();
    channel.posted = [];
    hidden = true;
    document.dispatchEvent(new Event('visibilitychange'));
    expect(channel.posted[0]).toMatchObject({ kind: 'state', hidden: true, cause: 'tick' });
  });

  it('đoạn phát chưa bắt đầu (audio lead): sentAt ở tương lai, beat = điểm bắt đầu', () => {
    let t = 50;
    const audio: Clock = { kind: 'audio', now: () => t, lead: () => 0.08 };
    make({ clock: audio }).start();
    channel.posted = [];
    transport.play({ fromBeat: 4 });
    expect(channel.posted[0]).toMatchObject({ playing: true, beat: 4, sentAt: 1_000_080 });
    t += 1;
    nowMs += 1000;
    vi.advanceTimersByTime(1000);
    // Đã qua lead: beat theo đồng hồ (1 s − 0.08 s ở 120 BPM = 1.84 beat sau điểm 4).
    const hb = states(channel.posted).at(-1);
    expect(hb?.sentAt).toBe(1_001_000);
    expect(hb?.beat).toBeCloseTo(4 + (1 - 0.08) * 2, 6);
  });

  it('đếm vào: countIn + beat âm; loop / hết bài chưa kịp áp (tab ẩn) thì tự quy đổi', () => {
    make().start();
    channel.posted = [];
    transport.play({ countInBeats: 4 });
    expect(states(channel.posted).at(-1)).toMatchObject({
      beat: -4,
      countIn: { startBeat: -4, endBeat: 0 },
    });
    // Loop 2..6, đồng hồ chạy 6 s (12 beat từ −4 → 8) mà không ai gọi update().
    transport.setLoop({ start: 2, end: 6 });
    clock.advance(6);
    nowMs += 6000;
    vi.advanceTimersByTime(1000);
    const looped = states(channel.posted).at(-1);
    expect(looped?.countIn).toBeNull();
    expect(looped?.beat).toBeCloseTo(4, 6); // 8 → 2 + (8 − 6) % 4
    transport.setLoop(null);
    clock.advance(20);
    nowMs += 20_000;
    vi.advanceTimersByTime(1000);
    expect(states(channel.posted).at(-1)).toMatchObject({ playing: false, beat: 16 });
  });

  it('setSong: song + state với khóa mới; cùng nguồn thì bỏ qua', () => {
    const br = make();
    br.start();
    channel.posted = [];
    br.setSong(SOURCE);
    expect(channel.posted).toEqual([]);
    br.setSong(`${SOURCE}\nZ`);
    expect(channel.posted.map((m) => m.kind)).toEqual(['song', 'state']);
    expect(channel.posted[1]).toMatchObject({
      songKey: songKeyOf(`${SOURCE}\nZ`),
      cause: 'announce',
    });
  });

  it('stop: bye, đóng kênh, gỡ hết listener + timer; pagehide cũng gửi bye', () => {
    const br = make();
    br.start();
    window.dispatchEvent(new Event('pagehide'));
    expect(channel.posted.at(-1)).toMatchObject({ kind: 'bye', from: 'tab-A' });
    channel.posted = [];
    br.stop();
    expect(channel.posted).toEqual([{ v: 1, from: 'tab-A', kind: 'bye' }]);
    expect(relayed.at(-1)).toMatchObject({ kind: 'bye' });
    expect(channel.closed).toBe(true);
    expect(channel.listenerCount).toBe(0);
    expect(engineListeners.size).toBe(0);
    expect(displayListeners.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    const before = relayed.length;
    transport.play();
    window.dispatchEvent(new Event('pagehide'));
    document.dispatchEvent(new Event('visibilitychange'));
    expect(relayed.length).toBe(before);
    b = null;
  });

  it('sau pagehide (bye) không gửi gì nữa — visibilitychange / heartbeat / hello; pageshow từ bfcache gửi lại', () => {
    const br = make();
    br.start();
    window.dispatchEvent(new Event('pagehide'));
    expect(channel.posted.at(-1)).toMatchObject({ kind: 'bye' });
    channel.posted = [];
    // Đóng tab: trình duyệt bắn visibilitychange SAU pagehide — không được kéo overlay về `follow`.
    document.dispatchEvent(new Event('visibilitychange'));
    vi.advanceTimersByTime(6000);
    channel.deliver({ v: 1, from: 'overlay-1', kind: 'hello' });
    window.dispatchEvent(new Event('pagehide'));
    expect(channel.posted).toEqual([]);
    const show = new Event('pageshow') as Event & { persisted?: boolean };
    Object.defineProperty(show, 'persisted', { value: true });
    window.dispatchEvent(show);
    expect(channel.posted.map((m) => m.kind)).toEqual(['song', 'state']);
    expect(channel.posted.map((m) => ('cause' in m ? m.cause : null))).toEqual([
      'announce',
      'announce',
    ]);
    br.stop();
    b = null;
  });

  it('cửa sổ nổi (priority 1) cùng tab: nói thay Player chính; đóng → Player chính nói tiếp, không bye', () => {
    const main = make();
    main.start();
    const mainSeq = states(channel.posted).at(-1)?.seq ?? 0;
    const floatChannel = new FakeChannel();
    const floatTransport = new Transport({ clock, bpm: 100, endBeat: 32 });
    const floatSource: FollowSource = {
      transport: floatTransport,
      getState: () => ({ countdown: null }),
      subscribe: (l) => floatTransport.subscribe(l),
    };
    const FLOAT_SOURCE = '@title Nổi\n@bpm 100\nZ X';
    const float = new FollowBroadcaster(floatSource, FLOAT_SOURCE, {
      channel: floatChannel,
      now: () => nowMs,
      senderId: 'tab-A',
      getDisplay: () => display,
      subscribeDisplay: () => () => {},
      isHidden: () => hidden,
      win: window,
      priority: 1,
    });
    float.start();
    expect(main.speaking).toBe(false);
    expect(float.speaking).toBe(true);
    expect(floatChannel.posted.map((m) => m.kind)).toEqual(['song', 'state']);
    expect(floatChannel.posted[0]).toMatchObject({ from: 'tab-A', source: FLOAT_SOURCE });
    // Player chính (đã tạm dừng khi mở cửa sổ nổi) im: đổi transport / heartbeat không gửi gì.
    channel.posted = [];
    transport.play();
    advance(2000);
    expect(channel.posted).toEqual([]);
    // Cửa sổ nổi phát → overlay thấy đổi thật (change); seq dùng chung nên vẫn tăng so với Player chính.
    floatTransport.play();
    const floatState = states(floatChannel.posted).at(-1);
    expect(floatState).toMatchObject({ playing: true, bpm: 100, cause: 'change' });
    expect(floatState?.seq ?? 0).toBeGreaterThan(mainSeq);
    // Đóng cửa sổ nổi: không bye (tab còn Player), Player chính báo lại bài + trạng thái ngay.
    channel.posted = [];
    floatChannel.posted = [];
    float.stop();
    expect(floatChannel.posted).toEqual([]);
    expect(channel.posted.map((m) => m.kind)).toEqual(['song', 'state']);
    expect(channel.posted[0]).toMatchObject({ source: SOURCE, cause: 'announce' });
    expect(main.speaking).toBe(true);
    // Player chính rời đi sau đó → bye như thường.
    main.stop();
    expect(channel.posted.at(-1)).toMatchObject({ kind: 'bye' });
    b = null;
  });

  it('Player chính mount lại khi cửa sổ nổi đang mở: vẫn im; cửa sổ nổi đóng → bộ mới nói', () => {
    const floatChannel = new FakeChannel();
    const float = new FollowBroadcaster(source, '@title Nổi\nZ', {
      channel: floatChannel,
      now: () => nowMs,
      senderId: 'tab-A',
      getDisplay: () => display,
      subscribeDisplay: () => () => {},
      win: null,
      priority: 1,
    });
    float.start();
    const main = make();
    main.start();
    expect(channel.posted).toEqual([]);
    float.stop();
    expect(channel.posted.map((m) => m.kind)).toEqual(['song', 'state']);
  });

  it('không có BroadcastChannel: chỉ relay OBS', () => {
    make({ channel: null }).start();
    expect(relayed.map((m) => m.kind)).toEqual(['song', 'state']);
  });
});

describe('useFollowBroadcast', () => {
  const created: FakeChannel[] = [];

  beforeEach(() => {
    created.length = 0;
    vi.stubGlobal(
      'BroadcastChannel',
      class extends FakeChannel {
        constructor(readonly name: string) {
          super();
          created.push(this);
        }
      },
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('mở kênh FOLLOW_CHANNEL, gửi bài; nguồn đổi → song mới; unmount → bye + đóng kênh', () => {
    const engine = source as unknown as PlayerEngine;
    const entry = (src: string) => ({ source: src }) as unknown as LibraryEntry;
    const { rerender, unmount } = renderHook(({ e }) => useFollowBroadcast(engine, e), {
      initialProps: { e: entry(SOURCE) },
    });
    expect(created).toHaveLength(1);
    const ch = created[0] as FakeChannel & { name: string };
    expect(ch.name).toBe(FOLLOW_CHANNEL);
    expect(ch.posted.map((m) => m.kind)).toEqual(['song', 'state']);
    rerender({ e: entry(`${SOURCE}\nZ`) });
    expect(ch.posted.filter((m) => m.kind === 'song')).toHaveLength(2);
    unmount();
    expect(ch.posted.at(-1)?.kind).toBe('bye');
    expect(ch.closed).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
});

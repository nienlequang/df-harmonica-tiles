import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FollowDisplay, FollowMessage } from './follow';
import { FollowReceiver } from './followReceiver';

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

let seq = 0;
function state(from: string, patch: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    v: 1,
    from,
    kind: 'state',
    seq: ++seq,
    songKey: 'k1',
    sentAt: 1000 + seq,
    playing: false,
    beat: 0,
    bpm: 120,
    countdownEndsAt: null,
    loop: null,
    display: DISPLAY,
    ...patch,
  };
}
const song = (from: string, songKey = 'k1', cause = 'change') => ({
  v: 1,
  from,
  kind: 'song',
  songKey,
  source: `@title ${songKey}\nZ X`,
  cause,
});

let r: FollowReceiver;
let sent: FollowMessage[];

beforeEach(() => {
  vi.useFakeTimers();
  seq = 0;
  sent = [];
  r = new FollowReceiver({ selfId: 'ov-1' });
  r.start((m) => sent.push(m));
});

afterEach(() => {
  r.stop();
  vi.useRealTimers();
});

describe('FollowReceiver', () => {
  it('mở ra: gửi hello; không nghe thấy Player sau 2 s → standalone', () => {
    expect(sent).toEqual([{ v: 1, from: 'ov-1', kind: 'hello' }]);
    expect(r.getState().mode).toBe('waiting');
    vi.advanceTimersByTime(1999);
    expect(r.getState().mode).toBe('waiting');
    vi.advanceTimersByTime(1);
    expect(r.getState().mode).toBe('standalone');
  });

  it('tin hợp lệ đầu tiên → follow (kể cả sau khi đã standalone); dữ liệu lạ / hello bị bỏ qua', () => {
    const listener = vi.fn();
    r.subscribe(listener);
    r.receive({ v: 1, from: 'x', kind: 'hello' });
    r.receive('rác');
    r.receive({ v: 9, from: 'p', kind: 'song' });
    expect(listener).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2000);
    expect(r.getState().mode).toBe('standalone');
    r.receive(song('p1'));
    expect(r.getState()).toMatchObject({ mode: 'follow', sender: 'p1', state: null });
    expect(r.getState().song?.songKey).toBe('k1');
    r.receive(state('p1', { playing: true }));
    expect(r.getState().state).toMatchObject({ playing: true });
    expect(r.getState().song).not.toBeNull();
  });

  it('follow trước 2 s thì không bao giờ standalone', () => {
    r.receive(state('p1'));
    vi.advanceTimersByTime(1500);
    r.receive(state('p1'));
    vi.advanceTimersByTime(1500);
    expect(r.getState().mode).toBe('follow');
  });

  it('im lặng 4 s → lost; tin mới → follow lại', () => {
    r.receive(state('p1'));
    vi.advanceTimersByTime(3999);
    expect(r.getState().mode).toBe('follow');
    vi.advanceTimersByTime(1);
    expect(r.getState().mode).toBe('lost');
    expect(r.getState().state).not.toBeNull(); // giữ trạng thái cuối
    r.receive(state('p1', { cause: 'tick' }));
    expect(r.getState().mode).toBe('follow');
  });

  it('tab Player ẩn (hidden): chờ 90 s mới coi là mất (timer của tab ẩn bị hãm)', () => {
    r.receive(state('p1', { hidden: true }));
    vi.advanceTimersByTime(60_000);
    expect(r.getState().mode).toBe('follow');
    vi.advanceTimersByTime(30_000);
    expect(r.getState().mode).toBe('lost');
  });

  it('bye của Player đang theo → lost ngay; bye của Player khác bị bỏ qua', () => {
    r.receive(state('p1'));
    r.receive({ v: 1, from: 'p2', kind: 'bye' });
    expect(r.getState().mode).toBe('follow');
    r.receive({ v: 1, from: 'p1', kind: 'bye' });
    expect(r.getState().mode).toBe('lost');
  });

  it('Player khác: heartbeat không giành; đổi thật (change) thì chuyển sang', () => {
    r.receive(song('p1', 'k1'));
    r.receive(state('p1'));
    r.receive(state('p2', { songKey: 'k2', cause: 'tick' }));
    r.receive(song('p2', 'k2', 'reply'));
    expect(r.getState().sender).toBe('p1');
    r.receive(state('p2', { songKey: 'k2', cause: 'change' }));
    // Bài của p2 đã nghe (reply, lúc còn theo p1) được nhớ → có bài ngay, không chờ lần nhắc lại.
    expect(r.getState()).toMatchObject({ sender: 'p2' });
    expect(r.getState().song?.songKey).toBe('k2');
    expect(r.getState().state?.songKey).toBe('k2');
    // Mất p2 → tin của p1 (kể cả heartbeat) được nhận lại.
    vi.advanceTimersByTime(4000);
    expect(r.getState().mode).toBe('lost');
    r.receive(state('p1', { cause: 'tick' }));
    expect(r.getState()).toMatchObject({ mode: 'follow', sender: 'p1' });
  });

  it('tab app mới mở (announce) không cướp overlay đang theo Player khác (R5)', () => {
    r.receive(song('p1', 'k1'));
    r.receive(state('p1', { playing: true, beat: 10 }));
    // Tab B vừa mở `#/` (màn chơi với bài mẫu): song + state `announce`, rồi heartbeat.
    r.receive(song('p2', 'demo', 'announce'));
    r.receive(state('p2', { songKey: 'demo', cause: 'announce' }));
    r.receive(state('p2', { songKey: 'demo', cause: 'tick' }));
    expect(r.getState()).toMatchObject({ mode: 'follow', sender: 'p1' });
    expect(r.getState().song?.songKey).toBe('k1');
    expect(r.getState().state).toMatchObject({ playing: true, beat: 10 });
    // Người dùng bấm ở tab B (change) → chuyển, có ngay bài của B.
    r.receive(state('p2', { songKey: 'demo', cause: 'change', playing: true }));
    expect(r.getState()).toMatchObject({ sender: 'p2' });
    expect(r.getState().song?.songKey).toBe('demo');
  });

  it('chưa theo ai / mất Player: announce được nhận ngay', () => {
    r.receive(song('p1', 'k1', 'announce'));
    expect(r.getState()).toMatchObject({ mode: 'follow', sender: 'p1' });
    r.receive({ v: 1, from: 'p1', kind: 'bye' });
    expect(r.getState().mode).toBe('lost');
    r.receive(song('p2', 'k2', 'announce'));
    expect(r.getState()).toMatchObject({ mode: 'follow', sender: 'p2' });
    expect(r.getState().song?.songKey).toBe('k2');
  });

  it('bài đổi: bỏ trạng thái của bài cũ (và ngược lại)', () => {
    r.receive(song('p1', 'k1'));
    r.receive(state('p1', { songKey: 'k1' }));
    r.receive(song('p1', 'k2'));
    expect(r.getState()).toMatchObject({ state: null });
    expect(r.getState().song?.songKey).toBe('k2');
    r.receive(state('p1', { songKey: 'k3' }));
    expect(r.getState().song).toBeNull();
    expect(r.getState().state?.songKey).toBe('k3');
  });

  it('tin cũ hơn (relay giao lệch thứ tự) bị bỏ', () => {
    r.receive(state('p1', { seq: 10, sentAt: 5000, beat: 3 }));
    r.receive(state('p1', { seq: 9, sentAt: 4000, beat: 1 }));
    expect(r.getState().state?.beat).toBe(3);
    // Player mount lại (seq về 0) nhưng tin mới hơn theo thời gian → nhận.
    r.receive(state('p1', { seq: 1, sentAt: 6000, beat: 7 }));
    expect(r.getState().state?.beat).toBe(7);
  });

  it('stop dọn timer; start lại (StrictMode) gửi hello và hẹn giờ lại', () => {
    r.stop();
    vi.advanceTimersByTime(5000);
    expect(r.getState().mode).toBe('waiting');
    r.start((m) => sent.push(m));
    expect(sent).toHaveLength(2);
    vi.advanceTimersByTime(2000);
    expect(r.getState().mode).toBe('standalone');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('không có kênh gửi (không BroadcastChannel): vẫn chạy theo tin OBS / standalone', () => {
    const solo = new FollowReceiver();
    solo.start(null);
    solo.receive(state('p9'));
    expect(solo.getState().mode).toBe('follow');
    solo.stop();
  });
});

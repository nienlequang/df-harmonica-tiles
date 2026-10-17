import { describe, expect, it } from 'vitest';
import {
  MINI_DEFAULT_DELAY,
  MINI_DELAY_MAX,
  MINI_SONG_STORAGE_KEY,
  MiniController,
  isMiniStopped,
  parseMiniDelay,
  readLastMiniSong,
  rememberMiniSong,
} from './miniControl';
import type { MiniTarget, MiniTimers } from './miniControl';

/** Timer tay: `advance()` chạy timer kế tiếp (1 giây). */
function manualTimers() {
  let next = 1;
  const pending = new Map<number, () => void>();
  const timers: MiniTimers = {
    setTimeout: (fn) => {
      const id = next++;
      pending.set(id, fn);
      return id;
    },
    clearTimeout: (id) => {
      pending.delete(id as number);
    },
  };
  return {
    timers,
    get pending() {
      return pending.size;
    },
    advance(times = 1) {
      for (let i = 0; i < times; i++) {
        const first = pending.entries().next();
        if (first.done) return;
        const [id, fn] = first.value;
        pending.delete(id);
        fn();
      }
    },
  };
}

function target() {
  const calls: string[] = [];
  const t: MiniTarget = {
    play: () => calls.push('play'),
    pause: () => calls.push('pause'),
    restart: () => calls.push('restart'),
  };
  return { t, calls };
}

describe('isMiniStopped (panel + nút "◂" chỉ khi đang dừng — góp ý 2026-10-16)', () => {
  it('ready / paused / ended = dừng; countdown / playing = không', () => {
    expect(isMiniStopped('ready')).toBe(true);
    expect(isMiniStopped('paused')).toBe(true);
    expect(isMiniStopped('ended')).toBe(true);
    expect(isMiniStopped('countdown')).toBe(false);
    expect(isMiniStopped('playing')).toBe(false);
  });

  it('khớp `active` của controller qua mọi pha', () => {
    const clock = manualTimers();
    const { t } = target();
    const c = new MiniController(t, { timers: clock.timers });
    const check = () => expect(isMiniStopped(c.getState().phase)).toBe(!c.active);
    check(); // ready
    c.start();
    check(); // countdown
    clock.advance(3);
    check(); // playing
    c.pause();
    check(); // paused
  });
});

describe('MiniController', () => {
  it('▶ → đếm ngược 3-2-1 → chạy (play), không cần chạm thêm', () => {
    const clock = manualTimers();
    const { t, calls } = target();
    const c = new MiniController(t, { timers: clock.timers });
    expect(c.getState()).toEqual({ phase: 'ready', countdown: null, delay: MINI_DEFAULT_DELAY });
    c.start();
    expect(c.getState()).toMatchObject({ phase: 'countdown', countdown: 3 });
    expect(c.active).toBe(true);
    clock.advance();
    expect(c.getState().countdown).toBe(2);
    clock.advance();
    expect(c.getState().countdown).toBe(1);
    expect(calls).toEqual([]);
    clock.advance();
    expect(c.getState()).toMatchObject({ phase: 'playing', countdown: null });
    expect(calls).toEqual(['play']);
    expect(clock.pending).toBe(0);
  });

  it('chạm khi chạy = tạm dừng; chạm lại = đếm ngược rồi chạy tiếp', () => {
    const clock = manualTimers();
    const { t, calls } = target();
    const c = new MiniController(t, { delaySec: 0, timers: clock.timers });
    c.tap();
    expect(c.getState().phase).toBe('playing');
    c.tap();
    expect(c.getState().phase).toBe('paused');
    expect(c.active).toBe(false);
    c.setDelay(5);
    c.tap();
    expect(c.getState()).toMatchObject({ phase: 'countdown', countdown: 5 });
    clock.advance(5);
    expect(c.getState().phase).toBe('playing');
    expect(calls).toEqual(['play', 'pause', 'play']);
  });

  it('chạm khi đang đếm ngược = hủy, về pha trước (chưa chạy / tạm dừng)', () => {
    const clock = manualTimers();
    const { t, calls } = target();
    const c = new MiniController(t, { delaySec: 3, timers: clock.timers });
    c.tap();
    c.tap();
    expect(c.getState()).toMatchObject({ phase: 'ready', countdown: null });
    expect(clock.pending).toBe(0);
    c.start();
    clock.advance(3);
    c.pause();
    c.start();
    c.cancelCountdown();
    expect(c.getState().phase).toBe('paused');
    expect(calls).toEqual(['play', 'pause']);
    // start khi đang chạy / đang đếm: bỏ qua
    c.start();
    c.start();
    expect(c.getState().countdown).toBe(3);
  });

  it('hết bài → chạm = đếm ngược rồi chơi lại TỪ ĐẦU (restart)', () => {
    const clock = manualTimers();
    const { t, calls } = target();
    const c = new MiniController(t, { delaySec: 3, timers: clock.timers });
    c.markEnded(); // chưa chạy: bỏ qua
    expect(c.getState().phase).toBe('ready');
    c.start();
    clock.advance(3);
    c.markEnded();
    expect(c.getState().phase).toBe('ended');
    c.tap();
    expect(c.getState().phase).toBe('countdown');
    clock.advance(3);
    expect(calls).toEqual(['play', 'restart']);
  });

  it('↺ khi đang chạy: dừng, đếm ngược, restart; hủy đếm → tạm dừng', () => {
    const clock = manualTimers();
    const { t, calls } = target();
    const c = new MiniController(t, { delaySec: 3, timers: clock.timers });
    c.start();
    clock.advance(3);
    c.restart();
    expect(calls).toEqual(['play', 'pause']);
    expect(c.getState().phase).toBe('countdown');
    // ↺ lần nữa khi đang đếm: đếm lại từ đầu, giữ pha gốc
    clock.advance();
    c.restart();
    expect(c.getState().countdown).toBe(3);
    c.cancelCountdown();
    expect(c.getState().phase).toBe('paused');
    c.restart();
    clock.advance(3);
    expect(calls).toEqual(['play', 'pause', 'restart']);
  });

  it('đếm ngược 0: chạy ngay', () => {
    const clock = manualTimers();
    const { t, calls } = target();
    const c = new MiniController(t, { delaySec: 0, timers: clock.timers });
    c.restart();
    expect(c.getState().phase).toBe('playing');
    expect(calls).toEqual(['restart']);
    expect(clock.pending).toBe(0);
  });

  it('setDelay nhận số giây nguyên 0..10 (như Cài đặt); báo listener khi đổi', () => {
    const { t } = target();
    const c = new MiniController(t, { delaySec: 11 });
    expect(c.getState().delay).toBe(MINI_DEFAULT_DELAY);
    expect(new MiniController(t, { delaySec: 7 }).getState().delay).toBe(7);
    let n = 0;
    const off = c.subscribe(() => n++);
    c.setDelay(4.5);
    c.setDelay(-1);
    c.setDelay(MINI_DELAY_MAX + 1);
    c.setDelay(MINI_DEFAULT_DELAY);
    expect(n).toBe(0);
    c.setDelay(10);
    expect(c.getState().delay).toBe(10);
    expect(n).toBe(1);
    off();
    c.setDelay(5);
    expect(n).toBe(1);
  });

  it('dispose (unmount) hủy đếm ngược, timer không chạy nữa; dùng lại được (StrictMode)', () => {
    const clock = manualTimers();
    const { t, calls } = target();
    const c = new MiniController(t, { timers: clock.timers });
    c.start();
    c.dispose();
    expect(c.getState().phase).toBe('ready');
    expect(clock.pending).toBe(0);
    clock.advance(5);
    expect(calls).toEqual([]);
    c.start();
    clock.advance(3);
    expect(calls).toEqual(['play']);
  });

  it('dùng setTimeout thật khi không tiêm timer', () => {
    const { t, calls } = target();
    const c = new MiniController(t, { delaySec: 0 });
    c.start();
    expect(calls).toEqual(['play']);
    c.dispose();
  });

  it('R7: báo engine lúc bắt đầu / hủy đếm ngược (prepare) để vẽ frame đầu đếm vào; đếm 0 thì không', () => {
    const clock = manualTimers();
    const calls: string[] = [];
    const t: MiniTarget = {
      play: () => calls.push('play'),
      pause: () => calls.push('pause'),
      restart: () => calls.push('restart'),
      prepare: (a) => calls.push(`prepare:${a ?? 'null'}`),
    };
    const c = new MiniController(t, { timers: clock.timers });
    c.start();
    expect(calls).toEqual(['prepare:play']);
    clock.advance(3);
    expect(calls).toEqual(['prepare:play', 'play']);
    c.tap(); // tạm dừng
    c.tap(); // chạy tiếp: đếm lại
    c.tap(); // hủy
    expect(calls.slice(2)).toEqual(['pause', 'prepare:play', 'prepare:null']);
    calls.length = 0;
    c.restart();
    expect(calls).toEqual(['prepare:restart']);
    c.dispose();
    expect(calls).toEqual(['prepare:restart', 'prepare:null']);
    calls.length = 0;
    c.setDelay(0);
    c.start();
    expect(calls).toEqual(['play']);
  });

  it('engine không có prepare (tùy chọn) vẫn chạy như cũ', () => {
    const clock = manualTimers();
    const { t, calls } = target();
    const c = new MiniController(t, { timers: clock.timers });
    c.start();
    c.cancelCountdown();
    c.start();
    clock.advance(3);
    expect(calls).toEqual(['play']);
  });
});

describe('parseMiniDelay + nhớ bài', () => {
  it('nhận số giây nguyên 0..10 (số hoặc chuỗi `?delay=`), còn lại null', () => {
    expect(parseMiniDelay('5')).toBe(5);
    expect(parseMiniDelay(' 4 ')).toBe(4);
    expect(parseMiniDelay(0)).toBe(0);
    expect(parseMiniDelay('0')).toBe(0);
    expect(parseMiniDelay(10)).toBe(10);
    expect(parseMiniDelay('')).toBeNull();
    expect(parseMiniDelay(' ')).toBeNull();
    expect(parseMiniDelay('11')).toBeNull();
    expect(parseMiniDelay(2.5)).toBeNull();
    expect(parseMiniDelay('2.5')).toBeNull();
    expect(parseMiniDelay(-1)).toBeNull();
    expect(parseMiniDelay(null)).toBeNull();
    expect(parseMiniDelay('abc')).toBeNull();
  });

  it('bài mở trang mini lần trước', () => {
    expect(readLastMiniSong()).toBeNull();
    rememberMiniSong('seed-quoc-ca-viet-nam');
    expect(localStorage.getItem(MINI_SONG_STORAGE_KEY)).toBe('seed-quoc-ca-viet-nam');
    expect(readLastMiniSong()).toBe('seed-quoc-ca-viet-nam');
    rememberMiniSong('');
    rememberMiniSong('x'.repeat(300));
    expect(readLastMiniSong()).toBe('seed-quoc-ca-viet-nam');
  });
});

import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ScreenWakeLock, useScreenWakeLock } from './wakeLock';
import type { WakeLockDocument, WakeLockNavigator, WakeLockSentinelLike } from './wakeLock';

class FakeSentinel implements WakeLockSentinelLike {
  released = false;
  private readonly listeners = new Set<() => void>();
  release = vi.fn(() => {
    this.released = true;
    return Promise.resolve();
  });
  addEventListener(_t: 'release', l: () => void): void {
    this.listeners.add(l);
  }
  removeEventListener(_t: 'release', l: () => void): void {
    this.listeners.delete(l);
  }
  /** Trình duyệt tự nhả (trang bị ẩn). */
  systemRelease(): void {
    this.released = true;
    for (const l of Array.from(this.listeners)) l();
  }
  get listenerCount(): number {
    return this.listeners.size;
  }
}

function fakeEnv(opts: { reject?: boolean } = {}) {
  const sentinels: FakeSentinel[] = [];
  const resolvers: (() => void)[] = [];
  const request = vi.fn(
    () =>
      new Promise<WakeLockSentinelLike>((resolve, reject) => {
        resolvers.push(() => {
          if (opts.reject) {
            reject(new DOMException('denied', 'NotAllowedError'));
            return;
          }
          const s = new FakeSentinel();
          sentinels.push(s);
          resolve(s);
        });
      }),
  );
  const nav: WakeLockNavigator = { wakeLock: { request } };
  const listeners = new Set<() => void>();
  const doc = {
    visibilityState: 'visible' as DocumentVisibilityState,
    addEventListener: (_t: 'visibilitychange', l: () => void) => listeners.add(l),
    removeEventListener: (_t: 'visibilitychange', l: () => void) => listeners.delete(l),
  };
  const setVisible = (v: boolean): void => {
    doc.visibilityState = v ? 'visible' : 'hidden';
    for (const l of Array.from(listeners)) l();
  };
  /** Trả kết quả cho mọi request đang chờ. */
  const settle = async (): Promise<void> => {
    for (const r of resolvers.splice(0)) r();
    await Promise.resolve();
    await Promise.resolve();
  };
  return { nav, doc: doc as WakeLockDocument, request, sentinels, setVisible, settle, listeners };
}

describe('ScreenWakeLock', () => {
  it('xin khi cần, nhả khi tắt', async () => {
    const env = fakeEnv();
    const lock = new ScreenWakeLock(env.nav, env.doc);
    expect(lock.supported).toBe(true);
    lock.setWanted(true);
    expect(env.request).toHaveBeenCalledWith('screen');
    lock.setWanted(true); // đang chờ: không xin hai lần
    expect(env.request).toHaveBeenCalledTimes(1);
    await env.settle();
    expect(lock.held).toBe(true);
    lock.setWanted(false);
    expect(lock.held).toBe(false);
    expect(env.sentinels[0].release).toHaveBeenCalledTimes(1);
    expect(env.sentinels[0].listenerCount).toBe(0);
  });

  it('trang ẩn → trình duyệt nhả; hiện lại → xin lại (nếu vẫn cần)', async () => {
    const env = fakeEnv();
    const lock = new ScreenWakeLock(env.nav, env.doc);
    lock.setWanted(true);
    await env.settle();
    env.setVisible(false);
    env.sentinels[0].systemRelease();
    expect(lock.held).toBe(false);
    expect(env.request).toHaveBeenCalledTimes(1);
    env.setVisible(true);
    expect(env.request).toHaveBeenCalledTimes(2);
    await env.settle();
    expect(lock.held).toBe(true);
    // Không cần nữa: hiện lại không xin.
    lock.setWanted(false);
    env.setVisible(false);
    env.setVisible(true);
    expect(env.request).toHaveBeenCalledTimes(2);
  });

  it('trang đang ẩn thì chưa xin; tắt trước khi được cấp → nhả ngay khi cấp', async () => {
    const env = fakeEnv();
    const lock = new ScreenWakeLock(env.nav, env.doc);
    env.setVisible(false);
    lock.setWanted(true);
    expect(env.request).not.toHaveBeenCalled();
    env.setVisible(true);
    expect(env.request).toHaveBeenCalledTimes(1);
    lock.setWanted(false);
    await env.settle();
    expect(lock.held).toBe(false);
    expect(env.sentinels[0].release).toHaveBeenCalledTimes(1);
  });

  it('bị từ chối / request throw / không hỗ trợ → im lặng', async () => {
    const env = fakeEnv({ reject: true });
    const lock = new ScreenWakeLock(env.nav, env.doc);
    lock.setWanted(true);
    await env.settle();
    expect(lock.held).toBe(false);
    // Thử lại được sau khi bị từ chối.
    env.setVisible(true);
    expect(env.request).toHaveBeenCalledTimes(2);

    const throwing: WakeLockNavigator = {
      wakeLock: {
        request: () => {
          throw new Error('nope');
        },
      },
    };
    const l2 = new ScreenWakeLock(throwing, env.doc);
    expect(() => l2.setWanted(true)).not.toThrow();
    expect(l2.held).toBe(false);

    const l3 = new ScreenWakeLock({}, env.doc);
    expect(l3.supported).toBe(false);
    l3.setWanted(true);
    expect(l3.held).toBe(false);
  });

  it('dispose: nhả, gỡ listener visibilitychange, không xin nữa', async () => {
    const env = fakeEnv();
    const lock = new ScreenWakeLock(env.nav, env.doc);
    expect(env.listeners.size).toBe(1);
    lock.setWanted(true);
    await env.settle();
    lock.dispose();
    lock.dispose();
    expect(env.listeners.size).toBe(0);
    expect(env.sentinels[0].release).toHaveBeenCalledTimes(1);
    lock.setWanted(true);
    expect(env.request).toHaveBeenCalledTimes(1);
  });
});

describe('useScreenWakeLock', () => {
  function Probe({ on }: { on: boolean }) {
    useScreenWakeLock(on);
    return null;
  }

  it('dùng navigator.wakeLock của trình duyệt: xin khi bật, nhả khi tắt / unmount', async () => {
    const sentinel = new FakeSentinel();
    const request = vi.fn(() => Promise.resolve(sentinel));
    Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: { request } });
    try {
      const { rerender, unmount } = render(<Probe on={false} />);
      expect(request).not.toHaveBeenCalled();
      rerender(<Probe on />);
      expect(request).toHaveBeenCalledTimes(1);
      await Promise.resolve();
      await Promise.resolve();
      rerender(<Probe on={false} />);
      expect(sentinel.release).toHaveBeenCalledTimes(1);
      rerender(<Probe on />);
      unmount();
    } finally {
      delete (navigator as unknown as Record<string, unknown>).wakeLock;
    }
  });

  it('không có wakeLock (jsdom) → không lỗi', () => {
    const { rerender, unmount } = render(<Probe on />);
    rerender(<Probe on={false} />);
    unmount();
  });
});

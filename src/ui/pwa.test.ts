import { registerSW } from 'virtual:pwa-register';
import type { RegisterSWOptions } from 'virtual:pwa-register';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  RELOAD_FALLBACK_MS,
  UPDATE_CHECK_INTERVAL_MS,
  UPDATE_CHECK_MIN_GAP_MS,
  applyUpdate,
  canUseServiceWorker,
  dismissOfflineReady,
  dismissUpdate,
  resetPwaForTests,
  startPwa,
  usePwa,
  watchForUpdates,
} from './pwa';
import type { WatchUpdatesDeps } from './pwa';

const sw = vi.hoisted(() => ({
  options: undefined as RegisterSWOptions | undefined,
  update: undefined as ((reloadPage?: boolean) => Promise<void>) | undefined,
}));

vi.mock('virtual:pwa-register', () => ({
  registerSW: vi.fn((options?: RegisterSWOptions) => {
    sw.options = options;
    return sw.update;
  }),
}));

function setServiceWorker(present: boolean): void {
  if (present) {
    Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: {} });
  } else {
    Reflect.deleteProperty(navigator, 'serviceWorker');
  }
}

/** Hook của SW đã đăng ký (lỗi nếu startPwa chưa gọi registerSW). */
function hooks(): RegisterSWOptions {
  if (!sw.options) throw new Error('registerSW was not called');
  return sw.options;
}

let reload: ReturnType<typeof vi.fn<() => void>>;

beforeEach(() => {
  vi.useFakeTimers();
  sw.options = undefined;
  sw.update = vi.fn(() => Promise.resolve());
  vi.mocked(registerSW).mockClear();
  reload = vi.fn<() => void>();
  resetPwaForTests({ reload });
  setServiceWorker(true);
});

afterEach(() => {
  resetPwaForTests();
  setServiceWorker(false);
  vi.useRealTimers();
});

describe('canUseServiceWorker', () => {
  it('http(s) + navigator.serviceWorker → có', () => {
    expect(window.location.protocol).toMatch(/^https?:$/);
    expect(canUseServiceWorker()).toBe(true);
  });

  it('không có navigator.serviceWorker (trang không an toàn / trình duyệt cũ) → không', () => {
    setServiceWorker(false);
    expect(canUseServiceWorker()).toBe(false);
  });

  it('cửa sổ Tauri (window.__TAURI__) → không', () => {
    Object.defineProperty(window, '__TAURI__', { configurable: true, value: {} });
    try {
      expect(canUseServiceWorker()).toBe(false);
    } finally {
      Reflect.deleteProperty(window, '__TAURI__');
    }
  });
});

describe('startPwa', () => {
  it('đăng ký một lần cho cả phiên', () => {
    startPwa();
    startPwa();
    expect(registerSW).toHaveBeenCalledTimes(1);
    expect(hooks().immediate).toBeUndefined();
  });

  it('không có service worker → không đăng ký, không lỗi', () => {
    setServiceWorker(false);
    startPwa();
    expect(registerSW).not.toHaveBeenCalled();
    expect(usePwa.getState()).toEqual({ needRefresh: false, offlineReady: false });
  });

  it('onNeedRefresh / onOfflineReady → trạng thái cho UpdatePrompt', () => {
    startPwa();
    hooks().onOfflineReady?.();
    expect(usePwa.getState()).toEqual({ needRefresh: false, offlineReady: true });
    dismissOfflineReady();
    hooks().onNeedRefresh?.();
    expect(usePwa.getState()).toEqual({ needRefresh: true, offlineReady: false });
    dismissUpdate();
    expect(usePwa.getState().needRefresh).toBe(false);
  });

  it('lỗi đăng ký chỉ cảnh báo (console.warn), không console.error', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error');
    startPwa();
    hooks().onRegisterError?.(new Error('blocked'));
    expect(warn).toHaveBeenCalledTimes(1);
    expect(error).not.toHaveBeenCalled();
  });

  it('SW mới nhận trang mà tab này chưa bấm "Tải lại" (tab khác bấm) → không tự tải lại, nhắc lại', () => {
    startPwa();
    hooks().onNeedReload?.();
    expect(reload).not.toHaveBeenCalled();
    expect(usePwa.getState().needRefresh).toBe(true);
  });
});

describe('applyUpdate', () => {
  it('nhắn SW mới skipWaiting, ẩn nhắc; SW nhận trang → tải lại đúng một lần', async () => {
    startPwa();
    hooks().onNeedRefresh?.();
    await applyUpdate();
    expect(sw.update).toHaveBeenCalledWith(true);
    expect(usePwa.getState().needRefresh).toBe(false);
    expect(reload).not.toHaveBeenCalled();

    hooks().onNeedReload?.();
    expect(reload).toHaveBeenCalledTimes(1);
    // Dự phòng đã hủy: không tải lại lần hai.
    vi.advanceTimersByTime(RELOAD_FALLBACK_MS * 2);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('SW mới không nhận trang (đã được tab khác kích hoạt) → tự tải lại sau RELOAD_FALLBACK_MS', async () => {
    startPwa();
    await applyUpdate();
    vi.advanceTimersByTime(RELOAD_FALLBACK_MS - 1);
    expect(reload).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('chưa đăng ký SW (không hỗ trợ) → tải lại ngay', async () => {
    setServiceWorker(false);
    startPwa();
    await applyUpdate();
    expect(reload).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(RELOAD_FALLBACK_MS);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('updateServiceWorker lỗi → cảnh báo và tải lại ngay', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    sw.update = vi.fn(() => Promise.reject(new Error('no waiting worker')));
    startPwa();
    await applyUpdate();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(reload).toHaveBeenCalledTimes(1);
  });
});

describe('watchForUpdates (vòng R7: tự kiểm tra bản mới, không cần tải lại tay)', () => {
  /** Document giả: visibilityState đổi được + phát visibilitychange. */
  function fakeDoc(initial: DocumentVisibilityState = 'visible') {
    const listeners = new Set<() => void>();
    const doc = {
      visibilityState: initial,
      addEventListener: (_t: string, l: () => void) => listeners.add(l),
      removeEventListener: (_t: string, l: () => void) => listeners.delete(l),
    };
    return {
      doc: doc as unknown as NonNullable<WatchUpdatesDeps['doc']>,
      listeners,
      show(state: DocumentVisibilityState) {
        doc.visibilityState = state;
        for (const l of Array.from(listeners)) l();
      },
    };
  }

  let t = 0;
  const now = () => t;
  /** Tiến đồng hồ + timer giả (interval 45 phút). */
  const advance = (ms: number) => {
    t += ms;
    vi.advanceTimersByTime(ms);
  };

  beforeEach(() => {
    t = 1_000_000;
  });

  it('quay lại tab → update() ngay, nhưng không dày hơn UPDATE_CHECK_MIN_GAP_MS; tab ẩn thì không', async () => {
    const update = vi.fn(() => Promise.resolve());
    const d = fakeDoc();
    const stop = watchForUpdates({ update }, { doc: d.doc, now, isOnline: () => true });
    // Vừa đăng ký = vừa kiểm tra: quay lại tab ngay sau đó không hỏi lại.
    d.show('hidden');
    d.show('visible');
    expect(update).not.toHaveBeenCalled();
    t += UPDATE_CHECK_MIN_GAP_MS;
    d.show('hidden');
    expect(update).not.toHaveBeenCalled();
    d.show('visible');
    expect(update).toHaveBeenCalledTimes(1);
    await Promise.resolve();
    t += 60_000;
    d.show('hidden');
    d.show('visible');
    expect(update).toHaveBeenCalledTimes(1);
    stop();
    t += UPDATE_CHECK_MIN_GAP_MS * 2;
    d.show('visible');
    expect(update).toHaveBeenCalledTimes(1);
    expect(d.listeners.size).toBe(0);
  });

  it('đang hiện: kiểm tra mỗi UPDATE_CHECK_INTERVAL_MS; tab ẩn thì bỏ lượt (hỏi khi hiện lại)', async () => {
    const update = vi.fn(() => Promise.resolve());
    const d = fakeDoc();
    const stop = watchForUpdates({ update }, { doc: d.doc, now, isOnline: () => true });
    expect(UPDATE_CHECK_INTERVAL_MS).toBeGreaterThanOrEqual(30 * 60_000);
    expect(UPDATE_CHECK_INTERVAL_MS).toBeLessThanOrEqual(60 * 60_000);
    advance(UPDATE_CHECK_INTERVAL_MS - 1);
    expect(update).not.toHaveBeenCalled();
    advance(1);
    expect(update).toHaveBeenCalledTimes(1);
    await Promise.resolve();
    d.show('hidden');
    advance(UPDATE_CHECK_INTERVAL_MS);
    expect(update).toHaveBeenCalledTimes(1);
    d.show('visible');
    expect(update).toHaveBeenCalledTimes(2);
    stop();
    advance(UPDATE_CHECK_INTERVAL_MS * 3);
    expect(update).toHaveBeenCalledTimes(2);
  });

  it('offline → bỏ lượt; update() lỗi (mạng) → im lặng, lượt sau thử lại; không chồng hai lần hỏi', async () => {
    const error = vi.spyOn(console, 'error');
    let online = false;
    const pending: { fail: ((e: Error) => void) | null } = { fail: null };
    const update = vi.fn(
      () =>
        new Promise<void>((_res, rej) => {
          pending.fail = rej;
        }),
    );
    const d = fakeDoc();
    const stop = watchForUpdates({ update }, { doc: d.doc, now, isOnline: () => online });
    t += UPDATE_CHECK_MIN_GAP_MS;
    d.show('visible');
    expect(update).not.toHaveBeenCalled();
    online = true;
    d.show('visible');
    expect(update).toHaveBeenCalledTimes(1);
    // Đang hỏi dở: lượt khác bỏ qua.
    t += UPDATE_CHECK_MIN_GAP_MS;
    d.show('visible');
    expect(update).toHaveBeenCalledTimes(1);
    pending.fail?.(new Error('offline'));
    await Promise.resolve();
    await Promise.resolve();
    t += UPDATE_CHECK_MIN_GAP_MS;
    d.show('visible');
    expect(update).toHaveBeenCalledTimes(2);
    expect(error).not.toHaveBeenCalled();
    stop();
  });

  it('update() ném đồng bộ → không vỡ, lượt sau vẫn hỏi', () => {
    const update = vi.fn(() => {
      throw new Error('invalid state');
    });
    const d = fakeDoc();
    const stop = watchForUpdates({ update }, { doc: d.doc, now, isOnline: () => true });
    t += UPDATE_CHECK_MIN_GAP_MS;
    expect(() => d.show('visible')).not.toThrow();
    t += UPDATE_CHECK_MIN_GAP_MS;
    d.show('visible');
    expect(update).toHaveBeenCalledTimes(2);
    stop();
  });

  it('startPwa: đăng ký xong (onRegisteredSW) → bắt đầu theo dõi một lần; reset dừng theo dõi', async () => {
    const update = vi.fn(() => Promise.resolve());
    startPwa();
    const reg = { update } as unknown as ServiceWorkerRegistration;
    hooks().onRegisteredSW?.('/sw.js', reg);
    hooks().onRegisteredSW?.('/sw.js', reg); // gọi lại không tạo bộ theo dõi thứ hai
    hooks().onRegisteredSW?.('/sw.js', undefined);
    vi.advanceTimersByTime(UPDATE_CHECK_INTERVAL_MS);
    // jsdom: document hiện, navigator.onLine = true.
    expect(update).toHaveBeenCalledTimes(1);
    resetPwaForTests({ reload });
    vi.advanceTimersByTime(UPDATE_CHECK_INTERVAL_MS * 2);
    expect(update).toHaveBeenCalledTimes(1);
  });
});

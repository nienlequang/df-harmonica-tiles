/**
 * Cửa sổ giả cho test "Cửa sổ nổi" (jsdom không có Document Picture-in-Picture): document riêng
 * (`document.implementation.createHTMLDocument`), hàng đợi rAF chạy tay, timer chuyển tiếp sang timer
 * global (dùng được với `vi.useFakeTimers()`), ResizeObserver / matchMedia giả, đếm listener theo
 * loại để kiểm tra không leak. CHỈ dùng trong test (app không import).
 */
import { vi } from 'vitest';
import type { Mock } from 'vitest';

type TimeoutId = ReturnType<typeof setTimeout>;
type IntervalId = ReturnType<typeof setInterval>;

export interface FakeResizeObserver {
  readonly callback: ResizeObserverCallback;
  readonly targets: Set<Element>;
  disconnected: boolean;
}

export interface FakeMediaQueryList {
  readonly media: string;
  readonly listeners: Set<EventListenerOrEventListenerObject>;
}

export interface FakePipWindow {
  /** Đối tượng đưa cho code như một `Window`. */
  readonly win: Window;
  readonly doc: Document;
  readonly frames: Map<number, FrameRequestCallback>;
  readonly raf: Mock<(cb: FrameRequestCallback) => number>;
  readonly caf: Mock<(id: number) => void>;
  readonly setTimeoutSpy: Mock<(fn: () => void, ms?: number) => TimeoutId>;
  readonly setIntervalSpy: Mock<(fn: () => void, ms?: number) => IntervalId>;
  readonly clearIntervalSpy: Mock<(id: IntervalId) => void>;
  readonly resizeObservers: FakeResizeObserver[];
  readonly mediaQueries: FakeMediaQueryList[];
  readonly close: Mock<() => void>;
  readonly focus: Mock<() => void>;
  /** Chạy các frame đang chờ (`count` lượt). */
  flushFrames(count?: number): void;
  /** Số listener đang gắn trên cửa sổ theo loại sự kiện. */
  listenerCount(type: string): number;
  /** Đổi kích thước trong + bắn 'resize'. */
  resizeTo(width: number, height: number): void;
  /** Bắn phím trên cửa sổ (keydown rồi keyup). */
  press(code: string, key?: string): void;
  /** Interval đang sống (đã đặt, chưa clear). */
  readonly liveIntervals: Set<unknown>;
}

export interface FakePipWindowInit {
  width?: number;
  height?: number;
  dpr?: number;
  screenHeight?: number;
  /** false = không có ResizeObserver (engine phải nghe 'resize' của cửa sổ). */
  resizeObserver?: boolean;
}

export function createFakePipWindow(init: FakePipWindowInit = {}): FakePipWindow {
  const doc = document.implementation.createHTMLDocument('pip');
  const target = new EventTarget();
  const counts = new Map<string, number>();
  const frames = new Map<number, FrameRequestCallback>();
  let nextFrame = 1;
  const resizeObservers: FakeResizeObserver[] = [];
  const mediaQueries: FakeMediaQueryList[] = [];
  const liveIntervals = new Set<unknown>();

  const raf = vi.fn((cb: FrameRequestCallback) => {
    const id = nextFrame++;
    frames.set(id, cb);
    return id;
  });
  const caf = vi.fn((id: number) => {
    frames.delete(id);
  });
  const setTimeoutSpy = vi.fn((fn: () => void, ms?: number) => setTimeout(fn, ms));
  const clearTimeoutSpy = vi.fn((id: TimeoutId) => clearTimeout(id));
  const setIntervalSpy = vi.fn((fn: () => void, ms?: number) => {
    const id = setInterval(fn, ms);
    liveIntervals.add(id);
    return id;
  });
  const clearIntervalSpy = vi.fn((id: IntervalId) => {
    liveIntervals.delete(id);
    clearInterval(id);
  });

  class ResizeObserverFake implements FakeResizeObserver {
    readonly callback: ResizeObserverCallback;
    readonly targets = new Set<Element>();
    disconnected = false;
    constructor(cb: ResizeObserverCallback) {
      this.callback = cb;
      resizeObservers.push(this);
    }
    observe(el: Element): void {
      this.targets.add(el);
    }
    unobserve(el: Element): void {
      this.targets.delete(el);
    }
    disconnect(): void {
      this.disconnected = true;
      this.targets.clear();
    }
  }

  const matchMedia = vi.fn((media: string) => {
    const mql: FakeMediaQueryList & {
      matches: boolean;
      addEventListener: (t: string, l: EventListenerOrEventListenerObject) => void;
      removeEventListener: (t: string, l: EventListenerOrEventListenerObject) => void;
    } = {
      media,
      matches: true,
      listeners: new Set(),
      addEventListener: (_t, l) => mql.listeners.add(l),
      removeEventListener: (_t, l) => mql.listeners.delete(l),
    };
    mediaQueries.push(mql);
    return mql;
  });

  const close = vi.fn((): void => {
    target.dispatchEvent(new Event('pagehide'));
  });
  const focus = vi.fn((): void => {});

  const win = {
    document: doc,
    innerWidth: init.width ?? 576,
    innerHeight: init.height ?? 600,
    devicePixelRatio: init.dpr ?? 1,
    screen: { height: init.screenHeight ?? 1080 },
    requestAnimationFrame: raf,
    cancelAnimationFrame: caf,
    setTimeout: setTimeoutSpy,
    clearTimeout: clearTimeoutSpy,
    setInterval: setIntervalSpy,
    clearInterval: clearIntervalSpy,
    ResizeObserver: init.resizeObserver === false ? undefined : ResizeObserverFake,
    matchMedia,
    close,
    focus,
    addEventListener(
      type: string,
      fn: EventListenerOrEventListenerObject,
      opts?: AddEventListenerOptions | boolean,
    ) {
      counts.set(type, (counts.get(type) ?? 0) + 1);
      target.addEventListener(type, fn, opts);
    },
    removeEventListener(
      type: string,
      fn: EventListenerOrEventListenerObject,
      opts?: EventListenerOptions | boolean,
    ) {
      counts.set(type, Math.max(0, (counts.get(type) ?? 0) - 1));
      target.removeEventListener(type, fn, opts);
    },
    dispatchEvent(e: Event) {
      return target.dispatchEvent(e);
    },
  };

  return {
    win: win as unknown as Window,
    doc,
    frames,
    raf,
    caf,
    setTimeoutSpy,
    setIntervalSpy,
    clearIntervalSpy,
    resizeObservers,
    mediaQueries,
    close,
    focus,
    liveIntervals,
    flushFrames(count = 1) {
      for (let i = 0; i < count; i++) {
        const list = Array.from(frames.values());
        frames.clear();
        for (const cb of list) cb(0);
      }
    },
    listenerCount(type: string) {
      return counts.get(type) ?? 0;
    },
    resizeTo(width: number, height: number) {
      win.innerWidth = width;
      win.innerHeight = height;
      target.dispatchEvent(new Event('resize'));
    },
    press(code: string, key = '') {
      const opts = { code, key, bubbles: true, cancelable: true };
      target.dispatchEvent(new KeyboardEvent('keydown', opts));
      target.dispatchEvent(new KeyboardEvent('keyup', opts));
    },
  };
}

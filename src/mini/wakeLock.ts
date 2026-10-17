/**
 * Giữ màn hình sáng khi trang mini đang chạy (Screen Wake Lock API, `navigator.wakeLock`). Trình duyệt
 * tự nhả khóa khi trang bị ẩn → xin lại khi trang hiện lại (`visibilitychange`) nếu vẫn cần. Không hỗ
 * trợ / bị từ chối → im lặng bỏ qua (chỉ là tiện ích, không chặn chơi).
 */
import { useEffect, useRef } from 'react';

/** Phần của WakeLockSentinel dùng ở đây. */
export interface WakeLockSentinelLike {
  readonly released: boolean;
  release(): Promise<void>;
  addEventListener(type: 'release', listener: () => void): void;
  removeEventListener(type: 'release', listener: () => void): void;
}

export interface WakeLockNavigator {
  wakeLock?: { request(type: 'screen'): Promise<WakeLockSentinelLike> };
}

export interface WakeLockDocument {
  readonly visibilityState: DocumentVisibilityState;
  addEventListener(type: 'visibilitychange', listener: () => void): void;
  removeEventListener(type: 'visibilitychange', listener: () => void): void;
}

export class ScreenWakeLock {
  private readonly nav: WakeLockNavigator;
  private readonly doc: WakeLockDocument;
  private wanted = false;
  private sentinel: WakeLockSentinelLike | null = null;
  private pending = false;
  private disposed = false;

  constructor(
    nav: WakeLockNavigator = navigator as unknown as WakeLockNavigator,
    doc: WakeLockDocument = document,
  ) {
    this.nav = nav;
    this.doc = doc;
    doc.addEventListener('visibilitychange', this.onVisibility);
  }

  get supported(): boolean {
    return typeof this.nav.wakeLock?.request === 'function';
  }

  /** Đang giữ khóa (đã cấp, chưa nhả). */
  get held(): boolean {
    return this.sentinel !== null && !this.sentinel.released;
  }

  /** Cần giữ màn hình sáng hay không (xin / nhả theo đó). */
  setWanted(on: boolean): void {
    if (this.disposed) return;
    this.wanted = on;
    if (on) this.acquire();
    else this.release();
  }

  dispose(): void {
    if (this.disposed) return;
    this.wanted = false;
    this.release();
    this.disposed = true;
    this.doc.removeEventListener('visibilitychange', this.onVisibility);
  }

  private readonly onVisibility = (): void => {
    if (this.wanted && this.doc.visibilityState === 'visible') this.acquire();
  };

  private readonly onRelease = (): void => {
    // Trình duyệt nhả (trang ẩn): quên sentinel; lúc hiện lại sẽ xin lại.
    this.sentinel?.removeEventListener('release', this.onRelease);
    this.sentinel = null;
  };

  private acquire(): void {
    if (this.held || this.pending || !this.supported) return;
    if (this.doc.visibilityState !== 'visible') return;
    const wl = this.nav.wakeLock;
    if (!wl) return;
    this.pending = true;
    let request: Promise<WakeLockSentinelLike>;
    try {
      request = wl.request('screen');
    } catch {
      this.pending = false;
      return;
    }
    request.then(
      (s) => {
        this.pending = false;
        if (!this.wanted || this.disposed) {
          void s.release().catch(() => undefined);
          return;
        }
        this.sentinel = s;
        s.addEventListener('release', this.onRelease);
      },
      () => {
        this.pending = false;
      },
    );
  }

  private release(): void {
    const s = this.sentinel;
    if (!s) return;
    s.removeEventListener('release', this.onRelease);
    this.sentinel = null;
    if (!s.released) void s.release().catch(() => undefined);
  }
}

/** Giữ màn hình sáng khi `active`; nhả khi tắt / unmount. */
export function useScreenWakeLock(active: boolean): void {
  const ref = useRef<ScreenWakeLock | null>(null);
  // Tạo trong effect (StrictMode gắn / gỡ hai lần: lần gắn lại có khóa mới).
  useEffect(() => {
    if (typeof navigator === 'undefined' || typeof document === 'undefined') return;
    const lock = new ScreenWakeLock();
    ref.current = lock;
    return () => {
      lock.dispose();
      ref.current = null;
    };
  }, []);
  useEffect(() => {
    ref.current?.setWanted(active);
  }, [active]);
}

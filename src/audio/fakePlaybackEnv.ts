/**
 * Đồ giả cho test phiên "playback" (playbackSession.ts): `navigator.audioSession` (Audio Session API của Safari
 * 16.4+), UA iPhone, phần tử `<audio>` tối thiểu. App không import file này.
 */

export interface FakeAudioSessionHandle {
  /** Mọi giá trị đã ĐẶT vào `type`, theo thứ tự. */
  readonly log: string[];
  readonly type: string;
  /** Gỡ `navigator.audioSession`. */
  restore: () => void;
}

/**
 * Đặt `navigator.audioSession = { type }` giả (ghi lại mọi lần đặt). `onSet` chạy lúc đặt (vd. ghi số lần resume()
 * của AudioContext tại thời điểm đó để kiểm thứ tự).
 */
export function installFakeAudioSession(
  initial = 'auto',
  onSet?: (type: string) => void,
): FakeAudioSessionHandle {
  const log: string[] = [];
  let type = initial;
  const session = {
    get type(): string {
      return type;
    },
    set type(v: string) {
      type = v;
      log.push(v);
      onSet?.(v);
    },
  };
  Object.defineProperty(navigator, 'audioSession', { value: session, configurable: true });
  return {
    log,
    get type() {
      return type;
    },
    restore: () => {
      Reflect.deleteProperty(navigator, 'audioSession');
    },
  };
}

export const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 15_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.6 Mobile/15E148 Safari/604.1';
export const ANDROID_UA =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36';

/** Giả UA (mặc định iPhone) + số điểm chạm trên `navigator`; trả hàm gỡ. */
export function fakeUserAgent(ua = IPHONE_UA, maxTouchPoints = 5): () => void {
  Object.defineProperty(navigator, 'userAgent', { value: ua, configurable: true });
  Object.defineProperty(navigator, 'maxTouchPoints', { value: maxTouchPoints, configurable: true });
  return () => {
    Reflect.deleteProperty(navigator, 'userAgent');
    Reflect.deleteProperty(navigator, 'maxTouchPoints');
  };
}

export type FakePlayResult = 'resolve' | 'reject' | 'throw';

/** `<audio>` tối thiểu: thuộc tính, play / pause / load đếm được, `paused`. */
export class FakeAudioElement {
  preload = '';
  loop = false;
  muted = true;
  volume = 1;
  src = '';
  paused = true;
  playCalls = 0;
  pauseCalls = 0;
  loadCalls = 0;
  playResult: FakePlayResult = 'resolve';
  private readonly attrs = new Map<string, string>();

  setAttribute(name: string, value: string): void {
    this.attrs.set(name, value);
  }
  getAttribute(name: string): string | null {
    return this.attrs.get(name) ?? null;
  }
  hasAttribute(name: string): boolean {
    return this.attrs.has(name);
  }
  removeAttribute(name: string): void {
    this.attrs.delete(name);
    if (name === 'src') this.src = '';
  }
  play(): Promise<void> {
    this.playCalls++;
    if (this.playResult === 'throw') throw new Error('NotAllowedError');
    if (this.playResult === 'reject') return Promise.reject(new Error('NotAllowedError'));
    this.paused = false;
    return Promise.resolve();
  }
  pause(): void {
    this.pauseCalls++;
    this.paused = true;
  }
  load(): void {
    this.loadCalls++;
  }
  asElement(): HTMLAudioElement {
    return this as unknown as HTMLAudioElement;
  }
}

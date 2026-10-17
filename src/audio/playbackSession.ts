/**
 * Phiên âm thanh "playback" — để tiếng của app vẫn kêu khi iPhone / iPad gạt nút im lặng bên hông (D-421).
 *
 * iOS xếp Web Audio của trang web vào phiên "ambient": nút gạt bên hông ở im lặng là mất tiếng, kể cả khi
 * AudioContext đang chạy. Khi người dùng THẬT SỰ muốn nghe (giai điệu mẫu / click / tiếng phản hồi đang bật — gọi
 * ĐỒNG BỘ trong cú chạm mở khóa, trước hoặc cùng lúc `resume()`):
 * - Có Audio Session API (Safari 16.4+): `navigator.audioSession.type = 'playback'`.
 * - Không có API mà là máy Apple cảm ứng (iOS cũ): một `<audio>` im lặng, lặp (WAV PCM 8 bit dựng trong code, data:
 *   URI — không network, không file; cùng sample rate với AudioContext để iOS không đổi tần số phần cứng) phát trong
 *   cùng cú chạm — phần tử media đưa phiên của cả trang sang "playback" nên Web Audio không còn bị tắt tiếng.
 * `release()`: trả `type = 'auto'` / dừng + bỏ phần tử — để nhạc của app khác (Apple Music, Spotify…) không bị trang
 * chiếm mãi. Máy khác không có API (Android: âm lượng media quyết định; máy tính: không có nút gạt) → không làm gì.
 *
 * Không bao giờ throw. Chưa `acquire()` thì không đụng tới gì (mặc định app im lặng).
 */

/** Âm lượng của phần tử im lặng (nội dung đã là im lặng; iOS bỏ qua `volume` — chỉ để chắc chắn không kêu). */
export const SILENT_ELEMENT_VOLUME = 0.001;
/** Độ dài một vòng của WAV im lặng (giây) — đủ ngắn để data: URI nhỏ (~6 KB ở 48 kHz). */
export const SILENT_LOOP_SEC = 0.1;
/** Sample rate khi chưa biết của AudioContext. */
export const DEFAULT_SILENT_RATE = 44100;

/** `navigator.audioSession` (Audio Session API, Safari 16.4+) — lib DOM chưa khai báo. */
interface AudioSessionLike {
  type: string;
}

/** Phần navigator cần đọc (test truyền bản giả). */
export interface SessionNavigator {
  audioSession?: unknown;
  userAgent?: string;
  maxTouchPoints?: number;
}

export interface PlaybackSessionEnv {
  /** Mặc định `globalThis.navigator`, đọc lại mỗi lần (test đổi được giữa chừng). */
  navigator?: () => SessionNavigator | null | undefined;
  /** Tạo phần tử `<audio>` (mặc định `document.createElement('audio')`; test truyền bản giả). */
  createAudio?: () => HTMLAudioElement | null;
}

/** Cách đang giữ phiên: API của Safari, phần tử media im lặng, hoặc không làm được gì trên máy này. */
export type PlaybackMode = 'session-api' | 'media-element' | 'none';

function audioSessionOf(nav: SessionNavigator | null | undefined): AudioSessionLike | null {
  const s = nav?.audioSession;
  if (s === null || typeof s !== 'object') return null;
  try {
    return typeof (s as { type?: unknown }).type === 'string' ? (s as AudioSessionLike) : null;
  } catch {
    return null;
  }
}

/**
 * iPhone / iPad (kể cả iPadOS báo UA "Macintosh" + cảm ứng) — cùng phép thử với `isAppleMobile` của
 * src/pip/phonePref.ts (src/audio không import src/pip). Chỉ ở đây mới có nút gạt im lặng.
 */
export function isAppleTouch(nav: SessionNavigator | null | undefined): boolean {
  if (!nav) return false;
  const ua = String(nav.userAgent ?? '');
  if (/iPhone|iPad|iPod/i.test(ua)) return true;
  return /Macintosh/i.test(ua) && (nav.maxTouchPoints ?? 0) > 1;
}

function writeAscii(view: DataView, at: number, text: string): void {
  for (let i = 0; i < text.length; i++) view.setUint8(at + i, text.charCodeAt(i));
}

/** Byte → base64 (btoa có ở mọi trình duyệt, jsdom và Node ≥ 16). */
function toBase64(bytes: Uint8Array): string {
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

/**
 * WAV im lặng (PCM 8 bit không dấu, mono: mọi mẫu = 0x80) dạng data: URI. Sample rate lạ / thiếu → 44,1 kHz.
 */
export function silentWavDataUri(sampleRate?: number, seconds = SILENT_LOOP_SEC): string {
  const rate =
    typeof sampleRate === 'number' &&
    Number.isFinite(sampleRate) &&
    sampleRate >= 3000 &&
    sampleRate <= 768000
      ? Math.round(sampleRate)
      : DEFAULT_SILENT_RATE;
  const sec = Number.isFinite(seconds) && seconds > 0 ? seconds : SILENT_LOOP_SEC;
  // Số mẫu chẵn: khối RIFF cỡ lẻ phải có byte đệm (vd. 22,05 kHz × 0,1 s = 2205) — làm tròn lên số chẵn thay vì đệm.
  const n = Math.max(2, 2 * Math.ceil(Math.round(rate * sec) / 2));
  const bytes = new Uint8Array(44 + n);
  const v = new DataView(bytes.buffer);
  writeAscii(v, 0, 'RIFF');
  v.setUint32(4, 36 + n, true);
  writeAscii(v, 8, 'WAVE');
  writeAscii(v, 12, 'fmt ');
  v.setUint32(16, 16, true); // cỡ khối fmt
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, rate, true);
  v.setUint32(28, rate, true); // byte rate = rate × 1 kênh × 1 byte
  v.setUint16(32, 1, true); // block align
  v.setUint16(34, 8, true); // 8 bit
  writeAscii(v, 36, 'data');
  v.setUint32(40, n, true);
  bytes.fill(0x80, 44);
  return `data:audio/wav;base64,${toBase64(bytes)}`;
}

function defaultNavigator(): SessionNavigator | null {
  return typeof navigator === 'undefined' ? null : (navigator as unknown as SessionNavigator);
}

function defaultCreateAudio(): HTMLAudioElement | null {
  if (typeof document === 'undefined') return null;
  try {
    return document.createElement('audio');
  } catch {
    return null;
  }
}

export class PlaybackSession {
  private api: AudioSessionLike | null = null;
  private el: HTMLAudioElement | null = null;
  private readonly nav: () => SessionNavigator | null | undefined;
  private readonly createAudio: () => HTMLAudioElement | null;

  constructor(env: PlaybackSessionEnv = {}) {
    this.nav = env.navigator ?? defaultNavigator;
    this.createAudio = env.createAudio ?? defaultCreateAudio;
  }

  /** Đang giữ phiên (API đã đặt 'playback' hoặc phần tử im lặng đang dùng). */
  get held(): boolean {
    return this.api !== null || this.el !== null;
  }

  /** Cách đang giữ (null = không giữ). */
  get mode(): PlaybackMode | null {
    if (this.api) return 'session-api';
    if (this.el) return 'media-element';
    return null;
  }

  /** Phần tử im lặng đang dùng (test / chẩn đoán). */
  get element(): HTMLAudioElement | null {
    return this.el;
  }

  /**
   * Gọi ĐỒNG BỘ trong user gesture, trước / cùng lúc `AudioContext.resume()`. Gọi lại được (đã giữ thì chỉ bảo đảm còn
   * hiệu lực: API vẫn 'playback', phần tử bị iOS tạm dừng — vd. sau cuộc gọi — thì phát lại). Trả cách đang dùng.
   */
  acquire(sampleRate?: number): PlaybackMode {
    let nav: SessionNavigator | null | undefined;
    try {
      nav = this.nav();
    } catch {
      nav = null;
    }
    const api = audioSessionOf(nav);
    if (api) {
      try {
        if (api.type !== 'playback') api.type = 'playback';
        this.api = api;
        return 'session-api';
      } catch {
        // API có mà không đặt được → thử phần tử im lặng như iOS cũ
      }
    }
    if (!isAppleTouch(nav)) return 'none';
    const cur = this.el;
    if (cur) {
      if (cur.paused) this.playElement(cur);
      return this.el ? 'media-element' : 'none';
    }
    let el: HTMLAudioElement | null;
    try {
      el = this.createAudio();
    } catch {
      el = null;
    }
    if (!el) return 'none';
    try {
      el.setAttribute('x-webkit-airplay', 'deny'); // không hiện trong AirPlay
      el.setAttribute('playsinline', '');
      el.setAttribute('aria-hidden', 'true');
      el.preload = 'auto';
      el.loop = true;
      el.muted = false; // muted thì iOS không đổi phiên
      try {
        el.volume = SILENT_ELEMENT_VOLUME;
      } catch {
        // iOS: volume chỉ đọc
      }
      el.src = silentWavDataUri(sampleRate);
    } catch {
      return 'none';
    }
    this.el = el;
    this.playElement(el);
    return this.el ? 'media-element' : 'none';
  }

  /** Trả phiên: API → 'auto', phần tử → dừng + bỏ nguồn. Gọi khi tắt hết tiếng / rời màn chơi. */
  release(): void {
    const api = this.api;
    this.api = null;
    if (api) {
      try {
        if (api.type === 'playback') api.type = 'auto';
      } catch {
        // bỏ qua
      }
    }
    this.dropElement(this.el);
  }

  private playElement(el: HTMLAudioElement): void {
    let p: Promise<void> | undefined;
    try {
      p = el.play();
    } catch {
      this.dropElement(el);
      return;
    }
    // Bị từ chối (không trong cú chạm…) → bỏ phần tử, cú chạm sau tạo lại.
    if (p && typeof p.catch === 'function') p.catch(() => this.dropElement(el));
  }

  private dropElement(el: HTMLAudioElement | null): void {
    if (!el) return;
    if (this.el === el) this.el = null;
    try {
      el.pause();
    } catch {
      // bỏ qua
    }
    try {
      el.removeAttribute('src');
      el.load();
    } catch {
      // bỏ qua
    }
  }
}

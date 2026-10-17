/**
 * AudioEngine: một AudioContext mỗi trang, tạo LƯỜI trong unlock() (gọi từ user gesture) hoặc
 * warm() (ngoài gesture, chỉ khi trang đã có user activation).
 * Graph: musicGain → master → destination; clickGain → master.
 * Bị chặn / không hỗ trợ thì unlock() trả false, app vẫn chạy visual.
 *
 * Phiên "playback" (iPhone: kêu cả khi gạt nút im lặng — playbackSession.ts, D-421): chỉ giữ khi nơi gọi xin
 * (`unlock({ playback: holder })` / `holdPlayback(holder)` trong cú chạm, lúc người dùng muốn nghe); trả khi holder
 * cuối `releasePlayback(holder)` (tắt hết tiếng / rời màn chơi) hoặc dispose(). Mặc định không đụng tới.
 */
import type { Timbre } from '../ui/settings';
import { PlaybackSession } from './playbackSession';
import { scheduleVoice } from './synth';
import type { Voice } from './synth';

/**
 * Chờ context chạy tối đa (ms) trước khi coi như bị chặn. iOS lần đầu có thể mất hơn 1 s (D-422); Play chỉ chờ
 * lâu vậy ở lần đầu — đã thất bại một lần thì hình chạy ngay, tiếng gắn vào khi mở khóa được.
 */
export const UNLOCK_TIMEOUT_MS = 3000;
/** Hằng thời gian setTargetAtTime khi đổi volume (giây). */
const VOLUME_TC = 0.02;
const MASTER_GAIN = 0.9;
/** Trễ nhỏ cho preview để envelope bắt đầu sạch. */
const PREVIEW_DELAY = 0.005;

type AudioContextCtor = new (options?: AudioContextOptions) => AudioContext;

function audioContextCtor(): AudioContextCtor | null {
  const g = globalThis as unknown as {
    AudioContext?: AudioContextCtor;
    webkitAudioContext?: AudioContextCtor;
  };
  return g.AudioContext ?? g.webkitAudioContext ?? null;
}

/**
 * Dựng sẵn bảng sóng của context vừa tạo (v1.0.1, khựng lúc nốt đầu khi có tiếng): Chromium tạo PeriodicWave sine /
 * sawtooth và hệ số bộ lọc LƯỜI ở lần đầu một node loại đó được tạo — đúng lúc scheduler lên lịch nốt giai điệu đầu,
 * ~0,13–0,15 s trước khi nốt đầu chạm vạch (đo: 4–8 ms mỗi loại ở CPU 4×; khung hở 39–51 ms ở lượt đầu có tiếng, tạo
 * sẵn thì không còn). Tạo trước bằng constructor (không start, không nối → không kêu, GC dọn); chỉ chạy khi đã cần
 * AudioContext (âm thanh tắt thì không bao giờ tới đây). Không có constructor (jsdom, trình duyệt cũ) → bỏ qua.
 */
function primeWaveTables(ctx: BaseAudioContext): void {
  const g = globalThis as unknown as {
    OscillatorNode?: typeof OscillatorNode;
    BiquadFilterNode?: typeof BiquadFilterNode;
  };
  const made: AudioNode[] = [];
  try {
    if (typeof g.OscillatorNode === 'function') {
      made.push(new g.OscillatorNode(ctx, { type: 'sine' }));
      made.push(new g.OscillatorNode(ctx, { type: 'sawtooth' }));
    }
    if (typeof g.BiquadFilterNode === 'function') {
      made.push(new g.BiquadFilterNode(ctx, { type: 'lowpass' }));
    }
  } catch {
    // không quan trọng — chỉ là làm nóng
  }
  made.length = 0;
}

/** Trình duyệt có Web Audio (AudioContext hoặc webkitAudioContext) không. */
export function isAudioSupported(): boolean {
  return audioContextCtor() !== null;
}

/**
 * Trang đã từng nhận user gesture (sticky activation, `navigator.userActivation.hasBeenActive`) —
 * khi đó trình duyệt cho AudioContext tạo ngoài gesture được phát tiếng. API không có → false.
 */
export function hasStickyActivation(): boolean {
  const nav = (globalThis as { navigator?: unknown }).navigator as
    { userActivation?: { hasBeenActive?: unknown } } | undefined;
  return nav?.userActivation?.hasBeenActive === true;
}

function clamp01(v: number): number {
  return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0;
}

/**
 * true khi `ctx` chạy ('running') trong `ms`: theo `statechange` (iOS có thể chuyển muộn hơn lúc resume() xong,
 * hoặc nhờ một resume() của cú chạm sau) hoặc khi `first` xong mà đã chạy. `first` bị từ chối → false ngay; quá hạn
 * → false; đóng → false. Không để lại timer / listener.
 */
function runningWithin(ctx: AudioContext, first: Promise<unknown>, ms: number): Promise<boolean> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (ok: boolean): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      ctx.removeEventListener('statechange', onState);
      resolve(ok);
    };
    const onState = (): void => {
      if (ctx.state === 'running') finish(true);
      else if (ctx.state === 'closed') finish(false);
    };
    const timer = setTimeout(() => finish(ctx.state === 'running'), ms);
    ctx.addEventListener('statechange', onState);
    first.then(
      () => {
        if (ctx.state === 'running') finish(true);
      },
      () => finish(ctx.state === 'running'),
    );
  });
}

/** Ai đang cần phiên "playback" (vd. một PlayerEngine) — so sánh theo identity. */
export type PlaybackHolder = object;

export interface UnlockOptions {
  /**
   * Giữ phiên "playback" cho `playback` (iPhone: kêu cả khi gạt im lặng) tới `releasePlayback(playback)`. Chỉ truyền
   * khi người dùng thật sự muốn nghe (giai điệu / click / tiếng phản hồi đang bật).
   */
  playback?: PlaybackHolder;
}

export interface AudioEngineOptions {
  /** Phiên "playback" (test truyền bản có navigator / `<audio>` giả). */
  session?: PlaybackSession;
}

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private music: GainNode | null = null;
  private click: GainNode | null = null;
  private musicVol = 0.8;
  private clickVol = 0.6;
  private timbreValue: Timbre = 'harmonica';
  private readonly previews = new Set<Voice>();
  private readonly stopListeners = new Set<() => void>();
  private readonly listeners = new Set<() => void>();
  private readonly onStateChange = (): void => this.emit();
  private readonly session: PlaybackSession;
  private readonly holders = new Set<PlaybackHolder>();

  constructor(options: AudioEngineOptions = {}) {
    this.session = options.session ?? new PlaybackSession();
  }

  /** AudioContext (null trước unlock() hoặc sau dispose()). */
  get context(): AudioContext | null {
    return this.ctx;
  }

  /** Context đang chạy (đã unlock thành công và chưa bị suspend). */
  get ready(): boolean {
    return this.ctx !== null && this.ctx.state === 'running';
  }

  get timbre(): Timbre {
    return this.timbreValue;
  }
  get musicVolume(): number {
    return this.musicVol;
  }
  get clickVolume(): number {
    return this.clickVol;
  }

  // --- Interface cho AudioScheduler (AudioOutput) ---
  getContext(): AudioContext | null {
    return this.ctx;
  }
  musicDestination(): AudioNode | null {
    return this.music;
  }
  clickDestination(): AudioNode | null {
    return this.click;
  }

  /** Đang giữ phiên "playback" cho ít nhất một holder. */
  get playbackHeld(): boolean {
    return this.holders.size > 0;
  }

  /**
   * Gọi trong handler của user gesture (click/keydown/touchend). Tạo context nếu cần (latencyHint
   * 'interactive') và resume — cả khi đang 'suspended' lẫn 'interrupted' (iOS: cuộc gọi, Siri, app khác). Có
   * `playback` → giữ phiên "playback" TRƯỚC resume(), cùng cú chạm. Mỗi lần gọi đều gọi resume() và có lượt chờ đầy
   * đủ của riêng nó: cú chạm trước có thể không được tính là gesture (vd. `pointerdown` của ngón tay) nên cú sau phải
   * được trọn UNLOCK_TIMEOUT_MS; context chạy thì mọi lượt đang chờ cùng xong (statechange). Không bao giờ throw; trả
   * false nếu không hỗ trợ / bị chặn / quá UNLOCK_TIMEOUT_MS.
   */
  unlock(options: UnlockOptions = {}): Promise<boolean> {
    const ctx = this.ensureContext();
    if (!ctx) return Promise.resolve(false);
    if (options.playback !== undefined) this.holdPlayback(options.playback);
    if (ctx.state === 'running') return Promise.resolve(true);
    let resumed: Promise<void>;
    try {
      // Gọi resume() đồng bộ trong gesture (Safari/iOS yêu cầu).
      resumed = ctx.resume();
    } catch {
      return Promise.resolve(false);
    }
    this.primeOutput(ctx);
    return runningWithin(ctx, resumed, UNLOCK_TIMEOUT_MS).then(
      (ok) => ok && this.ctx === ctx && ctx.state === 'running',
    );
  }

  /**
   * Giữ phiên "playback" cho `holder` — gọi ĐỒNG BỘ trong user gesture, khi người dùng muốn nghe. Gọi lại được: bảo
   * đảm phiên còn hiệu lực (vd. iOS dừng phần tử im lặng sau cuộc gọi). Không throw.
   */
  holdPlayback(holder: PlaybackHolder): void {
    this.holders.add(holder);
    try {
      this.session.acquire(this.ctx?.sampleRate);
    } catch {
      // không quan trọng: Web Audio vẫn chạy, chỉ theo nút gạt im lặng
    }
  }

  /** `holder` không cần nữa; holder cuối → trả phiên (`type = 'auto'`, dừng phần tử im lặng). */
  releasePlayback(holder: PlaybackHolder): void {
    if (!this.holders.delete(holder)) return;
    if (this.holders.size === 0) this.session.release();
  }

  /**
   * Tạo AudioContext sẵn, NGOÀI gesture, nếu trang đã có user activation (sticky). Chromium mở thiết
   * bị âm thanh đồng bộ trong constructor (0.5–1 s chặn main thread) và currentTime còn đứng thêm một
   * lúc — làm việc đó ngay khi vào Player thì lần Play đầu không bị khựng. Không resume/prime (Safari
   * vẫn cần unlock() trong gesture Play). Chưa có activation → không tạo gì. Không throw; trả true
   * nếu context đang chạy.
   */
  warm(): boolean {
    if (!hasStickyActivation()) return this.ready;
    const ctx = this.ensureContext();
    return ctx !== null && ctx.state === 'running';
  }

  setMusicVolume(v: number): void {
    this.musicVol = clamp01(v);
    this.rampGain(this.music, this.musicVol);
  }

  setClickVolume(v: number): void {
    this.clickVol = clamp01(v);
    this.rampGain(this.click, this.clickVol);
  }

  /** Timbre cho playPreview (scheduler đọc timbre từ options của nó). */
  setTimbre(timbre: Timbre): void {
    this.timbreValue = timbre === 'sine' ? 'sine' : 'harmonica';
  }

  /**
   * Phát một nốt ngay (phản hồi practice/MIDI). Đơn âm: nốt preview trước bị release nhanh.
   * Trả null nếu chưa unlock. Muốn giữ tới note-off: truyền duration dài rồi gọi voice.stop().
   */
  playPreview(midi: number, durationSec = 0.4): Voice | null {
    const ctx = this.ctx;
    const dest = this.music;
    if (!ctx || !dest || ctx.state === 'closed') return null;
    if (ctx.state !== 'running') {
      try {
        ctx.resume().catch(() => undefined);
      } catch {
        // bị chặn — nốt sẽ kêu khi context chạy lại
      }
    }
    this.stopPreviews();
    let voice: Voice | null = null;
    voice = scheduleVoice(ctx, dest, {
      midi,
      when: ctx.currentTime + PREVIEW_DELAY,
      duration: durationSec,
      timbre: this.timbreValue,
      onEnded: () => {
        if (voice) this.previews.delete(voice);
      },
    });
    this.previews.add(voice);
    return voice;
  }

  /** Dừng mọi âm đang kêu: preview + báo các scheduler đã đăng ký (addStopListener). */
  stopAll(): void {
    this.stopPreviews();
    for (const fn of Array.from(this.stopListeners)) {
      try {
        fn();
      } catch (err) {
        console.error(err);
      }
    }
  }

  /** Scheduler đăng ký để stopAll() dừng cả voice của nó. Trả hàm hủy. */
  addStopListener(fn: () => void): () => void {
    this.stopListeners.add(fn);
    return () => {
      this.stopListeners.delete(fn);
    };
  }

  /** Nghe thay đổi trạng thái (tạo context, running/suspended, dispose). Trả hàm hủy. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Đóng context, xóa singleton (getAudioEngine() lần sau tạo engine mới). */
  dispose(): void {
    this.stopAll();
    this.holders.clear();
    this.session.release();
    const ctx = this.ctx;
    this.teardown();
    if (ctx && ctx.state !== 'closed') {
      try {
        ctx.close().catch(() => undefined);
      } catch {
        // bỏ qua
      }
    }
    if (instance === this) instance = null;
    this.emit();
    this.listeners.clear();
    this.stopListeners.clear();
  }

  private ensureContext(): AudioContext | null {
    if (this.ctx && this.ctx.state !== 'closed') return this.ctx;
    if (this.ctx) this.teardown(); // bị đóng từ bên ngoài → tạo lại
    const Ctor = audioContextCtor();
    if (!Ctor) return null;
    let ctx: AudioContext;
    try {
      ctx = new Ctor({ latencyHint: 'interactive' });
    } catch {
      try {
        ctx = new Ctor(); // webkitAudioContext cũ không nhận options
      } catch {
        return null;
      }
    }
    try {
      const master = ctx.createGain();
      master.gain.value = MASTER_GAIN;
      master.connect(ctx.destination);
      const music = ctx.createGain();
      music.gain.value = this.musicVol;
      music.connect(master);
      const click = ctx.createGain();
      click.gain.value = this.clickVol;
      click.connect(master);
      this.master = master;
      this.music = music;
      this.click = click;
    } catch {
      ctx.close().catch(() => undefined);
      return null;
    }
    this.ctx = ctx;
    primeWaveTables(ctx);
    ctx.addEventListener('statechange', this.onStateChange);
    this.emit();
    return ctx;
  }

  /** Phát 1 mẫu im lặng trong gesture — mẹo mở khóa audio trên iOS. */
  private primeOutput(ctx: AudioContext): void {
    try {
      const src = ctx.createBufferSource();
      src.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
      src.connect(ctx.destination);
      src.onended = () => {
        src.onended = null;
        src.disconnect();
      };
      src.start(0);
    } catch {
      // không quan trọng
    }
  }

  private rampGain(node: GainNode | null, value: number): void {
    const ctx = this.ctx;
    if (!node || !ctx) return;
    try {
      node.gain.setTargetAtTime(value, ctx.currentTime, VOLUME_TC);
    } catch {
      node.gain.value = value;
    }
  }

  private stopPreviews(): void {
    for (const v of Array.from(this.previews)) v.stop();
    this.previews.clear();
  }

  private teardown(): void {
    const ctx = this.ctx;
    if (ctx) ctx.removeEventListener('statechange', this.onStateChange);
    for (const n of [this.music, this.click, this.master]) {
      try {
        n?.disconnect();
      } catch {
        // đã ngắt
      }
    }
    this.ctx = null;
    this.master = null;
    this.music = null;
    this.click = null;
    this.previews.clear();
  }

  private emit(): void {
    for (const fn of Array.from(this.listeners)) {
      try {
        fn();
      } catch (err) {
        console.error(err);
      }
    }
  }
}

let instance: AudioEngine | null = null;

/** Singleton lười (không tạo AudioContext — chỉ unlock() mới tạo). */
export function getAudioEngine(): AudioEngine {
  if (!instance) instance = new AudioEngine();
  return instance;
}

/**
 * Bộ máy gọn của overlay OBS (spec §7): Transport + TilesRenderer + vòng requestAnimationFrame.
 * KHÔNG có âm thanh — file này (và mọi thứ nó import) không đụng tới src/audio, không bao giờ tạo
 * AudioContext (OBS Browser Source không có user gesture; SPEC "Overlay luôn im lặng"). Clock luôn là
 * performance.now (test truyền ManualClock).
 *
 * Khác PlayerEngine (src/player/usePlayerEngine.ts): option lấy từ URL (`overlayParams.ts`) thay vì
 * settings — đếm vào chỉ bằng hình, loop = hết bài chạy lại từ đầu, đếm ngược `delay` trước mỗi lần
 * chạy do người dùng bấm / autoplay (không áp cho lần chạy lại tự động của loop).
 * Chế độ THEO Player chính (`applyFollow`, follow.ts): transport chép trạng thái của Player (phát / dừng
 * ở beat mong đợi, đếm vào, tempo, loop A-B, đếm ngược tới `countdownEndsAt`), lệch quá
 * FOLLOW_SNAP_BEATS mới nhảy (không giật); giữa hai tin thì tự chạy theo tempo.
 * Đếm ngược (của chính overlay, của trang mini qua `prepare`, hay của Player chính — tin `state` chưa phát
 * kèm `countIn` = ô nhịp đếm vào sắp chạy): canvas vẽ ĐÚNG frame đầu của đếm vào (`preRoll`, ô đứng yên)
 * → lúc bắt đầu chạy ô chỉ việc rơi, không nhảy lùi một ô nhịp (vòng R7, như PlayerEngine). Bước khung
 * đứng yên ↔ khung pre-roll / đếm vào trượt mượt (preRollGlide.ts, D-389) — overlay theo Player trượt y như
 * Player nên stream không thấy cú nhảy lúc streamer bấm Phát.
 * React nhận state rời rạc (nốt / run / dòng đổi, đếm ngược) qua `subscribe` / `getState`.
 */
import {
  lineIndexAt,
  nextLineStart,
  noteIndexAt,
  prevLineStart,
  runIndexAt,
} from '../core/timelineQuery';
import type { Timeline } from '../core/types';
import { createPerformanceClock } from '../player/clock';
import { warmDomEffects, warmTileGlow } from '../player/glowWarmup';
import { leadInBeats, playStartBeat } from '../player/leadIn';
import { MobileEntryTracker, mobilePlanFor, mobileUiAt } from '../player/mobilePlan';
import type { MobileUiState } from '../player/mobilePlan';
import { PreRollGlide } from '../player/preRollGlide';
import type { DrawMode } from '../player/preRollGlide';
import { TilesRenderer } from '../player/renderer';
import type { RendererOptions } from '../player/renderer';
import { Transport, wrapEndOf } from '../player/transport';
import type { BeatRange, Clock } from '../player/transport.types';
import type { ControlScheme, MobileSemitone } from '../ui/settings';
import type { FollowStateMessage } from './follow';
import { FOLLOW_SNAP_BEATS, countdownLeftAt, expectedBeatAt, followNow } from './follow';

/** ← trong khoảng này (giây) sau đầu dòng thì về dòng trước (như Player, D-027). */
const PREV_LINE_GRACE_SEC = 0.6;
/** Số frame đứng yên đầu tiên (mỗi lần attach) vẽ kèm hình làm nóng glow (player/glowWarmup.ts). */
const OVERLAY_GLOW_WARMUP_FRAMES = 6;
/** Theo Player: nhảy xa hơn chừng này beat = nhảy thật (chạy lại, tua, đổi dòng) → cue vào lại Mobile. */
const FOLLOW_JUMP_BEATS = 0.5;

/** Phần tin `state` mà engine cần để theo Player. */
export type FollowTransportState = Pick<
  FollowStateMessage,
  'playing' | 'beat' | 'bpm' | 'sentAt' | 'loop' | 'countdownEndsAt' | 'countIn'
>;

export interface OverlayEngineOptions {
  /** Tempo dùng cho cả phiên (bpm của bài hoặc `?bpm=`). */
  bpm: number;
  /** Đếm vào (chỉ bằng hình, độ dài theo src/player/leadIn.ts) trước mỗi lần chạy. */
  countIn: boolean;
  /** Hết bài → chạy lại từ đầu. */
  loop: boolean;
  /** Đếm ngược (giây) trước lần chạy do người dùng / autoplay. */
  delaySec: number;
  scheme: ControlScheme;
  mobileSemitone: MobileSemitone;
  /** Mặc định performance.now — test truyền ManualClock. */
  clock?: Clock;
  /** Đồng hồ chung với Player (epoch ms) cho đếm ngược khi theo Player. Mặc định followNow. */
  now?: () => number;
}

export interface OverlayUiState {
  /** Đang chạy, hoặc đang đếm ngược trước khi chạy. */
  playing: boolean;
  /** Số giây đếm ngược còn lại; null = không đếm. */
  countdown: number | null;
  /** Đã từng bấm chạy / autoplay (ẩn gợi ý "bấm để chạy"). */
  started: boolean;
  /** Dừng ở cuối bài (không loop). */
  ended: boolean;
  countingIn: boolean;
  /** Nốt ở hit line (-1 nếu không có); lúc đếm vào là nốt tại điểm bắt đầu. */
  noteIndex: number;
  runIndex: number;
  lineIndex: number;
  /** Scheme Mobile: chế độ tại hit line + lần chạm kế; null ở PC. */
  mobile: MobileUiState | null;
  /** Số lần bài đã tự chạy lại (loop). */
  loops: number;
}

export interface OverlayAttachTargets {
  canvas: HTMLCanvasElement | null;
  /** Nhận CSS var --lane-left / --lane-right (game bar căn theo lane). */
  stage?: HTMLElement | null;
  renderer?: Partial<RendererOptions>;
}

export class OverlayEngine {
  readonly transport: Transport;
  private tl: Timeline;
  private readonly opts: OverlayEngineOptions;
  private mobileSemitone: MobileSemitone;
  private state: OverlayUiState;
  private readonly listeners = new Set<() => void>();
  private attached = false;
  private unsubTransport: (() => void) | null = null;

  private renderer: TilesRenderer | null = null;
  private canvas: HTMLCanvasElement | null = null;
  /** Số frame đứng yên đã vẽ kèm hình làm nóng glow (player/glowWarmup.ts) từ lần attach. */
  private glowWarmups = 0;
  private rendererOpts: Partial<RendererOptions> = {};
  private stage: HTMLElement | null = null;
  /** Gỡ keycap / banner làm nóng (glowWarmup.ts) nếu còn. */
  private cancelDomWarm: (() => void) | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private windowResize: (() => void) | null = null;
  private laneLeft = Number.NaN;
  private laneRight = Number.NaN;

  private rafId: number | null = null;
  private rafIsTimeout = false;

  private countdownTimer: ReturnType<typeof setTimeout> | null = null;
  private countdownLeft = 0;
  /** Beat bắt đầu khi hết đếm ngược (undefined = vị trí hiện tại). */
  private countdownFrom: number | undefined = undefined;
  private started = false;
  private loops = 0;
  /** Đang theo Player chính (applyFollow đã gọi): bỏ loop cả bài + đếm ngược riêng của overlay. */
  private following = false;
  /** Đếm ngược của Player (giây còn lại) khi theo Player; null = không đếm. */
  private followCountdownLeft: number | null = null;
  private followCountdownEndsAt: number | null = null;
  private followCountdownTimer: ReturnType<typeof setTimeout> | null = null;
  /** Theo Player: Player đang chờ phát (đếm ngược) — ô nhịp đếm vào sắp chạy theo tin `state`. */
  private followPreRoll: BeatRange | null = null;
  /**
   * Bộ điều khiển ngoài (trang mini) đang đếm ngược trước khi gọi play / restart: điểm sẽ bắt đầu
   * (undefined = vị trí hiện tại); null = không chờ.
   */
  private prepared: { from: number | undefined } | null = null;
  /** Object `preRoll` trả lần trước (giữ identity khi giá trị không đổi). */
  private preRollCache: BeatRange | null = null;
  /** Trượt mượt vào / ra khung pre-roll (preRollGlide.ts, D-389). */
  private readonly glide = new PreRollGlide();
  private mobilePlanSeen: object | null = null;
  /** Chế độ mobile người chơi đang giữ qua các lần chạy / loop / đổi dòng → cue vào lại. */
  private readonly mobileTrack = new MobileEntryTracker();

  constructor(timeline: Timeline, opts: OverlayEngineOptions) {
    this.tl = timeline;
    this.opts = { ...opts, delaySec: Math.max(0, Math.round(opts.delaySec)) };
    this.mobileSemitone = opts.mobileSemitone;
    this.transport = new Transport({
      clock: opts.clock ?? createPerformanceClock(),
      bpm: opts.bpm,
      endBeat: Math.max(0, timeline.totalBeats),
    });
    this.state = {
      playing: false,
      countdown: null,
      started: false,
      ended: false,
      countingIn: false,
      noteIndex: -1,
      runIndex: -1,
      lineIndex: -1,
      mobile: null,
      loops: 0,
    };
    this.sync();
  }

  // -------------------------------------------------------------------------
  // React bridge
  // -------------------------------------------------------------------------

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  readonly getState = (): OverlayUiState => this.state;

  get timeline(): Timeline {
    return this.tl;
  }

  get isAttached(): boolean {
    return this.attached;
  }

  /** Renderer đang gắn (null khi chưa attach) — để test / UI đọc layout. */
  get tilesRenderer(): TilesRenderer | null {
    return this.renderer;
  }

  // -------------------------------------------------------------------------
  // Vòng đời
  // -------------------------------------------------------------------------

  attach(targets: OverlayAttachTargets): void {
    if (this.attached) this.detach();
    this.attached = true;
    this.stage = targets.stage ?? null;
    if (targets.renderer) this.rendererOpts = { ...targets.renderer };
    const canvas = targets.canvas;
    if (canvas) {
      const r = new TilesRenderer(canvas, this.rendererOpts);
      this.canvas = canvas;
      this.glowWarmups = 0;
      this.glide.reset();
      r.setTimeline(this.tl);
      this.renderer = r;
      this.observeResize(canvas);
      r.resize();
      this.updateLaneVars();
    }
    this.unsubTransport = this.transport.subscribe(this.onTransportChange);
    this.sync();
    this.drawFrame();
    // Keycap sáng của game bar PC (filter + hiệu ứng nhấn) và banner "ĐANG GIỮ …": làm nóng lúc còn đứng yên để lần
    // đầu chúng hiện (nốt đầu chạm vạch, hold đầu) không khựng — như PlayerEngine (glowWarmup.ts, v1.0.1).
    if (this.stage) {
      this.cancelDomWarm = warmDomEffects(
        this.stage,
        (fn, ms) => setTimeout(fn, ms),
        (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
      );
    }
  }

  detach(): void {
    if (!this.attached) return;
    this.attached = false;
    this.cancelDomWarm?.();
    this.cancelDomWarm = null;
    this.clearCountdown();
    this.clearFollowCountdown();
    this.cancelFrame();
    this.unsubTransport?.();
    this.unsubTransport = null;
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    if (this.windowResize) {
      window.removeEventListener('resize', this.windowResize);
      this.windowResize = null;
    }
    if (this.transport.playing) this.transport.pause();
    this.renderer?.dispose();
    this.renderer = null;
    this.canvas = null;
    this.stage = null;
    this.laneLeft = Number.NaN;
    this.laneRight = Number.NaN;
    this.sync();
  }

  /** Bài / settings (baseOctave) đổi → timeline mới, giữ vị trí. */
  setTimeline(tl: Timeline): void {
    if (tl === this.tl) return;
    this.tl = tl;
    this.renderer?.setTimeline(tl);
    this.transport.setEndBeat(Math.max(0, tl.totalBeats));
    this.sync();
    this.requestFrame();
  }

  /** Option canvas đổi (theme, ngôn ngữ, tên nút… từ settings của trình duyệt OBS). */
  setRendererOptions(patch: Partial<RendererOptions>): void {
    this.rendererOpts = { ...this.rendererOpts, ...patch };
    this.renderer?.setOptions(patch);
    // setOptions tính lại layout ngay (tileScale đổi gutter ribbon…) → keycap game bar / banner theo lane mới.
    // Không chờ ResizeObserver: trang mini đổi tileScale SAU khi observer của engine đã chạy.
    this.updateLaneVars();
    if (typeof patch.mobileSemitone === 'string') this.mobileSemitone = patch.mobileSemitone;
    this.sync();
    this.requestFrame();
  }

  /** Kiểu điều khiển / cách Nửa Cung đổi (theo Player chính) — banner, game bar, cue Mobile theo ngay. */
  setScheme(scheme: ControlScheme, mobileSemitone: MobileSemitone): void {
    if (scheme === this.opts.scheme && mobileSemitone === this.mobileSemitone) return;
    this.opts.scheme = scheme;
    this.mobileSemitone = mobileSemitone;
    this.renderer?.setOptions({ scheme, mobileSemitone });
    this.sync();
    this.requestFrame();
  }

  /** Đang theo Player chính (đã nhận trạng thái ít nhất một lần). */
  get isFollowing(): boolean {
    return this.following;
  }

  // -------------------------------------------------------------------------
  // Theo Player chính (follow.ts)
  // -------------------------------------------------------------------------

  /**
   * Chép trạng thái của Player tại `nowMs` (epoch ms, cùng đồng hồ với `sentAt`): tempo, loop A-B, đếm
   * ngược, rồi phát / dừng ở beat mong đợi (`expectedBeatAt`). Đang phát mà lệch ≤ FOLLOW_SNAP_BEATS thì
   * để yên (không giật mỗi heartbeat); lệch hơn → nhảy thẳng tới đó.
   */
  applyFollow(s: FollowTransportState, nowMs: number = this.now()): void {
    this.following = true;
    this.started = true;
    this.clearCountdown();
    this.prepared = null;
    const tr = this.transport;
    if (tr.bpm !== s.bpm) tr.setBpm(s.bpm);
    this.applyFollowLoop(s.loop);
    this.setFollowCountdown(s.countdownEndsAt, nowMs);
    // Player chưa phát mà gửi `countIn` = đang chờ phát (đếm ngược): vẽ frame đầu của đếm vào như Player.
    const pre =
      !s.playing && s.countIn && s.countIn.endBeat > s.countIn.startBeat ? s.countIn : null;
    this.followPreRoll = pre ? this.rangeOf(pre.startBeat, pre.endBeat) : null;

    const end = Math.max(0, this.tl.totalBeats);
    const target = expectedBeatAt(s, nowMs);
    const ci = s.playing && s.countIn && target < s.countIn.endBeat ? s.countIn : null;
    const from = this.positionBeat();
    if (!s.playing || !this.hasNotes() || (ci === null && target >= end)) {
      // Dừng (kể cả đã hết bài): đứng đúng beat của Player.
      const b = Math.min(Math.max(0, target), end);
      const needSeek = Math.abs(tr.getBeat() - b) > 1e-6;
      if (!tr.playing && !needSeek) {
        this.sync();
        this.requestFrame();
        return;
      }
      this.followMove(from, b, () => {
        if (tr.playing) tr.pause();
        if (needSeek || Math.abs(tr.getBeat() - b) > 1e-6) tr.seek(b);
      });
      this.sync();
      this.requestFrame();
      return;
    }
    const cur = tr.getBeat();
    const curCi = tr.countIn;
    const sameCountIn =
      ci === null
        ? curCi === null || cur >= curCi.end
        : curCi !== null && Math.abs(curCi.end - ci.endBeat) < 1e-6;
    if (tr.playing && sameCountIn && Math.abs(cur - target) <= FOLLOW_SNAP_BEATS) {
      this.sync();
      this.requestFrame();
      return;
    }
    const at = ci ? ci.endBeat : Math.max(0, target);
    // `sentAt` ở tương lai = đoạn phát của Player chưa chạy (chờ output latency của audio): chờ đúng chừng đó
    // rồi mới chạy — chạy trước sẽ bị kéo lùi ở tin kế (giật). Kẹp 1 s phòng đồng hồ lệch.
    const wait = Math.min(1, Math.max(0, (s.sentAt - nowMs) / 1000));
    this.followMove(from, at, () =>
      ci
        ? tr.play({ fromBeat: ci.endBeat, countInBeats: ci.endBeat - target, startDelaySec: wait })
        : tr.play({ fromBeat: Math.max(0, target), startDelaySec: wait }),
    );
    this.sync();
    this.requestFrame();
  }

  /** Mất Player chính (đóng tab / im lặng): dừng tại chỗ, bỏ đếm ngược, chờ. */
  followPause(): void {
    this.clearFollowCountdown();
    this.followCountdownEndsAt = null;
    this.followPreRoll = null;
    if (this.transport.playing) this.pause();
    this.sync();
    this.requestFrame();
  }

  private now(): number {
    return this.opts.now ? this.opts.now() : followNow();
  }

  /** Nhảy theo Player; nhảy xa (chạy lại / tua / đổi dòng) mới ghi nhận cho cue vào lại Mobile. */
  private followMove(from: number, to: number, fn: () => void): void {
    if (Math.abs(to - from) > FOLLOW_JUMP_BEATS) this.move(fn);
    else fn();
  }

  private applyFollowLoop(loop: FollowTransportState['loop']): void {
    let range: BeatRange | null = null;
    if (loop && loop.endBeat > Math.max(0, loop.startBeat)) {
      range = { start: Math.max(0, loop.startBeat), end: loop.endBeat };
    }
    try {
      this.transport.setLoop(range);
    } catch {
      this.transport.setLoop(null);
    }
  }

  private setFollowCountdown(endsAt: number | null, nowMs: number): void {
    this.clearFollowCountdown();
    this.followCountdownEndsAt = endsAt;
    this.followCountdownLeft = countdownLeftAt(endsAt, nowMs);
    if (this.followCountdownLeft === null || endsAt === null || !this.attached) return;
    // Hẹn đúng lúc con số đổi (ranh giới giây tính từ endsAt).
    const msToNext = endsAt - nowMs - (this.followCountdownLeft - 1) * 1000;
    this.followCountdownTimer = setTimeout(this.onFollowCountdownTick, Math.max(10, msToNext));
  }

  private readonly onFollowCountdownTick = (): void => {
    this.followCountdownTimer = null;
    if (!this.attached) return;
    this.setFollowCountdown(this.followCountdownEndsAt, this.now());
    this.sync();
  };

  private clearFollowCountdown(): void {
    if (this.followCountdownTimer !== null) clearTimeout(this.followCountdownTimer);
    this.followCountdownTimer = null;
    this.followCountdownLeft = null;
  }

  // -------------------------------------------------------------------------
  // Điều khiển (Space / R / ← / →, click, autoplay, `dfht:command`)
  // -------------------------------------------------------------------------

  /** Chạy (tiếp) — có `delay` thì đếm ngược trước. Đang chạy / đang đếm ngược thì bỏ qua. */
  play(): void {
    if (!this.hasNotes()) return;
    if (this.countdownTimer !== null || this.transport.playing) return;
    this.started = true;
    if (this.opts.delaySec > 0) {
      this.beginCountdown(undefined);
      return;
    }
    this.startNow(undefined);
  }

  /** Dừng (giữa lúc đếm vào → về điểm bắt đầu); đang đếm ngược → hủy đếm ngược. */
  pause(): void {
    this.cancelPrepared();
    if (this.countdownTimer !== null) {
      this.clearCountdown();
      this.sync();
      this.requestFrame(); // bỏ frame đầu đếm vào
      return;
    }
    const tr = this.transport;
    if (!tr.playing) return;
    const ci = tr.countIn;
    const target = ci !== null && tr.getBeat() < ci.end ? ci.end : null;
    this.move(() => {
      tr.pause();
      if (target !== null) tr.seek(target);
    });
  }

  toggle(): void {
    if (this.countdownTimer !== null || this.transport.playing) this.pause();
    else this.play();
  }

  /** Chạy lại từ đầu bài (kể cả khi đang chạy); có `delay` thì đếm ngược trước. */
  restart(): void {
    if (!this.hasNotes()) return;
    this.clearCountdown();
    this.started = true;
    if (this.opts.delaySec > 0) {
      this.move(() => {
        if (this.transport.playing) this.transport.pause();
        this.transport.seek(0);
      });
      this.beginCountdown(0);
      return;
    }
    this.startNow(0);
  }

  /**
   * Bộ điều khiển ngoài (MiniController của trang mini) bắt đầu / hủy đếm ngược riêng của nó trước khi gọi
   * `play()` / `restart()`: trong lúc đó canvas vẽ frame đầu của đếm vào sắp chạy (ô đứng yên) — hết đếm
   * ngược ô chỉ việc rơi. 'play' = từ vị trí hiện tại, 'restart' = từ đầu bài, null = hủy.
   */
  prepare(action: 'play' | 'restart' | null): void {
    if (action === null) {
      this.cancelPrepared();
      return;
    }
    if (this.transport.playing) return;
    this.prepared = { from: action === 'restart' ? 0 : undefined };
    this.requestFrame();
  }

  /**
   * Ô nhịp đếm vào của lần chạy đang chờ bắt đầu (đếm ngược của overlay / của trang mini / của Player chính
   * khi đang theo): canvas vẽ frame đầu của nó (beat = `start`). null = không chờ hoặc không đếm vào.
   */
  get preRoll(): BeatRange | null {
    const tr = this.transport;
    if (tr.playing) return null;
    if (this.following) return this.followPreRoll;
    if (this.countdownTimer === null && this.prepared === null) return null;
    // Cùng chuẩn hóa điểm bắt đầu như Transport.play: beat âm → 0, đứng ở cuối bài → 0.
    const from = playStartBeat(
      this.countdownTimer !== null ? this.countdownFrom : this.prepared?.from,
      tr.getBeat(),
      tr.endBeat,
    );
    const n = this.countInBeats(from);
    if (!(n > 0)) return null;
    return this.rangeOf(from - n, from);
  }

  prevLine(): void {
    const grace = Math.max(0.5, (PREV_LINE_GRACE_SEC * this.transport.bpm) / 60);
    this.seek(prevLineStart(this.tl, this.positionBeat(), grace));
  }

  nextLine(): void {
    const at = this.positionBeat();
    const next = nextLineStart(this.tl, at);
    if (next >= this.tl.totalBeats || next <= at) return;
    this.seek(next);
  }

  /** Vẽ ngay một frame (sau khi đổi kích thước…); vòng rAF tự chạy khi đang phát. */
  renderNow(): void {
    if (this.attached) this.drawFrame();
  }

  // -------------------------------------------------------------------------
  // Nội bộ
  // -------------------------------------------------------------------------

  private hasNotes(): boolean {
    return this.tl.notes.length > 0 && this.tl.totalBeats > 0;
  }

  /** Vị trí phát: lúc đếm vào là điểm định bắt đầu (không phải beat âm). */
  private positionBeat(): number {
    const tr = this.transport;
    const ci = tr.countIn;
    const raw = tr.getBeat();
    return tr.playing && ci !== null && raw < ci.end ? ci.end : Math.max(0, raw);
  }

  private seek(beat: number): void {
    if (!Number.isFinite(beat)) return;
    const b = Math.min(Math.max(0, beat), Math.max(0, this.tl.totalBeats));
    this.move(() => this.transport.seek(b));
  }

  private startNow(fromBeat: number | undefined): void {
    this.started = true;
    this.prepared = null;
    const tr = this.transport;
    const countInBeats = this.countInBeats(playStartBeat(fromBeat, tr.getBeat(), tr.endBeat));
    // Hết bài rồi chạy (loop, bấm chạy lại) → transport về 0: nhảy.
    this.move(() => tr.play({ fromBeat, countInBeats }));
  }

  /**
   * Số beat đếm vào trước lần chạy từ `from` (chỉ bằng hình) — như màn chơi: quãng dẫn vào của nốt đầu rút còn
   * 65 % (src/player/leadIn.ts, v1.0.1).
   */
  private countInBeats(from: number): number {
    return this.opts.countIn ? leadInBeats(this.tl, from, Math.max(0, this.tl.beatsPerBar)) : 0;
  }

  /** BeatRange đông cứng, giữ identity khi giá trị không đổi (renderer / React so tham chiếu). */
  private rangeOf(start: number, end: number): BeatRange {
    const cur = this.preRollCache;
    if (cur !== null && cur.start === start && cur.end === end) return cur;
    this.preRollCache = Object.freeze({ start, end });
    return this.preRollCache;
  }

  private cancelPrepared(): void {
    if (this.prepared === null) return;
    this.prepared = null;
    this.requestFrame();
  }

  /**
   * Đổi transport; nếu vị trí nhảy (chạy lại, hết bài → chạy lại / loop, đổi dòng) thì ghi nhận cho
   * cue vào lại của Mobile — chế độ người chơi đang giữ có thể khác chế độ nốt đầu lượt mới.
   */
  private move(fn: () => void): void {
    const tr = this.transport;
    const from = this.positionBeat();
    const epoch = tr.epoch;
    fn();
    if (tr.epoch === epoch) return;
    const plan = mobilePlanFor(this.tl, this.mobileSemitone);
    if (this.mobileTrack.move(plan, this.tl, from, tr.segmentStart) && this.attached) {
      this.sync();
      this.requestFrame();
    }
  }

  private beginCountdown(fromBeat: number | undefined): void {
    this.clearCountdown();
    this.countdownLeft = this.opts.delaySec;
    this.countdownFrom = fromBeat;
    this.countdownTimer = setTimeout(this.onCountdownTick, 1000);
    this.sync();
    // Ô đứng yên ở frame đầu của đếm vào suốt lúc đếm ngược (preRoll).
    this.requestFrame();
  }

  private readonly onCountdownTick = (): void => {
    this.countdownTimer = null;
    if (!this.attached) return;
    this.countdownLeft--;
    if (this.countdownLeft > 0) {
      this.countdownTimer = setTimeout(this.onCountdownTick, 1000);
      this.sync();
      return;
    }
    const from = this.countdownFrom;
    this.countdownFrom = undefined;
    this.startNow(from);
    this.sync();
  };

  private clearCountdown(): void {
    if (this.countdownTimer !== null) clearTimeout(this.countdownTimer);
    this.countdownTimer = null;
    this.countdownLeft = 0;
    this.countdownFrom = undefined;
  }

  private readonly onTransportChange = (): void => {
    if (!this.attached) return;
    this.sync();
    this.requestFrame();
  };

  private requestFrame(): void {
    if (!this.attached || this.rafId !== null) return;
    if (typeof requestAnimationFrame === 'function') {
      this.rafIsTimeout = false;
      this.rafId = requestAnimationFrame(this.onFrame);
    } else {
      this.rafIsTimeout = true;
      this.rafId = window.setTimeout(this.onFrame, 16);
    }
  }

  private cancelFrame(): void {
    if (this.rafId === null) return;
    if (this.rafIsTimeout) window.clearTimeout(this.rafId);
    else if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(this.rafId);
    this.rafId = null;
  }

  private readonly onFrame = (): void => {
    this.rafId = null;
    if (!this.attached) return;
    this.drawFrame();
    if (this.transport.playing || this.glide.active) this.requestFrame();
  };

  /** Một frame: áp hết bài (+ loop), vẽ canvas, đẩy state rời rạc lên React. */
  private drawFrame(): void {
    const tr = this.transport;
    const r = tr.update();
    if (r.ended && this.opts.loop && !this.following && this.hasNotes()) {
      this.loops++;
      this.startNow(0);
    }
    // Đang chờ chạy (đếm ngược): frame đầu của đếm vào sắp chạy (ô đứng yên tại đó).
    const pre = this.preRoll;
    const target = pre ? pre.start : tr.getBeat();
    const live = tr.countIn;
    const ci = pre ?? (tr.playing && live !== null && target < live.end ? live : null);
    // Khung đứng yên ↔ pre-roll / đếm vào: trượt mượt thay vì nhảy một ô nhịp (như PlayerEngine).
    const mode: DrawMode = pre ? 'pre' : ci ? 'countIn' : tr.playing ? 'play' : 'idle';
    const beat = this.glide.beatFor(target, mode, ci ? ci.end - ci.start : 0, tr.clock.now());
    // Loop A-B (chỉ khi theo Player) vẽ "vòng kế" như Player — khi transport thật sự sẽ wrap.
    const loop = this.wrappingLoop();
    const plan = this.opts.scheme === 'mobile' ? mobilePlanFor(this.tl, this.mobileSemitone) : null;
    this.renderer?.render({
      beat,
      countInRemaining: ci ? ci.end - beat : null,
      countIn: ci,
      loop,
      mobileEntry: plan ? this.mobileTrack.entry(plan, this.tl) : null,
      mobileLoopEntry: plan && loop ? this.mobileTrack.loopEntry(plan, this.tl, loop) : null,
    });
    // Vị trí đang vẽ (beat) trên khung overlay: e2e đo độ lệch so với Player chính (không CSS nào đọc
    // thuộc tính này → không tốn style recalc).
    if (this.stage) this.stage.dataset.beat = beat.toFixed(3);
    // Ô đứng yên: vẽ kèm hình làm nóng glow → lần đầu tile sáng ở hit line không khựng (như PlayerEngine).
    if (
      !tr.playing &&
      this.glowWarmups < OVERLAY_GLOW_WARMUP_FRAMES &&
      this.canvas &&
      this.renderer
    ) {
      if (warmTileGlow(this.canvas, this.renderer.layout)) this.glowWarmups++;
    }
    this.sync();
  }

  /** Loop A-B mà transport sẽ wrap (cùng điều kiện `wrapEndOf` như Player); null nếu không. */
  private wrappingLoop(): BeatRange | null {
    const tr = this.transport;
    return wrapEndOf({ loop: tr.loop, endBeat: tr.endBeat, segmentStart: tr.segmentStart }) !== null
      ? tr.loop
      : null;
  }

  private observeResize(canvas: HTMLCanvasElement): void {
    const onResize = (): void => {
      if (!this.attached || !this.renderer) return;
      this.renderer.resize();
      this.updateLaneVars();
      this.drawFrame();
    };
    if (typeof ResizeObserver === 'function') {
      this.resizeObserver = new ResizeObserver(onResize);
      this.resizeObserver.observe(canvas);
    } else {
      this.windowResize = onResize;
      window.addEventListener('resize', onResize);
    }
  }

  /** --lane-left / --lane-right theo layout dọc để keycap game bar thẳng hàng lane. */
  private updateLaneVars(): void {
    const st = this.stage;
    const L = this.renderer?.layout;
    if (!st || !L || L.orientation !== 'vertical') return;
    const left = Math.round(L.laneArea.x);
    const right = Math.max(0, Math.round(L.width - L.laneArea.x - L.laneArea.w));
    if (left === this.laneLeft && right === this.laneRight) return;
    this.laneLeft = left;
    this.laneRight = right;
    st.style.setProperty('--lane-left', `${left}px`);
    st.style.setProperty('--lane-right', `${right}px`);
  }

  /** State UI từ transport; chỉ tạo object mới + notify khi có giá trị đổi. */
  private sync(): void {
    const tr = this.transport;
    const tl = this.tl;
    const raw = tr.getBeat();
    const ci = tr.countIn;
    const countingIn = tr.playing && ci !== null && raw < ci.end;
    const at = countingIn && ci !== null ? ci.end : raw;
    const noteIndex = noteIndexAt(tl, at);
    const runIndex = runIndexAt(tl, at);
    const lineIndex = lineIndexAt(tl, at);
    const countdown = this.countdownTimer !== null ? this.countdownLeft : this.followCountdownLeft;
    const playing = tr.playing || countdown !== null;
    const ended = !playing && this.hasNotes() && raw >= tl.totalBeats - 1e-9;
    const prev = this.state;
    const mobile = this.mobileAt(at, prev.mobile);
    const started = this.started;
    const loops = this.loops;
    if (
      prev.playing === playing &&
      prev.countdown === countdown &&
      prev.started === started &&
      prev.ended === ended &&
      prev.countingIn === countingIn &&
      prev.noteIndex === noteIndex &&
      prev.runIndex === runIndex &&
      prev.lineIndex === lineIndex &&
      prev.mobile === mobile &&
      prev.loops === loops
    ) {
      return;
    }
    this.state = {
      playing,
      countdown,
      started,
      ended,
      countingIn,
      noteIndex,
      runIndex,
      lineIndex,
      mobile,
      loops,
    };
    for (const l of Array.from(this.listeners)) l();
  }

  private mobileAt(at: number, prev: MobileUiState | null): MobileUiState | null {
    if (this.opts.scheme !== 'mobile') return null;
    const plan = mobilePlanFor(this.tl, this.mobileSemitone);
    const reuse = prev !== null && this.mobilePlanSeen === plan ? prev : null;
    this.mobilePlanSeen = plan;
    const loop = this.wrappingLoop();
    return mobileUiAt(plan, at, reuse, {
      entry: this.mobileTrack.entry(plan, this.tl),
      loop: loop ? { ...loop, entry: this.mobileTrack.loopEntry(plan, this.tl, loop) } : null,
    });
  }
}

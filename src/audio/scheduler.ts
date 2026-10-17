/**
 * Lookahead scheduler (spec mục 5): tick 25 ms, lên lịch trước 100 ms trên trục AudioContext.
 * planEvents() thuần (test được); AudioScheduler giữ con trỏ beat + các voice đang sống.
 *
 * Thời gian lấy thẳng từ snapshot của transport → node.start(time) trực tiếp. Audio clock đọc
 * thời điểm NGHE THẤY (= ctx.currentTime - output latency L), nên:
 * - Đoạn phát mới (play/seek/đổi clock) neo ở tương lai (`Clock.lead` = L + 25 ms) → sự kiện đầu
 *   được start() đúng giờ thay vì bị kẹp trễ L.
 * - Transport chỉ wrap loop khi đã NGHE tới loop end (ctx đã đi quá đó L giây) → scheduler lên lịch
 *   TRƯỚC vòng sau theo snapshot dự đoán, và khi transport wrap đúng như vậy thì giữ nguyên voice.
 * - Đổi bpm (cùng epoch) không phải gián đoạn: giữ nốt đang ngân, chỉ lên lịch lại phần chưa phát.
 */
import type { Timeline, TimelineNote } from '../core/types';
import { wrapEndOf } from '../player/transport';
import type { TransportSnapshot } from '../player/transport.types';
import type { Timbre } from '../ui/settings';
import { scheduleClick } from './metronome';
import { scheduleVoice } from './synth';
import type { Voice } from './synth';

export const TICK_MS = 25;
/** Lên lịch trước bao xa (giây). */
export const SCHEDULE_AHEAD_SEC = 0.1;
/** Sự kiện trễ hơn mức này thì bỏ (ngắn hơn thì phát ngay). */
export const MAX_LATENESS_SEC = 0.2;
/** Nốt không luyến được rút ngắn chút cho rõ tiếng (articulation). */
export const ARTICULATION = 0.92;
/**
 * Fade khi cắt voice mà phần đầu chưa kịp nghe (đã render nhưng còn nằm trong output latency) lúc
 * pause/seek: cắt thật nhanh để "blip" của nốt sắp tới ngắn nhất có thể.
 */
export const ONSET_CUT_SEC = 0.003;
/** Nốt bị phát trễ không ngắn hơn mức này. */
const MIN_LATE_DURATION = 0.03;
const EPS = 1e-9;
/** Sai số cho phép khi so anchor wrap của transport với vòng loop scheduler đã dự đoán (giây). */
const WRAP_MATCH_SEC = 1e-6;

export interface NoteEvent {
  type: 'note';
  noteIndex: number;
  midi: number;
  /** startBeat của nốt. */
  beat: number;
  /** Thời điểm (trục clock của snapshot). */
  time: number;
  /** Độ dài giữ nốt (giây), chưa gồm release. */
  duration: number;
}

export interface ClickEvent {
  type: 'click';
  beat: number;
  time: number;
  accent: boolean;
}

export type PlannedEvent = NoteEvent | ClickEvent;

export interface PlanOptions {
  /** Click suốt bài (trong [0, endBeat)). */
  metronome: boolean;
  /**
   * Có tiếng click không (settings.clickSound). false → không click nào, kể cả đếm vào (đếm vào chỉ là
   * đoạn ô chạy dẫn vào, không tiếng). Bỏ trống = true (tương thích cũ).
   */
  clicks?: boolean;
}

export interface SchedulerOptions extends PlanOptions {
  timbre: Timbre;
}

/** Phần Transport mà scheduler cần. */
export interface SchedulerSource {
  snapshot(): TransportSnapshot;
  /** Áp loop wrap / kết thúc bài (gọi mỗi tick để chạy cả khi rAF bị throttle). */
  update?(): void;
  /**
   * Nếu có và không phải 'audio' thì scheduler im lặng (thời gian không cùng trục AudioContext).
   * `now()` của audio clock (thời điểm đang nghe thấy) cho biết voice nào chưa kịp nghe khi cắt.
   */
  readonly clock?: { readonly kind: 'audio' | 'performance'; now?(): number };
}

/** Đầu ra âm thanh (AudioEngine thỏa mãn interface này). */
export interface AudioOutput {
  getContext(): BaseAudioContext | null;
  musicDestination(): AudioNode | null;
  clickDestination(): AudioNode | null;
  /** Tùy chọn: để engine.stopAll() dừng cả voice của scheduler. */
  addStopListener?(listener: () => void): () => void;
}

/** Thời điểm (trục clock) của `beat` theo anchor của snapshot. */
export function beatToTime(snap: TransportSnapshot, beat: number): number {
  return snap.anchorTime + ((beat - snap.anchorBeat) * 60) / snap.bpm;
}

/** Beat tại thời điểm `time` (giả định đang chạy). */
export function timeToBeat(snap: TransportSnapshot, time: number): number {
  return snap.anchorBeat + ((time - snap.anchorTime) * snap.bpm) / 60;
}

function isDownbeat(beat: number, beatsPerBar: number): boolean {
  const r = ((beat % beatsPerBar) + beatsPerBar) % beatsPerBar;
  return r < EPS || beatsPerBar - r < EPS;
}

/** Index nốt đầu tiên có startBeat >= beat (notes sắp theo startBeat). */
function lowerBound(notes: readonly TimelineNote[], beat: number): number {
  let lo = 0;
  let hi = notes.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (notes[mid].startBeat < beat) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Beat kết thúc đoạn click dẫn vào của count-in `ci`: nốt đầu tiên từ `ci.end` trở đi (đoạn nốt đầu còn đang rơi
 * tới hit line), không có nốt nào thì `ci.end`.
 */
export function leadInClickEnd(timeline: Timeline, ci: { end: number }): number {
  const notes = timeline.notes;
  const k = lowerBound(notes, ci.end - EPS);
  return k < notes.length ? Math.max(ci.end, notes[k].startBeat) : ci.end;
}

/**
 * Sự kiện trong cửa sổ beat nửa mở [fromBeat, toBeat) — hai cửa sổ liền nhau không trùng, không hở.
 * - Nốt có fromBeat <= startBeat < toBeat; nốt nằm trong vùng count-in bị bỏ (đếm vào chỉ có click).
 * - Click dẫn vào ở mọi beat nguyên từ đầu count-in tới nốt đầu tiên sau nó (`leadInClickEnd` — v1.0.1: count-in
 *   ngắn hơn 1 ô nhịp, src/player/leadIn.ts, nên đếm tiếp qua khoảng lặng đầu bài tới lúc nốt đầu chạm hit line;
 *   Quốc ca: −1, 0, 1, 2 rồi nốt lấy đà ở 2,75), hoặc khi bật metronome thì trong [0, endBeat). Accent chỉ ở đầu ô
 *   nhịp (b % beatsPerBar === 0) — count-in không còn bắt đầu ở vạch nhịp. `clicks: false` → không click.
 *   `snap.countIn` là count-in của đoạn phát (AudioScheduler giữ lại sau khi count-in của transport đã hết).
 * Kết quả sắp theo thời gian.
 */
export function planEvents(
  timeline: Timeline,
  snap: TransportSnapshot,
  fromBeat: number,
  toBeat: number,
  opts: PlanOptions,
): PlannedEvent[] {
  const out: PlannedEvent[] = [];
  if (!(toBeat > fromBeat) || !(snap.bpm > 0)) return out;
  const spb = 60 / snap.bpm;
  const ci = snap.countIn;
  const inCountIn = (b: number): boolean => ci !== null && b >= ci.start && b < ci.end;

  const notes = timeline.notes;
  for (let i = lowerBound(notes, fromBeat); i < notes.length; i++) {
    const n = notes[i];
    if (n.startBeat >= toBeat) break;
    if (inCountIn(n.startBeat)) continue;
    const beats = n.endBeat - n.startBeat;
    if (!(beats > 0)) continue;
    const full = beats * spb;
    out.push({
      type: 'note',
      noteIndex: n.index,
      midi: n.midi,
      beat: n.startBeat,
      time: beatToTime(snap, n.startBeat),
      duration: n.slur ? full : full * ARTICULATION,
    });
  }

  const bpb = timeline.beatsPerBar > 0 ? timeline.beatsPerBar : 4;
  const hasClicks = opts.clicks !== false && (ci !== null || opts.metronome);
  if (hasClicks) {
    const leadEnd = ci ? leadInClickEnd(timeline, ci) : Number.NaN;
    for (let b = Math.ceil(fromBeat); b < toBeat; b++) {
      const counting = ci !== null && b >= ci.start && b < leadEnd;
      const ticking = opts.metronome && b >= 0 && b < snap.endBeat;
      if (!counting && !ticking) continue;
      out.push({
        type: 'click',
        beat: b,
        time: beatToTime(snap, b),
        accent: isDownbeat(b, bpb),
      });
    }
  }

  out.sort((a, b) => a.time - b.time);
  return out;
}

const DEFAULT_OPTIONS: SchedulerOptions = { metronome: false, timbre: 'harmonica' };

/** Cùng trục beat↔thời gian (không re-anchor). */
function sameAxis(a: TransportSnapshot, b: TransportSnapshot): boolean {
  return a.anchorTime === b.anchorTime && a.anchorBeat === b.anchorBeat && a.bpm === b.bpm;
}

/** Cùng cấu hình điểm wrap / hết bài. */
function sameShape(a: TransportSnapshot, b: TransportSnapshot): boolean {
  return a.loop === b.loop && a.endBeat === b.endBeat && a.segmentStart === b.segmentStart;
}

/** Snapshot của vòng loop kế tiếp — đúng như transport sẽ neo khi wrap tại beat `wrapEnd`. */
function lapAfter(seg: TransportSnapshot, wrapEnd: number): TransportSnapshot {
  const start = seg.loop ? seg.loop.start : seg.anchorBeat;
  return {
    ...seg,
    anchorBeat: start,
    anchorTime: beatToTime(seg, wrapEnd),
    countIn: null,
    segmentStart: start,
  };
}

/** Snapshot `b` (transport vừa đổi epoch) là đúng vòng loop `lap` scheduler đã lên lịch trước. */
function isPlannedWrap(lap: TransportSnapshot, b: TransportSnapshot): boolean {
  return (
    b.playing &&
    b.countIn === null &&
    b.anchorBeat === lap.anchorBeat &&
    b.bpm === lap.bpm &&
    Math.abs(b.anchorTime - lap.anchorTime) <= WRAP_MATCH_SEC &&
    sameShape(lap, b)
  );
}

/**
 * Chạy interval 25 ms (chỉ khi transport đang phát), mỗi tick lên lịch các sự kiện trong 100 ms tới.
 * Dùng: `const s = new AudioScheduler(getAudioEngine()); s.start(transport, () => timeline,
 * () => ({ metronome, timbre }));` gọi `s.poke()` ngay sau mọi thay đổi của transport (play/pause/
 * seek/bpm/loop) — khi pause interval tự tắt và poke() đánh thức lại; `s.dispose()` khi unmount.
 */
export class AudioScheduler {
  private readonly output: AudioOutput;
  private readonly unsubscribeStop: (() => void) | null;
  private source: SchedulerSource | null = null;
  private getTimeline: () => Timeline | null = () => null;
  private getOptions: () => SchedulerOptions = () => DEFAULT_OPTIONS;
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly voices = new Set<Voice>();
  /** Epoch transport đã đồng bộ; null = chưa có kế hoạch (lần tick kế sẽ bắt đầu từ anchor). */
  private epoch: number | null = null;
  /** Snapshot thật gần nhất của đoạn phát đang lên lịch. */
  private real: TransportSnapshot | null = null;
  /** Vòng loop kế tiếp đã lên lịch trước (transport chưa wrap); khi có, con trỏ nằm trên trục này. */
  private lap: TransportSnapshot | null = null;
  /** Khi có `lap`: beat trên trục `real` đã lên lịch tới (= điểm wrap). */
  private boundary = 0;
  /** Đã lên lịch mọi sự kiện có beat < cursorBeat (trên trục lap ?? real). */
  private cursorBeat = 0;
  /**
   * Count-in của đoạn phát hiện tại (lấy lúc epoch đổi) — giữ lại sau khi transport đã qua count-in để click dẫn
   * vào đếm tiếp tới nốt đầu (`planEvents`). null = đoạn này không đếm vào.
   */
  private leadIn: TransportSnapshot['countIn'] = null;
  private timeline: Timeline | null = null;
  private ctx: BaseAudioContext | null = null;
  private disposed = false;
  private ticking = false;
  private reported = false;

  constructor(output: AudioOutput) {
    this.output = output;
    this.unsubscribeStop = output.addStopListener?.(() => this.silence()) ?? null;
  }

  /** Đã start() (gắn với transport) và chưa stop(). Interval có thể đang nghỉ khi pause. */
  get running(): boolean {
    return this.source !== null;
  }

  /** Interval 25 ms đang chạy (chỉ khi transport đang phát). */
  get timerActive(): boolean {
    return this.timer !== null;
  }

  /** Số voice (nốt + click) đã lên lịch và chưa kết thúc. */
  get activeVoiceCount(): number {
    return this.voices.size;
  }

  /**
   * Bắt đầu (gọi lại = khởi động lại). `getTimeline` nên trả cùng một object khi bài
   * không đổi — object mới cùng epoch được hiểu là bài vừa sửa (hủy nốt chưa phát, plan lại).
   * Chỉ chạy khi transport dùng audio clock (trục AudioContext).
   */
  start(
    source: SchedulerSource,
    getTimeline: () => Timeline | null,
    getOptions: () => SchedulerOptions,
  ): void {
    if (this.disposed) return;
    this.stop();
    this.source = source;
    this.getTimeline = getTimeline;
    this.getOptions = getOptions;
    this.setTimer(true);
    this.onTick(); // transport đang pause → tick này tắt interval ngay
  }

  /** Chạy một tick ngay (gọi sau khi transport đổi: play/pause/seek/bpm/loop). */
  poke(): void {
    if (this.source !== null) this.onTick();
  }

  /** Dừng interval và tắt mọi voice. Không còn timer nào sau khi gọi. */
  stop(): void {
    this.setTimer(false);
    this.silence();
    this.resetCursor();
    this.source = null;
    this.ctx = null;
  }

  dispose(): void {
    this.stop();
    this.unsubscribeStop?.();
    this.getTimeline = () => null;
    this.getOptions = () => DEFAULT_OPTIONS;
    this.disposed = true;
  }

  private readonly onTick = (): void => {
    // Chống gọi lồng (listener của transport.update() có thể poke() ngay trong tick).
    if (this.ticking) return;
    this.ticking = true;
    try {
      this.tick();
    } catch (err) {
      if (!this.reported) {
        this.reported = true;
        console.error('[audio] scheduler tick failed', err);
      }
    } finally {
      this.ticking = false;
    }
  };

  private setTimer(on: boolean): void {
    if (on && this.timer === null && this.source !== null) {
      this.timer = setInterval(this.onTick, TICK_MS);
    } else if (!on && this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private tick(): void {
    const source = this.source;
    if (!source) return;
    source.update?.();
    const snap = source.snapshot();
    // Pause / hết bài: không cần thức 40 lần/giây — poke() ở lần play kế bật lại.
    this.setTimer(snap.playing);
    const ctx = this.output.getContext();
    if (ctx !== this.ctx) {
      // Context đổi (dispose/tạo lại): voice cũ thuộc context cũ.
      this.silence();
      this.resetCursor();
      this.ctx = ctx;
    }
    const audioClock = source.clock === undefined || source.clock.kind === 'audio';
    if (!snap.playing || !ctx || ctx.state === 'closed' || !audioClock || !(snap.bpm > 0)) {
      this.silence(this.heardTime(source));
      this.resetCursor();
      return;
    }
    // Suspended: thời gian đứng yên, giữ nguyên con trỏ chờ resume.
    if (ctx.state !== 'running') return;
    const timeline = this.getTimeline();
    if (!timeline) {
      this.silence();
      this.resetCursor();
      return;
    }
    const now = ctx.currentTime;
    this.follow(source, snap, timeline, now);
    this.plan(ctx, timeline, now);
  }

  /** Đồng bộ kế hoạch với snapshot mới của transport (và timeline). */
  private follow(
    source: SchedulerSource,
    snap: TransportSnapshot,
    timeline: Timeline,
    now: number,
  ): void {
    const real = this.real;
    if (real === null || snap.epoch !== this.epoch) {
      if (real !== null && this.lap !== null && isPlannedWrap(this.lap, snap)) {
        // Transport vừa wrap đúng vòng đã lên lịch trước: nốt ở loop.start đã start() đúng giờ —
        // giữ voice và con trỏ, không phát lại.
        this.lap = null;
      } else {
        // Gián đoạn (play/seek/đổi clock/wrap chưa lên lịch trước): bỏ hết voice, chạy lại từ anchor.
        this.silence(this.heardTime(source));
        this.lap = null;
        this.cursorBeat = snap.anchorBeat;
        this.timeline = timeline;
      }
      this.epoch = snap.epoch;
      this.real = snap;
      this.leadIn = snap.countIn;
    } else {
      const shapeChanged = !sameShape(real, snap);
      if (!sameAxis(real, snap)) {
        // Đổi tempo (vị trí liên tục): giữ nốt đang ngân, lên lịch lại phần chưa phát theo tempo mới.
        this.rewind(now);
        this.real = snap;
        if (this.lap !== null) {
          if (shapeChanged) this.dropLap();
          else this.lap = lapAfter(snap, this.boundary);
        }
      }
      if (shapeChanged) this.reshape(snap);
      else this.real = snap; // countIn có thể vừa hết
    }
    if (timeline !== this.timeline) {
      // Bài đổi giữa chừng (cùng epoch): hủy nốt chưa phát, lên lịch lại từ hiện tại.
      this.rewind(now);
      this.timeline = timeline;
    }
  }

  /** Lên lịch [cursor, now + 100 ms), sang cả vòng loop kế tiếp nếu cửa sổ vượt điểm wrap. */
  private plan(ctx: BaseAudioContext, timeline: Timeline, now: number): void {
    const horizon = now + SCHEDULE_AHEAD_SEC;
    let opts: SchedulerOptions | null = null;
    for (;;) {
      const seg = this.lap ?? this.real;
      if (seg === null) return;
      const wrapEnd = wrapEndOf(seg);
      const reach = timeToBeat(seg, horizon);
      const to = Math.min(reach, seg.endBeat, wrapEnd ?? Infinity);
      const cursor = this.cursorBeat;
      if (to > cursor) {
        this.cursorBeat = to;
        // Phần quá trễ sẽ bị bỏ dù sao → không cần plan (tránh vòng lặp dài sau khi tab bị treo).
        const from = Math.max(cursor, timeToBeat(seg, now - MAX_LATENESS_SEC));
        if (to > from) {
          opts ??= this.getOptions();
          // Đoạn thật (không phải vòng loop kế) đã qua count-in: vẫn đếm dẫn vào tới nốt đầu.
          const plan =
            seg === this.real && seg.countIn === null && this.leadIn !== null
              ? { ...seg, countIn: this.leadIn }
              : seg;
          this.schedule(ctx, planEvents(timeline, plan, from, to, opts), now, opts);
        }
      }
      // Cửa sổ vượt loop end → lên lịch luôn vòng sau (tối đa 1 vòng trước transport): transport
      // chỉ wrap khi đã NGHE tới loop end, lúc đó nốt ở loop.start đã quá giờ trên trục ctx.
      if (
        this.lap !== null ||
        wrapEnd === null ||
        this.cursorBeat < wrapEnd ||
        !(reach > wrapEnd)
      ) {
        return;
      }
      this.boundary = wrapEnd;
      this.lap = lapAfter(seg, wrapEnd);
      this.cursorBeat = this.lap.anchorBeat;
    }
  }

  private schedule(
    ctx: BaseAudioContext,
    events: readonly PlannedEvent[],
    now: number,
    opts: SchedulerOptions,
  ): void {
    const music = this.output.musicDestination();
    const click = this.output.clickDestination();
    for (const ev of events) {
      const late = now - ev.time;
      if (late > MAX_LATENESS_SEC) continue;
      const when = late > 0 ? now : ev.time;
      if (ev.type === 'note') {
        if (!music) continue;
        const duration = Math.max(MIN_LATE_DURATION, ev.duration - Math.max(0, late));
        this.track((onEnded) =>
          scheduleVoice(ctx, music, {
            midi: ev.midi,
            when,
            duration,
            timbre: opts.timbre,
            onEnded,
          }),
        );
      } else {
        if (!click) continue;
        this.track((onEnded) => scheduleClick(ctx, click, when, ev.accent, onEnded));
      }
    }
  }

  /**
   * Hủy voice chưa bắt đầu (when >= now) và lùi con trỏ về sự kiện đầu tiên chưa bắt đầu — tính
   * theo kế hoạch CŨ (gọi trước khi áp snapshot/timeline mới). Voice đã bắt đầu giữ nguyên: không
   * cắt nốt đang ngân, không phát lại nốt đã phát.
   */
  private rewind(now: number): void {
    const real = this.real;
    if (real === null) return;
    this.silencePending(now);
    const lap = this.lap;
    if (lap !== null && now < lap.anchorTime) {
      // ctx chưa tới vòng sau: mọi voice của vòng sau chưa bắt đầu (vừa hủy) → bỏ vòng sau.
      this.lap = null;
      this.cursorBeat = Math.min(this.boundary, Math.max(real.anchorBeat, timeToBeat(real, now)));
      return;
    }
    const seg = lap ?? real;
    this.cursorBeat = Math.min(this.cursorBeat, Math.max(seg.anchorBeat, timeToBeat(seg, now)));
  }

  /**
   * Loop / endBeat / segmentStart đổi (cùng trục): bỏ phần đã lên lịch vượt quá điểm wrap hoặc
   * cuối bài mới (kể cả vòng loop đã lên lịch trước), rồi lên lịch tiếp theo cấu hình mới.
   */
  private reshape(snap: TransportSnapshot): void {
    const real = this.real;
    const lap = this.lap;
    const wrapEnd = wrapEndOf(snap);
    if (real === null) {
      this.real = snap;
      return;
    }
    if (lap !== null && wrapEnd === this.boundary && snap.loop?.start === lap.anchorBeat) {
      // Vòng sau không đổi (vd. chỉ endBeat đổi, vẫn sau loop end).
      this.real = snap;
      this.lap = lapAfter(snap, wrapEnd);
      return;
    }
    const realCursor = lap !== null ? this.boundary : this.cursorBeat;
    const cut = Math.min(wrapEnd ?? Infinity, snap.endBeat, realCursor);
    if (lap !== null || cut < realCursor) {
      this.silenceFrom(beatToTime(real, cut));
      this.lap = null;
      this.cursorBeat = cut;
    }
    this.real = snap;
  }

  /** Bỏ vòng loop đã lên lịch trước (cắt cả voice của nó), con trỏ về điểm wrap trên trục thật. */
  private dropLap(): void {
    const lap = this.lap;
    if (lap === null) return;
    this.silenceFrom(lap.anchorTime);
    this.lap = null;
    this.cursorBeat = this.boundary;
  }

  /** Thời điểm (trục ctx) đang nghe thấy theo audio clock; Infinity nếu không biết. */
  private heardTime(source: SchedulerSource): number {
    const clock = source.clock;
    if (!clock || clock.kind !== 'audio' || typeof clock.now !== 'function') return Infinity;
    const t = clock.now();
    return Number.isFinite(t) ? t : Infinity;
  }

  private track(make: (onEnded: () => void) => Voice): void {
    let voice: Voice | null = null;
    let ended = false;
    voice = make(() => {
      ended = true;
      if (voice) this.voices.delete(voice);
    });
    if (!ended) this.voices.add(voice);
  }

  /**
   * Release nhanh mọi voice (đang kêu lẫn chưa bắt đầu). Voice có `when > heard` — đã render
   * nhưng phần đầu còn nằm trong output latency, người nghe chưa thấy — cắt cực nhanh
   * (ONSET_CUT_SEC) để chỉ còn phần đã render không thu hồi được.
   */
  private silence(heard = Infinity): void {
    if (this.voices.size === 0) return;
    const list = Array.from(this.voices);
    this.voices.clear();
    for (const v of list) {
      try {
        v.stop(undefined, v.when > heard + EPS ? ONSET_CUT_SEC : undefined);
      } catch {
        // context đã đóng
      }
    }
  }

  /** Chỉ hủy voice chưa bắt đầu (when === now chưa phát mẫu nào → cũng hủy, tránh trùng khi plan lại). */
  private silencePending(now: number): void {
    this.silenceFrom(now);
  }

  /** Dừng mọi voice có when >= t (chưa bắt đầu → im lặng; đang kêu → release nhanh). */
  private silenceFrom(t: number): void {
    for (const v of Array.from(this.voices)) {
      if (v.when >= t - EPS) {
        this.voices.delete(v);
        try {
          v.stop();
        } catch {
          // context đã đóng
        }
      }
    }
  }

  private resetCursor(): void {
    this.epoch = null;
    this.real = null;
    this.lap = null;
    this.boundary = 0;
    this.cursorBeat = 0;
    this.timeline = null;
    this.leadIn = null;
  }
}

import type { BeatRange, Clock, TransportSnapshot } from './transport.types';

export const BPM_MIN = 20;
export const BPM_MAX = 400;
const BPM_DEFAULT = 120;

export interface TransportOptions {
  clock: Clock;
  bpm: number;
  /** Beat kết thúc bài; bỏ trống = không bao giờ kết thúc (Infinity). */
  endBeat?: number;
}

export interface PlayOptions {
  /** Beat bắt đầu; bỏ trống = beat hiện tại. */
  fromBeat?: number;
  /** Số beat đếm vào trước `fromBeat` (beat âm/lùi lại trong lúc đếm). */
  countInBeats?: number;
  /**
   * Chờ thêm (giây, ≥ 0) rồi đoạn phát mới bắt đầu chạy — cộng vào khoảng chờ `clock.lead()`. Trong lúc chờ
   * beat đứng ở điểm đầu đoạn (vd. overlay theo Player: Player còn chờ output latency của audio thì overlay
   * chờ đúng chừng đó thay vì chạy trước rồi bị kéo lại).
   */
  startDelaySec?: number;
}

export interface UpdateResult {
  wrapped: boolean;
  ended: boolean;
}

export type TransportListener = (snap: TransportSnapshot) => void;

const NO_CHANGE: Readonly<UpdateResult> = Object.freeze({ wrapped: false, ended: false });
const WRAPPED: Readonly<UpdateResult> = Object.freeze({ wrapped: true, ended: false });
const ENDED: Readonly<UpdateResult> = Object.freeze({ wrapped: false, ended: true });

/** Kẹp bpm vào [BPM_MIN, BPM_MAX]; NaN/Infinity → 120. */
export function clampBpm(bpm: number): number {
  if (!Number.isFinite(bpm)) return BPM_DEFAULT;
  return Math.min(BPM_MAX, Math.max(BPM_MIN, bpm));
}

function normalizeEndBeat(endBeat: number | undefined): number {
  if (endBeat === undefined) return Infinity;
  if (Number.isNaN(endBeat) || endBeat < 0) {
    throw new RangeError(`endBeat không hợp lệ: ${endBeat}`);
  }
  return endBeat;
}

function wrapEnd(loop: BeatRange | null, endBeat: number, segmentStart: number): number | null {
  if (!loop) return null;
  // Loop không vượt quá cuối bài; chỉ wrap khi đoạn phát hiện tại bắt đầu trước loop end.
  const end = Math.min(loop.end, endBeat);
  return loop.start < end && segmentStart < end ? end : null;
}

/**
 * Beat mà đoạn phát của snapshot sẽ wrap về `loop.start`; null = không wrap (không loop, loop rỗng
 * sau khi kẹp endBeat, hoặc đoạn phát bắt đầu từ loop end trở đi). Transport và scheduler dùng chung.
 */
export function wrapEndOf(
  snap: Pick<TransportSnapshot, 'loop' | 'endBeat' | 'segmentStart'>,
): number | null {
  return wrapEnd(snap.loop, snap.endBeat, snap.segmentStart);
}

/** Beat tại thời điểm `t` (trục clock) theo snapshot — dùng cho renderer/scheduler. */
export function snapshotBeatAt(snap: TransportSnapshot, t: number): number {
  return snap.playing
    ? snap.anchorBeat + (Math.max(0, t - snap.anchorTime) * snap.bpm) / 60
    : snap.anchorBeat;
}

/** Thời điểm (trục clock) beat `beat` đi qua theo anchor của snapshot (giả định đang chạy). */
export function snapshotTimeAt(snap: TransportSnapshot, beat: number): number {
  return snap.anchorTime + ((beat - snap.anchorBeat) * 60) / snap.bpm;
}

/**
 * Transport: vị trí phát (beat) trên một Clock. Logic thuần, không DOM/React.
 * Khi playing: beat(t) = anchorBeat + (t - anchorTime) * bpm / 60 (t < anchorTime → anchorBeat:
 * đoạn phát mới neo tại now + clock.lead() nên hình chờ đúng khoảng output latency của audio).
 * Khi pause: beat = anchorBeat. Gọi `update()` mỗi frame / mỗi tick scheduler để áp dụng loop
 * wrap và kết thúc bài.
 */
export class Transport {
  private _clock: Clock;
  private _bpm: number;
  private _playing = false;
  private _anchorTime: number;
  private _anchorBeat = 0;
  private _epoch = 0;
  private _loop: BeatRange | null = null;
  private _countIn: BeatRange | null = null;
  private _segmentStart = 0;
  private _endBeat: number;
  private readonly listeners = new Set<TransportListener>();

  constructor(opts: TransportOptions) {
    this._clock = opts.clock;
    this._bpm = clampBpm(opts.bpm);
    this._endBeat = normalizeEndBeat(opts.endBeat);
    this._anchorTime = opts.clock.now();
  }

  get clock(): Clock {
    return this._clock;
  }
  get bpm(): number {
    return this._bpm;
  }
  get playing(): boolean {
    return this._playing;
  }
  get loop(): BeatRange | null {
    return this._loop;
  }
  get endBeat(): number {
    return this._endBeat;
  }
  get epoch(): number {
    return this._epoch;
  }
  get countIn(): BeatRange | null {
    return this._countIn;
  }
  /** Vị trí bắt đầu của đoạn phát hiện tại (xem TransportSnapshot.segmentStart). */
  get segmentStart(): number {
    return this._segmentStart;
  }

  /** Beat hiện tại (có thể âm khi đang đếm vào). Chưa áp loop/end — gọi `update()` trước. */
  getBeat(): number {
    return this._playing ? this.beatAt(this._clock.now()) : this._anchorBeat;
  }

  snapshot(): TransportSnapshot {
    return {
      playing: this._playing,
      anchorTime: this._anchorTime,
      anchorBeat: this._anchorBeat,
      bpm: this._bpm,
      epoch: this._epoch,
      loop: this._loop,
      countIn: this._countIn,
      segmentStart: this._segmentStart,
      endBeat: this._endBeat,
    };
  }

  /**
   * Phát từ `fromBeat` (mặc định beat hiện tại). Beat âm → 0; tại/sau endBeat → 0.
   * Đang phát mà không truyền `fromBeat` thì bỏ qua.
   */
  play(opts: PlayOptions = {}): void {
    if (this._playing && opts.fromBeat === undefined) return;
    let from = opts.fromBeat ?? this._anchorBeat;
    if (!Number.isFinite(from) || from < 0) from = 0;
    if (from >= this._endBeat) from = 0;
    const ci = opts.countInBeats;
    const count = ci !== undefined && Number.isFinite(ci) && ci > 0 ? ci : 0;
    this._anchorBeat = from - count;
    const wait = opts.startDelaySec;
    this._anchorTime =
      this.startTime(this._clock) +
      (wait !== undefined && Number.isFinite(wait) && wait > 0 ? wait : 0);
    this._countIn = count > 0 ? Object.freeze({ start: from - count, end: from }) : null;
    this._segmentStart = from;
    this._playing = true;
    this._epoch++;
    this.emit();
  }

  /** Dừng, giữ nguyên vị trí chính xác. */
  pause(): void {
    if (!this._playing) return;
    const now = this._clock.now();
    this.settle(now); // áp wrap/end còn treo trước khi đóng băng
    if (this._playing) {
      this._anchorBeat = this.beatAt(now);
      this._anchorTime = now;
      this._segmentStart = this._anchorBeat;
      this._playing = false;
      this._countIn = null;
      this._epoch++;
    }
    this.emit();
  }

  toggle(opts?: PlayOptions): void {
    if (this._playing) this.pause();
    else this.play(opts);
  }

  /** Nhảy tới beat (kẹp [0, endBeat]); chạy được cả khi đang phát lẫn pause. */
  seek(beat: number): void {
    let b = Math.min(Math.max(Number.isNaN(beat) ? 0 : beat, 0), this._endBeat);
    if (!Number.isFinite(b)) b = 0;
    this._anchorBeat = b;
    this._anchorTime = this._playing ? this.startTime(this._clock) : this._clock.now();
    this._countIn = null;
    this._segmentStart = b;
    this._epoch++;
    this.emit();
  }

  /**
   * Đổi tempo (kẹp 20..400), neo lại tại beat hiện tại nên vị trí không nhảy. Không phải gián đoạn:
   * không tăng epoch (scheduler giữ nốt đang ngân, chỉ lên lịch lại phần chưa phát theo tempo mới).
   */
  setBpm(bpm: number): void {
    if (!Number.isFinite(bpm)) return;
    const next = clampBpm(bpm);
    if (next === this._bpm) return;
    const now = this._clock.now();
    this.settle(now);
    // Còn trong khoảng chờ đầu đoạn (now < anchorTime) thì giữ anchor: beat tại anchorTime không đổi.
    if (this._playing && now > this._anchorTime) {
      this._anchorBeat = this.beatAt(now);
      this._anchorTime = now;
    }
    this._bpm = next;
    this.emit();
  }

  /** Đổi master clock (performance ↔ audio), giữ nguyên beat và trạng thái phát. */
  setClock(clock: Clock): void {
    if (clock === this._clock) return;
    const now = this._clock.now();
    this.settle(now);
    const beat = this.beatAt(now);
    this._clock = clock;
    this._anchorBeat = beat;
    // Đang phát: đoạn tiếp theo bắt đầu trên clock mới → chừa lead để âm thanh kịp đúng giờ.
    this._anchorTime = this._playing ? this.startTime(clock) : clock.now();
    this._epoch++;
    this.emit();
  }

  /**
   * Đặt/tắt loop A-B. start < end (start âm kẹp về 0), sai thì RangeError.
   * Playhead ở ngoài vùng loop thì không nhảy: trước vùng → chạy vào rồi wrap ở end;
   * đã qua end → chạy tiếp tới hết bài. "Playhead" là vị trí phát — lúc đang đếm vào là điểm
   * định bắt đầu, không phải beat âm của ô nhịp đếm.
   */
  setLoop(range: BeatRange | null): void {
    let next: BeatRange | null = null;
    if (range !== null) {
      const start = Math.max(0, range.start);
      const end = range.end;
      if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end) {
        throw new RangeError(`loop không hợp lệ: ${range.start}..${range.end}`);
      }
      next = Object.freeze({ start, end });
    }
    const cur = this._loop;
    if (
      next === null
        ? cur === null
        : cur !== null && cur.start === next.start && cur.end === next.end
    ) {
      return;
    }
    const now = this._clock.now();
    this.settle(now); // wrap theo loop cũ nếu đã vượt
    if (this._playing) {
      // Đoạn phát coi như bắt đầu tại vị trí hiện tại (để biết playhead ở phía nào của loop end).
      this._segmentStart = Math.max(this._segmentStart, this.beatAt(now));
    }
    this._loop = next;
    this.emit();
  }

  /** Đổi beat kết thúc bài. Đang pause sau beat mới thì kẹp về endBeat. */
  setEndBeat(endBeat: number): void {
    const n = normalizeEndBeat(endBeat);
    if (n === this._endBeat) return;
    if (this._playing) this.settle(this._clock.now());
    this._endBeat = n;
    if (!this._playing && this._anchorBeat > n) {
      this._anchorBeat = n;
      this._segmentStart = n;
      this._countIn = null;
      this._epoch++;
    }
    this.emit();
  }

  /** Gọi mỗi frame và mỗi tick scheduler: áp loop wrap / kết thúc bài. */
  update(): Readonly<UpdateResult> {
    if (!this._playing) return NO_CHANGE;
    const r = this.settle(this._clock.now());
    if (r !== NO_CHANGE) this.emit();
    return r;
  }

  /** Thời điểm (trục clock) của beat. Khi pause: dự phóng như thể phát tiếp ngay bây giờ. */
  beatToTime(beat: number): number {
    const base = this._playing ? this._anchorTime : this._clock.now();
    return base + ((beat - this._anchorBeat) * 60) / this._bpm;
  }

  /** Beat tại thời điểm `t` (trục clock). Khi pause luôn là beat đang dừng. */
  timeToBeat(t: number): number {
    return this.beatAt(t);
  }

  /** Nghe thay đổi rời rạc (play, pause, seek, bpm, loop, clock, wrap, end) — không theo frame. */
  subscribe(listener: TransportListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  dispose(): void {
    this.listeners.clear();
  }

  /** anchorTime cho đoạn phát mới trên `clock`: now + lead (khoảng chờ output latency). */
  private startTime(clock: Clock): number {
    const now = clock.now();
    const lead = clock.lead?.() ?? 0;
    return Number.isFinite(lead) && lead > 0 ? now + lead : now;
  }

  private beatAt(t: number): number {
    return this._playing
      ? this._anchorBeat + (Math.max(0, t - this._anchorTime) * this._bpm) / 60
      : this._anchorBeat;
  }

  /** Áp wrap/end/hết count-in tại `now`, không notify. */
  private settle(now: number): Readonly<UpdateResult> {
    if (!this._playing) return NO_CHANGE;
    const beat = this.beatAt(now);
    const loopEnd = wrapEnd(this._loop, this._endBeat, this._segmentStart);
    if (loopEnd !== null && this._loop !== null && beat >= loopEnd) {
      this.wrap(this._loop.start, loopEnd, beat, now);
      return WRAPPED;
    }
    if (beat >= this._endBeat) {
      this._playing = false;
      this._anchorBeat = this._endBeat;
      this._anchorTime = now;
      this._segmentStart = this._endBeat;
      this._countIn = null;
      this._epoch++;
      return ENDED;
    }
    if (this._countIn !== null && beat >= this._countIn.end) this._countIn = null;
    return NO_CHANGE;
  }

  /**
   * Wrap chính xác: neo tại lần cuối vượt loop end (trong quá khứ), kể cả khi trễ nhiều vòng.
   * Thời điểm neo tính đúng như `snapshotTimeAt(snap, end)` để scheduler (đã lên lịch trước vòng
   * sau) nhận ra đây là wrap nó chờ.
   */
  private wrap(start: number, end: number, beat: number, now: number): void {
    const lapSec = ((end - start) * 60) / this._bpm;
    const tEnd = this._anchorTime + ((end - this._anchorBeat) * 60) / this._bpm;
    const laps = Math.floor((beat - end) / (end - start));
    let t = tEnd + laps * lapSec;
    // Chống sai số float: sau wrap beat phải < end.
    if (start + ((now - t) * this._bpm) / 60 >= end) t += lapSec;
    this._anchorBeat = start;
    this._anchorTime = t;
    this._segmentStart = start;
    this._countIn = null;
    this._epoch++;
  }

  private emit(): void {
    if (this.listeners.size === 0) return;
    const snap = this.snapshot();
    for (const listener of Array.from(this.listeners)) {
      try {
        listener(snap);
      } catch (err) {
        console.error(err);
      }
    }
  }
}

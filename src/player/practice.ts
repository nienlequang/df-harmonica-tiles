/**
 * Chấm điểm practice mode (spec §6 "Practice mode", §6b B "Dùng 1"). Thuần TS: không DOM/React.
 *
 * Engine đưa input đã chuẩn hóa (practiceInput.ts / Web MIDI / bàn chạm Mobile mobilePadInput.ts)
 * vào `handleInput`, mỗi frame gọi
 * `tick` (chế độ chấm điểm: sinh miss) hoặc `waitTarget` (chế độ chờ: nốt cần giữ transport) và
 * truyền `noteStates` cho renderer.
 *
 * - Chấm điểm: bấm khớp nốt chưa chấm GẦN NHẤT trong ±220 ms → perfect (≤ 100 ms) / good; không
 *   khớp nốt nào trong cửa sổ → bấm sai (mất combo). Nốt quá 220 ms không ai bấm → miss.
 * - Chờ: mục tiêu là nốt chưa chấm kế tiếp; bấm đúng (không sớm hơn 220 ms) → perfect; bấm sai chỉ
 *   báo, không đổi combo; không có miss.
 * - Loop A-B (`InputContext.loop`): mỗi vòng là một lượt (engine gọi `wrapLoop` lúc wrap). Nốt từ
 *   loop end trở đi không chấm; bấm sớm cho nốt đầu vòng kế (trong cửa sổ, trước wrap) được chấm
 *   trước và tính vào lượt mới; bấm muộn cho nốt cuối vòng vừa qua (sau wrap) không tính sai.
 * Độ lệch ms = (beat lúc bấm − startBeat) × 60000 / bpm phát thực tế (đã tính BPM override).
 */
import type { KeyChoice } from '../core/keys';
import type { NoteKey, Octave, Timeline, TimelineNote } from '../core/types';
import type { PracticeMode } from '../ui/settings';
import { GOOD_WINDOW_MS, PERFECT_WINDOW_MS } from './practice.types';
import type {
  Grade,
  Judgement,
  PracticeInputEvent,
  PracticeModifier,
  PracticeScore,
} from './practice.types';

export type { PracticeMode };

export interface PracticeOptions {
  mode: PracticeMode;
  /** MIDI: chỉ cần đúng pitch class (bỏ qua quãng). Mặc định false = đúng cao độ tuyệt đối. */
  midiPitchClassOnly?: boolean;
}

/** Loop A-B của đoạn phát: transport tới `end` thì quay về `start`. */
export interface LoopWrap {
  start: number;
  /** Beat wrap = loop end đã kẹp theo cuối bài (`wrapEndOf`). */
  end: number;
}

export interface InputContext {
  /** Đổi timeStamp (trục performance.now, ms) của input thành beat của transport. */
  beatAt(timeStampMs: number): number;
  /** BPM phát thực tế (sau override) — để đổi lệch beat thành ms. */
  bpm: number;
  /**
   * Loop mà đoạn phát hiện tại sẽ wrap (bỏ trống / null = không loop). Có loop: nốt từ `end` trở
   * đi không được chấm (vòng này không phát tới); bấm không khớp vòng này nhưng khớp nốt đầu vòng
   * kế trong cửa sổ trước `end` → chấm trước cho vòng kế; bấm ngay sau wrap khớp nốt cuối vòng
   * trước (còn trong cửa sổ) → không tính sai.
   */
  loop?: LoopWrap | null;
}

export interface HeldModifiers {
  left: boolean;
  right: boolean;
  scroll: boolean;
}

export interface InputResult {
  /** Nốt vừa được chấm (perfect/good), null nếu không chấm nốt nào. */
  judgement: Judgement | null;
  /** Bấm sai: sai phím/modifier, ngoài cửa sổ, sớm quá (chờ) hoặc giữ cả trái lẫn phải. */
  wrong: boolean;
  /**
   * Có khi `judgement` thuộc vòng loop khác (không đổi điểm lượt hiện tại): 'next' = chấm trước
   * cho vòng kế, được tính khi `wrapLoop`; 'previous' = bấm muộn cho nốt cuối vòng vừa qua (vòng
   * đó đã đóng, chỉ để báo kết quả lần bấm).
   */
  lap?: 'next' | 'previous';
}

/**
 * Mã trạng thái nốt cho renderer — bản sao của `NoteState` trong renderer.ts (để file này không
 * import module canvas); practice.test.ts bảo đảm hai bảng khớp nhau.
 */
export const PRACTICE_NOTE_STATE = {
  none: 0,
  perfect: 1,
  good: 2,
  miss: 3,
  waiting: 4,
} as const;

/** Sai số float khi so cửa sổ (ms) và khi so beat. */
const EPS_MS = 1e-6;
const EPS_BEAT = 1e-9;

const OPEN = 0;
const JUDGED = 1;
const SKIPPED = 2;

const NO_RESULT: InputResult = Object.freeze({ judgement: null, wrong: false });
const WRONG: InputResult = Object.freeze({ judgement: null, wrong: true });

const MODIFIERS: readonly PracticeModifier[] = ['left', 'right', 'scroll'];

type ModSource = 'keyboard' | 'mouse';
type NoteMatcher = (note: TimelineNote) => boolean;

interface Hit {
  index: number;
  grade: Grade;
  deltaMs: number;
}

/** Lần bấm đã chấm trước cho vòng loop kế (áp khi `wrapLoop` cùng loop). */
interface CarriedHit extends Hit {
  start: number;
  end: number;
}

/** Nốt cuối vòng vừa qua chưa chấm; `startBeat` đã dời về tọa độ vòng mới (trước loop start). */
interface TailNote {
  index: number;
  startBeat: number;
}

const gradeFor = (delta: number): Grade =>
  Math.abs(delta) <= PERFECT_WINDOW_MS + EPS_MS ? 'perfect' : 'good';

function validLoop(loop: LoopWrap | null | undefined): LoopWrap | null {
  return loop && Number.isFinite(loop.start) && Number.isFinite(loop.end) && loop.end > loop.start
    ? loop
    : null;
}

/**
 * Nốt người chơi đang bấm bằng bàn phím: phím + modifier đang giữ. Trái → quãng -1, phải → +1,
 * scroll → nửa cung; giữ cả trái lẫn phải là không hợp lệ → null.
 */
export function keyboardPress(key: NoteKey, held: HeldModifiers): KeyChoice | null {
  if (held.left && held.right) return null;
  const octave: Octave = held.left ? -1 : held.right ? 1 : 0;
  return { key, octave, sharp: held.scroll };
}

const pitchClass = (midi: number): number => ((Math.round(midi) % 12) + 12) % 12;

export class PracticeSession {
  /** Trạng thái từng nốt (index theo timeline.notes) cho renderer — cùng một mảng suốt phiên. */
  readonly noteStates: Uint8Array;

  private readonly notes: readonly TimelineNote[];
  private readonly fallbackBpm: number;
  private readonly status: Uint8Array;
  private _mode: PracticeMode;
  private pitchClassOnly: boolean;
  private readonly held: Record<PracticeModifier, Set<ModSource>> = {
    left: new Set(),
    right: new Set(),
    scroll: new Set(),
  };

  private total = 0;
  private perfect = 0;
  private good = 0;
  private miss = 0;
  private combo = 0;
  private maxCombo = 0;
  private wrong = 0;
  /** Nốt OPEN đầu tiên (= notes.length khi hết). */
  private cursor = 0;
  /** Nốt đang đánh dấu waiting, -1 nếu không có. */
  private waitingIndex = -1;
  /** Bấm sớm đã chấm trước cho vòng loop kế. */
  private nextLap: CarriedHit[] = [];
  /** Nốt cuối vòng loop vừa qua còn nhận bấm muộn (sau `wrapLoop`). */
  private prevTail: TailNote[] = [];

  constructor(timeline: Timeline, opts: PracticeOptions) {
    this.notes = timeline.notes;
    this.fallbackBpm = timeline.bpm > 0 ? timeline.bpm : 120;
    this.noteStates = new Uint8Array(this.notes.length);
    this.status = new Uint8Array(this.notes.length);
    this._mode = opts.mode;
    this.pitchClassOnly = opts.midiPitchClassOnly ?? false;
    this.reset(0);
  }

  get mode(): PracticeMode {
    return this._mode;
  }

  /** Đổi chế độ giữa chừng: giữ kết quả đã chấm, bỏ đánh dấu waiting. Muốn chơi lại thì reset(). */
  setMode(mode: PracticeMode): void {
    if (mode === this._mode) return;
    this._mode = mode;
    this.clearWaiting();
    this.dropLoopCarry();
  }

  setMidiPitchClassOnly(value: boolean): void {
    this.pitchClassOnly = value;
  }

  /**
   * Bắt đầu lại từ `fromBeat`: xóa kết quả; nốt bắt đầu trước `fromBeat` bị bỏ qua (không tính vào
   * tổng, không bao giờ miss). Modifier đang giữ được giữ nguyên (phím vật lý vẫn đang bấm).
   */
  reset(fromBeat = 0): void {
    const from = Number.isFinite(fromBeat) ? fromBeat : 0;
    this.noteStates.fill(PRACTICE_NOTE_STATE.none);
    let total = 0;
    for (let i = 0; i < this.notes.length; i++) {
      const skip = this.notes[i].startBeat < from - EPS_BEAT;
      this.status[i] = skip ? SKIPPED : OPEN;
      if (!skip) total++;
    }
    this.total = total;
    this.perfect = 0;
    this.good = 0;
    this.miss = 0;
    this.combo = 0;
    this.maxCombo = 0;
    this.wrong = 0;
    this.cursor = 0;
    this.waitingIndex = -1;
    this.nextLap = [];
    this.prevTail = [];
    this.advanceCursor();
  }

  /**
   * Loop wrap về `loop.start`: lượt mới như `reset(loop.start)`, rồi tính các lần bấm sớm đã chấm
   * trước cho vòng này (cùng loop) — trả các judgement đó theo thứ tự bấm. Nốt cuối vòng vừa qua
   * chưa ai bấm mà còn trong cửa sổ good lúc wrap được giữ lại để bấm muộn không bị tính sai.
   */
  wrapLoop(loop: LoopWrap, bpm: number): Judgement[] {
    const lp = validLoop(loop);
    if (!lp) {
      this.reset(loop.start);
      return [];
    }
    const b = this.validBpm(bpm);
    const len = lp.end - lp.start;
    const tail: TailNote[] = [];
    for (let i = this.cursor; i < this.notes.length; i++) {
      const s = this.notes[i].startBeat;
      if (s >= lp.end - EPS_BEAT) break;
      if (this.status[i] !== OPEN || s < lp.start - EPS_BEAT) continue;
      if (deltaMs(lp.end, s, b) <= GOOD_WINDOW_MS + EPS_MS) {
        tail.push({ index: i, startBeat: s - len });
      }
    }
    const carried = this.nextLap.filter((h) => h.start === lp.start && h.end === lp.end);
    this.reset(lp.start);
    this.prevTail = tail;
    const out: Judgement[] = [];
    for (const h of carried) {
      if (this.status[h.index] === OPEN) out.push(this.judge(h.index, h.grade, h.deltaMs));
    }
    return out;
  }

  /**
   * Bỏ phần "vắt qua" loop wrap (bấm chấm trước cho vòng kế, nốt cuối vòng trước): gọi khi transport
   * không chạy liền qua wrap nữa (pause, seek, đổi loop…).
   */
  dropLoopCarry(): void {
    this.nextLap = [];
    this.prevTail = [];
  }

  /** Modifier đang giữ (gộp bàn phím thay thế và chuột). */
  get heldModifiers(): HeldModifiers {
    return {
      left: this.held.left.size > 0,
      right: this.held.right.size > 0,
      scroll: this.held.scroll.size > 0,
    };
  }

  /** Thả hết modifier (vd. khi tắt practice / gỡ input giữa chừng). */
  releaseModifiers(): void {
    for (const m of MODIFIERS) this.held[m].clear();
  }

  /** Nốt chưa chấm kế tiếp (nốt người chơi sẽ bấm tới) — index trong timeline.notes; -1 nếu hết. */
  get nextNoteIndex(): number {
    return this.cursor < this.notes.length ? this.cursor : -1;
  }

  /** Số lần bấm sai từ lần reset gần nhất (cả hai chế độ). */
  get wrongPresses(): number {
    return this.wrong;
  }

  /** Mọi nốt được tính đã chấm xong (true cả khi không có nốt nào để chấm). */
  get finished(): boolean {
    return this.perfect + this.good + this.miss >= this.total;
  }

  handleInput(ev: PracticeInputEvent, ctx: InputContext): InputResult {
    switch (ev.type) {
      case 'mod-down':
        this.held[ev.modifier].add(ev.source);
        return NO_RESULT;
      case 'mod-up':
        this.held[ev.modifier].delete(ev.source);
        return NO_RESULT;
      case 'key-down': {
        const press = keyboardPress(ev.key, this.heldModifiers);
        const matcher: NoteMatcher | null = press
          ? (n) => n.key === press.key && n.octave === press.octave && n.sharp === press.sharp
          : null;
        return this.press(matcher, ev.timeStamp, ctx);
      }
      case 'tap-down': {
        // Bàn chạm Mobile: chế độ đã chốt lúc chạm (không dùng modifier đang giữ).
        const { key, octave, sharp } = ev;
        return this.press(
          (n) => n.key === key && n.octave === octave && n.sharp === sharp,
          ev.timeStamp,
          ctx,
        );
      }
      case 'midi-on': {
        // Velocity 0 = note off (spec §6b B).
        if (!(ev.velocity > 0)) return NO_RESULT;
        const target = ev.midi;
        const pc = pitchClass(target);
        const matcher: NoteMatcher = this.pitchClassOnly
          ? (n) => pitchClass(n.midi) === pc
          : (n) => n.midi === target;
        return this.press(matcher, ev.timeStamp, ctx);
      }
      default:
        // key-up / midi-off / tap-up: không ảnh hưởng điểm.
        return NO_RESULT;
    }
  }

  /**
   * Nốt người chơi lẽ ra phải bấm tại `beat` (vd. để chỉ nút chế độ cần chạm sau một lần bấm sai):
   * chờ → nốt mục tiêu (nốt chưa chấm kế tiếp); chấm điểm → nốt chưa chấm gần `beat` nhất trong cửa
   * sổ good (hòa → nốt sớm hơn). Không có → -1.
   */
  expectedNoteAt(beat: number, bpm: number): number {
    if (!Number.isFinite(beat) || this.finished) return -1;
    const b = this.validBpm(bpm);
    if (this._mode === 'wait') return this.cursor < this.notes.length ? this.cursor : -1;
    const hit = this.scoreHit(() => true, beat, b, this.cursor, Infinity, null);
    return hit ? hit.index : -1;
  }

  /** Chấm điểm: nốt quá cửa sổ good mà chưa bấm → miss (mất combo). Chế độ chờ: luôn []. */
  tick(beat: number, bpm: number): Judgement[] {
    if (this._mode !== 'score' || !Number.isFinite(beat)) return [];
    const b = this.validBpm(bpm);
    const out: Judgement[] = [];
    for (let i = this.cursor; i < this.notes.length; i++) {
      if (this.status[i] !== OPEN) continue;
      // Nốt sắp theo startBeat: nốt này còn trong cửa sổ thì các nốt sau cũng vậy.
      if (deltaMs(beat, this.notes[i].startBeat, b) <= GOOD_WINDOW_MS + EPS_MS) break;
      out.push(this.judge(i, 'miss', null));
    }
    return out;
  }

  /**
   * Chế độ chờ: index nốt chưa chấm kế tiếp nếu playhead đã tới nó (startBeat ≤ beat + ε) — engine
   * phải giữ transport tại startBeat của nốt đó; nốt được đánh dấu waiting. Không có → -1.
   */
  waitTarget(beat: number): number {
    const i = this.cursor;
    if (
      this._mode !== 'wait' ||
      i >= this.notes.length ||
      !(this.notes[i].startBeat <= beat + EPS_BEAT)
    ) {
      this.clearWaiting();
      return -1;
    }
    if (this.waitingIndex !== i) {
      this.clearWaiting();
      this.waitingIndex = i;
      this.noteStates[i] = PRACTICE_NOTE_STATE.waiting;
    }
    return i;
  }

  score(): PracticeScore {
    const judged = this.perfect + this.good + this.miss;
    return {
      total: this.total,
      judged,
      perfect: this.perfect,
      good: this.good,
      miss: this.miss,
      combo: this.combo,
      maxCombo: this.maxCombo,
      accuracy: this.total > 0 ? ((this.perfect + 0.5 * this.good) / this.total) * 100 : 0,
    };
  }

  // ── nội bộ ──

  private press(matcher: NoteMatcher | null, timeStamp: number, ctx: InputContext): InputResult {
    const beat = ctx.beatAt(timeStamp);
    if (!Number.isFinite(beat)) return NO_RESULT;
    const bpm = this.validBpm(ctx.bpm);
    const loop = validLoop(ctx.loop);
    if (matcher !== null) {
      if (!this.finished) {
        // Có loop: nốt từ loop end trở đi vòng này không phát tới.
        const limitBeat = loop ? loop.end - EPS_BEAT : Infinity;
        const hit =
          this._mode === 'wait'
            ? this.waitHit(matcher, beat, bpm, this.cursor, limitBeat)
            : this.scoreHit(matcher, beat, bpm, this.cursor, limitBeat, null);
        if (hit) return { judgement: this.judge(hit.index, hit.grade, hit.deltaMs), wrong: false };
      }
      const other = loop ? this.otherLap(matcher, beat, bpm, loop) : null;
      if (other) return other;
    }
    // Hết nốt để chấm: bấm thêm không làm gì (không phá combo cuối bài).
    if (this.finished) return NO_RESULT;
    this.wrong++;
    if (this._mode === 'score') this.combo = 0;
    return WRONG;
  }

  /** Chờ: nốt mục tiêu (nốt mở đầu tiên từ `from`) khớp và không sớm hơn cửa sổ good. */
  private waitHit(
    matcher: NoteMatcher,
    beat: number,
    bpm: number,
    from: number,
    limitBeat: number,
    skip: ((i: number) => boolean) | null = null,
  ): Hit | null {
    let i = from;
    while (i < this.notes.length && skip !== null && skip(i)) i++;
    const note = this.notes[i];
    if (note === undefined || note.startBeat >= limitBeat) return null;
    const d = deltaMs(beat, note.startBeat, bpm);
    return matcher(note) && d >= -GOOD_WINDOW_MS - EPS_MS
      ? { index: i, grade: 'perfect', deltaMs: d }
      : null;
  }

  /**
   * Chấm điểm: nốt khớp gần nhất trong ±220 ms (hòa → nốt sớm hơn), index ≥ `from`, startBeat <
   * `limitBeat`. `skip` = null → chỉ nốt OPEN; có `skip` → coi mọi nốt là mở trừ nốt `skip` (vòng kế).
   */
  private scoreHit(
    matcher: NoteMatcher,
    beat: number,
    bpm: number,
    from: number,
    limitBeat: number,
    skip: ((i: number) => boolean) | null,
  ): Hit | null {
    const limit = GOOD_WINDOW_MS + EPS_MS;
    let best = -1;
    let bestDelta = 0;
    const start = Math.max(from, this.lowerBound(beat - (limit * bpm) / 60000));
    for (let i = start; i < this.notes.length; i++) {
      const note = this.notes[i];
      if (note.startBeat >= limitBeat) break;
      const d = deltaMs(beat, note.startBeat, bpm);
      if (d < -limit) break; // các nốt sau còn xa hơn
      if (Math.abs(d) > limit || !matcher(note)) continue;
      if (skip === null ? this.status[i] !== OPEN : skip(i)) continue;
      if (best < 0 || Math.abs(d) < Math.abs(bestDelta)) {
        best = i;
        bestDelta = d;
      }
    }
    return best < 0 ? null : { index: best, grade: gradeFor(bestDelta), deltaMs: bestDelta };
  }

  /** Bấm không khớp vòng này: thử nốt đầu vòng loop kế (bấm sớm), rồi nốt cuối vòng trước (muộn). */
  private otherLap(
    matcher: NoteMatcher,
    beat: number,
    bpm: number,
    loop: LoopWrap,
  ): InputResult | null {
    const limit = GOOD_WINDOW_MS + EPS_MS;
    if (beat < loop.end && deltaMs(loop.end, beat, bpm) <= limit) {
      // Vòng kế sau reset(loop.start): mọi nốt từ loop start đều mở, trừ nốt đã chấm trước.
      const claimed = (i: number): boolean => this.nextLap.some((h) => h.index === i);
      const nextBeat = beat - (loop.end - loop.start);
      const from = this.lowerBound(loop.start - EPS_BEAT);
      const limitBeat = loop.end - EPS_BEAT;
      const hit =
        this._mode === 'wait'
          ? this.waitHit(matcher, nextBeat, bpm, from, limitBeat, claimed)
          : this.scoreHit(matcher, nextBeat, bpm, from, limitBeat, claimed);
      if (hit) {
        this.nextLap.push({ ...hit, start: loop.start, end: loop.end });
        return {
          judgement: { noteIndex: hit.index, grade: hit.grade, deltaMs: hit.deltaMs },
          wrong: false,
          lap: 'next',
        };
      }
    }
    let best = -1;
    let bestDelta = 0;
    for (let k = 0; k < this.prevTail.length; k++) {
      const t = this.prevTail[k];
      const d = deltaMs(beat, t.startBeat, bpm);
      if (Math.abs(d) > limit || !matcher(this.notes[t.index])) continue;
      if (best < 0 || Math.abs(d) < Math.abs(bestDelta)) {
        best = k;
        bestDelta = d;
      }
    }
    if (best < 0) return null;
    const [t] = this.prevTail.splice(best, 1);
    return {
      judgement: { noteIndex: t.index, grade: gradeFor(bestDelta), deltaMs: bestDelta },
      wrong: false,
      lap: 'previous',
    };
  }

  private judge(i: number, grade: Grade, delta: number | null): Judgement {
    this.status[i] = JUDGED;
    if (grade === 'miss') {
      this.miss++;
      this.combo = 0;
    } else {
      if (grade === 'perfect') this.perfect++;
      else this.good++;
      this.combo++;
      if (this.combo > this.maxCombo) this.maxCombo = this.combo;
    }
    this.noteStates[i] = PRACTICE_NOTE_STATE[grade];
    if (this.waitingIndex === i) this.waitingIndex = -1;
    this.advanceCursor();
    return { noteIndex: i, grade, deltaMs: delta };
  }

  private advanceCursor(): void {
    while (this.cursor < this.notes.length && this.status[this.cursor] !== OPEN) this.cursor++;
  }

  private clearWaiting(): void {
    const w = this.waitingIndex;
    if (w >= 0 && this.noteStates[w] === PRACTICE_NOTE_STATE.waiting) {
      this.noteStates[w] = PRACTICE_NOTE_STATE.none;
    }
    this.waitingIndex = -1;
  }

  /** Nốt đầu tiên có startBeat ≥ beat (tìm nhị phân; notes sắp theo startBeat). */
  private lowerBound(beat: number): number {
    let lo = 0;
    let hi = this.notes.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.notes[mid].startBeat < beat) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  private validBpm(bpm: number): number {
    return Number.isFinite(bpm) && bpm > 0 ? bpm : this.fallbackBpm;
  }
}

/** Lệch (ms) của lần bấm so với đầu nốt; dương = muộn. */
function deltaMs(beat: number, startBeat: number, bpm: number): number {
  return ((beat - startBeat) * 60000) / bpm;
}

/**
 * "Tự chơi để tạo bài" (SPEC 2026-10-14, Phase 3b) — lõi thuần (không React / DOM):
 *
 * - HitRecorder: ghi các lần bấm nốt (key, octave, sharp, onMs, offMs) trên trục performance.now();
 *   đơn âm — nốt mới cắt nốt đang kêu.
 * - PcCapture: PracticeInputEvent (phím Z…, giữ chuột / phím thay thế) → nốt. Nốt lấy modifier
 *   ĐANG GIỮ lúc bấm phím (trái −1, phải +1, cả hai → bỏ lần bấm, scroll → thăng); kết thúc khi
 *   nhả phím đó hoặc khi nốt khác bắt đầu.
 * - MobileCapture: 8 nút số + 4 nút chế độ trên màn hình. Chế độ quãng GIỮ trạng thái (chạm để chọn);
 *   Nửa Cung theo setting mobileSemitone ('toggle' giữ, 'oneShot' chỉ áp cho nốt kế tiếp).
 * - quantizeHits / hitsToSong / hitsToHarm: ms → beat, quantize theo lưới, đơn âm, rest, chia dòng
 *   (arrangeMelody của MIDI import) → Song (key / octave / sharp đúng như đã bấm, KHÔNG optimizer).
 */
import { DEFAULT_BASE_OCTAVE, noteMidi } from '../core/keys';
import type { KeyChoice } from '../core/keys';
import { melodyToSong } from '../core/melodyBuild';
import type { MobileOctaveMode, MobileSemitoneMode } from '../core/mobile';
import type { Placement } from '../core/optimizer';
import { serializeHarm } from '../core/serializer';
import type { NoteKey, Octave, ScrollDir, Song, TimeSig } from '../core/types';
import { DEFAULT_SECTION_NAME } from '../core/types';
import { arrangeMelody, snapBeats } from '../midi/arrange';
import type { MonoNote } from '../midi/types';
import type { MobileButton } from '../player/mobilePlan';
import type { PracticeInputEvent, PracticeModifier } from '../player/practice.types';

// ---------------------------------------------------------------------------
// Ghi nốt
// ---------------------------------------------------------------------------

export interface RecordedHit {
  key: NoteKey;
  octave: Octave;
  sharp: boolean;
  /** performance-ms lúc bấm. */
  onMs: number;
  /** performance-ms lúc nhả (hoặc lúc nốt kế tiếp cắt). */
  offMs: number;
}

/** Nốt đang kêu (chưa kết thúc). */
export type SoundingHit = Omit<RecordedHit, 'offMs'>;

/** Ghi lần bấm đơn âm: noteOn mới đóng nốt đang kêu tại thời điểm đó. */
export class HitRecorder {
  private done: RecordedHit[] = [];
  private cur: SoundingHit | null = null;

  /** Xóa mọi nốt (bắt đầu bản thu mới). */
  reset(): void {
    this.done = [];
    this.cur = null;
  }

  noteOn(choice: KeyChoice, t: number): void {
    if (!Number.isFinite(t)) return;
    this.close(t);
    this.cur = { key: choice.key, octave: choice.octave, sharp: choice.sharp, onMs: t };
  }

  /** Nhả phím `key`: chỉ kết thúc nốt đang kêu nếu đúng phím đó (nốt đã bị cắt thì bỏ qua). */
  noteOff(key: NoteKey, t: number): void {
    if (this.cur && this.cur.key === key) this.close(t);
  }

  /** Kết thúc nốt đang kêu tại `t`; trả mọi nốt đã ghi (bản sao, theo thứ tự bấm). */
  stop(t: number): RecordedHit[] {
    this.close(t);
    return [...this.done];
  }

  get hits(): readonly RecordedHit[] {
    return this.done;
  }

  get sounding(): SoundingHit | null {
    return this.cur;
  }

  private close(t: number): void {
    const c = this.cur;
    if (!c) return;
    this.cur = null;
    const off = Number.isFinite(t) ? Math.max(c.onMs, t) : c.onMs;
    this.done.push({ ...c, offMs: off });
  }
}

/** Phím / modifier đang giữ (khớp `PressedKeys` của GameBar). */
export interface CapturePressed {
  keys: NoteKey[];
  left: boolean;
  right: boolean;
  scroll: boolean;
}

const PC_MODIFIERS: readonly PracticeModifier[] = ['left', 'right', 'scroll'];

/**
 * Bàn phím + chuột PC (sự kiện đã chuẩn hóa bởi attachPracticeInput). Một modifier có thể được giữ
 * đồng thời bằng chuột và phím thay thế → theo dõi theo nguồn, nhả hết nguồn mới coi là nhả.
 */
export class PcCapture {
  readonly recorder = new HitRecorder();
  private readonly mods: Record<PracticeModifier, Set<'keyboard' | 'mouse'>> = {
    left: new Set(),
    right: new Set(),
    scroll: new Set(),
  };
  private readonly down: NoteKey[] = [];

  /** Xử lý một sự kiện; true nếu trạng thái hiển thị (phím giữ / nốt đang kêu) có thể đã đổi. */
  handle(ev: PracticeInputEvent): boolean {
    switch (ev.type) {
      case 'mod-down':
        this.mods[ev.modifier].add(ev.source);
        return true;
      case 'mod-up':
        this.mods[ev.modifier].delete(ev.source);
        return true;
      case 'key-down': {
        if (!this.down.includes(ev.key)) this.down.push(ev.key);
        const left = this.held('left');
        const right = this.held('right');
        // Trái + phải cùng lúc: game không có quãng nào như vậy → bỏ lần bấm (nốt đang kêu giữ nguyên).
        if (left && right) return true;
        const octave: Octave = left ? -1 : right ? 1 : 0;
        this.recorder.noteOn({ key: ev.key, octave, sharp: this.held('scroll') }, ev.timeStamp);
        return true;
      }
      case 'key-up': {
        const i = this.down.indexOf(ev.key);
        if (i >= 0) this.down.splice(i, 1);
        this.recorder.noteOff(ev.key, ev.timeStamp);
        return true;
      }
      default:
        // MIDI không thuộc màn này.
        return false;
    }
  }

  /** Thả mọi thứ (mất focus, dừng thu): nốt đang kêu kết thúc tại `t`. */
  releaseAll(t: number): void {
    for (const m of PC_MODIFIERS) this.mods[m].clear();
    this.down.length = 0;
    const cur = this.recorder.sounding;
    if (cur) this.recorder.noteOff(cur.key, t);
  }

  get pressed(): CapturePressed {
    return {
      keys: [...this.down],
      left: this.held('left'),
      right: this.held('right'),
      scroll: this.held('scroll'),
    };
  }

  private held(m: PracticeModifier): boolean {
    return this.mods[m].size > 0;
  }
}

/**
 * Nút cảm ứng kiểu Mobile: chạm nút chế độ quãng → giữ trạng thái tới lần chạm khác; Nửa Cung
 * 'toggle' bật/tắt giữ trạng thái, 'oneShot' bật cho đúng nốt kế tiếp rồi tự tắt (chạm lại = hủy).
 */
export class MobileCapture {
  readonly recorder = new HitRecorder();
  semitone: MobileSemitoneMode;
  private modeValue: MobileOctaveMode = 0;
  private semitoneValue = false;
  private readonly down: NoteKey[] = [];

  constructor(semitone: MobileSemitoneMode = 'toggle') {
    this.semitone = semitone;
  }

  get mode(): MobileOctaveMode {
    return this.modeValue;
  }

  get semitoneOn(): boolean {
    return this.semitoneValue;
  }

  /** Chạm một nút chế độ (thứ tự game: Nửa Cung · Ngẩng Lên · Ngẩng Tự Nhiên · Cúi Xuống). */
  tapMode(button: MobileButton): void {
    if (button === 'scroll') this.semitoneValue = !this.semitoneValue;
    else this.modeValue = button === 'left' ? -1 : button === 'right' ? 1 : 0;
  }

  noteOn(key: NoteKey, t: number): void {
    if (!this.down.includes(key)) this.down.push(key);
    this.recorder.noteOn({ key, octave: this.modeValue, sharp: this.semitoneValue }, t);
    if (this.semitone === 'oneShot') this.semitoneValue = false;
  }

  noteOff(key: NoteKey, t: number): void {
    const i = this.down.indexOf(key);
    if (i >= 0) this.down.splice(i, 1);
    this.recorder.noteOff(key, t);
  }

  /** Thả mọi nút số đang giữ (chế độ đã chọn KHÔNG mất — như game). */
  releaseAll(t: number): void {
    this.down.length = 0;
    const cur = this.recorder.sounding;
    if (cur) this.recorder.noteOff(cur.key, t);
  }

  get pressedKeys(): NoteKey[] {
    return [...this.down];
  }
}

// ---------------------------------------------------------------------------
// Quantize → Song
// ---------------------------------------------------------------------------

/** Lưới quantize (beat), như "Thu melody": 1/16, 1/32, chùm ba 1/8, tắt. */
export const RECORD_GRIDS = [0.25, 0.125, 1 / 3, 0] as const;
/** Bấm sớm hơn beat 0 trong ngần này (beat) vẫn giữ, dời về beat 0. */
export const EARLY_TOLERANCE_BEATS = 1 / 4;
/** Lưới tắt: độ dài nốt tối thiểu (beat). */
export const MIN_BEATS_GRID_OFF = 1 / 16;
/** Lưới tắt: làm tròn tới ngần này beat cho `.harm` gọn (≈ 1 ms ở 60 BPM). */
const GRID_OFF_RESOLUTION = 1000;
/**
 * Hai lần bấm cách nhau ít hơn ngần này (ms) coi là bấm lệch / chạm nhầm hai phím: bỏ nốt trước
 * (lần bấm sau thắng, như nốt mới cắt nốt cũ). Nốt bấm-nhả nhanh đứng một mình thì vẫn giữ.
 */
export const FLAM_MS = 40;
const EPS = 1e-9;

export interface QuantizeOptions {
  bpm: number;
  /** performance-ms của beat 0 (hết đếm vào). */
  startMs: number;
  /** Lưới (beat); 0 = tắt. */
  grid: number;
}

/** Nốt sau quantize: beat tính từ beat 0 của bản thu. */
export interface PlacedNote extends KeyChoice {
  startBeat: number;
  beats: number;
}

function validGrid(grid: number): number {
  return Number.isFinite(grid) && grid > 0 ? grid : 0;
}

/**
 * ms → beat ((t − startMs) / 60000 · bpm), bỏ lần bấm trước beat 0 − EARLY_TOLERANCE_BEATS (lần
 * bấm hơi sớm dời về 0), quantize đầu / cuối nốt về mốc lưới gần nhất, độ dài ≥ lưới (≥ 1/16 beat
 * khi tắt lưới), đơn âm (nốt sau cắt nốt trước), khe hở nhỏ hơn độ dài tối thiểu (chỉ có khi tắt
 * lưới) nối vào nốt trước. Hai nốt rơi cùng ô lưới: ô kế còn trống → nốt sau dời sang đó; ô kế là ô
 * của lần bấm tiếp theo → giữ nốt bấm gần mốc ô hơn (hòa → nốt sau), bỏ nốt kia — không đẩy dây
 * chuyền mọi nốt phía sau trễ một ô (một lần bấm thừa giữa đoạn legato).
 */
export function quantizeHits(hits: readonly RecordedHit[], opts: QuantizeOptions): PlacedNote[] {
  const { bpm, startMs } = opts;
  if (!(Number.isFinite(bpm) && bpm > 0) || !Number.isFinite(startMs)) return [];
  const grid = validGrid(opts.grid);
  const minLen = grid > 0 ? grid : MIN_BEATS_GRID_OFF;
  const toBeat = (ms: number): number => ((ms - startMs) / 60000) * bpm;
  const q = (beat: number): number =>
    snapBeats(
      grid > 0
        ? Math.round(beat / grid) * grid
        : Math.round(beat * GRID_OFF_RESOLUTION) / GRID_OFF_RESOLUTION,
    );

  const sorted = hits
    .filter((h) => Number.isFinite(h.onMs) && Number.isFinite(h.offMs))
    .map((h, i) => ({ h, i }))
    .sort((a, b) => a.h.onMs - b.h.onMs || a.i - b.i)
    .map((x) => x.h);

  // Lần bấm được giữ + beat thô (có thể hơi âm: bấm sớm) + ô lưới của đầu nốt.
  const kept: { h: RecordedHit; raw: number; cell: number }[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const h = sorted[i];
    const next = sorted[i + 1];
    // bấm lệch: nốt sau tới gần như ngay → bỏ nốt này
    if (next && next.onMs - h.onMs < FLAM_MS) continue;
    const raw = toBeat(h.onMs);
    if (raw < -EARLY_TOLERANCE_BEATS - EPS) continue;
    kept.push({ h, raw, cell: q(Math.max(0, raw)) });
  }

  const out: PlacedNote[] = [];
  /** Beat thô (lần bấm thật) của từng nốt trong `out`. */
  const raws: number[] = [];
  for (let i = 0; i < kept.length; i++) {
    const { h, raw, cell } = kept[i];
    const endOf = (start: number): number => {
      const end = Math.max(start, q(Math.max(0, toBeat(h.offMs))));
      return end - start < minLen - EPS ? snapBeats(start + minLen) : end;
    };
    let s = cell;
    let prev: PlacedNote | undefined = out[out.length - 1];
    if (prev) {
      const earliest = snapBeats(prev.startBeat + minLen);
      if (s < earliest - EPS) {
        const nextCell = kept[i + 1]?.cell ?? Infinity;
        if (earliest < nextCell - EPS) {
          // Ô kế còn trống → dời nốt này sang đó.
          s = earliest;
        } else {
          // Ô kế là ô của lần bấm tiếp theo: chỉ một trong hai nốt ở lại ô này — nốt bấm sát mốc
          // ô hơn (hòa → nốt sau).
          const slot = prev.startBeat;
          if (Math.abs(raw - slot) > Math.abs((raws[raws.length - 1] ?? slot) - slot) + EPS)
            continue;
          out.pop();
          raws.pop();
          prev = out[out.length - 1];
          s = slot;
        }
      }
    }
    const e = endOf(s);
    if (prev) {
      const prevEnd = prev.startBeat + prev.beats;
      // chồng nhau → cắt nốt trước; khe quá nhỏ (tắt lưới) → nối vào nốt trước
      if (prevEnd > s + EPS || s - prevEnd < minLen - EPS) {
        prev.beats = snapBeats(s - prev.startBeat);
      }
    }
    out.push({
      key: h.key,
      octave: h.octave,
      sharp: h.sharp,
      startBeat: s,
      beats: snapBeats(e - s),
    });
    raws.push(raw);
  }
  return out;
}

export interface HitsToSongOptions extends QuantizeOptions {
  timeSig: TimeSig;
  title: string;
  scrollDir: ScrollDir;
}

/** Số beat (đen) mỗi ô nhịp. */
export function beatsPerBar(ts: TimeSig): number {
  return (ts.num * 4) / ts.den;
}

/** Song dựng từ các nốt đã quantize (không optimizer: phím + modifier đúng như đã bấm). */
export function placedToSong(
  placed: readonly PlacedNote[],
  opts: Omit<HitsToSongOptions, 'startMs'>,
): Song {
  const mono: MonoNote[] = placed.map((p) => ({
    startBeat: p.startBeat,
    beats: p.beats,
    midi: noteMidi(p.key, p.octave, p.sharp, DEFAULT_BASE_OCTAVE, opts.scrollDir),
  }));
  // Chia dòng / section như tạo bài từ file: bắt đầu từ ô nhịp chứa nốt đầu, xuống dòng tại rest
  // ≥ 1 beat hoặc mỗi 2 ô nhịp, mỗi 8 ô nhịp một section "Phần N".
  const melody = arrangeMelody(mono, {
    title: opts.title,
    bpm: opts.bpm,
    timeSig: opts.timeSig,
    markers: [],
    grid: validGrid(opts.grid),
  });
  // Bài ngắn (một section) → "Main" như bài soạn tay.
  if (melody.sections.length === 1) melody.sections[0].name = DEFAULT_SECTION_NAME;

  const choices: (KeyChoice | null)[] = [];
  let k = 0;
  for (const sec of melody.sections) {
    for (const line of sec.lines) {
      for (const ev of line.events) {
        if (ev.midi === null) {
          choices.push(null);
          continue;
        }
        const p = placed[k++];
        if (!p) throw new RangeError('placedToSong: arrangeMelody trả nhiều nốt hơn đầu vào');
        choices.push({ key: p.key, octave: p.octave, sharp: p.sharp });
      }
    }
  }
  if (k !== placed.length) {
    throw new RangeError(`placedToSong: ${placed.length} nốt nhưng bố cục chỉ có ${k}`);
  }
  const modified = placed.filter((p) => p.octave !== 0 || p.sharp).length;
  const placement: Placement = {
    transpose: 0,
    shift: 0,
    cost: 0,
    stats: {
      noteCount: placed.length,
      scrollNotes: placed.filter((p) => p.sharp).length,
      holdRuns: 0,
      modifiedNotes: modified,
      foldedNotes: 0,
    },
    choices,
    folded: choices.map(() => false),
  };
  return melodyToSong(melody, placement, { scrollDir: opts.scrollDir });
}

/** Bản thu → Song (một section "Main", hoặc "Phần N" mỗi 8 ô nhịp). */
export function hitsToSong(hits: readonly RecordedHit[], opts: HitsToSongOptions): Song {
  return placedToSong(quantizeHits(hits, opts), opts);
}

/** Bản thu → văn bản `.harm` (serializeHarm). */
export function hitsToHarm(hits: readonly RecordedHit[], opts: HitsToSongOptions): string {
  return serializeHarm(hitsToSong(hits, opts));
}

export interface TakeSummary {
  notes: number;
  /** Beat đầu bài (đầu ô nhịp chứa nốt đầu — ô nhịp trống phía trước bị bỏ như khi dựng bài). */
  origin: number;
  /** Độ dài bài (beat), từ `origin` tới hết nốt cuối. */
  beats: number;
  bars: number;
  seconds: number;
}

/** Số nốt / độ dài của bản thu đã quantize (khớp bài sẽ dựng). */
export function takeSummary(placed: readonly PlacedNote[], bpm: number, ts: TimeSig): TakeSummary {
  const bpb = beatsPerBar(ts);
  if (placed.length === 0 || !(bpm > 0) || !(bpb > 0)) {
    return { notes: 0, origin: 0, beats: 0, bars: 0, seconds: 0 };
  }
  const first = placed[0].startBeat;
  const origin = Math.floor(first / bpb + EPS) * bpb;
  let end = 0;
  for (const p of placed) end = Math.max(end, p.startBeat + p.beats);
  const beats = snapBeats(end - origin);
  return {
    notes: placed.length,
    origin,
    beats,
    bars: Math.max(1, Math.ceil(beats / bpb - EPS)),
    seconds: (beats * 60) / bpm,
  };
}

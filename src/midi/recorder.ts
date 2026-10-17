import { DEFAULT_EXTRACT, defaultLegatoBeats, extractMelody } from './extract';
import type { LiveMidiEvent, MonoNote, OverlapPolicy } from './types';

/**
 * "Thu melody" (spec §6b B Dùng 2): ghi note on/off kèm timestamp (trục performance.now(), ms),
 * rồi quy đổi sang beat theo bpm, quantize và giải chồng nốt như MIDI file import.
 */

export interface RecordedNote {
  midi: number;
  onMs: number;
  offMs: number;
}

export class MelodyRecorder {
  private active = false;
  private startMs = 0;
  /** midi → thời điểm note on của nốt đang giữ. */
  private readonly held = new Map<number, number>();
  private done: RecordedNote[] = [];

  /** Bắt đầu thu (xóa bản cũ). startMs = performance-ms của beat 0 (sau count-in). */
  start(startMs: number): void {
    this.active = true;
    this.startMs = startMs;
    this.held.clear();
    this.done = [];
  }

  handle(e: LiveMidiEvent): void {
    if (!this.active || !Number.isFinite(e.timeStamp)) return;
    const on = this.held.get(e.midi);
    if (e.type === 'on') {
      // note on lặp khi chưa off: đóng nốt cũ tại đây
      if (on !== undefined) this.close(e.midi, on, e.timeStamp);
      this.held.set(e.midi, e.timeStamp);
    } else if (on !== undefined) {
      this.close(e.midi, on, e.timeStamp);
      this.held.delete(e.midi);
    }
  }

  /** Dừng thu; nốt còn giữ kết thúc tại nowMs. Trả các nốt theo thứ tự note on. */
  stop(nowMs: number): RecordedNote[] {
    if (this.active) {
      for (const [midi, on] of this.held) this.close(midi, on, nowMs);
      this.held.clear();
      this.active = false;
      this.done.sort((a, b) => a.onMs - b.onMs);
    }
    return [...this.done];
  }

  get recording(): boolean {
    return this.active;
  }

  /** performance-ms của beat 0 trong lần thu gần nhất. */
  get beatZeroMs(): number {
    return this.startMs;
  }

  /** Nốt đã kết thúc (chưa gồm nốt đang giữ). */
  get notes(): readonly RecordedNote[] {
    return this.done;
  }

  private close(midi: number, onMs: number, offMs: number): void {
    this.done.push({ midi, onMs, offMs: Math.max(onMs, offMs) });
  }
}

export interface RecordingQuantizeOptions {
  bpm: number;
  /** performance-ms của beat 0. */
  startMs: number;
  /** Lưới quantize (beat); 0 = tắt. */
  grid: number;
  overlap: OverlapPolicy;
}

/** Nốt bắt đầu sớm hơn beat 0 trong ngần này (beat) vẫn giữ, dời về beat 0 (bấm hơi sớm). */
export const RECORD_EARLY_TOLERANCE_BEATS = 1 / 4;
/** Chồng nốt ≤ ngần này (ms) khi chơi live coi là legato (nhấn phím mới trước khi nhả phím cũ). */
export const RECORD_LEGATO_MS = 150;
/** Nốt ngắn hơn (ms) coi là chạm nhầm / hợp âm bấm lệch, bỏ. */
export const RECORD_MIN_NOTE_MS = 40;

/** ms → beat, bỏ nốt trước beat 0 (trừ dung sai), rồi extractMelody với grid/overlap đã chọn. */
export function recordingToMonoNotes(
  notes: readonly RecordedNote[],
  opts: RecordingQuantizeOptions,
): MonoNote[] {
  const { bpm, startMs, grid, overlap } = opts;
  if (!Number.isFinite(bpm) || bpm <= 0 || !Number.isFinite(startMs)) return [];
  const toBeat = (ms: number): number => ((ms - startMs) / 60000) * bpm;
  const msToBeats = (ms: number): number => (ms / 60000) * bpm;

  const input: { startBeat: number; beats: number; midi: number }[] = [];
  for (const n of notes) {
    let start = toBeat(n.onMs);
    const end = toBeat(n.offMs);
    if (start < -RECORD_EARLY_TOLERANCE_BEATS - 1e-9) continue;
    start = Math.max(0, start);
    if (end <= start) continue;
    input.push({ startBeat: start, beats: end - start, midi: n.midi });
  }

  const g = Number.isFinite(grid) && grid > 0 ? grid : 0;
  return extractMelody(input, {
    overlap,
    grid: g,
    minBeats: Math.max(DEFAULT_EXTRACT.minBeats, msToBeats(RECORD_MIN_NOTE_MS)),
    legatoBeats: Math.max(defaultLegatoBeats(g), msToBeats(RECORD_LEGATO_MS)),
    mergeTies: 'never',
  });
}

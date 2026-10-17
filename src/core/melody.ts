import type { TimeSig } from './types';

/**
 * Giai điệu cao độ tuyệt đối (midi) — đầu vào chung của optimizer, cảm âm importer,
 * MIDI file import và MIDI record. Optimizer gán (key, octave, sharp) cho từng nốt
 * rồi `melodyToSong` sinh Song → serializeHarm ra .harm.
 */
export interface MelodyEvent {
  /** Cao độ midi; null = nghỉ. */
  midi: number | null;
  /** Độ dài (beat, > 0). */
  beats: number;
  /**
   * Nhóm luyến: các event NỐT liên tiếp có cùng slurId (≥ 2 nốt) thành 1 Slur khi sinh .harm.
   * Các nốt trong nhóm phải cùng `beats` (nếu không, builder tách thành nốt rời).
   */
  slurId?: number;
  /** Cảnh báo cho nốt (vd. "gập quãng") — builder sinh comment `//! …` phía trên dòng. */
  warning?: string;
}

export interface MelodyLine {
  events: MelodyEvent[];
}

export interface MelodySection {
  name: string;
  lines: MelodyLine[];
}

export interface Melody {
  title: string;
  artist?: string;
  bpm: number;
  timeSig: TimeSig;
  sections: MelodySection[];
}

/** Danh sách cao độ theo thứ tự (null = rest) — đúng thứ tự optimizer nhận. */
export function melodyPitches(melody: Melody): (number | null)[] {
  const out: (number | null)[] = [];
  for (const s of melody.sections) {
    for (const l of s.lines) {
      for (const e of l.events) out.push(e.midi);
    }
  }
  return out;
}

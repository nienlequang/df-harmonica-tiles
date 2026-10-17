import type { TimeSig } from '../core/types';

/** Contract MIDI (spec §6b): import file .mid và Web MIDI live input. */

/** Giới hạn kích thước file .mid (spec: 2 MB). */
export const MAX_MIDI_BYTES = 2 * 1024 * 1024;
/** Giới hạn file MusicXML nén .mxl (Phase 2c: 5 MB). */
export const MAX_MXL_BYTES = 5 * 1024 * 1024;
/** Giới hạn MusicXML chưa nén (.musicxml / .xml, hoặc bản nhạc giải nén từ .mxl): 20 MB. */
export const MAX_MUSICXML_BYTES = 20 * 1024 * 1024;

export interface MidiNote {
  midi: number;
  ticks: number;
  durationTicks: number;
  velocity: number;
  channel: number;
}

/** Meta event dạng chữ (marker) theo tick. */
export interface MidiMetaText {
  ticks: number;
  text: string;
}

export interface MidiTrackSummary {
  /** Index trong ParsedMidi.notes. */
  index: number;
  name: string;
  instrument: string;
  channel: number;
  /** Kênh 10 (index 9) = drum → ẩn khỏi bảng chọn track. */
  isDrum: boolean;
  noteCount: number;
  minMidi: number;
  maxMidi: number;
  avgMidi: number;
  /** 0..1 — tỉ lệ thời lượng nốt không chồng lên nốt khác trong cùng track. */
  monophonicRatio: number;
  /**
   * Mật độ: số nốt / beat (nốt đen) trên cả bài (nốt đầu của mọi track → hết nốt cuối) = số nốt mỗi
   * phút ÷ BPM. Giai điệu ≈ 1 (gợi ý melody — melodySuggest.ts).
   */
  notesPerBeat: number;
}

export interface ParsedMidi {
  fileName: string;
  /** Ticks per quarter note. */
  ppq: number;
  /** Tempo đầu tiên (mặc định 120). */
  bpm: number;
  /** Số lần đổi tempo trong file (chỉ để thông tin; dur tính theo tick nên không bị ảnh hưởng). */
  tempoChanges: number;
  /** Time signature đầu tiên (mặc định 4/4). */
  timeSig: TimeSig;
  durationTicks: number;
  /** Chỉ các track có nốt (đã bỏ track rỗng), theo thứ tự file. */
  tracks: MidiTrackSummary[];
  /** notes[i] = nốt của tracks[i], sắp theo ticks. */
  notes: MidiNote[][];
  markers: MidiMetaText[];
  /**
   * File có dấu hiệu bị cụt / hỏng nhưng vẫn đọc được một phần (chunk khai dài quá cuối file, thiếu
   * track so với header, hoặc lượt quét chặt chẽ lỗi) — có thể thiếu nốt; UI cảnh báo, không chặn.
   */
  damaged: boolean;
}

export type OverlapPolicy = 'highest' | 'lowest' | 'longest';

/** Lưới quantize (beat). 0 = tắt. */
export const QUANTIZE_GRIDS = [0.25, 0.125, 1 / 3, 0] as const;

/** Nốt đơn âm sau khi trích melody (beat tính từ tick / PPQ). */
export interface MonoNote {
  startBeat: number;
  beats: number;
  midi: number;
}

export interface ExtractOptions {
  overlap: OverlapPolicy;
  /** Lưới quantize start/dur (beat); 0 = tắt. Mặc định 0.25. */
  grid: number;
  /** Bỏ nốt ngắn hơn (beat). Mặc định 1/32. */
  minBeats: number;
}

export interface ArrangeOptions {
  /** Ngắt dòng tại rest >= n beat (mặc định 1). */
  breakRestBeats: number;
  /** Hoặc mỗi n ô nhịp (mặc định 2). */
  barsPerLine: number;
  /** Không có marker thì mỗi n ô nhịp một section "Phần N" (mặc định 8). */
  barsPerSection: number;
}

export type MidiImportErrorCode = 'too-large' | 'invalid' | 'no-notes';

export class MidiImportError extends Error {
  readonly code: MidiImportErrorCode;
  constructor(code: MidiImportErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'MidiImportError';
    this.code = code;
  }
}

// ── Web MIDI live input ──

export interface MidiInputInfo {
  id: string;
  name: string;
  manufacturer: string;
  state: 'connected' | 'disconnected';
}

/** Note on/off đã chuẩn hóa (velocity 0 = off). timeStamp: trục performance.now() (ms). */
export interface LiveMidiEvent {
  type: 'on' | 'off';
  midi: number;
  velocity: number;
  timeStamp: number;
  inputId: string;
}

import type { NoteKey, Octave } from '../core/types';

/**
 * Contract practice mode (spec §6 "Practice mode", §6b B "Dùng 1"). Mọi nguồn input (bàn phím, chuột,
 * phím thay thế, MIDI, bàn chạm Mobile) được chuẩn hóa thành PracticeInputEvent rồi mới tới logic chấm
 * điểm. `timeStamp` luôn trên trục performance.now() (ms) — KeyboardEvent/PointerEvent/MIDIMessageEvent
 * đều có timeStamp cùng trục; dùng nó (không dùng thời điểm xử lý) để chấm điểm.
 *
 * 'tap-down' / 'tap-up' (bàn chạm kiểu game Mobile, SPEC Phase 4m C): nút chế độ GIỮ TRẠNG THÁI nên lần
 * chạm nốt mang sẵn (key, octave, sharp) đã chốt lúc chạm — không phụ thuộc modifier đang giữ.
 */

export type PracticeModifier = 'left' | 'right' | 'scroll';

export type PracticeInputEvent =
  | { type: 'key-down' | 'key-up'; key: NoteKey; source: 'keyboard'; timeStamp: number }
  | {
      type: 'mod-down' | 'mod-up';
      modifier: PracticeModifier;
      source: 'keyboard' | 'mouse';
      timeStamp: number;
    }
  | {
      type: 'midi-on' | 'midi-off';
      midi: number;
      velocity: number;
      source: 'midi';
      timeStamp: number;
    }
  | {
      type: 'tap-down' | 'tap-up';
      key: NoteKey;
      /** Chế độ quãng đang chốt trên bàn chạm lúc chạm (−1 Cúi Xuống, 0 Tự Nhiên, +1 Ngẩng Lên). */
      octave: Octave;
      /** Nửa Cung đang bật lúc chạm (kể cả kiểu "chỉ 1 nốt"). */
      sharp: boolean;
      source: 'touch';
      /** Ngón chạm (PointerEvent.pointerId) — đa chạm: mỗi ngón thả đúng nốt của nó. */
      pointerId: number;
      timeStamp: number;
    };

export type Grade = 'perfect' | 'good' | 'miss';

/** Cửa sổ chấm điểm (spec): ±100 ms perfect, ±220 ms good, ngoài ra miss. */
export const PERFECT_WINDOW_MS = 100;
export const GOOD_WINDOW_MS = 220;

export interface Judgement {
  noteIndex: number;
  grade: Grade;
  /** Lệch thời gian (ms, dương = bấm muộn); null khi miss vì hết cửa sổ mà không bấm. */
  deltaMs: number | null;
}

export interface PracticeScore {
  total: number;
  judged: number;
  perfect: number;
  good: number;
  miss: number;
  combo: number;
  maxCombo: number;
  /** 0..100 = (perfect + 0.5 × good) / total × 100. */
  accuracy: number;
}

import type { Modifiers, NoteKey, Octave, ScrollDir } from './types';
import { NOTE_KEYS } from './types';

export { NOTE_KEYS };

export const DEFAULT_BASE_OCTAVE = 4;

/**
 * Chiều Nửa Cung (nút cuộn) trong game: cố định THĂNG +1 semitone (góp ý 2026-10-15 — bỏ lựa chọn
 * thăng / giáng). Dùng cho âm thanh, optimizer, sinh bài và mọi chỗ trước đây đọc Cài đặt `scrollDir`.
 * Bài cũ ghi `@scroll -1` vẫn parse được (Player báo bài viết cho giáng, sửa bằng Tối ưu lại).
 */
export const GAME_SCROLL_DIR: ScrollDir = 1;

/** Semitone so với Z (Đồ) trong cùng quãng. */
export const KEY_SEMITONES: Readonly<Record<NoteKey, number>> = {
  Z: 0,
  X: 2,
  C: 4,
  V: 5,
  B: 7,
  N: 9,
  M: 11,
  ',': 12,
};

/** Số ký hiệu trên game bar: 1 2 3 4 5 6 7 1̇ (U+0307 combining dot above). */
export const KEY_DEGREE: Readonly<Record<NoteKey, string>> = {
  Z: '1',
  X: '2',
  C: '3',
  V: '4',
  B: '5',
  N: '6',
  M: '7',
  ',': '1̇',
};

export const KEY_SOLFEGE_VI: Readonly<Record<NoteKey, string>> = {
  Z: 'Đồ',
  X: 'Rê',
  C: 'Mi',
  V: 'Fa',
  B: 'Sol',
  N: 'La',
  M: 'Si',
  ',': 'Đố',
};

export const KEY_SOLFEGE_EN: Readonly<Record<NoteKey, string>> = {
  Z: 'Do',
  X: 'Re',
  C: 'Mi',
  V: 'Fa',
  B: 'Sol',
  N: 'La',
  M: 'Ti',
  ',': "Do'",
};

/** KeyboardEvent.code của phím nốt thật. */
export const KEY_CODES: Readonly<Record<NoteKey, string>> = {
  Z: 'KeyZ',
  X: 'KeyX',
  C: 'KeyC',
  V: 'KeyV',
  B: 'KeyB',
  N: 'KeyN',
  M: 'KeyM',
  ',': 'Comma',
};

export const CODE_TO_KEY: Readonly<Record<string, NoteKey>> = Object.fromEntries(
  NOTE_KEYS.map((k) => [KEY_CODES[k], k]),
);

export function isNoteKey(value: string): value is NoteKey {
  return (NOTE_KEYS as readonly string[]).includes(value);
}

/** Index lane 0..7 theo thứ tự Z X C V B N M ,. */
export function keyIndex(key: NoteKey): number {
  return NOTE_KEYS.indexOf(key);
}

export function modifiersOf(octave: Octave, sharp: boolean): Modifiers {
  return { left: octave === -1, right: octave === 1, scroll: sharp };
}

/** midi của Z ở quãng thường. baseOctave 4 → 60 (C4). */
export function baseMidi(baseOctave: number = DEFAULT_BASE_OCTAVE): number {
  return 12 * (baseOctave + 1);
}

export function noteMidi(
  key: NoteKey,
  octave: Octave,
  sharp: boolean,
  baseOctave: number = DEFAULT_BASE_OCTAVE,
  scrollDir: ScrollDir = 1,
): number {
  return baseMidi(baseOctave) + KEY_SEMITONES[key] + 12 * octave + (sharp ? scrollDir : 0);
}

/**
 * Tầm harmonica C3..C6 khi baseOctave = 4 (trái / thường / phải).
 * Tổng quát: [baseMidi - 12, baseMidi + 24].
 */
export function playableRange(baseOctave: number = DEFAULT_BASE_OCTAVE): {
  min: number;
  max: number;
} {
  const b = baseMidi(baseOctave);
  return { min: b - 12, max: b + 24 };
}

export interface KeyChoice {
  key: NoteKey;
  octave: Octave;
  sharp: boolean;
}

/**
 * Mọi cách bấm ra đúng cao độ `midi` (không lọc theo tầm). Thứ tự ổn định:
 * octave 0 trước, rồi -1, rồi 1; không scroll trước scroll; theo thứ tự phím.
 */
export function keyChoicesForMidi(
  midi: number,
  baseOctave: number = DEFAULT_BASE_OCTAVE,
  scrollDir: ScrollDir = 1,
): KeyChoice[] {
  const out: KeyChoice[] = [];
  const octaves: Octave[] = [0, -1, 1];
  for (const sharp of [false, true]) {
    for (const octave of octaves) {
      for (const key of NOTE_KEYS) {
        if (noteMidi(key, octave, sharp, baseOctave, scrollDir) === midi) {
          out.push({ key, octave, sharp });
        }
      }
    }
  }
  return out;
}

const PITCH_NAMES_SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/** 60 → "C4". */
export function midiName(midi: number): string {
  const pc = ((midi % 12) + 12) % 12;
  return `${PITCH_NAMES_SHARP[pc]}${Math.floor(midi / 12) - 1}`;
}

export function midiToFrequency(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

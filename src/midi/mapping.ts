import { GAME_SCROLL_DIR, keyChoicesForMidi, playableRange } from '../core/keys';
import type { KeyChoice } from '../core/keys';
import type { ScrollDir } from '../core/types';
import type { Settings } from '../ui/settings';

/**
 * Mapping cao độ MIDI live → cách bấm harmonica (spec §6b B): cộng offset transpose (bán cung +
 * quãng tám) để keyboard thật khớp tầm, rồi chọn cách bấm ít modifier nhất trong tầm C3..C6.
 */

export interface MidiMapOptions {
  /** Z = C{baseOctave}. */
  baseOctave: number;
  scrollDir: ScrollDir;
  /** Dịch bán cung (-11..11). */
  transposeSemitones: number;
  /** Dịch quãng tám (-3..3). */
  transposeOctaves: number;
}

/** Lấy MidiMapOptions từ settings (baseOctave, midiTranspose*); Nửa Cung theo game (GAME_SCROLL_DIR). */
export function midiMapOptionsFromSettings(
  s: Pick<Settings, 'baseOctave' | 'midiTransposeSemitones' | 'midiTransposeOctaves'>,
): MidiMapOptions {
  return {
    baseOctave: s.baseOctave,
    scrollDir: GAME_SCROLL_DIR,
    transposeSemitones: s.midiTransposeSemitones,
    transposeOctaves: s.midiTransposeOctaves,
  };
}

/** midi + bán cung + 12 × quãng tám. */
export function transposeMidi(
  midi: number,
  opts: Pick<MidiMapOptions, 'transposeSemitones' | 'transposeOctaves'>,
): number {
  return midi + opts.transposeSemitones + 12 * opts.transposeOctaves;
}

/** Số modifier cần giữ: quãng (trái/phải) + Nửa Cung. */
export function modifierCount(choice: KeyChoice): number {
  return (choice.octave !== 0 ? 1 : 0) + (choice.sharp ? 1 : 0);
}

/**
 * Cao độ (sau transpose) → cách bấm ít modifier nhất (hòa: theo thứ tự keyChoicesForMidi).
 * null nếu ngoài playableRange(baseOctave) hoặc midi không hợp lệ.
 */
export function mapMidiNote(midi: number, opts: MidiMapOptions): KeyChoice | null {
  const pitch = transposeMidi(midi, opts);
  if (!Number.isInteger(pitch)) return null;
  const { min, max } = playableRange(opts.baseOctave);
  if (pitch < min || pitch > max) return null;
  let best: KeyChoice | null = null;
  for (const c of keyChoicesForMidi(pitch, opts.baseOctave, opts.scrollDir)) {
    if (best === null || modifierCount(c) < modifierCount(best)) best = c;
  }
  return best;
}

import type { Modifiers, Timeline } from './types';

export interface PressCounts {
  left: number;
  right: number;
  scroll: number;
}

export interface SongStats {
  noteCount: number;
  totalBeats: number;
  /** Độ dài bài (giây) ở tl.bpm. */
  durationSec: number;
  lineCount: number;
  /** Mọi section, kể cả section rỗng. */
  sectionCount: number;
  /** = tl.holdRuns.length (run theo tổ hợp octave + scroll). */
  holdRunCount: number;
  /** Số hold run có chuột trái hoặc chuột phải. */
  mouseHoldCount: number;
  /** Số nốt cần Nửa Cung (scroll). */
  scrollNoteCount: number;
  /** Số nốt có ít nhất 1 modifier. */
  modifiedNoteCount: number;
  /**
   * Số lần nhấn vật lý từng nút: mỗi nhóm nốt liên tiếp cùng cần nút đó tính 1 lần; nhóm bị cắt
   * bởi rest (khoảng trống giữa hai nốt) hoặc bởi một nốt không cần nút đó.
   */
  presses: PressCounts;
}

/** Sai số phát hiện khoảng trống (rest) giữa hai nốt liền kề. */
const GAP_EPS = 1e-9;

const DIMENSIONS: readonly (keyof Modifiers)[] = ['left', 'right', 'scroll'];

/** Thống kê bài từ timeline (editor preview, library, optimizer UI). */
export function songStats(tl: Timeline): SongStats {
  let scrollNoteCount = 0;
  let modifiedNoteCount = 0;
  const presses: PressCounts = { left: 0, right: 0, scroll: 0 };

  const notes = tl.notes;
  for (let i = 0; i < notes.length; i++) {
    const m = notes[i].modifiers;
    if (m.scroll) scrollNoteCount++;
    if (m.left || m.right || m.scroll) modifiedNoteCount++;

    const prev = i > 0 ? notes[i - 1] : null;
    const contiguous = prev !== null && notes[i].startBeat - prev.endBeat <= GAP_EPS;
    for (const dim of DIMENSIONS) {
      if (m[dim] && !(contiguous && prev !== null && prev.modifiers[dim])) presses[dim]++;
    }
  }

  let mouseHoldCount = 0;
  for (const run of tl.holdRuns) {
    if (run.modifiers.left || run.modifiers.right) mouseHoldCount++;
  }

  return {
    noteCount: notes.length,
    totalBeats: tl.totalBeats,
    durationSec: tl.bpm > 0 ? (tl.totalBeats * 60) / tl.bpm : 0,
    lineCount: tl.lines.length,
    sectionCount: tl.sections.length,
    holdRunCount: tl.holdRuns.length,
    mouseHoldCount,
    scrollNoteCount,
    modifiedNoteCount,
    presses,
  };
}

import { DEFAULT_BASE_OCTAVE, modifiersOf, noteMidi } from './keys';
import type {
  HoldRun,
  Note,
  ScrollDir,
  Song,
  Timeline,
  TimelineLine,
  TimelineNote,
  TimelineOptions,
  TimelineSection,
} from './types';

/**
 * Model → Timeline (beat tuyệt đối, midi, modifiers, hold runs). O(n) theo số đơn vị.
 *
 * - Con trỏ beat chạy từ 0 qua section → line → unit; rest chỉ đẩy con trỏ; nốt luyến nối tiếp nhau.
 * - Hold run = dải liên tiếp cùng (octave, sharp) ≠ (0, false); rest phá run, xuống dòng / sang
 *   section không phá (DECISIONS D-020, D-021).
 */
export function buildTimeline(song: Song, opts: TimelineOptions = {}): Timeline {
  const baseOctave = opts.baseOctave ?? DEFAULT_BASE_OCTAVE;
  const scrollDir: ScrollDir = opts.scrollDir ?? song.scrollDir;

  const notes: TimelineNote[] = [];
  const lines: TimelineLine[] = [];
  const sections: TimelineSection[] = [];
  const holdRuns: HoldRun[] = [];

  let cursor = 0;
  let slurCounter = 0;
  // Run đang mở (null = không có run nào nối tiếp được).
  let run: HoldRun | null = null;

  const addNote = (
    n: Note,
    lineIndex: number,
    sectionIndex: number,
    unitIndex: number,
    slur: TimelineNote['slur'],
  ): void => {
    const index = notes.length;
    const startBeat = cursor;
    const endBeat = cursor + n.beats;
    cursor = endBeat;

    let runIndex: number | null = null;
    if (n.octave !== 0 || n.sharp) {
      if (run !== null && run.octave === n.octave && run.sharp === n.sharp) {
        run.endBeat = endBeat;
        run.noteCount++;
      } else {
        run = {
          index: holdRuns.length,
          octave: n.octave,
          sharp: n.sharp,
          modifiers: modifiersOf(n.octave, n.sharp),
          startBeat,
          endBeat,
          firstNote: index,
          noteCount: 1,
        };
        holdRuns.push(run);
      }
      runIndex = run.index;
    } else {
      run = null;
    }

    notes.push({
      index,
      key: n.key,
      octave: n.octave,
      sharp: n.sharp,
      startBeat,
      endBeat,
      midi: noteMidi(n.key, n.octave, n.sharp, baseOctave, scrollDir),
      modifiers: modifiersOf(n.octave, n.sharp),
      lineIndex,
      sectionIndex,
      unitIndex,
      slur,
      runIndex,
    });
  };

  song.sections.forEach((section, sectionIndex) => {
    const sectionStart = cursor;
    const firstLine = lines.length;

    for (const line of section.lines) {
      const lineIndex = lines.length;
      const lineStart = cursor;
      const firstNote = notes.length;

      line.units.forEach((unit, unitIndex) => {
        if (unit.kind === 'rest') {
          cursor += unit.beats;
          run = null;
          return;
        }
        if (unit.kind === 'note') {
          addNote(unit, lineIndex, sectionIndex, unitIndex, null);
          return;
        }
        const count = unit.notes.length;
        if (count === 0) return;
        const id = slurCounter++;
        unit.notes.forEach((n, pos) => {
          addNote(n, lineIndex, sectionIndex, unitIndex, { id, pos, count });
        });
      });

      lines.push({
        index: lineIndex,
        sectionIndex,
        startBeat: lineStart,
        endBeat: cursor,
        firstNote,
        noteCount: notes.length - firstNote,
      });
    }

    sections.push({
      index: sectionIndex,
      name: section.name,
      startBeat: sectionStart,
      endBeat: cursor,
      firstLine,
      lineCount: lines.length - firstLine,
    });
  });

  return {
    bpm: song.bpm,
    timeSig: { num: song.timeSig.num, den: song.timeSig.den },
    beatsPerBar: (song.timeSig.num * 4) / song.timeSig.den,
    scrollDir,
    baseOctave,
    notes,
    lines,
    sections,
    holdRuns,
    totalBeats: cursor,
  };
}

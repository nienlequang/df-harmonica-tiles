import { describe, expect, it } from 'vitest';
import { songStats } from './stats';
import { buildTimeline } from './timeline';
import type { Line, Note, NoteKey, Octave, Rest, Section, Song, Unit } from './types';

const n = (key: NoteKey, beats = 1, octave: Octave = 0, sharp = false): Note => ({
  kind: 'note',
  key,
  octave,
  sharp,
  beats,
});
const L = (key: NoteKey, beats = 1): Note => n(key, beats, -1);
const R = (key: NoteKey, beats = 1): Note => n(key, beats, 1);
const S = (key: NoteKey, beats = 1): Note => n(key, beats, 0, true);
const LS = (key: NoteKey, beats = 1): Note => n(key, beats, -1, true);
const RS = (key: NoteKey, beats = 1): Note => n(key, beats, 1, true);
const rest = (beats = 1): Rest => ({ kind: 'rest', beats });
const line = (units: Unit[]): Line => ({ units });
const sec = (name: string, ...lines: Line[]): Section => ({ name, lines });
const song = (sections: Section[], bpm = 120): Song => ({
  id: 's',
  title: 'Stats',
  bpm,
  timeSig: { num: 4, den: 4 },
  scrollDir: 1,
  sections,
});
const statsOf = (...units: Unit[]) => songStats(buildTimeline(song([sec('A', line(units))])));

describe('songStats', () => {
  it('is all zeros for an empty song', () => {
    expect(songStats(buildTimeline(song([])))).toEqual({
      noteCount: 0,
      totalBeats: 0,
      durationSec: 0,
      lineCount: 0,
      sectionCount: 0,
      holdRunCount: 0,
      mouseHoldCount: 0,
      scrollNoteCount: 0,
      modifiedNoteCount: 0,
      presses: { left: 0, right: 0, scroll: 0 },
    });
  });

  it('counts notes, lines, sections (incl. empty) and duration at tl.bpm', () => {
    const st = songStats(
      buildTimeline(
        song(
          [
            sec('A', line([n('Z', 2), rest(2)]), line([n('X', 4)])),
            sec('RAP'),
            sec('B', line([n('C', 8)])),
          ],
          90,
        ),
      ),
    );
    expect(st.noteCount).toBe(3);
    expect(st.totalBeats).toBe(16);
    expect(st.durationSec).toBeCloseTo((16 * 60) / 90, 10);
    expect(st.lineCount).toBe(3);
    expect(st.sectionCount).toBe(3);
    expect(statsOf(n('Z', 8)).durationSec).toBe(4);
  });

  it('guards a non-positive bpm', () => {
    const tl = buildTimeline(song([sec('A', line([n('Z', 4)]))]));
    expect(songStats({ ...tl, bpm: 0 }).durationSec).toBe(0);
  });

  it('counts hold runs, mouse holds, scroll and modified notes', () => {
    const st = statsOf(L('Z'), n('X'), R('C'), R('V'), S('N'), n('B'), RS('M'), LS('Z'));
    expect(st.holdRunCount).toBe(5);
    expect(st.mouseHoldCount).toBe(4);
    expect(st.scrollNoteCount).toBe(3);
    expect(st.modifiedNoteCount).toBe(6);
  });

  it('counts one press for (R) (R+S) (R) while making three runs', () => {
    const st = statsOf(R('Z'), RS('X'), R('C'));
    expect(st.holdRunCount).toBe(3);
    expect(st.mouseHoldCount).toBe(3);
    expect(st.presses).toEqual({ left: 0, right: 1, scroll: 1 });
  });

  it('breaks press groups on rests and on notes that do not need the button', () => {
    expect(statsOf(R('Z'), rest(0.5), R('Z')).presses).toEqual({ left: 0, right: 2, scroll: 0 });
    expect(statsOf(L('Z'), n('X'), L('Z')).presses).toEqual({ left: 2, right: 0, scroll: 0 });
    expect(statsOf(S('N'), n('N'), S('N'), S('N')).presses).toEqual({
      left: 0,
      right: 0,
      scroll: 2,
    });
    // Scroll giữ liên tục khi đổi trái → phải.
    expect(statsOf(LS('Z'), RS('Z')).presses).toEqual({ left: 1, right: 1, scroll: 1 });
  });

  it('keeps a press across line and section breaks', () => {
    const st = songStats(
      buildTimeline(
        song([sec('A', line([R('Z')]), line([R('X')])), sec('B', line([R('C'), rest()]))]),
      ),
    );
    expect(st.presses.right).toBe(1);
    expect(st.holdRunCount).toBe(1);
  });
});

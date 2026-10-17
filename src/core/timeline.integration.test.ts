import { beforeAll, describe, expect, it } from 'vitest';
import seed1Text from '../test/fixtures/bai-thu-nhip-dieu.harm?raw';
import seed2Text from '../test/fixtures/bai-thu-lap-doan.harm?raw';
import { parseHarm } from './parser';
import { songStats } from './stats';
import { buildTimeline } from './timeline';
import { lineIndexAt, sectionIndexAt } from './timelineQuery';
import type { ParseResult, Song, Timeline } from './types';

// Cần parser thật (agent khác) — chạy ở giai đoạn tích hợp.

/** Tổng beat của mọi unit trong model. */
function sumUnitBeats(song: Song): number {
  let total = 0;
  for (const section of song.sections) {
    for (const line of section.lines) {
      for (const unit of line.units) {
        if (unit.kind === 'slur') for (const note of unit.notes) total += note.beats;
        else total += unit.beats;
      }
    }
  }
  return total;
}

function sectionIndex(tl: Timeline, name: string): number {
  const i = tl.sections.findIndex((s) => s.name === name);
  expect(i, `section ${name}`).toBeGreaterThanOrEqual(0);
  return i;
}

describe('fixture 1 — Bài thử nhịp điệu', () => {
  let parsed: ParseResult;
  let tl: Timeline;
  // Parse trong beforeAll: parser lỗi thì từng test báo fail thay vì cả suite không thu thập được.
  beforeAll(() => {
    parsed = parseHarm(seed1Text, { id: 'fixture-bai-thu-nhip-dieu' });
    tl = buildTimeline(parsed.song);
  });

  it('parses without errors', () => {
    expect(parsed.ok).toBe(true);
    expect(parsed.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  });

  it('totalBeats equals the sum of all unit beats (128 = 32 + 32 + 64)', () => {
    expect(tl.totalBeats).toBeCloseTo(sumUnitBeats(parsed.song), 9);
    expect(tl.totalBeats).toBe(128);
    expect(tl.bpm).toBe(76);
    expect(tl.beatsPerBar).toBe(4);
    const v1 = tl.sections[sectionIndex(tl, 'ĐOẠN 1')];
    const v2 = tl.sections[sectionIndex(tl, 'ĐOẠN 2')];
    const ch = tl.sections[sectionIndex(tl, 'ĐIỆP KHÚC')];
    expect([v1.startBeat, v1.endBeat]).toEqual([0, 32]);
    expect([v2.startBeat, v2.endBeat]).toEqual([32, 64]);
    expect([ch.startBeat, ch.endBeat]).toEqual([64, 128]);
    expect(ch.lineCount).toBe(8);
  });

  it('has exactly 5 right-mouse hold runs: 2 + 2 short verse holds, 1 long chorus hold', () => {
    expect(tl.holdRuns).toHaveLength(5);
    for (const run of tl.holdRuns) {
      expect(run.modifiers).toEqual({ left: false, right: true, scroll: false });
      expect(run.octave).toBe(1);
      expect(run.sharp).toBe(false);
    }
    const sectionOfRun = tl.holdRuns.map((r) => tl.notes[r.firstNote].sectionIndex);
    const v1 = sectionIndex(tl, 'ĐOẠN 1');
    const v2 = sectionIndex(tl, 'ĐOẠN 2');
    const ch = sectionIndex(tl, 'ĐIỆP KHÚC');
    expect(sectionOfRun).toEqual([v1, v1, v2, v2, ch]);

    // Hold ngắn ở đoạn = cặp luyến X-C (2 nốt, 1 beat).
    expect(tl.holdRuns.slice(0, 4).map((r) => [r.startBeat, r.endBeat, r.noteCount])).toEqual([
      [4, 5, 2],
      [20, 21, 2],
      [36, 37, 2],
      [52, 53, 2],
    ]);

    // Hold dài điệp khúc: từ đầu section tới hết "N*3.5" cuối (trước rest 0.5).
    const chorusRun = tl.holdRuns[4];
    expect(chorusRun.startBeat).toBe(tl.sections[ch].startBeat);
    expect(chorusRun.endBeat).toBe(tl.totalBeats - 0.5);
    const last = tl.notes[tl.notes.length - 1];
    expect(last.key).toBe('N');
    expect(last.endBeat - last.startBeat).toBe(3.5);
    expect(chorusRun.firstNote + chorusRun.noteCount).toBe(tl.notes.length);
    expect(tl.notes.slice(chorusRun.firstNote).every((x) => x.runIndex === 4)).toBe(true);

    const st = songStats(tl);
    expect(st.holdRunCount).toBe(5);
    expect(st.mouseHoldCount).toBe(5);
    expect(st.presses).toEqual({ left: 0, right: 5, scroll: 0 });
    expect(st.scrollNoteCount).toBe(0);
  });
});

describe('fixture 2 — Bài thử lặp đoạn và giữ chuột', () => {
  let parsed: ParseResult;
  let tl: Timeline;
  beforeAll(() => {
    parsed = parseHarm(seed2Text, { id: 'fixture-bai-thu-lap-doan' });
    tl = buildTimeline(parsed.song);
  });

  it('parses without errors and keeps totalBeats = sum of unit beats', () => {
    expect(parsed.ok).toBe(true);
    expect(tl.totalBeats).toBeCloseTo(sumUnitBeats(parsed.song), 9);
    expect(tl.scrollDir).toBe(1);
    expect(tl.bpm).toBe(160);
  });

  it('has scroll notes only in ĐOẠN 6 (4 sharp N = 70)', () => {
    const d6 = sectionIndex(tl, 'ĐOẠN 6');
    const scroll = tl.notes.filter((x) => x.modifiers.scroll);
    expect(scroll).toHaveLength(4);
    for (const x of scroll) {
      expect(x.sectionIndex).toBe(d6);
      expect(x.key).toBe('N');
      expect(x.octave).toBe(0);
      expect(x.midi).toBe(70);
    }
    const st = songStats(tl);
    expect(st.scrollNoteCount).toBe(4);
    expect(st.presses.scroll).toBe(4);
  });

  it('scrollDir override -1 lowers the sharp N to 68', () => {
    const down = buildTimeline(parsed.song, { scrollDir: -1 });
    expect(down.scrollDir).toBe(-1);
    const scroll = down.notes.filter((x) => x.sharp);
    expect(scroll).toHaveLength(4);
    for (const x of scroll) expect(x.midi).toBe(68);
    // Nốt không scroll giữ nguyên cao độ.
    const plainUp = tl.notes.filter((x) => !x.sharp).map((x) => x.midi);
    const plainDown = down.notes.filter((x) => !x.sharp).map((x) => x.midi);
    expect(plainDown).toEqual(plainUp);
  });

  it('keeps the empty ĐOẠN 3 section and skips it when locating the current section', () => {
    const empty = sectionIndex(tl, 'ĐOẠN 3');
    const d4 = sectionIndex(tl, 'ĐOẠN 4');
    const section = tl.sections[empty];
    expect(section.lineCount).toBe(0);
    expect(section.startBeat).toBe(section.endBeat);
    expect(tl.sections[d4].startBeat).toBe(section.startBeat);
    expect(sectionIndexAt(tl, section.startBeat)).toBe(d4);
    expect(lineIndexAt(tl, section.startBeat)).toBe(tl.sections[d4].firstLine);
  });

  it('expands @repeat into ĐOẠN 5 and KẾT', () => {
    const d2 = tl.sections[sectionIndex(tl, 'ĐOẠN 2')];
    const chorus = tl.sections[sectionIndex(tl, 'ĐIỆP KHÚC')];
    const d5 = tl.sections[sectionIndex(tl, 'ĐOẠN 5')];
    const ket = tl.sections[sectionIndex(tl, 'KẾT')];
    expect(d5.lineCount).toBe(d2.lineCount + chorus.lineCount);
    expect(ket.lineCount).toBe(2 + 2 * chorus.lineCount);
    expect(ket.endBeat).toBe(tl.totalBeats);
  });
});

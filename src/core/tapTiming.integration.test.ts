import { describe, expect, it } from 'vitest';
import { parseHarm } from './parser';
import { collectTapTargets, computeTapDurations, TapSession } from './tapTiming';
import type { TapTarget } from './tapTiming';
import { buildTimeline } from './timeline';
import type { Line, ParseResult } from './types';
import seed1 from '../test/fixtures/bai-thu-nhip-dieu.harm?raw';
import seed2 from '../test/fixtures/bai-thu-lap-doan.harm?raw';

// Phụ thuộc parser thật + hai fixture dài (spec §10).

function flatLines(r: ParseResult): Line[] {
  return r.song.sections.flatMap((s) => s.lines);
}
function sectionIndex(r: ParseResult, name: string): number {
  const i = r.song.sections.findIndex((s) => s.name === name);
  expect(i, name).toBeGreaterThanOrEqual(0);
  return i;
}
/** Thời điểm bấm (ms) đúng lúc bắt đầu mỗi unit cần bấm, theo độ dài hiện có trong model. */
function tapsFromModel(r: ParseResult, targets: TapTarget[]): number[] {
  const tl = buildTimeline(r.song);
  const msPerBeat = 60000 / r.song.bpm;
  const out: number[] = [];
  for (const t of targets) {
    if (t.kind === 'rest') continue;
    const note = tl.notes.find((x) => x.lineIndex === t.lineIndex && x.unitIndex === t.unitIndex);
    expect(note, `${t.lineIndex}:${t.unitIndex}`).toBeDefined();
    out.push((note?.startBeat ?? 0) * msPerBeat);
  }
  return out;
}

describe('fixture 1: Bài thử nhịp điệu', () => {
  const r = parseHarm(seed1);

  it('whole song: every unit of the 16 lines, none repeated', () => {
    const t = collectTapTargets(r, null);
    const lines = flatLines(r);
    expect(lines).toHaveLength(16);
    expect(t).toHaveLength(lines.reduce((s, l) => s + l.units.length, 0));
    expect(t.every((x) => !x.repeated)).toBe(true);
    expect(new Set(t.map((x) => x.lineIndex)).size).toBe(16);
  });

  it('first line: labels and beats', () => {
    const t = collectTapTargets(r, 0).filter((x) => x.lineIndex === 0);
    expect(t.map((x) => [x.label, x.beats])).toEqual([
      ['N', 0.5],
      ['M', 0.5],
      [',', 1],
      ['B', 2],
      ['X-C', 1],
      ['N', 2],
      ['_', 1],
    ]);
  });

  it('chorus section starts at global line 8', () => {
    const t = collectTapTargets(r, sectionIndex(r, 'ĐIỆP KHÚC'));
    expect(t[0]).toMatchObject({
      lineIndex: 8,
      unitIndex: 0,
      label: 'C',
      beats: 2,
    });
    expect(new Set(t.map((x) => x.lineIndex))).toEqual(new Set([8, 9, 10, 11, 12, 13, 14, 15]));
  });

  it('tapping exactly in time reproduces the written durations (last → lastBeats)', () => {
    const targets = collectTapTargets(r, null);
    const taps = tapsFromModel(r, targets);
    const tappable = targets.filter((x) => x.kind !== 'rest');
    for (const quantize of [true, false]) {
      const out = computeTapDurations(targets, taps, { bpm: r.song.bpm, quantize, lastBeats: 7 });
      expect(out).toHaveLength(tappable.length);
      expect(out.slice(0, -1).map((x) => x.beats)).toEqual(
        tappable.slice(0, -1).map((x) => x.beats),
      );
      expect(out.at(-1)?.beats).toBe(7);
    }
  });

  it('a TapSession over a section produces the same result', () => {
    const targets = collectTapTargets(r, sectionIndex(r, 'ĐOẠN 2'));
    const taps = tapsFromModel(r, targets);
    const s = new TapSession(targets);
    for (const ms of taps) s.tap(ms);
    expect(s.done).toBe(true);
    const out = computeTapDurations(targets, s.taps(), { bpm: 76, quantize: true });
    expect(out.map((x) => x.beats)).toEqual([
      ...targets
        .filter((x) => x.kind !== 'rest')
        .slice(0, -1)
        .map((x) => x.beats),
      1,
    ]);
  });
});

describe('fixture 2: Bài thử lặp đoạn và giữ chuột (@repeat)', () => {
  const r = parseHarm(seed2);
  const lineCount = (name: string): number =>
    r.song.sections[sectionIndex(r, name)]?.lines.length ?? 0;

  it('whole song skips @repeat lines (ĐOẠN 5 and the repeats in KẾT)', () => {
    const t = collectTapTargets(r, null);
    const lines = new Set(t.map((x) => x.lineIndex));
    expect(lines.size).toBe(6 + 5 + 8 + 7 + 6 + 2);
    expect(t.every((x) => !x.repeated)).toBe(true);
    const repeatedLines = r.lineOrigins.flatMap((o, i) => (o.repeatLine !== undefined ? [i] : []));
    expect(repeatedLines).toHaveLength(5 + 8 + 16);
    for (const i of repeatedLines) expect(lines.has(i)).toBe(false);
  });

  it('a repeated section keeps its lines, marked repeated, same notes as the originals', () => {
    const t = collectTapTargets(r, sectionIndex(r, 'ĐOẠN 5'));
    expect(lineCount('ĐOẠN 5')).toBe(13);
    expect(t.every((x) => x.repeated)).toBe(true);
    const originals = [
      ...collectTapTargets(r, sectionIndex(r, 'ĐOẠN 2')),
      ...collectTapTargets(r, sectionIndex(r, 'ĐIỆP KHÚC')),
    ];
    expect(t.map((x) => [x.label, x.beats])).toEqual(originals.map((x) => [x.label, x.beats]));
  });

  it('KẾT: its own two lines are not repeated, the two chorus repeats are', () => {
    const t = collectTapTargets(r, sectionIndex(r, 'KẾT'));
    const byLine = new Map<number, boolean>();
    for (const x of t) byLine.set(x.lineIndex, x.repeated);
    const flags = [...byLine.values()];
    expect(flags).toHaveLength(2 + 16);
    expect(flags.slice(0, 2)).toEqual([false, false]);
    expect(flags.slice(2).every(Boolean)).toBe(true);
  });

  it('empty section (ĐOẠN 3) → no targets', () => {
    expect(collectTapTargets(r, sectionIndex(r, 'ĐOẠN 3'))).toEqual([]);
  });

  it('slur with a prefix keeps its key label', () => {
    const t = collectTapTargets(r, sectionIndex(r, 'ĐOẠN 2'));
    expect(t.find((x) => x.kind === 'slur')).toMatchObject({ label: 'Z-N', beats: 1 });
  });

  it('the unit before a skipped @repeat block gets lastBeats instead of the long pause', () => {
    const targets = collectTapTargets(r, null);
    const tappable = targets.filter((x) => x.kind !== 'rest');
    // bấm đều 1 beat, riêng chỗ ĐOẠN 5 (bị bỏ) chờ 40 giây
    const gapAfter = tappable.findIndex(
      (x, k) => (tappable[k + 1]?.lineIndex ?? x.lineIndex) > x.lineIndex + 1,
    );
    expect(gapAfter).toBeGreaterThan(0);
    const beatMs = 60000 / r.song.bpm;
    const taps = tappable.map((_, k) => k * beatMs + (k > gapAfter ? 40000 : 0));
    const out = computeTapDurations(targets, taps, {
      bpm: r.song.bpm,
      quantize: true,
      lastBeats: 2,
    });
    expect(out[gapAfter]?.beats).toBe(2);
    expect(out[gapAfter - 1]?.beats).toBe(1);
    expect(out[gapAfter + 1]?.beats).toBe(1);
    // nốt trước ĐOẠN 5 là nốt cuối của ĐOẠN 4
    expect(tappable[gapAfter]?.lineIndex).toBe(6 + 5 + 8 + 7 - 1);
  });
});

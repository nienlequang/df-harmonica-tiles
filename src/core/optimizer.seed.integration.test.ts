import { describe, expect, it } from 'vitest';
import seed1 from '../test/fixtures/bai-thu-nhip-dieu.harm?raw';
import { noteMidi } from './keys';
import { melodyPitches } from './melody';
import { melodyToSong, songToMelody } from './melodyBuild';
import { evaluateTranspose, keepOriginalKey, optimizeTranspose } from './optimizer';
import { parseHarm } from './parser';
import { buildTimeline } from './timeline';

/**
 * Spec mục 9 (test optimizer trên một bài thật dài) — fixture "Bài thử nhịp điệu" (base 4, scroll +1).
 *
 * Kiểm tay (rest phá run — D-020; xuống dòng / sang section không phá):
 *
 * transpose 0 (giữ nguyên bài):
 *   - Mỗi đoạn: dòng 1 và dòng 3 có `R:X R:C` (luyến X-C, D5 E5) — 1 run 2 nốt = 4 + 2 = 6;
 *     `,` (C5) đứng ngay sau cặp luyến (dòng 3 đoạn 1, dòng 1 đoạn 2) bấm thường (giữ luôn cả `,` =
 *     R:Z tốn 4 + 3 = 7 > 6). Còn lại toàn nốt thường. → 12 / đoạn, 2 run ngắn / đoạn.
 *   - Điệp khúc: 6 + 9 + 6 + 6 + 6 + 5 + 9 + 6 = 53 nốt, thấp nhất D5 (74) nên cả 53 nốt cần R,
 *     không có rest giữa chừng → 1 run dài: 4 + 53 = 57.
 *   - Tổng: 12 + 12 + 57 = 81.
 *
 * transpose -12 (hạ 1 quãng tám): điệp khúc thành nốt thường (0), hai đoạn cần L gần hết (A3, B3, G3,
 *   E3, D3; C4 nằm giữa run thì giữ luôn thành L:,): 54 nốt L trong 8 run — rest cuối dòng 1 / 3 và cặp
 *   luyến (giờ là D4 E4 thường) phá run, xuống dòng / sang đoạn thì không. 8 × 4 + 54 = 86 > 81 →
 *   transpose 0 thắng (shift 5 = transpose -7 cũng không cần Nửa Cung: 89). (Nếu rest không phá run,
 *   -12 chỉ còn 75 — lý do của D-020.)
 */

const parsed = parseHarm(seed1, { id: 'fixture-bai-thu-nhip-dieu' });
const OPTS = { baseOctave: 4, scrollDir: 1 as const };

/** Cao độ theo thứ tự (rest = null, nốt luyến tách riêng) — đi thẳng trên units. */
function seedPitches(): (number | null)[] {
  const out: (number | null)[] = [];
  for (const s of parsed.song.sections) {
    for (const l of s.lines) {
      for (const u of l.units) {
        if (u.kind === 'rest') out.push(null);
        else if (u.kind === 'note') out.push(noteMidi(u.key, u.octave, u.sharp, 4, 1));
        else for (const n of u.notes) out.push(noteMidi(n.key, n.octave, n.sharp, 4, 1));
      }
    }
  }
  return out;
}

describe('optimizer — fixture "Bài thử nhịp điệu" (spec §9)', () => {
  const pitches = seedPitches();

  it('seed parses cleanly and songToMelody gives the same pitch sequence', () => {
    expect(parsed.ok).toBe(true);
    expect(melodyPitches(songToMelody(parsed.song, OPTS))).toEqual(pitches);
    // ĐOẠN 1: 7 + 9 + 11 + 7, ĐOẠN 2: 8 + 9 + 8 + 6, điệp khúc 53
    expect(pitches.filter((p) => p !== null)).toHaveLength(34 + 31 + 53);
  });

  it('pitch set has no Fa', () => {
    const classes = new Set(pitches.flatMap((p) => (p === null ? [] : [p % 12])));
    expect(classes.has(5)).toBe(false);
    expect([...classes].sort((a, b) => a - b)).toEqual([0, 2, 4, 7, 9, 11]);
  });

  it('only shift 0 and 5 need no scroll among the 12 shift classes', () => {
    const all = optimizeTranspose(pitches, { ...OPTS, top: 12 });
    expect(all).toHaveLength(12);
    expect(new Set(all.map((p) => p.shift)).size).toBe(12);
    const noScroll = all
      .filter((p) => p.stats.scrollNotes === 0)
      .map((p) => p.shift)
      .sort((a, b) => a - b);
    expect(noScroll).toEqual([0, 5]);
    // shift 5 (transpose -7) xếp thứ hai, đắt hơn bài gốc
    expect(all[1]).toMatchObject({ shift: 5, transpose: -7, cost: 89 });
  });

  it('the optimum is transpose 0 (shift 0, original octave), cost 81 vs 86 for -12', () => {
    const [best] = optimizeTranspose(pitches, OPTS);
    expect(best?.transpose).toBe(0);
    expect(best?.shift).toBe(0);
    expect(best?.cost).toBe(81);
    expect(best?.stats).toEqual({
      noteCount: 118,
      scrollNotes: 0,
      holdRuns: 5,
      modifiedNotes: 2 * 2 * 2 + 53,
      foldedNotes: 0,
    });
    expect(evaluateTranspose(pitches, -12, OPTS)?.cost).toBe(86);
    expect(keepOriginalKey(pitches, OPTS)?.transpose).toBe(0);
  });

  it('with that placement: each verse has 2 short hold runs, the chorus 1 long run', () => {
    const best = optimizeTranspose(pitches, OPTS)[0];
    expect(best).toBeDefined();
    if (!best) return;
    const melody = songToMelody(parsed.song, OPTS);
    const song = melodyToSong(melody, best, { id: parsed.song.id, scrollDir: 1 });
    // trùng hẳn bài gốc: cùng phím, cùng chỗ giữ / thả
    expect(song).toEqual(parsed.song);

    const tl = buildTimeline(song);
    expect(tl.holdRuns).toHaveLength(5);
    const bySection = new Map<string, number[]>();
    for (const run of tl.holdRuns) {
      const name = tl.sections[tl.notes[run.firstNote]?.sectionIndex ?? -1]?.name ?? '?';
      bySection.set(name, [...(bySection.get(name) ?? []), run.noteCount]);
    }
    expect(Object.fromEntries(bySection)).toEqual({
      'ĐOẠN 1': [2, 2],
      'ĐOẠN 2': [2, 2],
      'ĐIỆP KHÚC': [53],
    });
    for (const run of tl.holdRuns) expect(run.modifiers.right).toBe(true);
  });
});

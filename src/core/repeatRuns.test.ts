import { describe, expect, it } from 'vitest';
import { modifiersOf } from './keys';
import { parseHarm } from './parser';
import {
  REPEAT_GAP_MAX_BEATS,
  REPEAT_NOTE_MAX_BEATS,
  REPEAT_RUN_MIN,
  findRepeatRuns,
  pressesAhead,
  repeatRemaining,
  repeatRunIndex,
} from './repeatRuns';
import type { RepeatNote, RepeatRun } from './repeatRuns';
import { buildTimeline } from './timeline';
import type { NoteKey, Octave, TimelineNote } from './types';

/** Timeline của các dòng nốt `.harm` tự viết (không phải bài hát thật). */
function notesOf(...lines: string[]): TimelineNote[] {
  const r = parseHarm(['@bpm 120', '# A', ...lines].join('\n'));
  expect(r.ok, JSON.stringify(r.diagnostics)).toBe(true);
  return buildTimeline(r.song).notes;
}

/** [nốt đầu, số nốt] của từng đoạn — gọn để so. */
const spans = (runs: readonly RepeatRun[]): [number, number][] =>
  runs.map((r) => [r.firstNote, r.noteCount]);

const runsOf = (...lines: string[]): RepeatRun[] => findRepeatRuns(notesOf(...lines));

/** Nốt dựng tay (chỉ các trường việc dò đoạn cần). */
const raw = (
  key: NoteKey,
  startBeat: number,
  endBeat: number,
  octave: Octave = 0,
  sharp = false,
): RepeatNote => ({
  key,
  octave,
  sharp,
  startBeat,
  endBeat,
  modifiers: modifiersOf(octave, sharp),
  slur: null,
});

describe('findRepeatRuns', () => {
  it('hằng số theo góp ý: hơn 3 lần (≥ 4), nốt ≤ 0,5 beat, khoảng nghỉ ≤ 0,25 beat', () => {
    expect(REPEAT_RUN_MIN).toBe(4);
    expect(REPEAT_NOTE_MAX_BEATS).toBe(0.5);
    expect(REPEAT_GAP_MAX_BEATS).toBe(0.25);
  });

  it('không có nốt → không đoạn nào', () => {
    expect(findRepeatRuns([])).toEqual([]);
    expect(runsOf('_*2')).toEqual([]);
  });

  it('đúng 3 lần → không phải đoạn; 4 lần → một đoạn', () => {
    expect(runsOf('Z X N*0.5 N*0.5 N*0.5 C')).toEqual([]);
    const runs = runsOf('Z X N*0.5 N*0.5 N*0.5 N*0.5 C');
    expect(runs).toEqual([
      {
        index: 0,
        firstNote: 2,
        noteCount: 4,
        startBeat: 2,
        endBeat: 4,
        key: 'N',
        octave: 0,
        sharp: false,
        modifiers: { left: false, right: false, scroll: false },
      },
    ]);
  });

  it('nốt 0,5 / 0,25 / 1/3 beat đều được; dãy dài nhất có thể (không cắt thành nhiều đoạn)', () => {
    expect(spans(runsOf('B*0.25 B*0.25 B*0.5 B*0.5 B*0.25 B*0.25 B*0.5'))).toEqual([[0, 7]]);
    // Chùm ba: 1/3 + 1/3 + 1/3 không cộng tròn — sai số ε.
    expect(spans(runsOf('V*1/3 V*1/3 V*1/3 V*1/3 V*1/3 V*1/3'))).toEqual([[0, 6]]);
  });

  it('một nốt 0,75 beat (hoặc 1 beat) cắt đoạn', () => {
    expect(spans(runsOf('N*0.5 N*0.5 N*0.5 N*0.75 N*0.5 N*0.5 N*0.5'))).toEqual([]);
    expect(spans(runsOf('N*0.5 N*0.5 N*0.5 N*0.5 N*0.75 N*0.5 N*0.5 N*0.5 N*0.5 N N*0.5'))).toEqual(
      [
        [0, 4],
        [5, 4],
      ],
    );
    // Nốt dài đứng đầu / cuối dãy không thuộc đoạn.
    expect(spans(runsOf('M*2 M*0.5 M*0.5 M*0.5 M*0.5 M*1'))).toEqual([[1, 4]]);
  });

  it('khác modifier / quãng / Nửa Cung (= khác chế độ Mobile) cắt đoạn', () => {
    // Ngẩng Lên (R:) ở giữa → hai nửa 2 + 3 nốt.
    expect(spans(runsOf('N*0.5 N*0.5 R:N*0.5 N*0.5 N*0.5 N*0.5'))).toEqual([]);
    expect(spans(runsOf('N*0.5 N*0.5 N*0.5 N*0.5 L:N*0.5 L:N*0.5 L:N*0.5 L:N*0.5'))).toEqual([
      [0, 4],
      [4, 4],
    ]);
    expect(spans(runsOf('C*0.5 C*0.5 S:C*0.5 C*0.5 C*0.5'))).toEqual([]);
    // Cùng modifier giữ suốt đoạn: một đoạn, ghi đúng quãng / Nửa Cung / modifier.
    const held = runsOf(
      '[giữ chuột phải] [giữ scroll] X*0.5 X*0.5 X*0.5 X*0.5 [thả scroll] [thả chuột phải]',
    );
    expect(spans(held)).toEqual([[0, 4]]);
    expect(held[0]).toMatchObject({
      key: 'X',
      octave: 1,
      sharp: true,
      modifiers: { left: false, right: true, scroll: true },
    });
  });

  it('khác phím ở giữa cắt đoạn (đoạn không bao giờ vắt qua nốt khác)', () => {
    expect(spans(runsOf('N*0.5 N*0.5 B*0.5 N*0.5 N*0.5'))).toEqual([]);
    expect(spans(runsOf('N*0.5 N*0.5 N*0.5 B*0.5 N*0.5 N*0.5 N*0.5 N*0.5'))).toEqual([[4, 4]]);
  });

  it('khoảng nghỉ > 0,25 beat cắt đoạn; ≤ 0,25 beat thì không', () => {
    expect(spans(runsOf('N*0.5 N*0.5 _*0.5 N*0.5 N*0.5'))).toEqual([]);
    expect(spans(runsOf('N*0.5 N*0.5 _*0.3 N*0.5 N*0.5'))).toEqual([]);
    expect(spans(runsOf('Z*0.25 _*0.25 Z*0.25 _*0.25 Z*0.25 _*0.25 Z*0.25'))).toEqual([[0, 4]]);
    // Nghỉ dài ở giữa: hai đoạn riêng.
    expect(spans(runsOf('Z*0.5 Z*0.5 Z*0.5 Z*0.5 _ Z*0.5 Z*0.5 Z*0.5 Z*0.5'))).toEqual([
      [0, 4],
      [4, 4],
    ]);
  });

  it('nốt thuộc luyến không bao giờ nằm trong đoạn', () => {
    expect(spans(runsOf('N*0.5 N*0.5 N-N N*0.5 N*0.5'))).toEqual([]);
    expect(spans(runsOf('N-N N*0.5 N*0.5 N*0.5 N*0.5'))).toEqual([[2, 4]]);
    expect(spans(runsOf('N*0.5 N*0.5 N*0.5 N*0.5 N-N'))).toEqual([[0, 4]]);
  });

  it('hai đoạn liền nhau ở hai phím khác nhau', () => {
    const runs = runsOf('N*0.5 N*0.5 N*0.5 N*0.5 B*0.25 B*0.25 B*0.25 B*0.25 B*0.25');
    expect(spans(runs)).toEqual([
      [0, 4],
      [4, 5],
    ]);
    expect(runs.map((r) => [r.key, r.index, r.startBeat, r.endBeat])).toEqual([
      ['N', 0, 0, 2],
      ['B', 1, 2, 3.25],
    ]);
  });

  it('đoạn ở đầu bài và cuối bài; vắt qua xuống dòng / sang đoạn bài', () => {
    expect(spans(runsOf(',*0.5 ,*0.5 ,*0.5 ,*0.5 Z'))).toEqual([[0, 4]]);
    expect(spans(runsOf('Z M*0.5 M*0.5 M*0.5 M*0.5'))).toEqual([[1, 4]]);
    expect(spans(runsOf('C C*0.5 C*0.5', 'C*0.5 C*0.5', '# B', 'C*0.5 X'))).toEqual([[1, 5]]);
  });

  it('nốt dựng tay: chỉ nhìn phím / quãng / Nửa Cung / độ dài / khoảng nghỉ', () => {
    const notes = [
      raw('Z', 0, 0.5),
      raw('Z', 0.5, 1),
      raw('Z', 1.25, 1.75), // nghỉ đúng 0,25
      raw('Z', 1.75, 2.25),
      raw('Z', 2.25, 2.75, -1), // khác quãng
    ];
    expect(spans(findRepeatRuns(notes))).toEqual([[0, 4]]);
  });
});

describe('repeatRunIndex', () => {
  it('nốt → đoạn chứa nó, -1 ở ngoài', () => {
    const notes = notesOf('Z N*0.5 N*0.5 N*0.5 N*0.5 X B*0.5 B*0.5 B*0.5 B*0.5');
    const runs = findRepeatRuns(notes);
    expect(Array.from(repeatRunIndex(runs, notes.length))).toEqual([
      -1, 0, 0, 0, 0, -1, 1, 1, 1, 1,
    ]);
    expect(Array.from(repeatRunIndex([], 3))).toEqual([-1, -1, -1]);
    expect(repeatRunIndex(runs, 0).length).toBe(0);
  });
});

describe('repeatRemaining', () => {
  const notes = notesOf('Z N*0.5 N*0.5 N*0.5 N*0.5 N*0.5 X');
  const starts = notes.map((n) => n.startBeat);
  const [run] = findRepeatRuns(notes);

  it('đoạn 5 lần bấm ở beat 1..3', () => {
    expect(run).toMatchObject({ firstNote: 1, noteCount: 5, startBeat: 1, endBeat: 3.5 });
  });

  it('trước khi thanh chạm hit line = đủ số; ngay sau lần bấm đầu = n − 1; sau lần bấm cuối = 0', () => {
    expect(repeatRemaining(run, starts, -4)).toBe(5);
    expect(repeatRemaining(run, starts, 0.999)).toBe(5);
    // Nốt ĐÚNG ở hit line (dừng ở đầu dòng / chế độ chờ) chưa bấm; sai số float nghiêng về "chưa bấm".
    expect(repeatRemaining(run, starts, 1)).toBe(5);
    expect(repeatRemaining(run, starts, 1 + 1e-9)).toBe(5);
    expect(repeatRemaining(run, starts, 1.01)).toBe(4);
    expect(repeatRemaining(run, starts, 1.6)).toBe(3);
    expect(repeatRemaining(run, starts, 2.4)).toBe(2);
    expect(repeatRemaining(run, starts, 2.6)).toBe(1);
    expect(repeatRemaining(run, starts, 3)).toBe(1);
    expect(repeatRemaining(run, starts, 3.01)).toBe(0);
    expect(repeatRemaining(run, starts, 3.4)).toBe(0);
    expect(repeatRemaining(run, starts, 100)).toBe(0);
  });

  it('until (loop end): nốt bắt đầu từ đó không tính', () => {
    expect(repeatRemaining(run, starts, 0, 2)).toBe(2);
    expect(repeatRemaining(run, starts, 1.2, 2.5)).toBe(2);
    expect(repeatRemaining(run, starts, 0, 1)).toBe(0);
    expect(repeatRemaining(run, starts, 0, Infinity)).toBe(5);
  });

  it('pressesAhead: dải nốt bất kỳ của đoạn (vd. bỏ nốt của ô nhịp đếm vào)', () => {
    expect(pressesAhead(starts, 1, 6, 0)).toBe(5);
    expect(pressesAhead(starts, 3, 6, 0)).toBe(3);
    expect(pressesAhead(starts, 3, 6, 2)).toBe(3);
    expect(pressesAhead(starts, 3, 6, 2.1)).toBe(2);
    expect(pressesAhead(starts, 3, 6, 2, 3)).toBe(2);
    expect(pressesAhead(starts, 4, 4, 0)).toBe(0);
    expect(pressesAhead(starts, -3, 2, 0.5)).toBe(1);
  });

  it('đầu vào lạ: đoạn rỗng / vượt mảng → 0', () => {
    expect(repeatRemaining({ firstNote: 0, noteCount: 0 }, starts, 0)).toBe(0);
    expect(repeatRemaining({ firstNote: 10, noteCount: 4 }, starts, 0)).toBe(0);
    expect(repeatRemaining(run, new Float64Array(starts), 1.6)).toBe(3);
  });
});

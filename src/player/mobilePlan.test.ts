import { describe, expect, it } from 'vitest';
import { modifiersOf } from '../core/keys';
import { parseHarm } from '../core/parser';
import { buildTimeline } from '../core/timeline';
import seedQuocCa from '../library/seeds/quoc-ca-viet-nam.harm?raw';
// Bài tự soạn chỉ dùng cho test (src/test/fixtures/): kết thúc ở Ngẩng Lên.
import fixtureRhythm from '../test/fixtures/bai-thu-nhip-dieu.harm?raw';
import type { MobileCue } from '../core/mobile';
import type { NoteKey, Octave, Timeline, TimelineNote } from '../core/types';
import {
  CUE_SOON_BEATS,
  MOBILE_BUTTONS,
  MobileEntryTracker,
  NATURAL_LATCH,
  cueButton,
  cueLabel,
  cuesAtSameBeat,
  mobileEntryFor,
  mobileLatchAt,
  mobilePlanFor,
  mobileUiAt,
  modeButton,
} from './mobilePlan';

function note(index: number, key: NoteKey, start: number, octave: Octave, sharp = false) {
  const n: TimelineNote = {
    index,
    key,
    octave,
    sharp,
    startBeat: start,
    endBeat: start + 1,
    midi: 60,
    modifiers: modifiersOf(octave, sharp),
    lineIndex: 0,
    sectionIndex: 0,
    unitIndex: index,
    slur: null,
    runIndex: null,
  };
  return n;
}

// Z (0) · N Cúi Xuống (1) · M# Cúi Xuống (2) · X thường (4, sau rest)
const TL: Timeline = {
  bpm: 120,
  timeSig: { num: 4, den: 4 },
  beatsPerBar: 4,
  scrollDir: 1,
  baseOctave: 4,
  notes: [note(0, 'Z', 0, 0), note(1, 'N', 1, -1), note(2, 'M', 2, -1, true), note(3, 'X', 4, 0)],
  lines: [],
  sections: [],
  holdRuns: [],
  totalBeats: 5,
};

const LABELS = { left: 'L', right: 'R', natural: 'N', scroll: 'S' };

describe('mobilePlan', () => {
  it('caches one plan per timeline and semitone mode', () => {
    const a = mobilePlanFor(TL, 'toggle');
    expect(mobilePlanFor(TL, 'toggle')).toBe(a);
    const b = mobilePlanFor(TL, 'oneShot');
    expect(b).not.toBe(a);
    expect(mobilePlanFor(TL, 'oneShot')).toBe(b);
    expect(mobilePlanFor({ ...TL }, 'toggle')).not.toBe(a);
  });

  it('buttons and labels: game order, mode → button, cue → button', () => {
    expect(MOBILE_BUTTONS).toEqual(['scroll', 'right', 'natural', 'left']);
    expect([modeButton(-1), modeButton(0), modeButton(1)]).toEqual(['left', 'natural', 'right']);
    const oct: MobileCue = { beat: 1, noteIndex: 1, kind: 'octave', mode: -1 };
    const semi: MobileCue = { beat: 2, noteIndex: 2, kind: 'semitone', on: false };
    expect(cueButton(oct)).toBe('left');
    expect(cueButton(semi)).toBe('scroll');
    expect(cueLabel(oct, LABELS)).toBe('L');
    expect(cueLabel(semi, LABELS)).toBe('S');
  });

  it('cuesAtSameBeat groups octave + semitone cues of one note', () => {
    const plan = mobilePlanFor(TL, 'toggle');
    expect(cuesAtSameBeat(plan, null)).toEqual([]);
    // Beat 4: về Ngẩng Tự Nhiên + tắt Nửa Cung.
    const at4 = plan.cues.filter((c) => c.beat === 4);
    expect(at4).toHaveLength(2);
    expect(cuesAtSameBeat(plan, at4[0])).toEqual(at4);
    expect(cuesAtSameBeat(plan, at4[1])).toEqual(at4);
  });

  it('mobileUiAt: soon window, latch across the rest, object reuse', () => {
    const plan = mobilePlanFor(TL, 'toggle');
    const s0 = mobileUiAt(plan, 0, null);
    expect(s0).toMatchObject({ mode: 0, semitoneOn: false, cueSoon: true });
    expect(s0.nextCues.map((c) => c.beat)).toEqual([1]);
    expect(mobileUiAt(plan, 0, s0)).toBe(s0);
    const s3 = mobileUiAt(plan, 3, s0); // rest: chế độ + Nửa Cung giữ nguyên
    expect(s3).toMatchObject({ mode: -1, semitoneOn: true });
    expect(s3.nextCues.map((c) => c.kind)).toEqual(['octave', 'semitone']);
    expect(s3.cueSoon).toBe(true);
    const early = mobileUiAt(plan, 4 - CUE_SOON_BEATS - 0.5, null);
    expect(early.cueSoon).toBe(false);
    const end = mobileUiAt(plan, 4.5, s3);
    expect(end).toMatchObject({ mode: 0, semitoneOn: false, nextCues: [], cueSoon: false });
    expect(mobileUiAt(plan, 4.8, end)).toBe(end);
  });

  describe('chế độ đang giữ + cue vào lại (game giữ chế độ qua các lần phát)', () => {
    const brief = (cs: readonly MobileCue[]) =>
      cs.map((c) => [c.beat, c.noteIndex, c.kind === 'octave' ? c.mode : c.on]);

    it('mobileLatchAt: nốt bắt đầu đúng tại vị trí chưa chơi; oneShot luôn tắt', () => {
      const plan = mobilePlanFor(TL, 'toggle');
      expect(mobileLatchAt(plan, 1, null)).toEqual({ mode: 0, semitoneOn: false });
      expect(mobileLatchAt(plan, 1.5, null)).toEqual({ mode: -1, semitoneOn: false });
      expect(mobileLatchAt(plan, 3, null)).toEqual({ mode: -1, semitoneOn: true });
      expect(mobileLatchAt(plan, 5, null)).toEqual({ mode: 0, semitoneOn: false });
      expect(mobileLatchAt(mobilePlanFor(TL, 'oneShot'), 2.5, null).semitoneOn).toBe(false);
      // Chưa tới nốt vào lại của lượt → vẫn là chế độ lúc vào lượt.
      const entry = mobileEntryFor(plan, TL, 1, { mode: 1, semitoneOn: true });
      expect(mobileLatchAt(plan, 1, entry)).toEqual({ mode: 1, semitoneOn: true });
    });

    it('mobileEntryFor: cue thay cue của kế hoạch tại nốt đầu, không chạm Nửa Cung mò', () => {
      const plan = mobilePlanFor(TL, 'toggle');
      // Kết thúc ở tự nhiên / tắt → vào lại từ 0: nốt 0 tự nhiên → không cần chạm.
      expect(mobileEntryFor(plan, TL, 0, NATURAL_LATCH)).toMatchObject({
        beat: 0,
        noteIndex: 0,
        cues: [],
      });
      // Đang Cúi Xuống + Nửa Cung bật, vào lại từ 0 → về Ngẩng Tự Nhiên + tắt Nửa Cung.
      const back = mobileEntryFor(plan, TL, 0, { mode: -1, semitoneOn: true });
      expect(brief(back!.cues)).toEqual([
        [0, 0, 0],
        [0, 0, false],
      ]);
      // Nhảy tới nốt 2 (M# Cúi Xuống) khi đang Cúi Xuống + bật: kế hoạch có "chạm Nửa Cung" ở đó,
      // nhưng Nửa Cung đã bật → chạm nữa sẽ TẮT nó → không có cue nào.
      expect(mobileEntryFor(plan, TL, 2, { mode: -1, semitoneOn: true })?.cues).toEqual([]);
      // Giữa một nốt / trong nghỉ → nốt kế tiếp.
      expect(mobileEntryFor(plan, TL, 2.5, NATURAL_LATCH)?.noteIndex).toBe(3);
      expect(mobileEntryFor(plan, TL, 4.5, NATURAL_LATCH)).toBeNull();
      // oneShot: chạm Nửa Cung trước mỗi nốt thăng giữ nguyên như kế hoạch.
      const one = mobilePlanFor(TL, 'oneShot');
      expect(brief(mobileEntryFor(one, TL, 2, NATURAL_LATCH)!.cues)).toEqual([
        [2, 2, -1],
        [2, 2, true],
      ]);
    });

    it('mobileUiAt + cue vào lại: hiện chế độ đang giữ tới hết nốt vào lại, rồi theo kế hoạch', () => {
      const plan = mobilePlanFor(TL, 'toggle');
      const entry = mobileEntryFor(plan, TL, 0, { mode: -1, semitoneOn: true });
      const at0 = mobileUiAt(plan, 0, null, { entry });
      expect(at0).toMatchObject({ mode: -1, semitoneOn: true, cueSoon: true });
      expect(at0.nextCues).toBe(entry!.cues);
      expect(mobileUiAt(plan, 0, at0, { entry })).toBe(at0);
      const early = mobileUiAt(plan, -3, null, { entry }); // đếm vào / đếm ngược trước nốt
      expect(early).toMatchObject({ mode: -1, cueSoon: false });
      const after = mobileUiAt(plan, 0.5, at0, { entry });
      expect(after).toMatchObject({ mode: 0, semitoneOn: false });
      expect(brief(after.nextCues)).toEqual([[1, 1, -1]]);
      // Cue vào lại rỗng: bỏ luôn cue của kế hoạch ở nốt đó (đã đúng chế độ).
      const same = mobileEntryFor(plan, TL, 2, { mode: -1, semitoneOn: true });
      const st = mobileUiAt(plan, 2, null, { entry: same });
      expect(st).toMatchObject({ mode: -1, semitoneOn: true });
      expect(brief(st.nextCues)).toEqual([
        [4, 3, 0],
        [4, 3, false],
      ]);
    });

    it('mobileUiAt + loop: không báo cue từ loop end trở đi; cue vòng sau tính qua wrap', () => {
      const plan = mobilePlanFor(TL, 'toggle');
      // Loop [0, 1): cue Cúi Xuống @1 ngoài vòng → không có lần chạm nào.
      const tr = new MobileEntryTracker();
      const loopA = { start: 0, end: 1 };
      const a = mobileUiAt(plan, 0.5, null, {
        loop: { ...loopA, entry: tr.loopEntry(plan, TL, loopA) },
      });
      expect(a).toMatchObject({ nextCues: [], cueSoon: false });
      // Loop [0, 3): hết vòng ở Cúi Xuống + Nửa Cung bật → vòng sau: Ngẩng Tự Nhiên + tắt ở nốt 0.
      const loopB = { start: 0, end: 3 };
      const le = tr.loopEntry(plan, TL, loopB);
      expect(brief(le!.cues)).toEqual([
        [0, 0, 0],
        [0, 0, false],
      ]);
      expect(tr.loopEntry(plan, TL, loopB)).toBe(le);
      const b = mobileUiAt(plan, 2.2, null, { loop: { ...loopB, entry: le } });
      expect(b.nextCues).toBe(le!.cues);
      expect(b.cueSoon).toBe(true); // 0.8 beat tới wrap + 0
      // Còn cue trong vòng → cue đó trước.
      const inLoop = mobileUiAt(plan, 1.5, null, { loop: { ...loopB, entry: le } });
      expect(brief(inLoop.nextCues)).toEqual([[2, 2, true]]);
    });

    it('bài kết thúc ở Ngẩng Lên (fixture 1): chơi lại → nhắc Ngẩng Tự Nhiên ở nốt 0', () => {
      const tl = buildTimeline(parseHarm(fixtureRhythm).song);
      const plan = mobilePlanFor(tl, 'toggle');
      expect(plan.cues[0]?.noteIndex).toBeGreaterThan(0); // nốt đầu tự nhiên → kế hoạch không có cue
      const tr = new MobileEntryTracker();
      expect(tr.entry(plan, tl)?.cues).toEqual([]);
      tr.move(plan, tl, tl.totalBeats, 0);
      const entry = tr.entry(plan, tl);
      expect(entry?.latch.mode).toBe(1);
      expect(brief(entry!.cues)).toEqual([[tl.notes[0].startBeat, 0, 0]]);
      const ui = mobileUiAt(plan, 0, null, { entry });
      expect(ui).toMatchObject({ mode: 1, cueSoon: true });
      expect(ui.nextCues).toBe(entry!.cues);
    });

    it('bài mẫu Quốc ca (e2e dựa vào): dòng 4 = đầu "Phần 2", cả dòng Ngẩng Lên → nhảy tới từ Ngẩng Tự Nhiên phải chạm Ngẩng Lên', () => {
      const tl = buildTimeline(parseHarm(seedQuocCa).song);
      const line = tl.lines[4]!;
      const section = tl.sections[line.sectionIndex]!;
      expect(section.name).toBe('Phần 2');
      expect(section.firstLine).toBe(4);
      const notes = tl.notes.slice(line.firstNote, line.firstNote + line.noteCount);
      expect(notes.length).toBeGreaterThan(3);
      expect(notes.every((n) => n.octave === 1 && !n.sharp)).toBe(true);
      // Nốt đầu bài tự nhiên: mở bài ở chế độ Ngẩng Tự Nhiên là đúng.
      expect(tl.notes[0]).toMatchObject({ octave: 0, sharp: false });
      const plan = mobilePlanFor(tl, 'toggle');
      const entry = mobileEntryFor(plan, tl, line.startBeat, NATURAL_LATCH);
      expect(brief(entry!.cues)).toEqual([[notes[0]!.startBeat, line.firstNote, 1]]);
      expect(cueButton(entry!.cues[0]!)).toBe('right');
    });

    it('MobileEntryTracker: pause / phát tiếp tại chỗ không đổi; nhảy giữ chế độ đã chơi tới', () => {
      const plan = mobilePlanFor(TL, 'toggle');
      const tr = new MobileEntryTracker();
      const first = tr.entry(plan, TL);
      expect(first?.cues).toEqual([]);
      expect(tr.entry(plan, TL)).toBe(first);
      expect(tr.move(plan, TL, 3.5, 3.5 + 1e-5)).toBe(false);
      expect(tr.entry(plan, TL)).toBe(first);
      // Đã chơi tới 3.5 (Cúi Xuống + Nửa Cung bật) rồi chạy lại từ 0.
      expect(tr.move(plan, TL, 3.5, 0)).toBe(true);
      expect(brief(tr.entry(plan, TL)!.cues)).toEqual([
        [0, 0, 0],
        [0, 0, false],
      ]);
      // Nhảy tiếp khi chưa chơi (vẫn ở nốt vào lại) → chế độ đang giữ không đổi.
      tr.move(plan, TL, 0, 1);
      expect(tr.entry(plan, TL)?.latch).toEqual({ mode: -1, semitoneOn: true });
      expect(brief(tr.entry(plan, TL)!.cues)).toEqual([[1, 1, false]]);
    });
  });
});

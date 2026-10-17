import { describe, expect, it } from 'vitest';
import seed1 from '../test/fixtures/bai-thu-nhip-dieu.harm?raw';
import seed2 from '../test/fixtures/bai-thu-lap-doan.harm?raw';
import { KEY_DEGREE } from './keys';
import type { MobileCue, MobilePlan } from './mobile';
import { buildMobilePlan, jianpuLabel, jianpuText, mobileStateAt } from './mobile';
import { parseHarm } from './parser';
import { buildTimeline } from './timeline';
import type {
  Line,
  Note,
  NoteKey,
  Octave,
  Rest,
  Section,
  Slur,
  Song,
  Timeline,
  Unit,
} from './types';
import { NOTE_KEYS } from './types';

// Model dựng tay — không phụ thuộc parser.
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
const rest = (beats = 1): Rest => ({ kind: 'rest', beats });
const slur = (...notes: Note[]): Slur => ({ kind: 'slur', notes });
const line = (...units: Unit[]): Line => ({ units });
const sec = (name: string, ...lines: Line[]): Section => ({ name, lines });
const song = (...sections: Section[]): Song => ({
  id: 't',
  title: 'Test',
  bpm: 120,
  timeSig: { num: 4, den: 4 },
  scrollDir: 1,
  sections,
});
const tlOf = (...units: Unit[]): Timeline => buildTimeline(song(sec('Main', line(...units))));

const DOT_ABOVE = '̇';
const DOT_BELOW = '̣';

function seedTimeline(text: string): Timeline {
  const r = parseHarm(text);
  expect(r.ok).toBe(true);
  return buildTimeline(r.song);
}

/** Cue gọn để so: "o:-1@3#5" (octave), "s:on@3#5" (semitone). */
function fmt(c: MobileCue): string {
  return c.kind === 'octave'
    ? `o:${c.mode}@${c.beat}#${c.noteIndex}`
    : `s:${c.on ? 'on' : 'off'}@${c.beat}#${c.noteIndex}`;
}

describe('jianpuLabel / jianpuText', () => {
  // [key, octave −1, octave 0, octave +1] — văn bản mong đợi
  const table: [NoteKey, string, string, string][] = [
    ['Z', `1${DOT_BELOW}`, '1', `1${DOT_ABOVE}`],
    ['X', `2${DOT_BELOW}`, '2', `2${DOT_ABOVE}`],
    ['C', `3${DOT_BELOW}`, '3', `3${DOT_ABOVE}`],
    ['V', `4${DOT_BELOW}`, '4', `4${DOT_ABOVE}`],
    ['B', `5${DOT_BELOW}`, '5', `5${DOT_ABOVE}`],
    ['N', `6${DOT_BELOW}`, '6', `6${DOT_ABOVE}`],
    ['M', `7${DOT_BELOW}`, '7', `7${DOT_ABOVE}`],
    [',', '1', `1${DOT_ABOVE}`, `1${DOT_ABOVE}${DOT_ABOVE}`],
  ];

  it('covers every key × octave', () => {
    expect(table.map((r) => r[0])).toEqual([...NOTE_KEYS]);
    for (const [key, low, mid, high] of table) {
      expect(jianpuText(jianpuLabel(key, -1)), `${key} -1`).toBe(low);
      expect(jianpuText(jianpuLabel(key, 0)), `${key} 0`).toBe(mid);
      expect(jianpuText(jianpuLabel(key, 1)), `${key} +1`).toBe(high);
    }
  });

  it('labels: Z..M → 1..7 with dots from the octave; "," is 1 one octave up', () => {
    expect(jianpuLabel('Z', -1)).toEqual({ digit: '1', dotsAbove: 0, dotsBelow: 1 });
    expect(jianpuLabel('N', 0)).toEqual({ digit: '6', dotsAbove: 0, dotsBelow: 0 });
    expect(jianpuLabel('M', 1)).toEqual({ digit: '7', dotsAbove: 1, dotsBelow: 0 });
    expect(jianpuLabel(',', -1)).toEqual({ digit: '1', dotsAbove: 0, dotsBelow: 0 });
    expect(jianpuLabel(',', 0)).toEqual({ digit: '1', dotsAbove: 1, dotsBelow: 0 });
    expect(jianpuLabel(',', 1)).toEqual({ digit: '1', dotsAbove: 2, dotsBelow: 0 });
  });

  it('octave 0 text equals the game-bar degrees (KEY_DEGREE)', () => {
    for (const key of NOTE_KEYS) expect(jianpuText(jianpuLabel(key, 0))).toBe(KEY_DEGREE[key]);
  });

  it('jianpuText writes one combining mark per dot', () => {
    expect(jianpuText({ digit: '5', dotsAbove: 2, dotsBelow: 0 })).toBe(
      `5${DOT_ABOVE}${DOT_ABOVE}`,
    );
    expect(jianpuText({ digit: '3', dotsAbove: 0, dotsBelow: 2 })).toBe(
      `3${DOT_BELOW}${DOT_BELOW}`,
    );
    expect(jianpuText({ digit: '7', dotsAbove: 0, dotsBelow: 0 })).toBe('7');
  });
});

describe('buildMobilePlan — hand-built timelines', () => {
  it('empty timeline → empty plan', () => {
    const plan = buildMobilePlan(buildTimeline(song()), { semitone: 'toggle' });
    expect(plan).toEqual({
      cues: [],
      octaveSpans: [],
      semitoneSpans: [],
      stats: { octaveTaps: 0, semitoneTaps: 0 },
      semitone: 'toggle',
    });
  });

  it('all-natural song: no cue, one mode-0 span', () => {
    const plan = buildMobilePlan(tlOf(n('Z'), rest(), n('X', 2)), { semitone: 'toggle' });
    expect(plan.cues).toEqual([]);
    expect(plan.octaveSpans).toEqual([
      { startBeat: 0, endBeat: 4, firstNote: 0, lastNote: 1, mode: 0 },
    ]);
    expect(plan.semitoneSpans).toEqual([]);
    expect(plan.stats).toEqual({ octaveTaps: 0, semitoneTaps: 0 });
  });

  it('octave modes latch: rests neither reset nor break the mode', () => {
    // L:N _ L:N Z  → 1 lần chạm Cúi Xuống, 1 lần Ngẩng Tự Nhiên
    const plan = buildMobilePlan(tlOf(L('N'), rest(2), L('N'), n('Z')), { semitone: 'toggle' });
    expect(plan.cues.map(fmt)).toEqual(['o:-1@0#0', 'o:0@4#2']);
    expect(plan.octaveSpans).toEqual([
      { startBeat: 0, endBeat: 4, firstNote: 0, lastNote: 1, mode: -1 },
      { startBeat: 4, endBeat: 5, firstNote: 2, lastNote: 2, mode: 0 },
    ]);
    expect(plan.stats).toEqual({ octaveTaps: 2, semitoneTaps: 0 });
  });

  it('switches directly between Cúi Xuống and Ngẩng Lên (one tap each)', () => {
    const plan = buildMobilePlan(tlOf(L('Z'), R('Z'), L('Z')), { semitone: 'toggle' });
    expect(plan.cues.map(fmt)).toEqual(['o:-1@0#0', 'o:1@1#1', 'o:-1@2#2']);
    expect(plan.octaveSpans.map((s) => s.mode)).toEqual([-1, 1, -1]);
    expect(plan.stats.octaveTaps).toBe(3);
  });

  it('line and section breaks do not break a mode span', () => {
    const s = song(sec('A', line(R('Z')), line(R('X'))), sec('B', line(R('C'), n('V'))));
    const plan = buildMobilePlan(buildTimeline(s), { semitone: 'toggle' });
    expect(plan.cues.map(fmt)).toEqual(['o:1@0#0', 'o:0@3#3']);
    expect(plan.octaveSpans).toEqual([
      { startBeat: 0, endBeat: 3, firstNote: 0, lastNote: 2, mode: 1 },
      { startBeat: 3, endBeat: 4, firstNote: 3, lastNote: 3, mode: 0 },
    ]);
  });

  it('cues inside a slur are on the slur note itself', () => {
    // Z-L:N (luyến 2 nốt, 0.5 beat mỗi nốt)
    const plan = buildMobilePlan(tlOf(slur(n('Z', 0.5), L('N', 0.5)), n('X')), {
      semitone: 'toggle',
    });
    expect(plan.cues.map(fmt)).toEqual(['o:-1@0.5#1', 'o:0@1#2']);
  });

  it("semitone 'toggle': taps on every change, latching across rests", () => {
    // S:Z _ S:X Z S:C  → bật, (giữ qua rest), tắt, bật
    const tl = tlOf(S('Z'), rest(), S('X'), n('Z'), S('C'));
    const plan = buildMobilePlan(tl, { semitone: 'toggle' });
    expect(plan.cues.map(fmt)).toEqual(['s:on@0#0', 's:off@3#2', 's:on@4#3']);
    expect(plan.semitoneSpans).toEqual([
      { startBeat: 0, endBeat: 3, firstNote: 0, lastNote: 1 },
      { startBeat: 4, endBeat: 5, firstNote: 3, lastNote: 3 },
    ]);
    expect(plan.stats).toEqual({ octaveTaps: 0, semitoneTaps: 3 });
    expect(plan.semitone).toBe('toggle');
  });

  it("semitone 'oneShot': a tap before every sharp note, never an off cue", () => {
    const tl = tlOf(S('Z'), rest(), S('X'), n('Z'), S('C'), S('V'));
    const plan = buildMobilePlan(tl, { semitone: 'oneShot' });
    expect(plan.cues.map(fmt)).toEqual(['s:on@0#0', 's:on@2#1', 's:on@4#3', 's:on@5#4']);
    expect(plan.semitoneSpans).toEqual([
      { startBeat: 0, endBeat: 1, firstNote: 0, lastNote: 0 },
      { startBeat: 2, endBeat: 3, firstNote: 1, lastNote: 1 },
      { startBeat: 4, endBeat: 5, firstNote: 3, lastNote: 3 },
      { startBeat: 5, endBeat: 6, firstNote: 4, lastNote: 4 },
    ]);
    expect(plan.stats).toEqual({ octaveTaps: 0, semitoneTaps: 4 });
    expect(plan.semitone).toBe('oneShot');
  });

  it('same-note cues: octave first, then semitone', () => {
    // LS:Z rồi Z: Cúi Xuống + Nửa Cung, rồi Ngẩng Tự Nhiên + Nửa Cung (tắt)
    const plan = buildMobilePlan(tlOf(LS('Z'), n('Z')), { semitone: 'toggle' });
    expect(plan.cues.map(fmt)).toEqual(['o:-1@0#0', 's:on@0#0', 'o:0@1#1', 's:off@1#1']);
    const one = buildMobilePlan(tlOf(LS('Z'), n('Z')), { semitone: 'oneShot' });
    expect(one.cues.map(fmt)).toEqual(['o:-1@0#0', 's:on@0#0', 'o:0@1#1']);
    expect(one.stats).toEqual({ octaveTaps: 2, semitoneTaps: 1 });
  });

  it('does not depend on baseOctave / scrollDir (only key choices matter)', () => {
    const s = song(sec('Main', line(L('Z'), S('X'), R('C'))));
    const a = buildMobilePlan(buildTimeline(s), { semitone: 'toggle' });
    const b = buildMobilePlan(buildTimeline(s, { baseOctave: 3, scrollDir: -1 }), {
      semitone: 'toggle',
    });
    expect(b).toEqual(a);
  });
});

describe('buildMobilePlan — seeds', () => {
  const tl1 = seedTimeline(seed1);
  const tl2 = seedTimeline(seed2);

  it('seed 1 verse "[R] X-C [/R]": cue Ngẩng Lên on X then Ngẩng Tự Nhiên on the next note', () => {
    const plan = buildMobilePlan(tl1, { semitone: 'toggle' });
    // dòng 1: N*.5 M*.5 , B*2 X-C N*2 _ → X ở beat 4 (nốt #4), N*2 ở beat 5 (nốt #6)
    expect(plan.cues.slice(0, 2).map(fmt)).toEqual(['o:1@4#4', 'o:0@5#6']);
    expect(tl1.notes[4]?.key).toBe('X');
    expect(tl1.notes[6]?.key).toBe('N');
    // mỗi verse có 2 chỗ X-C (4 lần chạm), + 1 lần chạm vào điệp khúc
    expect(plan.stats).toEqual({ octaveTaps: 9, semitoneTaps: 0 });
    expect(plan.cues.every((c) => c.kind === 'octave')).toBe(true);
  });

  it('seed 1 chorus = ONE Ngẩng Lên span through the whole chorus (incl. the final rest)', () => {
    const plan = buildMobilePlan(tl1, { semitone: 'toggle' });
    const chorus = tl1.sections.find((s) => s.name === 'ĐIỆP KHÚC');
    expect(chorus).toBeDefined();
    const firstNote = tl1.lines[chorus?.firstLine ?? -1]?.firstNote ?? -1;
    const lastNote = tl1.notes.length - 1;
    const last = plan.octaveSpans.at(-1);
    expect(last).toEqual({
      mode: 1,
      firstNote,
      lastNote,
      startBeat: tl1.notes[firstNote]?.startBeat,
      endBeat: tl1.notes[lastNote]?.endBeat,
    });
    // cue cuối cùng là chạm Ngẩng Lên ở nốt đầu điệp khúc; sau đó không chạm gì nữa
    expect(plan.cues.at(-1)).toEqual({
      beat: tl1.notes[firstNote]?.startBeat,
      noteIndex: firstNote,
      kind: 'octave',
      mode: 1,
    });
    // rest cuối bài (_*.5) vẫn ở Ngẩng Lên
    const tail = (tl1.notes[lastNote]?.endBeat ?? 0) + 0.25;
    expect(tail).toBeLessThan(tl1.totalBeats);
    expect(mobileStateAt(plan, tail)).toEqual({ mode: 1, semitoneOn: false, nextCue: null });
    // spans xen kẽ 0 / 1: 2 verse × (0,1,0,1) — 2 verse nối nhau ở mode 0 — rồi điệp khúc
    expect(plan.octaveSpans.map((s) => s.mode)).toEqual([0, 1, 0, 1, 0, 1, 0, 1, 0, 1]);
  });

  it('seed 2: latching across lines — "X C Z-L:N" then "[L] N [/L] Z" taps Cúi Xuống once', () => {
    const plan = buildMobilePlan(tl2, { semitone: 'toggle' });
    const doan2 = tl2.sections.find((s) => s.name === 'ĐOẠN 2');
    const l2 = tl2.lines[(doan2?.firstLine ?? 0) + 1];
    const l3 = tl2.lines[(doan2?.firstLine ?? 0) + 2];
    expect(l2 && l3).toBeTruthy();
    if (!l2 || !l3) return;
    const slurN = l2.firstNote + l2.noteCount - 1; // L:N cuối dòng 2 (trong luyến)
    expect(tl2.notes[slurN]?.slur?.pos).toBe(1);
    const cuesHere = plan.cues.filter(
      (c) => c.noteIndex >= slurN && c.noteIndex <= l3.firstNote + 1,
    );
    expect(cuesHere.map(fmt)).toEqual([
      `o:-1@${tl2.notes[slurN]?.startBeat}#${slurN}`,
      `o:0@${tl2.notes[l3.firstNote + 1]?.startBeat}#${l3.firstNote + 1}`,
    ]);
  });

  it('seed 2 ĐOẠN 6 sharp notes: toggle = 8 taps (on/off), oneShot = 4 taps', () => {
    const toggle = buildMobilePlan(tl2, { semitone: 'toggle' });
    const oneShot = buildMobilePlan(tl2, { semitone: 'oneShot' });
    const doan6 = tl2.sections.findIndex((s) => s.name === 'ĐOẠN 6');
    const sharpNotes = tl2.notes.filter((x) => x.sharp);
    expect(sharpNotes).toHaveLength(4);
    expect(sharpNotes.every((x) => x.sectionIndex === doan6 && x.key === 'N')).toBe(true);

    const semi = (p: MobilePlan): MobileCue[] => p.cues.filter((c) => c.kind === 'semitone');
    expect(semi(toggle).map((c) => (c.kind === 'semitone' ? c.on : null))).toEqual([
      true,
      false,
      true,
      false,
      true,
      false,
      true,
      false,
    ]);
    expect(semi(oneShot)).toHaveLength(4);
    expect(semi(oneShot).map((c) => c.noteIndex)).toEqual(sharpNotes.map((x) => x.index));
    expect(toggle.stats.semitoneTaps).toBe(8);
    expect(oneShot.stats.semitoneTaps).toBe(4);
    // chế độ quãng không phụ thuộc cách Nửa Cung hoạt động
    expect(oneShot.stats.octaveTaps).toBe(toggle.stats.octaveTaps);
    expect(oneShot.octaveSpans).toEqual(toggle.octaveSpans);
    // nốt thăng đứng lẻ → mỗi dải 1 nốt ở cả hai kiểu
    const spans = sharpNotes.map((x) => ({
      startBeat: x.startBeat,
      endBeat: x.endBeat,
      firstNote: x.index,
      lastNote: x.index,
    }));
    expect(toggle.semitoneSpans).toEqual(spans);
    expect(oneShot.semitoneSpans).toEqual(spans);
  });

  it('every cue changes state; spans cover every note exactly once, in order', () => {
    for (const tl of [tl1, tl2]) {
      for (const semitone of ['toggle', 'oneShot'] as const) {
        const plan = buildMobilePlan(tl, { semitone });
        const covered = plan.octaveSpans.flatMap((s) =>
          Array.from({ length: s.lastNote - s.firstNote + 1 }, (_, k) => s.firstNote + k),
        );
        expect(covered).toEqual(tl.notes.map((x) => x.index));
        for (const s of plan.octaveSpans) {
          for (let i = s.firstNote; i <= s.lastNote; i++) expect(tl.notes[i]?.octave).toBe(s.mode);
        }
        const beats = plan.cues.map((c) => c.beat);
        expect([...beats].sort((a, b) => a - b)).toEqual(beats);
        for (const c of plan.cues) expect(c.beat).toBe(tl.notes[c.noteIndex]?.startBeat);
        expect(plan.stats.octaveTaps).toBe(plan.cues.filter((c) => c.kind === 'octave').length);
        expect(plan.stats.semitoneTaps).toBe(plan.cues.filter((c) => c.kind === 'semitone').length);
      }
    }
  });
});

describe('mobileStateAt', () => {
  it('before the first note: Ngẩng Tự Nhiên, Nửa Cung off, next cue = first cue', () => {
    const plan = buildMobilePlan(tlOf(rest(2), L('Z')), { semitone: 'toggle' });
    expect(mobileStateAt(plan, 0)).toEqual({ mode: 0, semitoneOn: false, nextCue: plan.cues[0] });
    expect(mobileStateAt(plan, -5).nextCue).toBe(plan.cues[0]);
    expect(mobileStateAt(plan, Number.NaN)).toEqual({
      mode: 0,
      semitoneOn: false,
      nextCue: plan.cues[0],
    });
  });

  it('a cue applies at exactly its beat; nextCue is strictly later', () => {
    // L:Z(0..1) _(1..2) L:X(2..3) S:C(3..4) R:V(4..5)
    const tl = tlOf(L('Z'), rest(), L('X'), S('C'), R('V'));
    const plan = buildMobilePlan(tl, { semitone: 'toggle' });
    expect(plan.cues.map(fmt)).toEqual(['o:-1@0#0', 'o:0@3#2', 's:on@3#2', 'o:1@4#3', 's:off@4#3']);
    const [, c1, , c3] = plan.cues;
    expect(mobileStateAt(plan, 0)).toEqual({ mode: -1, semitoneOn: false, nextCue: c1 });
    expect(mobileStateAt(plan, 1.5)).toEqual({ mode: -1, semitoneOn: false, nextCue: c1 }); // rest
    expect(mobileStateAt(plan, 2.999)).toEqual({ mode: -1, semitoneOn: false, nextCue: c1 });
    // hai cue cùng beat 3 đều đã áp; cue kế là cue đầu ở beat 4
    expect(mobileStateAt(plan, 3)).toEqual({ mode: 0, semitoneOn: true, nextCue: c3 });
    expect(mobileStateAt(plan, 4)).toEqual({ mode: 1, semitoneOn: false, nextCue: null });
    expect(mobileStateAt(plan, 99)).toEqual({ mode: 1, semitoneOn: false, nextCue: null });
  });

  it('toggle: Nửa Cung stays on through rests until the off tap; oneShot: off after the note', () => {
    // S:Z(0..1) _(1..2) S:X(2..3) _(3..4) Z(4..5)
    const tl = tlOf(S('Z'), rest(), S('X'), rest(), n('Z'));
    const toggle = buildMobilePlan(tl, { semitone: 'toggle' });
    const one = buildMobilePlan(tl, { semitone: 'oneShot' });
    const on = (p: MobilePlan, b: number): boolean => mobileStateAt(p, b).semitoneOn;
    expect([0, 0.5, 1, 1.5, 2, 3, 3.5, 4, 4.5].map((b) => on(toggle, b))).toEqual([
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      false,
      false,
    ]);
    expect([0, 0.5, 1, 1.5, 2, 3, 3.5, 4, 4.5].map((b) => on(one, b))).toEqual([
      true,
      true,
      false,
      false,
      true,
      false,
      false,
      false,
      false,
    ]);
    // cue kế khi đang nghỉ giữa hai nốt thăng
    expect(mobileStateAt(toggle, 1.5).nextCue).toEqual({
      beat: 4,
      noteIndex: 2,
      kind: 'semitone',
      on: false,
    });
    expect(mobileStateAt(one, 1.5).nextCue).toEqual({
      beat: 2,
      noteIndex: 1,
      kind: 'semitone',
      on: true,
    });
  });

  it('oneShot back-to-back sharp notes stay on across the boundary', () => {
    const plan = buildMobilePlan(tlOf(S('Z'), S('X'), n('C')), { semitone: 'oneShot' });
    expect(mobileStateAt(plan, 1).semitoneOn).toBe(true);
    expect(mobileStateAt(plan, 1.99).semitoneOn).toBe(true);
    expect(mobileStateAt(plan, 2).semitoneOn).toBe(false);
  });

  it('toggle: a song ending sharp keeps Nửa Cung on after the last note', () => {
    const plan = buildMobilePlan(tlOf(n('Z'), S('X'), rest()), { semitone: 'toggle' });
    expect(mobileStateAt(plan, 2.5).semitoneOn).toBe(true);
  });

  it('a plan without the `semitone` field is read as toggle', () => {
    const tl = tlOf(S('Z'), rest(), n('X'));
    const full = buildMobilePlan(tl, { semitone: 'toggle' });
    const legacy: MobilePlan = {
      cues: full.cues,
      octaveSpans: full.octaveSpans,
      semitoneSpans: full.semitoneSpans,
      stats: full.stats,
    };
    expect(mobileStateAt(legacy, 1.5).semitoneOn).toBe(true);
    expect(mobileStateAt(legacy, 2).semitoneOn).toBe(false);
  });

  it('seed 2 ĐOẠN 6 at exact cue beats (toggle and oneShot)', () => {
    const tl = seedTimeline(seed2);
    for (const semitone of ['toggle', 'oneShot'] as const) {
      const plan = buildMobilePlan(tl, { semitone });
      for (const [k, c] of plan.cues.entries()) {
        const st = mobileStateAt(plan, c.beat);
        const note = tl.notes[c.noteIndex];
        expect(note).toBeDefined();
        if (!note) continue;
        // tại beat của cue: trạng thái đúng bằng nốt của cue
        expect(st.mode).toBe(note.octave);
        expect(st.semitoneOn).toBe(note.sharp);
        // cue kế: cue đầu tiên có beat lớn hơn
        const next = plan.cues.slice(k + 1).find((x) => x.beat > c.beat) ?? null;
        expect(st.nextCue).toBe(next);
      }
      // giữa mọi nốt: trạng thái khớp nốt đang vang
      for (const x of tl.notes) {
        const mid = (x.startBeat + x.endBeat) / 2;
        const st = mobileStateAt(plan, mid);
        expect(st.mode).toBe(x.octave);
        expect(st.semitoneOn).toBe(x.sharp);
      }
    }
  });
});

import { describe, expect, it } from 'vitest';
import { parseHarm } from '../core/parser';
import type { NoteKey, Octave } from '../core/types';
import type { PracticeInputEvent, PracticeModifier } from '../player/practice.types';
import {
  EARLY_TOLERANCE_BEATS,
  FLAM_MS,
  HitRecorder,
  MobileCapture,
  PcCapture,
  beatsPerBar,
  hitsToHarm,
  hitsToSong,
  placedToSong,
  quantizeHits,
  takeSummary,
} from './recorder';
import type { HitsToSongOptions, RecordedHit } from './recorder';

/** 60 BPM: 1 beat = 1000 ms; beat 0 tại 1000 ms. */
const START = 1000;
const BEAT = 1000;
const at = (beat: number) => START + beat * BEAT;

function hit(
  key: NoteKey,
  on: number,
  off: number,
  octave: Octave = 0,
  sharp = false,
): RecordedHit {
  return { key, octave, sharp, onMs: at(on), offMs: at(off) };
}

const OPTS: HitsToSongOptions = {
  bpm: 60,
  startMs: START,
  grid: 0.25,
  timeSig: { num: 4, den: 4 },
  title: 'Thử',
  scrollDir: 1,
};

const keyDown = (key: NoteKey, t: number): PracticeInputEvent => ({
  type: 'key-down',
  key,
  source: 'keyboard',
  timeStamp: t,
});
const keyUp = (key: NoteKey, t: number): PracticeInputEvent => ({
  type: 'key-up',
  key,
  source: 'keyboard',
  timeStamp: t,
});
const mod = (
  type: 'mod-down' | 'mod-up',
  modifier: PracticeModifier,
  t: number,
  source: 'keyboard' | 'mouse' = 'mouse',
): PracticeInputEvent => ({ type, modifier, source, timeStamp: t });

/** Phần dòng nốt của `.harm` (bỏ directive / header / dòng trống). */
function bodyLines(harm: string): string[] {
  return harm.split('\n').filter((l) => l !== '' && !l.startsWith('@') && !l.startsWith('#'));
}

describe('HitRecorder', () => {
  it('đơn âm: nốt mới cắt nốt đang kêu; nhả phím đã bị cắt thì bỏ qua', () => {
    const r = new HitRecorder();
    r.noteOn({ key: 'Z', octave: 0, sharp: false }, 100);
    expect(r.sounding).toEqual({ key: 'Z', octave: 0, sharp: false, onMs: 100 });
    r.noteOn({ key: 'X', octave: 1, sharp: true }, 300);
    r.noteOff('Z', 350); // Z đã bị cắt tại 300
    expect(r.sounding?.key).toBe('X');
    r.noteOff('X', 500);
    expect(r.sounding).toBeNull();
    expect(r.hits).toEqual([
      { key: 'Z', octave: 0, sharp: false, onMs: 100, offMs: 300 },
      { key: 'X', octave: 1, sharp: true, onMs: 300, offMs: 500 },
    ]);
  });

  it('stop đóng nốt đang kêu; reset xóa; thời điểm lỗi bị bỏ', () => {
    const r = new HitRecorder();
    r.noteOn({ key: 'C', octave: -1, sharp: false }, 10);
    r.noteOn({ key: 'V', octave: 0, sharp: false }, Number.NaN);
    const out = r.stop(5); // nhả trước lúc bấm → độ dài 0, không âm
    expect(out).toEqual([{ key: 'C', octave: -1, sharp: false, onMs: 10, offMs: 10 }]);
    out.pop();
    expect(r.hits).toHaveLength(1); // stop trả bản sao
    r.reset();
    expect(r.hits).toHaveLength(0);
    expect(r.stop(99)).toEqual([]);
  });
});

describe('PcCapture', () => {
  it('modifier giữ TRƯỚC khi bấm phím áp cho nốt; đổi modifier giữa nốt không đổi nốt đó', () => {
    const c = new PcCapture();
    c.handle(mod('mod-down', 'right', 0));
    c.handle(keyDown('X', 10));
    c.handle(mod('mod-up', 'right', 20)); // nhả chuột khi nốt còn kêu
    c.handle(keyUp('X', 50));
    c.handle(mod('mod-down', 'left', 60));
    c.handle(mod('mod-down', 'scroll', 61, 'keyboard'));
    c.handle(keyDown('C', 70));
    c.handle(keyUp('C', 90));
    c.handle(keyDown('V', 100)); // trái + scroll vẫn giữ
    c.handle(mod('mod-up', 'left', 105));
    c.handle(mod('mod-up', 'scroll', 106, 'keyboard'));
    c.handle(keyUp('V', 120));
    c.handle(keyDown('B', 130));
    expect(c.recorder.stop(140)).toEqual([
      { key: 'X', octave: 1, sharp: false, onMs: 10, offMs: 50 },
      { key: 'C', octave: -1, sharp: true, onMs: 70, offMs: 90 },
      { key: 'V', octave: -1, sharp: true, onMs: 100, offMs: 120 },
      { key: 'B', octave: 0, sharp: false, onMs: 130, offMs: 140 },
    ]);
  });

  it('giữ cả trái lẫn phải → bỏ lần bấm (nốt đang kêu không bị cắt)', () => {
    const c = new PcCapture();
    c.handle(keyDown('Z', 0));
    c.handle(mod('mod-down', 'left', 5));
    c.handle(mod('mod-down', 'right', 6));
    c.handle(keyDown('X', 10)); // bị bỏ
    expect(c.recorder.sounding?.key).toBe('Z');
    c.handle(keyUp('X', 20));
    expect(c.recorder.sounding?.key).toBe('Z');
    c.handle(keyUp('Z', 30));
    expect(c.recorder.stop(40)).toEqual([
      { key: 'Z', octave: 0, sharp: false, onMs: 0, offMs: 30 },
    ]);
  });

  it('cùng modifier giữ bằng chuột và phím thay thế: nhả cả hai mới là nhả', () => {
    const c = new PcCapture();
    c.handle(mod('mod-down', 'right', 0, 'mouse'));
    c.handle(mod('mod-down', 'right', 1, 'keyboard'));
    c.handle(mod('mod-up', 'right', 2, 'mouse'));
    expect(c.pressed.right).toBe(true);
    c.handle(keyDown('N', 3));
    expect(c.recorder.sounding?.octave).toBe(1);
    c.handle(mod('mod-up', 'right', 4, 'keyboard'));
    expect(c.pressed).toEqual({ keys: ['N'], left: false, right: false, scroll: false });
  });

  it('monophony: phím mới cắt nốt cũ dù phím cũ còn giữ; pressed liệt kê phím đang giữ', () => {
    const c = new PcCapture();
    c.handle(keyDown('Z', 0));
    c.handle(keyDown('X', 100));
    expect(c.pressed.keys).toEqual(['Z', 'X']);
    c.handle(keyUp('Z', 150));
    expect(c.recorder.sounding?.key).toBe('X');
    c.handle(keyUp('X', 200));
    expect(c.pressed.keys).toEqual([]);
    expect(c.recorder.hits.map((h) => [h.key, h.onMs, h.offMs])).toEqual([
      ['Z', 0, 100],
      ['X', 100, 200],
    ]);
  });

  it('releaseAll thả mọi thứ và kết thúc nốt; sự kiện MIDI bị bỏ qua', () => {
    const c = new PcCapture();
    c.handle(mod('mod-down', 'left', 0));
    c.handle(keyDown('M', 10));
    expect(
      c.handle({ type: 'midi-on', midi: 60, velocity: 1, source: 'midi', timeStamp: 11 }),
    ).toBe(false);
    c.releaseAll(40);
    expect(c.pressed).toEqual({ keys: [], left: false, right: false, scroll: false });
    expect(c.recorder.sounding).toBeNull();
    expect(c.recorder.hits).toEqual([{ key: 'M', octave: -1, sharp: false, onMs: 10, offMs: 40 }]);
    c.releaseAll(50); // không có gì để thả
    expect(c.recorder.hits).toHaveLength(1);
  });
});

describe('MobileCapture', () => {
  it('chế độ quãng GIỮ trạng thái tới lần chạm khác; Nửa Cung toggle', () => {
    const c = new MobileCapture('toggle');
    expect(c.mode).toBe(0);
    c.tapMode('left');
    c.noteOn('Z', 0);
    c.noteOff('Z', 10);
    c.noteOn('X', 20); // vẫn Cúi Xuống
    c.tapMode('scroll');
    expect(c.semitoneOn).toBe(true);
    c.noteOn('C', 30);
    c.noteOn('V', 40); // vẫn thăng (toggle)
    c.tapMode('scroll');
    c.tapMode('right');
    c.noteOn('B', 50);
    c.tapMode('natural');
    c.noteOn('N', 60);
    expect(c.pressedKeys).toEqual(['X', 'C', 'V', 'B', 'N']);
    c.releaseAll(70);
    expect(c.pressedKeys).toEqual([]);
    expect(c.mode).toBe(0);
    expect(c.recorder.hits.map((h) => [h.key, h.octave, h.sharp])).toEqual([
      ['Z', -1, false],
      ['X', -1, false],
      ['C', -1, true],
      ['V', -1, true],
      ['B', 1, false],
      ['N', 0, false],
    ]);
  });

  it("Nửa Cung 'oneShot' chỉ áp cho nốt kế tiếp; chạm lại trước khi bấm = hủy", () => {
    const c = new MobileCapture('oneShot');
    c.tapMode('scroll');
    c.noteOn('Z', 0);
    expect(c.semitoneOn).toBe(false);
    c.noteOn('X', 10);
    c.tapMode('scroll');
    c.tapMode('scroll');
    c.noteOn('C', 20);
    c.noteOff('C', 30);
    expect(c.recorder.hits.map((h) => h.sharp)).toEqual([true, false, false]);
    // đổi setting giữa chừng
    c.semitone = 'toggle';
    c.tapMode('scroll');
    c.noteOn('V', 40);
    expect(c.semitoneOn).toBe(true);
  });
});

describe('quantizeHits', () => {
  it('ms → beat, quantize đầu / cuối về lưới gần nhất', () => {
    const placed = quantizeHits(
      [hit('Z', 0.04, 0.96), hit('X', 1.1, 1.62), hit('C', 2.13, 3.4)],
      OPTS,
    );
    expect(placed.map((p) => [p.key, p.startBeat, p.beats])).toEqual([
      ['Z', 0, 1],
      ['X', 1, 0.5],
      ['C', 2.25, 1.25],
    ]);
  });

  it('lưới 1/8 beat, chùm ba và tắt lưới', () => {
    const hits = [hit('Z', 0.06, 0.3), hit('X', 0.36, 0.7)];
    expect(quantizeHits(hits, { ...OPTS, grid: 0.125 }).map((p) => [p.startBeat, p.beats])).toEqual(
      [
        [0, 0.25],
        [0.375, 0.375],
      ],
    );
    expect(quantizeHits(hits, { ...OPTS, grid: 1 / 3 }).map((p) => [p.startBeat, p.beats])).toEqual(
      [
        [0, 1 / 3],
        [1 / 3, 1 / 3],
      ],
    );
    // tắt lưới: giữ nguyên (làm tròn 1/1000 beat); khe 0.06 < 1/16 beat nối vào nốt trước
    expect(quantizeHits(hits, { ...OPTS, grid: 0 }).map((p) => [p.startBeat, p.beats])).toEqual([
      [0.06, 0.3],
      [0.36, 0.34],
    ]);
    expect(
      quantizeHits([hit('Z', 0.0612, 0.3), hit('X', 0.5, 0.75)], { ...OPTS, grid: 0 }).map((p) => [
        p.startBeat,
        p.beats,
      ]),
    ).toEqual([
      [0.061, 0.239],
      [0.5, 0.25],
    ]);
  });

  it('bỏ lần bấm trước beat 0 − dung sai; bấm hơi sớm dời về beat 0', () => {
    const placed = quantizeHits(
      [hit('Z', -2, -1.5), hit('X', -EARLY_TOLERANCE_BEATS - 0.01, 0.2), hit('C', -0.2, 0.9)],
      OPTS,
    );
    expect(placed.map((p) => [p.key, p.startBeat, p.beats])).toEqual([['C', 0, 1]]);
  });

  it('độ dài tối thiểu = lưới (1/16 beat khi tắt lưới)', () => {
    expect(quantizeHits([hit('Z', 1, 1.02)], OPTS)[0].beats).toBe(0.25);
    expect(quantizeHits([hit('Z', 1, 1.01)], { ...OPTS, grid: 0 })[0].beats).toBe(1 / 16);
  });

  it('đơn âm: nốt trước bị cắt; hai nốt cùng ô lưới → nốt sau dời sang ô kế', () => {
    const placed = quantizeHits(
      [
        { key: 'Z', octave: 0, sharp: false, onMs: at(0), offMs: at(2) }, // chồng (không phải từ capture)
        hit('X', 1, 1.1),
        hit('C', 1.12, 2), // cùng ô 1.0 với X (cách 120 ms, không phải bấm lệch)
      ],
      OPTS,
    );
    expect(placed.map((p) => [p.key, p.startBeat, p.beats])).toEqual([
      ['Z', 0, 1],
      ['X', 1, 0.25],
      ['C', 1.25, 0.75],
    ]);
  });

  it('lần bấm thừa cùng ô giữa đoạn legato: không đẩy dây chuyền mọi nốt sau trễ một ô', () => {
    const run: NoteKey[] = ['Z', 'C', 'V', 'B', 'N', 'M', ',', 'B'];
    const legato = run.map((k, i) => hit(k, i * 0.25, (i + 1) * 0.25));
    const want = run.map((k, i) => [k, i * 0.25]);
    // Lần bấm thừa X 50 ms sau Z (không phải bấm lệch): Z sát mốc ô 0 hơn → giữ Z, bỏ X.
    const stray = [legato[0], hit('X', 0.05, 0.1), ...legato.slice(1)];
    expect(quantizeHits(stray, OPTS).map((p) => [p.key, p.startBeat])).toEqual(want);
    // Nốt chính bấm trễ hơn lần bấm thừa: nốt sát mốc ô hơn (Z) thắng, vẫn không dời nốt sau.
    const late = [hit('X', -0.06, 0.02), hit('Z', 0.02, 0.25), ...legato.slice(1)];
    expect(quantizeHits(late, OPTS).map((p) => [p.key, p.startBeat])).toEqual(want);
    // Nốt cuối cùng ô với nốt trước: ô kế trống → vẫn dời sang ô kế.
    const tail = quantizeHits([...legato, hit('X', 1.8, 2)], OPTS);
    expect(tail.map((p) => [p.key, p.startBeat]).slice(-2)).toEqual([
      ['B', 1.75],
      ['X', 2],
    ]);
  });

  it('bấm lệch (< FLAM_MS) → bỏ nốt trước', () => {
    const t = at(1);
    const placed = quantizeHits(
      [
        { key: 'Z', octave: 0, sharp: false, onMs: t, offMs: t + FLAM_MS - 5 },
        { key: 'X', octave: 0, sharp: false, onMs: t + FLAM_MS - 5, offMs: at(2) },
      ],
      OPTS,
    );
    expect(placed.map((p) => p.key)).toEqual(['X']);
  });

  it('tắt lưới: khe hở rất nhỏ nối vào nốt trước (không sinh rest vụn)', () => {
    const placed = quantizeHits([hit('Z', 0, 0.98), hit('X', 1, 2)], { ...OPTS, grid: 0 });
    expect(placed.map((p) => [p.startBeat, p.beats])).toEqual([
      [0, 1],
      [1, 1],
    ]);
  });

  it('đầu vào lỗi → rỗng / bỏ phần tử lỗi; sắp theo lúc bấm', () => {
    expect(quantizeHits([hit('Z', 0, 1)], { ...OPTS, bpm: 0 })).toEqual([]);
    expect(quantizeHits([hit('Z', 0, 1)], { ...OPTS, startMs: Number.NaN })).toEqual([]);
    const placed = quantizeHits(
      [hit('X', 2, 3), { ...hit('Z', 0, 1), onMs: Number.POSITIVE_INFINITY }, hit('C', 0, 1)],
      { ...OPTS, grid: Number.NaN },
    );
    expect(placed.map((p) => p.key)).toEqual(['C', 'X']);
  });
});

describe('hitsToSong / hitsToHarm', () => {
  it('key / octave / sharp đúng như đã bấm (không optimizer), parse lại không lỗi', () => {
    const harm = hitsToHarm(
      [hit('Z', 0, 1), hit('X', 1, 2, 1), hit('C', 2, 3), hit('V', 3, 4, -1, true)],
      OPTS,
    );
    expect(harm.startsWith('@title Thử\n@bpm 60\n@time 4/4\n@scroll +1\n')).toBe(true);
    expect(harm).toContain('# Main');
    expect(bodyLines(harm)).toEqual([
      'Z [giữ chuột phải] X [thả chuột phải] C [giữ chuột trái] [giữ scroll] V [thả scroll] [thả chuột trái]',
    ]);
    const parsed = parseHarm(harm);
    expect(parsed.ok).toBe(true);
    expect(parsed.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  });

  it('rest cho khe hở; xuống dòng tại rest ≥ 1 beat hoặc mỗi 2 ô nhịp', () => {
    const song = hitsToSong(
      [
        hit('Z', 0, 1),
        hit('X', 1.5, 2), // rest 0.5 → không xuống dòng
        hit('C', 3, 4), // rest 1 → xuống dòng
        hit('V', 4, 5),
        hit('B', 5, 6),
        hit('N', 6, 7),
        hit('M', 7, 8),
        hit(',', 8, 9), // hết 2 ô nhịp từ dòng trước? dòng 2 bắt đầu beat 3 → mốc 8
        hit('Z', 9, 10),
      ],
      OPTS,
    );
    expect(song.sections).toHaveLength(1);
    const lines = song.sections[0].lines.map((l) =>
      l.units.map((u) => (u.kind === 'rest' ? `_${u.beats}` : u.kind === 'note' ? u.key : '?')),
    );
    expect(lines).toEqual([
      ['Z', '_0.5', 'X', '_1'],
      ['C', 'V', 'B', 'N', 'M'],
      [',', 'Z'],
    ]);
  });

  it('bỏ các ô nhịp trống đầu bài (giữ vị trí trong ô nhịp)', () => {
    const song = hitsToSong([hit('Z', 5.5, 6), hit('X', 6, 7)], OPTS);
    const units = song.sections[0].lines[0].units;
    expect(units[0]).toEqual({ kind: 'rest', beats: 1.5 });
    expect(units).toHaveLength(3);
  });

  it('mỗi 8 ô nhịp một section "Phần N"', () => {
    const hits: RecordedHit[] = [];
    for (let b = 0; b < 40; b += 2) hits.push(hit('Z', b, b + 1.5));
    const song = hitsToSong(hits, OPTS);
    expect(song.sections.map((s) => s.name)).toEqual(['Phần 1', 'Phần 2']);
  });

  it('nhịp 3/4 và 6/8, scroll −1: tiêu đề / nhịp / chiều scroll ghi vào bài', () => {
    const song = hitsToSong([hit('Z', 0, 1, 0, true)], {
      ...OPTS,
      timeSig: { num: 6, den: 8 },
      scrollDir: -1,
      bpm: 120,
      startMs: START,
    });
    expect(song.timeSig).toEqual({ num: 6, den: 8 });
    expect(song.scrollDir).toBe(-1);
    expect(song.bpm).toBe(120);
    expect(song.title).toBe('Thử');
    expect(beatsPerBar({ num: 3, den: 4 })).toBe(3);
    expect(beatsPerBar({ num: 6, den: 8 })).toBe(3);
  });

  it('không có nốt → bài rỗng (không section)', () => {
    expect(hitsToSong([], OPTS).sections).toEqual([]);
  });

  it('placedToSong báo lỗi nếu bố cục và đầu vào lệch nhau (bất biến)', () => {
    // hai nốt chồng hẳn lên nhau (không qua quantizeHits): arrangeMelody bỏ nốt thứ hai
    expect(() =>
      placedToSong(
        [
          { key: 'Z', octave: 0, sharp: false, startBeat: 0, beats: 1 },
          { key: 'X', octave: 0, sharp: false, startBeat: 0, beats: 1 },
        ],
        OPTS,
      ),
    ).toThrow(RangeError);
  });
});

describe('takeSummary', () => {
  it('số nốt, độ dài từ đầu ô nhịp chứa nốt đầu, số ô nhịp, giây', () => {
    const placed = quantizeHits([hit('Z', 4.5, 5), hit('X', 5, 9.5)], OPTS);
    expect(takeSummary(placed, 60, { num: 4, den: 4 })).toEqual({
      notes: 2,
      origin: 4,
      beats: 5.5,
      bars: 2,
      seconds: 5.5,
    });
    expect(takeSummary([], 60, { num: 4, den: 4 })).toEqual({
      notes: 0,
      origin: 0,
      beats: 0,
      bars: 0,
      seconds: 0,
    });
  });
});

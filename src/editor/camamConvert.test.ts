import { describe, expect, it } from 'vitest';
import { GAME_SCROLL_DIR } from '../core/keys';
import { melodyPitches } from '../core/melody';
import { songToMelody } from '../core/melodyBuild';
import { parseHarm } from '../core/parser';
import { AI_PROMPT_EN, AI_PROMPT_VI } from './aiPrompt';
import { convertPasted, extractPasted, looksLikePrompt } from './camamConvert';
import type { PasteConversion } from './camamConvert';

const OPTS = { baseOctave: 4 } as const;

/** Cao độ (midi) mà `.harm` kết quả phát ra. */
function harmPitches(harm: string): (number | null)[] {
  const r = parseHarm(harm);
  return melodyPitches(songToMelody(r.song, { baseOctave: 4, scrollDir: GAME_SCROLL_DIR }));
}

/** Cao độ gốc của văn bản cảm âm = cao độ của .harm trừ transpose đã chọn. */
function sourcePitches(c: PasteConversion): (number | null)[] {
  const t = c.placement?.transpose ?? 0;
  return harmPitches(c.harm ?? '').map((p) => (p === null ? null : p - t));
}

function harmErrors(harm: string): number {
  return parseHarm(harm).diagnostics.filter((d) => d.severity === 'error').length;
}

const AI_ANSWER = [
  'Đây là cảm âm của bài:',
  '',
  '```text',
  '@title Bài thử',
  '@artist Ai đó',
  '@bpm 100',
  '@time 3/4',
  '',
  '# Đoạn 1',
  'do1 re1 mi1*0.5 fa1*0.5',
  'sol1*2 la1 si1 do2*2',
  '',
  '# Điệp khúc',
  '// không chắc nốt cuối',
  're2mi2 _ fa#1 sib1*1.5',
  '```',
  '',
  'Chúc bạn chơi vui!',
].join('\n');

/** Câu trả lời hai phần (bài dài: AI chia khối / người dùng bảo "viết tiếp"). */
const TWO_PARTS = [
  'Phần 1:',
  '```text',
  '# Đoạn 1',
  'do1 re1 mi1 fa1',
  '```',
  'Còn tiếp — phần 2:',
  '```text',
  '# Điệp khúc',
  'sol1 la1 si1 do2',
  '```',
  'Hết.',
].join('\n');

describe('extractPasted', () => {
  it('không có khối code: giữ nguyên (bỏ BOM, CRLF → LF)', () => {
    expect(extractPasted('\uFEFFdo1 re1\r\nmi1')).toEqual({
      text: 'do1 re1\nmi1',
      lineOffset: 0,
      blocks: 0,
    });
  });

  it('lấy nội dung khối ```; lineOffset = số dòng trước nội dung', () => {
    const r = extractPasted(AI_ANSWER);
    expect(r.lineOffset).toBe(3);
    expect(r.blocks).toBe(1);
    expect(r.text.startsWith('@title Bài thử\n')).toBe(true);
    expect(r.text.endsWith('re2mi2 _ fa#1 sib1*1.5')).toBe(true);
    expect(r.text).not.toContain('```');
    expect(r.text).not.toContain('Chúc bạn');
  });

  it('hàng rào 4 dấu / ~~~; thiếu hàng rào đóng → tới hết văn bản', () => {
    expect(extractPasted('x\n````text\ndo1\n```\nre1\n````\ny').text).toBe('do1\n```\nre1');
    expect(extractPasted('~~~\ndo1\n~~~').text).toBe('do1');
    expect(extractPasted('a\n```\ndo1 re1\nmi1')).toEqual({
      text: 'do1 re1\nmi1',
      lineOffset: 2,
      blocks: 1,
    });
  });

  it('nhiều khối (AI chia bài dài / "viết tiếp"): ghép MỌI khối theo thứ tự, số dòng vẫn đúng chỗ đã dán', () => {
    const r = extractPasted(TWO_PARTS);
    expect(r.blocks).toBe(2);
    expect(r.text.split('\n')).toEqual([
      '# Đoạn 1',
      'do1 re1 mi1 fa1',
      '',
      '',
      '',
      '# Điệp khúc',
      'sol1 la1 si1 do2',
    ]);
    // Dòng i (0-based) của `text` = dòng i + lineOffset (0-based) của văn bản gốc.
    expect(TWO_PARTS.split('\n')[r.lineOffset + 5]).toBe('# Điệp khúc');
    expect(r.text).not.toContain('Còn tiếp');
    expect(r.text).not.toContain('```');
  });
});

describe('convertPasted — nhiều phần', () => {
  it('ghép cả hai phần thành một bài (cùng một tông), báo đã ghép 2 phần', () => {
    const c = convertPasted(TWO_PARTS, OPTS);
    expect(c.kind).toBe('camam');
    expect(c.blocks).toBe(2);
    expect(c.noteCount).toBe(8);
    expect(c.issues).toEqual([]);
    const harm = c.harm ?? '';
    expect(harm).toContain('# Đoạn 1');
    expect(harm).toContain('# Điệp khúc');
    expect(harmErrors(harm)).toBe(0);
  });

  it('dán tiếp phần 2 vào cuối ô (phần 1 đã có) = như dán cả hai cùng lúc', () => {
    const [part1, part2] = TWO_PARTS.split('Còn tiếp — phần 2:');
    const joined = convertPasted(`${part1}\n${part2}`, OPTS);
    expect(joined.noteCount).toBe(8);
    expect(joined.harm).toBe(convertPasted(TWO_PARTS, OPTS).harm);
  });

  it('một khối: blocks = 1; không có khối: 0', () => {
    expect(convertPasted(AI_ANSWER, OPTS).blocks).toBe(1);
    expect(convertPasted('do1 re1 mi1', OPTS).blocks).toBe(0);
  });
});

describe('convertPasted — cảm âm', () => {
  it('câu trả lời của AI (khối code + chữ giải thích) → .harm 0 lỗi, giữ tên / tác giả / nhịp', () => {
    const c = convertPasted(AI_ANSWER, OPTS);
    expect(c.kind).toBe('camam');
    expect(c.issues).toEqual([]);
    expect(c.title).toBe('Bài thử');
    // do re mi fa sol la si do = 8; re2mi2 = 2; fa#1 sib1 = 2
    expect(c.noteCount).toBe(12);
    expect(c.lineCount).toBe(3);
    const harm = c.harm ?? '';
    expect(harmErrors(harm)).toBe(0);
    expect(harm).toContain('@title Bài thử');
    expect(harm).toContain('@artist Ai đó');
    expect(harm).toContain('@bpm 100');
    expect(harm).toContain('@time 3/4');
    expect(harm).toContain('@scroll +1');
    expect(harm).toContain('# Đoạn 1');
    expect(harm).toContain('# Điệp khúc');
    // không còn tên nốt cảm âm trong kết quả
    expect(harm).not.toMatch(/\b(do|re|mi|fa|sol|la|si)\d/);
    // ghi chú "// không chắc" của AI giữ lại thành cảnh báo //! ngay trên dòng nốt kế tiếp
    const lines = harm.split('\n');
    const note = lines.indexOf('//! không chắc nốt cuối');
    expect(note).toBeGreaterThan(lines.indexOf('# Điệp khúc'));
    // dòng ngay dưới là dòng nốt (không phải comment / section / directive)
    expect(lines[note + 1]).toMatch(/^[^/#@\s]/);
    const annotations = parseHarm(harm).diagnostics.filter((d) => d.code === 'annotation');
    expect(annotations.map((d) => d.line)).toEqual([note + 1]);
    expect(sourcePitches(c)).toEqual([60, 62, 64, 65, 67, 69, 71, 72, 74, 76, null, 66, 70]);
  });

  it('chọn sẵn phương án dễ nhất; phương án đầu = tốt nhất, có thêm giữ cung gốc', () => {
    const c = convertPasted(AI_ANSWER, OPTS);
    expect(c.keyOptions.length).toBeGreaterThanOrEqual(1);
    expect(c.placement).toBe(c.keyOptions[0]);
    const costs = c.keyOptions.slice(0, 3).map((p) => p.cost);
    expect([...costs].sort((a, b) => a - b)).toEqual(costs);
    expect(c.keyOptions.some((p) => p.shift === 0)).toBe(true);
  });

  it('đổi cung (transpose tùy chọn): .harm theo phương án đó; transpose lạ → phương án dễ nhất', () => {
    const best = convertPasted(AI_ANSWER, OPTS);
    const other = best.keyOptions[1];
    expect(other).toBeDefined();
    const c = convertPasted(AI_ANSWER, { ...OPTS, transpose: other!.transpose });
    expect(c.placement?.transpose).toBe(other!.transpose);
    expect(c.harm).not.toBe(best.harm);
    expect(sourcePitches(c)).toEqual(sourcePitches(best));
    expect(convertPasted(AI_ANSWER, { ...OPTS, transpose: 999 }).placement?.transpose).toBe(
      best.placement?.transpose,
    );
    expect(convertPasted(AI_ANSWER, { ...OPTS, transpose: null }).harm).toBe(best.harm);
  });

  it('không có số quãng: chữ thường = quãng 1, chữ hoa = quãng 2; có dấu tiếng Việt vẫn đọc', () => {
    const c = convertPasted('đô rê mi Đô\nla si Do*2', OPTS);
    expect(c.kind).toBe('camam');
    expect(c.issues).toEqual([]);
    expect(sourcePitches(c)).toEqual([60, 62, 64, 72, 69, 71, 72]);
    expect(c.title).toBe('');
    expect(c.harm).not.toContain('@title');
  });

  it('có số quãng ở mọi nốt → quy ước "chỉ hậu tố số" (chữ hoa không đổi quãng)', () => {
    const c = convertPasted('Do1 re1 Mi2', OPTS);
    expect(sourcePitches(c)).toEqual([60, 62, 76]);
  });

  it('token lạ bị bỏ qua, báo đúng dòng / cột của văn bản ĐÃ DÁN (tính cả dòng trước khối code)', () => {
    const c = convertPasted('Kết quả:\n```text\ndo1 xx1 re1 mi1\n```', OPTS);
    expect(c.kind).toBe('camam');
    expect(c.noteCount).toBe(3);
    expect(c.issues).toEqual([
      {
        kind: 'camam',
        line: 3,
        column: 5,
        diag: expect.objectContaining({ code: 'unknown-token', token: 'xx1' }),
      },
    ]);
    expect(harmErrors(c.harm ?? '')).toBe(0);
  });

  it('dòng chữ (lời giải thích, "do" trùng tên nốt) bị bỏ cả dòng', () => {
    const c = convertPasted('Bài này do Văn Cao sáng tác\ndo1 re1 mi1\nhết rồi nhé', OPTS);
    expect(c.kind).toBe('camam');
    expect(c.noteCount).toBe(3);
    expect(c.issues.map((i) => [i.kind, i.line])).toEqual([
      ['prose', 1],
      ['prose', 3],
    ]);
    expect(sourcePitches(c)).toEqual([60, 62, 64]);
  });

  it('dòng chỉ có "-" (kéo dài nốt dòng trên) không bị coi là chữ', () => {
    const c = convertPasted('do1 re1\n- -', OPTS);
    expect(c.issues).toEqual([]);
    expect(c.noteCount).toBe(2);
  });

  it('kiểu Mobile: phương án theo cost model Mobile (có số lần chạm)', () => {
    const c = convertPasted(AI_ANSWER, { ...OPTS, scheme: 'mobile', mobileSemitone: 'toggle' });
    expect(c.placement?.stats.octaveTaps).toBeTypeOf('number');
    expect(c.placement?.stats.semitoneTaps).toBeTypeOf('number');
    expect(harmErrors(c.harm ?? '')).toBe(0);
  });

  it('trọn tầm cảm âm (dob1 … si3) vẫn vừa tầm game: không nốt nào bị gập', () => {
    const c = convertPasted('dob1 do1 sol2 si3', OPTS);
    expect(c.placement?.stats.foldedNotes).toBe(0);
    expect(c.harm).not.toContain('//!');
    expect(sourcePitches(c)).toEqual([59, 60, 79, 95]);
  });

  it.each([
    ['vi', AI_PROMPT_VI],
    ['en', AI_PROMPT_EN],
  ])('ví dụ đầu ra của prompt (%s) chuyển trọn vẹn: 20 nốt, 0 chỗ lỗi', (_lang, prompt) => {
    const example = /\n```text\n([\s\S]*?)\n```$/.exec(prompt)?.[1] ?? '';
    const c = convertPasted(example, OPTS);
    expect(c.kind).toBe('camam');
    expect(c.noteCount).toBe(20);
    expect(c.issues).toEqual([]);
    expect(harmErrors(c.harm ?? '')).toBe(0);
  });
});

describe('convertPasted — .harm, rỗng, rác, dán nhầm prompt', () => {
  it('đã là .harm (đọc trọn vẹn) → giữ nguyên văn, không có phương án cung', () => {
    const src = '@title Có sẵn\n@bpm 90\n# A\nZ X C*2 [giữ chuột phải] V B [thả chuột phải]';
    const c = convertPasted(src, OPTS);
    expect(c.kind).toBe('harm');
    expect(c.harm).toBe(`${src}\n`);
    expect(c.title).toBe('Có sẵn');
    expect(c.noteCount).toBe(5);
    expect(c.lineCount).toBe(1);
    expect(c.keyOptions).toEqual([]);
    expect(c.placement).toBeNull();
    expect(c.issues).toEqual([]);
  });

  it('.harm trong khối code của AI cũng nhận ra', () => {
    const c = convertPasted('```\n@title K\nZ X C\n```', OPTS);
    expect(c.kind).toBe('harm');
    expect(c.harm).toBe('@title K\nZ X C\n');
  });

  it('.harm có lỗi (nhiều nốt .harm hơn cảm âm) → vẫn là .harm, báo lỗi theo dòng', () => {
    const c = convertPasted('Z X C V\nB N ?? M', OPTS);
    expect(c.kind).toBe('harm');
    expect(c.noteCount).toBe(7);
    expect(c.issues).toHaveLength(1);
    expect(c.issues[0]).toMatchObject({ kind: 'harm', line: 2 });
  });

  it('dấu phẩy giữa các nốt cảm âm không làm nó thành .harm (", " = phím Đố của .harm)', () => {
    const c = convertPasted('do1 , re1 , mi1', OPTS);
    expect(c.kind).toBe('camam');
    expect(c.noteCount).toBe(3);
  });

  it.each(['', '   \n\t', '```text\n\n```'])('rỗng (%j) → empty', (text) => {
    const c = convertPasted(text, OPTS);
    expect(c.kind).toBe('empty');
    expect(c.harm).toBeNull();
  });

  it.each(['hello world', 'Xin chào, tôi không biết bài này', '12345 !!! ???'])(
    'rác (%j) → invalid, không có .harm',
    (text) => {
      const c = convertPasted(text, OPTS);
      expect(c.kind).toBe('invalid');
      expect(c.harm).toBeNull();
      expect(c.noteCount).toBe(0);
    },
  );

  it.each([
    ['vi', AI_PROMPT_VI],
    ['en', AI_PROMPT_EN],
  ])('dán nhầm prompt (%s) → prompt (không biến ví dụ trong prompt thành bài)', (_lang, p) => {
    expect(looksLikePrompt(p)).toBe(true);
    expect(convertPasted(p, OPTS).kind).toBe('prompt');
    expect(convertPasted(`Câu hỏi của tôi:\n${p}`, OPTS).harm).toBeNull();
    expect(looksLikePrompt('do1 re1 mi1')).toBe(false);
  });
});

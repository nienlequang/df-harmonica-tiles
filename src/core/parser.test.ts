import { afterEach, describe, expect, it, vi } from 'vitest';
import { normalizeModifierText, parseModifierLabel } from './modifierLabels';
import { DIAGNOSTIC_SEVERITY, MAX_REPEAT_CHARS, isValidTimeSig, parseHarm } from './parser';
import { serializeHarm } from './serializer';
import type {
  Diagnostic,
  DiagnosticCode,
  Line,
  Note,
  NoteKey,
  Octave,
  ParseResult,
  Rest,
  Slur,
  Unit,
} from './types';

// ── helpers ────────────────────────────────────────────────────────────────

/** U+00A0 (NBSP) — viết bằng mã để file nguồn không chứa ký tự vô hình. */
const NBSP = String.fromCharCode(0xa0);

function n(key: NoteKey, octave: Octave = 0, sharp = false, beats = 1): Note {
  return { kind: 'note', key, octave, sharp, beats };
}
function rest(beats = 1): Rest {
  return { kind: 'rest', beats };
}
function slur(...notes: Note[]): Slur {
  return { kind: 'slur', notes };
}

function allLines(r: ParseResult): Line[] {
  return r.song.sections.flatMap((s) => s.lines);
}
/** Units của dòng model đầu tiên. */
function units(text: string): Unit[] {
  return allLines(parseHarm(text))[0]?.units ?? [];
}
function codes(r: ParseResult): DiagnosticCode[] {
  return r.diagnostics.map((d) => d.code);
}
function only(r: ParseResult, code: DiagnosticCode): Diagnostic {
  const found = r.diagnostics.filter((d) => d.code === code);
  expect(found, `${code} in ${JSON.stringify(r.diagnostics)}`).toHaveLength(1);
  return found[0] as Diagnostic;
}

// ── tokens ─────────────────────────────────────────────────────────────────

describe('parseHarm: tokens', () => {
  it('reads every key (incl. ",") as 1-beat plain notes', () => {
    expect(units('Z X C V B N M ,')).toStrictEqual([
      n('Z'),
      n('X'),
      n('C'),
      n('V'),
      n('B'),
      n('N'),
      n('M'),
      n(','),
    ]);
  });

  it('is case-insensitive and stores uppercase keys', () => {
    expect(units('z x c v b n m ,')).toStrictEqual(units('Z X C V B N M ,'));
  });

  it('reads durations: decimals, leading dot, trailing dot, fractions', () => {
    expect(units('Z*.5 X*0.25 C*1.5 V*4 B*1/3 N*2. M*1 ,*0.125')).toStrictEqual([
      n('Z', 0, false, 0.5),
      n('X', 0, false, 0.25),
      n('C', 0, false, 1.5),
      n('V', 0, false, 4),
      n('B', 0, false, 1 / 3),
      n('N', 0, false, 2),
      n('M', 0, false, 1),
      n(',', 0, false, 0.125),
    ]);
  });

  it('reads rests "_" and "_*dur"', () => {
    expect(units('Z _ _*2 _*.5 _*1/3')).toStrictEqual([
      n('Z'),
      rest(1),
      rest(2),
      rest(0.5),
      rest(1 / 3),
    ]);
  });

  it('reads 2- and 3-note slurs, dividing the total equally', () => {
    expect(units('X-C')).toStrictEqual([slur(n('X', 0, false, 0.5), n('C', 0, false, 0.5))]);
    expect(units('X-C*2')).toStrictEqual([slur(n('X'), n('C'))]);
    expect(units('x-c*.5')).toStrictEqual([slur(n('X', 0, false, 0.25), n('C', 0, false, 0.25))]);
    expect(units('Z-X-C')).toStrictEqual([
      slur(n('Z', 0, false, 1 / 3), n('X', 0, false, 1 / 3), n('C', 0, false, 1 / 3)),
    ]);
    expect(units('Z-X-C*3')).toStrictEqual([slur(n('Z'), n('X'), n('C'))]);
    expect(units('Z-,')).toStrictEqual([slur(n('Z', 0, false, 0.5), n(',', 0, false, 0.5))]);
  });

  it('reads every prefix (case-insensitive, SL/SR equivalent to LS/RS)', () => {
    expect(units('L:N R:N S:N LS:N RS:N SL:N SR:N')).toStrictEqual([
      n('N', -1),
      n('N', 1),
      n('N', 0, true),
      n('N', -1, true),
      n('N', 1, true),
      n('N', -1, true),
      n('N', 1, true),
    ]);
    expect(units('l:n r:n s:n ls:n Rs:n sL:n sr:,')).toStrictEqual([
      n('N', -1),
      n('N', 1),
      n('N', 0, true),
      n('N', -1, true),
      n('N', 1, true),
      n('N', -1, true),
      n(',', 1, true),
    ]);
  });

  it('combines prefixes with durations and slurs', () => {
    expect(units('L:N*2 R:,*.5')).toStrictEqual([n('N', -1, false, 2), n(',', 1, false, 0.5)]);
    expect(units('Z-L:N')).toStrictEqual([slur(n('Z', 0, false, 0.5), n('N', -1, false, 0.5))]);
    expect(units('R:X-S:C*2')).toStrictEqual([slur(n('X', 1), n('C', 0, true))]);
  });

  it('reads the full Vietnamese hold labels', () => {
    expect(
      units(
        '[giữ chuột trái] Z [thả chuột trái] [giữ chuột phải] X [thả chuột phải] [giữ scroll] C [thả scroll]',
      ),
    ).toStrictEqual([n('Z', -1), n('X', 1), n('C', 0, true)]);
  });

  it('reads labels case-insensitively, without diacritics, NFD, extra spaces', () => {
    const r = parseHarm(
      [
        '[Giữ Chuột Trái] Z [THẢ CHUỘT TRÁI]',
        '[giu chuot phai] X [tha chuot phai]',
        '[  GIU   scroll ] C [Tha Scroll]',
        `${'[giữ chuột trái]'.normalize('NFD')} V ${'[thả chuột trái]'.normalize('NFD')}`,
      ].join('\n'),
    );
    expect(r.diagnostics).toEqual([]);
    expect(allLines(r).map((l) => l.units)).toStrictEqual([
      [n('Z', -1)],
      [n('X', 1)],
      [n('C', 0, true)],
      [n('V', -1)],
    ]);
  });

  it('reads the abbreviations [L] [/L] [R] [/R] [S] [/S] (any case)', () => {
    expect(units('[L] Z [/L] [R] X [/R] [S] C [/S] [l] V [/l] [r] [s] B [/s] [/r]')).toStrictEqual([
      n('Z', -1),
      n('X', 1),
      n('C', 0, true),
      n('V', -1),
      n('B', 1, true),
    ]);
  });

  it('splits brackets glued to notes ("N[/L]", "[R]N[/R]Z")', () => {
    const r = parseHarm('[L]N[/L] [R]N[/R]Z X[S]C[/S]');
    expect(r.diagnostics).toEqual([]);
    expect(allLines(r)[0]?.units).toStrictEqual([
      n('N', -1),
      n('N', 1),
      n('Z'),
      n('X'),
      n('C', 0, true),
    ]);
  });

  it('normalizes modifier text (helper)', () => {
    expect(normalizeModifierText('  Giữ   Chuột  TRÁI ')).toBe('giu chuot trai');
    expect(normalizeModifierText('Đđ')).toBe('dd');
    expect(parseModifierLabel('/S')).toEqual({ action: 'release', button: 'scroll' });
    expect(parseModifierLabel('giữ chuột')).toBeNull();
  });
});

// ── directives ─────────────────────────────────────────────────────────────

describe('parseHarm: directives', () => {
  it('uses defaults for an empty file', () => {
    const r = parseHarm('');
    expect(r).toStrictEqual({
      song: {
        id: '',
        title: '',
        bpm: 90,
        timeSig: { num: 4, den: 4 },
        scrollDir: 1,
        sections: [],
      },
      diagnostics: [],
      lineOrigins: [],
      lineSpans: [],
      unitSpans: [],
      ok: true,
    });
    expect('artist' in r.song).toBe(false);
  });

  it('sets id from options', () => {
    expect(parseHarm('Z', { id: 'abc' }).song.id).toBe('abc');
  });

  it('reads every directive (case-insensitive name, trimmed value)', () => {
    const r = parseHarm(
      '@title   Bài hát  hay  \n@ARTIST Ca sĩ\n@Bpm 120.5\n@time 3/4\n@scroll -1\n  @bpm  76 ',
    );
    expect(r.diagnostics).toEqual([]);
    expect(r.song).toStrictEqual({
      id: '',
      title: 'Bài hát  hay',
      artist: 'Ca sĩ',
      bpm: 76,
      timeSig: { num: 3, den: 4 },
      scrollDir: -1,
      sections: [],
    });
  });

  it('accepts @scroll +1 | 1 | -1', () => {
    expect(parseHarm('@scroll -1\n@scroll +1').song.scrollDir).toBe(1);
    expect(parseHarm('@scroll -1\n@scroll 1').song.scrollDir).toBe(1);
    expect(parseHarm('@scroll -1').song.scrollDir).toBe(-1);
  });

  it('lets later duplicates override earlier ones', () => {
    const r = parseHarm('@title A\n@title B\n@bpm 100\n@bpm 120\n@time 3/4\n@time 6/8');
    expect(r.song.title).toBe('B');
    expect(r.song.bpm).toBe(120);
    expect(r.song.timeSig).toEqual({ num: 6, den: 8 });
  });

  it('omits artist when empty or absent', () => {
    expect('artist' in parseHarm('@artist').song).toBe(false);
    expect('artist' in parseHarm('@artist   ').song).toBe(false);
    expect('artist' in parseHarm('@artist X\n@artist').song).toBe(false);
    expect(parseHarm('@artist X').song.artist).toBe('X');
  });

  it('accepts valid time signatures at the limits', () => {
    expect(parseHarm('@time 1/1').song.timeSig).toEqual({ num: 1, den: 1 });
    expect(parseHarm('@time 32/32').song.timeSig).toEqual({ num: 32, den: 32 });
    expect(parseHarm('@time 7/16').song.timeSig).toEqual({ num: 7, den: 16 });
  });

  it.each([
    ['@bpm abc', 'bpm', 'abc', 6, 3],
    ['@bpm 0', 'bpm', '0', 6, 1],
    ['@bpm -5', 'bpm', '-5', 6, 2],
    ['@bpm 1/2', 'bpm', '1/2', 6, 3],
    ['@bpm 1e2', 'bpm', '1e2', 6, 3],
    ['@time 4', 'time', '4', 7, 1],
    ['@time 0/4', 'time', '0/4', 7, 3],
    ['@time 33/4', 'time', '33/4', 7, 4],
    ['@time 4/3', 'time', '4/3', 7, 3],
    ['@time 4/64', 'time', '4/64', 7, 4],
    ['@time a/b', 'time', 'a/b', 7, 3],
    ['@time 4 / 4', 'time', '4 / 4', 7, 5],
    ['@scroll 2', 'scroll', '2', 9, 1],
    ['@scroll +2', 'scroll', '+2', 9, 2],
    ['@scroll up', 'scroll', 'up', 9, 2],
  ])(
    '%s → invalid-directive-value (error) and keeps the default',
    (text, name, value, col, len) => {
      const r = parseHarm(text);
      expect(r.ok).toBe(false);
      expect(r.diagnostics).toEqual([
        {
          severity: 'error',
          code: 'invalid-directive-value',
          line: 1,
          column: col,
          length: len,
          params: { name, value },
        },
      ]);
      expect(r.song.bpm).toBe(90);
      expect(r.song.timeSig).toEqual({ num: 4, den: 4 });
      expect(r.song.scrollDir).toBe(1);
    },
  );

  it('reports an empty value over the whole directive', () => {
    expect(parseHarm('@bpm').diagnostics).toEqual([
      {
        severity: 'error',
        code: 'invalid-directive-value',
        line: 1,
        column: 1,
        length: 4,
        params: { name: 'bpm', value: '' },
      },
    ]);
  });

  it('keeps the previous valid value after an invalid one', () => {
    const r = parseHarm('@bpm 100\n@bpm abc\n@time 3/4\n@time x\n@scroll -1\n@scroll 0');
    expect(r.song.bpm).toBe(100);
    expect(r.song.timeSig).toEqual({ num: 3, den: 4 });
    expect(r.song.scrollDir).toBe(-1);
    expect(r.diagnostics.map((d) => d.line)).toEqual([2, 4, 6]);
  });

  it('warns on unknown directives (case kept in params)', () => {
    const r = parseHarm('Z\n  @Foo bar');
    expect(r.ok).toBe(true);
    expect(r.diagnostics).toEqual([
      {
        severity: 'warning',
        code: 'unknown-directive',
        line: 2,
        column: 3,
        length: 4,
        params: { name: 'Foo' },
      },
    ]);
  });
});

// ── sections ───────────────────────────────────────────────────────────────

describe('parseHarm: sections', () => {
  it('creates "Main" lazily for notes before any header', () => {
    expect(parseHarm('Z').song.sections).toStrictEqual([
      { name: 'Main', lines: [{ units: [n('Z')] }] },
    ]);
    expect(parseHarm('Z\n# A\nX').song.sections.map((s) => s.name)).toEqual(['Main', 'A']);
  });

  it('has no Main when the file starts with a header', () => {
    expect(parseHarm('# A\nZ').song.sections).toStrictEqual([
      { name: 'A', lines: [{ units: [n('Z')] }] },
    ]);
    expect(parseHarm('// c\n@bpm 100\n\n# A\nZ').song.sections.map((s) => s.name)).toEqual(['A']);
  });

  it('does not create Main for a modifier-only line before the first header', () => {
    const r = parseHarm('[R]\n# A\nZ [/R]');
    expect(r.diagnostics).toEqual([]);
    expect(r.song.sections).toStrictEqual([{ name: 'A', lines: [{ units: [n('Z', 1)] }] }]);
  });

  it('keeps empty sections and allows duplicate names', () => {
    const r = parseHarm('# A\n// chỉ comment\n# B\nZ\n# B\n#\n##   Điệp khúc  ');
    expect(r.song.sections).toStrictEqual([
      { name: 'A', lines: [] },
      { name: 'B', lines: [{ units: [n('Z')] }] },
      { name: 'B', lines: [] },
      { name: 'Main', lines: [] },
      { name: 'Điệp khúc', lines: [] },
    ]);
  });
});

// ── tiền tố lời kiểu cũ (tính năng lời đã bỏ — chỉ còn đọc được file / link cũ) ──────────────

describe('parseHarm: legacy lyric prefix', () => {
  it('never puts a lyric key on a line', () => {
    const line = allLines(parseHarm('Z X'))[0];
    expect(line).toStrictEqual({ units: [n('Z'), n('X')] });
    expect(line && 'lyric' in line).toBe(false);
  });

  it('silently drops the text before the first ": " (no diagnostic, notes unchanged)', () => {
    const r = parseHarm('  Một  hai :  Z X');
    expect(r.diagnostics).toEqual([]);
    expect(allLines(r)[0]).toStrictEqual({ units: [n('Z'), n('X')] });
    expect(allLines(parseHarm('a\t:\tZ'))[0]).toStrictEqual({ units: [n('Z')] });
    expect(allLines(parseHarm(': Z'))[0]).toStrictEqual({ units: [n('Z')] });
  });

  it('old "lời: tokens" files parse to the same notes as the bare tokens', () => {
    const legacy = '@title A\n# S\nMột hai ba: Z X-C _ [R] V\nbốn: B [/R]\n';
    const bare = '@title A\n# S\nZ X-C _ [R] V\nB [/R]\n';
    const a = parseHarm(legacy);
    const b = parseHarm(bare);
    expect(a.diagnostics).toEqual([]);
    expect(a.song).toEqual(b.song);
    // phần token bắt đầu sau tiền tố cũ
    expect(a.lineSpans.map((s) => s.tokensStart)).toEqual([12, 5]);
    expect(a.unitSpans[0]?.[0]).toMatchObject({ line: 3, start: 12, end: 13 });
  });

  it('keeps the L:N R:N S:N LS:N RS:N prefix disambiguation (":" glued to the token)', () => {
    expect(allLines(parseHarm('L:N S:Z'))[0]).toStrictEqual({
      units: [n('N', -1), n('Z', 0, true)],
    });
    // `L:2` không phải tiền tố lời (":" dính chữ số) → token lạ, `X` vẫn là nốt
    const odd = parseHarm('L:2 X');
    expect(allLines(odd)[0]).toStrictEqual({ units: [n('X')] });
    expect(odd.diagnostics).toMatchObject([{ code: 'unknown-token', column: 1, length: 3 }]);
    expect(allLines(parseHarm('LS:N RS:Z'))[0]).toStrictEqual({
      units: [n('N', -1, true), n('Z', 1, true)],
    });
    expect(allLines(parseHarm('Một hai: L:N R:Z'))[0]).toStrictEqual({
      units: [n('N', -1), n('Z', 1)],
    });
    expect(allLines(parseHarm('10:30 sáng: Z X'))[0]).toStrictEqual({
      units: [n('Z'), n('X')],
    });
  });

  it('a legacy prefix with nothing after it is not a line — warning so the empty line is explained', () => {
    const r = parseHarm('lời bài:');
    expect(r.song.sections).toEqual([]);
    expect(r.diagnostics).toEqual([
      {
        severity: 'warning',
        code: 'legacy-prefix-ignored',
        line: 1,
        column: 1,
        length: 8,
        params: { text: 'lời bài:' },
      },
    ]);
  });

  it('warns (column span + text) when the dropped prefix is valid note tokens — a stray ":" (R5)', () => {
    // dấu ":" lạc ở cuối dòng nuốt cả dòng nốt
    const all = parseHarm('Z X C V B N M ,:');
    expect(all.song.sections).toEqual([]);
    expect(all.diagnostics).toEqual([
      {
        severity: 'warning',
        code: 'legacy-prefix-ignored',
        line: 1,
        column: 1,
        length: 16,
        params: { text: 'Z X C V B N M ,:' },
      },
    ]);
    // giữa dòng: chỉ còn phần sau dấu ":"
    const mid = parseHarm('  Z X C: V B');
    expect(allLines(mid)).toStrictEqual([{ units: [n('V'), n('B')] }]);
    expect(mid.diagnostics).toMatchObject([
      { severity: 'warning', code: 'legacy-prefix-ignored', line: 1, column: 3, length: 6 },
    ]);
    // nốt có độ dài / luyến / nghỉ / hold cũng là "nốt"
    expect(parseHarm('Z*2 X-C _ [L] [/L]: V').diagnostics.map((d) => d.code)).toEqual([
      'legacy-prefix-ignored',
    ]);
    // trích dẫn dài bị cắt
    const long = parseHarm(`${'Z '.repeat(20)}: X`);
    const text = String(long.diagnostics[0]?.params?.text ?? '');
    expect(text.length).toBeLessThanOrEqual(24);
    expect(text.endsWith('…')).toBe(true);
  });

  it('real lyric prefixes (words that are not note tokens) stay silent', () => {
    for (const src of ['Đồ rê mi: Z X C', 'Một hai ba: Z', 'La si Do: Z X', 'Mưa: Z']) {
      expect(parseHarm(src).diagnostics).toEqual([]);
    }
    // ";" lạc vẫn là token lạ (lỗi) như trước
    expect(parseHarm('Z X C V B N M ,;').diagnostics.map((d) => d.code)).toEqual(['unknown-token']);
  });

  it('no duplicate legacy-prefix warning from @repeat replays', () => {
    const r = parseHarm('# A\nZ X: C\n# B\n@repeat A\n@repeat A');
    expect(r.diagnostics.map((d) => [d.line, d.code])).toEqual([[2, 'legacy-prefix-ignored']]);
  });

  it('keeps rest-only lines', () => {
    const r = parseHarm('la: _ _*2');
    expect(r.diagnostics).toEqual([]);
    expect(allLines(r)).toStrictEqual([{ units: [rest(), rest(2)] }]);
  });

  it('a prefix-only line still applies its holds', () => {
    const r = parseHarm('Lời: [giữ chuột phải]\nZ [/R]');
    expect(r.diagnostics).toEqual([]);
    expect(allLines(r)).toStrictEqual([{ units: [n('Z', 1)] }]);
  });
});

// ── holds ──────────────────────────────────────────────────────────────────

describe('parseHarm: holds', () => {
  it('keeps holds across multiple lines; standalone modifier lines are not model lines', () => {
    const r = parseHarm('[giữ chuột phải]\nZ X\nlời: C\n[thả chuột phải]\nV');
    expect(r.diagnostics).toEqual([]);
    expect(allLines(r)).toStrictEqual([
      { units: [n('Z', 1), n('X', 1)] },
      { units: [n('C', 1)] },
      { units: [n('V')] },
    ]);
    expect(r.lineOrigins).toEqual([{ sourceLine: 2 }, { sourceLine: 3 }, { sourceLine: 5 }]);
  });

  it('keeps holds across sections', () => {
    const r = parseHarm('# A\n[L] Z\n# B\nX [/L] C');
    expect(r.song.sections.map((s) => s.lines[0]?.units)).toStrictEqual([
      [n('Z', -1)],
      [n('X', -1), n('C')],
    ]);
  });

  it('combines scroll with left or right, released in any order', () => {
    expect(units('[L] [S] Z [/S] X [/L] C')).toStrictEqual([n('Z', -1, true), n('X', -1), n('C')]);
    expect(units('[R] [S] Z [/R] X [/S] C')).toStrictEqual([
      n('Z', 1, true),
      n('X', 0, true),
      n('C'),
    ]);
    expect(units('[S] [L] Z [/L] [R] X [/R] [/S]')).toStrictEqual([
      n('Z', -1, true),
      n('X', 1, true),
    ]);
  });

  it('makes prefixes cumulative with holds', () => {
    const r = parseHarm('[L] S:Z [/L] [S] L:Z R:X [/S] [R] R:Z RS:X [/R] [L] L:C [/L]');
    expect(r.diagnostics).toEqual([]);
    expect(allLines(r)[0]?.units).toStrictEqual([
      n('Z', -1, true),
      n('Z', -1, true),
      n('X', 1, true),
      n('Z', 1),
      n('X', 1, true),
      n('C', -1),
    ]);
  });

  it('reports prefix-conflict when a prefix fights the hold, and the hold wins', () => {
    const r = parseHarm('[R] L:Z [/R] [L] R:X [/L]');
    expect(r.diagnostics).toEqual([
      {
        severity: 'error',
        code: 'prefix-conflict',
        line: 1,
        column: 5,
        length: 3,
        params: { token: 'L:Z' },
      },
      {
        severity: 'error',
        code: 'prefix-conflict',
        line: 1,
        column: 18,
        length: 3,
        params: { token: 'R:X' },
      },
    ]);
    expect(allLines(r)[0]?.units).toStrictEqual([n('Z', 1), n('X', -1)]);
  });

  it('reports prefix-conflict once per slur token', () => {
    const r = parseHarm('[R] L:X-L:C*2 [/R]');
    expect(only(r, 'prefix-conflict')).toMatchObject({ column: 5, length: 9 });
    expect(allLines(r)[0]?.units).toStrictEqual([slur(n('X', 1), n('C', 1))]);
  });

  it('reports self-conflicting prefixes (LR:, RL:, LRS:) and keeps the note', () => {
    const r = parseHarm('LR:Z RL:X SLR:C');
    expect(codes(r)).toEqual(['prefix-conflict', 'prefix-conflict', 'prefix-conflict']);
    expect(r.diagnostics.map((d) => [d.column, d.length, d.params?.token])).toEqual([
      [1, 4, 'LR:Z'],
      [6, 4, 'RL:X'],
      [11, 5, 'SLR:C'],
    ]);
    expect(allLines(r)[0]?.units).toStrictEqual([n('Z'), n('X'), n('C', 0, true)]);
  });

  it('warns (not errors) for holds left open at the end, at the hold position', () => {
    const r = parseHarm('Z\n  [giữ chuột trái] X\n[S] C');
    expect(r.ok).toBe(true);
    expect(r.diagnostics).toEqual([
      {
        severity: 'warning',
        code: 'unclosed-hold',
        line: 2,
        column: 3,
        length: 16,
        params: { button: 'left' },
      },
      {
        severity: 'warning',
        code: 'unclosed-hold',
        line: 3,
        column: 1,
        length: 3,
        params: { button: 'scroll' },
      },
    ]);
    expect(allLines(r).map((l) => l.units)).toStrictEqual([
      [n('Z')],
      [n('X', -1)],
      [n('C', -1, true)],
    ]);
  });

  it('does not warn once every hold is released', () => {
    expect(parseHarm('[L] Z\n[/L]\n[S]\n[/S]').diagnostics).toEqual([]);
  });
});

// ── errors ─────────────────────────────────────────────────────────────────

describe('parseHarm: errors (line + column)', () => {
  it('release-without-hold for each button', () => {
    const r = parseHarm('Z [/L]\n[thả chuột phải]\n  [/s]');
    expect(r.ok).toBe(false);
    expect(r.diagnostics).toEqual([
      {
        severity: 'error',
        code: 'release-without-hold',
        line: 1,
        column: 3,
        length: 4,
        params: { button: 'left' },
      },
      {
        severity: 'error',
        code: 'release-without-hold',
        line: 2,
        column: 1,
        length: 16,
        params: { button: 'right' },
      },
      {
        severity: 'error',
        code: 'release-without-hold',
        line: 3,
        column: 3,
        length: 4,
        params: { button: 'scroll' },
      },
    ]);
  });

  it('hold-conflict (left while right and vice versa); state unchanged', () => {
    const r = parseHarm('[L]\n[R] Z [/L]\n[R] X [giữ chuột trái] C [/R]');
    expect(r.diagnostics).toEqual([
      {
        severity: 'error',
        code: 'hold-conflict',
        line: 2,
        column: 1,
        length: 3,
        params: { button: 'right', other: 'left' },
      },
      {
        severity: 'error',
        code: 'hold-conflict',
        line: 3,
        column: 7,
        length: 16,
        params: { button: 'left', other: 'right' },
      },
    ]);
    expect(allLines(r).map((l) => l.units)).toStrictEqual([[n('Z', -1)], [n('X', 1), n('C', 1)]]);
  });

  it('hold-duplicate for each button', () => {
    const r = parseHarm('[L] [giữ chuột trái] Z [/L]\n[R] [r] X [/R]\n[S] [S] C [/S]');
    expect(
      r.diagnostics.map((d) => [d.code, d.line, d.column, d.length, d.params?.button]),
    ).toEqual([
      ['hold-duplicate', 1, 5, 16, 'left'],
      ['hold-duplicate', 2, 5, 3, 'right'],
      ['hold-duplicate', 3, 5, 3, 'scroll'],
    ]);
    // giữ lặp không làm "thả" hai lần
    expect(codes(r)).not.toContain('release-without-hold');
  });

  it.each([
    ['Z Q X', 3, 'Q'],
    ['X- Z', 1, 'X-'],
    ['Z -X', 3, '-X'],
    ['Z-X- Z', 1, 'Z-X-'],
    ['Q:Z', 1, 'Q:Z'],
    ['LL:Z', 1, 'LL:Z'],
    ['X:Z', 1, 'X:Z'],
    ['ZZ', 1, 'ZZ'],
    ['Z N]', 3, 'N]'],
    ['_x', 1, '_x'],
    ['__', 1, '__'],
    ['*2', 1, '*2'],
    ['X**2', 1, 'X**2'],
    ['A', 1, 'A'],
    ['Z 1', 3, '1'],
    ['[foo] Z', 1, '[foo]'],
    ['[] Z', 1, '[]'],
    ['[L/] Z', 1, '[L/]'],
    ['Z [giữ chuột]', 3, '[giữ chuột]'],
    ['Đ', 1, 'Đ'],
    ['Z 😀', 3, '😀'],
  ])('unknown-token in %j at column %i', (text, column, token) => {
    const r = parseHarm(text);
    expect(r.ok).toBe(false);
    expect(only(r, 'unknown-token')).toEqual({
      severity: 'error',
      code: 'unknown-token',
      line: 1,
      column,
      length: token.length,
      params: { token },
    });
  });

  it('skips unknown tokens but keeps the rest of the line', () => {
    expect(units('Z Q X')).toStrictEqual([n('Z'), n('X')]);
    expect(units('Z X- C')).toStrictEqual([n('Z'), n('C')]);
  });

  it('reports an unclosed bracket as unknown-token for the rest of the line', () => {
    const r = parseHarm('Z [giữ chuột Z X  ');
    expect(r.diagnostics).toEqual([
      {
        severity: 'error',
        code: 'unknown-token',
        line: 1,
        column: 3,
        length: 14,
        params: { token: '[giữ chuột Z X' },
      },
    ]);
    expect(allLines(r)[0]?.units).toStrictEqual([n('Z')]);
  });

  it.each([
    ['Z*0', 'Z*0'],
    ['Z*', 'Z*'],
    ['Z*abc', 'Z*abc'],
    ['Z*-1', 'Z*-1'],
    ['Z*1/0', 'Z*1/0'],
    ['Z*0/2', 'Z*0/2'],
    ['Z*1e3', 'Z*1e3'],
    ['L:Z*0.0', 'L:Z*0.0'],
  ])('invalid-duration %j → recovers with 1 beat', (text, token) => {
    const r = parseHarm(`X ${text}`);
    expect(r.diagnostics).toEqual([
      {
        severity: 'error',
        code: 'invalid-duration',
        line: 1,
        column: 3,
        length: token.length,
        params: { token },
      },
    ]);
    const u = allLines(r)[0]?.units[1];
    expect(u).toMatchObject({ kind: 'note', key: 'Z', beats: 1 });
  });

  it('invalid-duration on rests and slurs recovers with total 1', () => {
    const r = parseHarm('_*0 X-C*x');
    expect(codes(r)).toEqual(['invalid-duration', 'invalid-duration']);
    expect(allLines(r)[0]?.units).toStrictEqual([
      rest(1),
      slur(n('X', 0, false, 0.5), n('C', 0, false, 0.5)),
    ]);
  });

  it('unknown-repeat at the section name', () => {
    const r = parseHarm('# A\nZ\n@repeat  Nope ');
    expect(r.ok).toBe(false);
    expect(r.diagnostics).toEqual([
      {
        severity: 'error',
        code: 'unknown-repeat',
        line: 3,
        column: 10,
        length: 4,
        params: { name: 'Nope' },
      },
    ]);
    expect(parseHarm('@repeat').diagnostics).toEqual([
      {
        severity: 'error',
        code: 'unknown-repeat',
        line: 1,
        column: 1,
        length: 7,
        params: { name: '' },
      },
    ]);
  });

  it('emits //! annotations as warnings', () => {
    const r = parseHarm('Z\n  //!  nốt bị gập quãng  \n// thường');
    expect(r.ok).toBe(true);
    expect(r.diagnostics).toEqual([
      {
        severity: 'warning',
        code: 'annotation',
        line: 2,
        column: 3,
        length: 21,
        params: { text: 'nốt bị gập quãng' },
      },
    ]);
  });

  it('sorts diagnostics by line then column', () => {
    const r = parseHarm('Z [L]\n@foo\nQ W [/R]\n[S]');
    expect(r.diagnostics.map((d) => [d.line, d.column, d.code])).toEqual([
      [1, 3, 'unclosed-hold'],
      [2, 1, 'unknown-directive'],
      [3, 1, 'unknown-token'],
      [3, 3, 'unknown-token'],
      [3, 5, 'release-without-hold'],
      [4, 1, 'unclosed-hold'],
    ]);
  });
});

// ── lineOrigins ────────────────────────────────────────────────────────────

describe('parseHarm: lineOrigins', () => {
  it('maps every model line (flattened) to its source line', () => {
    const r = parseHarm('// c\nZ\n# A\n\n[R]\nX [/R]\n# B\n\nlời: C\n  V');
    expect(allLines(r)).toHaveLength(4);
    expect(r.lineOrigins).toEqual([
      { sourceLine: 2 },
      { sourceLine: 6 },
      { sourceLine: 9 },
      { sourceLine: 10 },
    ]);
  });
});

// ── @repeat ────────────────────────────────────────────────────────────────

describe('parseHarm: @repeat', () => {
  it('re-inserts all note lines of an earlier section', () => {
    const r = parseHarm('# A\nlời: Z*2\nX\n# B\n@repeat A');
    expect(r.diagnostics).toEqual([]);
    const [a, b] = r.song.sections;
    expect(b?.lines).toStrictEqual(a?.lines);
    expect(r.lineOrigins).toEqual([
      { sourceLine: 2 },
      { sourceLine: 3 },
      { sourceLine: 2, repeatLine: 5 },
      { sourceLine: 3, repeatLine: 5 },
    ]);
  });

  it('can be used many times', () => {
    const r = parseHarm('# A\nZ\n# B\n@repeat A\nX\n@repeat A');
    expect(r.song.sections[1]?.lines).toStrictEqual([
      { units: [n('Z')] },
      { units: [n('X')] },
      { units: [n('Z')] },
    ]);
  });

  it('expands nested repeats (a section that itself contains @repeat)', () => {
    const r = parseHarm('# A\nZ\n# B\nX\n@repeat A\n# C\n@repeat B\nC');
    expect(r.diagnostics).toEqual([]);
    expect(r.song.sections[2]?.lines).toStrictEqual([
      { units: [n('X')] },
      { units: [n('Z')] },
      { units: [n('C')] },
    ]);
    expect(r.lineOrigins.slice(3)).toEqual([
      { sourceLine: 4, repeatLine: 7 },
      { sourceLine: 2, repeatLine: 7 },
      { sourceLine: 8 },
    ]);
  });

  it('repeats the current section using a snapshot of its lines so far', () => {
    const r = parseHarm('# A\nZ\nX\n@repeat A\nC\n@repeat A');
    expect(r.diagnostics).toEqual([]);
    expect(r.song.sections[0]?.lines.map((l) => (l.units[0] as Note).key)).toEqual([
      'Z',
      'X',
      'Z',
      'X',
      'C',
      'Z',
      'X',
      'Z',
      'X',
      'C',
    ]);
  });

  it('works for the lazy Main section before any header', () => {
    const r = parseHarm('Z\n@repeat main');
    expect(r.song.sections).toStrictEqual([
      { name: 'Main', lines: [{ units: [n('Z')] }, { units: [n('Z')] }] },
    ]);
    expect(codes(parseHarm('@repeat Main\n# A'))).toEqual(['unknown-repeat']);
  });

  it('matches names exactly first, then case-insensitively (NFC)', () => {
    const exact = parseHarm('# a\nZ\n# A\nX\n# B\n@repeat a');
    expect(exact.song.sections[2]?.lines).toStrictEqual([{ units: [n('Z')] }]);
    const fallback = parseHarm(`# ${'Điệp Khúc'.normalize('NFD')}\nZ\n# B\n@repeat  điệp khúc`);
    expect(fallback.diagnostics).toEqual([]);
    expect(fallback.song.sections[1]?.lines).toStrictEqual([{ units: [n('Z')] }]);
  });

  it('falls back to whitespace-insensitive names (NBSP, double space, tab)', () => {
    for (const header of [`ĐIỆP${NBSP}KHÚC`, 'ĐIỆP  KHÚC', 'ĐIỆP\tKHÚC', `điệp ${NBSP} khúc`]) {
      const r = parseHarm(`# ${header}\nZ\n# B\n@repeat ĐIỆP KHÚC`);
      expect(r.diagnostics, JSON.stringify(header)).toEqual([]);
      expect(r.song.sections[1]?.lines).toStrictEqual([{ units: [n('Z')] }]);
    }
    // và ngược lại: NBSP ở dòng @repeat
    const r = parseHarm(`# ĐIỆP KHÚC\nZ\n# B\n@repeat ĐIỆP${NBSP}KHÚC`);
    expect(r.diagnostics).toEqual([]);
    expect(r.song.sections[1]?.lines).toStrictEqual([{ units: [n('Z')] }]);
    // khoảng trắng vẫn tách từ: "AB" không khớp "A B"
    expect(codes(parseHarm('# A B\nZ\n# C\n@repeat AB'))).toEqual(['unknown-repeat']);
  });

  it('keeps exact matches ahead of the normalized fallback', () => {
    // "A  B" khớp chính xác dù "A B" (cùng khóa chuẩn hóa) được khai báo sau
    const r = parseHarm('# A  B\nZ\n# A B\nX\n# C\n@repeat A  B');
    expect(r.song.sections[2]?.lines).toStrictEqual([{ units: [n('Z')] }]);
    // không có tên chính xác → section gần nhất theo khóa chuẩn hóa
    const r2 = parseHarm(`# A  B\nZ\n# a b\nX\n# C\n@repeat A${NBSP}B`);
    expect(r2.song.sections[2]?.lines).toStrictEqual([{ units: [n('X')] }]);
  });

  it('looks sections up in constant time (many headers + many unknown repeats)', () => {
    const count = 20_000;
    const text =
      Array.from({ length: count }, (_, i) => `# S${i}`).join('\n') +
      '\n' +
      '@repeat không có\n'.repeat(count);
    const t0 = performance.now();
    const r = parseHarm(text);
    expect(performance.now() - t0).toBeLessThan(3000);
    expect(r.diagnostics).toHaveLength(count);
    expect(r.song.sections).toHaveLength(count);
  });

  it('uses the most recently started section with that name', () => {
    const r = parseHarm('# A\nZ\n# A\nX\n# B\n@repeat A');
    expect(r.song.sections[2]?.lines).toStrictEqual([{ units: [n('X')] }]);
  });

  it('applies the hold state at the @repeat point to the repeated notes', () => {
    const r = parseHarm('# A\nZ X\n# B\n[giữ chuột phải]\n@repeat A\n[thả chuột phải]');
    expect(r.diagnostics).toEqual([]);
    expect(r.song.sections[1]?.lines).toStrictEqual([{ units: [n('Z', 1), n('X', 1)] }]);
  });

  it('repeats modifier-only lines too', () => {
    const r = parseHarm('# A\n[L]\nZ\n[/L]\n# B\n@repeat A\nX');
    expect(r.diagnostics).toEqual([]);
    expect(r.song.sections[1]?.lines).toStrictEqual([{ units: [n('Z', -1)] }, { units: [n('X')] }]);
  });

  it('reports state errors inside a replay at the @repeat line with fromLine', () => {
    const r = parseHarm('# A\n[R] Z [/R]\n# B\n[L]\n@repeat A\n[/L]');
    expect(r.diagnostics).toEqual([
      {
        severity: 'error',
        code: 'hold-conflict',
        line: 5,
        column: 1,
        length: 9,
        params: { button: 'right', other: 'left', fromLine: 2 },
      },
      {
        severity: 'error',
        code: 'release-without-hold',
        line: 5,
        column: 1,
        length: 9,
        params: { button: 'right', fromLine: 2 },
      },
    ]);
    expect(r.song.sections[1]?.lines).toStrictEqual([{ units: [n('Z', -1)] }]);
  });

  it('reports prefix-conflict caused by the replay context at the @repeat line', () => {
    const r = parseHarm('# A\nL:Z\n# B\n[R]\n@repeat A\n[/R]');
    expect(r.diagnostics).toEqual([
      {
        severity: 'error',
        code: 'prefix-conflict',
        line: 5,
        column: 1,
        length: 9,
        params: { token: 'L:Z', fromLine: 2 },
      },
    ]);
    expect(r.song.sections[1]?.lines).toStrictEqual([{ units: [n('Z', 1)] }]);
  });

  it('does not duplicate token-level diagnostics from repeated lines', () => {
    const r = parseHarm('# A\na b: Z Q*2 X*0 LR:C\nlời: [S]\n[/S] W W\n# B\n@repeat A\n@repeat A');
    expect(r.diagnostics.map((d) => [d.line, d.code])).toEqual([
      [2, 'unknown-token'],
      [2, 'invalid-duration'],
      [2, 'prefix-conflict'],
      [4, 'unknown-token'],
      [4, 'unknown-token'],
    ]);
    expect(r.song.sections[1]?.lines).toHaveLength(2);
  });

  it('remembers the @repeat line and the source line for holds opened during a replay', () => {
    const r = parseHarm('# A\nZ [S]\n# B\n[/S]\n  @repeat A');
    expect(r.diagnostics).toEqual([
      {
        severity: 'warning',
        code: 'unclosed-hold',
        line: 5,
        column: 1,
        length: 11,
        params: { button: 'scroll', fromLine: 2 },
      },
    ]);
    // hold mở ở dòng gốc (không phải replay) không có fromLine
    expect(only(parseHarm('# A\nZ [S]\nX'), 'unclosed-hold').params).toEqual({ button: 'scroll' });
  });
});

// ── @repeat budget ─────────────────────────────────────────────────────────

describe('parseHarm: @repeat budget', () => {
  const unitCount = (r: ParseResult): number => allLines(r).reduce((s, l) => s + l.units.length, 0);

  it('stops expanding pathological doubling repeats (no hang) and warns once', () => {
    const text = `# A\nZ\n${'@repeat A\n'.repeat(40)}`;
    const t0 = performance.now();
    const r = parseHarm(text);
    expect(performance.now() - t0).toBeLessThan(3000);
    const lines = allLines(r).length;
    expect(lines).toBeGreaterThan(1000);
    // mỗi dòng replay "Z" tốn 2 ký tự
    expect(lines).toBeLessThanOrEqual(1 + MAX_REPEAT_CHARS / 2);
    expect(r.ok).toBe(true);
    expect(r.diagnostics.map((d) => [d.code, d.severity])).toEqual([['repeat-limit', 'warning']]);
  });

  it('bounds the work for wide lines too (budget counts characters, not lines)', () => {
    // nguồn ~1.1 KB: trước đây mở rộng thành ~10 triệu nốt và treo ~15 s
    const text = `@title Bom nho\n# A\n${'Z '.repeat(500)}\n${'@repeat A\n'.repeat(16)}`;
    expect(text.length).toBeLessThan(1200);
    const t0 = performance.now();
    const r = parseHarm(text);
    expect(performance.now() - t0).toBeLessThan(3000);
    expect(unitCount(r)).toBeLessThanOrEqual(500 + MAX_REPEAT_CHARS / 2);
    expect(unitCount(r)).toBeGreaterThan(500);
    expect(r.ok).toBe(true);
    expect(codes(r)).toEqual(['repeat-limit']);
  });

  it('charges length + 1 per replayed line and reports where the expansion stopped', () => {
    const wide = `Z${' Z'.repeat(499)}`; // 999 ký tự → 1000 mỗi lần replay
    const fit = Math.floor(MAX_REPEAT_CHARS / (wide.length + 1));
    const text = `# A\n${wide}\n# B\n${'@repeat A\n'.repeat(fit + 3)}`;
    const r = parseHarm(text);
    expect(r.song.sections[1]?.lines).toHaveLength(fit);
    // @repeat đầu tiên không vừa: dòng 3 + fit + 1, gạch chân tên section
    expect(r.diagnostics).toEqual([
      {
        severity: 'warning',
        code: 'repeat-limit',
        line: 4 + fit,
        column: 9,
        length: 1,
        params: { name: 'A', limit: MAX_REPEAT_CHARS },
      },
    ]);
    // các dòng replay vẫn mang lineOrigins
    expect(r.lineOrigins.at(-1)).toEqual({ sourceLine: 2, repeatLine: 3 + fit });
  });

  it('skips every later @repeat once the budget is spent (even small ones)', () => {
    const wide = 'Z '.repeat(1000).trimEnd();
    const text = `# A\n${wide}\n# S\nX\n# B\n${'@repeat A\n'.repeat(200)}@repeat S\n`;
    const r = parseHarm(text);
    const b = r.song.sections[2];
    expect(b?.lines.length).toBeLessThan(200);
    expect(b?.lines.some((l) => l.units.length === 1)).toBe(false);
    expect(codes(r)).toEqual(['repeat-limit']);
  });

  it('does not warn for songs well inside the budget', () => {
    const line = 'một hai ba bốn năm sáu bảy tám: Z X C V B N M ,';
    const chorus = Array.from({ length: 40 }, () => line).join('\n');
    const text = `# ĐIỆP KHÚC\n${chorus}\n# B\n${'@repeat ĐIỆP KHÚC\n'.repeat(20)}`;
    const r = parseHarm(text);
    expect(r.diagnostics).toEqual([]);
    expect(r.song.sections[1]?.lines).toHaveLength(40 * 20);
  });
});

describe('parseHarm: helpers', () => {
  it('isValidTimeSig matches what @time accepts', () => {
    expect(isValidTimeSig({ num: 4, den: 4 })).toBe(true);
    expect(isValidTimeSig({ num: 32, den: 32 })).toBe(true);
    expect(isValidTimeSig({ num: 1, den: 1 })).toBe(true);
    for (const [num, den] of [
      [0, 4],
      [33, 4],
      [4.5, 4],
      [4, 3],
      [4, 64],
      [Number.NaN, 4],
    ] as const) {
      expect(isValidTimeSig({ num, den }), `${num}/${den}`).toBe(false);
      expect(codes(parseHarm(`@time ${num}/${den}`))).toEqual(['invalid-directive-value']);
    }
  });

  it('gives every diagnostic code a severity', () => {
    expect(DIAGNOSTIC_SEVERITY['repeat-limit']).toBe('warning');
  });
});

// ── input encoding ─────────────────────────────────────────────────────────

describe('parseHarm: input', () => {
  const lf = '@title A\n# S\nlời ơi: Z [R] X\n[/R]\n';

  it('accepts CRLF and a leading BOM', () => {
    const crlf = `\uFEFF${lf.replace(/\n/g, '\r\n')}`;
    expect(parseHarm(crlf)).toStrictEqual(parseHarm(lf));
    expect(parseHarm(crlf).diagnostics).toEqual([]);
    expect(parseHarm('\uFEFFQ').diagnostics[0]).toMatchObject({ line: 1, column: 1 });
    expect(parseHarm('\uFEFF@bpm 100').song.bpm).toBe(100);
  });

  it('a lone CR is a line break too (like the Editor, D-100): same model as LF', () => {
    const cr = lf.replace(/\n/g, '\r');
    expect(parseHarm(cr)).toStrictEqual(parseHarm(lf));
    // CR CR LF = 2 xu\u1ED1ng d\u00F2ng (d\u00F2ng tr\u1ED1ng \u1EDF gi\u1EEFa); CRLF v\u1EABn l\u00E0 1
    const r = parseHarm('Z\r\r\nQ\r\nW');
    expect(r.diagnostics.map((d) => [d.code, d.line])).toEqual([
      ['unknown-token', 3],
      ['unknown-token', 4],
    ]);
    // tr\u01B0\u1EDBc \u0111\u00E2y `@title A\rB` cho title 'A\rB'; Editor l\u1EA1i t\u00E1ch d\u00F2ng \u1EDF CR \u2192 title 'A' + n\u1ED1t B
    const t = parseHarm('@title A\rB');
    expect(t.song.title).toBe('A');
    expect(t.song.sections[0]?.lines[0]?.units).toStrictEqual([n('B')]);
  });

  it('computes columns in the original (untrimmed) line, UTF-16', () => {
    const r = parseHarm('\t  Z  Q\nlời ơi: 😀 W');
    const unknown = r.diagnostics.filter((d) => d.code === 'unknown-token');
    expect(unknown.map((d) => [d.line, d.column, d.length])).toEqual([
      [1, 7, 1],
      [2, 9, 2],
      [2, 12, 1],
    ]);
  });

  it('never throws on non-string input', () => {
    expect(parseHarm(undefined as unknown as string).song.sections).toEqual([]);
  });
});

// ── fuzz ───────────────────────────────────────────────────────────────────

const FRAGMENTS = [
  'Z',
  'x',
  'C',
  'v',
  'B',
  'n',
  'M',
  ',',
  '_',
  '*',
  '*.5',
  '*2',
  '*1/3',
  '*0',
  '/',
  '-',
  ':',
  ': ',
  'L:',
  'R:',
  'S:',
  'LS:',
  'rs:',
  'LR:',
  'Q:',
  '[',
  ']',
  '[L]',
  '[/L]',
  '[R]',
  '[/R]',
  '[S]',
  '[/S]',
  '[giữ chuột trái]',
  '[thả chuột phải]',
  '[giu scroll]',
  ' ',
  ' ',
  ' ',
  '\t',
  '\n',
  '\n',
  '\r\n',
  '\r',
  '@repeat ',
  '@repeat A',
  '@bpm ',
  '@time ',
  '@scroll ',
  '@title ',
  '@artist ',
  '@',
  '#',
  '# A',
  '# B',
  '//',
  '//!',
  'A',
  'ĐOẠN',
  'lời',
  '😀',
  '\uD800',
  '\u0301',
  '\uFEFF',
  '\u00A0',
  '\u2028',
  '1',
  '0',
  '.',
  '1/0',
  '3/4',
  '-1',
  '+1',
];

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('parseHarm: fuzz', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('never throws, diagnostics are well-formed, and parsed songs round-trip', () => {
    const errSpy = vi.spyOn(console, 'error');
    const rnd = mulberry32(20261013);
    // kiểm bằng code thường trong vòng lặp (nhanh), gom lỗi rồi assert một lần
    const failures: string[] = [];
    const fail = (why: string, text: string): void => {
      if (failures.length < 5) failures.push(`${why}: ${JSON.stringify(text)}`);
    };
    for (let i = 0; i < 3000; i++) {
      const count = 1 + Math.floor(rnd() * 60);
      let text = '';
      for (let k = 0; k < count; k++) {
        text += FRAGMENTS[Math.floor(rnd() * FRAGMENTS.length)] ?? '';
      }
      const lineCount = text.split(/\r\n?|\n/).length;
      let r: ParseResult;
      try {
        r = parseHarm(text);
      } catch (err) {
        fail(`threw ${String(err)}`, text);
        continue;
      }
      if (r.ok !== !r.diagnostics.some((d) => d.severity === 'error')) fail('ok flag', text);
      if (r.lineOrigins.length !== allLines(r).length) fail('lineOrigins length', text);
      let prev: Diagnostic | null = null;
      for (const d of r.diagnostics) {
        const wellFormed =
          Number.isInteger(d.line) &&
          Number.isInteger(d.column) &&
          Number.isInteger(d.length) &&
          d.line >= 1 &&
          d.line <= lineCount &&
          d.column >= 1 &&
          d.length >= 1;
        if (!wellFormed) fail(`bad diagnostic ${JSON.stringify(d)}`, text);
        if (prev && (prev.line > d.line || (prev.line === d.line && prev.column > d.column))) {
          fail('diagnostics not sorted', text);
        }
        prev = d;
      }
      // mọi model parse ra đều serialize + parse lại y hệt (JSON: thứ tự key cố định)
      const out = serializeHarm(r.song);
      const back = parseHarm(out);
      if (JSON.stringify(back.song) !== JSON.stringify(r.song)) fail('round-trip', text);
      if (back.diagnostics.some((d) => d.severity !== 'info')) fail('re-parse diagnostics', text);
      if (serializeHarm(back.song) !== out) fail('not idempotent', text);
    }
    expect(failures).toEqual([]);
    expect(errSpy).not.toHaveBeenCalled();
  }, 60_000);
});

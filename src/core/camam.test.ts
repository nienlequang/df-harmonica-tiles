import { describe, expect, it, vi } from 'vitest';
import type { CamAmConvention, CamAmDiagnostic, CamAmOptions, CamAmResult } from './camam';
import { CAMAM_BASE_MIDI, CAMAM_CONVENTIONS, parseCamAm } from './camam';
import type { MelodyEvent, MelodyLine } from './melody';
import { melodyPitches } from './melody';
import { DEFAULT_TIME_SIG } from './types';

// ── helpers ────────────────────────────────────────────────────────────────

/** Ký tự đặc biệt viết bằng mã để file nguồn không chứa ký tự vô hình. */
const COMBINING_CIRCUMFLEX = String.fromCharCode(0x0302);
const COMBINING_GRAVE = String.fromCharCode(0x0300);
const BOM = String.fromCharCode(0xfeff);
const NBSP = String.fromCharCode(0xa0);

function lines(r: CamAmResult): MelodyLine[] {
  return r.melody.sections.flatMap((s) => s.lines);
}
function events(text: string, convention?: CamAmConvention): MelodyEvent[] {
  return lines(parseCamAm(text, { convention })).flatMap((l) => l.events);
}
function midis(text: string, convention?: CamAmConvention): (number | null)[] {
  return events(text, convention).map((e) => e.midi);
}
function beats(text: string, convention?: CamAmConvention): number[] {
  return events(text, convention).map((e) => e.beats);
}
function diags(text: string, opts?: CamAmOptions): CamAmDiagnostic[] {
  return parseCamAm(text, opts).diagnostics;
}
function diag(
  line: number,
  column: number,
  length: number,
  code: CamAmDiagnostic['code'],
  token: string,
): CamAmDiagnostic {
  return { line, column, length, code, token };
}
/** midi của âm (semitone so với Đô) ở quãng q. */
function m(semitone: number, q = 1): number {
  return CAMAM_BASE_MIDI + 12 * (q - 1) + semitone;
}
const DO = 0;
const RE = 2;
const MI = 4;
const FA = 5;
const SOL = 7;
const LA = 9;
const SI = 11;

// ── âm và biến thể ─────────────────────────────────────────────────────────

describe('parseCamAm — syllables', () => {
  it('maps every syllable and alias to quãng 1 when lowercase', () => {
    expect(midis('do re mi fa sol la si')).toEqual([60, 62, 64, 65, 67, 69, 71]);
    expect(midis('đô đồ rê pha son ti')).toEqual([m(DO), m(DO), m(RE), m(FA), m(SOL), m(SI)]);
    expect(parseCamAm('do re mi fa sol la si').diagnostics).toEqual([]);
  });

  it('maps every syllable and alias to quãng 2 when uppercase', () => {
    expect(midis('Do Re Mi Fa Sol La Si')).toEqual([72, 74, 76, 77, 79, 81, 83]);
    expect(midis('Đô Đồ Rê Pha Son Ti')).toEqual([
      m(DO, 2),
      m(DO, 2),
      m(RE, 2),
      m(FA, 2),
      m(SOL, 2),
      m(SI, 2),
    ]);
  });

  it('matches case-insensitively; the first letter decides the octave', () => {
    expect(midis('DO RE MI FA SOL LA SI PHA SON TI ĐÔ')).toEqual([
      72, 74, 76, 77, 79, 81, 83, 77, 79, 83, 72,
    ]);
    expect(midis('dO rE sOL pHA')).toEqual([60, 62, 67, 65]);
  });

  it('tolerates any diacritics, precomposed or combining', () => {
    expect(midis('rế mí fà sòl lá sí đố Đố')).toEqual([62, 64, 65, 67, 69, 71, 60, 72]);
    // r + e + U+0302 (Rê viết kiểu tổ hợp), d + o + U+0302 + U+0300 (đồ không gạch)
    const re = `re${COMBINING_CIRCUMFLEX}`;
    const doo = `do${COMBINING_CIRCUMFLEX}${COMBINING_GRAVE}`;
    expect(midis(`${re} ${doo}`)).toEqual([62, 60]);
    // Ð (U+00D0, eth hoa) trông như Đ
    expect(midis(`${String.fromCharCode(0xd0)}o`)).toEqual([72]);
  });

  it('rejects things that are not syllables', () => {
    expect(midis('so ra me fi xi do')).toEqual([60]);
    expect(diags('so ra me fi xi do').map((d) => d.token)).toEqual(['so', 'ra', 'me', 'fi', 'xi']);
    expect(diags('so').every((d) => d.code === 'unknown-token')).toBe(true);
  });
});

// ── dấu hóa ────────────────────────────────────────────────────────────────

describe('parseCamAm — accidentals', () => {
  it('reads #, ♯ as +1 and b, ♭ as −1 right after the syllable', () => {
    expect(midis('Sib sib Mib lab solb Fa# Do# fa♯ si♭ reb sol#')).toEqual([
      m(SI, 2) - 1,
      m(SI) - 1,
      m(MI, 2) - 1,
      m(LA) - 1,
      m(SOL) - 1,
      m(FA, 2) + 1,
      m(DO, 2) + 1,
      m(FA) + 1,
      m(SI) - 1,
      m(RE) - 1,
      m(SOL) + 1,
    ]);
  });

  it('accepts an uppercase B as flat and stacks repeated accidentals', () => {
    expect(midis('SIB MIB do## mibb')).toEqual([m(SI, 2) - 1, m(MI, 2) - 1, 62, 62]);
  });

  it('accepts accidental and octave digit in either order', () => {
    expect(midis('mib3 mi3b Fa#1 fa1#')).toEqual([87, 87, 66, 66]);
  });

  it('rejects notes pushed outside midi 0..127', () => {
    const r = parseCamAm(`si3${'#'.repeat(40)} do${'b'.repeat(70)} do`);
    expect(lines(r).flatMap((l) => l.events.map((e) => e.midi))).toEqual([60]);
    expect(r.diagnostics.map((d) => d.code)).toEqual(['unknown-token', 'unknown-token']);
  });

  it('rejects stray accidentals with no syllable', () => {
    expect(diags('do # b ♭ ♯').map((d) => d.token)).toEqual(['#', 'b', '♭', '♯']);
  });
});

// ── quãng ──────────────────────────────────────────────────────────────────

describe('parseCamAm — octave conventions', () => {
  it("'case' is the default: lowercase = quãng 1, uppercase = quãng 2, digit overrides", () => {
    expect(midis('do Do do1 Do1 do2 do3 Re3 La2 ti3')).toEqual([
      60, 72, 60, 60, 72, 84, 86, 81, 95,
    ]);
    expect(midis('do Do do3', 'case')).toEqual([60, 72, 84]);
  });

  it("'digits' ignores case and defaults to quãng 1", () => {
    expect(midis('do Do DO dO', 'digits')).toEqual([60, 60, 60, 60]);
    expect(midis('Do2 mi3 La Sib Re1 ĐÔ3', 'digits')).toEqual([72, 88, 69, 70, 62, 84]);
    expect(midis('Dola Sibla2', 'digits')).toEqual([60, 69, 70, 81]);
  });

  it('only digits 1..3, at most one per syllable', () => {
    for (const bad of ['do0', 'do4', 'do9', 'do12', 'do3#3', 'Re0']) {
      const r = parseCamAm(bad);
      expect(lines(r), bad).toEqual([]);
      expect(r.diagnostics, bad).toEqual([diag(1, 1, bad.length, 'unknown-token', bad)]);
    }
  });

  it('falls back to case for an unknown convention at runtime', () => {
    const r = parseCamAm('do Do', { convention: 'weird' as unknown as CamAmConvention });
    expect(melodyPitches(r.melody)).toEqual([60, 72]);
  });

  it('exports the conventions for the UI', () => {
    expect(CAMAM_CONVENTIONS).toEqual(['case', 'digits']);
    expect(CAMAM_BASE_MIDI).toBe(60);
  });
});

// ── luyến (token dính) ─────────────────────────────────────────────────────

describe('parseCamAm — glued slurs', () => {
  it('splits glued syllables into one slur with equal beats; case applies per syllable', () => {
    const ev = events('Dola');
    expect(ev.map((e) => e.midi)).toEqual([72, 69]);
    expect(ev.map((e) => e.beats)).toEqual([0.5, 0.5]);
    expect(ev[0]?.slurId).toBeDefined();
    expect(ev[1]?.slurId).toBe(ev[0]?.slurId);
  });

  it('splits greedily, three-letter syllables first', () => {
    expect(midis('solfa')).toEqual([67, 65]);
    expect(midis('domi')).toEqual([60, 64]);
    expect(midis('Sibla')).toEqual([82, 69]);
    expect(midis('phala sonmi Solla')).toEqual([65, 69, 67, 64, 79, 69]);
    expect(midis('Đôla rêmi')).toEqual([72, 69, 62, 64]);
  });

  it('keeps accidentals and digits per syllable inside a slur', () => {
    expect(midis('Do#la')).toEqual([73, 69]);
    expect(midis('do3re')).toEqual([84, 62]);
    expect(midis('dore3')).toEqual([60, 86]);
    expect(midis('sibmib')).toEqual([70, 63]);
  });

  it('accepts hyphen-joined syllables as a slur', () => {
    const ev = events('do-re Do-la3');
    expect(ev.map((e) => e.midi)).toEqual([60, 62, 72, 93]);
    expect(ev[0]?.slurId).toBe(ev[1]?.slurId);
    expect(ev[2]?.slurId).toBe(ev[3]?.slurId);
    expect(ev[0]?.slurId).not.toBe(ev[2]?.slurId);
  });

  it('splits three or more syllables equally', () => {
    const ev = events('dolasi');
    expect(ev.map((e) => e.midi)).toEqual([60, 69, 71]);
    expect(ev.map((e) => e.beats)).toEqual([1 / 3, 1 / 3, 1 / 3]);
    expect(new Set(ev.map((e) => e.slurId)).size).toBe(1);
  });

  it('gives each slur its own id and single notes no slurId', () => {
    const ev = events('dola re remi\nfasol');
    const ids = ev.map((e) => e.slurId);
    expect(ids[0]).toBe(ids[1]);
    expect('slurId' in (ev[2] ?? {})).toBe(false);
    expect(ids[3]).toBe(ids[4]);
    expect(ids[5]).toBe(ids[6]);
    expect(new Set([ids[0], ids[3], ids[5]]).size).toBe(3);
  });

  it('rejects the whole glued token when any part is unknown', () => {
    for (const bad of ['dox', 'sola', 'xdo', 'domix', 'do-', '-do', 'do--re', 'do-#', 'dola.']) {
      const r = parseCamAm(`mi ${bad}`);
      expect(melodyPitches(r.melody), bad).toEqual([64]);
      expect(r.diagnostics, bad).toEqual([diag(1, 4, bad.length, 'unknown-token', bad)]);
    }
  });
});

// ── độ dài, nghỉ, kéo dài ──────────────────────────────────────────────────

describe('parseCamAm — durations', () => {
  it('reads *dur as decimal or a/b, default 1', () => {
    expect(beats('do do*2 re*.5 mi*1/3 fa*1.5 sol*0.25 la*2.')).toEqual([
      1,
      2,
      0.5,
      1 / 3,
      1.5,
      0.25,
      2,
    ]);
  });

  it('applies *dur to the whole slur, split equally', () => {
    expect(beats('Dola*2')).toEqual([1, 1]);
    expect(beats('Dola*1/2')).toEqual([0.25, 0.25]);
    expect(beats('dolasi*3')).toEqual([1, 1, 1]);
  });

  it('reports invalid-duration and keeps the note with 1 beat', () => {
    for (const bad of ['do*0', 'do*abc', 'do*', 'do*-1', 'do*1/0', 'Dola*0']) {
      const r = parseCamAm(bad);
      const ev = lines(r).flatMap((l) => l.events);
      expect(
        ev.reduce((s, e) => s + e.beats, 0),
        bad,
      ).toBe(1);
      expect(r.diagnostics, bad).toEqual([diag(1, 1, bad.length, 'invalid-duration', bad)]);
    }
  });

  it('reports only unknown-token when the base is unknown', () => {
    expect(diags('xyz*2 xyz*0 do**2')).toEqual([
      diag(1, 1, 5, 'unknown-token', 'xyz*2'),
      diag(1, 7, 5, 'unknown-token', 'xyz*0'),
      diag(1, 13, 5, 'unknown-token', 'do**2'),
    ]);
  });
});

describe('parseCamAm — rests', () => {
  it('reads _ as a 1-beat rest and _*dur', () => {
    expect(events('do _ re _*2 _*1/2')).toEqual([
      { midi: 60, beats: 1 },
      { midi: null, beats: 1 },
      { midi: 62, beats: 1 },
      { midi: null, beats: 2 },
      { midi: null, beats: 0.5 },
    ]);
  });

  it('reports a bad rest duration and keeps 1 beat', () => {
    const r = parseCamAm('_*0');
    expect(lines(r)[0]?.events).toEqual([{ midi: null, beats: 1 }]);
    expect(r.diagnostics).toEqual([diag(1, 1, 3, 'invalid-duration', '_*0')]);
  });

  it('rejects other underscore forms', () => {
    expect(diags('__ _x').map((d) => d.token)).toEqual(['__', '_x']);
  });

  it('a line of rests is still a line', () => {
    const r = parseCamAm('_ _');
    expect(lines(r)).toEqual([
      {
        events: [
          { midi: null, beats: 1 },
          { midi: null, beats: 1 },
        ],
      },
    ]);
    expect(r.noteCount).toBe(0);
  });
});

describe('parseCamAm — "-" extension', () => {
  it('extends the previous note by 1 beat per hyphen', () => {
    expect(events('do - re')).toEqual([
      { midi: 60, beats: 2 },
      { midi: 62, beats: 1 },
    ]);
    expect(beats('do - - re')).toEqual([3, 1]);
    expect(beats('do -- re')).toEqual([3, 1]);
    expect(beats('do*2 -')).toEqual([3]);
  });

  it('accepts -*dur on a single hyphen', () => {
    expect(beats('do -*2 re')).toEqual([3, 1]);
    expect(beats('do -*1/2')).toEqual([1.5]);
  });

  it('extends a whole slur, keeping its notes equal', () => {
    const ev = events('Dola -');
    expect(ev.map((e) => e.beats)).toEqual([1, 1]);
    expect(ev[0]?.slurId).toBe(ev[1]?.slurId);
    expect(beats('dolasi - -')).toEqual([1, 1, 1]);
  });

  it('extends a rest', () => {
    expect(events('_ -')).toEqual([{ midi: null, beats: 2 }]);
  });

  it('extends across lines; a line of only "-" adds no line', () => {
    const r = parseCamAm('do re\n- mi\n-\n# B\n- fa');
    expect(r.melody.sections).toEqual([
      {
        name: 'Main',
        lines: [
          {
            events: [
              { midi: 60, beats: 1 },
              { midi: 62, beats: 2 },
            ],
          },
          { events: [{ midi: 64, beats: 3 }] },
        ],
      },
      { name: 'B', lines: [{ events: [{ midi: 65, beats: 1 }] }] },
    ]);
    expect(r.diagnostics).toEqual([]);
  });

  it('reports "-" with nothing before it', () => {
    const r = parseCamAm('// đầu bài\n  - do');
    expect(r.diagnostics).toEqual([diag(2, 3, 1, 'unknown-token', '-')]);
    expect(melodyPitches(r.melody)).toEqual([60]);
    // `-*0` sau do: độ dài sai → vẫn kéo dài 1 beat
    expect(parseCamAm('do -*0').diagnostics).toEqual([diag(1, 4, 3, 'invalid-duration', '-*0')]);
    expect(beats('do -*0')).toEqual([2]);
    // `-*0` mồ côi chỉ báo token lạ
    expect(diags('-*0')).toEqual([diag(1, 1, 3, 'unknown-token', '-*0')]);
  });

  it('rejects ambiguous multi-hyphen with duration', () => {
    expect(diags('do --*2')).toEqual([diag(1, 4, 4, 'unknown-token', '--*2')]);
    expect(beats('do --*2')).toEqual([1]);
  });

  it('an unknown token does not reset the extension target', () => {
    expect(beats('do xx -')).toEqual([2]);
  });
});

// ── cấu trúc dòng ──────────────────────────────────────────────────────────

describe('parseCamAm — sections, directives', () => {
  it('reads directives, sections, comments and note lines (legacy prefixes dropped)', () => {
    const r = parseCamAm(
      [
        '@title Bài thử',
        '@artist Ai đó',
        '@bpm 120',
        '@time 3/4',
        '// comment: do re mi',
        '',
        '# Verse',
        'Lời một: do re mi',
        '   ',
        '## Chorus ',
        'Do Re: Mi',
      ].join('\n'),
    );
    expect(r.melody).toEqual({
      title: 'Bài thử',
      artist: 'Ai đó',
      bpm: 120,
      timeSig: { num: 3, den: 4 },
      sections: [
        {
          name: 'Verse',
          lines: [
            {
              events: [
                { midi: 60, beats: 1 },
                { midi: 62, beats: 1 },
                { midi: 64, beats: 1 },
              ],
            },
          ],
        },
        { name: 'Chorus', lines: [{ events: [{ midi: 76, beats: 1 }] }] },
      ],
    });
    expect(r.diagnostics).toEqual([]);
    expect(r.noteCount).toBe(4);
  });

  it('uses defaults when there are no directives', () => {
    const r = parseCamAm('');
    expect(r.melody).toEqual({ title: '', bpm: 90, timeSig: { num: 4, den: 4 }, sections: [] });
    expect('artist' in r.melody).toBe(false);
    // không dùng chung object mặc định
    expect(r.melody.timeSig).not.toBe(DEFAULT_TIME_SIG);
    expect(r.noteCount).toBe(0);
    expect(r.diagnostics).toEqual([]);
  });

  it('opts.title / opts.bpm are fallbacks; directives in the text win', () => {
    expect(parseCamAm('do', { title: ' Tên ', bpm: 100 }).melody).toMatchObject({
      title: 'Tên',
      bpm: 100,
    });
    expect(
      parseCamAm('@title Từ văn bản\n@bpm 75\ndo', { title: 'Tên', bpm: 100 }).melody,
    ).toMatchObject({ title: 'Từ văn bản', bpm: 75 });
    // @title rỗng → dùng opts
    expect(parseCamAm('@title\ndo', { title: 'Tên' }).melody.title).toBe('Tên');
    for (const bad of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(parseCamAm('do', { bpm: bad }).melody.bpm, String(bad)).toBe(90);
    }
  });

  it('ignores invalid directive values and unknown directives without diagnostics', () => {
    const r = parseCamAm(
      [
        '@bpm abc',
        '@bpm 0',
        '@bpm 1/2',
        '@time 5/3',
        '@time 4',
        '@scroll -1',
        '@repeat Verse',
        '@foo bar',
        '@',
        'do',
      ].join('\n'),
      { bpm: 100 },
    );
    expect(r.melody.bpm).toBe(100);
    expect(r.melody.timeSig).toEqual({ num: 4, den: 4 });
    expect(r.diagnostics).toEqual([]);
    expect(melodyPitches(r.melody)).toEqual([60]);
  });

  it('the last directive wins; names are case-insensitive', () => {
    const r = parseCamAm('@TITLE A\n@title B\n@Bpm 80\n@bpm 96.5\n@time 6/8\n@artist X\ndo');
    expect(r.melody).toMatchObject({
      title: 'B',
      artist: 'X',
      bpm: 96.5,
      timeSig: { num: 6, den: 8 },
    });
  });

  it('creates Main lazily and keeps explicit empty sections', () => {
    expect(parseCamAm('do\n# A\nre').melody.sections.map((s) => s.name)).toEqual(['Main', 'A']);
    expect(parseCamAm('# A\nre').melody.sections.map((s) => s.name)).toEqual(['A']);
    const r = parseCamAm('# A\n// chưa có\n# B\ndo\n#\nre\n### \nmi');
    expect(r.melody.sections.map((s) => [s.name, s.lines.length])).toEqual([
      ['A', 0],
      ['B', 1],
      ['Main', 1],
      ['Main', 1],
    ]);
  });

  it('drops a legacy prefix up to the first ":" followed by whitespace / end of line (no lyric)', () => {
    expect(lines(parseCamAm('Em ơi, anh: la, do'))).toEqual([
      {
        events: [
          { midi: 69, beats: 1 },
          { midi: 60, beats: 1 },
        ],
      },
    ]);
    // chỉ ":" ĐẦU TIÊN tách: phần sau là token (b: lạ)
    expect(diags('a: b: do')).toEqual([diag(1, 4, 2, 'unknown-token', 'b:')]);
    expect(lines(parseCamAm(`Lời:${NBSP}do`))[0]).toEqual({
      events: [{ midi: 60, beats: 1 }],
    });
    expect(lines(parseCamAm('  : do re'))[0]).toEqual({
      events: [
        { midi: 60, beats: 1 },
        { midi: 62, beats: 1 },
      ],
    });
    // ":" dính token không phải tiền tố kiểu cũ
    expect(diags('loi:do')).toEqual([diag(1, 1, 6, 'unknown-token', 'loi:do')]);
  });

  it('a legacy prefix never produces a diagnostic, whatever its length', () => {
    const r = parseCamAm('một hai ba bốn năm: do Dola\nmột: do re mi fa');
    expect(lines(r).map((l) => l.events.length)).toEqual([3, 4]);
    expect(lines(r).every((l) => !('lyric' in l))).toBe(true);
    expect(r.diagnostics).toEqual([]);
  });

  it('drops lines without notes', () => {
    const r = parseCamAm('Lời:\nLời: xx\nLời: do');
    expect(lines(r)).toEqual([{ events: [{ midi: 60, beats: 1 }] }]);
    expect(r.diagnostics).toEqual([diag(2, 6, 2, 'unknown-token', 'xx')]);
  });

  it('separates tokens by whitespace or commas', () => {
    expect(midis('do,re, mi ,fa,,sol\tla')).toEqual([60, 62, 64, 65, 67, 69]);
    expect(midis(`do${NBSP}re`)).toEqual([60, 62]);
  });

  it('accepts CRLF and a leading BOM', () => {
    const r = parseCamAm(`${BOM}do xx\r\n# A\r\nre\r\n`);
    expect(r.melody.sections.map((s) => s.name)).toEqual(['Main', 'A']);
    expect(melodyPitches(r.melody)).toEqual([60, 62]);
    expect(r.diagnostics).toEqual([diag(1, 4, 2, 'unknown-token', 'xx')]);
  });
});

// ── diagnostics ────────────────────────────────────────────────────────────

describe('parseCamAm — diagnostics', () => {
  it('reports 1-based line and UTF-16 column of each bad token, in source order', () => {
    const text = ['// header', '', 'Lời: do  xx re*0', '   ?? Dola*x', '𝄞 yy'].join('\n');
    expect(diags(text)).toEqual([
      diag(3, 10, 2, 'unknown-token', 'xx'),
      diag(3, 13, 4, 'invalid-duration', 're*0'),
      diag(4, 4, 2, 'unknown-token', '??'),
      diag(4, 7, 6, 'invalid-duration', 'Dola*x'),
      diag(5, 1, 2, 'unknown-token', '𝄞'),
      diag(5, 4, 2, 'unknown-token', 'yy'),
    ]);
  });

  it('measures columns in UTF-16 code units, combining marks included', () => {
    const decomposed = `de${COMBINING_CIRCUMFLEX}`;
    expect(diags(`${decomposed} xx`)).toEqual([
      diag(1, 1, 3, 'unknown-token', decomposed),
      diag(1, 5, 2, 'unknown-token', 'xx'),
    ]);
  });

  it('skips unknown tokens and keeps the rest of the line', () => {
    const r = parseCamAm('do (x2) re | mi');
    expect(melodyPitches(r.melody)).toEqual([60, 62, 64]);
    expect(r.diagnostics.map((d) => d.token)).toEqual(['(x2)', '|']);
  });
});

// ── an toàn ────────────────────────────────────────────────────────────────

describe('parseCamAm — never throws', () => {
  it('handles non-string input and null options', () => {
    expect(parseCamAm(undefined as unknown as string).melody.sections).toEqual([]);
    expect(
      parseCamAm(null as unknown as string, null as unknown as CamAmOptions).melody,
    ).toMatchObject({ bpm: 90, title: '' });
    expect(parseCamAm(42 as unknown as string).diagnostics).toEqual([]);
  });

  it('handles very long and odd input', () => {
    const long = 'x'.repeat(100_000);
    expect(diags(long)).toEqual([diag(1, 1, 100_000, 'unknown-token', long)]);
    const many = Array.from({ length: 2000 }, () => 'Dola*1/3 - _ Sib3').join(' ');
    const r = parseCamAm(many);
    expect(r.noteCount).toBe(6000);
    expect(r.diagnostics).toEqual([]);
    expect(() => parseCamAm('\0 \u{10FFFF} \uD800 ♯♭ :: @ # //')).not.toThrow();
  });

  it('does not mutate the options', () => {
    const opts: CamAmOptions = { convention: 'digits', title: 'T', bpm: 70 };
    parseCamAm('@title X\nDo', opts);
    expect(opts).toEqual({ convention: 'digits', title: 'T', bpm: 70 });
  });

  it('logs and reports a line when something unexpected throws', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const orig = String.prototype.normalize;
    // chỉ "ê" làm hỏng → lỗi nội bộ ở đúng dòng 2
    const spy = vi.spyOn(String.prototype, 'normalize').mockImplementation(function (
      this: string,
      form?: string,
    ): string {
      if (String(this) === 'ê') throw new Error('boom');
      return orig.call(this, form);
    });
    try {
      const r = parseCamAm('do\n  rê re  \nmi');
      expect(r.diagnostics).toEqual([diag(2, 1, 9, 'unknown-token', 'rê re')]);
      expect(melodyPitches(r.melody)).toEqual([60, 64]);
      expect(err).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
      err.mockRestore();
    }
  });
});

// ── bài thật ───────────────────────────────────────────────────────────────

describe('parseCamAm — realistic Vietnamese cảm âm', () => {
  it('parses a folk-song sheet with lyrics, slurs, holds and sections', () => {
    const text = [
      '@title Bắc Kim Thang',
      '@artist Dân ca Nam Bộ',
      '@bpm 110',
      '// cảm âm sưu tầm — chữ thường quãng 1, chữ hoa quãng 2',
      '',
      '# Đoạn 1',
      'Bắc kim thang cà lang bí rợ: mi sol la la, sol mi re',
      'Cột qua kèo là kèo qua cột: re mi sol sol la Do la*2',
      '',
      '# Đoạn 2',
      'Chú bán dầu qua cầu mà té: sol la Dola sol mi re -',
      '_ _',
    ].join('\n');
    const r = parseCamAm(text);
    expect(r.diagnostics).toEqual([]);
    expect(r.melody.title).toBe('Bắc Kim Thang');
    expect(r.melody.artist).toBe('Dân ca Nam Bộ');
    expect(r.melody.bpm).toBe(110);
    expect(r.melody.sections.map((s) => s.name)).toEqual(['Đoạn 1', 'Đoạn 2']);
    expect(melodyPitches(r.melody)).toEqual([
      64,
      67,
      69,
      69,
      67,
      64,
      62,
      62,
      64,
      67,
      67,
      69,
      72,
      69,
      67,
      69,
      72,
      69,
      67,
      64,
      62,
      null,
      null,
    ]);
    const [l1, l2, l3, l4] = lines(r);
    expect(l1).not.toHaveProperty('lyric');
    expect(l2?.events.at(-1)).toEqual({ midi: 69, beats: 2 });
    // Dola là luyến, re kéo dài bởi "-"
    expect(l3?.events.slice(2, 4).map((e) => e.beats)).toEqual([0.5, 0.5]);
    expect(l3?.events[2]?.slurId).toBe(l3?.events[3]?.slurId);
    expect(l3?.events.at(-1)).toEqual({ midi: 62, beats: 2 });
    expect(l4).toEqual({
      events: [
        { midi: null, beats: 1 },
        { midi: null, beats: 1 },
      ],
    });
    expect(r.noteCount).toBe(21);
  });

  it('parses a verse line with a comma, a held note ("-") and high notes', () => {
    const r = parseCamAm(
      '@title Bài thử cảm âm\n@bpm 104\nmi sol la la, la sol mi re do\nmi sol la la la - Mi Re Do la*2',
    );
    expect(r.diagnostics).toEqual([]);
    const [a, b] = lines(r);
    expect(a?.events.map((e) => e.midi)).toEqual([64, 67, 69, 69, 69, 67, 64, 62, 60]);
    expect(b?.events.map((e) => [e.midi, e.beats])).toEqual([
      [64, 1],
      [67, 1],
      [69, 1],
      [69, 1],
      [69, 2],
      [76, 1],
      [74, 1],
      [72, 1],
      [69, 2],
    ]);
    // cùng đoạn ở convention 'digits'
    const d = parseCamAm('mi sol la la la - mi2 re2 do2 la*2', { convention: 'digits' });
    expect(melodyPitches(d.melody)).toEqual(b?.events.map((e) => e.midi));
  });
});

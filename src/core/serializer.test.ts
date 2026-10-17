import { describe, expect, it } from 'vitest';
import { parseHarm } from './parser';
import { canonicalSong, serializeHarm } from './serializer';
import type { Line, Note, NoteKey, Octave, Rest, Section, Slur, Song, Unit } from './types';
import seed1 from '../test/fixtures/bai-thu-nhip-dieu.harm?raw';
import seed2 from '../test/fixtures/bai-thu-lap-doan.harm?raw';

// ── helpers ────────────────────────────────────────────────────────────────

function n(key: NoteKey, octave: Octave = 0, sharp = false, beats = 1): Note {
  return { kind: 'note', key, octave, sharp, beats };
}
function rest(beats = 1): Rest {
  return { kind: 'rest', beats };
}
function slur(...notes: Note[]): Slur {
  return { kind: 'slur', notes };
}
function line(units: Unit[]): Line {
  return { units };
}
/** Dòng của model ngoài kiểu cũ (vd. JSON nhập trước khi bỏ tính năng lời) còn key `lyric`. */
function legacyLine(units: Unit[], lyric: string): Line {
  return { lyric, units } as Line;
}
function sec(name: string, ...lines: Line[]): Section {
  return { name, lines };
}
function song(sections: Section[], extra: Partial<Song> = {}): Song {
  return {
    id: '',
    title: '',
    bpm: 90,
    timeSig: { num: 4, den: 4 },
    scrollDir: 1,
    sections,
    ...extra,
  };
}
/** Chỉ phần dòng nốt (không directive, không header). */
function body(...lines: Line[]): string {
  return serializeHarm(song([sec('Main', ...lines)]), { directives: false, sectionHeaders: false });
}
function units(...u: Unit[]): string {
  return body(line(u)).trimEnd();
}
function expectRoundTrip(s: Song): void {
  const text = serializeHarm(s);
  const r = parseHarm(text, { id: s.id });
  expect(r.diagnostics.filter((d) => d.severity !== 'info')).toEqual([]);
  expect(r.song).toStrictEqual(s);
}

const HL = '[giữ chuột trái]';
const RL = '[thả chuột trái]';
const HR = '[giữ chuột phải]';
const RR = '[thả chuột phải]';
const HS = '[giữ scroll]';
const RS = '[thả scroll]';

// ── format ─────────────────────────────────────────────────────────────────

describe('serializeHarm: layout', () => {
  it('writes directives, a blank line, headers separated by blank lines, trailing newline', () => {
    const s = song(
      [sec('ĐOẠN 1', line([n('Z'), n('X', 0, false, 0.5)]), line([n('C')])), sec('RAP')],
      { title: 'Tên bài', artist: 'Ca sĩ', bpm: 120, timeSig: { num: 3, den: 4 }, scrollDir: -1 },
    );
    expect(serializeHarm(s)).toBe(
      [
        '@title Tên bài',
        '@artist Ca sĩ',
        '@bpm 120',
        '@time 3/4',
        '@scroll -1',
        '',
        '# ĐOẠN 1',
        'Z X*0.5',
        'C',
        '',
        '# RAP',
        '',
      ].join('\n'),
    );
    expectRoundTrip(s);
  });

  it('omits @title when empty and @artist when absent; writes decimal bpm', () => {
    expect(serializeHarm(song([], { bpm: 76.5 }))).toBe('@bpm 76.5\n@time 4/4\n@scroll +1\n');
    expect(serializeHarm(song([], { artist: '' }))).not.toContain('@artist');
  });

  it('writes "# Main" for the lazy default section', () => {
    const s = parseHarm('Z\n# A\nX').song;
    expect(serializeHarm(s, { directives: false })).toBe('# Main\nZ\n\n# A\nX\n');
    expectRoundTrip(s);
  });

  it('never emits "*1" and writes other durations compactly', () => {
    expect(
      units(
        n('Z'),
        n('X', 0, false, 0.5),
        n('C', 0, false, 0.25),
        n('V', 0, false, 1.5),
        n('B', 0, false, 4),
        n('N', 0, false, 1 / 3),
        n('M', 0, false, 2 / 3),
        n(',', 0, false, 0.125),
      ),
    ).toBe('Z X*0.5 C*0.25 V*1.5 B*4 N*1/3 M*2/3 ,*0.125');
    expect(units(rest(), rest(2), rest(0.5))).toBe('_ _*2 _*0.5');
  });

  it('writes the slur total once after the slur', () => {
    expect(units(slur(n('X', 0, false, 0.5), n('C', 0, false, 0.5)))).toBe('X-C');
    expect(units(slur(n('X'), n('C')))).toBe('X-C*2');
    expect(
      units(slur(n('Z', 0, false, 1 / 3), n('X', 0, false, 1 / 3), n('C', 0, false, 1 / 3))),
    ).toBe('Z-X-C');
    expect(
      units(slur(n('Z', 0, false, 2 / 3), n('X', 0, false, 2 / 3), n('C', 0, false, 2 / 3))),
    ).toBe('Z-X-C*2');
    expect(units(slur(n('Z', 0, false, 0.25), n(',', 0, false, 0.25)))).toBe('Z-,*0.5');
  });

  it('keeps slur beats bit-exact for any parsed total and slur size', () => {
    const keys: NoteKey[] = ['Z', 'X', 'C', 'V', 'B', 'N', 'M', ','];
    for (let i = 1; i <= 400; i++) {
      for (let count = 2; count <= 8; count++) {
        const total = i / 977;
        const text = `${keys.slice(0, count).join('-')}*${String(total)}`;
        const parsed = parseHarm(text).song;
        const s = parsed.sections[0]?.lines[0]?.units[0] as Slur;
        expect(s.notes[0]?.beats).toBe(total / count);
        const back = parseHarm(serializeHarm(parsed)).song;
        expect(back).toStrictEqual(parsed);
      }
    }
  }, 60_000); // 2 800 round-trip (~2.5 s khi chạy riêng): ngân sách riêng để không flaky khi CPU bị tranh
});

// ── modifiers ──────────────────────────────────────────────────────────────

describe('serializeHarm: hold grouping', () => {
  it('wraps a single held note in a full-label pair', () => {
    expect(units(n('N', -1))).toBe(`${HL} N ${RL}`);
    expect(units(n('N', 1))).toBe(`${HR} N ${RR}`);
    expect(units(n('N', 0, true))).toBe(`${HS} N ${RS}`);
  });

  it('groups consecutive notes with the same modifier into one pair', () => {
    expect(units(n('N', -1), n('N', -1, false, 2), n('Z'))).toBe(`${HL} N N*2 ${RL} Z`);
    expect(units(n('Z'), n('N', 0, true), n('N', 0, true), n('X'))).toBe(`Z ${HS} N N ${RS} X`);
  });

  it('keeps a group open across a line break (hold on the first line, release on the last)', () => {
    expect(body(line([n('Z'), n('N', 1)]), line([n('N', 1), n('X')]))).toBe(
      `Z ${HR} N\nN ${RR} X\n`,
    );
  });

  it('keeps a group open across sections', () => {
    const s = song([sec('A', line([n('N', -1)])), sec('B'), sec('C', line([n('M', -1), n('Z')]))]);
    expect(serializeHarm(s, { directives: false })).toBe(`# A\n${HL} N\n\n# B\n\n# C\nM ${RL} Z\n`);
    expectRoundTrip(s);
  });

  it('breaks groups at rests (rests never sit inside a hold)', () => {
    expect(units(n('N', 1), rest(), n('N', 1))).toBe(`${HR} N ${RR} _ ${HR} N ${RR}`);
    expect(units(n('N', 0, true), rest(0.5), n('N', 0, true))).toBe(
      `${HS} N ${RS} _*0.5 ${HS} N ${RS}`,
    );
  });

  it('nests scroll inside a right/left hold', () => {
    expect(units(n('N', 1), n('N', 1, true), n('N', 1))).toBe(`${HR} N ${HS} N ${RS} N ${RR}`);
    expect(units(n('N', 1, true))).toBe(`${HR} ${HS} N ${RS} ${RR}`);
    expect(units(n('Z', -1, true), n('X', -1, true), n('C', -1))).toBe(
      `${HL} ${HS} Z X ${RS} C ${RL}`,
    );
  });

  it('tracks octave and scroll separately (scroll survives an octave change)', () => {
    expect(units(n('Z', 1, true), n('Z', -1, true), n('X'))).toBe(
      `${HR} ${HS} Z ${RR} ${HL} Z ${RS} ${RL} X`,
    );
    expect(units(n('Z', 0, true), n('X', 1, true), n('C', 1))).toBe(
      `${HS} Z ${HR} X ${RS} C ${RR}`,
    );
  });

  it('switches directly between left and right', () => {
    expect(units(n('Z', -1), n('Z', 1))).toBe(`${HL} Z ${RL} ${HR} Z ${RR}`);
  });
});

describe('serializeHarm: slurs with mixed modifiers', () => {
  it('uses prefixes for notes that deviate from the slur state', () => {
    expect(units(slur(n('Z', 0, false, 0.5), n('N', -1, false, 0.5)))).toBe('Z-L:N');
    expect(units(slur(n('X', 0, false, 0.5), n('C', 0, true, 0.5)))).toBe('X-S:C');
    expect(units(slur(n('Z', -1, true, 0.5), n('N', 0, false, 0.5)))).toBe('LS:Z-N');
    expect(units(slur(n('Z', 1, true, 0.5), n('N', 0, false, 0.5)))).toBe('RS:Z-N');
    expect(units(slur(n('Z', -1, false, 0.5), n('N', 1, false, 0.5)))).toBe('L:Z-R:N');
  });

  it('holds the common state of the slur', () => {
    expect(units(slur(n('X', 1, false, 0.5), n('C', 1, false, 0.5)))).toBe(`${HR} X-C ${RR}`);
    expect(units(slur(n('X', 1, true, 0.5), n('C', 1, true, 0.5)))).toBe(
      `${HR} ${HS} X-C ${RS} ${RR}`,
    );
    expect(units(slur(n('X', 1, true, 0.5), n('C', 1, false, 0.5)))).toBe(`${HR} S:X-C ${RR}`);
    expect(units(slur(n('X', -1, true), n('C', 0, true)))).toBe(`${HS} L:X-C*2 ${RS}`);
  });

  it('joins a slur into a surrounding group when its state matches', () => {
    expect(units(n('N', 1), slur(n('X', 1, false, 0.5), n('C', 1, false, 0.5)), n('N', 1))).toBe(
      `${HR} N X-C N ${RR}`,
    );
    expect(units(n('N', 1), slur(n('X', 1, false, 0.5), n('C', 0, false, 0.5)), n('N', 1))).toBe(
      `${HR} N ${RR} R:X-C ${HR} N ${RR}`,
    );
  });

  it('round-trips every mixed slur', () => {
    const notes = [
      n('Z', -1),
      n('X', 0),
      n('C', 1),
      n('V', -1, true),
      n('B', 0, true),
      n('N', 1, true),
    ];
    const lines: Line[] = [];
    for (const a of notes) {
      for (const b of notes) {
        lines.push(
          line([n('M', a.octave, a.sharp), slur({ ...a, beats: 0.5 }, { ...b, beats: 0.5 })]),
        );
      }
    }
    expectRoundTrip(song([sec('A', ...lines)]));
  });
});

// ── options ────────────────────────────────────────────────────────────────

describe('serializeHarm: options', () => {
  const s = song(
    [
      sec('A', line([n('Z', -1, false, 0.5), n('X', 0, false, 2)])),
      sec('B', line([rest(0.5), n('C')])),
    ],
    { title: 'T' },
  );

  it('defaults: directives, headers, durations — never a lyric', () => {
    expect(serializeHarm(s)).toBe(
      `@title T\n@bpm 90\n@time 4/4\n@scroll +1\n\n# A\n${HL} Z*0.5 ${RL} X*2\n\n# B\n_*0.5 C\n`,
    );
  });

  it('durations: false drops every *dur', () => {
    expect(serializeHarm(s, { durations: false, directives: false })).toBe(
      `# A\n${HL} Z ${RL} X\n\n# B\n_ C\n`,
    );
    expect(
      serializeHarm(song([sec('A', line([slur(n('X'), n('C'))]))]), {
        durations: false,
        directives: false,
      }),
    ).toBe('# A\nX-C\n');
  });

  it('sectionHeaders: false drops headers (one blank line after directives)', () => {
    expect(serializeHarm(s, { sectionHeaders: false })).toBe(
      `@title T\n@bpm 90\n@time 4/4\n@scroll +1\n\n${HL} Z*0.5 ${RL} X*2\n_*0.5 C\n`,
    );
  });

  it('directives: false drops directives', () => {
    expect(serializeHarm(s, { directives: false })).toBe(
      `# A\n${HL} Z*0.5 ${RL} X*2\n\n# B\n_*0.5 C\n`,
    );
  });

  it('all off → bare note lines', () => {
    expect(
      serializeHarm(s, {
        directives: false,
        sectionHeaders: false,
        durations: false,
      }),
    ).toBe(`${HL} Z ${RL} X\n_ C\n`);
  });

  it('keeps single-line text safe (newlines in title / section name become spaces)', () => {
    const t = serializeHarm(song([sec('A\nB', line([n('Z')]))], { title: 'x\r\ny' }));
    expect(t).toBe('@title x y\n@bpm 90\n@time 4/4\n@scroll +1\n\n# A B\nZ\n');
  });

  it('a lone CR is a line break too: the Editor EOL normalization cannot re-split a line', () => {
    // trước đây CR lẻ còn nguyên; Editor đổi nó thành xuống dòng → title 'A', thêm nốt B
    const s = song([sec('S\rT', line([n('Z'), n('X')]))], {
      title: 'A\rB',
      artist: 'P\rQ',
    });
    const text = serializeHarm(s);
    expect(text).not.toContain('\r');
    expect(text).toBe('@title A B\n@artist P Q\n@bpm 90\n@time 4/4\n@scroll +1\n\n# S T\nZ X\n');
    const c = canonicalSong(s);
    expect(c.title).toBe('A B');
    expect(c.artist).toBe('P Q');
    expect(c.sections[0]?.name).toBe('S T');
    // như editorText.normalizeEol (D-100): CRLF / CR → LF — không đổi gì vì không có CR
    for (const t of [text, text.replace(/\r\n?/g, '\n')]) {
      const r = parseHarm(t);
      expect(r.diagnostics).toEqual([]);
      expect(r.song).toStrictEqual(c);
    }
    // model parser đọc ra (kể cả từ nguồn có CR lẻ, tiền tố lời kiểu cũ) là điểm bất động
    const parsed = parseHarm('@title A\rB\r# S\rx y: Z X').song;
    expect(canonicalSong(parsed)).toStrictEqual(parsed);
  });
});

// ── canonical form (model ngoài, vd. JSON nhập) ────────────────────────────

describe('serializeHarm: models the text format cannot hold verbatim', () => {
  const ZZZ = [n('Z'), n('Z'), n('Z')];
  it.each(['Anh nói: em ơi', '#1 fan cứng', '// chú thích', '@em ơi', '2/9 năm ấy', '  x:\ty  '])(
    'drops a legacy lyric key %j: notes kept, nothing but tokens written',
    (lyric) => {
      const s = song([sec('A', legacyLine(ZZZ, lyric), line([n('X')]))]);
      const text = serializeHarm(s);
      expect(text).toBe('@bpm 90\n@time 4/4\n@scroll +1\n\n# A\nZ Z Z\nX\n');
      const r = parseHarm(text);
      expect(r.diagnostics).toEqual([]);
      expect(r.song.sections[0]?.lines).toStrictEqual([line(ZZZ), line([n('X')])]);
      expect(r.song).toStrictEqual(canonicalSong(s));
      expect(canonicalSong(s).sections[0]?.lines[0]).not.toHaveProperty('lyric');
    },
  );

  it('writes a single-note slur as that note and drops empty slurs', () => {
    const s = song([sec('A', line([slur(n('X', 1, true, 2)), slur(), n('C')]))]);
    expect(serializeHarm(s, { directives: false })).toBe(`# A\n${HR} ${HS} X*2 ${RS} ${RR} C\n`);
    expect(parseHarm(serializeHarm(s)).song.sections[0]?.lines).toStrictEqual([
      line([n('X', 1, true, 2), n('C')]),
    ]);
  });

  it('drops lines without units, like the parser (D-013)', () => {
    const s = song([sec('A', line([]), line([n('Z')]), line([slur()]))]);
    expect(serializeHarm(s, { directives: false })).toBe('# A\nZ\n');
    expect(canonicalSong(s).sections[0]?.lines).toStrictEqual([line([n('Z')])]);
  });

  it('keeps the total of a slur with unequal notes and divides it evenly', () => {
    const s = song([sec('A', line([slur(n('X', 0, false, 0.5), n('C', 0, false, 1.5))]))]);
    expect(units(slur(n('X', 0, false, 0.5), n('C', 0, false, 1.5)))).toBe('X-C*2');
    expect(parseHarm(serializeHarm(s)).song).toStrictEqual(canonicalSong(s));
    expect(canonicalSong(s).sections[0]?.lines[0]?.units).toStrictEqual([slur(n('X'), n('C'))]);
  });

  it('normalizes text fields, an out-of-range @time and a bad bpm', () => {
    const s = song([sec('  ', line([n('Z')])), sec(' Điệp\nkhúc ')], {
      title: '  Tên\r\nbài ',
      artist: ' \n ',
      timeSig: { num: 5, den: 3 },
      bpm: 0,
    });
    const c = canonicalSong(s);
    expect(c).toStrictEqual(
      song([sec('Main', line([n('Z')])), sec('Điệp khúc')], {
        title: 'Tên bài',
        timeSig: { num: 4, den: 4 },
        bpm: 90,
      }),
    );
    expect('artist' in c).toBe(false);
    const r = parseHarm(serializeHarm(s));
    expect(r.diagnostics).toEqual([]);
    expect(r.song).toStrictEqual(c);
  });

  it('does not touch its input and is idempotent', () => {
    const s = song([sec('A', legacyLine([slur(n('Z'))], '#x: y'), line([]))], { title: ' t ' });
    const before = JSON.stringify(s);
    const c = canonicalSong(s);
    expect(JSON.stringify(s)).toBe(before);
    expect(canonicalSong(c)).toStrictEqual(c);
    expect(serializeHarm(c)).toBe(serializeHarm(s));
  });

  it('is the identity on parsed songs (seeds)', () => {
    for (const src of [seed1, seed2]) {
      const parsed = parseHarm(src).song;
      expect(canonicalSong(parsed)).toStrictEqual(parsed);
    }
  });
});

// ── seeds ──────────────────────────────────────────────────────────────────

describe('serializeHarm: seeds', () => {
  it('Seed 1: chorus is one long right-hold, released before the final rest', () => {
    const text = serializeHarm(parseHarm(seed1).song);
    const lines = text.split('\n');
    const start = lines.indexOf('# ĐIỆP KHÚC');
    expect(lines[start + 1]).toBe(`${HR} C*2 B N M*2 N B`);
    expect(lines[start + 8]).toBe(`X*0.5 C*0.5 B*0.5 N*0.5 C*2 N*3.5 ${RR} _*0.5`);
    expect(text.split(HR)).toHaveLength(1 + 4 + 1);
  });

  it('Seed 2 export (donate text DoD) matches the snapshot', () => {
    const r = parseHarm(seed2, { id: 'fixture-bai-thu-lap-doan' });
    const text = serializeHarm(r.song);
    expect(text).toMatchSnapshot();
    expect(parseHarm(text, { id: r.song.id }).song).toStrictEqual(r.song);
  });
});

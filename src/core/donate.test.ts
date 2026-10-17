import { describe, expect, it } from 'vitest';
import { DEFAULT_DONATE_LIMIT, MIN_DONATE_LIMIT, buildDonateText, chunkDonateText } from './donate';
import { parseHarm } from './parser';
import { serializeHarm } from './serializer';
import type { ParseResult, Song } from './types';
import seed1 from '../test/fixtures/bai-thu-nhip-dieu.harm?raw';
import seed2 from '../test/fixtures/bai-thu-lap-doan.harm?raw';

const song1 = parseHarm(seed1).song;
const song2 = parseHarm(seed2).song;

const ALL = { durations: true, sectionHeaders: true };
const OPTION_SETS = [
  ALL,
  { durations: false, sectionHeaders: true },
  { durations: true, sectionHeaders: false },
  { durations: false, sectionHeaders: false },
];

/** Cả 4 tổ hợp option. */
const ALL_COMBOS = [0, 1, 2, 3].map((o) => ({
  durations: (o & 1) !== 0,
  sectionHeaders: (o & 2) !== 0,
}));

const PREFIX_RE = /^(\d+)\/(\d+) /;

/** Dán lại: mỗi phần một dòng mới. */
function join(chunks: string[]): string {
  return chunks.join('\n');
}

/** Mọi phần ≤ limit, đánh số đúng `k/n ` (k = 1..n), không có surrogate lẻ. */
function checkChunks(chunks: string[], limit: number): string[] {
  const problems: string[] = [];
  const n = chunks.length;
  chunks.forEach((c, i) => {
    if (c.length > limit) problems.push(`chunk ${i + 1} has ${c.length} > ${limit}`);
    if (n > 1) {
      const m = PREFIX_RE.exec(c);
      if (!m || Number(m[1]) !== i + 1 || Number(m[2]) !== n) problems.push(`prefix ${i + 1}`);
    }
    if (/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(c)) {
      problems.push(`lone surrogate in chunk ${i + 1}`);
    }
  });
  return problems;
}

/** Dãy âm phát ra (phím, quãng, scroll, độ dài) — không phụ thuộc cách chia dòng. */
function sounds(r: ParseResult): string {
  return r.song.sections
    .flatMap((s) => s.lines)
    .flatMap((l) => l.units)
    .flatMap((u) =>
      u.kind === 'rest'
        ? [`_${u.beats}`]
        : u.kind === 'note'
          ? [`${u.key}${u.octave}${u.sharp ? '#' : ''}${u.beats}`]
          : u.notes.map((n) => `${n.key}${n.octave}${n.sharp ? '#' : ''}${n.beats}~`),
    )
    .join(' ');
}

function errors(r: ParseResult): unknown[] {
  return r.diagnostics.filter((d) => d.severity === 'error');
}

/** Lỗi + cảnh báo (bỏ info). */
function problems(r: ParseResult): string[] {
  return r.diagnostics.filter((d) => d.severity !== 'info').map((d) => `${d.code}@${d.line}`);
}

/** `got` = `want`, hoặc `want` rút gọn bằng `…`. */
function sameOrShortened(got: string, want: string): boolean {
  return got === want || (got.endsWith('…') && want.startsWith(got.slice(0, -1).trimEnd()));
}

/** Các dòng (bỏ tiền tố `k/n `) của các phần. */
function bodyLines(chunks: string[]): string[] {
  return join(chunks.map((c) => c.replace(PREFIX_RE, ''))).split('\n');
}

// ── buildDonateText ────────────────────────────────────────────────────────

describe('buildDonateText', () => {
  it('is serializeHarm with directives and without blank lines / trailing newline', () => {
    const text = buildDonateText(song2, ALL);
    expect(text).toBe(
      serializeHarm(song2)
        .split('\n')
        .filter((l) => l !== '')
        .join('\n'),
    );
    expect(
      text.startsWith('@title Bài thử lặp đoạn và giữ chuột\n@artist Tác giả thử\n@bpm 160'),
    ).toBe(true);
    expect(text).not.toMatch(/\n\s*\n/);
    expect(text.endsWith('\n')).toBe(false);
    expect(parseHarm(text).song).toStrictEqual(song2);
  });

  it('honours the duration / section header options (directives always kept, never a lyric)', () => {
    const text = buildDonateText(song1, { durations: false, sectionHeaders: false });
    const r = parseHarm(text);
    expect(errors(r)).toEqual([]);
    expect(text).toContain('@title Bài thử nhịp điệu');
    expect(text).toContain('@bpm 76');
    expect(text).not.toMatch(/^#/m);
    expect(text).not.toContain('*');
    // dòng nốt chỉ có token (không có tiền tố `lời: `)
    for (const l of text.split('\n').filter((x) => !x.startsWith('@'))) {
      expect(l).not.toMatch(/:(?=\s|$)/);
    }
  });
});

// ── chunkDonateText ────────────────────────────────────────────────────────

describe('chunkDonateText', () => {
  it('returns the text unchanged (no prefix) when it fits in one chunk', () => {
    expect(chunkDonateText('@title A\nZ X C')).toEqual(['@title A\nZ X C']);
    // dòng trống / khoảng trắng hai đầu / CRLF được dọn
    expect(chunkDonateText('  @title A \r\n\r\n Z X C\r\n')).toEqual(['@title A\nZ X C']);
    const exact = `${'Z '.repeat(99)}X,`;
    expect(exact).toHaveLength(DEFAULT_DONATE_LIMIT);
    expect(chunkDonateText(exact)).toEqual([exact]);
  });

  it('empty or blank text → no chunks', () => {
    expect(chunkDonateText('')).toEqual([]);
    expect(chunkDonateText(' \n\r\n\t')).toEqual([]);
    expect(chunkDonateText('﻿')).toEqual([]);
  });

  it('seed 2 (default 200): numbered chunks; pasting them back gives the seed-2 model', () => {
    const chunks = chunkDonateText(serializeHarm(song2));
    expect(chunks.length).toBeGreaterThan(9);
    expect(checkChunks(chunks, 200)).toEqual([]);
    expect(chunks[0]?.startsWith(`1/${chunks.length} @title Bài thử lặp đoạn và giữ chuột\n`)).toBe(
      true,
    );
    const back = parseHarm(join(chunks));
    expect(back.diagnostics.map((d) => d.code)).toEqual(
      parseHarm(seed2).diagnostics.map((d) => d.code),
    );
    expect(back.song).toStrictEqual(song2);
    // không dòng nào bị chia: bỏ tiền tố là ra đúng các dòng của văn bản donate
    expect(join(chunks.map((c) => c.replace(PREFIX_RE, '')))).toBe(buildDonateText(song2, ALL));
  });

  it('pasted chunks parse back to the same model for every option set (limit 200 / 1000)', () => {
    for (const song of [song1, song2]) {
      for (const opts of OPTION_SETS) {
        const text = buildDonateText(song, opts);
        const want = parseHarm(text).song;
        for (const limit of [200, 1000]) {
          const chunks = chunkDonateText(text, limit);
          expect(checkChunks(chunks, limit)).toEqual([]);
          expect(parseHarm(join(chunks)).song).toStrictEqual(want);
        }
      }
    }
  });

  it.each([30, 50, 64, 80, 120, 199, 1000])(
    'limit %i: every chunk fits, numbering is right, notes survive',
    (limit) => {
      for (const song of [song1, song2]) {
        for (const opts of OPTION_SETS) {
          const text = buildDonateText(song, opts);
          const chunks = chunkDonateText(text, limit);
          expect(checkChunks(chunks, limit), JSON.stringify(opts)).toEqual([]);
          // không bao giờ cắt trong token [...]: mỗi dòng có ngoặc cân bằng
          for (const c of chunks) {
            for (const line of c.split('\n')) {
              expect(line.split('[').length, line).toBe(line.split(']').length);
            }
          }
          // dòng dài chỉ bị tách giữa các token → cùng dãy nốt, không lỗi
          const back = parseHarm(join(chunks));
          expect(problems(back), `${limit} ${JSON.stringify(opts)}`).toEqual([]);
          expect(sounds(back)).toBe(sounds(parseHarm(text)));
        }
      }
    },
  );

  it('property: every limit ≥ MIN and every option combo pastes back without errors (seeds)', () => {
    // mọi limit 30..80 (vùng chia dày nhất), rồi thưa dần tới 420 (sweep đầy đủ 30..420 đã chạy tay)
    const limits: number[] = [];
    for (let l = MIN_DONATE_LIMIT; l <= 420; l += l < 80 ? 1 : 13) limits.push(l);
    for (const song of [song1, song2]) {
      for (const opts of ALL_COMBOS) {
        const text = buildDonateText(song, opts);
        const want = parseHarm(text);
        const wantSounds = sounds(want);
        const wantSections = want.song.sections.map((s) => s.name).join('|');
        for (const limit of limits) {
          const chunks = chunkDonateText(text, limit);
          const back = parseHarm(join(chunks));
          const bad = [
            ...checkChunks(chunks, limit),
            ...problems(back),
            sounds(back) === wantSounds ? '' : 'sounds',
            sameOrShortened(back.song.title, want.song.title) ? '' : 'title',
            back.song.sections.map((s) => s.name).join('|') === wantSections ? '' : 'sections',
          ].filter(Boolean);
          if (bad.length > 0)
            expect(bad, `${song.title} ${limit} ${JSON.stringify(opts)}`).toEqual([]);
        }
      }
    }
  });

  it('a legacy "lời: " prefix on a long pasted line is dropped; notes split between tokens', () => {
    const src = '@title A\nMột hai ba bốn năm sáu bảy tám chín mười: Z X C V B N M , Z X';
    const chunks = chunkDonateText(src, 40);
    expect(checkChunks(chunks, 40)).toEqual([]);
    expect(bodyLines(chunks)).toEqual(['@title A', 'Z X C V B N M , Z X']);
    const back = parseHarm(join(chunks));
    expect(back.diagnostics).toEqual([]);
    expect(sounds(back)).toBe(sounds(parseHarm(src)));
  });

  it('regression: a long @title is shortened with "…", never split into a note line', () => {
    // seed 2, limit 30: trước đây '1/95 @title Bài thử lặp đoạn và' + '2/95 giữ chuột …' (token lạ)
    const text = buildDonateText(song2, { durations: true, sectionHeaders: true });
    const chunks = chunkDonateText(text, 30);
    expect(checkChunks(chunks, 30)).toEqual([]);
    expect(chunks[0]).toMatch(/^1\/\d+ @title Bài thử lặp đoạn…$/);
    const back = parseHarm(join(chunks));
    expect(problems(back)).toEqual([]);
    expect(back.song.title).toBe('Bài thử lặp đoạn…');
    expect(back.song.artist).toBe('Tác giả thử');
  });

  it('long @artist / # header lines are shortened in place (still a directive / header)', () => {
    const artist = `@artist ${'Nghệ sĩ rất dài '.repeat(6).trim()}`;
    const header = `# ${'Điệp khúc cuối cùng '.repeat(5).trim()}`;
    const chunks = chunkDonateText(`@title A\n${artist}\n${header}\nZ X C`, 40);
    expect(checkChunks(chunks, 40)).toEqual([]);
    const lines = bodyLines(chunks);
    expect(lines.filter((l) => l.startsWith('@artist '))).toHaveLength(1);
    expect(lines.filter((l) => l.startsWith('# '))).toHaveLength(1);
    const back = parseHarm(join(chunks));
    expect(back.diagnostics).toEqual([]);
    expect(sameOrShortened(back.song.artist ?? '', artist.slice('@artist '.length))).toBe(true);
    expect(back.song.artist?.endsWith('…')).toBe(true);
    expect(back.song.sections.map((s) => s.name)).toHaveLength(1);
    expect(sameOrShortened(back.song.sections[0]?.name ?? '', header.slice(2))).toBe(true);
    expect(back.song.sections[0]?.lines).toHaveLength(1);
  });

  it('a long legacy prefix-only line (no notes) is dropped', () => {
    const chunks = chunkDonateText(`${'lời rất dài '.repeat(8).trim()}:\nZ X`, 30);
    expect(checkChunks(chunks, 30)).toEqual([]);
    expect(bodyLines(chunks)).toEqual(['Z X']);
    const back = parseHarm(join(chunks));
    expect(errors(back)).toEqual([]);
    expect(sounds(back)).toBe('Z01 X01');
  });

  it('a donate marker already at the start of a long line is dropped before splitting', () => {
    const line = `3/9 ${'Z X C V B N M , '.repeat(6).trim()}`;
    const chunks = chunkDonateText(line, 40);
    expect(checkChunks(chunks, 40)).toEqual([]);
    expect(bodyLines(chunks).every((l) => !l.startsWith('3/9'))).toBe(true);
    const back = parseHarm(join(chunks));
    expect(back.diagnostics).toEqual([]);
    expect(sounds(back)).toBe(sounds(parseHarm(line)));
  });

  it('CRLF input chunks exactly like LF input', () => {
    const text = buildDonateText(song2, ALL);
    expect(chunkDonateText(text.replace(/\n/g, '\r\n'), 120)).toEqual(chunkDonateText(text, 120));
  });

  it('splits a long note line between tokens (never inside [...])', () => {
    const line = '[giữ chuột trái] N N [thả chuột trái] X '.repeat(5).trim();
    const chunks = chunkDonateText(`@title Dài\n${line}`, 60);
    expect(checkChunks(chunks, 60)).toEqual([]);
    const lines = join(chunks.map((c) => c.replace(PREFIX_RE, ''))).split('\n');
    expect(lines[0]).toBe('@title Dài');
    expect(lines[1]?.startsWith('[giữ chuột trái] N N')).toBe(true);
    // ghép các mảnh bằng dấu cách là ra nguyên dòng
    expect(lines.slice(1).join(' ')).toBe(line);
    const back = parseHarm(join(chunks));
    expect(errors(back)).toEqual([]);
    expect(sounds(back)).toBe(sounds(parseHarm(line)));
  });

  it('emoji and Vietnamese: lengths in UTF-16 units, surrogate pairs never cut', () => {
    // tiền tố kiểu cũ có emoji / tiếng Việt (parser bỏ qua) — vẫn không cắt đôi cặp surrogate
    const legacy = 'Em ơi 😀😀 đừng khóc 🎵 nữa nhé người ơi';
    const text = Array.from({ length: 12 }, (_, i) => `${legacy} ${i}: Z X C V B N M ,`).join('\n');
    for (const limit of [30, 50, 61, 100]) {
      const chunks = chunkDonateText(text, limit);
      expect(checkChunks(chunks, limit)).toEqual([]);
    }
    // không có khoảng trắng nào: buộc cắt cứng, vẫn không cắt đôi emoji
    const solid = '😀'.repeat(200);
    const chunks = chunkDonateText(solid, 50);
    expect(checkChunks(chunks, 50)).toEqual([]);
    expect(chunks.map((c) => c.replace(PREFIX_RE, '')).join('')).toBe(solid);
  });

  it('hard split only as a last resort, and the pieces concatenate back', () => {
    const solid = 'Z*0.25-X'.repeat(60);
    const chunks = chunkDonateText(solid, 50);
    expect(checkChunks(chunks, 50)).toEqual([]);
    expect(chunks.map((c) => c.replace(PREFIX_RE, '')).join('')).toBe(solid);
  });

  it('recomputes the prefix width when n gains a digit (9 → 10+ chunks)', () => {
    // các dòng 38 ký tự quanh ngưỡng 2 dòng / phần, n vượt 9 → tiền tố dài thêm
    const lines = Array.from({ length: 10 }, (_, i) => `${'Z X '.repeat(9)}C${i}`.slice(0, 40));
    const text = lines.join('\n');
    for (const limit of [44, 45, 46, 47, 48]) {
      const chunks = chunkDonateText(text, limit);
      expect(checkChunks(chunks, limit), String(limit)).toEqual([]);
    }
    const many = Array.from({ length: 250 }, (_, i) => `Z X C ${i}`).join('\n');
    const chunks = chunkDonateText(many, 30);
    expect(chunks.length).toBeGreaterThan(99);
    expect(checkChunks(chunks, 30)).toEqual([]);
    expect(join(chunks.map((c) => c.replace(PREFIX_RE, '')))).toBe(many);
  });

  it('a long comment keeps "// " on its continuation pieces', () => {
    const comment = `// ${'ghi chú rất dài '.repeat(10).trim()}`;
    const chunks = chunkDonateText(`${comment}\nZ`, 40);
    expect(checkChunks(chunks, 40)).toEqual([]);
    const lines = join(chunks.map((c) => c.replace(PREFIX_RE, ''))).split('\n');
    expect(lines.slice(0, -1).every((l) => l.startsWith('//'))).toBe(true);
    const r = parseHarm(join(chunks));
    expect(r.diagnostics).toEqual([]);
    expect(r.song.sections[0]?.lines).toHaveLength(1);
  });

  it('limits below MIN_DONATE_LIMIT are raised to it; NaN uses the default', () => {
    const text = buildDonateText(song1, ALL);
    expect(chunkDonateText(text, 5)).toEqual(chunkDonateText(text, MIN_DONATE_LIMIT));
    expect(chunkDonateText(text, Number.NaN)).toEqual(chunkDonateText(text));
    expect(chunkDonateText(text, Number.POSITIVE_INFINITY)).toEqual([text]);
  });

  it('works for a big song (many chunks) quickly', () => {
    const big: Song = {
      ...song2,
      sections: Array.from({ length: 20 }, () => song2.sections).flat(),
    };
    const text = buildDonateText(big, ALL);
    const t0 = performance.now();
    const chunks = chunkDonateText(text, 200);
    expect(performance.now() - t0).toBeLessThan(1000);
    expect(chunks.length).toBeGreaterThan(99);
    expect(checkChunks(chunks, 200)).toEqual([]);
    expect(sounds(parseHarm(join(chunks)))).toBe(sounds(parseHarm(text)));
  });
});

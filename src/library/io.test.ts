import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as Parser from '../core/parser';
import type * as Serializer from '../core/serializer';
import type { ParseResult, Song } from '../core/types';
import { useSettings } from '../ui/settings';
import type { ExportInput } from './io';
import {
  SONG_FILE_FORMAT,
  exportBaseName,
  exportHarm,
  exportJson,
  parseImportFile,
  readFileText,
  sameSongContent,
  toSong,
} from './io';

// Serializer / parser thật do agent khác viết → bản giả: serializer ghi lại model nhận được,
// parser "đọc lại" đúng model đó (round-trip lý tưởng) trừ vài title đặc biệt để thử nhánh lỗi.
const fake = vi.hoisted(() => {
  const seen: { song: unknown; parsed: string[] } = { song: null, parsed: [] };
  const serialize = (song: { title: string }) => {
    seen.song = song;
    if (song.title === 'THROW') throw new Error('boom');
    if (song.title === 'EMPTY') return '';
    return `@title ${song.title}\n# Main\nZ\n`;
  };
  const parse = (text: string) => {
    seen.parsed.push(text);
    const song = seen.song as { title: string; bpm: number };
    // DRIFT: đọc lại ra bài khác (serializer làm mất thông tin); BROKEN: đọc lại bị lỗi cú pháp.
    const back = song.title === 'DRIFT' ? { ...song, bpm: song.bpm + 1 } : song;
    return { song: back, diagnostics: [], lineOrigins: [], ok: song.title !== 'BROKEN' };
  };
  return { seen, serialize, parse };
});

// canonicalSong / isValidTimeSig là hàm thuần của core → dùng bản thật.
vi.mock('../core/serializer', async (importOriginal) => ({
  ...(await importOriginal<typeof Serializer>()),
  serializeHarm: fake.serialize,
}));
vi.mock('../core/parser', async (importOriginal) => ({
  ...(await importOriginal<typeof Parser>()),
  parseHarm: fake.parse,
}));
const flags = vi.hoisted(() => ({ editor: false, share: false, midiImport: false }));
vi.mock('../ui/features', () => ({ FEATURES: flags }));

const SONG: Song = {
  id: 'x',
  title: 'Từ model',
  artist: 'A',
  bpm: 100,
  timeSig: { num: 3, den: 4 },
  scrollDir: -1,
  sections: [
    {
      name: 'ĐOẠN 1',
      lines: [
        {
          units: [
            { kind: 'note', key: 'Z', octave: -1, sharp: true, beats: 0.5 },
            {
              kind: 'slur',
              notes: [
                { kind: 'note', key: 'X', octave: 0, sharp: false, beats: 0.5 },
                { kind: 'note', key: ',', octave: 1, sharp: false, beats: 0.5 },
              ],
            },
            { kind: 'rest', beats: 1 },
          ],
        },
      ],
    },
  ],
};

beforeEach(() => {
  useSettings.setState({ language: 'vi' });
  fake.seen.song = null;
  fake.seen.parsed = [];
  flags.midiImport = false;
});

describe('parseImportFile — văn bản', () => {
  it('.harm / .txt → nguyên văn (bỏ BOM, CRLF → LF)', () => {
    expect(parseImportFile('a.harm', '@title A\nZ X')).toEqual({
      sources: ['@title A\nZ X'],
      errors: [],
    });
    expect(parseImportFile('B.TXT', '﻿@title B\r\nZ\r\n').sources).toEqual(['@title B\nZ\n']);
  });

  it('file rỗng → lỗi', () => {
    const r = parseImportFile('a.harm', '  \n ');
    expect(r.sources).toEqual([]);
    expect(r.errors).toEqual(['a.harm: file rỗng']);
  });

  it('đuôi không hỗ trợ / MIDI → lỗi', () => {
    expect(parseImportFile('x.png', 'abc').errors[0]).toContain('x.png');
    expect(parseImportFile('x.png', 'abc').sources).toEqual([]);
    expect(parseImportFile('song.mid', 'MThd').errors[0]).toContain('MIDI');
  });

  it('MIDI / MusicXML: chưa có "Tạo bài từ file" thì không chỉ tới nút đó', () => {
    expect(parseImportFile('song.mid', 'MThd').errors).toEqual([
      'song.mid: bản này chưa hỗ trợ nhập file MIDI',
    ]);
    expect(parseImportFile('score.musicxml', '<score-partwise/>').errors).toEqual([
      'score.musicxml: chỉ nhận file .harm, .json hoặc .txt',
    ]);
    flags.midiImport = true;
    expect(parseImportFile('song.midi', 'MThd').errors).toEqual([
      'song.midi: file MIDI — dùng "Tạo bài từ file MIDI / MusicXML"',
    ]);
    expect(parseImportFile('karaoke.KAR', 'MThd').errors).toEqual([
      'karaoke.KAR: file MIDI — dùng "Tạo bài từ file MIDI / MusicXML"',
    ]);
    for (const name of ['a.musicxml', 'b.xml', 'c.mxl']) {
      expect(parseImportFile(name, '<score-partwise/>').errors).toEqual([
        `${name}: file MusicXML — dùng "Tạo bài từ file MIDI / MusicXML"`,
      ]);
    }
  });

  it('không có đuôi: tự nhận JSON hoặc .harm', () => {
    expect(parseImportFile('noext', '{"source":"Z"}').sources).toEqual(['Z']);
    expect(parseImportFile('noext', '@title X\nZ').sources).toEqual(['@title X\nZ']);
  });
});

describe('parseImportFile — JSON', () => {
  it('{ format, version, source } và { source }', () => {
    const file = JSON.stringify({ format: SONG_FILE_FORMAT, version: 1, source: '@title A\nZ' });
    expect(parseImportFile('a.json', file)).toEqual({ sources: ['@title A\nZ'], errors: [] });
    expect(parseImportFile('a.json', '{"source":"X\\r\\nC"}').sources).toEqual(['X\nC']);
  });

  it('ưu tiên source hơn song', () => {
    const r = parseImportFile('a.json', JSON.stringify({ source: 'Z', song: SONG }));
    expect(r.sources).toEqual(['Z']);
    expect(fake.seen.song).toBeNull();
  });

  it('{ song: Song } → serialize model, đọc lại để kiểm', () => {
    const r = parseImportFile('a.json', JSON.stringify({ song: SONG }));
    expect(r).toEqual({ sources: ['@title Từ model\n# Main\nZ\n'], errors: [] });
    expect(fake.seen.song).toEqual(SONG);
    expect(fake.seen.parsed).toEqual(['@title Từ model\n# Main\nZ\n']);
  });

  it('đọc lại ra bài khác hoặc có lỗi cú pháp → lỗi serialize, không nhập bài đã bị đổi', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    for (const title of ['DRIFT', 'BROKEN']) {
      const r = parseImportFile('m.json', JSON.stringify({ song: { ...SONG, title } }));
      expect(r.sources, title).toEqual([]);
      expect(r.errors, title).toEqual(['m.json: không chuyển được bài thành .harm']);
    }
  });

  it('luyến có nốt dài khác nhau → giữ tổng độ dài, chia đều (D-014)', () => {
    const r = parseImportFile(
      'slur.json',
      JSON.stringify({
        sections: [
          {
            lines: [
              {
                units: [
                  {
                    kind: 'slur',
                    notes: [
                      { key: 'Z', beats: 1 },
                      { key: 'X', beats: 3 },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      }),
    );
    expect(r.errors).toEqual([]);
    const song = fake.seen.song as Song;
    expect(song.sections[0]?.lines[0]?.units).toEqual([
      {
        kind: 'slur',
        notes: [
          { kind: 'note', key: 'Z', octave: 0, sharp: false, beats: 2 },
          { kind: 'note', key: 'X', octave: 0, sharp: false, beats: 2 },
        ],
      },
    ]);
  });

  it('source rỗng → dùng song', () => {
    const r = parseImportFile('a.json', JSON.stringify({ source: '  ', song: SONG }));
    expect(r.sources).toEqual(['@title Từ model\n# Main\nZ\n']);
  });

  it('Song-like trần có sections → serialize, field thiếu lấy mặc định', () => {
    const r = parseImportFile(
      'a.json',
      JSON.stringify({ title: 'Trần', sections: [{ lines: [{ units: [{ key: 'z' }] }] }] }),
    );
    expect(r.errors).toEqual([]);
    expect(fake.seen.song).toEqual({
      id: '',
      title: 'Trần',
      bpm: 90,
      timeSig: { num: 4, den: 4 },
      scrollDir: 1,
      sections: [
        {
          name: 'Main',
          lines: [{ units: [{ kind: 'note', key: 'Z', octave: 0, sharp: false, beats: 1 }] }],
        },
      ],
    });
  });

  it('mảng các dạng trên, lỗi từng mục có số thứ tự', () => {
    const r = parseImportFile(
      'list.json',
      JSON.stringify([{ source: 'A' }, { song: SONG }, 42, { foo: 1 }]),
    );
    expect(r.sources).toEqual(['A', '@title Từ model\n# Main\nZ\n']);
    expect(r.errors).toEqual([
      'list.json (mục 3): không nhận ra định dạng bài hát',
      'list.json (mục 4): không nhận ra định dạng bài hát',
    ]);
  });

  it('gói { songs: [...] } (vd. bản sao localStorage cũ có field text)', () => {
    const r = parseImportFile(
      'lib.json',
      JSON.stringify({ songs: [{ text: 'Z' }, { source: 'X' }] }),
    );
    expect(r.sources).toEqual(['Z', 'X']);
    expect(parseImportFile('lib.json', '[]').errors).toHaveLength(1);
  });

  it('JSON hỏng → lỗi, không throw', () => {
    expect(() => parseImportFile('bad.json', '{oops')).not.toThrow();
    expect(parseImportFile('bad.json', '{oops')).toEqual({
      sources: [],
      errors: ['bad.json: JSON không hợp lệ'],
    });
  });

  it('shape lạ / model sai → lỗi', () => {
    for (const bad of [
      '{"foo":1}',
      '"str"',
      '42',
      'null',
      '{"song":{"sections":[{"lines":[{"units":[{"key":"Q"}]}]}]}}',
      '{"song":{"sections":[{"lines":[{"units":[{"key":"Z","beats":-1}]}]}]}}',
      '{"song":{"sections":[{"lines":[{"units":[{"key":"Z","octave":2}]}]}]}}',
      '{"song":{"sections":[{"lines":[{"units":[{"kind":"slur","notes":[]}]}]}]}}',
      '{"song":{"bpm":0,"sections":[]}}',
      '{"song":{"scrollDir":2,"sections":[]}}',
      '{"song":{"timeSig":{"num":4},"sections":[]}}',
      // nhịp ngoài miền `@time` của parser (sẽ bị đổi thành 4/4 nếu nhận)
      '{"song":{"timeSig":{"num":5,"den":3},"sections":[]}}',
      '{"song":{"timeSig":{"num":33,"den":4},"sections":[]}}',
      '{"song":{"sections":[{"lines":"x"}]}}',
    ]) {
      const r = parseImportFile('x.json', bad);
      expect(r.sources, bad).toEqual([]);
      expect(r.errors, bad).toEqual(['x.json: không nhận ra định dạng bài hát']);
    }
  });

  it('serialize throw / rỗng → lỗi riêng', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    for (const title of ['THROW', 'EMPTY']) {
      const r = parseImportFile('s.json', JSON.stringify({ song: { ...SONG, title } }));
      expect(r.sources).toEqual([]);
      expect(r.errors).toEqual(['s.json: không chuyển được bài thành .harm']);
    }
  });

  it('thông báo lỗi theo ngôn ngữ hiện tại', () => {
    useSettings.setState({ language: 'en' });
    expect(parseImportFile('bad.json', '{').errors).toEqual(['bad.json: invalid JSON']);
  });
});

describe('toSong', () => {
  it('bỏ key lyric của JSON cũ (kể cả sai kiểu); artist rỗng bị bỏ; dòng không có nốt bị bỏ (D-013)', () => {
    const s = toSong({
      artist: ' ',
      sections: [
        {
          name: 'A',
          lines: [
            { lyric: 'x', units: [{ kind: 'rest' }] },
            { lyric: 3, units: [{ key: 'Z' }] },
            { lyric: 'chỉ có lời', units: [] },
          ],
        },
      ],
    });
    expect(s?.artist).toBeUndefined();
    expect(s?.sections[0]?.lines).toEqual([
      { units: [{ kind: 'rest', beats: 1 }] },
      { units: [{ kind: 'note', key: 'Z', octave: 0, sharp: false, beats: 1 }] },
    ]);
  });

  it('luyến có nốt dài bằng nhau (vd. chùm ba 1/3) giữ nguyên giá trị', () => {
    const third = 1 / 3;
    const notes = ['Z', 'X', 'C'].map((key) => ({ key, beats: third }));
    const song = toSong({ sections: [{ lines: [{ units: [{ kind: 'slur', notes }] }] }] });
    const unit = song?.sections[0]?.lines[0]?.units[0];
    expect(unit?.kind === 'slur' ? unit.notes.map((n) => n.beats) : null).toEqual([
      third,
      third,
      third,
    ]);
  });

  it('round trip model hợp lệ', () => {
    expect(toSong(JSON.parse(JSON.stringify(SONG)))).toEqual(SONG);
    expect(toSong([])).toBeNull();
    expect(toSong({ sections: [{ lines: [{ units: 3 }] }] })).toBeNull();
  });
});

describe('sameSongContent', () => {
  const clone = (): Song => JSON.parse(JSON.stringify(SONG)) as Song;

  it('bỏ qua id, khoảng trắng thừa và sai số float', () => {
    const b = clone();
    b.id = 'khác';
    b.title = '  Từ   model ';
    const u = b.sections[0]!.lines[0]!.units[0]!;
    if (u.kind === 'note') u.beats = 0.1 + 0.2 + 0.2 - 0.0000000000000001;
    expect(sameSongContent(SONG, b)).toBe(true);
  });

  it('phát hiện mọi khác biệt nội dung', () => {
    const mutations: ((s: Song) => void)[] = [
      (s) => (s.bpm = 101),
      (s) => (s.scrollDir = 1),
      (s) => (s.timeSig = { num: 4, den: 4 }),
      (s) => (s.artist = 'B'),
      (s) => (s.sections[0]!.name = 'ĐOẠN 2'),
      (s) => s.sections[0]!.lines[0]!.units.pop(),
      (s) => s.sections.push({ name: 'X', lines: [] }),
      (s) => {
        const slur = s.sections[0]!.lines[0]!.units[1]!;
        if (slur.kind === 'slur') slur.notes[1]!.beats = 1.5;
      },
      (s) => {
        const n = s.sections[0]!.lines[0]!.units[0]!;
        if (n.kind === 'note') n.sharp = false;
      },
      (s) => (s.sections[0]!.lines[0]!.units[2] = { kind: 'rest', beats: 2 }),
    ];
    mutations.forEach((mutate, i) => {
      const b = clone();
      mutate(b);
      expect(sameSongContent(SONG, b), `mutation ${i}`).toBe(false);
    });
  });
});

describe('export', () => {
  const parsed = (title: string): ParseResult => ({
    song: { ...SONG, id: 'seed-quoc-ca-viet-nam', title },
    diagnostics: [],
    lineOrigins: [],
    lineSpans: [],
    unitSpans: [],
    ok: true,
  });
  const entry: ExportInput = {
    id: 'seed-quoc-ca-viet-nam',
    source: '@title Quốc ca Việt Nam\n# A\nZ\n',
    parsed: parsed('Quốc ca Việt Nam'),
  };

  it('exportHarm: tên file slug không dấu, nội dung = nguồn', () => {
    expect(exportHarm(entry)).toEqual({
      filename: 'quoc-ca-viet-nam.harm',
      text: entry.source,
      mime: 'text/plain',
    });
  });

  it('exportJson: { format, version, source, song }', () => {
    const f = exportJson({ ...entry, parsed: parsed('Tiến quân ca') });
    expect(f.filename).toBe('tien-quan-ca.json');
    expect(f.mime).toBe('application/json');
    const data = JSON.parse(f.text) as Record<string, unknown>;
    expect(data).toEqual({
      format: 'dfht-song',
      version: 1,
      source: entry.source,
      song: { ...SONG, id: 'seed-quoc-ca-viet-nam', title: 'Tiến quân ca' },
    });
  });

  it('tên file fallback: @title trong nguồn → id → "song"', () => {
    expect(exportBaseName({ ...entry, parsed: parsed('') })).toBe('quoc-ca-viet-nam');
    expect(exportBaseName({ id: 'Bài Đẹp', source: 'Z', parsed: parsed('') })).toBe('bai-dep');
    expect(exportBaseName({ source: 'Z', parsed: parsed('!!!') })).toBe('song');
  });

  it('export .json → import lại ra đúng nguồn', () => {
    const f = exportJson(entry);
    expect(parseImportFile(f.filename, f.text)).toEqual({ sources: [entry.source], errors: [] });
    const h = exportHarm(entry);
    expect(parseImportFile(h.filename, h.text).sources).toEqual([entry.source]);
  });
});

describe('readFileText', () => {
  it('đọc File UTF-8', async () => {
    const file = new File(['@title Tiếng Việt\nZ'], 'a.harm', { type: 'text/plain' });
    await expect(readFileText(file)).resolves.toBe('@title Tiếng Việt\nZ');
  });
});

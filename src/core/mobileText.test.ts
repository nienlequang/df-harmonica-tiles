import { describe, expect, it } from 'vitest';
import seed1 from '../test/fixtures/bai-thu-nhip-dieu.harm?raw';
import seed2 from '../test/fixtures/bai-thu-lap-doan.harm?raw';
import type { MobileTextOptions } from './mobileText';
import { serializeMobileText } from './mobileText';
import { parseHarm } from './parser';
import type { Line, Note, NoteKey, Octave, Rest, Section, Slur, Song, Unit } from './types';

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
const RS = (key: NoteKey, beats = 1): Note => n(key, beats, 1, true);
const rest = (beats = 1): Rest => ({ kind: 'rest', beats });
const slur = (...notes: Note[]): Slur => ({ kind: 'slur', notes });
const line = (units: Unit[]): Line => ({ units });
const sec = (name: string, ...lines: Line[]): Section => ({ name, lines });
const song = (sections: Section[], extra: Partial<Song> = {}): Song => ({
  id: 't',
  title: 'Test',
  bpm: 120,
  timeSig: { num: 4, den: 4 },
  scrollDir: 1,
  sections,
  ...extra,
});

const VI = { left: 'Cúi Xuống', right: 'Ngẩng Lên', natural: 'Ngẩng Tự Nhiên', scroll: 'Nửa Cung' };
const ALL: MobileTextOptions = {
  durations: true,
  sectionHeaders: true,
  semitone: 'toggle',
  labels: VI,
};

/**
 * A: "L:N L:N*.5 Z X" / "_*2 X-R:C S:V ,"
 * B: "RS:Z _ RS:X"
 */
const small = song([
  sec(
    'A',
    line([L('N'), L('N', 0.5), n('Z'), n('X')]),
    line([rest(2), slur(n('X', 0.5), R('C', 0.5)), S('V'), n(',')]),
  ),
  sec('B', line([RS('Z'), rest(), RS('X')])),
]);

describe('serializeMobileText — small songs', () => {
  it('full output: button positions, mode taps where the cues are, toggle semitone', () => {
    expect(serializeMobileText(small, ALL)).toBe(
      [
        '@title Test',
        '@bpm 120',
        '@time 4/4',
        '@scroll +1',
        '',
        '# A',
        '[Cúi Xuống] 6 6*0.5 [Ngẩng Tự Nhiên] 1 2',
        '_*2 2-[Ngẩng Lên]3 [Ngẩng Tự Nhiên] [Nửa Cung] 4 [Nửa Cung] 8',
        '',
        '# B',
        // rest không làm mất chế độ: nốt sau rest không cần chạm lại
        '[Ngẩng Lên] [Nửa Cung] 1 _ 2',
        '',
      ].join('\n'),
    );
  });

  it("oneShot semitone: a tap before every sharp note, no 'off' tap", () => {
    const text = serializeMobileText(small, { ...ALL, semitone: 'oneShot' });
    expect(text.split('\n').slice(6)).toEqual([
      '[Cúi Xuống] 6 6*0.5 [Ngẩng Tự Nhiên] 1 2',
      '_*2 2-[Ngẩng Lên]3 [Ngẩng Tự Nhiên] [Nửa Cung] 4 8',
      '',
      '# B',
      '[Ngẩng Lên] [Nửa Cung] 1 _ [Nửa Cung] 2',
      '',
    ]);
  });

  it('overridden labels, durations off, sections off', () => {
    const text = serializeMobileText(small, {
      durations: false,
      sectionHeaders: false,
      semitone: 'toggle',
      labels: { left: 'Xuống', right: 'Lên', natural: 'Giữa', scroll: 'NC' },
    });
    expect(text).toBe(
      [
        '@title Test',
        '@bpm 120',
        '@time 4/4',
        '@scroll +1',
        '',
        '[Xuống] 6 6 [Giữa] 1 2',
        '_ 2-[Lên]3 [Giữa] [NC] 4 [NC] 8',
        '[Lên] [NC] 1 _ 2',
        '',
      ].join('\n'),
    );
  });

  it('legend becomes the first comment line (one line, trimmed; empty → omitted)', () => {
    const tiny = song([sec('Main', line([L('Z'), n('Z', 2)]))], { artist: 'Ai đó', bpm: 90.5 });
    const legend = '  1–8 = nút từ trái sang phải\n[…] = chạm nút chế độ  ';
    expect(serializeMobileText(tiny, { ...ALL, legend })).toBe(
      [
        '// 1–8 = nút từ trái sang phải […] = chạm nút chế độ',
        '@title Test',
        '@artist Ai đó',
        '@bpm 90.5',
        '@time 4/4',
        '@scroll +1',
        '',
        '# Main',
        '[Cúi Xuống] 1 [Ngẩng Tự Nhiên] 1*2',
        '',
      ].join('\n'),
    );
    expect(serializeMobileText(tiny, { ...ALL, legend: '   ' })).not.toContain('//');
    expect(serializeMobileText(tiny, ALL).startsWith('@title Test\n')).toBe(true);
  });

  it('slur durations are written as the total; multiple cues inside a slur stick together', () => {
    // luyến 3 nốt × 1/3 (chùm ba), nốt giữa đổi quãng + bật Nửa Cung
    const third = 1 / 3;
    const s = song([
      sec('Main', line([slur(n('Z', third), RS('X', third), n('C', third)), slur(n('V'), n('B'))])),
    ]);
    expect(
      serializeMobileText(s, { ...ALL, sectionHeaders: false })
        .split('\n')
        .slice(5),
    ).toEqual(['1-[Ngẩng Lên][Nửa Cung]2-[Ngẩng Tự Nhiên][Nửa Cung]3 4-5*2', '']);
  });

  it('empty sections still get a header; a song without sections has only directives', () => {
    const s = song([sec('Rỗng'), sec('Main', line([n('M')]))], { title: '' });
    expect(serializeMobileText(s, ALL)).toBe(
      ['@bpm 120', '@time 4/4', '@scroll +1', '', '# Rỗng', '', '# Main', '7', ''].join('\n'),
    );
    expect(serializeMobileText(song([], { scrollDir: -1 }), ALL)).toBe(
      '@title Test\n@bpm 120\n@time 4/4\n@scroll -1\n',
    );
  });

  it('normalizes like serializeHarm (one-line text) and does not touch the input', () => {
    const legacy = { lyric: 'a: b', units: [n('Z')] } as Line;
    const s = song([sec('Đoạn\n1', legacy)], { title: 'T\r\nX' });
    const before = JSON.stringify(s);
    const text = serializeMobileText(s, ALL);
    expect(text).toContain('@title T X\n');
    expect(text).toContain('# Đoạn 1\n1\n');
    // không bao giờ ghi lời (key `lyric` của dữ liệu cũ bị bỏ)
    expect(text).not.toContain('a: b');
    expect(JSON.stringify(s)).toBe(before);
  });
});

describe('serializeMobileText — seeds', () => {
  const song1 = parseHarm(seed1, { id: 'seed-1' }).song;
  const song2 = parseHarm(seed2, { id: 'seed-2' }).song;

  it('seed 1: verse X-C and the long Ngẩng Lên chorus', () => {
    const lines = serializeMobileText(song1, ALL).split('\n');
    expect(lines).toContain('6*0.5 7*0.5 8 5*2 [Ngẩng Lên] 2-3 [Ngẩng Tự Nhiên] 6*2 _');
    const chorus = lines.indexOf('# ĐIỆP KHÚC');
    expect(lines[chorus + 1]).toBe('[Ngẩng Lên] 3*2 5 6 7*2 6 5');
    // cả điệp khúc chỉ một lần chạm
    expect(lines.slice(chorus).join('\n').match(/\[/g)).toHaveLength(1);
    expect(lines.at(-2)).toBe('2*0.5 3*0.5 5*0.5 6*0.5 3*2 6*3.5 _*0.5');
  });

  it('seed 2 ĐOẠN 6: toggle vs oneShot semitone taps', () => {
    const toggle = serializeMobileText(song2, ALL).split('\n');
    const oneShot = serializeMobileText(song2, { ...ALL, semitone: 'oneShot' }).split('\n');
    expect(toggle).toContain('4 5 [Nửa Cung] 6 [Nửa Cung] 5 4 3 2');
    expect(toggle).toContain('2 4 5 [Nửa Cung] 6 [Nửa Cung] 8 6 4');
    expect(oneShot).toContain('4 5 [Nửa Cung] 6 5 4 3 2');
    expect(oneShot).toContain('2 4 5 [Nửa Cung] 6 8 6 4');
  });

  it('seed 2: Cúi Xuống tapped inside a slur latches into the next line', () => {
    const lines = serializeMobileText(song2, ALL).split('\n');
    expect(lines).toContain('4 5 6 5 4 3 2 3 4 2 3 1-[Cúi Xuống]6');
    expect(lines).toContain('6 [Ngẩng Tự Nhiên] 1 2 4 3 2 3 4 6');
  });

  it('seed 2 full export (snapshot)', () => {
    expect(serializeMobileText(song2, ALL)).toMatchSnapshot();
  });
});

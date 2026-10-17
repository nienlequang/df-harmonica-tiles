import { describe, expect, it } from 'vitest';
import type { Song } from '../core/types';
import {
  foldText,
  formatDuration,
  getDirective,
  matchesQuery,
  newSongTemplate,
  setDirectiveInSource,
  setTitleInSource,
  slugify,
  quickSongStats,
} from './songSource';

const BOM = String.fromCharCode(0xfeff);

describe('getDirective', () => {
  const src = '@title  Kìa con bướm vàng  \n@ARTIST Ai đó\n@bpm 76\n@time\n# A\nZ X';

  it('trả về giá trị đã trim, không phân biệt hoa thường', () => {
    expect(getDirective(src, 'title')).toBe('Kìa con bướm vàng');
    expect(getDirective(src, 'artist')).toBe('Ai đó');
    expect(getDirective(src, 'BPM')).toBe('76');
  });

  it('directive không có giá trị → chuỗi rỗng; không có → null', () => {
    expect(getDirective(src, 'time')).toBe('');
    expect(getDirective(src, 'scroll')).toBeNull();
  });

  it('không khớp tiền tố tên dài hơn và bỏ qua comment', () => {
    expect(getDirective('@titles X\n// @title Y', 'title')).toBeNull();
  });

  it('directive lặp → lấy dòng CUỐI, khớp parser (directive sau ghi đè)', () => {
    expect(getDirective('@title A\n@bpm 90\n# S\nZ\n@title B\n', 'title')).toBe('B');
    expect(getDirective('@artist X\n@artist\n', 'artist')).toBe('');
  });

  it('chấp nhận BOM và CRLF', () => {
    expect(getDirective('﻿@title A\r\n@bpm 90\r\n', 'title')).toBe('A');
    expect(getDirective('﻿@title A\r\n@bpm 90\r\n', 'bpm')).toBe('90');
  });
});

describe('setTitleInSource', () => {
  it('thay dòng @title, giữ phần còn lại', () => {
    expect(setTitleInSource('@title Cũ\n@bpm 90\n# A\nZ\n', 'Mới')).toBe(
      '@title Mới\n@bpm 90\n# A\nZ\n',
    );
  });

  it('nhiều dòng @title → thay dòng CUỐI (dòng parser dùng), giữ các dòng khác', () => {
    const src = '@title Cũ\n@bpm 90\n# A\nZ\n@title Thứ hai\n';
    const out = setTitleInSource(src, 'Mới');
    expect(out).toBe('@title Cũ\n@bpm 90\n# A\nZ\n@title Mới\n');
    expect(getDirective(out, 'title')).toBe('Mới');
  });

  it('chèn @title lên đầu nếu chưa có', () => {
    expect(setTitleInSource('@bpm 90\nZ X\n', 'Bài A')).toBe('@title Bài A\n@bpm 90\nZ X\n');
    expect(setTitleInSource('', 'Bài A')).toBe('@title Bài A\n');
  });

  it('khớp không phân biệt hoa thường, có thụt lề', () => {
    expect(setTitleInSource('  @Title cũ\nZ', 'B')).toBe('@title B\nZ');
  });

  it('giữ CRLF và BOM', () => {
    expect(setTitleInSource('﻿@bpm 90\r\nZ\r\n', 'T')).toBe('﻿@title T\r\n@bpm 90\r\nZ\r\n');
    expect(setTitleInSource('﻿@title a\r\nZ\r\n', 'T')).toBe('﻿@title T\r\nZ\r\n');
  });

  it('title nhiều dòng bị gộp thành một dòng', () => {
    expect(setTitleInSource('Z', 'a\nb\r\nc')).toBe('@title a b c\nZ');
  });

  it('title rỗng → bỏ dòng @title (hoặc giữ nguyên nếu không có)', () => {
    expect(setTitleInSource('@title X\n@bpm 90\n', '  ')).toBe('@bpm 90\n');
    expect(setTitleInSource('@bpm 90\n', '')).toBe('@bpm 90\n');
  });

  it('title rỗng → bỏ MỌI dòng @title (không để dòng phía trên có hiệu lực lại)', () => {
    const out = setTitleInSource('@title A\r\n@bpm 90\r\nZ\r\n@title B', '');
    expect(out).toBe('@bpm 90\r\nZ\r\n');
    expect(getDirective(out, 'title')).toBeNull();
  });
});

describe('setDirectiveInSource', () => {
  it('thay dòng cuối cùng (dòng parser dùng), giữ phần còn lại', () => {
    expect(setDirectiveInSource('@title A\n@bpm 90\n@time 4/4\nZ\n', 'bpm', '132')).toBe(
      '@title A\n@bpm 132\n@time 4/4\nZ\n',
    );
    expect(setDirectiveInSource('@bpm 80\n@bpm 90\nZ', 'bpm', '70')).toBe('@bpm 80\n@bpm 70\nZ');
  });

  it('chưa có: chèn ngay sau khối directive / comment đầu bài; không có khối → lên đầu', () => {
    expect(setDirectiveInSource('@title A\n@bpm 90\n// x\n\n# Main\nZ\n', 'artist', 'Tôi')).toBe(
      '@title A\n@bpm 90\n@artist Tôi\n// x\n\n# Main\nZ\n',
    );
    expect(setDirectiveInSource('Z X\n', 'bpm', '100')).toBe('@bpm 100\nZ X\n');
    expect(setDirectiveInSource('', 'bpm', '100')).toBe('@bpm 100\n');
  });

  it('giữ CRLF + BOM; giá trị rỗng / xuống dòng', () => {
    expect(setDirectiveInSource(`${BOM}@title A\r\nZ\r\n`, 'time', '3/4')).toBe(
      `${BOM}@title A\r\n@time 3/4\r\nZ\r\n`,
    );
    expect(setDirectiveInSource('@bpm 90\nZ', 'bpm', '  ')).toBe('@bpm 90\nZ');
    expect(setDirectiveInSource('Z', 'artist', 'a\nb')).toBe('@artist a b\nZ');
  });
});

describe('foldText / matchesQuery / slugify', () => {
  it('bỏ dấu tiếng Việt và đ', () => {
    expect(foldText('Kìa con BƯỚM vàng')).toBe('kia con buom vang');
    expect(foldText('Đường   đời ư ơ')).toBe('duong doi u o');
  });

  it('search không dấu, không phân biệt hoa thường, mọi từ phải khớp', () => {
    expect(matchesQuery('kia con buom vang', 'Kìa con bướm vàng')).toBe(true);
    expect(matchesQuery('BƯỚM', 'Kìa con bướm vàng')).toBe(true);
    expect(matchesQuery('van cao', 'Quốc ca Việt Nam', 'Văn Cao')).toBe(true);
    expect(matchesQuery('vang buom', 'Kìa con bướm vàng')).toBe(true);
    expect(matchesQuery('viet nam', 'Kìa con bướm vàng')).toBe(false);
    expect(matchesQuery('   ', 'bất kỳ')).toBe(true);
    expect(matchesQuery('x', null, undefined)).toBe(false);
  });

  it('slug không dấu', () => {
    expect(slugify('Quốc ca Việt Nam')).toBe('quoc-ca-viet-nam');
    expect(slugify('Đường về nhà (bản sao)')).toBe('duong-ve-nha-ban-sao');
    expect(slugify('TAKEDISKRUSH!')).toBe('takediskrush');
    expect(slugify('  ---  ')).toBe('');
    expect(slugify('a'.repeat(100)).length).toBe(60);
    expect(slugify('ab cd ef', 3)).toBe('ab');
  });
});

describe('quickSongStats / formatDuration', () => {
  const song: Song = {
    id: 's',
    title: 'T',
    bpm: 120,
    timeSig: { num: 4, den: 4 },
    scrollDir: 1,
    sections: [
      {
        name: 'A',
        lines: [
          {
            units: [
              { kind: 'note', key: 'Z', octave: 0, sharp: false, beats: 1 },
              { kind: 'rest', beats: 0.5 },
              {
                kind: 'slur',
                notes: [
                  { kind: 'note', key: 'X', octave: 0, sharp: false, beats: 0.5 },
                  { kind: 'note', key: 'C', octave: 1, sharp: false, beats: 0.5 },
                ],
              },
            ],
          },
        ],
      },
      {
        name: 'B',
        lines: [{ units: [{ kind: 'note', key: ',', octave: 0, sharp: true, beats: 4 }] }],
      },
    ],
  };

  it('đếm beat (gồm rest) và nốt (luyến đếm từng nốt)', () => {
    expect(quickSongStats(song)).toEqual({ totalBeats: 6.5, noteCount: 4, durationSec: 3.25 });
  });

  it('bpm hỏng → dùng bpm mặc định', () => {
    expect(quickSongStats({ ...song, bpm: 0 }).durationSec).toBeCloseTo((6.5 * 60) / 90);
  });

  it('mm:ss', () => {
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(5.4)).toBe('0:05');
    // Làm tròn xuống như đồng hồ Player (formatClock): cùng một bài, cùng một độ dài.
    expect(formatDuration(125.6)).toBe('2:05');
    expect(formatDuration(30.5)).toBe('0:30');
    expect(formatDuration(29.9999999)).toBe('0:30');
    expect(formatDuration(Number.NaN)).toBe('0:00');
    expect(formatDuration(-3)).toBe('0:00');
  });
});

describe('newSongTemplate', () => {
  it('sinh nguồn tối thiểu với title, @scroll +1, section và dòng nốt mẫu (không lời)', () => {
    const src = newSongTemplate({ title: 'Bài mới', section: 'ĐOẠN 1', comment: 'gợi ý' });
    expect(getDirective(src, 'title')).toBe('Bài mới');
    // Nửa Cung của game luôn thăng
    expect(getDirective(src, 'scroll')).toBe('+1');
    expect(getDirective(src, 'bpm')).toBe('90');
    expect(src).toContain('// gợi ý\n');
    expect(src.endsWith('\n# ĐOẠN 1\nZ X C V B N M ,\n')).toBe(true);
  });
});

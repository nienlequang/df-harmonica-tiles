import { beforeEach, describe, expect, it } from 'vitest';
import { parseHarm } from '../core/parser';
import type { Song } from '../core/types';
import { useSettings } from '../ui/settings';
import { exportHarm, exportJson, parseImportFile } from './io';
import { SEED_SONGS } from './seeds';
import { formatClock } from '../player/usePlayerEngine';
import { formatDuration, quickSongStats } from './songSource';
import { clearParseCache, entryTitle, getSong, listSongs, useLibrary } from './store';

// Dùng parser + serializer thật (chạy ở giai đoạn integration).

const withoutId = (song: Song): Omit<Song, 'id'> => {
  const { id: _id, ...rest } = song;
  return rest;
};

beforeEach(() => {
  useLibrary.setState({ songs: [] });
  clearParseCache();
  useSettings.setState({ language: 'vi' });
});

describe('library + parser thật', () => {
  it('mọi seed parse không lỗi', () => {
    for (const seed of SEED_SONGS) {
      const entry = getSong(seed.id);
      expect(entry, seed.id).not.toBeNull();
      const errors = entry!.parsed.diagnostics.filter((d) => d.severity === 'error');
      expect(errors, seed.id).toEqual([]);
      expect(entry!.parsed.ok, seed.id).toBe(true);
      expect(entry!.parsed.song.id).toBe(seed.id);
      expect(quickSongStats(entry!.parsed.song).noteCount).toBeGreaterThan(0);
    }
    expect(listSongs().map(entryTitle)).toEqual([
      'Quốc ca Việt Nam',
      'TAKEDISKRUSH!',
      '寂寞的人伤心的歌 (Bài Ca Đau Khổ Của Kẻ Cô Đơn)',
      'Sao Mình Chưa Nắm Tay Nhau',
    ]);
    expect(getSong('seed-quoc-ca-viet-nam')!.parsed.song.artist).toBe('Văn Cao');
    expect(getSong('seed-quoc-ca-viet-nam')!.parsed.song.bpm).toBe(80);
    expect(getSong('seed-takediskrush')!.parsed.song.artist).toBe('N2UtheHartlocker');
    expect(getSong('seed-takediskrush')!.parsed.song.bpm).toBe(122);
    expect(getSong('seed-ji-mo-de-ren')!.parsed.song.artist).toBe('龙梅子、杨海彪');
    expect(getSong('seed-ji-mo-de-ren')!.parsed.song.bpm).toBe(125);
  });

  it('nhân bản giữ nội dung, chỉ đổi title', () => {
    for (const seed of SEED_SONGS) {
      const original = getSong(seed.id)!.parsed.song;
      const id = useLibrary.getState().duplicateSong(seed.id);
      const copy = getSong(id)!;
      expect(copy.seed).toBe(false);
      expect(copy.parsed.ok).toBe(true);
      expect(copy.parsed.song.title).toBe(`${original.title} (bản sao)`);
      expect({ ...withoutId(copy.parsed.song), title: original.title }).toEqual(
        withoutId(original),
      );
    }
  });

  it('export .json → import → cùng nguồn và cùng model', () => {
    for (const seed of SEED_SONGS) {
      const entry = getSong(seed.id)!;
      const file = exportJson(entry);
      const imported = parseImportFile(file.filename, file.text);
      expect(imported.errors).toEqual([]);
      expect(imported.sources).toEqual([seed.source.replace(/\r\n?/g, '\n')]);

      const [id] = useLibrary.getState().importSongs(imported.sources);
      const back = getSong(id!)!;
      expect(back.parsed.ok).toBe(true);
      expect(withoutId(back.parsed.song)).toEqual(withoutId(entry.parsed.song));
    }
  });

  it('import JSON chỉ có model ({ song }) → serialize → parse ra model giống hệt', () => {
    for (const seed of SEED_SONGS) {
      const entry = getSong(seed.id)!;
      const text = JSON.stringify({ song: entry.parsed.song });
      const imported = parseImportFile('model.json', text);
      expect(imported.errors).toEqual([]);
      expect(imported.sources).toHaveLength(1);
      const reparsed = parseHarm(imported.sources[0]!);
      expect(reparsed.ok).toBe(true);
      expect(withoutId(reparsed.song)).toEqual(withoutId(entry.parsed.song));
    }
  });

  it('JSON chỉ có model: luyến lệch độ dài được chia đều, giữ tổng beat (không mất beat âm thầm)', () => {
    const slur = (beats: [number, number]) => ({
      kind: 'slur',
      notes: [
        { key: 'Z', beats: beats[0] },
        { key: 'X', beats: beats[1] },
      ],
    });
    const json = JSON.stringify({
      title: 'Luyến',
      sections: [{ name: 'A', lines: [{ units: [slur([1, 3]), { key: 'C', beats: 1 }] }] }],
    });
    const imported = parseImportFile('m.json', json);
    expect(imported.errors).toEqual([]);
    const back = parseHarm(imported.sources[0]!);
    expect(back.ok).toBe(true);
    expect(quickSongStats(back.song).totalBeats).toBe(5);
    expect(back.song.sections[0]!.lines[0]!.units[0]).toMatchObject({
      kind: 'slur',
      notes: [{ beats: 2 }, { beats: 2 }],
    });
  });

  it('JSON chỉ có model kiểu cũ có key lyric (": ", # @ //): lời bị bỏ, nốt nhập đúng', () => {
    const lyrics = ['Anh nói: em ơi', '#1 fan cứng', '// chú thích', '@em ơi'];
    const song = {
      title: 'Lời lạ',
      sections: [
        {
          name: 'A',
          lines: [
            ...lyrics.map((lyric) => ({ lyric, units: [{ key: 'Z' }, { key: 'X' }] })),
            // luyến 1 nốt = nốt
            { units: [{ kind: 'slur', notes: [{ key: 'C', beats: 2 }] }] },
          ],
        },
      ],
    };
    const imported = parseImportFile('m.json', JSON.stringify(song));
    expect(imported.errors).toEqual([]);
    const back = parseHarm(imported.sources[0]!);
    expect(back.ok).toBe(true);
    expect(back.diagnostics.filter((d) => d.severity !== 'info')).toEqual([]);
    const lines = back.song.sections[0]!.lines;
    // lời bị bỏ hẳn (tính năng lời đã bỏ); văn bản lưu chỉ có token
    expect(lines.every((l) => !('lyric' in l))).toBe(true);
    expect(lines.map((l) => l.units.length)).toEqual([2, 2, 2, 2, 1]);
    for (const lyric of lyrics) expect(imported.sources[0]).not.toContain(lyric);
    expect(lines[4]!.units).toEqual([
      { kind: 'note', key: 'C', octave: 0, sharp: false, beats: 2 },
    ]);
  });

  it('nhân bản bài có 2 dòng @title: bản sao đổi đúng title parser dùng (dòng cuối)', () => {
    const id = useLibrary
      .getState()
      .addSong('@title Bài A\n@artist X\n# S\nZ\n@title Bài A (sửa)\n');
    expect(getSong(id)!.parsed.song.title).toBe('Bài A (sửa)');
    const copyId = useLibrary.getState().duplicateSong(id);
    expect(getSong(copyId)!.parsed.song.title).toBe('Bài A (sửa) (bản sao)');
    expect(entryTitle(getSong(copyId)!)).toBe('Bài A (sửa) (bản sao)');
  });

  it('thẻ thư viện và đồng hồ Player hiện cùng độ dài bài', () => {
    // 61 nốt × 1 beat ở 120 BPM = 30.5 s.
    const id = useLibrary.getState().addSong(`@bpm 120\n${'Z '.repeat(61)}\n`);
    for (const songId of [id, ...SEED_SONGS.map((s) => s.id)]) {
      const { song } = getSong(songId)!.parsed;
      const stats = quickSongStats(song);
      const playerTotal = formatClock(stats.totalBeats * (60 / song.bpm));
      expect(formatDuration(stats.durationSec), songId).toBe(playerTotal);
    }
    expect(formatDuration(quickSongStats(getSong(id)!.parsed.song).durationSec)).toBe('0:30');
  });

  it('export .harm → import → nguyên văn', () => {
    const entry = getSong('seed-quoc-ca-viet-nam')!;
    const file = exportHarm(entry);
    expect(file.filename).toBe('quoc-ca-viet-nam.harm');
    expect(parseImportFile(file.filename, file.text).sources).toEqual([
      entry.source.replace(/\r\n?/g, '\n'),
    ]);
  });
});

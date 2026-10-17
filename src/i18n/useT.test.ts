import { describe, expect, it } from 'vitest';
import { useSettings } from '../ui/settings';
import { STRINGS } from './strings';
import type { StringKey } from './strings';
import { tNow, translateCount } from './useT';

describe('translateCount (số ít / số nhiều)', () => {
  it('EN: n = 1 dùng key `_one`, còn lại dùng key gốc', () => {
    expect(translateCount('en', 'library.imported', { n: 1 })).toBe('Imported 1 song');
    expect(translateCount('en', 'library.imported', { n: 2 })).toBe('Imported 2 songs');
    expect(translateCount('en', 'library.imported', { n: 0 })).toBe('Imported 0 songs');
    expect(translateCount('en', 'library.badgeErrorCount', { n: 1 })).toBe('1 error');
    expect(translateCount('en', 'library.count', { n: 1 })).toBe('1 song');
    expect(translateCount('en', 'common.beats', { n: 1 })).toBe('1 beat');
    expect(translateCount('en', 'library.importMoreErrors', { n: 1 })).toBe('…and 1 more error');
    expect(translateCount('en', 'library.importedWithErrors', { n: 1 })).toMatch(
      /^1 imported song has syntax errors/,
    );
  });

  it('VI: không chia số — `_one` giống câu gốc', () => {
    expect(translateCount('vi', 'library.imported', { n: 1 })).toBe('Đã nhập 1 bài');
    expect(translateCount('vi', 'library.imported', { n: 3 })).toBe('Đã nhập 3 bài');
  });

  it('key không có `_one` hoặc không có n → như translate thường', () => {
    expect(translateCount('en', 'common.bpm', { n: 1 })).toBe('1 BPM');
    expect(translateCount('en', 'library.imported')).toBe('Imported {n} songs');
    expect(translateCount('en', 'library.imported', { title: 'x' })).toBe('Imported {n} songs');
  });

  it('n là chuỗi "1" (số đã định dạng, vd. formatBeats) cũng là số ít', () => {
    expect(translateCount('en', 'common.beats', { n: '1' })).toBe('1 beat');
    expect(translateCount('en', 'common.beats', { n: '1.5' })).toBe('1.5 beats');
    expect(translateCount('en', 'library.imported', { n: '1' })).toBe('Imported 1 song');
  });

  it('`{x:một|nhiều}` chọn theo tham số đếm x (D-143)', () => {
    expect(
      translateCount('en', 'midi.file.loaded', { file: 'a.mid', tracks: 1, bpm: 100, time: '4/4' }),
    ).toBe('a.mid: 1 track with notes · 100 BPM · 4/4 time');
    expect(
      translateCount('en', 'midi.file.loaded', { file: 'a.mid', tracks: 3, bpm: 100, time: '4/4' }),
    ).toBe('a.mid: 3 tracks with notes · 100 BPM · 4/4 time');
    expect(translateCount('en', 'editor.diagSummary', { errors: 1, warnings: 0, infos: 2 })).toBe(
      '1 error · 0 warnings · 2 notes',
    );
    expect(translateCount('en', 'midi.arrange.summary', { sections: 1, lines: 1, notes: 8 })).toBe(
      '1 section · 1 line · 8 notes',
    );
    expect(translateCount('en', 'editor.statBeatsValue', { beats: '1', time: '0:00' })).toBe(
      '1 beat (0:00)',
    );
    expect(
      translateCount('en', 'editor.tools.reopt.current', {
        scroll: 1,
        holds: 2,
        modified: 1,
        cost: 5,
      }),
    ).toBe('Current song: 1 scroll note · 2 holds · 1 note with a modifier · cost 5');
    expect(translateCount('en', 'share.diagSummary', { errors: 1, warnings: 3 })).toBe(
      '1 error · 3 warnings',
    );
    expect(translateCount('en', 'library.countFiltered', { n: 0, total: 1 })).toBe('0/1 song');
    // Tiếng Việt không chia số.
    expect(
      translateCount('vi', 'midi.file.loaded', { file: 'a.mid', tracks: 1, bpm: 90, time: '3/4' }),
    ).toBe('a.mid: 1 track có nốt · 90 BPM · nhịp 3/4');
  });

  it('thiếu tham số → giữ nguyên placeholder; giá trị chèn vào không bị hiểu thành placeholder', () => {
    expect(translateCount('en', 'share.diagSummary', { errors: 1 })).toBe(
      '1 error · {warnings} {warnings:warning|warnings}',
    );
    expect(
      translateCount('en', 'midi.file.loaded', {
        file: '{tracks:x|y}',
        tracks: 2,
        bpm: 1,
        time: '{bpm}',
      }),
    ).toBe('{tracks:x|y}: 2 tracks with notes · 1 BPM · {bpm} time');
  });

  it('EN: mọi số đếm + danh từ số nhiều đều có dạng số ít (`_one` theo n, hoặc `{x:một|nhiều}`)', () => {
    // Tham số không bao giờ bằng 1: giới hạn / độ dài cố định, tầm slider bắt đầu từ 4…
    const neverOne = new Set([
      'diag.repeat-limit:limit',
      'player.lookaheadValue:n',
      'editor.shareCopied:n',
      'editor.shareLong:n',
      'editor.donateLimitHint:max',
      'editor.donateSummary:chars',
      'editor.donateChars:limit',
      'midi.preview.playAria:sec',
      // `_one` chọn theo n = |num| (OptimizerPanel).
      'editor.optimizer.semitones:num',
    ]);
    const notNoun = new Set(['ms', 'has', 'is', 'was', 'uses', 'opens']);
    const missing: string[] = [];
    for (const [key, text] of Object.entries(STRINGS.en)) {
      if (key.endsWith('_one')) continue;
      for (const [, param = '', word = ''] of text.matchAll(/\{(\w+)\} (?:[a-z]+ )?([a-z]+s)\b/g)) {
        if (notNoun.has(word) || neverOne.has(`${key}:${param}`)) continue;
        if (param === 'n' && `${key}_one` in STRINGS.en) continue;
        missing.push(`${key}: {${param}} … ${word}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('mọi key `_one` có key gốc và cùng bộ tham số', () => {
    const keys = Object.keys(STRINGS.vi) as StringKey[];
    const params = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join(',');
    for (const key of keys.filter((k) => k.endsWith('_one'))) {
      const base = key.slice(0, -'_one'.length) as StringKey;
      expect(keys, key).toContain(base);
      for (const lang of ['vi', 'en'] as const) {
        expect(params(STRINGS[lang][key]), `${lang} ${key}`).toBe(params(STRINGS[lang][base]));
      }
    }
  });

  it('tNow dùng ngôn ngữ trong settings', () => {
    useSettings.setState({ language: 'en' });
    expect(tNow('library.imported', { n: 1 })).toBe('Imported 1 song');
    useSettings.setState({ language: 'vi' });
    expect(tNow('library.imported', { n: 1 })).toBe('Đã nhập 1 bài');
  });
});

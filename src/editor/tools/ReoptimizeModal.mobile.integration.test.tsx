/**
 * Tối ưu tông — kiểu Mobile, với core THẬT của agent khác: buildMobilePlan (src/core/mobile.ts) đếm
 * lần chạm của "Bài hiện tại", optimizer scheme 'mobile' (src/core/optimizer.ts) chọn phương án.
 * Hai bên phải cùng cost model: bài sinh từ phương án tốt nhất có "độ khó hiện tại" = cost của nó.
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { melodyPitches } from '../../core/melody';
import { melodyToHarm, songToMelody } from '../../core/melodyBuild';
import { optimizeTranspose } from '../../core/optimizer';
import { parseHarm } from '../../core/parser';
import seed1 from '../../test/fixtures/bai-thu-nhip-dieu.harm?raw';
import seed2 from '../../test/fixtures/bai-thu-lap-doan.harm?raw';
import { useSettings } from '../../ui/settings';
import type { MobileSemitone } from '../../ui/settings';
import { ReoptimizeModal, currentSongStats } from './ReoptimizeModal';

beforeEach(() => {
  act(() => useSettings.getState().reset());
});

// Cúi Xuống cả câu, nghỉ, rồi Ngẩng Tự Nhiên + một nốt Nửa Cung
const SOURCE = [
  '@title Thử',
  '# A',
  'một hai ba: [giữ chuột trái] Z X C [thả chuột trái] _ V S:B N',
  '',
].join('\n');

function setup(source = SOURCE) {
  const onApply = vi.fn();
  render(
    <ReoptimizeModal
      open
      onClose={() => {}}
      source={source}
      parsed={parseHarm(source, { id: 'u1' })}
      songId="u1"
      onApply={onApply}
    />,
  );
  return { onApply };
}

describe('currentSongStats', () => {
  it('PC: lần giữ + nốt có modifier (như trước)', () => {
    const song = parseHarm(SOURCE).song;
    const st = currentSongStats(song, { baseOctave: 4, scheme: 'pc', mobileSemitone: 'toggle' });
    // runs: trái (Z X C), scroll (B) → 2; nốt có modifier: 4
    expect(st).toEqual({ scheme: 'pc', scroll: 1, holds: 2, modified: 4, cost: 10 + 8 + 4 });
  });

  it('Mobile: chạm đổi quãng / Nửa Cung giữ trạng thái qua chỗ nghỉ', () => {
    const song = parseHarm(SOURCE).song;
    const toggle = currentSongStats(song, {
      baseOctave: 4,
      scheme: 'mobile',
      mobileSemitone: 'toggle',
    });
    // Cúi Xuống trước Z, Ngẩng Tự Nhiên trước V; Nửa Cung bật trước B, tắt trước N
    expect(toggle).toEqual({
      scheme: 'mobile',
      scroll: 1,
      octaveTaps: 2,
      semitoneTaps: 2,
      cost: 10 + 4 * 4,
    });
    const oneShot = currentSongStats(song, {
      baseOctave: 4,
      scheme: 'mobile',
      mobileSemitone: 'oneShot',
    });
    expect(oneShot).toMatchObject({ octaveTaps: 2, semitoneTaps: 1, cost: 10 + 4 * 3 });
  });

  it.each<[string, string, MobileSemitone]>([
    ['seed 1', seed1, 'toggle'],
    ['seed 2', seed2, 'toggle'],
    ['seed 2', seed2, 'oneShot'],
  ])(
    '%s (%s): bài sinh từ phương án Mobile tốt nhất có độ khó hiện tại = cost của phương án',
    (_name, source, semitone) => {
      const song = parseHarm(source).song;
      const melody = songToMelody(song, { baseOctave: 4, scrollDir: song.scrollDir });
      const best = optimizeTranspose(melodyPitches(melody), {
        baseOctave: 4,
        scrollDir: song.scrollDir,
        scheme: 'mobile',
        mobileSemitone: semitone,
        top: 1,
      })[0];
      expect(best).toBeTruthy();
      if (!best) return;
      const harm = melodyToHarm(melody, best, { baseOctave: 4, scrollDir: song.scrollDir });
      const st = currentSongStats(parseHarm(harm).song, {
        baseOctave: 4,
        scheme: 'mobile',
        mobileSemitone: semitone,
      });
      expect(st).toEqual({
        scheme: 'mobile',
        scroll: best.stats.scrollNotes,
        octaveTaps: best.stats.octaveTaps,
        semitoneTaps: best.stats.semitoneTaps,
        cost: best.cost,
      });
    },
  );
});

describe('ReoptimizeModal — Mobile', () => {
  it('"Bài hiện tại" và bảng phương án theo cost Mobile; áp dụng ghi bài mới', () => {
    act(() => useSettings.getState().set({ controlScheme: 'mobile' }));
    const { onApply } = setup();
    expect(
      screen.getByText(
        'Bài hiện tại (Mobile): 1 nốt Nửa Cung · 2 lần chạm đổi chế độ · 2 lần chạm Nửa Cung · độ khó 26',
      ),
    ).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: 'Chạm đổi chế độ' })).toBeTruthy();
    expect(screen.queryByRole('columnheader', { name: 'Lần giữ' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Tiếp tục' }));
    fireEvent.click(screen.getByRole('button', { name: 'Thay văn bản' }));
    expect(onApply).toHaveBeenCalledTimes(1);
    const next = String(onApply.mock.calls[0]?.[0]);
    expect(parseHarm(next).ok).toBe(true);
  });

  it('tên gọi tùy chỉnh và tiếng Anh', () => {
    act(() =>
      useSettings.getState().set({
        language: 'en',
        controlScheme: 'mobile',
        mobileSemitone: 'oneShot',
        labelOverrides: { left: '', right: '', natural: '', scroll: 'Half' },
      }),
    );
    setup();
    expect(
      screen.getByText('Current song (Mobile): 1 Half note · 2 mode taps · 1 Half tap · cost 22'),
    ).toBeTruthy();
  });
});

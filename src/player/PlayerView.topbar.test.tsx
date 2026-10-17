/**
 * "Thu gọn thanh trên" của màn chơi (góp ý 2026-10-17): nút ở header ẩn header + thanh điều khiển, cụm nhỏ ở
 * góc khu tiles (Phát / Tạm dừng + mở lại), nhớ theo máy, focus chuyển sang nút kia.
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useLibrary } from '../library/store';
import { useSettings } from '../ui/settings';
import { PlayerView } from './PlayerView';
import { TOP_COLLAPSED_STORAGE_KEY, resetTopCollapsedForTest } from './topBarPref';
import FIXTURE_SONG from '../test/fixtures/bai-thu-nhip-dieu.harm?raw';

vi.mock('../audio/engine', () => ({
  isAudioSupported: () => false,
  getAudioEngine: () => {
    throw new Error('audio engine must not be used when unsupported');
  },
  UNLOCK_TIMEOUT_MS: 1000,
}));

const SEED = useLibrary.getState().addSong(FIXTURE_SONG);

beforeEach(() => {
  vi.stubGlobal(
    'requestAnimationFrame',
    vi.fn(() => 1),
  );
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => null);
  useSettings.getState().reset();
  useSettings.getState().set({ startDelaySec: 0 });
  localStorage.removeItem(TOP_COLLAPSED_STORAGE_KEY);
  resetTopCollapsedForTest();
  window.location.hash = `#/play/${SEED}`;
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.location.hash = '';
});

const player = () => document.querySelector('.player');

describe('PlayerView — thu gọn thanh trên', () => {
  it('thu gọn → ẩn header + thanh điều khiển, cụm góc khu tiles phát được, mở lại; nhớ theo máy', () => {
    const { unmount } = render(<PlayerView songId={SEED} />);
    const collapse = screen.getByRole('button', { name: 'Thu gọn thanh trên' });
    expect(collapse.getAttribute('aria-expanded')).toBe('true');
    expect(player()?.classList.contains('is-top-collapsed')).toBe(false);

    act(() => {
      fireEvent.click(collapse);
    });
    expect(player()?.classList.contains('is-top-collapsed')).toBe(true);
    expect(localStorage.getItem(TOP_COLLAPSED_STORAGE_KEY)).toBe('1');
    const expand = screen.getByRole('button', { name: 'Hiện thanh trên' });
    expect(document.activeElement).toBe(expand);
    // Tên bài vẫn là tiêu đề trang (sr-only) khi header ẩn.
    expect(document.querySelector('h1.sr-only')?.textContent).toBe('Bài thử nhịp điệu');

    const mini = document.querySelector('.player-top-mini');
    const play = mini?.querySelector<HTMLButtonElement>('button[aria-label="Phát"]');
    expect(play).toBeTruthy();
    act(() => {
      play?.click();
    });
    expect(mini?.querySelector('button[aria-label="Tạm dừng"]')).toBeTruthy();

    // Mở lại trang → vẫn thu gọn.
    unmount();
    render(<PlayerView songId={SEED} />);
    expect(player()?.classList.contains('is-top-collapsed')).toBe(true);
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Hiện thanh trên' }));
    });
    expect(player()?.classList.contains('is-top-collapsed')).toBe(false);
    expect(document.querySelector('.player-top-mini')).toBeNull();
    expect(localStorage.getItem(TOP_COLLAPSED_STORAGE_KEY)).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Thu gọn thanh trên' }));
  });
});

/**
 * Màn chơi của bài chưa nằm trong Thư viện (vòng sửa R5 sau góp ý 2026-10-15): bản nháp và bài tạm từ link
 * chia sẻ phải có lối giữ bài lại (màn chơi không còn nút "Sửa"); bản nháp đã Lưu thì `#/play/draft-…`
 * chuyển sang bài đã lưu (không mở lại nội dung cũ).
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearTransientSongs,
  openDraftSong,
  openTransientSong,
  resetSavedShares,
  saveDraftSong,
  useLibrary,
} from '../library/store';
import { useSettings } from '../ui/settings';
import { PlayerView } from './PlayerView';

vi.mock('../audio/engine', () => ({
  isAudioSupported: () => false,
  getAudioEngine: () => {
    throw new Error('audio engine must not be used when unsupported');
  },
  UNLOCK_TIMEOUT_MS: 1000,
}));

beforeEach(() => {
  vi.stubGlobal(
    'requestAnimationFrame',
    vi.fn(() => 1),
  );
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => null);
  useSettings.getState().reset();
  useLibrary.setState({ songs: [] });
  clearTransientSongs();
  resetSavedShares();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  useLibrary.setState({ songs: [] });
  clearTransientSongs();
  window.location.hash = '';
});

describe('PlayerView — songs not in the Library', () => {
  it('draft: "Bản nháp — chưa lưu" chip + link back to its editor (no "Sửa" button)', () => {
    const id = openDraftSong('@title Nháp\nZ X C\n');
    window.location.hash = `#/play/${id}`;
    render(<PlayerView songId={id} />);
    expect(document.querySelector('.player-chip-transient')?.textContent).toContain(
      'Bản nháp — chưa lưu',
    );
    const link = screen.getByRole('link', { name: 'Mở trình soạn để lưu' });
    expect(link.getAttribute('href')).toBe(`#/edit/${id}`);
    expect(screen.queryByRole('link', { name: /^Sửa/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Lưu vào thư viện' })).toBeNull();
  });

  it('shared link song: "Lưu vào thư viện" saves once and moves the Player to the saved song', () => {
    const source = '@title Từ link\nZ X C\n';
    const id = openTransientSong(source);
    window.location.hash = `#/play/${id}`;
    render(<PlayerView songId={id} />);
    expect(document.querySelector('.player-chip-transient')?.textContent).toContain(
      'Bài tạm từ link — chưa lưu',
    );
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Lưu vào thư viện' }));
    });
    const songs = useLibrary.getState().songs;
    expect(songs).toHaveLength(1);
    expect(songs[0]?.source).toBe(source);
    expect(window.location.hash).toBe(`#/play/${songs[0]?.id ?? ''}`);
  });

  it('a song already saved from that link is reused (no duplicate)', () => {
    const source = '@title Đã có\nZ X C\n';
    const existing = useLibrary.getState().addSong(source);
    // Bài tạm cùng nội dung (vd. mở link khi thư viện chưa có, lưu ở tab khác)
    const id = openTransientSong(source);
    render(<PlayerView songId={id} />);
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Lưu vào thư viện' }));
    });
    expect(useLibrary.getState().songs).toHaveLength(1);
    expect(window.location.hash).toBe(`#/play/${existing}`);
  });

  it('library songs and seeds show no transient notice', () => {
    const id = useLibrary.getState().addSong('@title Của tôi\nZ X C\n');
    const { unmount } = render(<PlayerView songId={id} />);
    expect(document.querySelector('.player-transient')).toBeNull();
    unmount();
    render(<PlayerView songId="seed-takediskrush" />);
    expect(document.querySelector('.player-transient')).toBeNull();
  });

  it('a draft that was saved since → `#/play/draft-…` redirects to the saved song (keeps ?line=)', () => {
    const id = openDraftSong('@title Cũ\nZ X C\n');
    const saved = saveDraftSong(id, '@title Đã sửa\nZ X C V\n');
    window.location.hash = `#/play/${id}?line=0`;
    const { container } = render(<PlayerView songId={id} />);
    // không vẽ nội dung cũ của bản nháp
    expect(container.querySelector('.player')).toBeNull();
    expect(window.location.hash).toBe(`#/play/${saved}?line=0`);
  });
});

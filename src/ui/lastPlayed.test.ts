import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearTransientSongs, openDraftSong, saveDraftSong, useLibrary } from '../library/store';
import {
  LAST_PLAYED_KEY,
  backToPlayerTarget,
  readLastPlayed,
  rememberLastPlayed,
  resolvePlayedId,
  useBackToPlayer,
} from './lastPlayed';

const SEED = 'seed-quoc-ca-viet-nam';
const OTHER_SEED = 'seed-takediskrush';

beforeEach(() => {
  rememberLastPlayed(null);
  window.sessionStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  useLibrary.setState({ songs: [] });
});

describe('backToPlayerTarget', () => {
  const exists = (id: string) => id !== 'da-xoa';

  it('chưa mở bài nào → `#/` với bài mẫu', () => {
    expect(backToPlayerTarget(null, exists)).toEqual({ path: '/', songId: SEED });
  });

  it('bài còn tồn tại → `/play/<id>` (id được encode)', () => {
    expect(backToPlayerTarget(OTHER_SEED, exists)).toEqual({
      path: `/play/${OTHER_SEED}`,
      songId: OTHER_SEED,
    });
    expect(backToPlayerTarget('a b', exists).path).toBe('/play/a%20b');
  });

  it('bài đã bị xóa → `#/`', () => {
    expect(backToPlayerTarget('da-xoa', exists)).toEqual({ path: '/', songId: SEED });
  });
});

describe('rememberLastPlayed / readLastPlayed', () => {
  it('lưu ở sessionStorage; null = màn mặc định', () => {
    rememberLastPlayed('x1');
    expect(window.sessionStorage.getItem(LAST_PLAYED_KEY)).toBe('x1');
    expect(readLastPlayed()).toBe('x1');
    rememberLastPlayed(null);
    expect(window.sessionStorage.getItem(LAST_PLAYED_KEY)).toBeNull();
    expect(readLastPlayed()).toBeNull();
  });

  it('sessionStorage bị chặn → vẫn nhớ trong bộ nhớ, không ném lỗi', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    expect(() => rememberLastPlayed('y2')).not.toThrow();
    expect(readLastPlayed()).toBe('y2');
  });
});

describe('useBackToPlayer', () => {
  it('đích + tên bài; theo dõi bài nhớ và thư viện (xóa bài → về `#/`)', () => {
    const { result } = renderHook(() => useBackToPlayer());
    expect(result.current).toEqual({ path: '/', songId: SEED, title: 'Quốc ca Việt Nam' });

    let id = '';
    act(() => {
      id = useLibrary.getState().addSong('@title Bài của tôi\nZ X C');
      rememberLastPlayed(id);
    });
    expect(result.current).toEqual({ path: `/play/${id}`, songId: id, title: 'Bài của tôi' });

    act(() => useLibrary.getState().updateSong(id, '@title Tên mới\nZ X C'));
    expect(result.current.title).toBe('Tên mới');

    act(() => useLibrary.getState().removeSong(id));
    expect(result.current).toEqual({ path: '/', songId: SEED, title: 'Quốc ca Việt Nam' });
  });
});

describe('useBackToPlayer — drafts (R5 fix)', () => {
  afterEach(() => clearTransientSongs());

  it('played draft → still a draft: back to that draft', () => {
    const draft = openDraftSong('@title Nháp\nZ X C');
    act(() => rememberLastPlayed(draft));
    const { result } = renderHook(() => useBackToPlayer());
    expect(result.current).toEqual({ path: `/play/${draft}`, songId: draft, title: 'Nháp' });
  });

  it('played draft that was then saved → the saved library song, not the stale draft', () => {
    const draft = openDraftSong('@title Bài mới\nZ X C');
    act(() => rememberLastPlayed(draft));
    const { result } = renderHook(() => useBackToPlayer());
    let saved = '';
    act(() => {
      saved = saveDraftSong(draft, '@title Bai Da Sua\nZ X C V');
    });
    expect(resolvePlayedId(draft)).toBe(saved);
    expect(result.current).toEqual({ path: `/play/${saved}`, songId: saved, title: 'Bai Da Sua' });
  });
});

import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useSettings } from '../ui/settings';
import {
  LIBRARY_STORAGE_KEY,
  TRANSIENT_ID_PREFIX,
  clearParseCache,
  clearTransientSongs,
  entryTitle,
  getSong,
  isTransientSong,
  listSongs,
  openTransientSong,
  useLibrary,
  useSong,
} from './store';

const SRC = '@title Bài chia sẻ\n@bpm 100\nZ X C V';

beforeEach(() => {
  useLibrary.setState({ songs: [] });
  clearTransientSongs();
  localStorage.clear();
  clearParseCache();
  useSettings.setState({ language: 'vi' });
});

describe('openTransientSong (bài tạm từ link chia sẻ)', () => {
  it('trả id shared-<hash>, cùng nội dung → cùng id', () => {
    const id = openTransientSong(SRC);
    expect(id.startsWith(TRANSIENT_ID_PREFIX)).toBe(true);
    expect(id).toMatch(/^shared-[0-9a-z]+$/);
    expect(openTransientSong(SRC)).toBe(id);
    expect(openTransientSong(`${SRC}\nB`)).not.toBe(id);
    expect(Object.keys(useLibrary.getState().transient)).toHaveLength(2);
  });

  it('getSong / useSong thấy được, parse như bài thường', () => {
    const id = openTransientSong(SRC);
    const e = getSong(id);
    expect(e).not.toBeNull();
    expect(e?.seed).toBe(false);
    expect(e?.source).toBe(SRC);
    expect(e && entryTitle(e)).toBe('Bài chia sẻ');
    expect(e?.parsed.song.bpm).toBe(100);
    const { result } = renderHook(() => useSong(id));
    expect(result.current?.id).toBe(id);
    expect(isTransientSong(id)).toBe(true);
  });

  it('không có trong listSongs và không ghi localStorage', () => {
    const userId = useLibrary.getState().addSong('@title Của tôi\nZ');
    const id = openTransientSong(SRC);
    expect(listSongs().map((e) => e.id)).not.toContain(id);
    expect(listSongs().map((e) => e.id)).toContain(userId);
    const raw = localStorage.getItem(LIBRARY_STORAGE_KEY) ?? '';
    expect(raw).toContain('Của tôi');
    expect(raw).not.toContain('Bài chia sẻ');
    expect(raw).not.toContain(id);
    const parsed = JSON.parse(raw) as { state: Record<string, unknown> };
    expect(Object.keys(parsed.state)).toEqual(['songs']);
  });

  it('rehydrate từ localStorage không xóa bài tạm đang mở', async () => {
    const id = openTransientSong(SRC);
    useLibrary.getState().addSong('@title Khác\nZ');
    await useLibrary.persist.rehydrate();
    expect(getSong(id)?.source).toBe(SRC);
  });

  it('bài tạm chỉ đọc với các action thư viện; nhân bản thì thành bài user', () => {
    const id = openTransientSong(SRC);
    expect(useLibrary.getState().updateSong(id, 'Z')).toBe(false);
    expect(useLibrary.getState().removeSong(id)).toBe(false);
    const copy = useLibrary.getState().duplicateSong(id);
    expect(copy).not.toBe('');
    expect(getSong(copy)?.source).toContain('Bài chia sẻ (bản sao)');
    expect(isTransientSong(copy)).toBe(false);
  });

  it('trùng hash nhưng khác nội dung → thêm hậu tố', () => {
    const id = openTransientSong(SRC);
    clearTransientSongs();
    useLibrary.setState({
      transient: { [id]: { id, source: 'nội dung khác', createdAt: 1, updatedAt: 1 } },
    });
    expect(openTransientSong(SRC)).toBe(`${id}-2`);
    expect(getSong(`${id}-2`)?.source).toBe(SRC);
    expect(getSong(id)?.source).toBe('nội dung khác');
  });

  it('id lạ / prototype không trúng', () => {
    expect(getSong('shared-khongco')).toBeNull();
    expect(getSong('__proto__')).toBeNull();
    expect(getSong('toString')).toBeNull();
    expect(isTransientSong('__proto__')).toBe(false);
    expect(isTransientSong('seed-quoc-ca-viet-nam')).toBe(false);
  });
});

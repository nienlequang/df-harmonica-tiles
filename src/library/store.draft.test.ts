import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { createNewSong, newSongSource } from '../home/newSong';
import { useSettings } from '../ui/settings';
import { getDirective } from './songSource';
import {
  DRAFT_ID_PREFIX,
  LIBRARY_STORAGE_KEY,
  clearParseCache,
  clearTransientSongs,
  draftSavedAs,
  getSong,
  isDraftSong,
  isTransientSong,
  listSongs,
  openDraftSong,
  openTransientSong,
  saveDraftSong,
  useLibrary,
  useSong,
} from './store';

const SRC = '@title Bản nháp\n@bpm 100\nZ X C V';

beforeEach(() => {
  useLibrary.setState({ songs: [] });
  clearTransientSongs();
  localStorage.clear();
  clearParseCache();
  useSettings.setState({ language: 'vi' });
});

describe('openDraftSong (bài vừa tạo, chưa lưu — góp ý 2026-10-15 C)', () => {
  it('mỗi lần mở một id draft-… mới, kể cả cùng nội dung', () => {
    const a = openDraftSong(SRC);
    const b = openDraftSong(SRC);
    expect(a.startsWith(DRAFT_ID_PREFIX)).toBe(true);
    expect(b.startsWith(DRAFT_ID_PREFIX)).toBe(true);
    expect(a).not.toBe(b);
  });

  it('getSong / useSong thấy được; không có trong Thư viện; không ghi localStorage', () => {
    const userId = useLibrary.getState().addSong('@title Của tôi\nZ');
    const id = openDraftSong(SRC);
    expect(getSong(id)?.source).toBe(SRC);
    expect(getSong(id)?.seed).toBe(false);
    const { result } = renderHook(() => useSong(id));
    expect(result.current?.id).toBe(id);
    expect(listSongs().map((e) => e.id)).not.toContain(id);
    expect(useLibrary.getState().songs.map((s) => s.id)).toEqual([userId]);
    const raw = localStorage.getItem(LIBRARY_STORAGE_KEY) ?? '';
    expect(raw).toContain('Của tôi');
    expect(raw).not.toContain('Bản nháp');
    expect(raw).not.toContain(id);
  });

  it('isDraftSong chỉ đúng với bản nháp đang mở (không phải bài tạm chia sẻ / bài mẫu / bài user)', () => {
    const id = openDraftSong(SRC);
    expect(isDraftSong(id)).toBe(true);
    expect(isTransientSong(id)).toBe(true);
    expect(isDraftSong(openTransientSong(SRC))).toBe(false);
    expect(isDraftSong('seed-quoc-ca-viet-nam')).toBe(false);
    expect(isDraftSong(useLibrary.getState().addSong(SRC))).toBe(false);
    expect(isDraftSong(`${DRAFT_ID_PREFIX}không-có`)).toBe(false);
    clearTransientSongs();
    expect(isDraftSong(id)).toBe(false);
    expect(getSong(id)).toBeNull();
  });
});

describe('saveDraftSong / draftSavedAs', () => {
  it('Lưu lần đầu thêm bài user; Lưu lại cập nhật đúng bài đó (không nhân bản)', () => {
    const draft = openDraftSong(SRC);
    expect(draftSavedAs(draft)).toBeNull();
    const id = saveDraftSong(draft, `${SRC} B`);
    expect(id.startsWith(DRAFT_ID_PREFIX)).toBe(false);
    expect(useLibrary.getState().songs).toHaveLength(1);
    expect(getSong(id)?.source).toBe(`${SRC} B`);
    expect(draftSavedAs(draft)).toBe(id);
    // bản nháp vẫn mở được (Back về #/edit/draft-… sẽ được chuyển sang bài đã lưu)
    expect(getSong(draft)?.source).toBe(SRC);

    expect(saveDraftSong(draft, `${SRC} B N`)).toBe(id);
    expect(useLibrary.getState().songs).toHaveLength(1);
    expect(getSong(id)?.source).toBe(`${SRC} B N`);
  });

  it('bài đã lưu bị xóa → Lưu lại thêm bài mới; draftSavedAs về null', () => {
    const draft = openDraftSong(SRC);
    const first = saveDraftSong(draft, SRC);
    useLibrary.getState().removeSong(first);
    expect(draftSavedAs(draft)).toBeNull();
    const second = saveDraftSong(draft, SRC);
    expect(second).not.toBe(first);
    expect(useLibrary.getState().songs.map((s) => s.id)).toEqual([second]);
  });

  it('clearTransientSongs quên luôn liên kết bản nháp → bài đã lưu', () => {
    const draft = openDraftSong(SRC);
    saveDraftSong(draft, SRC);
    clearTransientSongs();
    expect(draftSavedAs(draft)).toBeNull();
  });
});

describe('createNewSong ("Tạo bài mới thủ công")', () => {
  it('mở template thành bản nháp theo ngôn ngữ, không thêm vào thư viện', () => {
    const id = createNewSong();
    expect(isDraftSong(id)).toBe(true);
    expect(useLibrary.getState().songs).toHaveLength(0);
    const src = getSong(id)?.source ?? '';
    expect(src).toBe(newSongSource());
    expect(getDirective(src, 'title')).toBe('Bài mới');
    expect(src).toContain('@scroll +1');
    expect(src).not.toMatch(/lời|:\s*Z/);

    useSettings.setState({ language: 'en' });
    expect(getDirective(getSong(createNewSong())?.source ?? '', 'title')).toBe('New song');
  });
});

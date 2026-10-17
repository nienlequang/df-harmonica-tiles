/**
 * Editor với BẢN NHÁP (góp ý 2026-10-15 C): bài vừa tạo ("Tạo bài mới thủ công", "Tạo bài từ file",
 * "Tự chơi để tạo bài") mở dạng nháp — sửa được, chưa vào Thư viện; chưa sửa gì thì rời trang không
 * hỏi, không lưu; sửa rồi thì Lưu / Ctrl+S / "Lưu rồi đi" mới thêm vào thư viện.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DRAFT_ID_PREFIX,
  clearParseCache,
  clearTransientSongs,
  draftSavedAs,
  getSong,
  isDraftSong,
  openDraftSong,
  useLibrary,
} from '../library/store';
import type * as Components from '../ui/components';
import { useSettings } from '../ui/settings';
import { useToasts } from '../ui/toast';
import { EditorView } from './EditorView';

vi.mock('../ui/features', () => ({ FEATURES: { editor: true, share: true, midiImport: true } }));
vi.mock('../ui/components', async (importOriginal) => ({
  ...(await importOriginal<typeof Components>()),
  copyText: vi.fn(async () => true),
  downloadText: vi.fn(),
}));

const DRAFT = '@title Bài nháp\n@bpm 100\n\n# A\nZ X C V\n';
const toastTexts = () => useToasts.getState().toasts.map((t) => t.text);
const textarea = () => screen.getByLabelText('Nội dung bài (.harm)') as HTMLTextAreaElement;
const type = (value: string) => fireEvent.change(textarea(), { target: { value } });
const link = <a href="#/settings">Đi tới cài đặt</a>;

function renderEditor(id: string, extra?: React.ReactNode) {
  window.history.replaceState(null, '', `/#/edit/${encodeURIComponent(id)}`);
  return render(
    <>
      {extra}
      <EditorView songId={id} />
    </>,
  );
}

/** Click link mà không để jsdom điều hướng thật; trả về guard có chặn không. */
function clickLink(): boolean | null {
  let prevented: boolean | null = null;
  document.addEventListener(
    'click',
    (e) => {
      prevented = e.defaultPrevented;
      e.preventDefault();
    },
    { once: true },
  );
  fireEvent.click(screen.getByText('Đi tới cài đặt'));
  return prevented;
}

beforeEach(() => {
  useLibrary.setState({ songs: [] });
  clearTransientSongs();
  clearParseCache();
  useToasts.setState({ toasts: [] });
  useSettings.setState({ language: 'vi' });
});

afterEach(async () => {
  await new Promise((r) => setTimeout(r, 0));
  window.history.replaceState(null, '', '/');
});

describe('EditorView — bản nháp', () => {
  it('sửa được (không phải chỉ đọc); dòng trạng thái "Bản nháp — chưa lưu" + ghi chú rõ', () => {
    const id = openDraftSong(DRAFT);
    renderEditor(id);
    expect(textarea().value).toBe(DRAFT);
    expect(screen.getByRole('note').textContent).toBe(
      'Bản nháp — chưa lưu vào Thư viện. Bấm Lưu (Ctrl+S) để giữ bài; rời trang khi chưa sửa gì thì bản nháp bị bỏ, không lưu.',
    );
    expect(screen.queryByText(/chỉ đọc/)).toBeNull();
    expect(screen.getByText('Bản nháp — chưa lưu')).toBeTruthy();
    expect(screen.queryByText('Đã lưu mọi thay đổi')).toBeNull();
    // sửa → "Chưa lưu"
    type(`${DRAFT}B\n`);
    expect(screen.getByText('Chưa lưu')).toBeTruthy();
  });

  it('chưa sửa gì: rời trang không hỏi, không lưu gì vào thư viện', () => {
    renderEditor(openDraftSong(DRAFT), link);
    const ev = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
    expect(clickLink()).toBe(false);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(useLibrary.getState().songs).toHaveLength(0);
  });

  it('đã sửa: rời trang thì hỏi; "Bỏ thay đổi" rời đi mà không lưu', () => {
    const id = openDraftSong(DRAFT);
    renderEditor(id, link);
    type(`${DRAFT}B\n`);
    const ev = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    fireEvent.click(screen.getByText('Đi tới cài đặt'));
    expect(screen.getByRole('dialog', { name: 'Rời trình soạn?' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Bỏ thay đổi' }));
    expect(window.location.hash).toBe('#/settings');
    expect(useLibrary.getState().songs).toHaveLength(0);
    expect(getSong(id)?.source).toBe(DRAFT);
  });

  it('đã sửa: "Lưu rồi đi" thêm vào thư viện rồi điều hướng', async () => {
    const id = openDraftSong(DRAFT);
    renderEditor(id);
    type(`${DRAFT}B\n`);
    act(() => {
      window.location.hash = '#/';
    });
    await waitFor(() =>
      expect(screen.getByRole('dialog', { name: 'Rời trình soạn?' })).toBeTruthy(),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Lưu rồi đi' }));
    const songs = useLibrary.getState().songs;
    expect(songs).toHaveLength(1);
    expect(songs[0]!.source).toBe(`${DRAFT}B\n`);
    expect(draftSavedAs(id)).toBe(songs[0]!.id);
    expect(window.location.hash).toBe('#/');
  });

  it('Lưu: thêm vào thư viện, editor đi tiếp với bài đã lưu (replace, không mount lại)', () => {
    const id = openDraftSong(DRAFT);
    const r = renderEditor(id);
    const ta = textarea();
    type(`${DRAFT}B\n`);
    ta.focus();
    fireEvent.click(screen.getByRole('button', { name: 'Lưu' }));
    const songs = useLibrary.getState().songs;
    expect(songs).toHaveLength(1);
    const savedId = songs[0]!.id;
    expect(savedId.startsWith(DRAFT_ID_PREFIX)).toBe(false);
    expect(songs[0]!.source).toBe(`${DRAFT}B\n`);
    expect(window.location.hash).toBe(`#/edit/${encodeURIComponent(savedId)}`);
    expect(toastTexts()).toContain('Đã lưu "Bài nháp" vào thư viện');

    r.rerender(<EditorView songId={savedId} />);
    expect(textarea()).toBe(ta); // cùng phiên soạn
    expect(screen.queryByRole('note')).toBeNull();
    expect(screen.getByText('Đã lưu mọi thay đổi')).toBeTruthy();
    // bài thư viện: Ctrl+S cập nhật tại chỗ
    type(`${DRAFT}B N\n`);
    fireEvent.keyDown(window, { key: 's', code: 'KeyS', ctrlKey: true });
    expect(useLibrary.getState().songs).toHaveLength(1);
    expect(getSong(savedId)?.source).toBe(`${DRAFT}B N\n`);
  });

  it('Ctrl+S khi chưa sửa vẫn lưu (người dùng chủ động muốn giữ bài)', () => {
    renderEditor(openDraftSong(DRAFT));
    fireEvent.keyDown(window, { key: 's', code: 'KeyS', ctrlKey: true });
    expect(useLibrary.getState().songs.map((s) => s.source)).toEqual([DRAFT]);
  });

  it('Phát: chưa sửa → phát thẳng bản nháp (không lưu); đã sửa → lưu rồi phát bài đã lưu', () => {
    const id = openDraftSong(DRAFT);
    renderEditor(id);
    const play = () =>
      fireEvent.click(screen.getByRole('button', { name: /Phát từ dòng con trỏ/ }));
    textarea().setSelectionRange(0, 0);
    play();
    expect(window.location.hash).toBe(`#/play/${encodeURIComponent(id)}?line=0`);
    expect(useLibrary.getState().songs).toHaveLength(0);
    expect(isDraftSong(id)).toBe(true);

    window.history.replaceState(null, '', `/#/edit/${encodeURIComponent(id)}`);
    type(`${DRAFT}B\n`);
    textarea().setSelectionRange(0, 0);
    play();
    const songs = useLibrary.getState().songs;
    expect(songs).toHaveLength(1);
    expect(window.location.hash).toBe(`#/play/${encodeURIComponent(songs[0]!.id)}?line=0`);
  });

  it('mở lại URL bản nháp đã lưu (Back) → chuyển sang bài đã lưu', () => {
    const id = openDraftSong(DRAFT);
    renderEditor(id);
    fireEvent.click(screen.getByRole('button', { name: 'Lưu' }));
    const savedId = useLibrary.getState().songs[0]!.id;
    // phiên khác mở lại #/edit/draft-…
    const r = render(<EditorView songId={id} />);
    expect(window.location.hash).toBe(`#/edit/${encodeURIComponent(savedId)}`);
    r.unmount();
  });

  it('bản nháp không còn (tải lại trang) → báo rõ, chỉ về Thư viện', () => {
    renderEditor(`${DRAFT_ID_PREFIX}mat-roi`);
    expect(screen.getByText(/Bản nháp chỉ còn tới khi tải lại trang/)).toBeTruthy();
    expect(screen.queryByLabelText('Nội dung bài (.harm)')).toBeNull();
  });

  it('tiếng Anh', () => {
    useSettings.setState({ language: 'en' });
    renderEditor(openDraftSong(DRAFT));
    expect(screen.getByText('Draft — not saved')).toBeTruthy();
    expect(screen.getByRole('note').textContent).toMatch(/^Draft — not in the library yet/);
  });
});

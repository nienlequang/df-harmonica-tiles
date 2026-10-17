import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { encodeShareData } from '../core/share';
import {
  LIBRARY_STORAGE_KEY,
  clearParseCache,
  clearTransientSongs,
  getSong,
  isTransientSong,
  listSongs,
  useLibrary,
} from '../library/store';
import { useSettings } from '../ui/settings';
import { useToasts } from '../ui/toast';
import { ShareView, resetSavedShares } from './ShareView';

const flags = vi.hoisted(() => ({ editor: true, share: true, midiImport: false }));
vi.mock('../ui/features', () => ({ FEATURES: flags }));

const SRC = '@title Bài chia sẻ\n@artist Người gửi\n@bpm 120\n# Đoạn A\nlời một: Z X C V\n';

beforeEach(() => {
  useLibrary.setState({ songs: [] });
  clearTransientSongs();
  clearParseCache();
  resetSavedShares();
  useToasts.setState({ toasts: [] });
  useSettings.setState({ language: 'vi' });
  flags.editor = true;
  window.history.replaceState(null, '', '/#/s/x');
});

describe('ShareView', () => {
  it('giải mã link: tên, tác giả, thống kê, không lỗi', () => {
    render(<ShareView data={encodeShareData(SRC)} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Bài chia sẻ' })).toBeTruthy();
    expect(screen.getByText('Người gửi')).toBeTruthy();
    expect(screen.getByText('120 BPM')).toBeTruthy();
    expect(screen.getByText('0:02')).toBeTruthy(); // 4 beat ở 120 BPM
    expect(screen.getByText('Không có lỗi cú pháp.')).toBeTruthy();
    // nút thao tác
    expect(screen.getByRole('button', { name: /Phát ngay/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Lưu vào thư viện' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Mở trong trình soạn' })).toBeTruthy();
  });

  it('link hỏng / rỗng / bị cắt → thẻ lỗi, không crash', () => {
    const { unmount } = render(<ShareView data="!!!không-hợp-lệ" />);
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText('Link chia sẻ không hợp lệ')).toBeTruthy();
    unmount();
    render(<ShareView data="" />);
    expect(screen.getByText('Link chia sẻ không hợp lệ')).toBeTruthy();
  });

  it('link bị app chat percent-encode vẫn mở được', () => {
    const data = encodeShareData(SRC).replace(/\$/g, '%24').replace(/\+/g, '%2B');
    render(<ShareView data={data} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Bài chia sẻ' })).toBeTruthy();
  });

  it('Phát: mở bài tạm (không lưu, không có trong thư viện) và chuyển tới Player', () => {
    render(<ShareView data={encodeShareData(SRC)} />);
    fireEvent.click(screen.getByRole('button', { name: /Phát ngay/ }));
    const m = /^#\/play\/(shared-[0-9a-z-]+)$/.exec(window.location.hash);
    expect(m).not.toBeNull();
    const id = m![1]!;
    expect(isTransientSong(id)).toBe(true);
    expect(getSong(id)?.source).toBe(SRC);
    expect(useLibrary.getState().songs).toHaveLength(0);
    expect(listSongs().some((e) => e.id === id)).toBe(false);
    expect(localStorage.getItem(LIBRARY_STORAGE_KEY) ?? '').not.toContain('Bài chia sẻ');
  });

  it('Lưu vào thư viện một lần; Phát / Mở trình soạn sau đó dùng bài đã lưu', () => {
    render(<ShareView data={encodeShareData(SRC)} />);
    fireEvent.click(screen.getByRole('button', { name: 'Lưu vào thư viện' }));
    const songs = useLibrary.getState().songs;
    expect(songs).toHaveLength(1);
    expect(songs[0]!.source).toBe(SRC);
    expect(useToasts.getState().toasts.map((t) => t.text)).toContain(
      'Đã lưu "Bài chia sẻ" vào thư viện',
    );
    const saved = screen.getByRole('button', { name: 'Đã lưu vào thư viện' });
    // aria-disabled (không phải disabled): nút vừa bấm giữ focus
    expect(saved.getAttribute('aria-disabled')).toBe('true');
    expect((saved as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(saved);
    expect(useLibrary.getState().songs).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: 'Mở trong trình soạn' }));
    expect(window.location.hash).toBe(`#/edit/${encodeURIComponent(songs[0]!.id)}`);
    fireEvent.click(screen.getByRole('button', { name: /Phát ngay/ }));
    expect(window.location.hash).toBe(`#/play/${encodeURIComponent(songs[0]!.id)}`);
    expect(useLibrary.getState().songs).toHaveLength(1);
  });

  it('Lưu xong, rời trang rồi Back về: vẫn "Đã lưu", không nhân bản; Phát dùng bài đã lưu', () => {
    const data = encodeShareData(SRC);
    const first = render(<ShareView data={data} />);
    const button = screen.getByRole('button', { name: 'Lưu vào thư viện' });
    button.focus();
    fireEvent.click(button);
    expect(document.activeElement).toBe(button);
    fireEvent.click(screen.getByRole('button', { name: 'Mở trong trình soạn' }));
    const id = useLibrary.getState().songs[0]!.id;
    first.unmount(); // route đổi sang editor

    // Back: thẻ mount lại
    const second = render(<ShareView data={data} />);
    const again = screen.getByRole('button', { name: 'Đã lưu vào thư viện' });
    expect(again.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(again);
    fireEvent.click(screen.getByRole('button', { name: 'Mở trong trình soạn' }));
    expect(useLibrary.getState().songs).toHaveLength(1);
    expect(window.location.hash).toBe(`#/edit/${encodeURIComponent(id)}`);
    fireEvent.click(screen.getByRole('button', { name: /Phát ngay/ }));
    expect(window.location.hash).toBe(`#/play/${encodeURIComponent(id)}`);
    expect(screen.queryByText(/Phát mà không lưu/)).toBeNull();
    second.unmount();

    // bản đã lưu được sửa trong editor: vẫn nhớ là đã lưu từ link này
    useLibrary.getState().updateSong(id, `${SRC}B N M\n`);
    const third = render(<ShareView data={data} />);
    expect(screen.getByRole('button', { name: 'Đã lưu vào thư viện' })).toBeTruthy();
    third.unmount();

    // xóa bản đã lưu → lưu lại được
    useLibrary.getState().removeSong(id);
    render(<ShareView data={data} />);
    fireEvent.click(screen.getByRole('button', { name: 'Lưu vào thư viện' }));
    expect(useLibrary.getState().songs).toHaveLength(1);
    expect(useLibrary.getState().songs[0]!.id).not.toBe(id);
  });

  it('thư viện đã có bài cùng nội dung → coi như đã lưu (không nhân bản)', () => {
    const id = useLibrary.getState().addSong(SRC);
    render(<ShareView data={encodeShareData(SRC)} />);
    expect(screen.getByRole('button', { name: 'Đã lưu vào thư viện' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Mở trong trình soạn' }));
    expect(useLibrary.getState().songs).toHaveLength(1);
    expect(window.location.hash).toBe(`#/edit/${encodeURIComponent(id)}`);
  });

  it('Mở trong trình soạn khi chưa lưu: thêm vào thư viện rồi mở editor', () => {
    render(<ShareView data={encodeShareData(SRC)} />);
    fireEvent.click(screen.getByRole('button', { name: 'Mở trong trình soạn' }));
    const songs = useLibrary.getState().songs;
    expect(songs).toHaveLength(1);
    expect(window.location.hash).toBe(`#/edit/${encodeURIComponent(songs[0]!.id)}`);
  });

  it('cờ editor tắt → ẩn "Mở trong trình soạn" (D-060)', () => {
    flags.editor = false;
    render(<ShareView data={encodeShareData(SRC)} />);
    expect(screen.queryByRole('button', { name: 'Mở trong trình soạn' })).toBeNull();
  });

  it('bài có lỗi cú pháp: tóm tắt + dòng lỗi', () => {
    render(<ShareView data={encodeShareData('@title Hỏng\nZ Q X\n[thả chuột trái]')} />);
    expect(screen.getByText('2 lỗi · 0 cảnh báo')).toBeTruthy();
    expect(screen.getByText(/Dòng 2, cột 3: Token lạ: "Q"/)).toBeTruthy();
    expect(screen.getByText(/Bài có lỗi cú pháp/)).toBeTruthy();
  });

  it('tiếng Anh', () => {
    useSettings.setState({ language: 'en' });
    render(<ShareView data={encodeShareData(SRC)} />);
    expect(screen.getByRole('button', { name: 'Save to library' })).toBeTruthy();
    expect(screen.getByText('Shared song')).toBeTruthy();
  });
});

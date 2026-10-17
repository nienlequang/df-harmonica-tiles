import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildDonateText, chunkDonateText } from '../core/donate';
import { parseHarm } from '../core/parser';
import { copyText } from '../ui/components';
import type * as Components from '../ui/components';
import { useSettings } from '../ui/settings';
import { DONATE_JOIN, DonateModal, parseDonateLimit } from './DonateModal';
// Bài tự soạn chỉ dùng cho test (src/test/fixtures/, app không import): dài, có @repeat + giữ chuột.
import SEED_2 from '../test/fixtures/bai-thu-lap-doan.harm?raw';

vi.mock('../ui/components', async (importOriginal) => ({
  ...(await importOriginal<typeof Components>()),
  copyText: vi.fn(async () => true),
}));

const song = parseHarm(SEED_2).song;
const ALL = { durations: true, sectionHeaders: true };

function chunkItems(): HTMLElement[] {
  return within(screen.getByRole('list', { name: 'Các phần' })).getAllByRole('listitem');
}

function chunkTexts(): string[] {
  return chunkItems().map((li) => li.querySelector('pre')?.textContent ?? '');
}

beforeEach(() => {
  useSettings.setState({ language: 'vi' });
  vi.mocked(copyText).mockClear();
  vi.mocked(copyText).mockResolvedValue(true);
});

describe('parseDonateLimit', () => {
  it('chỉ nhận số nguyên trong miền', () => {
    expect(parseDonateLimit('200')).toBe(200);
    expect(parseDonateLimit(' 30 ')).toBe(30);
    expect(parseDonateLimit('2000')).toBe(2000);
    expect(parseDonateLimit('29')).toBeNull();
    expect(parseDonateLimit('2001')).toBeNull();
    expect(parseDonateLimit('1.5')).toBeNull();
    expect(parseDonateLimit('')).toBeNull();
    expect(parseDonateLimit('abc')).toBeNull();
  });
});

describe('DonateModal', () => {
  it('mặc định: đủ option, giới hạn 200, các phần khớp chunkDonateText', () => {
    render(<DonateModal open onClose={() => {}} song={song} />);
    expect(screen.getByRole('dialog', { name: 'Donate text' })).toBeTruthy();
    const expected = chunkDonateText(buildDonateText(song, ALL), 200);
    expect(expected.length).toBeGreaterThan(5);
    expect(chunkTexts()).toEqual(expected);
    expect(screen.getByText(`Phần 1/${expected.length}`)).toBeTruthy();
    expect(screen.getByText(`${expected[0]!.length}/200 ký tự`)).toBeTruthy();
    for (const c of expected) expect(c.length).toBeLessThanOrEqual(200);
    const text = buildDonateText(song, ALL);
    expect(screen.getByText(`${text.length} ký tự · ${expected.length} phần`)).toBeTruthy();
  });

  it('dán lại tất cả các phần ra đúng bài', () => {
    render(<DonateModal open onClose={() => {}} song={song} />);
    const pasted = chunkTexts().join(DONATE_JOIN);
    const back = parseHarm(pasted);
    expect(back.ok).toBe(true);
    // ở 200, mọi dòng của seed 2 vừa một phần (không bị chia giữa dòng)
    expect(back.song).toEqual(song);
  });

  it('đổi option và giới hạn → xem trước cập nhật', () => {
    render(<DonateModal open onClose={() => {}} song={song} />);
    expect(screen.queryByLabelText('Có lời')).toBeNull();
    expect(chunkTexts()).toEqual(chunkDonateText(buildDonateText(song, ALL), 200));
    fireEvent.click(screen.getByLabelText('Có độ dài (*dur)'));
    fireEvent.click(screen.getByLabelText('Có tên đoạn (# section)'));
    const opts = { durations: false, sectionHeaders: false };
    expect(chunkTexts()).toEqual(chunkDonateText(buildDonateText(song, opts), 200));
    expect(chunkTexts().join('\n')).not.toContain('# ĐOẠN');

    const limit = screen.getByLabelText('Số ký tự tối đa mỗi tin');
    fireEvent.change(limit, { target: { value: '1000' } });
    const big = chunkDonateText(buildDonateText(song, opts), 1000);
    expect(chunkTexts()).toEqual(big);
    for (const c of big) expect(c.length).toBeLessThanOrEqual(1000);
  });

  it('giới hạn không hợp lệ: báo, giữ giới hạn hợp lệ gần nhất', () => {
    render(<DonateModal open onClose={() => {}} song={song} />);
    const limit = screen.getByLabelText('Số ký tự tối đa mỗi tin');
    fireEvent.change(limit, { target: { value: '500' } });
    fireEvent.change(limit, { target: { value: '10' } });
    expect(limit.getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByText('Nhập số nguyên từ 30 đến 2000 — đang dùng 500.')).toBeTruthy();
    expect(chunkTexts()).toEqual(chunkDonateText(buildDonateText(song, ALL), 500));
  });

  it('sao chép từng phần và tất cả (nối bằng dòng trống)', async () => {
    render(<DonateModal open onClose={() => {}} song={song} />);
    const expected = chunkDonateText(buildDonateText(song, ALL), 200);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Sao chép phần 2' }));
    });
    expect(copyText).toHaveBeenLastCalledWith(expected[1]);
    expect(within(chunkItems()[1]!).getByRole('button').textContent).toBe('Đã sao chép');

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Sao chép tất cả' }));
    });
    expect(copyText).toHaveBeenLastCalledWith(expected.join('\n\n'));
    expect(screen.getAllByText('Đã sao chép').length).toBeGreaterThan(0);
  });

  it('sao chép thất bại → báo lỗi trên nút', async () => {
    vi.mocked(copyText).mockResolvedValue(false);
    render(<DonateModal open onClose={() => {}} song={song} />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Sao chép tất cả' }));
    });
    expect(
      screen.getAllByText('Không sao chép được — trình duyệt chặn clipboard').length,
    ).toBeGreaterThan(0);
  });

  it('bài vừa một phần: không tiền tố; bài rỗng: thông báo', () => {
    const small = parseHarm('@title Ngắn\nZ X C').song;
    const { unmount } = render(<DonateModal open onClose={() => {}} song={small} />);
    const texts = chunkTexts();
    expect(texts).toHaveLength(1);
    expect(texts[0]?.startsWith('@title Ngắn')).toBe(true);
    unmount();
    const empty = { ...small, title: '', sections: [] };
    render(<DonateModal open onClose={() => {}} song={empty} />);
    // directive luôn có (@bpm…) nên vẫn có 1 phần; không có nốt vẫn không crash
    expect(chunkTexts().length).toBe(1);
  });

  it('tiếng Anh', () => {
    useSettings.setState({ language: 'en' });
    render(<DonateModal open onClose={() => {}} song={song} />);
    expect(screen.queryByLabelText('Include lyrics')).toBeNull();
    expect(screen.getByLabelText('Include durations (*dur)')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Copy all' })).toBeTruthy();
  });

  it('Esc đóng modal', () => {
    const onClose = vi.fn();
    render(<DonateModal open onClose={onClose} song={song} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('errorCount > 0: cảnh báo donate text khác văn bản; nút tới lỗi gọi onShowErrors', () => {
    const onShowErrors = vi.fn();
    const { rerender } = render(
      <DonateModal
        open
        onClose={() => {}}
        song={song}
        errorCount={1}
        onShowErrors={onShowErrors}
      />,
    );
    expect(screen.getByText(/Bài có 1 lỗi cú pháp/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Tới lỗi đầu tiên' }));
    expect(onShowErrors).toHaveBeenCalledTimes(1);
    act(() => useSettings.setState({ language: 'en' }));
    rerender(<DonateModal open onClose={() => {}} song={song} errorCount={3} />);
    expect(screen.getByText(/This song has 3 syntax errors/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Go to first error' })).toBeNull();
    rerender(<DonateModal open onClose={() => {}} song={song} />);
    expect(screen.queryByText(/syntax error/)).toBeNull();
  });
});

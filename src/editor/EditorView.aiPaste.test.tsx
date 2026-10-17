import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearParseCache,
  clearTransientSongs,
  getSong,
  openDraftSong,
  useLibrary,
} from '../library/store';
import { useSettings } from '../ui/settings';
import { useToasts } from '../ui/toast';
import { EditorView } from './EditorView';

vi.mock('../ui/features', () => ({ FEATURES: { editor: true, share: true, midiImport: false } }));

/**
 * Ô "Dán kết quả của AI vào đây" phía trên ô soạn (góp ý 2026-10-16, mục 9): dán = chuyển ngay sang .harm
 * (tông dễ nhất) và thay nội dung bài, Hoàn tác được; gõ tay thì bấm "Áp dụng"; đổi tông sau khi dán áp
 * dụng lại (vẫn một bước Hoàn tác); "Nhập cảm âm" không còn trong Công cụ.
 */

const AI_ANSWER = '```text\n@title Từ AI\n@bpm 96\n# Đoạn 1\ndo1 re1 mi1 fa1\nsol1*2 la1 si1\n```';

function renderEditor(id: string) {
  window.history.replaceState(null, '', `/#/edit/${encodeURIComponent(id)}`);
  return render(<EditorView songId={id} />);
}

const source = () => screen.getByLabelText('Nội dung bài (.harm)') as HTMLTextAreaElement;
const box = () => screen.getByLabelText('Dán kết quả của AI vào đây') as HTMLTextAreaElement;

/** Dán như người dùng: lần nhập `insertFromPaste` (trình duyệt chèn chữ đã dán). */
function paste(text: string) {
  fireEvent.input(box(), { target: { value: text }, inputType: 'insertFromPaste' });
}

beforeEach(() => {
  useLibrary.setState({ songs: [] });
  clearTransientSongs();
  clearParseCache();
  useToasts.setState({ toasts: [] });
  act(() => useSettings.getState().reset());
  useSettings.setState({ language: 'vi' });
});

afterEach(async () => {
  // jsdom phát hashchange / popstate trong task sau: chạy hết trước test kế
  await new Promise((r) => setTimeout(r, 0));
});

describe('EditorView — ô dán kết quả AI', () => {
  it('nằm ngay trên ô soạn .harm; Công cụ không còn "Nhập cảm âm"; link lấy prompt mở tab mới', () => {
    const id = useLibrary.getState().addSong('@title A\nZ X\n');
    renderEditor(id);
    const pasteBox = box();
    expect(
      pasteBox.compareDocumentPosition(source()) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(pasteBox.closest('.editor-source')).toBe(source().closest('.editor-source'));
    fireEvent.click(screen.getByRole('button', { name: /Công cụ/ }));
    const menu = screen.getByRole('list', { name: 'Danh sách công cụ' });
    expect(within(menu).queryByRole('button', { name: 'Nhập cảm âm' })).toBeNull();
    const promptLink = screen.getByRole('link', { name: /Lấy prompt cho AI/ });
    expect(promptLink.getAttribute('href')).toBe('#/ai');
    expect(promptLink.getAttribute('target')).toBe('_blank');
  });

  it('dán → thay nội dung bài bằng .harm đã chuyển; Hoàn tác về bài cũ; Lưu như thường', () => {
    const id = useLibrary.getState().addSong('@title Cũ\nZ X\n');
    renderEditor(id);
    paste(AI_ANSWER);
    const harm = source().value;
    expect(harm).toContain('@title Từ AI');
    expect(harm).toContain('@bpm 96');
    expect(harm).toContain('# Đoạn 1');
    expect(harm).not.toMatch(/do1|re1/);
    expect(screen.getByText('7 nốt · tông dễ chơi nhất · 0 lỗi')).toBeTruthy();
    expect(screen.getByText('Đã đưa 7 nốt vào bài — bấm Lưu để lưu.')).toBeTruthy();
    expect(screen.getByText('Chưa lưu')).toBeTruthy();

    const undo = screen.getByRole('button', { name: /Hoàn tác/ }) as HTMLButtonElement;
    expect(undo.title).toBe('Hoàn tác: Dán kết quả AI');
    fireEvent.click(undo);
    expect(source().value).toBe('@title Cũ\nZ X\n');
    fireEvent.click(screen.getByRole('button', { name: /Làm lại/ }));
    expect(source().value).toBe(harm);

    fireEvent.click(screen.getByRole('button', { name: 'Lưu' }));
    expect(getSong(id)?.source).toBe(harm);
    expect(getSong(id)?.parsed.ok).toBe(true);
  });

  it('bản nháp: dán → Lưu = bài vào Thư viện', () => {
    const draft = openDraftSong('@title Bài mới\n# ĐOẠN 1\nZ X C\n');
    renderEditor(draft);
    paste(AI_ANSWER);
    fireEvent.click(screen.getByRole('button', { name: 'Lưu' }));
    const songs = useLibrary.getState().songs;
    expect(songs).toHaveLength(1);
    expect(songs[0]?.source).toContain('@title Từ AI');
  });

  it('gõ tay (không phải dán): chỉ xem trước, "Áp dụng" mới thay', () => {
    const id = useLibrary.getState().addSong('Z\n');
    renderEditor(id);
    fireEvent.change(box(), { target: { value: 'do1 re1 mi1' } });
    expect(source().value).toBe('Z\n');
    expect(screen.getByText('3 nốt · tông dễ chơi nhất · 0 lỗi')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Áp dụng' }));
    expect(source().value).not.toBe('Z\n');
    expect(source().value).not.toContain('do1');
    expect(screen.queryByRole('button', { name: 'Áp dụng' })).toBeNull();
    expect(screen.getByText('Đã đưa 3 nốt vào bài — bấm Lưu để lưu.')).toBeTruthy();
  });

  it('văn bản dán không có @title → giữ tên bài hiện tại; có @title thì dùng tên mới', () => {
    const id = useLibrary.getState().addSong('@title Giữ tên\nZ\n');
    renderEditor(id);
    paste('do1 re1 mi1');
    expect(source().value.startsWith('@title Giữ tên\n')).toBe(true);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Sửa: Giữ tên');
    paste('@title Tên mới\ndo1 re1');
    expect(source().value.startsWith('@title Tên mới\n')).toBe(true);
  });

  it('đổi tông sau khi dán: áp dụng lại, Hoàn tác vẫn về bài trước khi dán (một bước)', () => {
    const id = useLibrary.getState().addSong('Z\n');
    renderEditor(id);
    paste('fa#1 sib1 do#2 re#2 fa#2 sib1 do#2 fa#1');
    const first = source().value;
    const select = screen.getByLabelText('Tông') as HTMLSelectElement;
    const other = Array.from(select.options)[1]!;
    fireEvent.change(select, { target: { value: other.value } });
    expect(source().value).not.toBe(first);
    fireEvent.click(screen.getByRole('button', { name: /Hoàn tác/ }));
    expect(source().value).toBe('Z\n');
  });

  it('dán rác / dán nhầm prompt: không đổi bài, lời nhắc thân thiện', () => {
    const id = useLibrary.getState().addSong('Z\n');
    renderEditor(id);
    paste('hello world');
    expect(source().value).toBe('Z\n');
    expect(screen.getByText(/^Không đọc được nốt nào/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Áp dụng' })).toBeNull();
  });

  it('dán .harm có sẵn: thay nguyên văn', () => {
    const id = useLibrary.getState().addSong('Z\n');
    renderEditor(id);
    paste('@title K\nX C V');
    expect(source().value).toBe('@title K\nX C V\n');
  });

  it('dán vài dòng nốt (không header) giữ tempo / nhịp / tác giả / tên của bài', () => {
    const id = useLibrary
      .getState()
      .addSong('@title Bài của tôi\n@artist Tôi\n@bpm 132\n@time 3/4\nZ X\n');
    renderEditor(id);
    paste('do1 re1 mi1 fa1');
    const harm = source().value;
    expect(harm).toContain('@title Bài của tôi');
    expect(harm).toContain('@artist Tôi');
    expect(harm).toContain('@bpm 132');
    expect(harm).toContain('@time 3/4');
    expect(harm).not.toContain('@bpm 90');
    expect(harm).not.toContain('@time 4/4');
    // Văn bản dán có header riêng → dùng của nó.
    paste('@bpm 70\n@time 6/8\ndo1 re1');
    expect(source().value).toContain('@bpm 70');
    expect(source().value).toContain('@time 6/8');
    expect(source().value).toContain('@title Bài của tôi');
  });

  it('Hoàn tác / sửa tay sau khi dán: bỏ dòng "Đã đưa …", hiện lại "Áp dụng"; Làm lại → lại "Đã đưa …"', () => {
    const id = useLibrary.getState().addSong('@title Cũ\nZ X\n');
    renderEditor(id);
    paste(AI_ANSWER);
    const applied = 'Đã đưa 7 nốt vào bài — bấm Lưu để lưu.';
    expect(screen.getByText(applied)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Áp dụng' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Hoàn tác/ }));
    expect(source().value).toBe('@title Cũ\nZ X\n');
    expect(screen.queryByText(applied)).toBeNull();
    expect(screen.getByRole('button', { name: 'Áp dụng' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Làm lại/ }));
    expect(screen.getByText(applied)).toBeTruthy();
    // Sửa tay ô soạn: bài không còn đúng là kết quả đã dán.
    fireEvent.change(source(), { target: { value: `${source().value}Z\n` } });
    expect(screen.queryByText(applied)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Áp dụng' }));
    expect(screen.getByText(applied)).toBeTruthy();
  });

  it('lần nhập sau một lần dán là gõ tay (không còn cờ "vừa dán"): chỉ xem trước', () => {
    const id = useLibrary.getState().addSong('Z\n');
    renderEditor(id);
    // Dán nhưng không đổi gì (vd. dán ảnh / dán đè cùng chữ): chỉ có sự kiện paste, không có lần nhập.
    fireEvent.paste(box());
    fireEvent.change(box(), { target: { value: 'do1 re1 mi1' } });
    expect(source().value).toBe('Z\n');
    expect(screen.getByRole('button', { name: 'Áp dụng' })).toBeTruthy();
    paste('do1 re1 mi1 fa1');
    const pasted = source().value;
    expect(pasted).not.toBe('Z\n');
    // Xóa bớt một nốt bằng tay: xem trước, bài giữ nguyên tới khi bấm Áp dụng.
    fireEvent.change(box(), { target: { value: 'do1 re1 mi1' } });
    expect(source().value).toBe(pasted);
    expect(screen.getByRole('button', { name: 'Áp dụng' })).toBeTruthy();
  });

  it('dòng kết quả là live region có sẵn trước lần dán đầu (trình đọc màn hình đọc được kết quả)', () => {
    const id = useLibrary.getState().addSong('Z\n');
    renderEditor(id);
    const region = document.querySelector('.editor-ai') as HTMLElement;
    const live = Array.from(region.querySelectorAll('[role="status"]'));
    expect(live.length).toBeGreaterThanOrEqual(2);
    expect(live.map((el) => (el.textContent ?? '').trim())).toEqual(live.map(() => ''));
    paste('xin chao ban oi');
    // Cùng phần tử live region (không tạo mới) giờ có lời nhắc.
    expect(live[0]?.isConnected).toBe(true);
    expect(live[0]?.textContent).toMatch(/^Không đọc được nốt nào/);
    paste(AI_ANSWER);
    expect(live[1]?.isConnected).toBe(true);
    expect(live[1]?.textContent).toContain('Đã đưa 7 nốt vào bài');
  });

  it('dán tiếp phần 2 vào cuối ô: bài = cả hai phần (ghép theo thứ tự, "ghép 2 phần")', () => {
    const id = useLibrary.getState().addSong('Z\n');
    renderEditor(id);
    const part1 = '```text\n# Đoạn 1\ndo1 re1 mi1 fa1\n```';
    const part2 = '```text\n# Điệp khúc\nsol1 la1 si1 do2\n```';
    paste(part1);
    paste(`${part1}\nCòn tiếp:\n${part2}`);
    const harm = source().value;
    expect(harm).toContain('# Đoạn 1');
    expect(harm).toContain('# Điệp khúc');
    expect(screen.getByText('8 nốt · ghép 2 phần · tông dễ chơi nhất · 0 lỗi')).toBeTruthy();
    // Vẫn một bước Hoàn tác về bài trước khi dán.
    fireEvent.click(screen.getByRole('button', { name: /Hoàn tác/ }));
    expect(source().value).toBe('Z\n');
  });

  it('"Xóa ô dán" làm trống ô (bài giữ nguyên)', () => {
    const id = useLibrary.getState().addSong('Z\n');
    renderEditor(id);
    paste(AI_ANSWER);
    const harm = source().value;
    fireEvent.click(screen.getByRole('button', { name: 'Xóa ô dán' }));
    expect(box().value).toBe('');
    expect(document.activeElement).toBe(box());
    expect(source().value).toBe(harm);
  });
});

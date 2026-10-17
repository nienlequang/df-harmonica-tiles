import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AI_PROMPT_EN, AI_PROMPT_VI } from '../editor/aiPrompt';
import { getDirective } from '../library/songSource';
import {
  DRAFT_ID_PREFIX,
  clearParseCache,
  clearTransientSongs,
  getSong,
  isDraftSong,
  useLibrary,
} from '../library/store';
import { copyText } from '../ui/components';
import type * as Components from '../ui/components';
import { useSettings } from '../ui/settings';
import { useToasts } from '../ui/toast';
import { AiCreateView } from './AiCreateView';

vi.mock('../ui/components', async (importOriginal) => ({
  ...(await importOriginal<typeof Components>()),
  copyText: vi.fn(async () => true),
}));

const AI_ANSWER = [
  'Đây là cảm âm của bài:',
  '```text',
  '@title Bài thử',
  '@bpm 100',
  '',
  '# Đoạn 1',
  'do1 re1 mi1 fa1',
  'sol1*2 la1 si1 do2*2',
  '```',
].join('\n');

const toastTexts = () => useToasts.getState().toasts.map((t) => t.text);

function pasteBox(label = 'Dán kết quả của AI vào đây'): HTMLTextAreaElement {
  return screen.getByLabelText(label) as HTMLTextAreaElement;
}

/** Dán như người dùng: lần nhập `insertFromPaste` (trình duyệt chèn chữ đã dán). */
function paste(text: string, label?: string) {
  fireEvent.input(pasteBox(label), { target: { value: text }, inputType: 'insertFromPaste' });
}

function status(): string {
  return document.querySelector('.paste-status')?.textContent ?? '';
}

function saveButton(): HTMLButtonElement {
  return screen.getByRole('button', { name: 'Lưu' }) as HTMLButtonElement;
}

beforeEach(() => {
  useLibrary.setState({ songs: [] });
  clearTransientSongs();
  clearParseCache();
  useToasts.setState({ toasts: [] });
  act(() => useSettings.getState().reset());
  useSettings.setState({ language: 'vi' });
  vi.mocked(copyText).mockClear();
  vi.mocked(copyText).mockResolvedValue(true);
  window.location.hash = '#/ai';
});

describe('AiCreateView (#/ai)', () => {
  it('4 bước theo thứ tự; tiêu đề trang; link nhỏ "hoặc tự gõ từ đầu"', () => {
    render(<AiCreateView />);
    expect(screen.getByRole('heading', { level: 1, name: 'Tạo bài với AI' })).toBeTruthy();
    const steps = screen.getByRole('list', { name: 'Các bước tạo bài với AI' });
    expect(
      within(steps)
        .getAllByRole('heading', { level: 2 })
        .map((h) => h.textContent),
    ).toEqual(['Sao chép prompt', 'Dán vào AI, kèm bài hát', 'Dán kết quả của AI', 'Lưu']);
    expect(screen.getByRole('button', { name: 'hoặc tự gõ từ đầu' })).toBeTruthy();
    expect(document.title).toContain('Tạo bài với AI');
  });

  it('Sao chép prompt: theo ngôn ngữ giao diện (vi / en), báo đã sao chép', async () => {
    const { unmount } = render(<AiCreateView />);
    fireEvent.click(screen.getByRole('button', { name: 'Sao chép prompt' }));
    await waitFor(() => expect(copyText).toHaveBeenCalledWith(AI_PROMPT_VI));
    expect(await screen.findByRole('button', { name: '✓ Đã sao chép prompt' })).toBeTruthy();
    unmount();

    act(() => useSettings.setState({ language: 'en' }));
    render(<AiCreateView />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy the prompt' }));
    await waitFor(() => expect(copyText).toHaveBeenLastCalledWith(AI_PROMPT_EN));
  });

  it('clipboard bị chặn: báo lỗi, mở ô prompt để tự chép', async () => {
    vi.mocked(copyText).mockResolvedValue(false);
    render(<AiCreateView />);
    const show = screen.getByRole('button', { name: /Xem prompt/ });
    expect(show.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(screen.getByRole('button', { name: 'Sao chép prompt' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/Không sao chép được/);
    expect(show.getAttribute('aria-expanded')).toBe('true');
    const prompt = screen.getByLabelText('Prompt cho AI') as HTMLTextAreaElement;
    expect(prompt.value).toBe(AI_PROMPT_VI);
    expect(prompt.readOnly).toBe(true);
  });

  it('bước 2: link ChatGPT / Claude / Gemini mở tab mới; mẹo tìm nguồn + link Hướng dẫn', () => {
    render(<AiCreateView />);
    const links = within(screen.getByRole('list', { name: 'Mở một AI chat' })).getAllByRole('link');
    expect(links.map((a) => a.getAttribute('href'))).toEqual([
      'https://chatgpt.com/',
      'https://claude.ai/new',
      'https://gemini.google.com/app',
    ]);
    for (const a of links) {
      expect(a.getAttribute('target')).toBe('_blank');
      expect(a.getAttribute('rel')).toBe('noopener noreferrer');
      expect(a.textContent).toContain('(mở tab mới)');
    }
    expect(screen.getByText('Tìm bài ở đâu?').tagName).toBe('SUMMARY');
    expect(
      screen.getByRole('link', { name: /Thêm mẹo và trang hay dùng/ }).getAttribute('href'),
    ).toBe(`#/guide/cam-am?s=${encodeURIComponent('tìm-nguồn-ở-đâu')}`);
  });

  it('chưa dán gì: dòng kết quả nhắc dán, Lưu / Mở trong Editor bị tắt', () => {
    render(<AiCreateView />);
    expect(pasteBox().getAttribute('aria-describedby')).toContain(
      document.querySelector('.paste-status')?.id ?? '?',
    );
    expect(status()).toBe('Chưa có kết quả — dán câu trả lời của AI vào ô trên.');
    expect(saveButton().disabled).toBe(true);
    expect(
      (screen.getByRole('button', { name: 'Mở trong Editor' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('dán câu trả lời của AI → "N nốt · tông … · 0 lỗi", tên bài điền sẵn; Lưu → Thư viện + Phát', () => {
    render(<AiCreateView />);
    paste(AI_ANSWER);
    expect(status()).toBe('✓8 nốt · tông dễ chơi nhất · 0 lỗi');
    const title = screen.getByLabelText('Tên bài') as HTMLInputElement;
    expect(title.value).toBe('Bài thử');
    fireEvent.click(saveButton());

    const songs = useLibrary.getState().songs;
    expect(songs).toHaveLength(1);
    const saved = songs[0]!;
    expect(saved.source).toContain('@title Bài thử');
    expect(saved.source).toContain('@bpm 100');
    expect(saved.source).toContain('@scroll +1');
    expect(saved.source).not.toMatch(/do1|re1/);
    expect(getSong(saved.id)?.parsed.ok).toBe(true);
    expect(toastTexts()).toContain('Đã lưu "Bài thử" vào Thư viện.');

    const confirm = screen.getByText(/Đã lưu "Bài thử" vào Thư viện\./);
    expect(document.activeElement).toBe(confirm);
    expect(screen.getByRole('link', { name: 'Phát' }).getAttribute('href')).toBe(
      `#/play/${saved.id}`,
    );
    expect(screen.getByRole('link', { name: 'Sửa trong Editor' }).getAttribute('href')).toBe(
      `#/edit/${saved.id}`,
    );
    expect(screen.queryByRole('button', { name: 'Lưu' })).toBeNull();

    // "Tạo bài khác": ô dán trống, có thể lưu bài mới
    fireEvent.click(screen.getByRole('button', { name: 'Tạo bài khác' }));
    expect(pasteBox().value).toBe('');
    expect(document.activeElement).toBe(pasteBox());
    expect(saveButton().disabled).toBe(true);
  });

  it('sửa tên bài trước khi lưu → @title mới; dán bài khác → tên theo bài mới', () => {
    render(<AiCreateView />);
    paste(AI_ANSWER);
    const title = screen.getByLabelText('Tên bài') as HTMLInputElement;
    fireEvent.change(title, { target: { value: 'Tên của tôi' } });
    fireEvent.click(saveButton());
    const saved = useLibrary.getState().songs[0]!;
    expect(getDirective(saved.source, 'title')).toBe('Tên của tôi');

    fireEvent.click(screen.getByRole('button', { name: 'Tạo bài khác' }));
    paste('@title Bài hai\ndo1 re1 mi1');
    expect((screen.getByLabelText('Tên bài') as HTMLInputElement).value).toBe('Bài hai');
  });

  it('tên đã sửa không bị trả về @title khi lần nhập sau một lần dán "không đổi gì" là gõ tay', () => {
    render(<AiCreateView />);
    paste(AI_ANSWER);
    const title = () => screen.getByLabelText('Tên bài') as HTMLInputElement;
    fireEvent.change(title(), { target: { value: 'Tên của tôi' } });
    // Dán không chèn gì (ảnh / dán đè cùng chữ): chỉ có sự kiện paste.
    fireEvent.paste(pasteBox());
    // Rồi gõ tay sửa ô dán.
    fireEvent.change(pasteBox(), { target: { value: `${AI_ANSWER}\n` } });
    expect(title().value).toBe('Tên của tôi');
  });

  it('câu trả lời nhiều phần: ghép mọi khối, báo "ghép 2 phần", lưu đủ cả hai phần', () => {
    render(<AiCreateView />);
    paste(
      'Phần 1:\n```text\n@title Dài\n# Đoạn 1\ndo1 re1 mi1 fa1\n```\nPhần 2:\n```text\n# Điệp khúc\nsol1 la1 si1 do2\n```',
    );
    expect(status()).toBe('✓8 nốt · ghép 2 phần · tông dễ chơi nhất · 0 lỗi');
    fireEvent.click(saveButton());
    const saved = useLibrary.getState().songs[0]!.source;
    expect(saved).toContain('# Đoạn 1');
    expect(saved).toContain('# Điệp khúc');
  });

  it('chỗ không đọc được: báo đúng dòng của văn bản đã dán, vẫn lưu được phần đọc được', () => {
    render(<AiCreateView />);
    paste('Kết quả:\n```text\ndo1 xx1 re1 mi1\n```');
    expect(status()).toBe('!3 nốt · tông dễ chơi nhất · 1 chỗ không đọc được (đã bỏ qua)');
    const issues = screen.getByRole('list', { name: 'Chỗ không đọc được' });
    expect(within(issues).getByText('Dòng 3: không đọc được "xx1"')).toBeTruthy();
    expect(saveButton().disabled).toBe(false);
  });

  it('dán rác / dán nhầm prompt: lời nhắc thân thiện, không lưu được', () => {
    render(<AiCreateView />);
    paste('xin chào bạn');
    expect(status()).toMatch(/^Không đọc được nốt nào/);
    expect(saveButton().disabled).toBe(true);
    paste(AI_PROMPT_VI);
    expect(status()).toMatch(/^Đây là prompt của bước 1/);
    expect(saveButton().disabled).toBe(true);
  });

  it('dán .harm có sẵn: giữ nguyên văn, "đã là phím .harm"', () => {
    render(<AiCreateView />);
    paste('@title Có sẵn\nZ X C V');
    expect(status()).toBe('✓4 nốt · đã là phím .harm · 0 lỗi');
    expect(screen.queryByLabelText('Tông')).toBeNull();
    fireEvent.click(saveButton());
    expect(useLibrary.getState().songs[0]?.source).toBe('@title Có sẵn\nZ X C V\n');
  });

  it('ô Tông (tùy chọn): dễ nhất chọn sẵn; đổi tông → kết quả + bài lưu theo tông đó', () => {
    render(<AiCreateView />);
    paste('@title T\nfa#1 sib1 do#2 re#2 fa#2 sib1 do#2 fa#1');
    const select = screen.getByLabelText('Tông') as HTMLSelectElement;
    const options = Array.from(select.options);
    expect(options.length).toBeGreaterThan(1);
    expect(options[0]?.textContent).toMatch(/— dễ nhất$/);
    expect(select.value).toBe(options[0]?.value);
    const before = status();
    const other = options[1]!;
    fireEvent.change(select, { target: { value: other.value } });
    expect(status()).not.toBe(before);
    expect(status()).toContain(`tông: ${other.textContent}`);
    fireEvent.click(saveButton());
    const first = useLibrary.getState().songs[0]!.source;
    // lưu thêm một bản với tông dễ nhất để so: khác nhau
    fireEvent.click(screen.getByRole('button', { name: 'Tạo bài khác' }));
    paste('@title T\nfa#1 sib1 do#2 re#2 fa#2 sib1 do#2 fa#1');
    fireEvent.click(saveButton());
    const second = useLibrary.getState().songs[1]!.source;
    expect(first).not.toBe(second);
  });

  it('"Mở trong Editor" = bản nháp (chưa vào Thư viện)', () => {
    render(<AiCreateView />);
    paste(AI_ANSWER);
    fireEvent.click(screen.getByRole('button', { name: 'Mở trong Editor' }));
    expect(useLibrary.getState().songs).toHaveLength(0);
    const hash = window.location.hash;
    expect(hash.startsWith(`#/edit/${DRAFT_ID_PREFIX}`)).toBe(true);
    const id = decodeURIComponent(hash.slice('#/edit/'.length));
    expect(isDraftSong(id)).toBe(true);
    expect(getDirective(getSong(id)?.source ?? '', 'title')).toBe('Bài thử');
  });

  it('"hoặc tự gõ từ đầu" = bản nháp trống trong Editor (cách thủ công cũ)', () => {
    render(<AiCreateView />);
    fireEvent.click(screen.getByRole('button', { name: 'hoặc tự gõ từ đầu' }));
    expect(useLibrary.getState().songs).toHaveLength(0);
    const id = decodeURIComponent(window.location.hash.slice('#/edit/'.length));
    expect(isDraftSong(id)).toBe(true);
    expect(getDirective(getSong(id)?.source ?? '', 'title')).toBe('Bài mới');
  });

  it('EN', () => {
    useSettings.setState({ language: 'en' });
    render(<AiCreateView />);
    expect(screen.getByRole('heading', { level: 1, name: 'Create with AI' })).toBeTruthy();
    paste(AI_ANSWER, "Paste the AI's answer here");
    expect(status()).toBe('✓8 notes · easiest key · 0 errors');
    expect(screen.getByRole('button', { name: 'or type a song from scratch' })).toBeTruthy();
  });
});

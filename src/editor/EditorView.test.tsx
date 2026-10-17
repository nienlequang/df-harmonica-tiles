import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildDonateText, chunkDonateText } from '../core/donate';
import { parseHarm } from '../core/parser';
import { encodeShareData } from '../core/share';
import { songStats } from '../core/stats';
import { buildTimeline } from '../core/timeline';
import { SEED_SONGS } from '../library/seeds';
import { clearParseCache, clearTransientSongs, getSong, useLibrary } from '../library/store';
import { copyText, downloadText } from '../ui/components';
import type * as Components from '../ui/components';
import { useSettings } from '../ui/settings';
import { useToasts } from '../ui/toast';
import { EditorView, PARSE_DEBOUNCE_MS } from './EditorView';
import { normalizeEol, offsetAt } from './editorText';
import type { EditorToolProps } from './tools/types';
// Bài tự soạn chỉ dùng cho test (src/test/fixtures/), thêm vào thư viện như bài user: bài dài có @repeat + đoạn
// rỗng (ĐOẠN 3) + luyến.
import REPEAT_SONG from '../test/fixtures/bai-thu-lap-doan.harm?raw';

vi.mock('../ui/features', () => ({ FEATURES: { editor: true, share: true, midiImport: false } }));
vi.mock('../ui/components', async (importOriginal) => ({
  ...(await importOriginal<typeof Components>()),
  copyText: vi.fn(async () => true),
  downloadText: vi.fn(),
}));

// Công cụ do agent khác viết: thay bằng modal giả theo đúng contract EditorToolProps.
function FakeTool({ name, p }: { name: string; p: EditorToolProps }) {
  return (
    <div role="dialog" aria-modal="true" aria-label={`fake ${name}`}>
      <p data-testid="tool-source">{p.source}</p>
      <p data-testid="tool-sections">{p.parsed.song.sections.map((s) => s.name).join('|')}</p>
      <p data-testid="tool-song-id">{p.songId}</p>
      <button type="button" onClick={() => p.onApply(`${p.source}\nB N M`, `Fake ${name}`)}>
        apply
      </button>
      <button type="button" onClick={p.onClose}>
        close
      </button>
    </div>
  );
}
vi.mock('./tools/TapTimingModal', () => ({
  TapTimingModal: (p: EditorToolProps) => <FakeTool name="tap" p={p} />,
}));

vi.mock('./tools/ReoptimizeModal', () => ({
  ReoptimizeModal: (p: EditorToolProps) => <FakeTool name="reoptimize" p={p} />,
}));

const SEED_1_ID = 'seed-quoc-ca-viet-nam';
const SEED_2_ID = 'seed-takediskrush';
const SEED_1 = SEED_SONGS.find((s) => s.id === SEED_1_ID)!.source;
const SEED_2 = SEED_SONGS.find((s) => s.id === SEED_2_ID)!.source;
/** Thêm fixture có @repeat vào thư viện (bài user), trả id. */
const addRepeatSong = () => useLibrary.getState().addSong(REPEAT_SONG);

const toastTexts = () => useToasts.getState().toasts.map((t) => t.text);

function renderEditor(id: string, extra?: React.ReactNode) {
  window.history.replaceState(null, '', `/#/edit/${encodeURIComponent(id)}`);
  return render(
    <>
      {extra}
      <EditorView songId={id} />
    </>,
  );
}

function textarea(): HTMLTextAreaElement {
  return screen.getByLabelText('Nội dung bài (.harm)') as HTMLTextAreaElement;
}

function type(value: string) {
  fireEvent.change(textarea(), { target: { value } });
}

/** Chạy hết debounce parse (timer thật). */
async function flushParse() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, PARSE_DEBOUNCE_MS + 30));
  });
}

function setCaretAtLine(line: number) {
  const ta = textarea();
  const off = offsetAt(ta.value, line, 1);
  ta.setSelectionRange(off, off);
}

beforeEach(() => {
  useLibrary.setState({ songs: [] });
  clearTransientSongs();
  clearParseCache();
  useToasts.setState({ toasts: [] });
  useSettings.setState({ language: 'vi' });
  vi.mocked(copyText).mockClear();
  vi.mocked(copyText).mockResolvedValue(true);
  vi.mocked(downloadText).mockClear();
});

afterEach(async () => {
  vi.useRealTimers();
  // jsdom phát hashchange / popstate trong task sau: chạy hết trước test kế (không rò sự kiện).
  await new Promise((r) => setTimeout(r, 0));
});

describe('EditorView — hiển thị', () => {
  it('bài seed: văn bản, thông báo chỉ đọc, preview (thông tin, thống kê, dòng)', () => {
    renderEditor(SEED_1_ID);
    expect(textarea().value).toBe(normalizeEol(SEED_1));
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Sửa: Quốc ca Việt Nam');
    expect(screen.getByRole('note').textContent).toMatch(/bài mẫu \(chỉ đọc\)/);
    expect(screen.getByText('Đã lưu mọi thay đổi')).toBeTruthy();

    const song = parseHarm(SEED_1).song;
    const stats = songStats(buildTimeline(song));
    const stat = (k: string) => document.querySelector(`[data-stat="${k}"]`)?.textContent;
    expect(stat('notes')).toBe(String(stats.noteCount));
    expect(stat('holds')).toBe(
      `trái ${stats.presses.left} · phải ${stats.presses.right} · ${stats.holdRunCount} dải giữ`,
    );
    expect(stat('scroll')).toBe(String(stats.scrollNoteCount));
    expect(stat('beats')).toMatch(/^[\d.]+ beat \(\d+:\d\d\)$/);
    expect(screen.getByText('80 BPM')).toBeTruthy();

    // dòng theo section, chip tô màu modifier (giữ chuột phải); không còn dòng lời
    expect(screen.getByRole('heading', { level: 4, name: 'Phần 2' })).toBeTruthy();
    expect(document.querySelector('.pv-lyric')).toBeNull();
    expect(document.querySelectorAll('.pv-note-right').length).toBeGreaterThan(10);
  });

  it('bài có @repeat: dòng lặp được đánh dấu, đoạn rỗng (ĐOẠN 3) vẫn hiện, chip luyến', () => {
    renderEditor(addRepeatSong());
    expect(screen.getByRole('heading', { level: 4, name: 'ĐOẠN 3' })).toBeTruthy();
    expect(screen.getAllByText('Đoạn trống').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/^lặp \(@repeat ở dòng \d+\)$/).length).toBe(
      parseHarm(REPEAT_SONG).lineOrigins.filter((o) => o.repeatLine !== undefined).length,
    );
    expect(document.querySelectorAll('.pv-chip-slur').length).toBeGreaterThan(0);
  });

  it('id không có → không tìm thấy', () => {
    renderEditor('khong-co');
    expect(screen.getByText('Không tìm thấy bài hát')).toBeTruthy();
  });

  it('tiếng Anh', () => {
    useSettings.setState({ language: 'en' });
    renderEditor(SEED_1_ID);
    expect(screen.getByLabelText('Song text (.harm)')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Play from cursor line/ })).toBeTruthy();
  });
});

describe('EditorView — parse debounce + lỗi', () => {
  it('parse lại sau 150 ms ngừng gõ', () => {
    vi.useFakeTimers();
    const id = useLibrary.getState().addSong('@title Cũ\nZ');
    renderEditor(id);
    const heading = () => screen.getByRole('heading', { level: 1 }).textContent;
    expect(heading()).toBe('Sửa: Cũ');
    type('@title Mới\nZ X');
    expect(heading()).toBe('Sửa: Cũ');
    act(() => vi.advanceTimersByTime(PARSE_DEBOUNCE_MS - 1));
    expect(heading()).toBe('Sửa: Cũ');
    // gõ tiếp → đếm lại từ đầu
    type('@title Mới hơn\nZ X');
    act(() => vi.advanceTimersByTime(PARSE_DEBOUNCE_MS - 1));
    expect(heading()).toBe('Sửa: Cũ');
    act(() => vi.advanceTimersByTime(1));
    expect(heading()).toBe('Sửa: Mới hơn');
    expect(screen.getByText('Chưa lưu')).toBeTruthy();
  });

  it('bấm lỗi trong preview → con trỏ tới dòng/cột; gutter có marker', async () => {
    const id = useLibrary.getState().addSong('@title A\nZ X Q\n');
    renderEditor(id);
    const ta = textarea();
    expect(ta.getAttribute('aria-invalid')).toBe('true');
    const gutterLine = document.querySelector('.harm-gutter-line.is-error');
    expect(gutterLine?.textContent).toContain('2');
    expect(gutterLine?.getAttribute('title')).toBe('Token lạ: "Q"');

    const diag = screen.getByRole('button', { name: /Dòng 2:5.*Token lạ: "Q"/ });
    fireEvent.click(diag);
    expect(document.activeElement).toBe(ta);
    expect(ta.selectionStart).toBe(13);
    expect(ta.selectionEnd).toBe(13);
    expect(ta.value[13]).toBe('Q');
    expect(screen.getByText('Dòng 2, cột 5')).toBeTruthy();

    // nút "Dòng N" của danh sách dòng → đầu dòng nguồn
    fireEvent.click(screen.getByRole('button', { name: 'Tới dòng nguồn 2' }));
    expect(ta.selectionStart).toBe(9);

    // sửa lỗi → hết lỗi sau debounce
    type('@title A\nZ X C\n');
    await flushParse();
    expect(screen.getByText('Không có lỗi hay cảnh báo.')).toBeTruthy();
    expect(document.querySelector('.harm-gutter-line.is-error')).toBeNull();
  });

  it('lỗi phát sinh trong @repeat hiện kèm dòng gốc', () => {
    const src = '# A\n[giữ chuột trái]\nZ\n# B\n[giữ chuột trái]\n@repeat A\n[thả chuột trái]\n';
    const id = useLibrary.getState().addSong(src);
    renderEditor(id);
    expect(screen.getByText(/\(trong @repeat, dòng gốc 2\)/)).toBeTruthy();
  });
});

describe('EditorView — Tab', () => {
  it('Tab chèn 2 dấu cách; Esc rồi Tab thì không chặn', () => {
    const id = useLibrary.getState().addSong('Z X');
    renderEditor(id);
    const ta = textarea();
    ta.focus();
    ta.setSelectionRange(1, 1);
    const prevented = !fireEvent.keyDown(ta, { key: 'Tab' });
    expect(prevented).toBe(true);
    expect(ta.value).toBe('Z   X');
    expect(ta.selectionStart).toBe(3);

    fireEvent.keyDown(ta, { key: 'Escape' });
    expect(fireEvent.keyDown(ta, { key: 'Tab' })).toBe(true); // không preventDefault
    expect(ta.value).toBe('Z   X');
    // Shift+Tab không bao giờ bị chặn
    expect(fireEvent.keyDown(ta, { key: 'Tab', shiftKey: true })).toBe(true);
  });
});

describe('EditorView — lưu', () => {
  it('bài user: Lưu cập nhật thư viện; Ctrl+S cũng lưu', () => {
    const id = useLibrary.getState().addSong('@title A\nZ');
    renderEditor(id);
    type('@title A\nZ X');
    expect(screen.getByText('Chưa lưu')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Lưu' }));
    expect(getSong(id)?.source).toBe('@title A\nZ X');
    expect(screen.getByText('Đã lưu mọi thay đổi')).toBeTruthy();
    expect(toastTexts()).toContain('Đã lưu');

    type('@title A\nZ X C');
    const notPrevented = fireEvent.keyDown(window, { key: 's', code: 'KeyS', ctrlKey: true });
    expect(notPrevented).toBe(false);
    expect(getSong(id)?.source).toBe('@title A\nZ X C');
    expect(useLibrary.getState().songs).toHaveLength(1);
  });

  it('bài mẫu: Lưu tạo bản sao, mở editor bản sao (replace), seed giữ nguyên', () => {
    renderEditor(SEED_1_ID);
    const next = `${textarea().value}Z X C\n`;
    type(next);
    fireEvent.click(screen.getByRole('button', { name: 'Lưu' }));
    const songs = useLibrary.getState().songs;
    expect(songs).toHaveLength(1);
    expect(songs[0]!.source).toBe(next);
    expect(window.location.hash).toBe(`#/edit/${encodeURIComponent(songs[0]!.id)}`);
    expect(toastTexts()).toContain('Đã lưu bản sao "Quốc ca Việt Nam" vào thư viện');
    expect(getSong(SEED_1_ID)?.source).toBe(SEED_1);
  });

  it('bài CRLF mở ra không bị coi là đã sửa', () => {
    const id = useLibrary.getState().addSong('@title A\r\nZ X\r\n');
    renderEditor(id);
    expect(textarea().value).toBe('@title A\nZ X\n');
    expect(screen.getByText('Đã lưu mọi thay đổi')).toBeTruthy();
  });
});

describe('EditorView — Phát từ dòng con trỏ', () => {
  const playButton = () => screen.getByRole('button', { name: /Phát từ dòng con trỏ/ });

  it('con trỏ trên @repeat → dòng model đầu tiên do repeat chèn', () => {
    const id = addRepeatSong();
    renderEditor(id);
    const lines = textarea().value.split('\n');
    setCaretAtLine(lines.indexOf('@repeat ĐIỆP KHÚC') + 1);
    fireEvent.click(playButton());
    expect(window.location.hash).toBe(`#/play/${id}?line=31`);
    // không sửa → không lưu lại, không tạo bài mới
    expect(useLibrary.getState().songs).toHaveLength(1);
    expect(getSong(id)?.source).toBe(REPEAT_SONG);
  });

  it('con trỏ trong điệp khúc gốc, trên header, ở đầu bài', () => {
    const id = addRepeatSong();
    renderEditor(id);
    const lines = textarea().value.split('\n');
    setCaretAtLine(lines.indexOf('# ĐIỆP KHÚC') + 4);
    fireEvent.click(playButton());
    expect(window.location.hash).toBe(`#/play/${id}?line=13`);

    window.history.replaceState(null, '', `/#/edit/${id}`);
    setCaretAtLine(lines.indexOf('# ĐOẠN 2') + 1);
    fireEvent.click(playButton());
    expect(window.location.hash).toBe(`#/play/${id}?line=6`);

    window.history.replaceState(null, '', `/#/edit/${id}`);
    setCaretAtLine(1);
    fireEvent.click(playButton());
    expect(window.location.hash).toBe(`#/play/${id}?line=0`);
  });

  it('bài user đang sửa: lưu trước rồi phát (dùng văn bản mới, chưa chờ debounce)', () => {
    const id = useLibrary.getState().addSong('# A\nZ\n');
    renderEditor(id);
    type('# A\nZ\nX\n# B\nC\n');
    setCaretAtLine(5);
    fireEvent.click(playButton());
    expect(getSong(id)?.source).toBe('# A\nZ\nX\n# B\nC\n');
    expect(window.location.hash).toBe(`#/play/${encodeURIComponent(id)}?line=2`);
  });

  it('bài mẫu đang sửa: tạo bản sao rồi phát bản sao', () => {
    renderEditor(SEED_1_ID);
    type(`${textarea().value}Z\n`);
    setCaretAtLine(1);
    fireEvent.click(playButton());
    const songs = useLibrary.getState().songs;
    expect(songs).toHaveLength(1);
    expect(window.location.hash).toBe(`#/play/${encodeURIComponent(songs[0]!.id)}?line=0`);
  });

  it('bài không có dòng nốt → phát không kèm ?line', () => {
    const id = useLibrary.getState().addSong('@title Trống\n');
    renderEditor(id);
    fireEvent.click(playButton());
    expect(window.location.hash).toBe(`#/play/${encodeURIComponent(id)}`);
  });
});

describe('EditorView — công cụ + Hoàn tác / Làm lại', () => {
  it('menu Công cụ mở modal với source + parse khớp; áp dụng, hoàn tác, làm lại', () => {
    const id = useLibrary.getState().addSong('# A\nZ\n');
    renderEditor(id);
    const undo = screen.getByRole('button', { name: /Hoàn tác/ }) as HTMLButtonElement;
    const redo = screen.getByRole('button', { name: /Làm lại/ }) as HTMLButtonElement;
    expect(undo.disabled).toBe(true);

    // gõ rồi mở công cụ ngay (chưa hết debounce): công cụ nhận parse của văn bản mới
    type('# A\nZ\n# B\nX\n');
    const menuButton = screen.getByRole('button', { name: /Công cụ/ });
    expect(menuButton.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(menuButton);
    expect(menuButton.getAttribute('aria-expanded')).toBe('true');
    const menu = screen.getByRole('list', { name: 'Danh sách công cụ' });
    expect(
      within(menu)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['Tap timing (gõ nhịp)', 'Tối ưu lại cung / quãng']);
    fireEvent.click(within(menu).getByRole('button', { name: 'Tap timing (gõ nhịp)' }));
    const dialog = screen.getByRole('dialog', { name: 'fake tap' });
    expect(within(dialog).getByTestId('tool-source').textContent).toBe('# A\nZ\n# B\nX\n');
    expect(within(dialog).getByTestId('tool-sections').textContent).toBe('A|B');
    expect(within(dialog).getByTestId('tool-song-id').textContent).toBe(id);

    fireEvent.click(within(dialog).getByRole('button', { name: 'apply' }));
    expect(textarea().value).toBe('# A\nZ\n# B\nX\n\nB N M');
    // modal vẫn mở thì nhận source mới
    expect(within(dialog).getByTestId('tool-source').textContent).toBe('# A\nZ\n# B\nX\n\nB N M');
    fireEvent.click(within(dialog).getByRole('button', { name: 'close' }));
    expect(screen.queryByRole('dialog')).toBeNull();

    expect(undo.disabled).toBe(false);
    expect(undo.title).toBe('Hoàn tác: Fake tap');
    fireEvent.click(undo);
    expect(textarea().value).toBe('# A\nZ\n# B\nX\n');
    expect(undo.disabled).toBe(true);
    expect(redo.disabled).toBe(false);
    expect(redo.title).toBe('Làm lại: Fake tap');
    fireEvent.click(redo);
    expect(textarea().value).toBe('# A\nZ\n# B\nX\n\nB N M');
    expect(screen.getByText('Chưa lưu')).toBeTruthy();
  });

  it('Esc / bấm ngoài đóng menu; mỗi mục mở đúng công cụ', () => {
    const id = useLibrary.getState().addSong('Z');
    renderEditor(id);
    const menuButton = screen.getByRole('button', { name: /Công cụ/ });
    fireEvent.click(menuButton);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(menuButton.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(menuButton);
    fireEvent.click(menuButton);
    fireEvent.mouseDown(document.body);
    expect(menuButton.getAttribute('aria-expanded')).toBe('false');

    for (const [label, name] of [
      ['Tap timing (gõ nhịp)', 'fake tap'],
      ['Tối ưu lại cung / quãng', 'fake reoptimize'],
    ] as const) {
      fireEvent.click(menuButton);
      fireEvent.click(screen.getByRole('button', { name: label }));
      const dialog = screen.getByRole('dialog', { name });
      fireEvent.click(within(dialog).getByRole('button', { name: 'close' }));
    }
  });

  it('Ctrl+S không chạy khi hộp thoại đang mở', () => {
    const id = useLibrary.getState().addSong('Z');
    renderEditor(id);
    type('Z X');
    fireEvent.click(screen.getByRole('button', { name: /Công cụ/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Tối ưu lại cung / quãng' }));
    fireEvent.keyDown(window, { key: 's', code: 'KeyS', ctrlKey: true });
    expect(getSong(id)?.source).toBe('Z');
  });
});

describe('EditorView — xuất, chia sẻ, donate', () => {
  it('Xuất .harm / .json dùng văn bản hiện tại', () => {
    const id = useLibrary.getState().addSong('@title Xuất thử\nZ');
    renderEditor(id);
    type('@title Xuất thử\nZ X');
    fireEvent.click(screen.getByRole('button', { name: 'Xuất .harm' }));
    expect(downloadText).toHaveBeenLastCalledWith(
      'xuat-thu.harm',
      '@title Xuất thử\nZ X',
      'text/plain',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Xuất .json' }));
    const [name, json] = vi.mocked(downloadText).mock.calls.at(-1)!;
    expect(name).toBe('xuat-thu.json');
    const payload = JSON.parse(json) as { source: string; song: { sections: unknown[] } };
    expect(payload.source).toBe('@title Xuất thử\nZ X');
    expect(toastTexts()).toContain('Đã xuất xuat-thu.json');
  });

  it('Chia sẻ link: sao chép #/s/<lz-string>; link dài thì cảnh báo', async () => {
    const id = useLibrary.getState().addSong('@title Chia sẻ\nZ X C');
    renderEditor(id);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Chia sẻ link' }));
    });
    const url = `${window.location.origin}${window.location.pathname}#/s/${encodeShareData('@title Chia sẻ\nZ X C')}`;
    expect(copyText).toHaveBeenLastCalledWith(url);
    expect(toastTexts()).toContain(`Đã sao chép link chia sẻ (${url.length} ký tự)`);
    expect(toastTexts().some((x) => x.startsWith('Link dài'))).toBe(false);

    // văn bản entropy cao → link > 8000 ký tự
    let seed = 7;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    const alphabet = 'abcdefghijklmnopqrstuvwxyzăâđêôơưáàảãạ0123456789';
    let noise = '';
    for (let i = 0; i < 14000; i++) noise += alphabet[Math.floor(rnd() * alphabet.length)];
    // tiền tố kiểu cũ trước ": " (parser bỏ qua) — vẫn nằm trong nguồn được chia sẻ
    type(`${noise}: Z`);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Chia sẻ link' }));
    });
    expect(toastTexts().some((x) => x.startsWith('Link dài'))).toBe(true);

    vi.mocked(copyText).mockResolvedValue(false);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Chia sẻ link' }));
    });
    expect(toastTexts()).toContain('Không sao chép được link — trình duyệt chặn clipboard');
  });

  it('Chia sẻ link: bài rỗng / toàn khoảng trắng không sao chép link (link chỉ mở ra "link hỏng")', async () => {
    const id = useLibrary.getState().addSong('@title Rỗng\nZ');
    renderEditor(id);
    for (const blank of ['', '  \n\t\n', '\u0000\u000b']) {
      vi.mocked(copyText).mockClear();
      useToasts.setState({ toasts: [] });
      type(blank);
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Chia sẻ link' }));
      });
      expect(copyText, JSON.stringify(blank)).not.toHaveBeenCalled();
      expect(toastTexts()).toEqual(['Bài chưa có nội dung để chia sẻ.']);
    }
  });

  it('Donate text: chia theo văn bản đang sửa (chưa lưu)', () => {
    renderEditor(SEED_2_ID);
    type(textarea().value.replace('@title TAKEDISKRUSH!', '@title Bản donate'));
    fireEvent.click(screen.getByRole('button', { name: 'Donate text' }));
    const dialog = screen.getByRole('dialog', { name: 'Donate text' });
    const parts = within(dialog)
      .getAllByRole('listitem')
      .map((li) => li.querySelector('pre')?.textContent);
    const song = parseHarm(textarea().value).song;
    expect(parts).toEqual(
      chunkDonateText(buildDonateText(song, { durations: true, sectionHeaders: true }), 200),
    );
    expect(parts[0]).toContain('@title Bản donate');
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('EditorView — rời trang khi chưa lưu', () => {
  const link = <a href="#/settings">Đi tới cài đặt</a>;

  it('không sửa: link đi bình thường, beforeunload không chặn', () => {
    const id = useLibrary.getState().addSong('Z');
    renderEditor(id, link);
    const ev = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
    // Ghi lại guard có chặn không, rồi tự chặn điều hướng thật (jsdom xếp nó vào task sau, sẽ rò
    // sang test kế).
    let preventedByGuard: boolean | null = null;
    document.addEventListener(
      'click',
      (e) => {
        preventedByGuard = e.defaultPrevented;
        e.preventDefault();
      },
      { once: true },
    );
    fireEvent.click(screen.getByText('Đi tới cài đặt'));
    expect(preventedByGuard).toBe(false);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('đang sửa: beforeunload chặn; click link hỏi xác nhận (Ở lại / Bỏ thay đổi)', () => {
    const id = useLibrary.getState().addSong('Z');
    renderEditor(id, link);
    type('Z X');
    const ev = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);

    fireEvent.click(screen.getByText('Đi tới cài đặt'));
    expect(screen.getByRole('dialog', { name: 'Rời trình soạn?' })).toBeTruthy();
    expect(window.location.hash).toBe(`#/edit/${encodeURIComponent(id)}`);
    fireEvent.click(screen.getByRole('button', { name: 'Ở lại' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(window.location.hash).toBe(`#/edit/${encodeURIComponent(id)}`);

    fireEvent.click(screen.getByText('Đi tới cài đặt'));
    fireEvent.click(screen.getByRole('button', { name: 'Bỏ thay đổi' }));
    expect(window.location.hash).toBe('#/settings');
    expect(getSong(id)?.source).toBe('Z');
  });

  it('đang sửa: hash đổi (Back / gõ URL) bị trả lại; "Lưu rồi đi" lưu rồi điều hướng', async () => {
    const id = useLibrary.getState().addSong('Z');
    renderEditor(id);
    type('Z X C');
    act(() => {
      window.location.hash = '#/';
    });
    await waitFor(() =>
      expect(screen.getByRole('dialog', { name: 'Rời trình soạn?' })).toBeTruthy(),
    );
    expect(window.location.hash).toBe(`#/edit/${encodeURIComponent(id)}`);
    fireEvent.click(screen.getByRole('button', { name: 'Lưu rồi đi' }));
    expect(getSong(id)?.source).toBe('Z X C');
    expect(window.location.hash).toBe('#/');
  });
});

describe('EditorView — lưu bài chỉ đọc giữ phiên soạn', () => {
  it('bài mẫu: Ctrl+S chuyển sang bản sao không mount lại (Hoàn tác, con trỏ, focus còn nguyên)', () => {
    const r = renderEditor(SEED_2_ID);
    const ta = textarea();
    fireEvent.click(screen.getByRole('button', { name: /Công cụ/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Tap timing (gõ nhịp)' }));
    fireEvent.click(screen.getByRole('button', { name: 'apply' }));
    fireEvent.click(screen.getByRole('button', { name: 'close' }));
    const undoButton = () => screen.getByRole('button', { name: /Hoàn tác/ }) as HTMLButtonElement;
    expect(undoButton().disabled).toBe(false);
    const afterTool = ta.value;

    type(`${afterTool}a`);
    ta.focus();
    setCaretAtLine(50);
    const caret = ta.selectionStart;
    expect(caret).toBeGreaterThan(0);
    fireEvent.keyDown(window, { key: 's', code: 'KeyS', ctrlKey: true });

    const songs = useLibrary.getState().songs;
    expect(songs).toHaveLength(1);
    const copyId = songs[0]!.id;
    expect(window.location.hash).toBe(`#/edit/${encodeURIComponent(copyId)}`);
    // App render lại theo route mới
    r.rerender(
      <>
        <EditorView songId={copyId} />
      </>,
    );
    expect(textarea()).toBe(ta); // cùng phần tử: không mount lại
    expect(document.activeElement).toBe(ta);
    expect(ta.selectionStart).toBe(caret);
    expect(ta.value).toBe(`${afterTool}a`);
    expect(undoButton().disabled).toBe(false);
    expect(screen.queryByRole('note')).toBeNull(); // không còn là bài chỉ đọc
    expect(screen.getByText('Đã lưu mọi thay đổi')).toBeTruthy();

    // bản sao là bài user: Lưu cập nhật tại chỗ, không tạo bản sao nữa
    type(`${afterTool}ab`);
    fireEvent.keyDown(window, { key: 's', code: 'KeyS', ctrlKey: true });
    expect(useLibrary.getState().songs).toHaveLength(1);
    expect(getSong(copyId)?.source).toBe(`${afterTool}ab`);
    // Hoàn tác thao tác công cụ vẫn được
    fireEvent.click(undoButton());
    expect(ta.value).toBe(normalizeEol(SEED_2));

    // mở bài khác (kể cả chính bài mẫu) → phiên mới
    r.rerender(
      <>
        <EditorView songId={SEED_2_ID} />
      </>,
    );
    expect(textarea()).not.toBe(ta);
    expect(textarea().value).toBe(normalizeEol(SEED_2));
    expect(undoButton().disabled).toBe(true);
    expect(screen.getByRole('note').textContent).toMatch(/bài mẫu/);
  });

  it('đổi sang bài khác không qua Lưu → mount lại với nội dung bài đó', () => {
    const a = useLibrary.getState().addSong('@title A\nZ\n');
    const b = useLibrary.getState().addSong('@title B\nX\n');
    const r = renderEditor(a);
    const ta = textarea();
    r.rerender(
      <>
        <EditorView songId={b} />
      </>,
    );
    expect(textarea()).not.toBe(ta);
    expect(textarea().value).toBe('@title B\nX\n');
  });
});

describe('EditorView — focus quanh menu Công cụ', () => {
  it('mở công cụ: focus về nút Công cụ (Modal trả focus vào đây); Áp dụng xong → ô soạn', () => {
    const id = useLibrary.getState().addSong('# A\nZ\n');
    renderEditor(id);
    const menuButton = screen.getByRole('button', { name: /Công cụ/ });
    fireEvent.click(menuButton);
    const item = screen.getByRole('button', { name: 'Tap timing (gõ nhịp)' });
    item.focus();
    fireEvent.click(item);
    // mục menu đã bị ẩn: phần tử đang focus lúc Modal mở là nút Công cụ (còn hiện)
    expect(document.activeElement).toBe(menuButton);
    fireEvent.click(screen.getByRole('button', { name: 'close' }));
    expect(document.activeElement).toBe(menuButton);

    fireEvent.click(menuButton);
    fireEvent.click(screen.getByRole('button', { name: 'Tối ưu lại cung / quãng' }));
    fireEvent.click(screen.getByRole('button', { name: 'apply' }));
    fireEvent.click(screen.getByRole('button', { name: 'close' }));
    expect(document.activeElement).toBe(textarea());
  });

  it('Tab ra khỏi menu → menu đóng; focus vào mục trong menu thì không', () => {
    const id = useLibrary.getState().addSong('Z');
    renderEditor(id);
    const menuButton = screen.getByRole('button', { name: /Công cụ/ });
    fireEvent.click(menuButton);
    const item = screen.getByRole('button', { name: 'Tap timing (gõ nhịp)' });
    fireEvent.focusOut(menuButton, { relatedTarget: item });
    expect(menuButton.getAttribute('aria-expanded')).toBe('true');
    // relatedTarget null (click chỗ không focus được, đổi cửa sổ): để mousedown-ngoài xử lý
    fireEvent.focusOut(item, { relatedTarget: null });
    expect(menuButton.getAttribute('aria-expanded')).toBe('true');
    fireEvent.focusOut(item, { relatedTarget: screen.getByRole('button', { name: 'Xuất .harm' }) });
    expect(menuButton.getAttribute('aria-expanded')).toBe('false');
  });
});

describe('EditorView — Donate khi bài có lỗi', () => {
  it('cảnh báo số lỗi; "Tới lỗi đầu tiên" đóng hộp thoại và đưa con trỏ tới lỗi', () => {
    const id = useLibrary.getState().addSong('@title A\nZ X\nZ Q X\nB N*0 M\n');
    renderEditor(id);
    fireEvent.click(screen.getByRole('button', { name: 'Donate text' }));
    const dialog = screen.getByRole('dialog', { name: 'Donate text' });
    expect(within(dialog).getByText(/Bài có 2 lỗi cú pháp/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Tới lỗi đầu tiên' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    const ta = textarea();
    expect(document.activeElement).toBe(ta);
    expect(ta.selectionStart).toBe(15);
    expect(ta.value[15]).toBe('Q');
  });

  it('bài không lỗi: không có cảnh báo', () => {
    const id = useLibrary.getState().addSong('@title A\nZ X\n');
    renderEditor(id);
    fireEvent.click(screen.getByRole('button', { name: 'Donate text' }));
    expect(screen.queryByText(/lỗi cú pháp/)).toBeNull();
  });
});

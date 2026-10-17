import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SHARE_URL_SOFT_LIMIT, buildShareUrl, decodeShareData } from '../core/share';
import { downloadText } from '../ui/components';
import { href, paths } from '../ui/router';
import { useSettings } from '../ui/settings';
import { useToasts } from '../ui/toast';
import type * as Components from '../ui/components';
import { LibraryView } from './LibraryView';
import { SEED_SONGS } from './seeds';
import { clearParseCache, getSong, useLibrary } from './store';

// Parser giả (parser thật thuộc agent khác): đọc directive, mỗi bài = 1 nốt 2 beat.
const fake = vi.hoisted(() => ({
  parse: (text: string, opts: { id?: string } = {}) => {
    const get = (name: string) =>
      new RegExp(`^[ \\t]*@${name}[ \\t]+([^\\r\\n]*)`, 'im').exec(text)?.[1]?.trim();
    const artist = get('artist');
    const ok = !text.includes('!!ERR');
    return {
      song: {
        id: opts.id ?? '',
        title: get('title') ?? '',
        ...(artist ? { artist } : {}),
        bpm: Number(get('bpm')) || 90,
        timeSig: { num: 4, den: 4 },
        scrollDir: 1 as const,
        sections: [
          {
            name: 'Main',
            lines: [
              {
                units: [
                  {
                    kind: 'note' as const,
                    key: 'Z' as const,
                    octave: 0 as const,
                    sharp: false,
                    beats: 2,
                  },
                ],
              },
            ],
          },
        ],
      },
      diagnostics: ok
        ? []
        : [
            {
              severity: 'error' as const,
              code: 'unknown-token' as const,
              line: 2,
              column: 3,
              length: 5,
              params: { token: '!!ERR' },
            },
          ],
      lineOrigins: [],
      ok,
    };
  },
}));

vi.mock('../core/parser', () => ({ parseHarm: fake.parse }));
// Cờ tính năng (D-060) đổi được trong từng test.
const flags = vi.hoisted(() => ({ editor: false, share: false, midiImport: false }));
vi.mock('../ui/features', () => ({ FEATURES: flags }));
vi.mock('../ui/components', async (importOriginal) => ({
  ...(await importOriginal<typeof Components>()),
  downloadText: vi.fn(),
}));

const toastTexts = () => useToasts.getState().toasts.map((t) => t.text);

/** Tên các bài mẫu theo thứ tự thư viện (góp ý 2026-10-16: hai bài của người dùng đứng đầu). */
const SEED_TITLES = ['Quốc ca Việt Nam', 'TAKEDISKRUSH!'];
const SEED_1 = 'Quốc ca Việt Nam';
const SEED_2 = 'TAKEDISKRUSH!';

function searchBox(): HTMLElement {
  return screen.getByLabelText('Tìm bài theo tên hoặc tác giả');
}

function cardTitles(): string[] {
  const list = screen.queryByRole('list', { name: 'Danh sách bài hát' });
  return list
    ? within(list)
        .queryAllByRole('listitem')
        .map((li) => within(li).getByRole('heading').textContent ?? '')
    : [];
}

/** Nhãn các nút / link "Thêm bài" theo thứ tự hiện. */
function createActions(): string[] {
  const list = screen.getByRole('list', { name: 'Các cách thêm bài' });
  return within(list)
    .getAllByRole('listitem')
    .map((li) => (li.querySelector('.btn')?.textContent ?? '').trim());
}

beforeEach(() => {
  useLibrary.setState({ songs: [] });
  clearParseCache();
  useSettings.setState({ language: 'vi' });
  useToasts.setState({ toasts: [] });
  window.location.hash = '';
  Object.assign(flags, { editor: false, share: false, midiImport: false });
});

describe('LibraryView', () => {
  it('hiện các bài seed (2 bài mới đứng đầu) với badge, tác giả, bpm, độ dài, số nốt; seed không có nút Xóa', () => {
    render(<LibraryView />);
    expect(screen.getByRole('heading', { level: 1, name: 'Thư viện bài hát' })).toBeTruthy();
    expect(cardTitles()).toEqual(SEED_TITLES);

    const card1 = screen.getByRole('listitem', { name: SEED_1 });
    expect(within(card1).getByText('Mẫu')).toBeTruthy();
    expect(within(card1).getByText('Văn Cao')).toBeTruthy();
    expect(within(card1).getByText('80 BPM')).toBeTruthy();
    // 1 nốt × 2 beat ở 80 bpm = 1.5 s → làm tròn xuống như đồng hồ Player
    expect(within(card1).getByText('0:01')).toBeTruthy();
    expect(within(card1).getByText('1')).toBeTruthy();

    const card2 = screen.getByRole('listitem', { name: SEED_2 });
    expect(within(card2).getByText('N2UtheHartlocker')).toBeTruthy();
    expect(within(card2).getByText('122 BPM')).toBeTruthy();

    const play = within(card1).getByRole('link', { name: `Phát "${SEED_1}"` });
    expect(play.getAttribute('href')).toBe('#/play/seed-quoc-ca-viet-nam');

    expect(screen.queryByRole('button', { name: /^Xóa "/ })).toBeNull();
  });

  it('Phase 1 (chưa có Editor / MIDI / share): ẩn "Tạo bài với AI", "Sửa", "Tạo bài từ file", "Chia sẻ"', () => {
    render(<LibraryView />);
    expect(screen.queryByRole('link', { name: 'Tạo bài với AI' })).toBeNull();
    expect(screen.queryByRole('link', { name: /^Sửa "/ })).toBeNull();
    expect(screen.queryByRole('link', { name: /^Tạo bài từ file/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Chia sẻ "/ })).toBeNull();
    expect(
      screen.getByText('Chọn bài để phát, hoặc nhập file ký tự .harm / .txt / .json.'),
    ).toBeTruthy();
    expect(createActions()).toEqual([
      'Nhập file ký tự (.harm / .txt / .json)',
      'Tự chơi để tạo bài',
    ]);
    // Ghi chú định dạng riêng vẫn có, nhưng không chỉ tới file MIDI (nút "Tạo bài từ file" đang ẩn).
    const hint = screen.getByText(/Định dạng chữ riêng của app/);
    expect(hint.textContent).not.toMatch(/Tạo bài từ file|MIDI/);
    // Không có lối nào dẫn vào route placeholder.
    const deadLinks = Array.from(document.querySelectorAll('a[href]'))
      .map((a) => a.getAttribute('href') ?? '')
      .filter((h) => /^#\/(edit|midi|s|ai)(\/|$)/.test(h));
    expect(deadLinks).toEqual([]);
  });

  it('bật cờ editor / midiImport: hiện link Sửa, "Tạo bài với AI" và "Tạo bài từ file" (MIDI + MusicXML)', () => {
    Object.assign(flags, { editor: true, midiImport: true });
    render(<LibraryView />);
    const card1 = screen.getByRole('listitem', { name: SEED_1 });
    const edit = within(card1).getByRole('link', { name: `Sửa "${SEED_1}"` });
    expect(edit.getAttribute('href')).toBe(href(paths.edit('seed-quoc-ca-viet-nam')));
    const fromFile = screen.getByRole('link', { name: 'Tạo bài từ file MIDI / MusicXML' });
    expect(fromFile.getAttribute('href')).toBe(href(paths.midi()));
    expect(screen.queryByRole('link', { name: 'Tạo bài từ MIDI' })).toBeNull();
    // "Tạo bài với AI" thay "Tạo bài mới thủ công" (góp ý 2026-10-16): link sang trang #/ai
    expect(screen.getByRole('link', { name: 'Tạo bài với AI' }).getAttribute('href')).toBe(
      href(paths.ai()),
    );
    expect(screen.queryByRole('button', { name: 'Tạo bài mới thủ công' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Bài mới' })).toBeNull();
    // "Tự chơi để tạo bài" (trước chỉ có ở ☰ Menu)
    expect(screen.getByRole('link', { name: 'Tự chơi để tạo bài' }).getAttribute('href')).toBe(
      href(paths.record()),
    );
  });

  it('"Thêm bài": 4 cách theo thứ tự, "Tạo bài với AI" đầu; mỗi cách một dòng giải thích', () => {
    Object.assign(flags, { editor: true, midiImport: true });
    render(<LibraryView />);
    expect(screen.getByRole('heading', { level: 2, name: 'Thêm bài' })).toBeTruthy();
    expect(createActions()).toEqual([
      'Tạo bài với AI',
      'Tạo bài từ file MIDI / MusicXML',
      'Nhập file ký tự (.harm / .txt / .json)',
      'Tự chơi để tạo bài',
    ]);
    const hintOf = (el: HTMLElement) =>
      document.getElementById(el.getAttribute('aria-describedby') ?? '')?.textContent ?? '';
    expect(hintOf(screen.getByRole('link', { name: 'Tạo bài với AI' }))).toBe(
      'Gửi ảnh sheet nhạc / cảm âm cho ChatGPT, Claude hoặc Gemini rồi dán câu trả lời vào app — app tự đổi sang phím trong game, tông dễ chơi nhất.',
    );
    expect(hintOf(screen.getByRole('link', { name: 'Tạo bài từ file MIDI / MusicXML' }))).toBe(
      'App gợi ý track / bè giai điệu, tự chọn cung và chia dòng; bài mở trong Editor dạng nháp.',
    );
    expect(hintOf(screen.getByRole('link', { name: 'Tự chơi để tạo bài' }))).toBe(
      'Bấm phím (hoặc chạm nút) như trong game, app ghi lại thành bài.',
    );
    // dòng fan-made cuối trang (trước nằm trong ☰ Menu)
    expect(
      screen.getByText('Fan-made · không liên kết với nhà phát hành Delta Force').tagName,
    ).toBe('FOOTER');
  });

  it('ghi chú cạnh "Nhập file ký tự": định dạng riêng của app, không phải MIDI / MusicXML', () => {
    flags.midiImport = true;
    render(<LibraryView />);
    const importBtn = screen.getByRole('button', {
      name: 'Nhập file ký tự (.harm / .txt / .json)',
    });
    const hintId = importBtn.getAttribute('aria-describedby') ?? '';
    const hint = document.getElementById(hintId);
    expect(hint?.textContent).toBe(
      'Định dạng chữ riêng của app (từ nút Xuất, hoặc tự gõ) — không phải file nhạc MIDI / MusicXML. Cú pháp .harm',
    );
    // "Cú pháp .harm" dẫn tới mục "Cú pháp .harm" của trang Hướng dẫn (D-260; bản đầy đủ ở
    // docs/REFERENCE.md, không hiện trong app).
    expect(
      within(hint as HTMLElement)
        .getByRole('link', { name: 'Cú pháp .harm' })
        .getAttribute('href'),
    ).toBe(href(paths.guide('readme', 'cú-pháp-harm')));
    // hiện ra (không sr-only), cùng ô với nút Nhập file; mục MIDI có dòng giải thích riêng
    expect(hint?.className).not.toContain('sr-only');
    expect(hint?.closest('.library-create-item')?.contains(importBtn)).toBe(true);
    expect(
      screen
        .getByRole('link', { name: 'Tạo bài từ file MIDI / MusicXML' })
        .getAttribute('aria-describedby'),
    ).not.toBe(hintId);
  });

  it('EN: action names + hints', () => {
    Object.assign(flags, { editor: true, midiImport: true });
    useSettings.setState({ language: 'en' });
    render(<LibraryView />);
    expect(screen.getByRole('link', { name: 'Create from a MIDI / MusicXML file' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Play to create a song' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Create with AI' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Create a song manually' })).toBeNull();
    const importBtn = screen.getByRole('button', {
      name: 'Import a text file (.harm / .txt / .json)',
    });
    expect(
      document.getElementById(importBtn.getAttribute('aria-describedby') ?? '')?.textContent,
    ).toContain("This app's own text format");
    expect(screen.getByText(/^Fan-made · not affiliated/)).toBeTruthy();
  });

  it('search không phân biệt dấu / hoa thường, có trạng thái rỗng', () => {
    render(<LibraryView />);
    fireEvent.change(searchBox(), { target: { value: 'quoc ca viet' } });
    expect(cardTitles()).toEqual([SEED_1]);
    expect(screen.getByText(`1/${SEED_TITLES.length} bài`)).toBeTruthy();

    // theo tác giả
    fireEvent.change(searchBox(), { target: { value: 'N2UTHE' } });
    expect(cardTitles()).toEqual([SEED_2]);

    fireEvent.change(searchBox(), { target: { value: 'không có bài này' } });
    expect(cardTitles()).toEqual([]);
    expect(screen.getByText('Không có bài nào khớp "không có bài này".')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Xóa tìm kiếm' }));
    expect(cardTitles()).toHaveLength(SEED_TITLES.length);
    // Nút "Xóa tìm kiếm" đã biến mất → focus về ô tìm kiếm, không rơi về <body>.
    expect(document.activeElement).toBe(searchBox());
  });

  it('xóa bài user cần xác nhận; hủy thì giữ lại', () => {
    const id = useLibrary.getState().addSong('@title Bài của tôi\n@artist Tôi\nZ');
    render(<LibraryView />);
    expect(cardTitles()).toEqual([...SEED_TITLES, 'Bài của tôi']);
    const card = screen.getByRole('listitem', { name: 'Bài của tôi' });
    expect(within(card).getByText('Của bạn')).toBeTruthy();

    // Chỉ bài user có nút Xóa.
    expect(screen.getAllByRole('button', { name: /^Xóa "/ })).toHaveLength(1);

    fireEvent.click(within(card).getByRole('button', { name: 'Xóa "Bài của tôi"' }));
    let dialog = screen.getByRole('dialog', { name: 'Xóa bài hát?' });
    // Xác nhận xóa: focus mặc định ở nút an toàn (Hủy).
    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Hủy' }));
    expect(
      within(dialog).getByText('Xóa "Bài của tôi" khỏi thư viện? Không thể hoàn tác.'),
    ).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Hủy' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(getSong(id)).not.toBeNull();

    fireEvent.click(within(card).getByRole('button', { name: 'Xóa "Bài của tôi"' }));
    dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Xóa' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(getSong(id)).toBeNull();
    expect(cardTitles()).toEqual(SEED_TITLES);
    expect(toastTexts()).toContain('Đã xóa "Bài của tôi"');
    expect(document.activeElement).toBe(searchBox());
  });

  it('nhân bản seed tạo bài user "(bản sao)"', () => {
    render(<LibraryView />);
    fireEvent.click(screen.getByRole('button', { name: `Nhân bản "${SEED_1}"` }));
    expect(useLibrary.getState().songs).toHaveLength(1);
    expect(cardTitles()).toContain(`${SEED_1} (bản sao)`);
    expect(toastTexts()).toContain(`Đã tạo bản sao "${SEED_1} (bản sao)"`);
  });

  it('export .harm / .json gọi downloadText với tên file không dấu', () => {
    render(<LibraryView />);
    fireEvent.click(screen.getByRole('button', { name: `Xuất "${SEED_1}" dạng file .harm` }));
    expect(vi.mocked(downloadText)).toHaveBeenLastCalledWith(
      'quoc-ca-viet-nam.harm',
      SEED_SONGS[0]!.source,
      'text/plain',
    );
    fireEvent.click(screen.getByRole('button', { name: `Xuất "${SEED_2}" dạng file .json` }));
    const call = vi.mocked(downloadText).mock.lastCall;
    expect(call?.[0]).toBe('takediskrush.json');
    expect(call?.[2]).toBe('application/json');
    expect(JSON.parse(call?.[1] ?? '{}')).toMatchObject({ format: 'dfht-song', version: 1 });
  });

  it('badge lỗi + danh sách dòng bị lỗi (Phase 1 không có Editor để xem)', () => {
    useLibrary.getState().addSong('@title Hỏng\n!!ERR');
    render(<LibraryView />);
    const card = screen.getByRole('listitem', { name: 'Hỏng' });
    const badge = within(card).getByText('1 lỗi');
    expect(badge.getAttribute('title')).not.toMatch(/Sửa/);
    expect(card.querySelector('details.library-card-errors')).not.toBeNull();
    expect(within(card).getByText('Xem dòng bị lỗi').tagName).toBe('SUMMARY');
    expect(within(card).getByText('Dòng 2, cột 3: Token lạ: "!!ERR"').tagName).toBe('LI');
    expect(
      within(card).getByText('Xuất file .harm, sửa bằng trình soạn văn bản rồi nhập lại.'),
    ).toBeTruthy();

    // Bài không lỗi: không có danh sách.
    const ok = screen.getByRole('listitem', { name: SEED_1 });
    expect(ok.querySelector('details')).toBeNull();
  });

  it('nhập bài lỗi: toast không chỉ tới nút Sửa không tồn tại', async () => {
    render(<LibraryView />);
    const input = screen.getByLabelText('Chọn file .harm, .json hoặc .txt để nhập');
    fireEvent.change(input, { target: { files: [new File(['@title X\n!!ERR'], 'x.harm')] } });
    await waitFor(() =>
      expect(toastTexts()).toContain(
        '1 bài vừa nhập có lỗi cú pháp — bấm "Xem dòng bị lỗi" trên thẻ bài',
      ),
    );
    expect(toastTexts().join('\n')).not.toMatch(/Sửa/);
  });

  it('EN: số ít / số nhiều ("Imported 1 song", "1 error")', async () => {
    useSettings.setState({ language: 'en' });
    useLibrary.getState().addSong('@title Broken\n!!ERR');
    render(<LibraryView />);
    const card = screen.getByRole('listitem', { name: 'Broken' });
    expect(within(card).getByText('1 error')).toBeTruthy();
    expect(screen.getByText(`${SEED_TITLES.length + 1} songs`)).toBeTruthy();
    const input = screen.getByLabelText('Choose .harm, .json or .txt files to import');
    fireEvent.change(input, { target: { files: [new File(['@title Y\nZ'], 'y.harm')] } });
    await waitFor(() => expect(toastTexts()).toContain('Imported 1 song'));
  });

  it('bài không có title hiện "Chưa đặt tên"', () => {
    useLibrary.getState().addSong('Z X');
    render(<LibraryView />);
    expect(cardTitles()).toContain('Chưa đặt tên');
  });

  it('nhập file qua input: thêm bài + toast, báo lỗi file hỏng', async () => {
    render(<LibraryView />);
    const input = screen.getByLabelText('Chọn file .harm, .json hoặc .txt để nhập');
    const good = new File(['@title Nhập vào\nZ'], 'a.harm');
    const bad = new File(['{oops'], 'b.json');
    fireEvent.change(input, { target: { files: [good, bad] } });
    await waitFor(() => expect(useLibrary.getState().songs).toHaveLength(1));
    expect(cardTitles()).toContain('Nhập vào');
    await waitFor(() => expect(toastTexts()).toContain('Đã nhập 1 bài'));
    expect(toastTexts()).toContain('b.json: JSON không hợp lệ');
  });

  it('kéo thả file lên trang: hiện lớp phủ, thả thì nhập', async () => {
    render(<LibraryView />);
    const file = new File(['@title Kéo thả\nZ'], 'k.harm');
    const dataTransfer = { types: ['Files'], files: [file], dropEffect: 'none' };
    act(() => {
      fireEvent.dragEnter(window, { dataTransfer });
    });
    expect(screen.getByText('Thả file để nhập vào thư viện')).toBeTruthy();
    act(() => {
      fireEvent.drop(window, { dataTransfer });
    });
    expect(screen.queryByText('Thả file để nhập vào thư viện')).toBeNull();
    await waitFor(() => expect(cardTitles()).toContain('Kéo thả'));
  });

  it('kéo thứ không phải file thì bỏ qua', () => {
    render(<LibraryView />);
    act(() => {
      fireEvent.dragEnter(window, { dataTransfer: { types: ['text/plain'], files: [] } });
    });
    expect(screen.queryByText('Thả file để nhập vào thư viện')).toBeNull();
  });

  it('đổi ngôn ngữ EN', () => {
    useSettings.setState({ language: 'en' });
    render(<LibraryView />);
    expect(screen.getByRole('heading', { level: 1, name: 'Song library' })).toBeTruthy();
    expect(screen.getAllByText('Seed')).toHaveLength(SEED_TITLES.length);
  });
});

describe('LibraryView — Chia sẻ', () => {
  // Clipboard giả (không đụng clipboard thật của máy).
  const writeText = vi.fn<(text: string) => Promise<void>>();

  beforeEach(() => {
    flags.share = true;
    writeText.mockReset();
    writeText.mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  });

  afterEach(() => {
    Reflect.deleteProperty(navigator, 'clipboard');
    Reflect.deleteProperty(document, 'execCommand');
  });

  const shareButton = (title: string) =>
    within(screen.getByRole('listitem', { name: title })).getByRole('button', {
      name: `Chia sẻ "${title}" (sao chép link)`,
    });

  it('mỗi thẻ có nút "Chia sẻ": copy link #/s/… mở lại đúng bài + toast', async () => {
    render(<LibraryView />);
    expect(screen.getAllByRole('button', { name: /^Chia sẻ "/ })).toHaveLength(SEED_TITLES.length);
    const btn = shareButton(SEED_1);
    expect(btn.textContent).toBe('Chia sẻ');
    fireEvent.click(btn);
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const url = writeText.mock.lastCall?.[0] ?? '';
    const source = SEED_SONGS[0]!.source;
    expect(url).toBe(buildShareUrl(source, window.location));
    expect(url.startsWith(`${window.location.origin}${window.location.pathname}#/s/`)).toBe(true);
    expect(decodeShareData(url.slice(url.indexOf('#/s/') + 4))).toBe(source);
    await waitFor(() =>
      expect(toastTexts()).toContain(`Đã sao chép link chia sẻ "${SEED_1}" — dán vào chat để gửi`),
    );
    // link ngắn: không cảnh báo
    expect(useToasts.getState().toasts.filter((t) => t.kind === 'error')).toEqual([]);
    // không điều hướng
    expect(window.location.hash).toBe('');
  });

  it('bài user cũng chia sẻ được; link quá dài thì cảnh báo thêm', async () => {
    // Nguồn giả ngẫu nhiên (khó nén) để link vượt giới hạn mềm.
    let seed = 7;
    let big = '@title To\n';
    for (let i = 0; i < 12000; i++) {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      big += `${'ZXCVBNM,'[(seed >>> 16) % 8]}*${((seed >>> 19) % 7) + 1} `;
      if (i % 12 === 11) big += '\n';
    }
    useLibrary.getState().addSong(big);
    render(<LibraryView />);
    fireEvent.click(shareButton('To'));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const url = writeText.mock.lastCall?.[0] ?? '';
    expect(url.length).toBeGreaterThan(SHARE_URL_SOFT_LIMIT);
    await waitFor(() =>
      expect(toastTexts()).toContain(
        `Link dài ${url.length} ký tự — một số app chat có thể cắt mất. Nên gửi file .harm (nút Xuất).`,
      ),
    );
    expect(toastTexts()).toContain('Đã sao chép link chia sẻ "To" — dán vào chat để gửi');
  });

  it('clipboard bị chặn → toast lỗi, không báo đã sao chép', async () => {
    writeText.mockRejectedValue(new Error('denied'));
    Object.defineProperty(document, 'execCommand', { value: () => false, configurable: true });
    render(<LibraryView />);
    fireEvent.click(shareButton(SEED_2));
    await waitFor(() =>
      expect(toastTexts()).toContain('Không sao chép được link — trình duyệt chặn clipboard'),
    );
    expect(toastTexts().join('\n')).not.toMatch(/Đã sao chép/);
  });

  it('bài rỗng: không tạo link hỏng', async () => {
    useLibrary.getState().addSong('   \n');
    render(<LibraryView />);
    fireEvent.click(shareButton('Chưa đặt tên'));
    await waitFor(() =>
      expect(toastTexts()).toContain('"Chưa đặt tên" chưa có nội dung để chia sẻ'),
    );
    expect(writeText).not.toHaveBeenCalled();
  });

  it('EN', async () => {
    useSettings.setState({ language: 'en' });
    render(<LibraryView />);
    const card = screen.getByRole('listitem', { name: SEED_1 });
    const btn = within(card).getByRole('button', { name: `Share "${SEED_1}" (copy link)` });
    expect(btn.textContent).toBe('Share');
    fireEvent.click(btn);
    await waitFor(() =>
      expect(toastTexts()).toContain(
        `Share link for "${SEED_1}" copied — paste it into a chat to send`,
      ),
    );
  });
});

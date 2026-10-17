import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { decodeShareData } from '../core/share';
import { getSong, useLibrary } from '../library/store';
import type { LibraryEntry } from '../library/store';
import { parseLocation } from '../ui/router';
import { useSettings } from '../ui/settings';
import { ObsLinkModal } from './ObsLinkModal';
import { OBS_LINK_PREFS_KEY, readObsLinkPrefs } from './obsLinkPrefs';
import { parseOverlayParams } from './overlayParams';

// Khối "Gửi thẳng vào OBS" là việc của obs-websocket (ObsConnectPanel) — ở đây chỉ kiểm link nó nhận.
vi.mock('./ObsConnectPanel', () => ({
  ObsConnectPanel: ({ overlayUrl }: { overlayUrl: string }) => (
    <div data-testid="obs-connect" data-url={overlayUrl} />
  ),
}));

const SEED = 'seed-quoc-ca-viet-nam';
const writeText = vi.fn<(text: string) => Promise<void>>();

function entry(id: string): LibraryEntry {
  const e = getSong(id);
  if (!e) throw new Error(`missing ${id}`);
  return e;
}

function open(song?: LibraryEntry | null) {
  return render(<ObsLinkModal open onClose={() => {}} song={song} />);
}

const dialog = () => screen.getByRole('dialog', { name: 'Tạo link OBS' });
const urlBox = () =>
  within(dialog()).getByRole('textbox', { name: 'Link overlay' }) as HTMLTextAreaElement;
const base = () => `${window.location.origin}${window.location.pathname}`;

/** Query của link (sau `#/overlay…?`) đã đọc bằng parser của overlay. */
function linkParams(url: string) {
  const parsed = parseLocation(url.slice(url.indexOf('#')), '');
  return { route: parsed.route, params: parseOverlayParams(parsed.query) };
}

beforeEach(() => {
  useSettings.getState().reset();
  localStorage.removeItem(OBS_LINK_PREFS_KEY);
  writeText.mockReset();
  writeText.mockResolvedValue(undefined);
  // Clipboard giả (không bao giờ đụng clipboard thật).
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const s of useLibrary.getState().songs) useLibrary.getState().removeSong(s.id);
});

describe('ObsLinkModal', () => {
  it('bài của Player: link cả canvas, nền trong suốt, kèm ảnh chụp Cài đặt; không chỉnh gì của Player', () => {
    open(entry(SEED));
    const d = within(dialog());
    expect(d.getByText('Quốc ca Việt Nam')).toBeTruthy();
    expect(
      d.getByText(
        'Overlay chỉ hiển thị — chạy theo màn chơi (Phát / tạm dừng / tua / tempo / kiểu điều khiển; cả Cửa sổ nổi khi đang mở). Chỉnh ở màn chơi.',
      ),
    ).toBeTruthy();
    const url = urlBox().value;
    expect(url.startsWith(`${base()}#/overlay/${SEED}?layout=game&fit=canvas`)).toBe(true);
    const { route, params } = linkParams(url);
    expect(route).toEqual({ name: 'overlay', id: SEED });
    // Mặc định Cài đặt: đếm vào bật, chờ 3 giây, nhãn phụ ẩn, tiếng Việt, theme tối.
    expect(params).toMatchObject({
      fit: 'canvas',
      bg: 'transparent',
      layout: 'game',
      scheme: 'pc',
      countIn: true,
      delaySec: 3,
      subLabel: 'none',
      lang: 'vi',
      theme: 'dark',
      scale: 1,
      preview: false,
    });
    expect(
      (d.getByRole('radio', { name: /Khớp bảng phím game/ }) as HTMLInputElement).checked,
    ).toBe(true);
    // Đã bỏ: ô chọn bài, kiểu điều khiển, lookahead, chờ, tự chạy, lặp, đếm vào, nền, bảng kích thước.
    expect(d.queryByRole('combobox')).toBeNull();
    expect(d.queryByRole('switch')).toBeNull();
    expect(d.queryByRole('radio', { name: /Xanh chroma|Trong suốt/ })).toBeNull();
    expect(d.queryByRole('slider', { name: /Chờ trước khi chạy|Số beat/ })).toBeNull();
    expect(d.queryByRole('table')).toBeNull();
    expect(url).not.toMatch(/autoplay|loop=|lyrics/);
  });

  it('bài người dùng: LUÔN nhúng data= (không id), giải mã ra đúng nguồn', () => {
    const source = '@title Bài của tôi\n@bpm 90\nZ X C V B';
    const id = useLibrary.getState().addSong(source);
    open(entry(id));
    const url = urlBox().value;
    expect(url.startsWith(`${base()}#/overlay?layout=game&fit=canvas`)).toBe(true);
    expect(url).not.toContain(id);
    const { route, params } = linkParams(url);
    expect(route).toEqual({ name: 'overlay', id: '' });
    expect(decodeShareData(params.data ?? '')).toBe(source);
  });

  it('ảnh chụp Cài đặt của Player đi vào link (overlay trong OBS không thấy Cài đặt)', () => {
    useSettings.getState().set({
      controlScheme: 'mobile',
      mobileSemitone: 'oneShot',
      labelOverrides: { left: '', right: '', natural: 'Giữa', scroll: 'Thăng' },
      lookahead: 6,
      tileScale: 1.25,
      subLabel: 'number',
      countIn: false,
      startDelaySec: 5,
      language: 'vi',
      theme: 'light',
    });
    open(entry(SEED));
    expect(linkParams(urlBox().value).params).toMatchObject({
      scheme: 'mobile',
      semitone: 'oneShot',
      names: { left: '', right: '', natural: 'Giữa', scroll: 'Thăng' },
      lookahead: 6,
      tileScale: 1.25,
      subLabel: 'number',
      countIn: false,
      delaySec: 5,
      theme: 'light',
    });
  });

  it('kiểu overlay, độ đậm, tinh chỉnh cỡ UI game vào link; đổi kiểu đặt lại độ đậm', () => {
    open(entry(SEED));
    const d = within(dialog());
    const opacity = d.getByRole('slider', { name: /Độ đậm của ô/ }) as HTMLInputElement;
    expect(opacity.value).toBe('0.85');
    expect(
      document.getElementById(opacity.getAttribute('aria-describedby') ?? '')?.textContent,
    ).toBe('Thấp hơn = thấy hình game phía sau ô rõ hơn.');
    fireEvent.change(opacity, { target: { value: '0.6' } });
    expect(linkParams(urlBox().value).params.opacity).toBe(0.6);

    const ui = d.getByRole('slider', { name: /Cỡ giao diện game/ });
    expect(ui.getAttribute('aria-valuetext')).toBe('100%');
    fireEvent.change(ui, { target: { value: '1.1' } });
    expect(linkParams(urlBox().value).params.scale).toBe(1.1);
    expect(ui.getAttribute('aria-valuetext')).toBe('110%');

    fireEvent.click(d.getByRole('radio', { name: /Dải ngang trên bảng phím/ }));
    expect(linkParams(urlBox().value).params).toMatchObject({
      layout: 'full',
      lanes: 'horizontal',
      gamebar: false,
      opacity: 1,
      fit: 'canvas',
      scale: 1.1,
    });
    fireEvent.click(d.getByRole('radio', { name: /Cột đầy đủ có game bar/ }));
    expect(linkParams(urlBox().value).params).toMatchObject({
      layout: 'full',
      lanes: 'vertical',
      gamebar: true,
    });
  });

  it('nhớ kiểu overlay / độ đậm / cỡ UI game: mở lại hộp thoại giữ đúng giá trị đã căn (R5)', () => {
    const first = open(entry(SEED));
    const d = within(dialog());
    fireEvent.click(d.getByRole('radio', { name: /Dải ngang trên bảng phím/ }));
    fireEvent.change(d.getByRole('slider', { name: /Độ đậm của ô/ }), { target: { value: '0.7' } });
    fireEvent.change(d.getByRole('slider', { name: /Cỡ giao diện game/ }), {
      target: { value: '1.1' },
    });
    const tuned = urlBox().value;
    first.unmount();
    expect(readObsLinkPrefs()).toEqual({ preset: 'strip', opacity: 0.7, uiScale: 1.1 });
    open(entry(SEED));
    const again = within(dialog());
    expect(
      (again.getByRole('radio', { name: /Dải ngang trên bảng phím/ }) as HTMLInputElement).checked,
    ).toBe(true);
    expect(urlBox().value).toBe(tuned);
    expect(linkParams(tuned).params).toMatchObject({
      lanes: 'horizontal',
      opacity: 0.7,
      scale: 1.1,
    });
  });

  it('hai cách theo thứ tự: Gửi thẳng vào OBS (nhận đúng link) → Browser Source thủ công; rồi Xem trước (R6: bỏ Window Capture)', () => {
    open(entry(SEED));
    const d = within(dialog());
    const direct = d.getByRole('region', { name: 'Gửi thẳng vào OBS (khuyên dùng)' });
    const manual = d.getByRole('region', { name: 'Browser Source thủ công' });
    const preview = d.getByRole('button', { name: 'Xem trước' });
    expect(direct.compareDocumentPosition(manual) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(manual.compareDocumentPosition(preview) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(direct).getByTestId('obs-connect').getAttribute('data-url')).toBe(urlBox().value);
    expect(within(manual).getByRole('textbox', { name: 'Link overlay' })).toBeTruthy();
    // 3 bước ngắn + ghi chú thật: tự phát một lần mỗi khi OBS tải / refresh source.
    const manualSteps = within(manual).getAllByRole('listitem');
    expect(manualSteps).toHaveLength(3);
    expect(manualSteps[2].textContent).toContain('1920 × 1080');
    expect(manualSteps[2].textContent).toContain('2560 × 1440');
    expect(manualSteps[2].textContent).toContain('tự nằm đúng trên bảng phím game');
    expect(manual.textContent).toContain('chạy một mình');
    expect(manual.textContent).toContain('một lần mỗi khi OBS tải / refresh source');
    // Xem trước: giải thích ngay cạnh nút — chỉ để xem, không dùng để quay.
    expect(
      document.getElementById(preview.getAttribute('aria-describedby') ?? '')?.textContent,
    ).toMatch(/không dùng để quay/);
    // Không còn Window Capture / chroma / Toàn màn hình / Mở thử ở bất cứ đâu trong hộp thoại.
    expect(dialog().textContent).not.toMatch(/Window Capture|Chroma|chroma|Toàn màn hình|Mở thử/);
    expect(d.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual([
      'Hiển thị',
      'Gửi thẳng vào OBS (khuyên dùng)',
      'Browser Source thủ công',
    ]);
  });

  it('Sao chép link: ghi đúng URL vào clipboard (giả) + thông báo; lỗi clipboard → báo lỗi', async () => {
    open(entry(SEED));
    const url = urlBox().value;
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Sao chép link' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(url));
    expect(
      await within(dialog()).findByText(`Đã sao chép link OBS (dài ${url.length} ký tự).`),
    ).toBeTruthy();
    // Đổi option → thông báo cũ biến mất.
    fireEvent.click(within(dialog()).getByRole('radio', { name: /Cột đầy đủ/ }));
    expect(within(dialog()).queryByText(/Đã sao chép link OBS/)).toBeNull();

    writeText.mockRejectedValue(new Error('denied'));
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Sao chép link' }));
    expect(await within(dialog()).findByText(/Không sao chép được/)).toBeTruthy();
  });

  it('Xem trước: cửa sổ 960×540 = link của Browser Source + preview=1 (nền tối, không chroma); bị chặn popup → báo cạnh nút', () => {
    const win = { opener: {} as unknown } as Window;
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(win);
    open(entry(SEED));
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Xem trước' }));
    expect(openSpy).toHaveBeenCalledTimes(1);
    const [previewUrl, target, features] = openSpy.mock.calls[0] as [string, string, string];
    expect(target).toBe('_blank');
    expect(features).toBe('popup=yes,width=960,height=540');
    expect(previewUrl).toContain('&preview=1');
    expect(previewUrl.replace('&preview=1', '')).toBe(urlBox().value);
    const { route, params } = linkParams(previewUrl);
    expect(route).toEqual({ name: 'overlay', id: SEED });
    expect(params).toMatchObject({
      preview: true,
      bg: 'transparent',
      fit: 'canvas',
      layout: 'game',
    });
    expect(win.opener).toBeNull();
    // Link để dán vào OBS không bao giờ là bản xem trước.
    expect(linkParams(urlBox().value).params.preview).toBe(false);

    openSpy.mockReturnValue(null);
    act(() => {
      fireEvent.click(within(dialog()).getByRole('button', { name: 'Xem trước' }));
    });
    const row = within(dialog()).getByRole('button', { name: 'Xem trước' }).parentElement;
    expect(row && within(row).getByText(/Trình duyệt chặn cửa sổ mới/)).toBeTruthy();
  });

  it('link dài (> 8000 ký tự) → cảnh báo', () => {
    // Nốt / tên section giả ngẫu nhiên (cố định) để lz-string không nén được nhiều.
    let seed = 7;
    const rnd = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed;
    };
    const word = () =>
      Array.from({ length: 6 }, () => String.fromCharCode(97 + (rnd() % 26))).join('');
    const keys = ['Z', 'X', 'C', 'V', 'B', 'N', 'M', ','];
    const lines = Array.from(
      { length: 600 },
      () =>
        `// ${word()} ${word()} ${word()}\n${Array.from({ length: 6 }, () => keys[rnd() % 8]).join(' ')}`,
    );
    const id = useLibrary.getState().addSong(`@title Dài\n${lines.join('\n')}`);
    open(entry(id));
    const n = urlBox().value.length;
    expect(n).toBeGreaterThan(8000);
    expect(within(dialog()).getByText(`Link dài ${n} ký tự`, { exact: false })).toBeTruthy();
  });

  it('bài không có nốt: cảnh báo, tắt Sao chép / Xem trước', () => {
    const id = useLibrary.getState().addSong('@title Trống\n_ _');
    open(entry(id));
    expect(within(dialog()).getByText('Bài "Trống" chưa có nốt nào.')).toBeTruthy();
    expect(
      (within(dialog()).getByRole('button', { name: 'Sao chép link' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(
      (within(dialog()).getByRole('button', { name: 'Xem trước' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('không có bài: chỉ nhắc mở bài trong Player', () => {
    open(null);
    expect(
      within(dialog()).getByText('Mở một bài ở màn chơi rồi bấm nút "OBS" ở đó.'),
    ).toBeTruthy();
    expect(within(dialog()).queryByRole('textbox')).toBeNull();
  });

  it('EN', () => {
    useSettings.setState({ language: 'en' });
    open(entry(SEED));
    expect(screen.getByRole('dialog', { name: 'Create OBS link' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Copy link' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: /Match the in-game key panel/ })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Send straight to OBS (recommended)' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Preview' })).toBeTruthy();
    const box = screen.getByRole('textbox', { name: 'Overlay link' }) as HTMLTextAreaElement;
    expect(linkParams(box.value).params.lang).toBe('en');
  });
});

/**
 * Màn chơi sau góp ý 2026-10-15 (B): `#/` = màn chơi đầy đủ với bài mẫu; header có ngôn ngữ + theme ở
 * góc phải; thân 3 cột (phím tắt đầy đủ · khu tiles · thanh dọc Kiểu điều khiển / Cửa sổ nổi / OBS /
 * Chia sẻ / Cài đặt); thanh tiến độ ở đáy; không còn nút Sửa. Kèm các test Phase 2c còn hiệu lực (Chia sẻ,
 * huy hiệu "Đang phát giai điệu", thanh điều khiển chỉ có nút loa của giai điệu mẫu, kiểu Mobile trong Player).
 * performance.now giả, rAF chạy tay, audio engine mock (không hỗ trợ), clipboard giả.
 */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { decodeShareData } from '../core/share';
import { HomeView } from '../home/HomeView';
import { useLibrary } from '../library/store';
import { readLastPlayed, rememberLastPlayed } from '../ui/lastPlayed';
import { useSettings } from '../ui/settings';
import { useToasts } from '../ui/toast';
import { PlayerView } from './PlayerView';

vi.mock('../audio/engine', () => ({
  isAudioSupported: () => false,
  getAudioEngine: () => {
    throw new Error('audio engine must not be used when unsupported');
  },
  hasStickyActivation: () => false,
  UNLOCK_TIMEOUT_MS: 1000,
}));

const SEED = 'seed-takediskrush';

let frames = new Map<number, FrameRequestCallback>();
let nextFrame = 1;
let nowMs = 0;
const added: string[] = [];
let writeText: ReturnType<typeof vi.fn>;

function flushFrames(): void {
  const list = Array.from(frames.values());
  frames.clear();
  act(() => list.forEach((cb) => cb(0)));
}

/** Tiến đồng hồ (performance.now) `ms` rồi chạy 1 frame. */
function advance(ms: number): void {
  nowMs += ms;
  flushFrames();
}

function press(code: string, init: KeyboardEventInit = {}): void {
  act(() => {
    fireEvent.keyDown(window, { code, ...init });
    fireEvent.keyUp(window, { code, ...init });
  });
}

/** Bài ngắn 120 BPM: Z X C V (0.5 s mỗi nốt, 2 s cả bài). */
function addShortSong(source = '@title Ngắn\n@bpm 120\nZ X C V\n'): string {
  const id = useLibrary.getState().addSong(source);
  added.push(id);
  return id;
}

const sideBar = () => screen.getByRole('complementary', { name: 'Công cụ màn chơi' });
const shortcutsColumn = () => screen.getByRole('complementary', { name: 'Phím tắt và cách bấm' });

/** Tên hiển thị của các control trong thanh dọc, theo thứ tự DOM. */
function sideBarItems(): string[] {
  return Array.from(sideBar().querySelectorAll<HTMLElement>('button, a')).map((el) =>
    (el.querySelector('.psb-label, .pip-toggle-label')?.textContent ?? el.textContent ?? '').trim(),
  );
}

beforeEach(() => {
  frames = new Map();
  nextFrame = 1;
  nowMs = 1000;
  vi.stubGlobal(
    'requestAnimationFrame',
    vi.fn((cb: FrameRequestCallback) => {
      const id = nextFrame++;
      frames.set(id, cb);
      return id;
    }),
  );
  vi.stubGlobal(
    'cancelAnimationFrame',
    vi.fn((id: number) => frames.delete(id)),
  );
  vi.spyOn(performance, 'now').mockImplementation(() => nowMs);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => null);
  // Clipboard giả (không đụng clipboard thật).
  writeText = vi.fn(async () => undefined);
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText },
    configurable: true,
  });
  useSettings.getState().reset();
  // mặc định v4 đếm ngược 3 giây — các test cần phát ngay
  useSettings.getState().set({ startDelaySec: 0 });
  useToasts.setState({ toasts: [] });
  rememberLastPlayed(null);
});

afterEach(() => {
  for (const id of added.splice(0)) useLibrary.getState().removeSong(id);
  Reflect.deleteProperty(navigator, 'clipboard');
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.location.hash = '';
});

describe('màn chơi — bố cục (góp ý 2026-10-15)', () => {
  it('#/ (HomeView) = màn chơi đầy đủ với bài mẫu: header, điều khiển, 3 cột, thanh tiến độ', () => {
    rememberLastPlayed(SEED);
    render(<HomeView />);
    // Bài mẫu của `#/` (DEMO_SONG_ID, góp ý 2026-10-16).
    expect(screen.getByRole('heading', { level: 1, name: 'Quốc ca Việt Nam' })).toBeTruthy();
    expect(screen.getByRole('group', { name: 'Điều khiển phát' })).toBeTruthy();
    expect(shortcutsColumn()).toBeTruthy();
    expect(sideBar()).toBeTruthy();
    expect(screen.getByRole('slider', { name: 'Vị trí trong bài' })).toBeTruthy();
    // Không còn bản chơi thử / menu ☰.
    expect(document.querySelector('.player-demo, .demo-start, .demo-menu')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Menu' })).toBeNull();
    // Màn mặc định → "Về màn chơi" của trang khác quay lại `#/`.
    expect(readLastPlayed()).toBeNull();
  });

  it('#/play/:id ghi nhớ bài cho nút "Về màn chơi"', () => {
    const id = addShortSong();
    render(<PlayerView songId={id} />);
    expect(readLastPlayed()).toBe(id);
  });

  it('header: "◂ Thư viện" bên trái, ngôn ngữ + theme ở góc phải (như các trang khác)', () => {
    render(<PlayerView songId={SEED} />);
    const header = document.querySelector('header.player-header') as HTMLElement;
    expect(within(header).getByRole('link', { name: 'Về thư viện' }).getAttribute('href')).toBe(
      '#/library',
    );
    const lang = within(header).getByRole('button', { name: 'Đổi ngôn ngữ (VI/EN)' });
    const theme = within(header).getByRole('button', { name: 'Đổi giao diện sáng/tối' });
    // Hai nút nằm sau tên bài (góc phải).
    const title = within(header).getByRole('heading', { level: 1 });
    expect(title.compareDocumentPosition(lang) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    act(() => lang.click());
    expect(useSettings.getState().language).toBe('en');
    act(() => theme.click());
    expect(useSettings.getState().theme).toBe('light');
    expect(screen.getByRole('complementary', { name: 'Player tools' })).toBeTruthy();
  });

  it('thanh dọc bên phải đúng thứ tự: Kiểu điều khiển PC | Mobile, Cửa sổ nổi, OBS, Chia sẻ, Cài đặt — không có Sửa', () => {
    render(<PlayerView songId={SEED} />);
    expect(sideBarItems()).toEqual(['PC', 'Mobile', 'Cửa sổ nổi', 'OBS', 'Chia sẻ', 'Cài đặt']);
    const scheme = within(sideBar()).getByRole('group', { name: 'Kiểu điều khiển' });
    expect(within(scheme).getByRole('button', { name: 'PC' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    expect(within(sideBar()).getByRole('link', { name: 'Cài đặt' }).getAttribute('href')).toBe(
      '#/settings',
    );
    expect(within(sideBar()).getByRole('button', { name: /^OBS/ })).toBeTruthy();
    // Nút "Sửa" đã bỏ khỏi màn chơi (chip lỗi vẫn có thể dẫn tới Editor).
    expect(screen.queryByRole('link', { name: /^Sửa/ })).toBeNull();
    expect(document.querySelector('a[href^="#/edit"]')).toBeNull();
  });

  it('nút Kiểu điều khiển ghi settings.controlScheme; Mobile: bàn nút + "Cửa sổ nổi" mở trang mini của bài này', () => {
    const id = addShortSong();
    render(<PlayerView songId={id} />);
    const scheme = within(sideBar()).getByRole('group', { name: 'Kiểu điều khiển' });
    act(() => within(scheme).getByRole('button', { name: 'Mobile' }).click());
    expect(useSettings.getState().controlScheme).toBe('mobile');
    expect(
      within(scheme).getByRole('button', { name: 'Mobile' }).getAttribute('aria-pressed'),
    ).toBe('true');
    expect(within(scheme).getByRole('button', { name: 'PC' }).getAttribute('aria-pressed')).toBe(
      'false',
    );
    expect(document.querySelector('.player-stage.is-mpad')).not.toBeNull();
    expect(document.querySelector('.player')?.classList.contains('is-mpad')).toBe(true);
    // Luyện tập kiểu Mobile chỉ bằng chạm bàn nút — gợi ý của nút không nói tới bàn phím.
    expect(screen.getByRole('button', { name: 'Luyện tập' }).title).toBe(
      'Chế độ luyện tập: chạm bàn nút trên màn hình (nút chế độ rồi nốt) để được chấm',
    );

    // Kiểu Mobile: "Cửa sổ nổi" hỏi trước Apple / Android (R7-6); Android = hộp thoại trang mini cho bài
    // đang mở, không ô chọn bài.
    const float = within(sideBar()).getByRole('button', { name: 'Cửa sổ nổi' });
    expect(float.getAttribute('aria-haspopup')).toBe('dialog');
    act(() => float.click());
    const chooser = screen.getByRole('dialog', { name: 'Cửa sổ nổi trên điện thoại' });
    expect(chooser.textContent).toContain('Điện thoại của bạn: Apple (iPhone / iPad) hay Android?');
    act(() => within(chooser).getByRole('button', { name: 'Android' }).click());
    const dialog = screen.getByRole('dialog', { name: 'Cửa sổ mini / video nổi (thử nghiệm)' });
    expect(within(dialog).queryByRole('combobox')).toBeNull();
    expect(within(dialog).getByRole('link', { name: 'Mở trang mini' }).getAttribute('href')).toBe(
      `#/mini/${id}`,
    );
    // Hộp thoại mở → phím tắt tạm nghỉ.
    press('Space', { key: ' ' });
    expect(document.querySelector('button.transport-play')?.getAttribute('data-playing')).toBe(
      'false',
    );
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(screen.queryByRole('dialog')).toBeNull();

    act(() => within(scheme).getByRole('button', { name: 'PC' }).click());
    expect(useSettings.getState().controlScheme).toBe('pc');
    // PC: "Cửa sổ nổi" = nút bật / tắt cửa sổ nổi Document PiP.
    expect(
      within(sideBar()).getByRole('button', { name: 'Cửa sổ nổi' }).getAttribute('aria-pressed'),
    ).toBe('false');
  });

  it('cột trái: danh sách phím tắt đầy đủ theo kiểu điều khiển + link Hướng dẫn', () => {
    useSettings
      .getState()
      .set({ labelOverrides: { left: 'Hạ', right: '', natural: '', scroll: '' } });
    render(<PlayerView songId={SEED} />);
    const col = shortcutsColumn();
    for (const text of [
      'Phát / Tạm dừng',
      'Phát lại từ đầu',
      'Dòng trước / dòng sau',
      'Loop A-B theo dòng (A → B → tắt)',
      'BPM −2 / +2',
      'Hủy đếm ngược',
    ]) {
      expect(within(col).getByText(text)).toBeTruthy();
    }
    const keys = Array.from(col.querySelectorAll('.shortcuts-notes kbd')).map((k) => k.textContent);
    expect(keys).toEqual(['Z', 'X', 'C', 'V', 'B', 'N', 'M', ',']);
    expect(within(col).getByText('Đồ')).toBeTruthy();
    expect(within(col).getByText('Đố')).toBeTruthy();
    // PC: chuột, tên gọi nút theo Cài đặt (D-181).
    expect(within(col).getByText('Giữ chuột trái')).toBeTruthy();
    expect(within(col).getByText('Hạ — hạ 1 quãng tám')).toBeTruthy();
    expect(within(col).getByText('Ngẩng Lên — lên 1 quãng tám')).toBeTruthy();
    expect(within(col).getByText('Nửa Cung — lên nửa cung (thăng)')).toBeTruthy();
    expect(col.textContent).toContain('Luyện tập: bấm phím thật + giữ chuột');
    expect(within(col).getByRole('link', { name: 'Xem hướng dẫn' }).getAttribute('href')).toBe(
      '#/guide',
    );

    act(() => useSettings.getState().set({ controlScheme: 'mobile' }));
    expect(col.querySelectorAll('.shortcuts-notes kbd')).toHaveLength(0);
    expect(col.querySelectorAll('.shortcuts-digit')).toHaveLength(8);
    expect(within(col).getByText('Chạm chế độ')).toBeTruthy();
    expect(within(col).getByText('Giữ nút số')).toBeTruthy();
    expect(col.textContent).toContain('Ngẩng Lên / Ngẩng Tự Nhiên / Hạ');
    expect(col.textContent).toContain('chỉ chạm / giữ bàn nút trên màn hình');
    expect(col.textContent).not.toContain('Giữ chuột trái');
  });

  it('nút "?" vẫn mở cùng danh sách trong hộp thoại (màn hẹp không có cột trái)', () => {
    render(<PlayerView songId={SEED} />);
    const help = screen.getByRole('button', { name: 'Phím tắt' });
    expect(help.closest('.transport-help')).not.toBeNull();
    act(() => help.click());
    const dialog = screen.getByRole('dialog', { name: 'Phím tắt của màn chơi' });
    expect(within(dialog).getByText('Hủy đếm ngược')).toBeTruthy();
    expect(within(dialog).getByText('Giữ chuột phải')).toBeTruthy();
  });

  it('thanh tiến độ ở đáy: sau thân màn chơi, ngoài header', () => {
    render(<PlayerView songId={SEED} />);
    const seek = screen.getByRole('slider', { name: 'Vị trí trong bài' });
    const footer = seek.closest('footer.player-footer') as HTMLElement;
    expect(footer).not.toBeNull();
    expect(seek.closest('header')).toBeNull();
    const body = document.querySelector('.player-body') as HTMLElement;
    expect(body.compareDocumentPosition(footer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Thứ tự khối của màn chơi: header → điều khiển → thân → đáy.
    const blocks = Array.from(document.querySelector('.player')?.children ?? []).map(
      (el) => el.className.split(' ')[0],
    );
    expect(blocks).toEqual(['player-header', 'transport', 'player-body', 'player-footer']);
    const cols = Array.from(body.children).map((el) => el.className.split(' ')[0]);
    expect(cols).toEqual(['player-shortcuts', 'player-main', 'player-sidebar']);
  });
});

describe('màn chơi — Phase 2c', () => {
  it('transport bar: only the melody speaker button (no metronome / click toggles)', () => {
    const id = addShortSong();
    render(<PlayerView songId={id} />);
    const transport = screen.getByRole('group', { name: 'Điều khiển phát' });
    expect(within(transport).queryByRole('button', { name: /Âm thanh/ })).toBeNull();
    expect(within(transport).queryByRole('button', { name: 'Metronome' })).toBeNull();
    // Trước deploy (chủ dự án duyệt): nút loa của giai điệu mẫu — chi tiết ở PlayerView.sound.test.tsx.
    expect(within(transport).getByRole('button', { name: 'Tiếng giai điệu' })).toBeTruthy();
    // góp ý 2026-10-16: Đếm vào / Đếm ngược chỉ còn ở Cài đặt → Phát bài.
    expect(within(transport).queryByRole('button', { name: 'Đếm vào' })).toBeNull();
    expect(within(transport).queryByRole('combobox', { name: 'Đếm ngược' })).toBeNull();
    // Lookahead vẫn ở đây.
    expect(within(transport).getByRole('slider', { name: /Lookahead/ })).toBeTruthy();
  });

  it('red "Đang phát giai điệu" badge only while the sample melody is on, with the Settings hint', () => {
    const id = addShortSong();
    render(<PlayerView songId={id} />);
    expect(document.querySelector('.player-chip-melody')).toBeNull();
    act(() => useSettings.getState().set({ audioEnabled: true }));
    const badge = document.querySelector('.player-chip-melody') as HTMLElement;
    expect(badge.textContent).toContain('🔊 Đang phát giai điệu');
    expect(badge.title).toContain('Cài đặt → Âm thanh');
    // D-417: chữ đầy đủ trong span riêng (màn hẹp / thấp chỉ ẩn bằng sr-only — vẫn là tên đọc) + ô "🔊" chỉ để nhìn.
    expect(badge.querySelector('.melody-badge-text')?.textContent).toBe('🔊 Đang phát giai điệu');
    expect(badge.querySelector('.melody-badge-icon')?.getAttribute('aria-hidden')).toBe('true');
    act(() => useSettings.getState().set({ audioEnabled: false, clickSound: true }));
    expect(document.querySelector('.player-chip-melody')).toBeNull();
  });

  it('Share copies the #/s/ link of the song source and toasts', async () => {
    const source = '@title Chia sẻ\n@bpm 120\nZ X C V\n';
    const id = addShortSong(source);
    render(<PlayerView songId={id} />);
    act(() => within(sideBar()).getByRole('button', { name: 'Chia sẻ' }).click());
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const url = String(writeText.mock.calls[0][0]);
    expect(url.startsWith(`${window.location.origin}${window.location.pathname}#/s/`)).toBe(true);
    expect(decodeShareData(url.slice(url.indexOf('#/s/') + 4))).toBe(source);
    await waitFor(() =>
      expect(useToasts.getState().toasts.map((t) => t.text)).toEqual([
        `Đã sao chép link chia sẻ (dài ${url.length} ký tự)`,
      ]),
    );
  });

  it('Share: long link → ONE success toast with the advice (region keeps 1); clipboard failure → error toast', async () => {
    // Nguồn ngẫu nhiên (nén kém) để link dài quá ngưỡng.
    let junk = '';
    let seed = 7;
    for (let i = 0; i < 9000; i++) {
      seed = (seed * 48271) % 2147483647;
      junk += String.fromCharCode(0x4e00 + (seed % 2000));
    }
    const id = addShortSong(`@title Dài\n// ${junk}\nZ X\n`);
    render(<PlayerView songId={id} />);
    act(() => screen.getByRole('button', { name: 'Chia sẻ' }).click());
    await waitFor(() => expect(useToasts.getState().toasts).toHaveLength(1));
    // Vùng toast của Player chỉ giữ 1 → không để cảnh báo đè mất (và trông như lỗi) xác nhận đã chép.
    const only = useToasts.getState().toasts[0];
    expect(only.kind).toBe('info');
    expect(only.text).toMatch(/^Đã sao chép link chia sẻ \(dài \d+ ký tự\) — .*\.harm/);

    useToasts.setState({ toasts: [] });
    // Clipboard API bị chặn; jsdom không có execCommand → fallback cũng thất bại.
    writeText.mockRejectedValue(new Error('denied'));
    act(() => screen.getByRole('button', { name: 'Chia sẻ' }).click());
    await waitFor(() =>
      expect(useToasts.getState().toasts.map((t) => t.text)).toEqual([
        'Không sao chép được link — trình duyệt chặn clipboard',
      ]),
    );
  });

  it('mobile scheme: digit game bar + mode banner in the full Player too; PC keeps keycaps', () => {
    const id = addShortSong('@title M\n@bpm 120\nZ L:N S:V Z\n');
    useSettings.getState().set({ controlScheme: 'mobile', countIn: false });
    render(<PlayerView songId={id} />);
    const bar = screen.getByRole('group', { name: 'Gợi ý phím như trong game' });
    expect(bar.dataset.scheme).toBe('mobile');
    const banner = () => document.querySelector('.hold-banner-text')?.textContent;
    expect(banner()).toBe('CHẾ ĐỘ: Ngẩng Tự Nhiên · Nửa Cung: TẮT');
    // Beat 0.5: lần chạm Cúi Xuống (beat 1) còn ≤ 1 beat → nhắc + nút nhấp nháy.
    press('Space', { key: ' ' });
    advance(250);
    expect(document.querySelector('.hold-banner-next')?.textContent).toBe('SẮP CHẠM: Cúi Xuống');
    expect(bar.querySelector('.gbm-mode-left')?.className).toContain('is-cue');
    advance(300); // beat 1.1
    expect(banner()).toBe('CHẾ ĐỘ: Cúi Xuống · Nửa Cung: TẮT');
    expect(bar.querySelector('.gbm-mode-left')?.className).toContain('is-selected');
    act(() => useSettings.getState().set({ controlScheme: 'pc' }));
    expect(screen.getByRole('group', { name: 'Gợi ý phím như trong game' }).dataset.scheme).toBe(
      'pc',
    );
  });
});

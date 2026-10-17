/**
 * Trang mini (route `#/mini/:id`): chỉ làn + bàn nút, ▶ → đếm ngược → chạy không cần chạm, chạm =
 * tạm dừng / chạy tiếp, giữ màn hình sáng, bảng ⓘ theo hãng, hộp thoại video PiP (jsdom: không hỗ trợ),
 * im lặng tuyệt đối. Kèm route + hộp thoại ở Menu. Bố cục "Khớp nút game" (mặc định) / "Thu nhỏ" (bàn nút
 * riêng — trang mini cũ) + "Căn chỉnh": MiniView.align.test.tsx.
 */
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StringKey } from '../i18n/strings';
import { translateCount } from '../i18n/useT';
import { getSong } from '../library/store';
import { PHONE_KIND_STORAGE_KEY } from '../pip/phonePref';
import { Transport } from '../player/transport';
import { parseLocation, paths } from '../ui/router';
import { useSettings } from '../ui/settings';
import { MINI_LAYOUT_STORAGE_KEY } from './miniAlign';
import { MINI_SONG_STORAGE_KEY } from './miniControl';
import { MiniLauncher } from './MiniLauncher';
import { MINI_HELP_VENDORS } from './MiniHelp';
import { MINI_RENDERER_OPTIONS, MiniView, miniRendererOptions, miniTileScale } from './MiniView';
import { formatBytes } from './VideoPipDialog';

const en = (key: StringKey, params?: Record<string, string | number>) =>
  translateCount('en', key, params);

const SEED = 'seed-quoc-ca-viet-nam';

function renderMini(id = SEED, query = '') {
  return render(<MiniView songId={id} query={new URLSearchParams(query)} />);
}

const region = () => screen.getByRole('region', { name: en('mini.region') });
const root = () => region() as HTMLElement;
const playBtn = () =>
  screen.getByRole('button', {
    name: new RegExp(`${en('mini.start')}|${en('mini.resume')}|${en('mini.replay')}`),
  });
const tapLayer = () => root().querySelector<HTMLButtonElement>('button.mini-tap')!;

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal(
    'requestAnimationFrame',
    vi.fn(() => 1),
  );
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => null);
  useSettings.getState().reset();
  useSettings.getState().set({ language: 'en' });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('router', () => {
  it('#/mini/:id → route mini (id decode), paths.mini encode', () => {
    expect(parseLocation('#/mini/seed-quoc-ca-viet-nam?delay=5', '').route).toEqual({
      name: 'mini',
      id: 'seed-quoc-ca-viet-nam',
    });
    expect(parseLocation('#/mini/a%20b', '').route).toEqual({ name: 'mini', id: 'a b' });
    expect(parseLocation('#/mini', '').route.name).toBe('not-found');
    expect(paths.mini('a b/c')).toBe('/mini/a%20b%2Fc');
  });
});

describe('MiniView', () => {
  it('chỉ có làn + bàn nút + panel gọn (huy hiệu Thử nghiệm, ▶, đếm ngược 3 s, ⓘ, video)', () => {
    // Bố cục "Thu nhỏ" (trang mini cũ, game bar riêng); "Khớp nút game": MiniView.align.test.tsx.
    localStorage.setItem(MINI_LAYOUT_STORAGE_KEY, 'compact');
    const { container } = renderMini();
    expect(root().dataset.layout).toBe('compact');
    const r = root();
    expect(r.dataset.phase).toBe('ready');
    expect(r.querySelector('canvas.mini-canvas')?.getAttribute('aria-label')).toMatch(
      /Quốc ca Việt Nam/,
    );
    expect(screen.getByRole('group', { name: en('player.gameBar') })).toBeTruthy();
    // Không chrome của Player / app (transport, lời, nav).
    expect(container.querySelector('nav, .transport, .player-header')).toBeNull();
    expect(screen.getByText(en('mini.experimental'))).toBeTruthy();
    expect(playBtn().textContent).toContain(en('mini.start'));
    // Đếm ngược theo Cài đặt → Phát bài (mặc định 3 s): chỉ nhắc giá trị, không có ô chọn riêng.
    expect(root().querySelector('select')).toBeNull();
    expect(root().querySelector('.mini-delay')?.textContent).toBe(
      en('mini.delayInfo', { value: en('mini.delayValue', { n: 3 }) }),
    );
    expect(screen.getByRole('button', { name: en('mini.help') })).toBeTruthy();
    expect(screen.getByRole('button', { name: en('mini.video.button') })).toBeTruthy();
    // Lớp chạm ra khỏi thứ tự Tab khi panel hiện.
    expect(tapLayer().tabIndex).toBe(-1);
    expect(document.title).toBe(en('mini.windowTitle', { title: 'Quốc ca Việt Nam' }));
    expect(localStorage.getItem(MINI_SONG_STORAGE_KEY)).toBe(SEED);
  });

  it('▶ → đếm ngược 3-2-1 → chạy (panel ẩn, focus lớp chạm); chạm = tạm dừng; chạm lại = đếm rồi chạy', () => {
    renderMini();
    fireEvent.click(playBtn());
    expect(root().dataset.phase).toBe('countdown');
    expect(screen.getByRole('status').textContent).toContain(en('player.countdownAria', { n: 3 }));
    expect(tapLayer().getAttribute('aria-label')).toBe(en('mini.tapCancel'));
    act(() => vi.advanceTimersByTime(2000));
    expect(screen.getByRole('status').textContent).toContain(en('player.countdownAria', { n: 1 }));
    act(() => vi.advanceTimersByTime(1000));
    expect(root().dataset.phase).toBe('playing');
    expect(root().querySelector('.mini-panel')).toBeNull();
    expect(document.activeElement).toBe(tapLayer());
    expect(tapLayer().tabIndex).toBe(0);
    expect(tapLayer().getAttribute('aria-label')).toBe(en('mini.tapPause'));

    fireEvent.click(tapLayer());
    expect(root().dataset.phase).toBe('paused');
    expect(screen.getByText(en('mini.paused'))).toBeTruthy();
    expect(document.activeElement).toBe(playBtn());
    expect(playBtn().textContent).toContain(en('mini.resume'));
    expect(screen.getByRole('button', { name: en('mini.restart') })).toBeTruthy();

    // Chạm nền (lớp chạm) khi tạm dừng cũng chạy tiếp.
    fireEvent.click(tapLayer());
    expect(root().dataset.phase).toBe('countdown');
    // Chạm khi đang đếm = hủy.
    fireEvent.click(tapLayer());
    expect(root().dataset.phase).toBe('paused');
  });

  it('nút "◂" về màn chơi của bài: chỉ khi đang dừng (sẵn sàng / tạm dừng), ẩn khi đếm / chạy', () => {
    renderMini();
    const back = () => screen.queryByRole('link', { name: en('mini.back') });
    // Sẵn sàng: có, trỏ màn chơi chính của bài.
    expect(back()?.getAttribute('href')).toBe(`#/play/${SEED}`);
    expect(back()?.getAttribute('title')).toBe(en('mini.back'));
    expect(back()?.closest('.mini-top')).not.toBeNull();
    fireEvent.click(playBtn());
    // Đang đếm ngược / đang chạy: không có gì ngoài ô rơi.
    expect(root().dataset.phase).toBe('countdown');
    expect(back()).toBeNull();
    act(() => vi.advanceTimersByTime(3000));
    expect(root().dataset.phase).toBe('playing');
    expect(back()).toBeNull();
    // Tạm dừng: hiện lại.
    fireEvent.click(tapLayer());
    expect(root().dataset.phase).toBe('paused');
    expect(back()?.getAttribute('href')).toBe(`#/play/${SEED}`);
  });

  it('tiếng Việt: tên nút "Về màn chơi"', () => {
    useSettings.getState().set({ language: 'vi' });
    renderMini();
    expect(screen.getByRole('link', { name: 'Về màn chơi' }).getAttribute('href')).toBe(
      `#/play/${SEED}`,
    );
  });

  it('sau đếm ngược, đếm vào không hiện số nào (không đếm hai lần)', () => {
    renderMini();
    // Phần tử lá có chữ là một số, trừ bàn nút (số bậc 1–7) và panel (ô chọn đếm ngược).
    const numbers = () =>
      Array.from(root().querySelectorAll('*'))
        .filter(
          (el) =>
            el.children.length === 0 &&
            !el.closest('.game-bar, .mpad, .mini-panel, .mini-fit-labels'),
        )
        .map((el) => (el.textContent ?? '').trim())
        .filter((s) => /^\d+$/.test(s));
    fireEvent.click(playBtn());
    expect(numbers()).toEqual(['3']);
    act(() => vi.advanceTimersByTime(3000));
    expect(root().dataset.phase).toBe('playing');
    expect(root().querySelector('.mini-countdown')).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
    expect(numbers()).toEqual([]);
  });

  it('?delay=0 → chạy ngay; Space dừng / chạy; R chơi lại', () => {
    renderMini(SEED, 'delay=0');
    expect(root().querySelector('.mini-delay')?.textContent).toBe(
      en('mini.delayInfo', { value: en('mini.delayOff') }),
    );
    fireEvent.keyDown(window, { code: 'Space', key: ' ' });
    expect(root().dataset.phase).toBe('playing');
    fireEvent.keyDown(window, { code: 'Space', key: ' ' });
    expect(root().dataset.phase).toBe('paused');
    fireEvent.keyDown(window, { code: 'KeyR', key: 'r' });
    expect(root().dataset.phase).toBe('playing');
  });

  it('đếm ngược theo Cài đặt → Phát bài (đổi ở Cài đặt áp ngay); `?delay=` đè Cài đặt', () => {
    useSettings.getState().set({ startDelaySec: 10 });
    const { unmount } = renderMini();
    fireEvent.click(playBtn());
    expect(screen.getByRole('status').textContent).toContain(en('player.countdownAria', { n: 10 }));
    fireEvent.click(tapLayer()); // hủy đếm ngược
    act(() => useSettings.getState().set({ startDelaySec: 5 }));
    fireEvent.click(playBtn());
    expect(screen.getByRole('status').textContent).toContain(en('player.countdownAria', { n: 5 }));
    fireEvent.click(tapLayer()); // hủy
    // Vòng R7: Cài đặt = Tắt → trang mini vẫn đếm 3 giây (bấm ▶ rồi còn chuyển vào game).
    act(() => useSettings.getState().set({ startDelaySec: 0 }));
    fireEvent.click(playBtn());
    expect(screen.getByRole('status').textContent).toContain(en('player.countdownAria', { n: 3 }));
    unmount();
    renderMini(SEED, 'delay=0');
    fireEvent.click(playBtn());
    expect(root().dataset.phase).toBe('playing');
  });

  it('đếm vào theo Cài đặt → Phát bài: bật = đoạn dẫn vào (leadIn.ts), tắt = chạy thẳng vào nốt đầu', () => {
    const play = vi.spyOn(Transport.prototype, 'play');
    const { unmount } = renderMini(SEED, 'delay=0');
    fireEvent.click(playBtn());
    expect(play.mock.calls.at(-1)?.[0]?.countInBeats).toBeGreaterThan(0);
    unmount();
    useSettings.getState().set({ countIn: false });
    renderMini(SEED, 'delay=0');
    fireEvent.click(playBtn());
    expect(root().dataset.phase).toBe('playing');
    expect(play.mock.calls.at(-1)?.[0]?.countInBeats).toBe(0);
  });

  it('giữ màn hình sáng khi đếm / chạy, nhả khi tạm dừng', async () => {
    const release = vi.fn(() => Promise.resolve());
    const sentinel = {
      released: false,
      release,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };
    const request = vi.fn(() => Promise.resolve(sentinel));
    Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: { request } });
    try {
      renderMini(SEED, 'delay=0');
      expect(request).not.toHaveBeenCalled();
      fireEvent.click(playBtn());
      expect(request).toHaveBeenCalledWith('screen');
      await act(async () => {
        await Promise.resolve();
      });
      fireEvent.click(tapLayer());
      expect(release).toHaveBeenCalledTimes(1);
    } finally {
      delete (navigator as unknown as Record<string, unknown>).wakeLock;
    }
  });

  it('ⓘ mở bảng hướng dẫn theo hãng + lưu ý; Esc đóng', () => {
    renderMini();
    fireEvent.click(screen.getByRole('button', { name: en('mini.help') }));
    const dialog = screen.getByRole('dialog', { name: en('mini.helpTitle') });
    for (const v of MINI_HELP_VENDORS) {
      expect(within(dialog).getByRole('heading', { name: en(v.title) })).toBeTruthy();
    }
    expect(within(dialog).getByText(en('mini.help.samsung'))).toBeTruthy();
    expect(within(dialog).getByText(en('mini.tip.gyro'))).toBeTruthy();
    expect(within(dialog).getByText(en('mini.tip.security'))).toBeTruthy();
    fireEvent.keyDown(window, { key: 'Escape', code: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('video nổi: jsdom không có PiP → một dòng giải thích, nút bị khóa', () => {
    renderMini();
    fireEvent.click(screen.getByRole('button', { name: en('mini.video.button') }));
    const dialog = screen.getByRole('dialog', { name: en('mini.video.title') });
    expect(within(dialog).getByText(en('mini.video.unsupported'))).toBeTruthy();
    expect(within(dialog).getByText(en('mini.video.intro', { n: 3 }))).toBeTruthy();
    expect(
      (within(dialog).getByRole('button', { name: en('mini.video.liveOpen') }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(
      (within(dialog).getByRole('button', { name: en('mini.video.build') }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it('scheme Mobile: bàn nút giống màn chơi kèn (MobilePad) trong khu làn, chỉ hiển thị; banner chế độ', () => {
    localStorage.setItem(MINI_LAYOUT_STORAGE_KEY, 'compact');
    useSettings.getState().set({ controlScheme: 'mobile' });
    const { container } = renderMini();
    expect(root().dataset.scheme).toBe('mobile');
    const pad = screen.getByRole('group', { name: en('player.gameBar') });
    expect(pad.dataset.scheme).toBe('mobile');
    expect(pad.classList.contains('mpad')).toBe(true);
    expect(pad.parentElement?.classList.contains('mini-lanes')).toBe(true);
    expect(container.querySelector('.game-bar')).toBeNull();
    // Không luyện tập: nút không bấm được (chạm đi vào lớp chạm = tạm dừng / chạy tiếp).
    expect(pad.querySelectorAll('button')).toHaveLength(0);
    expect(pad.querySelectorAll('.gbm-key')).toHaveLength(8);
    expect(pad.querySelectorAll('.gbm-mode')).toHaveLength(4);
    expect(screen.getByRole('group', { name: en('player.mobile.bannerRegion') })).toBeTruthy();
  });

  it('không bao giờ tạo AudioContext (kể cả khi bật giai điệu mẫu)', () => {
    const ctor = vi.fn();
    vi.stubGlobal('AudioContext', ctor);
    useSettings.getState().set({ audioEnabled: true, clickSound: true });
    renderMini(SEED, 'delay=0');
    fireEvent.click(playBtn());
    act(() => vi.advanceTimersByTime(3000));
    expect(ctor).not.toHaveBeenCalled();
  });

  it('bài không có → thông báo + link Thư viện', () => {
    renderMini('khong-co');
    expect(screen.getByRole('alert').textContent).toBe(en('mini.songMissing', { id: 'khong-co' }));
    expect(screen.getByRole('link', { name: en('mini.openLibrary') }).getAttribute('href')).toBe(
      '#/library',
    );
  });

  it('miniTileScale: 300 px → 0.6, 520+ → 1, bậc 0.05', () => {
    expect(miniTileScale(300)).toBe(0.6);
    expect(miniTileScale(416)).toBe(0.8);
    expect(miniTileScale(2000)).toBe(1);
    expect(miniTileScale(0)).toBe(1);
    expect(MINI_RENDERER_OPTIONS.lanePadding).toBe('none');
    expect(miniRendererOptions('mobile').lanePadding).toBe('pad');
    expect(miniRendererOptions('pc').lanePadding).toBe('none');
    expect(MINI_RENDERER_OPTIONS.showSectionLabels).toBe(false);
    // "Thu nhỏ" (mặc định của hàm) như trên; "Khớp nút game": lane theo nút thật ở cả hai kiểu.
    expect(miniRendererOptions('mobile', 'compact').lanePadding).toBe('pad');
    for (const scheme of ['pc', 'mobile'] as const) {
      const o = miniRendererOptions(scheme, 'game', null);
      expect(o.lanePadding).toBe('fit');
      expect(o.laneFit).toBeNull();
      expect(o.hitLinePos).toBe(MINI_RENDERER_OPTIONS.hitLinePos);
    }
  });

  it('formatBytes', () => {
    expect(formatBytes(10)).toBe('1 KB');
    expect(formatBytes(200 * 1024)).toBe('200 KB');
    expect(formatBytes(3.25 * 1024 * 1024)).toBe('3.3 MB');
  });
});

describe('MiniLauncher (Menu)', () => {
  it('chọn sẵn bài mở lần trước; link trỏ #/mini/<id>; bấm link đóng hộp thoại', () => {
    localStorage.setItem(MINI_SONG_STORAGE_KEY, 'seed-takediskrush');
    const onClose = vi.fn();
    render(<MiniLauncher open onClose={onClose} />);
    const dialog = screen.getByRole('dialog', { name: en('mini.launcherTitle') });
    const select = within(dialog).getByLabelText(en('pip.song')) as HTMLSelectElement;
    expect(select.value).toBe('seed-takediskrush');
    const link = within(dialog).getByRole('link', { name: en('mini.open') });
    expect(link.getAttribute('href')).toBe('#/mini/seed-takediskrush');
    fireEvent.change(select, { target: { value: SEED } });
    expect(link.getAttribute('href')).toBe(`#/mini/${SEED}`);
    expect(getSong(SEED)).not.toBeNull();
    fireEvent.click(link);
    expect(onClose).toHaveBeenCalled();
  });

  it('songId (nút Cửa sổ nổi của màn chơi, kiểu Mobile, đã chọn Android): bài cố định, không ô chọn bài', () => {
    // R7-6: lần đầu hỏi Apple / Android (MiniLauncher.test.tsx); máy này đã chọn Android.
    localStorage.setItem(PHONE_KIND_STORAGE_KEY, 'android');
    const onClose = vi.fn();
    render(<MiniLauncher open onClose={onClose} songId={SEED} />);
    const dialog = screen.getByRole('dialog', { name: en('mini.launcherTitle') });
    expect(within(dialog).queryByLabelText(en('pip.song'))).toBeNull();
    expect(dialog.textContent).toContain('Song: Quốc ca Việt Nam');
    const link = within(dialog).getByRole('link', { name: en('mini.open') });
    expect(link.getAttribute('href')).toBe(`#/mini/${SEED}`);
    fireEvent.click(link);
    expect(onClose).toHaveBeenCalled();
  });

  it('bài nhớ không còn → bài đầu thư viện', () => {
    localStorage.setItem(MINI_SONG_STORAGE_KEY, 'da-xoa');
    render(<MiniLauncher open onClose={() => undefined} />);
    expect(screen.getByRole('link', { name: en('mini.open') }).getAttribute('href')).toMatch(
      /^#\/mini\/seed-/,
    );
  });
});

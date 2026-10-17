import { act, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { useLibrary } from './library/store';
import type * as FeaturesModule from './ui/features';
import { rememberLastPlayed } from './ui/lastPlayed';
import { useSettings } from './ui/settings';
import { toast, useToasts } from './ui/toast';

// Player thật (canvas, audio) không cần cho test routing.
vi.mock('./player/PlayerView', () => ({
  PlayerView: ({ songId, home }: { songId: string; home?: boolean }) => (
    <h1>
      {home ? 'home' : 'player'} {songId}
    </h1>
  ),
}));
const flags = vi.hoisted(() => ({ editor: false, share: false, midiImport: false }));
vi.mock('./ui/features', () => ({ FEATURES: flags }));

/** Chờ chunk route tải lười (lần đầu phải transform cả EditorView / MidiImportView). */
const LAZY_TIMEOUT = 10_000;

function go(hash: string) {
  act(() => {
    window.location.hash = hash;
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  });
}

beforeEach(() => {
  Object.assign(flags, { editor: false, share: false, midiImport: false });
  useSettings.setState({ language: 'vi', theme: 'dark' });
  window.location.hash = '';
  rememberLastPlayed(null);
});

describe('App routing — tính năng chưa có (D-060)', () => {
  it.each([
    ['#/edit/seed-quoc-ca-viet-nam', 'Trình soạn bài'],
    ['#/midi', 'Tạo bài từ file MIDI / MusicXML'],
    ['#/s/abc', 'Mở bài được chia sẻ'],
  ])('%s → trang "sắp có" đã dịch, không phải placeholder', (hash, title) => {
    window.location.hash = hash;
    render(<App />);
    expect(screen.getByRole('heading', { level: 1, name: title })).toBeTruthy();
    expect(
      screen.getByText('Tính năng này chưa có trong bản hiện tại — sẽ có ở bản cập nhật sau.'),
    ).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Về thư viện' }).getAttribute('href')).toBe(
      '#/library',
    );
    expect(document.body.textContent).not.toMatch(/EditorView|MidiImportView|ShareView|Phase 2/);
  });

  it('EN', () => {
    useSettings.setState({ language: 'en' });
    window.location.hash = '#/edit/x';
    render(<App />);
    expect(screen.getByRole('heading', { level: 1, name: 'Song editor' })).toBeTruthy();
    go('#/midi');
    expect(
      screen.getByRole('heading', { level: 1, name: 'Create from a MIDI / MusicXML file' }),
    ).toBeTruthy();
  });

  it('bật cờ → render view thật của route (tải theo route)', async () => {
    Object.assign(flags, { editor: true, share: true, midiImport: true });
    const comingSoon = 'Tính năng này chưa có trong bản hiện tại — sẽ có ở bản cập nhật sau.';
    window.location.hash = '#/edit/x';
    render(<App />);
    // Chunk của route chưa tải xong → trạng thái "Đang tải…".
    expect(screen.getByText('Đang tải…').getAttribute('role')).toBe('status');
    // EditorView thật: id lạ → "không tìm thấy bài". Chunk lười phải transform lần đầu → chạy cả
    // suite song song có thể quá 1 s mặc định của findBy*.
    expect(
      await screen.findByRole(
        'heading',
        { level: 1, name: 'Không tìm thấy bài hát' },
        { timeout: LAZY_TIMEOUT },
      ),
    ).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Trình soạn bài' })).toBeNull();
    go('#/midi');
    // MidiImportView thật (cùng tiêu đề với trang "sắp có", nhưng có tab chọn nguồn).
    expect(await screen.findByRole('tablist', {}, { timeout: LAZY_TIMEOUT })).toBeTruthy();
    expect(
      screen.getByRole('heading', { level: 1, name: 'Tạo bài từ file MIDI / MusicXML' }),
    ).toBeTruthy();
    expect(screen.queryByText(comingSoon)).toBeNull();
    go('#/s/%%%');
    expect(
      await screen.findByRole(
        'heading',
        { level: 1, name: 'Link chia sẻ không hợp lệ' },
        { timeout: LAZY_TIMEOUT },
      ),
    ).toBeTruthy();
    expect(screen.queryByText(comingSoon)).toBeNull();
  });

  it('bản phát hành Phase 2: cờ editor / share / midiImport đều bật', async () => {
    const real = await vi.importActual<typeof FeaturesModule>('./ui/features');
    expect(real.FEATURES).toEqual({ editor: true, share: true, midiImport: true });
  });
});

describe('App — Player', () => {
  it('toast ở đỉnh màn hình (không che game bar), chỉ toast mới nhất', () => {
    useToasts.setState({ toasts: [] });
    window.location.hash = '#/play/seed-takediskrush';
    render(<App />);
    expect(screen.getByRole('heading', { name: 'player seed-takediskrush' })).toBeTruthy();
    act(() => {
      toast('Đã nhập 3 bài');
      toast('Trình duyệt chặn âm thanh', 'error');
    });
    const region = document.querySelector('.toast-region');
    expect(region?.classList.contains('is-top')).toBe(true);
    expect(region?.textContent).toBe('Trình duyệt chặn âm thanh');
    go('#/library');
    expect(document.querySelector('.toast-region')?.classList.contains('is-top')).toBe(false);
  });
});

describe('App — màn chơi (#/) và thư viện (#/library)', () => {
  it('#/ → màn chơi đầy đủ với bài mẫu (không nav — màn chơi có header riêng), toast ở đỉnh', () => {
    window.location.hash = '';
    render(<App />);
    expect(screen.getByRole('heading', { name: 'home seed-quoc-ca-viet-nam' })).toBeTruthy();
    expect(screen.queryByRole('navigation', { name: 'Điều hướng chính' })).toBeNull();
    expect(document.querySelector('.toast-region')?.classList.contains('is-top')).toBe(true);
  });

  it('#/library → nav: tên app thành nút "◂ Về màn chơi" (về `#/` khi chưa mở bài nào), link Hướng dẫn', () => {
    window.location.hash = '#/library';
    render(<App />);
    expect(screen.getByRole('heading', { level: 1, name: 'Thư viện bài hát' })).toBeTruthy();
    const nav = screen.getByRole('navigation', { name: 'Điều hướng chính' });
    const back = within(nav).getByRole('link', { name: 'Về màn chơi — Quốc ca Việt Nam' });
    expect(back.getAttribute('href')).toBe('#/');
    expect(back.getAttribute('title')).toBe('Về màn chơi — Quốc ca Việt Nam');
    expect(back.textContent).toBe('◂Về màn chơi');
    expect(back.classList.contains('app-brand')).toBe(true);
    // Không còn tên app ở chỗ này.
    expect(nav.textContent).not.toContain('Harmonica Tiles');
    const libraryLink = within(nav).getByRole('link', { name: 'Thư viện' });
    expect(libraryLink.getAttribute('href')).toBe('#/library');
    expect(libraryLink.getAttribute('aria-current')).toBe('page');
    expect(within(nav).getByRole('link', { name: 'Cài đặt' }).getAttribute('href')).toBe(
      '#/settings',
    );
    expect(within(nav).getByRole('link', { name: 'Hướng dẫn' }).getAttribute('href')).toBe(
      '#/guide',
    );
    // Ngôn ngữ + theme vẫn ở góc phải.
    expect(within(nav).getByRole('button', { name: 'Đổi ngôn ngữ (VI/EN)' })).toBeTruthy();
    expect(within(nav).getByRole('button', { name: 'Đổi giao diện sáng/tối' })).toBeTruthy();
    go('#/');
    expect(screen.getByRole('heading', { name: 'home seed-quoc-ca-viet-nam' })).toBeTruthy();
    expect(screen.queryByRole('navigation', { name: 'Điều hướng chính' })).toBeNull();
  });

  it('#/ai → "Tạo bài với AI" tải lười; link Thư viện vẫn sáng (trang con của Thư viện)', async () => {
    window.location.hash = '#/ai';
    render(<App />);
    expect(
      await screen.findByRole(
        'heading',
        { level: 1, name: 'Tạo bài với AI' },
        { timeout: LAZY_TIMEOUT },
      ),
    ).toBeTruthy();
    const nav = screen.getByRole('navigation', { name: 'Điều hướng chính' });
    // Trang con của Thư viện: link Thư viện sáng (mục cha) nhưng không nói "trang hiện tại".
    expect(within(nav).getByRole('link', { name: 'Thư viện' }).getAttribute('aria-current')).toBe(
      'true',
    );
    expect(screen.getByLabelText('Dán kết quả của AI vào đây')).toBeTruthy();
  });

  it('#/dev → Dev notes tải lười, có thanh điều hướng nhưng thanh điều hướng không có link tới nó (R7-8)', async () => {
    window.location.hash = '#/dev';
    render(<App />);
    expect(
      await screen.findByRole(
        'heading',
        { level: 1, name: 'Dev notes' },
        { timeout: LAZY_TIMEOUT },
      ),
    ).toBeTruthy();
    const nav = screen.getByRole('navigation', { name: 'Điều hướng chính' });
    expect(within(nav).queryByRole('link', { name: 'Dev notes' })).toBeNull();
    expect(nav.querySelector('a[href^="#/dev"]')).toBeNull();
    expect(nav.querySelector('[aria-current]')).toBeNull();
  });

  it('"Về màn chơi" trỏ về bài mở ở màn chơi gần nhất (còn tồn tại), EN', () => {
    const id = useLibrary.getState().addSong('@title Bài riêng\nZ X C');
    rememberLastPlayed(id);
    window.location.hash = '#/settings';
    render(<App />);
    const nav = screen.getByRole('navigation', { name: 'Điều hướng chính' });
    const back = within(nav).getByRole('link', { name: 'Về màn chơi — Bài riêng' });
    expect(back.getAttribute('href')).toBe(`#/play/${id}`);
    act(() => useSettings.setState({ language: 'en' }));
    expect(within(nav).getByRole('link', { name: 'Back to player — Bài riêng' })).toBeTruthy();
    expect(within(nav).getByRole('link', { name: 'Guide' })).toBeTruthy();
    // Bài bị xóa → về `#/`.
    act(() => {
      useLibrary.getState().removeSong(id);
    });
    expect(
      within(nav)
        .getByRole('link', { name: /^Back to player/ })
        .getAttribute('href'),
    ).toBe('#/');
  });

  it('#/overlay/:id → overlay tải lười: không nav, không toast / nhắc cập nhật, html.overlay-mode', async () => {
    // jsdom không có canvas 2D (renderer bỏ qua khi không có context) — chặn log "Not implemented".
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    window.location.hash = '#/overlay/seed-quoc-ca-viet-nam?bg=chroma';
    render(<App />);
    // Lúc chờ chunk không vẽ gì (không "Đang tải…" lên stream).
    expect(screen.queryByRole('status')).toBeNull();
    expect(document.documentElement.classList.contains('overlay-mode')).toBe(true);
    expect(
      await screen.findByRole('region', { name: 'Overlay OBS' }, { timeout: LAZY_TIMEOUT }),
    ).toBeTruthy();
    expect(document.documentElement.classList.contains('overlay-bg-chroma')).toBe(true);
    expect(screen.queryByRole('navigation', { name: 'Điều hướng chính' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Thông báo cập nhật app' })).toBeNull();
    expect(document.querySelector('.toast-region')).toBeNull();
    go('#/library');
    expect(screen.getByRole('heading', { level: 1, name: 'Thư viện bài hát' })).toBeTruthy();
    expect(document.documentElement.classList.contains('overlay-mode')).toBe(false);
    expect(document.documentElement.classList.contains('overlay-bg-chroma')).toBe(false);
  });

  it('trang không tồn tại: link "Về thư viện" tới #/library', () => {
    window.location.hash = '#/khong-co';
    render(<App />);
    expect(screen.getByRole('heading', { level: 1, name: 'Không tìm thấy trang' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Về thư viện' }).getAttribute('href')).toBe(
      '#/library',
    );
  });
});

describe('App — theme / lang trên <html>', () => {
  it('áp ngay khi render (layout effect) và khi đổi', () => {
    useSettings.setState({ theme: 'light', language: 'en' });
    render(<App />);
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(document.documentElement.lang).toBe('en');
    act(() => useSettings.setState({ theme: 'dark' }));
    expect(document.documentElement.dataset.theme).toBe('dark');
  });
});

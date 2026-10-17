import { act, fireEvent, render, screen } from '@testing-library/react';
import { registerSW } from 'virtual:pwa-register';
import type { RegisterSWOptions } from 'virtual:pwa-register';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetPwaForTests, usePwa } from './pwa';
import { useSettings } from './settings';
import { OFFLINE_READY_MS, UpdatePrompt } from './UpdatePrompt';

const sw = vi.hoisted(() => ({
  options: undefined as RegisterSWOptions | undefined,
  update: undefined as ((reloadPage?: boolean) => Promise<void>) | undefined,
}));

vi.mock('virtual:pwa-register', () => ({
  registerSW: vi.fn((options?: RegisterSWOptions) => {
    sw.options = options;
    return sw.update;
  }),
}));

function hooks(): RegisterSWOptions {
  if (!sw.options) throw new Error('registerSW was not called');
  return sw.options;
}

beforeEach(() => {
  vi.useFakeTimers();
  sw.options = undefined;
  sw.update = vi.fn(() => Promise.resolve());
  vi.mocked(registerSW).mockClear();
  resetPwaForTests({ reload: vi.fn() });
  Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: {} });
  useSettings.setState({ language: 'vi' });
});

afterEach(() => {
  resetPwaForTests();
  Reflect.deleteProperty(navigator, 'serviceWorker');
  vi.useRealTimers();
});

describe('UpdatePrompt', () => {
  it('mount → đăng ký SW một lần; ban đầu không hiện gì (vùng status rỗng)', () => {
    const { rerender } = render(<UpdatePrompt />);
    rerender(<UpdatePrompt placement="top" />);
    expect(registerSW).toHaveBeenCalledTimes(1);
    const region = screen.getByRole('status', { name: 'Thông báo cập nhật app' });
    expect(region.getAttribute('aria-live')).toBe('polite');
    expect(region.textContent).toBe('');
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('có bản mới → "Có bản mới" + Tải lại (updateServiceWorker(true)); không lấy focus', async () => {
    render(
      <>
        <button type="button">trước</button>
        <UpdatePrompt />
      </>,
    );
    const before = screen.getByRole('button', { name: 'trước' });
    before.focus();
    act(() => hooks().onNeedRefresh?.());
    expect(screen.getByText('Có bản mới')).toBeTruthy();
    expect(document.activeElement).toBe(before);

    const reload = screen.getByRole('button', { name: 'Tải lại' });
    await act(async () => {
      fireEvent.click(reload);
      await Promise.resolve();
    });
    expect(sw.update).toHaveBeenCalledWith(true);
    expect(screen.queryByText('Có bản mới')).toBeNull();
  });

  it('"Để sau" ẩn nhắc (không đổi SW)', () => {
    render(<UpdatePrompt />);
    act(() => hooks().onNeedRefresh?.());
    fireEvent.click(screen.getByRole('button', { name: 'Để sau' }));
    expect(screen.queryByText('Có bản mới')).toBeNull();
    expect(sw.update).not.toHaveBeenCalled();
    expect(usePwa.getState().needRefresh).toBe(false);
  });

  it('sẵn sàng offline: hiện một lần, tự ẩn sau OFFLINE_READY_MS', () => {
    render(<UpdatePrompt />);
    act(() => hooks().onOfflineReady?.());
    expect(screen.getByText(/Đã sẵn sàng dùng offline/)).toBeTruthy();
    act(() => vi.advanceTimersByTime(OFFLINE_READY_MS));
    expect(screen.queryByText(/Đã sẵn sàng dùng offline/)).toBeNull();
    expect(usePwa.getState().offlineReady).toBe(false);
  });

  it('sẵn sàng offline: nút × ẩn ngay', () => {
    render(<UpdatePrompt />);
    act(() => hooks().onOfflineReady?.());
    fireEvent.click(screen.getByRole('button', { name: 'Ẩn thông báo dùng offline' }));
    expect(screen.queryByText(/Đã sẵn sàng dùng offline/)).toBeNull();
  });

  it('showOfflineReady={false} (màn đầu): chờ, hiện khi sang trang khác', () => {
    const { rerender } = render(<UpdatePrompt placement="top" showOfflineReady={false} />);
    act(() => hooks().onOfflineReady?.());
    expect(screen.queryByText(/Đã sẵn sàng dùng offline/)).toBeNull();
    act(() => vi.advanceTimersByTime(OFFLINE_READY_MS * 2));
    expect(usePwa.getState().offlineReady).toBe(true);
    rerender(<UpdatePrompt />);
    expect(screen.getByText(/Đã sẵn sàng dùng offline/)).toBeTruthy();
  });

  it('placement top / bottom → class vùng; EN', () => {
    useSettings.setState({ language: 'en' });
    const { rerender } = render(<UpdatePrompt placement="top" />);
    expect(screen.getByRole('status').classList.contains('is-top')).toBe(true);
    rerender(<UpdatePrompt />);
    expect(screen.getByRole('status').className).toBe('update-prompt-region');
    act(() => hooks().onNeedRefresh?.());
    expect(screen.getByText('A new version is available')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Reload' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Later' })).toBeTruthy();
  });
});

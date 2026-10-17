/**
 * Thanh dọc phải của màn chơi: nút "Cửa sổ nổi" theo kiểu điều khiển và thiết bị (vòng sửa R5): điện
 * thoại không có Document PiP ở kiểu PC (mặc định của hồ sơ mới) → mở trang mini như kiểu Mobile, không
 * báo "dùng Chrome / Edge trên máy tính".
 */
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSettings } from '../ui/settings';
import { PlayerSideBar } from './PlayerSideBar';

function stubPointer(coarse: boolean): void {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: vi.fn((query: string) => ({
      matches: query === '(pointer: coarse)' ? coarse : false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  });
}

function renderBar() {
  const onOpenMini = vi.fn();
  const onFloatOpened = vi.fn();
  render(
    <PlayerSideBar
      songId="seed-quoc-ca-viet-nam"
      onFloatOpened={onFloatOpened}
      onOpenMini={onOpenMini}
      onOpenObs={vi.fn()}
      onShare={vi.fn()}
    />,
  );
  const bar = screen.getByRole('complementary', { name: 'Công cụ màn chơi' });
  const float = within(bar).getByRole('button', { name: /^Cửa sổ nổi/ });
  return { onOpenMini, float };
}

beforeEach(() => {
  act(() => useSettings.getState().reset());
});

afterEach(() => {
  delete (window as { matchMedia?: unknown }).matchMedia;
});

describe('PlayerSideBar — Cửa sổ nổi', () => {
  it('PC on a phone without Document PiP → opens the mini page dialog (no "use desktop Chrome" note)', () => {
    stubPointer(true);
    const { onOpenMini, float } = renderBar();
    expect(float.getAttribute('aria-haspopup')).toBe('dialog');
    expect(float.getAttribute('aria-pressed')).toBeNull();
    fireEvent.click(float);
    expect(onOpenMini).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/chưa hỗ trợ cửa sổ nổi/)).toBeNull();
  });

  it('PC on a desktop without Document PiP keeps the floating-window toggle (explains on click)', () => {
    stubPointer(false);
    const { onOpenMini, float } = renderBar();
    expect(float.getAttribute('aria-pressed')).toBe('false');
    expect(onOpenMini).not.toHaveBeenCalled();
  });

  it('Mobile scheme → mini page dialog on any device', () => {
    stubPointer(false);
    act(() => useSettings.getState().set({ controlScheme: 'mobile' }));
    const { onOpenMini, float } = renderBar();
    // R7-6: hộp thoại hỏi Apple / Android → gợi ý nói cả hai đường.
    expect(float.title).toBe(
      'Cửa sổ nổi trên điện thoại: Android = trang mini, iPhone / iPad = video nổi của bài này',
    );
    fireEvent.click(float);
    expect(onOpenMini).toHaveBeenCalledTimes(1);
  });
});

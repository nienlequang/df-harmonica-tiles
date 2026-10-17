import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastRegion, toast, useToasts } from './toast';

beforeEach(() => {
  vi.useFakeTimers();
  useToasts.setState({ toasts: [] });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('ToastRegion', () => {
  it('mặc định ở đáy, hiện mọi toast, tự hết hạn (info 3 s, lỗi 6 s)', () => {
    render(<ToastRegion />);
    act(() => {
      toast('a');
      toast('b', 'error');
    });
    const region = screen.getByRole('status');
    expect(region.className).toBe('toast-region');
    expect(region.textContent).toBe('ab');
    act(() => vi.advanceTimersByTime(3000));
    expect(region.textContent).toBe('b');
    act(() => vi.advanceTimersByTime(3000));
    expect(region.textContent).toBe('');
  });

  it('placement="top" + max: chỉ N toast mới nhất, ở đỉnh (Player, không che game bar)', () => {
    render(<ToastRegion placement="top" max={2} />);
    act(() => {
      for (const t of ['1', '2', '3']) toast(t);
    });
    const region = screen.getByRole('status');
    expect(region.classList.contains('is-top')).toBe(true);
    expect(Array.from(region.children).map((el) => el.textContent)).toEqual(['2', '3']);
    expect(useToasts.getState().toasts).toHaveLength(3);
  });
});

import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { useSettings } from './ui/settings';

// Chunk của Editor không tải được (vd. app vừa deploy, file chunk cũ đã mất): đọc export làm
// promise của `lazy` bị reject như import() lỗi.
vi.mock('./editor/EditorView', () => ({
  get EditorView(): never {
    throw new TypeError('Failed to fetch dynamically imported module');
  },
}));
vi.mock('./player/PlayerView', () => ({ PlayerView: () => <h1>player</h1> }));

// React (dev) ném lại lỗi render qua sự kiện 'error' của window: chặn để jsdom không in ra stderr.
const swallow = (e: ErrorEvent) => e.preventDefault();

beforeEach(() => {
  useSettings.setState({ language: 'vi', theme: 'dark' });
  vi.spyOn(console, 'error').mockImplementation(() => {});
  window.addEventListener('error', swallow);
});

afterEach(() => {
  window.removeEventListener('error', swallow);
  window.location.hash = '';
});

describe('App — route tải lười bị lỗi', () => {
  it('hiện thẻ "tải lại trang" thay cho màn hình trắng; đổi route thì dùng lại được', async () => {
    window.location.hash = '#/edit/seed-quoc-ca-viet-nam';
    render(<App />);
    const alert = await screen.findByRole('alert');
    expect(screen.getByRole('heading', { level: 1, name: 'Không mở được trang này' })).toBeTruthy();
    expect(alert.textContent).toContain('Tải lại trang để dùng bản mới.');
    expect(screen.getByRole('button', { name: 'Tải lại trang' })).toBeTruthy();
    // Thanh điều hướng vẫn còn.
    expect(screen.getByRole('navigation', { name: 'Điều hướng chính' })).toBeTruthy();

    fireEvent.click(screen.getByRole('link', { name: 'Về thư viện' }));
    act(() => {
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    expect(await screen.findByRole('heading', { level: 1, name: 'Thư viện bài hát' })).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

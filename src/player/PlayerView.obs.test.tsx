/**
 * PlayerView: nút "OBS" ở thanh dọc bên phải (hộp thoại Tạo link OBS cho bài đang mở — nội dung hộp thoại
 * được kiểm ở src/overlay/ObsLinkModal.test.tsx) và lệnh ngoài `dfht:command` (desktop global shortcut) =
 * Space / R / → / ←. Canvas getContext → null, rAF chạy tay, audio mock.
 */
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useLibrary } from '../library/store';
import { DFHT_COMMAND_EVENT, dispatchDfhtCommand } from '../overlay/commands';
import { useSettings } from '../ui/settings';
import { PlayerView } from './PlayerView';

vi.mock('../audio/engine', () => ({
  isAudioSupported: () => false,
  getAudioEngine: () => {
    throw new Error('audio engine must not be used when unsupported');
  },
  UNLOCK_TIMEOUT_MS: 1000,
}));

const SEED = 'seed-takediskrush';

let frames = new Map<number, FrameRequestCallback>();
let nextFrame = 1;

function bySelector<T extends Element>(selector: string): T {
  const el = document.querySelector<T>(selector);
  if (!el) throw new Error(`not found: ${selector}`);
  return el;
}
const playButton = () => bySelector<HTMLButtonElement>('button.transport-play');
const position = () =>
  Number(bySelector<HTMLInputElement>('input[type="range"][aria-label="Vị trí trong bài"]').value);

function command(c: Parameters<typeof dispatchDfhtCommand>[0]): void {
  act(() => dispatchDfhtCommand(c));
}

beforeEach(() => {
  frames = new Map();
  nextFrame = 1;
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    const id = nextFrame++;
    frames.set(id, cb);
    return id;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => {
    frames.delete(id);
  });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => null);
  useSettings.getState().reset();
  // Không đếm vào để vị trí đổi ngay khi seek.
  useSettings.setState({ countIn: false });
  window.location.hash = `#/play/${SEED}`;
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.location.hash = '';
  for (const s of useLibrary.getState().songs) useLibrary.getState().removeSong(s.id);
});

describe('PlayerView: nút OBS', () => {
  it('mở "Tạo link OBS" cho bài đang mở (không ô chọn bài); Esc đóng, focus về nút', () => {
    render(<PlayerView songId={SEED} />);
    const bar = screen.getByRole('complementary', { name: 'Công cụ màn chơi' });
    const obs = within(bar).getByRole('button', { name: /^OBS/ });
    expect(obs.getAttribute('aria-haspopup')).toBe('dialog');
    obs.focus();
    fireEvent.click(obs);
    const dialog = screen.getByRole('dialog', { name: 'Tạo link OBS' });
    expect(within(dialog).getAllByText('TAKEDISKRUSH!').length).toBeGreaterThan(0);
    expect(within(dialog).queryByRole('combobox', { name: 'Bài' })).toBeNull();
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(obs);
  });

  it('Space không chạy bài khi hộp thoại OBS đang mở', () => {
    render(<PlayerView songId={SEED} />);
    fireEvent.click(screen.getByRole('button', { name: /^OBS/ }));
    act(() => {
      fireEvent.keyDown(window, { code: 'Space' });
      fireEvent.keyUp(window, { code: 'Space' });
    });
    expect(playButton().getAttribute('data-playing')).toBe('false');
  });
});

describe("PlayerView: 'dfht:command'", () => {
  it('toggle = Space, restart = R, nextLine = →, prevLine = ←', () => {
    render(<PlayerView songId={SEED} />);
    expect(playButton().getAttribute('data-playing')).toBe('false');
    command('toggle');
    expect(playButton().getAttribute('data-playing')).toBe('true');
    command('toggle');
    expect(playButton().getAttribute('data-playing')).toBe('false');

    command('nextLine');
    const second = position();
    expect(second).toBeGreaterThan(0);
    command('nextLine');
    expect(position()).toBeGreaterThan(second);
    command('prevLine');
    expect(position()).toBe(second);

    command('restart');
    expect(playButton().getAttribute('data-playing')).toBe('true');
    expect(position()).toBeLessThan(0.05); // đồng hồ thật (performance.now) đã nhích chút ít
  });

  it('bỏ qua lệnh lạ / detail sai; bỏ qua khi hộp thoại đang mở', () => {
    render(<PlayerView songId={SEED} />);
    act(() => {
      window.dispatchEvent(new CustomEvent(DFHT_COMMAND_EVENT, { detail: { command: 'explode' } }));
      window.dispatchEvent(new CustomEvent(DFHT_COMMAND_EVENT, { detail: 'toggle' }));
      window.dispatchEvent(new Event(DFHT_COMMAND_EVENT));
    });
    expect(playButton().getAttribute('data-playing')).toBe('false');
    fireEvent.click(screen.getByRole('button', { name: /^OBS/ }));
    command('toggle');
    expect(playButton().getAttribute('data-playing')).toBe('false');
  });

  it('gỡ listener khi rời Player', () => {
    const { unmount } = render(<PlayerView songId={SEED} />);
    unmount();
    expect(() => command('toggle')).not.toThrow();
  });
});

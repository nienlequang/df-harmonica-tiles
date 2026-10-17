import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { getAudioEngine } from '../audio/engine';
import { translate } from '../i18n/strings';
import type { StringKey } from '../i18n/strings';
import { listSongs, useLibrary } from '../library/store';
import { useSettings } from '../ui/settings';
import { closeFloatingWindow, getFloatingWindowState } from './FloatingWindow';
import { FloatingWindowButton, PIP_NOTE_MS } from './FloatingWindowButton';
import { createFakePipWindow } from './testing/fakePipWindow';
import type { FakePipWindow } from './testing/fakePipWindow';

const en = (key: StringKey) => translate('en', key);
const [SONG_A, SONG_B] = listSongs().map((e) => e.id) as [string, string];

let fake: FakePipWindow;
let requestWindow: Mock;

function installPip(impl?: () => Promise<Window>): void {
  requestWindow = vi.fn(impl ?? (async () => fake.win));
  Object.defineProperty(window, 'documentPictureInPicture', {
    configurable: true,
    value: { requestWindow },
  });
}

beforeEach(() => {
  fake = createFakePipWindow();
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
  act(() => closeFloatingWindow());
  delete (window as Window & { documentPictureInPicture?: unknown }).documentPictureInPicture;
  useLibrary.setState({ songs: [] });
  getAudioEngine().dispose();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('FloatingWindowButton', () => {
  it('explains in one line instead of failing when the browser lacks the API (then hides it)', async () => {
    render(<FloatingWindowButton songId={SONG_A} />);
    const btn = screen.getByRole('button', { name: en('pip.button') });
    expect(btn.getAttribute('title')).toBe(en('pip.unsupported'));
    expect(btn.getAttribute('aria-pressed')).toBe('false');
    vi.useFakeTimers();
    try {
      fireEvent.click(btn);
      await act(async () => {
        await Promise.resolve();
      });
      expect(screen.getByText(en('pip.unsupported'))).toBeTruthy();
      expect(btn.getAttribute('aria-describedby')).toBeTruthy();
      act(() => vi.advanceTimersByTime(PIP_NOTE_MS));
      expect(screen.queryByText(en('pip.unsupported'))).toBeNull();
      expect(btn.getAttribute('aria-describedby')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('is a toggle: opens (pressed + status), the same button closes', async () => {
    installPip();
    const onOpened = vi.fn();
    render(<FloatingWindowButton songId={SONG_A} onOpened={onOpened} />);
    const btn = screen.getByRole('button', { name: en('pip.button') });
    fireEvent.click(btn);
    expect(requestWindow).toHaveBeenCalledTimes(1); // gọi ngay trong click
    await waitFor(() => expect(onOpened).toHaveBeenCalledTimes(1));
    expect(btn.getAttribute('aria-pressed')).toBe('true');
    expect(btn.getAttribute('title')).toBe(en('pip.close'));
    expect(screen.getByRole('status').textContent).toBe(en('pip.statusOpen'));
    expect(btn.textContent).toContain(en('pip.openTag'));
    expect(screen.queryByRole('button', { name: en('pip.switchSong') })).toBeNull();
    fireEvent.click(btn);
    expect(fake.close).toHaveBeenCalled();
    expect(getFloatingWindowState().open).toBe(false);
    expect(btn.getAttribute('aria-pressed')).toBe('false');
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('offers to switch the floating window to this song', async () => {
    installPip();
    const { rerender } = render(<FloatingWindowButton songId={SONG_A} />);
    fireEvent.click(screen.getByRole('button', { name: en('pip.button') }));
    await screen.findByRole('status');
    rerender(<FloatingWindowButton songId={SONG_B} />);
    fireEvent.click(screen.getByRole('button', { name: en('pip.switchSong') }));
    await waitFor(() => expect(getFloatingWindowState().songId).toBe(SONG_B));
    expect(requestWindow).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: en('pip.switchSong') })).toBeNull();
  });

  it('says so when the browser blocks the window', async () => {
    installPip(() => Promise.reject(new DOMException('x', 'NotAllowedError')));
    render(<FloatingWindowButton songId={SONG_A} />);
    fireEvent.click(screen.getByRole('button', { name: en('pip.button') }));
    expect(await screen.findByText(en('pip.blocked'))).toBeTruthy();
  });
});

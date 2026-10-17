/**
 * Nội dung cửa sổ nổi (render vào document chính, `hostWindow` = cửa sổ giả): thanh công cụ, đếm
 * ngược trên timer của cửa sổ nổi, căn chỉnh, phím Space / R / Esc trên cửa sổ nổi, âm thanh tắt.
 */
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getAudioEngine } from '../audio/engine';
import { NOTE_KEYS } from '../core/keys';
import { translate } from '../i18n/strings';
import type { StringKey } from '../i18n/strings';
import { listSongs } from '../library/store';
import { GAME_FRAME_PAD } from '../player/layout';
import { useSettings } from '../ui/settings';
import { FloatingStage, PIP_RENDERER_OPTIONS } from './FloatingStage';
import { takeInitialPlacement } from './pipPrefs';
import { createFakePipWindow } from './testing/fakePipWindow';
import type { FakePipWindow } from './testing/fakePipWindow';

const en = (key: StringKey, params?: Record<string, string | number>) =>
  translate('en', key, params);

const SONG = listSongs()[0]?.id ?? '';
let fake: FakePipWindow;
const globalRaf = vi.fn(() => 1);

function renderStage(songId = SONG) {
  return render(<FloatingStage songId={songId} hostWindow={fake.win} />);
}

const toolbar = () => screen.getByRole('group', { name: en('pip.toolbar') });
const playButton = () =>
  within(toolbar()).getByRole('button', {
    name: new RegExp(`^(${en('player.play')}|${en('player.pause')})$`),
  });

beforeEach(() => {
  vi.useFakeTimers();
  fake = createFakePipWindow();
  globalRaf.mockClear();
  vi.stubGlobal('requestAnimationFrame', globalRaf);
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => null);
  useSettings.getState().reset();
  useSettings.getState().set({ language: 'en', countIn: false, startDelaySec: 0 });
});

afterEach(() => {
  getAudioEngine().dispose();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('FloatingStage', () => {
  it('shows the lanes only, with the game-panel layout and the hold/mode banner slot', () => {
    const { container } = renderStage();
    const stage = screen.getByRole('region', { name: en('pip.region') });
    expect(stage.querySelector('canvas.pip-canvas')).not.toBeNull();
    expect(container.querySelector('.pip-banner [role="group"]')).not.toBeNull();
    // Không có game bar / lời / transport đầy đủ của Player.
    expect(container.querySelector('.game-bar, .transport')).toBeNull();
    expect(PIP_RENDERER_OPTIONS.lanePadding).toBe('none');
    // v1.0.1: khung = khung bảng phím PC (8 làn + đệm hai bên) — ô ngoài cùng không sát mép cửa sổ.
    expect(PIP_RENDERER_OPTIONS.framePad).toBe(GAME_FRAME_PAD);
    expect(PIP_RENDERER_OPTIONS.hitLinePos).toBeGreaterThan(0.9);
    expect(fake.doc.title).toContain(en('pip.region'));
  });

  it('counts down like Settings → Countdown (3 s by default) on the floating window timers, then plays on its rAF', () => {
    useSettings.getState().set({ startDelaySec: 3 });
    renderStage();
    // Không có ô đếm ngược riêng (góp ý 2026-10-16: chỉ chỉnh ở Cài đặt → Phát bài).
    expect(within(toolbar()).queryByLabelText(en('player.startDelay'))).toBeNull();
    expect(toolbar().querySelector('select')).toBeNull();
    fireEvent.click(playButton());
    const status = screen.getByRole('status');
    expect(status.textContent).toContain('3');
    expect(status.textContent).toContain(en('pip.countdownHint'));
    expect(fake.setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 1000);
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(screen.getByRole('status').textContent).toContain('1');
    // Frame đầu đếm vào (ô đứng yên) đã vẽ bằng rAF của cửa sổ nổi; hết đếm → chạy tiếp trên rAF đó.
    act(() => fake.flushFrames());
    fake.raf.mockClear();
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.queryByRole('status')).toBeNull();
    expect(playButton().getAttribute('aria-label')).toBe(en('player.pause'));
    expect(fake.raf).toHaveBeenCalled();
    expect(globalRaf).not.toHaveBeenCalled();
    expect(screen.getByRole('region', { name: en('pip.region') }).dataset.playing).toBe('true');
    expect(getAudioEngine().context).toBeNull(); // âm thanh tắt mặc định
  });

  it('count-in after the countdown draws no numbers in the DOM (góp ý 2026-10-16: no double counting)', () => {
    useSettings.getState().set({ countIn: true, startDelaySec: 3 });
    renderStage();
    const stage = screen.getByRole('region', { name: en('pip.region') });
    /** Phần tử lá ngoài thanh công cụ có chữ là một số. */
    const numbers = () =>
      Array.from(stage.querySelectorAll('*'))
        .filter((el) => el.children.length === 0 && !toolbar().contains(el))
        .map((el) => (el.textContent ?? '').trim())
        .filter((s) => /^\d+$/.test(s));
    fireEvent.click(playButton());
    // Ô còn đứng yên: số lớn 3-2-1.
    expect(numbers()).toEqual(['3']);
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    // Đang đếm vào (ô rơi dẫn vào): không còn số / status đếm nào.
    expect(playButton().getAttribute('aria-label')).toBe(en('player.pause'));
    expect(stage.querySelector('.pip-countdown')).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
    expect(numbers()).toEqual([]);
  });

  it('countdown = Settings with a 3 s minimum (R7: Off → 3, 5 → 5); a Settings change applies on the next restart', () => {
    // beforeEach: Cài đặt → Đếm ngược = Tắt → cửa sổ nổi vẫn đếm 3 giây (bấm ▶ rồi còn chuyển vào game).
    renderStage();
    fireEvent.click(playButton());
    expect(screen.getByRole('status').textContent).toContain('3');
    expect(playButton().getAttribute('aria-label')).toBe(en('player.pause'));
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(screen.queryByRole('status')).toBeNull();
    expect(playButton().getAttribute('aria-label')).toBe(en('player.pause'));
    fireEvent.click(playButton());
    expect(playButton().getAttribute('aria-label')).toBe(en('player.play'));
    act(() => useSettings.getState().set({ startDelaySec: 5 }));
    fireEvent.click(within(toolbar()).getByRole('button', { name: en('player.restartAria') }));
    expect(screen.getByRole('status').textContent).toContain('5');
  });

  it('mobile scheme: game-like pad at the bottom (display only), banner at the top; PC: no pad', () => {
    const pc = renderStage();
    const stage = () => screen.getByRole('region', { name: en('pip.region') });
    expect(stage().dataset.scheme).toBe('pc');
    expect(stage().querySelector('.mpad')).toBeNull();
    pc.unmount();
    useSettings.getState().set({ controlScheme: 'mobile' });
    renderStage();
    expect(stage().dataset.scheme).toBe('mobile');
    const pad = stage().querySelector('.mpad.pip-mpad');
    expect(pad).not.toBeNull();
    expect(pad?.querySelectorAll('.mpad-mode')).toHaveLength(4);
    // Chỉ hiển thị: không có nút bấm được trong bàn nút.
    expect(pad?.querySelector('button:not([disabled])')).toBeNull();
    // Banner không còn neo theo hit line kiểu PC (pip.css đặt ở đầu khu làn).
    expect((stage().querySelector('.pip-banner') as HTMLElement).style.bottom).toBe('');
  });

  it('toggles the align overlay: 8 labelled guides + bottom edge; Esc on the window hides it', () => {
    renderStage();
    const align = within(toolbar()).getByRole('button', { name: en('pip.align') });
    expect(align.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(align);
    expect(align.getAttribute('aria-pressed')).toBe('true');
    const guides = screen.getByRole('group', { name: en('pip.alignRegion') });
    const cols = guides.querySelectorAll('.pip-align-col');
    expect(Array.from(cols, (c) => c.textContent)).toEqual([...NOTE_KEYS]);
    expect(guides.querySelector('.pip-align-edge')?.textContent).toBe(en('pip.alignEdge'));
    expect(within(guides).getByText(en('pip.help'))).toBeTruthy();
    act(() => fake.press('Escape', 'Escape'));
    expect(screen.queryByRole('group', { name: en('pip.alignRegion') })).toBeNull();
    expect(align.getAttribute('aria-pressed')).toBe('false');
  });

  it('labels the guides with jianpu digits (separate dot elements) in the mobile scheme', () => {
    useSettings.getState().set({ controlScheme: 'mobile' });
    renderStage();
    fireEvent.click(within(toolbar()).getByRole('button', { name: en('pip.align') }));
    const cols = screen
      .getByRole('group', { name: en('pip.alignRegion') })
      .querySelectorAll('.pip-align-col');
    expect(Array.from(cols, (c) => c.querySelector('.jp-digit')?.textContent)).toEqual([
      '1',
      '2',
      '3',
      '4',
      '5',
      '6',
      '7',
      '1',
    ]);
    // Chỉ "1" cao (phím ,) có chấm trên — chấm là phần tử riêng, không phải ký tự ghép.
    expect(cols[7]?.querySelectorAll('.jp-dots-above .jp-dot')).toHaveLength(1);
    expect(cols[0]?.querySelector('.jp-dot')).toBeNull();
    expect(cols[7]?.querySelector('.jp-glyph')?.textContent).toBe('1');
  });

  it('handles Space / R / Esc on the floating window (not the main window)', () => {
    renderStage();
    act(() => fake.press('Space', ' '));
    expect(playButton().getAttribute('aria-label')).toBe(en('player.pause'));
    act(() => fake.press('Space', ' '));
    expect(playButton().getAttribute('aria-label')).toBe(en('player.play'));
    // Phím trên window chính không điều khiển cửa sổ nổi.
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', key: ' ' }));
    });
    expect(playButton().getAttribute('aria-label')).toBe(en('player.play'));
    // R: chơi lại (đếm ngược nếu có) — Esc hủy đếm ngược khi không căn chỉnh.
    act(() => useSettings.getState().set({ startDelaySec: 10 }));
    act(() => fake.press('KeyR', 'r'));
    expect(screen.getByRole('status').textContent).toContain('10');
    act(() => fake.press('Escape', 'Escape'));
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('removes its keyboard listeners from the floating window on unmount', () => {
    const { unmount } = renderStage();
    expect(fake.listenerCount('keydown')).toBeGreaterThan(0);
    unmount();
    expect(fake.listenerCount('keydown')).toBe(0);
    expect(fake.listenerCount('keyup')).toBe(0);
    expect(fake.frames.size).toBe(0);
  });

  it('shows the red melody badge outside the auto-hiding toolbar while the sample melody is on', () => {
    const { unmount } = renderStage();
    expect(document.querySelector('.player-chip-melody')).toBeNull();
    unmount();
    useSettings.getState().set({ audioEnabled: true });
    renderStage();
    const badge = document.querySelector('.player-chip-melody');
    expect(badge?.textContent).toContain(en('player.melodyBadge'));
    expect(badge?.getAttribute('title')).toBe(en('player.melodyBadgeHint'));
    expect(toolbar().contains(badge)).toBe(false);
    expect(screen.getByRole('region', { name: en('pip.region') }).dataset.melody).toBe('true');
  });

  describe('"Reset to standard size" (C)', () => {
    /** Cửa sổ PiP giả có màn hình 2560 × 1440, thanh tiêu đề 36 px; `allow` = trình duyệt cho đổi cỡ. */
    function dress(allow: boolean) {
      const resizeTo = vi.fn((w: number, h: number) => {
        if (allow) fake.resizeTo(w, h - 36);
      });
      Object.defineProperties(fake.win, {
        screen: { configurable: true, value: { width: 2560, height: 1440 } },
        outerWidth: { configurable: true, get: () => fake.win.innerWidth },
        outerHeight: { configurable: true, get: () => fake.win.innerHeight + 36 },
        resizeTo: { configurable: true, value: resizeTo },
      });
      return resizeTo;
    }
    const resetButton = () => within(toolbar()).getByRole('button', { name: en('pip.resetSize') });

    it('resizes to the standard size of its screen and forgets the remembered size', () => {
      localStorage.setItem(
        'dfht-pip-size',
        JSON.stringify({ width: 500, height: 400, screen: { width: 2560, height: 1440, dpr: 1 } }),
      );
      const resizeTo = dress(true);
      renderStage();
      expect(resetButton().getAttribute('title')).toBe(en('pip.resetSizeHint'));
      fireEvent.click(resetButton());
      // 1440p: khung bảng phím 738 (8 cột × 86,7 + đệm hai bên) + gutter 75 = 813 rộng; cao NGOÀI 1000 = mép
      // trên màn → mép trên bảng phím.
      expect(resizeTo).toHaveBeenCalledWith(813, 1000);
      expect(localStorage.getItem('dfht-pip-size')).toBeNull();
      act(() => {
        vi.advanceTimersByTime(1000);
      });
      expect(screen.queryByRole('alert')).toBeNull();
      // Đổi được → lần mở sau không cần bỏ chỗ / cỡ Chrome đã nhớ (D-419).
      expect(takeInitialPlacement()).toBe(false);
    });

    it('browser refuses (size unchanged) → a short note to close / reopen, hidden again later', () => {
      dress(false);
      renderStage();
      fireEvent.click(resetButton());
      expect(screen.queryByRole('alert')).toBeNull();
      act(() => {
        vi.advanceTimersByTime(400);
      });
      const note = screen.getByRole('alert');
      expect(note.textContent).toBe(en('pip.resetSizeBlocked'));
      expect(toolbar().contains(note)).toBe(true);
      // "Đóng rồi mở lại" phải ra cỡ chuẩn: lần mở sau xin preferInitialWindowPlacement (D-419).
      expect(takeInitialPlacement()).toBe(true);
      act(() => {
        vi.advanceTimersByTime(8000);
      });
      expect(screen.queryByRole('alert')).toBeNull();
    });

    it('no resize API at all → the note shows right away; Vietnamese label', () => {
      useSettings.getState().set({ language: 'vi' });
      renderStage();
      const btn = within(
        screen.getByRole('group', { name: translate('vi', 'pip.toolbar') }),
      ).getByRole('button', { name: 'Đặt lại cỡ chuẩn' });
      fireEvent.click(btn);
      expect(screen.getByRole('alert').textContent).toBe(translate('vi', 'pip.resetSizeBlocked'));
      expect(takeInitialPlacement()).toBe(true);
    });
  });

  it('explains a missing song', () => {
    renderStage('nope');
    expect(screen.getByRole('alert').textContent).toBe(en('pip.songMissing', { id: 'nope' }));
  });

  it('the OBS overlay follows the floating window while it is open (follow broadcast, R5)', () => {
    const posted: { kind: string; source?: string; playing?: boolean; cause?: string }[] = [];
    vi.stubGlobal(
      'BroadcastChannel',
      class {
        postMessage(m: unknown) {
          posted.push(m as (typeof posted)[number]);
        }
        addEventListener() {}
        removeEventListener() {}
        close() {}
      },
    );
    const entry = listSongs()[0];
    const { unmount } = renderStage();
    expect(posted.map((m) => m.kind)).toEqual(['song', 'state']);
    expect(posted[0]?.source).toBe(entry?.source);
    // Cài đặt → Đếm ngược = tắt (beforeEach) → cửa sổ nổi vẫn đếm tối thiểu 3 giây rồi chạy.
    fireEvent.click(playButton());
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(posted.filter((m) => m.kind === 'state').at(-1)).toMatchObject({
      playing: true,
      cause: 'change',
    });
    unmount();
    expect(posted.at(-1)?.kind).toBe('bye');
  });
});

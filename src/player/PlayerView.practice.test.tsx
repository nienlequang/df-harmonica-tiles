/**
 * PlayerView: practice mode (thanh điều khiển, dải điểm, PERFECT/MISS, bảng kết quả, cảnh báo
 * Ctrl+N, game bar "đang bấm") và đếm ngược trước khi phát. performance.now giả (clock của Player),
 * rAF chạy tay, audio engine mock (không hỗ trợ).
 */
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useLibrary } from '../library/store';
import { useSettings } from '../ui/settings';
import { PlayerView } from './PlayerView';

vi.mock('../audio/engine', () => ({
  isAudioSupported: () => false,
  getAudioEngine: () => {
    throw new Error('audio engine must not be used when unsupported');
  },
  hasStickyActivation: () => false,
  UNLOCK_TIMEOUT_MS: 1000,
}));

let frames = new Map<number, FrameRequestCallback>();
let nextFrame = 1;
let nowMs = 0;
const added: string[] = [];

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

function keyDown(code: string, init: KeyboardEventInit = {}): void {
  act(() => {
    fireEvent.keyDown(window, { code, ...init });
  });
}
function keyUp(code: string, init: KeyboardEventInit = {}): void {
  act(() => {
    fireEvent.keyUp(window, { code, ...init });
  });
}
function press(code: string, init: KeyboardEventInit = {}): void {
  keyDown(code, init);
  keyUp(code, init);
}

const playButton = () => document.querySelector('button.transport-play') as HTMLButtonElement;
const hud = () => document.querySelector('.practice-hud') as HTMLElement | null;
const stat = (name: string): string =>
  hud()?.querySelector(`.practice-stat-${name} dd`)?.textContent ?? '';

/** Bài ngắn 120 BPM: Z X C V (0.5 s mỗi nốt, 2 s cả bài). */
function addShortSong(): string {
  const id = useLibrary.getState().addSong('@title Ngắn\n@bpm 120\nZ X C V\n');
  added.push(id);
  return id;
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
  useSettings.getState().reset();
  // mặc định v4 đếm ngược 3 giây — test luyện tập cần phát ngay (test đếm ngược tự đặt giá trị)
  useSettings.getState().set({ countIn: false, startDelaySec: 0 });
});

afterEach(() => {
  for (const id of added.splice(0)) useLibrary.getState().removeSong(id);
  vi.unstubAllGlobals();
  window.location.hash = '';
});

describe('PlayerView — practice mode', () => {
  it('transport toggle shows the mode buttons, the guide toggle and the score strip', () => {
    const id = addShortSong();
    render(<PlayerView songId={id} />);
    const toggle = screen.getByRole('button', { name: 'Luyện tập' });
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    expect(screen.queryByRole('region', { name: 'Điểm luyện tập' })).toBeNull();
    act(() => toggle.click());
    expect(toggle.getAttribute('aria-pressed')).toBe('true');

    const modes = screen.getByRole('group', { name: 'Chế độ luyện tập' });
    const score = within(modes).getByRole('button', { name: 'Chấm điểm' });
    const wait = within(modes).getByRole('button', { name: 'Chờ' });
    expect(score.getAttribute('aria-pressed')).toBe('true'); // mặc định settings
    act(() => wait.click());
    expect(useSettings.getState().practiceMode).toBe('wait');
    expect(wait.getAttribute('aria-pressed')).toBe('true');

    // "Nghe giai điệu mẫu" chỉ có khi giai điệu mẫu đã bật trong Cài đặt → Âm thanh (tìm theo chữ
    // thay vì getByRole — tính tên truy cập trên cả DOM Player rất chậm trong jsdom).
    const guideButton = () =>
      Array.from(document.querySelectorAll('button')).find(
        (b) => b.textContent === 'Nghe giai điệu mẫu',
      );
    expect(guideButton()).toBeUndefined();
    act(() => useSettings.getState().set({ audioEnabled: true }));
    const guide = guideButton()!;
    expect(guide.getAttribute('aria-pressed')).toBe('false');
    act(() => guide.click());
    expect(guide.getAttribute('aria-pressed')).toBe('true');

    const strip = screen.getByRole('region', { name: 'Điểm luyện tập' });
    // Luôn ghi rõ: practice chỉ nhận input khi tab đang focus.
    expect(strip.textContent).toContain(
      'Luyện tập chỉ nhận phím / chuột khi tab app đang được chọn',
    );
    expect(strip.textContent).toContain('Chờ: bài dừng ở mỗi nốt');

    act(() => toggle.click());
    expect(screen.queryByRole('region', { name: 'Điểm luyện tập' })).toBeNull();
    expect(screen.queryByRole('group', { name: 'Chế độ luyện tập' })).toBeNull();
  });

  it('no keyboard substitute for the mouse modifiers: no Ctrl+N warning, Ctrl does not hold a mode', () => {
    const id = addShortSong();
    render(<PlayerView songId={id} />);
    act(() => screen.getByRole('button', { name: 'Luyện tập' }).click());
    expect(hud()?.querySelector('.practice-warning')).toBeNull();
    expect(hud()?.textContent).not.toContain('Ctrl');
    keyDown('ControlLeft', { key: 'Control' });
    const gameBar = screen.getByRole('group', { name: 'Gợi ý phím như trong game' });
    expect(gameBar.querySelector('.is-pressed')).toBeNull();
    keyUp('ControlLeft', { key: 'Control' });
  });

  it('score flow: PERFECT flash, live stats, pressed keycap, then the results modal and replay', () => {
    const id = addShortSong();
    render(<PlayerView songId={id} />);
    act(() => screen.getByRole('button', { name: 'Luyện tập' }).click());
    press('Space', { key: ' ' });
    expect(playButton().getAttribute('aria-label')).toBe('Tạm dừng');

    // Z đúng lúc → PERFECT gần hit line + combo 1; keycap Z sáng kiểu "đang bấm".
    keyDown('KeyZ', { key: 'z' });
    const gameBar = screen.getByRole('group', { name: 'Gợi ý phím như trong game' });
    const zCell = gameBar.querySelector('[data-key="Z"]') as HTMLElement;
    expect(zCell.dataset.pressed).toBe('true');
    expect(zCell.className).toContain('is-pressed');
    keyUp('KeyZ', { key: 'z' });
    expect(zCell.dataset.pressed).toBeUndefined();
    const flash = () => document.querySelector('.practice-flash');
    expect(flash()?.textContent).toContain('PERFECT');
    expect(flash()?.closest('[aria-hidden="true"]')).not.toBeNull();
    expect(stat('combo')).toBe('1');
    expect(stat('perfect')).toBe('1');
    expect(stat('accuracy')).toBe('100%'); // trên số nốt đã chấm

    // Không bấm X: quá 220 ms → MISS.
    advance(800);
    expect(flash()?.textContent).toContain('MISS');
    expect(stat('miss')).toBe('1');
    expect(stat('combo')).toBe('0');

    // Hết bài → nốt còn lại miss → bảng kết quả.
    advance(5000);
    const dialog = screen.getByRole('dialog', { name: 'Kết quả luyện tập' });
    expect(within(dialog).getByText('25%')).toBeTruthy();
    const value = (label: string) =>
      within(dialog).getByText(label).closest('div')?.querySelector('dd')?.textContent;
    expect(value('Perfect')).toBe('1');
    expect(value('Miss')).toBe('3');
    expect(value('Combo cao nhất')).toBe('1');
    expect(value('Tổng số nốt')).toBe('4');
    expect(playButton().getAttribute('aria-label')).toBe('Phát');
    // Modal mở: phím tắt Player tạm tắt.
    press('Space', { key: ' ' });
    expect(screen.getByRole('dialog', { name: 'Kết quả luyện tập' })).toBeTruthy();
    expect(playButton().getAttribute('aria-label')).toBe('Phát');

    act(() => within(dialog).getByRole('button', { name: 'Chơi lại' }).click());
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(playButton().getAttribute('aria-label')).toBe('Tạm dừng');
    expect(stat('perfect')).toBe('0');
    expect(stat('miss')).toBe('0');
  });

  it('closing the results keeps the position; Play starts a new run from the top', () => {
    const id = addShortSong();
    render(<PlayerView songId={id} />);
    act(() => screen.getByRole('button', { name: 'Luyện tập' }).click());
    press('Space', { key: ' ' });
    advance(5000);
    const dialog = screen.getByRole('dialog', { name: 'Kết quả luyện tập' });
    const footer = dialog.querySelector('.modal-footer') as HTMLElement;
    act(() => within(footer).getByRole('button', { name: 'Đóng' }).click());
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(stat('miss')).toBe('4');
    press('Space', { key: ' ' });
    expect(stat('miss')).toBe('0');
    expect(playButton().getAttribute('aria-label')).toBe('Tạm dừng');
  });

  it('wait mode shows the waiting status while the song is held', () => {
    useSettings.getState().set({ practiceMode: 'wait' });
    const id = addShortSong();
    render(<PlayerView songId={id} />);
    act(() => screen.getByRole('button', { name: 'Luyện tập' }).click());
    press('Space', { key: ' ' });
    flushFrames();
    expect(hud()?.querySelector('.practice-status.is-waiting')?.textContent).toBe(
      'Đang chờ bạn bấm nốt có viền vàng…',
    );
    expect(playButton().getAttribute('aria-label')).toBe('Tạm dừng');
    press('KeyZ', { key: 'z' });
    expect(hud()?.querySelector('.practice-status.is-waiting')).toBeNull();
    expect(stat('perfect')).toBe('1');
  });

  it('mouse buttons light the modifier row as pressed (distinct from the expected highlight)', () => {
    const id = addShortSong();
    render(<PlayerView songId={id} />);
    act(() => screen.getByRole('button', { name: 'Luyện tập' }).click());
    const left = () => document.querySelector('.gb-mod[data-mod="left"]') as HTMLElement;
    const stage = document.querySelector('.player-stage') as HTMLElement;
    act(() => {
      fireEvent.pointerDown(stage, { button: 0, buttons: 1, pointerType: 'mouse' });
    });
    expect(left().dataset.pressed).toBe('true');
    expect(left().className).toContain('is-pressed');
    expect(left().className).not.toContain('is-active');
    act(() => {
      fireEvent.pointerUp(window, { button: 0, buttons: 0, pointerType: 'mouse' });
    });
    expect(left().dataset.pressed).toBeUndefined();
    // Ctrl không còn là phím thay chuột trái
    keyDown('ControlLeft', { key: 'Control', ctrlKey: true });
    expect(left().dataset.pressed).toBeUndefined();
    keyUp('ControlLeft', { key: 'Control' });
  });

  it('Player hotkeys keep working in practice mode', () => {
    const id = addShortSong();
    render(<PlayerView songId={id} />);
    expect(document.querySelector('.player.is-practice')).toBeNull();
    act(() => screen.getByRole('button', { name: 'Luyện tập' }).click());
    // Practice bật: khu sân khấu không cho bôi đen chữ (CSS theo lớp này).
    expect(document.querySelector('.player.is-practice')).not.toBeNull();
    press('Space', { key: ' ' });
    expect(playButton().getAttribute('aria-label')).toBe('Tạm dừng');
    press('Space', { key: ' ' });
    expect(playButton().getAttribute('aria-label')).toBe('Phát');
    press('KeyR', { key: 'r' }); // Restart
    expect(playButton().getAttribute('aria-label')).toBe('Tạm dừng');
  });

  it('switches to English', () => {
    useSettings.getState().set({ language: 'en', audioEnabled: true });
    const id = addShortSong();
    render(<PlayerView songId={id} />);
    act(() => screen.getByRole('button', { name: 'Practice' }).click());
    const strip = screen.getByRole('region', { name: 'Practice score' });
    expect(strip.textContent).toContain(
      'Practice only receives keys/mouse while this tab has focus',
    );
    expect(strip.textContent).not.toContain('Ctrl');
    expect(screen.getByRole('button', { name: 'Hear the melody' })).toBeTruthy();
  });

  it('unmount with practice on removes every listener and the frame loop', () => {
    const add = vi.spyOn(window, 'addEventListener');
    const remove = vi.spyOn(window, 'removeEventListener');
    const id = addShortSong();
    const { unmount } = render(<PlayerView songId={id} />);
    act(() => screen.getByRole('button', { name: 'Luyện tập' }).click());
    press('Space', { key: ' ' });
    flushFrames();
    unmount();
    expect(frames.size).toBe(0);
    const types = new Set(add.mock.calls.map((c) => c[0]));
    for (const type of types) {
      const n = add.mock.calls.filter((c) => c[0] === type).length;
      const removed = remove.mock.calls.filter((c) => c[0] === type).length;
      expect({ type, removed }).toEqual({ type, removed: n });
    }
  });
});

describe('PlayerView — đếm ngược trước khi phát', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const overlay = () => document.querySelector('.player-countdown') as HTMLElement | null;

  it('Space shows a big N…1 countdown over the stage, then plays', () => {
    useSettings.getState().set({ startDelaySec: 3 });
    const id = addShortSong();
    render(<PlayerView songId={id} />);
    press('Space', { key: ' ' });
    expect(overlay()).not.toBeNull();
    expect(overlay()?.getAttribute('role')).toBe('status');
    expect(overlay()?.querySelector('.player-countdown-num')?.textContent).toBe('3');
    expect(overlay()?.textContent).toContain('Bắt đầu sau 3 giây');
    expect(overlay()?.textContent).toContain('Space / Esc để hủy');
    expect(overlay()?.closest('.player-canvas-wrap')).not.toBeNull();
    expect(playButton().getAttribute('aria-label')).toBe('Tạm dừng');
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(overlay()?.querySelector('.player-countdown-num')?.textContent).toBe('2');
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(overlay()).toBeNull();
    expect(playButton().getAttribute('aria-label')).toBe('Tạm dừng');
    advance(500);
    const seek = document.querySelector('input[aria-label="Vị trí trong bài"]') as HTMLInputElement;
    expect(Number(seek.value)).toBeCloseTo(1);
  });

  it('Escape and Space cancel the countdown', () => {
    useSettings.getState().set({ startDelaySec: 5 });
    const id = addShortSong();
    render(<PlayerView songId={id} />);
    press('Space', { key: ' ' });
    expect(overlay()).not.toBeNull();
    press('Escape', { key: 'Escape' });
    expect(overlay()).toBeNull();
    expect(playButton().getAttribute('aria-label')).toBe('Phát');
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(playButton().getAttribute('aria-label')).toBe('Phát');

    press('Space', { key: ' ' });
    expect(overlay()).not.toBeNull();
    press('Space', { key: ' ' });
    expect(overlay()).toBeNull();
    expect(playButton().getAttribute('aria-label')).toBe('Phát');
  });

  it('no countdown / count-in control on the transport bar; the countdown follows Settings', () => {
    const id = addShortSong();
    render(<PlayerView songId={id} />);
    // góp ý 2026-10-16: chỉ chỉnh ở Cài đặt → Phát bài.
    expect(screen.queryByRole('combobox', { name: 'Đếm ngược' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Đếm vào' })).toBeNull();
    // Đổi ở Cài đặt (7 giây — giá trị bất kỳ 0..10) → lần Phát kế tiếp đếm đúng số đó.
    act(() => useSettings.getState().set({ startDelaySec: 7 }));
    press('Space', { key: ' ' });
    expect(overlay()?.querySelector('.player-countdown-num')?.textContent).toBe('7');
    press('Escape', { key: 'Escape' });
    expect(overlay()).toBeNull();
  });

  it('count-in after the countdown shows no numbers anywhere in the DOM (no double counting)', () => {
    useSettings.getState().set({ startDelaySec: 3, countIn: true });
    const id = addShortSong();
    render(<PlayerView songId={id} />);
    const wrap = document.querySelector('.player-canvas-wrap') as HTMLElement;
    /** Mọi phần tử lá trong khu tiles có chữ là một số (vd. "3"). */
    const numbers = () =>
      Array.from(wrap.querySelectorAll('*'))
        .filter((el) => el.children.length === 0)
        .map((el) => (el.textContent ?? '').trim())
        .filter((s) => /^\d+$/.test(s));
    press('Space', { key: ' ' });
    // Ô còn đứng yên: số lớn 3-2-1 (đếm ngược trước khi phát).
    expect(numbers()).toEqual(['3']);
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    // Hết đếm ngược → đang đếm vào (0,65 ô nhịp = 2,6 beat ở 120 BPM = 1,3 s — leadIn.ts, v1.0.1): ô rơi, KHÔNG
    // có số nào.
    expect(overlay()).toBeNull();
    expect(playButton().getAttribute('aria-label')).toBe('Tạm dừng');
    for (let i = 0; i < 2; i++) {
      advance(500);
      expect(numbers()).toEqual([]);
      expect(screen.queryByText(/Bắt đầu sau/)).toBeNull();
    }
    const seek = document.querySelector('input[aria-label="Vị trí trong bài"]') as HTMLInputElement;
    // Vẫn trong ô nhịp đếm vào (chưa tới nốt đầu).
    expect(Number(seek.value)).toBe(0);
  });
});

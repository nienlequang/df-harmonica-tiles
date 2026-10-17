/**
 * Nút loa trên thanh điều khiển màn chơi (trước deploy, chủ dự án duyệt): mặc định tắt tiếng; bật phải qua
 * ĐÚNG hộp cảnh báo bản quyền của Cài đặt → Âm thanh; Hủy giữ tắt; "Tôi hiểu, bật" bật + huy hiệu đỏ; đang
 * bật thì bấm = tắt ngay (không hỏi); cùng một setting với Cài đặt (hai bên luôn khớp); Space chỉ bấm nút
 * khi Tab tới (bấm chuột rồi Space vẫn là phát / dừng — D-345).
 * performance.now giả, rAF chạy tay, audio engine mock (không hỗ trợ).
 */
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useLibrary } from '../library/store';
import { rememberLastPlayed } from '../ui/lastPlayed';
import { useSettings } from '../ui/settings';
import { SettingsView } from '../ui/SettingsView';
import { useToasts } from '../ui/toast';
import { PlayerView } from './PlayerView';
import { PlayerEngine } from './usePlayerEngine';

vi.mock('../audio/engine', () => ({
  isAudioSupported: () => false,
  getAudioEngine: () => {
    throw new Error('audio engine must not be used when unsupported');
  },
  hasStickyActivation: () => false,
  UNLOCK_TIMEOUT_MS: 1000,
}));

const DIALOG = 'Bật phát giai điệu mẫu?';
const BADGE = '🔊 Đang phát giai điệu';

let frames = new Map<number, FrameRequestCallback>();
let nextFrame = 1;
let nowMs = 0;
const added: string[] = [];

function flushFrames(): void {
  const list = Array.from(frames.values());
  frames.clear();
  act(() => list.forEach((cb) => cb(0)));
}

/** Bài ngắn 120 BPM: Z X C V. */
function addShortSong(): string {
  const id = useLibrary.getState().addSong('@title Loa\n@bpm 120\nZ X C V\n');
  added.push(id);
  return id;
}

const transport = () => screen.getByRole('group', { name: 'Điều khiển phát' });
/** Nút loa: tên cố định "Tiếng giai điệu" + aria-pressed (D-424); tooltip "Bật tiếng giai điệu" ↔ "Tắt tiếng". */
const soundButton = () => within(transport()).getByRole('button', { name: 'Tiếng giai điệu' });
const melodyOn = () => useSettings.getState().audioEnabled;
const badge = () => screen.queryByText(BADGE);
const playButton = () => within(transport()).getByRole('button', { name: /^(Phát|Tạm dừng)$/ });

/** Bấm bằng chuột như trình duyệt: pointerdown → focus nút → click. */
function mouseClick(el: HTMLElement): void {
  act(() => {
    fireEvent.pointerDown(el);
    fireEvent.mouseDown(el);
    el.focus();
    fireEvent.click(el);
  });
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
  // Phát ngay khi bấm (không đếm ngược 3 s mặc định).
  useSettings.getState().set({ startDelaySec: 0 });
  useToasts.setState({ toasts: [] });
  rememberLastPlayed(null);
});

afterEach(() => {
  for (const id of added.splice(0)) useLibrary.getState().removeSong(id);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.location.hash = '';
});

describe('màn chơi — nút loa (giai điệu mẫu)', () => {
  it('mặc định tắt tiếng: "Tiếng giai điệu" (tooltip "Bật tiếng giai điệu"), aria-pressed=false, không có huy hiệu; nằm ngay trước Tempo', () => {
    render(<PlayerView songId={addShortSong()} />);
    const btn = soundButton();
    expect(btn.getAttribute('aria-label')).toBe('Tiếng giai điệu');
    expect(btn.getAttribute('title')).toBe('Bật tiếng giai điệu');
    expect(btn.getAttribute('aria-pressed')).toBe('false');
    expect(btn.getAttribute('aria-haspopup')).toBe('dialog');
    expect(btn.getAttribute('data-sound')).toBe('off');
    expect(melodyOn()).toBe(false);
    expect(badge()).toBeNull();
    // Ngay cạnh Tempo (nhóm kế tiếp chứa thanh trượt Tempo).
    const group = btn.closest('.transport-group') as HTMLElement;
    const next = group.nextElementSibling as HTMLElement;
    expect(within(next).getByRole('slider', { name: /Tempo/ })).toBeTruthy();
  });

  it('bấm khi đang tắt → ĐÚNG hộp cảnh báo bản quyền của Cài đặt (focus = Hủy); chưa bật gì', () => {
    render(<PlayerView songId={addShortSong()} />);
    mouseClick(soundButton());
    const dialog = screen.getByRole('dialog', { name: DIALOG });
    expect(dialog.textContent).toContain('YouTube / Facebook / TikTok');
    expect(dialog.querySelector('.settings-warning')).not.toBeNull();
    const cancel = within(dialog).getByRole('button', { name: 'Hủy' });
    expect(document.activeElement).toBe(cancel);
    expect(within(dialog).getByRole('button', { name: 'Tôi hiểu, bật' })).toBeTruthy();
    expect(melodyOn()).toBe(false);
    expect(badge()).toBeNull();
  });

  it('Hủy (và Esc) giữ tắt tiếng, focus về nút loa', () => {
    render(<PlayerView songId={addShortSong()} />);
    const btn = soundButton();
    mouseClick(btn);
    act(() =>
      fireEvent.click(
        within(screen.getByRole('dialog', { name: DIALOG })).getByRole('button', { name: 'Hủy' }),
      ),
    );
    expect(screen.queryByRole('dialog', { name: DIALOG })).toBeNull();
    expect(melodyOn()).toBe(false);
    expect(soundButton().getAttribute('aria-pressed')).toBe('false');
    expect(document.activeElement).toBe(btn);

    mouseClick(btn);
    expect(screen.getByRole('dialog', { name: DIALOG })).toBeTruthy();
    act(() => fireEvent.keyDown(window, { key: 'Escape', code: 'Escape' }));
    expect(screen.queryByRole('dialog', { name: DIALOG })).toBeNull();
    expect(melodyOn()).toBe(false);
    expect(badge()).toBeNull();
  });

  it('"Tôi hiểu, bật" → bật (qua engine — mở khóa âm thanh trong cú bấm) + huy hiệu đỏ; tooltip thành "Tắt tiếng"', () => {
    const spy = vi.spyOn(PlayerEngine.prototype, 'setAudioEnabled');
    render(<PlayerView songId={addShortSong()} />);
    mouseClick(soundButton());
    act(() =>
      fireEvent.click(
        within(screen.getByRole('dialog', { name: DIALOG })).getByRole('button', {
          name: 'Tôi hiểu, bật',
        }),
      ),
    );
    expect(spy).toHaveBeenCalledWith(true);
    expect(melodyOn()).toBe(true);
    expect(screen.queryByRole('dialog', { name: DIALOG })).toBeNull();
    expect(badge()).not.toBeNull();
    const btn = soundButton();
    expect(btn.getAttribute('aria-label')).toBe('Tiếng giai điệu');
    expect(btn.getAttribute('title')).toBe('Tắt tiếng');
    expect(btn.getAttribute('aria-pressed')).toBe('true');
    expect(btn.getAttribute('aria-haspopup')).toBeNull();
    expect(btn.getAttribute('data-sound')).toBe('on');
  });

  it('đang bật → bấm = tắt ngay, không hỏi, huy hiệu biến mất', () => {
    act(() => useSettings.getState().set({ audioEnabled: true }));
    render(<PlayerView songId={addShortSong()} />);
    expect(badge()).not.toBeNull();
    mouseClick(soundButton());
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(melodyOn()).toBe(false);
    expect(badge()).toBeNull();
    expect(soundButton().getAttribute('aria-pressed')).toBe('false');
    expect(soundButton().getAttribute('title')).toBe('Bật tiếng giai điệu');
  });

  it('cùng setting với Cài đặt → Âm thanh: bật / tắt ở một bên, bên kia khớp ngay', () => {
    render(
      <>
        <PlayerView songId={addShortSong()} />
        <SettingsView />
      </>,
    );
    const sw = screen.getByRole('switch', { name: 'Phát giai điệu mẫu' }) as HTMLInputElement;
    expect(sw.checked).toBe(false);
    // Bật từ màn chơi → công tắc Cài đặt bật.
    mouseClick(soundButton());
    act(() =>
      fireEvent.click(
        within(screen.getByRole('dialog', { name: DIALOG })).getByRole('button', {
          name: 'Tôi hiểu, bật',
        }),
      ),
    );
    expect(sw.checked).toBe(true);
    expect(screen.getByText('Đang bật giai điệu')).toBeTruthy();
    // Tắt từ Cài đặt → nút loa về tắt tiếng.
    act(() => fireEvent.click(sw));
    expect(melodyOn()).toBe(false);
    expect(soundButton().getAttribute('aria-pressed')).toBe('false');
    expect(badge()).toBeNull();
    // Bật từ Cài đặt (qua hộp cảnh báo) → nút loa đã nhấn (tooltip "Tắt tiếng").
    act(() => fireEvent.click(sw));
    act(() =>
      fireEvent.click(
        within(screen.getByRole('dialog', { name: DIALOG })).getByRole('button', {
          name: 'Tôi hiểu, bật',
        }),
      ),
    );
    expect(soundButton().getAttribute('aria-pressed')).toBe('true');
    // Tắt từ màn chơi → công tắc Cài đặt tắt.
    mouseClick(soundButton());
    expect(sw.checked).toBe(false);
  });

  it('Space sau khi bấm nút loa bằng chuột vẫn là phát / dừng (không bật / tắt tiếng)', () => {
    act(() => useSettings.getState().set({ audioEnabled: true }));
    render(<PlayerView songId={addShortSong()} />);
    const btn = soundButton();
    mouseClick(btn); // tắt tiếng, focus còn ở nút
    expect(melodyOn()).toBe(false);
    expect(document.activeElement).toBe(btn);
    act(() => {
      fireEvent.keyDown(btn, { code: 'Space', key: ' ' });
      fireEvent.keyUp(btn, { code: 'Space', key: ' ' });
    });
    flushFrames();
    expect(playButton().getAttribute('aria-label')).toBe('Tạm dừng');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(melodyOn()).toBe(false);
  });

  it('Tab tới nút loa: Space để nút nhận (không phát / dừng)', () => {
    render(<PlayerView songId={addShortSong()} />);
    const btn = soundButton();
    act(() => {
      fireEvent.keyDown(window, { key: 'Tab', code: 'Tab' });
      btn.focus();
    });
    let prevented = false;
    act(() => {
      prevented = !fireEvent.keyDown(btn, { code: 'Space', key: ' ' });
    });
    expect(prevented).toBe(false); // trình duyệt sẽ "bấm" nút đang focus
    flushFrames();
    expect(playButton().getAttribute('aria-label')).toBe('Phát');
  });

  it('hộp cảnh báo đang mở: phím tắt màn chơi tạm tắt', () => {
    render(<PlayerView songId={addShortSong()} />);
    mouseClick(soundButton());
    expect(screen.getByRole('dialog', { name: DIALOG })).toBeTruthy();
    act(() => {
      fireEvent.keyDown(window, { code: 'Space', key: ' ' });
      fireEvent.keyDown(window, { code: 'KeyR', key: 'r' });
    });
    flushFrames();
    expect(playButton().getAttribute('aria-label')).toBe('Phát');
  });

  it('kiểu Mobile và bài rỗng: nút loa vẫn có và dùng được', () => {
    act(() => useSettings.getState().set({ controlScheme: 'mobile' }));
    const id = useLibrary.getState().addSong('@title Rỗng\n@bpm 120\n');
    added.push(id);
    render(<PlayerView songId={id} />);
    const btn = soundButton();
    expect((btn as HTMLButtonElement).disabled).toBe(false);
    mouseClick(btn);
    expect(screen.getByRole('dialog', { name: DIALOG })).toBeTruthy();
  });

  it('English: "Melody sound" (tooltip "Turn on the melody" / "Mute")', () => {
    act(() => useSettings.getState().set({ language: 'en' }));
    render(<PlayerView songId={addShortSong()} />);
    const group = screen.getByRole('group', { name: 'Playback controls' });
    const btn = within(group).getByRole('button', { name: 'Melody sound' });
    expect(btn.getAttribute('title')).toBe('Turn on the melody');
    mouseClick(btn);
    act(() =>
      fireEvent.click(
        within(screen.getByRole('dialog', { name: 'Turn on the sample melody?' })).getByRole(
          'button',
          { name: 'I understand, turn on' },
        ),
      ),
    );
    const on = within(group).getByRole('button', { name: 'Melody sound' });
    expect(on.getAttribute('aria-pressed')).toBe('true');
    expect(on.getAttribute('title')).toBe('Mute');
  });
});

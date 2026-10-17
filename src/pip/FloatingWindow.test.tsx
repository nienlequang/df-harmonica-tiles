/**
 * Vòng đời "Cửa sổ nổi" với Document Picture-in-Picture giả (jsdom không có): mở / chép CSS + theme /
 * React root riêng / rAF của cửa sổ nổi / nhớ kích thước / mở lại = đổi bài / bị chặn / dọn sạch khi
 * 'pagehide'.
 */
import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { getAudioEngine } from '../audio/engine';
import { translate } from '../i18n/strings';
import { listSongs } from '../library/store';
import { GAME_FRAME_PAD } from '../player/layout';
import { useSettings } from '../ui/settings';
import {
  PIP_ROOT_CLASS,
  SIZE_SAVE_DEBOUNCE_MS,
  closeFloatingWindow,
  getFloatingWindowState,
  openFloatingWindow,
  useFloatingWindowState,
} from './FloatingWindow';
import type { OpenFloatingResult } from './FloatingWindow';
import {
  PIP_CHROME_GUESS,
  PIP_SIZE_STORAGE_KEY,
  presetSize,
  readChromeHeight,
  rememberChromeHeight,
  rememberSize,
  requestInitialPlacementOnce,
} from './pipPrefs';
import { createFakePipWindow } from './testing/fakePipWindow';
import type { FakePipWindow } from './testing/fakePipWindow';

let fake: FakePipWindow;
let requestWindow: Mock;
const globalRaf = vi.fn(() => 1);
const mainStyles: Element[] = [];

const SCREEN_1080 = { width: 1920, height: 1080, dpr: 1 };

/** Màn hình của tab gốc (jsdom mặc định 0 × 0 = "không đọc được"). */
function stubMainScreen(width: number, height: number): void {
  vi.stubGlobal('screen', { width, height });
}

/**
 * Cho cửa sổ giả màn hình + thanh tiêu đề như cửa sổ PiP thật: outer = inner + `chrome` (đọc lúc gọi),
 * `resizeTo(outerW, outerH)` đổi cỡ trong + bắn 'resize' (`allow` = false → trình duyệt từ chối: không đổi),
 * `navigator.userActivation.isActive` = `activation`.
 */
function dressFake(opts: { chrome: number; activation?: boolean; allow?: boolean }) {
  const resizeTo = vi.fn((w: number, h: number) => {
    if (opts.allow === false) return;
    fake.resizeTo(w, h - opts.chrome);
  });
  Object.defineProperties(fake.win, {
    screen: { configurable: true, value: { width: 1920, height: 1080 } },
    outerWidth: { configurable: true, get: () => fake.win.innerWidth },
    outerHeight: { configurable: true, get: () => fake.win.innerHeight + opts.chrome },
    navigator: {
      configurable: true,
      value: { userActivation: { isActive: opts.activation ?? false } },
    },
    resizeTo: { configurable: true, value: resizeTo },
  });
  return resizeTo;
}

const [SONG_A, SONG_B] = listSongs().map((e) => e.id);

function installPip(impl?: () => Promise<Window>): void {
  requestWindow = vi.fn(impl ?? (async () => fake.win));
  Object.defineProperty(window, 'documentPictureInPicture', {
    configurable: true,
    value: { requestWindow, window: null },
  });
}

async function open(songId: string | undefined): Promise<OpenFloatingResult> {
  let r: OpenFloatingResult = 'blocked';
  await act(async () => {
    r = await openFloatingWindow(songId ?? '');
  });
  return r;
}

function addMainStyle(css: string): HTMLStyleElement {
  const s = document.createElement('style');
  s.textContent = css;
  document.head.append(s);
  mainStyles.push(s);
  return s;
}

beforeEach(() => {
  fake = createFakePipWindow();
  globalRaf.mockClear();
  vi.stubGlobal('requestAnimationFrame', globalRaf);
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => null);
  useSettings.getState().reset();
  useSettings.getState().set({ language: 'en', countIn: false });
});

afterEach(() => {
  act(() => closeFloatingWindow());
  delete (window as Window & { documentPictureInPicture?: unknown }).documentPictureInPicture;
  for (const s of mainStyles.splice(0)) s.remove();
  document.documentElement.removeAttribute('data-theme');
  getAudioEngine().dispose();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('openFloatingWindow', () => {
  it('reports unsupported without the API', async () => {
    expect(getFloatingWindowState().supported).toBe(false);
    expect(await open(SONG_A)).toBe('unsupported');
    expect(getFloatingWindowState()).toEqual({ open: false, songId: null, supported: false });
  });

  it('opens at the screen preset, copies styles / theme / lang and mounts the stage', async () => {
    installPip();
    expect(getFloatingWindowState().supported).toBe(true);
    addMainStyle('.from-main { color: red; }');
    document.documentElement.setAttribute('data-theme', 'light');
    document.documentElement.setAttribute('lang', 'en');
    expect(await open(SONG_A)).toBe('opened');
    expect(requestWindow).toHaveBeenCalledTimes(1);
    // Màn hình không đọc được (jsdom) → cỡ chuẩn 1080p: 610 rộng (khung bảng phím + gutter), cao ngoài 750
    // − thanh tiêu đề đoán.
    expect(requestWindow).toHaveBeenCalledWith({ width: 610, height: 750 - PIP_CHROME_GUESS });
    const doc = fake.doc;
    expect(
      Array.from(doc.head.querySelectorAll('style')).some((s) =>
        s.textContent?.includes('.from-main'),
      ),
    ).toBe(true);
    expect(doc.documentElement.getAttribute('data-theme')).toBe('light');
    expect(doc.documentElement.getAttribute('lang')).toBe('en');
    expect(doc.documentElement.classList.contains('pip-doc')).toBe(true);
    const stage = doc.querySelector(`.${PIP_ROOT_CLASS} .pip-stage`);
    expect(stage?.getAttribute('aria-label')).toBe(translate('en', 'pip.region'));
    expect(doc.querySelector('canvas.pip-canvas')).not.toBeNull();
    expect(doc.title).toContain(translate('en', 'pip.region'));
    expect(getFloatingWindowState()).toEqual({ open: true, songId: SONG_A, supported: true });
  });

  it('opens at the standard size of the screen: as wide as the 8 keys, tall to the top edge (C)', async () => {
    stubMainScreen(2560, 1440);
    installPip();
    await open(SONG_A);
    expect(requestWindow).toHaveBeenCalledWith({ width: 813, height: 1000 - PIP_CHROME_GUESS });
    act(() => closeFloatingWindow());
    // 1080p ở Windows scale 125 %: màn báo 1536 × 864 px CSS.
    stubMainScreen(1536, 864);
    vi.stubGlobal('devicePixelRatio', 1.25);
    fake = createFakePipWindow();
    await open(SONG_A);
    expect(requestWindow).toHaveBeenLastCalledWith(presetSize(864, 1.25));
    expect(requestWindow).toHaveBeenLastCalledWith({ width: 488, height: 600 - PIP_CHROME_GUESS });
  });

  it('5:4 screen over Chrome 25 % request cap: asks for the exact width + a lower height, then grows it (D-418)', async () => {
    stubMainScreen(1280, 1024);
    // Cỡ chuẩn 578 × 677 (diện tích 391 306 > 25 % × 1280 × 1024 = 327 680) → xin 578 × 566.
    fake = createFakePipWindow({ width: 578, height: 566 });
    const resizeTo = dressFake({ chrome: 34, activation: true });
    Object.defineProperty(fake.win, 'screen', {
      configurable: true,
      value: { width: 1280, height: 1024 },
    });
    vi.useFakeTimers();
    installPip();
    await open(SONG_A);
    expect(requestWindow).toHaveBeenCalledWith({ width: 578, height: 566 });
    // Mở xong: kéo cao lên cao ngoài chuẩn 750·k (k = 1024 / 1080) — bề ngang giữ đúng 578.
    expect(resizeTo).toHaveBeenCalledWith(578, 711);
    expect(fake.win.innerHeight).toBe(677);
    act(() => {
      vi.advanceTimersByTime(SIZE_SAVE_DEBOUNCE_MS);
    });
    // Cỡ chuẩn (đủ cao) không phải lựa chọn của người dùng → không nhớ.
    expect(localStorage.getItem(PIP_SIZE_STORAGE_KEY)).toBeNull();
  });

  it('after a refused "Reset to standard size", the next open asks for the initial placement once (D-419)', async () => {
    installPip();
    requestInitialPlacementOnce();
    await open(SONG_A);
    expect(requestWindow).toHaveBeenLastCalledWith({
      width: 610,
      height: 750 - PIP_CHROME_GUESS,
      preferInitialWindowPlacement: true,
    });
    act(() => closeFloatingWindow());
    fake = createFakePipWindow();
    await open(SONG_A);
    expect(requestWindow).toHaveBeenLastCalledWith({ width: 610, height: 750 - PIP_CHROME_GUESS });
  });

  it('reopens at the remembered size only on the same screen (legacy entries without a screen are ignored)', async () => {
    stubMainScreen(1920, 1080);
    rememberSize({ width: 640, height: 720 }, SCREEN_1080);
    installPip();
    await open(SONG_A);
    expect(requestWindow).toHaveBeenLastCalledWith({ width: 640, height: 720 });
    act(() => closeFloatingWindow());
    // Màn khác → cỡ chuẩn của màn đó.
    stubMainScreen(1920, 1200);
    fake = createFakePipWindow();
    await open(SONG_A);
    expect(requestWindow).toHaveBeenLastCalledWith({ width: 677, height: 833 - PIP_CHROME_GUESS });
    act(() => closeFloatingWindow());
    // Bản lưu kiểu cũ (không ghi màn hình) → cỡ chuẩn.
    stubMainScreen(1920, 1080);
    localStorage.setItem(PIP_SIZE_STORAGE_KEY, JSON.stringify({ width: 640, height: 720 }));
    fake = createFakePipWindow();
    await open(SONG_A);
    expect(requestWindow).toHaveBeenLastCalledWith({ width: 610, height: 750 - PIP_CHROME_GUESS });
  });

  it('measures the real title bar after opening, remembers it and fixes the height when allowed', async () => {
    stubMainScreen(1920, 1080);
    fake = createFakePipWindow({ width: 610, height: 750 - PIP_CHROME_GUESS });
    const resizeTo = dressFake({ chrome: 40, activation: true });
    vi.useFakeTimers();
    installPip();
    await open(SONG_A);
    expect(readChromeHeight()).toBe(40);
    // Cao NGOÀI phải = 750 (mép trên màn → mép trên bảng phím): xin đổi cỡ ngay.
    expect(resizeTo).toHaveBeenCalledWith(610, 750);
    expect(fake.win.innerHeight).toBe(710);
    act(() => {
      vi.advanceTimersByTime(SIZE_SAVE_DEBOUNCE_MS);
    });
    // Cỡ chuẩn không phải lựa chọn của người dùng → không nhớ (lần sau tính lại theo thanh tiêu đề đã đo).
    expect(localStorage.getItem(PIP_SIZE_STORAGE_KEY)).toBeNull();
    act(() => closeFloatingWindow());
    fake = createFakePipWindow();
    await open(SONG_A);
    expect(requestWindow).toHaveBeenLastCalledWith({ width: 610, height: 710 });
  });

  it('without user activation the height is not changed now, the next open uses the measured title bar', async () => {
    stubMainScreen(1920, 1080);
    fake = createFakePipWindow({ width: 610, height: 750 - PIP_CHROME_GUESS });
    const resizeTo = dressFake({ chrome: 30, activation: false });
    installPip();
    await open(SONG_A);
    expect(resizeTo).not.toHaveBeenCalled();
    expect(readChromeHeight()).toBe(30);
    act(() => closeFloatingWindow());
    fake = createFakePipWindow();
    await open(SONG_A);
    expect(requestWindow).toHaveBeenLastCalledWith({ width: 610, height: 720 });
  });

  it('a remembered size opens as is (no height fix); title bar measured later is still remembered', async () => {
    stubMainScreen(1920, 1080);
    rememberSize({ width: 600, height: 500 }, SCREEN_1080);
    rememberChromeHeight(30);
    fake = createFakePipWindow({ width: 600, height: 500 });
    const resizeTo = dressFake({ chrome: 36, activation: true });
    vi.useFakeTimers();
    installPip();
    await open(SONG_A);
    expect(resizeTo).not.toHaveBeenCalled();
    fake.resizeTo(620, 520);
    act(() => {
      vi.advanceTimersByTime(SIZE_SAVE_DEBOUNCE_MS);
    });
    expect(readChromeHeight()).toBe(36);
  });

  it("renders with the floating window's own requestAnimationFrame", async () => {
    vi.useFakeTimers();
    useSettings.getState().set({ startDelaySec: 0 });
    installPip();
    await open(SONG_A);
    fake.raf.mockClear();
    act(() => fake.press('Space', ' '));
    // Cài đặt → Đếm ngược = Tắt → cửa sổ nổi vẫn đếm tối thiểu 3 giây (R7-5); frame đứng yên vẽ bằng rAF của
    // cửa sổ nổi, hết đếm thì vòng vẽ chạy tiếp trên rAF đó.
    expect(fake.raf).toHaveBeenCalled();
    act(() => fake.flushFrames());
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    act(() => fake.flushFrames(3));
    expect(fake.frames.size).toBe(1); // vẫn đang chạy → frame kế đã xin trên cửa sổ nổi
    expect(globalRaf).not.toHaveBeenCalled();
    expect(getAudioEngine().context).toBeNull(); // âm thanh tắt → không tạo AudioContext
  });

  it('remembers the size + its screen after resizing (debounced) and on close; back to standard = forget', async () => {
    vi.useFakeTimers();
    stubMainScreen(1920, 1080);
    dressFake({ chrome: PIP_CHROME_GUESS });
    installPip();
    await open(SONG_A);
    fake.resizeTo(650, 610);
    expect(localStorage.getItem(PIP_SIZE_STORAGE_KEY)).toBeNull();
    act(() => {
      vi.advanceTimersByTime(SIZE_SAVE_DEBOUNCE_MS);
    });
    expect(JSON.parse(localStorage.getItem(PIP_SIZE_STORAGE_KEY) ?? 'null')).toEqual({
      width: 650,
      height: 610,
      screen: SCREEN_1080,
      framePad: GAME_FRAME_PAD,
    });
    // Kéo về đúng cỡ chuẩn → quên (lần sau mở cỡ chuẩn, tính lại theo thanh tiêu đề).
    fake.resizeTo(610, 716);
    act(() => {
      vi.advanceTimersByTime(SIZE_SAVE_DEBOUNCE_MS);
    });
    expect(localStorage.getItem(PIP_SIZE_STORAGE_KEY)).toBeNull();
    fake.resizeTo(700, 640);
    act(() => fake.close()); // đóng trước khi hết debounce → vẫn lưu
    expect(JSON.parse(localStorage.getItem(PIP_SIZE_STORAGE_KEY) ?? 'null')).toEqual({
      width: 700,
      height: 640,
      screen: SCREEN_1080,
      framePad: GAME_FRAME_PAD,
    });
  });

  it('keeps one window: reopening switches the song and focuses it', async () => {
    installPip();
    await open(SONG_A);
    expect(await open(SONG_B)).toBe('opened');
    expect(requestWindow).toHaveBeenCalledTimes(1);
    expect(fake.focus).toHaveBeenCalled();
    expect(getFloatingWindowState().songId).toBe(SONG_B);
    expect(fake.doc.querySelectorAll('.pip-stage')).toHaveLength(1);
  });

  it('shares one request when clicked twice before the window opens', async () => {
    let resolve: (w: Window) => void = () => {};
    installPip(() => new Promise<Window>((r) => (resolve = r)));
    let first: Promise<OpenFloatingResult> = Promise.resolve('blocked');
    let second: Promise<OpenFloatingResult> = Promise.resolve('blocked');
    act(() => {
      first = openFloatingWindow(SONG_A ?? '');
      second = openFloatingWindow(SONG_A ?? '');
    });
    expect(requestWindow).toHaveBeenCalledTimes(1);
    await act(async () => {
      resolve(fake.win);
      await first;
    });
    expect(await second).toBe('opened');
  });

  it('reports blocked when requestWindow rejects or throws', async () => {
    installPip(() => Promise.reject(new DOMException('no activation', 'NotAllowedError')));
    expect(await open(SONG_A)).toBe('blocked');
    expect(getFloatingWindowState().open).toBe(false);
    installPip(() => {
      throw new Error('sync');
    });
    expect(await open(SONG_A)).toBe('blocked');
  });
});

describe('cleanup', () => {
  it('pagehide unmounts the stage and removes every listener / frame / observer', async () => {
    useSettings.getState().set({ startDelaySec: 0 });
    installPip();
    await open(SONG_A);
    act(() => fake.press('Space', ' ')); // đang chạy: có frame đang chờ
    expect(fake.frames.size).toBe(1);
    expect(fake.listenerCount('keydown')).toBeGreaterThan(0);
    act(() => {
      fake.win.dispatchEvent(new Event('pagehide'));
    });
    expect(getFloatingWindowState()).toEqual({ open: false, songId: null, supported: true });
    expect(fake.frames.size).toBe(0);
    expect(fake.listenerCount('keydown')).toBe(0);
    expect(fake.listenerCount('keyup')).toBe(0);
    expect(fake.listenerCount('resize')).toBe(0);
    expect(fake.listenerCount('pagehide')).toBe(0);
    expect(fake.liveIntervals.size).toBe(0);
    expect(fake.resizeObservers.every((o) => o.disconnected || o.targets.size === 0)).toBe(true);
    expect(fake.doc.querySelector(`.${PIP_ROOT_CLASS}`)).toBeNull();
    // Không còn đồng bộ CSS từ tab gốc.
    const before = fake.doc.head.querySelectorAll('style').length;
    addMainStyle('.after-close { color: red; }');
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(fake.doc.head.querySelectorAll('style')).toHaveLength(before);
  });

  it('closeFloatingWindow closes the window and resets the state', async () => {
    installPip();
    await open(SONG_A);
    act(() => closeFloatingWindow());
    expect(fake.close).toHaveBeenCalledTimes(1);
    expect(getFloatingWindowState().open).toBe(false);
    // Mở lại được sau khi đóng.
    fake = createFakePipWindow();
    expect(await open(SONG_B)).toBe('opened');
    expect(getFloatingWindowState().songId).toBe(SONG_B);
  });
});

describe('useFloatingWindowState', () => {
  function Probe() {
    const s = useFloatingWindowState();
    return <p data-testid="probe">{`${s.open}|${s.songId ?? '-'}|${s.supported}`}</p>;
  }

  it('re-renders on open / close', async () => {
    installPip();
    render(<Probe />);
    expect(screen.getByTestId('probe').textContent).toBe('false|-|true');
    await open(SONG_A);
    expect(screen.getByTestId('probe').textContent).toBe(`true|${SONG_A}|true`);
    act(() => closeFloatingWindow());
    expect(screen.getByTestId('probe').textContent).toBe('false|-|true');
  });
});

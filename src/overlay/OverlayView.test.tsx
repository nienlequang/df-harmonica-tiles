/**
 * OverlayView với parser + seed thật. Canvas: context giả ghi lời gọi + kích thước 576×600 (jsdom
 * không có canvas); rAF chạy tay; đồng hồ = performance.now / Date.now giả (cùng chạy); setTimeout giả
 * (đếm ngược, hạn tự chạy / mất Player); BroadcastChannel giả (Player chính ở "tab khác").
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { encodeShareData } from '../core/share';
import { getSong, useLibrary } from '../library/store';
import { CHROMA_GREEN } from '../ui/palette';
import { useSettings } from '../ui/settings';
import { dispatchDfhtCommand } from './commands';
import type { FollowDisplay } from './follow';
import { FOLLOW_CHANNEL, FOLLOW_EVENT, songKeyOf } from './follow';
import { OverlayEngine } from './overlayEngine';
import { OverlayView } from './OverlayView';

const SEED = 'seed-quoc-ca-viet-nam';
/** 120 BPM: 1 beat = 0.5 s; 4 nốt (2 s). */
const SHORT = '@title Bài ngắn\n@bpm 120\nZ X C V';
const TWO_LINES = '@title Hai dòng\n@bpm 120\nZ X C V\nB N M ,';

interface Call {
  name: string;
  fillStyle: unknown;
}

let calls: Call[] = [];
function fakeCtx(): CanvasRenderingContext2D {
  const state: Record<string, unknown> = { fillStyle: '#000', strokeStyle: '#000', globalAlpha: 1 };
  return new Proxy({} as Record<string, unknown>, {
    get(_t, prop) {
      if (typeof prop !== 'string') return undefined;
      if (prop in state) return state[prop];
      return (...args: unknown[]) => {
        calls.push({ name: prop, fillStyle: state.fillStyle });
        if (prop === 'measureText') return { width: String(args[0]).length * 7 };
        return undefined;
      };
    },
    set(_t, prop, value: unknown) {
      if (typeof prop === 'string') state[prop] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
}

/** BroadcastChannel giả: tin tới mọi kênh KHÁC cùng tên (như thật), đồng bộ. */
class FakeBC {
  static all: FakeBC[] = [];
  static log: unknown[] = [];
  closed = false;
  private readonly listeners = new Set<(e: MessageEvent) => void>();
  constructor(readonly name: string) {
    FakeBC.all.push(this);
  }
  postMessage(data: unknown): void {
    FakeBC.log.push(data);
    for (const c of FakeBC.all) {
      if (c === this || c.closed || c.name !== this.name) continue;
      for (const l of Array.from(c.listeners)) l({ data } as MessageEvent);
    }
  }
  addEventListener(_t: string, l: (e: MessageEvent) => void): void {
    this.listeners.add(l);
  }
  removeEventListener(_t: string, l: (e: MessageEvent) => void): void {
    this.listeners.delete(l);
  }
  close(): void {
    this.closed = true;
  }
}

let frames = new Map<number, FrameRequestCallback>();
let nextFrame = 1;
let nowMs = 1000;
/** Date.now = EPOCH + nowMs (đồng hồ chung chạy cùng performance.now). */
const EPOCH = 1_700_000_000_000;

function flushFrames(): void {
  const pending = [...frames.values()];
  frames = new Map();
  for (const cb of pending) cb(nowMs);
}

/** Tiến đồng hồ (giây) + timer giả rồi chạy một frame. */
function advance(sec: number): void {
  act(() => {
    nowMs += sec * 1000;
    vi.advanceTimersByTime(sec * 1000);
    flushFrames();
  });
}

/** Chỉ tiến đồng hồ + vẽ frame (không chạy timer). */
function frame(sec: number): void {
  act(() => {
    nowMs += sec * 1000;
    flushFrames();
  });
}

const AudioCtor = vi.fn();

function show(hashQuery: string, songId = SEED) {
  return render(<OverlayView songId={songId} query={new URLSearchParams(hashQuery)} />);
}

const activeKey = () =>
  document.querySelector('.gb-key[aria-current="true"]')?.getAttribute('data-key') ?? null;

function press(code: string): void {
  act(() => {
    fireEvent.keyDown(window, { code });
    fireEvent.keyUp(window, { code });
  });
}

const DISPLAY: FollowDisplay = {
  scheme: 'pc',
  mobileSemitone: 'toggle',
  labels: { left: '', right: '', natural: '', scroll: '' },
  lookahead: 8,
  tileScale: 1,
  subLabel: 'none',
  countIn: false,
  language: 'vi',
  theme: 'dark',
};

let seq = 0;
function stateMsg(source: string, patch: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    v: 1,
    from: 'tab-player',
    kind: 'state',
    seq: ++seq,
    songKey: songKeyOf(source),
    sentAt: EPOCH + nowMs,
    playing: false,
    beat: 0,
    bpm: 120,
    countdownEndsAt: null,
    loop: null,
    display: DISPLAY,
    ...patch,
  };
}
const songMsg = (source: string) => ({
  v: 1,
  from: 'tab-player',
  kind: 'song',
  songKey: songKeyOf(source),
  source,
});

/** "Tab Player" gửi qua BroadcastChannel. */
function fromPlayer(...messages: unknown[]): void {
  const ch = new FakeBC(FOLLOW_CHANNEL);
  act(() => {
    for (const m of messages) ch.postMessage(m);
  });
  ch.close();
}

const statusText = () => document.querySelector('.overlay-status')?.textContent ?? '';

beforeEach(() => {
  calls = [];
  frames = new Map();
  nextFrame = 1;
  nowMs = 1000;
  seq = 0;
  FakeBC.all = [];
  FakeBC.log = [];
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  vi.spyOn(performance, 'now').mockImplementation(() => nowMs);
  vi.spyOn(Date, 'now').mockImplementation(() => EPOCH + nowMs);
  vi.stubGlobal('BroadcastChannel', FakeBC);
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    const id = nextFrame++;
    frames.set(id, cb);
    return id;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => {
    frames.delete(id);
  });
  AudioCtor.mockClear();
  vi.stubGlobal('AudioContext', AudioCtor);
  vi.stubGlobal('webkitAudioContext', AudioCtor);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    () => fakeCtx() as unknown as RenderingContext,
  );
  Object.defineProperty(HTMLCanvasElement.prototype, 'clientWidth', {
    configurable: true,
    get: () => 576,
  });
  Object.defineProperty(HTMLCanvasElement.prototype, 'clientHeight', {
    configurable: true,
    get: () => 600,
  });
  useSettings.getState().reset();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete (HTMLCanvasElement.prototype as { clientWidth?: number }).clientWidth;
  delete (HTMLCanvasElement.prototype as { clientHeight?: number }).clientHeight;
  delete (window as { obsstudio?: unknown }).obsstudio;
  document.documentElement.className = '';
  for (const s of useLibrary.getState().songs) useLibrary.getState().removeSong(s.id);
});

describe('OverlayView: hiển thị', () => {
  it('mặc định: không chrome của app, html.overlay-mode nền trong suốt, canvas vẽ (clearRect)', () => {
    document.title = 'App';
    const { unmount } = show('');
    const root = document.documentElement;
    expect(root.classList.contains('overlay-mode')).toBe(true);
    expect(root.classList.contains('overlay-bg-transparent')).toBe(true);
    // Tiêu đề tab riêng của overlay.
    expect(document.title).toBe('Quốc ca Việt Nam — Overlay OBS');
    expect(document.querySelector('nav')).toBeNull();
    // Không có nút nào (R6 bỏ "⛶ Toàn màn hình"), không có nhãn / nền của cửa sổ Xem trước.
    expect(screen.queryByRole('button')).toBeNull();
    expect(root.classList.contains('overlay-preview')).toBe(false);
    expect(document.querySelector('.overlay-preview-badge')).toBeNull();
    expect(document.querySelector('.overlay-preview-backdrop')).toBeNull();
    expect(
      screen.getByRole('img', { name: 'Ô nhạc của "Quốc ca Việt Nam" (overlay OBS)' }),
    ).toBeTruthy();
    expect(calls.some((c) => c.name === 'clearRect')).toBe(true);
    expect(calls.some((c) => c.name === 'fillRect' && c.fillStyle === CHROMA_GREEN)).toBe(false);
    // Đầy đủ: game bar + banner, game bar căn theo lane (lề nhãn 16 px, gutter 56 px).
    expect(screen.getByRole('group', { name: 'Gợi ý phím như trong game' })).toBeTruthy();
    const stage = document.querySelector<HTMLElement>('.overlay');
    expect(stage?.style.getPropertyValue('--lane-left')).toBe('16px');
    expect(stage?.style.getPropertyValue('--lane-right')).toBe('56px');
    expect(stage?.classList.contains('overlay-fit-source')).toBe(true);
    unmount();
    expect(document.title).toBe('App');
  });

  it('bg=chroma: trang + canvas xanh #00FF00', () => {
    const { unmount } = show('bg=chroma');
    expect(document.documentElement.classList.contains('overlay-bg-chroma')).toBe(true);
    expect(calls.some((c) => c.name === 'fillRect' && c.fillStyle === CHROMA_GREEN)).toBe(true);
    unmount();
    expect(document.documentElement.classList.contains('overlay-bg-chroma')).toBe(false);
  });

  it('class nền đặt sớm (script inline của index.html) mà lệch tham số → bỏ, chỉ giữ nền đúng', () => {
    document.documentElement.classList.add('overlay-mode', 'overlay-bg-chroma');
    const { unmount } = show('bg=theme');
    const root = document.documentElement;
    expect(root.classList.contains('overlay-bg-theme')).toBe(true);
    expect(root.classList.contains('overlay-bg-chroma')).toBe(false);
    unmount();
    expect(root.classList.contains('overlay-bg-theme')).toBe(false);
  });

  it('layout=game: không game bar, banner nổi trên hit line, lane phủ kín từ mép trái', () => {
    show('layout=game');
    expect(screen.queryByRole('group', { name: 'Gợi ý phím như trong game' })).toBeNull();
    const float = document.querySelector<HTMLElement>('.overlay-banner-float');
    expect(float).not.toBeNull();
    expect(float?.style.bottom).toBe('calc(3% + 6px)');
    const stage = document.querySelector<HTMLElement>('.overlay');
    expect(stage?.classList.contains('overlay-layout-game')).toBe(true);
    expect(stage?.style.getPropertyValue('--lane-left')).toBe('0px');
    expect(stage?.style.getPropertyValue('--lane-right')).toBe('56px');
    // Không bao giờ có dải lời.
    expect(document.querySelector('.overlay-lyrics, .lyrics')).toBeNull();
  });

  it('lanes=horizontal: banner phía trên dải lane, không banner nổi', () => {
    show('lanes=horizontal&gamebar=0');
    const stage = document.querySelector('.overlay');
    expect(stage?.classList.contains('overlay-lanes-horizontal')).toBe(true);
    expect(stage?.firstElementChild?.classList.contains('overlay-banner')).toBe(true);
    expect(document.querySelector('.overlay-banner-float')).toBeNull();
    expect(screen.queryByRole('group', { name: 'Gợi ý phím như trong game' })).toBeNull();
  });

  it('không có dải lời, kể cả link cũ có lyrics=1; banner=0 ẩn banner', () => {
    const a = show('lyrics=1');
    expect(document.querySelector('.overlay-lyrics, .lyrics')).toBeNull();
    expect(document.querySelector('.overlay-banner')).not.toBeNull();
    a.unmount();
    show('banner=0');
    expect(document.querySelector('.overlay-banner')).toBeNull();
  });

  it('scheme=mobile (lane dọc, R7-4): KHÔNG bàn nút đầy đủ — hình học bàn nút + 4 vòng mờ do renderer vẽ', () => {
    const setOptions = vi.spyOn(OverlayEngine.prototype, 'setRendererOptions');
    show('scheme=mobile');
    expect(document.querySelector('.game-bar')).toBeNull();
    // Không nút số / nút chế độ DOM nào (trên stream nút thật của game nằm bên dưới).
    expect(document.querySelector('.mpad, .mpad-digit, .mpad-mode')).toBeNull();
    // Làn thẳng hàng nút như màn chơi; vòng đích mờ + vòng "CHẠM" vẽ trên canvas overlay.
    expect(setOptions).toHaveBeenLastCalledWith(
      expect.objectContaining({ scheme: 'mobile', lanePadding: 'pad', modeTargets: 'outline' }),
    );
    // Banner ở đầu khu làn.
    expect(document.querySelector('.overlay-banner-top')).not.toBeNull();
    expect(document.querySelector('.overlay')?.getAttribute('data-scheme')).toBe('mobile');
    setOptions.mockRestore();
  });

  it('scheme=mobile + lane ngang (dải ngang): không bàn nút DOM, không game bar kể cả gamebar=1 (D-390); kiểu PC vẫn có', () => {
    const a = show('scheme=mobile&lanes=horizontal');
    expect(document.querySelector('.mpad')).toBeNull();
    expect(document.querySelector('.game-bar')).toBeNull();
    a.unmount();
    const b = show('scheme=mobile&lanes=horizontal&gamebar=1');
    expect(document.querySelector('.game-bar, .gbm-digits, .gbm-modes')).toBeNull();
    // Tên chế độ vẫn có ở banner trên dải lane.
    expect(document.querySelector('.overlay')?.firstElementChild?.classList).toContain(
      'overlay-banner',
    );
    b.unmount();
    show('scheme=pc&lanes=horizontal&gamebar=1');
    expect(document.querySelector('.game-bar')).not.toBeNull();
  });

  it('tên nút lấy từ link (nl / nr / nn / ns), không từ Cài đặt của trình duyệt đang mở', () => {
    useSettings.getState().set({
      labelOverrides: { left: 'CAIDAT', right: 'CAIDAT', natural: 'CAIDAT', scroll: 'CAIDAT' },
    });
    // Kiểu Mobile không có game bar / bàn nút (R7-4, D-390): tên nút hiện ở banner ("CHẾ ĐỘ: … · Thăng: …").
    show('scheme=mobile&lanes=horizontal&nl=Tr%C3%A1i%20X&nn=Gi%E1%BB%AFa&ns=Th%C4%83ng');
    const text = document.querySelector('.overlay')?.textContent ?? '';
    expect(text).toContain('Giữa');
    expect(text).toContain('Thăng');
    expect(text).not.toContain('Ngẩng Tự Nhiên');
    expect(text).not.toContain('CAIDAT');
  });

  it('lang / theme của Player trong link: áp trong bộ nhớ, KHÔNG ghi vào Cài đặt đã lưu', () => {
    localStorage.removeItem('dfht-settings');
    const storage = useSettings.persist.getOptions().storage;
    const { unmount } = show('lang=en&theme=light');
    expect(useSettings.getState()).toMatchObject({ language: 'en', theme: 'light' });
    expect(screen.getByRole('region', { name: 'OBS overlay' })).toBeTruthy();
    expect(localStorage.getItem('dfht-settings')).toBeNull();
    unmount();
    expect(useSettings.persist.getOptions().storage).toBe(storage);
  });
});

describe('OverlayView: bố cục cả canvas (fit=canvas)', () => {
  function viewport(w: number, h: number): void {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: w });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: h });
  }

  afterEach(() => {
    viewport(1024, 768);
  });

  it('khớp game: khung đặt đúng chỗ bảng phím game, theo cỡ trang (Browser Source = canvas OBS)', () => {
    viewport(1920, 1080);
    show('layout=game&fit=canvas');
    const stage = document.querySelector<HTMLElement>('.overlay');
    expect(stage?.classList.contains('overlay-fit-canvas')).toBe(true);
    expect(stage?.style.left).toBe('683px');
    expect(stage?.style.top).toBe('150px');
    expect(stage?.style.width).toBe('610px');
    expect(stage?.style.height).toBe('600px');
    act(() => {
      viewport(2560, 1440);
      window.dispatchEvent(new Event('resize'));
    });
    expect(stage?.style.left).toBe('911px');
    expect(stage?.style.top).toBe('200px');
    expect(stage?.style.width).toBe('813px');
    expect(stage?.style.height).toBe('800px');
  });

  it('tinh chỉnh scale + cỡ ô của Player (tilescale): 8 làn quanh tâm bảng phím, gutter rộng ra', () => {
    viewport(1920, 1080);
    show('layout=game&fit=canvas&scale=1.1&tilescale=1.5');
    const stage = document.querySelector<HTMLElement>('.overlay');
    expect(stage?.style.left).toBe('655px');
    expect(stage?.style.width).toBe(`${609 + Math.round(56 * 1.65)}px`);
  });
});

describe('OverlayView: bài', () => {
  it('data=: bài người dùng nhúng trong link, mở được khi thư viện trống', () => {
    expect(useLibrary.getState().songs).toHaveLength(0);
    show(`data=${encodeShareData(SHORT)}`, '');
    expect(screen.getByRole('img', { name: 'Ô nhạc của "Bài ngắn" (overlay OBS)' })).toBeTruthy();
    expect(activeKey()).toBe('Z');
  });

  it('data= thắng song id', () => {
    show(`data=${encodeShareData(SHORT)}`, SEED);
    expect(screen.getByRole('img', { name: /Bài ngắn/ })).toBeTruthy();
  });

  it('thẻ lỗi (khi tự chạy, sau ~2 s không thấy Player): id lạ, data hỏng, thiếu bài, bài rỗng', () => {
    const cases: [string, string, string][] = [
      ['', 'khong-co', 'notFound'],
      ['data=@@@', '', 'badData'],
      ['', '', 'noSong'],
      [`data=${encodeShareData('@title Rỗng\n_ _')}`, '', 'empty'],
    ];
    for (const [query, id, error] of cases) {
      const r = show(query, id);
      // Đang chờ Player: chưa báo lỗi (Player có thể gửi bài tới).
      expect(screen.queryByRole('alert')).toBeNull();
      advance(2);
      const alert = screen.getByRole('alert');
      expect(alert.getAttribute('data-error')).toBe(error);
      expect(alert.textContent).toContain('Overlay không mở được bài');
      expect(document.querySelector('canvas')).toBeNull();
      r.unmount();
    }
    show('', 'khong-co');
    advance(2);
    expect(screen.getByRole('alert').textContent).toContain('"khong-co"');
    expect(AudioCtor).not.toHaveBeenCalled();
  });
});

describe('OverlayView: tự chạy (không nghe thấy Player)', () => {
  it('chờ ~2 s ("Đang chờ Player…") rồi tự chạy bài trong link', () => {
    show(`data=${encodeShareData(SHORT)}`, '');
    expect(statusText()).toBe('Đang chờ màn chơi…');
    advance(1.9);
    expect(activeKey()).toBe('Z'); // chưa chạy
    expect(statusText()).toBe('Đang chờ màn chơi…');
    advance(0.1); // hết 2 s → chạy
    expect(statusText()).toBe('');
    frame(0.6); // 1.2 beat
    expect(activeKey()).toBe('X');
  });

  it('link cũ autoplay=0 / loop=1 bị bỏ qua: vẫn tự chạy, hết bài không lặp', () => {
    show(`autoplay=0&loop=1&data=${encodeShareData(SHORT)}`, '');
    advance(2);
    frame(1.6); // 3.2 beat → V
    expect(activeKey()).toBe('V');
    frame(0.6);
    frame(0.6);
    expect(activeKey()).toBeNull();
  });

  it('delay (chờ trước khi chạy của Player): đếm ngược 2…1 rồi mới chạy', () => {
    show(`delay=2&data=${encodeShareData(SHORT)}`, '');
    advance(2);
    const countdown = () => document.querySelector('.overlay-countdown')?.textContent ?? null;
    expect(countdown()).toContain('2');
    expect(screen.getByText('Bắt đầu sau 2 giây')).toBeTruthy();
    frame(1.1);
    expect(activeKey()).toBe('Z'); // chưa chạy
    advance(1);
    expect(screen.getByText('Bắt đầu sau 1 giây')).toBeTruthy();
    advance(1);
    expect(countdown()).toBeNull();
    frame(1.1);
    expect(activeKey()).toBe('C');
  });

  it('countin=1: đếm vào bằng hình trước nốt đầu (0,65 ô nhịp — v1.0.1)', () => {
    show(`countin=1&data=${encodeShareData(SHORT)}`, '');
    advance(2);
    frame(1.1); // beat −0.4: còn trong 2,6 beat (1,3 s) đếm vào
    expect(activeKey()).toBe('Z');
    frame(0.5); // beat 0.6
    expect(activeKey()).toBe('Z');
    frame(0.5); // beat 1.6
    expect(activeKey()).toBe('X');
  });

  it('Space tạm dừng / chạy, R chạy lại từ đầu, → / ← nhảy dòng; bấm vào overlay chạy tiếp', () => {
    show(`data=${encodeShareData(TWO_LINES)}`, '');
    press('Space'); // chạy trước khi hết 2 s chờ
    frame(1.1);
    expect(activeKey()).toBe('C');
    press('Space');
    advance(2);
    expect(activeKey()).toBe('C'); // tự chạy không chạy lại khi đã chạy tay
    press('KeyR');
    frame(0.1);
    expect(activeKey()).toBe('Z');
    press('ArrowRight');
    frame(0.1);
    expect(activeKey()).toBe('B');
    press('ArrowLeft');
    frame(0.1);
    expect(activeKey()).toBe('Z');
    press('Space');
    act(() => {
      fireEvent.click(screen.getByRole('region', { name: 'Overlay OBS' }));
    });
    frame(0.6);
    expect(activeKey()).toBe('X');
    // Bấm nữa không tạm dừng (bấm để focus cửa sổ).
    act(() => {
      fireEvent.click(screen.getByRole('region', { name: 'Overlay OBS' }));
    });
    frame(0.5);
    expect(activeKey()).toBe('C');
  });

  it("'dfht:command': toggle / restart / nextLine / prevLine", () => {
    show(`data=${encodeShareData(TWO_LINES)}`, '');
    act(() => dispatchDfhtCommand('toggle'));
    frame(1.1);
    expect(activeKey()).toBe('C');
    act(() => dispatchDfhtCommand('nextLine'));
    frame(0.1);
    expect(activeKey()).toBe('B');
    act(() => dispatchDfhtCommand('prevLine'));
    frame(0.1);
    expect(activeKey()).toBe('Z');
    act(() => dispatchDfhtCommand('toggle'));
    frame(2);
    expect(activeKey()).toBe('Z');
    act(() => dispatchDfhtCommand('restart'));
    frame(0.6);
    expect(activeKey()).toBe('X');
  });

  it('không bao giờ tạo AudioContext (kể cả khi Cài đặt bật giai điệu mẫu)', () => {
    useSettings.setState({ audioEnabled: true, clickSound: true, metronome: true });
    show(`countin=1&delay=1&data=${encodeShareData(SHORT)}`, '');
    advance(3);
    frame(3);
    press('Space');
    press('Space');
    press('KeyR');
    frame(1);
    expect(AudioCtor).not.toHaveBeenCalled();
  });
});

describe('OverlayView: theo Player chính', () => {
  it('mở ra gửi hello; Player trả lời → theo Player (vị trí, tempo), không bao giờ tự chạy', () => {
    show(`data=${encodeShareData(TWO_LINES)}`, '');
    expect(FakeBC.log).toContainEqual(expect.objectContaining({ kind: 'hello', v: 1 }));
    fromPlayer(
      songMsg(TWO_LINES),
      stateMsg(TWO_LINES, { playing: true, beat: 2, sentAt: EPOCH + nowMs - 500 }),
    );
    expect(statusText()).toBe('');
    expect(document.querySelector('.overlay')?.getAttribute('data-mode')).toBe('follow');
    frame(0); // 2 + 0.5 s × 2 = beat 3
    expect(activeKey()).toBe('V');
    frame(0.5);
    expect(activeKey()).toBe('B');
    // Heartbeat đều đặn: không bao giờ chuyển sang tự chạy.
    for (let i = 0; i < 3; i++) {
      advance(1);
      fromPlayer(stateMsg(TWO_LINES, { playing: false, beat: 4, cause: 'tick' }));
    }
    expect(activeKey()).toBe('B');
    expect(document.querySelector('.overlay')?.getAttribute('data-mode')).toBe('follow');
  });

  it('đang theo: Space / bấm / dfht:command không điều khiển overlay (chỉnh ở Player)', () => {
    show(`data=${encodeShareData(TWO_LINES)}`, '');
    fromPlayer(stateMsg(TWO_LINES, { playing: false, beat: 0 }));
    press('Space');
    act(() => dispatchDfhtCommand('nextLine'));
    act(() => {
      fireEvent.click(screen.getByRole('region', { name: 'Overlay OBS' }));
    });
    frame(1);
    expect(activeKey()).toBe('Z');
  });

  it('bài của Player khác bài trong link: chưa có tin `song` thì để trống, có rồi thì hiện bài đó', () => {
    show(`data=${encodeShareData(SHORT)}`, '');
    expect(screen.getByRole('img', { name: /Bài ngắn/ })).toBeTruthy();
    fromPlayer(stateMsg(TWO_LINES, { playing: true, beat: 4 }));
    expect(document.querySelector('canvas')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    fromPlayer(songMsg(TWO_LINES));
    expect(screen.getByRole('img', { name: /Hai dòng/ })).toBeTruthy();
    frame(0);
    expect(activeKey()).toBe('B');
  });

  it('link hỏng nhưng Player gửi bài → vẫn hiện (không thẻ lỗi)', () => {
    show('data=@@@', '');
    fromPlayer(songMsg(SHORT), stateMsg(SHORT));
    advance(3);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('img', { name: /Bài ngắn/ })).toBeTruthy();
  });

  it('hiển thị theo Player: kiểu điều khiển, tên nút, ngôn ngữ', () => {
    show(`data=${encodeShareData(SHORT)}`, '');
    fromPlayer(
      stateMsg(SHORT, {
        display: {
          ...DISPLAY,
          scheme: 'mobile',
          language: 'en',
          labels: { ...DISPLAY.labels, scroll: 'Sharp!' },
        },
      }),
    );
    // Player ở kiểu Mobile → overlay kiểu Mobile (không game bar, không bàn nút DOM — R7-4); tên nút theo
    // Player trong banner chế độ.
    expect(document.querySelector('.game-bar')).toBeNull();
    expect(document.querySelector('.mpad')).toBeNull();
    expect(document.querySelector('.overlay')?.getAttribute('data-scheme')).toBe('mobile');
    expect(screen.getByRole('region', { name: 'OBS overlay' })).toBeTruthy();
    expect(document.querySelector('.overlay-banner')?.textContent).toContain('Sharp!');
  });

  it('OBS Browser Source: tin tới bằng window CustomEvent (obs-browser emit_event)', () => {
    show(`data=${encodeShareData(SHORT)}`, '');
    act(() => {
      window.dispatchEvent(
        new CustomEvent(FOLLOW_EVENT, { detail: stateMsg(SHORT, { playing: true, beat: 1 }) }),
      );
    });
    frame(0);
    expect(activeKey()).toBe('X');
    advance(2);
    expect(document.querySelector('.overlay')?.getAttribute('data-mode')).toBe('follow');
  });

  it('đếm ngược của Player hiện trên overlay', () => {
    show(`data=${encodeShareData(SHORT)}`, '');
    fromPlayer(stateMsg(SHORT, { countdownEndsAt: EPOCH + nowMs + 3000 }));
    expect(screen.getByText('Bắt đầu sau 3 giây')).toBeTruthy();
    advance(1);
    expect(screen.getByText('Bắt đầu sau 2 giây')).toBeTruthy();
  });

  it('Player đóng (bye) → dừng tại chỗ, "Đang chờ Player…"; Player mở lại → theo tiếp', () => {
    show(`data=${encodeShareData(TWO_LINES)}`, '');
    fromPlayer(stateMsg(TWO_LINES, { playing: true, beat: 0 }));
    frame(1.1); // beat 2.2
    expect(activeKey()).toBe('C');
    fromPlayer({ v: 1, from: 'tab-player', kind: 'bye' });
    expect(statusText()).toBe('Đang chờ màn chơi…');
    frame(2);
    expect(activeKey()).toBe('C');
    fromPlayer(stateMsg(TWO_LINES, { playing: false, beat: 4 }));
    expect(statusText()).toBe('');
    frame(0);
    expect(activeKey()).toBe('B');
  });

  it('Player im lặng ~4 s (không bye) → coi như mất, dừng', () => {
    show(`data=${encodeShareData(TWO_LINES)}`, '');
    fromPlayer(stateMsg(TWO_LINES, { playing: true, beat: 0 }));
    advance(3.9);
    expect(statusText()).toBe('');
    advance(0.2);
    expect(statusText()).toBe('Đang chờ màn chơi…');
  });

  it('đang tự chạy mà Player xuất hiện → chuyển sang theo Player', () => {
    show(`data=${encodeShareData(TWO_LINES)}`, '');
    advance(2); // tự chạy
    frame(0.6); // beat 1.2 → X
    expect(activeKey()).toBe('X');
    fromPlayer(stateMsg(TWO_LINES, { playing: false, beat: 4 }));
    frame(0.5);
    expect(activeKey()).toBe('B');
  });
});

describe('OverlayView: khung cửa sổ', () => {
  it('trình duyệt thường: không có nút "Toàn màn hình" (R6 bỏ Window Capture) kể cả khi trình duyệt có requestFullscreen; dòng "Đang chờ màn chơi…" khi chờ', () => {
    const request = vi.fn(() => Promise.resolve());
    Object.defineProperty(document.documentElement, 'requestFullscreen', {
      configurable: true,
      value: request,
    });
    try {
      show('');
      expect(screen.queryByRole('button')).toBeNull();
      expect(statusText()).toBe('Đang chờ màn chơi…');
      fireEvent.click(document.querySelector('.overlay') as HTMLElement);
      expect(request).not.toHaveBeenCalled();
    } finally {
      delete (document.documentElement as { requestFullscreen?: unknown }).requestFullscreen;
    }
  });

  it('preview=1 (cửa sổ "Xem trước"): nền tối (html.overlay-preview), nhãn + tiêu đề "Xem trước", bảng phím game minh họa; vẫn theo Player', () => {
    document.title = 'App';
    const { unmount } = show('layout=game&fit=canvas&preview=1');
    const root = document.documentElement;
    expect(root.classList.contains('overlay-preview')).toBe(true);
    expect(root.classList.contains('overlay-bg-transparent')).toBe(true);
    expect(document.title).toBe('Xem trước overlay (không dùng để quay) — Quốc ca Việt Nam');
    expect(screen.getByText('Xem trước · không dùng để quay')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
    // Ô vẫn vẽ trên nền trong suốt của canvas (như trong OBS) — nền tối là của trang.
    expect(calls.some((c) => c.name === 'clearRect')).toBe(true);
    expect(calls.some((c) => c.name === 'fillRect' && c.fillStyle === CHROMA_GREEN)).toBe(false);
    // Bảng phím minh họa: trang trí (ẩn với trình đọc màn hình), 8 keycap Z … , theo thứ tự cột.
    const backdrop = document.querySelector('.overlay-preview-backdrop');
    expect(backdrop?.getAttribute('aria-hidden')).toBe('true');
    const keys = Array.from(document.querySelectorAll<HTMLElement>('.overlay-preview-key'));
    expect(keys.map((k) => k.textContent)).toEqual(['Z', 'X', 'C', 'V', 'B', 'N', 'M', ',']);
    expect(document.querySelector('.overlay-preview-frame')).toBeTruthy();
    // Theo Player như mọi overlay.
    fromPlayer(stateMsg(getSong(SEED)?.source ?? '', { playing: false, beat: 0 }));
    expect(document.querySelector('.overlay')?.getAttribute('data-mode')).toBe('follow');
    expect(statusText()).toBe('');
    unmount();
    expect(root.classList.contains('overlay-preview')).toBe(false);
    expect(document.title).toBe('App');
  });

  it('trong OBS (window.obsstudio): không nút, không dòng trạng thái, không nhãn Xem trước', () => {
    (window as { obsstudio?: unknown }).obsstudio = { pluginVersion: '2.24' };
    show('preview=1');
    expect(screen.queryByRole('button')).toBeNull();
    expect(document.querySelector('.overlay-status')).toBeNull();
    expect(document.querySelector('.overlay-preview-badge')).toBeNull();
  });

  it('bài mẫu theo id vẫn mở (seed có trong mọi trình duyệt)', () => {
    expect(getSong(SEED)).not.toBeNull();
    show('', SEED);
    expect(screen.getByRole('img', { name: /Quốc ca Việt Nam/ })).toBeTruthy();
  });
});

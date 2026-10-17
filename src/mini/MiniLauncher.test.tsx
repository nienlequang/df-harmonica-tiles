/**
 * Nút "Cửa sổ nổi" của màn chơi trên điện thoại (R7-6 / R7-7) — MiniLauncher có `songId`:
 * - hỏi "Apple / Android" lần đầu (nút chọn sẵn theo UA = nút chính, nhận focus), nhớ theo máy, "Đổi loại
 *   điện thoại" hỏi lại;
 * - Android → hộp thoại trang mini như cũ;
 * - Apple → video nổi: dựng sẵn NGAY khi hộp thoại hiện (tiến độ %), không có "Trực tiếp" (không chuẩn bị
 *   luồng canvas); dựng xong → "Mở video nổi" xin PiP ĐỒNG BỘ trong cú chạm (user activation giả kiểu
 *   Safari: bật trong click, tắt ở microtask kế); đóng hộp thoại không đóng khung PiP; đóng lúc đang dựng =
 *   hủy dựng.
 * Không có `songId` → hộp thoại chọn bài cũ, không hỏi.
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StringKey } from '../i18n/strings';
import { translateCount } from '../i18n/useT';
import { PHONE_KIND_STORAGE_KEY, resetPhoneKindForTest } from '../pip/phonePref';
import type * as VideoPip from '../pip/videoPip';
import type {
  GuideVideoOptions,
  PrerenderOptions,
  PrerenderResult,
  VideoPipSupport,
} from '../pip/videoPip';
import { useSettings } from '../ui/settings';
import { MiniLauncher } from './MiniLauncher';

const SEED = 'seed-quoc-ca-viet-nam';

const build = vi.hoisted(() => ({
  calls: [] as { opts: GuideVideoOptions; po: PrerenderOptions }[],
  resolve: null as ((r: PrerenderResult) => void) | null,
  reject: null as ((e: unknown) => void) | null,
  support: { pip: true, live: true, prerender: true } as VideoPipSupport,
}));

vi.mock('../pip/videoPip', async (importOriginal) => {
  const actual = await importOriginal<typeof VideoPip>();
  return {
    ...actual,
    detectVideoPipSupport: () => build.support,
    prerenderGuideVideo: (opts: GuideVideoOptions, po: PrerenderOptions = {}) =>
      new Promise<PrerenderResult>((resolve, reject) => {
        build.calls.push({ opts, po });
        build.resolve = resolve;
        build.reject = reject;
      }),
  };
});

const en = (key: StringKey, params?: Record<string, string | number>) =>
  translateCount('en', key, params);

const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

const BUILT: PrerenderResult = {
  blob: new Blob([new Uint8Array(4096)], { type: 'video/webm' }),
  codec: 'V_VP8',
  frames: 24,
  durationSec: 12,
  width: 480,
  height: 360,
};

function Harness({ open = true, onClose = () => undefined }) {
  return <MiniLauncher open={open} onClose={onClose} songId={SEED} />;
}

const restore: (() => void)[] = [];

function stub<T extends object>(obj: T, key: string, value: unknown): void {
  const had = Object.prototype.hasOwnProperty.call(obj, key);
  const prev = (obj as Record<string, unknown>)[key];
  Object.defineProperty(obj, key, { configurable: true, writable: true, value });
  restore.push(() => {
    if (had) Object.defineProperty(obj, key, { configurable: true, writable: true, value: prev });
    else delete (obj as Record<string, unknown>)[key];
  });
}

beforeEach(() => {
  useSettings.getState().reset();
  useSettings.getState().set({ language: 'en' });
  build.calls = [];
  build.resolve = null;
  build.reject = null;
  build.support = { pip: true, live: true, prerender: true };
  resetPhoneKindForTest();
});

afterEach(() => {
  for (const r of restore.splice(0).reverse()) r();
  vi.restoreAllMocks();
});

const chooser = () => screen.getByRole('dialog', { name: en('mini.phone.title') });
const option = (name: StringKey) => within(chooser()).getByRole('button', { name: en(name) });

describe('MiniLauncher — hỏi loại điện thoại (R7-6)', () => {
  it('lần đầu: hỏi Apple / Android; máy không phải Apple → chọn sẵn Android (nút chính, có focus)', () => {
    render(<Harness />);
    const dialog = chooser();
    expect(within(dialog).getByText(en('mini.phone.question'))).toBeTruthy();
    const group = within(dialog).getByRole('group', { name: en('mini.phone.question') });
    const apple = within(group).getByRole('button', { name: en('mini.phone.apple') });
    const android = within(group).getByRole('button', { name: en('mini.phone.android') });
    // Tên truy cập = tên lựa chọn; dòng giải thích là mô tả.
    expect(android.getAttribute('aria-describedby')).toBeTruthy();
    expect(
      document.getElementById(android.getAttribute('aria-describedby') ?? '')?.textContent,
    ).toBe(en('mini.phone.androidHint'));
    expect(android.className).toContain('btn-primary');
    expect(apple.className).toContain('btn-secondary');
    expect(document.activeElement).toBe(android);
    // Chưa vào trang mini / video khi chưa chọn.
    expect(screen.queryByRole('link', { name: en('mini.open') })).toBeNull();
  });

  it('iPhone (UA) → chọn sẵn Apple, nhưng vẫn hỏi (không quyết theo UA)', () => {
    stub(navigator, 'userAgent', IPHONE);
    render(<Harness />);
    expect(option('mini.phone.apple').className).toContain('btn-primary');
    expect(document.activeElement).toBe(option('mini.phone.apple'));
    expect(localStorage.getItem(PHONE_KIND_STORAGE_KEY)).toBeNull();
  });

  it('Android → hộp thoại trang mini như cũ; lần sau đi thẳng; "Đổi loại điện thoại" hỏi lại', () => {
    const onClose = vi.fn();
    const { rerender } = render(<Harness onClose={onClose} />);
    fireEvent.click(option('mini.phone.android'));
    expect(localStorage.getItem(PHONE_KIND_STORAGE_KEY)).toBe('android');
    const dialog = screen.getByRole('dialog', { name: en('mini.launcherTitle') });
    expect(within(dialog).queryByRole('combobox')).toBeNull();
    expect(dialog.textContent).toContain('Song: Quốc ca Việt Nam');
    expect(within(dialog).getByText(en('mini.phone.current', { kind: 'Android' }))).toBeTruthy();
    const link = within(dialog).getByRole('link', { name: en('mini.open') });
    expect(link.getAttribute('href')).toBe(`#/mini/${SEED}`);
    fireEvent.click(link);
    expect(onClose).toHaveBeenCalledTimes(1);

    // Đóng rồi mở lại → thẳng hộp thoại trang mini (đã nhớ).
    rerender(<Harness open={false} onClose={onClose} />);
    expect(screen.queryByRole('dialog')).toBeNull();
    rerender(<Harness onClose={onClose} />);
    const again = screen.getByRole('dialog', { name: en('mini.launcherTitle') });
    fireEvent.click(within(again).getByRole('button', { name: en('mini.phone.change') }));
    // Hỏi lại, chọn sẵn lựa chọn hiện tại.
    expect(option('mini.phone.android').className).toContain('btn-primary');
    expect(screen.queryByRole('dialog', { name: en('mini.launcherTitle') })).toBeNull();

    // Đóng giữa chừng → lần mở sau lại theo lựa chọn đã lưu (không kẹt ở bước hỏi).
    rerender(<Harness open={false} onClose={onClose} />);
    rerender(<Harness onClose={onClose} />);
    expect(screen.getByRole('dialog', { name: en('mini.launcherTitle') })).toBeTruthy();
  });

  it('không có songId → hộp thoại chọn bài cũ, không hỏi loại điện thoại', () => {
    render(<MiniLauncher open onClose={() => undefined} />);
    const dialog = screen.getByRole('dialog', { name: en('mini.launcherTitle') });
    expect(within(dialog).getByLabelText(en('pip.song'))).toBeTruthy();
    expect(screen.queryByRole('dialog', { name: en('mini.phone.title') })).toBeNull();
  });
});

describe('MiniLauncher — Apple: video nổi dựng sẵn (R7-6 / R7-7)', () => {
  let pipEl: Element | null = null;
  /** "User activation" giả kiểu Safari: bật khi click bắt đầu, tắt ở microtask kế (await là mất). */
  let activation = false;
  const onClickCapture = (): void => {
    activation = true;
    queueMicrotask(() => {
      activation = false;
    });
  };
  const captureStream = vi.fn(() => ({ getTracks: () => [{ stop: () => undefined }] }));

  beforeEach(() => {
    pipEl = null;
    activation = false;
    captureStream.mockClear();
    document.addEventListener('click', onClickCapture, true);
    restore.push(() => document.removeEventListener('click', onClickCapture, true));
    const onEnter = (e: Event): void => {
      pipEl = e.target as Element;
    };
    document.addEventListener('enterpictureinpicture', onEnter, true);
    restore.push(() => document.removeEventListener('enterpictureinpicture', onEnter, true));
    stub(
      HTMLMediaElement.prototype,
      'play',
      vi.fn(() => Promise.resolve()),
    );
    stub(HTMLMediaElement.prototype, 'pause', vi.fn());
    stub(HTMLCanvasElement.prototype, 'captureStream', captureStream);
    stub(
      HTMLVideoElement.prototype,
      'requestPictureInPicture',
      vi.fn(function (this: HTMLVideoElement) {
        if (!activation) {
          return Promise.reject(
            new DOMException(
              'The request is not triggered by a user activation.',
              'NotAllowedError',
            ),
          );
        }
        this.dispatchEvent(new Event('enterpictureinpicture'));
        return Promise.resolve({} as PictureInPictureWindow);
      }),
    );
    Object.defineProperty(document, 'pictureInPictureElement', {
      configurable: true,
      get: () => pipEl,
    });
    restore.push(() => {
      delete (document as unknown as Record<string, unknown>).pictureInPictureElement;
    });
    stub(
      document,
      'exitPictureInPicture',
      vi.fn(() => {
        pipEl = null;
        return Promise.resolve();
      }),
    );
    stub(
      URL,
      'createObjectURL',
      vi.fn(() => 'blob:built'),
    );
    stub(URL, 'revokeObjectURL', vi.fn());
  });

  afterEach(() => {
    // Gỡ cây (dọn video / phiên) TRƯỚC khi trả API giả (afterEach ngoài chạy sau).
    cleanup();
  });

  async function settle(): Promise<void> {
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  const hostVideos = () =>
    Array.from(document.querySelectorAll<HTMLVideoElement>('.mini-video-host video'));

  /** Hộp thoại video nổi đã tải xong (phần video tải lười; lúc tải là hộp thoại "Loading…" cùng tên). */
  async function videoDialog(): Promise<HTMLElement> {
    await waitFor(() => expect(document.querySelector('.mini-apple')).not.toBeNull());
    // Phần tải lười vừa commit ngoài act (waitFor thăm dò): xả effect của nó (dựng video ngay khi mở) trước khi kiểm —
    // không thì dưới tải nặng (cả bộ test) `build.calls` đôi khi còn rỗng.
    await act(async () => {
      await Promise.resolve();
    });
    return screen.getByRole('dialog', { name: en('mini.video.title') });
  }

  async function openApple(): Promise<HTMLElement> {
    fireEvent.click(option('mini.phone.apple'));
    return videoDialog();
  }

  it('chọn Apple → dựng ngay (tiến độ, nhắc giữ trang mở), không có "Trực tiếp"; dựng xong → "Mở video nổi" vào PiP trong cú chạm; đóng hộp thoại không đóng PiP', async () => {
    const { rerender } = render(<Harness />);
    const dialog = await openApple();
    expect(localStorage.getItem(PHONE_KIND_STORAGE_KEY)).toBe('apple');
    // Dựng ngay, không cần bấm "Dựng video".
    expect(build.calls).toHaveLength(1);
    expect(build.calls[0].opts.countdownSec).toBe(3);
    expect(within(dialog).queryByRole('button', { name: en('mini.video.build') })).toBeNull();
    expect(
      within(dialog).getByRole('progressbar', { name: en('mini.video.progress') }),
    ).toBeTruthy();
    expect(within(dialog).getByText(en('mini.apple.keepOpen'))).toBeTruthy();
    // Không có "Trực tiếp", không chuẩn bị luồng canvas.
    expect(within(dialog).queryByRole('button', { name: en('mini.video.liveOpen') })).toBeNull();
    expect(captureStream).not.toHaveBeenCalled();
    expect(hostVideos()).toHaveLength(0);
    const open = within(dialog).getByRole('button', { name: en('mini.apple.open') });
    expect(open).toHaveProperty('disabled', true);
    expect(
      within(dialog).getByText(en('mini.phone.current', { kind: en('mini.phone.kind.apple') })),
    ).toBeTruthy();

    // Tiến độ — nút khóa được mô tả bằng dòng tiến độ + lời nhắc (trình đọc màn hình biết vì sao chưa bấm được).
    act(() => build.calls[0].po.onProgress?.(0.42));
    expect(within(dialog).getByText(en('mini.apple.building', { pct: 42 }))).toBeTruthy();
    const described = (open.getAttribute('aria-describedby') ?? '')
      .split(/\s+/)
      .map((id) => document.getElementById(id)?.textContent);
    expect(described).toEqual([en('mini.apple.building', { pct: 42 }), en('mini.apple.keepOpen')]);

    // Dựng xong → video blob nạp sẵn (trước cú chạm), nút mở bật + nhận focus.
    await act(async () => {
      build.resolve?.(BUILT);
      await Promise.resolve();
    });
    expect(open).toHaveProperty('disabled', false);
    expect(document.activeElement).toBe(open);
    const [prepared] = hostVideos();
    expect(prepared.getAttribute('src')).toBe('blob:built');
    expect(HTMLVideoElement.prototype.requestPictureInPicture).not.toHaveBeenCalled();

    fireEvent.click(open);
    // Xin PiP đồng bộ trong click (còn activation), trên đúng video đã chuẩn bị.
    expect(HTMLVideoElement.prototype.requestPictureInPicture).toHaveBeenCalledTimes(1);
    expect(vi.mocked(HTMLVideoElement.prototype.requestPictureInPicture).mock.contexts[0]).toBe(
      prepared,
    );
    await settle();
    expect(pipEl).toBe(prepared);
    expect(within(dialog).getByText(en('mini.apple.statusOpen'))).toBeTruthy();
    expect(within(dialog).queryByRole('alert')).toBeNull();

    // Đóng hộp thoại: khung PiP vẫn mở (phiên sống cùng màn chơi), video không bị gỡ.
    rerender(<Harness open={false} />);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(pipEl).toBe(prepared);
    expect(prepared.isConnected).toBe(true);
    // Mở lại: thẳng video nổi (đã nhớ Apple), không dựng lại, vẫn báo đang mở.
    rerender(<Harness />);
    const again = await videoDialog();
    expect(build.calls).toHaveLength(1);
    expect(within(again).getByText(en('mini.apple.statusOpen'))).toBeTruthy();
    // Đóng video từ hộp thoại.
    fireEvent.click(within(again).getByRole('button', { name: en('mini.video.close') }));
    expect(document.exitPictureInPicture).toHaveBeenCalled();
  });

  it('đóng hộp thoại lúc đang dựng = hủy dựng; mở lại → dựng lại từ đầu', async () => {
    const { rerender } = render(<Harness />);
    await openApple();
    expect(build.calls).toHaveLength(1);
    const first = build.calls[0].po.signal;
    rerender(<Harness open={false} />);
    expect(first?.aborted).toBe(true);
    rerender(<Harness />);
    await videoDialog();
    expect(build.calls).toHaveLength(2);
    expect(build.calls[1].po.signal?.aborted).toBe(false);
  });

  it('dựng lỗi → câu dễ hiểu (lỗi gốc chỉ ở data-reason) + "Dựng video" để thử lại', async () => {
    render(<Harness />);
    const dialog = await openApple();
    await act(async () => {
      build.reject?.(new Error('EncodingError: raw encoder message'));
      await Promise.resolve();
    });
    const alert = within(dialog).getByRole('alert');
    expect(alert.textContent).toBe(en('mini.apple.buildFailed'));
    expect(alert.getAttribute('data-reason')).toContain('raw encoder message');
    expect(dialog.textContent).not.toContain('raw encoder message');
    expect(within(dialog).getByRole('button', { name: en('mini.apple.open') })).toHaveProperty(
      'disabled',
      true,
    );
    // Không tự dựng lại liên tục; chạm "Dựng video" mới dựng lại.
    expect(build.calls).toHaveLength(1);
    fireEvent.click(within(dialog).getByRole('button', { name: en('mini.video.build') }));
    expect(build.calls).toHaveLength(2);
    expect(within(dialog).queryByRole('alert')).toBeNull();
  });

  it('trình duyệt không dựng được (không WebCodecs / không phát WebM) → câu cập nhật iOS, không nút mở', async () => {
    build.support = { pip: true, live: true, prerender: false };
    render(<Harness />);
    const dialog = await openApple();
    expect(build.calls).toHaveLength(0);
    expect(within(dialog).getByRole('note').textContent).toBe(en('mini.apple.unsupported'));
    expect(within(dialog).queryByRole('button', { name: en('mini.apple.open') })).toBeNull();
    expect(within(dialog).queryByRole('button', { name: en('mini.video.liveOpen') })).toBeNull();
  });

  it('"Đổi loại điện thoại" trong hộp thoại video → hỏi lại → Android → trang mini', async () => {
    render(<Harness />);
    const dialog = await openApple();
    fireEvent.click(within(dialog).getByRole('button', { name: en('mini.phone.change') }));
    expect(option('mini.phone.apple').className).toContain('btn-primary');
    fireEvent.click(option('mini.phone.android'));
    expect(localStorage.getItem(PHONE_KIND_STORAGE_KEY)).toBe('android');
    expect(screen.getByRole('dialog', { name: en('mini.launcherTitle') })).toBeTruthy();
  });
});

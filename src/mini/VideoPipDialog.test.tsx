/**
 * Hộp thoại "Cửa sổ video nổi" (videoPip thật, API trình duyệt giả):
 * - dựng sẵn: tiến độ dựng chỉ cập nhật state khi số % đổi (onProgress báo ~20 lần / giây — không vẽ lại cả
 *   trang mini liên tục), chữ % không là live region (screen reader đọc <progress>), câu nhắc giữ trang mở;
 * - R6 (lỗi iPhone "The request is not triggered by user activation"): hộp thoại hiện là chuẩn bị video
 *   ngay; chạm nút mở gọi requestPictureInPicture ĐỒNG BỘ trong cú chạm — kiểm bằng "user activation" giả
 *   kiểu Safari (bật trong click, tắt ở microtask kế); lỗi hiện câu dễ hiểu, không chữ lỗi thô.
 * - R7-7: máy Apple (lựa chọn đã lưu; chưa chọn → UA) không có "Trực tiếp", tự dựng sẵn khi hộp thoại hiện;
 *   máy khác "Trực tiếp" là nút chính.
 */
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseHarm } from '../core/parser';
import { buildTimeline } from '../core/timeline';
import type { StringKey } from '../i18n/strings';
import { translateCount } from '../i18n/useT';
import type * as VideoPip from '../pip/videoPip';
import type {
  GuideVideoOptions,
  PrerenderOptions,
  PrerenderResult,
  VideoPipSupport,
} from '../pip/videoPip';
import { resetPhoneKindForTest, setPhoneKind } from '../pip/phonePref';
import { useSettings } from '../ui/settings';
import { PREPARE_STALL_MS, VideoPipDialog, useVideoPip, videoPipErrorText } from './VideoPipDialog';

const build = vi.hoisted(() => ({
  calls: 0,
  po: null as PrerenderOptions | null,
  resolve: null as ((r: PrerenderResult) => void) | null,
  support: { pip: true, live: false, prerender: true } as VideoPipSupport,
}));

vi.mock('../pip/videoPip', async (importOriginal) => {
  const actual = await importOriginal<typeof VideoPip>();
  return {
    ...actual,
    detectVideoPipSupport: () => build.support,
    prerenderGuideVideo: (_opts: GuideVideoOptions, po: PrerenderOptions = {}) =>
      new Promise<PrerenderResult>((resolve) => {
        build.calls++;
        build.po = po;
        build.resolve = resolve;
      }),
  };
});

const en = (key: StringKey, params?: Record<string, string | number>) =>
  translateCount('en', key, params);

const OPTIONS: GuideVideoOptions = {
  timeline: buildTimeline(parseHarm('@bpm 120\nZ X C V').song),
  bpm: 120,
  scheme: 'mobile',
  mobileSemitone: 'toggle',
  labels: { left: 'Left', right: 'Right', natural: 'Natural', scroll: 'Scroll' },
  theme: 'dark',
  language: 'en',
  subLabel: 'solfege',
  lookahead: 8,
  countdownSec: 3,
};

const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

const BUILT: PrerenderResult = {
  blob: new Blob([new Uint8Array(2048)], { type: 'video/webm' }),
  codec: 'V_VP8',
  frames: 24,
  durationSec: 1,
  width: 480,
  height: 360,
};

let renders = 0;

function Host({ open = true }: { open?: boolean }) {
  renders++;
  const hostRef = useRef<HTMLDivElement>(null);
  const pip = useVideoPip(OPTIONS, hostRef);
  return (
    <>
      <div ref={hostRef} data-testid="video-host" />
      <VideoPipDialog open={open} onClose={() => undefined} pip={pip} countdownSec={3} />
    </>
  );
}

beforeEach(() => {
  useSettings.getState().reset();
  useSettings.getState().set({ language: 'en' });
  build.calls = 0;
  build.po = null;
  build.resolve = null;
  resetPhoneKindForTest();
  build.support = { pip: true, live: false, prerender: true };
  renders = 0;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('VideoPipDialog — dựng sẵn', () => {
  it('tiến độ: state chỉ đổi khi số % đổi; chữ % không là live region; nhắc giữ trang mở', () => {
    render(<Host />);
    const dialog = screen.getByRole('dialog', { name: en('mini.video.title') });
    expect(within(dialog).getByText(en('mini.video.prerenderHint'))).toBeTruthy();
    act(() => {
      within(dialog)
        .getByRole('button', { name: en('mini.video.build') })
        .click();
    });
    expect(build.po?.onProgress).toBeTypeOf('function');
    const text = within(dialog).getByText(en('mini.video.building', { pct: 0 }));
    expect(text.textContent).toContain('100 %');
    expect(text.getAttribute('role')).toBeNull();
    expect(text.getAttribute('aria-live')).toBe('off');

    const before = renders;
    const report = (f: number): void =>
      act(() => {
        build.po?.onProgress?.(f);
      });
    // 20 lần báo trong cùng 0 % → không vẽ lại.
    for (let i = 1; i <= 20; i++) report(i / 2500);
    expect(renders).toBe(before);
    // 40 lần báo qua 1 % rồi 2 % → mỗi bậc một lần.
    for (let i = 0; i < 40; i++) report(0.01 + i / 2000);
    expect(renders - before).toBe(2);
    const bar = within(dialog).getByRole('progressbar', { name: en('mini.video.progress') });
    expect(bar.getAttribute('value')).toBe('2');
  });
});

describe('VideoPipDialog — mở PiP trong cú chạm (R6, iPhone)', () => {
  const restore: (() => void)[] = [];
  let pipEl: Element | null = null;
  /** "User activation" giả kiểu Safari: bật khi click bắt đầu, tắt ở microtask kế (await là mất). */
  let activation = false;
  /** Lỗi trình duyệt trả cho requestPictureInPicture (null = nhận khi còn activation). */
  let refuse: DOMException | null = null;
  const onClickCapture = (): void => {
    activation = true;
    queueMicrotask(() => {
      activation = false;
    });
  };

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
    build.support = { pip: true, live: true, prerender: true };
    pipEl = null;
    activation = false;
    refuse = null;
    document.addEventListener('click', onClickCapture, true);
    restore.push(() => document.removeEventListener('click', onClickCapture, true));
    // Video vào PiP = phần tử nhận enterpictureinpicture (bắt ở document, pha capture).
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
    if (!('srcObject' in HTMLMediaElement.prototype)) {
      stub(HTMLMediaElement.prototype, 'srcObject', null);
    }
    stub(HTMLCanvasElement.prototype, 'captureStream', () => ({
      getTracks: () => [{ stop: () => undefined }],
    }));
    stub(
      HTMLVideoElement.prototype,
      'requestPictureInPicture',
      vi.fn(function (this: HTMLVideoElement) {
        if (refuse) return Promise.reject(refuse);
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
    // Gỡ hộp thoại (dọn video chuẩn bị) TRƯỚC khi trả API giả.
    cleanup();
    delete (document as unknown as Record<string, unknown>).pictureInPictureElement;
    for (const r of restore.splice(0).reverse()) r();
  });

  const hostVideos = () =>
    Array.from(screen.getByTestId('video-host').querySelectorAll<HTMLVideoElement>('video'));

  /** Chờ promise của enter() + setState. */
  async function settle(): Promise<void> {
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  it('hộp thoại hiện → video trực tiếp chuẩn bị sẵn (đang phát, câm); chạm "Mở" → vào PiP ngay trong cú chạm', async () => {
    const { rerender } = render(<Host />);
    const dialog = screen.getByRole('dialog', { name: en('mini.video.title') });
    // Chuẩn bị TRƯỚC cú chạm: video gắn vào host, đã play(), chưa xin PiP.
    const [prepared] = hostVideos();
    expect(prepared).toBeTruthy();
    expect(prepared.muted).toBe(true);
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalled();
    expect(HTMLVideoElement.prototype.requestPictureInPicture).not.toHaveBeenCalled();
    const open = within(dialog).getByRole('button', { name: en('mini.video.liveOpen') });
    expect(open.getAttribute('data-ready')).toBe('false');
    act(() => {
      prepared.dispatchEvent(new Event('loadedmetadata'));
    });
    await settle();
    expect(open.getAttribute('data-ready')).toBe('true');

    fireEvent.click(open);
    // Lời gọi PiP đã xảy ra đồng bộ trong click (còn activation) trên đúng video đã chuẩn bị.
    expect(HTMLVideoElement.prototype.requestPictureInPicture).toHaveBeenCalledTimes(1);
    expect(vi.mocked(HTMLVideoElement.prototype.requestPictureInPicture).mock.contexts[0]).toBe(
      prepared,
    );
    await settle();
    expect(pipEl).toBe(prepared);
    expect(within(dialog).getByText(en('mini.video.statusOpen'))).toBeTruthy();
    expect(within(dialog).queryByRole('alert')).toBeNull();
    // Video mới đã chuẩn bị cho lần mở sau (cái đang ở PiP vẫn giữ).
    expect(hostVideos()).toHaveLength(2);

    // Đóng hộp thoại: bỏ video chuẩn bị, KHÔNG đóng khung PiP.
    rerender(<Host open={false} />);
    expect(hostVideos()).toEqual([prepared]);
    expect(pipEl).toBe(prepared);
  });

  it('trình duyệt vẫn từ chối (NotAllowedError) → câu dễ hiểu, không chữ lỗi thô; iPhone: "iPhone / iPad chưa hỗ trợ…"', async () => {
    refuse = new DOMException(
      'The request is not triggered by a user activation.',
      'NotAllowedError',
    );
    render(<Host />);
    const dialog = screen.getByRole('dialog', { name: en('mini.video.title') });
    fireEvent.click(within(dialog).getByRole('button', { name: en('mini.video.liveOpen') }));
    await settle();
    const alert = within(dialog).getByRole('alert');
    expect(alert.textContent).toBe(en('mini.video.errorBlocked'));
    expect(alert.getAttribute('data-error')).toBe('notAllowed');
    expect(dialog.textContent).not.toContain('user activation');
    // Chạm lại được: đã có video chuẩn bị mới.
    expect(hostVideos()).toHaveLength(1);
  });

  /** iPhone (UA, chưa chọn loại điện thoại): hộp thoại tự dựng sẵn — trả kết quả dựng (blob đã nạp sẵn). */
  async function finishAutoBuild(): Promise<void> {
    expect(build.po).not.toBeNull();
    await act(async () => {
      build.resolve?.(BUILT);
      await Promise.resolve();
    });
  }

  it('iPhone: bị từ chối / không hỗ trợ → "iPhone / iPad chưa hỗ trợ cửa sổ video nổi cho trang web này"', async () => {
    stub(navigator, 'userAgent', IPHONE_UA);
    useSettings.getState().set({ language: 'vi' });
    refuse = new DOMException('The video element does not support PiP.', 'NotSupportedError');
    render(<Host />);
    const dialog = screen.getByRole('dialog', { name: 'Cửa sổ video nổi (thử nghiệm)' });
    await finishAutoBuild();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Mở video dựng sẵn' }));
    await settle();
    expect(within(dialog).getByRole('alert').textContent).toBe(
      'iPhone / iPad chưa hỗ trợ cửa sổ video nổi cho trang web này.',
    );
  });

  it('iPhone: "chưa sẵn sàng" lần hai → "iPhone / iPad chưa hỗ trợ…" (không bắt chạm lại mãi)', async () => {
    stub(navigator, 'userAgent', IPHONE_UA);
    useSettings.getState().set({ language: 'vi' });
    refuse = new DOMException('The element is not ready.', 'InvalidStateError');
    render(<Host />);
    const dialog = screen.getByRole('dialog', { name: 'Cửa sổ video nổi (thử nghiệm)' });
    await finishAutoBuild();
    const open = () => within(dialog).getByRole('button', { name: 'Mở video dựng sẵn' });
    fireEvent.click(open());
    await settle();
    expect(within(dialog).getByRole('alert').textContent).toBe(
      'Video chưa sẵn sàng — chờ một giây rồi chạm lại.',
    );
    fireEvent.click(open());
    await settle();
    expect(within(dialog).getByRole('alert').textContent).toBe(
      'iPhone / iPad chưa hỗ trợ cửa sổ video nổi cho trang web này.',
    );
  });

  it('máy Apple (đã chọn): không có "Trực tiếp" (không chuẩn bị luồng canvas), tự dựng sẵn một lần khi hộp thoại hiện; Hủy dựng không tự dựng lại', () => {
    setPhoneKind('apple');
    const capture = vi.fn(() => ({ getTracks: () => [{ stop: () => undefined }] }));
    stub(HTMLCanvasElement.prototype, 'captureStream', capture);
    const { rerender } = render(<Host />);
    const dialog = screen.getByRole('dialog', { name: en('mini.video.title') });
    expect(within(dialog).queryByRole('heading', { name: en('mini.video.live') })).toBeNull();
    expect(within(dialog).queryByRole('button', { name: en('mini.video.liveOpen') })).toBeNull();
    expect(capture).not.toHaveBeenCalled();
    expect(hostVideos()).toHaveLength(0);
    // Tự dựng ngay (không chờ bấm "Dựng video").
    expect(build.calls).toBe(1);
    expect(
      within(dialog).getByRole('progressbar', { name: en('mini.video.progress') }),
    ).toBeTruthy();
    rerender(<Host />);
    expect(build.calls).toBe(1);
    act(() => {
      within(dialog)
        .getByRole('button', { name: en('mini.video.cancel') })
        .click();
    });
    expect(build.po?.signal?.aborted).toBe(true);
    expect(build.calls).toBe(1);
    expect(within(dialog).getByRole('button', { name: en('mini.video.build') })).toBeTruthy();
  });

  it('lựa chọn đã lưu thắng UA: iPhone nhưng chọn Android → có "Trực tiếp" (nút chính), không tự dựng', () => {
    stub(navigator, 'userAgent', IPHONE_UA);
    setPhoneKind('android');
    render(<Host />);
    const dialog = screen.getByRole('dialog', { name: en('mini.video.title') });
    const live = within(dialog).getByRole('button', { name: en('mini.video.liveOpen') });
    expect(live.className).toContain('btn-primary');
    expect(build.calls).toBe(0);
    expect(hostVideos()).toHaveLength(1);
  });

  it('video chuẩn bị treo quá PREPARE_STALL_MS → chạm báo "không hỗ trợ" ngay, không xin PiP với video hỏng', async () => {
    vi.useFakeTimers();
    try {
      render(<Host />);
      const dialog = screen.getByRole('dialog', { name: en('mini.video.title') });
      const open = within(dialog).getByRole('button', { name: en('mini.video.liveOpen') });
      // Không bao giờ có `loadedmetadata` (vd. iOS chặn phát video ẩn).
      act(() => {
        vi.advanceTimersByTime(PREPARE_STALL_MS);
      });
      fireEvent.click(open);
      expect(HTMLVideoElement.prototype.requestPictureInPicture).not.toHaveBeenCalled();
      const alert = within(dialog).getByRole('alert');
      expect(alert.getAttribute('data-error')).toBe('unsupported');
      expect(alert.textContent).toBe(en('mini.video.unsupported'));
    } finally {
      vi.useRealTimers();
    }
  });

  it('dựng xong → video dựng sẵn chuẩn bị sẵn (blob đã nạp); chạm "Mở video dựng sẵn" → PiP trong cú chạm', async () => {
    build.support = { pip: true, live: false, prerender: true };
    render(<Host />);
    const dialog = screen.getByRole('dialog', { name: en('mini.video.title') });
    act(() => {
      within(dialog)
        .getByRole('button', { name: en('mini.video.build') })
        .click();
    });
    await act(async () => {
      build.resolve?.({
        blob: new Blob([new Uint8Array(2048)], { type: 'video/webm' }),
        codec: 'V_VP8',
        frames: 24,
        durationSec: 1,
        width: 480,
        height: 360,
      });
      await Promise.resolve();
    });
    const [prepared] = hostVideos();
    expect(prepared.getAttribute('src')).toBe('blob:built');
    fireEvent.click(within(dialog).getByRole('button', { name: en('mini.video.openBuilt') }));
    expect(HTMLVideoElement.prototype.requestPictureInPicture).toHaveBeenCalledTimes(1);
    await settle();
    expect(pipEl).toBe(prepared);
    expect(within(dialog).getByText(en('mini.video.statusOpen'))).toBeTruthy();
  });
});

describe('videoPipErrorText', () => {
  it('loại lỗi → câu (iPhone gộp "từ chối" + "không hỗ trợ")', () => {
    expect(videoPipErrorText('notAllowed', true)).toBe('mini.video.errorIos');
    expect(videoPipErrorText('unsupported', true)).toBe('mini.video.errorIos');
    expect(videoPipErrorText('notAllowed', false)).toBe('mini.video.errorBlocked');
    expect(videoPipErrorText('unsupported', false)).toBe('mini.video.unsupported');
    expect(videoPipErrorText('notReady', true)).toBe('mini.video.errorNotReady');
    expect(videoPipErrorText('failed', false)).toBe('mini.video.errorFailed');
  });
});

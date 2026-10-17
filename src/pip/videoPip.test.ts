import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseHarm } from '../core/parser';
import { buildTimeline } from '../core/timeline';
import type { Timeline } from '../core/types';
import { CUE_LAYER_ATTR } from '../player/layout';
import {
  GuidePainter,
  KEYFRAME_EVERY_SEC,
  MIN_VIDEO_COUNTDOWN,
  currentVideoPipEnv,
  detectVideoPipSupport,
  guideVideoDurationSec,
  guideVideoFrameAt,
  guideVideoTiming,
  WEBKIT_PIP_TIMEOUT_MS,
  isAppleMobile,
  nextTask,
  pickPrerenderCodec,
  prepareLiveVideoPip,
  prepareVideoBlobPip,
  prerenderGuideVideo,
  requestVideoPip,
  videoPipErrorKind,
} from './videoPip';
import type {
  EncoderLike,
  GuideVideoOptions,
  VideoPipEnv,
  VideoPipHooks,
  VideoPipSession,
  WebCodecsApi,
} from './videoPip';

function timeline(src = '@bpm 120\nZ X C V B N M ,'): Timeline {
  const parsed = parseHarm(src);
  return buildTimeline(parsed.song, { baseOctave: 4, scrollDir: 1 });
}

function options(patch: Partial<GuideVideoOptions> = {}): GuideVideoOptions {
  return {
    timeline: timeline(),
    bpm: 120,
    scheme: 'mobile',
    mobileSemitone: 'toggle',
    labels: {
      left: 'Cúi Xuống',
      right: 'Ngẩng Lên',
      natural: 'Ngẩng Tự Nhiên',
      scroll: 'Nửa Cung',
    },
    theme: 'dark',
    language: 'vi',
    subLabel: 'solfege',
    lookahead: 8,
    countdownSec: 3,
    ...patch,
  };
}

describe('detectVideoPipSupport', () => {
  const fn = (): void => undefined;
  const env = (patch: Partial<VideoPipEnv>): VideoPipEnv => ({
    videoProto: {},
    canvasProto: {},
    pictureInPictureEnabled: true,
    VideoEncoder: undefined,
    VideoFrame: undefined,
    canPlayType: () => 'maybe',
    ...patch,
  });

  it('dựng sẵn cần <video> phát được WebM (VP8 hoặc VP9) — mã hóa được chưa đủ', () => {
    const full = { videoProto: { requestPictureInPicture: fn }, VideoEncoder: fn, VideoFrame: fn };
    expect(detectVideoPipSupport(env(full)).prerender).toBe(true);
    expect(detectVideoPipSupport(env({ ...full, canPlayType: () => '' })).prerender).toBe(false);
    expect(detectVideoPipSupport(env({ ...full, canPlayType: null })).prerender).toBe(false);
    const asked: string[] = [];
    const vp9Only = (type: string): string => (asked.push(type), /vp9/.test(type) ? 'maybe' : '');
    expect(detectVideoPipSupport(env({ ...full, canPlayType: vp9Only })).prerender).toBe(true);
    expect(asked[0]).toBe('video/webm; codecs="vp8"');
  });

  it('không có requestPictureInPicture → không gì cả', () => {
    expect(
      detectVideoPipSupport(
        env({ canvasProto: { captureStream: fn }, VideoEncoder: fn, VideoFrame: fn }),
      ),
    ).toEqual({
      pip: false,
      live: false,
      prerender: false,
    });
    expect(detectVideoPipSupport(env({ videoProto: null }))).toEqual({
      pip: false,
      live: false,
      prerender: false,
    });
  });

  it('PiP bị tắt (pictureInPictureEnabled = false) → không hỗ trợ', () => {
    expect(
      detectVideoPipSupport(
        env({ videoProto: { requestPictureInPicture: fn }, pictureInPictureEnabled: false }),
      ).pip,
    ).toBe(false);
  });

  it('PiP có, thiếu captureStream / WebCodecs → chỉ phần có', () => {
    const pip = { requestPictureInPicture: fn };
    expect(detectVideoPipSupport(env({ videoProto: pip }))).toEqual({
      pip: true,
      live: false,
      prerender: false,
    });
    expect(
      detectVideoPipSupport(env({ videoProto: pip, canvasProto: { captureStream: fn } })),
    ).toEqual({
      pip: true,
      live: true,
      prerender: false,
    });
    expect(detectVideoPipSupport(env({ videoProto: pip, VideoEncoder: fn }))).toEqual({
      pip: true,
      live: false,
      prerender: false,
    });
    expect(
      detectVideoPipSupport(
        env({
          videoProto: pip,
          canvasProto: { captureStream: fn },
          VideoEncoder: fn,
          VideoFrame: fn,
          pictureInPictureEnabled: undefined,
        }),
      ),
    ).toEqual({ pip: true, live: true, prerender: true });
  });

  it('thuộc tính không phải hàm thì không tính', () => {
    expect(detectVideoPipSupport(env({ videoProto: { requestPictureInPicture: 1 } })).pip).toBe(
      false,
    );
  });

  it('jsdom (không có PiP) → không hỗ trợ', () => {
    expect(detectVideoPipSupport(currentVideoPipEnv()).pip).toBe(false);
  });
});

describe('thời gian video', () => {
  it('đếm ngược tối thiểu 3 giây; dẫn vào 0,65 ô nhịp (v1.0.1); độ dài = đếm + dẫn + bài + đuôi', () => {
    const tl = timeline();
    expect(guideVideoTiming(tl, 120, 0).countdownSec).toBe(MIN_VIDEO_COUNTDOWN);
    expect(guideVideoTiming(tl, 120, 5).countdownSec).toBe(5);
    expect(guideVideoTiming(tl, 0, 3).bpm).toBe(90);
    const t = guideVideoTiming(tl, 120, 3);
    // Nốt đầu ở beat 0: dẫn vào = 0,65 × 4 beat (src/player/leadIn.ts).
    expect(t.leadBeats).toBe(2.6);
    // 8 nốt × 1 beat = 8 beat; 120 bpm → 0.5 s / beat
    expect(guideVideoDurationSec(t)).toBeCloseTo(3 + (2.6 + 8) * 0.5 + t.tailSec, 6);
    // Khoảng lặng đầu bài → dẫn vào ngắn lại (nốt đầu đi 0,65 × (4 + 2) beat).
    expect(guideVideoTiming(timeline('@bpm 120\n_*2 Z X'), 120, 3).leadBeats).toBeCloseTo(1.9, 9);
  });

  it('đếm vào tắt (Cài đặt → Phát bài) → không dẫn vào: nốt đầu chạm hit line ngay sau 3-2-1', () => {
    const tl = timeline();
    const t = guideVideoTiming(tl, 120, 3, false);
    expect(t.leadBeats).toBe(0);
    expect(guideVideoFrameAt(t, 3)).toEqual({ beat: 0, countdown: null, ended: false });
    expect(guideVideoDurationSec(t)).toBeCloseTo(3 + 8 * 0.5 + t.tailSec, 6);
  });

  it('3-2-1 rồi beat chạy từ đầu đoạn dẫn vào (−2,6); hết = ended', () => {
    const t = guideVideoTiming(timeline(), 120, 3);
    expect(guideVideoFrameAt(t, 0)).toEqual({ beat: -2.6, countdown: 3, ended: false });
    expect(guideVideoFrameAt(t, 0.99).countdown).toBe(3);
    expect(guideVideoFrameAt(t, 1).countdown).toBe(2);
    expect(guideVideoFrameAt(t, 2.5).countdown).toBe(1);
    expect(guideVideoFrameAt(t, 3)).toEqual({ beat: -2.6, countdown: null, ended: false });
    expect(guideVideoFrameAt(t, 4.3).beat).toBeCloseTo(0, 9);
    expect(guideVideoFrameAt(t, 5.3).beat).toBeCloseTo(2, 9);
    expect(guideVideoFrameAt(t, guideVideoDurationSec(t)).ended).toBe(true);
    expect(guideVideoFrameAt(t, Number.NaN).countdown).toBe(3);
  });
});

describe('GuidePainter (jsdom: không có canvas 2D)', () => {
  it('gắn canvas nguồn ẩn vào body, paint trả trạng thái, dispose gỡ sạch', () => {
    const before = document.body.children.length;
    const p = new GuidePainter(options());
    expect(p.width).toBe(480);
    expect(p.height).toBe(360);
    expect(p.canvas.width).toBe(480);
    const host = document.body.querySelector('.guide-video-source');
    expect(host?.getAttribute('aria-hidden')).toBe('true');
    expect(p.paint(0).countdown).toBe(3);
    expect(p.paint(10).countdown).toBeNull();
    p.dispose();
    p.dispose();
    expect(document.body.children.length).toBe(before);
    // Sau dispose vẫn trả trạng thái, không vẽ.
    expect(p.paint(0).countdown).toBe(3);
  });

  it('canvas nguồn vẽ ở DPR 1 (đúng width × cao làn) kể cả màn DPR 3', () => {
    const restore: (() => void)[] = [];
    const define = (obj: object, key: string, get: () => unknown): void => {
      const had = Object.getOwnPropertyDescriptor(obj, key);
      Object.defineProperty(obj, key, { configurable: true, get });
      restore.push(() => {
        if (had) Object.defineProperty(obj, key, had);
        else delete (obj as Record<string, unknown>)[key];
      });
    };
    define(window, 'devicePixelRatio', () => 3);
    define(HTMLCanvasElement.prototype, 'clientWidth', () => 480);
    define(HTMLCanvasElement.prototype, 'clientHeight', () => 360);
    try {
      const p = new GuidePainter(options());
      const tiles = document.querySelector<HTMLCanvasElement>('.guide-video-source canvas');
      expect(tiles?.width).toBe(480);
      expect(tiles?.height).toBe(360);
      p.dispose();
    } finally {
      for (const r of restore.reverse()) r();
    }
  });

  it('kích thước lẻ được làm chẵn (VP8/VP9 cần), scheme PC cũng chạy', () => {
    const p = new GuidePainter(options({ width: 301, height: 199, scheme: 'pc', theme: 'light' }));
    expect(p.width % 2).toBe(0);
    expect(p.height % 2).toBe(0);
    expect(p.paint(4).ended).toBe(false);
    p.dispose();
  });

  it('Mobile: lớp vòng "CHẠM" cạnh canvas làn (renderer vẽ lên đó, chép đè lên bàn nút); PC: không có', () => {
    const mobile = new GuidePainter(options());
    const host = document.querySelector('.guide-video-source');
    const layer = host?.querySelector(`canvas[${CUE_LAYER_ATTR}]`);
    expect(layer).not.toBeNull();
    // Cùng hộp với canvas làn (renderer tìm lớp trong cha của canvas làn).
    expect(layer?.parentElement).toBe(host?.querySelector('canvas')?.parentElement);
    expect(mobile.paint(5).countdown).toBeNull();
    mobile.dispose();
    expect(document.querySelector(`canvas[${CUE_LAYER_ATTR}]`)).toBeNull();
    const pc = new GuidePainter(options({ scheme: 'pc' }));
    expect(document.querySelector(`.guide-video-source canvas[${CUE_LAYER_ATTR}]`)).toBeNull();
    pc.dispose();
  });
});

// ---------------------------------------------------------------------------
// WebCodecs giả
// ---------------------------------------------------------------------------

interface FakeChunkSink {
  output: (chunk: EncodedVideoChunk) => void;
  error: (e: DOMException) => void;
}

function fakeApi(opts: { supported?: readonly string[]; failAt?: number } = {}) {
  const supported = opts.supported ?? ['vp8', 'vp09.00.10.08'];
  const encoders: FakeEncoder[] = [];
  const frames: { closed: boolean }[] = [];
  class FakeFrame {
    closed = false;
    timestamp: number;
    constructor(_src: CanvasImageSource, init?: VideoFrameInit) {
      this.timestamp = init?.timestamp ?? 0;
      frames.push(this);
    }
    close(): void {
      this.closed = true;
    }
  }
  class FakeEncoder implements EncoderLike {
    encodeQueueSize = 0;
    closed = false;
    config: VideoEncoderConfig | null = null;
    keyFlags: boolean[] = [];
    private readonly sink: FakeChunkSink;
    constructor(init: VideoEncoderInit) {
      this.sink = init as unknown as FakeChunkSink;
      encoders.push(this);
    }
    static isConfigSupported(config: VideoEncoderConfig): Promise<VideoEncoderSupport> {
      return Promise.resolve({ supported: supported.includes(config.codec), config });
    }
    configure(config: VideoEncoderConfig): void {
      this.config = config;
    }
    encode(frame: VideoFrame, options?: VideoEncoderEncodeOptions): void {
      const i = this.keyFlags.length;
      if (opts.failAt === i) {
        this.sink.error(new DOMException('boom', 'EncodingError'));
        return;
      }
      const key = options?.keyFrame === true;
      this.keyFlags.push(key);
      const data = new Uint8Array([i % 256, 1, 2]);
      const chunk = {
        type: key ? 'key' : 'delta',
        timestamp: (frame as unknown as FakeFrame).timestamp,
        byteLength: data.length,
        copyTo: (dest: Uint8Array) => dest.set(data),
      } as unknown as EncodedVideoChunk;
      this.sink.output(chunk);
    }
    flush(): Promise<void> {
      return Promise.resolve();
    }
    close(): void {
      this.closed = true;
    }
  }
  const api = { VideoEncoder: FakeEncoder, VideoFrame: FakeFrame } as unknown as WebCodecsApi;
  return { api, encoders, frames };
}

describe('prerenderGuideVideo', () => {
  // jsdom: canPlayType luôn '' → giả lập trình duyệt phát được WebM.
  beforeEach(() => {
    vi.spyOn(HTMLMediaElement.prototype, 'canPlayType').mockReturnValue('maybe');
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('chọn VP8 trước, VP9 nếu thiếu; không codec nào → null', async () => {
    expect((await pickPrerenderCodec(fakeApi().api, 480, 360, 24))?.id).toBe('V_VP8');
    expect(
      (await pickPrerenderCodec(fakeApi({ supported: ['vp09.00.10.08'] }).api, 480, 360, 24))?.id,
    ).toBe('V_VP9');
    expect(await pickPrerenderCodec(fakeApi({ supported: [] }).api, 480, 360, 24)).toBeNull();
  });

  it('bỏ codec mà <video> không phát được (canPlayType rỗng) — trước khi dựng', async () => {
    const vp9Only = (type: string): string => (/vp9/.test(type) ? 'probably' : '');
    expect((await pickPrerenderCodec(fakeApi().api, 480, 360, 24, vp9Only))?.id).toBe('V_VP9');
    expect(await pickPrerenderCodec(fakeApi().api, 480, 360, 24, () => '')).toBeNull();
    expect((await pickPrerenderCodec(fakeApi().api, 480, 360, 24, null))?.id).toBe('V_VP8');
    // Mã hóa được nhưng không phát được: reject ngay, không mã hóa khung nào.
    const { api, encoders } = fakeApi();
    await expect(
      prerenderGuideVideo(options(), { api, fps: 10, canPlayType: () => '' }),
    ).rejects.toThrow(/codec/);
    expect(encoders).toHaveLength(0);
  });

  it('nhường luồng bằng MessageChannel (timer của trang nền bị hãm) — không cần setTimeout', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    // setTimeout giả không bao giờ chạy: nextTask vẫn xong.
    await expect(nextTask()).resolves.toBeUndefined();
    const { api } = fakeApi();
    const r = await prerenderGuideVideo(options(), { api, fps: 10, maxSec: 2 });
    expect(r.frames).toBe(20);
  });

  it('dựng đủ khung, khung khóa đều, tiến độ tới 1, đóng mọi frame + encoder, ra WebM', async () => {
    const { api, encoders, frames } = fakeApi();
    const progress: number[] = [];
    const before = document.body.children.length;
    const r = await prerenderGuideVideo(options(), {
      api,
      fps: 10,
      maxSec: 4.05,
      onProgress: (f) => progress.push(f),
    });
    expect(r.codec).toBe('V_VP8');
    expect(r.frames).toBe(41);
    expect(r.durationSec).toBeCloseTo(4.05, 6);
    expect(r.blob.type).toBe('video/webm');
    expect(r.blob.size).toBeGreaterThan(41 * 3);
    expect(frames).toHaveLength(41);
    expect(frames.every((f) => f.closed)).toBe(true);
    const enc = encoders[0];
    expect(enc.closed).toBe(true);
    expect(enc.config?.width).toBe(480);
    const keys = enc.keyFlags.flatMap((k, i) => (k ? [i] : []));
    expect(keys).toEqual([0, 20, 40].filter((i) => i < 41));
    expect(KEYFRAME_EVERY_SEC * 10).toBe(20);
    expect(progress[progress.length - 1]).toBe(1);
    for (let i = 1; i < progress.length; i++)
      expect(progress[i]).toBeGreaterThanOrEqual(progress[i - 1]);
    // canvas nguồn ẩn đã gỡ
    expect(document.body.children.length).toBe(before);
  });

  it('mặc định dựng cả bài (đếm ngược + dẫn vào + bài + đuôi)', async () => {
    const { api } = fakeApi();
    const r = await prerenderGuideVideo(options(), { api, fps: 4 });
    const t = guideVideoTiming(options().timeline, 120, 3);
    expect(r.durationSec).toBeCloseTo(guideVideoDurationSec(t), 6);
    expect(r.frames).toBe(Math.ceil(guideVideoDurationSec(t) * 4));
  });

  it('hủy giữa chừng → AbortError, encoder đóng', async () => {
    const { api, encoders } = fakeApi();
    const ac = new AbortController();
    const p = prerenderGuideVideo(options(), {
      api,
      fps: 10,
      signal: ac.signal,
      onProgress: (f) => {
        if (f > 0.2) ac.abort();
      },
    });
    await expect(p).rejects.toMatchObject({ name: 'AbortError' });
    expect(encoders[0].closed).toBe(true);
  });

  it('lỗi encoder → reject; không codec → reject; không WebCodecs → reject', async () => {
    await expect(
      prerenderGuideVideo(options(), { api: fakeApi({ failAt: 3 }).api, fps: 10 }),
    ).rejects.toThrow(/boom/);
    await expect(
      prerenderGuideVideo(options(), { api: fakeApi({ supported: [] }).api }),
    ).rejects.toThrow(/codec/);
    await expect(prerenderGuideVideo(options())).rejects.toThrow(/WebCodecs/);
  });
});

// ---------------------------------------------------------------------------
// Phiên PiP (video + PiP giả)
// ---------------------------------------------------------------------------

describe('mở PiP: chuẩn bị trước cú chạm, xin PiP đồng bộ trong cú chạm (R6, lỗi iPhone)', () => {
  let host: HTMLDivElement;
  let pipEl: Element | null;
  const tracks: { stop: ReturnType<typeof vi.fn> }[] = [];
  const restore: (() => void)[] = [];
  /**
   * "User activation" giả kiểu Safari: bật trong handler click, tắt ở microtask kế tiếp — một `await`
   * trước lời gọi PiP là mất (đúng lỗi "The request is not triggered by user activation" trên iPhone).
   */
  let activation = false;

  function stub<T extends object>(obj: T, key: string, value: unknown): void {
    const had = Object.prototype.hasOwnProperty.call(obj, key);
    const prev = (obj as Record<string, unknown>)[key];
    Object.defineProperty(obj, key, { configurable: true, writable: true, value });
    restore.push(() => {
      if (had) Object.defineProperty(obj, key, { configurable: true, writable: true, value: prev });
      else delete (obj as Record<string, unknown>)[key];
    });
  }

  /** Cú chạm thật: listener đầu bật activation (tắt ở microtask kế), listener sau = handler của app. */
  function tap(handler: () => void): void {
    const btn = document.createElement('button');
    document.body.appendChild(btn);
    btn.addEventListener('click', () => {
      activation = true;
      queueMicrotask(() => {
        activation = false;
      });
    });
    btn.addEventListener('click', handler);
    btn.click();
    btn.remove();
  }

  const notAllowed = (): DOMException =>
    new DOMException('The request is not triggered by a user activation.', 'NotAllowedError');

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    pipEl = null;
    activation = false;
    tracks.length = 0;
    stub(
      HTMLMediaElement.prototype,
      'play',
      vi.fn(() => Promise.resolve()),
    );
    stub(HTMLMediaElement.prototype, 'pause', vi.fn());
    // Video vào PiP = phần tử nhận sự kiện enterpictureinpicture (bắt ở document, pha capture).
    const onEnter = (e: Event): void => {
      pipEl = e.target as Element;
    };
    document.addEventListener('enterpictureinpicture', onEnter, true);
    restore.push(() => document.removeEventListener('enterpictureinpicture', onEnter, true));
    // Như Safari: chỉ nhận khi đang trong cú chạm.
    stub(HTMLVideoElement.prototype, 'requestPictureInPicture', function (this: HTMLVideoElement) {
      if (!activation) return Promise.reject(notAllowed());
      this.dispatchEvent(new Event('enterpictureinpicture'));
      return Promise.resolve({} as PictureInPictureWindow);
    });
    stub(HTMLCanvasElement.prototype, 'captureStream', () => {
      const t = { stop: vi.fn() };
      tracks.push(t);
      return { getTracks: () => [t] } as unknown as MediaStream;
    });
    Object.defineProperty(document, 'pictureInPictureElement', {
      configurable: true,
      get: () => pipEl,
    });
    stub(
      document,
      'exitPictureInPicture',
      vi.fn(() => {
        const el = pipEl;
        pipEl = null;
        el?.dispatchEvent(new Event('leavepictureinpicture'));
        return Promise.resolve();
      }),
    );
    // jsdom: srcObject không có setter → giả lập thuộc tính thường.
    if (!('srcObject' in HTMLMediaElement.prototype)) {
      stub(HTMLMediaElement.prototype, 'srcObject', null);
    }
    stub(
      URL,
      'createObjectURL',
      vi.fn(() => 'blob:fake'),
    );
    stub(URL, 'revokeObjectURL', vi.fn());
  });

  afterEach(() => {
    delete (document as unknown as Record<string, unknown>).pictureInPictureElement;
    for (const r of restore.splice(0).reverse()) r();
    host.remove();
    vi.useRealTimers();
  });

  /** Mở trực tiếp như hộp thoại: chuẩn bị trước, rồi enter() trong cú chạm. */
  async function openLive(hooks: VideoPipHooks = {}): Promise<VideoPipSession> {
    const p = prepareLiveVideoPip(options(), host);
    let entering: Promise<VideoPipSession> | null = null;
    tap(() => {
      entering = p.enter(hooks);
    });
    if (!entering) throw new Error('tap không gọi enter');
    return entering;
  }

  it('đối chứng: bản cũ (await play() rồi mới xin PiP) bị từ chối NotAllowedError — như iPhone', async () => {
    const v = document.createElement('video');
    host.appendChild(v);
    let old: Promise<unknown> | null = null;
    tap(() => {
      old = (async () => {
        await v.play();
        return v.requestPictureInPicture();
      })();
    });
    await expect(old).rejects.toMatchObject({ name: 'NotAllowedError' });
    // Còn trong cú chạm (không await) thì được.
    let now: Promise<unknown> | null = null;
    tap(() => {
      now = v.requestPictureInPicture();
    });
    await expect(now).resolves.toBeTruthy();
  });

  it('chuẩn bị (trước cú chạm): video câm playsinline gắn vào host, ĐANG phát, chưa vào PiP; metadata → ready', async () => {
    const p = prepareLiveVideoPip(options(), host);
    expect(p.mode).toBe('live');
    expect(host.querySelector('video')).toBe(p.video);
    expect(p.video.muted).toBe(true);
    expect(p.video.hasAttribute('playsinline')).toBe(true);
    expect(p.video.srcObject).toBeTruthy();
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1);
    expect(pipEl).toBeNull();
    expect(p.entered).toBe(false);
    expect(p.ready).toBe(false);
    p.video.dispatchEvent(new Event('loadedmetadata'));
    await expect(p.whenReady).resolves.toBe(true);
    p.close();
  });

  it('cú chạm gọi enter() → requestPictureInPicture ĐỒNG BỘ (còn activation) → vào PiP; rời PiP → dọn, báo onClosed', async () => {
    const onClosed = vi.fn();
    const s = await openLive({ onClosed });
    expect(pipEl).toBe(s.video);
    expect(s.closed).toBe(false);
    expect(tracks).toHaveLength(1);
    s.video.dispatchEvent(new Event('leavepictureinpicture'));
    expect(s.closed).toBe(true);
    expect(onClosed).toHaveBeenCalledTimes(1);
    expect(tracks[0].stop).toHaveBeenCalled();
    expect(host.querySelector('video')).toBeNull();
    expect(document.querySelector('.guide-video-source')).toBeNull();
    // Rời PiP do trình duyệt (không phải close()) → không gọi exit (có thể thoát nhầm khung của video mới).
    expect(document.exitPictureInPicture).not.toHaveBeenCalled();
    s.close();
    expect(onClosed).toHaveBeenCalledTimes(1);
  });

  it('enter() sau một await (ngoài cú chạm) → NotAllowedError, video bị dọn, loại lỗi = notAllowed', async () => {
    const onClosed = vi.fn();
    const p = prepareLiveVideoPip(options(), host);
    let late: Promise<VideoPipSession> | null = null;
    tap(() => {
      late = (async () => {
        await Promise.resolve();
        return p.enter({ onClosed });
      })();
    });
    const err: unknown = await (late as Promise<VideoPipSession> | null)?.catch((e: unknown) => e);
    expect(videoPipErrorKind(err)).toBe('notAllowed');
    expect(p.closed).toBe(true);
    expect(onClosed).toHaveBeenCalledTimes(1);
    expect(host.querySelector('video')).toBeNull();
    expect(tracks[0].stop).toHaveBeenCalled();
  });

  it('close() thoát PiP nếu video đang ở PiP; bỏ video chuẩn bị (chưa vào) thì không báo onClosed', async () => {
    const s = await openLive();
    s.close();
    expect(document.exitPictureInPicture).toHaveBeenCalledTimes(1);
    expect(s.closed).toBe(true);

    const p = prepareLiveVideoPip(options(), host);
    const onClosed = vi.fn();
    p.close();
    expect(onClosed).not.toHaveBeenCalled();
    await expect(p.whenReady).resolves.toBe(false);
    expect(host.querySelector('video')).toBeNull();
    // Đã dọn thì không vào PiP được nữa.
    let again: Promise<VideoPipSession> | null = null;
    tap(() => {
      again = p.enter({ onClosed });
    });
    await expect(again).rejects.toMatchObject({ name: 'InvalidStateError' });
  });

  it('mỗi video chuẩn bị chỉ vào PiP một lần', async () => {
    const p = prepareLiveVideoPip(options(), host);
    let first: Promise<VideoPipSession> | null = null;
    let second: Promise<VideoPipSession> | null = null;
    tap(() => {
      first = p.enter();
      second = p.enter();
    });
    await expect(first).resolves.toBe(p);
    await expect(second).rejects.toMatchObject({ name: 'InvalidStateError' });
    p.close();
  });

  it('không có captureStream → ném NotSupportedError, không để lại gì', () => {
    stub(HTMLCanvasElement.prototype, 'captureStream', undefined);
    let err: unknown = null;
    try {
      prepareLiveVideoPip(options(), host);
    } catch (e) {
      err = e;
    }
    expect(videoPipErrorKind(err)).toBe('unsupported');
    expect(document.querySelector('.guide-video-source')).toBeNull();
    expect(host.children).toHaveLength(0);
  });

  it('trực tiếp: ❚❚ / ▶ của khung PiP qua Media Session; đứng yên không vẽ lại; hết bài ▶ chơi lại', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    let nowMs = 1000;
    const nowSpy = vi.spyOn(performance, 'now').mockImplementation(() => nowMs);
    const paint = vi.spyOn(GuidePainter.prototype, 'paint');
    const handlers = new Map<string, MediaSessionActionHandler | null>();
    stub(navigator, 'mediaSession', {
      setActionHandler: (action: string, fn: MediaSessionActionHandler | null) => {
        handlers.set(action, fn);
      },
    });
    // Mỗi bước = một nhịp 33 ms của vòng vẽ.
    const run = (ms: number): void => {
      for (let t = 0; t < ms; t += 33) {
        nowMs += 33;
        vi.advanceTimersByTime(33);
      }
    };
    const action = (name: MediaSessionAction): void =>
      handlers.get(name)?.({ action: name } as MediaSessionActionDetails);
    try {
      const p = prepareLiveVideoPip(options(), host);
      // Chưa vào PiP: chưa giành nút media, chưa chạy vòng vẽ (đồng hồ đứng ở khung 0).
      expect(handlers.size).toBe(0);
      paint.mockClear();
      run(500);
      expect(paint).not.toHaveBeenCalled();
      let entering: Promise<VideoPipSession> | null = null;
      tap(() => {
        entering = p.enter();
      });
      const s = await (entering as Promise<VideoPipSession> | null);
      if (!s) throw new Error('không vào PiP');
      expect(typeof handlers.get('play')).toBe('function');
      expect(typeof handlers.get('pause')).toBe('function');
      run(990);
      const lastSec = (): number => Number(paint.mock.calls[paint.mock.calls.length - 1]?.[0]);
      expect(lastSec()).toBeCloseTo(0.99, 2);

      // ❚❚: dừng video + ô rơi; đứng yên thì không vẽ lại (đỡ pin).
      action('pause');
      expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled();
      run(330);
      paint.mockClear();
      run(1000);
      expect(paint).not.toHaveBeenCalled();

      // ▶: chạy tiếp từ chỗ dừng.
      action('play');
      run(330);
      expect(lastSec()).toBeGreaterThan(1);
      expect(lastSec()).toBeLessThan(1.5);

      // Hết bài (10.5 s): video dừng (khung PiP hiện ▶), không vẽ nữa; ▶ = chơi lại từ đầu.
      const pauses = vi.mocked(HTMLMediaElement.prototype.pause).mock.calls.length;
      run(10_000);
      expect(vi.mocked(HTMLMediaElement.prototype.pause).mock.calls.length).toBeGreaterThan(pauses);
      paint.mockClear();
      run(500);
      expect(paint).not.toHaveBeenCalled();
      action('play');
      run(99);
      expect(lastSec()).toBeLessThan(0.2);

      s.close();
      expect(handlers.get('play')).toBeNull();
      expect(handlers.get('pause')).toBeNull();
    } finally {
      nowSpy.mockRestore();
      paint.mockRestore();
    }
  });

  it('dựng sẵn: chuẩn bị = nạp blob + mồi (phát rồi dừng ở 0 s); cú chạm → PiP + phát từ đầu; đóng → thu hồi URL', async () => {
    const p = prepareVideoBlobPip(new Blob([new Uint8Array(10)], { type: 'video/webm' }), host);
    expect(p.mode).toBe('prerender');
    expect(p.video.getAttribute('src')).toBe('blob:fake');
    expect(p.video.muted).toBe(true);
    await Promise.resolve();
    await Promise.resolve();
    // Mồi: play() rồi dừng ngay (iOS không nạp video chưa từng phát).
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1);
    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalledTimes(1);
    let entering: Promise<VideoPipSession> | null = null;
    tap(() => {
      entering = p.enter();
    });
    const s = await (entering as Promise<VideoPipSession> | null);
    expect(s).toBe(p);
    expect(pipEl).toBe(p.video);
    // Trong cú chạm: phát lại (không chờ).
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(2);
    p.close();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:fake');
    expect(host.querySelector('video')).toBeNull();
  });

  it('dựng sẵn: chạm ngay trong lúc đang mồi → không bị dừng lại sau đó', async () => {
    let finishPrime: () => void = () => undefined;
    vi.mocked(HTMLMediaElement.prototype.play).mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishPrime = resolve;
        }),
    );
    const p = prepareVideoBlobPip(new Blob([new Uint8Array(10)]), host);
    let entering: Promise<VideoPipSession> | null = null;
    tap(() => {
      entering = p.enter();
    });
    await (entering as Promise<VideoPipSession> | null);
    finishPrime();
    await Promise.resolve();
    await Promise.resolve();
    expect(HTMLMediaElement.prototype.pause).not.toHaveBeenCalled();
    p.close();
  });

  describe('Safari iOS kiểu cũ: chỉ có webkitSetPresentationMode', () => {
    type Wk = HTMLVideoElement & { webkitPresentationMode?: string };
    let setMode: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      stub(HTMLVideoElement.prototype, 'requestPictureInPicture', undefined);
      stub(HTMLVideoElement.prototype, 'webkitSupportsPresentationMode', () => true);
      // Như WebKit: chỉ đổi chế độ khi đang trong cú chạm (ngoài cú chạm: im lặng, không lỗi).
      setMode = vi.fn(function (this: Wk, mode: string) {
        if (mode === 'picture-in-picture' && !activation) return;
        this.webkitPresentationMode = mode;
        this.dispatchEvent(new Event('webkitpresentationmodechanged'));
      });
      stub(HTMLVideoElement.prototype, 'webkitSetPresentationMode', setMode);
    });

    it('phát hiện hỗ trợ: có webkitSetPresentationMode là có PiP', () => {
      const fn = (): void => undefined;
      const support = detectVideoPipSupport({
        videoProto: { webkitSetPresentationMode: fn },
        canvasProto: { captureStream: fn },
        pictureInPictureEnabled: undefined,
        VideoEncoder: undefined,
        VideoFrame: undefined,
        canPlayType: () => '',
      });
      expect(support).toEqual({ pip: true, live: true, prerender: false });
    });

    it('cú chạm → webkitSetPresentationMode("picture-in-picture") đồng bộ → vào PiP; về inline → dọn; close() → inline', async () => {
      const onClosed = vi.fn();
      const s = await openLive({ onClosed });
      expect(setMode).toHaveBeenCalledWith('picture-in-picture');
      expect((s.video as Wk).webkitPresentationMode).toBe('picture-in-picture');
      expect(s.closed).toBe(false);
      // Người dùng đóng khung PiP (về inline) → phiên dọn.
      (
        s.video as Wk & { webkitSetPresentationMode: (m: string) => void }
      ).webkitSetPresentationMode('inline');
      expect(s.closed).toBe(true);
      expect(onClosed).toHaveBeenCalledTimes(1);

      const s2 = await openLive();
      setMode.mockClear();
      s2.close();
      expect(setMode).toHaveBeenCalledWith('inline');
    });

    it('ngoài cú chạm → không đổi chế độ → sau WEBKIT_PIP_TIMEOUT_MS: NotAllowedError (câu "iPhone chưa hỗ trợ…")', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      const p = prepareLiveVideoPip(options(), host);
      const entering = p.enter();
      const caught = entering.catch((e: unknown) => e);
      vi.advanceTimersByTime(WEBKIT_PIP_TIMEOUT_MS + 10);
      const err = await caught;
      expect(videoPipErrorKind(err)).toBe('notAllowed');
      expect(p.closed).toBe(true);
    });
  });

  it('không có API PiP nào → NotSupportedError', async () => {
    stub(HTMLVideoElement.prototype, 'requestPictureInPicture', undefined);
    const v = document.createElement('video');
    const err: unknown = await requestVideoPip(v).catch((e: unknown) => e);
    expect(videoPipErrorKind(err)).toBe('unsupported');
  });
});

describe('videoPipErrorKind / isAppleMobile', () => {
  it('lỗi của trình duyệt → loại (để hộp thoại hiện câu dễ hiểu, không chữ lỗi thô)', () => {
    const dom = (name: string) => new DOMException('raw message', name);
    expect(videoPipErrorKind(dom('NotSupportedError'))).toBe('unsupported');
    expect(videoPipErrorKind(dom('NotAllowedError'))).toBe('notAllowed');
    expect(videoPipErrorKind(dom('SecurityError'))).toBe('notAllowed');
    expect(videoPipErrorKind(dom('InvalidStateError'))).toBe('notReady');
    expect(videoPipErrorKind(new Error('x'))).toBe('failed');
    expect(videoPipErrorKind('x')).toBe('failed');
    expect(videoPipErrorKind(null)).toBe('failed');
  });

  it('iPhone / iPad (kể cả iPadOS báo "Macintosh" có cảm ứng) — không phải Mac / Android', () => {
    const iphone =
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
    const mac =
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15';
    const android =
      'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36';
    expect(isAppleMobile({ userAgent: iphone, maxTouchPoints: 5 })).toBe(true);
    expect(isAppleMobile({ userAgent: mac, maxTouchPoints: 5 })).toBe(true);
    expect(isAppleMobile({ userAgent: mac, maxTouchPoints: 0 })).toBe(false);
    expect(isAppleMobile({ userAgent: android, maxTouchPoints: 5 })).toBe(false);
    expect(isAppleMobile(null)).toBe(false);
  });
});

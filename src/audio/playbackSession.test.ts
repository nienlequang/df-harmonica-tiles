import { describe, expect, it } from 'vitest';
import { ANDROID_UA, FakeAudioElement, IPHONE_UA } from './fakePlaybackEnv';
import {
  DEFAULT_SILENT_RATE,
  PlaybackSession,
  SILENT_ELEMENT_VOLUME,
  isAppleTouch,
  silentWavDataUri,
} from './playbackSession';
import type { SessionNavigator } from './playbackSession';

/** Navigator giả + nhà máy `<audio>` giả đếm được. */
function env(nav: SessionNavigator | null) {
  const made: FakeAudioElement[] = [];
  let nextResult: FakeAudioElement['playResult'] = 'resolve';
  const session = new PlaybackSession({
    navigator: () => nav,
    createAudio: () => {
      const el = new FakeAudioElement();
      el.playResult = nextResult;
      made.push(el);
      return el.asElement();
    },
  });
  return {
    session,
    made,
    setPlayResult: (r: FakeAudioElement['playResult']) => {
      nextResult = r;
    },
  };
}

/** Audio Session API giả: ghi mọi lần đặt type. */
function apiNav(initial = 'auto', extra: Partial<SessionNavigator> = {}) {
  const log: string[] = [];
  let type = initial;
  const audioSession = {
    get type() {
      return type;
    },
    set type(v: string) {
      type = v;
      log.push(v);
    },
  };
  return { nav: { audioSession, ...extra } as SessionNavigator, log, type: () => type };
}

/** Đọc header WAV từ data: URI. */
function parseWav(uri: string) {
  expect(uri.startsWith('data:audio/wav;base64,')).toBe(true);
  const bin = atob(uri.slice('data:audio/wav;base64,'.length));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  const v = new DataView(bytes.buffer);
  const ascii = (at: number, n: number) => String.fromCharCode(...bytes.subarray(at, at + n));
  return {
    riff: ascii(0, 4),
    riffSize: v.getUint32(4, true),
    wave: ascii(8, 4),
    fmt: ascii(12, 4),
    format: v.getUint16(20, true),
    channels: v.getUint16(22, true),
    rate: v.getUint32(24, true),
    byteRate: v.getUint32(28, true),
    bits: v.getUint16(34, true),
    data: ascii(36, 4),
    dataSize: v.getUint32(40, true),
    samples: bytes.subarray(44),
    total: bytes.length,
  };
}

describe('silentWavDataUri', () => {
  it('WAV PCM 8 bit mono, đúng sample rate, mọi mẫu im lặng (0x80), header khớp độ dài', () => {
    const w = parseWav(silentWavDataUri(48000));
    expect([w.riff, w.wave, w.fmt, w.data]).toEqual(['RIFF', 'WAVE', 'fmt ', 'data']);
    expect(w.format).toBe(1);
    expect(w.channels).toBe(1);
    expect(w.bits).toBe(8);
    expect(w.rate).toBe(48000);
    expect(w.byteRate).toBe(48000);
    expect(w.dataSize).toBe(4800); // 0,1 s
    expect(w.samples.length).toBe(w.dataSize);
    expect(w.riffSize).toBe(w.total - 8);
    expect(w.samples.every((b) => b === 0x80)).toBe(true);
  });

  it('sample rate thiếu / lạ → 44,1 kHz; độ dài tùy chọn', () => {
    expect(parseWav(silentWavDataUri()).rate).toBe(DEFAULT_SILENT_RATE);
    expect(parseWav(silentWavDataUri(Number.NaN)).rate).toBe(DEFAULT_SILENT_RATE);
    expect(parseWav(silentWavDataUri(10)).rate).toBe(DEFAULT_SILENT_RATE);
    expect(parseWav(silentWavDataUri(44100.4)).rate).toBe(44100);
    expect(parseWav(silentWavDataUri(8000, 0.5)).dataSize).toBe(4000);
    expect(parseWav(silentWavDataUri(8000, -1)).dataSize).toBe(800);
  });

  it('số mẫu lẻ (22,05 kHz × 0,1 s = 2205) → làm tròn lên số chẵn: khối "data" không cần byte đệm RIFF (D-426)', () => {
    const w = parseWav(silentWavDataUri(22050));
    expect(w.rate).toBe(22050);
    expect(w.dataSize).toBe(2206);
    expect(w.dataSize % 2).toBe(0);
    expect(w.samples.length).toBe(w.dataSize);
    expect(w.riffSize).toBe(w.total - 8);
    expect(parseWav(silentWavDataUri(44100, 1e-9)).dataSize).toBe(2); // tối thiểu 2 mẫu
  });
});

describe('isAppleTouch', () => {
  it('iPhone / iPad / iPadOS (Macintosh + cảm ứng); không phải Android, máy tính, null', () => {
    expect(isAppleTouch({ userAgent: IPHONE_UA })).toBe(true);
    expect(isAppleTouch({ userAgent: 'Mozilla/5.0 (iPad; CPU OS 16_0 like Mac OS X)' })).toBe(true);
    expect(
      isAppleTouch({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X)', maxTouchPoints: 5 }),
    ).toBe(true);
    expect(
      isAppleTouch({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X)', maxTouchPoints: 0 }),
    ).toBe(false);
    expect(isAppleTouch({ userAgent: ANDROID_UA, maxTouchPoints: 5 })).toBe(false);
    expect(isAppleTouch(null)).toBe(false);
  });
});

describe('PlaybackSession — Audio Session API (Safari 16.4+)', () => {
  it('acquire → type = "playback" (không tạo <audio>); gọi lại không đặt lại; release → "auto"', () => {
    const api = apiNav('auto', { userAgent: IPHONE_UA });
    const { session, made } = env(api.nav);
    expect(session.held).toBe(false);
    expect(session.acquire(48000)).toBe('session-api');
    expect(api.type()).toBe('playback');
    expect(session.held).toBe(true);
    expect(session.mode).toBe('session-api');
    expect(made).toHaveLength(0); // có API thì không cần phần tử im lặng
    session.acquire();
    expect(api.log).toEqual(['playback']);
    session.release();
    expect(api.type()).toBe('auto');
    expect(session.held).toBe(false);
    session.release(); // trả hai lần không đặt gì thêm
    expect(api.log).toEqual(['playback', 'auto']);
  });

  it('có API trên máy không phải Apple (vd. Safari macOS) → vẫn dùng API', () => {
    const api = apiNav('auto', { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X)' });
    const { session } = env(api.nav);
    expect(session.acquire()).toBe('session-api');
    expect(api.type()).toBe('playback');
  });

  it('người khác đã đổi type sau acquire → release không ghi đè', () => {
    const api = apiNav();
    const { session } = env(api.nav);
    session.acquire();
    (api.nav.audioSession as { type: string }).type = 'play-and-record';
    session.release();
    expect(api.type()).toBe('play-and-record');
  });

  it('setter type throw → không throw; máy Apple thì dùng phần tử im lặng', () => {
    const nav = {
      userAgent: IPHONE_UA,
      audioSession: {
        get type() {
          return 'auto';
        },
        set type(_v: string) {
          throw new Error('NotSupportedError');
        },
      },
    } as SessionNavigator;
    const { session, made } = env(nav);
    expect(() => session.acquire()).not.toThrow();
    expect(session.mode).toBe('media-element');
    expect(made).toHaveLength(1);
  });
});

describe('PlaybackSession — iOS cũ: <audio> im lặng lặp', () => {
  it('acquire (trong cú chạm) → một <audio> data: WAV, lặp, không muted, âm lượng ~0, playsinline, không AirPlay; play() ngay', () => {
    const { session, made } = env({ userAgent: IPHONE_UA });
    expect(session.acquire(44100)).toBe('media-element');
    expect(made).toHaveLength(1);
    const el = made[0];
    expect(el.playCalls).toBe(1);
    expect(el.paused).toBe(false);
    expect(el.loop).toBe(true);
    expect(el.muted).toBe(false);
    expect(el.volume).toBe(SILENT_ELEMENT_VOLUME);
    expect(el.volume).toBeLessThanOrEqual(0.01);
    expect(el.preload).toBe('auto');
    expect(el.hasAttribute('playsinline')).toBe(true);
    expect(el.getAttribute('x-webkit-airplay')).toBe('deny');
    expect(parseWav(el.src).rate).toBe(44100); // cùng sample rate với AudioContext
    expect(session.element).toBe(el.asElement());
  });

  it('gọi lại: không tạo phần tử mới; iOS đã dừng nó (sau cuộc gọi) → phát lại', async () => {
    const { session, made } = env({ userAgent: IPHONE_UA });
    session.acquire();
    session.acquire();
    expect(made).toHaveLength(1);
    expect(made[0].playCalls).toBe(1);
    made[0].pause(); // iOS dừng media khi bị gián đoạn
    expect(session.acquire()).toBe('media-element');
    expect(made).toHaveLength(1);
    expect(made[0].playCalls).toBe(2);
    await Promise.resolve();
    expect(session.held).toBe(true);
  });

  it('release → dừng, bỏ nguồn, load() (giải phóng); acquire sau tạo phần tử mới', () => {
    const { session, made } = env({ userAgent: IPHONE_UA });
    session.acquire();
    const el = made[0];
    session.release();
    expect(el.pauseCalls).toBe(1);
    expect(el.paused).toBe(true);
    expect(el.src).toBe('');
    expect(el.hasAttribute('src')).toBe(false);
    expect(el.loadCalls).toBe(1);
    expect(session.held).toBe(false);
    session.acquire();
    expect(made).toHaveLength(2);
  });

  it('play() bị từ chối (không phải gesture) → bỏ phần tử, cú chạm sau thử lại', async () => {
    const t = env({ userAgent: IPHONE_UA });
    t.setPlayResult('reject');
    expect(t.session.acquire()).toBe('media-element');
    await Promise.resolve();
    await Promise.resolve();
    expect(t.session.held).toBe(false);
    expect(t.made[0].pauseCalls).toBe(1);
    t.setPlayResult('resolve');
    t.session.acquire();
    expect(t.made).toHaveLength(2);
    expect(t.session.held).toBe(true);
  });

  it('play() throw đồng bộ → không throw, không giữ', () => {
    const t = env({ userAgent: IPHONE_UA });
    t.setPlayResult('throw');
    expect(() => t.session.acquire()).not.toThrow();
    expect(t.session.held).toBe(false);
  });
});

describe('PlaybackSession — máy khác', () => {
  it('Android / máy tính không có API → không làm gì (âm lượng media quyết định, không có nút gạt)', () => {
    for (const nav of [
      { userAgent: ANDROID_UA, maxTouchPoints: 5 },
      { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', maxTouchPoints: 0 },
      null,
    ]) {
      const { session, made } = env(nav);
      expect(session.acquire(48000)).toBe('none');
      expect(made).toHaveLength(0);
      expect(session.held).toBe(false);
      expect(() => session.release()).not.toThrow();
    }
  });

  it('navigator / createAudio throw → không throw', () => {
    const s = new PlaybackSession({
      navigator: () => {
        throw new Error('x');
      },
    });
    expect(s.acquire()).toBe('none');
    const s2 = new PlaybackSession({
      navigator: () => ({ userAgent: IPHONE_UA }),
      createAudio: () => {
        throw new Error('x');
      },
    });
    expect(s2.acquire()).toBe('none');
    expect(s2.held).toBe(false);
  });
});

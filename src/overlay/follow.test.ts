import { describe, expect, it } from 'vitest';
import type { FollowDisplay, FollowStateMessage } from './follow';
import {
  FOLLOW_CHANNEL,
  FOLLOW_EVENT,
  countdownLeftAt,
  expectedBeatAt,
  followNow,
  newFollowSenderId,
  parseFollowMessage,
  sameFollowDisplay,
  songKeyOf,
} from './follow';

const DISPLAY: FollowDisplay = {
  scheme: 'pc',
  mobileSemitone: 'toggle',
  labels: { left: '', right: '', natural: '', scroll: '' },
  lookahead: 8,
  tileScale: 1,
  subLabel: 'none',
  countIn: true,
  language: 'vi',
  theme: 'dark',
};

function state(patch: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    v: 1,
    from: 'tab-1',
    kind: 'state',
    seq: 3,
    songKey: 'abc-1',
    sentAt: 1_000_000,
    playing: true,
    beat: 4,
    bpm: 120,
    countdownEndsAt: null,
    loop: null,
    display: DISPLAY,
    ...patch,
  };
}

describe('follow contract', () => {
  it('channel / event names are stable (shared with OBS Browser Sources)', () => {
    expect(FOLLOW_CHANNEL).toBe('dfht-follow');
    expect(FOLLOW_EVENT).toBe('dfht-follow');
  });

  it('newFollowSenderId: non-empty, different every call', () => {
    const ids = new Set(Array.from({ length: 20 }, () => newFollowSenderId()));
    expect(ids.size).toBe(20);
    for (const id of ids) expect(id.length).toBeGreaterThan(5);
  });

  it('followNow = đồng hồ hệ thống (epoch ms)', () => {
    const before = Date.now();
    const t = followNow();
    expect(t).toBeGreaterThanOrEqual(before);
    expect(t).toBeLessThanOrEqual(Date.now());
  });
});

describe('parseFollowMessage', () => {
  it('hello / bye / song hợp lệ', () => {
    expect(parseFollowMessage({ v: 1, from: 'o', kind: 'hello' })).toEqual({
      v: 1,
      from: 'o',
      kind: 'hello',
    });
    expect(parseFollowMessage({ v: 1, from: 'p', kind: 'bye', extra: 1 })).toEqual({
      v: 1,
      from: 'p',
      kind: 'bye',
    });
    expect(
      parseFollowMessage({
        v: 1,
        from: 'p',
        kind: 'song',
        songKey: 'k',
        source: '',
        cause: 'tick',
      }),
    ).toEqual({ v: 1, from: 'p', kind: 'song', songKey: 'k', source: '', cause: 'tick' });
  });

  it('state hợp lệ: bản sao mới, trường tùy chọn mặc định (countIn null, hidden false)', () => {
    const raw = state({ loop: { startBeat: 0, endBeat: 8 } });
    const msg = parseFollowMessage(raw);
    expect(msg).toMatchObject({
      kind: 'state',
      seq: 3,
      playing: true,
      beat: 4,
      bpm: 120,
      loop: { startBeat: 0, endBeat: 8 },
      countIn: null,
      hidden: false,
      display: DISPLAY,
    });
    expect(msg).not.toHaveProperty('cause');
    // Không giữ tham chiếu tới dữ liệu gốc.
    if (msg?.kind !== 'state') throw new Error('kind');
    expect(msg.display).not.toBe(raw.display);
    expect(msg.loop).not.toBe(raw.loop);
  });

  it('state: countIn, hidden, cause, countdownEndsAt đọc đúng', () => {
    const msg = parseFollowMessage(
      state({
        beat: -2,
        countIn: { startBeat: -4, endBeat: 0 },
        hidden: true,
        cause: 'reply',
        countdownEndsAt: 1_003_000,
      }),
    );
    expect(msg).toMatchObject({
      countIn: { startBeat: -4, endBeat: 0 },
      hidden: true,
      cause: 'reply',
      countdownEndsAt: 1_003_000,
    });
  });

  it('kẹp số: bpm 20..400, lookahead 4..12, tileScale 0.5..3; tên nút gọn lại', () => {
    const msg = parseFollowMessage(
      state({
        bpm: 9000,
        display: {
          ...DISPLAY,
          lookahead: 50.4,
          tileScale: 0.01,
          labels: { left: ' Trái\nX ', right: 'x'.repeat(40), natural: '', scroll: '' },
        },
      }),
    );
    expect(msg).toMatchObject({
      bpm: 400,
      display: {
        lookahead: 12,
        tileScale: 0.5,
        labels: { left: 'Trái X', right: 'x'.repeat(24), natural: '', scroll: '' },
      },
    });
  });

  it('thiếu countdownEndsAt / loop / countIn (obs_data làm rơi null khi relay qua OBS) = null', () => {
    const raw = state();
    delete raw.countdownEndsAt;
    delete raw.loop;
    delete raw.countIn;
    const msg = parseFollowMessage(raw);
    expect(msg).toMatchObject({ kind: 'state', countdownEndsAt: null, loop: null, countIn: null });
  });

  it.each<[string, unknown]>([
    ['null', null],
    ['chuỗi', 'hello'],
    ['mảng', [1, 2]],
    ['sai version', { v: 2, from: 'p', kind: 'hello' }],
    ['thiếu from', { v: 1, kind: 'hello' }],
    ['from rỗng', { v: 1, from: '', kind: 'hello' }],
    ['kind lạ', { v: 1, from: 'p', kind: 'lyrics' }],
    ['song thiếu source', { v: 1, from: 'p', kind: 'song', songKey: 'k' }],
    ['song songKey rỗng', { v: 1, from: 'p', kind: 'song', songKey: '', source: 'x' }],
    ['song cause lạ', { v: 1, from: 'p', kind: 'song', songKey: 'k', source: 'x', cause: 'x' }],
    ['state seq âm', state({ seq: -1 })],
    ['state sentAt NaN', state({ sentAt: Number.NaN })],
    ['state playing chuỗi', state({ playing: 'yes' })],
    ['state beat Infinity', state({ beat: Infinity })],
    ['state bpm 0', state({ bpm: 0 })],
    ['state countdownEndsAt chuỗi', state({ countdownEndsAt: '3' })],
    ['state loop ngược', state({ loop: { startBeat: 8, endBeat: 4 } })],
    ['state loop thiếu end', state({ loop: { startBeat: 0 } })],
    ['state countIn hỏng', state({ countIn: { startBeat: 0, endBeat: 0 } })],
    ['state hidden số', state({ hidden: 1 })],
    ['state display thiếu', state({ display: undefined })],
    ['state scheme lạ', state({ display: { ...DISPLAY, scheme: 'console' } })],
    ['state theme lạ', state({ display: { ...DISPLAY, theme: 'pink' } })],
    ['state language lạ', state({ display: { ...DISPLAY, language: 'fr' } })],
    ['state subLabel lạ', state({ display: { ...DISPLAY, subLabel: 'lyrics' } })],
    ['state countIn chuỗi', state({ display: { ...DISPLAY, countIn: 'on' } })],
    ['state labels số', state({ display: { ...DISPLAY, labels: { left: 1 } } })],
    ['state lookahead NaN', state({ display: { ...DISPLAY, lookahead: Number.NaN } })],
  ])('dữ liệu lạ → null (%s)', (_name, data) => {
    expect(parseFollowMessage(data)).toBeNull();
  });
});

describe('songKeyOf', () => {
  it('ổn định, khác nhau theo nội dung, có độ dài', () => {
    const a = songKeyOf('@title A\nZ X C');
    expect(songKeyOf('@title A\nZ X C')).toBe(a);
    expect(songKeyOf('@title A\nZ X V')).not.toBe(a);
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-z]+$/);
    expect(songKeyOf('')).toMatch(/^811c9dc5-0$/);
  });
});

describe('expectedBeatAt', () => {
  const s: Pick<FollowStateMessage, 'playing' | 'beat' | 'bpm' | 'sentAt' | 'loop'> = {
    playing: true,
    beat: 4,
    bpm: 120,
    sentAt: 10_000,
    loop: null,
  };

  it('đang phát: beat + Δt · bpm / 60000; trước sentAt đứng yên', () => {
    expect(expectedBeatAt(s, 10_000)).toBe(4);
    expect(expectedBeatAt(s, 11_000)).toBe(6);
    expect(expectedBeatAt(s, 9_000)).toBe(4);
  });

  it('đang dừng: luôn là beat', () => {
    expect(expectedBeatAt({ ...s, playing: false }, 99_000)).toBe(4);
  });

  it('qua loop end → quay về loop start (cả khi trễ nhiều vòng)', () => {
    const loop = { startBeat: 2, endBeat: 6 };
    expect(expectedBeatAt({ ...s, loop }, 11_000)).toBe(2); // 6 → 2
    expect(expectedBeatAt({ ...s, loop }, 11_500)).toBe(3);
    expect(expectedBeatAt({ ...s, loop }, 14_000)).toBe(4); // 12 → 2 + (6 % 4)
    // Đoạn phát đã qua loop end (transport không wrap) → không quay.
    expect(expectedBeatAt({ ...s, beat: 7, loop }, 11_000)).toBe(9);
  });
});

describe('countdownLeftAt', () => {
  it('làm tròn lên theo giây, hết / không có → null', () => {
    expect(countdownLeftAt(null, 0)).toBeNull();
    expect(countdownLeftAt(3000, 0)).toBe(3);
    expect(countdownLeftAt(3000, 1)).toBe(3);
    expect(countdownLeftAt(3000, 1000)).toBe(2);
    expect(countdownLeftAt(3000, 2999)).toBe(1);
    expect(countdownLeftAt(3000, 3000)).toBeNull();
    expect(countdownLeftAt(3000, 5000)).toBeNull();
  });
});

describe('sameFollowDisplay', () => {
  it('so từng trường, kể cả tên nút', () => {
    expect(sameFollowDisplay(DISPLAY, { ...DISPLAY, labels: { ...DISPLAY.labels } })).toBe(true);
    expect(sameFollowDisplay(DISPLAY, { ...DISPLAY, theme: 'light' })).toBe(false);
    expect(
      sameFollowDisplay(DISPLAY, { ...DISPLAY, labels: { ...DISPLAY.labels, scroll: 'Thăng' } }),
    ).toBe(false);
  });
});

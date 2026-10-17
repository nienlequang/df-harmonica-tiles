import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { collectErrors, stubClipboard } from './helpers';

/**
 * Âm thanh trên điện thoại (D-421 – D-424), bản build, tiếng Việt. Một script chạy trước app đếm mọi AudioContext
 * tạo ra, mọi lần `createOscillator` (nốt của synth), mọi `<audio>.play()`, và — khi cần — cài
 * `navigator.audioSession` giả (Audio Session API của Safari 16.4+; Edge không có) ghi mọi lần đặt `type`.
 *
 * A. Mặc định im lặng: tải màn chơi, Phát, Luyện tập, Cài đặt — không AudioContext, không `<audio>`, không đổi phiên.
 * B. Nút loa (tên cố định "Tiếng giai điệu" + aria-pressed, tooltip = việc sẽ làm): "Tôi hiểu, bật" → context chạy
 *    NGAY trong cú bấm + phiên "playback"; Phát → nốt lên lịch; tắt → "auto"; bật lại rồi rời màn chơi → "auto".
 * C. iPhone không có Audio Session API (UA iPhone, cảm ứng): `<audio>` im lặng lặp (data: WAV) phát trong cú chạm
 *    "Tôi hiểu, bật"; tắt → dừng + bỏ nguồn. (Safari thật — nút gạt im lặng — chỉ kiểm được trên máy: checklist.)
 * D. Android Chrome (giả lập cảm ứng 844×390, UA Android): chạm Phát → context 'running' + giai điệu lên lịch;
 *    Luyện tập + "Phát tiếng khi bấm": chạm nút số → tiếng phản hồi lên lịch; không `<audio>`, không đổi phiên, không
 *    lỗi console. Android: âm lượng media quyết định Web Audio — không có chuyện nút gạt im lặng.
 * E. Tự chơi để tạo bài (UA iPhone + Audio Session API giả, D-426): tải trang không đụng gì; bật "Tiếng phản hồi khi
 *    bấm" → "playback"; tắt → "auto"; bật rồi rời màn → "auto".
 */

const QUOC_CA = { id: 'seed-quoc-ca-viet-nam', title: 'Quốc ca Việt Nam' } as const;
const TAKE = { id: 'seed-takediskrush', title: 'TAKEDISKRUSH!' } as const;
const DIALOG = 'Bật phát giai điệu mẫu?';
const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 15_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.6 Mobile/15E148 Safari/604.1';
const ANDROID_UA =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36';

/** Kết quả đọc từ script đo. */
interface AudioProbe {
  /** `state` của từng AudioContext đã tạo. */
  contexts: string[];
  oscillators: number;
  media: { src: string; loop: boolean; muted: boolean; paused: boolean; inPage: boolean }[];
  /** Mọi giá trị đã đặt vào `navigator.audioSession.type` (khi có API giả). */
  session: string[];
  /** `navigator.audioSession.type` hiện tại (null = không có API). */
  type: string | null;
}

interface ProbeStore {
  contexts: AudioContext[];
  oscillators: number;
  media: HTMLMediaElement[];
  session: string[];
}

test.beforeEach(async ({ context }) => {
  await stubClipboard(context);
});

/** Cài script đo trước khi app chạy (mọi lần tải trang). */
async function instrumentAudio(page: Page, opts: { audioSession?: boolean } = {}): Promise<void> {
  await page.addInitScript((o) => {
    const store: ProbeStore = { contexts: [], oscillators: 0, media: [], session: [] };
    (window as unknown as { __audioProbe: ProbeStore }).__audioProbe = store;
    const Orig = window.AudioContext;
    if (typeof Orig === 'function') {
      class Tracked extends Orig {
        constructor(options?: AudioContextOptions) {
          super(options);
          store.contexts.push(this);
        }
      }
      window.AudioContext = Tracked;
      const create = Orig.prototype.createOscillator;
      Orig.prototype.createOscillator = function (this: AudioContext): OscillatorNode {
        store.oscillators++;
        return create.call(this);
      };
    }
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function (this: HTMLMediaElement): Promise<void> {
      store.media.push(this);
      return play.call(this);
    };
    if (o.audioSession) {
      let type = 'auto';
      Object.defineProperty(navigator, 'audioSession', {
        configurable: true,
        value: {
          get type() {
            return type;
          },
          set type(v: string) {
            type = v;
            store.session.push(v);
          },
        },
      });
    }
  }, opts);
}

async function probe(page: Page): Promise<AudioProbe> {
  return page.evaluate(() => {
    const s = (window as unknown as { __audioProbe: ProbeStore }).__audioProbe;
    const api = (navigator as unknown as { audioSession?: { type: string } }).audioSession;
    return {
      contexts: s.contexts.map((c) => c.state as string),
      oscillators: s.oscillators,
      media: s.media.map((m) => ({
        src: m.getAttribute('src') ?? '',
        loop: m.loop,
        muted: m.muted,
        paused: m.paused,
        inPage: m.isConnected,
      })),
      session: [...s.session],
      type: api ? api.type : null,
    };
  });
}

/** Cài đặt đặt trước khi app chạy (một lần mỗi tab — tải lại / chuyển trang không ghi đè). */
async function presetSettings(page: Page, state: Record<string, unknown>): Promise<void> {
  await page.addInitScript((s) => {
    if (sessionStorage.getItem('audio-mobile-init')) return;
    sessionStorage.setItem('audio-mobile-init', '1');
    localStorage.setItem('dfht-settings', JSON.stringify({ state: s, version: 5 }));
  }, state);
}

const transport = (page: Page) => page.getByRole('group', { name: 'Điều khiển phát' });
/** Nút loa: tên đọc cố định (D-424). */
const soundButton = (page: Page) =>
  transport(page).getByRole('button', { name: 'Tiếng giai điệu' });
const playButton = (page: Page) => page.locator('button.transport-play');

async function openPlayer(page: Page, song: { id: string; title: string }): Promise<void> {
  await page.goto(`/#/play/${song.id}`);
  await expect(page.getByRole('heading', { level: 1, name: song.title })).toBeVisible();
}

test('A. mặc định im lặng: màn đầu, Phát, Luyện tập, Cài đặt — không AudioContext, không <audio>, không đổi phiên', async ({
  page,
}) => {
  const errors = collectErrors(page);
  await instrumentAudio(page, { audioSession: true });
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: QUOC_CA.title })).toBeVisible();
  // Thời gian rảnh sau khi vẽ (lúc app tạo sẵn AudioContext nếu âm thanh bật) đã qua.
  await page.waitForTimeout(800);
  await playButton(page).click();
  await expect(page.locator('.player-countdown')).toBeVisible();
  await playButton(page).click(); // hủy đếm ngược
  await page.getByRole('button', { name: 'Luyện tập', exact: true }).click();
  await page.locator('canvas.player-canvas').click();
  await page.keyboard.press('KeyZ');
  await page.goto('/#/settings');
  await expect(page.getByRole('region', { name: 'Âm thanh' })).toBeVisible();
  const p = await probe(page);
  expect(p.contexts).toEqual([]);
  expect(p.oscillators).toBe(0);
  expect(p.media).toEqual([]);
  expect(p.session).toEqual([]);
  expect(p.type).toBe('auto');
  expect(errors).toEqual([]);
});

test('B. nút loa: "Tôi hiểu, bật" mở khóa ngay trong cú bấm + phiên "playback"; Phát có nốt; tắt / rời màn chơi → "auto"', async ({
  page,
}) => {
  const errors = collectErrors(page);
  await instrumentAudio(page, { audioSession: true });
  await presetSettings(page, { startDelaySec: 0, countIn: false });
  await openPlayer(page, TAKE);
  const btn = soundButton(page);
  await expect(btn).toHaveAccessibleName('Tiếng giai điệu');
  await expect(btn).toHaveAttribute('aria-pressed', 'false');
  await expect(btn).toHaveAttribute('title', 'Bật tiếng giai điệu');
  expect((await probe(page)).contexts).toEqual([]);

  await btn.click();
  const dialog = page.getByRole('dialog', { name: DIALOG });
  await dialog.getByRole('button', { name: 'Tôi hiểu, bật' }).click();
  await expect(dialog).toBeHidden();
  await expect(btn).toHaveAttribute('aria-pressed', 'true');
  await expect(btn).toHaveAccessibleName('Tiếng giai điệu');
  await expect(btn).toHaveAttribute('title', 'Tắt tiếng');
  // Mở khóa ngay trong cú bấm "Tôi hiểu, bật" — chưa bấm Phát.
  await expect.poll(async () => (await probe(page)).contexts).toEqual(['running']);
  expect((await probe(page)).type).toBe('playback');

  await playButton(page).click();
  await expect(playButton(page)).toHaveAttribute('data-playing', 'true');
  await expect
    .poll(async () => (await probe(page)).oscillators, { timeout: 15_000 })
    .toBeGreaterThan(0);
  await playButton(page).click();

  // Tắt (giai điệu + click đều tắt) → trả phiên.
  await btn.click();
  await expect(btn).toHaveAttribute('aria-pressed', 'false');
  expect((await probe(page)).type).toBe('auto');

  // Bật lại rồi rời màn chơi → trả phiên.
  await btn.click();
  await dialog.getByRole('button', { name: 'Tôi hiểu, bật' }).click();
  await expect.poll(async () => (await probe(page)).type).toBe('playback');
  await page.goto('/#/library');
  await expect(page.getByRole('heading', { level: 1, name: 'Thư viện' })).toBeVisible();
  const p = await probe(page);
  expect(p.type).toBe('auto');
  expect(p.session).toEqual(['playback', 'auto', 'playback', 'auto']);
  expect(p.media).toEqual([]); // có API → không cần <audio> im lặng
  expect(p.contexts).toHaveLength(1);
  expect(errors).toEqual([]);
});

test.describe('C. iPhone không có Audio Session API (UA iPhone, cảm ứng)', () => {
  test.use({
    userAgent: IPHONE_UA,
    viewport: { width: 844, height: 390 },
    hasTouch: true,
    isMobile: true,
  });

  test('<audio> im lặng lặp (data: WAV) phát trong cú chạm "Tôi hiểu, bật"; tắt → dừng + bỏ nguồn', async ({
    page,
  }) => {
    const errors = collectErrors(page);
    await instrumentAudio(page);
    await presetSettings(page, { controlScheme: 'mobile', startDelaySec: 0 });
    await openPlayer(page, TAKE);
    const btn = soundButton(page);
    await btn.scrollIntoViewIfNeeded();
    await btn.tap();
    await page
      .getByRole('dialog', { name: DIALOG })
      .getByRole('button', { name: 'Tôi hiểu, bật' })
      .tap();
    await expect(btn).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(async () => (await probe(page)).media.length).toBe(1);
    await expect.poll(async () => (await probe(page)).media[0].paused).toBe(false);
    let p = await probe(page);
    expect(p.type).toBeNull();
    expect(p.media[0].src.startsWith('data:audio/wav;base64,')).toBe(true);
    expect(p.media[0].loop).toBe(true);
    expect(p.media[0].muted).toBe(false);
    expect(p.media[0].inPage).toBe(false);
    await expect.poll(async () => (await probe(page)).contexts).toEqual(['running']);

    await btn.tap(); // tắt
    await expect(btn).toHaveAttribute('aria-pressed', 'false');
    p = await probe(page);
    expect(p.media).toHaveLength(1);
    expect(p.media[0].paused).toBe(true);
    expect(p.media[0].src).toBe('');
    expect(errors).toEqual([]);
  });
});

test.describe('D. Android Chrome (giả lập cảm ứng 844×390)', () => {
  test.use({
    userAgent: ANDROID_UA,
    viewport: { width: 844, height: 390 },
    hasTouch: true,
    isMobile: true,
  });

  test('chạm Phát → context running + giai điệu lên lịch; Luyện tập + tiếng khi bấm: chạm nút số → tiếng phản hồi; không <audio>, không lỗi', async ({
    page,
  }) => {
    const errors = collectErrors(page);
    await instrumentAudio(page);
    await presetSettings(page, {
      controlScheme: 'mobile',
      audioEnabled: true,
      practiceFeedback: true,
      startDelaySec: 0,
      countIn: false,
    });
    await openPlayer(page, TAKE);
    // Mở thẳng link (chưa có cú chạm nào) → chưa tạo AudioContext.
    await page.waitForTimeout(500);
    expect((await probe(page)).contexts).toEqual([]);

    const play = transport(page).getByRole('button', { name: 'Phát', exact: true });
    await play.tap();
    await expect.poll(async () => (await probe(page)).contexts).toEqual(['running']);
    await expect
      .poll(async () => (await probe(page)).oscillators, { timeout: 15_000 })
      .toBeGreaterThan(0);
    await transport(page).getByRole('button', { name: 'Tạm dừng', exact: true }).tap();
    await expect(playButton(page)).toHaveAttribute('data-playing', 'false');

    await transport(page).getByRole('button', { name: 'Luyện tập', exact: true }).tap();
    const before = (await probe(page)).oscillators;
    const pad = page.getByRole('group', { name: 'Gợi ý phím như trong game' });
    await pad.locator('.mpad-digit').first().tap();
    await expect.poll(async () => (await probe(page)).oscillators).toBeGreaterThan(before);
    await pad.locator('.mpad-digit').nth(3).tap();

    const p = await probe(page);
    expect(p.contexts).toEqual(['running']);
    expect(p.media).toEqual([]); // Android: không <audio> im lặng
    expect(p.type).toBeNull();
    expect(errors).toEqual([]);
  });
});

test.describe('E. Tự chơi để tạo bài trên iPhone (D-426)', () => {
  test.use({
    userAgent: IPHONE_UA,
    viewport: { width: 844, height: 390 },
    hasTouch: true,
    isMobile: true,
  });

  test('tải trang không đụng gì; bật tiếng phản hồi → phiên "playback"; tắt → "auto"; bật rồi rời màn → "auto"', async ({
    page,
  }) => {
    const errors = collectErrors(page);
    await instrumentAudio(page, { audioSession: true });
    await page.goto('/#/record');
    await expect(page.getByRole('heading', { level: 1, name: 'Tự chơi để tạo bài' })).toBeVisible();
    let p = await probe(page);
    expect(p.contexts).toEqual([]);
    expect(p.session).toEqual([]);
    const feedback = page.getByRole('switch', { name: 'Tiếng phản hồi khi bấm' });
    await feedback.tap();
    await expect.poll(async () => (await probe(page)).type).toBe('playback');
    await expect.poll(async () => (await probe(page)).contexts).toEqual(['running']);
    await feedback.tap();
    expect((await probe(page)).type).toBe('auto');
    await feedback.tap();
    await expect.poll(async () => (await probe(page)).type).toBe('playback');
    await page.goto('/#/library');
    await expect(page.getByRole('heading', { level: 1, name: 'Thư viện' })).toBeVisible();
    p = await probe(page);
    expect(p.type).toBe('auto');
    expect(p.session).toEqual(['playback', 'auto', 'playback', 'auto']);
    expect(p.media).toEqual([]); // có API → không cần <audio> im lặng
    expect(errors).toEqual([]);
  });
});

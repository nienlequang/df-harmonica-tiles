import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { attributes, direction, measure, n, singlePart } from '../src/midi/testing/musicxml';
import { collectErrors, readClipboard, stubClipboard } from './helpers';

/**
 * Smoke Phase 2c (thay đổi người dùng yêu cầu, đầu docs/SPEC.md): âm thanh mặc định tắt + hộp thoại
 * bản quyền, kiểu điều khiển Mobile trong Player, nút Chia sẻ ở Thư viện, MusicXML trong wizard
 * "Tạo bài từ file", nút Kiểu điều khiển PC | Mobile ở thanh dọc của màn chơi. Chạy trên bản build, settings
 * mặc định.
 */

const SEED1 = { id: 'seed-quoc-ca-viet-nam', title: 'Quốc ca Việt Nam' } as const;
/**
 * Đoạn của SEED1 mà cả dòng đầu là Ngẩng Lên (dòng 4 = đầu "Phần 2"; src/player/mobilePlan.test.ts ghim): game vẫn
 * đang Ngẩng Tự Nhiên → phải chạm Ngẩng Lên trước nốt đầu.
 */
const UP_SECTION = { name: 'Phần 2', line: 4 } as const;

test.beforeEach(async ({ context }) => {
  await stubClipboard(context);
});

/** Bản nhạc 2 ô nhịp, bè hát có <lyric>, tempo 90 (C5..A5 → optimizer hạ 1 quãng vào tầm thường). */
function scoreFixture(): string {
  const words = ['Một', 'hai', 'ba', 'bốn', 'năm', 'sáu', 'bảy', 'tám'];
  const pitches = ['C5', 'D5', 'E5', 'G5', 'A5', 'G5', 'E5', 'D5'];
  const notes = pitches.map((p, i) => n(p, 1, { lyric: words[i] }));
  return singlePart(
    [
      measure(
        attributes({ divisions: 1, time: [4, 4] }) +
          direction({ soundTempo: 90 }) +
          notes.slice(0, 4).join(''),
      ),
      measure(notes.slice(4).join('')),
    ],
    { title: 'Thử MusicXML', composer: 'Tác giả' },
  );
}

/** Thẻ "Âm thanh" của Cài đặt hiện sẵn (không còn mục "Nâng cao" thu gọn — góp ý 2026-10-16). */
async function openSoundSettings(page: Page): Promise<void> {
  await page.goto('/#/settings');
  await expect(page.getByRole('region', { name: 'Âm thanh' })).toBeVisible();
}

test('âm thanh: mặc định tắt, thanh điều khiển chỉ có nút loa (không metronome); bật giai điệu phải qua hộp thoại bản quyền', async ({
  page,
}) => {
  const errors = collectErrors(page);
  await page.goto(`/#/play/${SEED1.id}`);
  await expect(page.getByRole('heading', { level: 1, name: SEED1.title })).toBeVisible();
  const transport = page.getByRole('group', { name: 'Điều khiển phát' });
  await expect(transport.getByRole('button', { name: /âm thanh|metronome/i })).toHaveCount(0);
  // Nút loa (bổ sung trước deploy, D-392) mặc định tắt tiếng — luồng đầy đủ ở e2e/predeploy.spec.ts.
  await expect(transport.getByRole('button', { name: 'Tiếng giai điệu' })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  await expect(page.getByText('🔊 Đang phát giai điệu')).toHaveCount(0);

  await openSoundSettings(page);
  const melody = page.getByRole('switch', { name: 'Phát giai điệu mẫu' });
  await expect(melody).not.toBeChecked();
  // Hủy → vẫn tắt, focus về switch.
  await melody.click();
  const dialog = page.getByRole('dialog', { name: 'Bật phát giai điệu mẫu?' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Hủy' }).click();
  await expect(dialog).toBeHidden();
  await expect(melody).not.toBeChecked();
  await expect(melody).toBeFocused();
  // Xác nhận → bật, Player hiện huy hiệu đỏ.
  await melody.click();
  await page.getByRole('button', { name: 'Tôi hiểu, bật' }).click();
  await expect(melody).toBeChecked();
  await page.goto(`/#/play/${SEED1.id}`);
  await expect(page.getByText('🔊 Đang phát giai điệu')).toBeVisible();
  expect(errors).toEqual([]);
});

test('Mobile: game bar số giản phổ + nút chế độ, banner chế độ; đoạn Ngẩng Lên của seed 1', async ({
  page,
}) => {
  const errors = collectErrors(page);
  await page.goto('/#/settings');
  await page.getByRole('radio', { name: 'Mobile (nút cảm ứng)' }).check();
  await page.goto(`/#/play/${SEED1.id}`);
  const modes = page.getByRole('group', { name: 'Nút chế độ như trong game mobile' });
  await expect(modes).toBeVisible();
  await expect(page.getByRole('group', { name: 'Nút nốt như trong game mobile' })).toBeVisible();
  const banner = page.getByRole('group', { name: 'Chế độ đang chọn' });
  await expect(banner).toContainText('CHẾ ĐỘ: Ngẩng Tự Nhiên · Nửa Cung: TẮT');

  await page.getByLabel('Nhảy tới đoạn').selectOption({ label: UP_SECTION.name });
  // Nhảy tới đoạn Ngẩng Lên: game vẫn giữ chế độ đang bật (Ngẩng Tự Nhiên) → banner ghi chế độ đang giữ và nhắc chạm
  // Ngẩng Lên ở nốt đầu (cue "vào lại", D-263).
  await expect(banner).toContainText('CHẾ ĐỘ: Ngẩng Tự Nhiên');
  await expect(banner).toContainText('SẮP CHẠM: Ngẩng Lên');
  await page.keyboard.press('Space');
  // Qua đếm vào + nốt đầu (đã chạm) → Ngẩng Lên.
  await expect(banner).toContainText('CHẾ ĐỘ: Ngẩng Lên');
  await page.keyboard.press('Space');
  // Chế độ giữ khi tạm dừng: vẫn Ngẩng Lên.
  await expect(banner).toContainText('CHẾ ĐỘ: Ngẩng Lên');
  expect(errors).toEqual([]);
});

test('Thư viện: "Chia sẻ" sao chép link #/s/… mở thẳng bài và phát được', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/#/library');
  await page.getByRole('button', { name: `Chia sẻ "${SEED1.title}" (sao chép link)` }).click();
  await expect(page.getByText(/Đã sao chép link chia sẻ/)).toBeVisible();
  const url = await readClipboard(page);
  expect(url).toMatch(/#\/s\/\S+$/);
  await page.goto(url);
  await expect(page.getByRole('heading', { level: 1, name: SEED1.title })).toBeVisible();
  await page.keyboard.press('Space');
  await page.waitForTimeout(1500);
  expect(errors).toEqual([]);
});

test('MusicXML: file .musicxml → 5 bước (bè hát được gợi ý) → Editor 0 lỗi, không lời', async ({
  page,
}) => {
  const errors = collectErrors(page);
  await page.goto('/#/midi');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Chọn file MIDI / MusicXML' }).click();
  await (
    await chooser
  ).setFiles({
    name: 'thu.musicxml',
    mimeType: 'application/vnd.recordare.musicxml+xml',
    buffer: Buffer.from(scoreFixture()),
  });
  const step = (name: string) => page.getByRole('heading', { level: 2, name });
  await expect(step('Chọn bè và giọng')).toBeVisible();
  await expect(page.getByText('8 nốt · tầm C5–A5', { exact: true })).toBeVisible();
  // mỗi bè ghi mật độ nốt so với tempo (cơ sở của gợi ý): 8 nốt / 8 beat ở 90 BPM
  await expect(page.getByText('≈ 90 nốt/phút · BPM 90', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Tiếp' }).click();
  await expect(step('Trích melody')).toBeVisible();
  await expect(page.getByRole('spinbutton', { name: 'Tempo (BPM)' })).toHaveValue('90');
  await page.getByRole('button', { name: 'Tiếp' }).click();
  await expect(step('Chọn cung và quãng')).toBeVisible();
  await page.getByRole('button', { name: 'Tiếp' }).click();
  await expect(step('Xem trước và tạo bài')).toBeVisible();
  await expect(page.getByLabel('Tên bài')).toHaveValue('Thử MusicXML');
  const preview = page.getByLabel('Xem trước .harm');
  await expect(preview).toContainText('@title Thử MusicXML');
  await expect(preview).not.toContainText('Một hai ba bốn');
  // mở dạng bản nháp (chưa vào thư viện cho tới khi Lưu)
  await page.getByRole('button', { name: 'Mở trong Editor' }).click();
  await expect(page).toHaveURL(/#\/edit\/draft-[^/]+$/);
  await expect(page.locator('.editor-preview [data-stat="notes"]')).toHaveText('8');
  await expect(page.locator('.editor-preview .pv-diag.is-error')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('màn chơi: nút Kiểu điều khiển PC | Mobile ở thanh dọc đổi bố cục ngay, cùng store với Cài đặt', async ({
  page,
}) => {
  const errors = collectErrors(page);
  await page.goto('/');
  const scheme = page
    .getByRole('complementary', { name: 'Công cụ màn chơi' })
    .getByRole('group', { name: 'Kiểu điều khiển' });
  const pc = scheme.getByRole('button', { name: 'PC', exact: true });
  const mobile = scheme.getByRole('button', { name: 'Mobile', exact: true });
  await expect(pc).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.game-bar')).toHaveCount(1);
  await mobile.click();
  await expect(mobile).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.game-bar')).toHaveCount(0);
  await expect(page.getByRole('group', { name: 'Nút nốt như trong game mobile' })).toBeVisible();
  // Cài đặt đọc cùng giá trị.
  await page.goto('/#/settings');
  await expect(page.getByRole('radio', { name: 'Mobile (nút cảm ứng)' })).toBeChecked();
  expect(errors).toEqual([]);
});

test.describe('Mobile kiểu game trên điện thoại ngang (Phase 4m)', () => {
  test.use({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true });

  test('bàn nút thẳng 8 lane; Luyện tập: chạm Ngẩng Lên rồi chạm nốt → PERFECT', async ({
    page,
  }) => {
    const errors = collectErrors(page);
    await page.addInitScript(() => {
      if (sessionStorage.getItem('p4m-init')) return;
      sessionStorage.setItem('p4m-init', '1');
      localStorage.setItem(
        'dfht-settings',
        JSON.stringify({ state: { controlScheme: 'mobile', language: 'vi' }, version: 3 }),
      );
    });
    // Dòng đầu đoạn Ngẩng Lên, game vẫn đang Ngẩng Tự Nhiên → phải chạm Ngẩng Lên trước.
    await page.goto(`/#/play/${SEED1.id}?line=${UP_SECTION.line}`);
    const pad = page.getByRole('group', { name: 'Gợi ý phím như trong game' });
    await expect(pad).toHaveAttribute('data-scheme', 'mobile');
    await expect(page.locator('.game-bar')).toHaveCount(0);
    // Tâm 8 nút tròn = tâm 8 lane của canvas (cùng padGeometry).
    const offsets = await page.evaluate(() => {
      const c = document.querySelector('canvas.player-canvas')!.getBoundingClientRect();
      return [...document.querySelectorAll('.mpad-digit .mpad-circle')].map((el, i) => {
        const r = el.getBoundingClientRect();
        return Math.abs(r.left + r.width / 2 - (c.left + ((i + 0.5) * c.width) / 8));
      });
    });
    expect(offsets).toHaveLength(8);
    for (const d of offsets) expect(d).toBeLessThan(1.5);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      844,
    );

    await page.getByRole('button', { name: 'Luyện tập' }).click();
    await page.getByRole('button', { name: 'Chờ', exact: true }).click();
    await page
      .getByRole('group', { name: 'Điều khiển phát' })
      .getByRole('button', { name: 'Phát', exact: true })
      .click();
    await expect(page.getByText('Đang chờ bạn bấm nốt có viền vàng…')).toBeVisible({
      timeout: 15_000,
    });
    const upMode = pad.getByRole('button', { name: 'Ngẩng Lên' });
    await expect(upMode).toHaveClass(/is-cue/);
    await upMode.tap();
    await expect(upMode).toHaveAttribute('aria-pressed', 'true');
    await pad.locator('.mpad-digit.is-active').tap();
    await expect(page.locator('.practice-stat-perfect dd')).toHaveText('1');
    await expect(page.locator('.practice-stat-wrong dd')).toHaveText('0');
    await expect(pad.locator('.mpad-pop')).toHaveText('PERFECT');
    expect(errors).toEqual([]);
  });

  test.describe('giảm chuyển động (Android "Xóa hiệu ứng")', () => {
    test.use({ reducedMotion: 'reduce' });

    test('đúng nốt sai chế độ → SAI CHẾ ĐỘ + vòng nút cần chạm; mọi hiệu ứng mờ dần rồi tắt', async ({
      page,
    }) => {
      const errors = collectErrors(page);
      await page.addInitScript(() => {
        if (sessionStorage.getItem('p4m-rm')) return;
        sessionStorage.setItem('p4m-rm', '1');
        localStorage.setItem(
          'dfht-settings',
          JSON.stringify({ state: { controlScheme: 'mobile', language: 'vi' }, version: 3 }),
        );
      });
      await page.goto(`/#/play/${SEED1.id}?line=${UP_SECTION.line}`);
      expect(
        await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches),
      ).toBe(true);
      const pad = page.getByRole('group', { name: 'Gợi ý phím như trong game' });
      await page.getByRole('button', { name: 'Luyện tập' }).click();
      await page.getByRole('button', { name: 'Chờ', exact: true }).click();
      await expect(page.locator('.practice-status')).toHaveText(
        'Chờ: bài dừng ở mỗi nốt tới khi bạn chạm đúng nút chế độ rồi chạm nốt.',
      );
      await page
        .getByRole('group', { name: 'Điều khiển phát' })
        .getByRole('button', { name: 'Phát', exact: true })
        .click();
      await expect(page.getByText('Đang chờ bạn bấm nốt có viền vàng…')).toBeVisible({
        timeout: 15_000,
      });
      // Chưa chạm Ngẩng Lên: đúng nốt, sai chế độ.
      await pad.locator('.mpad-digit.is-active').tap();
      const pop = pad.locator('.mpad-pop');
      await expect(pop).toHaveText('SAI CHẾ ĐỘ');
      const need = pad.locator('.mpad-need-ring');
      await expect(need).toHaveCount(1);
      // Animation mờ dần vẫn chạy (luật toàn cục `animation: none !important` không thắng).
      const anim = (sel: string) =>
        pad
          .locator(sel)
          .first()
          .evaluate((el) => getComputedStyle(el).animationName);
      expect(await anim('.mpad-pop')).toBe('mpad-fade');
      expect(await anim('.mpad-need-ring')).toBe('mpad-fade');
      await pad.getByRole('button', { name: 'Ngẩng Lên' }).tap();
      await pad.locator('.mpad-digit.is-active').tap();
      await expect(pad.locator('.mpad-pop', { hasText: 'PERFECT' })).toHaveCount(1);
      await expect(pad.locator('.mpad-spark')).toHaveCount(1);
      expect(await anim('.mpad-spark')).toBe('mpad-fade');
      // Không còn gì đứng yên trên bàn nút.
      await expect(pad.locator('.mpad-pop, .mpad-spark, .mpad-need-ring')).toHaveCount(0, {
        timeout: 3000,
      });
      expect(errors).toEqual([]);
    });
  });
});

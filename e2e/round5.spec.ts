import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { writeSmf } from '../src/midi/testing/smf';
import type { SmfSpec } from '../src/midi/testing/smf';
import { collectErrors, stubClipboard } from './helpers';

/**
 * Góp ý 2026-10-15 (round 5): bản nháp "tự gõ từ đầu" (trước: "Tạo bài mới thủ công") / "Tạo bài từ file" chỉ vào Thư viện khi
 * người dùng sửa + Lưu; wizard MIDI không còn ô gộp nốt / chia dòng và gợi ý track theo mật độ nốt so với
 * BPM; Cài đặt mặc định (đếm ngược 3 s, nhãn phụ ẩn, không chiều Nửa Cung); hộp thoại OBS chỉ còn tùy chọn
 * hiển thị; không còn giao diện lời bài hát. Chạy trên bản build, settings mặc định (tiếng Việt).
 */

const SEED = { id: 'seed-takediskrush', title: 'TAKEDISKRUSH!' } as const;

test.beforeEach(async ({ context }) => {
  await stubClipboard(context);
});

/** Số bài mẫu: 2 bài của người dùng (góp ý 2026-10-16); hai bài mẫu cũ đã bỏ trước khi deploy (vòng 7). */
const SEED_COUNT = 2;

function songCards(page: Page) {
  return page.getByRole('list', { name: 'Danh sách bài hát' }).locator(':scope > li');
}

/**
 * Bản nháp trống (cách thủ công, góp ý 2026-10-16): Thư viện → "Tạo bài với AI" → "hoặc tự gõ từ đầu"
 * (trước là nút "Tạo bài mới thủ công" ở Thư viện).
 */
async function openBlankDraft(page: Page): Promise<void> {
  await page.getByRole('link', { name: 'Tạo bài với AI' }).click();
  await expect(page).toHaveURL(/#\/ai$/);
  await page.getByRole('button', { name: 'hoặc tự gõ từ đầu' }).click();
}

test('"hoặc tự gõ từ đầu" là bản nháp: rời trang khi chưa sửa → không lưu; sửa + Ctrl+S → vào Thư viện', async ({
  page,
}) => {
  const errors = collectErrors(page);
  await page.goto('/#/library');
  await expect(songCards(page)).toHaveCount(SEED_COUNT);

  await openBlankDraft(page);
  await expect(page).toHaveURL(/#\/edit\/draft-[^/]+$/);
  await expect(page.getByText('Bản nháp — chưa lưu', { exact: true })).toBeVisible();
  // Rời trang khi chưa sửa gì: không hỏi, không lưu.
  await page
    .getByRole('navigation', { name: 'Điều hướng chính' })
    .getByRole('link', { name: 'Thư viện' })
    .click();
  await expect(page).toHaveURL(/#\/library$/);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(songCards(page)).toHaveCount(SEED_COUNT);
  await page.reload();
  await expect(songCards(page)).toHaveCount(SEED_COUNT);

  // Sửa → Ctrl+S → bài thư viện thật (URL đổi sang id thật).
  await openBlankDraft(page);
  await expect(page).toHaveURL(/#\/edit\/draft-[^/]+$/);
  const source = page.getByLabel('Nội dung bài (.harm)');
  await source.fill('@title Bài nháp e2e\n@bpm 100\n# Main\nZ X C V\nB N M ,\n');
  await expect(page.locator('.editor-status')).toHaveText(/Chưa lưu$/);
  await source.press('Control+s');
  await expect(page.getByText('Đã lưu mọi thay đổi')).toBeVisible();
  await expect(page).toHaveURL(/#\/edit\/(?!seed-|draft-)[^/]+$/);
  // Lưu rồi rời trang: không hỏi; thư viện có thêm đúng 1 bài.
  await page
    .getByRole('navigation', { name: 'Điều hướng chính' })
    .getByRole('link', { name: 'Thư viện' })
    .click();
  await expect(page).toHaveURL(/#\/library$/);
  await expect(songCards(page)).toHaveCount(SEED_COUNT + 1);
  await expect(songCards(page).filter({ hasText: 'Bài nháp e2e' })).toHaveCount(1);
  expect(errors).toEqual([]);
});

/**
 * MIDI 3 track cùng 16 beat ở 100 BPM: "Flute" (giai điệu, 1 nốt / beat), "Piano" (hợp âm 3 nốt mỗi móc
 * đơn — NHIỀU nốt nhất, 6 nốt / beat) và "Cello" (bass 1 nốt / beat nhưng âm vực trầm). Tên track không
 * gợi ý gì: gợi ý phải đến từ mật độ nốt so với BPM.
 */
function chordalSpec(): SmfSpec {
  const PPQ = 480;
  const melody = [72, 74, 76, 77, 79, 81, 83, 84, 84, 83, 81, 79, 77, 76, 74, 72];
  const chords = [
    [48, 52, 55],
    [53, 57, 60],
    [55, 59, 62],
    [48, 52, 55],
  ];
  const piano = Array.from({ length: 32 }, (_, i) => i).flatMap((i) =>
    (chords[Math.floor(i / 8)] ?? chords[0]!).map((midi) => ({
      tick: (i * PPQ) / 2,
      type: 'note' as const,
      midi,
      duration: PPQ / 2,
      channel: 1,
    })),
  );
  return {
    format: 1,
    ppq: PPQ,
    tracks: [
      {
        name: 'Conductor',
        events: [
          { tick: 0, type: 'tempo', bpm: 100 },
          { tick: 0, type: 'timeSig', num: 4, den: 4 },
        ],
      },
      {
        name: 'Piano',
        events: piano,
      },
      {
        name: 'Flute',
        events: melody.map((midi, i) => ({
          tick: i * PPQ,
          type: 'note' as const,
          midi,
          duration: PPQ,
          channel: 0,
        })),
      },
      {
        name: 'Cello',
        events: Array.from({ length: 16 }, (_, i) => ({
          tick: i * PPQ,
          type: 'note' as const,
          midi: i % 2 === 0 ? 36 : 43,
          duration: PPQ,
          channel: 2,
        })),
      },
    ],
  };
}

test('wizard MIDI: gợi ý track theo mật độ nốt / BPM (không phải track nhiều nốt), không còn ô gộp nốt / chia dòng; mở bản nháp, rời trang không lưu', async ({
  page,
}) => {
  const errors = collectErrors(page);
  await page.goto('/#/library');
  await expect(songCards(page)).toHaveCount(SEED_COUNT);
  await page.getByRole('link', { name: 'Tạo bài từ file MIDI / MusicXML' }).click();
  await expect(page).toHaveURL(/#\/midi$/);

  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /^Chọn file MIDI( \/ MusicXML)?$/ }).click();
  await (
    await chooser
  ).setFiles({
    name: 'giai_dieu.mid',
    mimeType: 'audio/midi',
    buffer: Buffer.from(writeSmf(chordalSpec())),
  });

  const step = (name: string) => page.getByRole('heading', { level: 2, name });
  await expect(step('Chọn track')).toBeVisible();
  await expect(page.getByRole('checkbox', { name: 'Chọn track "Flute"' })).toBeChecked();
  await expect(page.getByRole('checkbox', { name: 'Chọn track "Piano"' })).not.toBeChecked();
  await expect(page.getByRole('checkbox', { name: 'Chọn track "Cello"' })).not.toBeChecked();
  // Mỗi track hiện lý do: số nốt mỗi phút so với BPM.
  await expect(page.getByText('≈ 100 nốt/phút · BPM 100')).toHaveCount(2); // Flute + Cello
  await expect(page.getByText('≈ 600 nốt/phút · BPM 100')).toBeVisible(); // Piano

  await page.getByRole('button', { name: 'Tiếp' }).click();
  await expect(step('Trích melody')).toBeVisible();
  await expect(page.getByText(/16 nốt sau khi trích/)).toBeVisible();

  await page.getByRole('button', { name: 'Tiếp' }).click();
  await expect(step('Chọn cung và quãng')).toBeVisible();
  // Gộp nốt vượt tầm luôn bật: không còn công tắc.
  await expect(page.getByRole('switch')).toHaveCount(0);
  await expect(page.getByText(/Gập nốt vượt tầm|Bật gập quãng/)).toHaveCount(0);

  await page.getByRole('button', { name: 'Tiếp' }).click();
  await expect(step('Xem trước và tạo bài')).toBeVisible();
  // Chia dòng / section tự động: không còn ô nhập.
  for (const label of [
    /Ngắt dòng tại chỗ nghỉ/,
    /Mỗi dòng tối đa/,
    /Mỗi section/,
    /Section theo marker/,
  ]) {
    await expect(page.getByText(label)).toHaveCount(0);
  }
  await expect(page.getByRole('spinbutton')).toHaveCount(0);
  await expect(page.getByRole('checkbox')).toHaveCount(0);
  await expect(page.getByLabel('Xem trước .harm')).toContainText('@title giai dieu');

  await page.getByRole('button', { name: 'Mở trong Editor' }).click();
  await expect(page).toHaveURL(/#\/edit\/draft-[^/]+$/);
  await expect(page.getByText('Bản nháp — chưa lưu', { exact: true })).toBeVisible();
  // Chưa sửa gì → rời trang: không hỏi, thư viện không đổi.
  await page
    .getByRole('navigation', { name: 'Điều hướng chính' })
    .getByRole('link', { name: 'Thư viện' })
    .click();
  await expect(page).toHaveURL(/#\/library$/);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(songCards(page)).toHaveCount(SEED_COUNT);
  expect(errors).toEqual([]);
});

test('Cài đặt mặc định: đếm ngược 3 s, nhãn phụ ẩn, không có chiều Nửa Cung / lời; Phát đếm 3-2-1', async ({
  page,
}) => {
  const errors = collectErrors(page);
  await page.goto('/#/settings');
  await expect(page.getByLabel('Nhãn phụ trên tile')).toHaveValue('none');
  await expect(page.getByRole('slider', { name: 'Đếm ngược trước khi phát' })).toHaveAttribute(
    'aria-valuetext',
    '3 giây',
  );
  await expect(page.getByText(/\(scroll\)/)).toHaveCount(0);
  await expect(page.getByText(/Chiều Nửa Cung|thăng hay giáng/i)).toHaveCount(0);
  await expect(page.getByText(/karaoke|Hiện lời/i)).toHaveCount(0);

  await page.goto(`/#/play/${SEED.id}`);
  // góp ý 2026-10-16: Đếm vào / Đếm ngược chỉ ở Cài đặt → Phát bài; Lookahead mặc định 6 beat.
  const transport = page.getByRole('group', { name: 'Điều khiển phát' });
  await expect(transport.getByRole('button', { name: 'Đếm vào' })).toHaveCount(0);
  await expect(transport.getByRole('combobox', { name: 'Đếm ngược' })).toHaveCount(0);
  await expect(transport.getByRole('slider', { name: /Lookahead/ })).toHaveValue('6');
  const play = page.locator('button.transport-play');
  await play.click();
  const num = page.locator('.player-countdown-num');
  await expect(num).toHaveText('3');
  await expect(num).toHaveText('2', { timeout: 2_000 });
  await expect(num).toHaveText('1', { timeout: 2_000 });
  await expect(num).toHaveCount(0, { timeout: 2_000 });
  await expect(play).toHaveAttribute('data-playing', 'true');
  // Đang đếm vào (mặc định bật): không đếm lần hai — không còn số / status đếm nào ở DOM.
  await expect(page.locator('.player-countdown')).toHaveCount(0);
  await expect(page.getByText(/Bắt đầu sau/)).toHaveCount(0);
  await play.click();
  expect(errors).toEqual([]);
});

test('hộp thoại OBS chỉ còn tùy chọn hiển thị (không chọn bài / kiểu điều khiển / chờ / tự chạy / lặp / đếm vào / lời)', async ({
  page,
}) => {
  const errors = collectErrors(page);
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto(`/#/play/${SEED.id}`);
  await page.getByRole('button', { name: /^OBS/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Tạo link OBS' });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('.obs-link-song')).toContainText(SEED.title);
  // Hiển thị: 3 kiểu overlay + độ đậm + cỡ UI game.
  await expect(dialog.getByRole('radio')).toHaveCount(3);
  await expect(dialog.getByRole('slider')).toHaveCount(2);
  // Không còn: chọn bài, kiểu điều khiển, số beat thấy trước, chờ, tự chạy, lặp, đếm vào, lời, nền.
  await expect(dialog.getByRole('combobox')).toHaveCount(0);
  await expect(dialog.getByRole('switch')).toHaveCount(0);
  for (const label of [
    'Kiểu điều khiển',
    'Số beat thấy trước',
    'Chờ trước khi chạy',
    'Tự chạy khi mở',
    'Hết bài thì chạy lại',
    'Đếm vào khi bấm Phát',
    'Hiện lời',
    'Xanh chroma',
  ]) {
    await expect(dialog.getByLabel(label, { exact: false })).toHaveCount(0);
  }
  // Hai cách đưa lên OBS (góp ý 2026-10-16: bỏ Window Capture) + nút "Xem trước" (không phải cách quay).
  await expect(dialog.getByRole('heading', { level: 3 })).toHaveText([
    'Hiển thị',
    'Gửi thẳng vào OBS (khuyên dùng)',
    'Browser Source thủ công',
  ]);
  await expect(dialog.getByRole('button', { name: 'Xem trước' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: /Mở thử|Toàn màn hình/ })).toHaveCount(0);
  await expect(dialog.getByText(/Window Capture|Chroma Key|chroma/i)).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('không còn giao diện lời bài hát: Player, Công cụ của Editor, Donate', async ({ page }) => {
  const errors = collectErrors(page);
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto(`/#/play/${SEED.id}`);
  await expect(page.locator('canvas.player-canvas')).toBeVisible();
  await expect(page.getByRole('button', { name: /^Lời/ })).toHaveCount(0);
  await expect(page.getByRole('region', { name: /Lời bài hát/ })).toHaveCount(0);
  await expect(page.getByText(/karaoke/i)).toHaveCount(0);

  await page.goto(`/#/edit/${SEED.id}`);
  await page.getByRole('button', { name: 'Công cụ' }).click();
  const menu = page.getByRole('list', { name: 'Danh sách công cụ' });
  // "Nhập cảm âm" không còn trong Công cụ (góp ý 2026-10-16: ô dán kết quả AI phía trên ô soạn).
  await expect(menu.getByRole('button')).toHaveText([
    'Tap timing (gõ nhịp)',
    'Tối ưu lại cung / quãng',
  ]);
  await expect(menu.getByText(/lời/i)).toHaveCount(0);
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: 'Donate text' }).click();
  const donate = page.getByRole('dialog', { name: 'Donate text' });
  await expect(donate).toBeVisible();
  await expect(donate.getByLabel('Có lời')).toHaveCount(0);
  await page.keyboard.press('Escape');
  expect(errors).toEqual([]);
});

// ── Vòng sửa R5 (sau review) ─────────────────────────────────────────────────────────────────────────

test('R5: bản nháp → Phát → chip + "Mở trình soạn để lưu" → Lưu → "◂ Về màn chơi" mở bài đã lưu (không phải bản nháp cũ)', async ({
  page,
}) => {
  const errors = collectErrors(page);
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto('/#/library');
  await openBlankDraft(page);
  await expect(page).toHaveURL(/#\/edit\/draft-[^/?]+$/);
  const draftUrl = page.url();
  // Phát bản nháp CHƯA sửa → màn chơi của bản nháp.
  await page.getByRole('button', { name: 'Phát từ dòng con trỏ' }).click();
  await expect(page).toHaveURL(/#\/play\/draft-/);
  const chip = page.locator('.player-chip-transient');
  await expect(chip).toContainText('Bản nháp — chưa lưu');
  const back = page.getByRole('link', { name: 'Mở trình soạn để lưu' });
  await expect(back).toBeVisible();
  // Màn chơi vẫn không có nút "Sửa".
  await expect(page.getByRole('link', { name: /^Sửa/ })).toHaveCount(0);
  await back.click();
  await expect(page).toHaveURL(draftUrl);
  // Sửa tên + Ctrl+S → bài thư viện thật.
  const source = page.getByLabel('Nội dung bài (.harm)');
  await source.fill('@title Bai Da Sua\n@bpm 100\n# Main\nZ X C V\n');
  await source.press('Control+s');
  await expect(page).toHaveURL(/#\/edit\/(?!seed-|draft-)[^/]+$/);
  const savedId = decodeURIComponent(page.url().split('#/edit/')[1] ?? '');
  // "◂ Về màn chơi" (đã phát bản nháp trước đó) → bài ĐÃ LƯU.
  const brand = page.locator('a.app-back');
  await expect(brand).toHaveAttribute('href', `#/play/${encodeURIComponent(savedId)}`);
  await brand.click();
  await expect(page.getByRole('heading', { level: 1, name: 'Bai Da Sua' })).toBeVisible();
  await expect(page.locator('.player-transient')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('R5: bài tạm từ link chia sẻ → "Phát ngay" → màn chơi có "Lưu vào thư viện" → lưu một lần', async ({
  page,
}) => {
  const errors = collectErrors(page);
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto('/#/library');
  await expect(songCards(page)).toHaveCount(SEED_COUNT);
  // Link chia sẻ của bài mẫu (nút Chia sẻ ở thanh dọc): bài mẫu không nằm trong danh sách bài người dùng nên
  // "Phát ngay" mở bài tạm `shared-…`; "Lưu vào thư viện" ở màn chơi tạo bài người dùng.
  await page.goto(`/#/play/${SEED.id}`);
  await page.getByRole('button', { name: 'Chia sẻ' }).click();
  const link = await page.evaluate(() => navigator.clipboard.readText());
  expect(link).toContain('#/s/');
  await page.goto(link);
  await page.getByRole('button', { name: /Phát ngay/ }).click();
  await expect(page).toHaveURL(/#\/play\/shared-/);
  await expect(page.locator('.player-chip-transient')).toContainText('Bài tạm từ link — chưa lưu');
  await page.getByRole('button', { name: 'Lưu vào thư viện' }).click();
  await expect(page).toHaveURL(/#\/play\/(?!shared-|seed-)[^/?]+$/);
  await expect(page.locator('.player-transient')).toHaveCount(0);
  await page.goto('/#/library');
  await expect(songCards(page)).toHaveCount(SEED_COUNT + 1);
  expect(errors).toEqual([]);
});

test('R5: Tab tới nút "Mobile" ở thanh dọc + Space → đổi kiểu điều khiển, không đếm ngược; bấm chuột rồi Space vẫn là Phát', async ({
  page,
}) => {
  const errors = collectErrors(page);
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto(`/#/play/${SEED.id}`);
  const scheme = page
    .getByRole('complementary', { name: 'Công cụ màn chơi' })
    .getByRole('group', { name: 'Kiểu điều khiển' });
  const pc = scheme.getByRole('button', { name: 'PC', exact: true });
  const mobile = scheme.getByRole('button', { name: 'Mobile', exact: true });
  await expect(pc).toHaveAttribute('aria-pressed', 'true');
  // Tab từ nút PC sang nút Mobile (focus bằng bàn phím).
  await pc.focus();
  await page.keyboard.press('Tab');
  await expect(mobile).toBeFocused();
  await page.keyboard.press('Space');
  await expect(mobile).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.player-countdown')).toHaveCount(0);
  // Bấm chuột vào PC rồi nhấn Space → Space là Phát (D-033), không bấm lại nút.
  await pc.click();
  await expect(pc).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Space');
  await expect(page.locator('.player-countdown')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(pc).toHaveAttribute('aria-pressed', 'true');
  expect(errors).toEqual([]);
});

import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { writeSmf } from '../src/midi/testing/smf';
import type { SmfSpec } from '../src/midi/testing/smf';
import { collectErrors, readClipboard, stubClipboard } from './helpers';

/**
 * Smoke Phase 2 / 2b (spec §6, §6b, §9): Editor + preview, Donate text (DoD: dán lại các phần ra
 * đúng bài), link chia sẻ, wizard MIDI (file SMF tự sinh), practice mode, card Cài đặt mới.
 * Chạy trên bản build (`vite preview`), settings mặc định (tiếng Việt). Thư viện ở `#/library`.
 */

const SEED2 = { id: 'seed-takediskrush', title: 'TAKEDISKRUSH!' } as const;
const SEED1 = { id: 'seed-quoc-ca-viet-nam', title: 'Quốc ca Việt Nam' } as const;
const DONATE_LIMIT = 200;
/** Tiêu đề wizard tạo bài từ file nhạc (MIDI, MusicXML). */
const FROM_FILE = 'Tạo bài từ file MIDI / MusicXML';
/** Lối vào wizard ở Thư viện (góp ý 2026-10-15: ghi rõ loại file). */
const FROM_FILE_LINK = 'Tạo bài từ file MIDI / MusicXML';

test.beforeEach(async ({ context }) => {
  await stubClipboard(context);
});

/** Preview của Editor đã parse xong và không có lỗi (cảnh báo / ghi chú thì được). */
async function expectNoErrors(page: Page): Promise<void> {
  const preview = page.locator('.editor-preview');
  await expect(preview.getByRole('heading', { level: 3, name: 'Lỗi và cảnh báo' })).toBeVisible();
  await expect(preview.locator('.pv-diag.is-error')).toHaveCount(0);
  const summary = preview.locator('.pv-diag-summary');
  if ((await summary.count()) > 0) await expect(summary).toHaveText(/^0 lỗi · /);
  else await expect(preview.getByText('Không có lỗi hay cảnh báo.')).toBeVisible();
  await expect(page.getByLabel('Nội dung bài (.harm)')).not.toHaveAttribute('aria-invalid', 'true');
}

function noteCount(page: Page) {
  return page.locator('.editor-preview [data-stat="notes"]');
}

/** File MIDI 2 track: melody (thang Đô trưởng, có marker) + hợp âm; trống bị wizard ẩn. */
function midiSpec(): SmfSpec {
  const PPQ = 480;
  const scale = [60, 62, 64, 65, 67, 69, 71, 72, 72, 71, 69, 67, 65, 64, 62, 60];
  return {
    format: 1,
    ppq: PPQ,
    tracks: [
      {
        name: 'Conductor',
        events: [
          { tick: 0, type: 'tempo', bpm: 100 },
          { tick: 0, type: 'timeSig', num: 4, den: 4 },
          { tick: 0, type: 'marker', text: 'Verse' },
          { tick: 8 * PPQ, type: 'marker', text: 'Chorus' },
        ],
      },
      {
        name: 'Melody',
        events: scale.map((midi, i) => ({
          tick: i * PPQ,
          type: 'note' as const,
          midi,
          duration: PPQ,
          channel: 0,
        })),
      },
      {
        name: 'Chords',
        events: [48, 52, 55].map((midi) => ({
          tick: 0,
          type: 'note' as const,
          midi,
          duration: 16 * PPQ,
          channel: 1,
        })),
      },
      {
        name: 'Drums',
        events: [0, 1, 2, 3].map((b) => ({
          tick: b * PPQ,
          type: 'note' as const,
          midi: 36,
          duration: PPQ / 2,
          channel: 9,
        })),
      },
    ],
  };
}

test('editor: seed 2 có preview + thống kê, không lỗi; Donate chia phần ≤ 200 ký tự', async ({
  page,
}) => {
  const errors = collectErrors(page);
  await page.goto('/#/library');
  await page.getByRole('link', { name: `Sửa "${SEED2.title}"` }).click();
  await expect(page).toHaveURL(new RegExp(`#/edit/${SEED2.id}$`));
  await expect(page.getByRole('heading', { level: 1, name: `Sửa: ${SEED2.title}` })).toBeVisible();
  await expect(page.getByLabel('Nội dung bài (.harm)')).toHaveValue(/@title TAKEDISKRUSH!/);

  await expect(page.getByRole('heading', { level: 3, name: 'Thống kê' })).toBeVisible();
  await expect(noteCount(page)).toHaveText(/^\d+$/);
  expect(Number(await noteCount(page).textContent())).toBeGreaterThan(100);
  await expect(page.locator('.editor-preview [data-stat="beats"]')).toHaveText(/beat/);
  await expectNoErrors(page);

  await page.getByRole('button', { name: 'Donate text' }).click();
  const dialog = page.getByRole('dialog', { name: 'Donate text' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('Số ký tự tối đa mỗi tin')).toHaveValue(String(DONATE_LIMIT));
  const chunks = await dialog.locator('.donate-chunk-text').allTextContents();
  expect(chunks.length).toBeGreaterThan(1);
  chunks.forEach((chunk, i) => {
    expect(chunk.length, `phần ${i + 1}`).toBeLessThanOrEqual(DONATE_LIMIT);
    expect(chunk.startsWith(`${i + 1}/${chunks.length} `), `phần ${i + 1}`).toBe(true);
  });
  await expect(dialog.getByText(`Phần 1/${chunks.length}`)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);

  expect(errors).toEqual([]);
});

test('DoD: dán các phần Donate của seed 2 vào bài mới → 0 lỗi, cùng số nốt', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto(`/#/edit/${SEED2.id}`);
  await expectNoErrors(page);
  const seedNotes = Number(await noteCount(page).textContent());
  expect(seedNotes).toBeGreaterThan(100);

  await page.getByRole('button', { name: 'Donate text' }).click();
  const dialog = page.getByRole('dialog', { name: 'Donate text' });
  const chunks = await dialog.locator('.donate-chunk-text').allTextContents();
  expect(chunks.length).toBeGreaterThan(1);
  await dialog.getByRole('button', { name: 'Sao chép tất cả' }).click();
  await expect(dialog.getByRole('button', { name: 'Đã sao chép' })).toBeVisible();
  const pasted = await readClipboard(page);
  expect(pasted).toBe(chunks.join('\n\n'));
  await page.keyboard.press('Escape');

  // Thư viện → "Tạo bài với AI" → "hoặc tự gõ từ đầu" (template; trước là nút "Tạo bài mới thủ công")
  // → Editor của BẢN NHÁP (chưa vào thư viện).
  await page.getByRole('link', { name: 'Thư viện' }).click();
  await page.getByRole('link', { name: 'Tạo bài với AI' }).click();
  await page.getByRole('button', { name: 'hoặc tự gõ từ đầu' }).click();
  await expect(page).toHaveURL(/#\/edit\/draft-[^/]+$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Sửa: Bài mới' })).toBeVisible();
  await expect(page.getByText('Bản nháp — chưa lưu', { exact: true })).toBeVisible();

  const source = page.getByLabel('Nội dung bài (.harm)');
  await source.fill(pasted);
  await expect(page.getByRole('heading', { level: 1, name: `Sửa: ${SEED2.title}` })).toBeVisible();
  await expect(noteCount(page)).toHaveText(String(seedNotes));
  await expectNoErrors(page);
  await expect(page.locator('.editor-status')).toHaveText(/Chưa lưu$/);

  // Lưu → bản nháp thành bài thư viện (URL đổi sang id thật), không lỗi.
  await page.getByRole('button', { name: 'Lưu', exact: true }).click();
  await expect(page.getByText('Đã lưu mọi thay đổi')).toBeVisible();
  await expect(page).toHaveURL(/#\/edit\/(?!seed-|draft-)[^/]+$/);

  expect(errors).toEqual([]);
});

test('link chia sẻ từ Editor mở #/s/… và phát 2 s không lỗi console', async ({ page, context }) => {
  const errors = collectErrors(page);
  await page.goto(`/#/edit/${SEED2.id}`);
  await expectNoErrors(page);
  await page.getByRole('button', { name: 'Chia sẻ link' }).click();
  await expect(page.getByText(/^Đã sao chép link chia sẻ \(\d+ ký tự\)$/)).toBeVisible();
  const url = await readClipboard(page);
  expect(url).toMatch(/^http:\/\/localhost:\d+\/#\/s\/[A-Za-z0-9+\-$]+$/);

  // Người nhận: tab mới, mở link.
  const recipient = await context.newPage();
  const recipientErrors = collectErrors(recipient);
  await recipient.goto(url);
  await expect(recipient.getByRole('heading', { level: 1, name: SEED2.title })).toBeVisible();
  await recipient.getByRole('button', { name: 'Phát ngay' }).click();
  await expect(recipient).toHaveURL(/#\/play\/shared-[a-z0-9-]+$/);
  await expect(recipient.getByRole('heading', { level: 1, name: SEED2.title })).toBeVisible();

  const play = recipient.locator('button.transport-play');
  await expect(play).toHaveAttribute('data-playing', 'false');
  await play.click();
  await expect(play).toHaveAttribute('data-playing', 'true');
  await recipient.waitForTimeout(2_000);
  await expect(play).toHaveAttribute('data-playing', 'true');
  await play.click();
  await expect(play).toHaveAttribute('data-playing', 'false');

  expect(recipientErrors).toEqual([]);
  expect(errors).toEqual([]);
});

test('MIDI: file SMF → 5 bước → Editor 0 lỗi → Player', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/#/library');
  // Phase 2c: wizard nhận cả MusicXML → "Tạo bài từ file MIDI / MusicXML".
  await page.getByRole('link', { name: FROM_FILE_LINK }).click();
  await expect(page).toHaveURL(/#\/midi$/);
  await expect(page.getByRole('heading', { level: 1, name: FROM_FILE })).toBeVisible();

  // Bước 1: chọn file (qua file chooser của nút) → tự sang bước 2.
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /^Chọn file MIDI( \/ MusicXML)?$/ }).click();
  await (
    await chooser
  ).setFiles({
    name: 'thang_am.mid',
    mimeType: 'audio/midi',
    buffer: Buffer.from(writeSmf(midiSpec())),
  });

  const step = (name: string) => page.getByRole('heading', { level: 2, name });
  await expect(step('Chọn track')).toBeVisible();
  await expect(page.getByText('Đã ẩn 1 track trống (kênh 10).')).toBeVisible();
  // Phase 2c: chọn nhiều track (checkbox) rồi gộp; gợi ý mặc định chỉ track melody.
  await expect(page.getByRole('checkbox', { name: 'Chọn track "Melody"' })).toBeChecked();
  await expect(page.getByRole('checkbox', { name: 'Chọn track "Chords"' })).not.toBeChecked();

  await page.getByRole('button', { name: 'Tiếp' }).click();
  await expect(step('Trích melody')).toBeVisible();
  await expect(page.getByText(/16 nốt sau khi trích/)).toBeVisible();

  await page.getByRole('button', { name: 'Tiếp' }).click();
  await expect(step('Chọn cung và quãng')).toBeVisible();
  await expect(page.getByRole('radio', { name: 'Giữ cung gốc' })).toBeChecked();

  await page.getByRole('button', { name: 'Tiếp' }).click();
  await expect(step('Xem trước và tạo bài')).toBeVisible();
  await expect(page.getByLabel('Tên bài')).toHaveValue('thang am');
  const preview = page.getByLabel('Xem trước .harm');
  await expect(preview).toContainText('@title thang am');
  // dòng / section chia tự động: section theo 2 marker của file
  await expect(preview).toContainText('# Verse');
  await expect(preview).toContainText('# Chorus');

  // mở dạng bản nháp (chưa vào thư viện cho tới khi Lưu)
  await page.getByRole('button', { name: 'Mở trong Editor' }).click();
  await expect(page).toHaveURL(/#\/edit\/draft-[^/]+$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Sửa: thang am' })).toBeVisible();
  await expectNoErrors(page);
  await expect(noteCount(page)).toHaveText('16');

  await page.getByRole('button', { name: 'Phát từ dòng con trỏ' }).click();
  await expect(page).toHaveURL(/#\/play\/[^/?]+\?line=0$/);
  await expect(page.getByRole('heading', { level: 1, name: 'thang am' })).toBeVisible();
  await expect(page.locator('canvas.player-canvas')).toBeVisible();

  expect(errors).toEqual([]);
});

test('practice: bật Luyện tập hiện HUD; bấm Z X C… không lỗi, game bar sáng phím đang bấm', async ({
  page,
}) => {
  const errors = collectErrors(page);
  await page.goto(`/#/play/${SEED1.id}`);
  await expect(page.getByRole('heading', { level: 1, name: SEED1.title })).toBeVisible();

  const toggle = page.getByRole('button', { name: 'Luyện tập', exact: true });
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  const hud = page.getByRole('region', { name: 'Điểm luyện tập' });
  await expect(hud).toBeVisible();
  await expect(page.getByRole('group', { name: 'Chế độ luyện tập' })).toBeVisible();

  // Phím đang giữ sáng trên game bar.
  const gameBar = page.getByRole('group', { name: 'Gợi ý phím như trong game' });
  await page.keyboard.down('x');
  await expect(gameBar.locator('[data-pressed="true"]')).not.toHaveCount(0);
  await page.keyboard.up('x');
  await expect(gameBar.locator('[data-pressed="true"]')).toHaveCount(0);

  // Phát rồi bấm mọi phím nốt (kèm modifier) — được chấm, không throw.
  const play = page.locator('button.transport-play');
  await play.click();
  await expect(play).toHaveAttribute('data-playing', 'true');
  for (const key of ['z', 'x', 'c', 'v', 'b', 'n', 'm', ',', 'Shift+z', 'Alt+x']) {
    await page.keyboard.press(key);
  }
  await page.waitForTimeout(500);
  await play.click();
  await expect(play).toHaveAttribute('data-playing', 'false');
  await expect(hud).toBeVisible();

  await toggle.click();
  await expect(hud).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('settings: có card Luyện tập và MIDI', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/#/settings');
  await expect(page.getByRole('heading', { level: 2, name: 'Luyện tập' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: 'MIDI' })).toBeVisible();
  await expect(page.getByLabel('Chế độ luyện tập mặc định')).toBeVisible();
  // luyện tập chỉ bằng chuột: không còn ô chọn phím bàn phím thay chuột
  await expect(
    page.getByText(/= giữ chuột trái \/ chuột phải \/ nút cuộn trên khu tiles/),
  ).toBeVisible();
  await expect(page.getByLabel('Phím thay chuột trái (Cúi Xuống)')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('settings (góp ý 2026-10-16): 2 cột gọn, Âm thanh hiện sẵn, MIDI cuối, không Phím tắt / Lookahead', async ({
  page,
}) => {
  const errors = collectErrors(page);
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto('/#/settings');
  await expect(page.locator('.settings-view').getByRole('heading', { level: 2 })).toHaveText([
    /Kiểu điều khiển/,
    /Giao diện/,
    /Phát bài/,
    /Harmonica/,
    /Âm thanh/,
    /Luyện tập/,
    /MIDI/,
  ]);
  // Âm thanh: card thường (không còn "Nâng cao — âm thanh" thu gọn), mặc định tắt.
  await expect(page.getByText('Nâng cao — âm thanh')).toHaveCount(0);
  const melody = page.getByRole('switch', { name: 'Phát giai điệu mẫu' });
  await expect(melody).toBeVisible();
  await expect(melody).not.toBeChecked();
  await expect(page.getByRole('region', { name: 'Phím tắt' })).toHaveCount(0);
  await expect(page.getByRole('slider', { name: /Lookahead/ })).toHaveCount(0);
  // Hai cột: card 01 và 05 cùng hàng đầu; MIDI là card thấp nhất của cột phải.
  // exact: "Luyện tập" (card 06) ≠ nhóm "Tiếng khi luyện tập" trong card Âm thanh.
  const top = async (name: string) =>
    (await page.getByRole('region', { name, exact: true }).boundingBox())?.y ?? -1;
  expect(Math.abs((await top('Kiểu điều khiển')) - (await top('Âm thanh')))).toBeLessThan(2);
  expect(await top('MIDI')).toBeGreaterThan(await top('Luyện tập'));
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
  expect(errors).toEqual([]);
});

test('editor trong Chromium thật: Tab chèn 2 dấu cách, chặn rời trang khi chưa lưu (link + Back)', async ({
  page,
}) => {
  const errors = collectErrors(page);
  await page.goto('/#/library');
  await page.getByRole('link', { name: `Sửa "${SEED1.title}"` }).click();
  await expect(page.getByRole('heading', { level: 1, name: `Sửa: ${SEED1.title}` })).toBeVisible();
  const source = page.getByLabel('Nội dung bài (.harm)');
  const before = await source.inputValue();

  // Tab trong ô soạn: chèn 2 dấu cách tại con trỏ (execCommand), focus vẫn ở ô soạn.
  await source.focus();
  await page.keyboard.press('Control+End');
  await page.keyboard.press('Tab');
  await expect(source).toBeFocused();
  await expect(source).toHaveValue(`${before}  `);
  await expect(page.getByText('Chưa lưu')).toBeVisible();

  // Link trong app khi chưa lưu → hỏi; "Ở lại" giữ nguyên editor.
  await page.getByRole('link', { name: 'Thư viện' }).click();
  const leave = page.getByRole('dialog', { name: 'Rời trình soạn?' });
  await expect(leave).toBeVisible();
  await leave.getByRole('button', { name: 'Ở lại' }).click();
  await expect(leave).toHaveCount(0);
  await expect(page).toHaveURL(new RegExp(`#/edit/${SEED1.id}$`));
  await expect(source).toHaveValue(`${before}  `);

  // Nút Back của trình duyệt (popstate/hashchange) cũng bị chặn trước router.
  await page.goBack();
  await expect(leave).toBeVisible();
  await expect(page.getByRole('heading', { level: 1, name: `Sửa: ${SEED1.title}` })).toBeVisible();
  await leave.getByRole('button', { name: 'Bỏ thay đổi' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Thư viện bài hát' })).toBeVisible();

  expect(errors).toEqual([]);
});

test('Tap timing: Space khi nút "Hoàn tác tap" đang focus vẫn là tap (không bấm nút)', async ({
  page,
}) => {
  const errors = collectErrors(page);
  await page.goto(`/#/edit/${SEED1.id}`);
  await expectNoErrors(page);
  await page.getByRole('button', { name: 'Công cụ' }).click();
  await page.getByRole('button', { name: 'Tap timing (gõ nhịp)' }).click();
  const dialog = page.getByRole('dialog', { name: 'Tap timing (gõ nhịp)' });
  await dialog.getByRole('button', { name: 'Bắt đầu tap' }).click();
  const progress = dialog.getByText(/^Đã tap \d+\/\d+$/);
  await expect(progress).toHaveText(/^Đã tap 0\//);

  await page.keyboard.press('Space');
  await page.keyboard.press('Space');
  await expect(progress).toHaveText(/^Đã tap 2\//);
  const undo = dialog.getByRole('button', { name: 'Hoàn tác tap' });
  await undo.click();
  await expect(progress).toHaveText(/^Đã tap 1\//);
  await expect(undo).toBeFocused();
  await page.keyboard.press('Space');
  await expect(progress).toHaveText(/^Đã tap 2\//);

  // Đang tap dở: Hủy / Esc không đóng mà hỏi lại, focus về ô tap; tap tiếp thì bỏ câu hỏi và giữ
  // các lần tap (D-159).
  await dialog.getByRole('button', { name: 'Hủy' }).click();
  const prompt = dialog.getByRole('alert');
  await expect(prompt).toContainText('2 lần tap');
  await expect(
    dialog.getByRole('button', { name: 'Ô tap — nhấn Space hoặc chạm vào đây' }),
  ).toBeFocused();
  await page.keyboard.press('Space');
  await expect(prompt).toHaveCount(0);
  await expect(progress).toHaveText(/^Đã tap 3\//);
  await page.keyboard.press('Escape');
  await expect(prompt).toBeVisible();
  await expect(dialog).toHaveCount(1);

  await prompt.getByRole('button', { name: 'Bỏ 3 lần tap và đóng' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText('Đã lưu mọi thay đổi')).toBeVisible();
  expect(errors).toEqual([]);
});

test('editor: Esc ở công cụ trả focus về "Công cụ"; Ctrl+S bài mẫu giữ phiên soạn; bài rỗng không chia sẻ', async ({
  page,
}) => {
  const errors = collectErrors(page);
  await page.goto(`/#/edit/${SEED1.id}`);
  await expectNoErrors(page);
  const toolsButton = page.getByRole('button', { name: 'Công cụ' });
  const tool = page.getByRole('dialog', { name: 'Tối ưu tông' });

  // Esc trong modal công cụ: focus về nút Công cụ, không rơi về <body> (D-156).
  await toolsButton.click();
  await page.getByRole('button', { name: 'Tối ưu lại cung / quãng' }).click();
  await expect(tool).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(tool).toHaveCount(0);
  await expect(toolsButton).toBeFocused();

  // "Nhập cảm âm" không còn trong Công cụ: ô "Dán kết quả của AI vào đây" ngay trên ô soạn (góp ý
  // 2026-10-16). Gõ tay → "Áp dụng" → bài đổi sang phím .harm, Hoàn tác bật.
  await toolsButton.click();
  await expect(page.getByRole('button', { name: 'Nhập cảm âm' })).toHaveCount(0);
  await page.keyboard.press('Escape');
  const aiBox = page.getByLabel('Dán kết quả của AI vào đây');
  await aiBox.fill('do1 re1 mi1');
  await page.getByRole('button', { name: 'Áp dụng' }).click();
  const source = page.getByLabel('Nội dung bài (.harm)');
  await expect(source).toHaveValue(/^@title /);
  await expect(source).not.toHaveValue(/do1/);
  await expect(page.getByText('Đã đưa 3 nốt vào bài — bấm Lưu để lưu.')).toBeVisible();
  const undo = page.getByRole('button', { name: /^Hoàn tác/ });
  await expect(undo).toBeEnabled();

  // Ctrl+S trên bài mẫu: lưu bản sao, route đổi sang bản sao nhưng phiên soạn còn nguyên (D-155).
  await source.focus();
  await page.keyboard.press('Control+End');
  await page.keyboard.type('\n// e2e');
  await expect(page.getByText('Chưa lưu')).toBeVisible();
  await page.keyboard.press('Control+s');
  await expect(page).toHaveURL(/#\/edit\/(?!seed-)[^/]+$/);
  await expect(page.getByText('Đã lưu mọi thay đổi')).toBeVisible();
  await expect(page.getByRole('note')).toHaveCount(0);
  await expect(source).toBeFocused();
  await expect(undo).toBeEnabled();
  await page.keyboard.type('bcd');
  await expect(source).toHaveValue(/\n\/\/ e2ebcd$/);

  // Bài rỗng: không sao chép link (link chỉ mở ra "link hỏng"), báo lỗi (D-147).
  await source.fill('  \n');
  await page.getByRole('button', { name: 'Chia sẻ link' }).click();
  await expect(page.getByText('Bài chưa có nội dung để chia sẻ.')).toBeVisible();
  expect(await readClipboard(page)).toBe('');
  expect(errors).toEqual([]);
});

test('modal chồng nhau: hộp "Rời trình soạn?" trên modal Công cụ — Tab đi được, một Esc chỉ đóng hộp trên', async ({
  page,
}) => {
  const errors = collectErrors(page);
  await page.goto('/#/library');
  await page.getByRole('link', { name: `Sửa "${SEED1.title}"` }).click();
  await expect(page.getByRole('heading', { level: 1, name: `Sửa: ${SEED1.title}` })).toBeVisible();
  const source = page.getByLabel('Nội dung bài (.harm)');
  await source.focus();
  await page.keyboard.press('Control+End');
  await page.keyboard.press('Tab');
  await expect(page.getByText('Chưa lưu')).toBeVisible();

  await page.getByRole('button', { name: 'Công cụ' }).click();
  await page.getByRole('button', { name: 'Tối ưu lại cung / quãng' }).click();
  const tool = page.getByRole('dialog', { name: 'Tối ưu tông' });
  // chọn một phương án khác phương án mặc định: lựa chọn phải còn sau khi hộp trên đóng
  const choice = tool.getByRole('radio').nth(1);
  await choice.check();
  await expect(choice).toBeChecked();

  // Back khi đang mở công cụ → hộp xác nhận mở chồng lên modal công cụ.
  await page.goBack();
  const leave = page.getByRole('dialog', { name: 'Rời trình soạn?' });
  await expect(leave).toBeVisible();
  await expect(leave.getByRole('button', { name: 'Ở lại' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(leave.getByRole('button', { name: 'Bỏ thay đổi' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(leave.getByRole('button', { name: 'Lưu rồi đi' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(leave.getByRole('button', { name: 'Đóng' })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(leave.getByRole('button', { name: 'Lưu rồi đi' })).toBeFocused();

  // Một Esc chỉ đóng hộp trên cùng: modal công cụ và chữ đã gõ còn nguyên, focus về trong nó.
  await page.keyboard.press('Escape');
  await expect(leave).toHaveCount(0);
  await expect(tool).toBeVisible();
  await expect(choice).toBeChecked();
  await expect(page).toHaveURL(new RegExp(`#/edit/${SEED1.id}$`));
  await expect(tool.locator(':focus')).toHaveCount(1);

  await page.keyboard.press('Escape');
  await expect(tool).toHaveCount(0);
  expect(errors).toEqual([]);
});

/** Tỉ lệ contrast WCAG giữa màu chữ và màu nền (đặc) của phần tử — chạy trong trang. */
function contrastInPage(el: Element): number {
  const lum = (css: string) => {
    const [r = 0, g = 0, b = 0] = (css.match(/[\d.]+/g) ?? []).slice(0, 3).map((v) => {
      const s = Number(v) / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const cs = getComputedStyle(el);
  const a = lum(cs.color);
  const b = lum(cs.backgroundColor);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

test('player: nút đang bật vẫn đọc được khi chuột nằm trên nó; chuột phải / giữa lên nền không đóng dialog', async ({
  page,
}) => {
  const errors = collectErrors(page);
  // < 1200 px: cột phím tắt bên trái ẩn, nút "Phím tắt" (?) ở thanh điều khiển mở hộp thoại.
  await page.setViewportSize({ width: 1100, height: 800 });
  await page.goto(`/#/play/${SEED1.id}`);
  await expect(page.getByRole('heading', { level: 1, name: SEED1.title })).toBeVisible();

  // Bấm "Luyện tập" rồi để chuột nằm yên trên nút (trạng thái thường gặp nhất).
  const toggle = page.getByRole('button', { name: 'Luyện tập', exact: true });
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await toggle.hover();
  await expect.poll(() => toggle.evaluate(contrastInPage)).toBeGreaterThanOrEqual(4.5);

  await page.getByRole('button', { name: 'Phím tắt' }).click();
  const help = page.getByRole('dialog', { name: 'Phím tắt của màn chơi' });
  await expect(help).toBeVisible();
  await page.mouse.click(4, 4, { button: 'right' });
  await page.mouse.click(4, 4, { button: 'middle' });
  await expect(help).toBeVisible();
  await page.mouse.click(4, 4);
  await expect(help).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('settings: nhãn toggle dài xuống dòng ngay cạnh switch, không tách xuống dưới', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1920, height: 1000 });
  await page.goto('/#/settings');
  const name = 'Chỉ cần đúng pitch class (bỏ qua quãng tám)';
  const sw = page.getByRole('switch', { name });
  await sw.scrollIntoViewIfNeeded();
  const s = await sw.boundingBox();
  const l = await page.locator('label', { hasText: name }).boundingBox();
  if (!s || !l) throw new Error('không thấy switch / nhãn');
  expect(l.x).toBeGreaterThanOrEqual(s.x + s.width);
  expect(l.y).toBeLessThan(s.y + s.height);
});

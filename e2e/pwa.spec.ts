import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { writeSmf } from '../src/midi/testing/smf';
import { canvasColorCount, canvasSignature, collectErrors, stubClipboard } from './helpers';

/**
 * Phase 3 — PWA + bản 1 file (spec §7):
 * (a) bản build (`vite preview`) có service worker: SW nhận trang → offline → tải lại vẫn chạy
 *     (màn chơi `#/`, Phát, thư viện, chunk tải lười Editor / MIDI + @tonejs/midi đều từ precache);
 * (b) `build:single` → mở `dist-single/index.html` bằng file:// → màn chơi, Phát, ◂ Thư viện,
 *     Editor (chunk đã inline), không lỗi console.
 * Spec khác chặn service worker (playwright.config.ts) — chỉ file này cho phép.
 */

const SEED1 = { id: 'seed-quoc-ca-viet-nam', title: 'Quốc ca Việt Nam' } as const;
// Hai bài mẫu đầu thư viện (góp ý 2026-10-16).
const SEEDS = ['Quốc ca Việt Nam', 'TAKEDISKRUSH!'] as const;
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SINGLE_HTML = fileURLToPath(new URL('../dist-single/index.html', import.meta.url));
const VITE_BIN = fileURLToPath(new URL('../node_modules/vite/bin/vite.js', import.meta.url));

test.beforeEach(async ({ context }) => {
  await stubClipboard(context);
});

/** Nút Phát của thanh điều khiển màn chơi (`#/` = màn chơi với bài mẫu). */
function playButton(page: Page): Locator {
  return page.locator('.transport').getByRole('button', { name: 'Phát', exact: true });
}

/** Phát → (đếm ngược 3 s mặc định + đếm vào) → ô rơi (chữ ký canvas đổi). */
async function playStartsTiles(page: Page): Promise<void> {
  await expect(playButton(page)).toBeVisible();
  await expect.poll(() => canvasColorCount(page)).toBeGreaterThan(3);
  const before = await canvasSignature(page);
  await playButton(page).click();
  await expect
    .poll(() => canvasSignature(page), { timeout: 10_000, intervals: [50] })
    .not.toBe(before);
}

/** "◂ Thư viện" của màn chơi → `#/library` liệt kê 2 bài mẫu. */
async function openLibraryFromMenu(page: Page): Promise<void> {
  await page.getByRole('link', { name: 'Về thư viện' }).click();
  await expect(page).toHaveURL(/#\/library$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Thư viện bài hát' })).toBeVisible();
  for (const title of SEEDS) {
    await expect(page.getByRole('heading', { level: 2, name: title })).toBeVisible();
  }
}

/** Đổi hash (điều hướng trong trang, không tải lại tài liệu). */
async function goHash(page: Page, hash: string): Promise<void> {
  await page.evaluate((h) => {
    window.location.hash = h;
  }, hash);
}

/** File MIDI 1 track (thang Đô trưởng 8 nốt). */
function smallMidi(): Buffer {
  const PPQ = 480;
  return Buffer.from(
    writeSmf({
      format: 0,
      ppq: PPQ,
      tracks: [
        {
          name: 'Melody',
          events: [60, 62, 64, 65, 67, 69, 71, 72].map((midi, i) => ({
            tick: i * PPQ,
            type: 'note' as const,
            midi,
            duration: PPQ,
          })),
        },
      ],
    }),
  );
}

/** `#/midi` → chọn file MIDI → bước "Chọn track" (cần chunk MIDI + @tonejs/midi). */
async function midiWizardLoadsFile(page: Page): Promise<void> {
  await goHash(page, '#/midi');
  await expect(
    page.getByRole('heading', { level: 1, name: 'Tạo bài từ file MIDI / MusicXML', exact: true }),
  ).toBeVisible();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /^Chọn file MIDI( \/ MusicXML)?$/ }).click();
  await (
    await chooser
  ).setFiles({ name: 'thang_am.mid', mimeType: 'audio/midi', buffer: smallMidi() });
  await expect(page.getByRole('heading', { level: 2, name: 'Chọn track' })).toBeVisible();
}

test.describe('PWA: offline sau lần mở đầu', () => {
  test.use({ serviceWorkers: 'allow' });

  test('SW nhận trang → offline → tải lại: màn đầu, ▶, thư viện, Editor, MIDI chạy từ precache', async ({
    page,
    context,
  }) => {
    const errors = collectErrors(page);
    await page.goto('/');
    await expect(playButton(page)).toBeVisible();
    // Manifest + icon được trình duyệt thấy.
    await expect(page.locator('link[rel="manifest"]')).toHaveAttribute(
      'href',
      '/manifest.webmanifest',
    );
    // clientsClaim: lần cài đầu SW nhận luôn trang đang mở (precache đã xong khi SW active).
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, {
      timeout: 30_000,
    });
    const registered = await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.ready;
      return reg.active?.scriptURL ?? '';
    });
    expect(registered).toMatch(/\/sw\.js$/);
    // Màn chơi mặc định `#/` (lần mở đầu) không hiện "sẵn sàng offline" — chờ tới trang sau.
    await expect(page.getByText(/sẵn sàng dùng offline/)).toHaveCount(0);

    await context.setOffline(true);
    expect(await page.evaluate(() => navigator.onLine)).toBe(false);

    const res = await page.reload();
    expect(res?.fromServiceWorker()).toBe(true);
    await playStartsTiles(page);
    await openLibraryFromMenu(page);

    // Chunk tải lười Editor: phục vụ bởi service worker (precache), không cần mạng.
    const editorChunk = page.waitForResponse((r) =>
      /\/assets\/EditorView-[\w-]+\.js$/.test(r.url()),
    );
    await goHash(page, `#/edit/${SEED1.id}`);
    expect((await editorChunk).fromServiceWorker()).toBe(true);
    await expect(
      page.getByRole('heading', { level: 1, name: `Sửa: ${SEED1.title}` }),
    ).toBeVisible();

    // Overlay OBS (chunk tải lười) cũng từ precache.
    const overlayChunk = page.waitForResponse((r) =>
      /\/assets\/OverlayView-[\w-]+\.js$/.test(r.url()),
    );
    await goHash(page, `#/overlay/${SEED1.id}?bg=chroma`);
    expect((await overlayChunk).fromServiceWorker()).toBe(true);
    await expect(page.getByRole('region', { name: 'Overlay OBS' })).toBeVisible();

    // Wizard MIDI + @tonejs/midi (chunk riêng, tải khi chọn file) cũng offline.
    const midiChunk = page.waitForResponse((r) => /\/assets\/midiFile-[\w-]+\.js$/.test(r.url()));
    await midiWizardLoadsFile(page);
    expect((await midiChunk).fromServiceWorker()).toBe(true);

    await context.setOffline(false);
    expect(errors).toEqual([]);
  });

  test('tự kiểm tra bản mới (vòng R7): quay lại tab → registration.update(), không dày hơn 5 phút', async ({
    page,
  }) => {
    const errors = collectErrors(page);
    // Đồng hồ của trang chỉnh được (Date.now + lệch) và đếm lần gọi registration.update().
    await page.addInitScript(() => {
      const w = window as unknown as { __skew: number; __updates: number };
      w.__skew = 0;
      w.__updates = 0;
      const realNow = Date.now.bind(Date);
      Date.now = () => realNow() + w.__skew;
      const proto = ServiceWorkerRegistration.prototype;
      const update = proto.update;
      proto.update = function (this: ServiceWorkerRegistration) {
        w.__updates++;
        return update.call(this);
      };
    });
    await page.goto('/#/library');
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, {
      timeout: 30_000,
    });
    await page.evaluate(() => navigator.serviceWorker.ready);
    const updates = () =>
      page.evaluate(() => (window as unknown as { __updates: number }).__updates);
    /** Tab ẩn rồi hiện lại (visibilitychange), cộng `skewMs` vào đồng hồ của trang trước đó. */
    const hideAndShow = (skewMs: number) =>
      page.evaluate((ms) => {
        const w = window as unknown as { __skew: number };
        w.__skew += ms;
        const set = (v: DocumentVisibilityState) => {
          Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => v });
          document.dispatchEvent(new Event('visibilitychange'));
        };
        set('hidden');
        set('visible');
      }, skewMs);
    const base = await updates();
    // Vừa đăng ký (= một lần kiểm tra) → quay lại tab ngay: chưa hỏi lại.
    await hideAndShow(60_000);
    expect(await updates()).toBe(base);
    // Quá 5 phút → quay lại tab = hỏi lại sw.js ngay (không cần tải lại trang).
    await hideAndShow(5 * 60_000);
    await expect.poll(updates).toBe(base + 1);
    // Ngay sau đó thêm lần nữa: giãn tối thiểu 5 phút.
    await hideAndShow(30_000);
    expect(await updates()).toBe(base + 1);
    // Không có bản mới → không hiện "Có bản mới".
    await expect(page.getByText('Có bản mới')).toHaveCount(0);
    expect(errors).toEqual([]);
  });
});

test.describe('bản 1 file (build:single) mở từ file://', () => {
  test.beforeAll(() => {
    test.setTimeout(240_000);
    execFileSync(process.execPath, [VITE_BIN, 'build', '--mode', 'single', '--logLevel', 'warn'], {
      cwd: ROOT,
      stdio: 'inherit',
    });
    expect(existsSync(SINGLE_HTML)).toBe(true);
  });

  test('màn chơi, Phát → ô rơi, ◂ Thư viện, Editor + MIDI (chunk inline), không lỗi console', async ({
    page,
  }) => {
    const errors = collectErrors(page);
    const fileUrl = pathToFileURL(SINGLE_HTML).href;
    // Mọi request ngoài chính index.html (data: URI của icon không tính).
    const others: string[] = [];
    page.on('request', (req) => {
      const url = req.url().split('#')[0];
      if (url !== fileUrl && !url.startsWith('data:')) others.push(url);
    });
    await page.goto(fileUrl);
    await playStartsTiles(page);
    await openLibraryFromMenu(page);

    await goHash(page, `#/edit/${SEED1.id}`);
    await expect(
      page.getByRole('heading', { level: 1, name: `Sửa: ${SEED1.title}` }),
    ).toBeVisible();
    // Overlay (chunk lười, inline) — nền chroma cả trang.
    await goHash(page, `#/overlay/${SEED1.id}?bg=chroma`);
    await expect(page.getByRole('region', { name: 'Overlay OBS' })).toBeVisible();
    expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe(
      'rgb(0, 255, 0)',
    );
    await midiWizardLoadsFile(page);

    // Không service worker, không tải file nào ngoài chính index.html (JS/CSS/chunk/icon đều inline).
    expect(await page.evaluate(() => navigator.serviceWorker?.controller ?? null)).toBeNull();
    expect(others).toEqual([]);
    expect(errors).toEqual([]);
  });
});

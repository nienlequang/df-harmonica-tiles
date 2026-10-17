import type { BrowserContext, Page } from '@playwright/test';

/**
 * Tiện ích dùng chung cho mọi spec e2e (file không có `.spec` nên Playwright không chạy như test).
 */

/**
 * Clipboard giả trong trang (bộ nhớ): app vẫn gọi `navigator.clipboard.writeText` như thật, nhưng
 * chạy test không ghi đè clipboard hệ điều hành của người dùng (Edge headless trên Windows dùng
 * clipboard thật) và không cần cấp quyền. Gọi trong `test.beforeEach` của MỌI spec.
 */
export async function stubClipboard(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    let store = '';
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: (text: string) => {
          store = String(text);
          return Promise.resolve();
        },
        readText: () => Promise.resolve(store),
      },
    });
  });
}

/** Gom console.error + lỗi JS chưa bắt của trang. */
export function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const loc = msg.location();
    errors.push(`console.error: ${msg.text()}${loc.url ? ` (${loc.url}:${loc.lineNumber})` : ''}`);
  });
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  return errors;
}

/** Nội dung app vừa "sao chép" (clipboard giả của trang). */
export async function readClipboard(page: Page): Promise<string> {
  return page.evaluate(() => navigator.clipboard.readText());
}

/** Số màu khác nhau lấy mẫu trên canvas — > vài màu nghĩa là đã vẽ lane/tile, không trống. */
export async function canvasColorCount(page: Page): Promise<number> {
  return page.locator('canvas.player-canvas').evaluate((el) => {
    const canvas = el as HTMLCanvasElement;
    const ctx = canvas.getContext('2d');
    if (!ctx || canvas.width === 0 || canvas.height === 0) return 0;
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const seen = new Set<number>();
    // Bước lẻ (97 px) để không trùng nhịp với lưới lane.
    for (let i = 0; i < data.length && seen.size < 64; i += 4 * 97) {
      seen.add((data[i] << 16) | (data[i + 1] << 8) | data[i + 2]);
    }
    return seen.size;
  });
}

/**
 * "Chữ ký" điểm ảnh của canvas (hash FNV-1a trên mẫu thưa): hai lần đo khác nhau = khung hình đã
 * đổi (ô đang rơi). Mẫu bước lẻ phủ đều cả chiều cao để bắt được ô dịch vài pixel.
 */
export async function canvasSignature(page: Page): Promise<number> {
  return page.locator('canvas.player-canvas').evaluate((el) => {
    const canvas = el as HTMLCanvasElement;
    const ctx = canvas.getContext('2d');
    if (!ctx || canvas.width === 0 || canvas.height === 0) return 0;
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let h = 0x811c9dc5;
    for (let i = 0; i < data.length; i += 4 * 13) {
      h ^= (data[i] << 16) | (data[i + 1] << 8) | data[i + 2];
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h;
  });
}

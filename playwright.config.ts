import { defineConfig } from '@playwright/test';

/**
 * Smoke e2e (spec §9). Local: Microsoft Edge có sẵn (`channel: 'msedge'`, không tải browser — D-005).
 * CI đặt `PW_CHANNEL=chromium` sau `npx playwright install chromium`.
 * Không nằm trong `npm run check`; chạy bằng `npm run test:e2e`.
 */
const PORT = 4173;
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: 'e2e',
  reporter: 'list',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: BASE_URL,
    channel: process.env.PW_CHANNEL || 'msedge',
    headless: true,
    viewport: { width: 1366, height: 900 },
    trace: 'retain-on-failure',
    // Bản build có service worker (PWA, Phase 3). Spec thường chặn SW để chạy xác định (không có
    // thông báo "sẵn sàng offline" chen vào, request không đi qua SW); e2e/pwa.spec.ts cho phép lại.
    serviceWorkers: 'block',
  },
  webServer: {
    command: `npm run build && npx vite preview --port ${PORT} --strictPort`,
    url: BASE_URL,
    reuseExistingServer: true,
    timeout: 180_000,
  },
});

/// <reference types="vitest/config" />
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { defineConfig, loadEnv } from 'vite';
import type { Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import type { VitePWAOptions } from 'vite-plugin-pwa';
import { viteSingleFile } from 'vite-plugin-singlefile';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  version: string;
};

/**
 * Commit của bản build cho trang Dev notes (`#/dev`): Vercel build lại từ source (không có .git) nên
 * scripts/deploy.mjs truyền `DFHT_COMMIT` qua `--build-env`; build / dev server local đọc git (`-dirty` nếu cây
 * làm việc có thay đổi chưa commit, kể cả file mới chưa add); không có git → '' (trang ghi "không rõ").
 */
function buildCommit(): string {
  const fromEnv = process.env.DFHT_COMMIT || process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7);
  if (fromEnv) return fromEnv;
  const git = (args: string[]) =>
    execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  try {
    const sha = git(['rev-parse', '--short', 'HEAD']);
    // `status --porcelain` tính cả file MỚI chưa add (diff HEAD thì không): commit thiếu file mới → vẫn -dirty.
    // `--no-optional-locks`: không ghi lại index (chỉ đọc).
    return git(['--no-optional-locks', 'status', '--porcelain']) === '' ? sha : `${sha}-dirty`;
  } catch {
    return '';
  }
}

/**
 * PWA (spec §7): manifest + precache toàn bộ dist, cập nhật theo kiểu "prompt" (UpdatePrompt hỏi
 * người dùng, không tự tải lại). Tên file ra: `sw.js`, `workbox-<hash>.js`, `manifest.webmanifest`
 * (khớp header trong vercel.json; không có registerSW.js vì `injectRegister: null`).
 */
const PWA_OPTIONS: Partial<VitePWAOptions> = {
  registerType: 'prompt',
  // Tự đăng ký trong src/ui/pwa.ts (import 'virtual:pwa-register').
  injectRegister: null,
  // Icon đã nằm trong globPatterns bên dưới (tránh khai trùng trong precache).
  includeManifestIcons: false,
  manifest: {
    name: 'Delta Force Harmonica Tiles',
    short_name: 'Harmonica Tiles',
    description:
      'Guide thổi harmonica trong Delta Force kiểu Piano Tiles — ô rơi theo nhịp, chạy offline.',
    lang: 'vi',
    // Tương đối với manifest.webmanifest → đúng với mọi base (VITE_BASE).
    start_url: './',
    scope: './',
    display: 'standalone',
    background_color: '#0a0c0e',
    theme_color: '#0a0c0e',
    icons: [
      { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
      {
        src: 'icons/icon-maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
      { src: 'icons/icon.svg', sizes: 'any', type: 'image/svg+xml' },
    ],
  },
  workbox: {
    // Precache toàn bộ dist, cả chunk tải lười (Editor, MIDI, @tonejs/midi) → offline hoàn toàn.
    globPatterns: ['**/*.{js,css,html,svg,png,ico,webmanifest,woff2}'],
    // manifest.webmanifest plugin tự thêm vào precache (kèm revision) → bỏ khỏi glob cho khỏi khai
    // hai lần. sw.js / workbox-*.js workbox-build tự loại. `assets/*.png` = ảnh minh họa của trang Hướng
    // dẫn (docs/images, ~600 KB, D-260): tải khi mở trang, không bắt mọi người cài app tải trước; offline
    // trang hiện chú thích thay ảnh. Icon PWA nằm ở icons/, không bị loại.
    globIgnores: ['**/node_modules/**/*', 'manifest.webmanifest', 'assets/*.png'],
    cleanupOutdatedCaches: true,
    navigateFallback: 'index.html',
    // Lần cài đầu: SW nhận luôn trang đang mở (offline được ngay, không cần tải lại). Bản cập nhật
    // vẫn chờ người dùng bấm "Tải lại" (không skipWaiting tự động).
    clientsClaim: true,
  },
};

const ICON_MIME: Record<string, string> = { svg: 'image/svg+xml', png: 'image/png' };

/**
 * Bản 1 file: thay `href` của các `<link>` icon trỏ vào `public/icons/…` bằng data URI (bản này
 * không chép thư mục public — `dist-single/` chỉ có `index.html`, mở được từ file://).
 */
function inlineHtmlIcons(): Plugin {
  return {
    name: 'dfht:inline-html-icons',
    apply: 'build',
    transformIndexHtml: {
      order: 'pre',
      handler: (html) =>
        html.replace(/href="\/(icons\/[\w.-]+\.(svg|png))"/g, (_m, file: string, ext: string) => {
          const data = readFileSync(new URL(`./public/${file}`, import.meta.url));
          return `href="data:${ICON_MIME[ext]};base64,${data.toString('base64')}"`;
        }),
    },
  };
}

/**
 * Vitest: module runner không nạp được id ảo của vite-plugin-pwa (`/@vite-plugin-pwa/…` bị hiểu là
 * đường dẫn file) → thay bằng module ảo `\0` tự viết, `registerSW` rỗng. Test cần hành vi thì
 * `vi.mock('virtual:pwa-register')`.
 */
function pwaRegisterTestStub(): Plugin {
  const resolved = '\0virtual:pwa-register';
  return {
    name: 'dfht:pwa-register-test-stub',
    enforce: 'pre',
    resolveId: (source) => (source === 'virtual:pwa-register' ? resolved : undefined),
    load: (id) =>
      id === resolved ? 'export function registerSW() { return async () => {}; }' : undefined,
  };
}

// `--mode single` = bản 1 file HTML (dist-single/index.html): inline mọi JS/CSS (cả chunk tải lười)
// và icon, không PWA.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const single = mode === 'single';
  const base = single ? './' : env.VITE_BASE || '/';
  const vitest = process.env.VITEST !== undefined;

  return {
    base,
    // Bản 1 file không chép public/ (icon đã inline vào index.html).
    publicDir: single ? false : 'public',
    plugins: [
      react(),
      // Bản 1 file vẫn nạp plugin PWA để `virtual:pwa-register` resolve, nhưng `disable`: không
      // manifest, không sw.js, module ảo là hàm rỗng. Dev: không sinh SW (devOptions mặc định tắt).
      vitest ? pwaRegisterTestStub() : VitePWA({ ...PWA_OPTIONS, disable: single }),
      ...(single ? [inlineHtmlIcons(), viteSingleFile()] : []),
    ],
    define: {
      __APP_VERSION__: JSON.stringify(pkg.version),
      __SINGLE_FILE__: JSON.stringify(single),
      // Trang Dev notes. Vitest: luôn '' (test không phụ thuộc git / giờ của máy).
      __BUILD_COMMIT__: JSON.stringify(vitest ? '' : buildCommit()),
      __BUILD_DATE__: JSON.stringify(vitest ? '' : new Date().toISOString()),
    },
    build: {
      outDir: single ? 'dist-single' : 'dist',
      emptyOutDir: true,
      target: 'es2022',
    },
    test: {
      environment: 'jsdom',
      include: ['src/**/*.test.{ts,tsx}'],
      setupFiles: ['src/test/setup.ts'],
      restoreMocks: true,
      // Cả suite chạy ~40 file jsdom song song (dựng jsdom chiếm phần lớn CPU): test ~1 s khi chạy
      // riêng có thể vượt mặc định 5 s lúc CPU bị tranh. Không test nào chờ thời gian thật (clock
      // giả / rAF chạy tay; waitFor chỉ chờ promise), nên timeout chỉ để bắt treo.
      testTimeout: 15_000,
      // Mỗi worker dựng jsdom riêng (vài trăm MB): mặc định (số CPU − 1 fork) trên máy 12 luồng / 16 GB
      // đang mở nhiều app từng làm worker không khởi động kịp 60 s ("Timeout waiting for worker to
      // respond"). Một nửa số CPU: chậm hơn ~25% nhưng ổn định.
      maxWorkers: '50%',
    },
  };
});

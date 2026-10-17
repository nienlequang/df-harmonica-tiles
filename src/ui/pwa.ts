/// <reference types="vite-plugin-pwa/vanillajs" />
import { registerSW } from 'virtual:pwa-register';
import { create } from 'zustand';

/**
 * PWA: đăng ký service worker (vite-plugin-pwa, `registerType: 'prompt'`, `injectRegister: null` —
 * vite.config.ts) và giữ trạng thái cho `UpdatePrompt`.
 *
 * - Lần cài đầu xong → `offlineReady` (thông báo một lần: sự kiện chỉ có khi SW cài lần đầu).
 * - Bản mới đã tải về, SW mới đang chờ → `needRefresh`; người dùng bấm "Tải lại" → `applyUpdate()`
 *   nhắn SW mới `skipWaiting`, SW mới nhận trang thì tải lại. Không bao giờ tự tải lại khi người
 *   dùng chưa bấm (đang chơi / đang soạn dở): tab khác bấm "Tải lại" thì tab này chỉ hiện lại nhắc.
 * - Bản 1 file (`build:single`, file://), dev và test: không đăng ký (module ảo là hàm rỗng, và
 *   `canUseServiceWorker()` chặn trước).
 * - Tự kiểm tra bản mới (vòng R7, `watchForUpdates`): trình duyệt chỉ tự hỏi lại sw.js khi điều hướng —
 *   app một trang mở cả buổi stream thì không bao giờ thấy bản mới. Nên: quay lại tab (visibilitychange →
 *   visible, tối đa mỗi UPDATE_CHECK_MIN_GAP_MS một lần) và mỗi UPDATE_CHECK_INTERVAL_MS khi tab đang hiện
 *   → `registration.update()`; có bản mới thì "Có bản mới → Tải lại" hiện như thường.
 */

/** Đang mở tab: kiểm tra bản mới định kỳ (ms). */
export const UPDATE_CHECK_INTERVAL_MS = 45 * 60_000;
/** Quay lại tab: kiểm tra ngay, nhưng không dày hơn khoảng này (ms) — tính cả lần kiểm tra định kỳ. */
export const UPDATE_CHECK_MIN_GAP_MS = 5 * 60_000;

/** Phần ServiceWorkerRegistration dùng tới (test truyền object giả). */
export interface UpdatableRegistration {
  update(): Promise<unknown>;
}

export interface WatchUpdatesDeps {
  /** Document theo dõi visibilitychange. Mặc định document. */
  doc?: Pick<Document, 'visibilityState' | 'addEventListener' | 'removeEventListener'>;
  /** Đồng hồ (ms). Mặc định Date.now. */
  now?: () => number;
  /** Đang offline thì bỏ lượt (không gọi update → không có lỗi mạng vô ích). Mặc định navigator.onLine. */
  isOnline?: () => boolean;
}

/**
 * Hỏi lại service worker định kỳ (`registration.update()`): khi tab hiện lại (giãn tối thiểu
 * UPDATE_CHECK_MIN_GAP_MS từ lần trước) và mỗi UPDATE_CHECK_INTERVAL_MS khi tab đang hiện. Lỗi mạng bỏ qua
 * (lần sau thử lại). Lần đăng ký vừa xong tính là một lần kiểm tra. Trả hàm dừng.
 */
export function watchForUpdates(
  registration: UpdatableRegistration,
  deps: WatchUpdatesDeps = {},
): () => void {
  const doc = deps.doc ?? (typeof document !== 'undefined' ? document : null);
  const now = deps.now ?? Date.now;
  const isOnline =
    deps.isOnline ?? (() => typeof navigator === 'undefined' || navigator.onLine !== false);
  let last = now();
  let busy = false;
  const check = (): void => {
    if (busy) return;
    if (doc && doc.visibilityState !== 'visible') return;
    if (!isOnline()) return;
    const t = now();
    if (t - last < UPDATE_CHECK_MIN_GAP_MS) return;
    last = t;
    busy = true;
    let p: Promise<unknown>;
    try {
      p = registration.update();
    } catch {
      busy = false;
      return;
    }
    p.then(
      () => {
        busy = false;
      },
      () => {
        // offline / máy chủ lỗi: thử lại ở lượt sau, không làm phiền người dùng
        busy = false;
      },
    );
  };
  const onVisibility = (): void => {
    if (doc && doc.visibilityState === 'visible') check();
  };
  doc?.addEventListener('visibilitychange', onVisibility);
  const timer = setInterval(check, UPDATE_CHECK_INTERVAL_MS);
  return () => {
    clearInterval(timer);
    doc?.removeEventListener('visibilitychange', onVisibility);
  };
}

export interface PwaState {
  /** Có bản mới (SW mới đang chờ) — hiện "Có bản mới — Tải lại". */
  needRefresh: boolean;
  /** SW vừa cài lần đầu: app đã chạy được offline — hiện thông báo một lần. */
  offlineReady: boolean;
}

export const usePwa = create<PwaState>()(() => ({ needRefresh: false, offlineReady: false }));

/**
 * Bấm "Tải lại" mà SW mới không nhận trang trong khoảng này (vd. tab khác đã kích hoạt nó, không
 * còn SW nào chờ) → tự tải lại trang.
 */
export const RELOAD_FALLBACK_MS = 2500;

type UpdateServiceWorker = (reloadPage?: boolean) => Promise<void>;

const defaultReload = (): void => window.location.reload();

let started = false;
let updateServiceWorker: UpdateServiceWorker | undefined;
let reloadRequested = false;
let fallbackTimer: ReturnType<typeof setTimeout> | undefined;
let reloadImpl: () => void = defaultReload;
let stopWatch: (() => void) | undefined;

function reloadPage(): void {
  if (fallbackTimer !== undefined) clearTimeout(fallbackTimer);
  fallbackTimer = undefined;
  reloadImpl();
}

/**
 * Service worker chỉ có trên http(s) (localhost hoặc HTTPS), không có ở bản 1 file / file://.
 * Trong cửa sổ Tauri (asset đóng gói sẵn trong app) cũng không đăng ký: SW chỉ làm app desktop chạy
 * bản cũ trong cache sau khi cập nhật.
 */
export function canUseServiceWorker(): boolean {
  if (__SINGLE_FILE__) return false;
  if ('__TAURI__' in window) return false;
  const { protocol } = window.location;
  if (protocol !== 'https:' && protocol !== 'http:') return false;
  return 'serviceWorker' in navigator && Boolean(navigator.serviceWorker);
}

/**
 * Đăng ký SW (một lần cho cả phiên; gọi lại không làm gì). SW đăng ký sau sự kiện `load` của trang
 * (mặc định của workbox-window) để không tranh băng thông với lần tải đầu.
 */
export function startPwa(): void {
  if (started) return;
  started = true;
  if (!canUseServiceWorker()) return;
  updateServiceWorker = registerSW({
    onNeedRefresh: () => usePwa.setState({ needRefresh: true }),
    onOfflineReady: () => usePwa.setState({ offlineReady: true }),
    // Đăng ký xong → tự kiểm tra bản mới khi quay lại tab / định kỳ (một bộ theo dõi cho cả phiên).
    onRegisteredSW: (_url: string, registration: ServiceWorkerRegistration | undefined) => {
      if (!registration || stopWatch) return;
      stopWatch = watchForUpdates(registration);
    },
    // SW mới vừa nhận trang này. Mặc định plugin tự tải lại MỌI tab — ở đây chỉ tab đã bấm "Tải lại".
    onNeedReload: () => {
      if (reloadRequested) reloadPage();
      else usePwa.setState({ needRefresh: true });
    },
    onRegisterError: (error: unknown) => {
      // Không chặn app (vẫn chạy online); không dùng console.error (smoke e2e đòi console sạch).
      console.warn('[pwa] service worker registration failed', error);
    },
  });
}

/** Nút "Tải lại": kích hoạt bản mới rồi tải lại trang. */
export async function applyUpdate(): Promise<void> {
  usePwa.setState({ needRefresh: false });
  reloadRequested = true;
  if (fallbackTimer !== undefined) clearTimeout(fallbackTimer);
  fallbackTimer = setTimeout(reloadPage, RELOAD_FALLBACK_MS);
  if (!updateServiceWorker) {
    reloadPage();
    return;
  }
  try {
    await updateServiceWorker(true);
  } catch (error: unknown) {
    console.warn('[pwa] update failed', error);
    reloadPage();
  }
}

/** "Để sau": ẩn nhắc bản mới trong phiên này (lần mở app sau sẽ nhắc lại). */
export function dismissUpdate(): void {
  usePwa.setState({ needRefresh: false });
}

export function dismissOfflineReady(): void {
  usePwa.setState({ offlineReady: false });
}

/**
 * Chỉ cho test: trả module về trạng thái ban đầu; `reload` thay `location.reload()` (jsdom không
 * tải lại trang được).
 */
export function resetPwaForTests(opts: { reload?: () => void } = {}): void {
  started = false;
  updateServiceWorker = undefined;
  reloadRequested = false;
  stopWatch?.();
  stopWatch = undefined;
  if (fallbackTimer !== undefined) clearTimeout(fallbackTimer);
  fallbackTimer = undefined;
  reloadImpl = opts.reload ?? defaultReload;
  usePwa.setState({ needRefresh: false, offlineReady: false });
}

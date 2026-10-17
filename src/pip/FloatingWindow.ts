/**
 * "Cửa sổ nổi" (SPEC 2026-10-14, cho người chơi 1 màn hình — không bắt tải gì): cửa sổ nhỏ LUÔN
 * NẰM TRÊN mọi cửa sổ bằng Document Picture-in-Picture (Chrome / Edge 116+, Firefox 151+), chỉ có
 * 8 làn ô rơi kiểu "khớp bảng phím game" (FloatingStage).
 *
 * Vòng đời:
 * - `openFloatingWindow(songId)` gọi từ click (requestWindow cần user activation — gọi ĐỒNG BỘ,
 *   trước mọi await): kích thước = lần trước TRÊN ĐÚNG MÀN HÌNH NÀY, không có thì cỡ chuẩn theo màn hình
 *   (pipPrefs: rộng = khung bảng phím PC của game — 8 làn đúng bước phím + đệm hai bên, v1.0.1 — + gutter, cao
 *   ngoài = từ mép trên màn hình tới mép trên bảng phím — bổ sung trước deploy C). Mở xong: chép stylesheet + theme + ngôn ngữ (pipDocument), mount React root RIÊNG
 *   trong document của cửa sổ nổi (portal qua 2 document không tin cậy); cỡ chuẩn → đo thanh tiêu đề thật,
 *   nhớ cho lần sau, chỉnh cao ngay nếu trình duyệt cho (`fitOuterHeight`); nhớ kích thước khi người dùng
 *   đổi cỡ (đúng cỡ chuẩn thì không nhớ — lần sau tính lại theo thanh tiêu đề đã đo). Cỡ vượt trần 25 % diện tích
 *   màn của Chrome (màn 4:3 / 5:4): xin đúng bề ngang, chiều cao hạ, rồi `fitOuterHeight` kéo cao lên (D-418); sau
 *   "Đặt lại cỡ chuẩn" bị từ chối, lần mở sau xin `preferInitialWindowPlacement` (D-419).
 * - Chỉ một cửa sổ nổi: mở lại khi đang mở = đổi bài trong cửa sổ đó + focus.
 * - Đóng (nút X của cửa sổ, `closeFloatingWindow()`, tab gốc đóng): 'pagehide' → gỡ root (engine
 *   detach: hủy rAF / timer / scheduler), listener, observer — không leak.
 * Trình duyệt không có API → 'unsupported' (nút hiện một dòng giải thích); requestWindow bị từ
 * chối (không có activation…) → 'blocked'.
 */
import { createElement, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { FloatingStage } from './FloatingStage';
import { syncDocument } from './pipDocument';
import {
  PIP_SIZE_TOLERANCE,
  fitOuterHeight,
  forgetRememberedSize,
  initialWindowPlan,
  measureChromeHeight,
  rememberChromeHeight,
  rememberSize,
  requestInitialPlacementOnce,
  screenOf,
  standardPlan,
  takeInitialPlacement,
} from './pipPrefs';
import type { PipSize, WindowPlan } from './pipPrefs';
import './pip.css';

export type OpenFloatingResult = 'opened' | 'unsupported' | 'blocked';

export interface FloatingWindowState {
  open: boolean;
  /** Bài đang hiện trong cửa sổ nổi (null khi đóng). */
  songId: string | null;
  /** Trình duyệt có Document Picture-in-Picture. */
  supported: boolean;
}

/** Phần API Document Picture-in-Picture app dùng (lib DOM của TS chưa khai báo). */
export interface DocumentPictureInPictureLike {
  requestWindow(options?: {
    width?: number;
    height?: number;
    /** Chrome 130+: bỏ cỡ / chỗ đã nhớ của lần mở trước trong tab (D-419). */
    preferInitialWindowPlacement?: boolean;
  }): Promise<Window>;
  readonly window?: Window | null;
}

/** Ghi kích thước sau khi ngừng kéo giãn chừng này (ms). */
export const SIZE_SAVE_DEBOUNCE_MS = 250;
/** Mở xong mà chưa đo được thanh tiêu đề (cửa sổ chưa hiện hẳn) → đo lại một lần sau chừng này (ms). */
export const CHROME_RETRY_MS = 300;
/** Class trên `<html>` / `<body>` / container của document cửa sổ nổi (pip.css). */
export const PIP_DOC_CLASS = 'pip-doc';
export const PIP_ROOT_CLASS = 'pip-root';

/** `documentPictureInPicture` của `win` nếu dùng được. */
export function getDocumentPip(win: Window = window): DocumentPictureInPictureLike | null {
  if (!('documentPictureInPicture' in win)) return null;
  const api = (win as Window & { documentPictureInPicture?: unknown }).documentPictureInPicture;
  if (api === null || typeof api !== 'object') return null;
  return typeof (api as Partial<DocumentPictureInPictureLike>).requestWindow === 'function'
    ? (api as DocumentPictureInPictureLike)
    : null;
}

export function isFloatingWindowSupported(): boolean {
  return typeof window !== 'undefined' && getDocumentPip(window) !== null;
}

// ---------------------------------------------------------------------------
// State cho React (một cửa sổ nổi cho cả app)
// ---------------------------------------------------------------------------

let state: FloatingWindowState = { open: false, songId: null, supported: false };
const listeners = new Set<() => void>();

function publish(patch: Partial<FloatingWindowState>): void {
  const next = { ...state, ...patch };
  if (
    next.open === state.open &&
    next.songId === state.songId &&
    next.supported === state.supported
  ) {
    return;
  }
  state = next;
  for (const fn of Array.from(listeners)) {
    try {
      fn();
    } catch (err) {
      console.error(err);
    }
  }
}

/** State hiện tại (feature detect lại mỗi lần đọc; object giữ nguyên khi không đổi). */
export function getFloatingWindowState(): FloatingWindowState {
  const supported = isFloatingWindowSupported();
  if (supported !== state.supported) state = { ...state, supported };
  return state;
}

export function subscribeFloatingWindow(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** `{ open, songId, supported }` — re-render khi cửa sổ nổi mở / đóng / đổi bài. */
export function useFloatingWindowState(): FloatingWindowState {
  return useSyncExternalStore(
    subscribeFloatingWindow,
    getFloatingWindowState,
    getFloatingWindowState,
  );
}

// ---------------------------------------------------------------------------
// Phiên cửa sổ nổi
// ---------------------------------------------------------------------------

interface Session {
  readonly win: Window;
  songId: string;
  show(songId: string): void;
  dispose(): void;
}

let session: Session | null = null;
let pending: Promise<OpenFloatingResult> | null = null;

function focusSafely(win: Window): void {
  try {
    win.focus();
  } catch {
    // một số trình duyệt không cho focus cửa sổ PiP bằng script
  }
}

const near = (a: number, b: number): boolean => Math.abs(a - b) <= PIP_SIZE_TOLERANCE + 1;
const sameSize = (a: PipSize, b: PipSize): boolean =>
  near(a.width, b.width) && near(a.height, b.height);

/**
 * Dựng nội dung trong cửa sổ `win` (đã mở bằng requestWindow — hoặc cửa sổ bất kỳ cùng origin, cho
 * test / xem thử) và đăng ký làm cửa sổ nổi hiện tại (phiên cũ nếu có bị dọn trước). `plan` = cách đã mở
 * (`initialWindowPlan`): cỡ chuẩn (`outerHeight` khác null) → đo thanh tiêu đề + chỉnh cao ngoài.
 */
export function mountFloatingWindow(win: Window, songId: string, plan?: WindowPlan): void {
  session?.dispose();
  const doc = win.document;
  const stopSync = syncDocument(document, doc);
  doc.documentElement.classList.add(PIP_DOC_CLASS);
  doc.body.classList.add(PIP_DOC_CLASS);
  const container = doc.createElement('div');
  container.className = PIP_ROOT_CLASS;
  doc.body.append(container);
  const root: Root = createRoot(container);

  let disposed = false;
  let saveTimer: number | null = null;
  let chromeTimer: number | null = null;
  let lastSize: PipSize | null = null;
  // Cỡ TRONG đã xin / muốn có khi mở ở cỡ chuẩn (thanh tiêu đề còn là số đoán; chiều cao bị trần 25 % hạ) — cũng
  // coi là "cỡ chuẩn".
  const openedStandard = plan?.kind === 'standard' ? [plan.size, plan.target] : [];

  const flushSize = (): void => {
    if (saveTimer !== null) {
      win.clearTimeout(saveTimer);
      saveTimer = null;
    }
    const size = lastSize;
    lastSize = null;
    if (!size) return;
    const chrome = measureChromeHeight(win);
    if (chrome !== null) rememberChromeHeight(chrome);
    // Đúng cỡ chuẩn (vừa mở / sau "Đặt lại cỡ chuẩn" / do fitOuterHeight chỉnh) = không phải lựa chọn của
    // người dùng → không nhớ: lần mở sau tính lại cỡ chuẩn với thanh tiêu đề đã đo (đúng hơn số đoán).
    const screen = screenOf(win);
    const standard = standardPlan(screen);
    if ([standard.target, standard.size, ...openedStandard].some((s) => sameSize(size, s))) {
      forgetRememberedSize();
      return;
    }
    rememberSize(size, screen);
  };
  const onResize = (): void => {
    const width = win.innerWidth;
    const height = win.innerHeight;
    if (!(width > 0 && height > 0)) return;
    lastSize = { width, height };
    if (saveTimer !== null) win.clearTimeout(saveTimer);
    saveTimer = win.setTimeout(flushSize, SIZE_SAVE_DEBOUNCE_MS);
  };
  const onPageHide = (): void => {
    s.dispose();
  };

  const s: Session = {
    win,
    songId,
    show(id: string): void {
      if (disposed) return;
      s.songId = id;
      // key = id: đổi bài → mount lại engine (như Player đổi bài).
      root.render(createElement(FloatingStage, { key: id, songId: id, hostWindow: win }));
      if (session === s) publish({ open: true, songId: id });
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      if (chromeTimer !== null) {
        win.clearTimeout(chromeTimer);
        chromeTimer = null;
      }
      win.removeEventListener('resize', onResize);
      win.removeEventListener('pagehide', onPageHide);
      flushSize();
      stopSync();
      try {
        root.unmount();
      } catch (err) {
        console.error(err);
      }
      container.remove();
      if (session === s) {
        session = null;
        publish({ open: false, songId: null });
      }
    },
  };

  win.addEventListener('resize', onResize);
  win.addEventListener('pagehide', onPageHide);
  session = s;
  s.show(songId);
  // Cỡ chuẩn: cao NGOÀI phải chạm mép trên màn hình khi mép dưới nằm trên bảng phím game → đo thanh tiêu
  // đề thật (nhớ cho lần sau) và chỉnh ngay nếu trình duyệt cho (cả bề ngang, nếu trình duyệt đã thu nhỏ cỡ xin —
  // D-418); chưa đo được → thử lại một lần.
  const outer = plan?.outerHeight ?? null;
  const width = plan?.target.width;
  if (outer !== null && fitOuterHeight(win, outer, undefined, width) === 'unmeasured') {
    chromeTimer = win.setTimeout(() => {
      chromeTimer = null;
      if (!disposed) fitOuterHeight(win, outer, undefined, width);
    }, CHROME_RETRY_MS);
  }
}

/**
 * Mở cửa sổ nổi cho bài `songId` — GỌI TRONG CLICK (requestWindow cần user activation). Đang mở thì
 * đổi bài trong cửa sổ đó + focus ('opened').
 */
export function openFloatingWindow(songId: string): Promise<OpenFloatingResult> {
  const api = typeof window !== 'undefined' ? getDocumentPip(window) : null;
  publish({ supported: api !== null });
  if (!api) return Promise.resolve('unsupported');
  if (session) {
    if (session.songId !== songId) session.show(songId);
    focusSafely(session.win);
    return Promise.resolve('opened');
  }
  if (pending) return pending;
  const plan = initialWindowPlan(window);
  const size = plan.size;
  const initialPlacement = takeInitialPlacement();
  let request: Promise<Window>;
  try {
    // Đồng bộ, ngay trong click: chưa có await nào trước dòng này.
    request = api.requestWindow({
      width: size.width,
      height: size.height,
      ...(initialPlacement ? { preferInitialWindowPlacement: true } : {}),
    });
  } catch {
    if (initialPlacement) requestInitialPlacementOnce();
    return Promise.resolve('blocked');
  }
  const run = Promise.resolve(request).then(
    (win): OpenFloatingResult => {
      try {
        mountFloatingWindow(win, songId, plan);
        return 'opened';
      } catch (err) {
        console.error('[pip] mount failed', err);
        try {
          win.close();
        } catch {
          // bỏ qua
        }
        return 'blocked';
      }
    },
    (): OpenFloatingResult => 'blocked',
  );
  const p = run.finally(() => {
    if (pending === p) pending = null;
  });
  pending = p;
  return p;
}

/** Đóng cửa sổ nổi (nếu đang mở) và dọn sạch ngay. */
export function closeFloatingWindow(): void {
  const s = session;
  if (!s) return;
  s.dispose();
  try {
    s.win.close();
  } catch {
    // bỏ qua
  }
}

// Dev (HMR thay module này): đóng cửa sổ nổi của bản module cũ, tránh phiên mồ côi.
if (import.meta.hot) {
  import.meta.hot.dispose(() => closeFloatingWindow());
}

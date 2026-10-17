import { addNavigationInterceptor } from '../ui/router';

/**
 * Chặn điều hướng trong app (hash router) khi Editor có thay đổi chưa lưu.
 *
 * - Click link `#/…` cùng trang: chặn trước khi hash đổi (không sinh mục history thừa).
 * - Hash đổi bằng cách khác (Back/Forward, gõ URL, `location.hash = …`, `navigate()`): trả URL cũ
 *   bằng `history.replaceState`, chặn router nhận sự kiện, rồi báo `onBlocked(hash đích)` để hỏi
 *   người dùng (popstate tới trước hashchange khi Back). Hai đường cùng gọi một hàm kiểm tra:
 *   - interceptor của router (`addNavigationInterceptor`): listener router hỏi trước khi báo React
 *     — đường chính trên Chromium, nơi listener ở window chạy theo thứ tự đăng ký;
 *   - listener capture trên window: chạy trước listener thường khác theo chuẩn DOM (jsdom, Firefox).
 *   Gọi lần hai cho cùng sự kiện thì URL đã khớp → không chặn lại, không báo hai lần.
 * Rời trang hẳn (đóng tab, reload) do `beforeunload` lo, không thuộc helper này.
 */
export interface HashGuardOptions {
  /** true → chặn việc chuyển sang `nextHash` (dạng `#/…`). */
  shouldBlock(nextHash: string): boolean;
  /** Đã chặn: hash đích để hỏi xác nhận (rồi tự điều hướng nếu người dùng đồng ý). */
  onBlocked(nextHash: string): void;
}

function sameDocument(a: URL, b: URL): boolean {
  return a.origin === b.origin && a.pathname === b.pathname && a.search === b.search;
}

/** Cài guard; trả hàm gỡ (dọn mọi listener). */
export function installHashGuard(win: Window, opts: HashGuardOptions): () => void {
  let currentUrl = win.location.href;

  /** true = đã chặn (URL trả về như cũ). */
  const check = (e: Event): boolean => {
    if (e.type !== 'hashchange' && e.type !== 'popstate') return false;
    const nextUrl = win.location.href;
    if (nextUrl === currentUrl) return false;
    const nextHash = win.location.hash;
    if (!opts.shouldBlock(nextHash)) {
      currentUrl = nextUrl;
      return false;
    }
    // Listener khác (router) không thấy sự kiện; URL trả về như cũ.
    e.stopImmediatePropagation();
    win.history.replaceState(win.history.state, '', currentUrl);
    opts.onBlocked(nextHash);
    return true;
  };

  const onClick = (e: MouseEvent) => {
    if (e.defaultPrevented || e.button !== 0) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const target = e.target;
    if (!(target instanceof Element)) return;
    const a = target.closest('a[href]');
    if (!(a instanceof HTMLAnchorElement)) return;
    if ((a.target && a.target !== '_self') || a.hasAttribute('download')) return;
    let url: URL;
    let here: URL;
    try {
      url = new URL(a.href, win.location.href);
      here = new URL(win.location.href);
    } catch {
      return;
    }
    if (!sameDocument(url, here) || url.hash === here.hash || !url.hash) return;
    if (!opts.shouldBlock(url.hash)) return;
    e.preventDefault();
    opts.onBlocked(url.hash);
  };

  win.addEventListener('popstate', check, true);
  win.addEventListener('hashchange', check, true);
  win.document.addEventListener('click', onClick, true);
  const removeInterceptor = addNavigationInterceptor(check);
  return () => {
    win.removeEventListener('popstate', check, true);
    win.removeEventListener('hashchange', check, true);
    win.document.removeEventListener('click', onClick, true);
    removeInterceptor();
  };
}

/** So hai hash bỏ qua khác biệt percent-encoding (`%C4%91` vs `đ`). */
export function sameHash(a: string, b: string): boolean {
  if (a === b) return true;
  const dec = (s: string) => {
    try {
      return decodeURIComponent(s);
    } catch {
      return s;
    }
  };
  return dec(a) === dec(b);
}

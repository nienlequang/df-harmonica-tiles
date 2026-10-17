import { useSyncExternalStore } from 'react';

/**
 * Router hash tối giản (thay HashRouter, không thêm dep): chạy trên GitHub Pages và file://.
 *
 *   #/                     màn chơi đầy đủ với bài mẫu (src/home/demoSong.ts) — như #/play/:id
 *   #/library              thư viện
 *   #/play/:id             player
 *   #/edit/:id             editor
 *   #/overlay/:id?scale=…  overlay OBS (cũng nhận ?overlay=1&song=<id> trên location.search)
 *   #/s/<lz-string>        mở bài chia sẻ
 *   #/settings             cài đặt
 *   #/midi                 tạo bài từ MIDI
 *   #/record               tự chơi để tạo bài (thu phím / nút bấm như trong game)
 *   #/ai                   tạo bài với AI (sao chép prompt → AI → dán kết quả → Lưu)
 *   #/guide[/cam-am]?s=…   hướng dẫn trong app (README phần người dùng / prompt AI cảm âm), s = mục
 *   #/mini/:id?delay=…     trang mini cho cửa sổ nổi Android (thử nghiệm): chỉ làn + bàn nút, delay = đếm ngược
 *   #/dev?s=…              Dev notes (REFERENCE + phiên bản / commit + CHANGELOG): chỉ có link nhỏ ở chân trang
 *                          Hướng dẫn và Cài đặt, không có trên thanh điều hướng
 */
export type Route =
  | { name: 'home' }
  | { name: 'library' }
  | { name: 'play'; id: string }
  | { name: 'edit'; id: string }
  | { name: 'overlay'; id: string }
  | { name: 'share'; data: string }
  | { name: 'settings' }
  | { name: 'midi' }
  | { name: 'record' }
  | { name: 'ai' }
  | { name: 'guide'; doc: GuideDoc }
  | { name: 'mini'; id: string }
  | { name: 'dev' }
  | { name: 'not-found'; path: string };

/** Tài liệu của trang Hướng dẫn: README (phần người dùng) hoặc prompt AI cho cảm âm (D-260). */
export type GuideDoc = 'readme' | 'cam-am';

export interface RouteState {
  route: Route;
  /** Query gộp từ location.search và phần `?…` trong hash (hash thắng). */
  query: URLSearchParams;
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

export function parseLocation(hash: string, search: string): RouteState {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  const qIndex = raw.indexOf('?');
  const pathPart = qIndex >= 0 ? raw.slice(0, qIndex) : raw;
  const hashQuery = qIndex >= 0 ? raw.slice(qIndex + 1) : '';

  const query = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  new URLSearchParams(hashQuery).forEach((v, k) => query.set(k, v));

  // ?overlay=1&song=<id> (không cần hash)
  if (query.get('overlay') === '1' && (pathPart === '' || pathPart === '/')) {
    const id = query.get('song') ?? '';
    return { route: { name: 'overlay', id }, query };
  }

  const path = pathPart.replace(/\/+$/, '') || '/';
  const segs = path.split('/').filter(Boolean);
  const [head, ...rest] = segs;
  const arg = rest.join('/');

  let route: Route;
  if (segs.length === 0) route = { name: 'home' };
  else if (head === 'library' && !arg) route = { name: 'library' };
  else if (head === 'play' && arg) route = { name: 'play', id: safeDecode(arg) };
  else if (head === 'edit' && arg) route = { name: 'edit', id: safeDecode(arg) };
  else if (head === 'overlay' && arg) route = { name: 'overlay', id: safeDecode(arg) };
  else if (head === 'overlay') route = { name: 'overlay', id: query.get('song') ?? '' };
  // lz-string compressToEncodedURIComponent đã an toàn cho URL: giữ nguyên, không decode.
  else if (head === 's' && arg) route = { name: 'share', data: arg };
  else if (head === 'settings' && !arg) route = { name: 'settings' };
  else if (head === 'midi' && !arg) route = { name: 'midi' };
  else if (head === 'record' && !arg) route = { name: 'record' };
  else if (head === 'ai' && !arg) route = { name: 'ai' };
  else if (head === 'guide' && !arg) route = { name: 'guide', doc: 'readme' };
  else if (head === 'guide' && arg === 'cam-am') route = { name: 'guide', doc: 'cam-am' };
  else if (head === 'mini' && arg) route = { name: 'mini', id: safeDecode(arg) };
  else if (head === 'dev' && !arg) route = { name: 'dev' };
  else route = { name: 'not-found', path };

  return { route, query };
}

/** '/play/abc' → '#/play/abc'. Tự encode từng segment id khi dùng helper `paths`. */
export function href(path: string): string {
  return `#${path.startsWith('/') ? path : `/${path}`}`;
}

export const paths = {
  home: () => '/',
  library: () => '/library',
  play: (id: string) => `/play/${encodeURIComponent(id)}`,
  edit: (id: string) => `/edit/${encodeURIComponent(id)}`,
  overlay: (id: string) => `/overlay/${encodeURIComponent(id)}`,
  share: (data: string) => `/s/${data}`,
  settings: () => '/settings',
  midi: () => '/midi',
  record: () => '/record',
  /** Tạo bài với AI (góp ý 2026-10-16). */
  ai: () => '/ai',
  /** Hướng dẫn; `section` = id tiêu đề (slug kiểu GitHub) để cuộn tới. */
  guide: (doc: GuideDoc = 'readme', section?: string) =>
    `/guide${doc === 'cam-am' ? '/cam-am' : ''}${section ? `?s=${encodeURIComponent(section)}` : ''}`,
  /** Trang mini cho cửa sổ nổi Android (thử nghiệm). */
  mini: (id: string) => `/mini/${encodeURIComponent(id)}`,
  /** Dev notes (tài liệu tham khảo + CHANGELOG); `section` = id tiêu đề để cuộn tới. */
  dev: (section?: string) => `/dev${section ? `?s=${encodeURIComponent(section)}` : ''}`,
};

export function navigate(path: string, opts: { replace?: boolean } = {}): void {
  const target = href(path);
  if (opts.replace) {
    const url = `${window.location.pathname}${window.location.search}${target}`;
    window.history.replaceState(null, '', url);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  } else {
    window.location.hash = target;
  }
}

/**
 * Hàm chặn điều hướng (vd. Editor có thay đổi chưa lưu): trả `true` = đã chặn (tự trả URL cũ),
 * router bỏ qua sự kiện. Cần vì `popstate` / `hashchange` bắn thẳng ở `window`: Chromium chạy
 * listener ở window theo thứ tự đăng ký, capture KHÔNG được ưu tiên — guard cài sau router (vào
 * Editor từ thư viện) không chen trước được, và React kịp render route mới (microtask giữa hai
 * listener khi Back) làm gỡ luôn guard. Listener của router hỏi interceptor trước khi báo React.
 */
export type NavigationInterceptor = (event: Event) => boolean;

const interceptors = new Set<NavigationInterceptor>();

/** Đăng ký interceptor; trả hàm gỡ. */
export function addNavigationInterceptor(fn: NavigationInterceptor): () => void {
  interceptors.add(fn);
  return () => {
    interceptors.delete(fn);
  };
}

function subscribe(cb: () => void): () => void {
  const listener = (e: Event) => {
    for (const fn of [...interceptors]) if (fn(e)) return;
    cb();
  };
  window.addEventListener('hashchange', listener);
  window.addEventListener('popstate', listener);
  return () => {
    window.removeEventListener('hashchange', listener);
    window.removeEventListener('popstate', listener);
  };
}

const getSnapshot = () => `${window.location.hash}|${window.location.search}`;

let cacheKey = '';
let cacheState: RouteState = parseLocation('', '');

/** Route hiện tại; re-render khi hash đổi. */
export function useRoute(): RouteState {
  const key = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  if (key !== cacheKey) {
    cacheKey = key;
    cacheState = parseLocation(window.location.hash, window.location.search);
  }
  return cacheState;
}

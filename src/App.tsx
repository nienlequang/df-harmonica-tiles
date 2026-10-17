import { Component, lazy, Suspense, useLayoutEffect } from 'react';
import type { ReactNode } from 'react';
import { HomeView } from './home/HomeView';
import { useT } from './i18n/useT';
import { LibraryView } from './library/LibraryView';
import { PlayerView } from './player/PlayerView';
import { Button } from './ui/components';
import { FEATURES } from './ui/features';
import { useBackToPlayer } from './ui/lastPlayed';
import { PrefButtons } from './ui/PrefButtons';
import { href, paths, useRoute } from './ui/router';
import type { Route } from './ui/router';
import { useSettings } from './ui/settings';
import { SettingsView } from './ui/SettingsView';
import { ToastRegion } from './ui/toast';
import { UpdatePrompt } from './ui/UpdatePrompt';

// Editor / Share / MIDI tải theo route (chunk riêng): Player và Thư viện không phải tải chúng.
const EditorView = lazy(() =>
  import('./editor/EditorView').then((m) => ({ default: m.EditorView })),
);
const ShareView = lazy(() => import('./editor/ShareView').then((m) => ({ default: m.ShareView })));
const MidiImportView = lazy(() =>
  import('./midi/MidiImportView').then((m) => ({ default: m.MidiImportView })),
);
// "Tự chơi để tạo bài" (Phase 3b): bộ ghi + cuộn nốt chỉ tải khi mở màn thu.
const RecordView = lazy(() =>
  import('./record/RecordView').then((m) => ({ default: m.RecordView })),
);
// "Tạo bài với AI" (góp ý 2026-10-16): prompt + bộ chuyển cảm âm → .harm (optimizer) chỉ tải khi mở `#/ai`.
const AiCreateView = lazy(() =>
  import('./ai/AiCreateView').then((m) => ({ default: m.AiCreateView })),
);
// Hướng dẫn (README + prompt AI cảm âm nạp ?raw, ~80 KB) chỉ tải khi mở trang Hướng dẫn (D-260).
const GuideView = lazy(() => import('./guide/GuideView').then((m) => ({ default: m.GuideView })));
// Overlay OBS cũng tải lười: app thường không phải tải OverlayEngine / overlay.css. Lúc chờ chunk trang vẫn
// trong suốt / xanh chroma (class `overlay-mode` đặt sớm bởi script inline trong index.html).
const OverlayView = lazy(() =>
  import('./overlay/OverlayView').then((m) => ({ default: m.OverlayView })),
);
// Trang mini cho cửa sổ nổi Android (thử nghiệm, Phase 4m): chỉ tải khi mở `#/mini/:id`.
const MiniView = lazy(() => import('./mini/MiniView').then((m) => ({ default: m.MiniView })));
// Dev notes (REFERENCE + CHANGELOG nạp ?raw, ~110 KB, vòng 7): chỉ tải khi mở `#/dev` (link nhỏ ở chân trang
// Hướng dẫn / Cài đặt, không có trên thanh điều hướng).
const DevNotesView = lazy(() =>
  import('./dev/DevNotesView').then((m) => ({ default: m.DevNotesView })),
);

/**
 * Áp theme + lang lên <html> trước khi trình duyệt vẽ (layout effect). Lần tải đầu đã được
 * script inline trong index.html áp sẵn từ localStorage — không nháy tối → sáng (D-069).
 */
function useDocumentTheme(overlay: boolean) {
  const theme = useSettings((s) => s.theme);
  const language = useSettings((s) => s.language);
  useLayoutEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = theme;
    root.lang = language;
    root.classList.toggle('overlay-mode', overlay);
    // Thanh địa chỉ / title bar PWA theo màu nền của theme (giá trị lấy từ app.css).
    const bg = getComputedStyle(root).getPropertyValue('--bg').trim();
    if (bg) document.querySelector('meta[name="theme-color"]')?.setAttribute('content', bg);
  }, [theme, language, overlay]);
}

/**
 * Nút "◂ Về màn chơi" ở chỗ tên app (góp ý 2026-10-15 A): về bài mở ở màn chơi gần nhất trong phiên
 * (`#/play/<id>`), chưa có thì `#/` (bài mẫu). Tooltip / tên truy cập kèm tên bài.
 */
function BackToPlayer() {
  const t = useT();
  const { path, title } = useBackToPlayer();
  const label = title ? t('nav.backToPlayerSong', { title }) : t('nav.backToPlayer');
  return (
    <a className="app-brand app-back" href={href(path)} title={label} aria-label={label}>
      <span className="app-back-icon" aria-hidden="true">
        ◂
      </span>
      <span className="app-back-text">{t('nav.backToPlayer')}</span>
    </a>
  );
}

function AppNav({ route }: { route: Route }) {
  const t = useT();
  // "Tạo bài với AI" là trang con của Thư viện (mở từ mục "Thêm bài"): link Thư viện vẫn sáng, nhưng
  // aria-current="true" (mục cha) chứ không "page" — trang hiện tại không phải trang Thư viện.
  const parent = route.name === 'ai' ? 'library' : null;
  const link = (name: Route['name'], to: string, label: string) => (
    <a
      className="nav-link"
      href={href(to)}
      aria-current={route.name === name ? 'page' : parent === name ? 'true' : undefined}
    >
      {label}
    </a>
  );
  return (
    <nav className="app-nav" aria-label={t('nav.main')}>
      <BackToPlayer />
      <span className="app-nav-links">
        {link('library', paths.library(), t('common.library'))}
        {link('settings', paths.settings(), t('common.settings'))}
        {link('guide', paths.guide(), t('nav.guide'))}
      </span>
      <span className="spacer" />
      <PrefButtons />
    </nav>
  );
}

function NotFound() {
  const t = useT();
  return (
    <section className="card stack">
      <h1>{t('common.notFound')}</h1>
      <p>
        <a href={href(paths.library())}>{t('common.goHome')}</a>
      </p>
    </section>
  );
}

/** Chờ chunk của route tải xong (thường chỉ vài chục ms). */
function RouteLoading() {
  const t = useT();
  return (
    <p className="muted" role="status">
      {t('common.loading')}
    </p>
  );
}

function RouteFailed() {
  const t = useT();
  return (
    <section className="card stack" role="alert">
      <h1>{t('common.pageFailed')}</h1>
      <p>{t('common.pageFailedBody')}</p>
      <p className="row">
        <Button variant="primary" onClick={() => window.location.reload()}>
          {t('common.reloadPage')}
        </Button>
        <a href={href(paths.library())}>{t('common.goHome')}</a>
      </p>
    </section>
  );
}

/**
 * Lỗi khi tải chunk của route (vd. app vừa deploy bản mới, file chunk cũ không còn) hoặc khi render
 * view: hiện thẻ "tải lại trang" thay cho màn hình trắng. Đổi route thì mount boundary mới (key).
 */
class RouteErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override componentDidCatch(error: unknown): void {
    console.error(error);
  }

  override render(): ReactNode {
    return this.state.failed ? <RouteFailed /> : this.props.children;
  }
}

const COMING_SOON_TITLE = {
  editor: 'common.feature.editor',
  share: 'common.feature.share',
  midiImport: 'common.feature.midiImport',
} as const;

/** Route của tính năng chưa bật cờ (src/ui/features.ts, D-060): trang "sắp có" đã dịch. */
function ComingSoon({ feature }: { feature: keyof typeof COMING_SOON_TITLE }) {
  const t = useT();
  return (
    <section className="card stack">
      <h1>{t(COMING_SOON_TITLE[feature])}</h1>
      <p className="muted">{t('common.comingSoon')}</p>
      <p>
        <a href={href(paths.library())}>{t('common.goHome')}</a>
      </p>
    </section>
  );
}

export function App() {
  const { route, query } = useRoute();
  const overlay = route.name === 'overlay';
  useDocumentTheme(overlay);

  // Overlay và màn chơi (`#/` = bài mẫu, `#/play/:id`) chiếm toàn màn hình, không có nav.
  // Overlay (OBS) không có UpdatePrompt: không nhắc bản mới, không đăng ký service worker.
  // Chờ chunk: không vẽ gì (không "Đang tải…" lên stream). Chunk lỗi: thẻ "Tải lại trang".
  if (route.name === 'overlay') {
    return (
      <RouteErrorBoundary>
        <Suspense fallback={null}>
          <OverlayView songId={route.id} query={query} />
        </Suspense>
      </RouteErrorBoundary>
    );
  }
  // Trang mini (cửa sổ nổi nhỏ của Android): toàn khung, không nav, không nhắc bản mới (khung quá nhỏ).
  if (route.name === 'mini') {
    return (
      <>
        <RouteErrorBoundary>
          <Suspense fallback={<RouteLoading />}>
            <MiniView songId={route.id} query={query} />
          </Suspense>
        </RouteErrorBoundary>
        <ToastRegion placement="top" max={1} />
      </>
    );
  }
  if (route.name === 'play' || route.name === 'home') {
    return (
      <>
        {route.name === 'home' ? <HomeView /> : <PlayerView songId={route.id} />}
        {/* Đỉnh màn hình, chỉ toast mới nhất (nằm gọn trong header): không che game bar,
            hit line hay hàng điều khiển (D-063). */}
        <ToastRegion placement="top" max={1} />
        {/* Màn chơi mặc định `#/` (lần mở app đầu tiên): không hiện "sẵn sàng offline" — thông báo chờ
            tới trang tiếp theo người dùng mở. */}
        <UpdatePrompt placement="top" showOfflineReady={route.name !== 'home'} />
      </>
    );
  }

  let content;
  let wide = false;
  switch (route.name) {
    case 'library':
      content = <LibraryView />;
      break;
    case 'edit':
      if (FEATURES.editor) {
        content = <EditorView songId={route.id} />;
        wide = true;
      } else {
        content = <ComingSoon feature="editor" />;
      }
      break;
    case 'share':
      content = FEATURES.share ? <ShareView data={route.data} /> : <ComingSoon feature="share" />;
      break;
    case 'settings':
      content = <SettingsView />;
      break;
    case 'midi':
      if (FEATURES.midiImport) {
        content = <MidiImportView />;
        wide = true;
      } else {
        content = <ComingSoon feature="midiImport" />;
      }
      break;
    case 'record':
      content = <RecordView />;
      break;
    case 'ai':
      content = <AiCreateView />;
      break;
    case 'guide':
      content = <GuideView doc={route.doc} section={query.get('s')} />;
      break;
    case 'dev':
      content = <DevNotesView section={query.get('s')} />;
      break;
    default:
      content = <NotFound />;
  }

  return (
    <div className="app-shell">
      <AppNav route={route} />
      <main className={wide ? 'app-main app-main-wide' : 'app-main'}>
        <RouteErrorBoundary key={route.name}>
          <Suspense fallback={<RouteLoading />}>{content}</Suspense>
        </RouteErrorBoundary>
      </main>
      <ToastRegion />
      <UpdatePrompt />
    </div>
  );
}

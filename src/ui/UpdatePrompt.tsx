import { useEffect } from 'react';
import { useT } from '../i18n/useT';
import { Button } from './components';
import { applyUpdate, dismissOfflineReady, dismissUpdate, startPwa, usePwa } from './pwa';
import './updatePrompt.css';

/** Thông báo "sẵn sàng offline" tự ẩn sau khoảng này. */
export const OFFLINE_READY_MS = 6000;

export interface UpdatePromptProps {
  /**
   * 'bottom' (mặc định): góc dưới phải — các trang có thanh điều hướng. 'top': giữa, dưới vùng
   * header — màn chơi (`#/`, `#/play/:id`; không che game bar, hit line hay thanh dọc bên phải).
   */
  placement?: 'bottom' | 'top';
  /**
   * Hiện thông báo "sẵn sàng offline". Màn đầu (`#/`, màn chơi với bài mẫu) tắt để không chen vào lần
   * mở đầu tiên: thông báo chờ tới trang tiếp theo người dùng mở.
   */
  showOfflineReady?: boolean;
}

/**
 * Nhắc bản mới ("Có bản mới — Tải lại" + "Để sau") và thông báo một lần "sẵn sàng offline". Không
 * chặn thao tác (thẻ nhỏ cố định ở góc, không backdrop), không lấy focus (không autoFocus / focus()),
 * đọc qua vùng `role="status"`. Mount ở mọi route trừ overlay (App.tsx): overlay OBS không bao giờ
 * hiện và không đăng ký SW. Lần mount đầu đăng ký service worker (`startPwa`, chỉ một lần); từ đó app tự
 * hỏi bản mới khi quay lại tab và mỗi 45 phút (`watchForUpdates`, vòng R7) — "Có bản mới" hiện mà không
 * cần người dùng tự tải lại trang.
 */
export function UpdatePrompt({ placement = 'bottom', showOfflineReady = true }: UpdatePromptProps) {
  const t = useT();
  const needRefresh = usePwa((s) => s.needRefresh);
  const offlineReady = usePwa((s) => s.offlineReady);
  const showOffline = offlineReady && showOfflineReady && !needRefresh;

  useEffect(() => {
    startPwa();
  }, []);

  useEffect(() => {
    if (!showOffline) return;
    const id = setTimeout(dismissOfflineReady, OFFLINE_READY_MS);
    return () => clearTimeout(id);
  }, [showOffline]);

  return (
    <div
      className={placement === 'top' ? 'update-prompt-region is-top' : 'update-prompt-region'}
      role="status"
      aria-live="polite"
      aria-label={t('pwa.region')}
    >
      {needRefresh && (
        <div className="update-prompt">
          <p className="update-prompt-text">{t('pwa.updateAvailable')}</p>
          <Button
            size="sm"
            variant="primary"
            title={t('pwa.reloadHint')}
            onClick={() => void applyUpdate()}
          >
            {t('pwa.reload')}
          </Button>
          <Button size="sm" variant="ghost" title={t('pwa.laterHint')} onClick={dismissUpdate}>
            {t('pwa.later')}
          </Button>
        </div>
      )}
      {showOffline && (
        <div className="update-prompt is-info">
          <p className="update-prompt-text">{t('pwa.offlineReady')}</p>
          <Button
            size="sm"
            variant="ghost"
            className="btn-icon"
            aria-label={t('pwa.offlineDismiss')}
            title={t('pwa.offlineDismiss')}
            onClick={dismissOfflineReady}
          >
            <span aria-hidden="true">×</span>
          </Button>
        </div>
      )}
    </div>
  );
}

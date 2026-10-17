import { useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import { useT } from '../i18n/useT';
import { useFloatingWindowState } from '../pip/FloatingWindow';
import { FloatingWindowButton } from '../pip/FloatingWindowButton';
import { href, paths } from '../ui/router';
import { useSettings } from '../ui/settings';
import type { ControlScheme } from '../ui/settings';
import { Icon } from './TransportBar';

export interface PlayerSideBarProps {
  songId: string;
  /** Cửa sổ nổi (PC) vừa mở — tạm dừng Player ở tab này (chung một engine âm thanh). */
  onFloatOpened: () => void;
  /**
   * Kiểu Mobile (hoặc điện thoại không có Document PiP): "Cửa sổ nổi" = MiniLauncher của bài này — hỏi
   * Apple / Android (nhớ theo máy) rồi trang mini (Android) hoặc video nổi dựng sẵn (Apple), R7-6.
   */
  onOpenMini: () => void;
  /** Mở hộp thoại "Tạo link OBS" của bài này. */
  onOpenObs: () => void;
  onShare: () => void;
}

/** Con trỏ chính là ngón tay (điện thoại / máy tính bảng). */
const COARSE_POINTER_QUERY = '(pointer: coarse)';

function subscribeCoarse(cb: () => void): () => void {
  if (typeof window.matchMedia !== 'function') return () => {};
  const mq = window.matchMedia(COARSE_POINTER_QUERY);
  mq.addEventListener?.('change', cb);
  return () => mq.removeEventListener?.('change', cb);
}

function isCoarsePointer(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia(COARSE_POINTER_QUERY).matches;
}

const SCHEMES: readonly { value: ControlScheme; icon: 'pc' | 'mobile' }[] = [
  { value: 'pc', icon: 'pc' },
  { value: 'mobile', icon: 'mobile' },
];

/** Một ô của thanh: icon trên, nhãn ngắn in hoa dưới (màn hẹp: chỉ icon, nhãn vẫn là tên truy cập). */
function BarLabel({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <>
      {icon}
      <span className="psb-label">{children}</span>
    </>
  );
}

/**
 * Thanh dọc bên phải màn chơi (góp ý 2026-10-15 B), thứ tự trên → dưới: Kiểu điều khiển PC | Mobile
 * (ghi thẳng settings.controlScheme — cùng store với Cài đặt), Cửa sổ nổi (PC: cửa sổ nổi Document PiP
 * của bài này — không đổi; Mobile: hỏi "Apple / Android?" một lần rồi trang mini cho cửa sổ nổi Android
 * hoặc thẳng tới video nổi dựng sẵn trên iPhone / iPad — MiniLauncher, R7-6), OBS, Chia sẻ, Cài đặt.
 * Điện thoại / máy tính bảng không có Document PiP (Android Chrome) mà đang ở kiểu PC (mặc định của hồ
 * sơ mới) → "Cửa sổ nổi" cũng mở trang mini, không báo "dùng Chrome trên máy tính" (thiết bị này CÓ
 * đường cửa sổ nổi riêng).
 */
export function PlayerSideBar({
  songId,
  onFloatOpened,
  onOpenMini,
  onOpenObs,
  onShare,
}: PlayerSideBarProps) {
  const t = useT();
  const scheme = useSettings((s) => s.controlScheme);
  const set = useSettings((s) => s.set);
  const { supported: pipSupported } = useFloatingWindowState();
  const coarse = useSyncExternalStore(subscribeCoarse, isCoarsePointer, () => false);
  const miniFloat = scheme === 'mobile' || (!pipSupported && coarse);
  return (
    <aside className="player-sidebar" aria-label={t('player.sideBar')}>
      <div className="psb-scheme" role="group" aria-label={t('player.scheme')}>
        <span className="psb-scheme-title" aria-hidden="true">
          {t('player.scheme')}
        </span>
        <span className="psb-seg">
          {SCHEMES.map(({ value, icon }) => (
            <button
              key={value}
              type="button"
              className="btn psb-seg-btn"
              aria-pressed={scheme === value}
              title={t(value === 'pc' ? 'player.scheme.pcHint' : 'player.scheme.mobileHint')}
              onClick={() => set({ controlScheme: value })}
            >
              <BarLabel icon={<Icon name={icon} />}>
                {t(value === 'pc' ? 'player.scheme.pc' : 'player.scheme.mobile')}
              </BarLabel>
            </button>
          ))}
        </span>
      </div>

      {!miniFloat ? (
        <FloatingWindowButton
          songId={songId}
          className="psb-float"
          icon={<Icon name="pip" />}
          onOpened={onFloatOpened}
        />
      ) : (
        <button
          type="button"
          className="btn psb-btn psb-float"
          aria-haspopup="dialog"
          title={t('player.floatMobileHint')}
          onClick={onOpenMini}
        >
          <BarLabel icon={<Icon name="pip" />}>{t('pip.button')}</BarLabel>
        </button>
      )}

      <button
        type="button"
        className="btn psb-btn player-obs"
        aria-haspopup="dialog"
        title={t('overlay.playerButtonHint')}
        onClick={onOpenObs}
      >
        <BarLabel icon={<Icon name="obs" />}>{t('overlay.playerButton')}</BarLabel>
        <span className="sr-only"> — {t('overlay.playerButtonHint')}</span>
      </button>

      <button
        type="button"
        className="btn psb-btn player-share"
        title={t('player.shareHint')}
        onClick={onShare}
      >
        <BarLabel icon={<Icon name="share" />}>{t('player.share')}</BarLabel>
      </button>

      <a className="btn psb-btn player-settings" href={href(paths.settings())}>
        <BarLabel icon={<Icon name="settings" />}>{t('common.settings')}</BarLabel>
      </a>
    </aside>
  );
}

import type { Modifiers } from '../core/types';
import type { StringKey } from '../i18n/strings';
import { useT } from '../i18n/useT';
import { useModifierLabels } from '../ui/modLabels';
import type { ModifierLabels } from '../ui/modLabels';
import type { ControlScheme } from '../ui/settings';
import { cueLabel, modeButton } from './mobilePlan';
import type { MobileUiState } from './mobilePlan';
import './player.css';

/** Nhãn banner theo tổ hợp modifier ("CHUỘT PHẢI + SCROLL"…); null nếu không giữ gì. */
export function holdBannerKey(m: Modifiers): StringKey | null {
  if (m.left) return m.scroll ? 'mod.bannerLeftScroll' : 'mod.bannerLeft';
  if (m.right) return m.scroll ? 'mod.bannerRightScroll' : 'mod.bannerRight';
  return m.scroll ? 'mod.bannerScroll' : null;
}

export interface HoldBannerProps {
  /** PC: modifier của hold run đang cắt qua hit line; null = không có. */
  modifiers: Modifiers | null;
  /** Kiểu điều khiển (mặc định PC). */
  scheme?: ControlScheme;
  /** Mobile: chế độ tại hit line + lần chạm kế. */
  mobile?: MobileUiState | null;
  /** Tên 4 nút; mặc định theo Cài đặt (useModifierLabels). Overlay OBS truyền tên từ link. */
  labels?: ModifierLabels;
}

/**
 * Banner lớn ngay trên game bar. Slot luôn giữ chiều cao cố định để layout không nhảy.
 * - PC (spec §5 "Hold ribbon"): "ĐANG GIỮ: CHUỘT PHẢI" khi đang có hold run. Màu nền theo trái
 *   (xanh dương) / phải (cam) / scroll (xanh lá); tổ hợp với scroll thì nền theo trái/phải + viền và
 *   badge `#` xanh lá (giống tile).
 * - Mobile: luôn hiện "CHẾ ĐỘ: <chế độ> · <Nửa Cung>: BẬT/TẮT" (chạm chọn giữ trạng thái, rest
 *   không mất chế độ) + "SẮP CHẠM: …" khoảng 1 beat trước mỗi lần phải chạm.
 */
export function HoldBanner({ modifiers, scheme = 'pc', mobile = null, labels }: HoldBannerProps) {
  if (scheme === 'mobile') return <MobileBanner mobile={mobile} labels={labels} />;
  return <PcBanner modifiers={modifiers} />;
}

function PcBanner({ modifiers }: { modifiers: Modifiers | null }) {
  const t = useT();
  const key = modifiers ? holdBannerKey(modifiers) : null;
  let tone = '';
  if (modifiers && key) tone = modifiers.left ? 'left' : modifiers.right ? 'right' : 'scroll';
  const combo = modifiers !== null && modifiers.scroll && tone !== 'scroll';
  return (
    <div className="hold-banner-slot" role="group" aria-label={t('player.holdBanner')}>
      {key ? (
        <div className={`hold-banner hold-banner-${tone}${combo ? ' hold-banner-combo' : ''}`}>
          <span className="hold-banner-text">{t('mod.holdingBanner', { what: t(key) })}</span>
          {combo ? (
            <span className="hold-banner-badge" aria-hidden="true">
              #
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function MobileBanner({
  mobile,
  labels: labelsProp,
}: {
  mobile: MobileUiState | null;
  labels?: ModifierLabels;
}) {
  const t = useT();
  const settingsLabels = useModifierLabels();
  const labels = labelsProp ?? settingsLabels;
  const mode = mobile?.mode ?? 0;
  const semitoneOn = mobile?.semitoneOn ?? false;
  const button = modeButton(mode);
  // Như PC: quãng thắng màu; chỉ Nửa Cung → xanh lá; Ngẩng Tự Nhiên + tắt → nền trung tính.
  const tone = button !== 'natural' ? button : semitoneOn ? 'scroll' : 'natural';
  const combo = semitoneOn && tone !== 'scroll';
  const upcoming =
    mobile?.cueSoon && mobile.nextCues.length > 0
      ? mobile.nextCues.map((c) => cueLabel(c, labels)).join(' + ')
      : null;
  return (
    <div className="hold-banner-slot" role="group" aria-label={t('player.mobile.bannerRegion')}>
      <div
        className={`hold-banner hold-banner-mobile hold-banner-${tone}${combo ? ' hold-banner-combo' : ''}`}
        data-mode={button}
        data-semitone={semitoneOn ? 'on' : 'off'}
      >
        <span className="hold-banner-text">
          {t('player.mobile.banner', {
            mode: labels[button],
            scroll: labels.scroll,
            state: semitoneOn ? t('player.mobile.on') : t('player.mobile.off'),
          })}
        </span>
        {upcoming !== null ? (
          <span className="hold-banner-next">
            {t('player.mobile.upcoming', { label: upcoming })}
          </span>
        ) : null}
      </div>
    </div>
  );
}

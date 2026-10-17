import { useT } from '../i18n/useT';

/**
 * Huy hiệu đỏ "Đang phát giai điệu" khi giai điệu mẫu đang bật (SPEC "Âm thanh mặc định TẮT", D-184):
 * Player (đầy đủ + màn đầu) và Cửa sổ nổi — mọi bề mặt có thể phát giai điệu lên stream.
 *
 * Màn hẹp / thấp (điện thoại, D-417): ở header Player chỉ còn ô "[🔊]" đỏ (chữ đầy đủ vẫn đọc được — ẩn bằng
 * sr-only, kèm tooltip) để bật giai điệu bằng nút loa không đẩy ◂ / EN / ☀ xuống dòng mới (trang không nhảy).
 */
export function MelodyBadge({ className }: { className?: string }) {
  const t = useT();
  const hint = t('player.melodyBadgeHint');
  return (
    <span
      className={['player-chip', 'player-chip-melody', className].filter(Boolean).join(' ')}
      title={hint}
    >
      <span className="melody-badge-text">{t('player.melodyBadge')}</span>
      <span className="melody-badge-icon" aria-hidden="true">
        🔊
      </span>
      <span className="sr-only"> {hint}</span>
    </span>
  );
}

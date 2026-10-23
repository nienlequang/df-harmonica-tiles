/**
 * Bảng ⓘ của trang mini: bố cục nên dùng theo loại máy (D-448, góp ý 2026-10-21) + cách mở cửa sổ nổi theo hãng +
 * cách kéo / đổi cỡ cửa sổ cho hai bố cục khớp nút game (góp ý 2026-10-16) + lưu ý khi chơi
 * (docs/RESEARCH-MOBILE-FLOATING.md mục e "Hướng dẫn cho người dùng").
 * Modal dùng chung (giữ focus, Esc đóng, trả focus về nút đã mở). `section="fit"` (nút ⓘ của "Căn chỉnh") →
 * phần kéo / đổi cỡ lên đầu, tiêu đề hộp thoại là tên phần đó, và đoạn đầu tiên nói từng nút chọn của Căn chỉnh
 * chỉnh cái gì (cửa sổ nổi thật chỉ cao ~90–140 px: dòng đầu là dòng đọc được ngay — D-416); danh sách theo máy ngay
 * sau đoạn đó. `section="open"`: danh sách theo máy đứng đầu.
 */
import type { StringKey } from '../i18n/strings';
import { useT } from '../i18n/useT';
import { Modal } from '../ui/components';

interface VendorStep {
  id: string;
  title: StringKey;
  body: StringKey;
}

/**
 * Bố cục nên dùng theo loại máy (D-448, chủ dự án 2026-10-21 — thử thật trên điện thoại Samsung): điện thoại Samsung
 * → "dưới nút" (cửa sổ pop-up có chiều cao tối thiểu ~220 dp, kéo xuống quá mép dưới được); máy tính bảng Samsung /
 * OPPO, đa số máy gập → "Khớp nút game"; điện thoại hãng Trung Quốc → "Thu nhỏ" (cửa sổ nổi không kéo giãn được).
 */
export const MINI_HELP_DEVICES: readonly VendorStep[] = [
  {
    id: 'samsungPhone',
    title: 'mini.help.device.samsungPhone.title',
    body: 'mini.help.device.samsungPhone',
  },
  { id: 'tablet', title: 'mini.help.device.tablet.title', body: 'mini.help.device.tablet' },
  {
    id: 'chinaPhone',
    title: 'mini.help.device.chinaPhone.title',
    body: 'mini.help.device.chinaPhone',
  },
];

/** Thứ tự: hãng có cửa sổ nổi kiểm chứng trước, máy không có cửa sổ nổi cuối. */
export const MINI_HELP_VENDORS: readonly VendorStep[] = [
  { id: 'samsung', title: 'mini.help.samsung.title', body: 'mini.help.samsung' },
  { id: 'sony', title: 'mini.help.sony.title', body: 'mini.help.sony' },
  { id: 'xiaomi', title: 'mini.help.xiaomi.title', body: 'mini.help.xiaomi' },
  { id: 'huawei', title: 'mini.help.huawei.title', body: 'mini.help.huawei' },
  { id: 'oppo', title: 'mini.help.oppo.title', body: 'mini.help.oppo' },
  { id: 'other', title: 'mini.help.other.title', body: 'mini.help.other' },
];

/** Kéo / đổi cỡ cửa sổ nổi để đặt khớp bảng nút kèn (hai bố cục "Khớp nút game"). */
export const MINI_HELP_FIT_VENDORS: readonly VendorStep[] = [
  { id: 'samsung', title: 'mini.help.fit.samsung.title', body: 'mini.help.fit.samsung' },
  { id: 'tablet', title: 'mini.help.fit.tablet.title', body: 'mini.help.fit.tablet' },
  { id: 'other', title: 'mini.help.fit.other.title', body: 'mini.help.fit.other' },
];

export const MINI_HELP_TIPS: readonly StringKey[] = [
  'mini.tip.gyro',
  'mini.tip.gameTools',
  'mini.tip.noTouch',
  'mini.tip.security',
  'mini.tip.screen',
  'mini.tip.risk',
];

export type MiniHelpSection = 'open' | 'fit';

export interface MiniHelpProps {
  open: boolean;
  onClose: () => void;
  /** Phần đặt lên đầu (mặc định 'open' = cách mở cửa sổ nổi). */
  section?: MiniHelpSection;
}

/**
 * Danh sách bước theo hãng / theo loại máy. `kind` đặt tên class (`mini-help-vendors` / `mini-help-devices`…) và
 * thuộc tính `data-vendor` / `data-device` — hai danh sách tách class để test thứ tự tiêu đề hãng không lẫn nhau.
 */
function VendorList({
  steps,
  kind = 'vendor',
}: {
  steps: readonly VendorStep[];
  kind?: 'vendor' | 'device';
}) {
  const t = useT();
  return (
    <ul className={`mini-help-${kind}s`}>
      {steps.map((v) => (
        <li
          key={v.id}
          className={`mini-help-${kind}`}
          data-vendor={kind === 'vendor' ? v.id : undefined}
          data-device={kind === 'device' ? v.id : undefined}
        >
          <h3 className={`mini-help-${kind}-title`}>{t(v.title)}</h3>
          <p>{t(v.body)}</p>
        </li>
      ))}
    </ul>
  );
}

export function MiniHelp({ open, onClose, section = 'open' }: MiniHelpProps) {
  const t = useT();
  const fitFirst = section === 'fit';
  const devicesPart = (
    <div className="mini-help-device-part">
      <h3 className="mini-help-tips-title">{t('mini.help.devicesTitle')}</h3>
      <VendorList steps={MINI_HELP_DEVICES} kind="device" />
    </div>
  );
  const openPart = (
    <>
      <p>{t('mini.helpIntro')}</p>
      <VendorList steps={MINI_HELP_VENDORS} />
    </>
  );
  const fitPart = (
    <div className="mini-help-fit">
      {/* Mở từ "Căn chỉnh": tên phần đã là tiêu đề hộp thoại. */}
      {fitFirst ? null : <h3 className="mini-help-tips-title">{t('mini.help.fitTitle')}</h3>}
      {fitFirst ? <p className="mini-help-controls">{t('mini.help.fit.controls')}</p> : null}
      {fitFirst ? devicesPart : null}
      <p>{t('mini.help.fitIntro')}</p>
      <VendorList steps={MINI_HELP_FIT_VENDORS} />
      {fitFirst ? null : <p className="mini-help-controls">{t('mini.help.fit.controls')}</p>}
    </div>
  );
  return (
    <Modal
      open={open}
      title={t(fitFirst ? 'mini.help.fitTitle' : 'mini.helpTitle')}
      onClose={onClose}
    >
      <div className="mini-help" data-section={section}>
        {fitFirst ? (
          <>
            {fitPart}
            <h3 className="mini-help-tips-title">{t('mini.helpTitle')}</h3>
            {openPart}
          </>
        ) : (
          <>
            {devicesPart}
            {openPart}
            {fitPart}
          </>
        )}
        <h3 className="mini-help-tips-title">{t('mini.tipsTitle')}</h3>
        <ul className="mini-help-tips">
          {MINI_HELP_TIPS.map((k) => (
            <li key={k}>{t(k)}</li>
          ))}
        </ul>
      </div>
    </Modal>
  );
}

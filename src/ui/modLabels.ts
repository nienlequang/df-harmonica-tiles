import { translate } from '../i18n/strings';
import type { Lang } from '../i18n/strings';
import { useSettings } from './settings';
import type { ModifierLabelOverrides } from './settings';

/**
 * Tên gọi hiển thị của các nút modifier (game bar, banner, ribbon, nhắc "CHẠM: …", editor…).
 * Người dùng đổi được trong Cài đặt (labelOverrides); để trống = tên mặc định theo ngôn ngữ.
 * Mọi chỗ hiển thị tên modifier phải lấy từ đây thay vì đọc thẳng i18n `mod.left/right/scroll/natural`.
 */
export interface ModifierLabels {
  /** Cúi Xuống. */
  left: string;
  /** Ngẩng Lên. */
  right: string;
  /** Ngẩng Tự Nhiên (mobile). */
  natural: string;
  /** Nửa Cung. */
  scroll: string;
}

export function modifierLabels(lang: Lang, overrides: ModifierLabelOverrides): ModifierLabels {
  return {
    left: overrides.left || translate(lang, 'mod.left'),
    right: overrides.right || translate(lang, 'mod.right'),
    natural: overrides.natural || translate(lang, 'mod.natural'),
    scroll: overrides.scroll || translate(lang, 'mod.scroll'),
  };
}

/** Đọc ngoài React (canvas renderer…). */
export function currentModifierLabels(): ModifierLabels {
  const s = useSettings.getState();
  return modifierLabels(s.language, s.labelOverrides);
}

/** Hook: tên gọi hiện tại, re-render khi ngôn ngữ hoặc tên tùy chỉnh đổi. */
export function useModifierLabels(): ModifierLabels {
  const lang = useSettings((s) => s.language);
  const left = useSettings((s) => s.labelOverrides.left);
  const right = useSettings((s) => s.labelOverrides.right);
  const natural = useSettings((s) => s.labelOverrides.natural);
  const scroll = useSettings((s) => s.labelOverrides.scroll);
  return modifierLabels(lang, { left, right, natural, scroll });
}

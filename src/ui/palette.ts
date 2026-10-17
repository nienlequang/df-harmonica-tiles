/**
 * Màu modifier dùng chung cho canvas (TS) và UI React (CSS vars cùng giá trị trong app.css:
 * --mod-left, --mod-right, --mod-scroll, --mod-*-text). Đổi ở đây thì đổi cả app.css.
 *
 * Nhãn trên tile ≥ 28px đậm → tiêu chuẩn "large text" AA (≥ 3:1); các cặp dưới đây ≥ 4.5:1.
 */
export const MOD_COLORS = {
  /** Thường: xám trắng. */
  normal: { fill: '#e6e9ef', text: '#14171c', stroke: '#b9c0cc' },
  /** Chuột trái (Cúi Xuống): xanh dương. */
  left: { fill: '#2563eb', text: '#ffffff', stroke: '#1d4fc4' },
  /** Chuột phải (Ngẩng Lên): cam. */
  right: { fill: '#f97316', text: '#1a0c00', stroke: '#c25a0f' },
  /** Scroll (Nửa Cung): xanh lá. */
  scroll: { fill: '#22c55e', text: '#04210f', stroke: '#17913f' },
} as const;

export type ModColorKey = keyof typeof MOD_COLORS;

/** Chọn màu nền tile: trái/phải thắng; chỉ scroll → xanh lá; không gì → thường. */
export function tileColorKey(mods: {
  left: boolean;
  right: boolean;
  scroll: boolean;
}): ModColorKey {
  if (mods.left) return 'left';
  if (mods.right) return 'right';
  if (mods.scroll) return 'scroll';
  return 'normal';
}

/** Chroma key cho overlay OBS. */
export const CHROMA_GREEN = '#00ff00';

/**
 * Bảng màu canvas tiles theo theme (dark/light) và theo nền overlay (trong suốt / chroma) — kiểu
 * "Tactical HUD" (docs/DESIGN.md): lane tối #0c1013 xen kẽ rất nhẹ, vạch mảnh, hit line = tia laser
 * lõi trắng + glow xanh neon (vẽ bằng 2 vạch bán trong suốt chồng nhau, không shadowBlur), nhãn
 * section dạng tag vát góc. Màu tile theo modifier lấy từ src/ui/palette.ts (MOD_COLORS) — KHÔNG đổi;
 * accent xanh neon không bao giờ tô tile (gần màu Nửa Cung), chỉ dùng cho glow của hit line.
 *
 * Contrast (AA): sectionText/sectionBg ≥ 4.5:1. Viền tile/ribbon (`tileStroke`) và nét vòng "CHẠM"
 * (mobile, `cueRing`) ≥ 3:1 (non-text, WCAG 1.4.11) với nền canvas và cả hai màu lane của theme —
 * độ dài tile mang thông tin trường độ, nên mép tile phải thấy được cả ở theme sáng; vòng "CHẠM" có
 * thêm viền `cueHalo` hai bên nét nên vẫn thấy được trên tile / nút chế độ / hình game, chữ "CHẠM"
 * (`cueText`) ≥ 4.5:1 trên viền chữ `cueHalo` của nó (src/player/canvasTheme.test.ts đo lại).
 *
 * Nền chroma (#00FF00, OBS Chroma Key): mọi thứ vẽ ĐẶC — không glow xanh (bị key mất), vạch lưới
 * màu đặc, và thân tile / ribbon mờ dần được trộn sẵn lên nền đen (`opaqueBase`) thay vì vẽ bán
 * trong suốt (màu trộn với xanh chroma sẽ bị key ăn mất).
 */
import type { ModColorKey } from '../ui/palette';
import { MOD_COLORS } from '../ui/palette';
import type { Theme } from '../ui/settings';

export type CanvasBackground = 'theme' | 'transparent' | 'chroma';

/**
 * Cùng font HUD với app.css (`--font-hud`): Bahnschrift có sẵn trên Windows 10/11, máy khác rơi về
 * DIN / Roboto Condensed / system-ui. Không font qua network.
 */
export const CANVAS_FONT_STACK =
  "Bahnschrift, 'DIN Condensed', 'DIN Alternate', 'Roboto Condensed', 'Arial Narrow', system-ui, sans-serif";

/** Độ rộng chữ trong chuỗi font canvas (font-stretch của CSS font shorthand). */
export type CanvasFontStretch = 'condensed' | 'normal';

export interface CanvasTheme {
  /** Nền canvas (chỉ dùng khi background = 'theme'). */
  bg: string;
  /** Nền lane xen kẽ; '' = không vẽ. */
  laneFill: string;
  laneFillAlt: string;
  /** Nền gutter ribbon; '' = không vẽ. */
  gutterFill: string;
  /** Phủ tối vùng đã qua (sau hit line); '' = không vẽ. */
  pastShade: string;
  laneSeparator: string;
  barLine: string;
  beatLine: string;
  sectionLine: string;
  sectionText: string;
  sectionBg: string;
  /** Viền mảnh của tag nhãn section. */
  sectionBorder: string;
  /** Lõi hit line (+ ngoặc hai đầu). */
  hitLine: string;
  /** Glow sát lõi (vạch rộng vừa); '' = không vẽ. Chroma: viền tối đặc để lõi trắng nổi trên game. */
  hitGlow: string;
  /** Glow ngoài (vạch rộng, rất mờ); '' = không vẽ. */
  hitGlowOuter: string;
  /** Vạch đánh dấu chỗ loop A-B quay về đầu (vẽ đứt nét). */
  loopLine: string;
  /**
   * Viền tile + ribbon theo màu modifier. Theme sáng dùng tông đậm hơn palette để mép tile đạt
   * ≥ 3:1 trên nền/lane sáng (tile xám trắng và xanh lá gần như trùng nền).
   */
  tileStroke: Readonly<Record<ModColorKey, string>>;
  /** Viền trong tối 1 px của tile (bán trong suốt, nằm trên thân tile). */
  tileInner: string;
  /** Highlight mép trên của tile (bán trong suốt, nằm trên thân tile). */
  tileHighlight: string;
  /** Viền tile đang chạm hit line. */
  activeStroke: string;
  perfect: string;
  good: string;
  miss: string;
  waiting: string;
  /**
   * Nét vòng "CHẠM" (mobile, trong suốt — chỉ có nét) theo màu chế độ: theme tối = màu nút chế độ của
   * palette; theme sáng = tông đậm (như `tileStroke`) để ≥ 3:1 trên nền cát. Cũng là nét của 4 vòng chế độ
   * mờ tự vẽ (overlay OBS).
   */
  cueRing: Readonly<Record<ModColorKey, string>>;
  /** Viền tương phản hai bên nét vòng "CHẠM" + viền chữ "CHẠM" (thấy được trên mọi nền). */
  cueHalo: string;
  /** Chữ "CHẠM" / "TAP" giữa vòng (trên viền chữ `cueHalo`). */
  cueText: string;
  /** false ở chế độ chroma: bỏ shadowBlur để không loang màu lên nền #00FF00. */
  glow: boolean;
  /**
   * false ở chế độ chroma: thân tile / ribbon / vòng "CHẠM" mờ dần vẽ bằng màu đã
   * trộn sẵn lên `opaqueBase` (alpha 1) — chữ bán trong suốt / thân mờ trộn xanh sẽ bị key mất.
   */
  translucent: boolean;
  /** Nền giả định khi trộn sẵn màu đặc (chỉ dùng khi `translucent` = false). */
  opaqueBase: string;
}

const DARK: CanvasTheme = {
  bg: '#090b0d',
  laneFill: '#0c1013',
  laneFillAlt: '#0e1216',
  gutterFill: 'rgba(233,237,241,0.025)',
  pastShade: 'rgba(0,0,0,0.32)',
  laneSeparator: 'rgba(233,237,241,0.07)',
  barLine: 'rgba(233,237,241,0.17)',
  beatLine: 'rgba(233,237,241,0.05)',
  sectionLine: 'rgba(233,237,241,0.42)',
  sectionText: '#e9edf1',
  sectionBg: 'rgba(17,21,26,0.95)',
  sectionBorder: '#3d4752',
  hitLine: '#effff7',
  hitGlow: 'rgba(15,247,150,0.42)',
  hitGlowOuter: 'rgba(15,247,150,0.11)',
  loopLine: 'rgba(242,194,48,0.9)',
  tileStroke: {
    normal: '#b9c0cc',
    left: MOD_COLORS.left.stroke,
    right: MOD_COLORS.right.stroke,
    scroll: MOD_COLORS.scroll.stroke,
  },
  tileInner: 'rgba(0,0,0,0.26)',
  tileHighlight: 'rgba(255,255,255,0.3)',
  activeStroke: '#ffffff',
  perfect: '#effff7',
  good: '#8fd3ff',
  miss: '#ff5a4f',
  waiting: '#f2c230',
  // Màu nút chế độ (DOM `--mod-*`): xanh dương 3.6:1 trên lane tối nhất, còn lại cao hơn.
  cueRing: {
    normal: MOD_COLORS.normal.fill,
    left: MOD_COLORS.left.fill,
    right: MOD_COLORS.right.fill,
    scroll: MOD_COLORS.scroll.fill,
  },
  cueHalo: 'rgba(0,0,0,0.72)',
  cueText: '#ffffff',
  glow: true,
  translucent: true,
  opaqueBase: '#000000',
};

/** "Desert" — nền cát (cùng cấu trúc với app.css theme sáng). */
const LIGHT: CanvasTheme = {
  bg: '#d3cdb9',
  laneFill: '#dcd7c6',
  laneFillAlt: '#d7d1bf',
  gutterFill: 'rgba(60,50,20,0.05)',
  pastShade: 'rgba(60,50,20,0.1)',
  laneSeparator: 'rgba(27,30,24,0.12)',
  barLine: 'rgba(27,30,24,0.3)',
  beatLine: 'rgba(27,30,24,0.09)',
  sectionLine: 'rgba(27,30,24,0.45)',
  sectionText: '#1b1e18',
  sectionBg: 'rgba(244,240,228,0.96)',
  sectionBorder: '#b9b29c',
  hitLine: '#0d2219',
  hitGlow: 'rgba(0,107,68,0.34)',
  hitGlowOuter: 'rgba(0,107,68,0.1)',
  loopLine: 'rgba(122,92,0,0.9)',
  // Tỉ lệ với nền / lane / lane xen kẽ (#d3cdb9 / #dcd7c6 / #d7d1bf): normal 3.5/3.9/3.7,
  // left 4.5/4.9/4.6, right 3.6/4.0/3.8, scroll 3.2/3.5/3.3 (đều ≥ 3:1, canvasTheme.test.ts).
  tileStroke: {
    normal: '#5f6877',
    left: MOD_COLORS.left.stroke,
    right: '#a84a07',
    scroll: '#15803d',
  },
  tileInner: 'rgba(0,0,0,0.16)',
  tileHighlight: 'rgba(255,255,255,0.4)',
  activeStroke: '#0b1220',
  perfect: '#1b1e18',
  good: '#1a5fd0',
  miss: '#b42318',
  waiting: '#7a5c00',
  // Tông đậm như viền tile (≥ 3:1 trên nền / lane cát), viền sáng hai bên nét.
  cueRing: {
    normal: '#5f6877',
    left: MOD_COLORS.left.stroke,
    right: '#a84a07',
    scroll: '#15803d',
  },
  cueHalo: 'rgba(251,249,242,0.85)',
  cueText: '#1b1e18',
  glow: true,
  translucent: true,
  opaqueBase: '#000000',
};

/** Overlay OBS (nền trong suốt): không nền lane, vạch sáng để nổi trên hình game. */
const OVERLAY: CanvasTheme = {
  ...DARK,
  laneFill: '',
  laneFillAlt: '',
  gutterFill: '',
  pastShade: '',
  laneSeparator: 'rgba(255,255,255,0.22)',
  barLine: 'rgba(255,255,255,0.38)',
  beatLine: 'rgba(255,255,255,0.12)',
  sectionBg: 'rgba(9,11,13,0.88)',
};

/**
 * Overlay trên nền chroma #00FF00: mọi màu ĐẶC (không alpha), không xanh lá nào ngoài màu tile
 * Nửa Cung; hit line lõi trắng + viền tối đặc thay cho glow.
 */
const CHROMA: CanvasTheme = {
  ...OVERLAY,
  laneSeparator: '#59626b',
  barLine: '#8a949c',
  beatLine: '#3a4248',
  sectionLine: '#9aa5b1',
  sectionBg: '#0e1216',
  hitGlow: '#0c1013',
  hitGlowOuter: '',
  loopLine: '#f2c230',
  tileInner: 'rgba(0,0,0,0.26)',
  // Viền vòng / chữ "CHẠM" đặc (bán trong suốt trộn với xanh chroma bị key mất).
  cueHalo: '#0c1013',
  glow: false,
  translucent: false,
};

export const CANVAS_THEMES: Readonly<Record<Theme, CanvasTheme>> = { dark: DARK, light: LIGHT };

/** Bảng màu overlay (để test / đo contrast). */
export const OVERLAY_CANVAS_THEMES: Readonly<Record<'transparent' | 'chroma', CanvasTheme>> = {
  transparent: OVERLAY,
  chroma: CHROMA,
};

/** Bảng màu thực dùng cho (theme, nền). Trả object dùng chung — không sửa. */
export function canvasThemeFor(theme: Theme, background: CanvasBackground): Readonly<CanvasTheme> {
  if (background === 'chroma') return CHROMA;
  if (background === 'transparent') return OVERLAY;
  return theme === 'light' ? LIGHT : DARK;
}

/**
 * Chuỗi font canvas, vd. canvasFont(700, 28) → "700 condensed 28px Bahnschrift, …".
 * Font-stretch nằm TRONG chuỗi (gán `ctx.font` đặt lại `ctx.fontStretch`): nhãn phím / ribbon /
 * section dùng 'condensed' (kiểu HUD), chữ phụ nhỏ dùng 'normal' cho dễ đọc.
 */
export function canvasFont(
  weight: number,
  sizePx: number,
  stretch: CanvasFontStretch = 'condensed',
): string {
  const st = stretch === 'normal' ? '' : `${stretch} `;
  return `${weight} ${st}${Math.round(sizePx)}px ${CANVAS_FONT_STACK}`;
}

const HEX6 = /^#([0-9a-f]{6})$/i;

function rgbOf(hex: string): [number, number, number] | null {
  const m = HEX6.exec(hex);
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * Màu đặc tương đương `hex` (#rrggbb) vẽ với độ đục `alpha` lên nền `base` (#rrggbb) — dùng cho nền
 * chroma (vẽ đặc thay vì bán trong suốt). Màu không phải #rrggbb → trả nguyên `hex`.
 */
export function blendOver(hex: string, alpha: number, base: string): string {
  const c = rgbOf(hex);
  const b = rgbOf(base) ?? [0, 0, 0];
  if (!c) return hex;
  const a = Math.min(1, Math.max(0, alpha));
  const mix = (i: number): number => Math.round(b[i] + (c[i] - b[i]) * a);
  return `rgb(${mix(0)},${mix(1)},${mix(2)})`;
}

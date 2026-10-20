/**
 * Canvas 2D renderer khu tiles (spec §5 "Canvas", "Hold ribbon"; §7 overlay lane ngang + nền
 * trong suốt / chroma). Không phụ thuộc React: PlayerView/OverlayView tạo `TilesRenderer`,
 * gọi `resize()` khi canvas đổi kích thước và `render({ beat })` mỗi rAF.
 *
 * Hiệu năng (60fps, 500+ nốt): dữ liệu tĩnh theo nốt tính sẵn ở setTimeline (lane, màu, mũi tên,
 * nốt trước/kế cùng lane); độ dài tile, cỡ chữ nhãn (theo bậc font dựng sẵn) và bề rộng chữ tính
 * sẵn ở prepare() (chỉ khi đổi layout/option); mỗi frame chỉ tìm nhị phân + duyệt nốt/run đang
 * thấy, không measureText, không cấp phát.
 *
 * Độ nét: backing store khớp đúng ô device pixel của canvas (ResizeObserver
 * `device-pixel-content-box` khi trình duyệt hỗ trợ, không thì ước lượng theo cách trình duyệt snap
 * mép) để bitmap không bị co giãn lệch nửa pixel. Đổi DPR (kéo cửa sổ sang màn khác) → tự resize
 * và vẽ lại frame cuối (kể cả lúc đang pause).
 *
 * Loop A-B (`RenderFrame.loop`): không vẽ gì từ loop end trở đi; thay vào đó vẽ tiếp đầu loop
 * (các vòng kế) sau loop end, nên lần lặp sau cuộn vào liền mạch như phần còn lại của bài.
 * Đếm vào (`RenderFrame.countIn`, D-025): ô nhịp được tua lại vẽ mờ, không bao giờ "sáng".
 *
 * Kiểu điều khiển Mobile (`scheme: 'mobile'`): nhãn tile là số giản phổ có chấm trên/dưới (chấm vẽ
 * tay theo jianpuLabel), không mũi tên ↓/↑; KHÔNG có gutter ribbon / nhãn "CHẠM: <tên chế độ>" ở bất cứ
 * bố cục nào (vòng R6); mỗi lần chạm (kể cả về Ngẩng Tự Nhiên) có một vòng "CHẠM" trong suốt (chỉ nét màu
 * chế độ, Ø đúng bằng nút chế độ, chữ "CHẠM" ở tâm — vòng R7) rơi trong cột của nút đó nhanh gấp
 * CUE_RING_SPEED lần tile và đồng tâm với nút đúng lúc phải chạm (layout.ts `cueTargets` / `cueRingAxis`),
 * rồi "đáp" vào nút (đứng yên, mờ dần). Bàn nút ('pad') do MobilePad (DOM) vẽ — vòng vẽ lên lớp canvas trong
 * suốt của MobilePad (`CUE_LAYER_ATTR`, nằm TRÊN nút chế độ DOM); overlay OBS (`modeTargets: 'outline'`,
 * R7-4) và bố cục không có bàn nút → renderer tự vẽ 4 vòng chế độ mờ làm đích (`drawModeTargets`).
 *
 * Số đếm vào KHÔNG vẽ trên canvas (round 6): đếm vào chỉ là phần tile dẫn vào; số lớn chỉ có trong lúc
 * đếm ngược trước khi bài chạy (lớp DOM của từng màn).
 *
 * Overlay "khớp game" (`?layout=game`, docs/GAME-UI-REFERENCE.md): `lanePadding: 'none'` (lane phủ
 * kín, hit line sát đáy), `tileOpacity` < 1 (thân tile bán trong suốt), `gridStyle: 'subtle'`. Mặc
 * định của ba option này giữ Player y như trước. `framePad` (v1.0.1 — overlay `fit=canvas` + Cửa sổ nổi PC):
 * khung rộng bằng khung bảng phím PC của game, 8 làn ở giữa, đệm hai bên (layout.ts `GAME_FRAME_PAD`).
 *
 * Trang mini Android "Khớp nút game" (`lanePadding: 'fit'` + `laneFit`, góp ý 2026-10-16): lane theo tâm 8
 * nút số thật của game (cửa sổ nổi đặt ngay trên bảng nút), hit line sát mép dưới, vòng "CHẠM" rơi trong
 * cột 4 nút chế độ thật và đáp sát trên mép dưới, 4 vòng đích mờ ở đó (không bàn nút — nút thật nằm dưới).
 *
 * Thanh bấm lặp (D-447, core/repeatRuns.ts): ≥ 4 nốt ngắn liên tiếp cùng một lần bấm vẽ thành MỘT thân tile dài
 * (`collectBar` / `drawBarBody`) — cùng màu / viền / nhãn với tile thường của lần bấm đó, vạch mảnh ở đầu từng nốt
 * bên trong, nhãn phím + số lần bấm còn lại ("×5", chuỗi `player.repeatCount`) đứng sát phía trước hit line, đếm lùi
 * khi từng nốt đi qua hit line, hết thì ẩn số. Sáng / loé / trạng thái luyện tập vẫn theo từng nốt (đoạn của nốt đó
 * trên thanh). Mọi bố cục, cả hai hướng, mọi nơi dùng renderer này (màn chơi, Cửa sổ nổi, overlay OBS, trang mini,
 * video nổi).
 */
import { KEY_DEGREE, KEY_SOLFEGE_EN, KEY_SOLFEGE_VI, NOTE_KEYS, keyIndex } from '../core/keys';
import { jianpuLabel } from '../core/mobile';
import { REPEAT_RUN_MIN, findRepeatRuns, pressesAhead, repeatRunIndex } from '../core/repeatRuns';
import type { Modifiers, NoteKey, Timeline } from '../core/types';
import type { Lang, StringKey } from '../i18n/strings';
import { translate } from '../i18n/strings';
import type { ModifierLabels } from '../ui/modLabels';
import type { ModColorKey } from '../ui/palette';
import { CHROMA_GREEN, MOD_COLORS, tileColorKey } from '../ui/palette';
import type { ControlScheme, MobileSemitone, SubLabel, Theme } from '../ui/settings';
import type { CanvasBackground, CanvasTheme } from './canvasTheme';
import { blendOver, canvasFont, canvasThemeFor } from './canvasTheme';
import type {
  BeatRange,
  CueTargets,
  LaneFit,
  LanePadding,
  Layout,
  Orientation,
  Rect,
} from './layout';
import {
  CUE_LAYER_ATTR,
  CUE_RING_SPEED,
  FRAME_PAD_MAX,
  HIT_LINE_MAX,
  HIT_LINE_MAX_EDGE,
  HIT_LINE_MIN,
  LANE_COUNT,
  LOOKAHEAD_MAX,
  LOOKAHEAD_MIN,
  TILE_SCALE_MAX,
  TILE_SCALE_MIN,
  computeLayout,
  cueRingAxis,
  cueTargets,
  isLaneFit,
  lowerBound,
  mapSpan,
  sameLaneFit,
  tileLabelFloor,
  tileLength,
} from './layout';
import { MOBILE_BUTTONS, cueButton, mobilePlanFor } from './mobilePlan';
import type { MobileButton, MobileEntry } from './mobilePlan';

export interface RendererOptions {
  orientation: Orientation;
  /** Số beat hiện từ mép xa tới hit line (4..12). */
  lookahead: number;
  /**
   * Hit line = phần trục thời gian tính từ MÉP XA (nơi tile xuất hiện), 0.05..0.95.
   * Mặc định 0.82 → dọc: 82% chiều cao tính từ trên; ngang: 18% chiều rộng tính từ trái.
   */
  hitLinePos: number;
  subLabel: SubLabel;
  language: Lang;
  theme: Theme;
  /** Phóng nhãn + độ dài tile tối thiểu (nominal 0.75..1.5, chấp nhận 0.5..3 cho overlay). */
  tileScale: number;
  background: CanvasBackground;
  showRibbons: boolean;
  showBarLines: boolean;
  showSectionLabels: boolean;
  /** Kiểu điều khiển của game: PC (giữ chuột) hay Mobile (chạm chọn chế độ). */
  scheme: ControlScheme;
  /** Mobile: Nửa Cung bật/tắt giữ trạng thái hay chỉ áp 1 nốt. */
  mobileSemitone: MobileSemitone;
  /** Tên gọi các nút modifier (ui/modLabels); null = tên mặc định theo `language`. */
  modLabels: ModifierLabels | null;
  /**
   * Đệm vùng lane (layout.ts `LanePadding`): 'normal' như Player; 'none' (overlay khớp game) bỏ lề
   * nhãn section để 8 lane phủ kín tới mép, hitLinePos được tới HIT_LINE_MAX_EDGE; 'pad' (Player kiểu
   * Mobile) = 8 cột bằng nhau thẳng tâm bàn nút ở đáy, tile viên thuốc đáp xuống đỉnh nút số (bị cắt
   * tại hit line), không gutter ribbon; 'fit' (trang mini Android "Khớp nút game") = lane theo tâm nút
   * thật của game (`laneFit`), hit line sát mép dưới, vòng "CHẠM" đáp sát trên mép dưới ở cột nút chế độ
   * thật + 4 vòng đích mờ, không gutter.
   */
  lanePadding: LanePadding;
  /** `lanePadding: 'fit'`: tâm nút số / nút chế độ thật (layout.ts `LaneFit`); null = số đo mặc định. */
  laneFit: LaneFit | null;
  /**
   * `lanePadding: 'none'`: đệm hai bên 8 làn theo bước cột (layout.ts `framePad`; 0 = phủ kín như trước,
   * GAME_FRAME_PAD = khung bảng phím PC của game — Cửa sổ nổi PC, overlay khớp game `fit=canvas`). Có đệm thì không
   * vẽ vạch ở mép ngoài 8 làn (như game: vạch chỉ ngăn giữa các cột) mà vẽ một vạch ở mép phải khung (= mép gutter).
   */
  framePad: number;
  /** Độ đục thân tile (0.3..1): overlay để thấy gameplay phía sau; viền + nhãn giữ nguyên. */
  tileOpacity: number;
  /** 'subtle' (overlay khớp game): vạch nhịp / phách / section và nhãn section mờ hơn. */
  gridStyle: GridStyle;
  /**
   * Kiểu Mobile — đích của vòng "CHẠM" ở bố cục bàn nút ('pad'): 'pad' (màn chơi, Cửa sổ nổi, trang mini,
   * video) = bàn nút đầy đủ vẽ nút chế độ (MobilePad DOM / video tự vẽ), vòng vẽ lên lớp canvas của
   * MobilePad; 'outline' (overlay OBS, R7-4) = không bàn nút — renderer tự vẽ 4 vòng chế độ mờ ở hàng nút
   * chế độ (nút thật của game nằm bên dưới). Bố cục không có bàn nút luôn tự vẽ vòng mờ.
   */
  modeTargets: ModeTargets;
}

export type GridStyle = 'normal' | 'subtle';
export type ModeTargets = 'pad' | 'outline';

/** Tùy chọn lúc tạo renderer (cố định suốt đời renderer). */
export interface TilesRendererInit {
  /**
   * DPR cố định thay cho devicePixelRatio của cửa sổ — canvas nguồn của video PiP vẽ đúng số px CSS (DPR 3
   * mà rasterise gấp 9 lần điểm ảnh rồi thu về 480 × 360 là phí). Bỏ trống = theo màn hình (mặc định).
   */
  dpr?: number;
}

export const TILE_OPACITY_MIN = 0.3;
export const TILE_OPACITY_MAX = 1;
/** Hệ số alpha của vạch nhịp / section và nhãn section khi `gridStyle: 'subtle'`. */
export const SUBTLE_GRID_ALPHA = 0.45;
export const SUBTLE_LABEL_ALPHA = 0.7;

export const DEFAULT_RENDERER_OPTIONS: Readonly<RendererOptions> = {
  orientation: 'vertical',
  lookahead: 6,
  hitLinePos: 0.82,
  subLabel: 'solfege',
  language: 'vi',
  theme: 'dark',
  tileScale: 1,
  background: 'theme',
  showRibbons: true,
  showBarLines: true,
  showSectionLabels: true,
  scheme: 'pc',
  mobileSemitone: 'toggle',
  modLabels: null,
  lanePadding: 'normal',
  laneFit: null,
  framePad: 0,
  tileOpacity: 1,
  gridStyle: 'normal',
  modeTargets: 'pad',
};

/** Giá trị trong RenderFrame.noteStates (practice mode). */
export const NoteState = {
  none: 0,
  perfect: 1,
  good: 2,
  miss: 3,
  waiting: 4,
} as const;

export interface RenderFrame {
  /** Beat hiện tại (có thể âm trong lúc đếm vào). */
  beat: number;
  /**
   * Số beat đếm vào còn lại (engine báo trạng thái). Renderer KHÔNG vẽ số này nữa (round 6): đếm vào chỉ là
   * phần tile dẫn vào, số lớn chỉ hiện trong lúc đếm ngược trước khi bài chạy (DOM của từng màn).
   */
  countInRemaining?: number | null;
  /**
   * Vùng đếm vào của lần phát hiện tại (D-025; chỉ truyền khi đang đếm). Trong lúc đếm
   * (beat < end): nốt/run kết thúc trước điểm bắt đầu `end` — ô nhịp được tua lại, không phát —
   * vẽ mờ và không bao giờ sáng; chỉ nốt tại điểm bắt đầu (thứ game bar đang hiện) chạm hit line.
   */
  countIn?: BeatRange | null;
  /**
   * Loop A-B đang bật (beat). Khi playhead trước loop end: không vẽ nốt/run/vạch từ `end` trở
   * đi, thay vào đó vẽ tiếp [start, end) dời +(end − start) (các vòng kế) — nốt đầu loop có lead-in
   * như mọi nốt khác. Playhead đã qua loop end (transport không wrap) → vẽ như không loop.
   */
  loop?: BeatRange | null;
  /** Trạng thái từng nốt (index theo timeline.notes), xem `NoteState`. */
  noteStates?: Uint8Array | null;
  /** Đồng hồ (ms) cho hiệu ứng nhấp nháy; mặc định performance.now(). */
  timeMs?: number;
  /**
   * Mobile: cue "vào lại" của lượt phát hiện tại (mobilePlan.ts — chế độ người chơi đang giữ khác chế
   * độ nốt đầu lượt) — vẽ thay các cue của kế hoạch tại nốt đó, ở đoạn hiện tại.
   */
  mobileEntry?: MobileEntry | null;
  /** Mobile + loop A-B: cue vào lại ở đầu mỗi vòng kế (các bản vẽ lại [start, end)). */
  mobileLoopEntry?: MobileEntry | null;
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

const oneOf = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T =>
  (allowed as readonly unknown[]).includes(v) ? (v as T) : fallback;

const num = (v: unknown, min: number, max: number, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;

const bool = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback);

const LABEL_KEYS: readonly (keyof ModifierLabels)[] = ['left', 'right', 'natural', 'scroll'];

function sameLabels(a: ModifierLabels | null, b: ModifierLabels | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return LABEL_KEYS.every((k) => a[k] === b[k]);
}

/** Tên gọi hợp lệ (4 chuỗi) hoặc null; cùng nội dung với `base` → giữ đúng object `base`. */
function sanitizeLabels(v: unknown, base: ModifierLabels | null): ModifierLabels | null {
  if (v === undefined) return base;
  if (v === null) return null;
  if (typeof v !== 'object') return base;
  const r = v as Record<string, unknown>;
  if (!LABEL_KEYS.every((k) => typeof r[k] === 'string')) return base;
  const next: ModifierLabels = {
    left: r.left as string,
    right: r.right as string,
    natural: r.natural as string,
    scroll: r.scroll as string,
  };
  return sameLabels(next, base) ? base : next;
}

/** LaneFit hợp lệ hoặc null; cùng giá trị với `base` → giữ đúng object `base` (không dựng lại layout). */
function sanitizeLaneFit(v: unknown, base: LaneFit | null): LaneFit | null {
  if (v === undefined) return base;
  if (v === null) return null;
  if (!isLaneFit(v)) return base;
  if (sameLaneFit(v, base)) return base;
  const out: LaneFit = { first: v.first, last: v.last, modes: v.modes.slice() };
  // Đúng tỉ lệ thật (trang mini biết cỡ màn hình): bước cột / dời theo px.
  if (v.stepPx !== undefined) out.stepPx = v.stepPx;
  if (v.shiftPx !== undefined) out.shiftPx = v.shiftPx;
  return out;
}

/** Gộp `patch` lên `base` và chuẩn hoá (giá trị sai/thiếu → giữ base). */
export function sanitizeRendererOptions(
  patch: Partial<RendererOptions> | null | undefined,
  base: Readonly<RendererOptions> = DEFAULT_RENDERER_OPTIONS,
): RendererOptions {
  const p: Partial<RendererOptions> = patch ?? {};
  const lanePadding = oneOf(
    p.lanePadding,
    ['normal', 'none', 'pad', 'fit'] as const,
    base.lanePadding,
  );
  // Trần hit line theo kiểu đệm (D-028 giữ 0.95 cho Player); giá trị base cũng kẹp lại khi đổi kiểu.
  const hitMax = lanePadding === 'normal' ? HIT_LINE_MAX : HIT_LINE_MAX_EDGE;
  const hitBase = Math.min(hitMax, Math.max(HIT_LINE_MIN, base.hitLinePos));
  return {
    orientation: oneOf(p.orientation, ['vertical', 'horizontal'] as const, base.orientation),
    lookahead: num(p.lookahead, LOOKAHEAD_MIN, LOOKAHEAD_MAX, base.lookahead),
    hitLinePos: num(p.hitLinePos, HIT_LINE_MIN, hitMax, hitBase),
    subLabel: oneOf(p.subLabel, ['solfege', 'number', 'none'] as const, base.subLabel),
    language: oneOf(p.language, ['vi', 'en'] as const, base.language),
    theme: oneOf(p.theme, ['dark', 'light'] as const, base.theme),
    tileScale: num(p.tileScale, TILE_SCALE_MIN, TILE_SCALE_MAX, base.tileScale),
    background: oneOf(p.background, ['theme', 'transparent', 'chroma'] as const, base.background),
    showRibbons: bool(p.showRibbons, base.showRibbons),
    showBarLines: bool(p.showBarLines, base.showBarLines),
    showSectionLabels: bool(p.showSectionLabels, base.showSectionLabels),
    scheme: oneOf(p.scheme, ['pc', 'mobile'] as const, base.scheme),
    mobileSemitone: oneOf(p.mobileSemitone, ['toggle', 'oneShot'] as const, base.mobileSemitone),
    modLabels: sanitizeLabels(p.modLabels, base.modLabels),
    lanePadding,
    laneFit: sanitizeLaneFit(p.laneFit, base.laneFit),
    framePad: num(p.framePad, 0, FRAME_PAD_MAX, base.framePad),
    tileOpacity: num(p.tileOpacity, TILE_OPACITY_MIN, TILE_OPACITY_MAX, base.tileOpacity),
    gridStyle: oneOf(p.gridStyle, ['normal', 'subtle'] as const, base.gridStyle),
    modeTargets: oneOf(p.modeTargets, ['pad', 'outline'] as const, base.modeTargets),
  };
}

const OPTION_KEYS = Object.keys(DEFAULT_RENDERER_OPTIONS) as (keyof RendererOptions)[];
const LAYOUT_KEYS: readonly (keyof RendererOptions)[] = [
  'orientation',
  'lookahead',
  'hitLinePos',
  'tileScale',
  'showRibbons',
  'showSectionLabels',
  'lanePadding',
  'laneFit',
  'framePad',
  'scheme',
];

/**
 * Option hình học của renderer: kiểu Mobile KHÔNG có gutter ribbon (vòng R6 — chế độ hiện bằng vòng "CHẠM"
 * rơi xuống nút chế độ + banner, không còn dải "CHẠM: <tên chế độ>" cạnh làn) → 8 làn lấy cả chỗ gutter.
 */
export function layoutOptionsOf(o: RendererOptions): RendererOptions {
  return o.scheme === 'mobile' && o.showRibbons ? { ...o, showRibbons: false } : o;
}

// ---------------------------------------------------------------------------
// Nhãn ribbon
// ---------------------------------------------------------------------------

/** Thứ tự loại ribbon: trái, phải, scroll, trái+scroll, phải+scroll. */
const RIBBON_KIND_KEYS: readonly StringKey[] = [
  'mod.holdLeft',
  'mod.holdRight',
  'mod.holdScroll',
  'mod.holdLeftScroll',
  'mod.holdRightScroll',
];
/** Nhãn gọn cho run quá ngắn (không chỉ dựa vào màu). */
const RIBBON_COMPACT: readonly string[] = ['↓', '↑', '#', '↓#', '↑#'];
const KIND_NONE = 255;

function ribbonKind(m: Modifiers): number {
  if (m.left) return m.scroll ? 3 : 0;
  if (m.right) return m.scroll ? 4 : 1;
  return m.scroll ? 2 : KIND_NONE;
}

/**
 * Tách nhãn giữ thành các dòng xếp chồng: "GIỮ CHUỘT PHẢI" → GIỮ / CHUỘT / PHẢI.
 * Token không có chữ/số (vd. "+") dính vào từ trước: "GIỮ TRÁI + SCROLL" → GIỮ / TRÁI + / SCROLL.
 */
export function splitRibbonWords(text: string): string[] {
  const out: string[] = [];
  for (const w of text.split(/\s+/)) {
    if (!w) continue;
    if (out.length > 0 && !/[\p{L}\p{N}]/u.test(w)) out[out.length - 1] += ` ${w}`;
    else out.push(w);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Nhãn phím: bậc cỡ chữ
// ---------------------------------------------------------------------------

/** Spec §5: nhãn phím to (≥ 28px) — mọi tile không bị luật gap cắt ngắn. */
export const KEY_LABEL_MIN_PX = 28;
/** Cỡ chữ nhỏ nhất cho tile bị luật gap cắt ngắn (nốt ngắn lặp lại ở lookahead cao). */
export const KEY_LABEL_TINY_PX = 8;
/** Chiều cao chữ hoa ≈ 0.72 em (system font) — để biết chữ có lọt tile không. */
const CAP_RATIO = 0.72;
/** Khoảng cách (px) giữa ribbon và ô "THẢ" vẽ ngay sau cuối run ngắn. */
const RELEASE_OUT_GAP = 2;
/** Độ đậm của nốt/run thuộc ô nhịp đếm vào (không phát). */
const GHOST_ALPHA = 0.22;
/** Trần số vòng loop vẽ trước (loop rất ngắn + lookahead lớn). */
const MAX_LOOP_COPIES = 64;
const LOOP_DASH: number[] = [8, 5];
const NO_DASH: number[] = [];
const COMBINING_DOT_ABOVE = '\u0307';

// ── Mobile ──
/** Số giản phổ trên tile theo lane (Z..M → 1..7, "," → 1 — chấm theo quãng vẽ riêng). */
const MOBILE_DIGITS: readonly string[] = ['1', '2', '3', '4', '5', '6', '7', '1'];
/** Nút mobile (thứ tự index trong mảng dữ liệu): trái, phải, tự nhiên, Nửa Cung. */
const MB_ORDER: readonly MobileButton[] = ['left', 'right', 'natural', 'scroll'];
/** Màu của từng nút mobile (palette chung với tile). */
const MB_COLOR: readonly ModColorKey[] = ['left', 'right', 'normal', 'scroll'];
/** Vị trí nút (MB_*) trong hàng nút chế độ của game (MOBILE_BUTTONS = thứ tự `cueTargets`). */
const MB_TARGET: readonly number[] = MB_ORDER.map((b) => MOBILE_BUTTONS.indexOf(b));
/** Vòng "CHẠM": cỡ chữ tối thiểu / tối đa (px). */
const CUE_FONT_MIN = 7;
const CUE_FONT_MAX = 16;
/**
 * Vòng "CHẠM" đã tới tâm nút: đứng yên đồng tâm với nút ("đáp" vào nút) và mờ dần trong chừng này beat rồi
 * biến mất — khung hình rơi đúng lúc chạm vẫn thấy vòng khớp nút.
 */
export const CUE_RING_HOLD_BEATS = 0.25;
/**
 * Chữ "CHẠM" mờ dần khi vòng tới gần nút (sửa sau review vòng 7, D-390): tâm vòng cách tâm nút còn
 * CUE_TEXT_FADE_FAR × Ø thì bắt đầu mờ, còn CUE_TEXT_FADE_NEAR × Ø (và suốt lúc đứng trên nút) thì tắt hẳn — tên
 * chế độ in trong hình tròn nút (`data-label="inside"`) đọc được đúng lúc phải chạm; viền vòng vẫn "khóa" vào nút.
 */
export const CUE_TEXT_FADE_FAR = 1;
export const CUE_TEXT_FADE_NEAR = 0.5;
/** Bề dày nét vòng chế độ mờ tự vẽ (`drawModeTargets`) + độ đục nét / viền của nó. */
const TARGET_LINE = 1.5;
const TARGET_ALPHA = 0.5;
const TARGET_HALO_ALPHA = 0.45;

const mbIndex = (b: MobileButton): number => MB_ORDER.indexOf(b);

/** Chấm giản phổ theo cỡ chữ nhãn: bán kính, khe với chữ số, bước giữa hai chấm. */
const dotRadius = (size: number): number => Math.max(1.5, size * 0.075);
const dotGap = (size: number): number => Math.max(1.5, size * 0.06);
const dotStep = (size: number): number => 2 * dotRadius(size) + Math.max(1, size * 0.05);

/** Phần `n` chấm (một phía) vượt khỏi ô em của chữ số — khối nhãn chừa thêm chừng này. */
export function dotExtra(size: number, n: number): number {
  if (n <= 0) return 0;
  return Math.max(0, dotGap(size) + n * dotStep(size) - (size * (1 - CAP_RATIO)) / 2);
}

// ---------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------

const COLOR_KEYS: readonly ModColorKey[] = ['normal', 'left', 'right', 'scroll'];
const SCROLL_COLOR = COLOR_KEYS.indexOf('scroll');
/**
 * Bảng màu đặc (nền chroma): index màu k = 0..3 là thân (MOD_COLORS[COLOR_KEYS[k]].fill),
 * STROKE_COLOR + k là viền (palette.tileStroke); mỗi màu LUT_STEPS + 1 bậc alpha.
 */
const STROKE_COLOR = COLOR_KEYS.length;
const LUT_STEPS = 32;
/** Phủ sáng thân tile đang chạm hit line. */
const ACTIVE_FILL = 'rgba(255,255,255,0.22)';
const ARROW_GLYPH: readonly string[] = ['', '↓', '↑'];
const COMMA_LANE = keyIndex(',');

// Bố cục scratch cho mỗi tile đang thấy (Float32Array, stride cố định).
const F_X = 0;
const F_Y = 1;
const F_W = 2;
const F_H = 3;
const F_A = 4;
const F_KX = 5;
const F_KY = 6;
const F_SX = 7;
const F_SY = 8;
const F_AX = 9;
const F_AY = 10;
const F_BX = 11;
const F_BY = 12;
/** Bậc font nhãn phím (index vào tierSize), -1 = không vẽ nhãn. */
const F_T = 13;
/** Bán kính badge "#" (0 = không có). */
const F_BR = 14;
/**
 * Cờ: FLAG_ACTIVE (đang ở hit line, sáng) | FLAG_GHOST (ô nhịp đếm vào) | FLAG_COPY (bản vẽ lại
 * của vòng loop kế — không mang trạng thái practice của vòng hiện tại).
 */
const F_FLAGS = 15;
/** Độ loé sáng practice (0..1). */
const F_FL = 16;
/** Thanh bấm lặp: index nốt CUỐI của thanh (visIdx = nốt đầu); -1 = tile thường. */
const F_RUN = 17;
/** Thanh: beat hiện tại của đoạn trừ startBeat nốt đầu thanh (đoạn sáng / loé của từng nốt). */
const F_REL = 18;
/** Thanh: số lần bấm còn lại (0 = không vẽ số) + tâm chữ số. */
const F_CN = 19;
const F_CX = 20;
const F_CY = 21;
/** Thanh: số nốt đầu thanh thuộc ô nhịp đếm vào (vẽ mờ). */
const F_GN = 22;
/** Thanh: nốt đang ở hit line (tính từ nốt đầu thanh), -1 = không có. */
const F_AJ = 23;
/** Thanh: lớp cỡ chữ số (= số chữ số của số lần bấm lớn nhất của đoạn, index vào rpFonts). */
const F_CF = 24;
/**
 * Thanh: hộp bao khối chữ (nhãn phím, nhãn phụ, ↓/↑, "#", số) theo toạ độ canvas — vạch đầu nốt chừa ra (không gạch
 * ngang chữ); x0 > x1 = không có chữ.
 */
const F_LX0 = 25;
const F_LY0 = 26;
const F_LX1 = 27;
const F_LY1 = 28;
const STRIDE = 29;
const FLAG_ACTIVE = 1;
const FLAG_GHOST = 2;
const FLAG_COPY = 4;

// ── Thanh bấm lặp (D-447) ──
/** Cỡ chữ số lần bấm / cỡ nhãn phím (bậc 0); không nhỏ hơn REPEAT_COUNT_MIN_PX. */
export const REPEAT_COUNT_RATIO = 0.72;
export const REPEAT_COUNT_MIN_PX = 9;
/** Vạch ở đầu từng nốt bên trong thanh: độ đục (× độ đục thanh), bề dày (× scale), phần bề ngang chừa mỗi bên. */
const REPEAT_TICK_ALPHA = 0.55;
const REPEAT_TICK_WIDTH = 1.5;
const REPEAT_TICK_INSET = 0.16;
/** Vạch đi qua khối chữ chỉ còn phần ngoài bề ngang chữ (cách chữ ≥ 2 px); phần ngắn hơn chừng này px thì bỏ. */
const REPEAT_TICK_MIN = 3;
/**
 * Mỗi lần bấm của thanh loé sáng nhẹ ở đoạn của nốt đó khi nó chạm hit line (nốt liền nhau không có khe như tile
 * rời → vẫn thấy từng lần bấm): độ đục ban đầu, tắt dần trong chừng này beat; giảm chuyển động → không loé.
 */
const REPEAT_PULSE_ALPHA = 0.5;
/** Mỗi lần bấm trong thanh sáng mạnh rồi tắt dần trong phần này của độ dài nốt (re-trigger ở lần bấm kế). */
const REPEAT_PULSE_SPAN = 0.85;
/** Độ dài chớp ngắn nhất (beat) — nốt rất ngắn vẫn thấy được chớp. */
const REPEAT_PULSE_MIN_BEATS = 0.12;
/** Lớp cỡ chữ số lần bấm của đoạn `n` nốt: số chữ số (1…3; ≥ 100 nốt → 3). */
const countClass = (n: number): number => (n < 10 ? 1 : n < 100 ? 2 : 3);

const nowMs = (): number =>
  typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();

/**
 * Cửa sổ chứa canvas: canvas nằm trong document khác (cửa sổ nổi Document PiP) → window của document
 * đó (DPR / matchMedia / ResizeObserver theo màn hình của cửa sổ nổi, chạy cả khi tab gốc bị ẩn);
 * còn lại → `window` global (giữ nguyên hành vi cũ, kể cả global bị stub trong test).
 */
function hostWindow(canvas: HTMLCanvasElement): (Window & typeof globalThis) | null {
  if (typeof window === 'undefined') return null;
  const doc = canvas.ownerDocument as Document | null;
  if (!doc || (typeof document !== 'undefined' && doc === document)) return window;
  return (doc.defaultView as (Window & typeof globalThis) | null) ?? window;
}

function readDpr(win: Window | null): number {
  const raw = win ? win.devicePixelRatio : 1;
  return typeof raw === 'number' && Number.isFinite(raw) && raw > 0
    ? Math.min(4, Math.max(0.5, raw))
    : 1;
}

/** Kích thước ô device pixel do ResizeObserver('device-pixel-content-box') báo. */
interface DeviceBox {
  w: number;
  h: number;
  cssW: number;
  cssH: number;
  dpr: number;
}

/** Màu lưới + nhãn section (một phần CanvasTheme). */
type GridColors = Pick<
  CanvasTheme,
  'barLine' | 'beatLine' | 'sectionLine' | 'sectionBg' | 'sectionText' | 'sectionBorder'
>;

export class TilesRenderer {
  private readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D | null;
  private opts: RendererOptions;
  private pal: Readonly<CanvasTheme>;
  /** Màu đặc trộn sẵn theo alpha (pal.translucent = false, nền chroma); null = vẽ bán trong suốt. */
  private lut: string[] | null = null;
  /**
   * Lưới mờ (`gridStyle: 'subtle'`) trên bảng màu đặc (chroma): vạch / nhãn section trộn sẵn alpha
   * lên `opaqueBase` thay cho globalAlpha (bán trong suốt trên #00FF00 bị Chroma Key ăn — D-240).
   */
  private subtleSolid: GridColors | null = null;
  private timeline: Timeline | null = null;
  private lay: Layout | null = null;
  /** Kích thước đo được lần resize trước (px CSS lẻ + device px) để bỏ qua khi không đổi. */
  private cssW = -1;
  private cssH = -1;
  private devW = -1;
  private devH = -1;
  private dpr = 0;
  /** DPR cố định (`TilesRendererInit.dpr`); null = theo cửa sổ chứa canvas. */
  private readonly fixedDpr: number | null;
  /** Cần tính lại font / độ dài tile / bề rộng chữ trước frame kế. */
  private dirty = true;
  private disposed = false;
  private readonly hasRoundRect: boolean;
  private mql: MediaQueryList | null = null;
  /**
   * `prefers-reduced-motion: reduce` của cửa sổ chứa canvas (DESIGN.md nguyên tắc 4): tile đang chờ
   * bấm (practice "Chờ") có viền đậm tĩnh thay vì nhấp nháy.
   */
  private reduceMotion = false;
  private motionMql: MediaQueryList | null = null;
  private readonly onMotionChange = (): void => {
    this.reduceMotion = this.motionMql?.matches === true;
    this.redraw();
  };
  private ro: ResizeObserver | null = null;
  private devBox: DeviceBox | null = null;
  /** Frame vẽ gần nhất — để tự vẽ lại sau khi resize xóa bitmap (đổi DPR lúc pause). */
  private lastFrame: RenderFrame | null = null;
  private readonly onDprChange = (): void => {
    if (this.resize()) this.redraw();
  };

  // Dữ liệu tĩnh theo nốt (setTimeline).
  private nCount = 0;
  private nStart = new Float64Array(0);
  private nEnd = new Float64Array(0);
  /** startBeat nốt kế cùng lane, Infinity nếu không có. */
  private nNext = new Float64Array(0);
  /** Index nốt trước cùng lane, -1 nếu không có. */
  private nPrev = new Int32Array(0);
  private nLane = new Uint8Array(0);
  private nColor = new Uint8Array(0);
  /** 0 không, 1 ↓ (chuột trái), 2 ↑ (chuột phải). */
  private nArrow = new Uint8Array(0);
  private nScroll = new Uint8Array(0);
  /** Độ dài tile (px) theo layout hiện tại (prepare). */
  private nLen = new Float32Array(0);
  /** Bậc font nhãn phím theo layout hiện tại (prepare), -1 = không nhãn. */
  private nTier = new Int8Array(0);
  /** Mobile: số chấm trên / dưới số giản phổ (jianpuLabel). */
  private nDotA = new Uint8Array(0);
  private nDotB = new Uint8Array(0);
  private maxLenBeats = 0;

  // Thanh bấm lặp (D-447, core/repeatRuns): đoạn theo nốt + hình học / chữ theo layout (prepare).
  /** Index đoạn chứa nốt, -1 = nốt vẽ tile thường. */
  private nRep: Int32Array = new Int32Array(0);
  private rpCount = 0;
  private rpFirst = new Int32Array(0);
  private rpLast = new Int32Array(0);
  /** Độ dài thanh (px) + bậc font nhãn phím theo layout hiện tại. */
  private rpLen = new Float32Array(0);
  private rpTier = new Int8Array(0);
  /** Số nốt của đoạn dài nhất = số lớn nhất có thể vẽ. */
  private rpMax = 0;
  /**
   * Lớp cỡ chữ số của đoạn = số chữ số của số nốt (1…3): đoạn ≤ 9 nốt không bị thu nhỏ theo đoạn dài nhất của bài
   * ("×12" hẹp lane → chỉ đoạn đó chữ nhỏ); cả thanh một cỡ (số chỉ giảm).
   */
  private rpCls = new Uint8Array(0);
  private rpMaxCls = 1;
  /** Chữ số lần bấm theo số (index n → "×n"; index 0 = ''). */
  private rpText: string[] = [''];
  /** Theo lớp (index 1…rpMaxCls): font, chiều cao dòng; bề rộng "×n" ở font lớp d = rpW[d * (rpMax + 1) + n]. */
  private rpFonts: string[] = [''];
  private rpLines: number[] = [14];
  private rpW = new Float32Array(1);

  // Mobile (scheme 'mobile'): các lần chạm (vòng "CHẠM") của kế hoạch chạm.
  private mobile = false;
  private cCount = 0;
  private cBeat = new Float64Array(0);
  /** Nút cần chạm (MB_*). */
  private cBtn = new Uint8Array(0);
  /** Index nốt của cue (cue vào lại thay các cue của kế hoạch tại nốt này). */
  private cNote = new Int32Array(0);
  /**
   * Lớp canvas trong suốt của bàn nút DOM (`CUE_LAYER_ATTR`, cùng hộp với canvas tiles): vòng "CHẠM" vẽ ở
   * đây — trên nút chế độ DOM, vòng đáp đè lên nút thay vì chui dưới nút; null = vẽ thẳng lên canvas tiles.
   */
  private cueLayer: HTMLCanvasElement | null = null;
  private cueLayerCtx: CanvasRenderingContext2D | null = null;
  /** Lớp đang có hình (frame trước có vòng) → xóa trước frame kế. */
  private cueLayerInk = false;
  /** Lớp không lấy được context 2D (jsdom) — không thử lại mỗi frame. */
  private readonly deadLayers = new WeakSet<HTMLCanvasElement>();
  /** Nền chroma: màu đặc trộn sẵn theo (màu, bậc alpha) cho nét / chữ vòng "CHẠM". */
  private readonly solidCache = new Map<string, string[]>();

  // Hold run.
  private rCount = 0;
  private rStart = new Float64Array(0);
  private rEnd = new Float64Array(0);
  private rColor = new Uint8Array(0);
  private rKind = new Uint8Array(0);
  private maxRunBeats = 0;

  // Section không rỗng.
  private secStart: number[] = [];
  private secName: string[] = [];
  private secW: number[] = [];
  private maxSecW = 0;

  // Nhãn theo lane + metric (prepare).
  private laneKey: readonly string[] = NOTE_KEYS.slice();
  /** Lane vẽ "," phóng to (PC); -1 ở mobile (lane cuối là số "1"). */
  private commaLane = COMMA_LANE;
  /** Có nhãn phụ không (mobile: chỉ solfège — không lặp lại số). */
  private subOn = true;
  private laneSub: string[] = NOTE_KEYS.map(() => '');
  /** Nhãn phụ có chấm trên (1̇): vẽ chấm bằng tay — font hệ thống đặt U+0307 lệch sang phải. */
  private readonly laneSubDot = new Uint8Array(LANE_COUNT);
  /** Bề rộng nhãn phím ở cỡ lớn nhất (bậc 0) — chọn bố cục lane rộng/hẹp. */
  private readonly laneKeyW = new Float32Array(LANE_COUNT);
  private readonly laneSubW = new Float32Array(LANE_COUNT);
  private keySize = 28;
  private subSize = 12;
  private pad = 4;
  private glyphW = 10;
  private badgeR = 7;
  /** Bậc cỡ chữ nhãn phím, giảm dần: [keySize, sàn ≥ 28, …bậc gọn cho tile bị luật gap]. */
  private tierSize: number[] = [];
  private tierFont: string[] = [];
  private tierCommaSize: number[] = [];
  private tierCommaFont: string[] = [];
  /** Bề rộng nhãn phím theo (bậc, lane): index t * LANE_COUNT + lane. */
  private tierKeyW = new Float32Array(0);
  /** Số bậc ≥ sàn 28px (tile không bị luật gap chỉ dùng các bậc này). */
  private fullTiers = 1;
  private smallFont = '';
  private sectionFont = '';
  private sectionH = 18;
  /** Bề dày nhãn section xoay dọc trong lề trái (không lấn vào tile lane Z). */
  private sectionThick = 16;
  private ribbonFont = '';
  private ribbonLineH = 12;
  private ribbonPad = 3;
  private ribbonWords: string[][] = [];
  private ribbonCapLen: number[] = [];
  private ribbonCompactLen: number[] = [];
  private releaseText = '';
  private releaseCapLen = 0;
  // Vòng "CHẠM" (prepareCueRings): đích theo layout, chữ, font, bề dày nét màu.
  private cueT: CueTargets | null = null;
  private cueText = '';
  private cueFont = '';
  private cueLine = 2;
  private readonly widthCache = new Map<string, number>();

  // Scratch cho tile đang thấy.
  /** Bậc font có nhãn phím / nhãn "," trong frame (pass thân tile ghi, pass nhãn đọc). */
  private keyTierMask = 0;
  private commaTierMask = 0;
  private visIdx = new Int32Array(64);
  private vis = new Float32Array(64 * STRIDE);
  private readonly tmp: Rect = { x: 0, y: 0, w: 0, h: 0 };
  private readonly tmp2: Rect = { x: 0, y: 0, w: 0, h: 0 };
  /** Hộp bao khối chữ của thanh đang thu (x0, y0, x1, y1) — collectBar, không cấp phát. */
  private readonly lbox = new Float64Array(4);

  constructor(
    canvas: HTMLCanvasElement,
    options: Partial<RendererOptions> = {},
    init: TilesRendererInit = {},
  ) {
    this.canvas = canvas;
    this.fixedDpr =
      typeof init.dpr === 'number' && Number.isFinite(init.dpr) && init.dpr > 0
        ? Math.min(4, Math.max(0.5, init.dpr))
        : null;
    this.opts = sanitizeRendererOptions(options);
    this.mobile = this.opts.scheme === 'mobile';
    this.pal = canvasThemeFor(this.opts.theme, this.opts.background);
    this.buildLut();
    let ctx: CanvasRenderingContext2D | null;
    try {
      ctx = canvas.getContext('2d') ?? null;
    } catch {
      // jsdom / môi trường không có canvas → render() no-op.
      ctx = null;
    }
    this.ctx = ctx;
    this.hasRoundRect = ctx !== null && typeof ctx.roundRect === 'function';
    // DPR cố định: không theo ô device pixel / đổi màn hình.
    if (ctx && this.fixedDpr === null) this.observeDevicePixels();
    this.watchMotion();
  }

  /** Theo dõi prefers-reduced-motion của cửa sổ chứa canvas (cửa sổ nổi: của cửa sổ đó). */
  private watchMotion(): void {
    const win = hostWindow(this.canvas);
    if (!win || typeof win.matchMedia !== 'function') return;
    try {
      const mql = win.matchMedia('(prefers-reduced-motion: reduce)');
      this.reduceMotion = mql.matches === true;
      mql.addEventListener('change', this.onMotionChange);
      this.motionMql = mql;
    } catch {
      this.motionMql = null;
    }
  }

  /** Layout hiện tại (null trước resize hoặc khi canvas kích thước 0) — để UI căn theo lane. */
  get layout(): Layout | null {
    return this.lay;
  }

  get options(): Readonly<RendererOptions> {
    return this.opts;
  }

  setTimeline(tl: Timeline | null): void {
    if (this.disposed) return;
    this.timeline = tl;

    const notes = tl ? tl.notes : [];
    const n = notes.length;
    this.nCount = n;
    this.nStart = new Float64Array(n);
    this.nEnd = new Float64Array(n);
    this.nNext = new Float64Array(n);
    this.nPrev = new Int32Array(n);
    this.nLane = new Uint8Array(n);
    this.nColor = new Uint8Array(n);
    this.nArrow = new Uint8Array(n);
    this.nScroll = new Uint8Array(n);
    this.nLen = new Float32Array(n);
    this.nTier = new Int8Array(n);
    this.nDotA = new Uint8Array(n);
    this.nDotB = new Uint8Array(n);
    const lastStart = new Float64Array(LANE_COUNT).fill(Infinity);
    for (let i = n - 1; i >= 0; i--) {
      const note = notes[i];
      const lane = Math.max(0, keyIndex(note.key));
      const m = note.modifiers;
      this.nStart[i] = note.startBeat;
      this.nEnd[i] = note.endBeat;
      this.nLane[i] = lane;
      this.nNext[i] = lastStart[lane];
      lastStart[lane] = note.startBeat;
      this.nColor[i] = COLOR_KEYS.indexOf(tileColorKey(m));
      this.nArrow[i] = m.left ? 1 : m.right ? 2 : 0;
      this.nScroll[i] = m.scroll ? 1 : 0;
      const jp = jianpuLabel(note.key, note.octave);
      this.nDotA[i] = jp.dotsAbove;
      this.nDotB[i] = jp.dotsBelow;
    }
    const lastIdx = new Int32Array(LANE_COUNT).fill(-1);
    for (let i = 0; i < n; i++) {
      const lane = this.nLane[i];
      this.nPrev[i] = lastIdx[lane];
      lastIdx[lane] = i;
    }

    // Thanh bấm lặp: ≥ 4 nốt ngắn liên tiếp cùng một lần bấm (D-447).
    const reps = findRepeatRuns(notes);
    this.rpCount = reps.length;
    this.nRep = repeatRunIndex(reps, n);
    this.rpFirst = new Int32Array(reps.length);
    this.rpLast = new Int32Array(reps.length);
    this.rpLen = new Float32Array(reps.length);
    this.rpTier = new Int8Array(reps.length);
    this.rpCls = new Uint8Array(reps.length);
    let rpMax = 0;
    let rpMaxCls = 1;
    reps.forEach((r, k) => {
      this.rpFirst[k] = r.firstNote;
      this.rpLast[k] = r.firstNote + r.noteCount - 1;
      if (r.noteCount > rpMax) rpMax = r.noteCount;
      const cls = countClass(r.noteCount);
      this.rpCls[k] = cls;
      if (cls > rpMaxCls) rpMaxCls = cls;
    });
    this.rpMax = rpMax;
    this.rpMaxCls = rpMaxCls;

    const runs = tl ? tl.holdRuns : [];
    const rn = runs.length;
    this.rCount = rn;
    this.rStart = new Float64Array(rn);
    this.rEnd = new Float64Array(rn);
    this.rColor = new Uint8Array(rn);
    this.rKind = new Uint8Array(rn);
    let maxRun = 0;
    for (let i = 0; i < rn; i++) {
      const r = runs[i];
      this.rStart[i] = r.startBeat;
      this.rEnd[i] = r.endBeat;
      this.rColor[i] = COLOR_KEYS.indexOf(tileColorKey(r.modifiers));
      this.rKind[i] = ribbonKind(r.modifiers);
      if (r.endBeat - r.startBeat > maxRun) maxRun = r.endBeat - r.startBeat;
    }
    this.maxRunBeats = maxRun;

    this.secStart = [];
    this.secName = [];
    for (const s of tl ? tl.sections : []) {
      if (s.lineCount > 0 && s.endBeat > s.startBeat) {
        this.secStart.push(s.startBeat);
        this.secName.push(s.name);
      }
    }
    this.secW = this.secStart.map(() => 0);
    this.buildMobile();
    this.dirty = true;
  }

  setOptions(patch: Partial<RendererOptions>): void {
    if (this.disposed) return;
    const prev = this.opts;
    const next = sanitizeRendererOptions(patch, prev);
    if (OPTION_KEYS.every((k) => prev[k] === next[k])) return;
    this.opts = next;
    this.mobile = next.scheme === 'mobile';
    const pal = canvasThemeFor(next.theme, next.background);
    if (pal !== this.pal) {
      this.pal = pal;
      this.buildLut();
    }
    const layoutChanged = LAYOUT_KEYS.some((k) => prev[k] !== next[k]);
    if (layoutChanged && this.devW > 0 && this.devH > 0) {
      this.lay = computeLayout(this.devW / this.dpr, this.devH / this.dpr, layoutOptionsOf(next));
    }
    const planChanged = prev.scheme !== next.scheme || prev.mobileSemitone !== next.mobileSemitone;
    if (planChanged) this.buildMobile();
    if (
      layoutChanged ||
      planChanged ||
      prev.subLabel !== next.subLabel ||
      prev.language !== next.language ||
      prev.modLabels !== next.modLabels ||
      prev.modeTargets !== next.modeTargets
    ) {
      this.dirty = true;
    }
  }

  /** Các lần chạm của kế hoạch chạm (core/mobile) — rỗng khi scheme PC hoặc chưa có timeline. */
  private buildMobile(): void {
    const tl = this.timeline;
    if (!this.mobile || !tl) {
      this.cCount = 0;
      return;
    }
    const cues = mobilePlanFor(tl, this.opts.mobileSemitone).cues;
    const n = cues.length;
    this.cCount = n;
    this.cBeat = new Float64Array(n);
    this.cBtn = new Uint8Array(n);
    this.cNote = new Int32Array(n);
    cues.forEach((cue, i) => {
      this.cBeat[i] = cue.beat;
      this.cNote[i] = cue.noteIndex;
      this.cBtn[i] = mbIndex(cueButton(cue));
    });
  }

  /**
   * Đo canvas (px CSS lẻ + ô device pixel) và devicePixelRatio; chỉ làm việc khi có thay đổi.
   * Backing store = đúng số device pixel trình duyệt dành cho canvas → bitmap hiện 1:1, không bị
   * nội suy (vạch 1px, nhãn phím sắc nét). Trả true nếu backing store / layout đã đổi (bitmap bị
   * xóa — người gọi cần vẽ lại).
   */
  resize(): boolean {
    if (this.disposed) return false;
    const dpr = this.fixedDpr ?? readDpr(hostWindow(this.canvas));
    const c = this.canvas;
    let cssW = c.clientWidth;
    let cssH = c.clientHeight;
    let left = 0;
    let top = 0;
    const rect = typeof c.getBoundingClientRect === 'function' ? c.getBoundingClientRect() : null;
    // getBoundingClientRect cho px lẻ (clientWidth/Height làm tròn); bỏ qua nếu bị transform.
    if (
      rect &&
      rect.width > 0 &&
      rect.height > 0 &&
      Math.abs(rect.width - cssW) < 1 &&
      Math.abs(rect.height - cssH) < 1
    ) {
      cssW = rect.width;
      cssH = rect.height;
      left = rect.left;
      top = rect.top;
    }
    let devW: number;
    let devH: number;
    const box = this.devBox;
    // Chỉ tin ô device pixel khi nó khớp px CSS × dpr (±1.5): giả lập DPR (DevTools/Playwright
    // deviceScaleFactor) báo ô này bằng px CSS trong khi devicePixelRatio ≠ 1.
    if (
      box &&
      box.dpr === dpr &&
      Math.abs(box.cssW - cssW) < 0.01 &&
      Math.abs(box.cssH - cssH) < 0.01 &&
      Math.abs(box.w - cssW * dpr) <= 1.5 &&
      Math.abs(box.h - cssH * dpr) <= 1.5
    ) {
      devW = box.w;
      devH = box.h;
    } else {
      // Trình duyệt snap mép hộp về device pixel: kích thước = round(mép xa) − round(mép gần).
      devW = Math.round((left + cssW) * dpr) - Math.round(left * dpr);
      devH = Math.round((top + cssH) * dpr) - Math.round(top * dpr);
    }
    if (
      cssW === this.cssW &&
      cssH === this.cssH &&
      devW === this.devW &&
      devH === this.devH &&
      dpr === this.dpr
    ) {
      return false;
    }
    const dprChanged = dpr !== this.dpr;
    this.cssW = cssW;
    this.cssH = cssH;
    this.devW = devW;
    this.devH = devH;
    this.dpr = dpr;
    if (dprChanged) this.watchDpr();
    if (!(devW > 0 && devH > 0)) {
      this.lay = null;
      return true;
    }
    if (c.width !== devW) c.width = devW;
    if (c.height !== devH) c.height = devH;
    this.ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
    // Layout theo đúng ô device pixel (÷ dpr) → toạ độ CSS × dpr rơi đúng lưới pixel.
    this.lay = computeLayout(devW / dpr, devH / dpr, layoutOptionsOf(this.opts));
    this.dirty = true;
    return true;
  }

  render(frame: RenderFrame): void {
    const ctx = this.ctx;
    if (!ctx || this.disposed) return;
    this.lastFrame = frame;
    if (!this.lay) this.resize();
    const L = this.lay;
    if (!L) return;
    if (this.dirty) this.prepare(ctx, L);

    const cur = Number.isFinite(frame.beat) ? frame.beat : 0;

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
    ctx.shadowColor = 'transparent';
    this.drawBackground(ctx, L);

    const tl = this.timeline;
    // Loop: đoạn 0 = bài tới loop end; đoạn k ≥ 1 = [start, end) dời +k·len (vòng kế).
    let loopStart = 0;
    let loopEnd = Infinity;
    let loopLen = 0;
    let copies = 0;
    let ghostEnd = -Infinity;
    if (tl) {
      const loop = frame.loop;
      if (loop) {
        const start = Math.max(0, loop.start);
        const end = Math.min(loop.end, tl.totalBeats);
        if (Number.isFinite(start) && end > start && cur < end) {
          loopStart = start;
          loopEnd = end;
          loopLen = end - start;
          const farBeat = cur + L.lookahead;
          while (copies < MAX_LOOP_COPIES && loopEnd + copies * loopLen < farBeat) copies++;
        }
      }
      const ci = frame.countIn;
      if (ci && cur < ci.end) ghostEnd = ci.end;

      // Overlay khớp game: vạch nhịp / section mờ hơn (không che gameplay). drawGrid /
      // drawSectionLines không tự đặt alpha nên chỉ cần đặt quanh chúng.
      // Bảng màu đặc (chroma): màu trộn sẵn (gridColors), không globalAlpha.
      const subtle = this.opts.gridStyle === 'subtle' && this.subtleSolid === null;
      if (subtle) ctx.globalAlpha = SUBTLE_GRID_ALPHA;
      if (this.opts.showBarLines) {
        for (let k = 0; k <= copies; k++) {
          this.drawGrid(ctx, L, tl, cur - k * loopLen, k === 0 ? -Infinity : loopStart, loopEnd);
        }
      }
      const sections = this.opts.showSectionLabels && this.secStart.length > 0;
      if (sections) {
        for (let k = 0; k <= copies; k++) {
          this.drawSectionLines(
            ctx,
            L,
            cur - k * loopLen,
            k === 0 ? -Infinity : loopStart,
            loopEnd,
          );
        }
      }
      if (subtle) ctx.globalAlpha = 1;
      if (copies > 0) this.drawLoopMarkers(ctx, L, cur, loopEnd, loopLen, copies);
      // Gutter ribbon chỉ có ở kiểu PC (layoutOptionsOf: Mobile không có gutter).
      if (this.opts.showRibbons && L.gutter && !this.mobile) {
        for (let k = 0; k <= copies; k++) {
          const lo = k === 0 ? -Infinity : loopStart;
          const ghost = k === 0 ? ghostEnd : -Infinity;
          this.drawRibbons(ctx, L, cur - k * loopLen, lo, loopEnd, ghost);
        }
      }
      // Bàn nút kiểu game ('pad'): tile / nhãn section "đáp" xuống bàn nút — không vẽ gì dưới hit line
      // (vùng đó là bàn nút DOM phủ lên canvas).
      const padClip = L.pad !== null;
      if (padClip) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, 0, L.width, L.hitPos);
        ctx.clip();
      }
      let count = 0;
      for (let k = 0; k <= copies; k++) {
        const lo = k === 0 ? -Infinity : loopStart;
        const ghost = k === 0 ? ghostEnd : -Infinity;
        count = this.collectTiles(L, frame, cur - k * loopLen, lo, loopEnd, ghost, k > 0, count);
      }
      this.drawTileBodies(ctx, L, frame, count);
      this.drawTileLabels(ctx, count);
      // Nhãn section vẽ SAU tile (không bị tile lane Z che), trong lề trái / dải trên.
      if (sections) {
        for (let k = 0; k <= copies; k++) {
          const lo = k === 0 ? -Infinity : loopStart;
          this.drawSectionLabels(ctx, L, cur - k * loopLen, lo, loopEnd);
        }
      }
      if (padClip) ctx.restore();
    }
    this.drawHitLine(ctx, L);
    // Mobile: vòng "CHẠM" trên cùng (trên tile, hit line và cả nút chế độ DOM — qua lớp của bàn nút).
    const T = this.mobile && tl ? this.cueT : null;
    if (T) {
      // Không có nút chế độ thật ở đó (overlay OBS / bố cục không bàn nút): 4 vòng mờ làm đích.
      if (T.targets) this.drawModeTargets(ctx, L, T);
      const layer = T.targets || !L.pad ? null : this.cueLayerContext();
      if (!layer) this.releaseCueLayer();
      const out = layer ?? ctx;
      if (layer) {
        if (this.cueLayerInk) {
          layer.setTransform(1, 0, 0, 1, 0, 0);
          layer.clearRect(0, 0, this.devW, this.devH);
        }
        layer.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      }
      let ink = false;
      const entry0 = this.validEntry(frame.mobileEntry);
      const entryK = this.validEntry(frame.mobileLoopEntry);
      if (this.cCount > 0 || entry0 !== null || entryK !== null) {
        for (let k = 0; k <= copies; k++) {
          const lo = k === 0 ? -Infinity : loopStart;
          const ghost = k === 0 ? ghostEnd : -Infinity;
          const entry = k === 0 ? entry0 : entryK;
          if (this.drawCueRings(out, L, T, cur - k * loopLen, lo, loopEnd, ghost, entry))
            ink = true;
        }
      }
      out.globalAlpha = 1;
      if (layer) this.cueLayerInk = ink;
    } else {
      this.releaseCueLayer();
    }
    ctx.globalAlpha = 1;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.unwatchDpr();
    this.motionMql?.removeEventListener('change', this.onMotionChange);
    this.motionMql = null;
    this.ro?.disconnect();
    this.ro = null;
    this.releaseCueLayer();
    this.ctx = null;
    this.timeline = null;
    this.lay = null;
    this.lastFrame = null;
    this.widthCache.clear();
    this.solidCache.clear();
    this.nCount = 0;
    this.rCount = 0;
    this.cCount = 0;
    this.rpCount = 0;
    this.secStart = [];
    this.secName = [];
  }

  // -------------------------------------------------------------------------
  // Kích thước / DPR
  // -------------------------------------------------------------------------

  private redraw(): void {
    if (this.lastFrame && !this.disposed) this.render(this.lastFrame);
  }

  /**
   * ResizeObserver 'device-pixel-content-box': số device pixel chính xác của canvas, và báo cả khi
   * chỉ DPR đổi (kéo cửa sổ sang màn khác). Trình duyệt không hỗ trợ (Safari) → bỏ qua, dùng ước
   * lượng trong resize() + matchMedia(resolution).
   */
  private observeDevicePixels(): void {
    const RO = (hostWindow(this.canvas) as { ResizeObserver?: typeof ResizeObserver } | null)
      ?.ResizeObserver;
    if (typeof RO !== 'function') return;
    let ro: ResizeObserver | null = null;
    try {
      ro = new RO(this.onDeviceBox);
      ro.observe(this.canvas, { box: 'device-pixel-content-box' });
      this.ro = ro;
    } catch {
      ro?.disconnect();
      this.ro = null;
    }
  }

  private readonly onDeviceBox = (entries: ResizeObserverEntry[]): void => {
    if (this.disposed) return;
    const e = entries[entries.length - 1];
    if (!e) return;
    const sizes = (e as { devicePixelContentBoxSize?: readonly ResizeObserverSize[] })
      .devicePixelContentBoxSize;
    const box = sizes?.[0];
    if (!box) return;
    this.devBox = {
      w: box.inlineSize,
      h: box.blockSize,
      cssW: e.contentRect.width,
      cssH: e.contentRect.height,
      dpr: readDpr(hostWindow(this.canvas)),
    };
    if (this.resize()) this.redraw();
  };

  private watchDpr(): void {
    this.unwatchDpr();
    if (this.fixedDpr !== null) return;
    const win = hostWindow(this.canvas);
    if (!win || typeof win.matchMedia !== 'function') return;
    try {
      const mql = win.matchMedia(`(resolution: ${this.dpr}dppx)`);
      mql.addEventListener('change', this.onDprChange);
      this.mql = mql;
    } catch {
      this.mql = null;
    }
  }

  private unwatchDpr(): void {
    if (!this.mql) return;
    this.mql.removeEventListener('change', this.onDprChange);
    this.mql = null;
  }

  // -------------------------------------------------------------------------
  // Chuẩn bị (ngoài hot loop)
  // -------------------------------------------------------------------------

  private measure(ctx: CanvasRenderingContext2D, font: string, text: string): number {
    const k = `${font}\u0001${text}`;
    const hit = this.widthCache.get(k);
    if (hit !== undefined) return hit;
    if (this.widthCache.size > 1024) this.widthCache.clear();
    ctx.font = font;
    const m: unknown = ctx.measureText(text);
    const w =
      m && typeof m === 'object' && 'width' in m && typeof m.width === 'number' ? m.width : 0;
    this.widthCache.set(k, w);
    return w;
  }

  private prepare(ctx: CanvasRenderingContext2D, L: Layout): void {
    this.dirty = false;
    const o = this.opts;
    const s = L.scale;

    // Font + kích thước nhãn. Sàn 28px (spec) không phụ thuộc tileScale < 1.
    const floor = Math.round(Math.max(KEY_LABEL_MIN_PX, KEY_LABEL_MIN_PX * s));
    // 'pad': tile viên thuốc hẹp hơn lane nhiều → cỡ chữ theo bề rộng tile.
    const labelCross = L.pad ? (L.laneCrossSize - 2 * L.laneInset) * 0.62 : L.laneCrossSize * 0.42;
    this.keySize = Math.max(floor, Math.round(Math.min(labelCross, 36 * s)));
    this.subSize = Math.max(11, Math.round(this.keySize * 0.4));
    this.pad = Math.max(3, Math.round(4 * s));
    this.badgeR = Math.max(6, Math.round(this.subSize * 0.62));
    const sizes = [this.keySize];
    if (floor < this.keySize) sizes.push(floor);
    this.fullTiers = sizes.length;
    for (let c = floor; ;) {
      const next = Math.round(c * 0.75);
      if (next < KEY_LABEL_TINY_PX || next >= c) break;
      sizes.push(next);
      c = next;
    }
    this.tierSize = sizes;
    // Nhãn phím: Bahnschrift đậm condensed (kiểu HUD); nhãn phụ nhỏ để độ rộng thường cho dễ đọc.
    this.tierFont = sizes.map((z) => canvasFont(800, z));
    this.tierCommaSize = sizes.map((z) => Math.round(z * 1.45));
    this.tierCommaFont = this.tierCommaSize.map((z) => canvasFont(800, z));
    this.smallFont = canvasFont(700, this.subSize, 'normal');
    const secSize = Math.max(10, Math.round(12 * s));
    this.sectionFont = canvasFont(700, secSize);
    this.sectionH = Math.round(secSize * 1.6);
    const margin = L.labelBand ? (L.orientation === 'vertical' ? L.labelBand.w : 0) : 0;
    this.sectionThick = Math.max(secSize + 2, Math.min(this.sectionH, margin + L.laneInset - 1));

    // Nhãn phím: PC = Z X C … , ; mobile = số giản phổ (chấm theo quãng vẽ riêng từng nốt).
    const mobile = this.mobile;
    this.laneKey = mobile ? MOBILE_DIGITS : NOTE_KEYS;
    this.commaLane = mobile ? -1 : COMMA_LANE;
    // Nhãn phụ theo lane ("1̇" → "1" + chấm vẽ tay). Mobile: nhãn chính đã là số → chỉ solfège.
    const sub: SubLabel = mobile && o.subLabel === 'number' ? 'none' : o.subLabel;
    this.subOn = sub !== 'none';
    const table =
      sub === 'number' ? KEY_DEGREE : o.language === 'en' ? KEY_SOLFEGE_EN : KEY_SOLFEGE_VI;
    this.laneSub = NOTE_KEYS.map((k: NoteKey, i) => {
      const raw = sub === 'none' ? '' : table[k];
      const dot = raw.includes(COMBINING_DOT_ABOVE);
      this.laneSubDot[i] = dot ? 1 : 0;
      return dot ? raw.replace(COMBINING_DOT_ABOVE, '') : raw;
    });

    // Bề rộng chữ (cache; hot loop không measureText).
    this.tierKeyW = new Float32Array(sizes.length * LANE_COUNT);
    for (let t = 0; t < sizes.length; t++) {
      for (let i = 0; i < LANE_COUNT; i++) {
        this.tierKeyW[t * LANE_COUNT + i] =
          i === this.commaLane
            ? this.measure(ctx, this.tierCommaFont[t], this.laneKey[i])
            : this.measure(ctx, this.tierFont[t], this.laneKey[i]);
      }
    }
    for (let i = 0; i < LANE_COUNT; i++) {
      this.laneKeyW[i] = this.tierKeyW[i];
      this.laneSubW[i] = this.laneSub[i] ? this.measure(ctx, this.smallFont, this.laneSub[i]) : 0;
    }
    this.glyphW = Math.max(
      this.measure(ctx, this.smallFont, '↓'),
      this.measure(ctx, this.smallFont, '↑'),
      1,
    );
    this.maxSecW = 0;
    for (let i = 0; i < this.secName.length; i++) {
      const w = this.measure(ctx, this.sectionFont, this.secName[i]);
      this.secW[i] = w;
      if (w > this.maxSecW) this.maxSecW = w;
    }
    this.prepareRibbonLabels(ctx, L);
    if (mobile) this.prepareCueRings(ctx, L);

    // Độ dài tile + bậc font nhãn theo layout.
    let maxLen = 0;
    const minLen = L.minTileLen - 0.5;
    for (let i = 0; i < this.nCount; i++) {
      const len = tileLength(this.nStart[i], this.nEnd[i], this.nNext[i], L);
      this.nLen[i] = len;
      if (len > maxLen) maxLen = len;
      this.nTier[i] = this.tierFor(L, len, this.nLane[i], len < minLen);
    }
    // Chuỗi nốt lặp quá sát (không bậc nào lọt): chỉ nốt đầu chuỗi có nhãn (cỡ nhỏ nhất).
    // Duyệt ngược để nTier[prev] vẫn là giá trị gốc khi xét nốt i.
    const tiny = sizes.length - 1;
    for (let i = this.nCount - 1; i >= 0; i--) {
      if (this.nTier[i] >= 0) continue;
      const prev = this.nPrev[i];
      // Nốt trước cùng lane nằm trong thanh bấm lặp (không vẽ tile riêng) → nốt này mở chuỗi mới.
      if (prev < 0 || this.nTier[prev] >= 0 || this.nRep[prev] >= 0) this.nTier[i] = tiny;
    }
    // Thanh bấm lặp: một tile từ nốt đầu tới hết nốt cuối (luật gap với nốt kế cùng lane như tile thường).
    for (let r = 0; r < this.rpCount; r++) {
      const f = this.rpFirst[r];
      const l = this.rpLast[r];
      const len = tileLength(this.nStart[f], this.nEnd[l], this.nNext[l], L);
      this.rpLen[r] = len;
      if (len > maxLen) maxLen = len;
      this.rpTier[r] = this.tierFor(L, len, this.nLane[f], len < minLen);
    }
    if (this.rpCount > 0) this.prepareRepeatCount(ctx, L);
    this.maxLenBeats = maxLen / L.pxPerBeat;
  }

  /**
   * Chữ số lần bấm của thanh bấm lặp (D-447): "×n" (`player.repeatCount`) cho n = 1..rpMax, đo sẵn theo lớp cỡ chữ
   * (`countClass` = số chữ số của đoạn): ≈ REPEAT_COUNT_RATIO × nhãn phím; dọc: số rộng nhất CỦA LỚP lọt bề ngang tile
   * (đoạn ≤ 9 nốt không bị thu nhỏ theo "×12" của đoạn dài nhất bài); ngang: lọt bề cao làn.
   */
  private prepareRepeatCount(ctx: CanvasRenderingContext2D, L: Layout): void {
    const lang = this.opts.language;
    const max = this.rpMax;
    const text: string[] = [''];
    for (let k = 1; k <= max; k++) text.push(translate(lang, 'player.repeatCount', { n: k }));
    this.rpText = text;
    const cross = Math.max(1, L.laneCrossSize - 2 * L.laneInset);
    const want = Math.round(this.keySize * REPEAT_COUNT_RATIO);
    const vertical = L.orientation === 'vertical';
    const probe = canvasFont(800, 20);
    const classes = this.rpMaxCls;
    const fonts: string[] = [''];
    const lines: number[] = [0];
    const w = new Float32Array((classes + 1) * (max + 1));
    for (let d = 1; d <= classes; d++) {
      let size: number;
      if (vertical) {
        // Số rộng nhất lớp d (n = 10^(d−1) … min(max, 10^d − 1); chữ số không đều nhau ở font tỉ lệ).
        let widest = 0;
        const top = Math.min(max, d >= 3 ? max : 10 ** d - 1);
        for (let n = d === 1 ? 1 : 10 ** (d - 1); n <= top; n++) {
          widest = Math.max(widest, this.measure(ctx, probe, text[n]));
        }
        const perPx = Math.max(0.01, widest / 20);
        size = Math.min(want, Math.floor((cross - 4) / perPx));
      } else {
        size = Math.min(want, Math.floor(cross * 0.62));
      }
      size = Math.max(REPEAT_COUNT_MIN_PX, size);
      const font = canvasFont(800, size);
      fonts.push(font);
      lines.push(Math.round(size * 1.15));
      // Đoạn lớp d đếm lùi từ số nốt của nó (d chữ số) về 1 → cần bề rộng mọi n < 10^d.
      const top = Math.min(max, d >= 3 ? max : 10 ** d - 1);
      for (let n = 1; n <= top; n++) w[d * (max + 1) + n] = this.measure(ctx, font, text[n]);
    }
    this.rpFonts = fonts;
    this.rpLines = lines;
    this.rpW = w;
  }

  /**
   * Bậc font nhãn phím lớn nhất lọt tile dài `len` px (trục thời gian). Tile thường không xuống
   * dưới sàn 28px; tile bị luật gap cắt ngắn (`truncated`) dùng bậc gọn sao cho nhãn của các tile
   * liên tiếp cùng lane không đè nhau (≤ pitch − 1); không bậc nào lọt → -1.
   */
  private tierFor(L: Layout, len: number, lane: number, truncated: boolean): number {
    const pitchRoom = len + L.tileGap - 1;
    const vertical = L.orientation === 'vertical';
    const fitSize = vertical ? Math.max((len - 2 * this.pad) / CAP_RATIO, pitchRoom) : 0;
    const n = truncated ? this.tierSize.length : this.fullTiers;
    for (let t = 0; t < n; t++) {
      const fits = vertical
        ? this.tierSize[t] <= fitSize
        : this.tierKeyW[t * LANE_COUNT + lane] <= pitchRoom;
      if (fits) return t;
    }
    return truncated ? -1 : this.fullTiers - 1;
  }

  private prepareRibbonLabels(ctx: CanvasRenderingContext2D, L: Layout): void {
    const lang = this.opts.language;
    this.ribbonWords = RIBBON_KIND_KEYS.map((k) => splitRibbonWords(translate(lang, k)));
    this.releaseText = translate(lang, 'mod.release');
    const s = L.scale;
    const vertical = L.orientation === 'vertical';
    const base = Math.max(7, Math.round(11 * s));
    const inner = Math.max(8, L.ribbonCrossSize - 4);
    let size = base;
    if (vertical) {
      // Từ dài nhất phải lọt bề ngang dải (~56px).
      const baseFont = canvasFont(800, base);
      let widest = this.measure(ctx, baseFont, this.releaseText);
      for (const words of this.ribbonWords) {
        for (const w of words) widest = Math.max(widest, this.measure(ctx, baseFont, w));
      }
      if (widest > inner) size = Math.max(7, Math.floor((base * inner) / widest));
    } else {
      // Ngang: các dòng xếp chồng phải lọt bề cao gutter.
      let lines = 1;
      for (const words of this.ribbonWords) lines = Math.max(lines, words.length);
      size = Math.max(7, Math.min(base, Math.floor(inner / (lines * 1.15))));
    }
    this.ribbonFont = canvasFont(800, size);
    this.ribbonLineH = Math.round(size * 1.15);
    this.ribbonPad = Math.max(2, Math.round(3 * s));
    const capPad = 2 * this.ribbonPad;
    this.ribbonCapLen = [];
    this.ribbonCompactLen = [];
    for (let k = 0; k < this.ribbonWords.length; k++) {
      const words = this.ribbonWords[k];
      if (vertical) {
        this.ribbonCapLen.push(words.length * this.ribbonLineH + capPad);
        this.ribbonCompactLen.push(this.ribbonLineH + capPad);
      } else {
        let wmax = 0;
        for (const w of words) wmax = Math.max(wmax, this.measure(ctx, this.ribbonFont, w));
        this.ribbonCapLen.push(wmax + capPad);
        this.ribbonCompactLen.push(this.measure(ctx, this.ribbonFont, RIBBON_COMPACT[k]) + capPad);
      }
    }
    this.releaseCapLen = vertical
      ? this.ribbonLineH + capPad
      : this.measure(ctx, this.ribbonFont, this.releaseText) + capPad;
  }

  /**
   * Vòng "CHẠM": đích theo layout (`cueTargets`; overlay OBS `modeTargets: 'outline'` → tự vẽ đích mờ), chữ
   * "CHẠM" / "TAP" (không tên nút — vòng đáp đúng nút của nó). Ø vòng = Ø nút chế độ; nét màu 2–3 px; cỡ chữ
   * để khối chữ (rộng × cao chữ hoa + dấu) lọt trong lòng vòng (CUE_FONT_MIN…CUE_FONT_MAX).
   */
  private prepareCueRings(ctx: CanvasRenderingContext2D, L: Layout): void {
    const T = cueTargets(L, this.opts.modeTargets !== 'outline');
    this.cueT = T;
    this.cueText = translate(this.opts.language, 'player.mobile.tapBar');
    const d = T.size;
    this.cueLine = d >= 40 ? 3 : d >= 28 ? 2.5 : 2;
    // Bề rộng chữ / 1 px cỡ chữ (đo ở 20 px rồi chia — tỉ lệ gần tuyến tính); cao ≈ 0.8 em (kể cả dấu Ạ).
    const perPx = Math.max(0.01, this.measure(ctx, canvasFont(800, 20), this.cueText) / 20);
    const inner = d - 2 * this.cueLine - 2;
    const fit = inner / Math.hypot(perPx, 0.8);
    this.cueFont = canvasFont(
      800,
      Math.max(CUE_FONT_MIN, Math.min(CUE_FONT_MAX, Math.round(d * 0.34), Math.floor(fit))),
    );
  }

  private ensureVis(n: number): void {
    if (this.visIdx.length >= n) return;
    let cap = this.visIdx.length * 2;
    while (cap < n) cap *= 2;
    const idx = new Int32Array(cap);
    idx.set(this.visIdx);
    const vis = new Float32Array(cap * STRIDE);
    vis.set(this.vis);
    this.visIdx = idx;
    this.vis = vis;
  }

  // -------------------------------------------------------------------------
  // Vẽ
  // -------------------------------------------------------------------------

  private pathRoundRect(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    r: number,
  ): void {
    if (this.hasRoundRect && r > 0.5) ctx.roundRect(x, y, w, h, r);
    else ctx.rect(x, y, w, h);
  }

  /** Tag HUD: hình chữ nhật vát góc trên-phải và dưới-trái (nhãn section). */
  private pathTag(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    cut: number,
  ): void {
    const k = Math.min(cut, w / 2, h / 2);
    ctx.moveTo(x, y);
    ctx.lineTo(x + w - k, y);
    ctx.lineTo(x + w, y + k);
    ctx.lineTo(x + w, y + h);
    ctx.lineTo(x + k, y + h);
    ctx.lineTo(x, y + h - k);
    ctx.closePath();
  }

  /** Bảng màu đặc theo alpha cho nền chroma (một lần mỗi khi đổi palette, ngoài hot loop). */
  private buildLut(): void {
    const p = this.pal;
    if (p.translucent) {
      this.lut = null;
      this.subtleSolid = null;
      return;
    }
    const grid = (c: string): string => blendOver(c, SUBTLE_GRID_ALPHA, p.opaqueBase);
    const label = (c: string): string => blendOver(c, SUBTLE_LABEL_ALPHA, p.opaqueBase);
    this.subtleSolid = {
      barLine: grid(p.barLine),
      beatLine: grid(p.beatLine),
      sectionLine: grid(p.sectionLine),
      sectionBg: label(p.sectionBg),
      sectionText: label(p.sectionText),
      sectionBorder: label(p.sectionBorder),
    };
    const colors = [
      ...COLOR_KEYS.map((k) => MOD_COLORS[k].fill),
      ...COLOR_KEYS.map((k) => p.tileStroke[k]),
    ];
    const lut: string[] = [];
    for (const c of colors) {
      for (let q = 0; q <= LUT_STEPS; q++) lut.push(blendOver(c, q / LUT_STEPS, p.opaqueBase));
    }
    this.lut = lut;
  }

  private lutColor(lut: readonly string[], k: number, alpha: number): string {
    const a = alpha <= 0 ? 0 : alpha >= 1 ? 1 : alpha;
    return lut[k * (LUT_STEPS + 1) + Math.round(a * LUT_STEPS)];
  }

  /**
   * fillStyle + globalAlpha cho màu modifier `k` (0..3 = thân; STROKE_COLOR + k = viền) ở độ đục
   * `alpha`. Nền chroma: màu đặc trộn sẵn, alpha 1 (không bị chroma key ăn mất).
   */
  private paintFill(ctx: CanvasRenderingContext2D, k: number, alpha: number): void {
    const lut = this.lut;
    if (lut) {
      ctx.globalAlpha = 1;
      ctx.fillStyle = this.lutColor(lut, k, alpha);
    } else {
      ctx.globalAlpha = alpha;
      ctx.fillStyle =
        k < STROKE_COLOR
          ? MOD_COLORS[COLOR_KEYS[k]].fill
          : this.pal.tileStroke[COLOR_KEYS[k - STROKE_COLOR]];
    }
  }

  /** Như paintFill nhưng cho strokeStyle. */
  private paintStroke(ctx: CanvasRenderingContext2D, k: number, alpha: number): void {
    const lut = this.lut;
    if (lut) {
      ctx.globalAlpha = 1;
      ctx.strokeStyle = this.lutColor(lut, k, alpha);
    } else {
      ctx.globalAlpha = alpha;
      ctx.strokeStyle =
        k < STROKE_COLOR
          ? MOD_COLORS[COLOR_KEYS[k]].fill
          : this.pal.tileStroke[COLOR_KEYS[k - STROKE_COLOR]];
    }
  }

  /** Đường dọc theo trục thời gian tại toạ độ cross `c` (vạch ngăn lane). */
  private lineAlongTime(ctx: CanvasRenderingContext2D, L: Layout, c: number): void {
    if (L.orientation === 'vertical') {
      ctx.moveTo(c, 0);
      ctx.lineTo(c, L.height);
    } else {
      ctx.moveTo(0, c);
      ctx.lineTo(L.width, c);
    }
  }

  /** Đường cắt ngang trục thời gian tại `t`, từ cross c0 tới c1 (vạch nhịp, hit line). */
  private lineAcross(
    ctx: CanvasRenderingContext2D,
    L: Layout,
    t: number,
    c0: number,
    c1: number,
  ): void {
    if (L.orientation === 'vertical') {
      ctx.moveTo(c0, t);
      ctx.lineTo(c1, t);
    } else {
      ctx.moveTo(t, c0);
      ctx.lineTo(t, c1);
    }
  }

  private drawBackground(ctx: CanvasRenderingContext2D, L: Layout): void {
    const p = this.pal;
    const bg = this.opts.background;
    if (bg === 'transparent') {
      ctx.clearRect(0, 0, L.width, L.height);
    } else if (bg === 'chroma') {
      ctx.fillStyle = CHROMA_GREEN;
      ctx.fillRect(0, 0, L.width, L.height);
    } else {
      ctx.fillStyle = p.bg;
      ctx.fillRect(0, 0, L.width, L.height);
    }
    if (p.laneFill) {
      for (let i = 0; i < LANE_COUNT; i++) {
        const r = L.lanes[i];
        ctx.fillStyle = i % 2 === 0 ? p.laneFill : p.laneFillAlt;
        ctx.fillRect(r.x, r.y, r.w, r.h);
      }
    }
    if (p.gutterFill && L.gutter) {
      ctx.fillStyle = p.gutterFill;
      ctx.fillRect(L.gutter.x, L.gutter.y, L.gutter.w, L.gutter.h);
    }
    if (p.pastShade) {
      const pastEdge = L.timeDir < 0 ? L.timeLength : 0;
      const r = mapSpan(L, 0, L.crossLength, L.hitPos, pastEdge, this.tmp);
      ctx.fillStyle = p.pastShade;
      ctx.fillRect(r.x, r.y, r.w, r.h);
    }
    // Vạch ngăn lane (cả mép lane/gutter và lane/lề nhãn).
    ctx.strokeStyle = p.laneSeparator;
    ctx.lineWidth = 1;
    ctx.beginPath();
    const c0 = L.laneCrossStart[0];
    // Khung bảng phím PC (frameInset > 0): như game, vạch chỉ NGĂN GIỮA các cột — mép ngoài 8 làn để trống (ô ngoài
    // cùng không bị vạch kẹp sát); thay vào đó một vạch ở mép phải khung = ranh giới với gutter ribbon.
    const framed = L.frameInset > 0;
    for (let i = 0; i <= LANE_COUNT; i++) {
      if (framed && (i === 0 || i === LANE_COUNT)) continue;
      const c = c0 + i * L.laneCrossSize;
      if ((i === 0 && c < 1) || c > L.crossLength - 1) continue;
      this.lineAlongTime(ctx, L, Math.round(c) + 0.5);
    }
    if (framed && L.gutter) {
      const g = c0 + LANE_COUNT * L.laneCrossSize + L.frameInset;
      if (g <= L.crossLength - 1) this.lineAlongTime(ctx, L, Math.round(g) + 0.5);
    }
    ctx.stroke();
  }

  /**
   * Vạch nhịp/phách. `c` = beat hiện tại của đoạn đang vẽ (đã trừ độ dời vòng loop); chỉ vẽ vạch
   * thuộc [lo, hi) (hi = loop end, Infinity nếu không loop).
   */
  private drawGrid(
    ctx: CanvasRenderingContext2D,
    L: Layout,
    tl: Timeline,
    c: number,
    lo: number,
    hi: number,
  ): void {
    const p = this.gridColors();
    const bpb = tl.beatsPerBar > 0 ? tl.beatsPerBar : 4;
    const from = Math.max(0, c - L.behindBeats, lo);
    const to = Math.min(tl.totalBeats, c + L.lookahead);
    if (!(to >= from)) return;
    const excl = hi - 1e-9;
    const c0 = L.laneCrossStart[0];
    const c1 = c0 + L.laneCrossSize * LANE_COUNT;
    const ppb = L.pxPerBeat;

    if (ppb >= 16) {
      ctx.strokeStyle = p.beatLine;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let b = Math.ceil(from - 1e-9); b <= to && b < excl; b++) {
        const q = b / bpb;
        if (Math.abs(q - Math.round(q)) < 1e-6) continue;
        const t = Math.round(L.hitPos + L.timeDir * (b - c) * ppb) + 0.5;
        this.lineAcross(ctx, L, t, c0, c1);
      }
      ctx.stroke();
    }

    ctx.strokeStyle = p.barLine;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let k = Math.ceil(from / bpb - 1e-9); k * bpb <= to + 1e-9 && k * bpb < excl; k++) {
      const t = Math.round(L.hitPos + L.timeDir * (k * bpb - c) * ppb) + 0.5;
      this.lineAcross(ctx, L, t, c0, c1);
    }
    ctx.stroke();
  }

  /** Màu vạch nhịp / section + nhãn section: bảng màu, hoặc màu đặc trộn sẵn (lưới mờ trên chroma). */
  private gridColors(): GridColors {
    return this.opts.gridStyle === 'subtle' && this.subtleSolid ? this.subtleSolid : this.pal;
  }

  /** Khoảng beat (sau vạch section) mà nhãn section còn chiếm trên trục thời gian. */
  private sectionMarginBeats(L: Layout): number {
    return (Math.max(this.sectionH, this.maxSecW + this.sectionH) + 12) / L.pxPerBeat;
  }

  private drawSectionLines(
    ctx: CanvasRenderingContext2D,
    L: Layout,
    c: number,
    lo: number,
    hi: number,
  ): void {
    const n = this.secStart.length;
    const margin = this.sectionMarginBeats(L);
    const winStart = c - L.behindBeats - margin;
    const winEnd = c + L.lookahead;
    const c1 = L.laneCrossStart[0] + L.laneCrossSize * LANE_COUNT;
    ctx.strokeStyle = this.gridColors().sectionLine;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const b = this.secStart[i];
      if (b < lo || b >= hi || b <= winStart || b >= winEnd) continue;
      const t = Math.round(L.hitPos + L.timeDir * (b - c) * L.pxPerBeat) + 0.5;
      this.lineAcross(ctx, L, t, 0, c1);
    }
    ctx.stroke();
  }

  /**
   * Nhãn section ở biên trái khi section bắt đầu (spec §5). Dọc: nhãn xoay đọc từ dưới lên nằm
   * trong lề nhãn bên trái lane Z, phía tương lai của vạch — không bao giờ đè/bị che bởi tile.
   * Ngang: viên nhãn nằm trong dải nhãn phía trên lane.
   */
  private drawSectionLabels(
    ctx: CanvasRenderingContext2D,
    L: Layout,
    c: number,
    lo: number,
    hi: number,
  ): void {
    const n = this.secStart.length;
    const p = this.gridColors();
    const vertical = L.orientation === 'vertical';
    const margin = this.sectionMarginBeats(L);
    const winStart = c - L.behindBeats - margin;
    const winEnd = c + L.lookahead;
    ctx.font = this.sectionFont;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.globalAlpha =
      this.opts.gridStyle === 'subtle' && this.subtleSolid === null ? SUBTLE_LABEL_ALPHA : 1;
    ctx.lineWidth = 1;
    ctx.strokeStyle = p.sectionBorder;
    const padX = Math.round(this.sectionH * 0.35);
    // Tag HUD vát góc, viền mảnh (chữ giữ hoa/thường như người dùng đặt).
    for (let i = 0; i < n; i++) {
      const b = this.secStart[i];
      if (b < lo || b >= hi || b <= winStart || b >= winEnd) continue;
      const t = L.hitPos + L.timeDir * (b - c) * L.pxPerBeat;
      const w = this.secW[i] + 2 * padX;
      if (vertical) {
        const th = this.sectionThick;
        ctx.save();
        ctx.translate(th / 2, t - 3);
        ctx.rotate(-Math.PI / 2);
        ctx.fillStyle = p.sectionBg;
        ctx.beginPath();
        this.pathTag(ctx, 0.5, 0.5 - th / 2, w - 1, th - 1, Math.min(5, th / 3));
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = p.sectionText;
        ctx.fillText(this.secName[i], padX, 0);
        ctx.restore();
      } else {
        const h = this.sectionH;
        const x = Math.round(t + 3);
        const y = Math.round(L.labelBand ? Math.max(1, (L.labelBand.h - h) / 2) : 2);
        ctx.fillStyle = p.sectionBg;
        ctx.beginPath();
        this.pathTag(ctx, x + 0.5, y + 0.5, w - 1, h - 1, Math.min(5, h / 3));
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = p.sectionText;
        ctx.fillText(this.secName[i], x + padX, y + h / 2);
      }
    }
  }

  /** Vạch đứt nét ở chỗ loop quay về đầu (loop end và các vòng kế). */
  private drawLoopMarkers(
    ctx: CanvasRenderingContext2D,
    L: Layout,
    cur: number,
    loopEnd: number,
    loopLen: number,
    copies: number,
  ): void {
    ctx.strokeStyle = this.pal.loopLine;
    ctx.lineWidth = 2;
    ctx.globalAlpha = 1;
    ctx.setLineDash(LOOP_DASH);
    ctx.beginPath();
    for (let k = 0; k < copies; k++) {
      const t = Math.round(L.hitPos + L.timeDir * (loopEnd + k * loopLen - cur) * L.pxPerBeat);
      this.lineAcross(ctx, L, t, 0, L.crossLength);
    }
    ctx.stroke();
    ctx.setLineDash(NO_DASH);
  }

  /**
   * Hold ribbon của một đoạn: run cắt theo [lo, hi) (loop), `c` = beat hiện tại của đoạn.
   * Nhãn: GIỮ … ở đầu dải, THẢ ở cuối (D-023). Run quá ngắn cho cả hai: THẢ vẽ ngay sau cuối dải
   * (khoảng trống trước run kế), không đủ chỗ thì GIỮ gọn (↓/↑/#) + THẢ trong dải.
   */
  private drawRibbons(
    ctx: CanvasRenderingContext2D,
    L: Layout,
    c: number,
    lo: number,
    hi: number,
    ghostEnd: number,
  ): void {
    const n = this.rCount;
    if (n === 0) return;
    const dir = L.timeDir;
    const ppb = L.pxPerBeat;
    const rc0 = L.ribbonCrossStart;
    const rcs = L.ribbonCrossSize;
    const stripeW = Math.max(3, Math.round(rcs * 0.16));
    const relOut = this.releaseCapLen + RELEASE_OUT_GAP;
    const winStart = c - L.behindBeats - relOut / ppb;
    const winEnd = c + L.lookahead;
    ctx.font = this.ribbonFont;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Run bắt đầu trước lo (đầu loop) nhưng kéo vào trong vẫn được vẽ (cắt tại lo).
    for (let i = lowerBound(this.rStart, Math.max(lo, winStart) - this.maxRunBeats); i < n; i++) {
      const s0 = this.rStart[i];
      if (s0 >= winEnd || s0 >= hi) break;
      const s = s0 < lo ? lo : s0;
      const e = this.rEnd[i] > hi ? hi : this.rEnd[i];
      if (e <= winStart || e <= s) continue;
      const ck = this.rColor[i];
      const col = MOD_COLORS[COLOR_KEYS[ck]];
      const kind = this.rKind[i];
      const combo = kind === 3 || kind === 4;
      let t0 = L.hitPos + dir * (s - c) * ppb;
      let t1 = L.hitPos + dir * (e - c) * ppb;
      // Khe 1px giữa hai run liền nhau.
      if (Math.abs(t1 - t0) > 4) {
        t0 += dir;
        t1 -= dir;
      }
      const len = Math.abs(t1 - t0);
      const ghost = this.rEnd[i] <= ghostEnd + 1e-9;
      const active = !ghost && s <= c && c < e;
      const past = e <= c;
      const fade = ghost ? GHOST_ALPHA : 1;

      // Thân dải bán trong suốt (nền chroma: màu đặc trộn sẵn).
      const r = mapSpan(L, rc0, rcs, t0, t1, this.tmp);
      this.paintFill(ctx, ck, (past ? 0.25 : active ? 0.75 : 0.5) * fade);
      ctx.fillRect(r.x, r.y, r.w, r.h);

      // Nhãn theo độ dài: start 0 không / 1 gọn / 2 đủ; release 0 không / 1 trong / 2 ngoài.
      let start = 0;
      let release = 0;
      if (kind !== KIND_NONE) {
        const full = this.ribbonCapLen[kind];
        const comp = this.ribbonCompactLen[kind];
        const rel = this.releaseCapLen;
        // Chỗ trống sau cuối run tới run kế (hoặc tới loop end) — nơi đặt "THẢ" bên ngoài.
        const nextStart = i + 1 < n && this.rStart[i + 1] < hi ? this.rStart[i + 1] : hi;
        const outsideOk = (nextStart - e) * ppb >= relOut + 2;
        if (len >= full + rel + 2) {
          start = 2;
          release = 1;
        } else if (len >= full && outsideOk) {
          start = 2;
          release = 2;
        } else if (len >= comp + rel + 2) {
          start = 1;
          release = 1;
        } else if (len >= full) {
          start = 2;
        } else if (len >= comp) {
          start = 1;
          release = outsideOk ? 2 : 0;
        } else if (outsideOk) {
          release = 2;
        }
      }
      const capAlpha = (past ? 0.45 : 1) * fade;
      const outEdge = t1 + dir * RELEASE_OUT_GAP;
      if (start !== 0 || release !== 0) this.paintFill(ctx, ck, capAlpha);
      if (start === 2) this.fillCap(ctx, L, t0, dir, this.ribbonCapLen[kind]);
      else if (start === 1) this.fillCap(ctx, L, t0, dir, this.ribbonCompactLen[kind]);
      if (release === 1) this.fillCap(ctx, L, t1, -dir, this.releaseCapLen);
      else if (release === 2) this.fillCap(ctx, L, outEdge, dir, this.releaseCapLen);

      if (combo) {
        const sr = mapSpan(L, rc0 + rcs - stripeW, stripeW, t0, t1, this.tmp2);
        this.paintFill(ctx, SCROLL_COLOR, capAlpha);
        ctx.fillRect(sr.x, sr.y, sr.w, sr.h);
      }
      this.paintStroke(ctx, STROKE_COLOR + ck, (past ? 0.4 : 1) * fade);
      ctx.lineWidth = 1;
      ctx.strokeRect(r.x + 0.5, r.y + 0.5, Math.max(0, r.w - 1), Math.max(0, r.h - 1));
      if (release === 2) {
        const rr = mapSpan(L, rc0, rcs, outEdge, outEdge + dir * this.releaseCapLen, this.tmp2);
        ctx.strokeRect(rr.x + 0.5, rr.y + 0.5, Math.max(0, rr.w - 1), Math.max(0, rr.h - 1));
      }

      if (start === 0 && release === 0) continue;
      ctx.globalAlpha = capAlpha;
      ctx.fillStyle = col.text;
      const textCross = rc0 + (combo ? rcs - stripeW : rcs) / 2;
      if (start === 1) {
        this.capText(ctx, L, t0, dir, this.ribbonCompactLen[kind], textCross, RIBBON_COMPACT, kind);
      } else if (start === 2) {
        this.capLines(ctx, L, t0, dir, this.ribbonCapLen[kind], textCross, this.ribbonWords[kind]);
      }
      if (release === 1) {
        this.capText(ctx, L, t1, -dir, this.releaseCapLen, textCross, null, 0);
      } else if (release === 2) {
        // Ô ngoài không có sọc scroll → chữ ở giữa cả bề ngang dải.
        this.capText(ctx, L, outEdge, dir, this.releaseCapLen, rc0 + rcs / 2, null, 0);
      }
    }
    ctx.globalAlpha = 1;
  }

  /** Ô nhãn đặc ở một đầu dải: từ mép `edge` đi vào trong theo `sign` (màu đã đặt bằng paintFill). */
  private fillCap(
    ctx: CanvasRenderingContext2D,
    L: Layout,
    edge: number,
    sign: number,
    capLen: number,
  ): void {
    const r = mapSpan(
      L,
      L.ribbonCrossStart,
      L.ribbonCrossSize,
      edge,
      edge + sign * capLen,
      this.tmp2,
    );
    ctx.fillRect(r.x, r.y, r.w, r.h);
  }

  /** Một dòng chữ ở giữa ô nhãn (`list[idx]`, hoặc chữ THẢ khi list = null); `cross` = tâm trục cross. */
  private capText(
    ctx: CanvasRenderingContext2D,
    L: Layout,
    edge: number,
    sign: number,
    capLen: number,
    cross: number,
    list: readonly string[] | null,
    idx: number,
  ): void {
    const text = list ? list[idx] : this.releaseText;
    const t = edge + (sign * capLen) / 2;
    if (L.orientation === 'vertical') ctx.fillText(text, cross, t);
    else ctx.fillText(text, t, cross);
  }

  /** Các từ xếp chồng (đọc từ trên xuống) trong ô nhãn đầu dải. */
  private capLines(
    ctx: CanvasRenderingContext2D,
    L: Layout,
    edge: number,
    sign: number,
    capLen: number,
    cross: number,
    words: readonly string[],
  ): void {
    const lh = this.ribbonLineH;
    const nLines = words.length;
    if (L.orientation === 'vertical') {
      const top = Math.min(edge, edge + sign * capLen) + this.ribbonPad;
      for (let j = 0; j < nLines; j++) ctx.fillText(words[j], cross, top + (j + 0.5) * lh);
    } else {
      const t = edge + (sign * capLen) / 2;
      const top = cross - (nLines * lh) / 2;
      for (let j = 0; j < nLines; j++) ctx.fillText(words[j], t, top + (j + 0.5) * lh);
    }
  }

  /**
   * 4 vòng chế độ MỜ tự vẽ làm đích của vòng "CHẠM" khi không có nút chế độ thật ở đó — overlay OBS kiểu
   * Mobile (R7-4: không vẽ bàn nút đầy đủ, nút thật của game nằm bên dưới — vòng ở hàng nút chế độ của bàn
   * nút) và bố cục không có bàn nút (lane ngang: ngay sau hit line). Chỉ nét mảnh màu chế độ + viền mờ, không
   * tô, không chữ; tâm `T.cross` / `T.axis`, mép ngoài nét = Ø `T.size` (đúng cỡ vòng "CHẠM").
   */
  private drawModeTargets(ctx: CanvasRenderingContext2D, L: Layout, T: CueTargets): void {
    const vertical = L.orientation === 'vertical';
    const r = Math.max(1, T.size / 2 - TARGET_LINE / 2);
    for (let btn = 0; btn < MB_ORDER.length; btn++) {
      const cross = T.cross[MB_TARGET[btn]];
      if (cross === undefined) continue;
      ctx.beginPath();
      ctx.arc(vertical ? cross : T.axis, vertical ? T.axis : cross, r, 0, Math.PI * 2);
      this.inkStroke(ctx, this.pal.cueHalo, TARGET_HALO_ALPHA);
      ctx.lineWidth = TARGET_LINE + 2;
      ctx.stroke();
      this.inkStroke(ctx, this.pal.cueRing[MB_COLOR[btn]], TARGET_ALPHA);
      ctx.lineWidth = TARGET_LINE;
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  /**
   * Mobile: mỗi lần chạm (cue) một vòng "CHẠM" trong suốt màu chế độ, Ø đúng nút chế độ, rơi trong cột của
   * nút đó nhanh gấp CUE_RING_SPEED lần tile (`cueRingAxis` — xuất hiện muộn hơn tile cùng beat) và đồng tâm
   * với nút đúng beat phải chạm; sau đó đứng yên trên nút, mờ dần trong CUE_RING_HOLD_BEATS. Cue vào lại
   * (`entry`) thay mọi cue của kế hoạch tại nốt của nó. Đoạn `c` / [lo, hi) / `ghostEnd` như collectTiles.
   * Trả true nếu có vẽ.
   */
  private drawCueRings(
    ctx: CanvasRenderingContext2D,
    L: Layout,
    T: CueTargets,
    c: number,
    lo: number,
    hi: number,
    ghostEnd: number,
    entry: MobileEntry | null,
  ): boolean {
    // Cửa sổ beat: đã đáp xong / còn ngoài mép xa (vòng đi nhanh gấp CUE_RING_SPEED lần tile).
    const far = L.timeDir < 0 ? T.axis : L.timeLength - T.axis;
    const winStart = c - CUE_RING_HOLD_BEATS;
    const winEnd = c + (Math.max(0, far) + T.size / 2 + 2) / (L.pxPerBeat * CUE_RING_SPEED);
    ctx.font = this.cueFont;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    let ink = false;
    const skip = entry !== null ? entry.noteIndex : -1;
    for (let i = lowerBound(this.cBeat, Math.max(lo, winStart)); i < this.cCount; i++) {
      const b = this.cBeat[i];
      if (b >= winEnd || b >= hi) break;
      if (this.cNote[i] === skip) continue;
      if (this.drawCueRing(ctx, L, T, c, b, this.cBtn[i], ghostEnd)) ink = true;
    }
    if (entry !== null) {
      const b = entry.beat;
      if (b >= lo && b >= winStart && b < winEnd && b < hi) {
        for (const cue of entry.cues) {
          if (this.drawCueRing(ctx, L, T, c, b, mbIndex(cueButton(cue)), ghostEnd)) ink = true;
        }
      }
    }
    ctx.lineJoin = 'miter';
    ctx.globalAlpha = 1;
    return ink;
  }

  /** Cue vào lại dùng được với timeline đang vẽ (index nốt hợp lệ). */
  private validEntry(e: MobileEntry | null | undefined): MobileEntry | null {
    return e && e.noteIndex >= 0 && e.noteIndex < this.nCount ? e : null;
  }

  /**
   * Một vòng "CHẠM" của nút `btn` cho cue ở beat `b` khi bài ở beat `c`: nét màu chế độ (mép ngoài nét = Ø
   * nút), viền `cueHalo` hai bên nét, lòng trong suốt, chữ "CHẠM" ở tâm (viền chữ `cueHalo`). Ô nhịp đếm vào
   * → mờ như tile. Trả false nếu vòng còn ngoài khung / đã đáp xong.
   */
  private drawCueRing(
    ctx: CanvasRenderingContext2D,
    L: Layout,
    T: CueTargets,
    c: number,
    b: number,
    btn: number,
    ghostEnd: number,
  ): boolean {
    const cross = T.cross[MB_TARGET[btn]];
    if (cross === undefined) return false;
    let alpha = b < ghostEnd - 1e-9 ? GHOST_ALPHA : 1;
    let axis = T.axis;
    let textK = 0;
    if (c > b) {
      // Đã tới tâm nút: đứng yên đồng tâm với nút ("đáp" vào nút), mờ dần — không chữ (tên nút đọc được).
      const t = (c - b) / CUE_RING_HOLD_BEATS;
      if (t >= 1) return false;
      alpha *= 1 - t;
    } else {
      axis = cueRingAxis(T, b, c, L);
      const k = Math.abs(axis - T.axis) / T.size;
      textK = Math.min(
        1,
        Math.max(0, (k - CUE_TEXT_FADE_NEAR) / (CUE_TEXT_FADE_FAR - CUE_TEXT_FADE_NEAR)),
      );
    }
    const half = T.size / 2;
    // Còn ngoài mép xa (dọc: phía trên; ngang: bên phải) → không vẽ (phần vắt qua mép canvas tự cắt).
    if (L.timeDir < 0 ? axis + half + 1 < 0 : axis - half - 1 > L.timeLength) return false;
    const vertical = L.orientation === 'vertical';
    const x = vertical ? cross : axis;
    const y = vertical ? axis : cross;
    const lw = this.cueLine;
    ctx.beginPath();
    ctx.arc(x, y, Math.max(1, half - lw / 2), 0, Math.PI * 2);
    this.inkStroke(ctx, this.pal.cueHalo, alpha);
    ctx.lineWidth = lw + 2;
    ctx.stroke();
    this.inkStroke(ctx, this.pal.cueRing[MB_COLOR[btn]], alpha);
    ctx.lineWidth = lw;
    ctx.stroke();
    // Chữ mờ hẳn thì không vẽ (nền chroma trộn màu sẵn: vẽ ở alpha ~0 = tô màu nền lên nút).
    const ta = alpha * textK;
    if (ta < 0.02) return true;
    this.inkStroke(ctx, this.pal.cueHalo, ta);
    ctx.lineWidth = 3;
    ctx.strokeText(this.cueText, x, y + 0.5);
    this.inkFill(ctx, this.pal.cueText, ta);
    ctx.fillText(this.cueText, x, y + 0.5);
    return true;
  }

  /**
   * Lớp canvas của bàn nút DOM (`canvas[CUE_LAYER_ATTR]` trong hộp chứa canvas tiles — MobilePad, video):
   * tìm lại khi chưa có / đã bị gỡ khỏi DOM (đổi kiểu điều khiển), backing store = đúng canvas tiles (cùng
   * khung px CSS, cùng DPR). Không có lớp / không có context 2D → null (vòng vẽ thẳng lên canvas tiles).
   */
  private cueLayerContext(): CanvasRenderingContext2D | null {
    let layer = this.cueLayer;
    if (!layer || !layer.isConnected) {
      this.releaseCueLayer();
      const box = this.canvas.parentElement;
      const found =
        box && typeof box.querySelector === 'function'
          ? box.querySelector<HTMLCanvasElement>(`canvas[${CUE_LAYER_ATTR}]`)
          : null;
      if (!found || found === this.canvas || this.deadLayers.has(found)) return null;
      let lctx: CanvasRenderingContext2D | null;
      try {
        lctx = found.getContext('2d') ?? null;
      } catch {
        lctx = null;
      }
      if (!lctx) {
        this.deadLayers.add(found);
        return null;
      }
      this.cueLayer = found;
      this.cueLayerCtx = lctx;
      this.cueLayerInk = false;
      layer = found;
    }
    if (layer.width !== this.devW || layer.height !== this.devH) {
      // Gán kích thước = xóa bitmap.
      layer.width = this.devW;
      layer.height = this.devH;
      this.cueLayerInk = false;
    }
    return this.cueLayerCtx;
  }

  /** Thôi dùng lớp vòng "CHẠM" (xóa hình còn lại trên lớp nếu có). */
  private releaseCueLayer(): void {
    const layer = this.cueLayer;
    const lctx = this.cueLayerCtx;
    if (layer && lctx && this.cueLayerInk) {
      lctx.setTransform(1, 0, 0, 1, 0, 0);
      lctx.clearRect(0, 0, layer.width, layer.height);
    }
    this.cueLayer = null;
    this.cueLayerCtx = null;
    this.cueLayerInk = false;
  }

  /** strokeStyle + globalAlpha cho màu `color` ở độ đục `alpha` (nền chroma: màu đặc trộn sẵn, alpha 1). */
  private inkStroke(ctx: CanvasRenderingContext2D, color: string, alpha: number): void {
    if (this.lut) {
      ctx.globalAlpha = 1;
      ctx.strokeStyle = this.solid(color, alpha);
    } else {
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = color;
    }
  }

  /** Như inkStroke nhưng cho fillStyle. */
  private inkFill(ctx: CanvasRenderingContext2D, color: string, alpha: number): void {
    if (this.lut) {
      ctx.globalAlpha = 1;
      ctx.fillStyle = this.solid(color, alpha);
    } else {
      ctx.globalAlpha = alpha;
      ctx.fillStyle = color;
    }
  }

  /** Màu đặc tương đương `color` ở độ đục `alpha` trên `opaqueBase` (cache theo bậc LUT_STEPS). */
  private solid(color: string, alpha: number): string {
    const q = Math.round((alpha <= 0 ? 0 : alpha >= 1 ? 1 : alpha) * LUT_STEPS);
    let row = this.solidCache.get(color);
    if (!row) {
      row = [];
      this.solidCache.set(color, row);
    }
    let v = row[q];
    if (v === undefined) {
      v = blendOver(color, q / LUT_STEPS, this.pal.opaqueBase);
      row[q] = v;
    }
    return v;
  }

  /**
   * Pass 0 cho một đoạn (cull + hình học, không cấp phát): ghi các tile đang thấy vào `vis` từ
   * vị trí `count`, trả count mới. `c` = beat hiện tại của đoạn, nốt lấy trong [lo, hi) và tile
   * bị cắt tại hi (loop end); nốt kết thúc ≤ `ghostEnd` (ô nhịp đếm vào) vẽ mờ, không sáng.
   * `copy` = bản vẽ lại của vòng loop kế: chưa chơi tới nên bỏ qua trạng thái practice (noteStates
   * là của vòng hiện tại, cùng index nốt).
   */
  private collectTiles(
    L: Layout,
    frame: RenderFrame,
    c: number,
    lo: number,
    hi: number,
    ghostEnd: number,
    copy: boolean,
    count: number,
  ): number {
    const n = this.nCount;
    if (n === 0) return count;
    const vertical = L.orientation === 'vertical';
    const ppb = L.pxPerBeat;
    const dir = L.timeDir;
    const inset = L.laneInset;
    const gap = L.tileGap;
    const cs = Math.max(1, L.laneCrossSize - 2 * inset);
    const states = copy ? null : (frame.noteStates ?? null);
    const hasSub = this.subOn;
    const mobile = this.mobile;
    const subLine = this.subSize * 1.2;
    const pad = this.pad;
    const glyphW = this.glyphW;
    const br = this.badgeR;
    const behind = L.behindBeats > 0 ? L.behindBeats : 1;
    const minLen = L.minTileLen - 0.5;
    const winStart = c - L.behindBeats;
    const winEnd = c + L.lookahead;
    // Đáy thấp nhất của khối nhãn tile (dọc): đáy canvas; 'pad' → hit line, hoặc đỉnh dải tên nút chế độ
    // khi tên nằm dưới hình tròn (màn dọc hẹp: tên rộng ~2 cột vắt qua lane 2…6 ngay trên hit line).
    const labelFloor = tileLabelFloor(L);

    for (let i = lowerBound(this.nStart, Math.max(lo, winStart - this.maxLenBeats)); i < n; i++) {
      const s = this.nStart[i];
      if (s >= winEnd || s >= hi) break;
      const rep = this.nRep[i];
      if (rep >= 0) {
        // Thanh bấm lặp: phần của đoạn nằm trong [lo, hi) của đoạn loop đang vẽ (s ≥ lo, s < hi → jf ≤ i ≤ jl).
        let jf = this.rpFirst[rep];
        while (this.nStart[jf] < lo) jf++;
        let jl = this.rpLast[rep];
        while (jl > i && this.nStart[jl] >= hi) jl--;
        if (jl - jf + 1 >= REPEAT_RUN_MIN) {
          // Vẽ một lần ở nốt đầu; vào giữa thanh (i > jf) = thanh đã khuất phía sau (maxLenBeats tính cả thanh).
          if (i === jf) count = this.collectBar(L, c, hi, ghostEnd, copy, count, rep, jf, jl);
          i = jl;
          continue;
        }
        // Loop cắt đoạn còn < 4 nốt: các nốt đó vẽ tile thường.
      }
      const lane = this.nLane[i];
      let lenPx = this.nLen[i];
      let tier = this.nTier[i];
      if (hi !== Infinity) {
        // Loop: tile không vượt loop end (vòng kế bắt đầu ngay đó).
        const maxLen = (hi - s) * ppb - gap;
        if (lenPx > maxLen) {
          lenPx = maxLen < 1 ? 1 : maxLen;
          tier = this.tierFor(L, lenPx, lane, true);
        }
      }
      const farBeat = s + lenPx / ppb;
      if (farBeat <= winStart) continue;
      this.ensureVis(count + 1);
      const truncated = lenPx < minLen;
      const near = L.hitPos + dir * (s - c) * ppb;
      const c0 = L.laneCrossStart[lane] + inset;
      let x: number;
      let y: number;
      let w: number;
      let h: number;
      if (vertical) {
        x = c0;
        w = cs;
        y = near - lenPx;
        h = lenPx;
      } else {
        x = near;
        w = lenPx;
        y = c0;
        h = cs;
      }

      // Đã qua hit line → mờ dần; ô nhịp đếm vào → mờ hẳn.
      let a = 1;
      if (c > farBeat) {
        const t = (c - farBeat) / behind;
        a = t >= 1 ? 0.12 : 1 - 0.88 * t;
      }
      const ghost = this.nEnd[i] <= ghostEnd + 1e-9;
      if (ghost) a *= GHOST_ALPHA;
      const st = !ghost && states !== null && i < states.length ? states[i] : 0;
      if (st === NoteState.perfect || st === NoteState.good) a *= 0.45;
      else if (st === NoteState.miss) a *= 0.4;
      const active = !ghost && s <= c && c < this.nEnd[i];
      const flash =
        st === NoteState.perfect || st === NoteState.good ? 1 - Math.abs(c - s) / 0.5 : 0;

      // Nhãn: cỡ theo bậc; tile bị luật gap cắt → bỏ mũi tên / thu nhỏ badge cho vừa pitch.
      const hasLabel = tier >= 0;
      const kSize = hasLabel ? this.tierSize[tier] : 0;
      const kw = hasLabel ? this.tierKeyW[tier * LANE_COUNT + lane] : 0;
      // Mobile: quãng nằm ở chấm trên/dưới số → không mũi tên; khối nhãn chừa chỗ cho chấm.
      const exA = mobile && hasLabel ? dotExtra(kSize, this.nDotA[i]) : 0;
      const exB = mobile && hasLabel ? dotExtra(kSize, this.nDotB[i]) : 0;
      let drawArrow = !mobile && this.nArrow[i] !== 0;
      const scroll = this.nScroll[i] === 1;
      let rr = scroll ? br : 0;
      if (truncated) {
        const room = lenPx + gap - 1;
        if (room < this.subSize) drawArrow = false;
        if (scroll) rr = Math.min(br, Math.max(3, room / 2));
      }
      let kx: number;
      let ky: number;
      let sx = NaN;
      let sy = NaN;
      let ax = NaN;
      let ay = NaN;
      let bx = NaN;
      let by = NaN;
      if (vertical) {
        const stack = hasSub && hasLabel && !truncated && h >= kSize + exA + exB + subLine + 2;
        const block = kSize + exA + exB + (stack ? subLine : 0);
        const cc = Math.min(h / 2, block / 2 + pad);
        // Nhãn bám mép gần của tile; tile dài đã trôi quá đáy canvas → nhãn dính đáy phần còn thấy
        // ('pad': phần thấy kết thúc ở hit line — dưới đó là bàn nút; tên nút chế độ nằm DƯỚI hình tròn
        // thì nhãn dừng phía trên dải tên đó, tới khi đầu trên của tile đi qua).
        const bottom = Math.min(y + h, Math.max(labelFloor, y + 2 * cc));
        kx = x + w / 2;
        ky = bottom - (cc - block / 2 + (stack ? subLine : 0) + exB + kSize / 2);
        if (stack) {
          sx = kx;
          sy = bottom - (cc - block / 2 + subLine / 2);
        }
        const side = Math.max(2, pad - 1);
        if ((w - this.laneKeyW[lane]) / 2 >= Math.max(glyphW, 2 * br) + side) {
          // Lane đủ rộng: ↓/↑ bên trái, "#" bên phải, ngang hàng nhãn phím.
          if (drawArrow) {
            ax = x + side + glyphW / 2;
            ay = ky;
          }
          if (rr > 0) {
            bx = x + w - side - rr;
            by = ky;
          }
          if (hasSub && hasLabel && !stack && !truncated) {
            // Tile thấp: nhãn phụ cùng hàng, bên phải nhãn phím (hết chỗ thì bên trái).
            const sw = this.laneSubW[lane];
            const keyR = kx + kw / 2;
            const keyL = kx - kw / 2;
            const rightLimit = rr > 0 ? bx - rr - pad : x + w - side;
            const leftLimit = drawArrow ? ax + glyphW / 2 + pad : x + side;
            if (rightLimit - keyR - pad >= sw) {
              sx = keyR + pad + sw / 2;
              sy = ky;
            } else if (keyL - pad - leftLimit >= sw) {
              sx = keyL - pad - sw / 2;
              sy = ky;
            }
          }
        } else {
          // Lane hẹp (mobile): dồn lên hai góc phía trên nhãn phím để không đè chữ.
          const above = ky - kSize * 0.5;
          if (drawArrow) {
            ax = x + 1 + glyphW / 2;
            ay = Math.max(y + this.subSize * 0.6, above - this.subSize * 0.3);
          }
          if (rr > 0) {
            bx = x + w - rr * 0.7;
            by = Math.max(y + rr * 0.7, above - rr * 0.3);
          }
        }
      } else if (truncated) {
        // Ngang, tile ngắn: chỉ nhãn phím ở giữa + chấm scroll phía trên.
        kx = x + w / 2;
        ky = y + h / 2;
        if (rr > 0) {
          bx = kx;
          by = y + rr + 1;
        }
      } else {
        const sw = this.laneSubW[lane];
        const arrowW = drawArrow ? glyphW + pad : 0;
        const blockW = kw + arrowW + (rr > 0 ? pad + 2 * rr : 0);
        const showSub = hasSub && hasLabel && w >= blockW + pad + sw + 2 * pad;
        const total = blockW + (showSub ? pad + sw : 0);
        const fits = total + 2 * pad <= w;
        let px = fits ? x + pad : x + (w - total) / 2;
        // Tile dài đã trôi quá mép trái → hàng nhãn dính mép trái phần còn thấy.
        if (fits && x < 0) px = Math.min(pad, x + w - total - pad);
        const cy = y + h / 2;
        if (drawArrow) {
          ax = px + glyphW / 2;
          ay = cy;
        }
        px += arrowW;
        kx = px + kw / 2;
        px += kw;
        if (rr > 0) {
          bx = px + pad + rr;
          by = cy;
          px += pad + 2 * rr;
        }
        if (showSub) {
          sx = px + pad + sw / 2;
          sy = cy;
        }
        ky = cy;
      }

      const o = count * STRIDE;
      const v = this.vis;
      v[o + F_X] = x;
      v[o + F_Y] = y;
      v[o + F_W] = w;
      v[o + F_H] = h;
      v[o + F_A] = a;
      v[o + F_KX] = kx;
      v[o + F_KY] = ky;
      v[o + F_SX] = sx;
      v[o + F_SY] = sy;
      v[o + F_AX] = ax;
      v[o + F_AY] = ay;
      v[o + F_BX] = bx;
      v[o + F_BY] = by;
      v[o + F_T] = tier;
      v[o + F_BR] = rr;
      v[o + F_FLAGS] =
        (active ? FLAG_ACTIVE : 0) | (ghost ? FLAG_GHOST : 0) | (copy ? FLAG_COPY : 0);
      v[o + F_FL] = flash > 0 ? flash : 0;
      v[o + F_RUN] = -1;
      v[o + F_CN] = 0;
      this.visIdx[count] = i;
      count++;
    }
    return count;
  }

  /**
   * Pass 0 cho MỘT thanh bấm lặp (D-447): nốt jf..jl của đoạn `rep` (phần nằm trong [lo, hi) của đoạn loop đang
   * vẽ, ≥ REPEAT_RUN_MIN nốt) thành một mục `vis` — thân từ đầu nốt jf tới hết nốt cuối của đoạn (như tile dài: luật
   * gap với nốt kế cùng lane, cắt tại loop end `hi`), độ mờ khi đã qua hit line như tile thường, nốt thuộc ô nhịp
   * đếm vào (`ghostEnd`) mờ theo từng đoạn nốt. Nhãn: nhãn phím như tile thường (nhãn phụ, ↓/↑, "#", chấm giản phổ)
   * + số lần bấm còn lại ("×n") ngay sau đó — dọc: dòng dưới cùng của khối nhãn; ngang: cuối hàng nhãn. Khối nhãn
   * bám mép gần của phần được đếm (nốt ô đếm vào ở đầu thanh — vẽ mờ — không mang chữ), thanh đã chạm hit line thì
   * đứng ngay phía trước hit line (phần chưa bấm; mọi cột như nhau — góp ý 2026-10-20: dừng nhãn trên hàng vòng chế độ
   * của Mobile trông như thanh bị chặn) tới khi đuôi thanh đi qua; còn lần bấm thì số không xuống quá hit line. Phần chưa bấm không đủ chỗ
   * cho cả nhãn phím lẫn số → chỉ số. Ghi thêm hộp bao khối chữ để vạch đầu nốt chừa ra. Trả count mới.
   */
  private collectBar(
    L: Layout,
    c: number,
    hi: number,
    ghostEnd: number,
    copy: boolean,
    count: number,
    rep: number,
    jf: number,
    jl: number,
  ): number {
    const vertical = L.orientation === 'vertical';
    const ppb = L.pxPerBeat;
    const dir = L.timeDir;
    const gap = L.tileGap;
    const s = this.nStart[jf];
    const lane = this.nLane[jf];
    const minLen = L.minTileLen - 0.5;
    let lenPx: number;
    let tier: number;
    if (jf === this.rpFirst[rep]) {
      lenPx = this.rpLen[rep];
      tier = this.rpTier[rep];
    } else {
      // Đầu loop cắt giữa đoạn (vòng kế): thanh bắt đầu ở nốt đầu tiên trong loop.
      const last = this.rpLast[rep];
      lenPx = tileLength(s, this.nEnd[last], this.nNext[last], L);
      tier = this.tierFor(L, lenPx, lane, lenPx < minLen);
    }
    if (hi !== Infinity) {
      const maxLen = (hi - s) * ppb - gap;
      if (lenPx > maxLen) {
        lenPx = maxLen < 1 ? 1 : maxLen;
        tier = this.tierFor(L, lenPx, lane, true);
      }
    }
    const farBeat = s + lenPx / ppb;
    if (farBeat <= c - L.behindBeats) return count;
    this.ensureVis(count + 1);
    const truncated = lenPx < minLen;
    const near = L.hitPos + dir * (s - c) * ppb;
    const inset = L.laneInset;
    const cs = Math.max(1, L.laneCrossSize - 2 * inset);
    const c0 = L.laneCrossStart[lane] + inset;
    const x = vertical ? c0 : near;
    const w = vertical ? cs : lenPx;
    const y = vertical ? near - lenPx : c0;
    const h = vertical ? lenPx : cs;

    // Đã qua hit line → mờ dần như tile thường; cả thanh thuộc ô nhịp đếm vào → mờ hẳn.
    let a = 1;
    if (c > farBeat) {
      const t = (c - farBeat) / (L.behindBeats > 0 ? L.behindBeats : 1);
      a = t >= 1 ? 0.12 : 1 - 0.88 * t;
    }
    let gn = 0;
    while (jf + gn <= jl && this.nEnd[jf + gn] <= ghostEnd + 1e-9) gn++;
    const allGhost = gn > jl - jf;
    if (allGhost) a *= GHOST_ALPHA;

    // Số lần bấm còn lại: nốt (không thuộc ô đếm vào) chưa qua hit line — nốt đúng ở hit line (dừng ở đầu dòng,
    // chế độ chờ của luyện tập) vẫn tính (core/repeatRuns `pressesAhead`).
    const cn = pressesAhead(this.nStart, jf + gn, jl + 1, c, hi);
    // Nốt đang ở hit line (start ≤ c < end) → thanh sáng (glow) + đoạn của nốt đó phủ sáng: nốt chưa bấm đầu
    // tiên (đúng ở hit line) hoặc nốt ngay trước nó (đang ngân).
    let aj = -1;
    for (let j = jl + 1 - cn; j >= jl - cn && j >= jf + gn; j--) {
      if (j <= jl && this.nStart[j] <= c && c < this.nEnd[j]) {
        aj = j - jf;
        break;
      }
    }
    const active = aj >= 0;

    // Nhãn.
    const mobile = this.mobile;
    const hasSub = this.subOn;
    const subLine = this.subSize * 1.2;
    const pad = this.pad;
    const glyphW = this.glyphW;
    const br = this.badgeR;
    let hasLabel = tier >= 0;
    let kSize = hasLabel ? this.tierSize[tier] : 0;
    let kw = hasLabel ? this.tierKeyW[tier * LANE_COUNT + lane] : 0;
    let exA = mobile && hasLabel ? dotExtra(kSize, this.nDotA[jf]) : 0;
    let exB = mobile && hasLabel ? dotExtra(kSize, this.nDotB[jf]) : 0;
    let drawArrow = !mobile && this.nArrow[jf] !== 0;
    let rr = this.nScroll[jf] === 1 ? br : 0;
    if (truncated) {
      const room = lenPx + gap - 1;
      if (room < this.subSize) drawArrow = false;
      if (rr > 0) rr = Math.min(br, Math.max(3, room / 2));
    }
    const cls = this.rpCls[rep];
    const cw = cn > 0 ? this.rpW[cls * (this.rpMax + 1) + cn] : 0;
    const cl = cn > 0 ? this.rpLines[cls] : 0;
    // Nốt của ô nhịp đếm vào ở đầu thanh (vẽ mờ, không bấm) không mang nhãn — chữ tối trên nền mờ không đọc được:
    // khối nhãn bám đầu nốt đầu tiên được đếm (`lead`, trục thời gian) tới khi nốt đó chạm hit line.
    const lead = gn > 0 && !allGhost ? L.hitPos + dir * (this.nStart[jf + gn] - c) * ppb : near;
    let kx = NaN;
    let ky = NaN;
    let sx = NaN;
    let sy = NaN;
    let ax = NaN;
    let ay = NaN;
    let bx = NaN;
    let by = NaN;
    let cx = NaN;
    let cy = NaN;
    if (vertical) {
      // Phần thanh mang nhãn: đuôi (y) → `lead`.
      const nearL = Math.max(y, Math.min(y + h, lead));
      const hL = nearL - y;
      const floor = Math.min(tileLabelFloor(L), L.hitPos);
      // Còn lần bấm: chỉ phần CHƯA BẤM còn thấy (trên đáy) là chỗ cho chữ — không đủ cho cả nhãn phím lẫn số thì bỏ
      // nhãn phím trước (làn đã cho biết phím), số vẫn đứng trên hit line.
      const room = cn > 0 ? Math.min(nearL, floor) - y : hL;
      const keyH = kSize + exA + exB;
      // Không đủ cao cho hai dòng mà ô đủ rộng (thanh ngắn ở cửa sổ thấp — trang mini "Khớp nút game"): nhãn phím
      // + số trên CÙNG một dòng ("1̇ ×5"); hẹp nữa mới bỏ nhãn phím.
      let inline = false;
      let rowW = 0;
      let inlineFloor = floor;
      if (cn > 0 && hasLabel && room < keyH + cl + 2 * pad) {
        const side = Math.max(2, pad - 1);
        rowW = (drawArrow ? glyphW + pad : 0) + kw + (rr > 0 ? pad + 2 * rr : 0) + pad + cw;
        const need = Math.max(keyH, cl) + 2 * pad;
        if (rowW + 2 * side <= w) {
          if (room >= need) inline = true;
          else if (floor < L.hitPos - 1 && Math.min(nearL, L.hitPos - 1) - y >= need) {
            // Bàn nút 'pad': sàn của tile thường dừng trên nhãn chế độ — thà để dòng "phím ×n" xuống sát hit line
            // còn hơn mất nhãn phím.
            inline = true;
            inlineFloor = L.hitPos - 1;
          }
        }
        if (!inline) {
          hasLabel = false;
          tier = -1;
          kSize = 0;
          kw = 0;
          exA = 0;
          exB = 0;
          rr = 0;
        }
      }
      if (inline) {
        const lineH = Math.max(keyH, cl);
        const cc = Math.min(hL / 2, lineH / 2 + pad);
        const bottom = Math.min(nearL, Math.max(inlineFloor, y + 2 * cc));
        let base = bottom - cc + lineH / 2;
        if (base > L.hitPos - 1) base = L.hitPos - 1;
        const mid = base - lineH / 2;
        let px = x + (w - rowW) / 2;
        if (drawArrow) {
          ax = px + glyphW / 2;
          ay = mid;
          px += glyphW + pad;
        }
        kx = px + kw / 2;
        ky = mid - keyH / 2 + exA + kSize / 2;
        px += kw;
        if (rr > 0) {
          bx = px + pad + rr;
          by = mid;
          px += pad + 2 * rr;
        }
        px += pad;
        cx = px + cw / 2;
        cy = mid;
      }
      if (!inline) {
        const stack =
          hasSub && hasLabel && !truncated && room >= kSize + exA + exB + subLine + cl + 2;
        const block = kSize + exA + exB + (stack ? subLine : 0) + cl;
        const cc = Math.min(hL / 2, block / 2 + pad);
        // Thanh đã chạm hit line: khối nhãn đứng ngay trên đáy (phần chưa bấm), như nhãn tile dài bám phần còn thấy;
        // đuôi thanh tới gần thì đi xuống theo đuôi.
        const bottom = Math.min(nearL, Math.max(floor, y + 2 * cc));
        let base = bottom - cc + block / 2;
        // Còn lần bấm mà phần chưa bấm đã ngắn hơn dòng số: số không xuống quá hit line (không bị hit line gạch, không
        // bị mép canvas cắt — 'fit' có hit line sát đáy), thà vượt đuôi thanh một chút.
        if (cn > 0 && base > L.hitPos - 1) base = L.hitPos - 1;
        kx = x + w / 2;
        ky = base - cl - (stack ? subLine : 0) - exB - kSize / 2;
        if (cn > 0) {
          cx = kx;
          cy = base - cl / 2;
        }
        if (stack) {
          sx = kx;
          sy = base - cl - subLine / 2;
        }
        if (hasLabel) {
          const side = Math.max(2, pad - 1);
          if ((w - this.laneKeyW[lane]) / 2 >= Math.max(glyphW, 2 * br) + side) {
            if (drawArrow) {
              ax = x + side + glyphW / 2;
              ay = ky;
            }
            if (rr > 0) {
              bx = x + w - side - rr;
              by = ky;
            }
            if (hasSub && !stack && !truncated) {
              const sw = this.laneSubW[lane];
              const keyR = kx + kw / 2;
              const keyL = kx - kw / 2;
              const rightLimit = rr > 0 ? bx - rr - pad : x + w - side;
              const leftLimit = drawArrow ? ax + glyphW / 2 + pad : x + side;
              if (rightLimit - keyR - pad >= sw) {
                sx = keyR + pad + sw / 2;
                sy = ky;
              } else if (keyL - pad - leftLimit >= sw) {
                sx = keyL - pad - sw / 2;
                sy = ky;
              }
            }
          } else {
            const above = ky - kSize * 0.5;
            if (drawArrow) {
              ax = x + 1 + glyphW / 2;
              ay = Math.max(y + this.subSize * 0.6, above - this.subSize * 0.3);
            }
            if (rr > 0) {
              bx = x + w - rr * 0.7;
              by = Math.max(y + rr * 0.7, above - rr * 0.3);
            }
          }
        }
      }
    } else {
      // Ngang (thời gian chạy sang phải): phần mang nhãn từ `lead` tới đuôi.
      const x0 = Math.max(x, Math.min(x + w, lead));
      const wL = x + w - x0;
      const mid = y + h / 2;
      if (truncated) {
        // Thanh ngắn (luật gap / loop cắt sát): còn lần bấm → chỉ số ở giữa (như dọc khi chật); hết → nhãn phím ở
        // giữa như tile ngắn.
        if (cn > 0) {
          tier = -1;
          rr = 0;
          cx = x + w / 2;
          cy = mid;
        } else {
          kx = x + w / 2;
          ky = mid;
          if (rr > 0) {
            bx = kx;
            by = y + rr + 1;
          }
        }
      } else {
        // Còn lần bấm: chỗ cho chữ = phần chưa bấm (sau hit line) — như dọc.
        const room = cn > 0 ? x + w - Math.max(x0, L.hitPos) : wL;
        const cgap = cn > 0 ? pad + cw : 0;
        let arrowW = drawArrow ? glyphW + pad : 0;
        let blockW = kw + arrowW + (rr > 0 ? pad + 2 * rr : 0);
        if (cn > 0 && blockW + cgap + 2 * pad > room) {
          // Không đủ chỗ cho cả hàng nhãn lẫn số: chỉ số.
          hasLabel = false;
          tier = -1;
          rr = 0;
          arrowW = 0;
          blockW = 0;
        }
        const sw = this.laneSubW[lane];
        const showSub = hasSub && hasLabel && room >= blockW + pad + sw + 2 * pad + cgap;
        const total = (hasLabel ? blockW + (showSub ? pad + sw : 0) : 0) + (hasLabel ? cgap : cw);
        const fits = total + 2 * pad <= wL;
        let px = fits ? x0 + pad : x0 + (wL - total) / 2;
        // Thanh đã chạm hit line: hàng nhãn đứng ngay sau hit line (phần chưa bấm) tới khi đuôi thanh đi qua.
        if (fits && px < L.hitPos + pad) px = Math.min(L.hitPos + pad, x + w - total - pad);
        // Còn lần bấm: hàng chữ không lùi quá hit line, thà vượt đuôi thanh một chút.
        if (cn > 0 && px < L.hitPos + 1) px = L.hitPos + 1;
        if (hasLabel) {
          if (drawArrow) {
            ax = px + glyphW / 2;
            ay = mid;
          }
          px += arrowW;
          kx = px + kw / 2;
          ky = mid;
          px += kw;
          if (rr > 0) {
            bx = px + pad + rr;
            by = mid;
            px += pad + 2 * rr;
          }
          if (showSub) {
            sx = px + pad + sw / 2;
            sy = mid;
            px += pad + sw;
          }
          px += pad;
        }
        if (cn > 0) {
          cx = px + cw / 2;
          cy = mid;
        }
      }
    }

    // Hộp bao khối chữ — vạch đầu nốt (drawBarBody) chừa ra, không gạch ngang chữ khi thanh trôi qua nhãn đứng yên.
    const lb = this.lbox;
    lb[0] = Infinity;
    lb[1] = Infinity;
    lb[2] = -Infinity;
    lb[3] = -Infinity;
    if (tier >= 0) this.growLabelBox(kx, ky, kw / 2, kSize / 2 + Math.max(exA, exB));
    this.growLabelBox(sx, sy, this.laneSubW[lane] / 2, this.subSize * 0.75);
    this.growLabelBox(ax, ay, glyphW / 2, this.subSize * 0.6);
    if (rr > 0) this.growLabelBox(bx, by, rr, rr);
    if (cn > 0) this.growLabelBox(cx, cy, cw / 2, cl / 2);

    const o = count * STRIDE;
    const v = this.vis;
    v[o + F_X] = x;
    v[o + F_Y] = y;
    v[o + F_W] = w;
    v[o + F_H] = h;
    v[o + F_A] = a;
    v[o + F_KX] = kx;
    v[o + F_KY] = ky;
    v[o + F_SX] = sx;
    v[o + F_SY] = sy;
    v[o + F_AX] = ax;
    v[o + F_AY] = ay;
    v[o + F_BX] = bx;
    v[o + F_BY] = by;
    v[o + F_T] = tier;
    v[o + F_BR] = rr;
    v[o + F_FLAGS] =
      (active ? FLAG_ACTIVE : 0) | (allGhost ? FLAG_GHOST : 0) | (copy ? FLAG_COPY : 0);
    v[o + F_FL] = 0;
    v[o + F_RUN] = jl;
    v[o + F_REL] = c - s;
    v[o + F_CN] = cn;
    v[o + F_CX] = cx;
    v[o + F_CY] = cy;
    v[o + F_GN] = gn;
    v[o + F_AJ] = aj;
    v[o + F_CF] = cls;
    v[o + F_LX0] = lb[0];
    v[o + F_LY0] = lb[1];
    v[o + F_LX1] = lb[2];
    v[o + F_LY1] = lb[3];
    this.visIdx[count] = jf;
    return count + 1;
  }

  /** Nới hộp `lbox` cho một chữ tâm (cx, cy), nửa rộng `hw`, nửa cao `hh`; tâm NaN = chữ không vẽ. */
  private growLabelBox(cx: number, cy: number, hw: number, hh: number): void {
    if (Number.isNaN(cx) || Number.isNaN(cy)) return;
    const b = this.lbox;
    if (cx - hw < b[0]) b[0] = cx - hw;
    if (cy - hh < b[1]) b[1] = cy - hh;
    if (cx + hw > b[2]) b[2] = cx + hw;
    if (cy + hh > b[3]) b[3] = cy + hh;
  }

  /** Pass 1–3 trên các tile đã thu (mọi đoạn loop): thân tile, nhãn phím theo bậc, nhãn phụ/badge. */
  /** Pass 1 (+ 1b) của tile đang thấy: thân + viền (+ chi tiết HUD); ghi bậc font cần cho drawTileLabels. */
  private drawTileBodies(
    ctx: CanvasRenderingContext2D,
    L: Layout,
    frame: RenderFrame,
    count: number,
  ): void {
    this.keyTierMask = 0;
    this.commaTierMask = 0;
    if (count === 0) return;
    const p = this.pal;
    const states = frame.noteStates ?? null;
    const v = this.vis;
    const glow = p.glow;
    const s = L.scale;
    // Tile phẳng góc 3 px (kiểu HUD), viền trong tối + highlight mép trên ở pass 1b.
    // Bàn nút kiểu game ('pad'): tile viên thuốc (hai đầu bo tròn hết), không chi tiết HUD.
    const pill = L.pad !== null;
    const radiusBase = Math.max(2, Math.round(3 * s));
    // Tile chờ bấm nhấp nháy ~1.6 Hz; giảm chuyển động → viền đậm tĩnh (giữa hai mức của nhịp).
    const timeMs = typeof frame.timeMs === 'number' ? frame.timeMs : nowMs();
    const pulse = this.reduceMotion ? 0.5 : 0.5 + 0.5 * Math.sin(timeMs * 0.01);
    // Overlay: thân tile bán trong suốt (viền, nhãn giữ alpha thường để vẫn đọc được). 1 = như Player.
    const bodyOpacity = this.opts.tileOpacity;

    // Pass 1: thân tile + viền.
    let keyMask = 0;
    let commaMask = 0;
    for (let k = 0; k < count; k++) {
      const i = this.visIdx[k];
      const o = k * STRIDE;
      const x = v[o + F_X];
      const y = v[o + F_Y];
      const w = v[o + F_W];
      const h = v[o + F_H];
      const a = v[o + F_A];
      const tier = v[o + F_T];
      if (tier >= 0) {
        if (this.nLane[i] === this.commaLane) commaMask |= 1 << tier;
        else keyMask |= 1 << tier;
      }
      if (v[o + F_RUN] >= 0) {
        this.drawBarBody(ctx, L, k, states, pill, radiusBase, pulse, bodyOpacity);
        continue;
      }
      const ck = this.nColor[i];
      const flags = v[o + F_FLAGS];
      const active = (flags & FLAG_ACTIVE) !== 0;
      const ghost = (flags & FLAG_GHOST) !== 0;
      const copy = (flags & FLAG_COPY) !== 0;
      const st = !ghost && !copy && states !== null && i < states.length ? states[i] : 0;

      ctx.beginPath();
      this.pathRoundRect(
        ctx,
        x,
        y,
        w,
        h,
        pill ? Math.min(w, h) / 2 : Math.min(radiusBase, w / 4, h / 4),
      );
      if (active && glow) {
        ctx.shadowColor = MOD_COLORS[COLOR_KEYS[ck]].fill;
        ctx.shadowBlur = 18 * s;
      }
      // Nền chroma: thân mờ dần vẽ bằng màu đặc trộn sẵn (paintFill), không bán trong suốt.
      this.paintFill(ctx, ck, a * bodyOpacity);
      ctx.fill();
      if (active) {
        ctx.shadowBlur = 0;
        ctx.fillStyle = ACTIVE_FILL;
        ctx.fill();
      }
      const flash = v[o + F_FL];
      if (flash > 0) {
        // Loé sáng quanh lúc trúng.
        ctx.globalAlpha = flash * 0.6;
        ctx.fillStyle = '#ffffff';
        ctx.fill();
      }

      let stroke = '';
      let lw = 1;
      let strokeAlpha = a;
      if (st === NoteState.perfect || st === NoteState.good || st === NoteState.miss) {
        stroke = st === NoteState.perfect ? p.perfect : st === NoteState.good ? p.good : p.miss;
        lw = 2.5;
        strokeAlpha = Math.min(1, a * 2.2);
      } else if (st === NoteState.waiting) {
        stroke = p.waiting;
        lw = 2 + 2 * pulse;
        strokeAlpha = 0.6 + 0.4 * pulse;
        if (glow) {
          ctx.shadowColor = p.waiting;
          ctx.shadowBlur = (8 + 12 * pulse) * s;
        }
      } else if (active) {
        stroke = p.activeStroke;
        lw = 2;
      }
      if (stroke) {
        ctx.globalAlpha = strokeAlpha;
        ctx.strokeStyle = stroke;
      } else {
        this.paintStroke(ctx, STROKE_COLOR + ck, a);
      }
      ctx.lineWidth = lw;
      ctx.stroke();
      ctx.shadowBlur = 0;
    }

    // Pass 1b: highlight mép trên + viền trong tối 1 px (trên thân tile) — chỉ tile chữ nhật.
    if (!pill) this.drawTileDetails(ctx, count, Math.max(1, Math.round(2 * s)), bodyOpacity);
    this.keyTierMask = keyMask;
    this.commaTierMask = commaMask;
  }

  /**
   * Độ đục tương đối của đoạn nốt `j` trên thanh bấm lặp (thân thanh = 1): nốt thuộc ô nhịp đếm vào khi chỉ một phần
   * thanh thuộc đó (`gn` nốt đầu) mờ như tile đếm vào; luyện tập — trúng / trượt mờ như tile trúng / trượt.
   */
  private barSegMul(
    j: number,
    jf: number,
    gn: number,
    ghostAll: boolean,
    states: Uint8Array | null,
  ): number {
    if (j - jf < gn) return ghostAll ? 1 : GHOST_ALPHA;
    const st = states !== null && j < states.length ? states[j] : 0;
    if (st === NoteState.perfect || st === NoteState.good) return 0.45;
    if (st === NoteState.miss) return 0.4;
    return 1;
  }

  /**
   * Pass 1 của một thanh bấm lặp (mục `k` của `vis`, D-447): MỘT hình như tile thường của lần bấm đó (màu, bo góc /
   * viên thuốc, độ đục `tileOpacity`, glow khi có nốt đang ở hit line), ở độ đục thấp nhất trong các đoạn nốt; rồi
   * trong lòng thanh, từng đoạn nốt (đầu nốt → đầu nốt kế): tô thêm tới độ đục riêng của nó (ô đếm vào / trạng thái
   * luyện tập), phủ sáng khi nốt đó ở hit line (+ loé nhẹ lúc chạm), loé + viền màu chấm điểm khi trúng / trượt, và
   * vạch mảnh ở đầu từng nốt bên trong; cuối cùng viền ngoài (chờ bấm nhấp nháy, đang sáng, hoặc viền thường).
   */
  private drawBarBody(
    ctx: CanvasRenderingContext2D,
    L: Layout,
    k: number,
    states: Uint8Array | null,
    pill: boolean,
    radiusBase: number,
    pulse: number,
    bodyOpacity: number,
  ): void {
    const v = this.vis;
    const o = k * STRIDE;
    const p = this.pal;
    const s = L.scale;
    const jf = this.visIdx[k];
    const jl = v[o + F_RUN];
    const x = v[o + F_X];
    const y = v[o + F_Y];
    const w = v[o + F_W];
    const h = v[o + F_H];
    const a = v[o + F_A];
    const flags = v[o + F_FLAGS];
    const active = (flags & FLAG_ACTIVE) !== 0;
    const ghostAll = (flags & FLAG_GHOST) !== 0;
    const st = ghostAll || (flags & FLAG_COPY) !== 0 ? null : states;
    const gn = v[o + F_GN];
    const rel = v[o + F_REL];
    const aj = v[o + F_AJ];
    const ck = this.nColor[jf];
    const vertical = L.orientation === 'vertical';
    const dir = L.timeDir;
    const ppb = L.pxPerBeat;
    // Trục thời gian: mép gần (đầu nốt đầu) / mép xa của thanh; trục cross: bề ngang thanh.
    const near = vertical ? y + h : x;
    const far = vertical ? y : x + w;
    const crossStart = vertical ? x : y;
    const crossSize = vertical ? w : h;
    const s0 = this.nStart[jf];
    const op = a * bodyOpacity;

    let mMin = 1;
    let waiting = false;
    for (let j = jf; j <= jl; j++) {
      const m = this.barSegMul(j, jf, gn, ghostAll, st);
      if (m < mMin) mMin = m;
      if (st !== null && j - jf >= gn && j < st.length && st[j] === NoteState.waiting)
        waiting = true;
    }
    const radius = pill ? Math.min(w, h) / 2 : Math.min(radiusBase, w / 4, h / 4);
    const base = op * mMin;
    // Mỗi lần bấm sáng như một tile đơn đang chạm: sáng mạnh ở đầu nốt rồi tắt dần trước lần bấm kế → người chơi thấy
    // đủ số lần bấm (giảm chuyển động: sáng đều, không nhấp nháy).
    let env = 0;
    if (active) {
      if (this.reduceMotion) env = 1;
      else {
        const ja = jf + aj;
        const since = rel - (this.nStart[ja] - s0);
        const span = Math.max(
          REPEAT_PULSE_MIN_BEATS,
          (this.nEnd[ja] - this.nStart[ja]) * REPEAT_PULSE_SPAN,
        );
        env = since < 0 ? 0 : Math.max(0, 1 - since / span);
      }
    }
    ctx.beginPath();
    this.pathRoundRect(ctx, x, y, w, h, radius);
    if (active && p.glow) {
      ctx.shadowColor = MOD_COLORS[COLOR_KEYS[ck]].fill;
      ctx.shadowBlur = 18 * s * (0.2 + 0.8 * env);
    }
    this.paintFill(ctx, ck, base);
    ctx.fill();
    ctx.shadowBlur = 0;

    ctx.save();
    ctx.clip();
    for (let j = jf; j <= jl; j++) {
      const off = this.nStart[j] - s0;
      const t0 = near + dir * off * ppb;
      const t1 = j < jl ? near + dir * (this.nStart[j + 1] - s0) * ppb : far;
      const r = mapSpan(L, crossStart, crossSize, t0, t1, this.tmp);
      const m = this.barSegMul(j, jf, gn, ghostAll, st);
      if (m > mMin + 1e-6) {
        // Chồng cùng màu lên thân: bảng màu đặc (chroma) → tô thẳng màu đích; bán trong suốt → alpha bù cho đủ.
        const target = op * m;
        this.paintFill(ctx, ck, this.lut || base >= 1 ? target : (target - base) / (1 - base));
        ctx.fillRect(r.x, r.y, r.w, r.h);
      }
      if (j - jf === aj) {
        ctx.globalAlpha = (this.lut ? 1 : op * m) * (0.35 + 0.65 * env);
        ctx.fillStyle = ACTIVE_FILL;
        ctx.fillRect(r.x, r.y, r.w, r.h);
        if (!this.reduceMotion && env > 0) {
          ctx.globalAlpha = REPEAT_PULSE_ALPHA * env * a;
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(r.x, r.y, r.w, r.h);
        }
      }
      const sj = st !== null && j - jf >= gn && j < st.length ? st[j] : 0;
      if (sj === NoteState.perfect || sj === NoteState.good) {
        // Loé sáng quanh lúc trúng — chỉ đoạn của nốt đó.
        const flash = 1 - Math.abs(rel - off) / 0.5;
        if (flash > 0) {
          ctx.globalAlpha = flash * 0.6;
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(r.x, r.y, r.w, r.h);
        }
      }
      if (sj === NoteState.perfect || sj === NoteState.good || sj === NoteState.miss) {
        ctx.globalAlpha = Math.min(1, a * m * 2.2);
        ctx.strokeStyle =
          sj === NoteState.perfect ? p.perfect : sj === NoteState.good ? p.good : p.miss;
        ctx.lineWidth = 2.5;
        ctx.strokeRect(r.x + 1.25, r.y + 1.25, Math.max(0, r.w - 2.5), Math.max(0, r.h - 2.5));
      }
    }
    if (jl > jf) {
      // Vạch mảnh ở đầu từng nốt bên trong thanh: nhịp bấm vẫn đọc được. Nhãn đứng yên trên hit line còn thanh trôi qua
      // → vạch đi qua khối chữ chỉ còn phần ngoài bề ngang chữ (cách chữ 2 px; ngắn quá thì bỏ), không gạch ngang chữ.
      const ti = Math.max(2, Math.round(crossSize * REPEAT_TICK_INSET));
      const c0 = crossStart + ti;
      const c1 = crossStart + crossSize - ti;
      const lt0 = (vertical ? v[o + F_LY0] : v[o + F_LX0]) - 2;
      const lt1 = (vertical ? v[o + F_LY1] : v[o + F_LX1]) + 2;
      const lc0 = (vertical ? v[o + F_LX0] : v[o + F_LY0]) - 2;
      const lc1 = (vertical ? v[o + F_LX1] : v[o + F_LY1]) + 2;
      this.inkStroke(ctx, MOD_COLORS[COLOR_KEYS[ck]].text, REPEAT_TICK_ALPHA * a);
      ctx.lineWidth = Math.max(1, REPEAT_TICK_WIDTH * s);
      ctx.beginPath();
      for (let j = jf + 1; j <= jl; j++) {
        const t = near + dir * (this.nStart[j] - s0) * ppb;
        if (t > lt0 && t < lt1) {
          if (lc0 - c0 >= REPEAT_TICK_MIN) this.lineAcross(ctx, L, t, c0, Math.min(c1, lc0));
          if (c1 - lc1 >= REPEAT_TICK_MIN) this.lineAcross(ctx, L, t, Math.max(c0, lc1), c1);
        } else {
          this.lineAcross(ctx, L, t, c0, c1);
        }
      }
      ctx.stroke();
    }
    ctx.restore();

    // Viền ngoài: chờ bấm (luyện tập) nhấp nháy như tile thường, đang sáng, hoặc viền màu của lần bấm.
    ctx.beginPath();
    this.pathRoundRect(ctx, x, y, w, h, radius);
    let stroke = '';
    let lw = 1;
    let strokeAlpha = a;
    if (waiting) {
      stroke = p.waiting;
      lw = 2 + 2 * pulse;
      strokeAlpha = 0.6 + 0.4 * pulse;
      if (p.glow) {
        ctx.shadowColor = p.waiting;
        ctx.shadowBlur = (8 + 12 * pulse) * s;
      }
    } else if (active) {
      stroke = p.activeStroke;
      lw = 1 + 1.5 * env;
      strokeAlpha = a * (0.5 + 0.5 * env);
    }
    if (stroke) {
      ctx.globalAlpha = strokeAlpha;
      ctx.strokeStyle = stroke;
    } else {
      this.paintStroke(ctx, STROKE_COLOR + ck, a);
    }
    ctx.lineWidth = lw;
    ctx.stroke();
    ctx.shadowBlur = 0;
  }

  /** Pass 2 + 3 của tile đang thấy (sau drawTileBodies): nhãn phím, chấm giản phổ, nhãn phụ, ↓/↑, "#". */
  private drawTileLabels(ctx: CanvasRenderingContext2D, count: number): void {
    if (count === 0) return;
    const v = this.vis;
    const br = this.badgeR;
    const keyMask = this.keyTierMask;
    const commaMask = this.commaTierMask;
    // Pass 2: nhãn phím, gom theo bậc font (dấu phẩy phóng to riêng).
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let t = 0; t < this.tierSize.length; t++) {
      if ((keyMask & (1 << t)) === 0) continue;
      ctx.font = this.tierFont[t];
      this.drawKeyLabels(ctx, count, false, t, 0);
    }
    if (commaMask !== 0) {
      // "," rất nhỏ ở cỡ chữ thường → phóng to, đẩy lên giữa và tô viền cho đậm.
      ctx.lineJoin = 'round';
      for (let t = 0; t < this.tierSize.length; t++) {
        if ((commaMask & (1 << t)) === 0) continue;
        ctx.font = this.tierCommaFont[t];
        ctx.lineWidth = Math.max(1, this.tierSize[t] * 0.035);
        this.drawKeyLabels(ctx, count, true, t, this.tierCommaSize[t] * 0.26);
      }
    }

    // Pass 3: chấm giản phổ (mobile), nhãn phụ, mũi tên ↓/↑, badge "#".
    ctx.font = this.smallFont;
    const dotR = Math.max(1.2, this.subSize * 0.09);
    const mobile = this.mobile;
    for (let k = 0; k < count; k++) {
      const i = this.visIdx[k];
      const o = k * STRIDE;
      const a = v[o + F_A];
      const col = MOD_COLORS[COLOR_KEYS[this.nColor[i]]];
      ctx.globalAlpha = a;
      ctx.fillStyle = col.text;
      if (mobile) {
        const tier = v[o + F_T];
        if (tier >= 0 && (this.nDotA[i] > 0 || this.nDotB[i] > 0)) {
          this.drawJianpuDots(ctx, v[o + F_KX], v[o + F_KY], this.tierSize[tier], i);
        }
      }
      const sx = v[o + F_SX];
      const lane = this.nLane[i];
      if (!Number.isNaN(sx)) {
        const sy = v[o + F_SY];
        ctx.fillText(this.laneSub[lane], sx, sy);
        if (this.laneSubDot[lane] === 1) {
          ctx.beginPath();
          ctx.arc(sx, sy - this.subSize * 0.62, dotR, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      const ax = v[o + F_AX];
      if (!Number.isNaN(ax)) ctx.fillText(ARROW_GLYPH[this.nArrow[i]], ax, v[o + F_AY]);
      const rr = v[o + F_BR];
      if (rr > 0) {
        const bx = v[o + F_BX];
        const by = v[o + F_BY];
        ctx.beginPath();
        ctx.arc(bx, by, rr, 0, Math.PI * 2);
        ctx.fillStyle = MOD_COLORS.scroll.fill;
        ctx.fill();
        ctx.strokeStyle = MOD_COLORS.scroll.text;
        ctx.lineWidth = rr < br ? 1 : 1.5;
        ctx.stroke();
        // Badge thu nhỏ (tile rất ngắn) chỉ còn chấm xanh — "#" không còn đọc được.
        if (rr >= br - 0.5) {
          ctx.fillStyle = MOD_COLORS.scroll.text;
          ctx.fillText('#', bx, by + 0.5);
        }
      }
    }

    // Pass 4: số lần bấm còn lại của thanh bấm lặp ("×5"), màu chữ của tile, font theo lớp cỡ chữ của đoạn.
    let font = -1;
    for (let k = 0; k < count; k++) {
      const o = k * STRIDE;
      const n = v[o + F_CN];
      if (!(n > 0) || v[o + F_RUN] < 0) continue;
      const text = this.rpText[n];
      const cls = v[o + F_CF];
      const f = this.rpFonts[cls];
      if (text === undefined || f === undefined) continue;
      if (cls !== font) {
        ctx.font = f;
        font = cls;
      }
      ctx.globalAlpha = v[o + F_A];
      ctx.fillStyle = MOD_COLORS[COLOR_KEYS[this.nColor[this.visIdx[k]]]].text;
      ctx.fillText(text, v[o + F_CX], v[o + F_CY]);
    }
    ctx.globalAlpha = 1;
  }

  /**
   * Chi tiết tile kiểu HUD trên thân đã vẽ: dải highlight `hl` px ở mép trên + viền trong tối 1 px.
   * Tile chưa mờ (đa số) gom vào MỘT path mỗi loại → 2 lần vẽ cho cả frame (alpha = tileOpacity);
   * tile mờ dần (đã qua hit line, ô đếm vào) vẽ riêng theo độ đục của nó. Bỏ qua tile quá nhỏ và tile
   * đang chạm hit line (viền sáng dày).
   */
  private drawTileDetails(
    ctx: CanvasRenderingContext2D,
    count: number,
    hl: number,
    bodyOpacity: number,
  ): void {
    const p = this.pal;
    const v = this.vis;
    const minA = 0.999;
    const minH = 2 * hl + 4;
    let faded = false;
    let any = false;
    ctx.lineWidth = 1;
    // Highlight mép trên (tile chưa mờ).
    ctx.beginPath();
    for (let k = 0; k < count; k++) {
      const o = k * STRIDE;
      const w = v[o + F_W];
      if (w < 8 || v[o + F_H] < minH || (v[o + F_FLAGS] & FLAG_ACTIVE) !== 0) continue;
      if (v[o + F_A] < minA) {
        faded = true;
        continue;
      }
      ctx.rect(v[o + F_X] + 2, v[o + F_Y] + 1, w - 4, hl);
      any = true;
    }
    if (any) {
      ctx.globalAlpha = bodyOpacity;
      ctx.fillStyle = p.tileHighlight;
      ctx.fill();
      // Viền trong tối: cùng tập tile.
      ctx.beginPath();
      for (let k = 0; k < count; k++) {
        const o = k * STRIDE;
        const w = v[o + F_W];
        const h = v[o + F_H];
        if (w < 8 || h < minH || (v[o + F_FLAGS] & FLAG_ACTIVE) !== 0) continue;
        if (v[o + F_A] < minA) continue;
        ctx.rect(v[o + F_X] + 1.5, v[o + F_Y] + 1.5, w - 3, h - 3);
      }
      ctx.strokeStyle = p.tileInner;
      ctx.stroke();
    }
    if (faded) {
      // Tile mờ dần: từng cái theo alpha của nó.
      ctx.fillStyle = p.tileHighlight;
      ctx.strokeStyle = p.tileInner;
      for (let k = 0; k < count; k++) {
        const o = k * STRIDE;
        const w = v[o + F_W];
        const h = v[o + F_H];
        if (w < 8 || h < minH || (v[o + F_FLAGS] & FLAG_ACTIVE) !== 0) continue;
        const a = v[o + F_A];
        if (a >= minA || a * bodyOpacity < 0.05) continue;
        const x = v[o + F_X];
        const y = v[o + F_Y];
        ctx.globalAlpha = a * bodyOpacity;
        ctx.fillRect(x + 2, y + 1, w - 4, hl);
        ctx.strokeRect(x + 1.5, y + 1.5, w - 3, h - 3);
      }
    }
    ctx.globalAlpha = 1;
  }

  /**
   * Chấm quãng của số giản phổ (mobile) quanh nhãn tại (x, y), cỡ chữ `size`: chấm trên = quãng cao,
   * chấm dưới = quãng thấp (1 hoặc 2 chấm xếp dọc). Màu = fillStyle đang đặt (màu chữ của tile).
   */
  private drawJianpuDots(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    size: number,
    note: number,
  ): void {
    const r = dotRadius(size);
    const step = dotStep(size);
    const half = (size * CAP_RATIO) / 2;
    const first = half + dotGap(size) + r;
    ctx.beginPath();
    for (let j = 0; j < this.nDotA[note]; j++) {
      const cy = y - first - j * step;
      ctx.moveTo(x + r, cy);
      ctx.arc(x, cy, r, 0, Math.PI * 2);
    }
    for (let j = 0; j < this.nDotB[note]; j++) {
      const cy = y + first + j * step;
      ctx.moveTo(x + r, cy);
      ctx.arc(x, cy, r, 0, Math.PI * 2);
    }
    ctx.fill();
  }

  /** Vẽ nhãn phím của nhóm tile (dấu phẩy hay không, cùng bậc font) bằng font đang đặt. */
  private drawKeyLabels(
    ctx: CanvasRenderingContext2D,
    count: number,
    comma: boolean,
    tier: number,
    lift: number,
  ): void {
    const v = this.vis;
    for (let k = 0; k < count; k++) {
      const i = this.visIdx[k];
      const lane = this.nLane[i];
      const o = k * STRIDE;
      if ((lane === this.commaLane) !== comma || v[o + F_T] !== tier) continue;
      const text = MOD_COLORS[COLOR_KEYS[this.nColor[i]]].text;
      const x = v[o + F_KX];
      const y = v[o + F_KY] - lift;
      ctx.globalAlpha = v[o + F_A];
      ctx.fillStyle = text;
      if (comma) {
        ctx.strokeStyle = text;
        ctx.strokeText(',', x, y);
      }
      ctx.fillText(this.laneKey[lane], x, y);
    }
  }

  /**
   * Hit line = "tia laser": lõi 2 px (`hitLine`) + glow (`hitGlow` sát lõi, `hitGlowOuter` rộng mờ)
   * vẽ bằng các vạch bán trong suốt chồng nhau — không shadowBlur, chi phí như 3 vạch thẳng. Hai đầu
   * có ngoặc `[ ]` (cùng path với lõi → một lần stroke) và mũi `▸ ◂` chỉ vào trong.
   */
  private drawHitLine(ctx: CanvasRenderingContext2D, L: Layout): void {
    const p = this.pal;
    const s = L.scale;
    const t = L.hitPos;
    const end = L.crossLength;
    ctx.globalAlpha = 1;
    if (p.hitGlowOuter) {
      ctx.strokeStyle = p.hitGlowOuter;
      ctx.lineWidth = Math.max(8, Math.round(12 * s));
      ctx.beginPath();
      this.lineAcross(ctx, L, t, 0, end);
      ctx.stroke();
    }
    if (p.hitGlow) {
      ctx.strokeStyle = p.hitGlow;
      ctx.lineWidth = Math.max(4, Math.round(5 * s));
      ctx.beginPath();
      this.lineAcross(ctx, L, t, 0, end);
      ctx.stroke();
    }
    const lw = Math.max(2, Math.round(2 * s));
    const tick = Math.max(6, Math.round(8 * s));
    const tab = Math.max(4, Math.round(5 * s));
    const e0 = lw / 2;
    const e1 = end - lw / 2;
    ctx.strokeStyle = p.hitLine;
    ctx.lineWidth = lw;
    ctx.lineJoin = 'miter';
    ctx.beginPath();
    this.lineAcross(ctx, L, t, 0, end);
    // Ngoặc hai đầu: "[" ở đầu hàng, "]" ở cuối (dọc theo trục thời gian ± tick).
    this.bracketPath(ctx, L, t, e0, tab, tick);
    this.bracketPath(ctx, L, t, e1, -tab, tick);
    ctx.stroke();
    // Mũi chỉ vào trong ngay sau ngoặc.
    const ah = Math.max(3, Math.round(4 * s));
    const al = Math.max(4, Math.round(6 * s));
    ctx.fillStyle = p.hitLine;
    ctx.beginPath();
    this.arrowPath(ctx, L, t, e0 + tab + 2, al, ah);
    this.arrowPath(ctx, L, t, e1 - tab - 2, -al, ah);
    ctx.fill();
  }

  /** Ngoặc `[` (dir > 0) / `]` (dir < 0) tại toạ độ cross `c` trên hit line `t`. */
  private bracketPath(
    ctx: CanvasRenderingContext2D,
    L: Layout,
    t: number,
    c: number,
    dir: number,
    tick: number,
  ): void {
    if (L.orientation === 'vertical') {
      ctx.moveTo(c + dir, t - tick);
      ctx.lineTo(c, t - tick);
      ctx.lineTo(c, t + tick);
      ctx.lineTo(c + dir, t + tick);
    } else {
      ctx.moveTo(t - tick, c + dir);
      ctx.lineTo(t - tick, c);
      ctx.lineTo(t + tick, c);
      ctx.lineTo(t + tick, c + dir);
    }
  }

  /** Mũi tam giác trên hit line, gốc tại cross `c`, dài `len` (dấu = hướng), nửa bề ngang `half`. */
  private arrowPath(
    ctx: CanvasRenderingContext2D,
    L: Layout,
    t: number,
    c: number,
    len: number,
    half: number,
  ): void {
    if (L.orientation === 'vertical') {
      ctx.moveTo(c, t - half);
      ctx.lineTo(c + len, t);
      ctx.lineTo(c, t + half);
    } else {
      ctx.moveTo(t - half, c);
      ctx.lineTo(t, c + len);
      ctx.lineTo(t + half, c);
    }
    ctx.closePath();
  }
}

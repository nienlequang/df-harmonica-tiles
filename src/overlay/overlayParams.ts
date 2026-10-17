/**
 * Tham số URL của overlay OBS (spec §7 "Overlay" + docs/GAME-UI-REFERENCE.md): đọc (kẹp, giá trị lạ →
 * mặc định, param lạ bỏ qua), dựng lại link cho hộp thoại "Tạo link OBS", preset + hình học bố cục
 * "cả canvas" (`fit=canvas`). Thuần — không DOM / React / store.
 *
 * Route: `#/overlay/<id>?…` hoặc `?overlay=1&song=<id>&…` (router gộp query của location.search và
 * phần `?…` trong hash). Bài người dùng nên nhúng `data=<lz-string>` (OBS có localStorage riêng nên
 * không thấy thư viện của trình duyệt người dùng); bài mẫu dùng id được.
 *
 * Overlay là màn hiển thị của Player chính (follow.ts): khi nghe thấy Player thì bài, transport và hiển
 * thị lấy theo Player; link chỉ còn (1) cách hiển thị riêng của overlay (preset, nền, độ đậm, tinh chỉnh
 * cỡ UI game, `fit`, `preview` của cửa sổ "Xem trước") và (2) ẢNH CHỤP Cài đặt của Player lúc tạo link
 * (kiểu điều khiển, tên nút, Nửa Cung,
 * lookahead, cỡ ô, nhãn phụ, đếm vào, chờ trước khi chạy, ngôn ngữ, theme) — dùng khi overlay tự chạy
 * một mình (không nghe thấy Player). Link cũ: `lyrics`, `autoplay`, `loop` bị bỏ qua (tự chạy luôn tự
 * phát sau đếm ngược, không lặp).
 */
import { encodeShareData } from '../core/share';
import type { Lang } from '../i18n/strings';
import { BASE_GUTTER, GAME_FRAME_PAD } from '../player/layout';
import type { RendererOptions } from '../player/renderer';
import type {
  ControlScheme,
  MobileSemitone,
  ModifierLabelOverrides,
  SubLabel,
  Theme,
} from '../ui/settings';

export type OverlayLayout = 'full' | 'game';
export type OverlayLanes = 'vertical' | 'horizontal';
/**
 * transparent (Browser Source, mặc định) · chroma #00FF00 (chỉ còn cho link cũ — cách Window Capture + Chroma
 * Key đã bỏ ở vòng R6, link `bg=chroma` vẫn đọc / vẽ được) · theme.
 */
export type OverlayBackground = 'transparent' | 'chroma' | 'theme';
/**
 * `source` (mặc định, link cũ): trang = đúng khung overlay, người dùng tự đặt cỡ / vị trí source.
 * `canvas`: trang = CẢ canvas OBS (Browser Source cỡ canvas tại 0,0; cửa sổ "Xem trước" cũng vậy); overlay
 * tự vẽ đúng chỗ trên bảng phím game (canvasPlacement).
 */
export type OverlayFit = 'source' | 'canvas';

export interface OverlayParams {
  /** `song=<id>` (bài mẫu hoặc bài trong localStorage của trình duyệt đang mở); null = không có. */
  song: string | null;
  /** `data=<lz-string>` thô (giải mã bằng decodeShareData); null = không có. Thắng `song`. */
  data: string | null;
  /** Tempo ghi đè (20..400); null = theo bài. */
  bpm: number | null;
  /** Đếm vào bằng hình khi tự chạy (độ dài theo src/player/leadIn.ts; không bao giờ có tiếng). */
  countIn: boolean;
  /** Đếm ngược (giây, 0..10) trước mỗi lần tự chạy / bấm chạy. */
  delaySec: number;
  /** Số beat thấy trên màn (4..12). */
  lookahead: number;
  /**
   * `scale` (0.5..3): `fit=source` → tileScale của renderer (link cũ: 1.33 cho canvas 1440p);
   * `fit=canvas` → tinh chỉnh cỡ UI trong game (phóng quanh đáy-giữa bảng phím game).
   */
  scale: number;
  /** `tilescale` — cỡ ô trong Cài đặt của Player (nhân thêm vào tileScale của renderer). */
  tileScale: number;
  /** `sublabel` — nhãn phụ trên ô theo Cài đặt của Player; null = theo trình duyệt đang mở. */
  subLabel: SubLabel | null;
  /** `lang` — ngôn ngữ của Player; null = theo trình duyệt đang mở. */
  lang: Lang | null;
  /** `theme` — theme của Player; null = theo trình duyệt đang mở. */
  theme: Theme | null;
  lanes: OverlayLanes;
  bg: OverlayBackground;
  layout: OverlayLayout;
  fit: OverlayFit;
  /** Độ đục thân tile (0.3..1); nền chroma bỏ qua (luôn 1, xem effectiveTileOpacity). */
  opacity: number;
  scheme: ControlScheme;
  /** Game bar mô phỏng bảng phím (PC / Mobile theo `scheme`). */
  gamebar: boolean;
  /** Banner "ĐANG GIỮ …" / chế độ mobile. */
  banner: boolean;
  /**
   * Mobile: Nửa Cung bật/tắt giữ trạng thái (`toggle`, mặc định) hay chỉ áp 1 nốt (`semitone=oneshot`)
   * — như Cài đặt của người tạo link (OBS có bộ nhớ riêng, không thấy Cài đặt đó).
   */
  semitone: MobileSemitone;
  /**
   * Tên gọi tùy chỉnh của 4 nút (`nl` Cúi Xuống, `nr` Ngẩng Lên, `nn` Ngẩng Tự Nhiên, `ns` Nửa Cung);
   * chuỗi rỗng = tên mặc định theo ngôn ngữ. Cùng lý do với `semitone`.
   */
  names: ModifierLabelOverrides;
  /**
   * `preview=1` — cửa sổ "Xem trước" của hộp thoại OBS (vòng R6): trang nền tối thường (không trong suốt),
   * nhãn + tiêu đề cửa sổ "Xem trước · không dùng để quay", bảng phím game minh họa (gameKeyboardBox). Chỉ để
   * xem người xem stream thấy gì — không phải nguồn để quay.
   */
  preview: boolean;
}

export const OVERLAY_BPM_MIN = 20;
export const OVERLAY_BPM_MAX = 400;
export const OVERLAY_DELAY_MAX = 10;
export const OVERLAY_LOOKAHEAD_MIN = 4;
export const OVERLAY_LOOKAHEAD_MAX = 12;
/** = lookahead mặc định của Cài đặt (6 beat từ settings v5, góp ý 2026-10-16). */
export const OVERLAY_LOOKAHEAD_DEFAULT = 6;
export const OVERLAY_SCALE_MIN = 0.5;
export const OVERLAY_SCALE_MAX = 3;
/** Thanh trượt "tinh chỉnh cỡ UI game" của hộp thoại (fit=canvas). */
export const OVERLAY_UI_SCALE_MIN = 0.7;
export const OVERLAY_UI_SCALE_MAX = 1.3;
export const OVERLAY_OPACITY_MIN = 0.3;
export const OVERLAY_OPACITY_MAX = 1;
/** Độ đục tile mặc định của preset khớp game (thấy gameplay phía sau). */
export const GAME_LAYOUT_OPACITY = 0.85;
/** Hit line preset khớp game: sát đáy source (tile chạm đúng lúc rơi xuống bảng phím của game). */
export const GAME_LAYOUT_HIT_LINE = 0.97;
/** Hit line của Player (D-028) — overlay đầy đủ / dải ngang dùng y như vậy. */
export const DEFAULT_HIT_LINE = 0.82;
/** Độ dài tối đa tên nút trong link (= LABEL_OVERRIDE_MAX của Cài đặt). */
export const OVERLAY_NAME_MAX = 24;
/** Tham số URL của 4 tên nút. */
export const OVERLAY_NAME_PARAMS: Readonly<Record<keyof ModifierLabelOverrides, string>> = {
  left: 'nl',
  right: 'nr',
  natural: 'nn',
  scroll: 'ns',
};
const NAME_KEYS = ['left', 'right', 'natural', 'scroll'] as const;

/** Mặc định phụ thuộc layout. */
export interface LayoutDefaults {
  opacity: number;
  gamebar: boolean;
  banner: boolean;
}

export function layoutDefaults(layout: OverlayLayout): LayoutDefaults {
  return layout === 'game'
    ? { opacity: GAME_LAYOUT_OPACITY, gamebar: false, banner: true }
    : { opacity: 1, gamebar: true, banner: true };
}

const TRUE_VALUES = ['1', 'true', 'yes', 'on'];
const FALSE_VALUES = ['0', 'false', 'no', 'off'];

function readBool(q: URLSearchParams, name: string, fallback: boolean): boolean {
  const raw = q.get(name);
  if (raw === null) return fallback;
  const v = raw.trim().toLowerCase();
  if (TRUE_VALUES.includes(v)) return true;
  if (FALSE_VALUES.includes(v)) return false;
  return fallback;
}

function readNumber(q: URLSearchParams, name: string): number | null {
  const raw = q.get(name);
  if (raw === null) return null;
  const v = raw.trim();
  if (v === '') return null;
  const n = Number(v.replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v));

function readClamped(
  q: URLSearchParams,
  name: string,
  min: number,
  max: number,
  fallback: number,
): number {
  const n = readNumber(q, name);
  return n === null ? fallback : clamp(n, min, max);
}

function readEnum<T extends string>(
  q: URLSearchParams,
  name: string,
  allowed: readonly T[],
  fallback: T,
): T {
  const raw = q.get(name);
  if (raw === null) return fallback;
  const v = raw.trim().toLowerCase();
  return (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
}

/** Như readEnum nhưng thiếu / lạ → null ("theo trình duyệt đang mở"). */
function readOptionalEnum<T extends string>(
  q: URLSearchParams,
  name: string,
  allowed: readonly T[],
): T | null {
  const raw = q.get(name);
  if (raw === null) return null;
  const v = raw.trim().toLowerCase();
  return (allowed as readonly string[]).includes(v) ? (v as T) : null;
}

function readText(q: URLSearchParams, name: string): string | null {
  const raw = q.get(name);
  if (raw === null) return null;
  const v = raw.trim();
  return v === '' ? null : v;
}

/** Tên nút: bỏ xuống dòng / tab, trim, tối đa OVERLAY_NAME_MAX ký tự; thiếu → ''. */
function readName(q: URLSearchParams, name: string): string {
  const raw = q.get(name);
  if (raw === null) return '';
  return raw
    .replace(/[\r\n\t]+/g, ' ')
    .trim()
    .slice(0, OVERLAY_NAME_MAX);
}

/** Đọc mọi tham số overlay; không bao giờ throw. */
export function parseOverlayParams(query: URLSearchParams): OverlayParams {
  const layout = readEnum(query, 'layout', ['full', 'game'] as const, 'full');
  const d = layoutDefaults(layout);
  const bpm = readNumber(query, 'bpm');
  return {
    song: readText(query, 'song'),
    data: readText(query, 'data'),
    bpm: bpm !== null && bpm > 0 ? clamp(bpm, OVERLAY_BPM_MIN, OVERLAY_BPM_MAX) : null,
    countIn: readBool(query, 'countin', false),
    delaySec: Math.round(readClamped(query, 'delay', 0, OVERLAY_DELAY_MAX, 0)),
    lookahead: Math.round(
      readClamped(
        query,
        'lookahead',
        OVERLAY_LOOKAHEAD_MIN,
        OVERLAY_LOOKAHEAD_MAX,
        OVERLAY_LOOKAHEAD_DEFAULT,
      ),
    ),
    scale: readClamped(query, 'scale', OVERLAY_SCALE_MIN, OVERLAY_SCALE_MAX, 1),
    tileScale: readClamped(query, 'tilescale', OVERLAY_SCALE_MIN, OVERLAY_SCALE_MAX, 1),
    subLabel: readOptionalEnum(query, 'sublabel', ['solfege', 'number', 'none'] as const),
    lang: readOptionalEnum(query, 'lang', ['vi', 'en'] as const),
    theme: readOptionalEnum(query, 'theme', ['dark', 'light'] as const),
    lanes: readEnum(query, 'lanes', ['vertical', 'horizontal'] as const, 'vertical'),
    bg: readEnum(query, 'bg', ['transparent', 'chroma', 'theme'] as const, 'transparent'),
    layout,
    fit: readEnum(query, 'fit', ['source', 'canvas'] as const, 'source'),
    opacity: readClamped(query, 'opacity', OVERLAY_OPACITY_MIN, OVERLAY_OPACITY_MAX, d.opacity),
    scheme: readEnum(query, 'scheme', ['pc', 'mobile'] as const, 'pc'),
    gamebar: readBool(query, 'gamebar', d.gamebar),
    banner: readBool(query, 'banner', d.banner),
    semitone:
      readEnum(query, 'semitone', ['toggle', 'oneshot'] as const, 'toggle') === 'oneshot'
        ? 'oneShot'
        : 'toggle',
    names: {
      left: readName(query, OVERLAY_NAME_PARAMS.left),
      right: readName(query, OVERLAY_NAME_PARAMS.right),
      natural: readName(query, OVERLAY_NAME_PARAMS.natural),
      scroll: readName(query, OVERLAY_NAME_PARAMS.scroll),
    },
    preview: readBool(query, 'preview', false),
  };
}

/** Độ đục tile thực dùng: nền chroma luôn 1 (tile bán trong suốt trộn xanh sẽ bị Chroma Key ăn mất). */
export function effectiveTileOpacity(p: Pick<OverlayParams, 'bg' | 'opacity'>): number {
  return p.bg === 'chroma' ? 1 : p.opacity;
}

/**
 * Phần option renderer suy từ tham số (phần còn lại — theme, ngôn ngữ, nhãn phụ, tên nút; và khi theo
 * Player: kiểu điều khiển, lookahead, cỡ ô — OverlayView ghép vào).
 * Khớp game + `fit=canvas` + lane dọc (v1.0.1): khung = khung bảng phím PC của game (`framePad` =
 * GAME_FRAME_PAD, canvasPlacement chừa đúng chỗ đó) → ô ngoài cùng không sát mép. `fit=source` (link cũ, người dùng
 * tự kéo source cho 8 làn trùng 8 phím) giữ 8 làn phủ kín như trước — không xê dịch làn của link đang dùng.
 */
export function overlayRendererOptions(p: OverlayParams): Partial<RendererOptions> {
  const game = p.layout === 'game';
  const framed = game && p.fit === 'canvas' && p.lanes === 'vertical';
  return {
    orientation: p.lanes,
    lookahead: p.lookahead,
    tileScale: p.scale,
    background: p.bg,
    hitLinePos: game ? GAME_LAYOUT_HIT_LINE : DEFAULT_HIT_LINE,
    lanePadding: game ? 'none' : 'normal',
    framePad: framed ? GAME_FRAME_PAD : 0,
    tileOpacity: effectiveTileOpacity(p),
    gridStyle: game ? 'subtle' : 'normal',
    scheme: p.scheme,
    mobileSemitone: p.semitone,
    showRibbons: true,
    showBarLines: true,
    showSectionLabels: true,
  };
}

// ---------------------------------------------------------------------------
// Dựng link (hộp thoại "Tạo link OBS")
// ---------------------------------------------------------------------------

/** Các tham số của link (không gồm bài / bpm). */
export type OverlayLinkOptions = Omit<OverlayParams, 'song' | 'data' | 'bpm'>;

/** Bài cần nhúng vào link: bài mẫu dùng id; bài người dùng LUÔN nhúng `data=` (nguồn .harm). */
export interface OverlayLinkSong {
  id: string;
  seed: boolean;
  source: string;
}

const fmt = (v: number): string => String(Math.round(v * 100) / 100);
const flag = (v: boolean): string => (v ? '1' : '0');

/**
 * Query (không có `?` đầu) chỉ chứa giá trị khác mặc định, luôn có `layout` (đứng đầu); `data` (dài) ở
 * cuối, giữ nguyên ký tự lz-string (`+` bị URLSearchParams đọc thành dấu cách — decodeShareData chịu được).
 */
export function buildOverlayQuery(o: OverlayLinkOptions, data: string | null = null): string {
  const d = layoutDefaults(o.layout);
  const parts: string[] = [`layout=${o.layout}`];
  if (o.fit !== 'source') parts.push(`fit=${o.fit}`);
  if (o.lanes !== 'vertical') parts.push(`lanes=${o.lanes}`);
  if (o.bg !== 'transparent') parts.push(`bg=${o.bg}`);
  if (o.preview) parts.push('preview=1');
  const scale = clamp(o.scale, OVERLAY_SCALE_MIN, OVERLAY_SCALE_MAX);
  if (Math.abs(scale - 1) > 1e-9) parts.push(`scale=${fmt(scale)}`);
  const lookahead = Math.round(clamp(o.lookahead, OVERLAY_LOOKAHEAD_MIN, OVERLAY_LOOKAHEAD_MAX));
  if (lookahead !== OVERLAY_LOOKAHEAD_DEFAULT) parts.push(`lookahead=${lookahead}`);

  if (o.scheme !== 'pc') parts.push(`scheme=${o.scheme}`);
  if (o.scheme === 'mobile' && o.semitone === 'oneShot') parts.push('semitone=oneshot');
  for (const k of NAME_KEYS) {
    const name = o.names[k]
      .replace(/[\r\n\t]+/g, ' ')
      .trim()
      .slice(0, OVERLAY_NAME_MAX);
    if (name) parts.push(`${OVERLAY_NAME_PARAMS[k]}=${encodeURIComponent(name)}`);
  }
  const tileScale = clamp(o.tileScale, OVERLAY_SCALE_MIN, OVERLAY_SCALE_MAX);
  if (Math.abs(tileScale - 1) > 1e-9) parts.push(`tilescale=${fmt(tileScale)}`);
  if (o.subLabel !== null) parts.push(`sublabel=${o.subLabel}`);
  const opacity = clamp(o.opacity, OVERLAY_OPACITY_MIN, OVERLAY_OPACITY_MAX);
  if (Math.abs(opacity - d.opacity) > 1e-9) parts.push(`opacity=${fmt(opacity)}`);
  if (o.gamebar !== d.gamebar) parts.push(`gamebar=${flag(o.gamebar)}`);
  if (o.banner !== d.banner) parts.push(`banner=${flag(o.banner)}`);
  if (o.countIn) parts.push('countin=1');
  const delay = Math.round(clamp(o.delaySec, 0, OVERLAY_DELAY_MAX));
  if (delay > 0) parts.push(`delay=${delay}`);
  if (o.lang !== null) parts.push(`lang=${o.lang}`);
  if (o.theme !== null) parts.push(`theme=${o.theme}`);
  if (data !== null && data !== '') parts.push(`data=${data}`);
  return parts.join('&');
}

/**
 * Link overlay đầy đủ: `origin + pathname + '#/overlay/<id>?…'` (bài mẫu) hoặc
 * `origin + pathname + '#/overlay?…&data=<lz>'` (bài người dùng, mở được ở trình duyệt khác / OBS).
 */
export function buildOverlayUrl(
  loc: { origin: string; pathname: string },
  song: OverlayLinkSong,
  o: OverlayLinkOptions,
): string {
  const base = `${loc.origin}${loc.pathname}`;
  if (song.seed) return `${base}#/overlay/${encodeURIComponent(song.id)}?${buildOverlayQuery(o)}`;
  return `${base}#/overlay?${buildOverlayQuery(o, encodeShareData(song.source))}`;
}

// ---------------------------------------------------------------------------
// Preset
// ---------------------------------------------------------------------------

/** Preset trong hộp thoại: khớp bảng phím game · dải ngang · đầy đủ có game bar. */
export type ObsPreset = 'game' | 'strip' | 'full';
export const OBS_PRESETS: readonly ObsPreset[] = ['game', 'strip', 'full'];

/** Phần option mà preset đặt. */
export type PresetOptions = Pick<
  OverlayLinkOptions,
  'layout' | 'lanes' | 'gamebar' | 'banner' | 'opacity'
>;

export function presetOptions(preset: ObsPreset): PresetOptions {
  switch (preset) {
    case 'game':
      return {
        layout: 'game',
        lanes: 'vertical',
        gamebar: false,
        banner: true,
        opacity: GAME_LAYOUT_OPACITY,
      };
    case 'strip':
      return {
        layout: 'full',
        lanes: 'horizontal',
        gamebar: false,
        banner: true,
        opacity: 1,
      };
    default:
      return {
        layout: 'full',
        lanes: 'vertical',
        gamebar: true,
        banner: true,
        opacity: 1,
      };
  }
}

/** Preset suy từ tham số (chỗ đặt trên canvas): layout game → khớp game; lane ngang → dải; còn lại → đầy đủ. */
export function presetOf(p: Pick<OverlayParams, 'layout' | 'lanes'>): ObsPreset {
  if (p.layout === 'game') return 'game';
  return p.lanes === 'horizontal' ? 'strip' : 'full';
}

// ---------------------------------------------------------------------------
// Bố cục "cả canvas" (`fit=canvas`) — docs/GAME-UI-REFERENCE.md "Bố cục cả canvas"
// ---------------------------------------------------------------------------

/** Canvas tham chiếu: số đo bảng phím game quy về 1920×1080 (16:9). */
export const REF_CANVAS_W = 1920;
export const REF_CANVAS_H = 1080;

/** Hình chữ nhật (px). */
export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Số lane của game. */
const GAME_LANES = 8;
/** Bước cột phím game ở 1080p (px; docs/GAME-UI-REFERENCE.md). */
const GAME_PITCH_REF = 65;
/** 8 làn của preset game ở 1080p: mép trái x 700, rộng 8 × 65 (tâm nhóm 960) — tâm làn = tâm 8 phím. */
const GAME_LANES_REF = { x: 700, width: GAME_LANES * GAME_PITCH_REF } as const;
/** Đệm khung bảng phím PC mỗi bên 8 làn ở 1080p (px) = GAME_FRAME_PAD bước ≈ 16,9. */
const GAME_FRAME_PAD_REF = GAME_FRAME_PAD * GAME_PITCH_REF;
/**
 * Khung bảng phím PC của game ở 1080p (ảnh chụp của chủ dự án, v1.0.1): 8 làn + đệm hai bên ≈ x 683,1 → 1236,9
 * (rộng 553,8 = 8,52 bước). Số đo cũ từ ảnh stream thu nhỏ (x 681–1241, ±5 px) khớp trong sai số.
 */
const GAME_FRAME_REF = {
  x: GAME_LANES_REF.x - GAME_FRAME_PAD_REF,
  width: GAME_LANES_REF.width + 2 * GAME_FRAME_PAD_REF,
} as const;

/**
 * Chỗ của mỗi preset trên canvas 1920×1080 ở cỡ UI game mặc định, và điểm neo khi tinh chỉnh `scale`
 * (khung phóng / thu quanh điểm này):
 * - game: khung = khung bảng phím PC của game (v1.0.1) ≈ 553,8 × 600 tại (683,1, 150) → đáy y 750 ≈ mép trên
 *   bảng phím game (y 758); bên trong 8 làn 520 px (8 × 65, bước cột phím game) ở x 700–1220 trùng 8 keycap, đệm
 *   GAME_FRAME_PAD bước mỗi bên (renderer `framePad`); gutter ribbon (56 × tileScale) nằm thêm bên phải khung.
 *   Neo = đáy-giữa bảng phím game (960, 921): UI game to / nhỏ thì bảng phím phóng quanh đó.
 * - strip: dải ngang 1140 × 440 tại (370, 310) — đáy ngay trên bảng phím game, không lấn bên phải
 *   (x < 1510: khung chat / webcam thường ở đó). Neo = đáy-giữa của dải.
 * - full: cột 560 × 920 tại (1290, 80) — bên phải giữa màn, không đè bảng phím game (x > 1241). Neo =
 *   đáy-giữa của cột.
 */
interface PresetRef {
  box: Box;
  anchorX: number;
  anchorY: number;
}

const PRESET_REF: Readonly<Record<ObsPreset, PresetRef>> = {
  game: {
    box: { x: GAME_FRAME_REF.x, y: 150, width: GAME_FRAME_REF.width, height: 600 },
    anchorX: 960,
    anchorY: 921,
  },
  strip: { box: { x: 370, y: 310, width: 1140, height: 440 }, anchorX: 940, anchorY: 750 },
  full: { box: { x: 1290, y: 80, width: 560, height: 920 }, anchorX: 1570, anchorY: 1000 },
};

export interface CanvasFrame extends Box {
  /** Hệ số so với 1920×1080 (= width / 1920). */
  k: number;
}

/**
 * Khung 16:9 lớn nhất nằm giữa viewport (canvas không 16:9 — vd. 2560×1080 — thì chừa hai bên / trên
 * dưới như game căn UI theo giữa màn).
 */
export function canvasFrame(viewportW: number, viewportH: number): CanvasFrame {
  const w = Math.max(1, Number.isFinite(viewportW) ? viewportW : 1);
  const h = Math.max(1, Number.isFinite(viewportH) ? viewportH : 1);
  const ratio = REF_CANVAS_W / REF_CANVAS_H;
  const fw = w / h > ratio ? h * ratio : w;
  const fh = fw / ratio;
  return { x: (w - fw) / 2, y: (h - fh) / 2, width: fw, height: fh, k: fw / REF_CANVAS_W };
}

export interface CanvasPlacement extends Box {
  /** tileScale cho renderer: hệ số canvas × tinh chỉnh `scale` × cỡ ô của Player (kẹp 0.5..3). */
  rendererScale: number;
  /**
   * Bề rộng gutter ribbon (px) — preset game: khung = khung bảng phím PC (8 làn + đệm `GAME_FRAME_PAD` bước mỗi
   * bên) + gutter. 0 ở preset khác.
   */
  gutter: number;
}

// Làm tròn px nguyên: canvas nét (không nội suy nửa điểm ảnh); lệch cột ≤ 0.5 px.
const roundPx = (v: number): number => Math.round(v);

/**
 * Chỗ của khung overlay (px trong viewport) ở bố cục cả canvas. `scale` = tinh chỉnh cỡ UI trong game
 * (1 = mặc định), `tileScale` = cỡ ô của Player. Preset game: khung rộng bằng khung bảng phím PC của game
 * (553,8·k·scale), bên trong 8 làn rộng đúng 520·k·scale (bước 65·k·scale px, renderer `framePad` =
 * GAME_FRAME_PAD), tâm đúng tâm bảng phím game; gutter ribbon ở bên phải ngoài khung. Khung không vượt mép trên
 * khung 16:9 (scale lớn → thấp lại, không trồi khỏi màn).
 */
export function canvasPlacement(
  preset: ObsPreset,
  viewportW: number,
  viewportH: number,
  scale = 1,
  tileScale = 1,
): CanvasPlacement {
  const f = canvasFrame(viewportW, viewportH);
  const s = clamp(Number.isFinite(scale) ? scale : 1, OVERLAY_SCALE_MIN, OVERLAY_SCALE_MAX);
  const ts = clamp(
    Number.isFinite(tileScale) ? tileScale : 1,
    OVERLAY_SCALE_MIN,
    OVERLAY_SCALE_MAX,
  );
  const rendererScale = clamp(f.k * s * ts, OVERLAY_SCALE_MIN, OVERLAY_SCALE_MAX);
  const ref = PRESET_REF[preset];
  // Phóng quanh điểm neo (đơn vị 1080p), rồi đổi sang px viewport.
  const left = ref.anchorX + (ref.box.x - ref.anchorX) * s;
  const bottom = ref.anchorY + (ref.box.y + ref.box.height - ref.anchorY) * s;
  const top = Math.max(0, bottom - ref.box.height * s);
  const width = ref.box.width * s * f.k;
  // Preset game: renderer chừa gutter round(56 × tileScale) bên phải khung (layout.ts) → khung rộng thêm
  // đúng chừng đó để 8 làn giữ bước cột của game.
  const gutter = preset === 'game' ? Math.round(BASE_GUTTER * rendererScale) : 0;
  return {
    x: roundPx(f.x + left * f.k),
    y: roundPx(f.y + top * f.k),
    width: roundPx(width + gutter),
    height: roundPx((bottom - top) * f.k),
    rendererScale,
    gutter,
  };
}

/** Bước cột (px) của 8 làn preset game ở bố cục cả canvas (= bước phím game). */
export function gameLanePitch(viewportW: number, viewportH: number, scale = 1): number {
  const f = canvasFrame(viewportW, viewportH);
  return GAME_PITCH_REF * clamp(scale, OVERLAY_SCALE_MIN, OVERLAY_SCALE_MAX) * f.k;
}

// ---------------------------------------------------------------------------
// Bảng phím game minh họa (cửa sổ "Xem trước", `preview=1`)
// ---------------------------------------------------------------------------

/**
 * Khung bảng phím của game ở 1080p (docs/GAME-UI-REFERENCE.md): x = khung của preset game (≈ 683–1237 — mép trái /
 * phải khung overlay trùng mép khung bảng phím), y 758–921.
 */
const GAME_PANEL_REF: Box = {
  x: GAME_FRAME_REF.x,
  y: 758,
  width: GAME_FRAME_REF.width,
  height: 163,
};
/** Keycap Z…, của game ≈ 22 px, tâm hàng y ≈ 840; tâm cột = tâm 8 làn của preset game (bước 65). */
const GAME_KEY_REF = 22;
const GAME_KEY_ROW_Y = 840;

export interface GameKeyboardGeometry {
  /** Khung bảng phím (px trong viewport). */
  panel: Box;
  /** 8 keycap Z X C V B N M , theo thứ tự cột. */
  keys: Box[];
}

/**
 * Bảng phím của game (khung + 8 keycap) ở bố cục cả canvas — CHỈ để vẽ minh họa trong cửa sổ "Xem trước"
 * (trên stream đó là UI thật của game, overlay không bao giờ vẽ nó). Cùng khung 16:9 và cùng phép phóng
 * `scale` quanh đáy-giữa bảng phím (960, 921) như canvasPlacement → keycap thẳng tâm 8 làn của preset game.
 */
export function gameKeyboardBox(
  viewportW: number,
  viewportH: number,
  scale = 1,
): GameKeyboardGeometry {
  const f = canvasFrame(viewportW, viewportH);
  const s = clamp(Number.isFinite(scale) ? scale : 1, OVERLAY_SCALE_MIN, OVERLAY_SCALE_MAX);
  const { anchorX, anchorY } = PRESET_REF.game;
  const map = (x: number, y: number, w: number, h: number): Box => ({
    x: roundPx(f.x + (anchorX + (x - anchorX) * s) * f.k),
    y: roundPx(f.y + (anchorY + (y - anchorY) * s) * f.k),
    width: roundPx(w * s * f.k),
    height: roundPx(h * s * f.k),
  });
  const x0 = GAME_LANES_REF.x;
  const half = GAME_KEY_REF / 2;
  return {
    panel: map(GAME_PANEL_REF.x, GAME_PANEL_REF.y, GAME_PANEL_REF.width, GAME_PANEL_REF.height),
    keys: Array.from({ length: GAME_LANES }, (_, i) =>
      map(
        x0 + GAME_PITCH_REF * (i + 0.5) - half,
        GAME_KEY_ROW_Y - half,
        GAME_KEY_REF,
        GAME_KEY_REF,
      ),
    ),
  };
}

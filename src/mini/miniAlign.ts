/**
 * Bố cục "Khớp nút game" của trang mini Android (góp ý 2026-10-16, chủ dự án duyệt): cửa sổ nổi của Android
 * là cửa sổ ĐỤC nên không đặt đè lên nút được — người chơi đặt nó NGAY TRÊN bảng nút kèn của game, 8 lane
 * rơi thẳng trên 8 nút số thật và vòng "CHẠM" đáp ngay trên 4 nút chế độ thật (renderer `lanePadding:
 * 'fit'`, layout.ts `fitGeometry`). "Căn chỉnh" (chỉ khi đang dừng) chỉnh tinh; mặc định theo số đo ảnh game
 * (docs/GAME-UI-REFERENCE.md).
 *
 * ĐÚNG TỈ LỆ THẬT (D-405, chủ dự án: "để user chỉ cần kéo qua, hạn chế phải căn chỉnh trừ khi cần"): trang không
 * đặt được cỡ cửa sổ nổi nhưng đọc được cỡ MÀN HÌNH (`window.screen`). Máy Android cảm ứng (D-412), màn ngang và rõ
 * ràng rộng hơn cửa sổ → bước cột theo chiều cao màn (GAME_NOTE_STEP_H, D-413 — px CSS), hàng nút căn giữa cửa sổ:
 * lane đúng khoảng cách nút thật dù cửa sổ rộng / hẹp — người chơi chỉ kéo giãn cửa sổ cho đủ rộng (chỉ báo "Rộng:
 * vừa") rồi kéo cho vạch nằm trên nút. Chỉnh tinh: dời ngang cả hàng (px), khoảng cách (hệ số bước cột), dời / giãn
 * hàng nút chế độ. Màn không dùng được (≈ bề ngang cửa sổ, màn dọc, 0, máy tính / iPhone) → kiểu cũ "cửa sổ = 8
 * làn": tâm nút 1 / nút 1̇ theo phần bề ngang cửa sổ. Bề ngang cửa sổ cần = 8 bước cột (FIT_WINDOW_STEPS, v1.0.1): ô
 * ngoài cùng cách mép cửa sổ ~0,155 bước — không sát viền. Chiều cao: cửa sổ nên chạy từ mép trên màn hình xuống tới mép
 * trên bảng nút, không che hàng nút chế độ (GAME_PANEL_TOP_H … GAME_MODE_TOP_H, D-414) — chỉ báo "Cao".
 *
 * Nhớ theo máy ở localStorage (đọc / ghi bọc try — chế độ riêng tư, bộ nhớ đầy → chỉ nhớ trong phiên này):
 * bố cục (`Khớp nút game` | `Thu nhỏ` = trang mini cũ có bàn nút riêng) và số căn chỉnh. Không React.
 *
 * Nút − / + đi theo PX CSS của khung (D-400): 1 px mỗi chạm, giữ nút thì lặp và nhanh dần lên NUDGE_FAST_PX —
 * cửa sổ nổi thật chỉ rộng ~550–650 px nên bước theo phần bề ngang (0,001 ≈ 0,6 px) quá nhỏ để chạm.
 */
import {
  DEFAULT_LANE_FIT,
  FIT_NOTE_DISC_RATIO,
  FIT_WINDOW_STEPS,
  GAME_MODE_COLUMNS,
  LANE_COUNT,
} from '../player/layout';
import type { LaneFit } from '../player/layout';
import { isTouchDevice } from '../player/padPrefs';
import type { ControlScheme } from '../ui/settings';
import { MINI_SONG_STORAGE_KEY } from './miniControl';

/** 'game' = khớp nút game (lane theo nút thật, không bàn nút riêng); 'compact' = thu nhỏ (bàn nút riêng). */
export type MiniLayout = 'game' | 'compact';
export const MINI_LAYOUTS: readonly MiniLayout[] = ['game', 'compact'];

/**
 * Bố cục khi máy chưa chọn (D-402): kiểu Mobile → "Khớp nút game" (bố cục dành cho bản mobile của game);
 * kiểu PC → "Thu nhỏ" (trang mini cũ có game bar — PC không có nút trên màn hình để khớp).
 */
export function defaultMiniLayout(scheme: ControlScheme): MiniLayout {
  return scheme === 'mobile' ? 'game' : 'compact';
}

export const MINI_LAYOUT_STORAGE_KEY = 'dfht-mini-layout';
export const MINI_CALIBRATION_STORAGE_KEY = 'dfht-mini-calibration';
/**
 * Dấu "máy này đã mở trang mini từ v1.0.1" (cửa sổ "Khớp nút game" vừa = 8 làn, FIT_WINDOW_STEPS — D-434): có dấu thì
 * không nhắc đổi cỡ cửa sổ nữa (`needsFitWindowNotice`, D-441).
 */
export const MINI_FIT_NOTICE_STORAGE_KEY = 'dfht-mini-fit8';

// ---------------------------------------------------------------------------
// Số đo màn hình game (ảnh chụp màn hình game của chủ dự án 2026-10-16, màn ngang 1371 × 633)
// ---------------------------------------------------------------------------

/** Tỉ lệ (rộng / cao) của màn trong ảnh game: 1371 / 633 ≈ 2,166 (19,5:9). */
export const GAME_REF_ASPECT = 1371 / 633;
/** Bước cột (khoảng cách tâm hai nút số liền nhau) / bề ngang màn của ảnh game: 125,07 / 1371. */
export const GAME_NOTE_STEP_W = 0.0912;
/**
 * Cùng bước cột / CHIỀU CAO màn của ảnh game (= GAME_NOTE_STEP_W × GAME_REF_ASPECT ≈ 0,1975 — D-413): đơn vị
 * thật của trang mini. UI game phóng theo một hệ số cho cả hai chiều, theo chiều cao ở mọi màn ≥ 19,5:9.
 */
export const GAME_NOTE_STEP_H = GAME_NOTE_STEP_W * GAME_REF_ASPECT;
/** Mép trên bảng nút kèn (vạch ngang có hoa văn) / chiều cao màn: 207 / 633. */
export const GAME_PANEL_TOP_H = 0.327;
/** Đỉnh 4 nút chế độ (tâm 266 − Ø 75 / 2) / chiều cao màn: 228,5 / 633 ≈ 0,361 (D-414). */
export const GAME_MODE_TOP_H = 0.361;
/**
 * Bề ngang hàng nút số (mép ngoài nút 1 → mép ngoài nút 1̇) theo bước cột: 7 bước + Ø nút ≈ 0,70 bề ngang màn — cũng là
 * hai vạch khung bảng nút của game. Cửa sổ cần rộng hơn: FIT_WINDOW_STEPS (8 bước — ô ngoài cùng không sát mép).
 */
export const NOTE_ROW_STEPS = LANE_COUNT - 1 + FIT_NOTE_DISC_RATIO;

/** Màn "rõ ràng rộng hơn" cửa sổ: bề ngang cửa sổ ≤ chừng này × cạnh dài của màn (không thì là toàn màn). */
export const SCREEN_CLEAR_RATIO = 0.95;
/**
 * Chỉ báo "Rộng": hẹp hơn 8 làn (FIT_WINDOW_STEPS) quá chừng này bước cột → "hẹp quá" (ô ngoài cùng cách mép < ~0,08
 * bước — sát / bị cắt); 8 làn lệch tâm (dời "Vạch · Dời") ra ngoài mép cửa sổ quá chừng này → "lệch tâm" (ô ngoài cùng
 * chạm mép bên đó — kéo cửa sổ sang bên đó, không phải kéo giãn — D-415).
 */
export const WIDTH_NARROW_STEPS = 0.15;
/** … rộng hơn cần quá chừng này bước cột → "rộng hơn cần thiết" (che thêm màn game, vẫn dùng được). */
export const WIDTH_WIDE_STEPS = 0.6;
/**
 * Thanh kéo / tiêu đề của cửa sổ nổi (của hãng — trang không đo được, D-414): thường ~24 px CSS (Samsung pop-up,
 * HyperOS), tối đa chừng FLOAT_BAR_MAX. "Cao quá" tính với thanh thường gặp (cửa sổ đã che nút chế độ), "thấp quá"
 * với thanh lớn nhất (chắc chắn chưa chạm mép trên màn).
 */
export const FLOAT_BAR_GUESS = 24;
export const FLOAT_BAR_MAX = 36;
/** Sai số chiều cao: max(chừng này px, 1 % chiều cao màn). */
export const HEIGHT_TOL_MIN = 4;

/** `window.screen` đọc được (px CSS). */
export interface ScreenInfo {
  width: number;
  height: number;
  /** `screen.orientation.type` là landscape-… (null = trình duyệt không cho biết → so width / height). */
  landscape: boolean | null;
}

/** Đọc `window.screen` (lỗi / không có → null). */
export function readScreenInfo(): ScreenInfo | null {
  try {
    const s = typeof window === 'undefined' ? undefined : window.screen;
    if (!s) return null;
    const type = s.orientation?.type;
    return {
      width: s.width,
      height: s.height,
      landscape: typeof type === 'string' ? type.startsWith('landscape') : null,
    };
  } catch {
    return null;
  }
}

/**
 * Máy Android cảm ứng (D-412): nơi duy nhất cửa sổ nổi đặt trên game được — chỉ ở đây trang mới tin `window.screen`
 * là màn đang chạy game. Máy tính (cửa sổ trình duyệt không phóng to cũng "nhỏ hơn màn"), iPhone / iPad (trang mini
 * chỉ là chỗ mở Video nổi; Safari thụt lề vùng tai thỏ) → false → kiểu "cửa sổ = hàng nút", không chỉ báo.
 */
export function isAndroidTouch(win: Window | undefined = globalThis.window): boolean {
  if (!win) return false;
  try {
    const nav = win.navigator as Navigator & { userAgentData?: { platform?: string } };
    const android =
      /Android/i.test(nav?.userAgent ?? '') ||
      /^Android$/i.test(nav?.userAgentData?.platform ?? '');
    return android && isTouchDevice(win);
  } catch {
    return false;
  }
}

/**
 * Phần trình duyệt chiếm trong cửa sổ (thanh địa chỉ…) = outerHeight − innerHeight, chỉ khi hợp lý (> 0 và
 * ≤ 1/4 chiều cao màn — vài trình duyệt trả outerHeight = cả màn hình); không thì 0.
 */
export function browserChromeHeight(inner: number, outer: number, screenH: number): number {
  const d = outer - inner;
  return Number.isFinite(d) && d > 0 && Number.isFinite(screenH) && d <= screenH * 0.25 ? d : 0;
}

/** Tỉ lệ thật lấy từ cỡ màn hình (px CSS). */
export interface TrueScale {
  /** Cạnh dài / cạnh ngắn của màn. */
  screenW: number;
  screenH: number;
  /**
   * Chiều cao "màn ảnh game" UI game lấp vừa (px CSS, D-413): = screenH ở màn ≥ 19,5:9 (gần như mọi điện thoại —
   * UI phóng theo chiều cao, như cửa sổ nổi PC); màn hẹp hơn (16:9, máy tính bảng) = screenW / GAME_REF_ASPECT để
   * hàng nút vẫn nằm trọn trong màn.
   */
  refH: number;
  /** Bước cột thật = GAME_NOTE_STEP_H × refH (chưa nhân hệ số "Vạch · Giãn" của Căn chỉnh). */
  step: number;
  /** Mép trên bảng nút / đỉnh hàng nút chế độ (px CSS từ mép trên màn; bảng nút bám đáy màn). */
  panelTop: number;
  modeTop: number;
}

/**
 * Cỡ màn dùng được cho đúng tỉ lệ thật: máy Android cảm ứng (`androidTouch` — `isAndroidTouch()`, D-412), số dương,
 * màn NGANG (game chạy ngang), cạnh dài rõ ràng lớn hơn bề ngang cửa sổ `viewW` (≤ SCREEN_CLEAR_RATIO — không thì
 * trang đang chiếm cả màn, không phải cửa sổ nổi). Không → null (kiểu "cửa sổ = hàng nút").
 */
export function trueScaleOf(
  screen: ScreenInfo | null,
  viewW: number,
  androidTouch: boolean,
): TrueScale | null {
  if (!androidTouch || !screen) return null;
  const { width, height } = screen;
  if (!(Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0)) return null;
  if (!(Number.isFinite(viewW) && viewW > 0)) return null;
  const long = Math.max(width, height);
  const short = Math.min(width, height);
  const landscape = screen.landscape ?? width > height;
  if (!landscape || long <= short) return null;
  if (viewW > long * SCREEN_CLEAR_RATIO) return null;
  // Làm tròn 1e-9: màn đúng tỉ lệ ảnh (1371 × 633) ra đúng refH = 633.
  const refH = Math.min(short, Number((long / GAME_REF_ASPECT).toFixed(9)));
  return {
    screenW: long,
    screenH: short,
    refH,
    step: GAME_NOTE_STEP_H * refH,
    panelTop: short - (1 - GAME_PANEL_TOP_H) * refH,
    modeTop: short - (1 - GAME_MODE_TOP_H) * refH,
  };
}

// ---------------------------------------------------------------------------
// Số căn chỉnh
// ---------------------------------------------------------------------------

/** Số căn chỉnh (lưu theo máy). */
export interface MiniCalibration {
  /** Kiểu "cửa sổ = hàng nút": tâm nút 1 / nút 1̇ — phần bề ngang cửa sổ (0 = mép trái, 1 = mép phải). */
  first: number;
  last: number;
  /** Đúng tỉ lệ thật: dời ngang cả hàng nút (px CSS, + = sang phải) so với giữa cửa sổ. */
  shift: number;
  /** Đúng tỉ lệ thật: hệ số bước cột (1 = số đo; cửa sổ nổi bị hãng thu nhỏ / máy khác tỉ lệ → chỉnh). */
  stepScale: number;
  /** Dời cả hàng nút chế độ, đơn vị bước cột (+ = sang phải). */
  modeShift: number;
  /** Giãn hàng nút chế độ quanh Ngẩng Tự Nhiên (1 = như số đo). */
  modeSpacing: number;
}

export type CalibrationField = keyof MiniCalibration;
export const CALIBRATION_FIELDS: readonly CalibrationField[] = [
  'first',
  'last',
  'shift',
  'stepScale',
  'modeShift',
  'modeSpacing',
];

export interface CalibrationRange {
  min: number;
  max: number;
  /** Độ phân giải lưu (giá trị được làm tròn theo bước này — đủ mịn cho nút − / + theo px). */
  step: number;
  /** Bước của thanh trượt (phím mũi tên ≈ 0,6 px lane ở cửa sổ ~620 px). */
  sliderStep: number;
}

/**
 * Tầm chỉnh. Nút 1 / 1̇ được ra ngoài khung một chút (cửa sổ không giãn được tới mép ngoài hàng nút — vài
 * máy chỉ có cỡ cố định); `last − first` ≥ MIN_CALIBRATION_SPAN. "Vạch · Giãn" 0,5…2 (cửa sổ nhỏ của vài hãng thu nhỏ
 * cả trang).
 */
export const CALIBRATION_RANGES: Readonly<Record<CalibrationField, CalibrationRange>> =
  Object.freeze({
    first: { min: -0.2, max: 0.35, step: 0.0001, sliderStep: 0.001 },
    last: { min: 0.65, max: 1.2, step: 0.0001, sliderStep: 0.001 },
    shift: { min: -400, max: 400, step: 0.1, sliderStep: 1 },
    stepScale: { min: 0.5, max: 2, step: 0.0001, sliderStep: 0.002 },
    modeShift: { min: -1, max: 1, step: 0.001, sliderStep: 0.01 },
    modeSpacing: { min: 0.7, max: 1.3, step: 0.001, sliderStep: 0.01 },
  });

export const MIN_CALIBRATION_SPAN = 0.3;

/** Một chạm − / + dời vạch (hoặc vòng xa nhất của hàng chế độ) chừng này px CSS. */
export const NUDGE_PX = 1;
/** Giữ nút − / + một lúc: mỗi lần lặp dời chừng này px. */
export const NUDGE_FAST_PX = 5;
/** Bề ngang dùng khi chưa đo được khung (px CSS — cỡ cửa sổ nổi điển hình đặt trên bảng nút). */
const FALLBACK_WIDTH = 600;
/** Khoảng cách (bước cột) từ Ngẩng Tự Nhiên tới nút chế độ xa nhất (Nửa Cung) — "giãn" dời nút này nhiều nhất. */
const MODE_REACH = Math.max(...GAME_MODE_COLUMNS.map((m) => Math.abs(m - GAME_MODE_COLUMNS[2])));
/** Khoảng cách (bước cột) từ tâm hàng nút tới nút ngoài cùng — "Vạch · Giãn" dời nút này nhiều nhất. */
const ROW_REACH = (LANE_COUNT - 1) / 2;

/** Mặc định = số đo ảnh game (kiểu cũ: cửa sổ đúng 8 làn, căn giữa hàng nút số — DEFAULT_LANE_FIT). */
export const DEFAULT_CALIBRATION: Readonly<MiniCalibration> = Object.freeze({
  first: DEFAULT_LANE_FIT.first,
  last: DEFAULT_LANE_FIT.last,
  shift: 0,
  stepScale: 1,
  modeShift: 0,
  modeSpacing: 1,
});

/** Nút chế độ làm tâm khi giãn hàng (Ngẩng Tự Nhiên — giữa nhóm ba nút quãng). */
const MODE_PIVOT = GAME_MODE_COLUMNS[2];

/** Làm tròn theo bước của trường (bỏ nhiễu dấu phẩy động: 0.1 + 0.2). */
function snap(field: CalibrationField, v: number): number {
  const r = CALIBRATION_RANGES[field];
  const k = Math.round((v - r.min) / r.step);
  return Number((r.min + k * r.step).toFixed(6));
}

function clampField(field: CalibrationField, v: number): number {
  const r = CALIBRATION_RANGES[field];
  return snap(field, Math.min(r.max, Math.max(r.min, v)));
}

/**
 * Chuẩn hoá giá trị bất kỳ (JSON đọc từ storage, …): trường sai / thiếu (vd. số lưu trước khi có đúng tỉ lệ thật)
 * → mặc định, kẹp tầm, nút 1̇ bên phải nút 1.
 */
export function sanitizeCalibration(v: unknown): MiniCalibration {
  const r = v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
  const pick = (field: CalibrationField): number => {
    const x = r[field];
    return typeof x === 'number' && Number.isFinite(x)
      ? clampField(field, x)
      : DEFAULT_CALIBRATION[field];
  };
  const out: MiniCalibration = {
    first: pick('first'),
    last: pick('last'),
    shift: pick('shift'),
    stepScale: pick('stepScale'),
    modeShift: pick('modeShift'),
    modeSpacing: pick('modeSpacing'),
  };
  if (out.last - out.first < MIN_CALIBRATION_SPAN - 1e-9) {
    out.first = DEFAULT_CALIBRATION.first;
    out.last = DEFAULT_CALIBRATION.last;
  }
  return out;
}

/**
 * Đặt một trường (kẹp tầm + giữ `last − first` ≥ MIN_CALIBRATION_SPAN bằng cách chặn trường đang chỉnh).
 * Trả đúng object cũ khi không có gì đổi.
 */
export function setCalibrationField(
  c: MiniCalibration,
  field: CalibrationField,
  value: number,
): MiniCalibration {
  if (!Number.isFinite(value)) return c;
  let v = clampField(field, value);
  if (field === 'first') v = Math.min(v, snap('first', c.last - MIN_CALIBRATION_SPAN));
  if (field === 'last') v = Math.max(v, snap('last', c.first + MIN_CALIBRATION_SPAN));
  if (v === c[field]) return c;
  return { ...c, [field]: v };
}

/** Bước cột (px CSS) đang dùng: đúng tỉ lệ thật = bước thật × hệ số; không thì từ nút 1 / 1̇ và bề ngang khung. */
export function stepPxOf(c: MiniCalibration, widthPx: number, scale: TrueScale | null): number {
  if (scale) return scale.step * c.stepScale;
  const w = Number.isFinite(widthPx) && widthPx > 0 ? widthPx : FALLBACK_WIDTH;
  return (Math.max(MIN_CALIBRATION_SPAN, c.last - c.first) * w) / (LANE_COUNT - 1);
}

/**
 * Đổi của `field` ứng với 1 px CSS trong khung rộng `widthPx`: Nút 1 / 1̇ = 1 / bề ngang; dời ngang = 1 px;
 * "Vạch · Giãn" = nút ngoài cùng (cách tâm hàng 3,5 bước) dời 1 px; dời hàng chế độ = 1 / bước cột; giãn = vòng xa nhất
 * (Nửa Cung) dời 1 px. Khung chưa đo được → FALLBACK_WIDTH.
 */
export function calibrationPerPx(
  c: MiniCalibration,
  field: CalibrationField,
  widthPx: number,
  scale: TrueScale | null = null,
): number {
  const w = Number.isFinite(widthPx) && widthPx > 0 ? widthPx : FALLBACK_WIDTH;
  if (field === 'first' || field === 'last') return 1 / w;
  if (field === 'shift') return 1;
  if (field === 'stepScale') {
    const base = scale ? scale.step : w / FIT_WINDOW_STEPS;
    return 1 / (ROW_REACH * base);
  }
  const step = stepPxOf(c, w, scale);
  return field === 'modeShift' ? 1 / step : 1 / (MODE_REACH * step);
}

/**
 * Nút − / + : dời `px` px CSS theo `dir` (−1 | 1) trong khung rộng `widthPx` — ít nhất một bước lưu, kẹp tầm
 * như setCalibrationField (mép tầm → trả đúng object cũ).
 */
export function nudgeCalibration(
  c: MiniCalibration,
  field: CalibrationField,
  dir: -1 | 1,
  widthPx: number,
  px: number = NUDGE_PX,
  scale: TrueScale | null = null,
): MiniCalibration {
  const r = CALIBRATION_RANGES[field];
  const size = Math.max(r.step, Math.abs(px) * calibrationPerPx(c, field, widthPx, scale));
  return setCalibrationField(c, field, c[field] + dir * size);
}

export function isDefaultCalibration(c: MiniCalibration): boolean {
  return CALIBRATION_FIELDS.every((f) => c[f] === DEFAULT_CALIBRATION[f]);
}

/**
 * Số căn chỉnh → LaneFit của renderer: 4 nút chế độ theo số đo (GAME_MODE_COLUMNS) giãn quanh Ngẩng Tự Nhiên
 * theo `modeSpacing` rồi dời `modeShift` bước cột. Có `scale` (đúng tỉ lệ thật): bước cột theo px của màn ×
 * "Vạch · Giãn", hàng nút căn giữa khung + "Vạch · Dời"; không: lane nội suy đều giữa nút 1 và nút 1̇.
 */
export function laneFitOf(c: MiniCalibration, scale: TrueScale | null = null): LaneFit {
  const modes = GAME_MODE_COLUMNS.map((m) =>
    Number((MODE_PIVOT + (m - MODE_PIVOT) * c.modeSpacing + c.modeShift).toFixed(6)),
  );
  if (!scale) return { first: c.first, last: c.last, modes };
  return {
    first: c.first,
    last: c.last,
    modes,
    stepPx: Number((scale.step * c.stepScale).toFixed(4)),
    shiftPx: c.shift,
  };
}

// ---------------------------------------------------------------------------
// Chỉ báo cỡ cửa sổ (đúng tỉ lệ thật)
// ---------------------------------------------------------------------------

/**
 * Rộng: 'narrow' hẹp hơn 8 làn; 'wide' rộng hơn cần (vẫn dùng được); 'moveLeft' / 'moveRight' = cửa sổ đủ rộng
 * nhưng hàng nút đã dời ("Vạch · Dời") ra ngoài mép trái / phải → kéo CỬA SỔ sang bên đó rồi đặt "Vạch · Dời" về 0.
 */
export type FitWidthState = 'ok' | 'narrow' | 'wide' | 'moveLeft' | 'moveRight';
export type FitHeightState = 'ok' | 'short' | 'tall';

export interface FitStatus {
  width: FitWidthState;
  height: FitHeightState;
  /** Cỡ cửa sổ đang có (px CSS; chiều cao tính cả phần của trình duyệt nếu đo được). */
  widthPx: number;
  heightPx: number;
  /**
   * Bề ngang cần = 8 làn (FIT_WINDOW_STEPS bước cột); chiều cao nên có (trang + phần trình duyệt) = mép trên màn → mép trên bảng nút trừ
   * thanh thường gặp của cửa sổ nổi (FLOAT_BAR_GUESS).
   */
  needWidth: number;
  needHeight: number;
}

/**
 * So cỡ cửa sổ với hàng nút thật.
 * - Rộng (D-415): cần FIT_WINDOW_STEPS × bước (8 làn — v1.0.1: trước đó NOTE_ROW_STEPS = hàng nút, ô ngoài cùng sát
 *   mép) — KHÔNG cộng "Vạch · Dời" (cửa sổ đúng cỡ mà lệch tâm vẫn là đúng cỡ); hẹp hơn quá WIDTH_NARROW_STEPS bước →
 *   'narrow', rộng hơn quá WIDTH_WIDE_STEPS bước → 'wide'. Không hẹp mà 8 làn đã dời ra ngoài mép quá
 *   WIDTH_NARROW_STEPS bước → 'moveLeft' / 'moveRight'.
 * - Cao (D-414): mép dưới cửa sổ nên nằm từ mép trên bảng nút (vạch mảnh, `panelTop`) tới đỉnh hàng nút chế độ
 *   (`modeTop`) — không che nút chế độ. Trang + phần trình duyệt (`chromeH`) cộng thanh của cửa sổ nổi (không đo
 *   được): cao hơn `modeTop` với thanh thường gặp (FLOAT_BAR_GUESS) → 'tall'; thấp hơn `panelTop` kể cả với thanh lớn
 *   nhất (FLOAT_BAR_MAX) → 'short'; sai số max(HEIGHT_TOL_MIN, 1 % chiều cao màn).
 */
export function fitStatusOf(
  view: { w: number; h: number },
  chromeH: number,
  scale: TrueScale,
  c: MiniCalibration,
): FitStatus {
  const step = scale.step * c.stepScale;
  const needWidth = FIT_WINDOW_STEPS * step;
  const slack = WIDTH_NARROW_STEPS * step;
  let width: FitWidthState =
    view.w < needWidth - slack
      ? 'narrow'
      : view.w > needWidth + WIDTH_WIDE_STEPS * step
        ? 'wide'
        : 'ok';
  if (width !== 'narrow') {
    const left = view.w / 2 + c.shift - needWidth / 2;
    const right = view.w / 2 + c.shift + needWidth / 2;
    if (left < -slack) width = 'moveLeft';
    else if (right > view.w + slack) width = 'moveRight';
  }
  const heightPx = view.h + (Number.isFinite(chromeH) && chromeH > 0 ? chromeH : 0);
  const tol = Math.max(HEIGHT_TOL_MIN, scale.screenH * 0.01);
  const height: FitHeightState =
    heightPx + FLOAT_BAR_GUESS > scale.modeTop + tol
      ? 'tall'
      : heightPx + FLOAT_BAR_MAX < scale.panelTop - tol
        ? 'short'
        : 'ok';
  return {
    width,
    height,
    widthPx: view.w,
    heightPx,
    needWidth,
    needHeight: scale.panelTop - FLOAT_BAR_GUESS,
  };
}

// ---------------------------------------------------------------------------
// Lưu theo máy
// ---------------------------------------------------------------------------

/** Giá trị trong phiên khi localStorage không đọc / ghi được (undefined = dùng localStorage). */
let layoutFallback: MiniLayout | undefined;
let calibrationFallback: MiniCalibration | undefined;

function isMiniLayout(v: unknown): v is MiniLayout {
  return v === 'game' || v === 'compact';
}

/** Bố cục đã chọn trên máy này; chưa chọn → `defaultMiniLayout(scheme)`. */
export function readMiniLayout(scheme: ControlScheme): MiniLayout {
  try {
    const v = localStorage.getItem(MINI_LAYOUT_STORAGE_KEY);
    if (isMiniLayout(v)) return v;
  } catch {
    // storage bị chặn → giá trị trong phiên
  }
  return layoutFallback ?? defaultMiniLayout(scheme);
}

export function writeMiniLayout(layout: MiniLayout): void {
  try {
    localStorage.setItem(MINI_LAYOUT_STORAGE_KEY, layout);
    layoutFallback = undefined;
  } catch {
    // Không lưu được — vẫn áp trong phiên này.
    layoutFallback = layout;
  }
}

/** Số căn chỉnh đã lưu (JSON hỏng / thiếu trường → mặc định cho trường đó). */
export function readCalibration(): MiniCalibration {
  try {
    const raw = localStorage.getItem(MINI_CALIBRATION_STORAGE_KEY);
    if (raw !== null) return sanitizeCalibration(JSON.parse(raw) as unknown);
  } catch {
    // JSON hỏng / storage bị chặn
  }
  return calibrationFallback ? { ...calibrationFallback } : { ...DEFAULT_CALIBRATION };
}

/**
 * Nhắc một lần cho máy đã dùng trang mini TRƯỚC v1.0.1 với số căn chỉnh mặc định (D-441): mặc định của kiểu "cửa sổ = 8
 * làn" (trang không biết cỡ màn — không có chỉ báo "Rộng") đổi từ "cửa sổ đúng mép ngoài nút 1 / nút 1̇" (0,0443 /
 * 0,9563) sang 8 làn (1/16, 15/16) — cửa sổ đặt theo cách cũ thì làn ngoài cùng lệch ~0,14 bước vào trong mà trang
 * không có gì báo. Nhận ra máy cũ: có `dfht-mini-song` (bản 1.0.0 ghi mỗi lần mở trang mini; MiniView chỉ ghi SAU lần
 * gọi này), chưa có số căn chỉnh riêng (số đã lưu giữ nguyên, không lệch), chưa có dấu MINI_FIT_NOTICE_STORAGE_KEY.
 * Máy mới / đã có số riêng → ghi dấu luôn, false. Storage bị chặn → false (không nhắc mãi).
 */
export function needsFitWindowNotice(): boolean {
  try {
    if (localStorage.getItem(MINI_FIT_NOTICE_STORAGE_KEY) !== null) return false;
    const usedBefore = localStorage.getItem(MINI_SONG_STORAGE_KEY) !== null;
    const custom = localStorage.getItem(MINI_CALIBRATION_STORAGE_KEY) !== null;
    if (usedBefore && !custom) return true;
    localStorage.setItem(MINI_FIT_NOTICE_STORAGE_KEY, '1');
  } catch {
    // storage bị chặn
  }
  return false;
}

/** Đã xem / không cần nhắc đổi cỡ cửa sổ nữa (chạm nhắc, đổi số căn chỉnh). */
export function dismissFitWindowNotice(): void {
  try {
    localStorage.setItem(MINI_FIT_NOTICE_STORAGE_KEY, '1');
  } catch {
    // storage bị chặn — nhắc biến mất trong phiên này (state của MiniView)
  }
}

/** Lưu số căn chỉnh; bằng mặc định → xóa khóa ("Đặt lại mặc định"). */
export function writeCalibration(c: MiniCalibration): void {
  const clean = sanitizeCalibration(c);
  try {
    if (isDefaultCalibration(clean)) localStorage.removeItem(MINI_CALIBRATION_STORAGE_KEY);
    else localStorage.setItem(MINI_CALIBRATION_STORAGE_KEY, JSON.stringify(clean));
    calibrationFallback = undefined;
  } catch {
    calibrationFallback = clean;
  }
}

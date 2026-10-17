/**
 * Tùy chọn nhỏ của "Cửa sổ nổi" lưu trong localStorage (mọi truy cập đều bọc try/catch — chế độ
 * ẩn danh / storage bị chặn thì dùng mặc định, không lỗi):
 * - kích thước cửa sổ lần trước (`dfht-pip-size`) KÈM màn hình lúc lưu — chỉ dùng lại trên đúng màn hình
 *   đó (bổ sung trước deploy C, D-409) và đúng khung (`framePad`, v1.0.1 — cỡ kéo cho bố cục cũ 8 làn sát mép
 *   bị bỏ qua); không có / khác màn / khác khung → **cỡ chuẩn theo màn hình**;
 * - chiều cao thanh tiêu đề của cửa sổ nổi đo được lần trước (`dfht-pip-chrome`, D-408).
 *
 * Trần cỡ của Chrome (D-418): cỡ TRONG trang tự xin có diện tích > 25 % diện tích màn hình thì Chrome thu nhỏ cả hai
 * chiều giữ tỉ lệ (màn 4:3 / 5:4) → 8 cột lệch phím. Nên xin ĐÚNG bề ngang, hạ chiều cao cho vừa trần, rồi ngay sau
 * khi mở `resizeTo` lên đủ cao (người dùng / `resizeTo` được tới 80 % màn). Sau "Đặt lại cỡ chuẩn" không đổi được cỡ,
 * lần mở sau xin `preferInitialWindowPlacement` (Chrome bỏ cỡ / chỗ đã nhớ của lần mở trước trong tab — D-419).
 *
 * Cỡ chuẩn (D-407; docs/GAME-UI-REFERENCE.md, mục "Cửa sổ nổi PC — cỡ theo màn hình"): UI game phóng theo CHIỀU
 * CAO màn hình, hệ số `k = cao px thật / 1080`. Ở 1080p 8 phím cách nhau 65 px (vùng 8 làn 520 px); v1.0.1
 * (góp ý "ô ngoài cùng không được sát viền"): cửa sổ rộng bằng KHUNG bảng phím PC của game = 8 làn + đệm
 * GAME_FRAME_PAD bước mỗi bên (≈ 553,8 px) + gutter ribbon 56 px → rộng 610; mép trên bảng phím game ở y ≈ 750 → cửa
 * sổ đặt mép dưới lên mép trên bảng phím thì cao NGOÀI 750 px là chạm mép trên màn hình. Mọi số × k (pixel thật)
 * rồi ÷ dpr (px CSS): rộng ≈ 610·k/dpr, cao ngoài = 750·k/dpr, cao trong = cao ngoài − thanh tiêu đề.
 *
 * Đếm ngược của cửa sổ nổi theo Cài đặt → Phát bài (góp ý 2026-10-16 — không còn ô đếm ngược riêng / khóa
 * `dfht-pip-delay`), tối thiểu FLOATING_MIN_COUNTDOWN_SEC (vòng R7).
 */
import {
  BASE_GUTTER,
  GAME_FRAME_PAD,
  LANE_COUNT,
  TILE_SCALE_MAX,
  TILE_SCALE_MIN,
} from '../player/layout';

export const PIP_SIZE_STORAGE_KEY = 'dfht-pip-size';
export const PIP_CHROME_STORAGE_KEY = 'dfht-pip-chrome';

/**
 * Đếm ngược tối thiểu (giây) của Cửa sổ nổi và trang mini (vòng R7): hai chỗ này dùng để bấm ▶ rồi chuyển
 * vào game, nên kể cả khi Cài đặt → Phát bài → Đếm ngược = Tắt vẫn đếm 3 giây.
 */
export const FLOATING_MIN_COUNTDOWN_SEC = 3;
/** Trần đếm ngược (giây) — như Cài đặt (`startDelaySec` 0..10). */
const FLOATING_MAX_COUNTDOWN_SEC = 10;

/**
 * Đếm ngược (giây nguyên) của Cửa sổ nổi / trang mini theo giá trị Cài đặt `startDelaySec`: tối thiểu
 * FLOATING_MIN_COUNTDOWN_SEC, tối đa 10 (Tắt → 3, 3 → 3, 5 → 5). Giá trị hỏng → tối thiểu.
 */
export function floatingCountdownSec(startDelaySec: unknown): number {
  const v =
    typeof startDelaySec === 'number' && Number.isFinite(startDelaySec)
      ? Math.round(startDelaySec)
      : 0;
  return Math.min(FLOATING_MAX_COUNTDOWN_SEC, Math.max(FLOATING_MIN_COUNTDOWN_SEC, v));
}

export interface PipSize {
  width: number;
  height: number;
}

/** Màn hình chứa cửa sổ: rộng / cao px CSS (`screen.width` / `screen.height`) + devicePixelRatio. */
export interface PipScreen {
  width: number;
  height: number;
  dpr: number;
}

/** Màn chuẩn của mọi số đo (GAME-UI-REFERENCE): cao 1080 px thật. */
export const PIP_REFERENCE_HEIGHT = 1080;
/** Vùng 8 làn ở 1080p: 8 × 65 px (bước phím game). */
export const PIP_LANES_1080 = 520;
/**
 * Khung bảng phím PC ở 1080p (v1.0.1): 8 làn + đệm GAME_FRAME_PAD bước mỗi bên = 520 × (1 + 2 × 0,26 / 8) ≈ 553,8
 * px — renderer vẽ cửa sổ nổi với `framePad: GAME_FRAME_PAD` (FloatingStage) nên 8 làn vẫn đúng 65 px.
 */
export const PIP_FRAME_1080 = PIP_LANES_1080 * (1 + (2 * GAME_FRAME_PAD) / LANE_COUNT);
/** Mép trên bảng phím game ở 1080p (= đáy source overlay khớp game, y = 750) → cao NGOÀI chuẩn. */
export const PIP_PANEL_TOP_1080 = 750;
/**
 * Thanh tiêu đề đoán trước khi đo được (px CSS; Chrome / Edge trên Windows ≈ 30–40). Đo thật ở lần mở đầu
 * (`outerHeight − innerHeight`) rồi nhớ — lần sau đúng tới từng px.
 */
export const PIP_CHROME_GUESS = 34;
/** Thanh tiêu đề đo được lớn hơn chừng này (px CSS) = số đo vô nghĩa, bỏ qua. */
export const PIP_CHROME_MAX = 120;
/** Lệch quá chừng này (px CSS) so với cỡ mong muốn thì mới chỉnh / báo. */
export const PIP_SIZE_TOLERANCE = 2;
/**
 * Chrome (`kMaxSiteRequestedWindowSizeRatio`): cỡ TRONG trang xin có diện tích quá chừng này × diện tích màn hình
 * (`display.size()`, px CSS ở zoom 100 %) thì bị thu nhỏ giữ tỉ lệ (D-418).
 */
export const PIP_REQUEST_AREA_RATIO = 0.25;
export const PIP_MIN_SIZE: Readonly<PipSize> = { width: 200, height: 160 };
export const PIP_MAX_SIDE = 4096;

const finitePositive = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v > 0;

const clampSide = (v: number, min: number): number =>
  Math.round(Math.min(PIP_MAX_SIDE, Math.max(min, v)));

function clampSize(s: PipSize): PipSize {
  return {
    width: clampSide(s.width, PIP_MIN_SIZE.width),
    height: clampSide(s.height, PIP_MIN_SIZE.height),
  };
}

/**
 * px CSS của cửa sổ ứng với 1 px "1080p" của game: `k / dpr` với `k = screenHeight × dpr / 1080` (cao px
 * thật / 1080 — UI game phóng theo chiều cao). Thiếu / hỏng → như màn 1080p ở dpr 1 (= 1).
 */
export function screenCssScale(screenHeight: number, dpr = 1): number {
  const ratio = finitePositive(dpr) ? dpr : 1;
  const physical = finitePositive(screenHeight) ? screenHeight * ratio : PIP_REFERENCE_HEIGHT;
  return physical / PIP_REFERENCE_HEIGHT / ratio;
}

/**
 * Hệ số ô (renderer `tileScale`) của cửa sổ nổi: gutter ribbon (56 px CSS × tileScale) co giãn cùng vùng
 * lane, nếu không 8 cột lệch 8 phím (vd. 1080p @125 %: vùng lane 416 px CSS, gutter phải 45 chứ không 56).
 * = k / dpr, kẹp vào khoảng renderer nhận (TILE_SCALE_MIN..MAX); 1080p @100 % = 1.
 */
export function presetTileScale(screenHeight: number, dpr = 1): number {
  return Math.min(TILE_SCALE_MAX, Math.max(TILE_SCALE_MIN, screenCssScale(screenHeight, dpr)));
}

/** Gutter ribbon (px CSS) renderer sẽ vẽ ở tileScale của preset — như `computeLayout` (làm tròn). */
function presetGutter(screenHeight: number, dpr: number): number {
  return Math.round(BASE_GUTTER * presetTileScale(screenHeight, dpr));
}

/** Cao NGOÀI chuẩn (px CSS, gồm thanh tiêu đề): mép dưới trên mép trên bảng phím → mép trên chạm mép màn. */
export function presetOuterHeight(screenHeight: number, dpr = 1): number {
  return PIP_PANEL_TOP_1080 * screenCssScale(screenHeight, dpr);
}

/**
 * Cỡ chuẩn (px CSS, phần TRONG cửa sổ — thứ `requestWindow` nhận) theo màn hình:
 * - rộng = khung bảng phím PC `553,8·k/dpr` (8 làn `520·k/dpr` — bước 65 px thật × k = bước phím game — + đệm
 *   GAME_FRAME_PAD bước mỗi bên) + gutter renderer sẽ vẽ ở `presetTileScale` → phần còn lại cho khung đúng
 *   `553,8·k/dpr` (8 làn đúng `520·k/dpr`) kể cả khi tileScale bị kẹp (768p @150 %);
 * - cao = `750·k/dpr − chrome` (chrome = thanh tiêu đề px CSS: đo được lần trước, không có thì đoán).
 * 1080p @100 % (thanh tiêu đề 34): 610 × 716; 1440p: 813 × 966; 1080p @125 % (màn báo 864 px CSS): 488 × 566.
 */
export function presetSize(screenHeight: number, dpr = 1, chrome = PIP_CHROME_GUESS): PipSize {
  const c = screenCssScale(screenHeight, dpr);
  const ratio = finitePositive(dpr) ? dpr : 1;
  const bar = Number.isFinite(chrome) ? Math.min(PIP_CHROME_MAX, Math.max(0, chrome)) : 0;
  return clampSize({
    width: Math.round(PIP_FRAME_1080 * c) + presetGutter(screenHeight, ratio),
    height: PIP_PANEL_TOP_1080 * c - bar,
  });
}

/**
 * Cỡ xin `requestWindow` cho cỡ TRONG mong muốn `size` trên màn `screen` (D-418): diện tích vượt trần 25 % của Chrome
 * → giữ ĐÚNG bề ngang (8 cột thẳng 8 phím), hạ chiều cao cho vừa trần (rồi `fitOuterHeight` / "Đặt lại cỡ chuẩn"
 * kéo cao lên). Không biết bề ngang màn → như cũ.
 */
export function capRequestSize(size: PipSize, screen: PipScreen | null): PipSize {
  if (!screen || !finitePositive(screen.width) || !finitePositive(screen.height)) return size;
  const maxArea = PIP_REQUEST_AREA_RATIO * screen.width * screen.height;
  if (size.width * size.height <= maxArea) return size;
  return {
    width: size.width,
    height: Math.max(PIP_MIN_SIZE.height, Math.floor(maxArea / size.width)),
  };
}

/** Màn hình của `win`; lỗi / thiếu chiều cao → null (rộng thiếu → 0, dpr hỏng → 1). */
export function screenOf(win: Window): PipScreen | null {
  try {
    const height = win.screen?.height;
    if (!finitePositive(height)) return null;
    const width = win.screen?.width;
    const dpr = win.devicePixelRatio;
    return {
      width: finitePositive(width) ? width : 0,
      height,
      dpr: finitePositive(dpr) ? dpr : 1,
    };
  } catch {
    return null;
  }
}

/** `presetTileScale` cho màn hình chứa cửa sổ `win` (không đọc được → như 1080p @100 %). */
export function windowTileScale(win: Window): number {
  const s = screenOf(win);
  return s ? presetTileScale(s.height, s.dpr) : 1;
}

/** Cùng một màn hình (so pixel thật + dpr — đổi % scale của Windows cũng là "khác màn"). */
export function sameScreen(a: PipScreen, b: PipScreen): boolean {
  return (
    Math.abs(a.dpr - b.dpr) < 0.01 &&
    Math.round(a.width * a.dpr) === Math.round(b.width * b.dpr) &&
    Math.round(a.height * a.dpr) === Math.round(b.height * b.dpr)
  );
}

function safeStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function readJson(storage: Storage | null, key: string): unknown {
  if (!storage) return null;
  let raw: string | null;
  try {
    raw = storage.getItem(key);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

function writeJson(storage: Storage | null, key: string, value: unknown): void {
  if (!storage) return;
  try {
    storage.setItem(key, JSON.stringify(value));
  } catch {
    // storage đầy / bị chặn: lần sau dùng cỡ chuẩn
  }
}

function parseScreen(v: unknown): PipScreen | null {
  if (v === null || typeof v !== 'object') return null;
  const { width, height, dpr } = v as Record<string, unknown>;
  if (!finitePositive(height) || !finitePositive(dpr)) return null;
  if (!(typeof width === 'number' && Number.isFinite(width) && width >= 0)) return null;
  return { width, height, dpr };
}

/**
 * Kích thước đã nhớ (đã kẹp) — CHỈ khi được lưu trên đúng màn hình `screen` VÀ cho đúng khung hiện tại
 * (`framePad` = GAME_FRAME_PAD, v1.0.1). Bản lưu cũ không ghi màn hình (trước bổ sung C), bản lưu của bố cục cũ
 * (8 làn sát mép — v1.0.0, không có `framePad`: cùng bề ngang thì 8 làn nay hẹp hơn, lệch phím), màn khác, `screen`
 * null, giá trị hỏng, storage bị chặn → null (dùng cỡ chuẩn).
 */
export function readRememberedSize(
  screen: PipScreen | null,
  storage: Storage | null = safeStorage(),
): PipSize | null {
  if (!screen) return null;
  const v = readJson(storage, PIP_SIZE_STORAGE_KEY);
  if (v === null || typeof v !== 'object') return null;
  const { width, height, screen: saved, framePad } = v as Record<string, unknown>;
  if (!finitePositive(width) || !finitePositive(height)) return null;
  if (framePad !== GAME_FRAME_PAD) return null;
  const on = parseScreen(saved);
  if (!on || !sameScreen(on, screen)) return null;
  return clampSize({ width, height });
}

/**
 * Nhớ kích thước kèm màn hình đang chứa cửa sổ + khung đang dùng (`framePad`) (bỏ qua giá trị vô nghĩa, vd. 0×0
 * lúc cửa sổ đang đóng, hoặc không đọc được màn hình — không có màn để so thì lần sau cũng không dùng được).
 */
export function rememberSize(
  size: PipSize,
  screen: PipScreen | null,
  storage: Storage | null = safeStorage(),
): void {
  if (!screen || !finitePositive(size.width) || !finitePositive(size.height)) return;
  const { width, height } = clampSize(size);
  writeJson(storage, PIP_SIZE_STORAGE_KEY, {
    width,
    height,
    screen: { width: screen.width, height: screen.height, dpr: screen.dpr },
    framePad: GAME_FRAME_PAD,
  });
}

/** Quên kích thước đã nhớ ("Đặt lại cỡ chuẩn": lần mở sau về cỡ chuẩn dù trình duyệt không cho đổi cỡ). */
export function forgetRememberedSize(storage: Storage | null = safeStorage()): void {
  if (!storage) return;
  try {
    storage.removeItem(PIP_SIZE_STORAGE_KEY);
  } catch {
    // bỏ qua
  }
}

const validChrome = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= PIP_CHROME_MAX;

/** Thanh tiêu đề (px CSS) đo được lần trước; chưa có / hỏng → null. */
export function readChromeHeight(storage: Storage | null = safeStorage()): number | null {
  const v = readJson(storage, PIP_CHROME_STORAGE_KEY);
  return validChrome(v) ? Math.round(v) : null;
}

export function rememberChromeHeight(px: number, storage: Storage | null = safeStorage()): void {
  if (!validChrome(px)) return;
  writeJson(storage, PIP_CHROME_STORAGE_KEY, Math.round(px));
}

/**
 * Thanh tiêu đề của cửa sổ `win` = `outerHeight − innerHeight` (px CSS); không đo được (outer = 0, âm, quá
 * lớn, lỗi) → null.
 */
export function measureChromeHeight(win: Window): number | null {
  try {
    const outer = win.outerHeight;
    const inner = win.innerHeight;
    if (!finitePositive(outer) || !finitePositive(inner)) return null;
    const d = outer - inner;
    return validChrome(d) ? Math.round(d) : null;
  } catch {
    return null;
  }
}

/** Cách mở cửa sổ nổi. */
export interface WindowPlan {
  /** 'standard' = cỡ chuẩn theo màn hình; 'remembered' = cỡ người dùng đã kéo trên đúng màn này. */
  kind: 'standard' | 'remembered';
  /** Cỡ TRONG muốn có (cỡ chuẩn / cỡ đã nhớ). */
  target: PipSize;
  /** Cỡ TRONG xin `requestWindow` = `target`, chiều cao hạ cho vừa trần 25 % của Chrome nếu cần (D-418). */
  size: PipSize;
  /**
   * Cao NGOÀI cần chỉnh tới ngay sau khi mở (px CSS): cỡ chuẩn luôn có (mép trên chạm mép màn); cỡ đã nhớ chỉ khi bị
   * trần hạ (= cao đã nhớ + thanh tiêu đề). null = không chỉnh gì thêm.
   */
  outerHeight: number | null;
}

/** Cỡ chuẩn cho màn hình `screen` (null → 1080p @100 %), trừ thanh tiêu đề đã đo (chưa có thì đoán). */
export function standardPlan(
  screen: PipScreen | null,
  storage: Storage | null = safeStorage(),
): WindowPlan {
  const h = screen?.height ?? PIP_REFERENCE_HEIGHT;
  const dpr = screen?.dpr ?? 1;
  const chrome = readChromeHeight(storage) ?? PIP_CHROME_GUESS;
  const target = presetSize(h, dpr, chrome);
  return {
    kind: 'standard',
    target,
    size: capRequestSize(target, screen),
    outerHeight: Math.round(presetOuterHeight(h, dpr)),
  };
}

/** Mở cửa sổ: kích thước đã nhớ trên đúng màn hình này, không có thì cỡ chuẩn theo màn hình của `win`. */
export function initialWindowPlan(
  win: Window = window,
  storage: Storage | null = safeStorage(),
): WindowPlan {
  const screen = screenOf(win);
  const remembered = readRememberedSize(screen, storage);
  if (!remembered) return standardPlan(screen, storage);
  const size = capRequestSize(remembered, screen);
  const capped = size.height < remembered.height;
  const chrome = readChromeHeight(storage) ?? PIP_CHROME_GUESS;
  return {
    kind: 'remembered',
    target: remembered,
    size,
    outerHeight: capped ? remembered.height + chrome : null,
  };
}

/** "Đặt lại cỡ chuẩn" không đổi được cỡ → lần `requestWindow` sau xin `preferInitialWindowPlacement` (D-419). */
let initialPlacementOnce = false;

/**
 * Lần mở sau (trong tab này) bỏ cỡ / chỗ Chrome đã nhớ của lần mở trước: Chrome dùng lại bounds cũ khi trang xin
 * đúng cỡ như lần trước — sau "Đặt lại cỡ chuẩn" bị từ chối thì "đóng rồi mở lại" sẽ ra lại cỡ người dùng đã kéo.
 */
export function requestInitialPlacementOnce(): void {
  initialPlacementOnce = true;
}

/** Lấy (và xóa) cờ của `requestInitialPlacementOnce`. */
export function takeInitialPlacement(): boolean {
  const v = initialPlacementOnce;
  initialPlacementOnce = false;
  return v;
}

/** Kích thước TRONG khi mở (= `initialWindowPlan(win).size`). */
export function initialWindowSize(win: Window = window): PipSize {
  return initialWindowPlan(win).size;
}

/**
 * Cửa sổ `win` đang có user activation (trình duyệt chỉ cho cửa sổ PiP tự đổi cỡ trong cú bấm). Không có
 * API `navigator.userActivation` → coi như có (cứ thử).
 */
function hasActivation(win: Window): boolean {
  try {
    const ua = (win.navigator as Navigator | undefined)?.userActivation;
    return ua ? ua.isActive : true;
  } catch {
    return false;
  }
}

/** Gọi `resizeTo` (hoặc `resizeBy`) cho cỡ NGOÀI mong muốn; false = không có API / bị từ chối / lỗi. */
function resizeOuter(win: Window, outerWidth: number, outerHeight: number): boolean {
  try {
    if (typeof win.resizeTo === 'function') {
      win.resizeTo(Math.round(outerWidth), Math.round(outerHeight));
      return true;
    }
    if (typeof win.resizeBy === 'function') {
      const ow = finitePositive(win.outerWidth) ? win.outerWidth : win.innerWidth;
      const oh = finitePositive(win.outerHeight) ? win.outerHeight : win.innerHeight;
      win.resizeBy(Math.round(outerWidth - ow), Math.round(outerHeight - oh));
      return true;
    }
  } catch {
    // trình duyệt không cho (vd. thiếu user activation)
  }
  return false;
}

export type FitResult = 'ok' | 'resized' | 'remembered' | 'unmeasured';

/** Phần viền hai bên của cửa sổ (`outerWidth − innerWidth`, px CSS); không đo được → 0. */
function sideChromeOf(win: Window): number {
  try {
    if (finitePositive(win.outerWidth) && finitePositive(win.innerWidth)) {
      return Math.max(0, win.outerWidth - win.innerWidth);
    }
  } catch {
    // bỏ qua
  }
  return 0;
}

/**
 * Ngay sau khi mở ở cỡ chuẩn (hoặc cỡ bị trần 25 % hạ — D-418): đo thanh tiêu đề thật của cửa sổ nổi, nhớ cho lần
 * mở sau; nếu cao ngoài lệch cao ngoài mong muốn (hoặc bề ngang trong lệch `innerWidth` — trình duyệt đã thu nhỏ cỡ
 * xin) quá PIP_SIZE_TOLERANCE và trình duyệt cho (còn user activation) thì `resizeTo` ngay, bề ngang = `innerWidth`
 * + viền hai bên (không có `innerWidth` → giữ bề ngang hiện tại).
 * - 'ok': đã đúng; 'resized': đã xin đổi cỡ; 'remembered': lệch nhưng không đổi được lúc này — lần mở sau
 *   dùng số đo; 'unmeasured': không đo được (vd. trình duyệt không báo outerHeight).
 */
export function fitOuterHeight(
  win: Window,
  outerHeight: number,
  storage: Storage | null = safeStorage(),
  innerWidth?: number,
): FitResult {
  const chrome = measureChromeHeight(win);
  if (chrome === null) return 'unmeasured';
  rememberChromeHeight(chrome, storage);
  const current = win.innerHeight + chrome;
  const wantWidth = finitePositive(innerWidth) ? innerWidth : null;
  const widthOff = wantWidth !== null && Math.abs(win.innerWidth - wantWidth) > PIP_SIZE_TOLERANCE;
  if (Math.abs(current - outerHeight) <= PIP_SIZE_TOLERANCE && !widthOff) return 'ok';
  if (!hasActivation(win)) return 'remembered';
  const outerWidth =
    wantWidth !== null
      ? wantWidth + sideChromeOf(win)
      : finitePositive(win.outerWidth)
        ? win.outerWidth
        : win.innerWidth;
  return resizeOuter(win, outerWidth, outerHeight) ? 'resized' : 'remembered';
}

/** Kết quả "Đặt lại cỡ chuẩn": cỡ TRONG muốn đạt + đã xin trình duyệt đổi cỡ chưa. */
export interface ResetSizeResult {
  target: PipSize;
  requested: boolean;
}

/**
 * "Đặt lại cỡ chuẩn" (gọi trong cú bấm ở CHÍNH cửa sổ nổi — trình duyệt chỉ cho đổi cỡ khi có user
 * activation): quên kích thước đã nhớ (lần mở sau về cỡ chuẩn kể cả khi đổi cỡ bị từ chối), đo thanh tiêu
 * đề hiện tại, rồi `resizeTo` cỡ ngoài chuẩn ĐỦ CAO (không bị trần 25 % lúc xin mở — `resizeTo` được tới 80 % màn)
 * theo màn hình ĐANG chứa cửa sổ nổi. Nơi gọi kiểm tra lại cỡ sau một nhịp (`target`) để báo khi trình duyệt không
 * đổi (và gọi `requestInitialPlacementOnce` — D-419).
 */
export function resetToStandardSize(
  win: Window,
  storage: Storage | null = safeStorage(),
): ResetSizeResult {
  forgetRememberedSize(storage);
  const screen = screenOf(win);
  const measured = measureChromeHeight(win);
  if (measured !== null) rememberChromeHeight(measured, storage);
  const target = standardPlan(screen, storage).target;
  const chrome = measured ?? readChromeHeight(storage) ?? PIP_CHROME_GUESS;
  const requested = resizeOuter(win, target.width + sideChromeOf(win), target.height + chrome);
  return { target, requested };
}

/** Cỡ trong hiện tại của `win` đã khớp `target` (±PIP_SIZE_TOLERANCE + 1 px làm tròn). */
export function matchesSize(win: Window, target: PipSize): boolean {
  try {
    return (
      Math.abs(win.innerWidth - target.width) <= PIP_SIZE_TOLERANCE + 1 &&
      Math.abs(win.innerHeight - target.height) <= PIP_SIZE_TOLERANCE + 1
    );
  } catch {
    return false;
  }
}

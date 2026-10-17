/**
 * Hình học khu tiles (thuần, không DOM/React) — dùng chung cho renderer và test.
 *
 * Hai trục logic:
 * - trục THỜI GIAN: dọc = y (tile rơi từ trên xuống), ngang = x (tile chạy phải → trái);
 * - trục CROSS (lane): dọc = x (lane trái → phải), ngang = y (lane trên → dưới).
 * Bố cục ngang = bố cục dọc xoay 90° theo chiều kim đồng hồ: lane Z ở trên, gutter ribbon ở dưới,
 * nhãn section ở trên cùng, hit line gần mép trái. Mọi hình chữ nhật đi qua `mapSpan`.
 *
 * Đơn vị: px CSS (renderer tự nhân devicePixelRatio bằng setTransform).
 */
import type { NoteKey } from '../core/types';
import { keyIndex } from '../core/keys';

export type Orientation = 'vertical' | 'horizontal';

/**
 * Đệm quanh vùng lane trên trục cross. 'normal' (Player): lề nhãn section bên trái (dọc) / dải nhãn
 * phía trên (ngang). 'none' (overlay "khớp game", `?layout=game`): 8 lane phủ kín tới mép source, chỉ
 * chừa gutter ribbon; hit line được đặt sát mép tới HIT_LINE_MAX_EDGE.
 * 'pad' (Player kiểu Mobile, bố cục giống màn chơi kèn — SPEC Phase 4m): 8 cột bằng nhau phủ kín bề
 * ngang, KHÔNG gutter ribbon / lề nhãn; bàn nút (`padGeometry`) nằm ở đáy canvas, hit line = đỉnh hàng
 * nút số (hitLinePos bị bỏ qua), tâm lane = tâm nút số. Chỉ áp cho hướng dọc (ngang → như 'none').
 * 'fit' (trang mini Android "Khớp nút game", góp ý 2026-10-16): cửa sổ nổi đặt NGAY TRÊN bảng nút kèn thật
 * của game — 8 lane rộng đúng một bước cột, tâm lane = tâm nút số thật theo `laneFit` (nội suy đều giữa tâm
 * nút 1 và nút 1̇, có thể tràn mép khung), không gutter / lề nhãn / bàn nút, hit line sát mép dưới
 * (hitLinePos bị bỏ qua), vòng "CHẠM" rơi trong cột của 4 nút chế độ thật và đáp sát mép dưới
 * (`fitGeometry`, `cueTargets`); `laneFit.stepPx` = đúng tỉ lệ thật (bước cột theo px của màn, hàng nút căn
 * giữa khung). Chỉ áp cho hướng dọc (ngang → như 'none').
 */
export type LanePadding = 'normal' | 'none' | 'pad' | 'fit';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface BeatRange {
  start: number;
  end: number;
}

/** Phần option của renderer ảnh hưởng tới hình học. */
export interface LayoutOptions {
  orientation: Orientation;
  /** Số beat hiện từ mép xa (nơi tile xuất hiện) tới hit line. */
  lookahead: number;
  /**
   * Vị trí hit line = phần trục thời gian tính TỪ MÉP XA (nơi tile xuất hiện).
   * 0.82 → dọc: 82% chiều cao tính từ trên; ngang: 82% tính từ phải = 18% tính từ trái.
   */
  hitLinePos: number;
  tileScale: number;
  showRibbons: boolean;
  showSectionLabels: boolean;
  /** Mặc định 'normal' (bỏ trống = như Player). */
  lanePadding?: LanePadding;
  /** `lanePadding: 'fit'`: tâm nút số / nút chế độ thật (thiếu / sai → DEFAULT_LANE_FIT). */
  laneFit?: LaneFit | null;
  /**
   * `lanePadding: 'none'`: đệm hai bên vùng 8 làn tính bằng BƯỚC CỘT (0 / bỏ trống = 8 làn phủ kín tới mép như
   * trước; GAME_FRAME_PAD = khung bảng phím PC của game — Cửa sổ nổi PC, overlay khớp game `fit=canvas`). Gutter
   * ribbon nằm SAU đệm phải. Kiểu đệm khác bỏ qua.
   */
  framePad?: number;
}

export const LANE_COUNT = 8;
/** Bề rộng gutter ribbon (trước khi nhân tileScale). */
export const BASE_GUTTER = 56;
/**
 * Khung bảng phím PC của game vượt mép ngoài 8 làn chừng này BƯỚC CỘT mỗi bên (v1.0.1, góp ý "ô ngoài cùng không
 * được sát viền"; số đo ảnh chụp bảng phím của chủ dự án — docs/GAME-UI-REFERENCE.md "Khung bảng phím PC"): mép
 * ngoài khung ở ±4,26 bước tính từ tâm nhóm 8 phím (8 làn = ±4 bước; viền trong có hoa văn ở ±4,035 bước — gần như
 * trùng mép 8 làn). Cửa sổ nổi PC + overlay khớp game rộng đúng khung đó → ô ngoài cùng cách mép ≈ 0,34 bước, như
 * keycap ngoài cùng của game cách viền trong (0,38 bước).
 */
export const GAME_FRAME_PAD = 0.26;
/** Trần của `framePad` (bước cột) — số lạ / quá lớn bị kẹp. */
export const FRAME_PAD_MAX = 1;
/** Lề trái (dọc) dành cho nhãn section. */
export const BASE_LABEL_MARGIN_VERTICAL = 16;
/** Dải trên cùng (ngang) dành cho nhãn section. */
export const BASE_LABEL_BAND_HORIZONTAL = 22;
/** Độ dài tile tối thiểu (trước khi nhân tileScale). */
export const BASE_MIN_TILE = 28;
/** Khe hở tối thiểu giữa hai tile liên tiếp cùng lane (px). */
export const TILE_GAP = 2;

export const LOOKAHEAD_MIN = 4;
export const LOOKAHEAD_MAX = 12;
export const TILE_SCALE_MIN = 0.5;
export const TILE_SCALE_MAX = 3;
export const HIT_LINE_MIN = 0.05;
export const HIT_LINE_MAX = 0.95;
/** Trần của hitLinePos khi `lanePadding: 'none'` (overlay khớp game: hit line sát đáy source). */
export const HIT_LINE_MAX_EDGE = 0.99;

/** Trần hitLinePos theo kiểu đệm lane. */
export function hitLineMaxFor(lanePadding: LanePadding | undefined): number {
  return lanePadding === 'none' || lanePadding === 'pad' || lanePadding === 'fit'
    ? HIT_LINE_MAX_EDGE
    : HIT_LINE_MAX;
}

// ---------------------------------------------------------------------------
// Bàn nút kiểu game Mobile ('pad')
// ---------------------------------------------------------------------------

/** Ø nút số / bề rộng cột (game: 8 nút tròn trải hết bề ngang — docs/GAME-UI-REFERENCE.md). */
export const PAD_DIGIT_RATIO = 0.68;
/** Ø nút chế độ / bề rộng cột. */
export const PAD_MODE_RATIO = 0.45;
/** Bề rộng tile / Ø nút số: tile "viên thuốc" hẹp hơn nút một chút, lọt giữa hai nút chế độ. */
export const PAD_TILE_RATIO = 0.86;
/**
 * Tâm 4 nút chế độ theo đơn vị cột (thứ tự game Nửa Cung · Ngẩng Lên · Ngẩng Tự Nhiên · Cúi Xuống):
 * mép cột 3|4, 4|5, 5|6, 6|7 → nhóm căn giữa giữa cột 3 và cột 7 như game, nằm trên RANH giới lane
 * nên không che tile đang rơi.
 */
export const PAD_MODE_COLUMNS: readonly number[] = [3, 4, 5, 6];
/** Nút chế độ nhỏ hơn mức này: nhãn nằm ngay dưới hình tròn thay vì bên trong. */
export const PAD_LABEL_INSIDE_MIN = 40;

/** Hình học bàn nút (px CSS). Toạ độ x tính từ mép trái canvas, y tính từ ĐỈNH bàn nút. */
export interface PadGeometry {
  /** Bề rộng (= canvas) và chiều cao của bàn nút. */
  width: number;
  height: number;
  colW: number;
  /** Tâm 8 nút số theo thứ tự Z X C V B N M , (= tâm 8 lane). */
  digitCx: number[];
  digitD: number;
  digitTop: number;
  /** Tâm 4 nút chế độ (thứ tự PAD_MODE_COLUMNS). */
  modeCx: number[];
  modeD: number;
  modeTop: number;
  /** Nhãn hai dòng nằm trong hình tròn (đủ lớn) hay ngay dưới. */
  modeLabelInside: boolean;
  /** Chiều cao dải nhãn dưới hình tròn (0 khi nhãn nằm trong). */
  modeLabelH: number;
  modeFontPx: number;
  /** Bề rộng tile viên thuốc. */
  tileW: number;
  /** Khoảng từ đáy canvas tới hit line (= đỉnh nút số). */
  hitInset: number;
}

const between = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/**
 * Ø nút chế độ theo bề rộng cột `colW` (tỉ lệ game PAD_MODE_RATIO, sàn 22 px, trần 72 px và 0.9 cột);
 * `frameH` = chiều cao khung khi có bàn nút thật (màn ngang điện thoại thấp → nút nhỏ lại).
 */
export function padModeDiameter(colW: number, frameH = Infinity): number {
  return Math.min(colW * 0.9, Math.max(22, Math.min(colW * PAD_MODE_RATIO, frameH * 0.19, 72)));
}

/**
 * Bàn nút kiểu game cho khung canvas `width × height` (px CSS). Thuần — renderer (hit line, tâm lane)
 * và MobilePad (vị trí nút) gọi cùng hàm này với cùng khung nên luôn khớp nhau. Kích thước theo tỉ lệ
 * game (PAD_DIGIT_RATIO, PAD_MODE_RATIO) nhưng có trần theo chiều cao khung (màn ngang điện thoại thấp)
 * và trần tuyệt đối (màn desktop rộng).
 */
export function padGeometry(widthCss: number, heightCss: number): PadGeometry {
  const width = Math.max(1, Number.isFinite(widthCss) ? widthCss : 1);
  const height = Math.max(1, Number.isFinite(heightCss) ? heightCss : 1);
  const colW = width / LANE_COUNT;
  const digitD = Math.min(
    colW * 0.94,
    Math.max(26, Math.min(colW * PAD_DIGIT_RATIO, height * 0.22, 112)),
  );
  const modeD = padModeDiameter(colW, height);
  const modeLabelInside = modeD >= PAD_LABEL_INSIDE_MIN;
  const modeFontPx = modeLabelInside ? Math.round(between(modeD * 0.2, 9, 14)) : colW < 44 ? 9 : 10;
  const modeLabelH = modeLabelInside ? 0 : Math.ceil(modeFontPx * 1.25 * 2) + 2;
  const modeTop = Math.round(Math.max(4, modeD * 0.12));
  const rowGap = Math.round(Math.max(4, digitD * 0.1));
  const digitTop = modeTop + modeD + modeLabelH + rowGap;
  const bottomPad = Math.round(Math.max(6, digitD * 0.14));
  const padHeight = digitTop + digitD + bottomPad;
  const digitCx: number[] = [];
  for (let i = 0; i < LANE_COUNT; i++) digitCx.push((i + 0.5) * colW);
  return {
    width,
    height: padHeight,
    colW,
    digitCx,
    digitD,
    digitTop,
    modeCx: PAD_MODE_COLUMNS.map((c) => c * colW),
    modeD,
    modeTop,
    modeLabelInside,
    modeLabelH,
    modeFontPx,
    // Hẹp hơn nút số, và lọt khe giữa hai nút chế độ (tâm ở mép cột) — trừ khi cột quá hẹp (≥ nửa cột).
    tileW: Math.min(digitD * PAD_TILE_RATIO, Math.max(colW * 0.5, colW - modeD - 2)),
    hitInset: padHeight - digitTop,
  };
}

/**
 * Đáy thấp nhất của khối nhãn tile trên trục thời gian (hướng dọc; nhãn tile dài bám đáy phần còn thấy):
 * đáy canvas; bàn nút ('pad') → hit line, hoặc ĐỈNH dải tên nút chế độ khi tên nằm dưới hình tròn
 * (`!modeLabelInside` — màn dọc hẹp: tên rộng ~2 cột vắt ngang lane 2…6 ngay trên hit line, chữ tile sẽ chui
 * dưới chữ tên nút). Tên bắt đầu dưới hình tròn 2 px (gap của .mpad-mode); chừa 3 px cho viền chữ.
 */
export function tileLabelFloor(L: Pick<Layout, 'height' | 'hitPos' | 'pad'>): number {
  const p = L.pad;
  if (!p) return L.height;
  if (p.modeLabelInside) return L.hitPos;
  return L.hitPos - (p.digitTop - p.modeTop - p.modeD) - 1;
}

// ---------------------------------------------------------------------------
// Khớp nút game Mobile ('fit') — trang mini Android
// ---------------------------------------------------------------------------
//
// Số đo bảng nút kèn mobile của game (ảnh chụp màn hình game của chủ dự án 2026-10-16, màn ngang
// 1371 × 633; docs/GAME-UI-REFERENCE.md "Bản mobile — số đo bảng nút"): 8 nút số cách đều bước ≈ 125,07 px
// (0,0912 × bề ngang màn), tâm nút 1 ở 247,5 px, hàng căn giữa màn; 4 nút chế độ ở hàng trên.

/** Ø nút số / bước cột của game (≈ 86 / 125 px). Tile của 'fit' rộng đúng chừng này. */
export const FIT_NOTE_DISC_RATIO = 0.69;
/** Ø nút chế độ / bước cột (≈ 75 / 125 px) = Ø vòng "CHẠM" của 'fit'. */
export const FIT_MODE_DISC_RATIO = 0.6;
/** Trần Ø vòng chế độ theo chiều cao khung (cửa sổ nổi thấp: vòng không chiếm quá nửa chiều cao). */
export const FIT_MODE_MAX_HEIGHT = 0.42;
/** Hit line cách mép dưới khung chừng này px (nét lõi 2 px nằm trọn trong khung). */
export const FIT_HIT_INSET = 2;
/**
 * Tâm 4 nút chế độ của game theo BƯỚC CỘT tính từ tâm nút 1, thứ tự game Nửa Cung · Ngẩng Lên · Ngẩng Tự
 * Nhiên · Cúi Xuống (= MOBILE_BUTTONS): đo 491 / 645,5 / 760 / 876 px với nút 1 ở 247,5 px, bước 125,07 px
 * → (x − 247,5) / 125,07. Ba nút quãng cách đều 0,9215 bước; Nửa Cung là nhóm riêng, cách Ngẩng Lên 1,235 bước.
 */
export const GAME_MODE_COLUMNS: readonly number[] = Object.freeze([1.947, 3.182, 4.098, 5.025]);

/** Tâm nút số / nút chế độ thật của game trong khung 'fit'. */
export interface LaneFit {
  /** Tâm nút 1 (lane Z) và nút 1̇ (lane ,) — phần bề ngang khung (0 = mép trái, 1 = mép phải). */
  first: number;
  last: number;
  /** Tâm 4 nút chế độ (thứ tự GAME_MODE_COLUMNS) theo bước cột tính từ tâm nút 1. */
  modes: readonly number[];
  /**
   * Đúng tỉ lệ thật (trang mini biết cỡ màn hình — D-405): bước cột tính bằng px CSS (= khoảng cách nút số thật
   * trên màn), hàng nút căn giữa khung rồi dời `shiftPx` px (+ = sang phải). Có `stepPx` thì `first` / `last`
   * bị bỏ qua — lane giữ đúng khoảng cách thật dù cửa sổ rộng hay hẹp. Thiếu = kiểu cũ (cửa sổ = hàng nút).
   */
  stepPx?: number;
  shiftPx?: number;
}

/**
 * Bề ngang khung "lý tưởng" của 'fit' theo bước cột (v1.0.1, góp ý "ô ngoài cùng không được sát viền"): đúng 8
 * lane — mép khung = mép ngoài lane 1 / lane 1̇, mỗi bên cách tâm nút 1 / 1̇ nửa bước. Bảng nút mobile của game KHÔNG
 * có viền trong: hai vạch khung (y 207 / 442 của ảnh 1371 × 633) chạy 202,5 → 1166 px, trùng mép ngoài nút 1 / 1̇
 * (204,5 → 1166, Ø ≈ 86) trong ±2 px — khung bằng hàng nút thì ô (rộng đúng Ø nút) sát mép. 8 bước → ô ngoài cùng
 * cách mép (1 − FIT_NOTE_DISC_RATIO) / 2 ≈ 0,155 bước = nửa khe giữa hai ô, như bàn nút 'pad' (8 cột phủ khung).
 */
export const FIT_WINDOW_STEPS = LANE_COUNT;

/**
 * Mặc định (kiểu "cửa sổ = 8 làn" khi trang không biết cỡ màn) = cửa sổ đúng FIT_WINDOW_STEPS bước, căn giữa hàng
 * nút: tâm nút 1 ở 0,5 / 8, nút 1̇ ở 7,5 / 8 bề ngang (ảnh: cửa sổ 185 → 1185,6 px, rộng 8 × 125,07). Trước
 * v1.0.1 là 0,0443 / 0,9563 = cửa sổ đúng mép ngoài hàng nút 205 → 1165 px (ô ngoài cùng chạm mép).
 */
export const DEFAULT_LANE_FIT: Readonly<LaneFit> = Object.freeze({
  // Hàng nút căn giữa cửa sổ: tâm nút 1 / 1̇ cách giữa 3,5 bước (= 1/16, 15/16 khi FIT_WINDOW_STEPS = 8).
  first: (FIT_WINDOW_STEPS / 2 - (LANE_COUNT - 1) / 2) / FIT_WINDOW_STEPS,
  last: (FIT_WINDOW_STEPS / 2 + (LANE_COUNT - 1) / 2) / FIT_WINDOW_STEPS,
  modes: GAME_MODE_COLUMNS,
});

/**
 * `v` là LaneFit dùng được: số hữu hạn, nút 1̇ bên phải nút 1, đủ 4 nút chế độ; `stepPx` (nếu có) > 0 và
 * `shiftPx` (nếu có) hữu hạn.
 */
export function isLaneFit(v: unknown): v is LaneFit {
  if (!v || typeof v !== 'object') return false;
  const r = v as Record<string, unknown>;
  const fin = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
  return (
    fin(r.first) &&
    fin(r.last) &&
    r.last - r.first > 0.01 &&
    Array.isArray(r.modes) &&
    r.modes.length === GAME_MODE_COLUMNS.length &&
    r.modes.every(fin) &&
    (r.stepPx === undefined || (fin(r.stepPx) && r.stepPx > 0)) &&
    (r.shiftPx === undefined || fin(r.shiftPx))
  );
}

/** Hai LaneFit cùng giá trị (identity khác vẫn coi là một — renderer không dựng lại layout). */
export function sameLaneFit(a: LaneFit | null, b: LaneFit | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.first === b.first &&
    a.last === b.last &&
    a.stepPx === b.stepPx &&
    a.shiftPx === b.shiftPx &&
    a.modes.length === b.modes.length &&
    a.modes.every((m, i) => m === b.modes[i])
  );
}

/** Hình học 'fit' (px CSS, x tính từ mép trái khung, y từ đỉnh). */
export interface FitGeometry {
  width: number;
  height: number;
  /** Bước cột = bề rộng lane. */
  step: number;
  /** Tâm 8 lane theo thứ tự Z X C V B N M , (= tâm 8 nút số thật). */
  laneCx: number[];
  /** Tâm 4 nút chế độ thật (thứ tự GAME_MODE_COLUMNS). */
  modeCx: number[];
  /** Ø vòng "CHẠM" / vòng đích = Ø nút chế độ của game theo bước cột (có trần theo chiều cao). */
  modeD: number;
  /** Bề rộng tile = Ø nút số của game. */
  tileW: number;
  /** Toạ độ y của hit line (sát mép dưới). */
  hitPos: number;
}

/**
 * Hình học bố cục "khớp nút game" cho khung `width × height` (px CSS). Thuần — renderer (lane, vòng) và
 * trang mini (vạch căn chỉnh, nhãn) gọi cùng hàm với cùng khung nên luôn khớp nhau. `fit.stepPx` (đúng tỉ lệ
 * thật): bước cột cố định theo px, tâm hàng nút (giữa nút 1 và nút 1̇) = giữa khung + `shiftPx`; không có →
 * lane nội suy giữa `first` / `last` theo bề ngang khung.
 */
export function fitGeometry(
  widthCss: number,
  heightCss: number,
  fit: LaneFit | null | undefined,
): FitGeometry {
  const width = Math.max(1, Number.isFinite(widthCss) ? widthCss : 1);
  const height = Math.max(1, Number.isFinite(heightCss) ? heightCss : 1);
  const f = isLaneFit(fit) ? fit : DEFAULT_LANE_FIT;
  const scaled = f.stepPx !== undefined;
  const step = scaled ? (f.stepPx as number) : ((f.last - f.first) * width) / (LANE_COUNT - 1);
  const x0 = scaled
    ? width / 2 + (f.shiftPx ?? 0) - ((LANE_COUNT - 1) / 2) * step
    : f.first * width;
  const laneCx: number[] = [];
  for (let i = 0; i < LANE_COUNT; i++) laneCx.push(x0 + i * step);
  return {
    width,
    height,
    step,
    laneCx,
    modeCx: f.modes.map((m) => x0 + m * step),
    modeD: Math.max(12, Math.min(step * FIT_MODE_DISC_RATIO, height * FIT_MODE_MAX_HEIGHT)),
    tileW: step * FIT_NOTE_DISC_RATIO,
    hitPos: Math.max(1, height - FIT_HIT_INSET),
  };
}

export interface Layout {
  orientation: Orientation;
  width: number;
  height: number;
  scale: number;
  lookahead: number;
  /** Độ dài trục thời gian (dọc: height, ngang: width). */
  timeLength: number;
  /** Độ dài trục cross (dọc: width, ngang: height). */
  crossLength: number;
  /** Toạ độ hit line trên trục thời gian (dọc: y, ngang: x). */
  hitPos: number;
  /** -1: tương lai ở phía toạ độ nhỏ (dọc: phía trên); +1: phía lớn (ngang: bên phải). */
  timeDir: -1 | 1;
  pxPerBeat: number;
  /** Số beat đã qua còn nhìn thấy phía sau hit line. */
  behindBeats: number;
  /** Đầu lane i trên trục cross; lane cùng kích thước `laneCrossSize`. */
  laneCrossStart: number[];
  laneCrossSize: number;
  /** Lane theo thứ tự Z X C V B N M , (keyIndex), toạ độ màn hình, phủ hết trục thời gian. */
  lanes: Rect[];
  /** Khung bao 8 lane. */
  laneArea: Rect;
  /** Gutter ribbon (dọc: bên phải, ngang: bên dưới); null nếu tắt ribbon. */
  gutter: Rect | null;
  /** Vùng dải ribbon trong gutter (trục cross). */
  ribbonCrossStart: number;
  ribbonCrossSize: number;
  /** Lề nhãn section (dọc: bên trái, ngang: bên trên); null nếu tắt. */
  labelBand: Rect | null;
  /** Đệm giữa tile và mép lane (trục cross). */
  laneInset: number;
  minTileLen: number;
  tileGap: number;
  /** Bàn nút kiểu game ở đáy canvas (`lanePadding: 'pad'`, hướng dọc); null ở bố cục khác. */
  pad: PadGeometry | null;
  /** Khớp nút game thật (`lanePadding: 'fit'`, hướng dọc); null ở bố cục khác. */
  fit: FitGeometry | null;
  /**
   * Đệm khung bảng phím PC (px, mỗi bên vùng 8 làn = option `framePad` × bước cột; 0 = không có). Khung = từ mép
   * đầu trục cross tới hết đệm phải (= mép trái gutter ribbon).
   */
  frameInset: number;
}

const clampNum = (v: number, min: number, max: number, fallback: number): number =>
  Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;

/** Toạ độ logic (cross, thời gian) → hình chữ nhật màn hình. t0/t1 theo thứ tự bất kỳ. */
export function mapSpan(
  layout: Layout,
  cross0: number,
  crossSize: number,
  t0: number,
  t1: number,
  out: Rect = { x: 0, y: 0, w: 0, h: 0 },
): Rect {
  const lo = t0 < t1 ? t0 : t1;
  const len = t0 < t1 ? t1 - t0 : t0 - t1;
  if (layout.orientation === 'horizontal') {
    out.x = lo;
    out.w = len;
    out.y = cross0;
    out.h = crossSize;
  } else {
    out.x = cross0;
    out.w = crossSize;
    out.y = lo;
    out.h = len;
  }
  return out;
}

export function computeLayout(widthCss: number, heightCss: number, options: LayoutOptions): Layout {
  const width = Math.max(1, Number.isFinite(widthCss) ? widthCss : 1);
  const height = Math.max(1, Number.isFinite(heightCss) ? heightCss : 1);
  const orientation: Orientation = options.orientation === 'horizontal' ? 'horizontal' : 'vertical';
  const vertical = orientation === 'vertical';
  const scale = clampNum(options.tileScale, TILE_SCALE_MIN, TILE_SCALE_MAX, 1);
  const lookahead = clampNum(options.lookahead, LOOKAHEAD_MIN, LOOKAHEAD_MAX, 6);
  // Bàn nút kiểu game chỉ có ở hướng dọc; ngang thì như 'none' (lane phủ kín, vẫn có gutter).
  const pad = options.lanePadding === 'pad' && vertical ? padGeometry(width, height) : null;
  // Khớp nút game thật (trang mini Android) cũng chỉ có ở hướng dọc; ngang → như 'none'.
  const fit =
    options.lanePadding === 'fit' && vertical ? fitGeometry(width, height, options.laneFit) : null;
  const noPadding =
    options.lanePadding === 'none' ||
    options.lanePadding === 'pad' ||
    options.lanePadding === 'fit';
  const hitFrac = pad
    ? clampNum((height - pad.hitInset) / height, HIT_LINE_MIN, HIT_LINE_MAX_EDGE, 0.82)
    : fit
      ? clampNum(fit.hitPos / height, HIT_LINE_MIN, 1, HIT_LINE_MAX_EDGE)
      : clampNum(options.hitLinePos, HIT_LINE_MIN, hitLineMaxFor(options.lanePadding), 0.82);

  const timeLength = vertical ? height : width;
  const crossLength = vertical ? width : height;

  // 'pad': chế độ hiện trên bàn nút + vòng "CHẠM" rơi xuống nút chế độ → không gutter ribbon. 'fit': lane
  // theo nút thật của game, không chừa gì.
  const gutterSize =
    options.showRibbons && !pad && !fit
      ? Math.min(Math.round(BASE_GUTTER * scale), Math.floor(crossLength * 0.3))
      : 0;
  // 'none': không lề nhãn (nhãn section, nếu bật, vẽ đè mép lane Z).
  const labelSize =
    options.showSectionLabels && !noPadding
      ? Math.min(
          Math.round((vertical ? BASE_LABEL_MARGIN_VERTICAL : BASE_LABEL_BAND_HORIZONTAL) * scale),
          Math.floor(crossLength * 0.15),
        )
      : 0;
  // 'fit': lane rộng đúng một bước cột, tâm = tâm nút số thật (có thể tràn ra ngoài mép khung).
  const areaStart = fit ? fit.laneCx[0] - fit.step / 2 : labelSize;
  const areaEnd = fit
    ? areaStart + LANE_COUNT * fit.step
    : Math.max(areaStart, crossLength - gutterSize);
  // Khung bảng phím PC ('none' + framePad, v1.0.1): phần trước gutter = 8 làn + đệm `framePad` bước mỗi bên → ô
  // ngoài cùng không sát mép; tâm 8 làn vẫn ở giữa khung.
  const padSteps =
    options.lanePadding === 'none' ? clampNum(options.framePad ?? 0, 0, FRAME_PAD_MAX, 0) : 0;
  const frameInset = (padSteps * (areaEnd - areaStart)) / (LANE_COUNT + 2 * padSteps);
  const laneStart = areaStart + frameInset;
  const laneEnd = areaEnd - frameInset;
  const laneCrossSize = (laneEnd - laneStart) / LANE_COUNT;

  // Mép xa → hit line dài `lead` px và chứa đúng `lookahead` beat.
  const lead = hitFrac * timeLength;
  const hitPos = vertical ? lead : timeLength - lead;
  const pxPerBeat = lead / lookahead;
  const behindBeats = (timeLength - lead) / pxPerBeat;
  const timeDir: -1 | 1 = vertical ? -1 : 1;

  const layout: Layout = {
    orientation,
    width,
    height,
    scale,
    lookahead,
    timeLength,
    crossLength,
    hitPos,
    timeDir,
    pxPerBeat,
    behindBeats,
    laneCrossStart: [],
    laneCrossSize,
    lanes: [],
    laneArea: { x: 0, y: 0, w: 0, h: 0 },
    gutter: null,
    ribbonCrossStart: laneEnd,
    ribbonCrossSize: 0,
    labelBand: null,
    // 'pad': tile viên thuốc rộng pad.tileW căn giữa cột (không làm tròn — tâm tile = tâm nút số).
    laneInset: pad
      ? Math.max(0, (laneCrossSize - pad.tileW) / 2)
      : fit
        ? Math.max(0, (laneCrossSize - fit.tileW) / 2)
        : Math.max(2, Math.round(laneCrossSize * 0.07)),
    minTileLen: BASE_MIN_TILE * scale,
    tileGap: TILE_GAP,
    pad,
    fit,
    frameInset,
  };

  for (let i = 0; i < LANE_COUNT; i++) {
    const c = laneStart + i * laneCrossSize;
    layout.laneCrossStart.push(c);
    layout.lanes.push(mapSpan(layout, c, laneCrossSize, 0, timeLength));
  }
  if (fit) {
    // Khung bao = phần lane còn thấy trong khung (lane ngoài cùng có thể tràn mép).
    const a0 = Math.min(crossLength, Math.max(0, laneStart));
    const a1 = Math.min(crossLength, Math.max(a0, laneEnd));
    mapSpan(layout, a0, a1 - a0, 0, timeLength, layout.laneArea);
  } else {
    mapSpan(layout, laneStart, laneEnd - laneStart, 0, timeLength, layout.laneArea);
  }

  if (gutterSize > 0) {
    // Sau đệm phải của khung (framePad = 0 → ngay sau lane cuối như trước).
    layout.gutter = mapSpan(layout, areaEnd, gutterSize, 0, timeLength);
    const inset = Math.min(Math.round(5 * scale), Math.floor(gutterSize / 4));
    layout.ribbonCrossStart = areaEnd + inset;
    layout.ribbonCrossSize = gutterSize - 2 * inset;
  }
  if (labelSize > 0) {
    layout.labelBand = mapSpan(layout, 0, labelSize, 0, timeLength);
  }
  return layout;
}

// ---------------------------------------------------------------------------
// Vòng "CHẠM" (Mobile, vòng R7): vòng trong suốt rơi xuống nút chế độ
// ---------------------------------------------------------------------------

/**
 * Vòng "CHẠM" rơi nhanh hơn tile chừng này lần (R7-1): xuất hiện muộn hơn tile cùng beat, rơi nhanh hơn,
 * và đồng tâm với nút chế độ đúng lúc phải chạm.
 */
export const CUE_RING_SPEED = 1.75;

/**
 * Thuộc tính đánh dấu lớp canvas trong suốt của bàn nút DOM (MobilePad) — renderer vẽ vòng "CHẠM" lên lớp
 * này (nằm TRÊN nút chế độ DOM, vòng đáp đè lên nút) thay vì canvas tiles (bị nút che). Cùng hộp với canvas
 * tiles, phủ đúng khung đó.
 */
export const CUE_LAYER_ATTR = 'data-cue-layer';

/**
 * Đích của vòng "CHẠM" (kiểu Mobile, renderer): 4 nút chế độ theo thứ tự PAD_MODE_COLUMNS / game
 * (Nửa Cung · Ngẩng Lên · Ngẩng Tự Nhiên · Cúi Xuống). Vòng có Ø đúng bằng nút, rơi trong cột của nút
 * nhanh gấp CUE_RING_SPEED lần tile và tâm vòng trùng tâm nút (`axis`) đúng beat phải chạm.
 */
export interface CueTargets {
  /** Tâm 4 nút chế độ trên trục cross. */
  cross: number[];
  /** Ø nút chế độ = Ø vòng "CHẠM". */
  size: number;
  /** Tâm nút chế độ trên trục thời gian — tâm vòng trùng đây đúng beat của cue. */
  axis: number;
  /**
   * true = không có nút chế độ thật ở đó (overlay OBS — R7-4, hoặc bố cục không phải 'pad') → renderer tự
   * vẽ 4 vòng chế độ mờ làm đích (Ø `size`, tâm `cross` / `axis`); false = bàn nút (MobilePad / video) vẽ
   * nút ở đúng chỗ đó.
   */
  targets: boolean;
}

/** Khe (px) giữa hit line và vòng chế độ tự vẽ của bố cục không có bàn nút. */
export const CUE_TARGET_GAP = 1;

/**
 * Bàn nút kiểu game ('pad'): tâm + Ø nút chế độ của `padGeometry` (MobilePad vẽ nút ở đúng chỗ này; bàn nút
 * nằm sát đáy canvas). `padButtons` = false (overlay OBS, R7-4: không vẽ bàn nút đầy đủ) → vẫn đúng chỗ đó
 * nhưng renderer tự vẽ 4 vòng mờ làm đích. Bố cục không có bàn nút (overlay dải ngang — mọi màn dọc kiểu
 * Mobile đều dùng 'pad'): đặt như hàng nút chế độ của game so với 8 lane — tâm ở ranh giới cột 3|4 … 6|7
 * (PAD_MODE_COLUMNS), Ø như bàn nút cùng bề rộng cột — tâm ngay sau hit line (phía đã qua, `targets`).
 * Khớp nút game thật ('fit', trang mini Android): tâm ở cột của 4 nút chế độ thật (`fitGeometry`), vòng
 * đáp SÁT TRÊN hit line ở mép dưới (nút thật nằm ngay dưới cửa sổ) — renderer vẽ 4 vòng mờ làm đích.
 */
export function cueTargets(L: Layout, padButtons = true): CueTargets {
  const p = L.pad;
  if (p) {
    return {
      cross: p.modeCx.slice(),
      size: p.modeD,
      axis: L.height - p.height + p.modeTop + p.modeD / 2,
      targets: !padButtons,
    };
  }
  const f = L.fit;
  if (f) {
    return {
      cross: f.modeCx.slice(),
      size: f.modeD,
      axis: L.hitPos + L.timeDir * (f.modeD / 2 + CUE_TARGET_GAP),
      targets: true,
    };
  }
  const c0 = L.laneCrossStart[0] ?? 0;
  const size = padModeDiameter(L.laneCrossSize);
  return {
    cross: PAD_MODE_COLUMNS.map((c) => c0 + c * L.laneCrossSize),
    size,
    axis: L.hitPos - L.timeDir * (size / 2 + CUE_TARGET_GAP),
    targets: true,
  };
}

/**
 * Tâm vòng "CHẠM" trên trục thời gian (dọc: y, ngang: x) của cue ở `cueBeat` khi bài ở `currentBeat`:
 * trùng tâm nút (`T.axis`) đúng beat của cue, đi CUE_RING_SPEED lần tốc độ tile (px / beat) — trước cue
 * thì ở phía tương lai (dọc: phía trên).
 */
export function cueRingAxis(
  T: Pick<CueTargets, 'axis'>,
  cueBeat: number,
  currentBeat: number,
  layout: Layout,
): number {
  return T.axis + layout.timeDir * (cueBeat - currentBeat) * layout.pxPerBeat * CUE_RING_SPEED;
}

/** Beat → toạ độ trên trục thời gian (dọc: y, ngang: x). */
export function beatToAxis(beat: number, currentBeat: number, layout: Layout): number {
  return layout.hitPos + layout.timeDir * (beat - currentBeat) * layout.pxPerBeat;
}

/** Ngược của beatToAxis. */
export function axisToBeat(pos: number, currentBeat: number, layout: Layout): number {
  return currentBeat + (pos - layout.hitPos) / (layout.timeDir * layout.pxPerBeat);
}

/** Khoảng beat đang thấy trên màn (từ mép đã qua tới mép xa). */
export function visibleBeatRange(currentBeat: number, layout: Layout): BeatRange {
  return { start: currentBeat - layout.behindBeats, end: currentBeat + layout.lookahead };
}

/**
 * Độ dài tile (px, trục thời gian): beats × pxPerBeat, tối thiểu minTileLen (kéo dài về phía
 * tương lai), nhưng luôn chừa ≥ tileGap px trước tile kế tiếp cùng lane (luật min nhường luật gap).
 */
export function tileLength(
  startBeat: number,
  endBeat: number,
  nextSameLaneStart: number | null,
  layout: Layout,
): number {
  let len = Math.max((endBeat - startBeat) * layout.pxPerBeat, layout.minTileLen);
  if (nextSameLaneStart !== null && Number.isFinite(nextSameLaneStart)) {
    const maxLen = (nextSameLaneStart - startBeat) * layout.pxPerBeat - layout.tileGap;
    if (len > maxLen) len = maxLen;
  }
  return len < 1 ? 1 : len;
}

/**
 * Hình chữ nhật của tile trên màn. Mép gần (dọc: đáy, ngang: trái) chạm hit line đúng lúc
 * currentBeat = startBeat.
 */
export function tileRect(
  note: { key: NoteKey; startBeat: number; endBeat: number },
  nextSameLaneStart: number | null,
  currentBeat: number,
  layout: Layout,
  out?: Rect,
): Rect {
  const len = tileLength(note.startBeat, note.endBeat, nextSameLaneStart, layout);
  const near = beatToAxis(note.startBeat, currentBeat, layout);
  const lane = Math.max(0, keyIndex(note.key));
  return mapSpan(
    layout,
    layout.laneCrossStart[lane] + layout.laneInset,
    Math.max(1, layout.laneCrossSize - 2 * layout.laneInset),
    near,
    near + layout.timeDir * len,
    out,
  );
}

/** Dải ribbon trong gutter từ run.startBeat tới run.endBeat (D-023); null nếu tắt ribbon. */
export function ribbonRect(
  run: { startBeat: number; endBeat: number },
  currentBeat: number,
  layout: Layout,
  out?: Rect,
): Rect | null {
  if (!layout.gutter) return null;
  return mapSpan(
    layout,
    layout.ribbonCrossStart,
    layout.ribbonCrossSize,
    beatToAxis(run.startBeat, currentBeat, layout),
    beatToAxis(run.endBeat, currentBeat, layout),
    out,
  );
}

/** Index đầu tiên i có sorted[i] >= value (sorted tăng dần); = length nếu không có. */
export function lowerBound(sorted: ArrayLike<number>, value: number): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (sorted[mid] < value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

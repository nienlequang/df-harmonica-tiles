/**
 * Số căn chỉnh "Khớp nút game" của trang mini (miniAlign.ts): mặc định = số đo ảnh game, kẹp tầm, nút − / +
 * theo px (D-400), dời / giãn hàng nút chế độ, nhớ theo máy (localStorage, bọc try) + "Đặt lại mặc định", bố
 * cục nhớ riêng (chưa chọn → theo kiểu điều khiển, D-402).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_LANE_FIT,
  FIT_MODE_DISC_RATIO,
  FIT_MODE_MAX_HEIGHT,
  FIT_NOTE_DISC_RATIO,
  FIT_WINDOW_STEPS,
  GAME_MODE_COLUMNS,
  fitGeometry,
} from '../player/layout';
import {
  BELOW_GAP_FAST_PX,
  BELOW_GAP_STEP_PX,
  BELOW_VISIBLE_MIN,
  CALIBRATION_FIELDS,
  CALIBRATION_RANGES,
  DEFAULT_CALIBRATION,
  FLOAT_BAR_GUESS,
  FLOAT_BAR_MAX,
  GAME_MODE_TOP_H,
  GAME_NOTE_BOTTOM_H,
  GAME_NOTE_STEP_H,
  GAME_NOTE_STEP_W,
  GAME_PANEL_TOP_H,
  GAME_REF_ASPECT,
  MINI_CALIBRATION_STORAGE_KEY,
  MINI_FIT_NOTICE_STORAGE_KEY,
  MINI_LAYOUTS,
  MINI_LAYOUT_STORAGE_KEY,
  MIN_CALIBRATION_SPAN,
  NOTE_ROW_STEPS,
  NUDGE_FAST_PX,
  belowEdgeRange,
  belowGapOf,
  belowVisibleOf,
  browserChromeHeight,
  calibrationPerPx,
  canStepBelowGap,
  defaultMiniLayout,
  dismissFitWindowNotice,
  fitStatusOf,
  isAndroidTouch,
  isDefaultCalibration,
  isFitLayout,
  laneFitOf,
  needsFitWindowNotice,
  nudgeCalibration,
  readCalibration,
  readMiniLayout,
  readScreenInfo,
  sanitizeCalibration,
  setCalibrationField,
  stepBelowGap,
  trueScaleOf,
  writeCalibration,
  writeMiniLayout,
} from './miniAlign';
import type { ScreenInfo, TrueScale } from './miniAlign';
import { MINI_SONG_STORAGE_KEY } from './miniControl';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('mặc định + LaneFit', () => {
  it('mặc định = số đo ảnh game (renderer DEFAULT_LANE_FIT); bố cục mặc định theo kiểu điều khiển', () => {
    // D-402: Mobile → khớp nút game; PC (mặc định của Cài đặt) → "Thu nhỏ" có game bar như trang mini cũ.
    expect(defaultMiniLayout('mobile')).toBe('game');
    expect(defaultMiniLayout('pc')).toBe('compact');
    expect(laneFitOf(DEFAULT_CALIBRATION)).toEqual({
      first: DEFAULT_LANE_FIT.first,
      last: DEFAULT_LANE_FIT.last,
      modes: [...GAME_MODE_COLUMNS],
    });
    expect(isDefaultCalibration({ ...DEFAULT_CALIBRATION })).toBe(true);
    expect(sanitizeCalibration(DEFAULT_CALIBRATION)).toEqual(DEFAULT_CALIBRATION);
  });

  it('dời hàng chế độ: cả 4 nút cùng dời (bước cột); giãn: quanh Ngẩng Tự Nhiên, giữ tỉ lệ nhóm', () => {
    const shifted = laneFitOf({ ...DEFAULT_CALIBRATION, modeShift: 0.25 });
    shifted.modes.forEach((m, j) => expect(m).toBeCloseTo(GAME_MODE_COLUMNS[j] + 0.25, 6));
    const wide = laneFitOf({ ...DEFAULT_CALIBRATION, modeSpacing: 1.2 });
    expect(wide.modes[2]).toBeCloseTo(GAME_MODE_COLUMNS[2], 6);
    wide.modes.forEach((m, j) =>
      expect(m - wide.modes[2]).toBeCloseTo((GAME_MODE_COLUMNS[j] - GAME_MODE_COLUMNS[2]) * 1.2, 6),
    );
  });

  it('thanh trượt Nút 1 / Nút 1̇ đổi hình học: lane nội suy đều giữa hai nút', () => {
    const c = setCalibrationField(
      setCalibrationField(DEFAULT_CALIBRATION, 'first', 0.1),
      'last',
      0.8,
    );
    const g = fitGeometry(1000, 300, laneFitOf(c));
    expect(g.laneCx[0]).toBeCloseTo(100, 6);
    expect(g.laneCx[7]).toBeCloseTo(800, 6);
    expect(g.step).toBeCloseTo(100, 6);
    // Hàng chế độ đi theo bước cột mới.
    expect(g.modeCx[0]).toBeCloseTo(100 + GAME_MODE_COLUMNS[0] * 100, 6);
  });
});

describe('kẹp / nút − +', () => {
  it('kẹp tầm, làm tròn theo bước, giữ nút 1̇ cách nút 1 ≥ MIN_CALIBRATION_SPAN', () => {
    expect(setCalibrationField(DEFAULT_CALIBRATION, 'first', -5).first).toBe(
      CALIBRATION_RANGES.first.min,
    );
    expect(setCalibrationField(DEFAULT_CALIBRATION, 'modeSpacing', 9).modeSpacing).toBe(
      CALIBRATION_RANGES.modeSpacing.max,
    );
    expect(setCalibrationField(DEFAULT_CALIBRATION, 'modeShift', 0.123456).modeShift).toBe(0.123);
    const near = setCalibrationField({ ...DEFAULT_CALIBRATION, last: 0.66 }, 'first', 0.35);
    expect(near.last - near.first).toBeGreaterThanOrEqual(MIN_CALIBRATION_SPAN - 1e-9);
    // Không đổi gì → cùng object; NaN bị bỏ qua.
    expect(setCalibrationField(DEFAULT_CALIBRATION, 'first', DEFAULT_CALIBRATION.first)).toBe(
      DEFAULT_CALIBRATION,
    );
    expect(setCalibrationField(DEFAULT_CALIBRATION, 'first', Number.NaN)).toBe(DEFAULT_CALIBRATION);
  });

  it('nút − / + đi theo px của khung (D-400): 1 px mỗi chạm, giữ = NUDGE_FAST_PX; dừng ở mép tầm', () => {
    // Cửa sổ nổi thật ~624 px: một chạm dời vạch nút 1 đúng ~1 px (trước: 0,001 bề ngang = 0,62 px).
    const W = 624;
    const px = (c: { first: number }) => c.first * W;
    const plus = nudgeCalibration(DEFAULT_CALIBRATION, 'first', 1, W);
    expect(px(plus) - px(DEFAULT_CALIBRATION)).toBeCloseTo(1, 1);
    const minus = nudgeCalibration(plus, 'first', -1, W);
    expect(px(minus)).toBeCloseTo(px(DEFAULT_CALIBRATION), 1);
    const fast = nudgeCalibration(DEFAULT_CALIBRATION, 'last', -1, W, NUDGE_FAST_PX);
    expect((DEFAULT_CALIBRATION.last - fast.last) * W).toBeCloseTo(NUDGE_FAST_PX, 1);
    // Hàng chế độ: dời 1 px = 1 / bước cột; giãn 1 px = vòng xa nhất (Nửa Cung) dời 1 px.
    const g0 = fitGeometry(W, 100, laneFitOf(DEFAULT_CALIBRATION));
    const shifted = fitGeometry(
      W,
      100,
      laneFitOf(nudgeCalibration(DEFAULT_CALIBRATION, 'modeShift', 1, W)),
    );
    shifted.modeCx.forEach((x, j) => expect(x - g0.modeCx[j]).toBeCloseTo(1, 1));
    const spread = fitGeometry(
      W,
      100,
      laneFitOf(nudgeCalibration(DEFAULT_CALIBRATION, 'modeSpacing', 1, W)),
    );
    expect(g0.modeCx[0] - spread.modeCx[0]).toBeCloseTo(1, 0); // Nửa Cung ra xa ~1 px
    expect(spread.modeCx[2]).toBeCloseTo(g0.modeCx[2], 6); // tâm giãn = Ngẩng Tự Nhiên
    expect(calibrationPerPx(DEFAULT_CALIBRATION, 'first', W)).toBeCloseTo(1 / W, 9);
    // Chưa đo được khung → bề ngang dự phòng (vẫn dời được, không NaN).
    expect(nudgeCalibration(DEFAULT_CALIBRATION, 'first', 1, 0).first).toBeGreaterThan(
      DEFAULT_CALIBRATION.first,
    );
    // Mép tầm → đúng object cũ (nút giữ dừng ở đó).
    const top = { ...DEFAULT_CALIBRATION, modeSpacing: CALIBRATION_RANGES.modeSpacing.max };
    expect(nudgeCalibration(top, 'modeSpacing', 1, W)).toBe(top);
    let c = DEFAULT_CALIBRATION;
    for (let i = 0; i < 400; i++) c = nudgeCalibration(c, 'modeShift', -1, W, NUDGE_FAST_PX);
    expect(c.modeShift).toBe(CALIBRATION_RANGES.modeShift.min);
  });

  it('edgeShift (khoảng trống đáy "Đáy ◂ ▸" của "dưới nút", D-448): px; kẹp −600…+400; thiếu → 0; lưu chung số căn chỉnh', () => {
    expect(DEFAULT_CALIBRATION.edgeShift).toBe(0);
    expect(calibrationPerPx(DEFAULT_CALIBRATION, 'edgeShift', 624)).toBe(1);
    expect(sanitizeCalibration({ ...DEFAULT_CALIBRATION, edgeShift: -999 }).edgeShift).toBe(-600);
    expect(sanitizeCalibration({ ...DEFAULT_CALIBRATION, edgeShift: 999 }).edgeShift).toBe(400);
    expect(sanitizeCalibration({ ...DEFAULT_CALIBRATION, edgeShift: 'x' }).edgeShift).toBe(0);
    expect(CALIBRATION_FIELDS).toContain('edgeShift');
    // Chỉ đổi edgeShift vẫn là số riêng (lưu vào dfht-mini-calibration).
    expect(isDefaultCalibration({ ...DEFAULT_CALIBRATION, edgeShift: -3 })).toBe(false);
    // Không ảnh hưởng hình học lane.
    expect(laneFitOf({ ...DEFAULT_CALIBRATION, edgeShift: -50 })).toEqual(
      laneFitOf(DEFAULT_CALIBRATION),
    );
  });

  it('thanh trượt: bước ≈ 0,6 px lane ở cửa sổ ~620 px (phím mũi tên chỉnh tinh)', () => {
    expect(CALIBRATION_RANGES.first.sliderStep * 624).toBeLessThan(1);
    expect(CALIBRATION_RANGES.last.sliderStep * 624).toBeLessThan(1);
  });

  it('sanitize: JSON hỏng / thiếu trường → mặc định từng trường; nút 1̇ luôn bên phải nút 1', () => {
    expect(sanitizeCalibration(null)).toEqual(DEFAULT_CALIBRATION);
    expect(sanitizeCalibration({ first: 'x', modeShift: 0.5 })).toEqual({
      ...DEFAULT_CALIBRATION,
      modeShift: 0.5,
    });
    // Đảo ngược / ngoài tầm → kẹp về tầm của từng nút (tầm không chồng nhau, cách ≥ MIN_CALIBRATION_SPAN).
    const swapped = sanitizeCalibration({ first: 0.9, last: 0.1 });
    expect(swapped.first).toBe(CALIBRATION_RANGES.first.max);
    expect(swapped.last).toBe(CALIBRATION_RANGES.last.min);
    expect(swapped.last - swapped.first).toBeGreaterThanOrEqual(MIN_CALIBRATION_SPAN - 1e-9);
  });
});

describe('lưu theo máy', () => {
  it('bố cục: chưa chọn → theo kiểu điều khiển; đã chọn → nhớ (thắng kiểu điều khiển)', () => {
    expect(readMiniLayout('mobile')).toBe('game');
    expect(readMiniLayout('pc')).toBe('compact');
    writeMiniLayout('compact');
    expect(localStorage.getItem(MINI_LAYOUT_STORAGE_KEY)).toBe('compact');
    expect(readMiniLayout('mobile')).toBe('compact');
    writeMiniLayout('game');
    expect(readMiniLayout('pc')).toBe('game');
    localStorage.setItem(MINI_LAYOUT_STORAGE_KEY, 'lạ');
    expect(readMiniLayout('mobile')).toBe('game');
    expect(readMiniLayout('pc')).toBe('compact');
    localStorage.removeItem(MINI_LAYOUT_STORAGE_KEY);
  });

  it('"dưới nút" (D-448): bố cục thứ ba, cùng khóa lưu; khớp nút = game + below; mặc định không đổi', () => {
    expect(MINI_LAYOUTS).toEqual(['game', 'below', 'compact']);
    writeMiniLayout('below');
    expect(localStorage.getItem(MINI_LAYOUT_STORAGE_KEY)).toBe('below');
    expect(readMiniLayout('mobile')).toBe('below');
    expect(readMiniLayout('pc')).toBe('below');
    localStorage.removeItem(MINI_LAYOUT_STORAGE_KEY);
    expect(readMiniLayout('mobile')).toBe('game');
    expect(readMiniLayout('pc')).toBe('compact');
    expect(isFitLayout('game')).toBe(true);
    expect(isFitLayout('below')).toBe(true);
    expect(isFitLayout('compact')).toBe(false);
  });

  it('số căn chỉnh: ghi / đọc lại; bằng mặc định ("Đặt lại mặc định") → xóa khóa', () => {
    expect(readCalibration()).toEqual(DEFAULT_CALIBRATION);
    const c = {
      first: 0.06,
      last: 0.94,
      shift: -12.5,
      stepScale: 1.04,
      modeShift: -0.1,
      modeSpacing: 1.05,
      edgeShift: -8,
    };
    writeCalibration(c);
    expect(JSON.parse(localStorage.getItem(MINI_CALIBRATION_STORAGE_KEY) ?? '{}')).toEqual(c);
    expect(readCalibration()).toEqual(c);
    // Số lưu trước khi có đúng tỉ lệ thật (thiếu shift / stepScale) / trước "dưới nút" (thiếu edgeShift — D-448)
    // vẫn đọc được — trường thiếu = mặc định.
    localStorage.setItem(
      MINI_CALIBRATION_STORAGE_KEY,
      JSON.stringify({ first: 0.06, last: 0.94, modeShift: -0.1, modeSpacing: 1.05 }),
    );
    expect(readCalibration()).toEqual({ ...c, shift: 0, stepScale: 1, edgeShift: 0 });
    writeCalibration({ ...DEFAULT_CALIBRATION });
    expect(localStorage.getItem(MINI_CALIBRATION_STORAGE_KEY)).toBeNull();
    expect(readCalibration()).toEqual(DEFAULT_CALIBRATION);
    localStorage.setItem(MINI_CALIBRATION_STORAGE_KEY, '{hỏng');
    expect(readCalibration()).toEqual(DEFAULT_CALIBRATION);
  });

  it('localStorage bị chặn: không ném lỗi, nhớ trong phiên', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(readMiniLayout('mobile')).toBe('game');
    writeMiniLayout('compact');
    expect(readMiniLayout('mobile')).toBe('compact');
    const c = { ...DEFAULT_CALIBRATION, modeShift: 0.3 };
    writeCalibration(c);
    expect(readCalibration()).toEqual(c);
    writeCalibration({ ...DEFAULT_CALIBRATION });
    expect(readCalibration()).toEqual(DEFAULT_CALIBRATION);
    // Dọn giá trị trong phiên cho test sau.
    vi.restoreAllMocks();
    writeMiniLayout('game');
    localStorage.removeItem(MINI_LAYOUT_STORAGE_KEY);
    writeCalibration({ ...DEFAULT_CALIBRATION });
  });
});

describe('nhắc đổi cỡ cửa sổ cho máy dùng trang mini trước v1.0.1 (D-441)', () => {
  it('máy cũ (có bài mở lần trước, số căn chỉnh mặc định, chưa có dấu) → nhắc; chưa tự ghi dấu', () => {
    localStorage.setItem(MINI_SONG_STORAGE_KEY, 'seed-quoc-ca-viet-nam');
    expect(needsFitWindowNotice()).toBe(true);
    expect(needsFitWindowNotice()).toBe(true);
    expect(localStorage.getItem(MINI_FIT_NOTICE_STORAGE_KEY)).toBeNull();
    dismissFitWindowNotice();
    expect(localStorage.getItem(MINI_FIT_NOTICE_STORAGE_KEY)).toBe('1');
    expect(needsFitWindowNotice()).toBe(false);
  });

  it('máy mới (chưa có khóa trang mini) → không nhắc, ghi dấu ngay (lần sau đã có bài mở vẫn không nhắc)', () => {
    // Bố cục đã chọn (e2e / người dùng chọn trước khi mở) không phải dấu của bản cũ.
    localStorage.setItem(MINI_LAYOUT_STORAGE_KEY, 'game');
    expect(needsFitWindowNotice()).toBe(false);
    expect(localStorage.getItem(MINI_FIT_NOTICE_STORAGE_KEY)).toBe('1');
    localStorage.setItem(MINI_SONG_STORAGE_KEY, 'seed-quoc-ca-viet-nam');
    expect(needsFitWindowNotice()).toBe(false);
  });

  it('máy cũ có số căn chỉnh riêng (giữ nguyên — không lệch) → không nhắc, ghi dấu', () => {
    localStorage.setItem(MINI_SONG_STORAGE_KEY, 'seed-quoc-ca-viet-nam');
    writeCalibration({ ...DEFAULT_CALIBRATION, first: 0.0443, last: 0.9563 });
    expect(needsFitWindowNotice()).toBe(false);
    expect(localStorage.getItem(MINI_FIT_NOTICE_STORAGE_KEY)).toBe('1');
  });

  it('localStorage bị chặn → không nhắc, không ném', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(needsFitWindowNotice()).toBe(false);
    expect(() => dismissFitWindowNotice()).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Đúng tỉ lệ thật (D-405, D-412 … D-415): bước cột theo cỡ màn hình, chỉ báo cỡ cửa sổ
// ---------------------------------------------------------------------------

/** Số đo ảnh game (px của ảnh 1371 × 633): tâm 8 nút số, 4 nút chế độ. */
const REF_W = 1371;
const REF_H = 633;
const NOTE_X = [247.5, 372, 497, 622, 747.5, 872.5, 998, 1123];
const MODE_X = [491, 645.5, 760, 876];

const scr = (width: number, height: number, landscape: boolean | null = null): ScreenInfo => ({
  width,
  height,
  landscape,
});

/** Máy Android cảm ứng (nơi duy nhất trang tin cỡ màn — D-412). */
const ANDROID = true;

/**
 * Mô hình D-413: UI game = ảnh 1371 × 633 phóng vừa màn (cùng một hệ số cho hai chiều): theo chiều cao ở màn ≥ 19,5:9,
 * theo bề ngang ở màn hẹp hơn; hàng nút căn giữa màn, bảng nút bám đáy màn.
 */
function model(sw: number, sh: number) {
  const u = Math.min(sh / REF_H, sw / REF_W);
  return {
    u,
    step: 125.035 * u,
    x: (refX: number) => sw / 2 + (refX - REF_W / 2) * u,
    panelTop: sh - (REF_H - 207) * u,
    modeTop: sh - (REF_H - 228.5) * u,
  };
}

describe('đúng tỉ lệ thật: cỡ màn hình → bước cột', () => {
  it.each([
    [915, 412, 640, 200],
    [915, 412, 700, 220],
    [800, 360, 560, 180],
    [840, 360, 580, 150],
    [780, 360, 546, 94],
  ] as const)(
    'màn %d×%d, cửa sổ %d×%d: bước theo CHIỀU CAO màn (≥ 19,5:9 — D-413), không theo cửa sổ; hàng nút căn giữa',
    (sw, sh, w, h) => {
      const scale = trueScaleOf(scr(sw, sh), w, ANDROID);
      expect(scale).not.toBeNull();
      const m = model(sw, sh);
      expect(scale!.refH).toBeCloseTo(sh, 9);
      expect(scale!.step).toBeCloseTo(GAME_NOTE_STEP_H * sh, 9);
      expect(scale!.step).toBeCloseTo(m.step, 2);
      expect(scale!.panelTop).toBeCloseTo(GAME_PANEL_TOP_H * sh, 6);
      expect(scale!.modeTop).toBeCloseTo(GAME_MODE_TOP_H * sh, 6);
      const g = fitGeometry(w, h, laneFitOf(DEFAULT_CALIBRATION, scale));
      expect(g.step).toBeCloseTo(m.step, 2);
      g.laneCx.forEach((x, i) => expect(x).toBeCloseTo(w / 2 + (i - 3.5) * g.step, 3));
      // Vòng "CHẠM" ở cột nút chế độ thật (bước cột từ tâm nút 1), Ø theo bước cột (trần theo chiều cao).
      g.modeCx.forEach((x, j) =>
        expect(x).toBeCloseTo(g.laneCx[0] + GAME_MODE_COLUMNS[j] * g.step, 3),
      );
      expect(g.modeD).toBeCloseTo(
        Math.min(g.step * FIT_MODE_DISC_RATIO, h * FIT_MODE_MAX_HEIGHT),
        6,
      );
      expect(g.tileW).toBeCloseTo(g.step * FIT_NOTE_DISC_RATIO, 6);
      // Cửa sổ rộng / hẹp hơn: khoảng cách lane không đổi.
      for (const dw of [-60, 100]) {
        const other = fitGeometry(
          w + dw,
          h,
          laneFitOf(DEFAULT_CALIBRATION, trueScaleOf(scr(sw, sh), w + dw, ANDROID)),
        );
        expect(other.step).toBeCloseTo(g.step, 9);
        expect(other.laneCx[1] - other.laneCx[0]).toBeCloseTo(g.laneCx[1] - g.laneCx[0], 9);
      }
    },
  );

  it('một đơn vị cho cả hai chiều (D-413): 20:9 / 21:9 theo chiều cao, 16:9 / máy tính bảng theo bề ngang', () => {
    // 20:9 và 21:9 cùng cao 360 → cùng bước (UI theo chiều cao), KHÔNG phải 0,0912 × bề ngang.
    const a = trueScaleOf(scr(800, 360), 560, ANDROID)!;
    const b = trueScaleOf(scr(840, 360), 600, ANDROID)!;
    expect(a.step).toBeCloseTo(b.step, 9);
    expect(a.step).toBeCloseTo(71.1, 1);
    expect(GAME_NOTE_STEP_W * 840 - b.step).toBeGreaterThan(5); // mô hình cũ lệch ~5,5 px / bước ở 21:9
    expect(a.panelTop).toBeCloseTo(0.327 * 360, 6);
    // 16:9 (640 × 360): theo bề ngang → hàng nút vẫn = 0,70 × bề ngang (nằm trọn trong màn), bảng nút bám đáy.
    const c = trueScaleOf(scr(640, 360), 450, ANDROID)!;
    const m = model(640, 360);
    expect(c.refH).toBeCloseTo(640 / GAME_REF_ASPECT, 9);
    expect(c.step).toBeCloseTo(GAME_NOTE_STEP_W * 640, 9);
    expect(c.step).toBeCloseTo(m.step, 2);
    expect(NOTE_ROW_STEPS * c.step).toBeLessThan(640 * 0.71);
    expect(c.panelTop).toBeCloseTo(m.panelTop, 1);
    expect(c.modeTop).toBeCloseTo(m.modeTop, 1);
    expect(c.panelTop).toBeGreaterThan(0.327 * 360); // khoảng trống thừa ở trên, không ở dưới
    // Máy tính bảng 4:3 ngang (1024 × 768): hàng nút không bao giờ rộng hơn màn.
    const d = trueScaleOf(scr(1024, 768), 700, ANDROID)!;
    expect(NOTE_ROW_STEPS * d.step).toBeLessThan(1024 * 0.71);
  });

  it.each([960, 1000, 900])(
    'màn = ảnh game 1371 px, cửa sổ %d px căn giữa màn: vạch / vòng trùng tâm nút thật (±1,5 px)',
    (w) => {
      const scale = trueScaleOf(scr(REF_W, REF_H), w, ANDROID)!;
      expect(scale.refH).toBe(REF_H);
      expect(scale.step).toBeCloseTo(GAME_NOTE_STEP_W * REF_W, 9);
      const g = fitGeometry(w, 200, laneFitOf(DEFAULT_CALIBRATION, scale));
      const left = (REF_W - w) / 2; // mép trái cửa sổ trên màn
      g.laneCx.forEach((x, i) =>
        expect(Math.abs(x + left - NOTE_X[i]), 'nút ' + String(i + 1)).toBeLessThan(1.5),
      );
      g.modeCx.forEach((x, j) =>
        expect(Math.abs(x + left - MODE_X[j]), 'chế độ ' + String(j)).toBeLessThan(1.5),
      );
    },
  );

  it.each([
    [915, 412, 640],
    [800, 360, 560],
    [640, 360, 450],
  ] as const)(
    'màn %d×%d (mô hình D-413): vạch trùng tâm nút ở vị trí mô hình khi cửa sổ %d px căn giữa',
    (sw, sh, w) => {
      const m = model(sw, sh);
      const g = fitGeometry(
        w,
        120,
        laneFitOf(DEFAULT_CALIBRATION, trueScaleOf(scr(sw, sh), w, ANDROID)),
      );
      const left = (sw - w) / 2;
      g.laneCx.forEach((x, i) =>
        expect(Math.abs(x + left - m.x(NOTE_X[i]))).toBeLessThan(1.5 * m.u),
      );
      g.modeCx.forEach((x, j) =>
        expect(Math.abs(x + left - m.x(MODE_X[j]))).toBeLessThan(1.5 * m.u),
      );
    },
  );

  it('màn không dùng được → null (kiểu "cửa sổ = hàng nút"): ≈ bề ngang cửa sổ, dọc, 0, NaN, không có', () => {
    expect(trueScaleOf(null, 640, ANDROID)).toBeNull();
    expect(trueScaleOf(scr(0, 0), 640, ANDROID)).toBeNull();
    expect(trueScaleOf(scr(Number.NaN, 412), 640, ANDROID)).toBeNull();
    expect(trueScaleOf(scr(960, 300), 960, ANDROID)).toBeNull(); // trang chiếm cả màn (không phải cửa sổ nổi)
    expect(trueScaleOf(scr(1000, 400), 960, ANDROID)).toBeNull(); // 960 > 0,95 × 1000
    expect(trueScaleOf(scr(412, 915), 300, ANDROID)).toBeNull(); // màn dọc
    expect(trueScaleOf(scr(915, 412, false), 300, ANDROID)).toBeNull(); // orientation nói dọc
    expect(trueScaleOf(scr(915, 412), 0, ANDROID)).toBeNull(); // chưa đo được cửa sổ
    // Trình duyệt luôn trả cỡ dọc nhưng orientation nói ngang → cạnh dài là bề ngang.
    expect(trueScaleOf(scr(412, 915, true), 640, ANDROID)).toEqual(
      trueScaleOf(scr(915, 412), 640, ANDROID),
    );
  });

  it('không phải máy Android cảm ứng → null (D-412): cửa sổ trình duyệt máy tính, iPhone ngang', () => {
    // Máy tính: cửa sổ 1280 × 720 không phóng to trên màn 1920 × 1080 (trước đây: lane 175 px, chỉ báo vô nghĩa).
    expect(trueScaleOf(scr(1920, 1080), 1280, false)).toBeNull();
    expect(trueScaleOf(scr(1920, 1080), 1600, false)).toBeNull();
    // iPhone ngang: Safari thụt lề vùng tai thỏ (trang ≈ 0,89 × màn) — trang mini chỉ là chỗ mở Video nổi.
    expect(trueScaleOf(scr(812, 375), 724, false)).toBeNull();
    // Cùng số mà là Android cảm ứng thì dùng được.
    expect(trueScaleOf(scr(1920, 1080), 1280, true)).not.toBeNull();
  });

  it('isAndroidTouch: UA / userAgentData Android + cảm ứng; máy tính, iPhone, lỗi → false', () => {
    const win = (ua: string, touch: number, platform?: string, coarse = false) =>
      ({
        navigator: {
          userAgent: ua,
          maxTouchPoints: touch,
          ...(platform ? { userAgentData: { platform } } : {}),
        },
        matchMedia: (q: string) => ({ matches: coarse && q.includes('coarse') }),
      }) as unknown as Window;
    const ANDROID_UA =
      'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36';
    const DESKTOP_UA =
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
    const IPHONE_UA =
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
    expect(isAndroidTouch(win(ANDROID_UA, 5))).toBe(true);
    expect(isAndroidTouch(win(ANDROID_UA, 0, undefined, true))).toBe(true);
    expect(isAndroidTouch(win(DESKTOP_UA, 0, 'Android', true))).toBe(true); // UA giảm, client hints còn Android
    expect(isAndroidTouch(win(ANDROID_UA, 0))).toBe(false); // không cảm ứng
    expect(isAndroidTouch(win(DESKTOP_UA, 10, 'Windows', true))).toBe(false); // laptop cảm ứng
    expect(isAndroidTouch(win(IPHONE_UA, 5))).toBe(false);
    expect(isAndroidTouch(undefined)).toBe(false);
    const broken = {
      get navigator(): Navigator {
        throw new Error('blocked');
      },
    } as unknown as Window;
    expect(isAndroidTouch(broken)).toBe(false);
    expect(isAndroidTouch()).toBe(false); // jsdom
  });

  it('fallback "cửa sổ = hàng nút" (960×300, 720×240): như trước — lane trải theo bề ngang cửa sổ', () => {
    for (const [w, h] of [
      [960, 300],
      [720, 240],
    ] as const) {
      const fit = laneFitOf(DEFAULT_CALIBRATION, trueScaleOf(scr(w, h), w, ANDROID));
      expect(fit).toEqual({
        first: DEFAULT_LANE_FIT.first,
        last: DEFAULT_LANE_FIT.last,
        modes: [...GAME_MODE_COLUMNS],
      });
      const g = fitGeometry(w, h, fit);
      expect(g.laneCx[0]).toBeCloseTo(DEFAULT_LANE_FIT.first * w, 9);
      expect(g.laneCx[7]).toBeCloseTo(DEFAULT_LANE_FIT.last * w, 9);
    }
  });

  it('chỉnh tinh: "Vạch · Dời" dời cả hàng theo px, "Vạch · Giãn" giãn quanh tâm hàng; nút − / + = 1 px', () => {
    const scale = trueScaleOf(scr(915, 412), 640, ANDROID) as TrueScale;
    const W = 640;
    const geo = (c: typeof DEFAULT_CALIBRATION) => fitGeometry(W, 105, laneFitOf(c, scale));
    const g0 = geo(DEFAULT_CALIBRATION);
    const moved = setCalibrationField(DEFAULT_CALIBRATION, 'shift', 12);
    const g1 = geo(moved);
    g1.laneCx.forEach((x, i) => expect(x - g0.laneCx[i]).toBeCloseTo(12, 6));
    g1.modeCx.forEach((x, j) => expect(x - g0.modeCx[j]).toBeCloseTo(12, 6));
    const g2 = geo(setCalibrationField(DEFAULT_CALIBRATION, 'stepScale', 1.1));
    expect(g2.step).toBeCloseTo(g0.step * 1.1, 3);
    expect((g2.laneCx[0] + g2.laneCx[7]) / 2).toBeCloseTo(W / 2, 6);
    // − / +: "Vạch · Dời" 1 px; "Vạch · Giãn" → nút ngoài cùng dời ~1 px; dời hàng chế độ theo px.
    const n1 = geo(nudgeCalibration(DEFAULT_CALIBRATION, 'shift', 1, W, 1, scale));
    expect(n1.laneCx[0] - g0.laneCx[0]).toBeCloseTo(1, 6);
    const n2 = geo(nudgeCalibration(DEFAULT_CALIBRATION, 'stepScale', 1, W, 1, scale));
    expect(n2.laneCx[7] - g0.laneCx[7]).toBeCloseTo(1, 0);
    expect(g0.laneCx[0] - n2.laneCx[0]).toBeCloseTo(1, 0);
    const n3 = geo(nudgeCalibration(DEFAULT_CALIBRATION, 'modeShift', -1, W, NUDGE_FAST_PX, scale));
    n3.modeCx.forEach((x, j) => expect(g0.modeCx[j] - x).toBeCloseTo(NUDGE_FAST_PX, 1));
    expect(calibrationPerPx(DEFAULT_CALIBRATION, 'shift', W, scale)).toBe(1);
    // Tầm: "Vạch · Dời" ±400 px, "Vạch · Giãn" 0,5…2.
    expect(setCalibrationField(DEFAULT_CALIBRATION, 'shift', 9999).shift).toBe(
      CALIBRATION_RANGES.shift.max,
    );
    expect(setCalibrationField(DEFAULT_CALIBRATION, 'stepScale', 0).stepScale).toBe(
      CALIBRATION_RANGES.stepScale.min,
    );
    // Không có scale → LaneFit kiểu cũ (không stepPx): số chỉnh tinh của kiểu thật không ảnh hưởng.
    expect(laneFitOf(moved)).toEqual(laneFitOf(DEFAULT_CALIBRATION));
    expect(isDefaultCalibration(moved)).toBe(false);
  });
});

describe('chỉ báo cỡ cửa sổ', () => {
  const scale = trueScaleOf(scr(915, 412), 640, ANDROID) as TrueScale;
  const step = GAME_NOTE_STEP_H * 412; // ≈ 81,4 px
  const needW = FIT_WINDOW_STEPS * step; // ≈ 651 px (8 làn)
  const tol = 4.12; // max(4, 1 % × 412)

  it('bề ngang cần = 8 làn (v1.0.1 — ô ngoài cùng cách mép ~0,155 bước); vừa / hẹp quá / rộng hơn cần thiết', () => {
    expect(needW / (412 * GAME_REF_ASPECT)).toBeCloseTo(0.73, 2); // = 8 × 0,0912 bề ngang màn ảnh game
    const st = (w: number, c = DEFAULT_CALIBRATION) =>
      fitStatusOf({ w, h: 105 }, 0, scale, c).width;
    expect(st(651)).toBe('ok');
    expect(st(642)).toBe('ok');
    expect(st(690)).toBe('ok');
    // Cửa sổ đúng hàng nút (cần cũ ≈ 626 px: ô ngoài cùng chạm mép) → giờ là "hẹp quá".
    expect(st(Math.ceil(NOTE_ROW_STEPS * step))).toBe('narrow');
    expect(st(Math.floor(needW - 0.15 * step) - 1)).toBe('narrow');
    expect(st(590)).toBe('narrow');
    expect(st(710)).toBe('wide');
    expect(st(Math.ceil(needW + 0.6 * step) + 1)).toBe('wide');
    // "Vạch · Giãn" lớn hơn → hàng nút rộng hơn.
    expect(st(640, { ...DEFAULT_CALIBRATION, stepScale: 1.2 })).toBe('narrow');
    const s = fitStatusOf({ w: 640, h: 105 }, 0, scale, DEFAULT_CALIBRATION);
    expect(s.widthPx).toBe(640);
    expect(s.heightPx).toBe(105);
    expect(s.needWidth).toBeCloseTo(needW, 6);
    expect(s.needHeight).toBeCloseTo(GAME_PANEL_TOP_H * 412 - FLOAT_BAR_GUESS, 6);
  });

  it('lệch tâm ("Vạch · Dời") không làm cửa sổ đúng cỡ thành "hẹp quá" (D-415): chỉ khi hàng ra ngoài mép → kéo cửa sổ', () => {
    // Review: màn = ảnh game (1371 × 633), cửa sổ đúng cỡ (cần ≈ 1000,6 px — 8 làn): "Ngang" 10 px từng thành "hẹp
    // quá".
    const ref = trueScaleOf(scr(REF_W, REF_H), 1000, ANDROID) as TrueScale;
    const at = (shift: number) =>
      fitStatusOf({ w: 1000, h: 180 }, 0, ref, { ...DEFAULT_CALIBRATION, shift }).width;
    for (const s of [-15, -10, -8, 0, 8, 10, 15]) expect(at(s), `dời ${s}`).toBe('ok');
    // Dời ra ngoài mép quá 0,15 bước (≈ 19 px) → kéo CỬA SỔ sang bên đó (rồi đặt về 0), không phải kéo giãn.
    expect(at(25)).toBe('moveRight');
    expect(at(-25)).toBe('moveLeft');
    const st = (w: number, shift: number) =>
      fitStatusOf({ w, h: 105 }, 0, scale, { ...DEFAULT_CALIBRATION, shift }).width;
    // Cửa sổ rộng hơn: hàng dời trong phần thừa vẫn ổn ('wide'); ra ngoài mép thì báo lệch.
    expect(st(710, 30)).toBe('wide');
    expect(st(710, 80)).toBe('moveRight');
    // Hẹp quá vẫn là "hẹp quá" (kéo giãn trước).
    expect(st(590, 60)).toBe('narrow');
  });

  it('chiều cao (D-414): mép dưới từ mép trên khung kèn tới đỉnh hàng nút chế độ, trừ hao thanh của cửa sổ nổi', () => {
    const panelTop = GAME_PANEL_TOP_H * 412; // ≈ 134,7
    const modeTop = GAME_MODE_TOP_H * 412; // ≈ 148,7
    const st = (h: number, chrome = 0) =>
      fitStatusOf({ w: 640, h }, chrome, scale, DEFAULT_CALIBRATION).height;
    // Thanh thường gặp (~24 px): mép dưới ở mép trên khung kèn → vừa; tới đỉnh nút chế độ → vẫn vừa.
    expect(st(Math.round(panelTop - FLOAT_BAR_GUESS))).toBe('ok');
    expect(st(Math.floor(modeTop - FLOAT_BAR_GUESS))).toBe('ok');
    // Thanh 24 px mà mép dưới đã che nút chế độ (trước đây vẫn "vừa").
    expect(st(Math.ceil(modeTop - FLOAT_BAR_GUESS + tol) + 1)).toBe('tall');
    expect(st(138)).toBe('tall'); // 641 × 138 của review: mép dưới ở 162 > đỉnh nút chế độ 149
    expect(st(220)).toBe('tall');
    // Thấp: kể cả với thanh lớn nhất vẫn chưa tới khung kèn.
    expect(st(Math.ceil(panelTop - FLOAT_BAR_MAX - tol))).toBe('ok');
    expect(st(Math.floor(panelTop - FLOAT_BAR_MAX - tol) - 1)).toBe('short');
    expect(st(80)).toBe('short');
    // Thanh địa chỉ của trình duyệt (đo được) tính vào cửa sổ.
    expect(st(50, 56)).toBe('ok');
    expect(st(80, 56)).toBe('tall');
    // Màn 780 × 360 (review: 546 × 121, thanh 24 → mép dưới 145 > đỉnh nút chế độ 130): "cao quá".
    const s2 = trueScaleOf(scr(780, 360), 546, ANDROID) as TrueScale;
    expect(fitStatusOf({ w: 546, h: 121 }, 0, s2, DEFAULT_CALIBRATION).height).toBe('tall');
    const a = fitStatusOf({ w: 569, h: 94 }, 0, s2, DEFAULT_CALIBRATION); // 8 làn ≈ 569 px
    expect([a.width, a.height]).toEqual(['ok', 'ok']);
    // Màn = ảnh game (633 cao): 960 × 300 che khung kèn, 960 × 200 vừa (e2e predeploy).
    const s3 = trueScaleOf(scr(REF_W, REF_H), 960, ANDROID) as TrueScale;
    expect(fitStatusOf({ w: 960, h: 300 }, 0, s3, DEFAULT_CALIBRATION).height).toBe('tall');
    expect(fitStatusOf({ w: 960, h: 200 }, 0, s3, DEFAULT_CALIBRATION).height).toBe('ok');
    expect(fitStatusOf({ w: 960, h: 183 }, 0, s3, DEFAULT_CALIBRATION).height).toBe('ok');
  });

  it('phần trình duyệt = outerHeight − innerHeight chỉ khi hợp lý', () => {
    expect(browserChromeHeight(80, 136, 412)).toBe(56);
    expect(browserChromeHeight(105, 105, 412)).toBe(0);
    expect(browserChromeHeight(105, 412, 412)).toBe(0); // outerHeight = cả màn → bỏ
    expect(browserChromeHeight(105, Number.NaN, 412)).toBe(0);
    expect(browserChromeHeight(105, 90, 412)).toBe(0);
  });

  it('readScreenInfo: đọc window.screen (+ orientation), lỗi → null', () => {
    const s = window.screen;
    Object.defineProperty(s, 'width', { configurable: true, get: () => 915 });
    Object.defineProperty(s, 'height', { configurable: true, get: () => 412 });
    try {
      expect(readScreenInfo()).toEqual({ width: 915, height: 412, landscape: null });
      Object.defineProperty(s, 'orientation', {
        configurable: true,
        get: () => ({ type: 'landscape-primary' }),
      });
      expect(readScreenInfo()?.landscape).toBe(true);
      Object.defineProperty(s, 'orientation', {
        configurable: true,
        get: () => ({ type: 'portrait-primary' }),
      });
      expect(readScreenInfo()?.landscape).toBe(false);
      Object.defineProperty(s, 'width', {
        configurable: true,
        get: () => {
          throw new Error('blocked');
        },
      });
      expect(readScreenInfo()).toBeNull();
    } finally {
      for (const k of ['width', 'height', 'orientation']) {
        delete (s as unknown as Record<string, unknown>)[k];
      }
    }
    expect(readScreenInfo()).toEqual({ width: 0, height: 0, landscape: null }); // jsdom
  });
});

// ---------------------------------------------------------------------------
// "Khớp nút game · dưới nút" (D-448): phần thấy của cửa sổ đặt dưới hàng nút số
// ---------------------------------------------------------------------------

describe('"dưới nút": phần thấy (belowVisibleOf)', () => {
  const c0 = DEFAULT_CALIBRATION;
  const with_ = (edgeShift: number) => ({ ...DEFAULT_CALIBRATION, edgeShift });

  it('đáy hàng nút số của ảnh game = 426,5 / 633; màn của ảnh → phần thấy = đáy màn − đáy hàng nút − thanh cửa sổ', () => {
    expect(GAME_NOTE_BOTTOM_H).toBeCloseTo((383.5 + 86 / 2) / 633, 9);
    const scale = trueScaleOf(scr(REF_W, REF_H), 1001, ANDROID);
    const v = belowVisibleOf(scale, 0, 400, c0);
    expect(Math.abs(v - (REF_H - 426.5 - FLOAT_BAR_GUESS))).toBeLessThanOrEqual(0.5);
  });

  it.each([
    // màn, cửa sổ rộng, thanh trình duyệt, cao trang, edgeShift → phần thấy
    [780, 360, 640, 0, 300, 0, 93],
    [915, 412, 660, 0, 300, 0, 110],
    [780, 360, 640, 0, 300, 10, 103],
    // thanh địa chỉ ở đỉnh trang ăn mất phần thấy; không bao giờ dưới BELOW_VISIBLE_MIN (bảng lúc dừng / Căn chỉnh)
    [780, 360, 640, 20, 300, 0, BELOW_VISIBLE_MIN],
    [780, 360, 640, 56, 300, 0, BELOW_VISIBLE_MIN],
    [915, 412, 660, 20, 300, 0, 90],
    // trang thấp hơn số đoán → cả trang
    [780, 360, 640, 0, 70, 0, 70],
  ] as const)(
    'màn %d×%d, cửa sổ %d px, thanh %d, trang %d, edgeShift %d → %d px',
    (sw, sh, w, chrome, page, shift, want) => {
      const scale = trueScaleOf(scr(sw, sh), w, ANDROID);
      expect(scale).not.toBeNull();
      expect(belowVisibleOf(scale, chrome, page, with_(shift))).toBe(want);
    },
  );

  it('không biết cỡ màn (máy tính, màn không đọc được) → cả trang + edgeShift (tầm đủ lùi gần hết trang); chưa đo → 0', () => {
    expect(BELOW_VISIBLE_MIN).toBeGreaterThanOrEqual(80);
    expect(belowVisibleOf(null, 0, 300, c0)).toBe(300);
    expect(belowVisibleOf(null, 0, 300, with_(-100))).toBe(200);
    // Cửa sổ pop-up để cao 400 px mà chỉ thấy ~90 px: −310 vẫn trong tầm (−600).
    const c = setCalibrationField(c0, 'edgeShift', -310);
    expect(c.edgeShift).toBe(-310);
    expect(belowVisibleOf(null, 0, 400, c)).toBe(90);
    expect(belowVisibleOf(null, 0, 400, with_(-600))).toBe(BELOW_VISIBLE_MIN);
    expect(belowVisibleOf(null, 0, 400, with_(200))).toBe(400);
    expect(belowVisibleOf(null, 0, 0, c0)).toBe(0);
    expect(belowVisibleOf(null, 0, Number.NaN, c0)).toBe(0);
    expect(belowVisibleOf(null, Number.NaN, 300, c0)).toBe(300);
  });
});

describe('"dưới nút": tầm edgeShift còn có tác dụng (belowEdgeRange)', () => {
  const with_ = (edgeShift: number) => ({ ...DEFAULT_CALIBRATION, edgeShift });
  const vis = (scale: TrueScale | null, chrome: number, page: number, s: number) =>
    belowVisibleOf(scale, chrome, page, with_(s));

  it.each([
    // màn, cửa sổ rộng, thanh trình duyệt, cao trang
    [780, 360, 640, 0, 300],
    [780, 360, 640, 0, 768],
    [915, 412, 660, 0, 300],
    [915, 412, 660, 20, 200],
    [1371, 633, 1001, 0, 400],
  ] as const)(
    'màn %d×%d, cửa sổ %d px, thanh %d, trang %d: mỗi bước trong tầm đổi phần thấy 1 px, ngoài tầm không đổi',
    (sw, sh, w, chrome, page) => {
      const scale = trueScaleOf(scr(sw, sh), w, ANDROID);
      expect(scale).not.toBeNull();
      const r = belowEdgeRange(scale, chrome, page)!;
      expect(r.min).toBeLessThan(r.max);
      expect(r.min).toBeGreaterThanOrEqual(CALIBRATION_RANGES.edgeShift.min);
      expect(r.max).toBeLessThanOrEqual(CALIBRATION_RANGES.edgeShift.max);
      // Đầu dưới: thấp nhất (80 px), bước dưới nữa không đổi; đầu trên: cả trang (hoặc mép tầm cố định).
      expect(vis(scale, chrome, page, r.min)).toBe(BELOW_VISIBLE_MIN);
      expect(vis(scale, chrome, page, r.min - 1)).toBe(BELOW_VISIBLE_MIN);
      expect(vis(scale, chrome, page, r.min - 50)).toBe(BELOW_VISIBLE_MIN);
      if (r.max < CALIBRATION_RANGES.edgeShift.max) {
        expect(vis(scale, chrome, page, r.max)).toBe(page);
        expect(vis(scale, chrome, page, r.max + 1)).toBe(page);
      }
      for (let s = r.min + 1; s <= r.max; s++) {
        expect(vis(scale, chrome, page, s) - vis(scale, chrome, page, s - 1)).toBe(1);
      }
    },
  );

  it('ví dụ của review: màn 780 × 360 → đoán ≈ 93 px, tầm −13…+207 ở trang 300 px (không còn −600 … +400)', () => {
    const scale = trueScaleOf(scr(780, 360), 640, ANDROID);
    expect(belowEdgeRange(scale, 0, 300)).toEqual({ min: -13, max: 207 });
    // Trang cao hơn số đoán + 400: đầu trên là tầm cố định.
    expect(belowEdgeRange(scale, 0, 768)?.max).toBe(CALIBRATION_RANGES.edgeShift.max);
  });

  it('không biết cỡ màn → đoán = cả trang: chỉ lùi được (đầu trên 0, không −0), đầu dưới theo tầm cố định', () => {
    const r = belowEdgeRange(null, 0, 300)!;
    expect(r).toEqual({ min: BELOW_VISIBLE_MIN - 300, max: 0 });
    expect(Object.is(r.max, 0)).toBe(true);
    expect(belowEdgeRange(null, 0, 768)).toEqual({ min: CALIBRATION_RANGES.edgeShift.min, max: 0 });
  });

  it('trang thấp hơn 80 px → một điểm (cả trang); chưa đo trang → null', () => {
    const r = belowEdgeRange(null, 0, 60)!;
    expect(r.min).toBe(r.max);
    expect(belowVisibleOf(null, 0, 60, with_(r.min))).toBe(60);
    expect(belowEdgeRange(null, 0, 0)).toBeNull();
    expect(belowEdgeRange(null, 0, Number.NaN)).toBeNull();
  });
});

describe('"dưới nút": khoảng trống đáy "Đáy ◂ ▸" (belowGapOf / canStepBelowGap / stepBelowGap)', () => {
  const with_ = (edgeShift: number) => ({ ...DEFAULT_CALIBRATION, edgeShift });
  const PAGE = 300;
  const scale780 = () => trueScaleOf(scr(780, 360), 640, ANDROID);

  it('khoảng trống = cao trang − phần thấy (≥ 0); chưa đo → 0', () => {
    expect(belowGapOf(300, 93)).toBe(207);
    expect(belowGapOf(300, 300)).toBe(0);
    expect(belowGapOf(300, 320)).toBe(0);
    expect(belowGapOf(0, 93)).toBe(0);
    expect(belowGapOf(300, 0)).toBe(0);
    expect(belowGapOf(Number.NaN, 93)).toBe(0);
  });

  it('▸ (+1) = khoảng trống lớn hơn BELOW_GAP_STEP_PX (edgeShift giảm), ◂ (−1) = nhỏ hơn; giữ = BELOW_GAP_FAST_PX; số khác giữ nguyên', () => {
    const scale = scale780();
    const r = belowEdgeRange(scale, 0, PAGE)!;
    const gap = (c: ReturnType<typeof with_>) =>
      belowGapOf(PAGE, belowVisibleOf(scale, 0, PAGE, c));
    const c0 = { ...DEFAULT_CALIBRATION, shift: 12, modeSpacing: 1.1 };
    expect(BELOW_GAP_STEP_PX).toBe(8);
    expect(BELOW_GAP_FAST_PX).toBeGreaterThan(BELOW_GAP_STEP_PX);
    expect(gap(c0)).toBe(207);
    const less = stepBelowGap(c0, -1, r);
    expect(less.edgeShift).toBe(BELOW_GAP_STEP_PX);
    expect(gap(less)).toBe(207 - BELOW_GAP_STEP_PX);
    const more = stepBelowGap(c0, 1, r);
    expect(more.edgeShift).toBe(-BELOW_GAP_STEP_PX);
    expect(gap(more)).toBe(207 + BELOW_GAP_STEP_PX);
    expect(stepBelowGap(c0, -1, r, BELOW_GAP_FAST_PX).edgeShift).toBe(BELOW_GAP_FAST_PX);
    expect({ ...less, edgeShift: 0 }).toEqual(c0);
    // Mặc định của tham số px = BELOW_GAP_STEP_PX; bước nhanh bị kẹp ở mép tầm (−13).
    expect(stepBelowGap(c0, 1, r, BELOW_GAP_FAST_PX).edgeShift).toBe(r.min);
  });

  it('kẹp hai đầu: ▸ tới phần thấy BELOW_VISIBLE_MIN, ◂ tới cả trang (khoảng trống 0); mỗi chạm trong tầm đều đổi trang', () => {
    const scale = scale780();
    const r = belowEdgeRange(scale, 0, PAGE)!;
    const vis = (c: ReturnType<typeof with_>) => belowVisibleOf(scale, 0, PAGE, c);
    let c = with_(0);
    while (canStepBelowGap(c, r, 1)) {
      const n = stepBelowGap(c, 1, r);
      expect(vis(n)).toBeLessThan(vis(c));
      c = n;
    }
    expect(c.edgeShift).toBe(r.min);
    expect(vis(c)).toBe(BELOW_VISIBLE_MIN);
    expect(stepBelowGap(c, 1, r)).toBe(c);
    expect(canStepBelowGap(c, r, -1)).toBe(true);
    let presses = 0;
    while (canStepBelowGap(c, r, -1)) {
      const n = stepBelowGap(c, -1, r);
      expect(vis(n)).toBeGreaterThan(vis(c));
      c = n;
      presses++;
    }
    expect(c.edgeShift).toBe(r.max);
    expect(vis(c)).toBe(PAGE);
    expect(belowGapOf(PAGE, vis(c))).toBe(0);
    expect(stepBelowGap(c, -1, r)).toBe(c);
    expect(presses).toBe(Math.ceil((r.max - r.min) / BELOW_GAP_STEP_PX));
  });

  it('số lưu ngoài tầm tính như đã kẹp (lần bấm đầu đã đổi trang); chưa đo trang → tầm cố định −600…+400', () => {
    const r = { min: -13, max: 207 };
    const low = with_(-600);
    expect(canStepBelowGap(low, r, 1)).toBe(false);
    expect(stepBelowGap(low, 1, r)).toBe(low);
    expect(stepBelowGap(low, -1, r).edgeShift).toBe(-13 + BELOW_GAP_STEP_PX);
    const high = with_(300);
    expect(canStepBelowGap(high, r, -1)).toBe(false);
    expect(stepBelowGap(high, 1, r).edgeShift).toBe(207 - BELOW_GAP_STEP_PX);
    const fixed = CALIBRATION_RANGES.edgeShift;
    expect(stepBelowGap(DEFAULT_CALIBRATION, 1, null).edgeShift).toBe(-BELOW_GAP_STEP_PX);
    expect(stepBelowGap(with_(fixed.min + 3), 1, null).edgeShift).toBe(fixed.min);
    expect(canStepBelowGap(with_(fixed.min), null, 1)).toBe(false);
    expect(canStepBelowGap(with_(fixed.max), null, -1)).toBe(false);
  });
});

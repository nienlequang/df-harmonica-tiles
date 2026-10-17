import { afterEach, describe, expect, it, vi } from 'vitest';
import { GAME_FRAME_PAD, computeLayout } from '../player/layout';
import type { Layout } from '../player/layout';
import { PIP_RENDERER_OPTIONS } from './FloatingStage';
import {
  FLOATING_MIN_COUNTDOWN_SEC,
  PIP_CHROME_GUESS,
  PIP_CHROME_STORAGE_KEY,
  PIP_REQUEST_AREA_RATIO,
  PIP_SIZE_STORAGE_KEY,
  capRequestSize,
  fitOuterHeight,
  floatingCountdownSec,
  forgetRememberedSize,
  initialWindowPlan,
  initialWindowSize,
  matchesSize,
  measureChromeHeight,
  presetOuterHeight,
  presetSize,
  presetTileScale,
  readChromeHeight,
  readRememberedSize,
  rememberChromeHeight,
  rememberSize,
  requestInitialPlacementOnce,
  resetToStandardSize,
  sameScreen,
  screenCssScale,
  screenOf,
  standardPlan,
  takeInitialPlacement,
  windowTileScale,
} from './pipPrefs';
import type { PipScreen } from './pipPrefs';

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

/** Bố cục canvas của cửa sổ nổi (như FloatingStage) ở kích thước `w × h` px CSS. */
function pipLayout(w: number, h: number, tileScale: number): Layout {
  return computeLayout(w, h, {
    orientation: 'vertical',
    lookahead: 6,
    hitLinePos: PIP_RENDERER_OPTIONS.hitLinePos ?? 0.97,
    tileScale,
    showRibbons: true,
    showSectionLabels: true,
    lanePadding: 'none',
    framePad: PIP_RENDERER_OPTIONS.framePad,
  });
}

/** Đệm khung bảng phím PC mỗi bên 8 làn ở 1080p (px thật): GAME_FRAME_PAD bước × 65. */
const FRAME_PAD_1080 = GAME_FRAME_PAD * 65;

const SCREEN_1080: PipScreen = { width: 1920, height: 1080, dpr: 1 };

/** Cửa sổ giả tối thiểu cho các hàm đọc màn hình / kích thước. */
function fakeWin(init: {
  screen?: Partial<PipScreen> & { width?: number; height?: number };
  dpr?: number;
  inner?: [number, number];
  outer?: [number, number];
  activation?: boolean | null;
  resizeTo?: (w: number, h: number) => void;
  resizeBy?: (w: number, h: number) => void;
}): Window {
  const [iw, ih] = init.inner ?? [576, 716];
  const [ow, oh] = init.outer ?? [0, 0];
  const win: Record<string, unknown> = {
    screen: init.screen ?? { width: 1920, height: 1080 },
    devicePixelRatio: init.dpr ?? 1,
    innerWidth: iw,
    innerHeight: ih,
    outerWidth: ow,
    outerHeight: oh,
  };
  if (init.activation !== undefined && init.activation !== null) {
    win.navigator = { userActivation: { isActive: init.activation } };
  }
  if (init.resizeTo) win.resizeTo = init.resizeTo;
  if (init.resizeBy) win.resizeBy = init.resizeBy;
  return win as unknown as Window;
}

// ---------------------------------------------------------------------------
// Cỡ chuẩn theo màn hình (bổ sung trước deploy C)
// ---------------------------------------------------------------------------

describe('cỡ chuẩn: tỉ lệ theo chiều cao màn hình thật (768p … 2160p × dpr 1 / 1,25 / 1,5)', () => {
  const HEIGHTS = [768, 900, 1080, 1200, 1440, 2160];
  const DPRS = [1, 1.25, 1.5];
  for (const physical of HEIGHTS) {
    for (const dpr of DPRS) {
      it(`${physical}p @ dpr ${dpr}`, () => {
        const css = physical / dpr; // màn hình báo theo px CSS
        const k = physical / 1080; // UI game phóng theo chiều cao
        const chrome = 34;
        const size = presetSize(css, dpr, chrome);
        const scale = presetTileScale(css, dpr);

        // Cao: mép dưới trên mép trên bảng phím (750·k px thật) → mép trên (gồm thanh tiêu đề) chạm mép màn.
        expect(Math.abs((size.height + chrome) * dpr - 750 * k)).toBeLessThan(1);
        expect(Math.abs(presetOuterHeight(css, dpr) * dpr - 750 * k)).toBeLessThan(1e-6);

        // Rộng (v1.0.1): ≈ 610·k px thật = khung bảng phím PC 553,8·k (8 làn 520·k + đệm hai bên) + gutter;
        // tileScale bị kẹp (768p @150 %) thì gutter rộng hơn chút nhưng khung / 8 làn vẫn đúng.
        if (Math.abs(scale - k / dpr) < 1e-9) {
          expect(Math.abs(size.width * dpr - (520 + 2 * FRAME_PAD_1080 + 56) * k)).toBeLessThan(
            1.5 * dpr,
          );
        }

        // 8 cột thẳng 8 phím game: tâm (16,9 + 32,5 + 65·i)·k từ mép trái cửa sổ (= mép trái khung bảng phím),
        // rộng 65·k (pixel thật); ô ngoài cùng cách mép trái cửa sổ đúng đệm khung + đệm ô.
        const L = pipLayout(size.width, size.height, scale);
        expect(Math.abs(L.laneCrossSize * dpr - 65 * k)).toBeLessThan(0.15 * dpr);
        for (let i = 0; i < 8; i++) {
          const center = (L.laneCrossStart[i] + L.laneCrossSize / 2) * dpr;
          expect(Math.abs(center - (FRAME_PAD_1080 + 32.5 + 65 * i) * k)).toBeLessThan(1.5);
        }
        expect(Math.abs(L.frameInset * dpr - FRAME_PAD_1080 * k)).toBeLessThan(0.1 * dpr);
        // Gutter ribbon ngay sau mép phải khung (= đệm phải), tới mép phải cửa sổ.
        expect(L.gutter?.x).toBeCloseTo(L.laneCrossStart[7] + L.laneCrossSize + L.frameInset, 9);
        expect((L.gutter?.x ?? 0) + (L.gutter?.w ?? 0)).toBeCloseTo(size.width, 9);

        // Chỉ dài thêm đường rơi: cùng bề ngang, ô / làn rộng y như cỡ cũ (cao 600·k px thật).
        const old = pipLayout(size.width, (600 * k) / dpr, scale);
        expect(L.laneCrossSize).toBeCloseTo(old.laneCrossSize, 9);
        expect(L.laneInset).toBe(old.laneInset);
        expect(L.pxPerBeat).toBeGreaterThan(old.pxPerBeat);
      });
    }
  }

  it('bảng số ở dpr 1 (thanh tiêu đề 34 px): rộng = khung bảng phím + gutter, cao = 750·k − 34', () => {
    // Rộng trước v1.0.1 (8 làn sát mép): 410 / 480 / 576 / 640 / 768 / 1152.
    const rows: [number, number, number][] = [
      [768, 434, 499],
      [900, 509, 591],
      [1080, 610, 716],
      [1200, 677, 799],
      [1440, 813, 966],
      [2160, 1220, 1466],
    ];
    for (const [h, w, inner] of rows) {
      expect(presetSize(h, 1, 34)).toEqual({ width: w, height: inner });
    }
    // Windows scale: 1080p @125 % (màn báo 864 px CSS) → 488 × 566; 1440p @150 % (960) → 542 × 633.
    expect(presetSize(864, 1.25, 34)).toEqual({ width: 488, height: 566 });
    expect(presetSize(960, 1.5, 34)).toEqual({ width: 542, height: 633 });
  });

  it('thanh tiêu đề: mặc định số đoán, kẹp 0..120; màn lạ → như 1080p @100 %', () => {
    expect(presetSize(1080)).toEqual({ width: 610, height: 750 - PIP_CHROME_GUESS });
    expect(presetSize(1080, 1, 0)).toEqual({ width: 610, height: 750 });
    expect(presetSize(1080, 1, 500)).toEqual({ width: 610, height: 630 });
    expect(presetSize(1080, 1, -3)).toEqual({ width: 610, height: 750 });
    expect(presetSize(0)).toEqual({ width: 610, height: 716 });
    expect(presetSize(Number.NaN, Number.NaN)).toEqual({ width: 610, height: 716 });
    expect(screenCssScale(0)).toBe(1);
  });

  it('1080p @100 %: ô ngoài cùng cách mép cửa sổ / mép gutter như keycap ngoài cùng của game cách viền', () => {
    const size = presetSize(1080, 1, 34);
    const L = pipLayout(size.width, size.height, 1);
    // Ô lane 1: mép trái = đệm khung (16,9) + đệm ô (5) ≈ 21,9 px; ô lane 8: mép phải cách vạch gutter đúng chừng đó.
    const tileLeft = L.laneCrossStart[0] + L.laneInset;
    const tileRight = L.laneCrossStart[7] + L.laneCrossSize - L.laneInset;
    expect(tileLeft).toBeCloseTo(21.9, 0);
    expect((L.gutter?.x ?? 0) - tileRight).toBeCloseTo(tileLeft, 6);
    // ≈ 0,34 bước (game: keycap ngoài cùng → viền trong 0,38 bước, → mép khung 0,61 bước).
    expect(tileLeft / L.laneCrossSize).toBeGreaterThan(0.3);
    expect(tileLeft / L.laneCrossSize).toBeLessThan(0.4);
  });
});

describe('presetTileScale', () => {
  it('= k / dpr (gutter co giãn cùng vùng lane); 1080p @100 % = 1; kẹp theo renderer; lạ → 1', () => {
    expect(presetTileScale(1080, 1)).toBe(1);
    expect(presetTileScale(1440, 1)).toBeCloseTo(4 / 3, 9);
    expect(presetTileScale(864, 1.25)).toBeCloseTo(0.8, 9);
    expect(presetTileScale(2160, 1)).toBe(2);
    expect(presetTileScale(512, 1.5)).toBe(0.5); // 768p @150 % = 0,47 → kẹp 0,5
    expect(presetTileScale(270, 4)).toBe(0.5); // 1080p thật ở dpr 4 = 0,25 → kẹp
    expect(presetTileScale(1080, 4)).toBe(1); // 4320p thật ở dpr 4
    expect(presetTileScale(Number.NaN, Number.NaN)).toBe(1);
  });

  it('windowTileScale đọc màn hình của cửa sổ; không đọc được → 1', () => {
    expect(windowTileScale(fakeWin({ screen: { width: 2560, height: 1440 } }))).toBeCloseTo(4 / 3);
    expect(windowTileScale(fakeWin({ screen: { width: 1536, height: 864 }, dpr: 1.25 }))).toBe(0.8);
    expect(windowTileScale({} as Window)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Nhớ kích thước kèm màn hình
// ---------------------------------------------------------------------------

describe('kích thước đã nhớ: chỉ dùng lại trên đúng màn hình đã lưu', () => {
  it('lưu kèm màn hình, đọc lại trên cùng màn (đã kẹp)', () => {
    rememberSize({ width: 640.4, height: 700.6 }, SCREEN_1080);
    expect(JSON.parse(localStorage.getItem(PIP_SIZE_STORAGE_KEY) ?? 'null')).toEqual({
      width: 640,
      height: 701,
      screen: { width: 1920, height: 1080, dpr: 1 },
      framePad: GAME_FRAME_PAD,
    });
    expect(readRememberedSize(SCREEN_1080)).toEqual({ width: 640, height: 701 });
    rememberSize({ width: 50, height: 99999 }, SCREEN_1080);
    expect(readRememberedSize(SCREEN_1080)).toEqual({ width: 200, height: 4096 });
  });

  it('khác màn (cao / rộng / dpr), màn không rõ, bản lưu cũ không ghi màn → không dùng', () => {
    rememberSize({ width: 640, height: 700 }, SCREEN_1080);
    expect(readRememberedSize({ width: 2560, height: 1440, dpr: 1 })).toBeNull();
    expect(readRememberedSize({ width: 2560, height: 1080, dpr: 1 })).toBeNull();
    expect(readRememberedSize({ width: 1536, height: 864, dpr: 1.25 })).toBeNull(); // cùng màn, đổi % scale
    expect(readRememberedSize(null)).toBeNull();
    localStorage.setItem(PIP_SIZE_STORAGE_KEY, JSON.stringify({ width: 640, height: 720 }));
    expect(readRememberedSize(SCREEN_1080)).toBeNull();
  });

  it('cỡ kéo cho bố cục cũ (v1.0.0, 8 làn sát mép — không ghi `framePad`) / khung khác → không dùng', () => {
    const screen = { width: 1920, height: 1080, dpr: 1 };
    localStorage.setItem(PIP_SIZE_STORAGE_KEY, JSON.stringify({ width: 590, height: 700, screen }));
    expect(readRememberedSize(SCREEN_1080)).toBeNull();
    for (const framePad of [0, 0.035, '0.26', null]) {
      localStorage.setItem(
        PIP_SIZE_STORAGE_KEY,
        JSON.stringify({ width: 590, height: 700, screen, framePad }),
      );
      expect(readRememberedSize(SCREEN_1080)).toBeNull();
    }
    localStorage.setItem(
      PIP_SIZE_STORAGE_KEY,
      JSON.stringify({ width: 590, height: 700, screen, framePad: GAME_FRAME_PAD }),
    );
    expect(readRememberedSize(SCREEN_1080)).toEqual({ width: 590, height: 700 });
  });

  it('bỏ qua 0×0, màn null, giá trị hỏng; quên được', () => {
    rememberSize({ width: 0, height: 0 }, SCREEN_1080);
    rememberSize({ width: 600, height: 600 }, null);
    expect(localStorage.getItem(PIP_SIZE_STORAGE_KEY)).toBeNull();
    for (const bad of [
      '{',
      'null',
      '[]',
      '{"width":"a","height":2,"screen":{"width":1920,"height":1080,"dpr":1}}',
      '{"width":-1,"height":5,"screen":{"width":1920,"height":1080,"dpr":1}}',
      '{"width":600,"height":600,"screen":{"width":1920,"height":0,"dpr":1}}',
      '{"width":600,"height":600,"screen":"1080p"}',
    ]) {
      localStorage.setItem(PIP_SIZE_STORAGE_KEY, bad);
      expect(readRememberedSize(SCREEN_1080)).toBeNull();
    }
    rememberSize({ width: 600, height: 600 }, SCREEN_1080);
    forgetRememberedSize();
    expect(localStorage.getItem(PIP_SIZE_STORAGE_KEY)).toBeNull();
  });

  it('storage bị chặn: không lỗi, dùng cỡ chuẩn', () => {
    const boom = (): never => {
      throw new Error('blocked');
    };
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(boom);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(boom);
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(boom);
    expect(readRememberedSize(SCREEN_1080)).toBeNull();
    expect(readChromeHeight()).toBeNull();
    expect(() => rememberSize({ width: 600, height: 600 }, SCREEN_1080)).not.toThrow();
    expect(() => rememberChromeHeight(30)).not.toThrow();
    expect(() => forgetRememberedSize()).not.toThrow();
    expect(initialWindowSize(fakeWin({}))).toEqual({ width: 610, height: 716 });
  });

  it('sameScreen so pixel thật + dpr; screenOf đọc screen + dpr, thiếu chiều cao → null', () => {
    expect(sameScreen(SCREEN_1080, { width: 1920, height: 1080, dpr: 1 })).toBe(true);
    expect(sameScreen(SCREEN_1080, { width: 1920, height: 1080, dpr: 1.25 })).toBe(false);
    expect(screenOf(fakeWin({ screen: { width: 1536, height: 864 }, dpr: 1.25 }))).toEqual({
      width: 1536,
      height: 864,
      dpr: 1.25,
    });
    expect(screenOf(fakeWin({ screen: { height: 1080 }, dpr: Number.NaN }))).toEqual({
      width: 0,
      height: 1080,
      dpr: 1,
    });
    expect(screenOf(fakeWin({ screen: { width: 1920, height: 0 } }))).toBeNull();
    const throwing = {
      get screen(): never {
        throw new Error('no');
      },
    } as unknown as Window;
    expect(screenOf(throwing)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Thanh tiêu đề + kế hoạch mở
// ---------------------------------------------------------------------------

describe('thanh tiêu đề của cửa sổ nổi', () => {
  it('đo = outerHeight − innerHeight; outer 0 / âm / quá lớn → null', () => {
    expect(measureChromeHeight(fakeWin({ inner: [576, 716], outer: [576, 752] }))).toBe(36);
    expect(measureChromeHeight(fakeWin({ inner: [576, 716], outer: [576, 716] }))).toBe(0);
    expect(measureChromeHeight(fakeWin({ inner: [576, 716], outer: [0, 0] }))).toBeNull();
    expect(measureChromeHeight(fakeWin({ inner: [576, 716], outer: [576, 700] }))).toBeNull();
    expect(measureChromeHeight(fakeWin({ inner: [576, 716], outer: [576, 900] }))).toBeNull();
  });

  it('nhớ / đọc (làm tròn, hỏng → null)', () => {
    expect(readChromeHeight()).toBeNull();
    rememberChromeHeight(38.4);
    expect(localStorage.getItem(PIP_CHROME_STORAGE_KEY)).toBe('38');
    expect(readChromeHeight()).toBe(38);
    rememberChromeHeight(-1);
    rememberChromeHeight(Number.NaN);
    expect(readChromeHeight()).toBe(38);
    localStorage.setItem(PIP_CHROME_STORAGE_KEY, '"x"');
    expect(readChromeHeight()).toBeNull();
  });
});

describe('initialWindowPlan', () => {
  it('chưa nhớ gì → cỡ chuẩn của màn hình (cao ngoài = 750·k/dpr), thanh tiêu đề đoán', () => {
    const plan = initialWindowPlan(fakeWin({ screen: { width: 2560, height: 1440 } }));
    const size1440 = { width: 813, height: 1000 - PIP_CHROME_GUESS };
    expect(plan).toEqual({
      kind: 'standard',
      target: size1440,
      size: size1440,
      outerHeight: 1000,
    });
    expect(initialWindowPlan({} as Window)).toEqual({
      kind: 'standard',
      target: { width: 610, height: 716 },
      size: { width: 610, height: 716 },
      outerHeight: 750,
    });
  });

  it('thanh tiêu đề đã đo → trừ đúng số đo', () => {
    rememberChromeHeight(40);
    expect(initialWindowPlan(fakeWin({})).size).toEqual({ width: 610, height: 710 });
    expect(standardPlan(SCREEN_1080).size).toEqual({ width: 610, height: 710 });
  });

  it('cỡ đã nhớ trên đúng màn này thắng (không chỉnh cao thêm); màn khác → cỡ chuẩn', () => {
    rememberSize({ width: 500, height: 520 }, SCREEN_1080);
    expect(initialWindowPlan(fakeWin({}))).toEqual({
      kind: 'remembered',
      target: { width: 500, height: 520 },
      size: { width: 500, height: 520 },
      outerHeight: null,
    });
    expect(initialWindowSize(fakeWin({}))).toEqual({ width: 500, height: 520 });
    const size1200 = { width: 677, height: 833 - PIP_CHROME_GUESS };
    expect(initialWindowPlan(fakeWin({ screen: { width: 1920, height: 1200 } }))).toEqual({
      kind: 'standard',
      target: size1200,
      size: size1200,
      outerHeight: 833,
    });
  });
});

// ---------------------------------------------------------------------------
// Trần 25 % diện tích màn của Chrome (D-418): màn 4:3 / 5:4
// ---------------------------------------------------------------------------

describe('trần cỡ xin của Chrome (25 % diện tích màn — D-418)', () => {
  const area = (s: { width: number; height: number }) => s.width * s.height;

  it.each([
    // [rộng, cao, dpr] px CSS của màn
    [1280, 1024, 1],
    [1024, 768, 1],
    [1600, 1200, 1],
    [1400, 1050, 1],
    [2560, 2048, 1.25],
  ] as const)(
    'màn %d×%d @%d (4:3 / 5:4): xin ĐÚNG bề ngang, chiều cao hạ cho vừa trần; muốn cỡ chuẩn đủ cao',
    (sw, sh, dpr) => {
      const screen: PipScreen = { width: sw, height: sh, dpr };
      const plan = standardPlan(screen);
      const full = presetSize(sh, dpr, PIP_CHROME_GUESS);
      expect(plan.target).toEqual(full);
      expect(area(full)).toBeGreaterThan(PIP_REQUEST_AREA_RATIO * sw * sh); // cỡ chuẩn vượt trần
      expect(plan.size.width).toBe(full.width); // 8 cột vẫn thẳng 8 phím
      expect(area(plan.size)).toBeLessThanOrEqual(PIP_REQUEST_AREA_RATIO * sw * sh);
      expect(plan.size.height).toBe(Math.floor((PIP_REQUEST_AREA_RATIO * sw * sh) / full.width));
      // Sau khi mở vẫn kéo lên cao ngoài chuẩn (mép trên chạm mép màn).
      expect(plan.outerHeight).toBe(Math.round(presetOuterHeight(sh, dpr)));
      // Chrome không thu nhỏ cỡ đã hạ: lane rộng đúng 65·k px thật.
      const L = pipLayout(plan.size.width, plan.size.height, presetTileScale(sh, dpr));
      expect(Math.abs(L.laneCrossSize * dpr - (65 * sh * dpr) / 1080)).toBeLessThan(0.15 * dpr);
    },
  );

  it.each([
    [1920, 1080, 1],
    [1920, 1200, 1],
    [1366, 768, 1],
    [2560, 1440, 1],
    [1504, 1002.67, 1.5], // 2256 × 1504 @150 % (3:2)
    [3840, 2160, 1],
  ] as const)(
    'màn %d×%d @%d (16:9 / 16:10 / 3:2): dưới trần → xin nguyên cỡ chuẩn',
    (sw, sh, dpr) => {
      const plan = standardPlan({ width: sw, height: sh, dpr });
      expect(plan.size).toEqual(plan.target);
    },
  );

  it('capRequestSize: không biết bề ngang màn → như cũ; trần rất nhỏ → không thấp hơn cỡ tối thiểu', () => {
    const big = { width: 600, height: 900 };
    expect(capRequestSize(big, null)).toBe(big);
    expect(capRequestSize(big, { width: 0, height: 1080, dpr: 1 })).toBe(big);
    expect(capRequestSize(big, { width: 800, height: 600, dpr: 1 })).toEqual({
      width: 600,
      height: 200,
    });
    expect(capRequestSize(big, { width: 400, height: 300, dpr: 1 }).height).toBe(160);
  });

  it('cỡ đã nhớ vượt trần (người dùng kéo được tới 80 % màn): xin đúng bề ngang, rồi kéo cao lại cỡ đã nhớ', () => {
    const screen = { width: 1280, height: 1024 };
    rememberChromeHeight(30);
    rememberSize({ width: 546, height: 900 }, { ...screen, dpr: 1 });
    const plan = initialWindowPlan(fakeWin({ screen }));
    expect(plan.kind).toBe('remembered');
    expect(plan.target).toEqual({ width: 546, height: 900 });
    expect(plan.size).toEqual({ width: 546, height: Math.floor(327680 / 546) });
    expect(plan.outerHeight).toBe(930);
  });

  it('fitOuterHeight với bề ngang mong muốn: trình duyệt đã thu nhỏ cỡ xin → resizeTo cả bề ngang (+ viền)', () => {
    const resizeTo = vi.fn();
    // Chrome trả 514 × 600 thay cho 546 × 600 (cỡ xin vẫn vượt trần theo cách tính của nó).
    const win = fakeWin({
      screen: { width: 1280, height: 1024 },
      inner: [514, 600],
      outer: [516, 634],
      activation: true,
      resizeTo,
    });
    expect(fitOuterHeight(win, 711, undefined, 546)).toBe('resized');
    expect(resizeTo).toHaveBeenCalledWith(548, 711);
    // Đúng cả hai chiều → ok, không gọi gì.
    const ok = vi.fn();
    expect(
      fitOuterHeight(
        fakeWin({ inner: [546, 677], outer: [548, 711], activation: true, resizeTo: ok }),
        711,
        undefined,
        546,
      ),
    ).toBe('ok');
    expect(ok).not.toHaveBeenCalled();
  });

  it('"Đặt lại cỡ chuẩn" trên màn 5:4: resizeTo cỡ chuẩn ĐỦ CAO (không bị trần lúc xin mở)', () => {
    const resizeTo = vi.fn();
    const win = fakeWin({
      screen: { width: 1280, height: 1024 },
      inner: [546, 600],
      outer: [546, 634],
      resizeTo,
    });
    const r = resetToStandardSize(win);
    expect(r.target).toEqual(presetSize(1024, 1, 34));
    expect(r.target.width).toBe(578); // khung bảng phím + gutter (trước v1.0.1: 546)
    expect(resizeTo).toHaveBeenCalledWith(578, Math.round(presetOuterHeight(1024, 1)));
  });
});

describe('preferInitialWindowPlacement một lần (D-419)', () => {
  it('requestInitialPlacementOnce → takeInitialPlacement đúng một lần', () => {
    expect(takeInitialPlacement()).toBe(false);
    requestInitialPlacementOnce();
    expect(takeInitialPlacement()).toBe(true);
    expect(takeInitialPlacement()).toBe(false);
  });
});

describe('fitOuterHeight (ngay sau khi mở ở cỡ chuẩn)', () => {
  it('lệch + có user activation → nhớ thanh tiêu đề thật, resizeTo cao ngoài mong muốn', () => {
    const resizeTo = vi.fn();
    const win = fakeWin({ inner: [576, 716], outer: [576, 756], activation: true, resizeTo });
    expect(fitOuterHeight(win, 750)).toBe('resized');
    expect(resizeTo).toHaveBeenCalledWith(576, 750);
    expect(readChromeHeight()).toBe(40);
  });

  it('không có activation → không gọi resizeTo, lần mở sau dùng số đo', () => {
    const resizeTo = vi.fn();
    const win = fakeWin({ inner: [576, 716], outer: [576, 756], activation: false, resizeTo });
    expect(fitOuterHeight(win, 750)).toBe('remembered');
    expect(resizeTo).not.toHaveBeenCalled();
    expect(initialWindowPlan(fakeWin({})).size.height).toBe(710);
  });

  it('đã đúng → ok; không đo được → unmeasured; resizeTo ném lỗi / không có API → remembered', () => {
    expect(fitOuterHeight(fakeWin({ inner: [576, 716], outer: [576, 751] }), 750)).toBe('ok');
    expect(fitOuterHeight(fakeWin({ inner: [576, 716] }), 750)).toBe('unmeasured');
    const boom = vi.fn(() => {
      throw new Error('NotAllowed');
    });
    expect(
      fitOuterHeight(fakeWin({ inner: [576, 716], outer: [576, 760], resizeTo: boom }), 750),
    ).toBe('remembered');
    expect(fitOuterHeight(fakeWin({ inner: [576, 716], outer: [576, 760] }), 750)).toBe(
      'remembered',
    );
  });
});

describe('resetToStandardSize ("Đặt lại cỡ chuẩn")', () => {
  it('quên cỡ đã nhớ, đo thanh tiêu đề, resizeTo cỡ NGOÀI chuẩn của màn hình đang chứa cửa sổ', () => {
    rememberSize({ width: 500, height: 520 }, { width: 2560, height: 1440, dpr: 1 });
    const resizeTo = vi.fn();
    const win = fakeWin({
      screen: { width: 2560, height: 1440 },
      inner: [500, 520],
      outer: [502, 556],
      resizeTo,
    });
    const r = resetToStandardSize(win);
    expect(localStorage.getItem(PIP_SIZE_STORAGE_KEY)).toBeNull();
    expect(readChromeHeight()).toBe(36);
    expect(r).toEqual({ target: { width: 813, height: 964 }, requested: true });
    expect(resizeTo).toHaveBeenCalledWith(815, 1000);
  });

  it('chỉ có resizeBy → đổi theo phần chênh; không có API nào → requested false', () => {
    const resizeBy = vi.fn();
    const win = fakeWin({ inner: [500, 520], outer: [500, 554], resizeBy });
    expect(resetToStandardSize(win).requested).toBe(true);
    expect(resizeBy).toHaveBeenCalledWith(110, 196); // → 610 × 750 ngoài
    expect(resetToStandardSize(fakeWin({ inner: [500, 520] })).requested).toBe(false);
  });

  it('matchesSize: ±3 px', () => {
    const win = fakeWin({ inner: [577, 713] });
    expect(matchesSize(win, { width: 576, height: 716 })).toBe(true);
    expect(matchesSize(win, { width: 576, height: 709 })).toBe(false);
  });
});

describe('floatingCountdownSec (vòng R7: Cửa sổ nổi + trang mini đếm tối thiểu 3 giây)', () => {
  it('= Cài đặt, tối thiểu 3, tối đa 10; hỏng → tối thiểu', () => {
    expect(FLOATING_MIN_COUNTDOWN_SEC).toBe(3);
    expect(floatingCountdownSec(0)).toBe(3); // Cài đặt = Tắt
    expect(floatingCountdownSec(1)).toBe(3);
    expect(floatingCountdownSec(3)).toBe(3);
    expect(floatingCountdownSec(5)).toBe(5);
    expect(floatingCountdownSec(10)).toBe(10);
    expect(floatingCountdownSec(42)).toBe(10);
    expect(floatingCountdownSec(4.6)).toBe(5);
    for (const bad of [Number.NaN, Infinity, -2, '5', null, undefined]) {
      expect(floatingCountdownSec(bad)).toBe(3);
    }
  });
});

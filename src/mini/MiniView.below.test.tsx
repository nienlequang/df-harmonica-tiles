/**
 * Trang mini — bố cục "Khớp nút game · dưới nút" (D-448, điện thoại Samsung): cửa sổ đặt NGAY DƯỚI hàng nút số, phần
 * dưới ra ngoài màn hình. Cùng 'fit' + `laneFit` + số căn chỉnh với "Khớp nút game", renderer `flipY`; trang thu về
 * phần thấy (`--mini-visible-h` + `data-mini-layout` trên :root); Căn chỉnh lật (không còn "Đáy · Dời"); khoảng trống
 * đáy = "Đáy ◂ ▸" ở hàng trên của panel lúc dừng (góp ý 2026-10-22) + vạch đứt ở đáy phần thấy lúc dừng; chỉ báo chỉ có
 * "Rộng"; hướng dẫn ⓘ có "Bố cục nên dùng theo máy".
 */
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StringKey } from '../i18n/strings';
import { translateCount } from '../i18n/useT';
import { OverlayEngine } from '../overlay/overlayEngine';
import { CUE_TARGET_GAP, fitGeometry } from '../player/layout';
import type { RendererOptions } from '../player/renderer';
import { useSettings } from '../ui/settings';
import {
  HOLD_DELAY_MS,
  HOLD_FAST_AFTER,
  HOLD_REPEAT_MS,
  alignControlsFor,
  alignFocusOf,
} from './MiniCalibrate';
import {
  BELOW_GAP_FAST_PX,
  BELOW_GAP_STEP_PX,
  BELOW_VISIBLE_MIN,
  CALIBRATION_FIELDS,
  CALIBRATION_RANGES,
  DEFAULT_CALIBRATION,
  GAME_NOTE_STEP_H,
  MINI_CALIBRATION_STORAGE_KEY,
  MINI_LAYOUT_STORAGE_KEY,
  laneFitOf,
} from './miniAlign';
import { MINI_HELP_DEVICES, MINI_HELP_FIT_VENDORS } from './MiniHelp';
import { MiniView } from './MiniView';

const en = (key: StringKey, params?: Record<string, string | number>) =>
  translateCount('en', key, params);
const tVi = (key: StringKey, params?: Record<string, string | number>) =>
  translateCount('vi', key, params);

const SEED = 'seed-quoc-ca-viet-nam';
const W = 960;
const H = 300;
/** jsdom: `window.innerHeight` mặc định. */
const PAGE_H = 768;

function renderMini() {
  return render(<MiniView songId={SEED} query={new URLSearchParams()} />);
}

const root = () => screen.getByRole('region', { name: en('mini.region') });
const html = () => document.documentElement;
const visibleVar = () => html().style.getPropertyValue('--mini-visible-h');
const alignBtn = () => screen.getByRole('button', { name: en('mini.align.open') });
const layoutBtn = (key: StringKey) => screen.getByRole('button', { name: en(key) });
const alignPanel = () => screen.getByRole('group', { name: en('mini.align.region') });
const picks = () =>
  within(screen.getByRole('group', { name: en('mini.align.pick') })).getAllByRole('button');
const px = (v: string) => Number.parseFloat(v);
/** "Đáy ◂ giá trị ▸" ở hàng trên của panel lúc dừng (null = không có). */
const gapGroup = () => screen.queryByRole('group', { name: en('mini.gap.group') });
const gapLess = () => screen.getByRole('button', { name: en('mini.gap.less') });
const gapMore = () => screen.getByRole('button', { name: en('mini.gap.more') });
const gapValue = () => root().querySelector('.mini-gap-value')?.textContent;
const edgeMark = () => root().querySelector<HTMLElement>('.mini-edge-mark');
const savedEdge = () =>
  (
    JSON.parse(localStorage.getItem(MINI_CALIBRATION_STORAGE_KEY) ?? 'null') as {
      edgeShift: number;
    } | null
  )?.edgeShift ?? null;

/** Option renderer cuối cùng trang mini gửi cho engine. */
let lastOptions: () => Partial<RendererOptions> | undefined;

function box(w: number, h: number): void {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => w });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
    configurable: true,
    get: () => h,
  });
}

/** Màn điện thoại ngang + máy Android cảm ứng (đúng tỉ lệ thật — D-412) + cỡ vùng làn. */
function device(sw: number, sh: number, w: number, h: number): void {
  Object.defineProperty(window.navigator, 'userAgent', {
    configurable: true,
    get: () => 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 Chrome/141.0 Mobile',
  });
  Object.defineProperty(window.navigator, 'maxTouchPoints', { configurable: true, get: () => 5 });
  Object.defineProperty(window.screen, 'width', { configurable: true, get: () => sw });
  Object.defineProperty(window.screen, 'height', { configurable: true, get: () => sh });
  box(w, h);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal(
    'requestAnimationFrame',
    vi.fn(() => 1),
  );
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => null);
  box(W, H);
  const spy = vi.spyOn(OverlayEngine.prototype, 'setRendererOptions');
  lastOptions = () => spy.mock.calls.at(-1)?.[0];
  useSettings.getState().reset();
  useSettings.getState().set({ language: 'en', controlScheme: 'mobile' });
  localStorage.setItem(MINI_LAYOUT_STORAGE_KEY, 'below');
});

afterEach(() => {
  for (const k of ['clientWidth', 'clientHeight']) {
    delete (HTMLElement.prototype as unknown as Record<string, unknown>)[k];
  }
  delete (window.screen as unknown as Record<string, unknown>).width;
  delete (window.screen as unknown as Record<string, unknown>).height;
  delete (window.navigator as unknown as Record<string, unknown>).userAgent;
  delete (window.navigator as unknown as Record<string, unknown>).maxTouchPoints;
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('bố cục "Khớp nút game · dưới nút"', () => {
  it('đã chọn: lane theo nút thật ("fit" + laneFit chung), canvas lật; ba nút bố cục; không bàn nút / banner', () => {
    const { container } = renderMini();
    expect(root().dataset.layout).toBe('below');
    const o = lastOptions();
    expect(o?.lanePadding).toBe('fit');
    expect(o?.flipY).toBe(true);
    expect(o?.laneFit).toEqual(laneFitOf(DEFAULT_CALIBRATION));
    // Ba nút: chỉ "dưới nút" bật; chữ ngắn nằm trong tên đọc (WCAG 2.5.3); tooltip nói cách đặt.
    const seg = screen.getByRole('group', { name: en('mini.layout.group') });
    expect(
      within(seg)
        .getAllByRole('button')
        .map((b) => b.getAttribute('aria-label')),
    ).toEqual([en('mini.layout.game'), en('mini.layout.below'), en('mini.layout.compact')]);
    expect(layoutBtn('mini.layout.below').getAttribute('aria-pressed')).toBe('true');
    expect(layoutBtn('mini.layout.game').getAttribute('aria-pressed')).toBe('false');
    expect(layoutBtn('mini.layout.compact').getAttribute('aria-pressed')).toBe('false');
    const below = layoutBtn('mini.layout.below');
    expect(below.querySelector('.mini-short')?.textContent).toBe(en('mini.layout.belowShort'));
    expect(en('mini.layout.below').toLowerCase()).toContain(
      en('mini.layout.belowShort').toLowerCase(),
    );
    expect(below.getAttribute('title')).toBe(en('mini.layout.belowHint'));
    expect(alignBtn()).toBeTruthy();
    // Như "Khớp nút game" kiểu Mobile: không bàn nút / game bar / banner (D-403); nhãn làn ở tâm 8 nút số.
    expect(container.querySelector('.mpad, .game-bar')).toBeNull();
    expect(container.querySelector('.mini-banner')).toBeNull();
    const g = fitGeometry(W, H, laneFitOf(DEFAULT_CALIBRATION));
    const labels = Array.from(container.querySelectorAll<HTMLElement>('.mini-fit-label'));
    expect(labels).toHaveLength(8);
    labels.forEach((el, i) => expect(px(el.style.left)).toBeCloseTo(g.laneCx[i], 6));
  });

  it('phần thấy trên :root (không biết cỡ màn → cả trang − khoảng trống đáy); gỡ khi đổi bố cục / rời trang', () => {
    const { unmount } = renderMini();
    expect(html().dataset.miniLayout).toBe('below');
    expect(visibleVar()).toBe(`${PAGE_H}px`);
    expect(html().dataset.miniShort).toBeUndefined();
    // Cả trang thấy được → không có dòng nhắc "kéo xuống".
    expect(document.body.querySelector('.mini-below-rest')).toBeNull();
    // Đổi sang "Khớp nút game": hết lật (gửi rõ flipY false), :root sạch.
    fireEvent.click(layoutBtn('mini.layout.game'));
    expect(root().dataset.layout).toBe('game');
    expect(lastOptions()?.flipY).toBe(false);
    expect(lastOptions()?.lanePadding).toBe('fit');
    expect(html().dataset.miniLayout).toBeUndefined();
    expect(visibleVar()).toBe('');
    expect(localStorage.getItem(MINI_LAYOUT_STORAGE_KEY)).toBe('game');
    fireEvent.click(layoutBtn('mini.layout.below'));
    expect(lastOptions()?.flipY).toBe(true);
    expect(visibleVar()).toBe(`${PAGE_H}px`);
    unmount();
    expect(html().dataset.miniLayout).toBeUndefined();
    expect(visibleVar()).toBe('');

    // Khoảng trống đáy đã lưu (edgeShift, chung số căn chỉnh): phần thấy lùi lên; phần dưới có dòng nhắc (portal vào body).
    localStorage.setItem(
      MINI_CALIBRATION_STORAGE_KEY,
      JSON.stringify({ ...DEFAULT_CALIBRATION, edgeShift: -100 }),
    );
    const again = renderMini();
    expect(visibleVar()).toBe(`${PAGE_H - 100}px`);
    const rest = document.body.querySelector('.mini-below-rest');
    expect(rest?.textContent).toBe(en('mini.below.rest'));
    expect(root().contains(rest)).toBe(false);
    again.unmount();
    expect(document.body.querySelector('.mini-below-rest')).toBeNull();

    // Phần thấy thấp (≤ 240 px) → hộp thoại gọn (data-mini-short); không bao giờ dưới BELOW_VISIBLE_MIN.
    localStorage.setItem(
      MINI_CALIBRATION_STORAGE_KEY,
      JSON.stringify({ ...DEFAULT_CALIBRATION, edgeShift: -600 }),
    );
    renderMini();
    expect(visibleVar()).toBe(`${Math.max(BELOW_VISIBLE_MIN, PAGE_H - 600)}px`);
    expect(html().dataset.miniShort).toBe('true');
  });

  it('đúng tỉ lệ thật (màn 780 × 360): phần thấy ≈ 93 px; chỉ báo chỉ có "Rộng"; bảng Căn chỉnh ngay dưới hàng vòng', () => {
    device(780, 360, 640, H);
    renderMini();
    expect(root().dataset.scale).toBe('true');
    expect(visibleVar()).toBe('93px');
    expect(html().dataset.miniShort).toBe('true');
    const st = root().querySelector<HTMLElement>('.mini-fit-status')!;
    expect(st.dataset.width).toBeTruthy();
    expect(st.dataset.height).toBeUndefined();
    expect(st.querySelector('[data-dim="width"]')).toBeTruthy();
    expect(st.querySelector('[data-dim="height"]')).toBeNull();
    expect(st.getAttribute('title')).toBe(
      en('mini.fit.numbersWidth', { w: 640, nw: Math.round(8 * GAME_NOTE_STEP_H * 360) }),
    );
    fireEvent.click(alignBtn());
    expect(alignPanel().dataset.below).toBe('true');
    expect(alignPanel().textContent).toContain(en('mini.align.helpBelowScale'));
    expect(alignPanel().querySelector('.mini-fit-status [data-dim="height"]')).toBeNull();
    // Bảng ngay dưới hàng vòng (đã lật): mép trên (H − hitPos) + khe + Ø vòng + 2 px.
    const g = fitGeometry(640, H, lastOptions()?.laneFit ?? null);
    expect(root().style.getPropertyValue('--mini-align-top')).toBe(
      `${Math.ceil(H - g.hitPos + CUE_TARGET_GAP + g.modeD + 2)}px`,
    );
    // Như "Khớp nút game": không còn "Đáy · Dời" (khoảng trống đáy ở hàng trên của panel lúc dừng).
    expect(picks().map((b) => b.textContent)).toEqual([
      'Lines Move',
      'Lines Spacing',
      'Rings Move',
      'Rings Spacing',
    ]);
  });

  it('phần thấy thấp: bảng Căn chỉnh luôn trọn trong khung (được chồng lên hàng vòng)', () => {
    device(780, 360, 640, 90);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement,
    ) {
      const h = this.classList.contains('mini-align') ? 60 : 0;
      return { x: 0, y: 0, top: 0, left: 0, right: 0, bottom: h, width: 0, height: h } as DOMRect;
    });
    renderMini();
    fireEvent.click(alignBtn());
    // Dưới hàng vòng sẽ là 43 px → 43 + 60 > 90: bảng lên 30 px (đáy bảng = đáy khung).
    expect(root().style.getPropertyValue('--mini-align-top')).toBe('30px');
  });

  it('Căn chỉnh (không biết cỡ màn): vạch dẫn lật, KHÔNG có "Đáy · Dời"; vạch đứt ở đáy vẫn có; Đặt lại giữ khoảng trống đáy', () => {
    renderMini();
    fireEvent.click(alignBtn());
    expect(alignPanel().textContent).toContain(en('mini.align.helpBelow'));
    expect(picks().map((b) => b.textContent)).toEqual([
      `${en('mini.align.groupLines')} ${en('mini.align.firstShort')}`,
      `${en('mini.align.groupLines')} ${en('mini.align.lastShort')}`,
      `${en('mini.align.groupRings')} ${en('mini.align.modeShiftShort')}`,
      `${en('mini.align.groupRings')} ${en('mini.align.modeSpacingShort')}`,
    ]);
    for (const b of picks()) {
      expect(b.dataset.field).not.toBe('edgeShift');
      expect(b.textContent).not.toContain(en('mini.gap.label'));
    }
    // Lời nhắc chỉ sang "Đáy ◂ ▸" ở hàng trên (bảng Căn chỉnh che hàng đó → "Xong" trước).
    expect(en('mini.align.helpBelow')).toContain(`"${en('mini.gap.label')} ◂ ▸"`);
    expect(tVi('mini.align.helpBelow')).toContain(`"${tVi('mini.gap.label')} ◂ ▸"`);
    // Đang Căn chỉnh: panel ▶ (và "Đáy ◂ ▸") ẩn.
    expect(gapGroup()).toBeNull();
    const g = fitGeometry(W, H, laneFitOf(DEFAULT_CALIBRATION));
    const guides = root().querySelector<HTMLElement>('.mini-guides')!;
    expect(guides.dataset.flip).toBe('true');
    // Lật: không nhãn số (bảng nằm ngay dưới hàng vòng); mép sáng ở đỉnh; vòng ngay dưới nó (= vòng đích lật).
    expect(guides.dataset.keys).toBe('hidden');
    expect(px(root().querySelector<HTMLElement>('.mini-guide-edge')!.style.top)).toBeCloseTo(0, 6);
    const rings = Array.from(root().querySelectorAll<HTMLElement>('.mini-guide-mode'));
    expect(rings).toHaveLength(4);
    rings.forEach((el, j) => {
      expect(px(el.style.top)).toBeCloseTo(H - g.hitPos + CUE_TARGET_GAP, 6);
      expect(px(el.style.height)).toBeCloseTo(g.modeD, 6);
      expect(px(el.style.left) + px(el.style.width) / 2).toBeCloseTo(g.modeCx[j], 6);
    });
    // 8 vạch vẫn ở tâm 8 lane.
    const lines = Array.from(root().querySelectorAll<HTMLElement>('.mini-guide'));
    lines.forEach((el, i) => expect(px(el.style.left)).toBeCloseTo(g.laneCx[i], 6));
    // Vạch đứt ở đáy phần thấy: lúc dừng, cả trong Căn chỉnh (không còn kiểu "đang chỉnh").
    expect(edgeMark()).toBeTruthy();
    expect(edgeMark()?.dataset.focus).toBeUndefined();
    // Đặt lại mặc định của Căn chỉnh: số căn chỉnh về mặc định, khoảng trống đáy ("Đáy ◂ ▸") giữ nguyên.
    fireEvent.click(screen.getByRole('button', { name: en('mini.align.done') }));
    fireEvent.click(gapMore());
    expect(savedEdge()).toBe(-BELOW_GAP_STEP_PX);
    fireEvent.click(alignBtn());
    fireEvent.click(
      within(alignPanel()).getByRole('button', {
        name: en('mini.align.more', { name: en('mini.align.first') }),
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: en('mini.align.reset') }));
    expect(savedEdge()).toBe(-BELOW_GAP_STEP_PX);
    const saved = JSON.parse(localStorage.getItem(MINI_CALIBRATION_STORAGE_KEY) ?? '{}') as Record<
      string,
      number
    >;
    for (const f of CALIBRATION_FIELDS) {
      if (f !== 'edgeShift') expect(saved[f]).toBe(DEFAULT_CALIBRATION[f]);
    }
    expect(visibleVar()).toBe(`${PAGE_H - BELOW_GAP_STEP_PX}px`);
    // Xong → panel ▶ lại có "Đáy ◂ ▸", vạch đứt vẫn ở đáy phần thấy.
    fireEvent.click(screen.getByRole('button', { name: en('mini.align.done') }));
    expect(gapGroup()).toBeTruthy();
    expect(edgeMark()).toBeTruthy();
  });

  it('"Đáy ◂ ▸": chỉ ở "dưới nút" lúc dừng, ở hàng trên (sau huy hiệu, trước tên bài); chạy / đếm ngược / bố cục khác → không có', () => {
    renderMini();
    const g = gapGroup()!;
    expect(g).toBeTruthy();
    expect(g.parentElement?.classList).toContain('mini-top');
    // Bên trái chỉ có ◂ về + huy hiệu (bề ngang cố định) → nút không xê dịch khi những thứ bên phải đổi bề ngang.
    expect(Array.from(g.parentElement!.children).map((c) => c.className.split(' ').at(-1))).toEqual(
      ['mini-back', 'mini-badge', 'mini-gap', 'mini-title', 'mini-help-btn'],
    );
    expect(g.previousElementSibling?.classList).toContain('mini-badge');
    expect(g.nextElementSibling?.classList).toContain('mini-title');
    // Nhãn "Đáy", ◂, giá trị px, ▸ — theo đúng thứ tự.
    expect(g.querySelector('.mini-gap-label')?.textContent).toBe(en('mini.gap.label'));
    expect(Array.from(g.children).map((c) => c.className.split(' ').at(-1))).toEqual([
      'mini-gap-label',
      'mini-gap-btn',
      'mini-gap-value',
      'mini-gap-btn',
    ]);
    expect(gapLess().textContent).toBe('◂');
    expect(gapMore().textContent).toBe('▸');
    // Tooltip giải thích; tên đọc nói rõ việc làm.
    expect(gapLess().getAttribute('title')).toBe(en('mini.gap.hint'));
    expect(gapMore().getAttribute('title')).toBe(en('mini.gap.hint'));
    expect(g.getAttribute('title')).toBe(en('mini.gap.hint'));
    expect(tVi('mini.gap.label')).toBe('Đáy');
    expect(tVi('mini.gap.less')).toBe('Giảm khoảng trống đáy');
    expect(tVi('mini.gap.more')).toBe('Tăng khoảng trống đáy');
    expect(tVi('mini.gap.hint')).toBe(
      'Khoảng trống ở đáy cửa sổ (phần ra ngoài màn hình). Tăng tới khi thấy trọn bảng nút và làn',
    );
    expect(en('mini.gap.label')).toBe('Bottom');
    // Chạy → không có (panel ẩn), vạch đứt cũng ẩn; tạm dừng → lại có.
    fireEvent.click(screen.getByRole('button', { name: en('mini.start') }));
    expect(root().dataset.phase).toBe('countdown');
    expect(gapGroup()).toBeNull();
    expect(edgeMark()).toBeNull();
    act(() => vi.advanceTimersByTime(3000));
    expect(root().dataset.phase).toBe('playing');
    expect(gapGroup()).toBeNull();
    expect(edgeMark()).toBeNull();
    fireEvent.click(root().querySelector<HTMLButtonElement>('button.mini-tap')!);
    expect(root().dataset.phase).toBe('paused');
    expect(gapGroup()).toBeTruthy();
    expect(edgeMark()).toBeTruthy();
    // "Khớp nút game" / "Thu nhỏ": không có.
    fireEvent.click(layoutBtn('mini.layout.game'));
    expect(gapGroup()).toBeNull();
    expect(edgeMark()).toBeNull();
    fireEvent.click(layoutBtn('mini.layout.compact'));
    expect(gapGroup()).toBeNull();
    fireEvent.click(layoutBtn('mini.layout.below'));
    expect(gapGroup()).toBeTruthy();
  });

  it('"Đáy ◂ ▸" (không biết cỡ màn): ▸ = khoảng trống lớn hơn 8 px, ◂ = nhỏ hơn; lưu theo máy; ◂ tắt ở 0 px, ▸ tắt ở phần thấy thấp nhất', () => {
    const { unmount } = renderMini();
    // Đoán = cả trang → khoảng trống 0: ◂ tắt (aria-disabled — vẫn focus được), ▸ bật.
    expect(gapValue()).toBe('0 px');
    expect(gapLess().getAttribute('aria-disabled')).toBe('true');
    expect(gapMore().getAttribute('aria-disabled')).toBeNull();
    fireEvent.click(gapLess());
    expect(gapValue()).toBe('0 px');
    expect(localStorage.getItem(MINI_CALIBRATION_STORAGE_KEY)).toBeNull();
    fireEvent.click(gapMore());
    expect(gapValue()).toBe(`${BELOW_GAP_STEP_PX} px`);
    expect(visibleVar()).toBe(`${PAGE_H - BELOW_GAP_STEP_PX}px`);
    expect(savedEdge()).toBe(-BELOW_GAP_STEP_PX);
    expect(gapLess().getAttribute('aria-disabled')).toBeNull();
    fireEvent.click(gapMore());
    expect(gapValue()).toBe(`${2 * BELOW_GAP_STEP_PX} px`);
    fireEvent.click(gapLess());
    expect(gapValue()).toBe(`${BELOW_GAP_STEP_PX} px`);
    expect(savedEdge()).toBe(-BELOW_GAP_STEP_PX);
    // Tải lại: giữ số đã lưu.
    unmount();
    const again = renderMini();
    expect(gapValue()).toBe(`${BELOW_GAP_STEP_PX} px`);
    expect(visibleVar()).toBe(`${PAGE_H - BELOW_GAP_STEP_PX}px`);
    again.unmount();
    // ▸ tới đầu: tầm cố định −600 px (trang 768 px → phần thấy 168 px) — chạm cuối bị kẹp vẫn đổi trang, rồi tắt.
    const min = CALIBRATION_RANGES.edgeShift.min;
    localStorage.setItem(
      MINI_CALIBRATION_STORAGE_KEY,
      JSON.stringify({ ...DEFAULT_CALIBRATION, edgeShift: min + 10 }),
    );
    const low = renderMini();
    fireEvent.click(gapMore());
    expect(savedEdge()).toBe(min + 10 - BELOW_GAP_STEP_PX);
    expect(gapMore().getAttribute('aria-disabled')).toBeNull();
    fireEvent.click(gapMore());
    expect(savedEdge()).toBe(min);
    expect(visibleVar()).toBe(`${PAGE_H + min}px`);
    expect(gapValue()).toBe(`${-min} px`);
    expect(gapMore().getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(gapMore());
    expect(savedEdge()).toBe(min);
    low.unmount();
    // ◂ về 0 px (cả trang) rồi tắt.
    localStorage.setItem(
      MINI_CALIBRATION_STORAGE_KEY,
      JSON.stringify({ ...DEFAULT_CALIBRATION, edgeShift: -12 }),
    );
    renderMini();
    expect(gapValue()).toBe('12 px');
    fireEvent.click(gapLess());
    expect(gapValue()).toBe('4 px');
    fireEvent.click(gapLess());
    expect(gapValue()).toBe('0 px');
    expect(visibleVar()).toBe(`${PAGE_H}px`);
    expect(gapLess().getAttribute('aria-disabled')).toBe('true');
    // Về đúng mặc định → khóa căn chỉnh bị xóa (writeCalibration).
    expect(localStorage.getItem(MINI_CALIBRATION_STORAGE_KEY)).toBeNull();
  });

  it('"Đáy ◂ ▸" đúng tỉ lệ thật (màn 780 × 360): bắt đầu từ số đoán; ▸ dừng ở 80 px; số lưu ngoài tầm → lần bấm ◂ đầu đã đổi trang', () => {
    device(780, 360, 640, H);
    const first = renderMini();
    // Đoán ≈ 93 px → khoảng trống = trang 768 − 93.
    expect(visibleVar()).toBe('93px');
    expect(gapValue()).toBe(`${PAGE_H - 93} px`);
    fireEvent.click(gapMore());
    expect(visibleVar()).toBe(`${93 - BELOW_GAP_STEP_PX}px`);
    fireEvent.click(gapMore()); // −16 → kẹp −13 (số lớn nhất còn cho 80 px)
    expect(visibleVar()).toBe(`${BELOW_VISIBLE_MIN}px`);
    expect(gapValue()).toBe(`${PAGE_H - BELOW_VISIBLE_MIN} px`);
    expect(savedEdge()).toBe(-13);
    expect(gapMore().getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(gapMore());
    expect(savedEdge()).toBe(-13);
    first.unmount();

    localStorage.setItem(
      MINI_CALIBRATION_STORAGE_KEY,
      JSON.stringify({ ...DEFAULT_CALIBRATION, edgeShift: -600 }),
    );
    renderMini();
    expect(visibleVar()).toBe(`${BELOW_VISIBLE_MIN}px`);
    expect(gapMore().getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(gapLess());
    expect(savedEdge()).toBe(-13 + BELOW_GAP_STEP_PX);
    expect(visibleVar()).toBe(`${BELOW_VISIBLE_MIN + 8}px`);
  });

  it('"Đáy ◂ ▸" giữ để lặp: sau HOLD_DELAY_MS, nhanh dần; hết tầm thì thôi lặp; click của lần nhả bị bỏ', () => {
    renderMini();
    const more = gapMore();
    fireEvent.pointerDown(more, { button: 0 });
    act(() => vi.advanceTimersByTime(HOLD_DELAY_MS - 1));
    expect(gapValue()).toBe('0 px');
    act(() => vi.advanceTimersByTime(1));
    expect(gapValue()).toBe(`${BELOW_GAP_STEP_PX} px`);
    act(() => vi.advanceTimersByTime(HOLD_REPEAT_MS * (HOLD_FAST_AFTER - 1)));
    expect(gapValue()).toBe(`${HOLD_FAST_AFTER * BELOW_GAP_STEP_PX} px`);
    act(() => vi.advanceTimersByTime(HOLD_REPEAT_MS));
    const held = HOLD_FAST_AFTER * BELOW_GAP_STEP_PX + BELOW_GAP_FAST_PX;
    expect(gapValue()).toBe(`${held} px`);
    fireEvent.pointerUp(more);
    fireEvent.click(more);
    act(() => vi.advanceTimersByTime(HOLD_REPEAT_MS * 5));
    expect(gapValue()).toBe(`${held} px`);
    // Giữ ◂ tới 0 px: dừng ở 0, ◂ tắt.
    const less = gapLess();
    fireEvent.pointerDown(less, { button: 0 });
    act(() => vi.advanceTimersByTime(HOLD_DELAY_MS + HOLD_REPEAT_MS * 40));
    expect(gapValue()).toBe('0 px');
    expect(less.getAttribute('aria-disabled')).toBe('true');
    fireEvent.pointerUp(less);
    fireEvent.click(less);
    expect(gapValue()).toBe('0 px');
  });

  it('dòng nhắc dưới phần thấy chỉ lúc dừng (đếm ngược / chạy → ẩn, tạm dừng → lại có); nói cả cách sửa bằng ◂ của "Đáy ◂ ▸"', () => {
    localStorage.setItem(
      MINI_CALIBRATION_STORAGE_KEY,
      JSON.stringify({ ...DEFAULT_CALIBRATION, edgeShift: -100 }),
    );
    renderMini();
    const rest = () => document.body.querySelector('.mini-below-rest');
    expect(rest()).toBeTruthy();
    // Chỉ sang ◂ của "Đáy ◂ ▸" ở hàng trên (không còn Căn chỉnh → "Đáy · Dời").
    expect(en('mini.below.rest')).toContain(`◂ in "${en('mini.gap.label')} ◂ ▸"`);
    expect(tVi('mini.below.rest')).toContain(`◂ ở "${tVi('mini.gap.label')} ◂ ▸"`);
    expect(en('mini.below.rest')).not.toContain(en('mini.align.open'));
    fireEvent.click(screen.getByRole('button', { name: en('mini.start') }));
    expect(root().dataset.phase).toBe('countdown');
    expect(rest()).toBeNull();
    act(() => vi.advanceTimersByTime(3000));
    expect(root().dataset.phase).toBe('playing');
    expect(rest()).toBeNull();
    fireEvent.click(root().querySelector<HTMLButtonElement>('button.mini-tap')!);
    expect(root().dataset.phase).toBe('paused');
    expect(rest()).toBeTruthy();
  });

  it('kiểu PC: [Vạch · Nút 1 | Vạch · Nút 1̇], không vòng; banner giữ phím vẫn có; "Đáy ◂ ▸" vẫn ở hàng trên', () => {
    useSettings.getState().set({ controlScheme: 'pc' });
    const { container } = renderMini();
    expect(root().dataset.layout).toBe('below');
    expect(lastOptions()?.flipY).toBe(true);
    expect(container.querySelector('.mini-banner')).toBeTruthy();
    expect(gapGroup()?.parentElement?.classList).toContain('mini-top');
    fireEvent.click(alignBtn());
    expect(picks()).toHaveLength(2);
    expect(root().querySelectorAll('.mini-guide-mode')).toHaveLength(0);
    expect(alignPanel().textContent).toContain(en('mini.align.helpBelowPc'));
  });

  it('chọn số thuần: không bố cục / kiểu nào có số edgeShift trong Căn chỉnh', () => {
    for (const scheme of ['mobile', 'pc'] as const) {
      for (const scaled of [false, true]) {
        const fields = alignControlsFor(scheme, scaled).map((c) => c.field);
        expect(fields).not.toContain('edgeShift');
        expect(fields).toHaveLength(scheme === 'mobile' ? 4 : 2);
      }
    }
    expect(alignFocusOf('modeShift')).toBe('rings');
    expect(alignFocusOf('shift')).toBe('lines');
  });
});

describe('hướng dẫn ⓘ: "Bố cục nên dùng theo máy" (D-448)', () => {
  it('panel ▶: danh sách theo máy đứng đầu hộp thoại; giữ các lưu ý cũ theo hãng', () => {
    renderMini();
    fireEvent.click(screen.getByRole('button', { name: en('mini.help') }));
    const dialog = screen.getByRole('dialog', { name: en('mini.helpTitle') });
    const help = dialog.querySelector<HTMLElement>('.mini-help')!;
    expect(help.firstElementChild?.classList).toContain('mini-help-device-part');
    expect(
      within(dialog).getByRole('heading', { name: en('mini.help.devicesTitle') }),
    ).toBeTruthy();
    expect(
      Array.from(dialog.querySelectorAll('.mini-help-device-title')).map((h) => h.textContent),
    ).toEqual(MINI_HELP_DEVICES.map((d) => en(d.title)));
    for (const d of MINI_HELP_DEVICES) {
      expect(within(dialog).getByRole('heading', { name: en(d.title) })).toBeTruthy();
      expect(within(dialog).getByText(en(d.body))).toBeTruthy();
    }
    // Điện thoại Samsung → "dưới nút"; máy tính bảng / máy gập → "Khớp nút game"; hãng Trung Quốc → "Thu nhỏ" + cảnh báo.
    expect(en('mini.help.device.samsungPhone.title')).toContain(en('mini.layout.below'));
    expect(en('mini.help.device.tablet.title')).toContain(en('mini.layout.game'));
    expect(en('mini.help.device.chinaPhone.title')).toContain(en('mini.layout.compact'));
    for (const brand of ['Xiaomi', 'OPPO', 'realme', 'OnePlus', 'vivo', 'Honor', 'Huawei']) {
      expect(en('mini.help.device.chinaPhone.title')).toContain(brand);
    }
    expect(en('mini.help.device.chinaPhone')).toContain('cannot be stretched');
    // Lưu ý cũ vẫn còn nguyên.
    expect(en('mini.help.oppo')).toContain('quick-hide');
    expect(en('mini.help.oppo')).toContain('OnePlus');
    expect(en('mini.help.samsung')).toContain('Multi Focus');
    expect(en('mini.help.samsung')).toContain('Game Booster');
    expect(within(dialog).getByText(en('mini.tip.gyro'))).toBeTruthy();
    expect(within(dialog).getByText(en('mini.tip.risk'))).toBeTruthy();
  });

  it('ⓘ của Căn chỉnh: đoạn nút chọn đầu tiên, rồi danh sách theo máy, rồi cách kéo theo hãng', () => {
    renderMini();
    fireEvent.click(alignBtn());
    fireEvent.click(screen.getByRole('button', { name: en('mini.align.windowHelp') }));
    const dialog = screen.getByRole('dialog', { name: en('mini.help.fitTitle') });
    const controls = dialog.querySelector('.mini-help-controls')!;
    expect(controls.textContent).toBe(en('mini.help.fit.controls'));
    expect(controls.textContent).toContain('"Bottom ◂ ▸"');
    expect(controls.textContent).not.toContain('Bottom · Move');
    expect(controls.nextElementSibling?.classList).toContain('mini-help-device-part');
    expect(
      Array.from(dialog.querySelectorAll('.mini-help-vendor-title'))
        .slice(0, MINI_HELP_FIT_VENDORS.length)
        .map((h) => h.textContent),
    ).toEqual(MINI_HELP_FIT_VENDORS.map((v) => en(v.title)));
    // Chỉ một danh sách theo máy trong hộp thoại.
    expect(dialog.querySelectorAll('.mini-help-device-part')).toHaveLength(1);
  });

  it('"Khớp nút game" đúng tỉ lệ thật, "Cao quá": tooltip nhắc điện thoại Samsung dùng "dưới nút"', () => {
    localStorage.setItem(MINI_LAYOUT_STORAGE_KEY, 'game');
    device(915, 412, 700, 220);
    renderMini();
    const st = root().querySelector<HTMLElement>('.mini-fit-status')!;
    expect(st.dataset.height).toBe('tall');
    expect(st.getAttribute('title')).toContain(en('mini.fit.height.tallHint'));
    expect(en('mini.fit.height.tallHint')).toContain(en('mini.layout.below'));
    // :root không bị đụng ở bố cục này.
    expect(html().dataset.miniLayout).toBeUndefined();
  });
});

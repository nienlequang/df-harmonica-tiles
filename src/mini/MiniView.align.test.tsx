/**
 * Trang mini — bố cục "Khớp nút game" (mặc định của kiểu Mobile, góp ý 2026-10-16) / "Thu nhỏ" (mặc định của kiểu
 * PC, D-402) + "Căn chỉnh": không bàn nút / banner riêng, lane theo nút thật (renderer `lanePadding: 'fit'` +
 * `laneFit`), vạch căn chỉnh đặt bằng cùng `fitGeometry`, bảng chỉnh một số mỗi lúc (D-399): chọn số → thanh trượt /
 * nút − + (theo px, giữ để lặp — D-400) đổi hình học và lưu theo máy, "Đặt lại mặc định", chỉ khi đang dừng.
 */
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StringKey } from '../i18n/strings';
import { translateCount } from '../i18n/useT';
import { OverlayEngine } from '../overlay/overlayEngine';
import { GAME_MODE_COLUMNS, fitGeometry } from '../player/layout';
import { MOBILE_BUTTONS } from '../player/mobilePlan';
import type { RendererOptions } from '../player/renderer';
import { useSettings } from '../ui/settings';
import {
  GUIDE_KEY_GAP,
  GUIDE_KEY_H,
  HOLD_DELAY_MS,
  HOLD_FAST_AFTER,
  HOLD_REPEAT_MS,
  guideKeyTop,
} from './MiniCalibrate';
import {
  DEFAULT_CALIBRATION,
  MINI_CALIBRATION_STORAGE_KEY,
  MINI_FIT_NOTICE_STORAGE_KEY,
  MINI_LAYOUT_STORAGE_KEY,
  GAME_NOTE_STEP_H,
  NUDGE_FAST_PX,
  laneFitOf,
} from './miniAlign';
import { MINI_SONG_STORAGE_KEY } from './miniControl';
import { MINI_HELP_FIT_VENDORS } from './MiniHelp';
import { MiniView } from './MiniView';

const en = (key: StringKey, params?: Record<string, string | number>) =>
  translateCount('en', key, params);

const SEED = 'seed-quoc-ca-viet-nam';
const W = 960;
const H = 300;

function renderMini(query = '') {
  return render(<MiniView songId={SEED} query={new URLSearchParams(query)} />);
}

const root = () => screen.getByRole('region', { name: en('mini.region') });
const playBtn = () => screen.getByRole('button', { name: new RegExp(en('mini.start')) });
const alignBtn = () => screen.getByRole('button', { name: en('mini.align.open') });
const layoutBtn = (key: StringKey) => screen.getByRole('button', { name: en(key) });
const guides = () => Array.from(root().querySelectorAll<HTMLElement>('.mini-guide'));
const modes = () => Array.from(root().querySelectorAll<HTMLElement>('.mini-guide-mode'));
const px = (v: string) => Number.parseFloat(v);
const alignPanel = () => screen.getByRole('group', { name: en('mini.align.region') });
/** Dòng trên của nút chọn (D-416): "Vòng" cho hàng nút chế độ, "Vạch" cho mọi số còn lại. */
const groupOf = (short: StringKey): StringKey =>
  short === 'mini.align.modeShiftShort' || short === 'mini.align.modeSpacingShort'
    ? 'mini.align.groupRings'
    : 'mini.align.groupLines';
/** Chữ (= tên đọc) của nút chọn: "Lines Move", "Rings Spacing", "Lines Btn 1"… */
const pickName = (short: StringKey) => `${en(groupOf(short))} ${en(short)}`;
/** Nút chọn số cần chỉnh trong bảng Căn chỉnh. */
const pick = (short: StringKey) =>
  within(screen.getByRole('group', { name: en('mini.align.pick') })).getByRole('button', {
    name: pickName(short),
  });
const slider = (key: StringKey) => within(alignPanel()).getByRole('slider', { name: en(key) });
const nudge = (dir: 'less' | 'more', key: StringKey) =>
  within(alignPanel()).getByRole('button', {
    name: en(dir === 'less' ? 'mini.align.less' : 'mini.align.more', { name: en(key) }),
  });
const value = () => alignPanel().querySelector('.mini-align-value')?.textContent;

/** Option renderer cuối cùng trang mini gửi cho engine. */
let lastOptions: () => Partial<RendererOptions> | undefined;

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal(
    'requestAnimationFrame',
    vi.fn(() => 1),
  );
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => null);
  // Vùng làn đo được (jsdom không layout): cửa sổ nổi 960 × 300.
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => W });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
    configurable: true,
    get: () => H,
  });
  const spy = vi.spyOn(OverlayEngine.prototype, 'setRendererOptions');
  lastOptions = () => spy.mock.calls.at(-1)?.[0];
  useSettings.getState().reset();
  useSettings.getState().set({ language: 'en' });
});

afterEach(() => {
  delete (HTMLElement.prototype as unknown as Record<string, unknown>).clientWidth;
  delete (HTMLElement.prototype as unknown as Record<string, unknown>).clientHeight;
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('bố cục "Khớp nút game"', () => {
  it.each(['pc', 'mobile'] as const)(
    '%s: không bàn nút / game bar riêng, lane theo nút thật, nhãn làn nhỏ ở đỉnh',
    (scheme) => {
      useSettings.getState().set({ controlScheme: scheme });
      // PC mặc định là "Thu nhỏ" (D-402) → chọn sẵn "Khớp nút game".
      localStorage.setItem(MINI_LAYOUT_STORAGE_KEY, 'game');
      const { container } = renderMini();
      expect(root().dataset.layout).toBe('game');
      expect(container.querySelector('.game-bar, .mpad')).toBeNull();
      expect(screen.queryByRole('group', { name: en('player.gameBar') })).toBeNull();
      const o = lastOptions();
      expect(o?.lanePadding).toBe('fit');
      expect(o?.laneFit).toEqual(laneFitOf(DEFAULT_CALIBRATION));
      expect(o?.scheme).toBe(scheme);
      // Nhãn làn nhỏ ở tâm 8 nút số (cùng fitGeometry với renderer), chỉ để nhìn.
      const g = fitGeometry(W, H, laneFitOf(DEFAULT_CALIBRATION));
      const labels = Array.from(container.querySelectorAll<HTMLElement>('.mini-fit-label'));
      expect(labels).toHaveLength(8);
      labels.forEach((el, i) => expect(px(el.style.left)).toBeCloseTo(g.laneCx[i], 6));
      expect(container.querySelector('.mini-fit-labels')?.getAttribute('aria-hidden')).toBe('true');
      expect(labels[0].textContent).toContain(scheme === 'mobile' ? '1' : 'Z');
      // Hai nút bố cục kiểu bật / tắt; Căn chỉnh có ở bố cục này.
      expect(layoutBtn('mini.layout.game').getAttribute('aria-pressed')).toBe('true');
      expect(layoutBtn('mini.layout.compact').getAttribute('aria-pressed')).toBe('false');
      expect(screen.getByRole('group', { name: en('mini.layout.group') })).toBeTruthy();
      expect(alignBtn()).toBeTruthy();
      // D-403: Mobile không có banner chế độ (nằm chắn đường rơi vòng "CHẠM"); PC giữ banner giữ phím.
      expect(container.querySelector('.mini-banner') === null).toBe(scheme === 'mobile');
    },
  );

  it('chưa chọn bố cục: Mobile → "Khớp nút game", PC → "Thu nhỏ" (game bar như trang mini cũ)', () => {
    useSettings.getState().set({ controlScheme: 'mobile' });
    const { unmount } = renderMini();
    expect(root().dataset.layout).toBe('game');
    unmount();
    useSettings.getState().set({ controlScheme: 'pc' });
    const { container } = renderMini();
    expect(root().dataset.layout).toBe('compact');
    expect(container.querySelector('.game-bar.mini-pad')).toBeTruthy();
    expect(lastOptions()?.lanePadding).toBe('none');
    expect(localStorage.getItem(MINI_LAYOUT_STORAGE_KEY)).toBeNull();
  });

  it('kiểu PC: dòng "Playing on a phone?" + "Switch to Mobile" → kiểu Mobile, khớp nút game (chưa chọn bố cục)', () => {
    useSettings.getState().set({ controlScheme: 'pc' });
    renderMini();
    const panel = root().querySelector<HTMLElement>('.mini-panel')!;
    expect(panel.dataset.note).toBe('pc');
    expect(within(panel).getByText(en('mini.scheme.pcNote'))).toBeTruthy();
    const btn = within(panel).getByRole('button', { name: en('mini.scheme.toMobile') });
    expect(btn.getAttribute('title')).toBe(en('mini.scheme.toMobileHint'));
    fireEvent.click(btn);
    expect(useSettings.getState().controlScheme).toBe('mobile');
    expect(root().dataset.scheme).toBe('mobile');
    expect(root().dataset.layout).toBe('game');
    // Kiểu Mobile: không còn dòng nhắc.
    expect(root().querySelector('.mini-scheme')).toBeNull();
    expect(root().querySelector<HTMLElement>('.mini-panel')?.dataset.note).toBeUndefined();
  });

  it('"Thu nhỏ" → trang mini cũ (bàn nút riêng), nhớ theo máy; "Khớp nút game" → lại như trên', () => {
    useSettings.getState().set({ controlScheme: 'mobile' });
    const { unmount } = renderMini();
    fireEvent.click(layoutBtn('mini.layout.compact'));
    expect(root().dataset.layout).toBe('compact');
    expect(localStorage.getItem(MINI_LAYOUT_STORAGE_KEY)).toBe('compact');
    expect(screen.getByRole('group', { name: en('player.gameBar') }).classList).toContain('mpad');
    expect(lastOptions()?.lanePadding).toBe('pad');
    expect(screen.queryByRole('button', { name: en('mini.align.open') })).toBeNull();
    expect(root().querySelector('.mini-fit-labels')).toBeNull();
    // "Thu nhỏ" giữ banner chế độ như trang mini cũ.
    expect(root().querySelector('.mini-banner')).toBeTruthy();
    unmount();
    // Mở lại: nhớ "Thu nhỏ".
    renderMini();
    expect(root().dataset.layout).toBe('compact');
    fireEvent.click(layoutBtn('mini.layout.game'));
    expect(root().dataset.layout).toBe('game');
    expect(localStorage.getItem(MINI_LAYOUT_STORAGE_KEY)).toBe('game');
    expect(root().querySelector('.mpad')).toBeNull();
    expect(lastOptions()?.lanePadding).toBe('fit');
  });

  it('đếm ngược tối thiểu 3 s, nút "◂" chỉ khi dừng — như bố cục cũ', () => {
    useSettings.getState().set({ startDelaySec: 0, controlScheme: 'mobile' });
    renderMini();
    expect(root().dataset.layout).toBe('game');
    expect(screen.getByRole('link', { name: en('mini.back') })).toBeTruthy();
    fireEvent.click(playBtn());
    expect(screen.getByRole('status').textContent).toContain(en('player.countdownAria', { n: 3 }));
    expect(screen.queryByRole('link', { name: en('mini.back') })).toBeNull();
    expect(screen.queryByRole('button', { name: en('mini.align.open') })).toBeNull();
    act(() => vi.advanceTimersByTime(3000));
    expect(root().dataset.phase).toBe('playing');
  });

  it('nút video: tên đọc đầy đủ, chữ ngắn chứa trong tên (cửa sổ thấp hiện chữ ngắn)', () => {
    useSettings.getState().set({ controlScheme: 'mobile' });
    renderMini();
    const video = screen.getByRole('button', { name: en('mini.video.button') });
    expect(video.querySelector('.mini-short')?.textContent).toBe(en('mini.video.buttonShort'));
    expect(en('mini.video.button').toLowerCase()).toContain(
      en('mini.video.buttonShort').toLowerCase(),
    );
  });
});

describe('Căn chỉnh', () => {
  it('mở (chỉ khi dừng): 8 vạch đúng tâm lane + 4 vòng nút chế độ đúng chỗ vòng "CHẠM" đáp', () => {
    useSettings.getState().set({ controlScheme: 'mobile' });
    renderMini();
    fireEvent.click(alignBtn());
    expect(root().dataset.aligning).toBe('true');
    const panel = alignPanel();
    // Panel ▶ thay bằng bảng Căn chỉnh; focus vào nút chọn đầu ("Nút 1" — luôn thấy, kể cả cửa sổ thấp).
    expect(root().querySelector('.mini-panel')).toBeNull();
    expect(document.activeElement).toBe(pick('mini.align.firstShort'));
    // Chọn một số mỗi lúc: 4 nút chọn (Mobile), một thanh trượt của số đang chọn.
    const choices = within(screen.getByRole('group', { name: en('mini.align.pick') })).getAllByRole(
      'button',
    );
    expect(choices.map((b) => b.textContent)).toEqual([
      pickName('mini.align.firstShort'),
      pickName('mini.align.lastShort'),
      pickName('mini.align.modeShiftShort'),
      pickName('mini.align.modeSpacingShort'),
    ]);
    // Hai dòng: CÁI GÌ (Lines / Rings) + THẾ NÀO.
    expect(choices.map((b) => b.querySelector('.mini-pick-what')?.textContent)).toEqual([
      'Lines',
      'Lines',
      'Rings',
      'Rings',
    ]);
    expect(choices.map((b) => b.getAttribute('aria-pressed'))).toEqual([
      'true',
      'false',
      'false',
      'false',
    ]);
    expect(choices[2].getAttribute('title')).toBe(en('mini.align.modeShift'));
    expect(within(panel).getAllByRole('slider')).toHaveLength(1);
    expect(slider('mini.align.first')).toBeTruthy();
    const g = fitGeometry(W, H, laneFitOf(DEFAULT_CALIBRATION));
    expect(guides()).toHaveLength(8);
    guides().forEach((el, i) => expect(px(el.style.left)).toBeCloseTo(g.laneCx[i], 6));
    expect(modes()).toHaveLength(4);
    modes().forEach((el, j) => {
      expect(el.dataset.mode).toBe(MOBILE_BUTTONS[j]);
      expect(px(el.style.left) + px(el.style.width) / 2).toBeCloseTo(g.modeCx[j], 6);
      expect(px(el.style.width)).toBeCloseTo(g.modeD, 6);
      // Đáy vòng = hit line − 1 (vòng đích của renderer, cueTargets).
      expect(px(el.style.top) + px(el.style.height)).toBeCloseTo(g.hitPos - 1, 6);
    });
    expect(modes()[1].textContent).toBe('Look Up');
    // Nhãn số ngay trên hàng vòng (jsdom: bảng cao 0 → luôn còn chỗ).
    const guidesEl = root().querySelector<HTMLElement>('.mini-guides')!;
    expect(guidesEl.dataset.keys).toBeUndefined();
    expect(px(guidesEl.style.getPropertyValue('--mini-key-top'))).toBeCloseTo(
      g.hitPos - 1 - g.modeD - GUIDE_KEY_GAP - GUIDE_KEY_H,
      6,
    );
    // Lớp chạm khóa: chạm nhầm khi kéo cửa sổ không chạy bài; Space cũng không.
    expect(root().querySelector<HTMLButtonElement>('button.mini-tap')?.disabled).toBe(true);
    fireEvent.keyDown(window, { code: 'Space', key: ' ' });
    expect(root().dataset.phase).toBe('ready');
  });

  it('chọn số → thanh trượt / nút − + đổi vạch + option renderer ngay (theo px), lưu theo máy; Đặt lại mặc định', () => {
    useSettings.getState().set({ controlScheme: 'mobile' });
    const { unmount } = renderMini();
    fireEvent.click(alignBtn());
    fireEvent.change(slider('mini.align.first'), { target: { value: '0.1' } });
    fireEvent.click(pick('mini.align.lastShort'));
    expect(pick('mini.align.lastShort').getAttribute('aria-pressed')).toBe('true');
    expect(within(alignPanel()).queryByRole('slider', { name: en('mini.align.first') })).toBeNull();
    fireEvent.change(slider('mini.align.last'), { target: { value: '0.8' } });
    expect(px(guides()[0].style.left)).toBeCloseTo(0.1 * W, 6);
    expect(px(guides()[7].style.left)).toBeCloseTo(0.8 * W, 6);
    const step = (0.7 * W) / 7;
    expect(px(guides()[3].style.left) - px(guides()[2].style.left)).toBeCloseTo(step, 6);
    expect(lastOptions()?.laneFit).toMatchObject({ first: 0.1, last: 0.8 });
    // Hàng chế độ: dời +0.5 cột → cả 4 vòng dời nửa bước.
    fireEvent.click(pick('mini.align.modeShiftShort'));
    fireEvent.change(slider('mini.align.modeShift'), { target: { value: '0.5' } });
    modes().forEach((el, j) =>
      expect(px(el.style.left) + px(el.style.width) / 2).toBeCloseTo(
        0.1 * W + (GAME_MODE_COLUMNS[j] + 0.5) * step,
        4,
      ),
    );
    expect(value()).toBe('+0.50 col');
    // Nút + của "Nút 1": dời đúng 1 px của khung (D-400); giá trị hiện cạnh thanh trượt.
    fireEvent.click(pick('mini.align.firstShort'));
    const x0 = px(guides()[0].style.left);
    fireEvent.click(nudge('more', 'mini.align.first'));
    expect(px(guides()[0].style.left) - x0).toBeCloseTo(1, 1);
    expect(value()).toBe('10.1 %');
    const saved = JSON.parse(localStorage.getItem(MINI_CALIBRATION_STORAGE_KEY) ?? 'null') as {
      first: number;
      last: number;
      modeShift: number;
    };
    expect(saved).toMatchObject({ first: 0.101, last: 0.8, modeShift: 0.5 });
    // Mở lại trang: vẫn số đã lưu.
    unmount();
    renderMini();
    expect(lastOptions()?.laneFit).toMatchObject({ first: 0.101, last: 0.8 });
    fireEvent.click(alignBtn());
    expect(px(guides()[0].style.left)).toBeCloseTo(0.101 * W, 6);
    // Đặt lại mặc định: số đo ảnh game, khóa lưu bị xóa.
    const reset = screen.getByRole('button', { name: en('mini.align.reset') });
    expect(reset.querySelector('.mini-short')?.textContent).toBe(en('mini.align.resetShort'));
    fireEvent.click(reset);
    const g = fitGeometry(W, H, laneFitOf(DEFAULT_CALIBRATION));
    guides().forEach((el, i) => expect(px(el.style.left)).toBeCloseTo(g.laneCx[i], 6));
    expect(localStorage.getItem(MINI_CALIBRATION_STORAGE_KEY)).toBeNull();
    expect(lastOptions()?.laneFit).toEqual(laneFitOf(DEFAULT_CALIBRATION));
  });

  it('giữ nút − / +: lặp sau HOLD_DELAY_MS, nhanh dần; nhả → dừng, không thêm bước của click', () => {
    useSettings.getState().set({ controlScheme: 'mobile' });
    renderMini();
    fireEvent.click(alignBtn());
    const plus = nudge('more', 'mini.align.first');
    const x = () => px(guides()[0].style.left);
    const x0 = x();
    fireEvent.pointerDown(plus, { button: 0 });
    act(() => vi.advanceTimersByTime(HOLD_DELAY_MS - 1));
    expect(x()).toBe(x0); // chưa lặp
    act(() => vi.advanceTimersByTime(1)); // lần lặp 1: 1 px
    expect(x() - x0).toBeCloseTo(1, 1);
    act(() => vi.advanceTimersByTime(HOLD_REPEAT_MS * (HOLD_FAST_AFTER - 1))); // tới lần 6: 1 px mỗi lần
    expect(x() - x0).toBeCloseTo(HOLD_FAST_AFTER, 0);
    act(() => vi.advanceTimersByTime(HOLD_REPEAT_MS)); // lần 7: bước nhanh
    expect(x() - x0).toBeCloseTo(HOLD_FAST_AFTER + NUDGE_FAST_PX, 0);
    const held = x();
    fireEvent.pointerUp(plus);
    fireEvent.click(plus); // click của lần nhả: bỏ
    act(() => vi.advanceTimersByTime(HOLD_REPEAT_MS * 5));
    expect(x()).toBe(held);
    // Chạm thường sau đó: đúng một bước.
    fireEvent.click(plus);
    expect(x() - held).toBeCloseTo(1, 1);
    // Trượt ra ngoài khi đang giữ: dừng; không có click → lần bấm phím sau vẫn tính.
    fireEvent.pointerDown(plus, { button: 0 });
    act(() => vi.advanceTimersByTime(HOLD_DELAY_MS + HOLD_REPEAT_MS));
    fireEvent.pointerLeave(plus);
    act(() => vi.advanceTimersByTime(HOLD_REPEAT_MS * 5));
    const left = x();
    fireEvent.click(plus);
    expect(x() - left).toBeCloseTo(1, 1);
    // Nút phải (chuột giữa / phải) không lặp.
    fireEvent.pointerDown(plus, { button: 2 });
    act(() => vi.advanceTimersByTime(HOLD_DELAY_MS * 3));
    expect(x() - left).toBeCloseTo(1, 1);
  });

  it('nhãn số của vạch không bao giờ nằm sau bảng Căn chỉnh: hết chỗ → ẩn', () => {
    // Cửa sổ 624 × 100 (đặt ngay trên bảng nút): bảng một hàng 38 px → còn chỗ? (vòng Ø 42, đỉnh ở 55.)
    const g = fitGeometry(624, 100, laneFitOf(DEFAULT_CALIBRATION));
    const top = guideKeyTop(g, 'mobile', 0);
    expect(top).toBeCloseTo(g.hitPos - 1 - g.modeD - GUIDE_KEY_GAP - GUIDE_KEY_H, 6);
    expect(guideKeyTop(g, 'mobile', 38)).toBeNull();
    // PC không có vòng: nhãn ngay trên mép dưới.
    expect(guideKeyTop(g, 'pc', 38)).toBeCloseTo(g.hitPos - 2 - GUIDE_KEY_GAP - GUIDE_KEY_H, 6);
    // Cửa sổ 546 × 119: vẫn còn chỗ dưới bảng 38 px.
    const g2 = fitGeometry(546, 119, laneFitOf(DEFAULT_CALIBRATION));
    expect(guideKeyTop(g2, 'mobile', 38)).not.toBeNull();

    // Trong trang: bảng đo được cao gần hết khung → data-keys="hidden".
    useSettings.getState().set({ controlScheme: 'mobile' });
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement,
    ) {
      const h = this.classList.contains('mini-align') ? H - 60 : 0;
      return { x: 0, y: 0, top: 0, left: 0, right: 0, bottom: h, width: 0, height: h } as DOMRect;
    });
    renderMini();
    fireEvent.click(alignBtn());
    expect(root().querySelector<HTMLElement>('.mini-guides')?.dataset.keys).toBe('hidden');
    // Vạch + vòng vẫn đủ.
    expect(guides()).toHaveLength(8);
    expect(modes()).toHaveLength(4);
  });

  it('Xong / Esc: về panel ▶, focus lại nút Căn chỉnh; kiểu PC chỉ có 2 số, không vòng chế độ', () => {
    localStorage.setItem(MINI_LAYOUT_STORAGE_KEY, 'game');
    renderMini();
    fireEvent.click(alignBtn());
    const panel = alignPanel();
    expect(
      within(screen.getByRole('group', { name: en('mini.align.pick') })).getAllByRole('button'),
    ).toHaveLength(2);
    expect(modes()).toHaveLength(0);
    expect(guides()[0].textContent).toBe('Z');
    expect(panel.textContent).toContain(en('mini.align.helpPc'));
    fireEvent.click(within(panel).getByRole('button', { name: en('mini.align.done') }));
    expect(root().dataset.aligning).toBeUndefined();
    expect(guides()).toHaveLength(0);
    expect(document.activeElement).toBe(alignBtn());
    // Esc trên thanh trượt (useHotkeys bỏ qua ô nhập) cũng thoát.
    fireEvent.click(alignBtn());
    fireEvent.keyDown(slider('mini.align.first'), { key: 'Escape', code: 'Escape' });
    expect(root().dataset.aligning).toBeUndefined();
    // Esc khi focus ngoài ô nhập.
    fireEvent.click(alignBtn());
    act(() => (document.activeElement as HTMLElement | null)?.blur());
    fireEvent.keyDown(window, { key: 'Escape', code: 'Escape' });
    expect(root().dataset.aligning).toBeUndefined();
    // Sau khi thoát, Space lại chạy bài.
    act(() => (document.activeElement as HTMLElement | null)?.blur());
    fireEvent.keyDown(window, { code: 'Space', key: ' ' });
    expect(root().dataset.phase).toBe('countdown');
  });

  it('ⓘ của Căn chỉnh: hướng dẫn kéo / đổi cỡ cửa sổ theo hãng lên đầu', () => {
    useSettings.getState().set({ controlScheme: 'mobile' });
    renderMini();
    fireEvent.click(alignBtn());
    fireEvent.click(screen.getByRole('button', { name: en('mini.align.windowHelp') }));
    const dialog = screen.getByRole('dialog', { name: en('mini.help.fitTitle') });
    const headings = Array.from(dialog.querySelectorAll('.mini-help-vendor-title')).map(
      (h) => h.textContent,
    );
    expect(headings.slice(0, MINI_HELP_FIT_VENDORS.length)).toEqual(
      MINI_HELP_FIT_VENDORS.map((v) => en(v.title)),
    );
    expect(within(dialog).getByText(en('mini.help.fit.samsung'))).toBeTruthy();
    // Phần mở cửa sổ nổi vẫn có (sau).
    expect(within(dialog).getByText(en('mini.help.samsung'))).toBeTruthy();
    fireEvent.keyDown(window, { key: 'Escape', code: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    // Đóng hộp thoại không thoát Căn chỉnh.
    expect(root().dataset.aligning).toBe('true');
  });

  it('ⓘ của panel ▶: hướng dẫn mở cửa sổ nổi trước, kèm phần đặt cửa sổ khớp nút game', () => {
    renderMini();
    fireEvent.click(screen.getByRole('button', { name: en('mini.help') }));
    const dialog = screen.getByRole('dialog', { name: en('mini.helpTitle') });
    expect(within(dialog).getByRole('heading', { name: en('mini.help.fitTitle') })).toBeTruthy();
    for (const v of MINI_HELP_FIT_VENDORS) {
      expect(within(dialog).getByRole('heading', { name: en(v.title) })).toBeTruthy();
    }
  });
});

// ---------------------------------------------------------------------------
// Nhắc một lần đổi cỡ cửa sổ — máy dùng trang mini trước v1.0.1 (D-441)
// ---------------------------------------------------------------------------

describe('nhắc "kéo rộng thêm ¼ nút" (máy dùng trang mini trước v1.0.1, kiểu "cửa sổ = 8 làn" — D-441)', () => {
  const notice = () => screen.queryByRole('button', { name: en('mini.fit.notice') });
  /** Máy đã mở trang mini ở bản 1.0.0: có bài mở lần trước, số căn chỉnh mặc định (không lưu). */
  const legacyDevice = () => localStorage.setItem(MINI_SONG_STORAGE_KEY, SEED);

  it('máy cũ, Khớp nút game, không biết cỡ màn → nhắc ở chỗ chỉ báo (trước ⓘ); chạm → hướng dẫn đặt cửa sổ, không nhắc lại', () => {
    legacyDevice();
    useSettings.getState().set({ controlScheme: 'mobile' });
    const { unmount } = renderMini();
    expect(root().dataset.layout).toBe('game');
    expect(root().dataset.scale).toBeUndefined();
    const btn = notice()!;
    expect(btn).toBeTruthy();
    const slot = btn.parentElement!;
    expect(slot.parentElement?.classList).toContain('mini-top');
    expect(slot.nextElementSibling?.classList).toContain('mini-help-btn');
    // Chữ ngắn (cửa sổ hẹp) nằm trong tên đọc (WCAG 2.5.3); tooltip giải thích.
    expect(en('mini.fit.notice').toLowerCase()).toContain(en('mini.fit.noticeShort').toLowerCase());
    expect(btn.getAttribute('title')).toBe(en('mini.fit.noticeHint'));
    // Chưa chạm: chưa ghi dấu (lần mở sau vẫn nhắc).
    expect(localStorage.getItem(MINI_FIT_NOTICE_STORAGE_KEY)).toBeNull();
    fireEvent.click(btn);
    const dialog = screen.getByRole('dialog', { name: en('mini.help.fitTitle') });
    expect(within(dialog).getByText(en('mini.help.fitIntro'))).toBeTruthy();
    expect(notice()).toBeNull();
    expect(localStorage.getItem(MINI_FIT_NOTICE_STORAGE_KEY)).toBe('1');
    unmount();
    renderMini();
    expect(notice()).toBeNull();
  });

  it('máy mới (chưa từng mở trang mini) → không nhắc, ghi dấu ngay; lần mở sau (đã có bài mở lần trước) vẫn không', () => {
    useSettings.getState().set({ controlScheme: 'mobile' });
    const { unmount } = renderMini();
    expect(notice()).toBeNull();
    expect(localStorage.getItem(MINI_FIT_NOTICE_STORAGE_KEY)).toBe('1');
    expect(localStorage.getItem(MINI_SONG_STORAGE_KEY)).toBe(SEED);
    unmount();
    renderMini();
    expect(notice()).toBeNull();
  });

  it('máy cũ đã có số căn chỉnh riêng (giữ nguyên, không lệch) → không nhắc', () => {
    legacyDevice();
    localStorage.setItem(
      MINI_CALIBRATION_STORAGE_KEY,
      JSON.stringify({ ...DEFAULT_CALIBRATION, first: 0.0443, last: 0.9563 }),
    );
    useSettings.getState().set({ controlScheme: 'mobile' });
    renderMini();
    expect(notice()).toBeNull();
    expect(lastOptions()?.laneFit).toMatchObject({ first: 0.0443, last: 0.9563 });
  });

  it('"Thu nhỏ" không nhắc (nhắc vẫn chờ: đổi sang Khớp nút game → hiện); chỉnh số căn chỉnh → thôi nhắc', () => {
    legacyDevice();
    useSettings.getState().set({ controlScheme: 'mobile' });
    localStorage.setItem(MINI_LAYOUT_STORAGE_KEY, 'compact');
    renderMini();
    expect(notice()).toBeNull();
    fireEvent.click(layoutBtn('mini.layout.game'));
    expect(notice()).toBeTruthy();
    fireEvent.click(alignBtn());
    fireEvent.change(slider('mini.align.first'), { target: { value: '0.07' } });
    fireEvent.click(screen.getByRole('button', { name: en('mini.align.done') }));
    expect(notice()).toBeNull();
    expect(localStorage.getItem(MINI_FIT_NOTICE_STORAGE_KEY)).toBe('1');
  });
});

// ---------------------------------------------------------------------------
// Đúng tỉ lệ thật (D-405): trang biết cỡ màn hình → lane đúng khoảng cách nút thật + chỉ báo "Rộng" / "Cao"
// ---------------------------------------------------------------------------

describe('đúng tỉ lệ thật (cỡ màn hình đọc được)', () => {
  /** Giả màn hình điện thoại ngang + cỡ vùng làn (cửa sổ nổi) — dọn ở afterEach dưới. */
  function device(sw: number, sh: number, w: number, h: number, android = true): void {
    // Máy Android cảm ứng (D-412): UA có "Android" + điểm chạm.
    if (android) {
      Object.defineProperty(window.navigator, 'userAgent', {
        configurable: true,
        get: () => 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 Chrome/141.0 Mobile',
      });
      Object.defineProperty(window.navigator, 'maxTouchPoints', {
        configurable: true,
        get: () => 5,
      });
    }
    Object.defineProperty(window.screen, 'width', { configurable: true, get: () => sw });
    Object.defineProperty(window.screen, 'height', { configurable: true, get: () => sh });
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      configurable: true,
      get: () => w,
    });
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
      configurable: true,
      get: () => h,
    });
  }

  afterEach(() => {
    delete (window.screen as unknown as Record<string, unknown>).width;
    delete (window.screen as unknown as Record<string, unknown>).height;
    delete (window.navigator as unknown as Record<string, unknown>).userAgent;
    delete (window.navigator as unknown as Record<string, unknown>).maxTouchPoints;
  });

  const status = () => root().querySelector<HTMLElement>('.mini-fit-status');
  // Bước cột theo chiều cao màn (D-413): 0,0912 × 1371 / 633 × cao.
  const stepOf = (sh: number) => GAME_NOTE_STEP_H * sh;
  const step915 = stepOf(412);

  it.each([
    [915, 412, 640, 105, 'ok', 'ok'],
    [915, 412, 700, 220, 'wide', 'tall'],
    [915, 412, 590, 88, 'narrow', 'short'],
    [800, 360, 560, 180, 'ok', 'tall'],
  ] as const)(
    'màn %d×%d, cửa sổ %d×%d: lane đúng bước thật, căn giữa; chỉ báo Rộng = %s, Cao = %s (panel ▶, trước ⓘ)',
    (sw, sh, w, h, ws, hs) => {
      device(sw, sh, w, h);
      useSettings.getState().set({ controlScheme: 'mobile' });
      renderMini();
      expect(root().dataset.scale).toBe('true');
      const step = stepOf(sh);
      expect(sw).toBeGreaterThan(0);
      const fit = lastOptions()?.laneFit;
      expect(fit?.stepPx).toBeCloseTo(step, 3);
      expect(fit?.shiftPx).toBe(0);
      const g = fitGeometry(w, h, fit ?? null);
      expect(g.step).toBeCloseTo(step, 3);
      const labels = Array.from(root().querySelectorAll<HTMLElement>('.mini-fit-label'));
      labels.forEach((el, i) => expect(px(el.style.left)).toBeCloseTo(w / 2 + (i - 3.5) * step, 2));
      // Chỉ báo ở hàng đầu của panel, ngay trước ⓘ; trạng thái đọc được (role=status, chữ dài ẩn đọc).
      const st = status()!;
      expect(st.getAttribute('role')).toBe('status');
      expect(st.dataset.width).toBe(ws);
      expect(st.dataset.height).toBe(hs);
      expect(st.parentElement?.classList).toContain('mini-top');
      expect(st.nextElementSibling?.classList).toContain('mini-help-btn');
      const key = (dim: 'width' | 'height', s: string) => `mini.fit.${dim}.${s}` as StringKey;
      expect(st.textContent).toContain(en(key('width', ws)));
      expect(st.textContent).toContain(en(key('height', hs)));
      expect(st.getAttribute('title')).toContain(String(w));
    },
  );

  it('Căn chỉnh: [Move | Step | Shift | Spacing]; "Move" dời vạch theo px, "Step" giãn quanh tâm; lưu + Đặt lại', () => {
    // Cửa sổ 660 px ≥ 8 làn (≈ 651 — v1.0.1): dời 12 px vẫn "vừa", ô ngoài cùng không chạm mép.
    device(915, 412, 660, 105);
    useSettings.getState().set({ controlScheme: 'mobile' });
    const { unmount } = renderMini();
    fireEvent.click(alignBtn());
    const choices = within(screen.getByRole('group', { name: en('mini.align.pick') })).getAllByRole(
      'button',
    );
    expect(choices.map((b) => b.textContent)).toEqual([
      'Lines Move',
      'Lines Spacing',
      'Rings Move',
      'Rings Spacing',
    ]);
    // Thứ đang chỉnh sáng lên trên vạch dẫn (D-416): 8 vạch → 4 vòng khi chọn "Rings".
    const guidesEl = () => root().querySelector<HTMLElement>('.mini-guides')!;
    expect(guidesEl().dataset.focus).toBe('lines');
    fireEvent.click(pick('mini.align.modeSpacingShort'));
    expect(guidesEl().dataset.focus).toBe('rings');
    fireEvent.click(pick('mini.align.shiftShort'));
    expect(guidesEl().dataset.focus).toBe('lines');
    expect(document.activeElement).toBe(choices[0]);
    expect(alignPanel().dataset.scaled).toBe('true');
    expect(alignPanel().textContent).toContain(en('mini.align.helpScale'));
    // Chỉ báo cũng ở bảng Căn chỉnh.
    expect(alignPanel().querySelector<HTMLElement>('.mini-fit-status')?.dataset.width).toBe('ok');
    const x0 = guides().map((el) => px(el.style.left));
    x0.forEach((x, i) => expect(x).toBeCloseTo(330 + (i - 3.5) * step915, 2));
    // Thanh trượt "dời ngang" +12 px → mọi vạch + vòng dời 12 px; giá trị "+12 px".
    const m0 = modes().map((el) => px(el.style.left));
    fireEvent.change(slider('mini.align.shift'), { target: { value: '12' } });
    guides().forEach((el, i) => expect(px(el.style.left) - x0[i]).toBeCloseTo(12, 6));
    modes().forEach((el, j) => expect(px(el.style.left) - m0[j]).toBeCloseTo(12, 6));
    expect(value()).toBe('+12 px');
    expect(lastOptions()?.laneFit?.shiftPx).toBe(12);
    // Dời 12 px: cửa sổ vẫn đúng cỡ → "vừa" (D-415 — trước đây thành "hẹp quá"); dời ra ngoài mép (60 px) → kéo cửa
    // sổ sang phải rồi đặt về 0.
    const fitWidth = () =>
      alignPanel().querySelector<HTMLElement>('.mini-fit-status')?.dataset.width;
    expect(fitWidth()).toBe('ok');
    fireEvent.change(slider('mini.align.shift'), { target: { value: '60' } });
    expect(fitWidth()).toBe('moveRight');
    expect(alignPanel().querySelector('.mini-fit-status')?.textContent).toContain(
      en('mini.fit.width.moveRight'),
    );
    fireEvent.change(slider('mini.align.shift'), { target: { value: '12' } });
    expect(fitWidth()).toBe('ok');
    // "Step": nút + → vạch ngoài cùng ra xa ~1 px mỗi bên.
    fireEvent.click(pick('mini.align.stepScaleShort'));
    const a = guides().map((el) => px(el.style.left));
    fireEvent.click(nudge('more', 'mini.align.stepScale'));
    const b = guides().map((el) => px(el.style.left));
    expect(b[7] - a[7]).toBeCloseTo(1, 0);
    expect(a[0] - b[0]).toBeCloseTo(1, 0);
    expect(value()).toMatch(/^100\.\d %$/);
    const saved = JSON.parse(localStorage.getItem(MINI_CALIBRATION_STORAGE_KEY) ?? 'null') as {
      shift: number;
      stepScale: number;
    };
    expect(saved.shift).toBe(12);
    expect(saved.stepScale).toBeGreaterThan(1);
    // Mở lại: vẫn số đã lưu.
    unmount();
    renderMini();
    expect(lastOptions()?.laneFit?.shiftPx).toBe(12);
    fireEvent.click(alignBtn());
    fireEvent.click(screen.getByRole('button', { name: en('mini.align.reset') }));
    guides().forEach((el, i) => expect(px(el.style.left)).toBeCloseTo(x0[i], 6));
    expect(localStorage.getItem(MINI_CALIBRATION_STORAGE_KEY)).toBeNull();
  });

  it('kiểu PC: chỉ "Move" / "Step"; màn không dùng được (= cửa sổ) → kiểu "cửa sổ = hàng nút", không chỉ báo', () => {
    device(915, 412, 640, 105);
    localStorage.setItem(MINI_LAYOUT_STORAGE_KEY, 'game');
    const { unmount } = renderMini();
    fireEvent.click(alignBtn());
    expect(
      within(screen.getByRole('group', { name: en('mini.align.pick') }))
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['Lines Move', 'Lines Spacing']);
    expect(alignPanel().textContent).toContain(en('mini.align.helpScalePc'));
    unmount();
    // Màn = cửa sổ (trang chiếm cả màn / máy tính): như trước, Nút 1 / Nút 1̇, không chỉ báo.
    device(960, 300, 960, 300);
    useSettings.getState().set({ controlScheme: 'mobile' });
    renderMini();
    expect(root().dataset.scale).toBeUndefined();
    expect(status()).toBeNull();
    expect(lastOptions()?.laneFit).toEqual(laneFitOf(DEFAULT_CALIBRATION));
    fireEvent.click(alignBtn());
    expect(pick('mini.align.firstShort')).toBeTruthy();
    expect(alignPanel().querySelector('.mini-fit-status')).toBeNull();
  });

  it('máy tính (không phải Android cảm ứng — D-412): cửa sổ 1280 × 720 trên màn 1920 × 1080 → kiểu "cửa sổ = hàng nút", không chỉ báo', () => {
    device(1920, 1080, 1280, 720, false);
    useSettings.getState().set({ controlScheme: 'mobile' });
    renderMini();
    expect(root().dataset.layout).toBe('game');
    expect(root().dataset.scale).toBeUndefined();
    expect(status()).toBeNull();
    expect(lastOptions()?.laneFit).toEqual(laneFitOf(DEFAULT_CALIBRATION));
  });

  it('máy dùng trang mini trước v1.0.1 (D-441) mà biết cỡ màn: chỉ báo "Rộng" / "Cao", không nhắc', () => {
    localStorage.setItem(MINI_SONG_STORAGE_KEY, SEED);
    device(915, 412, 640, 105);
    useSettings.getState().set({ controlScheme: 'mobile' });
    renderMini();
    expect(status()?.getAttribute('role')).toBe('status');
    expect(screen.queryByRole('button', { name: en('mini.fit.notice') })).toBeNull();
  });

  it('"Thu nhỏ" không đổi: không chỉ báo, bàn nút riêng', () => {
    device(915, 412, 640, 300);
    useSettings.getState().set({ controlScheme: 'mobile' });
    localStorage.setItem(MINI_LAYOUT_STORAGE_KEY, 'compact');
    renderMini();
    expect(root().dataset.layout).toBe('compact');
    expect(root().dataset.scale).toBeUndefined();
    expect(status()).toBeNull();
    expect(lastOptions()?.lanePadding).toBe('pad');
    expect(root().querySelector('.mpad')).toBeTruthy();
  });
});

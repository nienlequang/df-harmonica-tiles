/**
 * Bố cục "Khớp nút game" của trang mini (góp ý 2026-10-16): nhãn làn nhỏ (MiniFitLabels), vạch căn chỉnh
 * (MiniAlignGuides — 8 vạch tâm nút số + 4 vòng nút chế độ + mép dưới) và bảng "Căn chỉnh" (MiniAlignPanel).
 * Vị trí lấy từ `fitGeometry` (layout.ts) — cùng hàm renderer dùng cho lane / vòng "CHẠM" ⇒ vạch luôn trùng
 * tâm lane trên canvas. Số căn chỉnh thuần ở miniAlign.ts.
 *
 * Bảng Căn chỉnh thiết kế cho cửa sổ nổi THẬT (D-399): đặt ngay trên bảng nút kèn thì cửa sổ chỉ cao ~80–150 px,
 * rộng ~550–650 px. Nên bảng chỉ chỉnh MỘT số mỗi lúc — chọn [Nút 1 | Nút 1̇ | Dời | Giãn] rồi − giá trị +
 * (giữ nút để lặp, nhanh dần — D-400) + thanh trượt khi đủ chỗ — và ở cửa sổ thấp gói gọn một hàng ~36 px ở
 * đỉnh, nền mờ trong suốt, để mép dưới, chân vạch và 4 vòng luôn thấy. Nhãn số của vạch chỉ hiện khi còn chỗ
 * giữa đáy bảng và đỉnh hàng vòng (không bao giờ nằm sau bảng).
 *
 * Đúng tỉ lệ thật (D-405 — trang biết cỡ màn hình): số chỉnh là [Vạch · Dời | Vạch · Giãn | Vòng · Dời | Vòng ·
 * Giãn] (dời cả hàng theo px, hệ số bước cột thật) thay cho Nút 1 / Nút 1̇, và MiniFitStatus (chỉ báo "Rộng" / "Cao"
 * của cửa sổ so với hàng nút thật) nằm ở hàng cuối của bảng (cửa sổ thấp: một dòng chữ 11 px, không viền) và ở hàng
 * đầu của panel ▶.
 *
 * Hiểu được ở cỡ cửa sổ nổi thật (~550–650 × 90–140 px, D-416): mỗi nút chọn ghi hai dòng — nó chỉnh CÁI GÌ ("Vạch"
 * = 8 vạch nút số, "Vòng" = 4 vòng nút chế độ) và chỉnh THẾ NÀO ("Dời" / "Giãn") — và thứ đang chỉnh được tô sáng
 * trên vạch dẫn (`focus`), thứ kia mờ đi; vòng nút chế độ giữ tên tới Ø GUIDE_NAME_MIN_D.
 *
 * "Khớp nút game · dưới nút" (D-448 — cửa sổ DƯỚI hàng nút số, canvas lật): vạch dẫn lật theo (`flip` — mép sáng ở
 * đỉnh, vòng ngay dưới, không nhãn số), chỉ báo chỉ có "Rộng" (`showHeight` false — chiều cao cửa sổ ở bố cục này không
 * có nghĩa: phần dưới ra ngoài màn), bảng nằm ngay dưới hàng vòng. Khoảng trống đáy (`edgeShift`) KHÔNG chỉnh ở đây mà ở
 * hàng trên của bảng lúc dừng: MiniBelowGap "Đáy ◂ 120 px ▸" (góp ý 2026-10-22, thay số "Đáy · Dời" cũ của Căn chỉnh).
 */
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type {
  CSSProperties,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode,
  RefObject,
} from 'react';
import { NOTE_KEYS } from '../core/keys';
import { jianpuLabel } from '../core/mobile';
import type { Lang, StringKey } from '../i18n/strings';
import { useT } from '../i18n/useT';
import { JianpuDigit } from '../player/GameBar';
import type { FitGeometry } from '../player/layout';
import { CUE_TARGET_GAP } from '../player/layout';
import { MOBILE_BUTTONS } from '../player/mobilePlan';
import { Button, IconButton } from '../ui/components';
import type { ModifierLabels } from '../ui/modLabels';
import type { ControlScheme } from '../ui/settings';
import { useSettings } from '../ui/settings';
import { CALIBRATION_RANGES } from './miniAlign';
import type { CalibrationField, FitStatus, MiniCalibration } from './miniAlign';

/** Nhãn của làn `i`: số giản phổ (Mobile, chấm vẽ CSS) hoặc phím Z X C … (PC). */
function LaneName({ index, scheme }: { index: number; scheme: ControlScheme }) {
  const key = NOTE_KEYS[index];
  return scheme === 'mobile' ? <JianpuDigit label={jianpuLabel(key, 0)} /> : <>{key}</>;
}

/**
 * Nhãn làn nhỏ, mờ ở đỉnh mỗi làn (bố cục khớp nút game không có bàn nút riêng — nút thật nằm ngay dưới
 * cửa sổ). Chỉ để nhìn; trình đọc màn hình bỏ qua.
 */
export function MiniFitLabels({ geo, scheme }: { geo: FitGeometry; scheme: ControlScheme }) {
  return (
    <div className="mini-fit-labels" aria-hidden="true">
      {geo.laneCx.map((x, i) =>
        x < 0 || x > geo.width ? null : (
          <span key={i} className="mini-fit-label" style={{ left: `${x}px` }}>
            <LaneName index={i} scheme={scheme} />
          </span>
        ),
      )}
    </div>
  );
}

/**
 * Vòng nút chế độ của vạch dẫn nhỏ hơn chừng này (px) thì chỉ còn màu, không tên (cửa sổ nổi thật ~90 px cao: Ø
 * ≈ 38 px vẫn ghi tên, chữ ≥ 10 px, xuống dòng theo từ — D-416).
 */
export const GUIDE_NAME_MIN_D = 30;

/** Thứ đang chỉnh trong Căn chỉnh: 8 vạch nút số hoặc 4 vòng nút chế độ — tô sáng trên vạch dẫn. */
export type AlignFocus = 'lines' | 'rings';

/** Số căn chỉnh → thứ nó dời (vòng = hàng nút chế độ; còn lại = vạch nút số). */
export function alignFocusOf(field: CalibrationField): AlignFocus {
  return field === 'modeShift' || field === 'modeSpacing' ? 'rings' : 'lines';
}

/** Chiều cao vạch mép sáng của vạch dẫn (px, = `.mini-guide-edge` trong mini.css). */
export const GUIDE_EDGE_H = 3;

/** Chiều cao nhãn số của vạch (px, khớp `.mini-guide-key` trong mini.css) và khe trên hàng vòng. */
export const GUIDE_KEY_H = 20;
export const GUIDE_KEY_GAP = 6;

/**
 * Đỉnh nhãn số của vạch (px từ đỉnh khung): ngay trên hàng vòng nút chế độ (PC: ngay trên mép dưới); null =
 * không còn chỗ dưới bảng Căn chỉnh (`topInset` = đáy bảng) → ẩn nhãn thay vì để nó nằm sau bảng.
 */
export function guideKeyTop(
  geo: FitGeometry,
  scheme: ControlScheme,
  topInset: number,
): number | null {
  const ringTop = scheme === 'mobile' ? geo.hitPos - CUE_TARGET_GAP - geo.modeD : geo.hitPos - 2;
  const top = ringTop - GUIDE_KEY_GAP - GUIDE_KEY_H;
  return top >= Math.max(0, topInset) + 2 ? top : null;
}

/**
 * Vạch căn chỉnh trên canvas: 8 vạch dọc tại tâm 8 nút số (nhãn ngay trên hàng vòng, khi còn chỗ), 4 vòng nút
 * chế độ đúng chỗ vòng "CHẠM" đáp (kiểu Mobile; tên chế độ trong vòng — vòng nhỏ hơn GUIDE_NAME_MIN_D thì
 * chỉ có màu), mép dưới sáng = hit line. `focus` = thứ đang chỉnh (tô sáng; thứ kia mờ). `flip` ("dưới nút",
 * D-448 — renderer `flipY`): mọi thứ lật dọc như canvas — mép sáng ở đỉnh, vòng ngay dưới nó; không nhãn số (bảng
 * Căn chỉnh nằm ngay dưới hàng vòng).
 */
export function MiniAlignGuides({
  geo,
  scheme,
  labels,
  topInset = 0,
  focus = null,
  flip = false,
}: {
  geo: FitGeometry;
  scheme: ControlScheme;
  labels: ModifierLabels;
  /** Đáy bảng Căn chỉnh (px từ đỉnh khung): nhãn số không bao giờ nằm trên đó. */
  topInset?: number;
  focus?: AlignFocus | null;
  /** Lật dọc (bố cục "dưới nút"). */
  flip?: boolean;
}) {
  const mobile = scheme === 'mobile';
  const d = geo.modeD;
  const keyTop = flip ? null : guideKeyTop(geo, scheme, topInset);
  // Đỉnh của một hộp cao `h` đặt ở `top` trong khung chưa lật → trong khung lật (gương quanh giữa khung).
  const y = (top: number, h: number): number => (flip ? geo.height - top - h : top);
  const style = {
    '--mini-mode-d': `${d}px`,
    '--mini-key-top': `${keyTop ?? 0}px`,
  } as CSSProperties;
  return (
    <div
      className="mini-guides"
      aria-hidden="true"
      data-small={d < GUIDE_NAME_MIN_D ? 'true' : undefined}
      data-keys={keyTop === null ? 'hidden' : undefined}
      data-focus={focus ?? undefined}
      data-flip={flip ? 'true' : undefined}
      style={style}
    >
      {geo.laneCx.map((x, i) => (
        <span key={i} className="mini-guide" data-lane={i} style={{ left: `${x}px` }}>
          <span className="mini-guide-key">
            <LaneName index={i} scheme={scheme} />
          </span>
        </span>
      ))}
      {mobile
        ? geo.modeCx.map((x, j) => (
            <span
              key={j}
              className="mini-guide-mode"
              data-mode={MOBILE_BUTTONS[j]}
              style={{
                left: `${x - d / 2}px`,
                top: `${y(geo.hitPos - CUE_TARGET_GAP - d, d)}px`,
                width: `${d}px`,
                height: `${d}px`,
              }}
            >
              <span className="mini-guide-mode-name">{labels[MOBILE_BUTTONS[j]]}</span>
            </span>
          ))
        : null}
      <span className="mini-guide-edge" style={{ top: `${y(geo.hitPos - 1, GUIDE_EDGE_H)}px` }} />
    </div>
  );
}

/** Số theo ngôn ngữ (dấu thập phân phẩy ở tiếng Việt). */
function useNumberFormat(lang: Lang, digits: number, signed = false): Intl.NumberFormat {
  return useMemo(
    () =>
      new Intl.NumberFormat(lang === 'vi' ? 'vi-VN' : 'en-US', {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
        signDisplay: signed ? 'exceptZero' : 'auto',
      }),
    [lang, digits, signed],
  );
}

export interface ControlDef {
  field: CalibrationField;
  /** Tên đầy đủ (nhãn thanh trượt, tên nút − / +, tooltip của nút chọn). */
  label: StringKey;
  /** Nút chọn, dòng trên: chỉnh CÁI GÌ ("Vạch" = 8 vạch nút số, "Vòng" = 4 vòng nút chế độ). */
  group: StringKey;
  /** Nút chọn, dòng dưới: chỉnh THẾ NÀO ("Dời" / "Giãn" / "Nút 1"…). */
  short: StringKey;
}

const LINES: StringKey = 'mini.align.groupLines';
const RINGS: StringKey = 'mini.align.groupRings';

const MODE_CONTROLS: readonly ControlDef[] = [
  {
    field: 'modeShift',
    label: 'mini.align.modeShift',
    group: RINGS,
    short: 'mini.align.modeShiftShort',
  },
  {
    field: 'modeSpacing',
    label: 'mini.align.modeSpacing',
    group: RINGS,
    short: 'mini.align.modeSpacingShort',
  },
];

/** Kiểu "cửa sổ = hàng nút" (không biết cỡ màn): tâm nút 1 / nút 1̇ theo phần bề ngang cửa sổ. */
export const ALIGN_CONTROLS: readonly ControlDef[] = [
  { field: 'first', label: 'mini.align.first', group: LINES, short: 'mini.align.firstShort' },
  { field: 'last', label: 'mini.align.last', group: LINES, short: 'mini.align.lastShort' },
  ...MODE_CONTROLS,
];

/** Đúng tỉ lệ thật (D-405): dời ngang cả hàng (px) + khoảng cách (hệ số bước cột thật). */
export const SCALE_ALIGN_CONTROLS: readonly ControlDef[] = [
  { field: 'shift', label: 'mini.align.shift', group: LINES, short: 'mini.align.shiftShort' },
  {
    field: 'stepScale',
    label: 'mini.align.stepScale',
    group: LINES,
    short: 'mini.align.stepScaleShort',
  },
  ...MODE_CONTROLS,
];

/**
 * Trường chỉnh được theo kiểu điều khiển (PC không có vòng "CHẠM" → không có hàng chế độ) và theo việc trang
 * có biết cỡ màn hình không (`scaled` = đúng tỉ lệ thật). Hai bố cục khớp nút giống nhau: khoảng trống đáy của "dưới
 * nút" (`edgeShift`) nằm ở hàng trên của bảng lúc dừng (MiniBelowGap), không ở đây.
 */
export function alignControlsFor(scheme: ControlScheme, scaled = false): readonly ControlDef[] {
  const all = scaled ? SCALE_ALIGN_CONTROLS : ALIGN_CONTROLS;
  return scheme === 'mobile' ? all : all.slice(0, 2);
}

/** Chữ của chỉ báo cỡ cửa sổ (dài / ngắn — cửa sổ thấp / hẹp dùng chữ ngắn). */
const WIDTH_TEXT: Readonly<Record<FitStatus['width'], readonly [StringKey, StringKey]>> = {
  ok: ['mini.fit.width.ok', 'mini.fit.width.okShort'],
  narrow: ['mini.fit.width.narrow', 'mini.fit.width.narrowShort'],
  wide: ['mini.fit.width.wide', 'mini.fit.width.wideShort'],
  moveLeft: ['mini.fit.width.moveLeft', 'mini.fit.width.moveLeftShort'],
  moveRight: ['mini.fit.width.moveRight', 'mini.fit.width.moveRightShort'],
};
const HEIGHT_TEXT: Readonly<Record<FitStatus['height'], readonly [StringKey, StringKey]>> = {
  ok: ['mini.fit.height.ok', 'mini.fit.height.okShort'],
  short: ['mini.fit.height.short', 'mini.fit.height.shortShort'],
  tall: ['mini.fit.height.tall', 'mini.fit.height.tallShort'],
};

/**
 * Chỉ báo cỡ cửa sổ so với hàng nút thật (đúng tỉ lệ thật — D-405): "Rộng: vừa / Hẹp quá — kéo giãn thêm / Rộng hơn
 * cần thiết / Lệch tâm — kéo cửa sổ sang trái | phải" + "Cao: vừa / Thấp quá — kéo mép trên lên chạm mép màn hình / Cao
 * quá — đang che khung kèn" (chữ dài khi đủ chỗ, chữ ngắn giữ ý của chữ dài — D-416). Cập nhật
 * khi kéo / đổi cỡ cửa sổ; `role="status"` đọc lại khi trạng thái đổi (chỉ chữ trạng thái — số px nằm ở tooltip và
 * dòng số chỉ hiện ở cửa sổ cao, không đọc, để không đọc liên tục khi đang kéo). "Cao quá": tooltip nhắc điện thoại
 * Samsung dùng "dưới nút" (cửa sổ pop-up không thu thấp được — D-448). `showHeight` false ("dưới nút": phần dưới cửa
 * sổ ra ngoài màn, chiều cao không có nghĩa) → chỉ chip "Rộng", số chỉ có bề ngang.
 */
export function MiniFitStatus({
  status,
  showHeight = true,
}: {
  status: FitStatus;
  showHeight?: boolean;
}) {
  const t = useT();
  const w = Math.round(status.widthPx);
  const nw = Math.round(status.needWidth);
  const numbers = showHeight
    ? t('mini.fit.numbers', {
        w,
        h: Math.round(status.heightPx),
        nw,
        nh: Math.round(status.needHeight),
      })
    : t('mini.fit.numbersWidth', { w, nw });
  const title =
    showHeight && status.height === 'tall'
      ? `${numbers} · ${t('mini.fit.height.tallHint')}`
      : numbers;
  const chip = (dim: 'width' | 'height', state: string, keys: readonly [StringKey, StringKey]) => (
    <span className="mini-fit-chip" data-dim={dim} data-state={state}>
      <span className="mini-long" aria-hidden="true">
        {t(keys[0])}
      </span>
      <span className="mini-short" aria-hidden="true">
        {t(keys[1])}
      </span>
      <span className="sr-only">{t(keys[0])}</span>
    </span>
  );
  return (
    <span
      className="mini-fit-status"
      role="status"
      title={title}
      data-width={status.width}
      data-height={showHeight ? status.height : undefined}
    >
      {chip('width', status.width, WIDTH_TEXT[status.width])}
      {showHeight ? chip('height', status.height, HEIGHT_TEXT[status.height]) : null}
      <span className="mini-fit-numbers" aria-hidden="true">
        {numbers}
      </span>
    </span>
  );
}

/**
 * Nhắc một lần ở chỗ chỉ báo "Rộng" (D-441 — máy đã dùng trang mini trước v1.0.1, bố cục "Khớp nút game", trang không
 * biết cỡ màn nên không có chỉ báo): cửa sổ vừa giờ rộng thêm ~1/4 nút mỗi bên. Một nút (chữ dài / ngắn như chip chỉ
 * báo — chữ ngắn nằm trong tên đọc), tooltip giải thích; chạm = mở hướng dẫn đặt cửa sổ + thôi nhắc.
 */
export function MiniFitNotice({ onOpen }: { onOpen: () => void }) {
  const t = useT();
  const long = t('mini.fit.notice');
  return (
    <span className="mini-fit-status mini-fit-notice">
      <button
        type="button"
        className="mini-fit-chip mini-fit-notice-btn"
        data-state="notice"
        aria-label={long}
        title={t('mini.fit.noticeHint')}
        onClick={onOpen}
      >
        <span className="mini-long" aria-hidden="true">
          {long}
        </span>
        <span className="mini-short" aria-hidden="true">
          {t('mini.fit.noticeShort')}
        </span>
      </button>
    </span>
  );
}

export interface MiniAlignPanelProps {
  calib: MiniCalibration;
  scheme: ControlScheme;
  /** Đúng tỉ lệ thật (trang biết cỡ màn hình): chỉnh dời ngang / khoảng cách thay cho nút 1 / nút 1̇. */
  scaled?: boolean;
  /** Chỉ báo cỡ cửa sổ (chỉ khi đúng tỉ lệ thật). */
  status?: FitStatus | null;
  /** Bố cục "dưới nút" (D-448): lời nhắc riêng, chỉ báo chỉ có "Rộng". */
  below?: boolean;
  /** Đặt một trường (MiniView kẹp tầm + lưu). */
  onField: (field: CalibrationField, value: number) => void;
  /** Nút − / + (`fast` = đang giữ nút đủ lâu → bước lớn). */
  onNudge: (field: CalibrationField, dir: -1 | 1, fast: boolean) => void;
  onReset: () => void;
  onDone: () => void;
  /** Mở hướng dẫn kéo / đổi cỡ cửa sổ nổi theo hãng. */
  onHelp: () => void;
  /** Nút chọn đầu tiên (nhận focus khi mở Căn chỉnh — luôn thấy, kể cả khi thanh trượt bị ẩn). */
  firstRef: RefObject<HTMLButtonElement>;
  /** Khung bảng (MiniView đo chiều cao để nhãn vạch không nằm sau bảng). */
  panelRef?: RefObject<HTMLDivElement>;
  /** Số đang chọn đổi (kể cả lần đầu) — MiniView tô sáng thứ nó dời trên vạch dẫn. */
  onActiveField?: (field: CalibrationField) => void;
}

/** Lời nhắc của bảng Căn chỉnh: [bố cục][đúng tỉ lệ thật][kiểu điều khiển]. */
const ALIGN_HELP: Readonly<
  Record<'game' | 'below', Readonly<Record<'scale' | 'plain', Record<ControlScheme, StringKey>>>>
> = {
  game: {
    scale: { mobile: 'mini.align.helpScale', pc: 'mini.align.helpScalePc' },
    plain: { mobile: 'mini.align.help', pc: 'mini.align.helpPc' },
  },
  below: {
    scale: { mobile: 'mini.align.helpBelowScale', pc: 'mini.align.helpBelowScalePc' },
    plain: { mobile: 'mini.align.helpBelow', pc: 'mini.align.helpBelowPc' },
  },
};

/**
 * Bảng "Căn chỉnh" (chỉ khi đang dừng): tiêu đề + lời nhắc (cửa sổ cao) + ⓘ + "Đặt lại mặc định" + "Xong";
 * nhóm nút chọn số cần chỉnh (Mobile 4, PC 2) + − / thanh trượt / giá trị / + của số đang chọn. Esc = Xong.
 */
export function MiniAlignPanel({
  calib,
  scheme,
  scaled = false,
  status = null,
  below = false,
  onField,
  onNudge,
  onReset,
  onDone,
  onHelp,
  firstRef,
  panelRef,
  onActiveField,
}: MiniAlignPanelProps) {
  const t = useT();
  const lang = useSettings((s) => s.language);
  const pct = useNumberFormat(lang, 1);
  const cols = useNumberFormat(lang, 2, true);
  const pxs = useNumberFormat(lang, 0, true);
  const controls = alignControlsFor(scheme, scaled);
  const [field, setField] = useState<CalibrationField>(controls[0].field);
  // Đổi kiểu (vd. cỡ màn đọc được sau lần đo đầu) → số đang chọn không còn → số đầu của kiểu mới.
  const active = controls.find((c) => c.field === field) ?? controls[0];
  const notify = useRef(onActiveField);
  useLayoutEffect(() => {
    notify.current = onActiveField;
  });
  useEffect(() => {
    notify.current?.(active.field);
  }, [active.field]);
  const display = (f: CalibrationField, v: number): string =>
    f === 'modeShift'
      ? t('mini.align.cols', { n: cols.format(v) })
      : f === 'shift'
        ? t('mini.align.px', { n: pxs.format(v) })
        : t('mini.align.pct', { n: pct.format(v * 100) });
  const help = ALIGN_HELP[below ? 'below' : 'game'][scaled ? 'scale' : 'plain'][scheme];
  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>): void => {
    // Esc trên thanh trượt (useHotkeys bỏ qua phím khi focus ở ô nhập) = Xong.
    if (e.key === 'Escape' && !e.defaultPrevented) {
      e.preventDefault();
      onDone();
    }
  };
  return (
    <div
      ref={panelRef}
      className="mini-align"
      role="group"
      aria-label={t('mini.align.region')}
      data-scheme={scheme}
      data-scaled={scaled ? 'true' : undefined}
      data-status={status ? 'true' : undefined}
      data-below={below ? 'true' : undefined}
      onKeyDown={onKeyDown}
    >
      <span className="mini-align-title">{t('mini.align.title')}</span>
      <p className="mini-align-help">{t(help)}</p>
      <span className="mini-seg mini-align-pick" role="group" aria-label={t('mini.align.pick')}>
        {controls.map((c, i) => (
          <button
            key={c.field}
            ref={i === 0 ? firstRef : undefined}
            type="button"
            className="btn btn-sm mini-seg-btn"
            data-field={c.field}
            aria-pressed={c.field === active.field}
            title={t(c.label)}
            onClick={() => setField(c.field)}
          >
            <span className="mini-pick-what">{t(c.group)}</span>{' '}
            <span className="mini-pick-how">{t(c.short)}</span>
          </button>
        ))}
      </span>
      <AlignControl
        key={active.field}
        field={active.field}
        label={t(active.label)}
        value={calib[active.field]}
        display={display(active.field, calib[active.field])}
        onField={onField}
        onNudge={onNudge}
      />
      <span className="mini-align-actions">
        <IconButton
          size="sm"
          className="mini-align-info"
          label={t('mini.align.windowHelp')}
          onClick={onHelp}
        >
          <span aria-hidden="true">ⓘ</span>
        </IconButton>
        <Button
          size="sm"
          className="mini-align-reset"
          aria-label={t('mini.align.reset')}
          onClick={onReset}
        >
          <ShortLong long={t('mini.align.reset')} short={t('mini.align.resetShort')} />
        </Button>
        <Button size="sm" variant="primary" className="mini-align-done" onClick={onDone}>
          {t('mini.align.done')}
        </Button>
      </span>
      {status ? <MiniFitStatus status={status} showHeight={!below} /> : null}
    </div>
  );
}

/**
 * Chữ dài + chữ ngắn của một nút (mini.css chọn cái hiện theo cỡ cửa sổ). Nút mang `aria-label` = chữ dài, nên
 * chữ ngắn phải là một phần của chữ dài (WCAG 2.5.3 "Label in Name").
 */
export function ShortLong({ long, short }: { long: ReactNode; short: ReactNode }) {
  return (
    <>
      <span className="mini-long" aria-hidden="true">
        {long}
      </span>
      <span className="mini-short" aria-hidden="true">
        {short}
      </span>
    </>
  );
}

/** Giữ nút − / + : chờ chừng này rồi mới lặp; khoảng lặp; sau chừng này lần lặp thì bước lớn. */
export const HOLD_DELAY_MS = 400;
export const HOLD_REPEAT_MS = 80;
export const HOLD_FAST_AFTER = 6;

/**
 * Nút bấm một lần / giữ để lặp: chạm (hoặc Enter / Space, TalkBack) = một bước qua `click`; giữ con trỏ quá
 * HOLD_DELAY_MS → lặp mỗi HOLD_REPEAT_MS (`fast` sau HOLD_FAST_AFTER lần) cho tới khi nhả / trượt ra / bị hủy
 * (hoặc `onStep` trả `false` — hết tầm, MiniBelowGap), và `click` ngay sau lần giữ đó bị bỏ (không thêm một bước). Mọi
 * hẹn giờ dọn khi nhả / unmount.
 */
function useHoldRepeat(onStep: (fast: boolean) => boolean | void) {
  const stepRef = useRef(onStep);
  useLayoutEffect(() => {
    stepRef.current = onStep;
  });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const count = useRef(0);
  const repeated = useRef(false);
  const clear = (): void => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
      if (resetTimer.current !== null) clearTimeout(resetTimer.current);
    },
    [],
  );
  const tick = (): void => {
    repeated.current = true;
    count.current += 1;
    // Hết tầm → thôi lặp (click của lần nhả vẫn bị bỏ — `repeated` còn true).
    if (stepRef.current(count.current > HOLD_FAST_AFTER) === false) {
      timer.current = null;
      return;
    }
    timer.current = setTimeout(tick, HOLD_REPEAT_MS);
  };
  const stop = (): void => {
    clear();
    if (!repeated.current) return;
    // `click` của lần nhả tới ngay sau pointerup (cùng tác vụ) → bỏ nó; trượt ra ngoài thì không có click.
    if (resetTimer.current !== null) clearTimeout(resetTimer.current);
    resetTimer.current = setTimeout(() => {
      resetTimer.current = null;
      repeated.current = false;
    }, 0);
  };
  return {
    onPointerDown: (e: ReactPointerEvent<HTMLButtonElement>): void => {
      if (e.button > 0) return;
      clear();
      repeated.current = false;
      count.current = 0;
      timer.current = setTimeout(tick, HOLD_DELAY_MS);
    },
    onPointerUp: stop,
    onPointerCancel: stop,
    onPointerLeave: stop,
    // Giữ lâu trên Android không mở menu ngữ cảnh / chọn chữ.
    onContextMenu: (e: { preventDefault: () => void }): void => e.preventDefault(),
    onClick: (): void => {
      if (repeated.current) {
        repeated.current = false;
        return;
      }
      stepRef.current(false);
    },
  };
}

interface AlignControlProps {
  field: CalibrationField;
  label: string;
  value: number;
  display: string;
  onField: (field: CalibrationField, value: number) => void;
  onNudge: (field: CalibrationField, dir: -1 | 1, fast: boolean) => void;
}

/** Số đang chọn: tên (cửa sổ cao) + − / thanh trượt / giá trị / +. */
function AlignControl({ field, label, value, display, onField, onNudge }: AlignControlProps) {
  const t = useT();
  const id = useId();
  const r = CALIBRATION_RANGES[field];
  const less = useHoldRepeat((fast) => onNudge(field, -1, fast));
  const more = useHoldRepeat((fast) => onNudge(field, 1, fast));
  return (
    <div className="mini-align-ctl" data-field={field}>
      <label className="mini-align-name" htmlFor={id}>
        {label}
      </label>
      <IconButton
        size="sm"
        className="mini-align-nudge"
        label={t('mini.align.less', { name: label })}
        {...less}
      >
        <span aria-hidden="true">−</span>
      </IconButton>
      <input
        id={id}
        className="mini-align-range"
        type="range"
        min={r.min}
        max={r.max}
        step={r.sliderStep}
        value={value}
        aria-label={label}
        aria-valuetext={display}
        onChange={(e) => onField(field, Number(e.currentTarget.value))}
      />
      <output htmlFor={id} className="mini-align-value">
        {display}
      </output>
      <IconButton
        size="sm"
        className="mini-align-nudge"
        label={t('mini.align.more', { name: label })}
        {...more}
      >
        <span aria-hidden="true">+</span>
      </IconButton>
    </div>
  );
}

export interface MiniBelowGapProps {
  /** Khoảng trống đáy hiện có (px CSS — `belowGapOf`). */
  gap: number;
  /** ◂ (nhỏ hơn) / ▸ (lớn hơn) còn đổi được không (`canStepBelowGap`) — hết tầm thì nút đó tắt. */
  canLess: boolean;
  canMore: boolean;
  /** Một bước: −1 = ◂ khoảng trống nhỏ hơn (nội dung xuống thấp hơn), +1 = ▸ lớn hơn; `fast` = đang giữ đủ lâu. */
  onStep: (dir: -1 | 1, fast: boolean) => void;
}

/**
 * "Dưới nút" (góp ý 2026-10-22, sau khi thử trên điện thoại Samsung thật): KHOẢNG TRỐNG ở đáy cửa sổ — phần cửa sổ ra
 * ngoài mép dưới màn hình, trang để trống — để phần còn trên màn là TRỌN nội dung trang. Nằm ở hàng trên của bảng lúc
 * dừng (cùng hàng ◂ / tên bài / ⓘ, nên chỉ hiện khi chưa chạy): "Đáy" ◂ giá trị ▸ — ◂ nhỏ lại, ▸ lớn ra; giữ để lặp như
 * − / + của Căn chỉnh. Hết tầm → nút đó tắt bằng `aria-disabled` (không `disabled`: nút đang giữ / đang focus không mất
 * sự kiện / focus) và lần lặp kế dừng. Giá trị là `<output>` (TalkBack đọc số mới). Một nguồn: `edgeShift` của số căn
 * chỉnh (MiniView đổi + lưu).
 */
export function MiniBelowGap({ gap, canLess, canMore, onStep }: MiniBelowGapProps) {
  const t = useT();
  const hint = t('mini.gap.hint');
  const less = useHoldRepeat((fast) => {
    if (!canLess) return false;
    onStep(-1, fast);
    return true;
  });
  const more = useHoldRepeat((fast) => {
    if (!canMore) return false;
    onStep(1, fast);
    return true;
  });
  return (
    <span className="mini-gap" role="group" aria-label={t('mini.gap.group')} title={hint}>
      <span className="mini-gap-label" aria-hidden="true">
        {t('mini.gap.label')}
      </span>
      <IconButton
        size="sm"
        className="mini-gap-btn"
        label={t('mini.gap.less')}
        title={hint}
        aria-disabled={canLess ? undefined : true}
        {...less}
      >
        <span aria-hidden="true">◂</span>
      </IconButton>
      <output className="mini-gap-value">{t('mini.gap.value', { n: gap })}</output>
      <IconButton
        size="sm"
        className="mini-gap-btn"
        label={t('mini.gap.more')}
        title={hint}
        aria-disabled={canMore ? undefined : true}
        {...more}
      >
        <span aria-hidden="true">▸</span>
      </IconButton>
    </span>
  );
}

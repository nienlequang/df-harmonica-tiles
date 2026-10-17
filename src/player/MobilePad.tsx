import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, ReactNode, RefObject } from 'react';
import { NOTE_KEYS, keyIndex } from '../core/keys';
import { jianpuLabel } from '../core/mobile';
import type { MobileOctaveMode } from '../core/mobile';
import type { NoteKey, TimelineNote } from '../core/types';
import type { StringKey } from '../i18n/strings';
import { useT } from '../i18n/useT';
import { useModifierLabels } from '../ui/modLabels';
import type { ModifierLabels } from '../ui/modLabels';
import { tileColorKey } from '../ui/palette';
import { useSettings } from '../ui/settings';
import { JianpuDigit } from './GameBar';
import { CUE_LAYER_ATTR, LANE_COUNT, PAD_MODE_COLUMNS, padGeometry } from './layout';
import type { PadGeometry } from './layout';
import { MobilePadLatch, attachMobilePadInput } from './mobilePadInput';
import type { PadLatchState } from './mobilePadInput';
import { MOBILE_BUTTONS, cueButton, modeButton } from './mobilePlan';
import type { MobileButton, MobileUiState } from './mobilePlan';
import { dismissRotateHint, getPadVibrate, isRotateHintDismissed } from './padPrefs';
import type { PracticeInputEvent } from './practice.types';
import type { PracticeFlash, PracticeInputOutcome } from './usePlayerEngine';
import './player.css';
import './mobilePad.css';

/**
 * Bàn nút kiểu game Mobile ở đáy khu tiles (SPEC Phase 4m a + b, docs/GAME-UI-REFERENCE.md "Bản
 * mobile"): hàng 8 nút tròn lớn số giản phổ trải hết bề ngang (cột bằng nhau — tâm nút = tâm lane của
 * canvas `lanePadding: 'pad'`, cùng `padGeometry`), phía trên 4 nút chế độ tròn nhỏ hai dòng chữ
 * (Nửa Cung · Ngẩng Lên · Ngẩng Tự Nhiên · Cúi Xuống) căn giữa cột 3 … cột 7 như game; nút chế độ đang
 * chọn sáng (màu chế độ), nút sắp phải chạm (~1 beat) có vòng hổ phách + một nhịp "ping" (một lần). Vòng
 * "CHẠM" của renderer (layout.ts `cueTargets`, vòng R7) rơi xuống và đồng tâm với hình tròn nút chế độ đúng
 * lúc phải chạm — vị trí / Ø hình tròn ở đây phải giữ đúng `padGeometry` (tâm = mép cột, đỉnh = modeTop tính
 * từ đỉnh bàn nút). Renderer vẽ vòng lên lớp canvas trong suốt cuối bàn nút (`CUE_LAYER_ATTR`, phủ cả hộp
 * canvas, không nhận chạm) để vòng nằm TRÊN nút chế độ chứ không chui dưới.
 *
 * Chỉ hiển thị khi xem; Luyện tập → bấm được bằng chạm / chuột (đa chạm, mobilePadInput.ts): nút chế độ
 * chốt như game, nút số = lần bấm được chấm (PracticeInputEvent 'tap-down'); tia sáng + PERFECT / GOOD /
 * MISS / SAI cạnh nút, bấm đúng nốt sai chế độ → "SAI CHẾ ĐỘ" + nút chế độ cần chạm loé lên; rung nhẹ
 * (padPrefs). Hiệu ứng tự gỡ khỏi state sau PAD_POP_MS / PAD_NEED_MS — không dựa vào CSS `forwards` (giảm
 * chuyển động có thể tắt animation, D-289); tia sáng nằm ngoài hình tròn (hình tròn remount khi nốt ở hit
 * line đổi — tia sáng không được chạy lại).
 * Đặt trong hộp canvas (position: absolute, đáy) — đo hộp đó để tính hình học.
 */
export interface MobilePadProps {
  /** Nốt đang ở hit line (nút số sáng theo màu tile). */
  note: Pick<TimelineNote, 'key' | 'modifiers'> | null;
  /** Định danh nốt ở hit line: đổi → nút "nhấn lại" kể cả cùng phím. */
  noteId?: number | null;
  /** Chế độ tại hit line + lần chạm kế theo kế hoạch (null = Ngẩng Tự Nhiên, Nửa Cung tắt). */
  mobile: MobileUiState | null;
  /** Luyện tập: bấm được (null = chỉ hiển thị). */
  practice?: MobilePadPractice | null;
  /**
   * Tên 4 nút chế độ; bỏ trống = theo Cài đặt của trình duyệt này. Overlay OBS truyền tên của Player / link
   * (OBS có bộ nhớ riêng — không đọc Cài đặt của trình duyệt mở overlay).
   */
  labels?: ModifierLabels;
  className?: string;
}

export interface MobilePadPractice {
  /** Kết quả chấm gần nhất (hiện cạnh nút của cột `last.key`). */
  last: PracticeFlash | null;
  /** Phím đang giữ (bàn phím + chạm). */
  pressedKeys: readonly NoteKey[];
  combo: number;
  /** Nốt chưa chấm kế tiếp (nhắc nút chế độ cần chạm trước nó); null = hết. */
  next: Pick<TimelineNote, 'octave' | 'sharp'> | null;
  /** Gửi lần chạm cho engine (PlayerEngine.handlePracticeInput). */
  onInput: (ev: PracticeInputEvent) => PracticeInputOutcome | null;
}

const GRADE_KEY: Readonly<Record<PracticeFlash['kind'], StringKey>> = {
  perfect: 'practice.grade.perfect',
  good: 'practice.grade.good',
  miss: 'practice.grade.miss',
  wrong: 'practice.grade.wrong',
  range: 'practice.grade.range',
};

/** Nhãn kết quả của lần chấm (bấm đúng nốt nhưng sai chế độ → "SAI CHẾ ĐỘ" thay cho "SAI PHÍM"). */
export function padGradeKey(flash: Pick<PracticeFlash, 'kind' | 'rightKey'>): StringKey {
  return flash.kind === 'wrong' && flash.rightKey === true
    ? 'practice.grade.wrongMode'
    : GRADE_KEY[flash.kind];
}

/** Kết quả + tia sáng cạnh nút tự gỡ sau chừng này ms (animation dài nhất 0.75 s). */
export const PAD_POP_MS = 900;
/** Vòng "cần chạm" của nút chế độ tự gỡ sau chừng này ms (animation 0.8 s). */
export const PAD_NEED_MS = 1000;

/** Phần trăm bề ngang của toạ độ cột `c` (đơn vị cột). */
const colPct = (c: number): string => `${(c / LANE_COUNT) * 100}%`;

/** Cột (0..7) của phím; null → giữa bàn nút. */
const flashColumn = (key: NoteKey | null | undefined): number | null =>
  key ? Math.max(0, keyIndex(key)) : null;

/**
 * Nút chế độ phải chạm (khi luyện tập) trước nốt `next` — nốt chưa chấm kế tiếp — so với chế độ ĐANG CHỐT
 * trên bàn chạm (không theo kế hoạch): quãng khác → nút quãng của nốt; Nửa Cung khác → Nửa Cung (cả kiểu
 * "chỉ 1 nốt": đang chờ áp mà nốt kế không thăng thì chạm lại để hủy). Đổi sớm lúc nghỉ cũng được (như game).
 */
export function neededModeButtons(
  latch: PadLatchState,
  next: Pick<TimelineNote, 'octave' | 'sharp'> | null,
): Set<MobileButton> {
  return new Set(
    next ? wrongModeButtons({ octave: latch.mode, sharp: latch.semitoneOn }, next) : [],
  );
}

/** Nút chế độ đúng cho nốt `expected` mà lần chạm (octave, sharp) đã sai. */
export function wrongModeButtons(
  tap: { octave: MobileOctaveMode; sharp: boolean },
  expected: Pick<TimelineNote, 'octave' | 'sharp'>,
): MobileButton[] {
  const out: MobileButton[] = [];
  if (expected.octave !== tap.octave) out.push(modeButton(expected.octave));
  if (expected.sharp !== tap.sharp) out.push('scroll');
  return out;
}

/** Đo hộp chứa (cha của bàn nút): bề rộng / cao px CSS (lẻ được, như renderer). */
function useBoxSize(ref: RefObject<HTMLElement>): { w: number; h: number } {
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const box = ref.current?.parentElement;
    if (!box) return;
    const measure = (): void => {
      const r = box.getBoundingClientRect();
      const w = r.width > 0 ? r.width : box.clientWidth;
      const h = r.height > 0 ? r.height : box.clientHeight;
      setSize((prev) => (prev.w === w && prev.h === h ? prev : { w, h }));
    };
    measure();
    const win = box.ownerDocument.defaultView;
    const RO =
      (win as (Window & typeof globalThis) | null)?.ResizeObserver ??
      (typeof ResizeObserver === 'function' ? ResizeObserver : null);
    if (typeof RO === 'function') {
      const ro = new RO(measure);
      ro.observe(box);
      return () => ro.disconnect();
    }
    const target = win ?? window;
    target.addEventListener('resize', measure);
    return () => target.removeEventListener('resize', measure);
  }, [ref]);
  return size;
}

/** Thuộc tính của lớp vòng "CHẠM" (renderer tìm `canvas[CUE_LAYER_ATTR]` trong hộp canvas). */
const CUE_LAYER_PROPS = { [CUE_LAYER_ATTR]: '' } as Record<string, string>;

function padStyle(g: PadGeometry, boxH: number): CSSProperties {
  return {
    height: `${g.height}px`,
    ['--mpad-box-h' as string]: `${boxH}px`,
    ['--mpad-digit-d' as string]: `${g.digitD}px`,
    ['--mpad-digit-top' as string]: `${g.digitTop}px`,
    ['--mpad-mode-d' as string]: `${g.modeD}px`,
    ['--mpad-mode-top' as string]: `${g.modeTop}px`,
    ['--mpad-mode-font' as string]: `${g.modeFontPx}px`,
    ['--mpad-col' as string]: `${g.colW}px`,
  };
}

export function MobilePad({
  note,
  noteId = null,
  mobile,
  practice = null,
  labels: labelsProp,
  className,
}: MobilePadProps) {
  const t = useT();
  const settingsLabels = useModifierLabels();
  const labels = labelsProp ?? settingsLabels;
  const semitone = useSettings((s) => s.mobileSemitone);
  const rootRef = useRef<HTMLDivElement>(null);
  const box = useBoxSize(rootRef);
  const g = useMemo(() => padGeometry(box.w, box.h), [box]);
  const interactive = practice !== null;

  // Chế độ đang chốt trên bàn chạm (giữ qua các lần chơi như game; chỉ có nghĩa khi luyện tập).
  const latchRef = useRef<MobilePadLatch | null>(null);
  if (latchRef.current === null) latchRef.current = new MobilePadLatch(semitone);
  const latch = latchRef.current;
  latch.semitone = semitone;
  const [latchState, setLatchState] = useState<PadLatchState>(() => latch.state);
  const [need, setNeed] = useState<{ buttons: MobileButton[]; seq: number } | null>(null);

  const onInputRef = useRef(practice?.onInput ?? null);
  onInputRef.current = practice?.onInput ?? null;
  const needSeq = useRef(0);

  // Hẹn giờ gỡ hiệu ứng (dọn hết khi unmount).
  const timers = useRef(new Set<number>());
  const later = useCallback((fn: () => void, ms: number): void => {
    const id = window.setTimeout(() => {
      timers.current.delete(id);
      fn();
    }, ms);
    timers.current.add(id);
  }, []);
  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const id of pending) window.clearTimeout(id);
      pending.clear();
    };
  }, []);

  useEffect(() => {
    const root = rootRef.current;
    if (!interactive || !root) return;
    const detach = attachMobilePadInput(root, {
      latch,
      onLatchChange: setLatchState,
      vibrate: getPadVibrate,
      onEvent: (ev) => {
        const outcome = onInputRef.current?.(ev) ?? null;
        if (ev.type !== 'tap-down' || outcome?.kind !== 'wrong' || !outcome.expected) return;
        const buttons = wrongModeButtons(ev, outcome.expected);
        if (buttons.length === 0) return;
        const seq = ++needSeq.current;
        setNeed({ buttons, seq });
        later(() => setNeed((prev) => (prev?.seq === seq ? null : prev)), PAD_NEED_MS);
      },
    });
    return () => {
      detach();
      setNeed(null);
    };
  }, [interactive, latch, later]);

  // Chọn / dấu chấm: luyện tập → chế độ đang chốt; xem → chế độ của kế hoạch tại hit line.
  const mode: MobileOctaveMode = interactive ? latchState.mode : (mobile?.mode ?? 0);
  const semitoneOn = interactive ? latchState.semitoneOn : (mobile?.semitoneOn ?? false);
  const selected = modeButton(mode);
  const cueSet = practice
    ? neededModeButtons(latchState, practice.next)
    : new Set<MobileButton>(mobile?.cueSoon ? mobile.nextCues.map((c) => cueButton(c)) : []);
  // "Ping" một lần mỗi lần chạm kế tới gần (key theo beat của cue).
  const pingKey = mobile?.cueSoon && mobile.nextCues[0] ? mobile.nextCues[0].beat : null;
  const needSet = new Set<MobileButton>(need?.buttons ?? []);

  const activeKey = note?.key ?? null;
  const tone = note ? tileColorKey(note.modifiers) : 'normal';
  const pressed = practice?.pressedKeys ?? [];

  // Kết quả gần nhất theo cột (mỗi cột giữ hiệu ứng của lần chấm mới nhất; key = seq → chạy một lần),
  // gỡ sau PAD_POP_MS.
  const [pops, setPops] = useState<ReadonlyMap<number, PracticeFlash>>(() => new Map());
  const last = practice?.last ?? null;
  useEffect(() => {
    if (!last) return;
    const col = flashColumn(last.key) ?? -1;
    setPops((prev) => {
      if (prev.get(col)?.seq === last.seq) return prev;
      const next = new Map(prev);
      next.set(col, last);
      return next;
    });
    later(
      () =>
        setPops((prev) => {
          if (prev.get(col)?.seq !== last.seq) return prev;
          const next = new Map(prev);
          next.delete(col);
          return next;
        }),
      PAD_POP_MS,
    );
  }, [last, later]);
  useEffect(() => {
    if (!interactive) setPops((prev) => (prev.size === 0 ? prev : new Map()));
  }, [interactive]);

  return (
    <div
      ref={rootRef}
      className={['mpad', interactive && 'is-interactive', className].filter(Boolean).join(' ')}
      role="group"
      aria-label={t('player.gameBar')}
      data-scheme="mobile"
      data-label={g.modeLabelInside ? 'inside' : 'below'}
      style={padStyle(g, box.h)}
    >
      <div className="mpad-modes" role="group" aria-label={t('player.mobile.modes')}>
        {MOBILE_BUTTONS.map((b, i) => {
          const on = b === 'scroll' ? semitoneOn : b === selected;
          const cue = cueSet.has(b);
          const flashNeed = needSet.has(b);
          const cls = [
            'mpad-mode',
            'gbm-mode',
            `gbm-mode-${b}`,
            on && 'is-selected',
            cue && 'is-cue',
            flashNeed && 'is-need',
          ];
          const className = cls.filter(Boolean).join(' ');
          const style = { left: colPct(PAD_MODE_COLUMNS[i] ?? 4) };
          const body: ReactNode = (
            <>
              <span className="gbm-mode-btn mpad-mode-circle">
                {cue && pingKey !== null ? (
                  <span key={`ping:${pingKey}`} className="mpad-ping" aria-hidden="true" />
                ) : null}
                {flashNeed && need ? (
                  <span key={`need:${need.seq}`} className="mpad-need-ring" aria-hidden="true" />
                ) : null}
                {g.modeLabelInside ? <ModeName labels={labels} button={b} /> : null}
              </span>
              {g.modeLabelInside ? null : <ModeName labels={labels} button={b} />}
            </>
          );
          return interactive ? (
            <button
              key={b}
              type="button"
              className={className}
              style={style}
              data-mode={b}
              data-pad-mode={b}
              data-cue={cue ? 'true' : undefined}
              aria-pressed={on}
            >
              {body}
            </button>
          ) : (
            <span
              key={b}
              className={className}
              style={style}
              data-mode={b}
              data-cue={cue ? 'true' : undefined}
              aria-current={on ? 'true' : undefined}
            >
              {body}
            </span>
          );
        })}
      </div>
      <div className="mpad-digits" role="group" aria-label={t('player.mobile.digits')}>
        {NOTE_KEYS.map((k, i) => {
          const active = k === activeKey;
          const down = pressed.includes(k);
          const pop = pops.get(i);
          const spark = pop && (pop.kind === 'perfect' || pop.kind === 'good') ? pop : null;
          const cls = [
            'mpad-digit',
            'gbm-key',
            active && `is-active gb-tone-${tone}`,
            down && 'is-pressed',
          ];
          const className = cls.filter(Boolean).join(' ');
          const style = { left: colPct(i) };
          // Tia sáng là anh em của hình tròn (không nằm trong): hình tròn remount mỗi khi nốt ở hit line
          // đổi (key theo noteId), tia sáng ở trong sẽ bị gắn lại và chạy lại như một lần trúng giả.
          const body: ReactNode = (
            <>
              <span key={active ? `on:${noteId ?? ''}` : 'off'} className="gbm-btn mpad-circle">
                <JianpuDigit label={jianpuLabel(k, mode)} />
              </span>
              {spark ? (
                <span
                  key={`spark:${spark.seq}`}
                  className={`mpad-spark mpad-spark-${spark.kind}`}
                  aria-hidden="true"
                />
              ) : null}
            </>
          );
          return interactive ? (
            // Chỉ nhận chạm / chuột (bàn phím đã có Z X C V B N M ,): không làm điểm dừng Tab.
            <button
              key={k}
              type="button"
              tabIndex={-1}
              className={className}
              style={style}
              data-key={k}
              data-pad-key={k}
              data-pressed={down ? 'true' : undefined}
            >
              {body}
            </button>
          ) : (
            <div
              key={k}
              className={className}
              style={style}
              data-key={k}
              aria-current={active ? 'true' : undefined}
            >
              {body}
            </div>
          );
        })}
      </div>
      {interactive ? (
        <div className="mpad-pops" aria-hidden="true">
          {[...pops.entries()].map(([col, p]) => (
            <span
              key={`${col}:${p.seq}`}
              className={`mpad-pop practice-flash-${p.kind}`}
              style={{ left: col < 0 ? '50%' : colPct(col + 0.5) }}
            >
              {t(padGradeKey(p))}
            </span>
          ))}
        </div>
      ) : null}
      {/* Lớp vòng "CHẠM" (renderer vẽ): cuối bàn nút → nằm trên nút chế độ; phủ cả hộp canvas. */}
      <canvas className="mpad-cues" aria-hidden="true" {...CUE_LAYER_PROPS} />
    </div>
  );
}

/** Số ký tự của từ dài nhất trong tên nút (CSS thu chữ để từ đó lọt một dòng — không cắt "SEMITON / E"). */
function longestWordLength(label: string): number {
  return Math.max(1, ...label.split(/\s+/).map((w) => Array.from(w).length));
}

function ModeName({ labels, button }: { labels: ModifierLabels; button: MobileButton }) {
  const label = labels[button];
  const style = { ['--mpad-name-ch' as string]: longestWordLength(label) } as CSSProperties;
  return (
    <span className="mpad-mode-name" style={style}>
      {label}
    </span>
  );
}

/** Điện thoại đang dọc (gợi ý xoay ngang cho giống màn chơi kèn). */
export const PORTRAIT_PHONE_QUERY = '(orientation: portrait) and (max-width: 720px)';

function usePortraitPhone(): boolean {
  const [match, setMatch] = useState(false);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia(PORTRAIT_PHONE_QUERY);
    const update = (): void => setMatch(mql.matches);
    update();
    mql.addEventListener('change', update);
    return () => mql.removeEventListener('change', update);
  }, []);
  return match;
}

/** "Xoay ngang để giống màn hình game" — chỉ trên điện thoại dọc, đóng được (nhớ lần sau). */
export function MobilePadRotateHint() {
  const t = useT();
  const portrait = usePortraitPhone();
  const [dismissed, setDismissed] = useState(isRotateHintDismissed);
  if (!portrait || dismissed) return null;
  return (
    <div className="mpad-rotate">
      <p className="mpad-rotate-chip" role="note">
        <span aria-hidden="true">⟳ </span>
        {t('player.mobile.rotateHint')}
        <button
          type="button"
          className="mpad-rotate-close"
          aria-label={t('player.mobile.rotateDismiss')}
          title={t('player.mobile.rotateDismiss')}
          onClick={() => {
            dismissRotateHint();
            setDismissed(true);
          }}
        >
          <span aria-hidden="true">✕</span>
        </button>
      </p>
    </div>
  );
}

/** Combo nhỏ ở góc khu tiles (bàn chạm luyện tập) — số đọc cho screen reader nằm ở HUD. */
export function MobilePadCombo({ combo }: { combo: number }) {
  const t = useT();
  if (combo < 2) return null;
  return (
    <div className="mpad-combo" aria-hidden="true">
      <span className="mpad-combo-label">{t('practice.combo')}</span>
      <span key={combo} className="mpad-combo-value">
        {combo}
      </span>
    </div>
  );
}

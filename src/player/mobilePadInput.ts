/**
 * Bàn chạm kiểu game Mobile cho practice (SPEC Phase 4m C, docs/RESEARCH-MOBILE-FLOATING.md): 8 nút số
 * + 4 nút chế độ bấm bằng chạm / chuột như trong game — chạm nút chế độ TRƯỚC rồi chạm nốt.
 *
 * - `MobilePadLatch` (thuần): chế độ quãng GIỮ TRẠNG THÁI tới lần chạm khác (Ngẩng Lên / Ngẩng Tự Nhiên
 *   / Cúi Xuống); Nửa Cung theo setting `mobileSemitone`: 'toggle' bật/tắt giữ trạng thái, 'oneShot'
 *   bật cho đúng nốt kế tiếp rồi tự tắt (chạm lại khi đang chờ = hủy) — như MobileCapture của `#/record`.
 * - `attachMobilePadInput` (DOM): pointer events trên phần tử bàn nút (chạm + chuột, đa chạm theo
 *   `pointerId`) → PracticeInputEvent 'tap-down' / 'tap-up' mang sẵn (key, octave, sharp) chốt lúc chạm,
 *   `timeStamp` = PointerEvent.timeStamp (trục performance.now) để chấm đúng lúc chạm.
 *   Nút nhận diện bằng thuộc tính `data-pad-key` (phím Z…,) / `data-pad-mode` (MobileButton).
 *   Chặn cuộn / zoom / menu nhấn giữ / bôi đen (CSS `touch-action: none` + preventDefault), và chặn
 *   pointerdown nổi lên stage (stage là vùng chuột-modifier kiểu PC của practiceInput.ts).
 *   Mất focus / tab ẩn → thả mọi ngón đang giữ (chế độ đã chốt KHÔNG mất — như game).
 */
import { isNoteKey } from '../core/keys';
import type { MobileOctaveMode, MobileSemitoneMode } from '../core/mobile';
import type { NoteKey, Octave } from '../core/types';
import { MOBILE_BUTTONS } from './mobilePlan';
import type { MobileButton } from './mobilePlan';
import type { PracticeInputEvent } from './practice.types';

/** Trạng thái nút chế độ đang chốt trên bàn chạm. */
export interface PadLatchState {
  mode: MobileOctaveMode;
  /** Nửa Cung đang bật ('oneShot': đang chờ áp cho nốt kế tiếp). */
  semitoneOn: boolean;
}

export interface PadNoteChoice {
  key: NoteKey;
  octave: Octave;
  sharp: boolean;
}

/** Thời lượng rung khi chạm (ms) — rất nhẹ. */
export const PAD_VIBRATE_MS = 10;

export class MobilePadLatch {
  /** Cách Nửa Cung hoạt động (đổi giữa chừng được — áp từ lần chạm kế). */
  semitone: MobileSemitoneMode;
  private modeValue: MobileOctaveMode = 0;
  private semitoneValue = false;

  constructor(semitone: MobileSemitoneMode = 'toggle') {
    this.semitone = semitone;
  }

  get state(): PadLatchState {
    return { mode: this.modeValue, semitoneOn: this.semitoneValue };
  }

  /** Chạm một nút chế độ (thứ tự game: Nửa Cung · Ngẩng Lên · Ngẩng Tự Nhiên · Cúi Xuống). */
  tapMode(button: MobileButton): void {
    if (button === 'scroll') this.semitoneValue = !this.semitoneValue;
    else this.modeValue = button === 'left' ? -1 : button === 'right' ? 1 : 0;
  }

  /** Chạm nốt: (octave, sharp) chốt lúc chạm; 'oneShot' → Nửa Cung tự tắt sau nốt này. */
  noteChoice(key: NoteKey): PadNoteChoice {
    const choice: PadNoteChoice = { key, octave: this.modeValue, sharp: this.semitoneValue };
    if (this.semitone === 'oneShot') this.semitoneValue = false;
    return choice;
  }

  /** Về trạng thái đầu (Ngẩng Tự Nhiên, Nửa Cung tắt). */
  reset(): void {
    this.modeValue = 0;
    this.semitoneValue = false;
  }
}

/** Nút trên bàn chạm mà `target` thuộc về (trong `root`), hoặc null. */
export type PadTarget = { kind: 'note'; key: NoteKey } | { kind: 'mode'; button: MobileButton };

interface ClosestLike {
  closest: (selector: string) => unknown;
}

interface AttrLike {
  getAttribute: (name: string) => string | null;
}

function hasClosest(x: unknown): x is ClosestLike {
  return x !== null && typeof x === 'object' && typeof (x as ClosestLike).closest === 'function';
}

function hasAttr(x: unknown): x is AttrLike {
  return x !== null && typeof x === 'object' && typeof (x as AttrLike).getAttribute === 'function';
}

const isMobileButton = (v: string | null): v is MobileButton =>
  v !== null && (MOBILE_BUTTONS as readonly string[]).includes(v);

/** Đọc nút từ phần tử được chạm (duck-typing: chạy được với Window khác như cửa sổ nổi). */
export function padTargetOf(target: unknown): PadTarget | null {
  if (!hasClosest(target)) return null;
  const el = target.closest('[data-pad-key],[data-pad-mode]');
  if (!hasAttr(el)) return null;
  const key = el.getAttribute('data-pad-key');
  if (key !== null) return isNoteKey(key) ? { kind: 'note', key } : null;
  const mode = el.getAttribute('data-pad-mode');
  return isMobileButton(mode) ? { kind: 'mode', button: mode } : null;
}

export interface MobilePadInputOptions {
  latch: MobilePadLatch;
  /** 'tap-down' / 'tap-up' cho engine (PlayerEngine.handlePracticeInput). */
  onEvent: (ev: PracticeInputEvent) => void;
  /** Chế độ đã chốt đổi (chạm nút chế độ, Nửa Cung 'oneShot' tự tắt) → vẽ lại bàn nút. */
  onLatchChange: (state: PadLatchState) => void;
  /** Rung nhẹ khi chạm có bật không (đọc mỗi lần chạm). Bỏ trống = không rung. */
  vibrate?: () => boolean;
}

/**
 * Gắn input bàn chạm lên `root`. Trả cleanup gỡ mọi listener và thả các ngón đang giữ ('tap-up' —
 * engine bỏ qua nếu practice đã tắt).
 */
export function attachMobilePadInput(root: HTMLElement, opts: MobilePadInputOptions): () => void {
  const doc = root.ownerDocument;
  const win = doc.defaultView ?? window;
  const { latch, onEvent, onLatchChange, vibrate } = opts;
  /** pointerId → phím đang giữ (đa chạm). */
  const active = new Map<number, NoteKey>();

  const buzz = (): void => {
    if (!vibrate?.()) return;
    const nav = win.navigator as Navigator & { vibrate?: (pattern: number) => boolean };
    try {
      if (typeof nav.vibrate === 'function') nav.vibrate(PAD_VIBRATE_MS);
    } catch {
      // Trình duyệt chặn (chưa có cử chỉ / iframe) — bỏ qua.
    }
  };

  const release = (pointerId: number, timeStamp: number): void => {
    const key = active.get(pointerId);
    if (key === undefined) return;
    active.delete(pointerId);
    const s = latch.state;
    onEvent({
      type: 'tap-up',
      key,
      octave: s.mode,
      sharp: s.semitoneOn,
      source: 'touch',
      pointerId,
      timeStamp,
    });
  };

  const releaseAll = (timeStamp: number): void => {
    for (const id of [...active.keys()]) release(id, timeStamp);
  };

  const tapMode = (button: MobileButton): void => {
    latch.tapMode(button);
    onLatchChange(latch.state);
  };

  const onPointerDown = (e: PointerEvent): void => {
    // Bàn nút không phải vùng chuột-modifier kiểu PC: không cho nổi lên stage.
    e.stopPropagation();
    // Chuột: chỉ nút trái là "chạm"; phải / giữa bị nuốt (không menu, không autoscroll).
    if (e.pointerType === 'mouse' && e.button !== 0) {
      e.preventDefault();
      return;
    }
    const target = padTargetOf(e.target);
    if (!target) return;
    // Không focus / bôi đen / sinh sự kiện chuột giả lập.
    e.preventDefault();
    if (target.kind === 'mode') {
      tapMode(target.button);
      buzz();
      return;
    }
    // Cùng ngón chạm lại (không có pointerup giữa chừng): thả nốt cũ trước.
    release(e.pointerId, e.timeStamp);
    const before = latch.state.semitoneOn;
    const choice = latch.noteChoice(target.key);
    active.set(e.pointerId, target.key);
    onEvent({
      type: 'tap-down',
      key: choice.key,
      octave: choice.octave,
      sharp: choice.sharp,
      source: 'touch',
      pointerId: e.pointerId,
      timeStamp: e.timeStamp,
    });
    if (latch.state.semitoneOn !== before) onLatchChange(latch.state);
    buzz();
  };

  const onPointerUp = (e: PointerEvent): void => release(e.pointerId, e.timeStamp);

  /** Bàn phím trên nút chế độ (Enter / Space khi đang focus): click có detail 0. */
  const onClick = (e: MouseEvent): void => {
    if (e.detail !== 0) return;
    const target = padTargetOf(e.target);
    if (target?.kind === 'mode') tapMode(target.button);
  };

  const prevent = (e: Event): void => e.preventDefault();

  /** iOS Safari: chặn cuộn / zoom / chạm đúp phóng to khi chạm vào nút (touch-action chưa đủ). */
  const onTouchStart = (e: TouchEvent): void => {
    if (padTargetOf(e.target)) e.preventDefault();
  };

  const onBlur = (e: FocusEvent): void => {
    const t = e.target as { nodeType?: unknown } | null;
    if (t !== null && t.nodeType === 1) return;
    releaseAll(e.timeStamp);
  };

  const onVisibility = (e: Event): void => {
    if (doc.visibilityState === 'hidden') releaseAll(e.timeStamp);
  };

  const capture = { capture: true } as const;
  const nonPassive = { passive: false } as const;
  root.addEventListener('pointerdown', onPointerDown);
  root.addEventListener('click', onClick);
  root.addEventListener('contextmenu', prevent);
  root.addEventListener('selectstart', prevent);
  root.addEventListener('dblclick', prevent);
  root.addEventListener('touchstart', onTouchStart, nonPassive);
  win.addEventListener('pointerup', onPointerUp, capture);
  win.addEventListener('pointercancel', onPointerUp, capture);
  win.addEventListener('blur', onBlur);
  doc.addEventListener('visibilitychange', onVisibility);

  return () => {
    root.removeEventListener('pointerdown', onPointerDown);
    root.removeEventListener('click', onClick);
    root.removeEventListener('contextmenu', prevent);
    root.removeEventListener('selectstart', prevent);
    root.removeEventListener('dblclick', prevent);
    root.removeEventListener('touchstart', onTouchStart);
    win.removeEventListener('pointerup', onPointerUp, capture);
    win.removeEventListener('pointercancel', onPointerUp, capture);
    win.removeEventListener('blur', onBlur);
    doc.removeEventListener('visibilitychange', onVisibility);
    releaseAll(typeof performance !== 'undefined' ? performance.now() : Date.now());
  };
}

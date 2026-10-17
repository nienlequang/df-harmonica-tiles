/**
 * Chuẩn hóa input practice mode từ DOM (spec §6 "Practice mode") thành PracticeInputEvent.
 *
 * - Phím nốt thật KeyZ KeyX KeyC KeyV KeyB KeyN KeyM Comma (theo `code`, không phụ thuộc layout).
 * - Modifier CHỈ bằng chuột trên `surface`, như trong game (góp ý 2026-10-15: bỏ phím bàn phím thay
 *   chuột): nút 0/1/2 = trái / scroll / phải. Bấm thêm nút khi đang giữ nút khác (chord) trình duyệt
 *   chỉ báo bằng pointermove → theo dõi theo bitmask `e.buttons`.
 * - Mất focus (blur) / tab ẩn → thả mọi thứ đang giữ, không kẹt modifier.
 * - Không bôi đen chữ (game bar) khi bấm chuột nhanh trên `surface`.
 * `timeStamp` = event.timeStamp (trục performance.now) để chấm điểm, không dùng lúc xử lý.
 * Practice chỉ nhận input khi tab app đang focus (giới hạn của trình duyệt).
 */
import { CODE_TO_KEY } from '../core/keys';
import type { NoteKey } from '../core/types';

import type { PracticeInputEvent, PracticeModifier } from './practice.types';

export interface PracticeInputTarget {
  window: Window;
  /** Vùng nhận click chuột (khu tiles). */
  surface: HTMLElement;
}

export interface PracticeInputOptions {
  onEvent: (ev: PracticeInputEvent) => void;
}

/** Bit của `MouseEvent.buttons`: 1 = trái, 2 = phải, 4 = giữa (scroll). */
const MOUSE_BITS: readonly (readonly [number, PracticeModifier])[] = [
  [1, 'left'],
  [2, 'right'],
  [4, 'scroll'],
];
const ALL_MOUSE_BITS = 7;

/** `MouseEvent.button` → bit trong `buttons` (0 trái, 1 giữa, 2 phải; nút khác bỏ qua). */
function buttonBit(button: number): number {
  return button === 0 ? 1 : button === 1 ? 4 : button === 2 ? 2 : 0;
}

interface ElementLike {
  tagName: string;
  closest: (selector: string) => unknown;
  getAttribute: (name: string) => string | null;
}

// Duck-typing thay `instanceof Element` để chạy được với Window khác (popout/iframe).
function asElement(x: unknown): ElementLike | null {
  if (x === null || typeof x !== 'object') return null;
  const el = x as Partial<ElementLike>;
  return typeof el.tagName === 'string' &&
    typeof el.closest === 'function' &&
    typeof el.getAttribute === 'function'
    ? (x as ElementLike)
    : null;
}

/** input mà phím chữ không làm thay đổi gì (slider BPM, checkbox…) → practice vẫn nhận phím. */
const NON_TEXT_INPUT_TYPES: readonly string[] = [
  'range',
  'checkbox',
  'radio',
  'button',
  'submit',
  'reset',
  'color',
  'file',
  'image',
];

/**
 * Focus đang ở chỗ gõ chữ (textarea, select, contenteditable, input kiểu chữ) hoặc trong dialog
 * `aria-modal` → bỏ qua phím practice để người dùng gõ bình thường.
 */
export function isPracticeBlockedTarget(target: unknown): boolean {
  const el = asElement(target);
  if (!el) return false;
  const tag = el.tagName.toUpperCase();
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag === 'INPUT') {
    const type = (el.getAttribute('type') ?? 'text').toLowerCase();
    if (!NON_TEXT_INPUT_TYPES.includes(type)) return true;
  }
  return (
    el.closest('[contenteditable]:not([contenteditable="false"])') !== null ||
    el.closest('[aria-modal="true"]') !== null
  );
}

/**
 * Gắn listener practice lên `window` + `surface`. Trả cleanup gỡ mọi listener (không phát thêm
 * sự kiện thả — engine tự `releaseModifiers()` nếu cần).
 */
export function attachPracticeInput(
  target: PracticeInputTarget,
  opts: PracticeInputOptions,
): () => void {
  const win = target.window;
  const doc = win.document;
  const { surface } = target;
  const { onEvent } = opts;

  /** code phím nốt đang giữ → phím. */
  const heldNotes = new Map<string, NoteKey>();
  /** Bitmask nút chuột đang giữ (chỉ tính khi bắt đầu bấm trên surface). */
  let mouseMask = 0;
  /** Chuột phải bấm từ surface: chặn contextmenu kế tiếp dù nhả chỗ khác (Windows mở lúc nhả). */
  let swallowContextMenu = false;

  const emitMod = (type: 'mod-down' | 'mod-up', modifier: PracticeModifier, timeStamp: number) =>
    onEvent({ type, modifier, source: 'mouse', timeStamp });

  const blocked = (e: Event): boolean =>
    isPracticeBlockedTarget(e.target) || isPracticeBlockedTarget(doc.activeElement);

  const applyMouseMask = (mask: number, timeStamp: number) => {
    const next = mask & ALL_MOUSE_BITS;
    for (const [bit, modifier] of MOUSE_BITS) {
      const was = (mouseMask & bit) !== 0;
      const now = (next & bit) !== 0;
      if (now && !was) emitMod('mod-down', modifier, timeStamp);
      else if (was && !now) emitMod('mod-up', modifier, timeStamp);
    }
    mouseMask = next;
  };

  const releaseAll = (timeStamp: number) => {
    for (const key of heldNotes.values()) {
      onEvent({ type: 'key-up', key, source: 'keyboard', timeStamp });
    }
    heldNotes.clear();
    applyMouseMask(0, timeStamp);
    swallowContextMenu = false;
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.isComposing) return;
    const key = Object.hasOwn(CODE_TO_KEY, e.code) ? CODE_TO_KEY[e.code] : undefined;
    // Chỉ phím nốt; phím khác (kể cả Ctrl / Alt / Shift) để phím tắt / trình duyệt xử lý.
    if (key === undefined || blocked(e)) return;
    // Ctrl / Alt / Cmd + phím: phím tắt của trình duyệt / hệ điều hành (Ctrl+C, Ctrl+N…), không phải nốt.
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    e.preventDefault();
    const id = e.code || e.key;
    if (e.repeat || heldNotes.has(id)) return;
    heldNotes.set(id, key);
    onEvent({ type: 'key-down', key, source: 'keyboard', timeStamp: e.timeStamp });
  };

  const onKeyUp = (e: KeyboardEvent) => {
    const id = e.code || e.key;
    const key = heldNotes.get(id);
    if (key === undefined) return;
    heldNotes.delete(id);
    e.preventDefault();
    onEvent({ type: 'key-up', key, source: 'keyboard', timeStamp: e.timeStamp });
  };

  const isTouch = (e: PointerEvent) => e.pointerType === 'touch';

  const onSurfacePointerDown = (e: PointerEvent) => {
    if (isTouch(e)) return;
    const bit = buttonBit(e.button);
    if (bit === 0) return;
    const mask = (e.buttons & ALL_MOUSE_BITS) | bit;
    if ((mask & 2) !== 0) swallowContextMenu = true;
    applyMouseMask(mask, e.timeStamp);
  };

  const onPointerMove = (e: PointerEvent) => {
    if (mouseMask === 0 || isTouch(e)) return;
    const mask = e.buttons & ALL_MOUSE_BITS;
    if (mask === mouseMask) return;
    if ((mask & ~mouseMask & 2) !== 0) swallowContextMenu = true;
    applyMouseMask(mask, e.timeStamp);
  };

  const onPointerUp = (e: PointerEvent) => {
    if (mouseMask === 0 || isTouch(e)) return;
    applyMouseMask(e.buttons & ~buttonBit(e.button), e.timeStamp);
  };

  const onPointerCancel = (e: PointerEvent) => {
    if (mouseMask !== 0) applyMouseMask(0, e.timeStamp);
  };

  const preventDefault = (e: Event) => e.preventDefault();

  const onSurfaceMouseDown = (e: MouseEvent) => {
    // Chuột giữa: chặn autoscroll.
    if (e.button === 1) e.preventDefault();
  };

  const onWindowContextMenu = (e: MouseEvent) => {
    if (!swallowContextMenu) return;
    swallowContextMenu = false;
    e.preventDefault();
  };

  const onSurfaceContextMenu = (e: MouseEvent) => {
    swallowContextMenu = false;
    e.preventDefault();
  };

  const onBlur = (e: FocusEvent) => {
    // Chỉ blur của chính window (element blur không nổi bọt; phòng hờ nếu có).
    const t = e.target as { nodeType?: unknown } | null;
    if (t !== null && t.nodeType === 1) return;
    releaseAll(e.timeStamp);
  };

  const onVisibility = (e: Event) => {
    if (doc.visibilityState === 'hidden') releaseAll(e.timeStamp);
  };

  // Capture: element con có stopPropagation cũng không làm mất keyup/pointerup (kẹt modifier).
  const capture = { capture: true } as const;
  win.addEventListener('keydown', onKeyDown, capture);
  win.addEventListener('keyup', onKeyUp, capture);
  win.addEventListener('pointermove', onPointerMove, capture);
  win.addEventListener('pointerup', onPointerUp, capture);
  win.addEventListener('pointercancel', onPointerCancel, capture);
  win.addEventListener('contextmenu', onWindowContextMenu);
  win.addEventListener('blur', onBlur);
  doc.addEventListener('visibilitychange', onVisibility);
  surface.addEventListener('pointerdown', onSurfacePointerDown);
  surface.addEventListener('mousedown', onSurfaceMouseDown);
  surface.addEventListener('contextmenu', onSurfaceContextMenu);
  surface.addEventListener('auxclick', preventDefault);
  // Bấm chuột trái nhanh (double / triple click) trên game bar không bôi đen chữ.
  surface.addEventListener('selectstart', preventDefault);

  return () => {
    win.removeEventListener('keydown', onKeyDown, capture);
    win.removeEventListener('keyup', onKeyUp, capture);
    win.removeEventListener('pointermove', onPointerMove, capture);
    win.removeEventListener('pointerup', onPointerUp, capture);
    win.removeEventListener('pointercancel', onPointerCancel, capture);
    win.removeEventListener('contextmenu', onWindowContextMenu);
    win.removeEventListener('blur', onBlur);
    doc.removeEventListener('visibilitychange', onVisibility);
    surface.removeEventListener('pointerdown', onSurfacePointerDown);
    surface.removeEventListener('mousedown', onSurfaceMouseDown);
    surface.removeEventListener('contextmenu', onSurfaceContextMenu);
    surface.removeEventListener('auxclick', preventDefault);
    surface.removeEventListener('selectstart', preventDefault);
    heldNotes.clear();
    mouseMask = 0;
  };
}

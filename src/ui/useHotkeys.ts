import { useEffect, useLayoutEffect, useRef } from 'react';
import { KEY_CODES } from '../core/keys';

/**
 * Phím tắt của app theo `KeyboardEvent.code` (không phụ thuộc layout bàn phím).
 * Phím nốt Z X C V B N M , dành riêng cho practice mode: hook từ chối bind.
 */

export type HotkeyHandler = (e: KeyboardEvent) => void;
/** code → handler. Handler `undefined` = tạm không bind (tiện cho bind có điều kiện). */
export type HotkeyBindings = Readonly<Record<string, HotkeyHandler | undefined>>;

export interface UseHotkeysOptions {
  /** Mặc định true. false = gỡ listener. */
  enabled?: boolean;
  /** Mặc định `window`. */
  target?: Window;
  /**
   * Các code được chạy lại khi giữ phím (auto-repeat). Code khác là phím kiểu toggle
   * (Space, R, L…): bỏ qua `e.repeat`. Mặc định: DEFAULT_REPEATABLE_CODES.
   */
  repeatable?: readonly string[];
}

/** Code phím tắt của Player (dùng chung cho Player và ShortcutsHelp). */
export const PLAYER_HOTKEYS = {
  playPause: 'Space',
  restart: 'KeyR',
  prevLine: 'ArrowLeft',
  nextLine: 'ArrowRight',
  loop: 'KeyL',
  bpmDown: 'BracketLeft',
  bpmUp: 'BracketRight',
} as const;

export type PlayerHotkey = keyof typeof PLAYER_HOTKEYS;

/** KeyZ KeyX KeyC KeyV KeyB KeyN KeyM Comma. */
export const RESERVED_NOTE_CODES: readonly string[] = Object.values(KEY_CODES);

/** Phím bước (seek dòng, BPM) được phép lặp khi giữ. */
export const DEFAULT_REPEATABLE_CODES: readonly string[] = [
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'ArrowDown',
  'BracketLeft',
  'BracketRight',
];

export function isReservedCode(code: string): boolean {
  return RESERVED_NOTE_CODES.includes(code);
}

/** Các code bị cấm có trong bindings (có handler). */
export function reservedCodesIn(bindings: HotkeyBindings): string[] {
  return Object.keys(bindings).filter((c) => bindings[c] !== undefined && isReservedCode(c));
}

interface ElementLike {
  tagName: string;
  closest: (selector: string) => unknown;
}

// Duck-typing thay `instanceof Element` để chạy được với Window khác (popout/iframe).
function asElement(x: unknown): ElementLike | null {
  if (x === null || typeof x !== 'object') return null;
  const el = x as Partial<ElementLike>;
  return typeof el.tagName === 'string' && typeof el.closest === 'function'
    ? (x as ElementLike)
    : null;
}

/** Focus đang ở ô nhập (input/textarea/select/contenteditable) → không xử lý phím tắt. */
export function isEditableTarget(target: unknown): boolean {
  const el = asElement(target);
  if (!el) return false;
  const tag = el.tagName.toUpperCase();
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return el.closest('[contenteditable]:not([contenteditable="false"])') !== null;
}

function isInModal(target: unknown): boolean {
  const el = asElement(target);
  return el !== null && el.closest('[aria-modal="true"]') !== null;
}

/** Control mà Space bấm được theo chuẩn (nút, nút bật / tắt, switch, checkbox / radio / tab tự làm). */
const ACTIVATABLE_SELECTOR =
  'button, summary, [role="button"], [role="switch"], [role="checkbox"], [role="radio"], [role="tab"], [role="menuitem"]';

/** Phần tử (focus) là control bấm được bằng Space. */
export function isActivatableControl(target: unknown): boolean {
  const el = asElement(target);
  return el !== null && el.closest(ACTIVATABLE_SELECTOR) === target;
}

/** Cách người dùng tương tác gần nhất trước khi focus đổi (theo dõi trong `useHotkeys`). */
interface FocusOrigin {
  /** 'tab' = phím gần nhất là Tab / Shift+Tab; null = chuột, phím khác hoặc chưa biết. */
  lastInput: 'tab' | null;
  /**
   * Phần tử người dùng TỰ Tab tới; null = focus tới bằng chuột / chạm, hoặc do app chuyển focus sau một
   * phím khác (vd. Space phát → app focus nút khác: Space lần sau vẫn là phím tắt).
   */
  keyboardFocused: EventTarget | null;
}

const warned = new Set<string>();

function refuseReserved(codes: readonly string[]): void {
  const msg =
    `useHotkeys: ${codes.join(', ')} is reserved for practice mode ` +
    '(note keys Z X C V B N M ,) and cannot be bound as an app shortcut.';
  if (import.meta.env.DEV) throw new Error(msg);
  const key = codes.join(',');
  if (!warned.has(key)) {
    warned.add(key);
    console.warn(msg);
  }
}

/**
 * Gắn phím tắt lên window. Bỏ qua khi:
 * - đang gõ trong input/textarea/select/contenteditable, hoặc focus nằm trong dialog `aria-modal`;
 * - có Ctrl/Meta/Alt, đang gõ IME (`isComposing`), hoặc event đã bị `preventDefault` trước đó;
 * - `e.repeat` với phím không nằm trong `repeatable`;
 * - Space khi focus đang ở một control bấm được (nút, nút bật / tắt, switch…) mà người dùng TAB tới — chuẩn
 *   bàn phím: Space bấm control đang focus (vòng sửa R5). Focus tới bằng chuột (bấm nút rồi nhấn Space)
 *   hoặc do app tự chuyển focus thì Space vẫn là phím tắt (D-033).
 * Phím được xử lý luôn `preventDefault()` (Space không cuộn trang, không "click" nút đang focus);
 * keyup tương ứng cũng bị chặn để nút đang focus không nhận click lần hai.
 * Bindings đổi identity mỗi render vẫn ổn (đọc qua ref, không gắn lại listener).
 */
export function useHotkeys(bindings: HotkeyBindings, opts: UseHotkeysOptions = {}): void {
  const { enabled = true, target, repeatable = DEFAULT_REPEATABLE_CODES } = opts;

  const reserved = reservedCodesIn(bindings);
  if (reserved.length > 0) refuseReserved(reserved);

  const bindingsRef = useRef(bindings);
  const repeatableRef = useRef(repeatable);
  const originRef = useRef<FocusOrigin>({ lastInput: null, keyboardFocused: null });
  useLayoutEffect(() => {
    bindingsRef.current = bindings;
    repeatableRef.current = repeatable;
  });

  // Focus tới control bằng Tab hay cách khác — không phụ thuộc `enabled` (hộp thoại đang mở không làm
  // mất dấu nguồn focus).
  useEffect(() => {
    const win = target ?? window;
    const origin = originRef.current;
    const onPointer = () => {
      origin.lastInput = null;
    };
    const onKey = (e: KeyboardEvent) => {
      origin.lastInput = e.key === 'Tab' ? 'tab' : null;
    };
    const onFocusIn = (e: FocusEvent) => {
      origin.keyboardFocused = origin.lastInput === 'tab' ? e.target : null;
    };
    win.addEventListener('pointerdown', onPointer, true);
    win.addEventListener('mousedown', onPointer, true);
    win.addEventListener('keydown', onKey, true);
    win.document.addEventListener('focusin', onFocusIn, true);
    return () => {
      win.removeEventListener('pointerdown', onPointer, true);
      win.removeEventListener('mousedown', onPointer, true);
      win.removeEventListener('keydown', onKey, true);
      win.document.removeEventListener('focusin', onFocusIn, true);
      origin.lastInput = null;
      origin.keyboardFocused = null;
    };
  }, [target]);

  useEffect(() => {
    if (!enabled) return;
    const win = target ?? window;
    // Code đã xử lý ở keydown → chặn keyup tương ứng.
    const pendingUp = new Set<string>();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const code = e.code;
      if (!code || isReservedCode(code)) return;
      const map = bindingsRef.current;
      const handler = Object.hasOwn(map, code) ? map[code] : undefined;
      if (!handler) return;
      const active = win.document.activeElement;
      if (isEditableTarget(e.target) || isEditableTarget(active)) return;
      if (isInModal(e.target) || isInModal(active)) return;
      // Space trên control đang focus bằng bàn phím: để trình duyệt bấm control đó (không phát / dừng).
      if (
        code === 'Space' &&
        active !== null &&
        originRef.current.keyboardFocused === active &&
        isActivatableControl(active)
      ) {
        return;
      }

      e.preventDefault();
      pendingUp.add(code);
      if (e.repeat && !repeatableRef.current.includes(code)) return;
      handler(e);
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (pendingUp.delete(e.code)) e.preventDefault();
    };

    win.addEventListener('keydown', onKeyDown);
    win.addEventListener('keyup', onKeyUp);
    return () => {
      win.removeEventListener('keydown', onKeyDown);
      win.removeEventListener('keyup', onKeyUp);
      pendingUp.clear();
    };
  }, [enabled, target]);
}

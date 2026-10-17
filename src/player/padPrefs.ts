/**
 * Tùy chọn cục bộ của bàn chạm Mobile (không nằm trong Cài đặt): "Rung khi chạm" — mặc định BẬT trên
 * máy cảm ứng, TẮT nơi khác; lưu ở một khóa localStorage riêng, đọc / ghi đều bọc try (chế độ riêng tư,
 * file://, bộ nhớ đầy → chỉ mất phần lưu). Dùng chung giữa HUD luyện tập (công tắc) và MobilePad (rung).
 */
import { useSyncExternalStore } from 'react';

export const PAD_VIBRATE_STORAGE_KEY = 'dfht-pad-vibrate';

/** Máy có màn cảm ứng (ngón tay là con trỏ chính hoặc có điểm chạm). */
export function isTouchDevice(win: Window | undefined = globalThis.window): boolean {
  if (!win) return false;
  try {
    if ((win.navigator?.maxTouchPoints ?? 0) > 0) return true;
    return typeof win.matchMedia === 'function' && win.matchMedia('(pointer: coarse)').matches;
  } catch {
    return false;
  }
}

/**
 * Con trỏ CHÍNH là ngón tay (điện thoại / máy tính bảng; laptop màn cảm ứng vẫn là chuột → false): ghi
 * chú về bàn phím trong HUD luyện tập không áp dụng.
 */
export function hasCoarsePointer(win: Window | undefined = globalThis.window): boolean {
  try {
    return typeof win?.matchMedia === 'function' && win.matchMedia('(pointer: coarse)').matches;
  } catch {
    return false;
  }
}

/** Trình duyệt có Vibration API (Chrome Android; iOS / Firefox desktop không có). */
export function canVibrate(win: Window | undefined = globalThis.window): boolean {
  return typeof (win?.navigator as { vibrate?: unknown } | undefined)?.vibrate === 'function';
}

function readStored(): boolean | null {
  try {
    const v = localStorage.getItem(PAD_VIBRATE_STORAGE_KEY);
    return v === '1' ? true : v === '0' ? false : null;
  } catch {
    return null;
  }
}

let current: boolean | null = null;
const listeners = new Set<() => void>();

/** Giá trị hiện tại ("Rung khi chạm"). */
export function getPadVibrate(): boolean {
  if (current === null) current = readStored() ?? isTouchDevice();
  return current;
}

export function setPadVibrate(on: boolean): void {
  current = on;
  try {
    localStorage.setItem(PAD_VIBRATE_STORAGE_KEY, on ? '1' : '0');
  } catch {
    // Không lưu được — vẫn áp trong phiên này.
  }
  for (const l of [...listeners]) l();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Hook: [đang bật, đặt]. */
export function usePadVibrate(): [boolean, (on: boolean) => void] {
  const on = useSyncExternalStore(subscribe, getPadVibrate, getPadVibrate);
  return [on, setPadVibrate];
}

/** Chỉ cho test: quên giá trị đã đọc (đọc lại từ localStorage / mặc định). */
export function resetPadVibrateForTest(): void {
  current = null;
}

// ── Gợi ý "Xoay ngang" (điện thoại dọc) đã đóng ──

export const ROTATE_HINT_STORAGE_KEY = 'dfht-rotate-hint-dismissed';

export function isRotateHintDismissed(): boolean {
  try {
    return localStorage.getItem(ROTATE_HINT_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function dismissRotateHint(): void {
  try {
    localStorage.setItem(ROTATE_HINT_STORAGE_KEY, '1');
  } catch {
    // Không lưu được — chỉ ẩn trong lần mở này.
  }
}

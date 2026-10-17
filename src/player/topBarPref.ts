/**
 * "Thu gọn thanh trên" của màn chơi (góp ý 2026-10-17): ẩn header + thanh điều khiển để khu tiles cao tối đa.
 * Tùy chọn cục bộ (không nằm trong Cài đặt), nhớ ở một khóa localStorage riêng; đọc / ghi bọc try (chế độ
 * riêng tư, file://, bộ nhớ đầy → chỉ mất phần lưu).
 */
import { useSyncExternalStore } from 'react';

export const TOP_COLLAPSED_STORAGE_KEY = 'dfht-player-top-collapsed';

function readStored(): boolean {
  try {
    return localStorage.getItem(TOP_COLLAPSED_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

let current: boolean | null = null;
const listeners = new Set<() => void>();

export function getTopCollapsed(): boolean {
  if (current === null) current = readStored();
  return current;
}

export function setTopCollapsed(on: boolean): void {
  current = on;
  try {
    if (on) localStorage.setItem(TOP_COLLAPSED_STORAGE_KEY, '1');
    else localStorage.removeItem(TOP_COLLAPSED_STORAGE_KEY);
  } catch {
    // chỉ mất phần lưu
  }
  for (const l of listeners) l();
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

/** Hook: thanh trên đang thu gọn? */
export function useTopCollapsed(): boolean {
  return useSyncExternalStore(subscribe, getTopCollapsed, () => false);
}

/** Chỉ cho test: quên giá trị đã đọc. */
export function resetTopCollapsedForTest(): void {
  current = null;
}

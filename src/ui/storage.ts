import type { PersistStorage, StorageValue } from 'zustand/middleware';

/**
 * Storage cho zustand `persist` không bao giờ throw (DECISIONS D-065): localStorage đầy (quota),
 * bị chặn (chế độ riêng tư, file:// trên vài trình duyệt) hay JSON hỏng không được làm hỏng thao
 * tác trong bộ nhớ — chỉ mất phần lưu. Dùng chung cho settings và thư viện.
 */
export interface GuardedStorageOptions<S> {
  /** Tiền tố cho console.warn, vd. 'settings'. */
  tag: string;
  /** Chuỗi đã lưu → giá trị persist. Mặc định JSON.parse; hỏng → null. */
  decode?: (text: string | null) => StorageValue<S> | null;
  /**
   * Gọi khi ghi thất bại — chỉ một lần cho mỗi chuỗi lỗi liên tiếp (kéo slider khi bộ nhớ đầy
   * không sinh hàng chục toast); ghi thành công lại thì lần lỗi sau được báo tiếp.
   */
  onSaveError?: (error: unknown) => void;
  /** Mặc định `localStorage` (đọc lười: truy cập có thể throw). */
  getStorage?: () => Storage;
}

function defaultDecode<S>(text: string | null): StorageValue<S> | null {
  if (text === null) return null;
  try {
    return JSON.parse(text) as StorageValue<S>;
  } catch {
    return null;
  }
}

export function createGuardedStorage<S>(opts: GuardedStorageOptions<S>): PersistStorage<S> {
  const decode = opts.decode ?? defaultDecode<S>;
  const getStorage = opts.getStorage ?? (() => localStorage);
  let failing = false;

  return {
    getItem: (name) => {
      try {
        return decode(getStorage().getItem(name));
      } catch {
        return null;
      }
    },
    setItem: (name, value) => {
      try {
        getStorage().setItem(name, JSON.stringify(value));
        failing = false;
      } catch (e) {
        console.warn(`[${opts.tag}] save failed`, e);
        if (!failing) {
          failing = true;
          opts.onSaveError?.(e);
        }
      }
    },
    removeItem: (name) => {
      try {
        getStorage().removeItem(name);
      } catch {
        // ignore
      }
    },
  };
}

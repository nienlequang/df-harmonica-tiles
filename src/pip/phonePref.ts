/**
 * Loại điện thoại cho nút "Cửa sổ nổi" của màn chơi trên điện thoại (góp ý R7-6): hỏi một lần "Apple
 * (iPhone / iPad) hay Android?", nhớ theo máy ở một khóa localStorage riêng (đọc / ghi bọc try — chế độ
 * riêng tư, file://, bộ nhớ đầy → chỉ nhớ trong phiên này). Apple → thẳng tới video nổi dựng sẵn; Android
 * → trang mini cho cửa sổ nổi.
 *
 * Quyết định theo LỰA CHỌN ĐÃ LƯU; UA chỉ dùng để chọn sẵn nút trong hộp thoại hỏi, và — khi chưa chọn bao
 * giờ (vd. mở thẳng link trang mini) — để đoán cho hộp thoại video nổi (`resolvePhoneKind`).
 *
 * Module nhẹ (không import videoPip / renderer): màn chơi nạp nó ngay, phần video nổi tải lười.
 */
import { useSyncExternalStore } from 'react';

export type PhoneKind = 'apple' | 'android';

export const PHONE_KIND_STORAGE_KEY = 'dfht-phone-kind';

/** iPhone / iPod / iPad (iPadOS báo UA "Macintosh" nhưng có cảm ứng đa điểm). */
export function isAppleMobile(
  nav: Pick<Navigator, 'userAgent' | 'maxTouchPoints'> | null = typeof navigator !== 'undefined'
    ? navigator
    : null,
): boolean {
  if (!nav) return false;
  const ua = String(nav.userAgent);
  if (/iPhone|iPad|iPod/i.test(ua)) return true;
  return /Macintosh/i.test(ua) && (nav.maxTouchPoints ?? 0) > 1;
}

/** Đoán theo UA (chỉ để chọn sẵn): Apple nếu là iPhone / iPad, còn lại Android. */
export function guessPhoneKind(
  nav: Pick<Navigator, 'userAgent' | 'maxTouchPoints'> | null = typeof navigator !== 'undefined'
    ? navigator
    : null,
): PhoneKind {
  return isAppleMobile(nav) ? 'apple' : 'android';
}

function isPhoneKind(v: unknown): v is PhoneKind {
  return v === 'apple' || v === 'android';
}

/** Giá trị trong phiên khi localStorage không ghi / đọc được (undefined = dùng localStorage). */
let fallback: PhoneKind | null | undefined;

/** Lựa chọn đã lưu trên máy này; null = chưa chọn. */
export function getPhoneKind(): PhoneKind | null {
  try {
    const v = localStorage.getItem(PHONE_KIND_STORAGE_KEY);
    if (isPhoneKind(v)) return v;
  } catch {
    // storage bị chặn → giá trị trong phiên
  }
  return fallback ?? null;
}

const listeners = new Set<() => void>();

function notify(): void {
  for (const l of [...listeners]) l();
}

/** Lưu lựa chọn (null = quên, lần sau hỏi lại). */
export function setPhoneKind(kind: PhoneKind | null): void {
  try {
    if (kind === null) localStorage.removeItem(PHONE_KIND_STORAGE_KEY);
    else localStorage.setItem(PHONE_KIND_STORAGE_KEY, kind);
    fallback = undefined;
  } catch {
    // Không lưu được — vẫn áp trong phiên này.
    fallback = kind;
  }
  notify();
}

/** Lựa chọn đã lưu, chưa chọn thì đoán theo UA (hộp thoại video nổi của trang mini). */
export function resolvePhoneKind(): PhoneKind {
  return getPhoneKind() ?? guessPhoneKind();
}

function onStorage(e: StorageEvent): void {
  // Tab khác (vd. trang mini) đổi lựa chọn.
  if (e.key === null || e.key === PHONE_KIND_STORAGE_KEY) notify();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1 && typeof window !== 'undefined') {
    window.addEventListener('storage', onStorage);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && typeof window !== 'undefined') {
      window.removeEventListener('storage', onStorage);
    }
  };
}

/** Hook: [lựa chọn đã lưu (null = chưa chọn), đặt]. */
export function usePhoneKind(): [PhoneKind | null, (kind: PhoneKind | null) => void] {
  const kind = useSyncExternalStore(subscribe, getPhoneKind, getPhoneKind);
  return [kind, setPhoneKind];
}

/** Hook: điện thoại là Apple (lựa chọn đã lưu; chưa chọn → đoán theo UA). */
export function useIsApplePhone(): boolean {
  const [kind] = usePhoneKind();
  return (kind ?? guessPhoneKind()) === 'apple';
}

/** Chỉ cho test: quên giá trị trong phiên (localStorage do test tự dọn). */
export function resetPhoneKindForTest(): void {
  fallback = undefined;
}

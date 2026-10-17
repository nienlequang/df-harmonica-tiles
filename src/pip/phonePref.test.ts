/**
 * Loại điện thoại (R7-6): nhớ theo máy ở localStorage riêng, bọc try (bị chặn → nhớ trong phiên); UA chỉ để
 * đoán / chọn sẵn; hook cập nhật khi đổi (cả từ tab khác qua sự kiện `storage`).
 */
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  PHONE_KIND_STORAGE_KEY,
  getPhoneKind,
  guessPhoneKind,
  isAppleMobile,
  resetPhoneKindForTest,
  resolvePhoneKind,
  setPhoneKind,
  useIsApplePhone,
  usePhoneKind,
} from './phonePref';

const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const IPADOS =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15';
const ANDROID =
  'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36';

/** UA giả (thuộc tính riêng của `navigator`, gỡ sau mỗi test → về UA của jsdom). */
function stubUa(ua: string): void {
  Object.defineProperty(navigator, 'userAgent', { configurable: true, get: () => ua });
}

afterEach(() => {
  vi.restoreAllMocks();
  delete (navigator as unknown as Record<string, unknown>).userAgent;
  resetPhoneKindForTest();
});

describe('đoán theo UA (chỉ để chọn sẵn)', () => {
  it('iPhone / iPadOS ("Macintosh" có cảm ứng) → apple; Mac / Android → android', () => {
    expect(isAppleMobile({ userAgent: IPHONE, maxTouchPoints: 5 })).toBe(true);
    expect(isAppleMobile({ userAgent: IPADOS, maxTouchPoints: 5 })).toBe(true);
    expect(isAppleMobile({ userAgent: IPADOS, maxTouchPoints: 0 })).toBe(false);
    expect(isAppleMobile(null)).toBe(false);
    expect(guessPhoneKind({ userAgent: IPHONE, maxTouchPoints: 5 })).toBe('apple');
    expect(guessPhoneKind({ userAgent: ANDROID, maxTouchPoints: 5 })).toBe('android');
    expect(guessPhoneKind(null)).toBe('android');
  });
});

describe('lựa chọn đã lưu', () => {
  it('chưa chọn → null; chọn → lưu localStorage; null → quên', () => {
    expect(getPhoneKind()).toBeNull();
    setPhoneKind('apple');
    expect(localStorage.getItem(PHONE_KIND_STORAGE_KEY)).toBe('apple');
    expect(getPhoneKind()).toBe('apple');
    setPhoneKind('android');
    expect(getPhoneKind()).toBe('android');
    setPhoneKind(null);
    expect(localStorage.getItem(PHONE_KIND_STORAGE_KEY)).toBeNull();
    expect(getPhoneKind()).toBeNull();
  });

  it('giá trị rác trong storage → coi như chưa chọn', () => {
    localStorage.setItem(PHONE_KIND_STORAGE_KEY, 'windows-phone');
    expect(getPhoneKind()).toBeNull();
  });

  it('lựa chọn đã lưu thắng UA; chưa chọn thì resolve theo UA', () => {
    stubUa(IPHONE);
    expect(resolvePhoneKind()).toBe('apple');
    setPhoneKind('android');
    expect(resolvePhoneKind()).toBe('android');
  });

  it('localStorage bị chặn → vẫn nhớ trong phiên, không ném lỗi', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    expect(() => setPhoneKind('apple')).not.toThrow();
    expect(getPhoneKind()).toBe('apple');
  });
});

describe('usePhoneKind / useIsApplePhone', () => {
  it('đổi lựa chọn → hook cập nhật; tab khác đổi (sự kiện storage) → cập nhật', () => {
    stubUa(ANDROID);
    const kind = renderHook(() => usePhoneKind());
    const apple = renderHook(() => useIsApplePhone());
    expect(kind.result.current[0]).toBeNull();
    expect(apple.result.current).toBe(false);
    act(() => kind.result.current[1]('apple'));
    expect(kind.result.current[0]).toBe('apple');
    expect(apple.result.current).toBe(true);
    // Tab khác ghi thẳng localStorage rồi trình duyệt báo `storage` ở tab này.
    act(() => {
      localStorage.setItem(PHONE_KIND_STORAGE_KEY, 'android');
      window.dispatchEvent(new StorageEvent('storage', { key: PHONE_KIND_STORAGE_KEY }));
    });
    expect(kind.result.current[0]).toBe('android');
    expect(apple.result.current).toBe(false);
  });

  it('chưa chọn: useIsApplePhone đoán theo UA', () => {
    stubUa(IPHONE);
    const apple = renderHook(() => useIsApplePhone());
    expect(apple.result.current).toBe(true);
  });
});

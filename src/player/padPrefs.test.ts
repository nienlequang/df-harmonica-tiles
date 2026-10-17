/** "Rung khi chạm" + gợi ý xoay ngang: mặc định theo máy cảm ứng, lưu khóa riêng, không ném khi bộ nhớ lỗi. */
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PAD_VIBRATE_STORAGE_KEY,
  ROTATE_HINT_STORAGE_KEY,
  canVibrate,
  dismissRotateHint,
  getPadVibrate,
  hasCoarsePointer,
  isRotateHintDismissed,
  isTouchDevice,
  resetPadVibrateForTest,
  setPadVibrate,
  usePadVibrate,
} from './padPrefs';

const fakeWin = (maxTouchPoints: number, coarse: boolean, vibrate?: unknown): Window =>
  ({
    navigator: { maxTouchPoints, vibrate },
    matchMedia: () => ({ matches: coarse }),
  }) as unknown as Window;

beforeEach(() => resetPadVibrateForTest());
afterEach(() => {
  vi.restoreAllMocks();
  resetPadVibrateForTest();
});

describe('isTouchDevice / canVibrate', () => {
  it('điểm chạm hoặc con trỏ thô = máy cảm ứng', () => {
    expect(isTouchDevice(fakeWin(5, false))).toBe(true);
    expect(isTouchDevice(fakeWin(0, true))).toBe(true);
    expect(isTouchDevice(fakeWin(0, false))).toBe(false);
    expect(isTouchDevice(undefined)).toBe(false);
    const broken = {
      navigator: { maxTouchPoints: 0 },
      matchMedia: () => {
        throw new Error('x');
      },
    } as unknown as Window;
    expect(isTouchDevice(broken)).toBe(false);
  });

  it('con trỏ chính là ngón tay (pointer: coarse); laptop cảm ứng có chuột → không', () => {
    expect(hasCoarsePointer(fakeWin(0, true))).toBe(true);
    expect(hasCoarsePointer(fakeWin(10, false))).toBe(false);
    expect(hasCoarsePointer(undefined)).toBe(false);
    const broken = {
      matchMedia: () => {
        throw new Error('x');
      },
    } as unknown as Window;
    expect(hasCoarsePointer(broken)).toBe(false);
  });

  it('Vibration API có / không', () => {
    expect(canVibrate(fakeWin(0, false, () => true))).toBe(true);
    expect(canVibrate(fakeWin(0, false))).toBe(false);
    expect(canVibrate(undefined)).toBe(false);
  });
});

describe('Rung khi chạm', () => {
  it('mặc định theo máy (jsdom: không cảm ứng → tắt); lưu và đọc lại', () => {
    expect(getPadVibrate()).toBe(isTouchDevice());
    setPadVibrate(true);
    expect(localStorage.getItem(PAD_VIBRATE_STORAGE_KEY)).toBe('1');
    resetPadVibrateForTest();
    expect(getPadVibrate()).toBe(true);
    setPadVibrate(false);
    resetPadVibrateForTest();
    expect(getPadVibrate()).toBe(false);
  });

  it('localStorage lỗi: không ném, vẫn áp trong phiên', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    expect(() => getPadVibrate()).not.toThrow();
    expect(() => setPadVibrate(true)).not.toThrow();
    expect(getPadVibrate()).toBe(true);
    expect(isRotateHintDismissed()).toBe(false);
    expect(() => dismissRotateHint()).not.toThrow();
  });

  it('hook cập nhật mọi nơi dùng', () => {
    const a = renderHook(() => usePadVibrate());
    const b = renderHook(() => usePadVibrate());
    act(() => a.result.current[1](true));
    expect(b.result.current[0]).toBe(true);
    act(() => b.result.current[1](false));
    expect(a.result.current[0]).toBe(false);
  });
});

describe('gợi ý xoay ngang', () => {
  it('đóng thì nhớ', () => {
    expect(isRotateHintDismissed()).toBe(false);
    dismissRotateHint();
    expect(localStorage.getItem(ROTATE_HINT_STORAGE_KEY)).toBe('1');
    expect(isRotateHintDismissed()).toBe(true);
  });
});

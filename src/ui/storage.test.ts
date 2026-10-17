import { describe, expect, it, vi } from 'vitest';
import { createGuardedStorage } from './storage';

function fakeStorage(overrides: Partial<Storage> = {}): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    key: (i) => Array.from(data.keys())[i] ?? null,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
    ...overrides,
  };
}

const quota = () => {
  throw new DOMException('exceeded the quota', 'QuotaExceededError');
};

describe('createGuardedStorage', () => {
  it('ghi / đọc JSON { state, version }', () => {
    const backing = fakeStorage();
    const s = createGuardedStorage<{ a: number }>({ tag: 't', getStorage: () => backing });
    s.setItem('k', { state: { a: 1 }, version: 2 });
    expect(backing.getItem('k')).toBe('{"state":{"a":1},"version":2}');
    expect(s.getItem('k')).toEqual({ state: { a: 1 }, version: 2 });
    s.removeItem('k');
    expect(s.getItem('k')).toBeNull();
  });

  it('JSON hỏng / storage throw khi đọc → null, không throw', () => {
    const backing = fakeStorage();
    backing.setItem('k', '{oops');
    const s = createGuardedStorage({ tag: 't', getStorage: () => backing });
    expect(s.getItem('k')).toBeNull();
    const blocked = createGuardedStorage({
      tag: 't',
      getStorage: () => {
        throw new Error('SecurityError');
      },
    });
    expect(blocked.getItem('k')).toBeNull();
    expect(() => blocked.removeItem('k')).not.toThrow();
  });

  it('quota đầy: không throw, báo một lần cho mỗi chuỗi lỗi liên tiếp', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    let full = true;
    const backing = fakeStorage();
    const real = backing.setItem.bind(backing);
    backing.setItem = (k, v) => (full ? quota() : real(k, v));
    const onSaveError = vi.fn();
    const s = createGuardedStorage({ tag: 'settings', getStorage: () => backing, onSaveError });

    expect(() => s.setItem('k', { state: 1, version: 0 })).not.toThrow();
    s.setItem('k', { state: 2, version: 0 });
    expect(onSaveError).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(2);

    full = false;
    s.setItem('k', { state: 3, version: 0 });
    expect(backing.getItem('k')).toBe('{"state":3,"version":0}');
    full = true;
    s.setItem('k', { state: 4, version: 0 });
    expect(onSaveError).toHaveBeenCalledTimes(2);
  });

  it('decode tùy biến', () => {
    const backing = fakeStorage();
    backing.setItem('k', 'raw');
    const s = createGuardedStorage<string>({
      tag: 't',
      getStorage: () => backing,
      decode: (text) => (text === null ? null : { state: text.toUpperCase(), version: 0 }),
    });
    expect(s.getItem('k')).toEqual({ state: 'RAW', version: 0 });
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  OBS_LINK_PREFS_KEY,
  defaultObsLinkPrefs,
  readObsLinkPrefs,
  rememberObsLinkPrefs,
} from './obsLinkPrefs';

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.removeItem(OBS_LINK_PREFS_KEY);
});

describe('obsLinkPrefs', () => {
  it('chưa lưu → mặc định (Khớp bảng phím game, độ đậm của preset, 100%)', () => {
    expect(readObsLinkPrefs()).toEqual(defaultObsLinkPrefs());
    expect(defaultObsLinkPrefs()).toMatchObject({ preset: 'game', uiScale: 1 });
  });

  it('ghi rồi đọc lại', () => {
    rememberObsLinkPrefs({ preset: 'full', opacity: 0.5, uiScale: 0.9 });
    expect(readObsLinkPrefs()).toEqual({ preset: 'full', opacity: 0.5, uiScale: 0.9 });
  });

  it('dữ liệu lạ → mặc định từng trường; số kẹp vào khoảng hợp lệ', () => {
    localStorage.setItem(OBS_LINK_PREFS_KEY, '{');
    expect(readObsLinkPrefs()).toEqual(defaultObsLinkPrefs());
    localStorage.setItem(OBS_LINK_PREFS_KEY, '"x"');
    expect(readObsLinkPrefs()).toEqual(defaultObsLinkPrefs());
    localStorage.setItem(
      OBS_LINK_PREFS_KEY,
      JSON.stringify({ preset: 'nope', opacity: 9, uiScale: 0.1 }),
    );
    expect(readObsLinkPrefs()).toEqual({ preset: 'game', opacity: 1, uiScale: 0.7 });
    localStorage.setItem(OBS_LINK_PREFS_KEY, JSON.stringify({ preset: 'strip', opacity: 'a' }));
    expect(readObsLinkPrefs()).toMatchObject({ preset: 'strip', uiScale: 1 });
  });

  it('storage bị chặn → mặc định, không ném lỗi', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    expect(() => rememberObsLinkPrefs(defaultObsLinkPrefs())).not.toThrow();
    expect(readObsLinkPrefs()).toEqual(defaultObsLinkPrefs());
  });
});

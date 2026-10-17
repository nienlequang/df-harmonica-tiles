/** PreviewPanel — Phase 2c: tên modifier từ modLabels, thống kê theo kiểu điều khiển. */
import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { parseHarm } from '../core/parser';
import type { Note } from '../core/types';
import { modifierLabels } from '../ui/modLabels';
import { useSettings } from '../ui/settings';
import { PreviewPanel, modsText } from './PreviewPanel';

beforeEach(() => {
  act(() => useSettings.getState().reset());
});

// Cúi Xuống (Z X), nghỉ, Ngẩng Tự Nhiên (C), Ngẩng Lên + Nửa Cung (N), Nửa Cung (B)
const SOURCE = '@title Thử\n# A\nZ: [giữ chuột trái] Z X [thả chuột trái] _ C RS:N S:B\n';

function renderPreview(source = SOURCE) {
  return render(<PreviewPanel parsed={parseHarm(source)} onJump={() => {}} />);
}

const stat = (k: string) => document.querySelector(`[data-stat="${k}"]`)?.textContent ?? null;

/** Chữ đọc cho screen reader của các chip nốt (theo thứ tự). */
function chipSr(): string[] {
  return Array.from(document.querySelectorAll('.pv-note .sr-only')).map((e) => e.textContent ?? '');
}

const note = (octave: -1 | 0 | 1, sharp: boolean): Note => ({
  kind: 'note',
  key: 'Z',
  octave,
  sharp,
  beats: 1,
});

describe('modsText', () => {
  it('tên theo modLabels, bỏ trống khi không có modifier', () => {
    const vi = modifierLabels('vi', { left: '', right: '', natural: '', scroll: '' });
    expect(modsText(vi, note(0, false))).toBe('');
    expect(modsText(vi, note(-1, false))).toBe(' (Cúi Xuống)');
    expect(modsText(vi, note(1, true))).toBe(' (Ngẩng Lên, Nửa Cung)');
    const custom = modifierLabels('en', { left: 'Down', right: '', natural: '', scroll: 'Half' });
    expect(modsText(custom, note(-1, true))).toBe(' (Down, Half)');
  });
});

describe('PreviewPanel', () => {
  it('PC (mặc định): số lần giữ chuột; chip đọc tên modifier mặc định', () => {
    renderPreview();
    expect(stat('holds')).toBe('trái 1 · phải 1 · 3 dải giữ');
    expect(stat('taps')).toBeNull();
    expect(screen.getByText('Số nốt scroll')).toBeTruthy();
    expect(stat('scroll')).toBe('2');
    expect(chipSr()).toEqual([
      ' (Cúi Xuống)',
      ' (Cúi Xuống)',
      'nghỉ',
      '',
      ' (Ngẩng Lên, Nửa Cung)',
      ' (Nửa Cung)',
    ]);
  });

  it('tên gọi tùy chỉnh trong Cài đặt đổi chữ đọc của chip', () => {
    act(() =>
      useSettings.getState().set({
        labelOverrides: { left: 'Hạ', right: 'Lên', natural: '', scroll: 'Thăng' },
      }),
    );
    renderPreview();
    expect(chipSr()).toEqual([' (Hạ)', ' (Hạ)', 'nghỉ', '', ' (Lên, Thăng)', ' (Thăng)']);
    // Nhãn directive @scroll dùng tên gọi Nửa Cung tùy chỉnh (D-181).
    expect(screen.getByText('Thăng (@scroll)')).toBeTruthy();
  });

  it('Mobile: số lần chạm đổi chế độ thay cho lần giữ chuột (chế độ giữ qua chỗ nghỉ)', () => {
    act(() => useSettings.getState().set({ controlScheme: 'mobile' }));
    const { unmount } = renderPreview();
    expect(stat('holds')).toBeNull();
    // quãng: Cúi Xuống, Ngẩng Tự Nhiên, Ngẩng Lên, Ngẩng Tự Nhiên = 4; Nửa Cung bật (N) — giữ cho B
    expect(stat('taps')).toBe('quãng 4 · Nửa Cung 1');
    expect(screen.getByText('Số lần chạm đổi chế độ')).toBeTruthy();
    expect(screen.getByText('Số nốt Nửa Cung')).toBeTruthy();
    expect(stat('scroll')).toBe('2');
    unmount();

    act(() => useSettings.getState().set({ mobileSemitone: 'oneShot' }));
    renderPreview();
    expect(stat('taps')).toBe('quãng 4 · Nửa Cung 2');
  });

  it('tiếng Anh + tên gọi tùy chỉnh', () => {
    act(() =>
      useSettings.getState().set({
        language: 'en',
        controlScheme: 'mobile',
        labelOverrides: { left: '', right: '', natural: '', scroll: 'Half' },
      }),
    );
    renderPreview();
    expect(screen.getByText('Mode taps')).toBeTruthy();
    expect(stat('taps')).toBe('octave 4 · Half 1');
    expect(screen.getByText('Notes on Half')).toBeTruthy();
    expect(chipSr()[0]).toBe(' (Crouch)');
    expect(screen.getByText('Half (@scroll)')).toBeTruthy();
  });
});

import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSettings } from '../ui/settings';
import { SeekBar, TransportBar } from './TransportBar';
import type { TransportBarProps } from './TransportBar';

function bar(extra: Partial<TransportBarProps> = {}) {
  const props: TransportBarProps = {
    playing: false,
    onTogglePlay: vi.fn(),
    onRestart: vi.fn(),
    onPrevLine: vi.fn(),
    onNextLine: vi.fn(),
    sections: [{ index: 0, name: 'Điệp khúc' }],
    sectionIndex: 0,
    onSection: vi.fn(),
    loop: null,
    onLoop: vi.fn(),
    bpm: 90,
    songBpm: 90,
    bpmOverridden: false,
    onBpm: vi.fn(),
    onBpmReset: vi.fn(),
    lookahead: 6,
    onLookahead: vi.fn(),
    audioEnabled: false,
    onHelp: vi.fn(),
    onPractice: vi.fn(),
    practice: false,
    ...extra,
  };
  render(<TransportBar {...props} />);
  return { props, group: screen.getByRole('group', { name: 'Điều khiển phát' }) };
}

describe('TransportBar (góp ý 2026-10-16)', () => {
  beforeEach(() => {
    useSettings.getState().reset();
  });

  it('không còn "Đếm vào" / "Đếm ngược" (chỉ ở Cài đặt → Phát bài)', () => {
    const { group } = bar();
    expect(within(group).queryByRole('button', { name: /Đếm vào/ })).toBeNull();
    expect(within(group).queryByRole('combobox', { name: /Đếm ngược/ })).toBeNull();
    expect(within(group).queryByText(/Đếm vào|Đếm ngược/)).toBeNull();
    // Chỉ còn một <select>: nhảy tới đoạn.
    expect(within(group).getAllByRole('combobox')).toHaveLength(1);
    expect(within(group).getByRole('combobox', { name: 'Nhảy tới đoạn' })).toBeTruthy();
    // Không có công tắc / nút nhấn giữ trạng thái nào ngoài Loop và Luyện tập.
    const pressed = within(group)
      .getAllByRole('button')
      .filter((b) => b.hasAttribute('aria-pressed'))
      .map((b) => b.textContent);
    expect(pressed).toEqual(['Loop', 'Luyện tập']);
  });

  it('Lookahead vẫn ở thanh điều khiển (mặc định 6 beat), kéo → onLookahead', () => {
    const onLookahead = vi.fn();
    const { group } = bar({ onLookahead });
    const look = within(group).getByRole('slider', { name: /Lookahead/ }) as HTMLInputElement;
    expect(look.value).toBe('6');
    expect(look.getAttribute('aria-valuetext')).toBe('6 beat');
    fireEvent.change(look, { target: { value: '9' } });
    expect(onLookahead).toHaveBeenCalledWith(9);
  });
});

describe('TransportBar — nút loa (giai điệu mẫu, trước deploy)', () => {
  beforeEach(() => {
    useSettings.getState().reset();
  });

  it('không truyền onSound → không có nút loa', () => {
    const { group } = bar();
    expect(within(group).queryByRole('button', { name: /tiếng/i })).toBeNull();
    expect(group.querySelector('.transport-sound')).toBeNull();
  });

  it('tắt tiếng: tên cố định "Tiếng giai điệu", aria-pressed=false, tooltip "Bật tiếng giai điệu", mở hộp thoại, mô tả trạng thái; bấm → onSound', () => {
    const onSound = vi.fn();
    const { group } = bar({ onSound });
    const btn = within(group).getByRole('button', { name: 'Tiếng giai điệu' });
    expect(btn.getAttribute('aria-pressed')).toBe('false');
    // D-424 (review A11Y-1): tên đọc không đổi theo trạng thái; tooltip = việc sẽ làm.
    expect(btn.getAttribute('title')).toBe('Bật tiếng giai điệu');
    expect(btn.getAttribute('aria-haspopup')).toBe('dialog');
    const desc = document.getElementById(btn.getAttribute('aria-describedby') ?? '');
    expect(desc?.textContent).toContain('Giai điệu mẫu đang tắt');
    // Icon loa + dấu × (SVG aria-hidden, tên nằm ở aria-label).
    expect(btn.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    fireEvent.click(btn);
    expect(onSound).toHaveBeenCalledTimes(1);
  });

  it('đang bật: vẫn tên "Tiếng giai điệu", aria-pressed=true, tooltip "Tắt tiếng", không mở hộp thoại', () => {
    const onSound = vi.fn();
    const { group } = bar({ onSound, audioEnabled: true });
    const btn = within(group).getByRole('button', { name: 'Tiếng giai điệu' });
    expect(btn.getAttribute('aria-pressed')).toBe('true');
    expect(btn.getAttribute('title')).toBe('Tắt tiếng');
    expect(btn.getAttribute('aria-haspopup')).toBeNull();
    expect(btn.getAttribute('data-sound')).toBe('on');
    const desc = document.getElementById(btn.getAttribute('aria-describedby') ?? '');
    expect(desc?.textContent).toContain('Giai điệu mẫu đang bật');
    fireEvent.click(btn);
    expect(onSound).toHaveBeenCalledTimes(1);
  });

  it('ngay trước Tempo; bài rỗng (disabled) vẫn bấm được', () => {
    const { group } = bar({ onSound: vi.fn(), disabled: true });
    const btn = within(group).getByRole('button', {
      name: 'Tiếng giai điệu',
    }) as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    const next = btn.closest('.transport-group')?.nextElementSibling as HTMLElement;
    expect(within(next).getByRole('slider', { name: /Tempo/ })).toBeTruthy();
    // Nút nhấn giữ trạng thái: Loop, Luyện tập + nút loa (không thêm metronome / click).
    const pressed = within(group)
      .getAllByRole('button')
      .filter((b) => b.hasAttribute('aria-pressed'))
      .map((b) => b.getAttribute('aria-label') ?? b.textContent);
    expect(pressed).toEqual(['Loop', 'Luyện tập', 'Tiếng giai điệu']);
  });
});

describe('SeekBar (thanh chia vạch HUD)', () => {
  it('khấc đầu section: bỏ khấc ở beat 0 / ngoài bài, vị trí theo phần bài, aria-hidden', () => {
    const { container } = render(
      <SeekBar beat={8} totalBeats={32} bpm={60} onSeek={() => {}} marks={[0, 8, 24, 40]} />,
    );
    const marks = container.querySelectorAll<HTMLElement>('.seekbar-mark');
    expect(marks).toHaveLength(2);
    expect(marks[0].style.getPropertyValue('--mark')).toBe('0.25');
    expect(marks[1].style.getPropertyValue('--mark')).toBe('0.75');
    expect(container.querySelector('.seekbar-marks')?.getAttribute('aria-hidden')).toBe('true');
    // Thanh vẫn là slider có tên; vị trí đã phát cho gradient.
    const slider = screen.getByRole('slider');
    expect(slider.style.getPropertyValue('--seek-frac')).toBe('0.25');
    expect(slider.style.getPropertyValue('--seek-pct')).toBe('25%');
  });

  it('không có marks → không vẽ khấc; kéo vẫn seek', () => {
    const onSeek = vi.fn();
    const { container } = render(<SeekBar beat={0} totalBeats={16} bpm={120} onSeek={onSeek} />);
    expect(container.querySelector('.seekbar-marks')).toBeNull();
    fireEvent.change(screen.getByRole('slider'), { target: { value: '4' } });
    expect(onSeek).toHaveBeenCalledWith(4);
  });
});

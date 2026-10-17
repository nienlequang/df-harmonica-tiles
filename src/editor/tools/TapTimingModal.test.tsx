import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { parseHarm } from '../../core/parser';
import { useSettings } from '../../ui/settings';
import { TapTimingModal } from './TapTimingModal';

beforeEach(() => {
  act(() => useSettings.getState().reset());
});

// @bpm 60 → 1 beat = 1000 ms
const SOURCE = ['@title Thử tap', '@bpm 60', '# A', 'Z X C', '# B', 'V _ B', '@repeat A', ''].join(
  '\n',
);

function setup(source = SOURCE) {
  const onApply = vi.fn();
  const onClose = vi.fn();
  const parsed = parseHarm(source, { id: 'u1' });
  const utils = render(
    <TapTimingModal
      open
      onClose={onClose}
      source={source}
      parsed={parsed}
      songId="u1"
      onApply={onApply}
    />,
  );
  return { ...utils, onApply, onClose };
}

/** Space trên phần tử với timeStamp giả (trục performance.now). */
function space(el: Element, timeStamp: number, init: KeyboardEventInit = {}): KeyboardEvent {
  const ev = new KeyboardEvent('keydown', {
    key: ' ',
    code: 'Space',
    bubbles: true,
    cancelable: true,
    ...init,
  });
  Object.defineProperty(ev, 'timeStamp', { value: timeStamp });
  act(() => {
    el.dispatchEvent(ev);
  });
  return ev;
}

function pad(): HTMLElement {
  return screen.getByRole('button', { name: /Ô tap/ });
}

function start() {
  fireEvent.click(screen.getByRole('button', { name: 'Bắt đầu tap' }));
}

describe('TapTimingModal', () => {
  it('renders the setup step with an accessible dialog and controls', () => {
    setup();
    expect(screen.getByRole('dialog', { name: 'Tap timing (gõ nhịp)' })).toBeTruthy();
    const scope = screen.getByLabelText('Phạm vi') as HTMLSelectElement;
    expect(Array.from(scope.options).map((o) => o.textContent)).toEqual([
      'Cả bài',
      'A (1 dòng)',
      'B (2 dòng)',
    ]);
    expect(
      (screen.getByRole('switch', { name: 'Làm tròn về bội 0.25 beat' }) as HTMLInputElement)
        .checked,
    ).toBe(true);
    expect(screen.getByText(/60 BPM/)).toBeTruthy();
    expect(screen.getByText('5 nốt cần tap')).toBeTruthy();
    // cả bài: dòng @repeat không phải tap lại
    expect(screen.getByText(/Dòng chèn bởi @repeat không phải tap lại/)).toBeTruthy();
    // nút Bắt đầu nhận focus đầu tiên; Áp dụng tắt khi chưa tap
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Bắt đầu tap' }));
    expect((screen.getByRole('button', { name: 'Áp dụng' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it('Space taps (event.timeStamp) write quantized durations into the source', () => {
    const { onApply, onClose } = setup();
    start();
    const p = pad();
    expect(document.activeElement).toBe(p);
    // nốt hiện tại: Z (không còn chữ lời)
    expect(p.textContent).toContain('Z');

    const e1 = space(p, 1000);
    expect(e1.defaultPrevented).toBe(true);
    space(p, 1500); // Z = 0.5
    space(p, 2500); // X = 1 (không đổi)
    space(p, 3000); // C = 0.5
    expect(screen.getByText('Đã tap 4/5')).toBeTruthy();
    expect(screen.getByText('Nốt vừa đo: 0.5 beat')).toBeTruthy();
    expect(pad().textContent).toContain('B');
    space(p, 6000); // V = 3 beat \u2212 nghỉ 1 beat = 2; B là nốt cuối (giữ nguyên)
    expect(screen.getByText(/Đã tap đủ 5 nốt/)).toBeTruthy();
    // đã xong: Space không ghi thêm
    space(p, 7000);
    expect(screen.getByText('Đã tap 5/5')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Áp dụng' }));
    expect(onApply).toHaveBeenCalledTimes(1);
    const [next, label] = onApply.mock.calls[0] as [string, string];
    expect(label).toBe('Tap timing');
    expect(next).toBe(
      ['@title Thử tap', '@bpm 60', '# A', 'Z*0.5 X C*0.5', '# B', 'V*2 _ B', '@repeat A', ''].join(
        '\n',
      ),
    );
    expect(parseHarm(next).ok).toBe(true);
    expect(onClose).toHaveBeenCalled();
  });

  it('ignores key repeat, other keys and modifier combos; undo and restart', () => {
    const { onApply } = setup();
    start();
    const p = pad();
    space(p, 1000);
    const held = space(p, 1100, { repeat: true });
    expect(held.defaultPrevented).toBe(true); // vẫn chặn cuộn trang
    expect(screen.getByText('Đã tap 1/5')).toBeTruthy();
    space(p, 1200, { ctrlKey: true });
    fireEvent.keyDown(p, { key: 'Enter', code: 'Enter' });
    expect(screen.getByText('Đã tap 1/5')).toBeTruthy();

    space(p, 1250); // Z = 0.25
    expect(screen.getByText('Nốt vừa đo: 0.25 beat')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Hoàn tác tap' }));
    expect(screen.getByText('Đã tap 1/5')).toBeTruthy();
    // focus đang ở nút Hoàn tác: Space vẫn là tap (không kích hoạt nút)
    const undoBtn = screen.getByRole('button', { name: 'Hoàn tác tap' });
    undoBtn.focus();
    space(undoBtn, 3000); // Z = 2
    expect(screen.getByText('Nốt vừa đo: 2 beat')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Áp dụng' }));
    expect(onApply.mock.calls[0]?.[0]).toContain('\nZ*2 X C\n');
  });

  it('restart clears every tap and keeps the tapping step', () => {
    setup();
    start();
    space(pad(), 1000);
    space(pad(), 2000);
    fireEvent.click(screen.getByRole('button', { name: 'Làm lại từ đầu' }));
    expect(screen.getByText('Đã tap 0/5')).toBeTruthy();
    expect(document.activeElement).toBe(pad());
    expect((screen.getByRole('button', { name: 'Áp dụng' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it('Space before starting or outside the dialog does not tap', () => {
    setup();
    const ev = space(screen.getByRole('button', { name: 'Bắt đầu tap' }), 500);
    expect(ev.defaultPrevented).toBe(false);
    start();
    expect(screen.getByText('Đã tap 0/5')).toBeTruthy();
    // chỉ lắng nghe trên dialog, không phải window/document
    space(document.body, 1000);
    expect(screen.getByText('Đã tap 0/5')).toBeTruthy();
  });

  it('section scope with quantize off; repeated lines write to the original line', () => {
    const { onApply } = setup();
    fireEvent.change(screen.getByLabelText('Phạm vi'), { target: { value: '1' } });
    expect(screen.getByText(/độ dài sẽ ghi vào dòng gốc/)).toBeTruthy();
    expect(screen.getByText('5 nốt cần tap')).toBeTruthy(); // V B + Z X C (lặp)
    fireEvent.click(screen.getByRole('switch', { name: 'Làm tròn về bội 0.25 beat' }));
    start();
    const p = pad();
    expect(p.textContent).toContain('V');
    space(p, 0);
    space(p, 1730); // V = 1.73 \u2212 nghỉ 1 = 0.73
    space(p, 2730); // B = 1 (không đổi)
    space(p, 3100); // Z (dòng lặp) = 0.37
    fireEvent.click(screen.getByRole('button', { name: 'Áp dụng' }));
    const next = onApply.mock.calls[0]?.[0] as string;
    expect(next).toContain('V*0.73 _ B');
    // dòng lặp ghi vào dòng gốc của section A
    expect(next).toContain('\nZ*0.37 X C\n');
  });

  it('colors the current key by modifier and names the modifier', () => {
    setup('@bpm 90\n[giữ chuột trái] N [thả chuột trái] X-L:C\n');
    start();
    const p = pad();
    const key = p.querySelector('.tap-key');
    expect(key?.textContent).toBe('N');
    expect(key?.className).toContain('mod-left');
    expect(p.textContent).toContain('Cúi Xuống');
    space(p, 0);
    // luyến: mỗi nốt tô riêng
    const keys = Array.from(pad().querySelectorAll('.tap-key'));
    expect(keys.map((k) => k.textContent)).toEqual(['X', 'C']);
    expect(keys.map((k) => k.className.includes('mod-left'))).toEqual([false, true]);
    expect(pad().textContent).toContain('X: không giữ gì · C: Cúi Xuống');
  });

  it('modifier names follow the custom labels from Settings (modLabels)', () => {
    act(() =>
      useSettings.getState().set({
        labelOverrides: { left: 'Hạ', right: 'Lên', natural: '', scroll: 'Thăng' },
      }),
    );
    setup('@bpm 90\nL:N RS:X\n');
    start();
    expect(pad().textContent).toContain('Hạ');
    expect(pad().textContent).not.toContain('Cúi Xuống');
    space(pad(), 0);
    expect(pad().textContent).toContain('Lên + Thăng');
  });

  it('a song without notes cannot start; Cancel / Escape close without applying', () => {
    const { onApply, onClose } = setup('# Trống\n// chưa có nốt\n');
    expect(screen.getByText('Không có nốt nào để tap.')).toBeTruthy();
    expect(
      (screen.getByRole('button', { name: 'Bắt đầu tap' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Hủy' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(onApply).not.toHaveBeenCalled();
  });

  it('renders nothing when closed and works in English', () => {
    const parsed = parseHarm(SOURCE);
    const { rerender } = render(
      <TapTimingModal
        open={false}
        onClose={() => {}}
        source={SOURCE}
        parsed={parsed}
        songId=""
        onApply={() => {}}
      />,
    );
    expect(screen.queryByRole('dialog')).toBeNull();
    act(() => useSettings.getState().set({ language: 'en' }));
    rerender(
      <TapTimingModal
        open
        onClose={() => {}}
        source={SOURCE}
        parsed={parsed}
        songId=""
        onApply={() => {}}
      />,
    );
    expect(screen.getByRole('dialog', { name: 'Tap timing' })).toBeTruthy();
    expect(screen.getByLabelText('Scope')).toBeTruthy();
    expect(screen.getByText('5 notes to tap')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Start tapping' }));
    expect(screen.getByRole('button', { name: /Tap pad/ })).toBeTruthy();
    expect(screen.getByText('Tapped 0/5')).toBeTruthy();
  });

  it('đang tap dở: Esc / × / Hủy / bấm nền hỏi lại thay vì bỏ các lần tap', () => {
    const { onClose } = setup();
    // chưa tap gì: Esc đóng luôn
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    onClose.mockClear();

    start();
    const p = pad();
    space(p, 1000);
    space(p, 1500);
    expect(screen.getByText('Đã tap 2/5')).toBeTruthy();

    // Esc → câu hỏi, không đóng; focus vẫn ở ô tap
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('Đang tap dở (2 lần tap)');
    expect(document.activeElement).toBe(pad());
    // Esc lần nữa, ×, Hủy, bấm nền: vẫn không đóng
    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: 'Đóng' }));
    fireEvent.click(screen.getByRole('button', { name: 'Hủy' }));
    const backdrop = document.querySelector('.modal-backdrop')!;
    fireEvent.mouseDown(backdrop);
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText('Đã tap 2/5')).toBeTruthy();

    // tap tiếp = bỏ câu hỏi, giữ các lần tap
    space(pad(), 2500);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByText('Đã tap 3/5')).toBeTruthy();

    // "Tiếp tục tap" cũng bỏ câu hỏi
    fireEvent.mouseDown(document.querySelector('.modal-backdrop')!);
    fireEvent.click(screen.getByRole('button', { name: 'Tiếp tục tap' }));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(document.activeElement).toBe(pad());
    expect(onClose).not.toHaveBeenCalled();

    // Space trên nút của câu hỏi bấm nút đó, không tính là tap
    fireEvent.keyDown(window, { key: 'Escape' });
    const discard = screen.getByRole('button', { name: 'Bỏ 3 lần tap và đóng' });
    const ev = space(discard, 4000);
    expect(ev.defaultPrevented).toBe(false);
    expect(screen.getByText('Đã tap 3/5')).toBeTruthy();
    // xác nhận bỏ → đóng
    fireEvent.click(discard);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('hoàn tác hết các lần tap → đóng không cần hỏi', () => {
    const { onClose } = setup();
    start();
    space(pad(), 1000);
    fireEvent.click(screen.getByRole('button', { name: 'Hoàn tác tap' }));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

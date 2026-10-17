import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildTimeline } from '../../core/timeline';
import { parseHarm } from '../../core/parser';
import seed1 from '../../test/fixtures/bai-thu-nhip-dieu.harm?raw';
import { useSettings } from '../../ui/settings';
import { ReoptimizeModal } from './ReoptimizeModal';

beforeEach(() => {
  act(() => useSettings.getState().reset());
});

// C3 D3 E3 viết bằng giữ chuột trái — lên 1 quãng thì không cần giữ gì
const SOURCE = [
  '@title Thử',
  '@artist Ai đó',
  '@bpm 100',
  '@time 3/4',
  '// ghi chú của người soạn',
  '# A',
  '[giữ chuột trái] Z X C [thả chuột trái]',
  '',
].join('\n');

function setup(source = SOURCE) {
  const onApply = vi.fn();
  const onClose = vi.fn();
  const parsed = parseHarm(source, { id: 'u1' });
  render(
    <ReoptimizeModal
      open
      onClose={onClose}
      source={source}
      parsed={parsed}
      songId="u1"
      onApply={onApply}
    />,
  );
  return { onApply, onClose, parsed };
}

function button(name: string): HTMLButtonElement {
  return screen.getByRole('button', { name }) as HTMLButtonElement;
}

describe('ReoptimizeModal', () => {
  it('shows the current cost, picks the best key and rewrites after confirmation', () => {
    const { onApply, onClose } = setup();
    expect(screen.getByRole('dialog', { name: 'Tối ưu tông' })).toBeTruthy();
    expect(
      screen.getByText('Bài hiện tại: 0 nốt scroll · 1 lần giữ · 3 nốt có modifier · độ khó 7'),
    ).toBeTruthy();
    const best = screen.getByRole('radio', { name: '+12 (lên 1 quãng)' }) as HTMLInputElement;
    expect(best.checked).toBe(true);

    fireEvent.click(button('Tiếp tục'));
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('Các dòng comment (//) sẽ bị xóa.');
    expect(alert.textContent).not.toContain('@repeat');
    expect(document.activeElement).toBe(button('Thay văn bản'));
    expect(onApply).not.toHaveBeenCalled();

    fireEvent.click(button('Thay văn bản'));
    expect(onApply).toHaveBeenCalledTimes(1);
    const [next, label] = onApply.mock.calls[0] as [string, string];
    expect(label).toBe('Tối ưu tông');
    expect(next).toBe(
      [
        '@title Thử',
        '@artist Ai đó',
        '@bpm 100',
        '@time 3/4',
        '@scroll +1',
        '',
        '# A',
        'Z X C',
        '',
      ].join('\n'),
    );
    expect(onClose).toHaveBeenCalled();
  });

  it('"Quay lại" returns to the options; another option can be chosen', () => {
    const { onApply } = setup();
    fireEvent.click(button('Tiếp tục'));
    fireEvent.click(button('Quay lại'));
    // "Giữ cung gốc" = phương án shift 0 tốt nhất (+12), đã là dòng đầu
    fireEvent.click(button('Giữ cung gốc'));
    expect(
      (screen.getByRole('radio', { name: '+12 (lên 1 quãng)' }) as HTMLInputElement).checked,
    ).toBe(true);
    // chọn phương án khác: +17 → F4 G4 A4
    fireEvent.click(screen.getByRole('radio', { name: '+17 bán cung' }));
    fireEvent.click(button('Tiếp tục'));
    fireEvent.click(button('Thay văn bản'));
    expect(onApply.mock.calls[0]?.[0]).toContain('\nV B N\n');
  });

  it('seed 1 (§9): the optimum is the original key, same cost as the song', () => {
    const { onApply, parsed } = setup(seed1);
    expect(
      screen.getByText('Bài hiện tại: 0 nốt scroll · 5 lần giữ · 61 nốt có modifier · độ khó 81'),
    ).toBeTruthy();
    const original = screen.getByRole('radio', { name: 'Giữ cung gốc' }) as HTMLInputElement;
    expect(original.checked).toBe(true);
    expect(original.closest('tr')?.lastElementChild?.textContent).toBe('81');
    fireEvent.click(button('Tiếp tục'));
    fireEvent.click(button('Thay văn bản'));
    const r = parseHarm(onApply.mock.calls[0]?.[0] as string);
    expect(r.ok).toBe(true);
    // cùng phương án → cùng model (section, nốt, modifier)
    expect(r.song.sections).toEqual(parsed.song.sections);
  });

  it('warns that @repeat is expanded and keeps the melody (up to whole octaves)', () => {
    const { onApply, parsed } = setup(`${seed1}\n# KẾT\n@repeat ĐIỆP KHÚC\n`);
    fireEvent.click(button('Tiếp tục'));
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('@repeat sẽ được trải ra');
    expect(alert.textContent).toContain('comment (//)');
    fireEvent.click(button('Thay văn bản'));
    const next = onApply.mock.calls[0]?.[0] as string;
    expect(next).not.toContain('@repeat');
    const r = parseHarm(next);
    expect(r.ok).toBe(true);
    const before = buildTimeline(parsed.song).notes;
    const after = buildTimeline(r.song).notes;
    expect(after.map((n) => [n.startBeat, n.endBeat])).toEqual(
      before.map((n) => [n.startBeat, n.endBeat]),
    );
    const shift = (after[0]?.midi ?? 0) - (before[0]?.midi ?? 0);
    expect(Math.abs(shift % 12)).toBe(0);
    expect(after.map((n, i) => n.midi - (before[i]?.midi ?? 0))).toEqual(after.map(() => shift));
    expect(r.song.sections.map((s) => s.name)).toEqual(parsed.song.sections.map((s) => s.name));
  });

  it('a song written for flat (@scroll -1): reads it with -1, rewrites it as @scroll +1', () => {
    act(() =>
      useSettings.getState().set({
        labelOverrides: { left: '', right: '', natural: '', scroll: 'Thăng' },
      }),
    );
    // S:Z với @scroll -1 = B3 (59), X = D4 (62)
    const { onApply } = setup('@scroll -1\n# A\nS:Z X\n');
    // ghi chú dùng tên gọi tùy chỉnh (D-181): game luôn thăng
    expect(
      screen.getByText(/Bài viết với @scroll −1 \(giáng\) nhưng trong game Thăng luôn là thăng/),
    ).toBeTruthy();
    fireEvent.click(button('Tiếp tục'));
    fireEvent.click(button('Thay văn bản'));
    const next = onApply.mock.calls[0]?.[0] as string;
    const r = parseHarm(next);
    expect(r.song.scrollDir).toBe(1);
    const midi = buildTimeline(r.song).notes.map((n) => n.midi);
    // cao độ giữ nguyên sau khi đổi transpose: chỉ dời cả bài, khoảng cách B → D là 3 bán cung
    expect(midi[1]! - midi[0]!).toBe(3);
  });

  it('a song already written for sharp (@scroll +1) shows no direction note', () => {
    setup('@scroll +1\n# A\nS:Z X\n');
    expect(screen.queryByText(/trong game .* luôn là thăng/)).toBeNull();
  });

  it('mentions syntax errors in the confirmation', () => {
    setup('# A\nZ Q X\n');
    fireEvent.click(button('Tiếp tục'));
    expect(screen.getByRole('alert').textContent).toContain('lỗi cú pháp');
  });

  it('a song without notes cannot continue', () => {
    const { onClose } = setup('# Trống\n');
    expect(screen.getByText('Chưa có nốt nào để tối ưu.')).toBeTruthy();
    expect(button('Tiếp tục').disabled).toBe(true);
    fireEvent.click(button('Hủy'));
    expect(onClose).toHaveBeenCalled();
  });

  it('renders in English', () => {
    act(() => useSettings.getState().set({ language: 'en' }));
    setup();
    expect(screen.getByRole('dialog', { name: 'Optimize key' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: '+12 (up 1 octave)' })).toBeTruthy();
    fireEvent.click(button('Continue'));
    expect(screen.getByRole('alert').textContent).toContain('Comment lines (//) will be removed.');
    expect(button('Replace text')).toBeTruthy();
  });
});

import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { evaluateTranspose } from '../core/optimizer';
import type { Placement } from '../core/optimizer';
import { translateCount } from '../i18n/useT';
import type { TFunction } from '../i18n/useT';
import { useSettings } from '../ui/settings';
import { OptimizerPanel, playableRangeLabel, transposeLabel } from './OptimizerPanel';

beforeEach(() => {
  act(() => useSettings.getState().reset());
});

const tVi: TFunction = (key, params) => translateCount('vi', key, params);
const tEn: TFunction = (key, params) => translateCount('en', key, params);

interface HarnessProps {
  pitches: readonly (number | null)[];
  initialValue?: Placement | null;
  onChange?: (p: Placement) => void;
}

/** Nơi gọi giống tối ưu lại / MIDI: giữ value (gộp nốt vượt tầm luôn bật — không còn công tắc). */
function Harness({ pitches, initialValue = null, onChange }: HarnessProps) {
  const [value, setValue] = useState<Placement | null>(initialValue);
  return (
    <OptimizerPanel
      pitches={pitches}
      baseOctave={4}
      value={value}
      onChange={(p) => {
        onChange?.(p);
        setValue(p);
      }}
    />
  );
}

const C_D_E = [60, 62, 64];

describe('transposeLabel', () => {
  it('names the original key, semitones and whole octaves (vi)', () => {
    expect(transposeLabel(tVi, 0)).toBe('Giữ cung gốc');
    expect(transposeLabel(tVi, 5)).toBe('+5 bán cung');
    expect(transposeLabel(tVi, -7)).toBe('\u22127 bán cung');
    expect(transposeLabel(tVi, -12)).toBe('\u221212 (hạ 1 quãng)');
    expect(transposeLabel(tVi, 24)).toBe('+24 (lên 2 quãng)');
  });

  it('uses singular forms in English', () => {
    expect(transposeLabel(tEn, 0)).toBe('Original key');
    expect(transposeLabel(tEn, 1)).toBe('+1 semitone');
    expect(transposeLabel(tEn, -3)).toBe('\u22123 semitones');
    expect(transposeLabel(tEn, 12)).toBe('+12 (up 1 octave)');
    expect(transposeLabel(tEn, -24)).toBe('\u221224 (down 2 octaves)');
  });

  it('playableRangeLabel follows the base octave', () => {
    expect(playableRangeLabel(4)).toBe('C3–C6');
    expect(playableRangeLabel(5)).toBe('C4–C7');
  });
});

describe('OptimizerPanel', () => {
  it('lists the top 3 as an accessible radio table and auto-selects the best', () => {
    const onChange = vi.fn();
    render(<Harness pitches={C_D_E} onChange={onChange} />);

    const group = screen.getByRole('group', { name: 'Chọn cung và quãng' });
    const radios = within(group).getAllByRole('radio');
    expect(radios.map((r) => r.getAttribute('id') !== null)).toEqual([true, true, true]);
    expect(within(group).getByRole('radio', { name: 'Giữ cung gốc' })).toBeTruthy();
    expect(within(group).getByRole('radio', { name: '+5 bán cung' })).toBeTruthy();
    expect(within(group).getByRole('radio', { name: '+7 bán cung' })).toBeTruthy();
    for (const col of ['Cung', 'Nốt scroll', 'Lần giữ', 'Nốt có modifier', 'Độ khó']) {
      expect(within(group).getByRole('columnheader', { name: col })).toBeTruthy();
    }
    // chưa bật gập quãng và không phương án nào gập → không có cột gập
    expect(within(group).queryByRole('columnheader', { name: 'Nốt gập quãng' })).toBeNull();

    // tự chọn phương án tốt nhất (transpose 0, cost 0)
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0]?.[0]).toMatchObject({ transpose: 0, cost: 0 });
    expect((screen.getByRole('radio', { name: 'Giữ cung gốc' }) as HTMLInputElement).checked).toBe(
      true,
    );
    // nhãn "Tối ưu" ở dòng đầu, công thức độ khó gắn với nhóm
    const firstRow = screen.getByRole('radio', { name: 'Giữ cung gốc' }).closest('tr');
    expect(firstRow && within(firstRow).getByText('Tối ưu')).toBeTruthy();
    expect(group.getAttribute('aria-describedby')).toBeTruthy();
    const hint = document.getElementById(group.getAttribute('aria-describedby') ?? '');
    expect(hint?.textContent).toMatch(/10 × nốt scroll/);
  });

  it('selecting a radio or clicking a row reports that placement', () => {
    const onChange = vi.fn();
    render(<Harness pitches={C_D_E} onChange={onChange} />);
    fireEvent.click(screen.getByRole('radio', { name: '+5 bán cung' }));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ transpose: 5 }));
    expect((screen.getByRole('radio', { name: '+5 bán cung' }) as HTMLInputElement).checked).toBe(
      true,
    );
    expect((screen.getByRole('radio', { name: 'Giữ cung gốc' }) as HTMLInputElement).checked).toBe(
      false,
    );

    // bấm vào ô số liệu của dòng cũng chọn
    const row = screen.getByRole('radio', { name: '+7 bán cung' }).closest('tr');
    const cell = row?.querySelector('td');
    expect(cell).toBeTruthy();
    if (cell) fireEvent.click(cell);
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ transpose: 7 }));
    expect(row?.className).toContain('is-selected');
  });

  it('"Giữ cung gốc" picks the best shift-0 placement even when it is not in the top 3', () => {
    const onChange = vi.fn();
    // F# G# A#: top 3 là \u22121, +1, \u22126; cung gốc cần scroll
    render(<Harness pitches={[66, 68, 70]} onChange={onChange} />);
    expect(onChange.mock.calls[0]?.[0]).toMatchObject({ transpose: -1 });
    const radios = screen.getAllByRole('radio').map((r) => r.closest('tr')?.textContent ?? '');
    expect(radios).toHaveLength(4); // top 3 + dòng cung gốc
    expect(screen.getByRole('radio', { name: '\u22121 bán cung' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: '+1 bán cung' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: '\u22126 bán cung' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Giữ cung gốc' }));
    const picked = onChange.mock.calls.at(-1)?.[0] as Placement;
    expect(picked.shift).toBe(0);
    expect(picked.transpose).toBe(0);
    expect(picked.stats.scrollNotes).toBe(3);
    expect((screen.getByRole('radio', { name: 'Giữ cung gốc' }) as HTMLInputElement).checked).toBe(
      true,
    );
  });

  it('folding is always on: a melody wider than the range still gets placements (folded column + flags)', () => {
    const onChange = vi.fn();
    // C1 … E7: rộng hơn 3 quãng tám — trước đây phải bật công tắc gập quãng
    render(<Harness pitches={[24, null, 100]} onChange={onChange} />);
    expect(screen.queryByRole('switch')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Bật gập quãng' })).toBeNull();
    expect(screen.getAllByRole('radio').length).toBeGreaterThan(0);
    expect(screen.getByRole('columnheader', { name: 'Nốt gập quãng' })).toBeTruthy();
    expect(screen.getByText(/gộp về quãng gần nhất \(luôn bật\)/)).toBeTruthy();
    const best = onChange.mock.calls.at(-1)?.[0] as Placement;
    expect(best.stats.foldedNotes).toBeGreaterThan(0);
    expect(best.folded.filter(Boolean)).toHaveLength(best.stats.foldedNotes);
  });

  it('a melody that fits never folds and hides the folded column', () => {
    const onChange = vi.fn();
    render(<Harness pitches={C_D_E} onChange={onChange} />);
    expect(screen.queryByRole('columnheader', { name: 'Nốt gập quãng' })).toBeNull();
    expect((onChange.mock.calls.at(-1)?.[0] as Placement).stats.foldedNotes).toBe(0);
  });

  it('has no fold switch: a melody wider than the range is folded right away', () => {
    render(<OptimizerPanel pitches={[24, 100]} baseOctave={4} value={null} onChange={() => {}} />);
    expect(screen.queryByRole('switch')).toBeNull();
    expect(screen.getAllByRole('radio').length).toBeGreaterThan(0);
    expect(screen.getByRole('columnheader', { name: 'Nốt gập quãng' })).toBeTruthy();
  });

  it('a melody without notes shows a hint and still reports the trivial placement', () => {
    const onChange = vi.fn();
    render(<Harness pitches={[null, null]} onChange={onChange} />);
    expect(screen.getByText('Chưa có nốt nào để tối ưu.')).toBeTruthy();
    expect(screen.queryByRole('radio')).toBeNull();
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ transpose: 0, cost: 0 }));
  });

  it('re-selects when the value belongs to another melody (stale choices)', () => {
    const onChange = vi.fn();
    const other = evaluateTranspose([60, 62], 0);
    expect(other).not.toBeNull();
    render(<Harness pitches={C_D_E} initialValue={other} onChange={onChange} />);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect((onChange.mock.calls[0]?.[0] as Placement).choices).toHaveLength(3);
  });

  it('keeps and shows a caller-provided placement that is not among the options', () => {
    const onChange = vi.fn();
    const custom = evaluateTranspose(C_D_E, 12); // +12: vẫn vừa tầm, không phải top 3
    expect(custom).not.toBeNull();
    render(<Harness pitches={C_D_E} initialValue={custom} onChange={onChange} />);
    expect(onChange).not.toHaveBeenCalled();
    const radio = screen.getByRole('radio', { name: '+12 (lên 1 quãng)' }) as HTMLInputElement;
    expect(radio.checked).toBe(true);
    expect(screen.getAllByRole('radio')).toHaveLength(4);
    // dòng shift 0 khác transpose 0 có nhãn "cung gốc"
    const row = radio.closest('tr');
    expect(row && within(row).getByText('cung gốc')).toBeTruthy();
  });

  it('renders in English', () => {
    act(() => useSettings.getState().set({ language: 'en' }));
    render(<Harness pitches={C_D_E} />);
    expect(screen.getByRole('group', { name: 'Choose key and octave' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Original key' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: '+5 semitones' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Keep original key' })).toBeTruthy();
    expect(screen.queryByRole('switch')).toBeNull();
    expect(screen.getByRole('columnheader', { name: 'Cost' })).toBeTruthy();
  });
});

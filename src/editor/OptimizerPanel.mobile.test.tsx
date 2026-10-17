/** OptimizerPanel — Phase 2c: cost model + cột thống kê theo kiểu điều khiển (PC / Mobile). */
import { act, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { optimizeTranspose } from '../core/optimizer';
import type { OptimizerOptions, Placement } from '../core/optimizer';
import { translateCount } from '../i18n/useT';
import type { TFunction } from '../i18n/useT';
import { useSettings } from '../ui/settings';
import type { ControlScheme, MobileSemitone } from '../ui/settings';
import { OptimizerPanel, transposeLabel } from './OptimizerPanel';

const tVi: TFunction = (key, params) => translateCount('vi', key, params);

beforeEach(() => {
  act(() => useSettings.getState().reset());
});

// C3 D3 E3 · nghỉ · C5 D5 E5 · F#4 G4: cần đổi quãng qua chỗ nghỉ và có nốt thăng
const MELODY: (number | null)[] = [48, 50, 52, null, 72, 74, 76, 66, 67];

function renderPanel(props: {
  scheme?: ControlScheme;
  mobileSemitone?: MobileSemitone;
  onChange?: (p: Placement) => void;
}) {
  return render(
    <OptimizerPanel
      pitches={MELODY}
      baseOctave={4}
      value={null}
      onChange={props.onChange ?? (() => {})}
      {...(props.scheme ? { scheme: props.scheme } : {})}
      {...(props.mobileSemitone ? { mobileSemitone: props.mobileSemitone } : {})}
    />,
  );
}

function headers(): string[] {
  return within(screen.getByRole('table'))
    .getAllByRole('columnheader')
    .map((h) => h.textContent ?? '');
}

/** Ô số liệu của dòng có radio `name`. */
function rowCells(name: string): string[] {
  const row = screen.getByRole('radio', { name }).closest('tr');
  return Array.from(row?.querySelectorAll('td') ?? []).map((td) => td.textContent ?? '');
}

function best(opts: OptimizerOptions): Placement {
  const p = optimizeTranspose(MELODY, { baseOctave: 4, scrollDir: 1, top: 3, ...opts })[0];
  if (!p) throw new Error('no placement');
  return p;
}

describe('OptimizerPanel — kiểu điều khiển', () => {
  it('PC (mặc định Cài đặt): cột lần giữ chuột + nốt có modifier, công thức PC', () => {
    const onChange = vi.fn();
    renderPanel({ onChange });
    expect(headers()).toEqual(['Cung', 'Nốt scroll', 'Lần giữ', 'Nốt có modifier', 'Độ khó']);
    const p = best({});
    expect(onChange.mock.calls[0]?.[0]).toEqual(p);
    expect(rowCells(transposeLabel(tVi, p.transpose))).toEqual([
      String(p.stats.scrollNotes),
      String(p.stats.holdRuns),
      String(p.stats.modifiedNotes),
      String(p.cost),
    ]);
    expect(screen.getByText(/10 × nốt scroll \+ 4 × lần giữ/)).toBeTruthy();
  });

  it('scheme="mobile": cột chạm đổi chế độ + chạm Nửa Cung, phương án theo cost Mobile', () => {
    const onChange = vi.fn();
    renderPanel({ scheme: 'mobile', onChange });
    expect(headers()).toEqual([
      'Cung',
      'Nốt Nửa Cung',
      'Chạm đổi chế độ',
      'Chạm Nửa Cung',
      'Độ khó',
    ]);
    const p = best({ scheme: 'mobile', mobileSemitone: 'toggle' });
    expect(p.stats.octaveTaps).toBeGreaterThan(0);
    expect(onChange.mock.calls[0]?.[0]).toEqual(p);
    expect(rowCells(transposeLabel(tVi, p.transpose))).toEqual([
      String(p.stats.scrollNotes),
      String(p.stats.octaveTaps),
      String(p.stats.semitoneTaps),
      String(p.cost),
    ]);
    const group = screen.getByRole('group', { name: 'Chọn cung và quãng' });
    const hint = document.getElementById(group.getAttribute('aria-describedby') ?? '');
    expect(hint?.textContent).toMatch(/^Độ khó \(Mobile\) = 10 × nốt Nửa Cung \+ 4 × lần chạm/);
  });

  it('không truyền scheme → theo Cài đặt Mobile; prop "pc" thắng Cài đặt', () => {
    act(() => useSettings.getState().set({ controlScheme: 'mobile' }));
    const { unmount } = renderPanel({});
    expect(headers()).toContain('Chạm đổi chế độ');
    unmount();
    renderPanel({ scheme: 'pc' });
    expect(headers()).toContain('Lần giữ');
    expect(headers()).not.toContain('Chạm đổi chế độ');
  });

  it('Nửa Cung "chỉ 1 nốt": theo prop hoặc Cài đặt', () => {
    const p = best({ scheme: 'mobile', mobileSemitone: 'oneShot' });
    const onChange = vi.fn();
    const { unmount } = renderPanel({ scheme: 'mobile', mobileSemitone: 'oneShot', onChange });
    expect(onChange.mock.calls[0]?.[0]).toEqual(p);
    expect(rowCells(transposeLabel(tVi, p.transpose))[2]).toBe(String(p.stats.semitoneTaps));
    unmount();

    act(() => useSettings.getState().set({ controlScheme: 'mobile', mobileSemitone: 'oneShot' }));
    const onChange2 = vi.fn();
    renderPanel({ onChange: onChange2 });
    expect(onChange2.mock.calls[0]?.[0]).toEqual(p);
  });

  it('tên gọi Nửa Cung tùy chỉnh và tiếng Anh', () => {
    act(() =>
      useSettings.getState().set({
        language: 'en',
        labelOverrides: { left: '', right: '', natural: '', scroll: 'Half' },
      }),
    );
    renderPanel({ scheme: 'mobile' });
    expect(headers()).toEqual(['Key', 'Notes on Half', 'Mode taps', 'Taps on Half', 'Cost']);
    expect(screen.getByText(/^Cost \(Mobile\) = 10 × notes on Half \+ 4 × octave/)).toBeTruthy();
  });
});

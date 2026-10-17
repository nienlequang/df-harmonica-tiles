/**
 * Donate text — Phase 2c: tùy chọn "Kiểu chữ: PC / Mobile" (serializeMobileText + chunkDonateText).
 * copyText được thay bằng bản giả (không đụng clipboard thật).
 */
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildDonateText, chunkDonateText } from '../core/donate';
import { parseHarm } from '../core/parser';
import { translateCount } from '../i18n/useT';
import type { TFunction } from '../i18n/useT';
import { copyText } from '../ui/components';
import type * as Components from '../ui/components';
import { modifierLabels } from '../ui/modLabels';
import { useSettings } from '../ui/settings';
import { DONATE_JOIN, DonateModal, buildMobileDonateText, mobileLegend } from './DonateModal';
// Bài tự soạn chỉ dùng cho test (src/test/fixtures/, app không import): dài, có @repeat + giữ chuột.
import SEED_2 from '../test/fixtures/bai-thu-lap-doan.harm?raw';

vi.mock('../ui/components', async (importOriginal) => ({
  ...(await importOriginal<typeof Components>()),
  copyText: vi.fn(async () => true),
}));

const tVi: TFunction = (key, params) => translateCount('vi', key, params);
const tEn: TFunction = (key, params) => translateCount('en', key, params);
const NO_OVERRIDES = { left: '', right: '', natural: '', scroll: '' };
const LABELS_VI = modifierLabels('vi', NO_OVERRIDES);
const ALL = { durations: true, sectionHeaders: true };

const seed = parseHarm(SEED_2).song;
// Cúi Xuống → (rest giữ chế độ) → Ngẩng Tự Nhiên → Nửa Cung bật / tắt
const small = parseHarm(
  '@title Nhỏ\n# A\n[giữ chuột trái] N N [thả chuột trái] _ Z X\nS:V C\n',
).song;

function chunkTexts(name = 'Các phần'): string[] {
  return within(screen.getByRole('list', { name }))
    .getAllByRole('listitem')
    .map((li) => li.querySelector('pre')?.textContent ?? '');
}

function styleSelect(label = 'Kiểu chữ'): HTMLSelectElement {
  return screen.getByLabelText(label) as HTMLSelectElement;
}

function preText(): string {
  return Array.from(document.querySelectorAll('pre'))
    .map((p) => p.textContent ?? '')
    .join('\n');
}

beforeEach(() => {
  act(() => useSettings.getState().reset());
  vi.mocked(copyText).mockClear();
  vi.mocked(copyText).mockResolvedValue(true);
});

describe('buildMobileDonateText / mobileLegend', () => {
  it('số nút + token chạm chế độ, không dòng trống, chú thích ở dòng đầu', () => {
    const legend = mobileLegend(tVi, LABELS_VI, 'toggle');
    expect(legend).toBe(
      'Mobile: số = nút 1–8 từ trái sang; [Ngẩng Lên] [Ngẩng Tự Nhiên] [Cúi Xuống] = chạm chọn quãng; [Nửa Cung] = chạm bật / tắt',
    );
    const text = buildMobileDonateText(small, {
      ...ALL,
      semitone: 'toggle',
      labels: LABELS_VI,
      legend,
    });
    const lines = text.split('\n');
    expect(lines[0]).toBe(`// ${legend}`);
    expect(lines).not.toContain('');
    expect(text.endsWith('\n')).toBe(false);
    expect(text).toContain('@title Nhỏ');
    expect(text).toContain('# A');
    expect(lines).toContain('[Cúi Xuống] 6 6 _ [Ngẩng Tự Nhiên] 1 2');
    expect(lines).toContain('[Nửa Cung] 4 [Nửa Cung] 3');
    // định dạng .harm không đổi: không có chữ phím Z X C… trong dòng nốt
    const noteTokens = lines
      .filter((l) => !/^(?:\/\/|@|#)/.test(l))
      .flatMap((l) =>
        l
          .slice(l.indexOf(': ') + 1)
          .trim()
          .split(/\s+/),
      );
    expect(noteTokens.length).toBeGreaterThan(5);
    expect(noteTokens.filter((tok) => /^[ZXCVBNM,](?:[*-]|$)/.test(tok))).toEqual([]);
    expect(noteTokens.filter((tok) => /^[1-8](?:[*-]|$)/.test(tok))).toHaveLength(6);
  });

  it('không độ dài / không tên đoạn; không chú thích khi legend rỗng', () => {
    const text = buildMobileDonateText(small, {
      durations: false,
      sectionHeaders: false,
      semitone: 'oneShot',
      labels: LABELS_VI,
    });
    expect(text.startsWith('//')).toBe(false);
    expect(text).not.toContain('# A');
    expect(text).not.toContain('một hai');
    // oneShot: chỉ chạm trước nốt thăng, không chạm tắt
    expect(text).toContain('[Nửa Cung] 4 3');
  });

  it('tên gọi tùy chỉnh và tiếng Anh', () => {
    const labels = modifierLabels('en', { left: 'Down', right: '', natural: '', scroll: 'Half' });
    expect(mobileLegend(tEn, labels, 'oneShot')).toBe(
      'Mobile: number = button 1–8 from the left; [Look Up] [Natural] [Down] = tap to pick the octave; [Half] = tap before the note (one note only)',
    );
    const text = buildMobileDonateText(small, { ...ALL, semitone: 'toggle', labels });
    expect(text).toContain('[Down] 6 6 _ [Natural] 1 2');
    expect(text).toContain('[Half] 4 [Half] 3');
  });
});

describe('DonateModal — kiểu chữ', () => {
  it('mặc định PC (theo Cài đặt): giống hệt trước, không có ghi chú Mobile', () => {
    render(<DonateModal open onClose={() => {}} song={seed} />);
    expect(styleSelect().value).toBe('pc');
    expect(chunkTexts()).toEqual(chunkDonateText(buildDonateText(seed, ALL), 200));
    expect(screen.queryByText(/Kiểu Mobile để người chơi điện thoại đọc/)).toBeNull();
  });

  it('Cài đặt kiểu điều khiển Mobile → mặc định Mobile; các phần = chunkDonateText của bản Mobile', () => {
    act(() => useSettings.getState().set({ controlScheme: 'mobile' }));
    render(<DonateModal open onClose={() => {}} song={seed} />);
    expect(styleSelect().value).toBe('mobile');
    const expected = chunkDonateText(
      buildMobileDonateText(seed, {
        ...ALL,
        semitone: 'toggle',
        labels: LABELS_VI,
        legend: mobileLegend(tVi, LABELS_VI, 'toggle'),
      }),
      200,
    );
    expect(expected.length).toBeGreaterThan(5);
    expect(chunkTexts()).toEqual(expected);
    for (const c of expected) expect(c.length).toBeLessThanOrEqual(200);
    expect(expected[0]).toMatch(/^1\/\d+ \/\/ Mobile: /);
    const note = screen.getByText(/Kiểu Mobile để người chơi điện thoại đọc/);
    expect(styleSelect().getAttribute('aria-describedby')).toBe(note.id);
  });

  it('đổi kiểu chữ trong modal; các option độ dài / đoạn áp cho cả hai kiểu; không có ô lời', () => {
    render(<DonateModal open onClose={() => {}} song={small} />);
    fireEvent.change(styleSelect(), { target: { value: 'mobile' } });
    expect(preText()).toContain('[Cúi Xuống] 6 6 _ [Ngẩng Tự Nhiên] 1 2');
    expect(screen.queryByLabelText('Có lời')).toBeNull();
    fireEvent.click(screen.getByLabelText('Có tên đoạn (# section)'));
    const opts = { durations: true, sectionHeaders: false };
    const mobileText = buildMobileDonateText(small, {
      ...opts,
      semitone: 'toggle',
      labels: LABELS_VI,
      legend: mobileLegend(tVi, LABELS_VI, 'toggle'),
    });
    const parts = chunkDonateText(mobileText, 200);
    expect(preText()).toBe(parts.join('\n'));
    expect(screen.getByText(`${mobileText.length} ký tự · ${parts.length} phần`)).toBeTruthy();
    fireEvent.change(styleSelect(), { target: { value: 'pc' } });
    expect(preText()).toBe(chunkDonateText(buildDonateText(small, opts), 200).join('\n'));
  });

  it('Nửa Cung "chỉ 1 nốt" và tên gọi tùy chỉnh từ Cài đặt', () => {
    act(() =>
      useSettings.getState().set({
        controlScheme: 'mobile',
        mobileSemitone: 'oneShot',
        labelOverrides: { left: 'Hạ', right: '', natural: 'Giữa', scroll: '' },
      }),
    );
    render(<DonateModal open onClose={() => {}} song={small} />);
    const text = preText();
    expect(text).toContain('[Hạ] 6 6 _ [Giữa] 1 2');
    expect(text).toContain('[Nửa Cung] 4 3');
    expect(text).toContain(
      '[Ngẩng Lên] [Giữa] [Hạ] = chạm chọn quãng; [Nửa Cung] = chạm trước nốt',
    );
  });

  it('sao chép tất cả ở kiểu Mobile', async () => {
    act(() => useSettings.getState().set({ controlScheme: 'mobile' }));
    render(<DonateModal open onClose={() => {}} song={seed} />);
    const parts = chunkTexts();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Sao chép tất cả' }));
    });
    expect(copyText).toHaveBeenCalledWith(parts.join(DONATE_JOIN));
  });

  it('tiếng Anh', () => {
    act(() => useSettings.getState().set({ language: 'en', controlScheme: 'mobile' }));
    render(<DonateModal open onClose={() => {}} song={small} />);
    expect(styleSelect('Text style').value).toBe('mobile');
    expect(screen.getByRole('option', { name: 'PC (keys Z X C V B N M ,)' })).toBeTruthy();
    expect(screen.getByText(/Mobile style is for phone players to read/)).toBeTruthy();
    expect(preText()).toContain('[Crouch] 6 6 _ [Natural] 1 2');
  });
});

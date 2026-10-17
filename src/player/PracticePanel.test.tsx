import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSettings } from '../ui/settings';
import type { PracticeScore } from './practice.types';
import {
  ANNOUNCE_INTERVAL_MS,
  PracticeGradeFlash,
  PracticeHud,
  PracticeResults,
  formatAccuracy,
  formatDelta,
  liveAccuracy,
} from './PracticePanel';
import type { PracticeFlash, PracticeUiState } from './usePlayerEngine';

const score = (p: Partial<PracticeScore> = {}): PracticeScore => ({
  total: 10,
  judged: 0,
  perfect: 0,
  good: 0,
  miss: 0,
  combo: 0,
  maxCombo: 0,
  accuracy: 0,
  ...p,
});

const ui = (p: Partial<PracticeUiState> = {}): PracticeUiState => ({
  mode: 'score',
  waiting: false,
  score: score(),
  wrong: 0,
  last: null,
  results: null,
  guide: false,
  midi: 'off',
  next: -1,
  ...p,
});

const flash = (kind: PracticeFlash['kind'], seq: number, deltaMs: number | null = null) => ({
  kind,
  seq,
  deltaMs,
});

beforeEach(() => useSettings.getState().reset());

describe('formatters', () => {
  it('formatAccuracy follows the language, max one decimal, clamped', () => {
    expect(formatAccuracy(87.5, 'vi')).toBe('87,5');
    expect(formatAccuracy(87.5, 'en')).toBe('87.5');
    expect(formatAccuracy(100, 'vi')).toBe('100');
    expect(formatAccuracy(33.333, 'en')).toBe('33.3');
    expect(formatAccuracy(Number.NaN, 'en')).toBe('0');
    expect(formatAccuracy(140, 'en')).toBe('100');
    expect(formatAccuracy(-3, 'en')).toBe('0');
  });

  it('liveAccuracy counts only the judged notes', () => {
    expect(liveAccuracy(score())).toBe(0);
    expect(liveAccuracy(score({ judged: 4, perfect: 2, good: 1, miss: 1 }))).toBeCloseTo(62.5);
    expect(liveAccuracy(score({ judged: 1, perfect: 1 }))).toBe(100);
  });

  it('formatDelta is signed and rounded', () => {
    expect(formatDelta(34.6)).toBe('+35');
    expect(formatDelta(-12.2)).toBe('−12');
    expect(formatDelta(0.3)).toBe('0');
  });
});

describe('PracticeHud', () => {
  afterEach(() => vi.useRealTimers());

  it('shows the live stats, the mode / waiting status and the focus note', () => {
    const { rerender } = render(
      <PracticeHud
        practice={ui({
          score: score({ judged: 9, combo: 7, perfect: 6, good: 2, miss: 1, accuracy: 70 }),
          wrong: 3,
        })}
      />,
    );
    const region = screen.getByRole('region', { name: 'Điểm luyện tập' });
    const value = (cls: string) => region.querySelector(`.practice-stat-${cls} dd`)?.textContent;
    expect(value('combo')).toBe('7');
    expect(value('perfect')).toBe('6');
    expect(value('good')).toBe('2');
    expect(value('miss')).toBe('1');
    expect(value('accuracy')).toBe('77,8%'); // (6 + 0.5 × 2) / 9 nốt đã chấm
    expect(value('wrong')).toBe('3');
    expect(region.textContent).toContain('Chấm điểm: chạy theo nhịp');
    expect(region.textContent).toContain(
      'Luyện tập chỉ nhận phím / chuột khi tab app đang được chọn',
    );
    rerender(<PracticeHud practice={ui({ mode: 'wait', waiting: true, midi: 'listening' })} />);
    expect(region.querySelector('.practice-status.is-waiting')?.textContent).toBe(
      'Đang chờ bạn bấm nốt có viền vàng…',
    );
    expect(region.textContent).toContain('Đang nhận nốt từ đàn MIDI.');
  });

  it('shows the real MIDI state: denied / not plugged in / nothing while off or pending', () => {
    const { rerender } = render(<PracticeHud practice={ui({ midi: 'denied' })} />);
    const note = () => document.querySelector('.practice-note')?.textContent ?? '';
    expect(note()).toContain('trình duyệt không cho phép');
    expect(note()).not.toContain('Đang nhận nốt');
    rerender(<PracticeHud practice={ui({ midi: 'disconnected' })} />);
    expect(note()).toContain('Đàn MIDI đã chọn chưa được cắm');
    for (const midi of ['off', 'pending'] as const) {
      rerender(<PracticeHud practice={ui({ midi })} />);
      expect(note()).not.toContain('MIDI');
    }
    act(() => useSettings.getState().set({ language: 'en' }));
    rerender(<PracticeHud practice={ui({ midi: 'disconnected' })} />);
    expect(note()).toContain('not plugged in');
  });

  it('Mobile scheme: touch note only — no keyboard focus note and no MIDI state (input ignored)', () => {
    act(() => useSettings.getState().set({ controlScheme: 'mobile' }));
    vi.stubGlobal(
      'matchMedia',
      vi.fn((q: string) => ({ matches: q === '(pointer: coarse)' })),
    );
    const { container, rerender } = render(<PracticeHud practice={ui()} />);
    expect(container.textContent).toContain('Bàn nút như game');
    expect(container.textContent).not.toContain('Practice chỉ nhận phím/chuột');
    expect(container.textContent).not.toContain('Ctrl + N');
    // Điện thoại: không cần nói thêm về bàn phím.
    expect(container.textContent).not.toContain('không nhận bàn phím');
    rerender(<PracticeHud practice={ui({ midi: 'listening' })} />);
    expect(container.textContent).not.toContain('MIDI');
    // Máy có chuột (kiểu Mobile trên desktop): nói rõ chỉ nhận chạm / click trên bàn nút.
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({ matches: false })),
    );
    rerender(<PracticeHud practice={ui({ midi: 'off' })} />);
    expect(container.textContent).toContain(
      'Kiểu Mobile chỉ nhận chạm / click trên bàn nút — không nhận bàn phím hay đàn MIDI.',
    );
    expect(container.textContent).not.toContain('Practice chỉ nhận phím/chuột');
    expect(container.textContent).not.toContain('Ctrl');
    vi.unstubAllGlobals();
  });

  it('Wait hint: PC says key + modifier, Mobile says mode button then note', () => {
    const { container, rerender } = render(<PracticeHud practice={ui({ mode: 'wait' })} />);
    const status = () => container.querySelector('.practice-status')?.textContent;
    expect(status()).toBe('Chờ: bài dừng ở mỗi nốt tới khi bạn bấm đúng phím + modifier.');
    act(() => useSettings.getState().set({ controlScheme: 'mobile' }));
    rerender(<PracticeHud practice={ui({ mode: 'wait' })} />);
    expect(status()).toBe('Chờ: bài dừng ở mỗi nốt tới khi bạn chạm đúng nút chế độ rồi chạm nốt.');
    act(() => useSettings.getState().set({ language: 'en' }));
    rerender(<PracticeHud practice={ui({ mode: 'wait' })} />);
    expect(status()).toBe(
      'Wait: the song stops at each note until you tap the right mode button, then the note.',
    );
  });

  it('announces grades politely, at most once per interval (trailing update)', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const { container, rerender } = render(<PracticeHud practice={ui()} />);
    const live = container.querySelector('[aria-live="polite"]') as HTMLElement;
    expect(live.textContent).toBe('');
    rerender(
      <PracticeHud practice={ui({ last: flash('perfect', 1), score: score({ combo: 1 }) })} />,
    );
    expect(live.textContent).toBe('PERFECT, combo 1');
    rerender(<PracticeHud practice={ui({ last: flash('good', 2), score: score({ combo: 2 }) })} />);
    rerender(<PracticeHud practice={ui({ last: flash('miss', 3), score: score({ combo: 0 }) })} />);
    expect(live.textContent).toBe('PERFECT, combo 1'); // chưa đủ khoảng cách
    act(() => {
      vi.advanceTimersByTime(ANNOUNCE_INTERVAL_MS);
    });
    expect(live.textContent).toBe('MISS, combo 0'); // chỉ đọc cái mới nhất
  });

  it('cleans up the pending announcement timer on unmount', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const { rerender, unmount } = render(
      <PracticeHud practice={ui({ last: flash('perfect', 1) })} />,
    );
    rerender(<PracticeHud practice={ui({ last: flash('good', 2) })} />);
    expect(vi.getTimerCount()).toBe(1);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('PracticeGradeFlash', () => {
  it('re-mounts on every judgement (even the same grade) and shows the timing offset', () => {
    const { container, rerender } = render(<PracticeGradeFlash last={null} />);
    const slot = container.querySelector('.practice-flash-slot') as HTMLElement;
    expect(slot.getAttribute('aria-hidden')).toBe('true');
    expect(slot.textContent).toBe('');
    rerender(<PracticeGradeFlash last={flash('perfect', 1, 12)} />);
    const first = slot.querySelector('.practice-flash');
    expect(first?.className).toContain('practice-flash-perfect');
    expect(first?.textContent).toBe('PERFECT+12 ms');
    rerender(<PracticeGradeFlash last={flash('perfect', 2, -40)} />);
    expect(slot.querySelector('.practice-flash')).not.toBe(first);
    expect(slot.textContent).toBe('PERFECT−40 ms');
    rerender(<PracticeGradeFlash last={flash('miss', 3)} />);
    expect(slot.textContent).toBe('MISS');
    rerender(<PracticeGradeFlash last={flash('wrong', 4)} />);
    expect(slot.textContent).toBe('SAI PHÍM');
  });
});

describe('PracticeResults', () => {
  it('modal with accuracy, counts, best combo; replay and close', () => {
    const onReplay = vi.fn();
    const onClose = vi.fn();
    const res = score({ total: 8, judged: 8, perfect: 5, good: 2, miss: 1, maxCombo: 6 });
    res.accuracy = 75;
    const { rerender } = render(
      <PracticeResults results={null} wrong={0} onReplay={onReplay} onClose={onClose} />,
    );
    expect(screen.queryByRole('dialog')).toBeNull();
    rerender(<PracticeResults results={res} wrong={2} onReplay={onReplay} onClose={onClose} />);
    const dialog = screen.getByRole('dialog', { name: 'Kết quả luyện tập' });
    expect(dialog.querySelector('.practice-results-accuracy strong')?.textContent).toBe('75%');
    const value = (label: string) =>
      within(dialog).getByText(label).closest('div')?.querySelector('dd')?.textContent;
    expect(value('Perfect')).toBe('5');
    expect(value('Good')).toBe('2');
    expect(value('Miss')).toBe('1');
    expect(value('Combo cao nhất')).toBe('6');
    expect(value('Bấm sai')).toBe('2');
    expect(value('Tổng số nốt')).toBe('8');
    // "Chơi lại" là nút được focus sẵn.
    const replay = within(dialog).getByRole('button', { name: 'Chơi lại' });
    expect(document.activeElement).toBe(replay);
    act(() => replay.click());
    expect(onReplay).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('a press on the backdrop (any button, incl. left) does not dismiss the results', () => {
    const onClose = vi.fn();
    render(
      <PracticeResults
        results={score({ total: 4, judged: 4, perfect: 4 })}
        wrong={0}
        onReplay={() => {}}
        onClose={onClose}
      />,
    );
    const backdrop = document.querySelector('.modal-backdrop');
    expect(backdrop).toBeTruthy();
    for (const button of [0, 1, 2]) fireEvent.mouseDown(backdrop!, { button });
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: 'Kết quả luyện tập' })).toBeTruthy();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('English labels', () => {
    useSettings.getState().set({ language: 'en' });
    render(
      <PracticeResults
        results={score({ accuracy: 87.5, maxCombo: 3 })}
        wrong={0}
        onReplay={() => {}}
        onClose={() => {}}
      />,
    );
    const dialog = screen.getByRole('dialog', { name: 'Practice results' });
    expect(dialog.textContent).toContain('87.5%');
    expect(within(dialog).getByRole('button', { name: 'Play again' })).toBeTruthy();
    expect(dialog.textContent).toContain('Best combo');
  });
});

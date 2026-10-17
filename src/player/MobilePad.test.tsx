/**
 * Bàn nút kiểu game Mobile (SPEC Phase 4m a + b): hiển thị (chế độ theo kế hoạch, nhắc chạm, dấu chấm
 * giản phổ), hình học khớp lane, luyện tập bằng chạm (chốt chế độ, nút chế độ cần chạm khi sai, kết quả
 * cạnh nút), gợi ý xoay ngang, dọn listener; PlayerView kiểu Mobile dùng bàn nút thay game bar.
 */
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MobileCue } from '../core/mobile';
import type { TimelineNote } from '../core/types';
import { useLibrary } from '../library/store';
import { useSettings } from '../ui/settings';
import { useToasts } from '../ui/toast';
import { CUE_LAYER_ATTR, PAD_MODE_COLUMNS, padGeometry } from './layout';
import {
  MobilePad,
  MobilePadCombo,
  MobilePadRotateHint,
  PAD_NEED_MS,
  PAD_POP_MS,
  neededModeButtons,
  padGradeKey,
  wrongModeButtons,
} from './MobilePad';
import type { MobilePadPractice } from './MobilePad';
import type { MobileUiState } from './mobilePlan';
import { ROTATE_HINT_STORAGE_KEY } from './padPrefs';
import type { PracticeInputEvent } from './practice.types';
import { PlayerView } from './PlayerView';
import type { PracticeFlash, PracticeInputOutcome } from './usePlayerEngine';

vi.mock('../audio/engine', () => ({
  isAudioSupported: () => false,
  getAudioEngine: () => {
    throw new Error('audio engine must not be used when unsupported');
  },
  hasStickyActivation: () => false,
  UNLOCK_TIMEOUT_MS: 1000,
}));

const NATURAL: MobileUiState = { mode: 0, semitoneOn: false, nextCues: [], cueSoon: false };
const octCue = (mode: -1 | 0 | 1, beat = 4): MobileCue => ({
  beat,
  noteIndex: 3,
  kind: 'octave',
  mode,
});
const semCue = (on: boolean, beat = 4): MobileCue => ({ beat, noteIndex: 3, kind: 'semitone', on });

const pad = () => screen.getByRole('group', { name: 'Gợi ý phím như trong game' });
const modeEl = (b: string) => pad().querySelector<HTMLElement>(`.gbm-mode-${b}`) as HTMLElement;
const digitEl = (k: string) => pad().querySelector<HTMLElement>(`[data-key="${k}"]`) as HTMLElement;
const dotsAbove = () => pad().querySelectorAll('.mpad-digits .jp-dots-above').length;
const dotsBelow = () => pad().querySelectorAll('.mpad-digits .jp-dots-below').length;

function pointer(type: string, target: Element, init: PointerEventInit = {}): void {
  act(() => {
    target.dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        pointerType: 'touch',
        pointerId: 1,
        button: 0,
        ...init,
      }),
    );
  });
}

const tapEl = (el: Element, pointerId = 1) => {
  pointer('pointerdown', el.querySelector('span') ?? el, { pointerId });
  pointer('pointerup', el, { pointerId });
};

function practiceProps(overrides: Partial<MobilePadPractice> = {}): MobilePadPractice {
  return {
    last: null,
    pressedKeys: [],
    combo: 0,
    next: null,
    onInput: () => null,
    ...overrides,
  };
}

beforeEach(() => {
  useSettings.getState().reset();
  useSettings.getState().set({ controlScheme: 'mobile' });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('MobilePad — hiển thị', () => {
  it('nhóm như game bar (aria / data-scheme), 4 nút chế độ theo thứ tự game với tên từ Cài đặt', () => {
    useSettings
      .getState()
      .set({ labelOverrides: { left: '', right: 'Lên', natural: '', scroll: '' } });
    render(<MobilePad note={null} mobile={NATURAL} />);
    expect(pad().dataset.scheme).toBe('mobile');
    const modes = within(pad()).getByRole('group', { name: 'Nút chế độ như trong game mobile' });
    expect([...modes.children].map((c) => (c as HTMLElement).dataset.mode)).toEqual([
      'scroll',
      'right',
      'natural',
      'left',
    ]);
    expect(modes.textContent).toBe('Nửa CungLênNgẩng Tự NhiênCúi Xuống');
    // Số ký tự của từ dài nhất (CSS thu chữ để từ lọt một dòng trong hình tròn).
    expect(
      [...modes.querySelectorAll<HTMLElement>('.mpad-mode-name')].map((el) =>
        el.style.getPropertyValue('--mpad-name-ch'),
      ),
    ).toEqual(['4', '3', '5', '5']);
    expect(
      within(pad()).getByRole('group', { name: 'Nút nốt như trong game mobile' }),
    ).toBeTruthy();
    // Chỉ xem: không có nút bấm, không kbd.
    expect(pad().querySelectorAll('button')).toHaveLength(0);
    expect(pad().querySelectorAll('kbd')).toHaveLength(0);
    expect(modeEl('natural').className).toContain('is-selected');
    expect(modeEl('natural').getAttribute('aria-current')).toBe('true');
  });

  it('chế độ theo kế hoạch tại hit line: chọn + dấu chấm số; nhắc chạm (vòng + ping) khi gần', () => {
    const { rerender } = render(<MobilePad note={null} mobile={{ ...NATURAL, mode: -1 }} />);
    expect(modeEl('left').className).toContain('is-selected');
    expect(dotsBelow()).toBe(7); // 1̣…7̣, nút cuối "1" không chấm
    expect(dotsAbove()).toBe(0);
    rerender(
      <MobilePad
        note={null}
        mobile={{ mode: 1, semitoneOn: true, nextCues: [octCue(0), semCue(false)], cueSoon: true }}
      />,
    );
    expect(modeEl('right').className).toContain('is-selected');
    expect(modeEl('scroll').className).toContain('is-selected');
    expect(dotsAbove()).toBe(8);
    expect(modeEl('natural').className).toContain('is-cue');
    expect(modeEl('scroll').className).toContain('is-cue');
    expect(modeEl('natural').querySelector('.mpad-ping')).not.toBeNull();
    expect(modeEl('left').className).not.toContain('is-cue');
  });

  it('nốt ở hit line: nút số sáng theo màu tile', () => {
    const note: Pick<TimelineNote, 'key' | 'modifiers'> = {
      key: 'N',
      modifiers: { left: true, right: false, scroll: false },
    };
    render(<MobilePad note={note} noteId={4} mobile={NATURAL} />);
    expect(digitEl('N').className).toContain('is-active');
    expect(digitEl('N').className).toContain('gb-tone-left');
    expect(digitEl('N').getAttribute('aria-current')).toBe('true');
    expect(digitEl('Z').className).not.toContain('is-active');
  });

  it('hình học theo hộp chứa: biến CSS từ padGeometry, nút số đều cột, nút chế độ ở mép cột 3…6', () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      width: 800,
      height: 300,
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 800,
      bottom: 300,
      toJSON: () => ({}),
    } as DOMRect);
    render(
      <div className="player-canvas-box">
        <MobilePad note={null} mobile={NATURAL} />
      </div>,
    );
    const g = padGeometry(800, 300);
    expect(pad().style.height).toBe(`${g.height}px`);
    expect(pad().style.getPropertyValue('--mpad-digit-d')).toBe(`${g.digitD}px`);
    expect(pad().style.getPropertyValue('--mpad-digit-top')).toBe(`${g.digitTop}px`);
    expect(pad().dataset.label).toBe(g.modeLabelInside ? 'inside' : 'below');
    const lefts = [...pad().querySelectorAll<HTMLElement>('.mpad-digit')].map((d) => d.style.left);
    expect(lefts).toEqual(['0%', '12.5%', '25%', '37.5%', '50%', '62.5%', '75%', '87.5%']);
    const modeLefts = [...pad().querySelectorAll<HTMLElement>('.mpad-mode')].map(
      (d) => d.style.left,
    );
    expect(modeLefts).toEqual(PAD_MODE_COLUMNS.map((c) => `${(c / 8) * 100}%`));
    // Lớp vòng "CHẠM" phủ cả hộp canvas (cao = hộp), nằm cuối bàn nút → trên nút chế độ.
    expect(pad().style.getPropertyValue('--mpad-box-h')).toBe('300px');
  });

  it('lớp canvas vòng "CHẠM" (renderer vẽ): cuối bàn nút, ẩn với trình đọc màn hình, không nhận chạm', () => {
    render(
      <div className="player-canvas-box">
        <canvas className="player-canvas" />
        <MobilePad note={null} mobile={NATURAL} />
      </div>,
    );
    const layer = pad().querySelector(`canvas[${CUE_LAYER_ATTR}]`);
    expect(layer).not.toBeNull();
    expect(layer?.classList.contains('mpad-cues')).toBe(true);
    expect(layer?.getAttribute('aria-hidden')).toBe('true');
    expect(pad().lastElementChild).toBe(layer);
    // Renderer tìm lớp trong hộp của canvas tiles (cùng cha với canvas).
    const box = document.querySelector('.player-canvas-box')!;
    expect(box.querySelector(`canvas[${CUE_LAYER_ATTR}]`)).toBe(layer);
  });
});

describe('MobilePad — luyện tập bằng chạm', () => {
  it('nút bấm được; chạm chế độ chốt như game, chạm nốt gửi tap-down với chế độ đã chốt', () => {
    const inputs: PracticeInputEvent[] = [];
    render(
      <MobilePad
        note={null}
        mobile={NATURAL}
        practice={practiceProps({ onInput: (ev) => (inputs.push(ev), null) })}
      />,
    );
    const right = within(pad()).getByRole('button', { name: 'Ngẩng Lên' });
    expect(right.getAttribute('aria-pressed')).toBe('false');
    tapEl(right);
    expect(right.getAttribute('aria-pressed')).toBe('true');
    expect(dotsAbove()).toBe(8); // số theo chế độ ĐANG CHỐT (không theo kế hoạch)
    const n = pad().querySelector('[data-pad-key="N"]') as HTMLElement;
    expect(n.tabIndex).toBe(-1);
    tapEl(n);
    expect(inputs.map((e) => e.type)).toEqual(['tap-down', 'tap-up']);
    expect(inputs[0]).toMatchObject({ key: 'N', octave: 1, sharp: false, source: 'touch' });
  });

  it("Nửa Cung 'oneShot': sáng tới nốt kế tiếp rồi tự tắt", () => {
    useSettings.getState().set({ mobileSemitone: 'oneShot' });
    const inputs: PracticeInputEvent[] = [];
    render(
      <MobilePad
        note={null}
        mobile={NATURAL}
        practice={practiceProps({ onInput: (ev) => (inputs.push(ev), null) })}
      />,
    );
    const scroll = within(pad()).getByRole('button', { name: 'Nửa Cung' });
    tapEl(scroll);
    expect(scroll.getAttribute('aria-pressed')).toBe('true');
    tapEl(pad().querySelector('[data-pad-key="V"]') as HTMLElement);
    expect(scroll.getAttribute('aria-pressed')).toBe('false');
    tapEl(pad().querySelector('[data-pad-key="V"]') as HTMLElement);
    const downs = inputs.filter((e) => e.type === 'tap-down');
    expect(downs.map((e) => (e.type === 'tap-down' ? e.sharp : null))).toEqual([true, false]);
  });

  it('đa chạm: hai ngón hai nốt, mỗi ngón thả đúng nốt', () => {
    const inputs: PracticeInputEvent[] = [];
    render(
      <MobilePad
        note={null}
        mobile={NATURAL}
        practice={practiceProps({ onInput: (ev) => (inputs.push(ev), null) })}
      />,
    );
    const z = pad().querySelector('[data-pad-key="Z"]') as HTMLElement;
    const c = pad().querySelector('[data-pad-key="C"]') as HTMLElement;
    pointer('pointerdown', z, { pointerId: 11 });
    pointer('pointerdown', c, { pointerId: 12 });
    pointer('pointerup', c, { pointerId: 11 });
    pointer('pointerup', c, { pointerId: 12 });
    expect(
      inputs.map((e) => (e.type === 'tap-down' || e.type === 'tap-up' ? `${e.type} ${e.key}` : '')),
    ).toEqual(['tap-down Z', 'tap-down C', 'tap-up Z', 'tap-up C']);
  });

  it('chạm nốt sai chế độ → nút chế độ cần chạm loé lên', () => {
    const expected = { octave: 1, sharp: true } as TimelineNote;
    const onInput = (ev: PracticeInputEvent): PracticeInputOutcome | null =>
      ev.type === 'tap-down' ? { kind: 'wrong', expected } : null;
    render(<MobilePad note={null} mobile={NATURAL} practice={practiceProps({ onInput })} />);
    tapEl(pad().querySelector('[data-pad-key="Z"]') as HTMLElement);
    expect(modeEl('right').className).toContain('is-need');
    expect(modeEl('scroll').className).toContain('is-need');
    expect(modeEl('right').querySelector('.mpad-need-ring')).not.toBeNull();
    expect(modeEl('natural').className).not.toContain('is-need');
  });

  it('kết quả hiện cạnh nút của cột (tia sáng khi trúng); không rõ cột → giữa', () => {
    const flash = (f: Partial<PracticeFlash>): PracticeFlash => ({
      kind: 'perfect',
      seq: 1,
      deltaMs: 0,
      key: 'C',
      ...f,
    });
    const { rerender } = render(
      <MobilePad note={null} mobile={NATURAL} practice={practiceProps({ last: flash({}) })} />,
    );
    const pops = () =>
      [...pad().querySelectorAll<HTMLElement>('.mpad-pop')].map(
        (p) => `${p.textContent} @${p.style.left}`,
      );
    expect(pops()).toEqual(['PERFECT @31.25%']);
    expect(digitEl('C').querySelector('.mpad-spark-perfect')).not.toBeNull();
    rerender(
      <MobilePad
        note={null}
        mobile={NATURAL}
        practice={practiceProps({ last: flash({ kind: 'miss', seq: 2, deltaMs: null }) })}
      />,
    );
    expect(pops()).toEqual(['MISS @31.25%']);
    expect(digitEl('C').querySelector('.mpad-spark')).toBeNull();
    rerender(
      <MobilePad
        note={null}
        mobile={NATURAL}
        practice={practiceProps({ last: flash({ kind: 'range', seq: 3, key: null }) })}
      />,
    );
    expect(pops()).toEqual(['MISS @31.25%', 'NGOÀI TẦM @50%']);
    // Tắt luyện tập: bỏ hết.
    rerender(<MobilePad note={null} mobile={NATURAL} />);
    expect(pad().querySelectorAll('.mpad-pop')).toHaveLength(0);
  });

  it('tia sáng KHÔNG chạy lại khi nốt tới / rời hit line ở cột đó (hình tròn remount)', () => {
    const last: PracticeFlash = { kind: 'perfect', seq: 1, deltaMs: 0, key: 'N' };
    const note = (key: 'N' | 'X') => ({
      key,
      modifiers: { left: false, right: false, scroll: false },
    });
    const { rerender } = render(
      <MobilePad note={note('N')} noteId={4} mobile={NATURAL} practice={practiceProps({ last })} />,
    );
    const spark = digitEl('N').querySelector('.mpad-spark');
    const circle = digitEl('N').querySelector('.mpad-circle');
    expect(spark).not.toBeNull();
    // Nốt rời hit line, rồi nốt N mới tới: hình tròn được gắn lại, tia sáng vẫn là phần tử cũ (animation không
    // chạy lại như một lần trúng giả).
    rerender(
      <MobilePad note={null} noteId={null} mobile={NATURAL} practice={practiceProps({ last })} />,
    );
    rerender(
      <MobilePad note={note('N')} noteId={5} mobile={NATURAL} practice={practiceProps({ last })} />,
    );
    expect(digitEl('N').querySelector('.mpad-circle')).not.toBe(circle);
    expect(digitEl('N').querySelectorAll('.mpad-spark')).toHaveLength(1);
    expect(digitEl('N').querySelector('.mpad-spark')).toBe(spark);
    expect(spark?.isConnected).toBe(true);
    // Tia sáng nằm cạnh hình tròn, không trong nó.
    expect(digitEl('N').querySelector('.mpad-circle .mpad-spark')).toBeNull();
  });

  it('hiệu ứng tự gỡ khỏi DOM (không dựa vào CSS — giảm chuyển động tắt animation)', () => {
    vi.useFakeTimers();
    try {
      const expected = { key: 'Z', octave: 1, sharp: false } as TimelineNote;
      const onInput = (ev: PracticeInputEvent): PracticeInputOutcome | null =>
        ev.type === 'tap-down' ? { kind: 'wrong', expected } : null;
      const last: PracticeFlash = { kind: 'perfect', seq: 7, deltaMs: 0, key: 'C' };
      render(
        <MobilePad note={null} mobile={NATURAL} practice={practiceProps({ last, onInput })} />,
      );
      tapEl(pad().querySelector('[data-pad-key="Z"]') as HTMLElement);
      expect(pad().querySelectorAll('.mpad-pop')).toHaveLength(1);
      expect(pad().querySelectorAll('.mpad-spark')).toHaveLength(1);
      expect(pad().querySelectorAll('.mpad-need-ring')).toHaveLength(1);
      act(() => {
        vi.advanceTimersByTime(PAD_POP_MS - 1);
      });
      expect(pad().querySelectorAll('.mpad-pop')).toHaveLength(1);
      act(() => {
        vi.advanceTimersByTime(1);
      });
      expect(pad().querySelectorAll('.mpad-pop')).toHaveLength(0);
      expect(pad().querySelectorAll('.mpad-spark')).toHaveLength(0);
      act(() => {
        vi.advanceTimersByTime(PAD_NEED_MS - PAD_POP_MS);
      });
      expect(pad().querySelectorAll('.mpad-need-ring, .is-need')).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('đúng nốt sai chế độ → "SAI CHẾ ĐỘ"; sai nốt → "SAI PHÍM"', () => {
    const wrong = (seq: number, rightKey?: boolean): PracticeFlash => ({
      kind: 'wrong',
      seq,
      deltaMs: null,
      key: 'X',
      ...(rightKey === undefined ? {} : { rightKey }),
    });
    const { rerender } = render(
      <MobilePad note={null} mobile={NATURAL} practice={practiceProps({ last: wrong(1, true) })} />,
    );
    const popText = () => pad().querySelector('.mpad-pop')?.textContent;
    expect(popText()).toBe('SAI CHẾ ĐỘ');
    rerender(
      <MobilePad note={null} mobile={NATURAL} practice={practiceProps({ last: wrong(2) })} />,
    );
    expect(popText()).toBe('SAI PHÍM');
    expect(padGradeKey({ kind: 'wrong', rightKey: true })).toBe('practice.grade.wrongMode');
    expect(padGradeKey({ kind: 'miss', rightKey: true })).toBe('practice.grade.miss');
  });

  it('nhắc nút chế độ cần chạm trước nốt kế tiếp, theo chế độ ĐANG CHỐT (đúng rồi thì thôi)', () => {
    // Kế hoạch tại hit line nói Ngẩng Tự Nhiên + sắp chạm Cúi Xuống — luyện tập không theo nó.
    const mobile: MobileUiState = {
      mode: 0,
      semitoneOn: false,
      nextCues: [octCue(-1)],
      cueSoon: true,
    };
    render(
      <MobilePad
        note={null}
        mobile={mobile}
        practice={practiceProps({ next: { octave: 1, sharp: true } })}
      />,
    );
    expect(modeEl('right').className).toContain('is-cue');
    expect(modeEl('scroll').className).toContain('is-cue');
    expect(modeEl('left').className).not.toContain('is-cue');
    tapEl(within(pad()).getByRole('button', { name: 'Ngẩng Lên' }));
    expect(modeEl('right').className).not.toContain('is-cue');
    expect(modeEl('scroll').className).toContain('is-cue');
    tapEl(within(pad()).getByRole('button', { name: 'Nửa Cung' }));
    expect(pad().querySelectorAll('.is-cue')).toHaveLength(0);
  });

  it('gỡ listener khi tắt luyện tập / unmount', () => {
    const add = vi.spyOn(window, 'addEventListener');
    const remove = vi.spyOn(window, 'removeEventListener');
    const inputs: PracticeInputEvent[] = [];
    const { rerender, unmount } = render(
      <MobilePad
        note={null}
        mobile={NATURAL}
        practice={practiceProps({ onInput: (ev) => (inputs.push(ev), null) })}
      />,
    );
    const count = (spy: { mock: { calls: unknown[][] } }, type: string) =>
      spy.mock.calls.filter((c) => c[0] === type).length;
    expect(count(add, 'pointerup')).toBe(1);
    rerender(<MobilePad note={null} mobile={NATURAL} />);
    expect(count(remove, 'pointerup')).toBe(1);
    expect(count(remove, 'pointercancel')).toBe(1);
    expect(count(remove, 'blur')).toBe(1);
    pointer('pointerdown', digitEl('Z'));
    expect(inputs).toHaveLength(0);
    unmount();
  });
});

describe('neededModeButtons / wrongModeButtons', () => {
  const st = (mode: -1 | 0 | 1, semitoneOn = false) => ({ mode, semitoneOn });

  it('nút phải chạm trước nốt kế tiếp so với chế độ đang chốt; hết nốt → không', () => {
    expect([...neededModeButtons(st(0), { octave: 1, sharp: true })]).toEqual(['right', 'scroll']);
    expect([...neededModeButtons(st(1, true), { octave: 1, sharp: true })]).toEqual([]);
    // Nửa Cung đang bật / đang chờ áp ("chỉ 1 nốt") mà nốt kế không thăng → chạm lại để tắt.
    expect([...neededModeButtons(st(-1, true), { octave: -1, sharp: false })]).toEqual(['scroll']);
    expect([...neededModeButtons(st(1), { octave: 0, sharp: false })]).toEqual(['natural']);
    expect([...neededModeButtons(st(0), null)]).toEqual([]);
  });

  it('nút đúng cho nốt lẽ ra phải bấm', () => {
    expect(wrongModeButtons({ octave: 0, sharp: false }, { octave: -1, sharp: false })).toEqual([
      'left',
    ]);
    expect(wrongModeButtons({ octave: 1, sharp: true }, { octave: 0, sharp: false })).toEqual([
      'natural',
      'scroll',
    ]);
    expect(wrongModeButtons({ octave: 0, sharp: false }, { octave: 0, sharp: false })).toEqual([]);
  });
});

describe('MobilePadRotateHint / MobilePadCombo', () => {
  function stubMatchMedia(matches: boolean) {
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({
        matches,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    );
  }

  it('chỉ trên điện thoại dọc; đóng được và nhớ', () => {
    stubMatchMedia(true);
    const { unmount } = render(<MobilePadRotateHint />);
    expect(screen.getByRole('note').textContent).toContain('Xoay ngang để giống màn hình game');
    fireEvent.click(screen.getByRole('button', { name: 'Đóng gợi ý xoay ngang' }));
    expect(screen.queryByRole('note')).toBeNull();
    expect(localStorage.getItem(ROTATE_HINT_STORAGE_KEY)).toBe('1');
    unmount();
    render(<MobilePadRotateHint />);
    expect(screen.queryByRole('note')).toBeNull();
  });

  it('màn ngang / desktop: không hiện', () => {
    stubMatchMedia(false);
    render(<MobilePadRotateHint />);
    expect(screen.queryByRole('note')).toBeNull();
  });

  it('combo chỉ hiện từ 2', () => {
    const { container, rerender } = render(<MobilePadCombo combo={1} />);
    expect(container.textContent).toBe('');
    rerender(<MobilePadCombo combo={12} />);
    expect(container.textContent).toBe('Combo12');
  });
});

// ── PlayerView kiểu Mobile ──

describe('PlayerView — bố cục kiểu game (Mobile)', () => {
  let frames = new Map<number, FrameRequestCallback>();
  let nextFrame = 1;
  let nowMs = 0;
  const added: string[] = [];

  const flushFrames = () => {
    const list = Array.from(frames.values());
    frames.clear();
    act(() => list.forEach((cb) => cb(0)));
  };
  const advance = (ms: number) => {
    nowMs += ms;
    flushFrames();
  };

  beforeEach(() => {
    frames = new Map();
    nextFrame = 1;
    nowMs = 1000;
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn((cb: FrameRequestCallback) => {
        const id = nextFrame++;
        frames.set(id, cb);
        return id;
      }),
    );
    vi.stubGlobal(
      'cancelAnimationFrame',
      vi.fn((id: number) => frames.delete(id)),
    );
    vi.spyOn(performance, 'now').mockImplementation(() => nowMs);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => null);
    useSettings.getState().set({ countIn: false, startDelaySec: 0 });
    useToasts.setState({ toasts: [] });
  });

  afterEach(() => {
    for (const id of added.splice(0)) useLibrary.getState().removeSong(id);
  });

  it('bàn nút thay game bar; luyện tập: chạm chế độ + nốt được chấm, combo + kết quả cạnh nút', () => {
    const id = useLibrary.getState().addSong('@title M\n@bpm 120\nZ R:N Z\n');
    added.push(id);
    render(<PlayerView songId={id} />);
    expect(pad().dataset.scheme).toBe('mobile');
    expect(document.querySelector('.game-bar')).toBeNull();
    expect(document.querySelector('.player-stage')?.className).toContain('is-mpad');
    // Banner gọn nằm trong khung sân khấu, trên khu tiles.
    expect(document.querySelector('.player-canvas-wrap .hold-banner-slot')).not.toBeNull();
    expect(pad().querySelectorAll('button')).toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: 'Luyện tập' }));
    expect(pad().querySelectorAll('button[data-pad-key]')).toHaveLength(8);
    expect(screen.getByText(/Bàn nút như game/)).toBeTruthy();
    act(() => {
      fireEvent.keyDown(window, { code: 'Space' });
      fireEvent.keyUp(window, { code: 'Space' });
    });
    advance(20);
    tapEl(pad().querySelector('[data-pad-key="Z"]') as HTMLElement);
    // Nốt kế (R:N) cần Ngẩng Lên: bàn nút nhắc trước.
    expect(modeEl('right').className).toContain('is-cue');
    advance(480); // beat 1: R:N
    tapEl(within(pad()).getByRole('button', { name: 'Ngẩng Lên' }), 2);
    tapEl(pad().querySelector('[data-pad-key="N"]') as HTMLElement, 3);
    const stat = (cls: string) => document.querySelector(`.${cls} dd`)?.textContent;
    expect(stat('practice-stat-perfect')).toBe('2');
    expect(stat('practice-stat-combo')).toBe('2');
    expect(document.querySelector('.mpad-combo')?.textContent).toBe('Combo2');
    expect(pad().querySelector('.mpad-pop')?.textContent).toBe('PERFECT');
    // Quên về Ngẩng Tự Nhiên ở nốt Z cuối: sai, nút Ngẩng Tự Nhiên loé.
    advance(500);
    tapEl(pad().querySelector('[data-pad-key="Z"]') as HTMLElement, 4);
    expect(stat('practice-stat-wrong')).toBe('1');
    expect(modeEl('natural').className).toContain('is-need');

    // Đổi sang PC: game bar cũ trở lại.
    act(() => useSettings.getState().set({ controlScheme: 'pc' }));
    expect(document.querySelector('.mpad')).toBeNull();
    expect(screen.getByRole('group', { name: 'Gợi ý phím như trong game' }).dataset.scheme).toBe(
      'pc',
    );
  });

  it('điện thoại (hẹp hoặc thấp): bấm Phát → cuộn tới khu tiles; nút tạm dừng ngay trong khu tiles', () => {
    const scroll = vi.fn();
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: scroll,
    });
    try {
      vi.stubGlobal(
        'matchMedia',
        vi.fn((q: string) => ({
          matches: q.includes('max-width: 720px'),
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
        })),
      );
      const id = useLibrary.getState().addSong('@title M\n@bpm 120\nZ X C V\n');
      added.push(id);
      render(<PlayerView songId={id} />);
      const stage = document.querySelector('.player-stage') as HTMLElement;
      expect(scroll).not.toHaveBeenCalled();
      act(() => {
        fireEvent.keyDown(window, { code: 'Space' });
        fireEvent.keyUp(window, { code: 'Space' });
      });
      advance(20);
      expect(scroll).toHaveBeenCalledTimes(1);
      expect(scroll.mock.contexts[0]).toBe(stage);
      expect(scroll).toHaveBeenCalledWith({ block: 'end', behavior: 'smooth' });
      const toggle = stage.querySelector('.player-stage-toggle') as HTMLButtonElement;
      expect(toggle.getAttribute('aria-label')).toBe('Tạm dừng');
      fireEvent.click(toggle);
      expect(toggle.getAttribute('aria-label')).toBe('Phát');
    } finally {
      delete (HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView;
    }
  });

  it('màn lớn: không tự cuộn khi Phát', () => {
    const scroll = vi.fn();
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: scroll,
    });
    try {
      vi.stubGlobal(
        'matchMedia',
        vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
      );
      const id = useLibrary.getState().addSong('@title M\n@bpm 120\nZ X C V\n');
      added.push(id);
      render(<PlayerView songId={id} />);
      act(() => {
        fireEvent.keyDown(window, { code: 'Space' });
        fireEvent.keyUp(window, { code: 'Space' });
      });
      advance(20);
      expect(scroll).not.toHaveBeenCalled();
    } finally {
      delete (HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView;
    }
  });
});

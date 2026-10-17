/**
 * Bàn chạm kiểu game Mobile (SPEC Phase 4m C): chốt chế độ như game (Nửa Cung theo setting), lần chạm nốt
 * mang (key, octave, sharp) + timeStamp của PointerEvent, đa chạm theo pointerId, chặn cuộn / menu, dọn sạch.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MobilePadLatch,
  PAD_VIBRATE_MS,
  attachMobilePadInput,
  padTargetOf,
} from './mobilePadInput';
import type { PadLatchState } from './mobilePadInput';
import type { PracticeInputEvent } from './practice.types';

describe('MobilePadLatch', () => {
  it('đầu: Ngẩng Tự Nhiên, Nửa Cung tắt; chế độ quãng giữ tới lần chạm khác', () => {
    const l = new MobilePadLatch();
    expect(l.state).toEqual({ mode: 0, semitoneOn: false });
    l.tapMode('right');
    expect(l.noteChoice('Z')).toEqual({ key: 'Z', octave: 1, sharp: false });
    expect(l.noteChoice('X')).toEqual({ key: 'X', octave: 1, sharp: false });
    l.tapMode('left');
    expect(l.noteChoice(',')).toEqual({ key: ',', octave: -1, sharp: false });
    l.tapMode('natural');
    expect(l.state.mode).toBe(0);
  });

  it("Nửa Cung 'toggle': bật giữ qua nhiều nốt, chạm lại thì tắt", () => {
    const l = new MobilePadLatch('toggle');
    l.tapMode('scroll');
    expect(l.noteChoice('V').sharp).toBe(true);
    expect(l.noteChoice('B').sharp).toBe(true);
    l.tapMode('scroll');
    expect(l.noteChoice('B').sharp).toBe(false);
  });

  it("Nửa Cung 'oneShot': chỉ áp cho nốt kế tiếp; chạm lại khi đang chờ = hủy", () => {
    const l = new MobilePadLatch('oneShot');
    l.tapMode('scroll');
    expect(l.state.semitoneOn).toBe(true);
    expect(l.noteChoice('V')).toEqual({ key: 'V', octave: 0, sharp: true });
    expect(l.state.semitoneOn).toBe(false);
    expect(l.noteChoice('V').sharp).toBe(false);
    l.tapMode('scroll');
    l.tapMode('scroll');
    expect(l.noteChoice('V').sharp).toBe(false);
    // Kết hợp với chế độ quãng (giữ nguyên quãng sau nốt).
    l.tapMode('left');
    l.tapMode('scroll');
    expect(l.noteChoice('C')).toEqual({ key: 'C', octave: -1, sharp: true });
    expect(l.state).toEqual({ mode: -1, semitoneOn: false });
  });

  it('đổi cách Nửa Cung giữa chừng áp từ lần chạm kế; reset về đầu', () => {
    const l = new MobilePadLatch('toggle');
    l.tapMode('scroll');
    l.semitone = 'oneShot';
    expect(l.noteChoice('Z').sharp).toBe(true);
    expect(l.state.semitoneOn).toBe(false);
    l.tapMode('right');
    l.reset();
    expect(l.state).toEqual({ mode: 0, semitoneOn: false });
  });
});

// ── DOM ──

let root: HTMLDivElement;
let parent: HTMLDivElement;
let events: PracticeInputEvent[];
let latchStates: PadLatchState[];
let latch: MobilePadLatch;
let detach: (() => void) | null;
let vibrateOn: boolean;

function button(attr: 'data-pad-key' | 'data-pad-mode', value: string): HTMLButtonElement {
  const b = document.createElement('button');
  b.setAttribute(attr, value);
  const inner = document.createElement('span');
  b.appendChild(inner);
  root.appendChild(b);
  return b;
}

const keyBtn = (k: string) =>
  root.querySelector<HTMLElement>(`[data-pad-key="${k}"] span`) as HTMLElement;
const modeBtn = (m: string) =>
  root.querySelector<HTMLElement>(`[data-pad-mode="${m}"]`) as HTMLElement;

function pointer(type: string, target: EventTarget, init: PointerEventInit = {}): PointerEvent {
  const e = new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    pointerType: 'touch',
    pointerId: 1,
    button: 0,
    ...init,
  });
  target.dispatchEvent(e);
  return e;
}

const attach = () => {
  detach = attachMobilePadInput(root, {
    latch,
    onEvent: (ev) => events.push(ev),
    onLatchChange: (s) => latchStates.push(s),
    vibrate: () => vibrateOn,
  });
};

const summary = () =>
  events.map((e) =>
    e.type === 'tap-down' || e.type === 'tap-up'
      ? `${e.type} ${e.key} ${e.octave}${e.sharp ? '#' : ''} p${e.pointerId}`
      : e.type,
  );

beforeEach(() => {
  parent = document.createElement('div');
  root = document.createElement('div');
  parent.appendChild(root);
  document.body.appendChild(parent);
  for (const k of ['Z', 'X', 'C', 'V', 'B', 'N', 'M', ',']) button('data-pad-key', k);
  for (const m of ['scroll', 'right', 'natural', 'left']) button('data-pad-mode', m);
  events = [];
  latchStates = [];
  latch = new MobilePadLatch('toggle');
  detach = null;
  vibrateOn = false;
});

afterEach(() => {
  detach?.();
  parent.remove();
  vi.restoreAllMocks();
});

describe('padTargetOf', () => {
  it('đọc nút từ phần tử con; thuộc tính lạ / không phải phần tử → null', () => {
    expect(padTargetOf(keyBtn(','))).toEqual({ kind: 'note', key: ',' });
    expect(padTargetOf(modeBtn('left'))).toEqual({ kind: 'mode', button: 'left' });
    const bad = document.createElement('span');
    bad.setAttribute('data-pad-key', 'Q');
    expect(padTargetOf(bad)).toBeNull();
    const badMode = document.createElement('span');
    badMode.setAttribute('data-pad-mode', 'up');
    expect(padTargetOf(badMode)).toBeNull();
    expect(padTargetOf(root)).toBeNull();
    expect(padTargetOf(null)).toBeNull();
    expect(padTargetOf({})).toBeNull();
  });
});

describe('attachMobilePadInput', () => {
  it('chạm chế độ rồi chạm nốt (như game): tap-down mang chế độ đã chốt + timeStamp của sự kiện', () => {
    attach();
    pointer('pointerdown', modeBtn('right'));
    expect(latchStates).toEqual([{ mode: 1, semitoneOn: false }]);
    const down = pointer('pointerdown', keyBtn('N'));
    expect(down.defaultPrevented).toBe(true);
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      type: 'tap-down',
      key: 'N',
      octave: 1,
      sharp: false,
      source: 'touch',
      pointerId: 1,
      timeStamp: down.timeStamp,
    });
    pointer('pointerup', window);
    expect(summary()).toEqual(['tap-down N 1 p1', 'tap-up N 1 p1']);
  });

  it("Nửa Cung 'oneShot' áp cho đúng nốt kế tiếp rồi tự tắt (báo cho bàn nút vẽ lại)", () => {
    latch.semitone = 'oneShot';
    attach();
    pointer('pointerdown', modeBtn('scroll'));
    pointer('pointerdown', keyBtn('V'));
    pointer('pointerup', window);
    pointer('pointerdown', keyBtn('V'));
    pointer('pointerup', window);
    expect(summary()).toEqual([
      'tap-down V 0# p1',
      'tap-up V 0 p1',
      'tap-down V 0 p1',
      'tap-up V 0 p1',
    ]);
    expect(latchStates).toEqual([
      { mode: 0, semitoneOn: true },
      { mode: 0, semitoneOn: false },
    ]);
  });

  it('đa chạm: mỗi ngón thả đúng nốt của nó; ngón giữ chế độ + ngón chạm nốt cùng lúc', () => {
    attach();
    pointer('pointerdown', keyBtn('Z'), { pointerId: 1 });
    pointer('pointerdown', modeBtn('left'), { pointerId: 2 });
    pointer('pointerdown', keyBtn('C'), { pointerId: 3 });
    pointer('pointerup', window, { pointerId: 1 });
    pointer('pointerup', window, { pointerId: 2 }); // ngón trên nút chế độ: không có nốt để thả
    pointer('pointercancel', window, { pointerId: 3 });
    pointer('pointerup', window, { pointerId: 3 }); // đã thả → bỏ qua
    expect(summary()).toEqual([
      'tap-down Z 0 p1',
      'tap-down C -1 p3',
      'tap-up Z -1 p1',
      'tap-up C -1 p3',
    ]);
  });

  it('cùng ngón chạm lại khi chưa thả: thả nốt cũ trước', () => {
    attach();
    pointer('pointerdown', keyBtn('Z'));
    pointer('pointerdown', keyBtn('X'));
    expect(summary()).toEqual(['tap-down Z 0 p1', 'tap-up Z 0 p1', 'tap-down X 0 p1']);
  });

  it('không nổi lên stage (vùng chuột-modifier PC); chuột phải / giữa bị nuốt, không là lần chạm', () => {
    const stageDown = vi.fn();
    parent.addEventListener('pointerdown', stageDown);
    attach();
    pointer('pointerdown', keyBtn('Z'), { pointerType: 'mouse' });
    const right = pointer('pointerdown', keyBtn('X'), {
      pointerType: 'mouse',
      button: 2,
      pointerId: 7,
    });
    expect(right.defaultPrevented).toBe(true);
    pointer('pointerdown', root); // nền bàn nút: không làm gì
    expect(stageDown).not.toHaveBeenCalled();
    expect(summary()).toEqual(['tap-down Z 0 p1']);
  });

  it('chặn menu nhấn giữ, bôi đen, chạm đúp phóng to và cuộn khi chạm nút', () => {
    attach();
    const ctx = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    keyBtn('Z').dispatchEvent(ctx);
    expect(ctx.defaultPrevented).toBe(true);
    const sel = new Event('selectstart', { bubbles: true, cancelable: true });
    root.dispatchEvent(sel);
    expect(sel.defaultPrevented).toBe(true);
    const dbl = new MouseEvent('dblclick', { bubbles: true, cancelable: true });
    keyBtn('Z').dispatchEvent(dbl);
    expect(dbl.defaultPrevented).toBe(true);
    const touchOnButton = new Event('touchstart', { bubbles: true, cancelable: true });
    keyBtn('Z').dispatchEvent(touchOnButton);
    expect(touchOnButton.defaultPrevented).toBe(true);
    const touchOnPad = new Event('touchstart', { bubbles: true, cancelable: true });
    root.dispatchEvent(touchOnPad);
    expect(touchOnPad.defaultPrevented).toBe(false);
  });

  it('bàn phím trên nút chế độ (click detail 0) chốt chế độ; click chuột (detail 1) không lặp lại', () => {
    attach();
    modeBtn('left').dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 }));
    expect(latch.state.mode).toBe(-1);
    pointer('pointerdown', modeBtn('right'), { pointerType: 'mouse' });
    modeBtn('right').dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
    expect(latch.state.mode).toBe(1);
    expect(latchStates).toHaveLength(2);
  });

  it('rung nhẹ mỗi lần chạm khi bật; tắt / không hỗ trợ thì thôi', () => {
    const vibrate = vi.fn(() => true);
    Object.defineProperty(navigator, 'vibrate', { value: vibrate, configurable: true });
    try {
      attach();
      pointer('pointerdown', keyBtn('Z'));
      expect(vibrate).not.toHaveBeenCalled();
      vibrateOn = true;
      pointer('pointerdown', modeBtn('right'), { pointerId: 2 });
      pointer('pointerdown', keyBtn('X'), { pointerId: 3 });
      expect(vibrate).toHaveBeenCalledTimes(2);
      expect(vibrate).toHaveBeenCalledWith(PAD_VIBRATE_MS);
      vibrate.mockImplementation(() => {
        throw new Error('blocked');
      });
      expect(() => pointer('pointerdown', keyBtn('C'), { pointerId: 4 })).not.toThrow();
    } finally {
      Reflect.deleteProperty(navigator, 'vibrate');
    }
  });

  it('mất focus / tab ẩn → thả mọi ngón (chế độ đã chốt không mất)', () => {
    attach();
    pointer('pointerdown', modeBtn('right'));
    pointer('pointerdown', keyBtn('Z'), { pointerId: 2 });
    pointer('pointerdown', keyBtn('X'), { pointerId: 3 });
    window.dispatchEvent(new FocusEvent('blur'));
    expect(summary().filter((s) => s.startsWith('tap-up'))).toEqual([
      'tap-up Z 1 p2',
      'tap-up X 1 p3',
    ]);
    pointer('pointerdown', keyBtn('C'), { pointerId: 4 });
    const vis = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    vis.mockRestore();
    expect(summary().at(-1)).toBe('tap-up C 1 p4');
    expect(latch.state.mode).toBe(1);
  });

  it('cleanup gỡ mọi listener và thả ngón đang giữ', () => {
    const addRoot = vi.spyOn(root, 'addEventListener');
    const removeRoot = vi.spyOn(root, 'removeEventListener');
    const addWin = vi.spyOn(window, 'addEventListener');
    const removeWin = vi.spyOn(window, 'removeEventListener');
    const addDoc = vi.spyOn(document, 'addEventListener');
    const removeDoc = vi.spyOn(document, 'removeEventListener');
    attach();
    pointer('pointerdown', keyBtn('B'));
    detach?.();
    detach = null;
    expect(summary()).toEqual(['tap-down B 0 p1', 'tap-up B 0 p1']);
    const types = (spy: { mock: { calls: unknown[][] } }) =>
      spy.mock.calls.map((c) => String(c[0])).sort();
    expect(types(removeRoot)).toEqual(types(addRoot));
    expect(types(removeWin)).toEqual(types(addWin));
    expect(types(removeDoc)).toEqual(types(addDoc));
    // Không còn nhận gì.
    pointer('pointerdown', keyBtn('Z'));
    pointer('pointerdown', modeBtn('left'));
    expect(events).toHaveLength(2);
    expect(latch.state.mode).toBe(0);
  });
});

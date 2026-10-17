import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PracticeInputEvent } from './practice.types';
import { attachPracticeInput, isPracticeBlockedTarget } from './practiceInput';

let surface: HTMLDivElement;
let events: PracticeInputEvent[];
let detach: (() => void) | null;

const attach = () => {
  detach = attachPracticeInput({ window, surface }, { onEvent: (ev) => events.push(ev) });
  return detach;
};

beforeEach(() => {
  surface = document.createElement('div');
  document.body.appendChild(surface);
  events = [];
  detach = null;
});

afterEach(() => {
  detach?.();
  surface.remove();
  document.body.innerHTML = '';
});

// ── Phát sự kiện ──
function key(
  type: 'keydown' | 'keyup',
  code: string,
  init: KeyboardEventInit = {},
  target: EventTarget = window,
): KeyboardEvent {
  const e = new KeyboardEvent(type, {
    code,
    key: init.key ?? code,
    bubbles: true,
    cancelable: true,
    ...init,
  });
  target.dispatchEvent(e);
  return e;
}
const down = (code: string, init?: KeyboardEventInit, target?: EventTarget) =>
  key('keydown', code, init, target);
const up = (code: string, init?: KeyboardEventInit, target?: EventTarget) =>
  key('keyup', code, init, target);

function pointer(type: string, target: EventTarget, init: PointerEventInit = {}): PointerEvent {
  const e = new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    pointerType: 'mouse',
    ...init,
  });
  target.dispatchEvent(e);
  return e;
}
function mouse(type: string, target: EventTarget, init: MouseEventInit = {}): MouseEvent {
  const e = new MouseEvent(type, { bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(e);
  return e;
}

const summary = () =>
  events.map((e) => {
    if ('key' in e) return `${e.type} ${e.key}`;
    if ('modifier' in e) return `${e.type} ${e.modifier} ${e.source}`;
    return `${e.type} ${e.midi}`;
  });

describe('attachPracticeInput — phím nốt', () => {
  it('KeyZ … Comma → key-down / key-up, chặn mặc định, timeStamp của event', () => {
    attach();
    const codes = ['KeyZ', 'KeyX', 'KeyC', 'KeyV', 'KeyB', 'KeyN', 'KeyM', 'Comma'];
    const evs = codes.map((c) => down(c));
    expect(evs.every((e) => e.defaultPrevented)).toBe(true);
    expect(summary()).toEqual([
      'key-down Z',
      'key-down X',
      'key-down C',
      'key-down V',
      'key-down B',
      'key-down N',
      'key-down M',
      'key-down ,',
    ]);
    expect(events[0]).toEqual({
      type: 'key-down',
      key: 'Z',
      source: 'keyboard',
      timeStamp: evs[0].timeStamp,
    });
    events = [];
    const u = up('KeyZ');
    expect(u.defaultPrevented).toBe(true);
    expect(events).toEqual([
      { type: 'key-up', key: 'Z', source: 'keyboard', timeStamp: u.timeStamp },
    ]);
  });

  it('theo code, không theo ký tự (layout khác / Shift+Comma)', () => {
    attach();
    down('KeyZ', { key: 'y' });
    down('Comma', { key: '<', shiftKey: true });
    expect(summary()).toContain('key-down Z');
    expect(summary()).toContain('key-down ,');
  });

  it('bỏ qua auto-repeat và keydown lặp khi đang giữ (vẫn chặn mặc định)', () => {
    attach();
    down('KeyX');
    const rep = down('KeyX', { repeat: true });
    expect(rep.defaultPrevented).toBe(true);
    down('KeyX');
    expect(summary()).toEqual(['key-down X']);
    up('KeyX');
    down('KeyX');
    expect(summary()).toEqual(['key-down X', 'key-up X', 'key-down X']);
  });

  it('keyup không có keydown tương ứng → bỏ qua', () => {
    attach();
    const u = up('KeyZ');
    expect(events).toEqual([]);
    expect(u.defaultPrevented).toBe(false);
  });

  it('phím khác không phát gì và không bị chặn', () => {
    attach();
    expect(down('KeyQ').defaultPrevented).toBe(false);
    expect(down('Space', { key: ' ' }).defaultPrevented).toBe(false);
    expect(events).toEqual([]);
  });

  it('Cmd/Win / Ctrl / Alt + phím nốt: phím tắt của hệ điều hành / trình duyệt, không phải nốt', () => {
    attach();
    for (const init of [{ metaKey: true }, { ctrlKey: true }, { altKey: true }]) {
      const e = down('KeyC', init);
      expect(e.defaultPrevented).toBe(false);
    }
    expect(events).toEqual([]);
    // Shift + phím nốt vẫn là nốt (Shift không mở phím tắt nào)
    expect(down('KeyN', { shiftKey: true }).defaultPrevented).toBe(true);
    expect(summary()).toEqual(['key-down N']);
  });

  it('IME đang gõ → bỏ qua', () => {
    attach();
    down('KeyZ', { isComposing: true });
    expect(events).toEqual([]);
  });

  it('focus trong ô nhập chữ → bỏ qua; slider/checkbox vẫn nhận', () => {
    attach();
    const text = document.createElement('input');
    const area = document.createElement('textarea');
    const range = document.createElement('input');
    range.type = 'range';
    document.body.append(text, area, range);

    text.focus();
    expect(down('KeyZ', {}, text).defaultPrevented).toBe(false);
    area.focus();
    expect(down('KeyX', {}, area).defaultPrevented).toBe(false);
    expect(events).toEqual([]);

    range.focus();
    expect(down('KeyC', {}, range).defaultPrevented).toBe(true);
    expect(summary()).toEqual(['key-down C']);
  });

  it('nhả phím sau khi focus chuyển vào ô nhập vẫn phát key-up (không kẹt)', () => {
    attach();
    down('KeyZ');
    const text = document.createElement('input');
    document.body.append(text);
    text.focus();
    up('KeyZ', {}, text);
    expect(summary()).toEqual(['key-down Z', 'key-up Z']);
  });

  it('dialog aria-modal đang mở → bỏ qua', () => {
    attach();
    const dlg = document.createElement('div');
    dlg.setAttribute('aria-modal', 'true');
    const btn = document.createElement('button');
    dlg.append(btn);
    document.body.append(dlg);
    btn.focus();
    down('KeyZ', {}, btn);
    expect(events).toEqual([]);
  });
});

describe('attachPracticeInput — không có phím bàn phím thay chuột (góp ý 2026-10-15)', () => {
  it.each([
    ['ControlLeft', 'Control'],
    ['ControlRight', 'Control'],
    ['AltLeft', 'Alt'],
    ['ShiftLeft', 'Shift'],
    ['ShiftRight', 'Shift'],
    ['KeyQ', 'q'],
    ['KeyE', 'e'],
    ['KeyA', 'a'],
    ['KeyD', 'd'],
    ['Tab', 'Tab'],
    ['CapsLock', 'CapsLock'],
  ])('%s không phát modifier và không bị chặn', (code, k) => {
    attach();
    expect(down(code, { key: k }).defaultPrevented).toBe(false);
    expect(up(code, { key: k }).defaultPrevented).toBe(false);
    expect(events).toEqual([]);
  });

  it('modifier chỉ đến từ chuột: mọi mod-down / mod-up có source "mouse"', () => {
    attach();
    down('ControlLeft', { key: 'Control' });
    down('KeyZ');
    pointer('pointerdown', surface, { button: 2, buttons: 2 });
    pointer('pointerup', window, { button: 2, buttons: 0 });
    up('KeyZ');
    up('ControlLeft', { key: 'Control' });
    expect(summary()).toEqual([
      'key-down Z',
      'mod-down right mouse',
      'mod-up right mouse',
      'key-up Z',
    ]);
  });
});

describe('attachPracticeInput — chuột', () => {
  it('nút 0/2/1 trên surface → trái / phải / scroll (source mouse)', () => {
    attach();
    const p = pointer('pointerdown', surface, { button: 0, buttons: 1 });
    pointer('pointerup', surface, { button: 0, buttons: 0 });
    pointer('pointerdown', surface, { button: 2, buttons: 2 });
    pointer('pointerup', surface, { button: 2, buttons: 0 });
    pointer('pointerdown', surface, { button: 1, buttons: 4 });
    pointer('pointerup', surface, { button: 1, buttons: 0 });
    expect(summary()).toEqual([
      'mod-down left mouse',
      'mod-up left mouse',
      'mod-down right mouse',
      'mod-up right mouse',
      'mod-down scroll mouse',
      'mod-up scroll mouse',
    ]);
    expect(events[0]).toEqual({
      type: 'mod-down',
      modifier: 'left',
      source: 'mouse',
      timeStamp: p.timeStamp,
    });
  });

  it('chord: bấm thêm nút khi đang giữ (pointermove) → mod-down / mod-up riêng', () => {
    attach();
    pointer('pointerdown', surface, { button: 0, buttons: 1 });
    pointer('pointermove', window, { button: -1, buttons: 1 }); // di chuột: không đổi
    pointer('pointermove', surface, { button: 1, buttons: 5 }); // thêm giữa
    pointer('pointermove', document.body, { button: 1, buttons: 1 }); // nhả giữa (ngoài surface)
    pointer('pointerup', document.body, { button: 0, buttons: 0 });
    expect(summary()).toEqual([
      'mod-down left mouse',
      'mod-down scroll mouse',
      'mod-up scroll mouse',
      'mod-up left mouse',
    ]);
  });

  it('pointerdown thiếu bit trong buttons vẫn tính nút vừa bấm', () => {
    attach();
    pointer('pointerdown', surface, { button: 2, buttons: 0 });
    pointer('pointerup', window, { button: 2, buttons: 0 });
    expect(summary()).toEqual(['mod-down right mouse', 'mod-up right mouse']);
  });

  it('bấm ngoài surface, nút back/forward, touch → bỏ qua', () => {
    attach();
    pointer('pointerdown', document.body, { button: 0, buttons: 1 });
    pointer('pointermove', window, { button: 1, buttons: 5 });
    pointer('pointerup', window, { button: 0, buttons: 0 });
    pointer('pointerdown', surface, { button: 3, buttons: 8 });
    pointer('pointerdown', surface, { button: 0, buttons: 1, pointerType: 'touch' });
    expect(events).toEqual([]);
  });

  it('pointercancel thả hết nút chuột', () => {
    attach();
    pointer('pointerdown', surface, { button: 0, buttons: 1 });
    pointer('pointermove', surface, { button: 2, buttons: 3 });
    pointer('pointercancel', window, {});
    expect(summary()).toEqual([
      'mod-down left mouse',
      'mod-down right mouse',
      'mod-up left mouse',
      'mod-up right mouse',
    ]);
  });

  it('chặn contextmenu, auxclick và mousedown chuột giữa trên surface', () => {
    attach();
    expect(mouse('contextmenu', surface, { button: 2 }).defaultPrevented).toBe(true);
    expect(mouse('auxclick', surface, { button: 1 }).defaultPrevented).toBe(true);
    expect(mouse('mousedown', surface, { button: 1 }).defaultPrevented).toBe(true);
    expect(mouse('mousedown', surface, { button: 0 }).defaultPrevented).toBe(false);
    // Ngoài surface không bị chặn.
    expect(mouse('contextmenu', document.body, { button: 2 }).defaultPrevented).toBe(false);
    expect(mouse('auxclick', document.body, { button: 1 }).defaultPrevented).toBe(false);
  });

  it('chặn selectstart trên surface: bấm nhanh không bôi đen game bar', () => {
    attach();
    const lyric = document.createElement('p');
    surface.append(lyric);
    const sel = (t: EventTarget) => {
      const e = new Event('selectstart', { bubbles: true, cancelable: true });
      t.dispatchEvent(e);
      return e.defaultPrevented;
    };
    expect(sel(lyric)).toBe(true);
    expect(sel(document.body)).toBe(false);
  });

  it('chuột phải bấm trên surface, nhả chỗ khác: chặn đúng một contextmenu kế tiếp', () => {
    attach();
    pointer('pointerdown', surface, { button: 2, buttons: 2 });
    pointer('pointerup', document.body, { button: 2, buttons: 0 });
    expect(mouse('contextmenu', document.body, { button: 2 }).defaultPrevented).toBe(true);
    expect(mouse('contextmenu', document.body, { button: 2 }).defaultPrevented).toBe(false);
  });
});

describe('attachPracticeInput — mất focus', () => {
  it('window blur → thả mọi phím nốt và nút chuột', () => {
    attach();
    down('KeyZ');
    down('KeyX');
    pointer('pointerdown', surface, { button: 1, buttons: 4 });
    events = [];
    const blur = new FocusEvent('blur');
    window.dispatchEvent(blur);
    expect(summary()).toEqual(['key-up Z', 'key-up X', 'mod-up scroll mouse']);
    expect(events.every((e) => e.timeStamp === blur.timeStamp)).toBe(true);
    // Đã thả: keyup thật đến sau không phát lại.
    events = [];
    up('KeyZ');
    pointer('pointerup', window, { button: 1, buttons: 0 });
    expect(events).toEqual([]);
  });

  it('blur của element con (không phải window) không thả gì', () => {
    attach();
    down('KeyZ');
    const btn = document.createElement('button');
    document.body.append(btn);
    btn.dispatchEvent(new FocusEvent('blur'));
    expect(summary()).toEqual(['key-down Z']);
  });

  it('tab ẩn (visibilitychange hidden) → thả hết; visible → không làm gì', () => {
    attach();
    let state: DocumentVisibilityState = 'visible';
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
    try {
      down('KeyB');
      pointer('pointerdown', surface, { button: 0, buttons: 1 });
      document.dispatchEvent(new Event('visibilitychange'));
      expect(summary()).toEqual(['key-down B', 'mod-down left mouse']);
      state = 'hidden';
      document.dispatchEvent(new Event('visibilitychange'));
      expect(summary()).toEqual([
        'key-down B',
        'mod-down left mouse',
        'key-up B',
        'mod-up left mouse',
      ]);
    } finally {
      // Xóa thuộc tính riêng → về lại getter của Document.prototype.
      delete (document as unknown as Record<string, unknown>).visibilityState;
    }
  });
});

describe('attachPracticeInput — cleanup', () => {
  it('gỡ mọi listener: không phát sự kiện, không chặn mặc định', () => {
    const off = attach();
    off();
    detach = null;
    const evs: Event[] = [
      down('KeyZ'),
      down('ControlLeft', { key: 'Control' }),
      down('AltLeft', { key: 'Alt' }),
      up('AltLeft', { key: 'Alt' }),
      pointer('pointerdown', surface, { button: 0, buttons: 1 }),
      pointer('pointermove', window, { button: 1, buttons: 5 }),
      pointer('pointerup', window, { button: 0, buttons: 0 }),
      mouse('contextmenu', surface, { button: 2 }),
      mouse('auxclick', surface, { button: 1 }),
      mouse('mousedown', surface, { button: 1 }),
    ];
    window.dispatchEvent(new FocusEvent('blur'));
    expect(events).toEqual([]);
    expect(evs.some((e) => e.defaultPrevented)).toBe(false);
  });

  it('gỡ đúng các listener đã gắn (window, document, surface)', () => {
    const targets: [string, EventTarget][] = [
      ['win', window],
      ['doc', document],
      ['surface', surface],
    ];
    const spies = targets.map(([name, t]) => ({
      name,
      add: vi.spyOn(t, 'addEventListener'),
      rem: vi.spyOn(t, 'removeEventListener'),
    }));
    try {
      attach()();
      detach = null;
      for (const { name, add, rem } of spies) {
        // Cùng (type, listener, capture) → removeEventListener khớp đúng listener đã gắn.
        const key = (c: unknown[]) => {
          const opt = c[2];
          const cap =
            typeof opt === 'object' && opt !== null
              ? 'capture' in opt && opt.capture === true
              : opt === true;
          return [c[0], c[1], cap];
        };
        expect(rem.mock.calls.map(key), name).toEqual(add.mock.calls.map(key));
      }
      expect(spies[0].add.mock.calls.length).toBeGreaterThan(0);
      expect(spies[2].add.mock.calls.length).toBeGreaterThan(0);
    } finally {
      spies.forEach(({ add, rem }) => {
        add.mockRestore();
        rem.mockRestore();
      });
    }
  });
});

describe('isPracticeBlockedTarget', () => {
  it('ô gõ chữ, select, contenteditable, aria-modal → true; còn lại false', () => {
    const el = (html: string): Element => {
      const wrap = document.createElement('div');
      wrap.innerHTML = html;
      document.body.append(wrap);
      return wrap.querySelector('[data-t]') ?? wrap;
    };
    expect(isPracticeBlockedTarget(el('<input data-t>'))).toBe(true);
    expect(isPracticeBlockedTarget(el('<input data-t type="number">'))).toBe(true);
    expect(isPracticeBlockedTarget(el('<input data-t type="search">'))).toBe(true);
    expect(isPracticeBlockedTarget(el('<textarea data-t></textarea>'))).toBe(true);
    expect(isPracticeBlockedTarget(el('<select data-t></select>'))).toBe(true);
    expect(isPracticeBlockedTarget(el('<div contenteditable><b data-t>x</b></div>'))).toBe(true);
    expect(isPracticeBlockedTarget(el('<div aria-modal="true"><p data-t></p></div>'))).toBe(true);
    expect(isPracticeBlockedTarget(el('<input data-t type="range">'))).toBe(false);
    expect(isPracticeBlockedTarget(el('<input data-t type="checkbox">'))).toBe(false);
    expect(isPracticeBlockedTarget(el('<button data-t></button>'))).toBe(false);
    expect(isPracticeBlockedTarget(el('<div contenteditable="false"><b data-t>x</b></div>'))).toBe(
      false,
    );
    expect(isPracticeBlockedTarget(null)).toBe(false);
    expect(isPracticeBlockedTarget(window)).toBe(false);
  });
});

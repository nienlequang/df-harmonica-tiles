import { fireEvent, render, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HotkeyBindings, UseHotkeysOptions } from './useHotkeys';
import {
  PLAYER_HOTKEYS,
  RESERVED_NOTE_CODES,
  isEditableTarget,
  isReservedCode,
  reservedCodesIn,
  useHotkeys,
} from './useHotkeys';

afterEach(() => {
  vi.unstubAllEnvs();
});

interface Props {
  b: HotkeyBindings;
  o?: UseHotkeysOptions;
}

function setup(bindings: HotkeyBindings, opts?: UseHotkeysOptions) {
  const initialProps: Props = { b: bindings, o: opts };
  return renderHook(({ b, o }: Props) => useHotkeys(b, o), { initialProps });
}

describe('useHotkeys', () => {
  it('fires the binding for the matching KeyboardEvent.code', () => {
    const restart = vi.fn();
    const next = vi.fn();
    setup({ KeyR: restart, ArrowRight: next });
    fireEvent.keyDown(window, { code: 'KeyR', key: 'r' });
    expect(restart).toHaveBeenCalledTimes(1);
    expect(restart.mock.calls[0]?.[0]).toBeInstanceOf(KeyboardEvent);
    expect(next).not.toHaveBeenCalled();
    fireEvent.keyDown(document.body, { code: 'ArrowRight', key: 'ArrowRight' });
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('ignores unbound codes and undefined handlers', () => {
    const fn = vi.fn();
    setup({ KeyR: fn, KeyL: undefined });
    expect(fireEvent.keyDown(window, { code: 'KeyL' })).toBe(true); // không preventDefault
    expect(fireEvent.keyDown(window, { code: 'KeyQ' })).toBe(true);
    expect(fireEvent.keyDown(window, { code: 'toString' })).toBe(true);
    expect(fn).not.toHaveBeenCalled();
  });

  it.each([
    ['input', '<input type="text" />'],
    ['range input', '<input type="range" />'],
    ['textarea', '<textarea></textarea>'],
    ['select', '<select><option>a</option></select>'],
    ['contenteditable', '<div contenteditable="true"><span>x</span></div>'],
  ])('ignores keys typed in a %s', (_name, html) => {
    const fn = vi.fn();
    setup({ Space: fn, KeyR: fn });
    const { container } = render(<div dangerouslySetInnerHTML={{ __html: html }} />);
    const el = container.querySelector('input, textarea, select, span');
    expect(el).not.toBeNull();
    if (!(el instanceof HTMLElement)) return;
    el.focus();
    // Space trong ô nhập phải gõ được dấu cách → không preventDefault.
    expect(fireEvent.keyDown(el, { code: 'Space', key: ' ' })).toBe(true);
    expect(fireEvent.keyDown(el, { code: 'KeyR', key: 'r' })).toBe(true);
    expect(fn).not.toHaveBeenCalled();
  });

  it('contenteditable="false" inside is not treated as editable', () => {
    const { container } = render(<div contentEditable={false}>x</div>);
    expect(isEditableTarget(container.firstChild)).toBe(false);
    expect(isEditableTarget(window)).toBe(false);
    expect(isEditableTarget(null)).toBe(false);
  });

  it('Space on a focused button: preventDefault on keydown + keyup, handled once', () => {
    const toggle = vi.fn();
    const click = vi.fn();
    setup({ Space: toggle });
    const { getByRole } = render(
      <button type="button" onClick={click}>
        btn
      </button>,
    );
    const btn = getByRole('button');
    btn.focus();
    // fireEvent trả false khi event bị preventDefault.
    expect(fireEvent.keyDown(btn, { code: 'Space', key: ' ' })).toBe(false);
    expect(fireEvent.keyUp(btn, { code: 'Space', key: ' ' })).toBe(false);
    expect(toggle).toHaveBeenCalledTimes(1);
    expect(click).not.toHaveBeenCalled();
    // keyup không có keydown tương ứng thì không bị chặn.
    expect(fireEvent.keyUp(btn, { code: 'Space', key: ' ' })).toBe(true);
  });

  it('Space on a control focused BY KEYBOARD (Tab) activates the control, not the shortcut (R5)', () => {
    const toggle = vi.fn();
    setup({ Space: toggle, KeyR: vi.fn() });
    const { getByRole } = render(
      <div>
        <button type="button" aria-pressed="false">
          Mobile
        </button>
        <span role="switch" aria-checked="false" tabIndex={0}>
          sw
        </span>
        <a href="#x">link</a>
      </div>,
    );
    const btn = getByRole('button');
    // Tab → focus (bàn phím)
    fireEvent.keyDown(window, { code: 'Tab', key: 'Tab' });
    btn.focus();
    // không preventDefault → trình duyệt bấm nút (keyup); phím tắt không chạy
    expect(fireEvent.keyDown(btn, { code: 'Space', key: ' ' })).toBe(true);
    expect(fireEvent.keyUp(btn, { code: 'Space', key: ' ' })).toBe(true);
    expect(toggle).not.toHaveBeenCalled();
    // các phím tắt khác vẫn chạy trên nút đó
    expect(fireEvent.keyDown(btn, { code: 'KeyR', key: 'r' })).toBe(false);
    // role="switch" cũng vậy
    const sw = getByRole('switch');
    fireEvent.keyDown(window, { code: 'Tab', key: 'Tab' });
    sw.focus();
    expect(fireEvent.keyDown(sw, { code: 'Space', key: ' ' })).toBe(true);
    // link: Space không bấm link → vẫn là phím tắt
    const link = getByRole('link');
    fireEvent.keyDown(window, { code: 'Tab', key: 'Tab' });
    link.focus();
    expect(fireEvent.keyDown(link, { code: 'Space', key: ' ' })).toBe(false);
    expect(toggle).toHaveBeenCalledTimes(1);
  });

  it('Space on a control focused BY MOUSE stays the shortcut (D-033: click Play, then Space)', () => {
    const toggle = vi.fn();
    setup({ Space: toggle });
    const { getByRole } = render(<button type="button">btn</button>);
    const btn = getByRole('button');
    fireEvent.keyDown(window, { code: 'Tab', key: 'Tab' });
    fireEvent.mouseDown(btn);
    btn.focus();
    expect(fireEvent.keyDown(btn, { code: 'Space', key: ' ' })).toBe(false);
    expect(toggle).toHaveBeenCalledTimes(1);
    // Space đầu tiên (bàn phím) không đổi nguồn focus → lần sau vẫn là phím tắt
    fireEvent.keyUp(btn, { code: 'Space', key: ' ' });
    expect(fireEvent.keyDown(btn, { code: 'Space', key: ' ' })).toBe(false);
    expect(toggle).toHaveBeenCalledTimes(2);
  });

  it('ignores ctrl / meta / alt combos but allows shift', () => {
    const fn = vi.fn();
    setup({ KeyR: fn });
    fireEvent.keyDown(window, { code: 'KeyR', ctrlKey: true });
    fireEvent.keyDown(window, { code: 'KeyR', metaKey: true });
    fireEvent.keyDown(window, { code: 'KeyR', altKey: true });
    expect(fn).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { code: 'KeyR', shiftKey: true });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('ignores events already handled, IME composition, and focus inside a modal dialog', () => {
    const fn = vi.fn();
    setup({ KeyR: fn });
    const ev = new KeyboardEvent('keydown', { code: 'KeyR', bubbles: true, cancelable: true });
    ev.preventDefault();
    window.dispatchEvent(ev);
    fireEvent.keyDown(window, { code: 'KeyR', isComposing: true });
    const { getByRole } = render(
      <div role="dialog" aria-modal="true">
        <button type="button">ok</button>
      </div>,
    );
    const btn = getByRole('button');
    btn.focus();
    fireEvent.keyDown(btn, { code: 'KeyR' });
    expect(fn).not.toHaveBeenCalled();
  });

  it('ignores auto-repeat for toggle keys but still blocks the default action', () => {
    const toggle = vi.fn();
    const next = vi.fn();
    const bpmUp = vi.fn();
    setup({ Space: toggle, ArrowRight: next, BracketRight: bpmUp });
    expect(fireEvent.keyDown(window, { code: 'Space', repeat: true })).toBe(false);
    expect(toggle).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { code: 'ArrowRight', repeat: true });
    fireEvent.keyDown(window, { code: 'BracketRight', repeat: true });
    expect(next).toHaveBeenCalledTimes(1);
    expect(bpmUp).toHaveBeenCalledTimes(1);
  });

  it('repeatable codes are configurable', () => {
    const toggle = vi.fn();
    const next = vi.fn();
    setup({ Space: toggle, ArrowRight: next }, { repeatable: ['Space'] });
    fireEvent.keyDown(window, { code: 'Space', repeat: true });
    fireEvent.keyDown(window, { code: 'ArrowRight', repeat: true });
    expect(toggle).toHaveBeenCalledTimes(1);
    expect(next).not.toHaveBeenCalled();
  });

  it('refuses reserved note codes: throws in dev', () => {
    // React dev rethrow qua window "error" → jsdom in stack; chặn để log gọn.
    const swallow = (e: ErrorEvent) => e.preventDefault();
    window.addEventListener('error', swallow);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      for (const code of RESERVED_NOTE_CODES) {
        expect(() => setup({ [code]: vi.fn() })).toThrow(code);
      }
    } finally {
      window.removeEventListener('error', swallow);
    }
  });

  it('refuses reserved note codes: warns once and never fires in production', () => {
    vi.stubEnv('DEV', false);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const note = vi.fn();
    const restart = vi.fn();
    const { rerender } = setup({ KeyZ: note, Comma: note, KeyR: restart });
    rerender({ b: { KeyZ: note, Comma: note, KeyR: restart } });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain('KeyZ, Comma');
    expect(fireEvent.keyDown(window, { code: 'KeyZ' })).toBe(true);
    expect(fireEvent.keyDown(window, { code: 'Comma' })).toBe(true);
    expect(note).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { code: 'KeyR' });
    expect(restart).toHaveBeenCalledTimes(1);
  });

  it('removes its listeners on unmount', () => {
    const add = vi.spyOn(window, 'addEventListener');
    const remove = vi.spyOn(window, 'removeEventListener');
    const fn = vi.fn();
    const { unmount } = setup({ KeyR: fn });
    // phím tắt (bubble) + theo dõi nguồn focus (capture: pointerdown / mousedown / keydown)
    const added = add.mock.calls.filter(
      ([type, , opts]) => (type === 'keydown' || type === 'keyup') && opts !== true,
    );
    expect(added).toHaveLength(2);
    const capture = add.mock.calls.filter(([, , opts]) => opts === true);
    expect(capture.map(([type]) => type).sort()).toEqual(['keydown', 'mousedown', 'pointerdown']);
    unmount();
    for (const [type, listener] of added) {
      expect(remove).toHaveBeenCalledWith(type, listener);
    }
    for (const [type, listener] of capture) {
      expect(remove).toHaveBeenCalledWith(type, listener, true);
    }
    fireEvent.keyDown(window, { code: 'KeyR' });
    expect(fn).not.toHaveBeenCalled();
  });

  it('uses the latest bindings without re-subscribing', () => {
    const add = vi.spyOn(window, 'addEventListener');
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = setup({ KeyR: first });
    const countKeydown = () =>
      add.mock.calls.filter(([type, , opts]) => type === 'keydown' && opts !== true).length;
    expect(countKeydown()).toBe(1);
    rerender({ b: { KeyR: second } });
    rerender({ b: { KeyR: second } });
    expect(countKeydown()).toBe(1);
    fireEvent.keyDown(window, { code: 'KeyR' });
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('enabled=false detaches; re-enabling attaches again', () => {
    const fn = vi.fn();
    const { rerender } = setup({ KeyL: fn }, { enabled: false });
    fireEvent.keyDown(window, { code: 'KeyL' });
    expect(fn).not.toHaveBeenCalled();
    rerender({ b: { KeyL: fn }, o: { enabled: true } });
    fireEvent.keyDown(window, { code: 'KeyL' });
    expect(fn).toHaveBeenCalledTimes(1);
    rerender({ b: { KeyL: fn }, o: { enabled: false } });
    fireEvent.keyDown(window, { code: 'KeyL' });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('listens on a custom target window', () => {
    const fn = vi.fn();
    const add = vi.spyOn(window, 'addEventListener');
    setup({ KeyR: fn }, { target: window });
    expect(add).toHaveBeenCalledWith('keydown', expect.any(Function));
    fireEvent.keyDown(window, { code: 'KeyR' });
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe('helpers', () => {
  it('reserved codes are exactly the 8 note keys', () => {
    expect([...RESERVED_NOTE_CODES].sort()).toEqual(
      ['Comma', 'KeyB', 'KeyC', 'KeyM', 'KeyN', 'KeyV', 'KeyX', 'KeyZ'].sort(),
    );
    expect(isReservedCode('KeyZ')).toBe(true);
    expect(isReservedCode('KeyR')).toBe(false);
    expect(
      reservedCodesIn({ KeyZ: () => undefined, KeyX: undefined, KeyR: () => undefined }),
    ).toEqual(['KeyZ']);
  });

  it('player hotkeys never use a reserved note code', () => {
    for (const code of Object.values(PLAYER_HOTKEYS)) {
      expect(isReservedCode(code)).toBe(false);
    }
  });
});

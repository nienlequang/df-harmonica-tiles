import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useRoute } from '../ui/router';
import { installHashGuard, sameHash } from './hashGuard';

function setUrl(hash: string): void {
  window.history.replaceState(null, '', `/${hash}`);
}

let dispose: (() => void) | null = null;
const routerSpy = vi.fn();

beforeEach(() => {
  setUrl('#/edit/a');
  routerSpy.mockReset();
  // listener thường như router (useRoute): phải KHÔNG thấy sự kiện bị chặn
  window.addEventListener('hashchange', routerSpy);
  window.addEventListener('popstate', routerSpy);
});

afterEach(() => {
  dispose?.();
  dispose = null;
  window.removeEventListener('hashchange', routerSpy);
  window.removeEventListener('popstate', routerSpy);
  document.body.innerHTML = '';
});

function install(block: boolean | ((h: string) => boolean)) {
  const onBlocked = vi.fn();
  dispose = installHashGuard(window, {
    shouldBlock: typeof block === 'function' ? block : () => block,
    onBlocked,
  });
  return onBlocked;
}

/** Mô phỏng hash đổi (Back / gõ URL / navigate replace): URL đổi rồi phát sự kiện. */
function changeHash(hash: string, type: 'hashchange' | 'popstate' = 'hashchange') {
  window.history.replaceState(null, '', `/${hash}`);
  window.dispatchEvent(
    type === 'hashchange' ? new HashChangeEvent('hashchange') : new PopStateEvent('popstate'),
  );
}

describe('installHashGuard', () => {
  it('chặn hashchange: trả URL cũ, router không nhận, báo hash đích', () => {
    const onBlocked = install(true);
    changeHash('#/settings');
    expect(window.location.hash).toBe('#/edit/a');
    expect(onBlocked).toHaveBeenCalledWith('#/settings');
    expect(routerSpy).not.toHaveBeenCalled();
  });

  it('chặn popstate (Back) trước router; hashchange theo sau bị bỏ qua', () => {
    const onBlocked = install(true);
    changeHash('#/', 'popstate');
    expect(window.location.hash).toBe('#/edit/a');
    expect(onBlocked).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    expect(onBlocked).toHaveBeenCalledTimes(1);
    expect(routerSpy).toHaveBeenCalledTimes(1); // chỉ hashchange (URL không đổi) tới router
  });

  it('không chặn khi shouldBlock false; nhớ URL mới', () => {
    const onBlocked = install((h) => h !== '#/play/a');
    changeHash('#/play/a');
    expect(window.location.hash).toBe('#/play/a');
    expect(onBlocked).not.toHaveBeenCalled();
    expect(routerSpy).toHaveBeenCalledTimes(1);
    // URL hiện tại giờ là play → chặn lần sau trả về play
    changeHash('#/');
    expect(window.location.hash).toBe('#/play/a');
  });

  it('click link #/… cùng trang: preventDefault + báo, không đổi hash', () => {
    const onBlocked = install(true);
    document.body.innerHTML = '<a href="#/settings"><span>Cài đặt</span></a>';
    const span = document.querySelector('span')!;
    const ev = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
    span.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(onBlocked).toHaveBeenCalledWith('#/settings');
    expect(window.location.hash).toBe('#/edit/a');
  });

  it('click bỏ qua: link ngoài, cùng hash, phím bổ trợ, target _blank, khi không cần chặn', () => {
    const onBlocked = install((h) => h !== '#/ok');
    document.body.innerHTML = [
      '<a id="ext" href="https://example.com/#/x">x</a>',
      '<a id="same" href="#/edit/a">same</a>',
      '<a id="blank" href="#/y" target="_blank">blank</a>',
      '<a id="ok" href="#/ok">ok</a>',
      '<a id="mod" href="#/z">mod</a>',
    ].join('');
    const click = (id: string, init: MouseEventInit = {}) => {
      const ev = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ...init });
      // chặn điều hướng thật của jsdom sau khi guard đã xét
      document.addEventListener('click', (e) => e.preventDefault(), { once: true });
      document.getElementById(id)!.dispatchEvent(ev);
    };
    click('ext');
    click('same');
    click('blank');
    click('ok');
    click('mod', { ctrlKey: true });
    expect(onBlocked).not.toHaveBeenCalled();
  });

  it('dispose gỡ mọi listener', () => {
    const onBlocked = install(true);
    dispose?.();
    dispose = null;
    changeHash('#/settings');
    expect(window.location.hash).toBe('#/settings');
    expect(onBlocked).not.toHaveBeenCalled();
    expect(routerSpy).toHaveBeenCalledTimes(1);
  });
});

describe('installHashGuard + router thật (thứ tự listener kiểu Chromium)', () => {
  it('router đăng ký TRƯỚC guard vẫn không thấy Back bị chặn (interceptor)', () => {
    // Router đăng ký listener trước (vào Editor từ thư viện).
    const { result } = renderHook(() => useRoute());
    expect(result.current.route).toEqual({ name: 'edit', id: 'a' });
    // Chromium chạy listener ở window theo thứ tự đăng ký (capture không ưu tiên) → listener
    // capture của guard tới SAU router. Mô phỏng: bỏ hẳn listener capture, chỉ còn đường interceptor.
    const realAdd = window.addEventListener.bind(window);
    vi.spyOn(window, 'addEventListener').mockImplementation(((
      type: string,
      listener: EventListenerOrEventListenerObject,
      options?: boolean | AddEventListenerOptions,
    ) => {
      if ((type === 'popstate' || type === 'hashchange') && options === true) return;
      realAdd(type, listener, options);
    }) as typeof window.addEventListener);
    const onBlocked = install(true);
    vi.mocked(window.addEventListener).mockRestore();
    const later = vi.fn();
    window.addEventListener('popstate', later);
    act(() => {
      window.history.replaceState(null, '', '/#/');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(window.location.hash).toBe('#/edit/a');
    expect(onBlocked).toHaveBeenCalledTimes(1);
    expect(onBlocked).toHaveBeenCalledWith('#/');
    expect(later).not.toHaveBeenCalled(); // stopImmediatePropagation từ trong listener router
    expect(result.current.route).toEqual({ name: 'edit', id: 'a' });
    window.removeEventListener('popstate', later);
    // hashchange theo sau: URL đã khớp → không báo lần hai, route không đổi.
    act(() => {
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    expect(onBlocked).toHaveBeenCalledTimes(1);
    expect(result.current.route).toEqual({ name: 'edit', id: 'a' });
  });

  it('dispose gỡ cả interceptor của router', () => {
    const { result } = renderHook(() => useRoute());
    install(true);
    dispose?.();
    dispose = null;
    act(() => {
      window.history.replaceState(null, '', '/#/settings');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(result.current.route).toEqual({ name: 'settings' });
  });
});

describe('sameHash', () => {
  it('bỏ qua khác biệt percent-encoding', () => {
    expect(sameHash('#/play/%C4%91', '#/play/đ')).toBe(true);
    expect(sameHash('#/a', '#/b')).toBe(false);
    expect(sameHash('#/%E0%A4%A', '#/%E0%A4%A')).toBe(true);
  });
});

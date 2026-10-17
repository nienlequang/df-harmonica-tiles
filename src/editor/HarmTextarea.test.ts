import { afterEach, describe, expect, it, vi } from 'vitest';
import { moveCaret } from './HarmTextarea';

/** Textarea có "layout" giả (jsdom không tính layout): kích thước, vị trí, cuộn. */
function makeTextarea(value: string, rectTop: number) {
  const ta = document.createElement('textarea');
  ta.value = value;
  ta.style.font = '13px monospace';
  ta.style.fontSize = '13px';
  ta.style.lineHeight = '20px';
  ta.style.padding = '8px 10px';
  document.body.appendChild(ta);
  let scrollTop = 0;
  let scrollLeft = 0;
  Object.defineProperties(ta, {
    clientWidth: { configurable: true, get: () => 300 },
    clientHeight: { configurable: true, get: () => 100 },
    scrollTop: { configurable: true, get: () => scrollTop, set: (v: number) => (scrollTop = v) },
    scrollLeft: {
      configurable: true,
      get: () => scrollLeft,
      set: (v: number) => (scrollLeft = v),
    },
  });
  ta.getBoundingClientRect = () => new DOMRect(0, rectTop, 320, 120);
  return ta;
}

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('moveCaret', () => {
  it('cột ngoài bề rộng ô → cuộn ngang tới đó; về cột 0 → cuộn về đầu dòng', () => {
    const scrollBy = vi.spyOn(window, 'scrollBy').mockImplementation(() => {});
    const value = `ngắn\n${'x'.repeat(300)}Q`;
    const ta = makeTextarea(value, 200);
    const q = value.indexOf('Q');
    moveCaret(ta, q);
    expect(document.activeElement).toBe(ta);
    expect(ta.selectionStart).toBe(q);
    // jsdom không đo được font → ước lượng 0.6em = 7.8px; x = padding 10 + 300 cột
    const x = 10 + 300 * 7.8;
    expect(ta.scrollLeft).toBeGreaterThan(0);
    expect(x).toBeGreaterThanOrEqual(ta.scrollLeft);
    expect(x + 7.8).toBeLessThanOrEqual(ta.scrollLeft + 300);
    // dòng đang trong khung nhìn: không cuộn trang
    expect(scrollBy).not.toHaveBeenCalled();

    moveCaret(ta, value.indexOf('\n') + 1);
    expect(ta.scrollLeft).toBe(0);
  });

  it('ô soạn đã cuộn khỏi màn hình (bố cục một cột) → cuộn trang tới dòng đó', () => {
    const scrollBy = vi.spyOn(window, 'scrollBy').mockImplementation(() => {});
    const ta = makeTextarea('Z X\nC V\nB N', -500);
    moveCaret(ta, 4);
    expect(scrollBy).toHaveBeenCalledTimes(1);
    const arg = scrollBy.mock.calls[0]?.[0] as ScrollToOptions;
    // dòng 2: y = -500 + padding 8 + 20 → đưa về khoảng 1/3 khung nhìn
    const y = -500 + 8 + 20;
    expect(arg.top).toBeCloseTo(y - window.innerHeight / 3);
  });

  it('không có layout (ô ẩn / jsdom thật): chỉ đặt con trỏ, không cuộn trang', () => {
    const scrollBy = vi.spyOn(window, 'scrollBy').mockImplementation(() => {});
    const ta = document.createElement('textarea');
    ta.value = 'Z X C';
    document.body.appendChild(ta);
    moveCaret(ta, 2);
    expect(ta.selectionStart).toBe(2);
    expect(scrollBy).not.toHaveBeenCalled();
  });
});

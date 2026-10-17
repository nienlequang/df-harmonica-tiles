import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DOM_WARMUP_CLASS,
  DOM_WARMUP_MS,
  DOM_WARMUP_WAIT_MS,
  HOLD_BANNER_CLASS,
  LIT_KEYCAP_CLASS,
  LIT_MOD_CLASS,
  TILE_GLOW_BLUR,
  WARMUP_COLOR,
  drawWarmup,
  warmDomEffects,
  warmTileGlow,
  warmupShape,
} from './glowWarmup';
import type { WarmupContext } from './glowWarmup';
import { computeLayout } from './layout';
import type { LayoutOptions } from './layout';

const OPTS: LayoutOptions = {
  orientation: 'vertical',
  lookahead: 6,
  hitLinePos: 0.82,
  tileScale: 1,
  showRibbons: true,
  showSectionLabels: true,
};

/** Context giả ghi lại lệnh vẽ + trạng thái lúc fill. */
function fakeCtx(withRoundRect = true) {
  const log: string[] = [];
  const state = { globalAlpha: 0.3, fillStyle: '#fff', shadowColor: 'red', shadowBlur: 0 };
  let atFill: typeof state | null = null;
  const ctx = {
    ...state,
    save: () => log.push('save'),
    restore: () => log.push('restore'),
    setTransform: (...a: number[]) => log.push(`setTransform(${a.join(',')})`),
    beginPath: () => log.push('beginPath'),
    rect: (...a: number[]) => log.push(`rect(${a.map((v) => v.toFixed(1)).join(',')})`),
    fill: () => {
      log.push('fill');
      atFill = {
        globalAlpha: ctx.globalAlpha,
        fillStyle: ctx.fillStyle,
        shadowColor: ctx.shadowColor,
        shadowBlur: ctx.shadowBlur,
      };
    },
    ...(withRoundRect
      ? {
          roundRect: (...a: number[]) =>
            log.push(`roundRect(${a.map((v) => v.toFixed(1)).join(',')})`),
        }
      : {}),
  };
  return { ctx: ctx as unknown as WarmupContext, log, fillState: () => atFill };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('warmupShape', () => {
  it('tile ở lane đầu, trong vùng làn thấy được, bo góc 3 px × scale, blur 18 × scale như renderer', () => {
    const L = computeLayout(800, 600, OPTS);
    const s = warmupShape(L, 1600);
    expect(s).not.toBeNull();
    if (!s) return;
    expect(s.dpr).toBe(2);
    expect(s.blur).toBe(TILE_GLOW_BLUR * L.scale);
    expect(s.r).toBe(Math.max(2, Math.round(3 * L.scale)));
    const lane = L.lanes[0];
    expect(s.x).toBeGreaterThanOrEqual(lane.x);
    expect(s.x + s.w).toBeLessThanOrEqual(lane.x + lane.w + 1e-9);
    expect(s.y).toBeGreaterThanOrEqual(0);
    expect(s.y + s.h).toBeLessThan(L.hitPos);
  });

  it('bố cục bàn nút (pad): tile viên thuốc (bán kính = nửa bề rộng)', () => {
    const L = computeLayout(400, 700, { ...OPTS, lanePadding: 'pad', hitLinePos: 0.7 });
    expect(L.pad).not.toBeNull();
    const s = warmupShape(L, 400);
    expect(s?.r).toBeCloseTo((s?.w ?? 0) / 2, 9);
    expect(s?.dpr).toBe(1);
  });

  it('tileScale nhân blur; layout ngang dùng trục ngang', () => {
    const big = warmupShape(computeLayout(900, 500, { ...OPTS, tileScale: 1.5 }), 900);
    expect(big?.blur).toBeCloseTo(TILE_GLOW_BLUR * 1.5, 9);
    const L = computeLayout(1200, 300, { ...OPTS, orientation: 'horizontal', hitLinePos: 0.3 });
    const h = warmupShape(L, 1200);
    expect(h).not.toBeNull();
    expect((h?.w ?? 0) >= (h?.h ?? 0)).toBe(true);
  });
});

describe('drawWarmup', () => {
  it('vẽ một hình có shadowBlur, gần như trong suốt, trong save/restore và transform dpr', () => {
    const { ctx, log, fillState } = fakeCtx();
    drawWarmup(ctx, { x: 10, y: 4, w: 50, h: 40, r: 3, blur: 18, dpr: 2 });
    expect(log).toEqual([
      'save',
      'setTransform(2,0,0,2,0,0)',
      'beginPath',
      'roundRect(10.0,4.0,50.0,40.0,3.0)',
      'fill',
      'restore',
    ]);
    expect(fillState()).toEqual({
      globalAlpha: 1,
      fillStyle: WARMUP_COLOR,
      shadowColor: WARMUP_COLOR,
      shadowBlur: 18,
    });
  });

  it('không có roundRect (trình duyệt cũ) → rect', () => {
    const { ctx, log } = fakeCtx(false);
    drawWarmup(ctx, { x: 1, y: 2, w: 3, h: 4, r: 3, blur: 9, dpr: 1 });
    expect(log).toContain('rect(1.0,2.0,3.0,4.0)');
  });
});

describe('warmTileGlow', () => {
  it('canvas không có context (jsdom) / chưa có layout → false, không ném', () => {
    const canvas = document.createElement('canvas');
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => null);
    expect(warmTileGlow(canvas, null)).toBe(false);
    expect(warmTileGlow(canvas, computeLayout(300, 300, OPTS))).toBe(false);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => {
      throw new Error('lost');
    });
    expect(warmTileGlow(canvas, computeLayout(300, 300, OPTS))).toBe(false);
  });

  it('có context → vẽ lên chính canvas đó', () => {
    const { ctx, log } = fakeCtx();
    const canvas = document.createElement('canvas');
    canvas.width = 600;
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
      () => ctx as unknown as CanvasRenderingContext2D,
    );
    expect(warmTileGlow(canvas, computeLayout(300, 300, OPTS))).toBe(true);
    expect(log).toContain('fill');
    expect(log).toContain('setTransform(2,0,0,2,0,0)');
  });
});

describe('warmDomEffects (keycap sáng + banner "ĐANG GIỮ" THẬT — player.css, v1.0.1)', () => {
  /** Timer tay (ghi lại thời lượng xin của từng timer còn chờ). */
  function timers() {
    const pending = new Map<number, { fn: () => void; ms: number }>();
    let next = 1;
    return {
      set: (fn: () => void, ms: number) => {
        expect([DOM_WARMUP_MS, DOM_WARMUP_WAIT_MS]).toContain(ms);
        const id = next++;
        pending.set(id, { fn, ms });
        return id;
      },
      clear: (id: unknown) => {
        pending.delete(id as number);
      },
      run: () => {
        for (const [id, p] of Array.from(pending)) {
          pending.delete(id);
          p.fn();
        }
      },
      get size() {
        return pending.size;
      },
      /** Thời lượng (ms) của các timer còn chờ. */
      get waits() {
        return Array.from(pending.values(), (p) => p.ms);
      },
    };
  }

  /** `<link rel=stylesheet>` trong `<head>` với `.sheet` điều khiển được (jsdom không tải CSS). */
  function pendingLink(): { link: HTMLLinkElement; load: (ok?: boolean) => void } {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'data:text/css,';
    let sheet: object | null = null;
    Object.defineProperty(link, 'sheet', { configurable: true, get: () => sheet });
    document.head.append(link);
    return {
      link,
      load: (ok = true) => {
        if (ok) sheet = {};
        link.dispatchEvent(new Event(ok ? 'load' : 'error'));
      },
    };
  }

  afterEach(() => {
    for (const l of Array.from(document.head.querySelectorAll('link'))) l.remove();
  });

  /**
   * getComputedStyle giả (jsdom không đọc player.css): keycap làm nóng có `filter` = `filter`, kbd của nó có
   * `animation-name` = `animation`, `clip-path` = `clip`; banner làm nóng có `animation-name` = `banner`.
   */
  function stubCss(filter: string, animation = '', clip = '', banner = '') {
    const real = window.getComputedStyle.bind(window);
    vi.spyOn(window, 'getComputedStyle').mockImplementation((el: Element) => {
      const st = real(el);
      if (el.classList.contains(DOM_WARMUP_CLASS) && el.classList.contains('hold-banner')) {
        return { ...st, animationName: banner } as CSSStyleDeclaration;
      }
      if (el.classList.contains(DOM_WARMUP_CLASS)) {
        return { ...st, filter } as CSSStyleDeclaration;
      }
      if (el.parentElement?.classList.contains(DOM_WARMUP_CLASS)) {
        return { ...st, animationName: animation, clipPath: clip } as CSSStyleDeclaration;
      }
      return st;
    });
  }

  it('đặt một keycap sáng thật (đúng lớp + kbd.gb-cap) gần như trong suốt, ngoài truy vấn phím, rồi gỡ', () => {
    stubCss('drop-shadow(rgba(230, 233, 239, 0.45) 0px 0px 9px)', 'gb-press');
    const host = document.createElement('div');
    document.body.append(host);
    const t = timers();
    warmDomEffects(host, t.set, t.clear);
    const probe = host.querySelector<HTMLElement>(`.${DOM_WARMUP_CLASS}`);
    expect(probe).not.toBeNull();
    expect(probe?.parentElement).toBe(host);
    for (const c of LIT_KEYCAP_CLASS.split(' ')) expect(probe?.classList.contains(c)).toBe(true);
    expect(probe?.querySelector('kbd.gb-cap')?.textContent).toBe('Z');
    expect(probe?.getAttribute('aria-hidden')).toBe('true');
    // Không bao giờ bị nhầm là phím của game bar (truy vấn theo data-key / aria-current).
    expect(probe?.hasAttribute('data-key')).toBe(false);
    expect(probe?.hasAttribute('aria-current')).toBe(false);
    expect(Number(probe?.style.opacity)).toBeLessThan(0.05);
    expect(probe?.style.pointerEvents).toBe('none');
    t.run();
    expect(host.querySelector(`.${DOM_WARMUP_CLASS}`)).toBeNull();
    host.remove();
  });

  it('banner "ĐANG GIỮ …" thật (kiểu PC) cũng được đặt cùng lúc và gỡ cùng lúc', () => {
    stubCss('drop-shadow(rgb(0, 0, 0) 0px 0px 9px)', 'gb-press', '', 'hold-banner-in');
    const host = document.createElement('div');
    const t = timers();
    warmDomEffects(host, t.set, t.clear);
    expect(host.querySelectorAll(`.${DOM_WARMUP_CLASS}`)).toHaveLength(2);
    const banner = host.querySelector<HTMLElement>(`.hold-banner.${DOM_WARMUP_CLASS}`);
    for (const c of HOLD_BANNER_CLASS.split(' ')) expect(banner?.classList.contains(c)).toBe(true);
    expect(banner?.parentElement).toBe(host);
    expect(banner?.getAttribute('aria-hidden')).toBe('true');
    expect(banner?.hasAttribute('role')).toBe(false);
    expect(Number(banner?.style.opacity)).toBeLessThan(0.05);
    expect(t.size).toBe(1);
    t.run();
    expect(host.childElementCount).toBe(0);
  });

  it('nhãn modifier sáng thật (".gb-mod.is-active", có transition nền) cũng được đặt', () => {
    const real = window.getComputedStyle.bind(window);
    vi.spyOn(window, 'getComputedStyle').mockImplementation((el: Element) => {
      const st = real(el);
      return el.classList.contains(DOM_WARMUP_CLASS) && el.classList.contains('gb-mod')
        ? ({ ...st, transitionProperty: 'background' } as CSSStyleDeclaration)
        : st;
    });
    const host = document.createElement('div');
    const t = timers();
    const stop = warmDomEffects(host, t.set, t.clear);
    const probes = host.querySelectorAll(`.${DOM_WARMUP_CLASS}`);
    expect(probes).toHaveLength(1);
    for (const c of LIT_MOD_CLASS.split(' ')) expect(probes[0].classList.contains(c)).toBe(true);
    expect(probes[0].getAttribute('aria-hidden')).toBe('true');
    expect(probes[0].hasAttribute('data-mod')).toBe(false);
    stop();
    expect(host.childElementCount).toBe(0);
  });

  it('theme / bố cục không có filter (theme sáng, overlay…) nhưng còn hiệu ứng nhấn → vẫn làm nóng', () => {
    stubCss('none', 'gb-press', 'polygon(0px 0px, 50px 0px)');
    const host = document.createElement('div');
    const t = timers();
    const stop = warmDomEffects(host, t.set, t.clear);
    expect(host.querySelector(`.${DOM_WARMUP_CLASS}`)).not.toBeNull();
    stop();
    expect(host.querySelector(`.${DOM_WARMUP_CLASS}`)).toBeNull();
    expect(t.size).toBe(0);
  });

  it('gỡ sớm (detach) hủy timer', () => {
    stubCss('drop-shadow(rgb(0, 0, 0) 0px 0px 9px)');
    const host = document.createElement('div');
    const t = timers();
    const stop = warmDomEffects(host, t.set, t.clear);
    expect(host.querySelector(`.${DOM_WARMUP_CLASS}`)).not.toBeNull();
    stop();
    expect(host.querySelector(`.${DOM_WARMUP_CLASS}`)).toBeNull();
    expect(t.size).toBe(0);
  });

  it('không có CSS (jsdom: không filter / animation / clip-path) → gỡ ngay, không làm gì', () => {
    for (const v of ['none', '']) {
      vi.restoreAllMocks();
      stubCss(v, v, v);
      const host = document.createElement('div');
      const t = timers();
      warmDomEffects(host, t.set, t.clear)();
      expect(host.childElementCount).toBe(0);
      expect(t.size).toBe(0);
    }
  });

  // Cửa sổ nổi ở bản build (D-440): CSS chép sang document PiP còn đang tải lúc engine gắn.
  it('CSS chưa nạp xong (stylesheet đang tải) → chờ `load` rồi mới đặt; giữ DOM_WARMUP_MS rồi gỡ', () => {
    stubCss('none', 'none', 'none');
    const css = pendingLink();
    const host = document.createElement('div');
    const t = timers();
    const addSpy = vi.spyOn(css.link, 'addEventListener');
    warmDomEffects(host, t.set, t.clear);
    // Chưa có CSS: không đặt gì, chỉ chờ (một timer trần chờ).
    expect(host.childElementCount).toBe(0);
    expect(t.waits).toEqual([DOM_WARMUP_WAIT_MS]);
    expect(addSpy.mock.calls.map((c) => c[0]).sort()).toEqual(['error', 'load']);
    // CSS về: keycap thật có filter + hiệu ứng nhấn.
    vi.restoreAllMocks();
    stubCss('drop-shadow(rgb(0, 0, 0) 0px 0px 9px)', 'gb-press');
    const removed = vi.spyOn(css.link, 'removeEventListener');
    css.load();
    expect(host.querySelector(`.${DOM_WARMUP_CLASS}`)).not.toBeNull();
    // Thôi chờ (bỏ listener + timer trần), còn đúng timer gỡ.
    expect(removed.mock.calls.map((c) => c[0]).sort()).toEqual(['error', 'load']);
    expect(t.waits).toEqual([DOM_WARMUP_MS]);
    t.run();
    expect(host.childElementCount).toBe(0);
    expect(t.size).toBe(0);
  });

  it('stylesheet đã nạp sẵn (`.sheet` có) → không chờ; CSS lỗi / nạp xong mà vẫn không có hiệu ứng → thôi', () => {
    stubCss('none', 'none', 'none');
    const loaded = pendingLink();
    loaded.load();
    const host = document.createElement('div');
    const t = timers();
    warmDomEffects(host, t.set, t.clear);
    expect(t.size).toBe(0);
    expect(host.childElementCount).toBe(0);

    const failing = pendingLink();
    const t2 = timers();
    warmDomEffects(host, t2.set, t2.clear);
    expect(t2.waits).toEqual([DOM_WARMUP_WAIT_MS]);
    failing.load(false);
    // Link lỗi vẫn có `.sheet` null nhưng đã báo xong → hết thứ để chờ, không đặt gì.
    expect(t2.size).toBe(0);
    expect(host.childElementCount).toBe(0);
  });

  it('nhiều stylesheet: link đầu nạp xong chưa đủ → chờ tiếp link còn lại', () => {
    stubCss('none', 'none', 'none');
    const a = pendingLink();
    const b = pendingLink();
    const host = document.createElement('div');
    const t = timers();
    warmDomEffects(host, t.set, t.clear);
    a.load();
    expect(host.childElementCount).toBe(0);
    expect(t.waits).toEqual([DOM_WARMUP_WAIT_MS]);
    vi.restoreAllMocks();
    stubCss('drop-shadow(rgb(0, 0, 0) 0px 0px 9px)');
    b.load();
    expect(host.querySelector(`.${DOM_WARMUP_CLASS}`)).not.toBeNull();
    expect(t.waits).toEqual([DOM_WARMUP_MS]);
  });

  it('detach / quá DOM_WARMUP_WAIT_MS lúc đang chờ CSS → thôi chờ: CSS về sau cũng không đặt gì', () => {
    for (const how of ['detach', 'timeout'] as const) {
      vi.restoreAllMocks();
      stubCss('none', 'none', 'none');
      const css = pendingLink();
      const host = document.createElement('div');
      const t = timers();
      const stop = warmDomEffects(host, t.set, t.clear);
      const removed = vi.spyOn(css.link, 'removeEventListener');
      if (how === 'detach') stop();
      else t.run();
      expect(removed.mock.calls.map((c) => c[0]).sort()).toEqual(['error', 'load']);
      expect(t.size).toBe(0);
      vi.restoreAllMocks();
      stubCss('drop-shadow(rgb(0, 0, 0) 0px 0px 9px)');
      css.load();
      expect(host.childElementCount, how).toBe(0);
      expect(t.size).toBe(0);
      css.link.remove();
    }
  });
});

/**
 * "Làm nóng" glow của tile đang chạm hit line (vòng R7-3). Lần ĐẦU một canvas vẽ hình có `shadowBlur`, GPU
 * phải dựng shader / bảng blur cho kiểu blur đó — đo bằng Edge headless (CPU 4×, bản build): 80–280 ms không
 * có frame nào, đúng lúc nốt đầu tiên chạm hit line (Quốc ca: ~5 s sau khi ô bắt đầu rơi; trace: GPU
 * `RasterDecoderImpl::DoEndRasterCHROMIUM` + `FinishPaintRenderPass` ~100 ms liền), các nốt sau không còn.
 * Engine (PlayerEngine / OverlayEngine) gọi `warmTileGlow` một lần sau frame đầu, lúc ô còn đứng yên: vẽ một
 * hình cùng kiểu với tile đang sáng (chữ nhật bo góc 3 px × scale, hoặc viên thuốc ở bố cục bàn nút) với
 * cùng độ blur (18 × scale như renderer), gần như trong suốt (alpha 1/255 — không thấy trên nền nào) → lúc
 * chơi không còn chi phí lần đầu. Frame kế của renderer vẽ đè cả canvas.
 *
 * Keycap đang sáng của game bar PC (và banner "ĐANG GIỮ …") cũng tốn như vậy lần đầu: PlayerEngine và OverlayEngine
 * gọi `warmDomEffects` lúc attach (v1.0.1 — xem chú thích của hàm: làm nóng bằng keycap / banner THẬT, không chỉ ô
 * mang filter).
 *
 * Giữ khớp với `drawTileBodies` của renderer.ts (bán kính, độ blur): lệch cũng không sai hình — chỉ làm
 * nóng kém hơn.
 */
import type { Layout } from './layout';
import { PAD_DIGIT_RATIO, PAD_TILE_RATIO } from './layout';

/** Độ blur glow của tile đang chạm hit line (× layout.scale) — như renderer. */
export const TILE_GLOW_BLUR = 18;
/** Màu gần như trong suốt (1/255): GPU vẫn phải vẽ (không bị bỏ qua) nhưng mắt không thấy. */
export const WARMUP_COLOR = 'rgba(0, 0, 0, 0.004)';

export interface WarmupShape {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Bán kính bo góc (px CSS). */
  r: number;
  /** shadowBlur (px — canvas không nhân blur theo transform). */
  blur: number;
  /** Tỉ lệ px thiết bị / px CSS của canvas. */
  dpr: number;
}

/**
 * Hình dùng để làm nóng theo layout hiện tại: tile ở lane đầu, gần mép trên (vùng làn luôn thấy), cùng bán
 * kính bo góc và độ blur với tile đang sáng. null khi layout chưa có kích thước.
 */
export function warmupShape(L: Layout, canvasWidth: number): WarmupShape | null {
  if (!(L.width > 0) || !(L.height > 0) || !(L.laneCrossSize > 0)) return null;
  const s = L.scale > 0 ? L.scale : 1;
  const dpr = canvasWidth > 0 ? canvasWidth / L.width : 1;
  const lane = L.lanes[0];
  if (!lane) return null;
  const cross = L.laneCrossSize;
  const pill = L.pad !== null;
  const w = pill ? cross * PAD_DIGIT_RATIO * PAD_TILE_RATIO : Math.max(4, cross - 4);
  const h = Math.max(w, 28 * s);
  const r = pill ? Math.min(w, h) / 2 : Math.min(Math.max(2, Math.round(3 * s)), w / 4, h / 4);
  const vertical = L.orientation === 'vertical';
  return {
    x: vertical ? lane.x + (lane.w - w) / 2 : lane.x + 4,
    y: vertical ? lane.y + 4 : lane.y + (lane.h - w) / 2,
    w: vertical ? w : h,
    h: vertical ? h : w,
    r,
    blur: TILE_GLOW_BLUR * s,
    dpr,
  };
}

/** Phần CanvasRenderingContext2D dùng tới (test truyền object giả). */
export type WarmupContext = Pick<
  CanvasRenderingContext2D,
  | 'save'
  | 'restore'
  | 'setTransform'
  | 'beginPath'
  | 'rect'
  | 'fill'
  | 'globalAlpha'
  | 'fillStyle'
  | 'shadowColor'
  | 'shadowBlur'
> & { roundRect?: CanvasRenderingContext2D['roundRect'] };

/** Vẽ hình làm nóng lên `ctx` (giữ nguyên trạng thái ctx). */
export function drawWarmup(ctx: WarmupContext, shape: WarmupShape): void {
  ctx.save();
  try {
    ctx.setTransform(shape.dpr, 0, 0, shape.dpr, 0, 0);
    ctx.globalAlpha = 1;
    ctx.beginPath();
    if (typeof ctx.roundRect === 'function' && shape.r > 0.5) {
      ctx.roundRect(shape.x, shape.y, shape.w, shape.h, shape.r);
    } else {
      ctx.rect(shape.x, shape.y, shape.w, shape.h);
    }
    ctx.shadowColor = WARMUP_COLOR;
    ctx.shadowBlur = shape.blur;
    ctx.fillStyle = WARMUP_COLOR;
    ctx.fill();
  } finally {
    ctx.restore();
  }
}

/** Lớp keycap đang sáng (GameBar.tsx, kiểu PC) — `filter: drop-shadow(…)` + hiệu ứng nhấn (player.css). */
export const LIT_KEYCAP_CLASS = 'gb-key is-active gb-tone-normal';
/** Lớp của banner "ĐANG GIỮ …" kiểu PC (HoldBanner.tsx) — clip-path, nền sọc, hiệu ứng hiện `hold-banner-in`. */
export const HOLD_BANNER_CLASS = 'hold-banner hold-banner-right';
/** Lớp của nhãn modifier đang sáng ở game bar PC ("NGẨNG LÊN [chuột phải]" lúc giữ — GameBar.tsx). */
export const LIT_MOD_CLASS = 'gb-mod gb-mod-right is-active';
/** Lớp riêng của phần tử làm nóng (để nhận ra / loại trừ). */
export const DOM_WARMUP_CLASS = 'glow-warmup';
/**
 * Giữ phần tử làm nóng chừng này (ms): hiệu ứng nhấn `gb-press` (0,15 s) / hiện banner (0,12 s) chạy hết + vài khung
 * tĩnh được raster, kể cả khi máy chậm.
 */
export const DOM_WARMUP_MS = 700;
/**
 * Chờ stylesheet của document tối đa chừng này (ms) khi chưa phần tử thăm dò nào có CSS (Cửa sổ nổi: CSS chép sang
 * còn đang tải lúc engine gắn — `warmDomEffects`). Đủ cho mạng chậm; vẫn xong trước nốt đầu (đếm ngược của cửa sổ nổi
 * ≥ 3 s).
 */
export const DOM_WARMUP_WAIT_MS = 2000;

const hasEffect = (v: string | null | undefined): boolean => !!v && v !== 'none';

/** Kiểu chung của phần tử làm nóng: gần như trong suốt, không đọc / không bắt chuột, ở góc host. */
function probeBox(doc: Document, className: string, size: string): HTMLElement {
  const el = doc.createElement('div');
  el.className = `${className} ${DOM_WARMUP_CLASS}`;
  el.setAttribute('aria-hidden', 'true');
  el.style.cssText = `position:absolute;left:0;top:0;${size}opacity:0.01;pointer-events:none;`;
  return el;
}

interface Probe {
  el: HTMLElement;
  /** CSS thật đã áp (có filter / animation / clip-path)? Không (jsdom) → gỡ. */
  styled: (view: Window) => boolean;
}

/** Keycap sáng thật: `.gb-key.is-active.gb-tone-normal > kbd.gb-cap` có chữ. */
function keycapProbe(doc: Document): Probe {
  const el = probeBox(doc, LIT_KEYCAP_CLASS, 'width:56px;');
  const cap = doc.createElement('kbd');
  cap.className = 'gb-cap';
  cap.textContent = 'Z';
  el.append(cap);
  return {
    el,
    styled: (view) => {
      const capSt = view.getComputedStyle(cap);
      return (
        hasEffect(view.getComputedStyle(el).filter) ||
        hasEffect(capSt.animationName) ||
        hasEffect(capSt.clipPath)
      );
    },
  };
}

/** Banner "ĐANG GIỮ …" thật (kiểu PC): `.hold-banner.hold-banner-right > .hold-banner-text`. */
function bannerProbe(doc: Document): Probe {
  const el = probeBox(doc, HOLD_BANNER_CLASS, 'width:240px;height:42px;');
  const text = doc.createElement('span');
  text.className = 'hold-banner-text';
  text.textContent = 'R';
  el.append(text);
  return {
    el,
    styled: (view) => {
      const st = view.getComputedStyle(el);
      return hasEffect(st.animationName) || hasEffect(st.clipPath);
    },
  };
}

/** Nhãn modifier đang sáng thật (game bar PC): `.gb-mod.gb-mod-right.is-active > .gb-mod-name`. */
function modProbe(doc: Document): Probe {
  const el = probeBox(doc, LIT_MOD_CLASS, '');
  const name = doc.createElement('span');
  name.className = 'gb-mod-name';
  name.textContent = 'R';
  el.append(name);
  return {
    el,
    styled: (view) => {
      const st = view.getComputedStyle(el);
      return hasEffect(st.transitionProperty) && st.transitionProperty !== 'all';
    },
  };
}

/**
 * Làm nóng hiệu ứng DOM của lần chạm đầu (v1.0.1, góp ý "phím đầu chạm xuống thanh ngang vẫn bị khựng"). Trace CDP
 * (Edge headless, trình duyệt mới, CPU 4×, Quốc ca — keycap sáng lần đầu đúng lúc nốt đầu ở beat 2,75 chạm vạch): GPU
 * raster ô DOM chứa keycap 34–49 ms kèm biên dịch shader ANGLE 28–44 ms, rồi thêm 5–15 ms vài lần trong 150 ms hiệu
 * ứng nhấn → khung hở 36–88 ms; canvas thì không tốn gì (lệnh vẽ ~1 ms — `warmTileGlow` đã đủ). Thủ phạm là CẢ
 * `filter: drop-shadow` của cột phím LẪN hiệu ứng `gb-press` (scale + nền + viền, keycap cắt bằng clip-path): tắt
 * riêng từng cái vẫn còn raster dài + biên dịch, tắt cả hai (+ translateY) thì hết. Bản cũ (vòng 7) chỉ đặt một ô
 * 48 px mang filter — không làm nóng được đường raster của keycap thật. Banner "ĐANG GIỮ …" hiện lần đầu (Quốc ca:
 * beat 7) cũng khựng 52–88 ms cùng kiểu (clip-path + nền sọc + hiệu ứng hiện), cùng lúc nhãn modifier sáng lần đầu.
 *
 * Giờ: đặt một keycap sáng THẬT (đúng lớp `LIT_KEYCAP_CLASS` + `kbd.gb-cap` có chữ), một banner THẬT
 * (`HOLD_BANNER_CLASS`) và một nhãn modifier sáng THẬT (`LIT_MOD_CLASS`) — mang đúng filter, clip-path, nền và chạy đúng hiệu ứng của theme / bố cục hiện tại — gần như
 * trong suốt (opacity 0,01), `aria-hidden`, không `data-key` / `aria-current` / role, không bắt chuột, ở góc `host`
 * (con trực tiếp của host, ngoài `.game-bar` / `.mini-pad` / `.hold-banner-slot` nên không lọt vào truy vấn của chúng)
 * trong DOM_WARMUP_MS: GPU raster đủ mọi khung của hiệu ứng khi ô còn đứng yên. Phần tử nào không có CSS thật (jsdom,
 * bố cục không nạp CSS đó) → gỡ ngay. Trả hàm gỡ sớm (detach).
 *
 * CSS chưa nạp xong (v1.0.1, D-440): Cửa sổ nổi chép `<link rel=stylesheet>` của tab gốc sang document PiP
 * (pipDocument.ts) rồi mount ngay — ở bản build, PlayerEngine.attach chạy khi CSS còn đang tải (~40–70 ms), mọi phần tử
 * thăm dò đọc ra "không có CSS" và bị gỡ cùng mili-giây → cửa sổ nổi không được làm nóng gì. Giờ: không phần tử nào có
 * CSS mà document còn stylesheet chưa nạp (`link.sheet` null, chưa báo load / error) → chờ các `<link>` đó báo xong rồi
 * thử lại (tối đa DOM_WARMUP_WAIT_MS; detach / quá hạn → thôi, gỡ listener).
 */
export function warmDomEffects(
  host: HTMLElement,
  setTimer: (fn: () => void, ms: number) => unknown,
  clearTimer: (id: unknown) => void,
): () => void {
  const doc = host.ownerDocument;
  const view = doc.defaultView;
  if (!view || typeof view.getComputedStyle !== 'function') return () => {};
  let done = false;
  let placed: HTMLElement[] = [];
  let removeTimer: unknown = null;
  let waitTimer: unknown = null;
  let waiting: HTMLLinkElement[] = [];
  /** `<link>` đã báo load / error trong lượt chờ này (link lỗi vẫn có `.sheet` null — không chờ nó nữa). */
  const settled = new Set<HTMLLinkElement>();

  const stopWaiting = (): void => {
    if (waitTimer !== null) clearTimer(waitTimer);
    waitTimer = null;
    for (const link of waiting) {
      link.removeEventListener('load', onSheet);
      link.removeEventListener('error', onSheet);
    }
    waiting = [];
  };
  const finish = (): void => {
    done = true;
    stopWaiting();
    if (removeTimer !== null) clearTimer(removeTimer);
    removeTimer = null;
    for (const el of placed) el.remove();
    placed = [];
  };
  const tryPlace = (): boolean => {
    placed = placeProbes(host, doc, view);
    if (placed.length === 0) return false;
    removeTimer = setTimer(finish, DOM_WARMUP_MS);
    return true;
  };
  function onSheet(ev: Event): void {
    if (done) return;
    if (ev.currentTarget) settled.add(ev.currentTarget as HTMLLinkElement);
    if (tryPlace()) {
      stopWaiting();
      return;
    }
    // Hết stylesheet để chờ mà vẫn không có hiệu ứng (bố cục không dùng CSS đó) → thôi.
    if (pendingStylesheets(doc, settled).length === 0) finish();
  }

  if (tryPlace()) return finish;
  waiting = pendingStylesheets(doc, settled);
  if (waiting.length === 0) return () => {};
  for (const link of waiting) {
    link.addEventListener('load', onSheet);
    link.addEventListener('error', onSheet);
  }
  waitTimer = setTimer(finish, DOM_WARMUP_WAIT_MS);
  return finish;
}

/** Đặt các phần tử thăm dò vào `host`; giữ phần tử có CSS thật, gỡ ngay phần tử không có. */
function placeProbes(host: HTMLElement, doc: Document, view: Window): HTMLElement[] {
  const placed: HTMLElement[] = [];
  for (const make of [keycapProbe, bannerProbe, modProbe]) {
    let el: HTMLElement | null = null;
    try {
      const probe = make(doc);
      el = probe.el;
      host.append(el);
      if (probe.styled(view)) placed.push(el);
      else el.remove();
    } catch {
      el?.remove();
    }
  }
  return placed;
}

/** `<link rel=stylesheet>` của `doc` còn đang tải: chưa có `.sheet`, chưa bị tắt, chưa báo load / error. */
function pendingStylesheets(
  doc: Document,
  settled: ReadonlySet<HTMLLinkElement>,
): HTMLLinkElement[] {
  const out: HTMLLinkElement[] = [];
  for (const el of Array.from(doc.querySelectorAll('link'))) {
    const link = el as HTMLLinkElement;
    if (!/(^|\s)stylesheet(\s|$)/i.test(link.getAttribute('rel') ?? '')) continue;
    if (link.disabled || link.sheet || settled.has(link)) continue;
    out.push(link);
  }
  return out;
}

/**
 * Làm nóng glow trên canvas thật của renderer (cùng surface GPU). Trả true nếu đã vẽ. Lỗi (canvas giả của
 * jsdom, context mất…) → false, không ném.
 */
export function warmTileGlow(canvas: HTMLCanvasElement, L: Layout | null): boolean {
  if (!L) return false;
  const shape = warmupShape(L, canvas.width);
  if (!shape) return false;
  try {
    const ctx = canvas.getContext('2d');
    if (!ctx) return false;
    drawWarmup(ctx, shape);
    return true;
  } catch {
    return false;
  }
}

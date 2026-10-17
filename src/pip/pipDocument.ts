/**
 * Chuẩn bị document của "Cửa sổ nổi" (Document Picture-in-Picture): cửa sổ PiP mở ra với document
 * trống — không có CSS, theme hay ngôn ngữ của tab gốc. File này chép sang:
 * - mọi stylesheet của tab gốc: `<link rel=stylesheet>` → bản sao (href tuyệt đối); `<style>` và
 *   stylesheet dựng bằng JS (`adoptedStyleSheets`) → `<style>` chứa cssText; đọc cssRules bị chặn
 *   (cross-origin) thì dùng textContent / bỏ qua, không lỗi;
 * - CSS thêm / sửa về sau (chunk tải lười, HMR lúc dev) — MutationObserver trên `<head>` tab gốc;
 * - `data-theme` / `lang` của `<html>` (đổi theme / ngôn ngữ ở tab gốc → cửa sổ nổi đổi theo);
 * - `<base href>` = URL tab gốc để url() tương đối trong CSS và link vẫn đúng.
 */

/** Thuộc tính `<html>` của tab gốc được chép sang cửa sổ nổi. */
export const MIRRORED_ROOT_ATTRIBUTES: readonly string[] = ['data-theme', 'lang'];

/** Đánh dấu node do cửa sổ nổi chép sang (debug + test). */
export const COPIED_STYLE_ATTR = 'data-pip-copied';

const isStyleEl = (n: Node): n is HTMLStyleElement =>
  n.nodeType === 1 && (n as Element).tagName.toUpperCase() === 'STYLE';

const isStylesheetLink = (n: Node): n is HTMLLinkElement =>
  n.nodeType === 1 &&
  (n as Element).tagName.toUpperCase() === 'LINK' &&
  /(^|\s)stylesheet(\s|$)/i.test((n as Element).getAttribute('rel') ?? '');

/** cssText của cả stylesheet; null nếu không đọc được (cross-origin / chưa tải / không có). */
export function cssTextOf(
  sheet: Pick<CSSStyleSheet, 'cssRules'> | null | undefined,
): string | null {
  if (!sheet) return null;
  try {
    const rules = sheet.cssRules;
    if (!rules) return null;
    let out = '';
    for (let i = 0; i < rules.length; i++) {
      const r = rules[i];
      if (r) out += `${r.cssText}\n`;
    }
    return out;
  } catch {
    return null;
  }
}

/** Nội dung CSS của một `<style>`: theo CSSOM (kể cả rule chèn bằng insertRule), không thì text. */
function styleText(el: HTMLStyleElement): string {
  return cssTextOf(el.sheet) ?? el.textContent ?? '';
}

/** Bản sao của một node stylesheet trong `dst`; null nếu node không phải stylesheet. */
export function cloneStyleNode(node: Node, dst: Document): HTMLElement | null {
  if (isStylesheetLink(node)) {
    const link = dst.createElement('link');
    link.rel = 'stylesheet';
    // `.href` đã là URL tuyệt đối (document cửa sổ nổi có URL riêng).
    link.href = node.href || (node.getAttribute('href') ?? '');
    const media = node.getAttribute('media');
    if (media) link.setAttribute('media', media);
    const cors = node.getAttribute('crossorigin');
    if (cors !== null) link.setAttribute('crossorigin', cors);
    link.setAttribute(COPIED_STYLE_ATTR, '');
    return link;
  }
  if (isStyleEl(node)) {
    const style = dst.createElement('style');
    style.textContent = styleText(node);
    const media = node.getAttribute('media');
    if (media) style.setAttribute('media', media);
    style.setAttribute(COPIED_STYLE_ATTR, '');
    return style;
  }
  return null;
}

/** `<style>` cho các stylesheet dựng bằng JS (`document.adoptedStyleSheets`). */
function cloneAdopted(src: Document, dst: Document): HTMLStyleElement[] {
  let sheets: readonly CSSStyleSheet[] = [];
  try {
    const raw = (src as Document & { adoptedStyleSheets?: readonly CSSStyleSheet[] })
      .adoptedStyleSheets;
    if (Array.isArray(raw)) sheets = raw;
  } catch {
    sheets = [];
  }
  const out: HTMLStyleElement[] = [];
  for (const sheet of sheets) {
    const text = cssTextOf(sheet);
    if (text === null) continue;
    const style = dst.createElement('style');
    style.textContent = text;
    style.setAttribute(COPIED_STYLE_ATTR, 'adopted');
    out.push(style);
  }
  return out;
}

/** Node stylesheet của `src` theo thứ tự tài liệu (head trước, rồi body). */
function styleNodesOf(src: Document): Element[] {
  return Array.from(src.querySelectorAll('link[rel], style')).filter(
    (n) => isStylesheetLink(n) || isStyleEl(n),
  );
}

/** Chép thuộc tính theme / ngôn ngữ của `<html>`. */
export function mirrorRootAttributes(src: Document, dst: Document): void {
  const from = src.documentElement;
  const to = dst.documentElement;
  for (const name of MIRRORED_ROOT_ATTRIBUTES) {
    const v = from.getAttribute(name);
    if (v === null) to.removeAttribute(name);
    else if (to.getAttribute(name) !== v) to.setAttribute(name, v);
  }
}

/** `<base href>` = URL tab gốc (url() tương đối trong `<style>` chép sang vẫn trỏ đúng). */
function ensureBase(src: Document, dst: Document): void {
  const href = src.baseURI;
  if (!href || dst.head.querySelector('base')) return;
  const base = dst.createElement('base');
  base.href = href;
  dst.head.prepend(base);
}

function copyInto(src: Document, dst: Document, clones?: Map<Node, HTMLElement>): number {
  let n = 0;
  for (const node of styleNodesOf(src)) {
    const clone = cloneStyleNode(node, dst);
    if (!clone) continue;
    dst.head.append(clone);
    clones?.set(node, clone);
    n++;
  }
  for (const style of cloneAdopted(src, dst)) {
    dst.head.append(style);
    n++;
  }
  return n;
}

/** Chép một lần mọi stylesheet hiện có của `src` sang `<head>` của `dst`. Trả số node đã thêm. */
export function copyStyles(src: Document, dst: Document): number {
  return copyInto(src, dst);
}

/**
 * Dựng document cửa sổ nổi từ tab gốc và giữ đồng bộ: stylesheet (có / thêm / sửa / bỏ), theme,
 * ngôn ngữ. Trả hàm dừng đồng bộ (gỡ mọi MutationObserver).
 */
export function syncDocument(src: Document, dst: Document): () => void {
  ensureBase(src, dst);
  mirrorRootAttributes(src, dst);
  const clones = new Map<Node, HTMLElement>();
  copyInto(src, dst, clones);

  const observers: MutationObserver[] = [];
  const MO = typeof MutationObserver === 'function' ? MutationObserver : null;
  if (MO) {
    const attrs = new MO(() => mirrorRootAttributes(src, dst));
    attrs.observe(src.documentElement, {
      attributes: true,
      attributeFilter: [...MIRRORED_ROOT_ATTRIBUTES],
    });
    observers.push(attrs);

    const refresh = (styleEl: HTMLStyleElement): void => {
      const clone = clones.get(styleEl);
      if (clone) clone.textContent = styleText(styleEl);
    };
    const styles = new MO((records) => {
      for (const rec of records) {
        // Sửa nội dung `<style>` (Vite HMR thay textContent).
        const parent = rec.target.nodeType === 1 ? rec.target : rec.target.parentNode;
        if (parent && isStyleEl(parent) && clones.has(parent)) {
          refresh(parent);
          continue;
        }
        rec.addedNodes.forEach((node) => {
          if (clones.has(node)) return;
          const clone = cloneStyleNode(node, dst);
          if (!clone) return;
          dst.head.append(clone);
          clones.set(node, clone);
        });
        rec.removedNodes.forEach((node) => {
          const clone = clones.get(node);
          if (!clone) return;
          clone.remove();
          clones.delete(node);
        });
      }
    });
    styles.observe(src.head, { childList: true, subtree: true, characterData: true });
    observers.push(styles);
  }

  return () => {
    for (const o of observers) o.disconnect();
    observers.length = 0;
    clones.clear();
  };
}

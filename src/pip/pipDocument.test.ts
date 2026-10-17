import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  COPIED_STYLE_ATTR,
  cloneStyleNode,
  copyStyles,
  cssTextOf,
  mirrorRootAttributes,
  syncDocument,
} from './pipDocument';

/** MutationObserver gom record vào microtask → chờ một lượt. */
const flushMutations = () => new Promise<void>((r) => setTimeout(r, 0));

let added: Element[] = [];

function addToHead(el: Element): Element {
  document.head.append(el);
  added.push(el);
  return el;
}

function styleEl(css: string): HTMLStyleElement {
  const s = document.createElement('style');
  s.textContent = css;
  return s;
}

function linkEl(href: string, media?: string): HTMLLinkElement {
  const l = document.createElement('link');
  l.rel = 'stylesheet';
  l.href = href;
  if (media) l.media = media;
  return l;
}

let dst: Document;

beforeEach(() => {
  dst = document.implementation.createHTMLDocument('pip');
});

afterEach(() => {
  for (const el of added) el.remove();
  added = [];
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.setAttribute('lang', 'en');
  Reflect.deleteProperty(document, 'adoptedStyleSheets');
});

describe('copyStyles', () => {
  it('clones stylesheet links (absolute href, media) and inlines <style> as cssText', () => {
    addToHead(linkEl('/assets/app.css', 'screen'));
    addToHead(styleEl('.a { color: red; }'));
    addToHead(document.createElement('link')); // không phải stylesheet → bỏ qua
    const n = copyStyles(document, dst);
    expect(n).toBe(2);
    const nodes = Array.from(dst.head.querySelectorAll(`[${COPIED_STYLE_ATTR}]`));
    expect(nodes.map((x) => x.tagName)).toEqual(['LINK', 'STYLE']);
    const link = nodes[0] as HTMLLinkElement;
    expect(link.rel).toBe('stylesheet');
    expect(link.getAttribute('href')).toMatch(/^http:\/\/localhost(:\d+)?\/assets\/app\.css$/);
    expect(link.getAttribute('media')).toBe('screen');
    expect(nodes[1]?.textContent).toMatch(/\.a\s*\{\s*color:\s*red;?\s*\}/);
  });

  it('copies rules inserted through the CSSOM, not just the text', () => {
    const s = addToHead(styleEl('')) as HTMLStyleElement;
    s.sheet?.insertRule('.late { color: blue; }');
    copyStyles(document, dst);
    expect(dst.head.querySelector('style')?.textContent).toContain('.late');
  });

  it('turns constructed (adopted) stylesheets into <style>', () => {
    Object.defineProperty(document, 'adoptedStyleSheets', {
      configurable: true,
      value: [{ cssRules: [{ cssText: '.adopted { margin: 0px; }' }] }],
    });
    copyStyles(document, dst);
    const adopted = dst.head.querySelector(`style[${COPIED_STYLE_ATTR}="adopted"]`);
    expect(adopted?.textContent).toContain('.adopted');
  });

  it('guards cross-origin sheets (cssRules throws)', () => {
    const blocked = {
      get cssRules(): CSSRuleList {
        throw new DOMException('cross-origin', 'SecurityError');
      },
    };
    expect(cssTextOf(blocked)).toBeNull();
    Object.defineProperty(document, 'adoptedStyleSheets', {
      configurable: true,
      value: [blocked],
    });
    expect(() => copyStyles(document, dst)).not.toThrow();
    // <style> có sheet không đọc được → dùng textContent.
    const s = styleEl('.fallback { top: 0; }');
    Object.defineProperty(s, 'sheet', { value: blocked });
    expect(cloneStyleNode(s, dst)?.textContent).toBe('.fallback { top: 0; }');
  });
});

describe('mirrorRootAttributes', () => {
  it('copies data-theme and lang, removing what the source lacks', () => {
    document.documentElement.setAttribute('data-theme', 'light');
    document.documentElement.setAttribute('lang', 'vi');
    dst.documentElement.setAttribute('data-theme', 'dark');
    mirrorRootAttributes(document, dst);
    expect(dst.documentElement.getAttribute('data-theme')).toBe('light');
    expect(dst.documentElement.getAttribute('lang')).toBe('vi');
    document.documentElement.removeAttribute('data-theme');
    mirrorRootAttributes(document, dst);
    expect(dst.documentElement.hasAttribute('data-theme')).toBe(false);
  });
});

describe('syncDocument', () => {
  it('adds a <base> and follows later style / theme changes until stopped', async () => {
    const s = addToHead(styleEl('.one { color: red; }')) as HTMLStyleElement;
    const stop = syncDocument(document, dst);
    expect(dst.head.querySelector('base')?.getAttribute('href')).toBe(document.baseURI);
    expect(dst.head.querySelectorAll(`[${COPIED_STYLE_ATTR}]`)).toHaveLength(1);

    // CSS chunk tải lười.
    addToHead(styleEl('.two { color: green; }'));
    // HMR sửa nội dung style cũ.
    s.textContent = '.one { color: purple; }';
    // Theme đổi ở tab gốc.
    document.documentElement.setAttribute('data-theme', 'light');
    await flushMutations();
    const texts = Array.from(dst.head.querySelectorAll('style'), (x) => x.textContent ?? '');
    expect(texts.some((x) => x.includes('.two'))).toBe(true);
    expect(texts.some((x) => x.includes('purple'))).toBe(true);
    expect(dst.documentElement.getAttribute('data-theme')).toBe('light');

    // Gỡ style ở tab gốc → gỡ bản sao.
    s.remove();
    await flushMutations();
    expect(
      Array.from(dst.head.querySelectorAll('style')).some((x) => x.textContent?.includes('.one')),
    ).toBe(false);

    stop();
    addToHead(styleEl('.three { color: blue; }'));
    document.documentElement.setAttribute('data-theme', 'dark');
    await flushMutations();
    expect(
      Array.from(dst.head.querySelectorAll('style')).some((x) => x.textContent?.includes('.three')),
    ).toBe(false);
    expect(dst.documentElement.getAttribute('data-theme')).toBe('light');
  });
});

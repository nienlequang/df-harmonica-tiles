import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SETTINGS_STORAGE_KEY, useSettings } from './settings';

const here = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(join(here, rel), 'utf8');
const indexHtml = read('../../index.html');
const appCss = read('./app.css');

/**
 * Script inline trong index.html áp theme / lang đã lưu trước khung hình đầu (D-069).
 * Test chạy đúng đoạn script đó trên jsdom và kiểm nó khớp key + shape persist của settings.
 */
function bootScript(): string {
  const m = /<script>([\s\S]*?)<\/script>/.exec(indexHtml);
  if (!m?.[1]) throw new Error('index.html: không thấy script inline');
  return m[1];
}

function runBoot(): void {
  new Function(bootScript())();
}

function cssToken(selector: RegExp, name: string): string {
  const block = selector.exec(appCss)?.[1] ?? '';
  const m = new RegExp(`--${name}:\\s*([^;]+);`).exec(block);
  return (m?.[1] ?? '').trim();
}

const root = document.documentElement;
let meta: HTMLMetaElement;

beforeEach(() => {
  root.setAttribute('data-theme', 'dark');
  root.lang = 'vi';
  meta = document.createElement('meta');
  meta.name = 'theme-color';
  meta.content = '#0a0c0e';
  document.head.appendChild(meta);
});

afterEach(() => {
  meta.remove();
  useSettings.getState().reset();
});

describe('index.html boot script', () => {
  it('đọc đúng thứ settings store lưu (key + { state })', () => {
    useSettings.getState().set({ theme: 'light', language: 'en' });
    expect(localStorage.getItem(SETTINGS_STORAGE_KEY)).not.toBeNull();
    runBoot();
    expect(root.getAttribute('data-theme')).toBe('light');
    expect(root.lang).toBe('en');
    expect(meta.content).toBe(cssToken(/:root\[data-theme='light'\]\s*\{([^}]*)\}/, 'bg'));
  });

  it('màu theme-color khớp --bg của app.css', () => {
    const darkBg = cssToken(/:root\s*\{([^}]*)\}/, 'bg');
    const lightBg = cssToken(/:root\[data-theme='light'\]\s*\{([^}]*)\}/, 'bg');
    expect(darkBg).toMatch(/^#[0-9a-f]{6}$/i);
    expect(bootScript()).toContain(`'${lightBg}'`);
    expect(bootScript()).toContain(`'${darkBg}'`);
    expect(indexHtml).toContain(`<meta name="theme-color" content="${darkBg}" />`);
  });

  it('nền sớm (<style> inline, trước khi CSS bundle tải) khớp --bg và chừa overlay trong suốt', () => {
    const style = /<style>([\s\S]*?)<\/style>/.exec(indexHtml)?.[1] ?? '';
    const darkBg = cssToken(/:root\s*\{([^}]*)\}/, 'bg');
    const lightBg = cssToken(/:root\[data-theme='light'\]\s*\{([^}]*)\}/, 'bg');
    const dark = /html:not\(\.overlay-mode\)\s*\{([^}]*)\}/.exec(style)?.[1] ?? '';
    const light =
      /html\[data-theme='light'\]:not\(\.overlay-mode\)\s*\{([^}]*)\}/.exec(style)?.[1] ?? '';
    expect(dark).toContain(`background-color: ${darkBg};`);
    expect(light).toContain(`background-color: ${lightBg};`);
  });

  it('không có gì / JSON hỏng / giá trị lạ → giữ mặc định, không throw', () => {
    for (const raw of [null, '{oops', '{"state":{"theme":"neon","language":"fr"}}', '42']) {
      localStorage.clear();
      if (raw !== null) localStorage.setItem(SETTINGS_STORAGE_KEY, raw);
      expect(runBoot).not.toThrow();
      expect(root.getAttribute('data-theme'), String(raw)).toBe('dark');
      expect(root.lang).toBe('vi');
      expect(meta.content).toBe('#0a0c0e');
    }
  });
});

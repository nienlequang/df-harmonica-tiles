import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Bất biến giao diện "Tactical HUD" của Editor + Công cụ (docs/DESIGN.md) — đọc thẳng file CSS
 * (`?raw` của .css bị pipeline CSS của Vitest làm rỗng):
 * - ô soạn .harm và gutter số dòng cùng font / line-height / padding dọc (gutter thẳng hàng);
 * - chẩn đoán: lỗi = --danger, cảnh báo = --warn, ghi chú = muted (không bao giờ accent);
 * - accent xanh neon không tô chip nốt / keycap (gần màu tile Nửa Cung);
 * - số dòng màu danger / warn trên nền pha màu của gutter vẫn đạt AA ở cả hai theme.
 */

const here = dirname(fileURLToPath(import.meta.url));
const read = (rel: string): string =>
  readFileSync(join(here, rel), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const editorCss = read('editor.css');
const toolsCss = read('tools/tools.css');
const appCss = read('../ui/app.css');

interface Rule {
  selector: string;
  body: string;
}

/** Rule trong cùng (kể cả trong @media); selector đã gộp khoảng trắng. */
function rules(css: string): Rule[] {
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
    selector: (m[1] ?? '').replace(/\s+/g, ' ').trim(),
    body: m[2] ?? '',
  }));
}

/** Rule đầu tiên có đúng selector này (một selector, không phải danh sách). */
function rule(css: string, selector: string): string {
  const found = rules(css).find((r) => r.selector === selector);
  if (!found) throw new Error(`thiếu rule ${selector}`);
  return found.body;
}

function decl(body: string, prop: string): string | undefined {
  return new RegExp(`(?:^|[;\\s])${prop}\\s*:\\s*([^;]+);`).exec(body)?.[1]?.trim();
}

function paddingTop(body: string): string | undefined {
  const top = decl(body, 'padding-top');
  if (top) return top;
  return decl(body, 'padding')?.split(/\s+/)[0];
}

describe('editor.css — ô soạn + gutter', () => {
  it('gutter và textarea dùng cùng font shorthand, line-height và padding trên', () => {
    const gutter = rule(editorCss, '.harm-gutter');
    const textarea = rule(editorCss, '.harm-textarea');
    expect(decl(gutter, 'font')).toBe('13px / var(--harm-line) var(--font-mono)');
    expect(decl(textarea, 'font')).toBe(decl(gutter, 'font'));
    expect(paddingTop(textarea)).toBe(paddingTop(gutter));
    expect(decl(rule(editorCss, '.harm-gutter-line'), 'height')).toBe('var(--harm-line)');
    // Không rule nào khác đổi font / cỡ / line-height của cặp này (kể cả theo theme hay @media).
    for (const r of rules(editorCss)) {
      if (!/\.harm-(textarea|gutter)\b(?!-)/.test(r.selector)) continue;
      if (r.selector === '.harm-gutter' || r.selector === '.harm-textarea') continue;
      expect(r.body, r.selector).not.toMatch(/(^|[;\s])(font|font-size|line-height|padding)\s*:/);
    }
  });

  it('caret xanh neon trong ô soạn', () => {
    expect(decl(rule(editorCss, '.harm-textarea'), 'caret-color')).toBe('var(--accent)');
  });
});

describe('màu chẩn đoán', () => {
  const sev = [
    ['error', '--danger'],
    ['warning', '--warn'],
    ['info', '--text-muted'],
  ] as const;

  it.each(sev)('gutter + danh sách: %s → %s', (level, token) => {
    expect(decl(rule(editorCss, `.harm-gutter-line.is-${level}`), 'color')).toBe(`var(${token})`);
    expect(decl(rule(editorCss, `.pv-diag.is-${level}`), '--hud-sev')).toBe(`var(${token})`);
  });

  it('chẩn đoán không dùng accent', () => {
    for (const r of rules(editorCss)) {
      if (/harm-gutter-line|pv-diag/.test(r.selector)) {
        expect(r.body, r.selector).not.toContain('--accent');
      }
    }
  });
});

describe('accent không tô chip nốt / keycap', () => {
  it.each([
    ['editor.css', editorCss, /\.pv-(note|chip|rest|sharp)/],
    ['tools.css', toolsCss, /\.tap-key/],
  ] as const)('%s', (_name, css, pattern) => {
    const hits = rules(css).filter((r) => pattern.test(r.selector));
    expect(hits.length).toBeGreaterThan(0);
    for (const r of hits) expect(r.body, r.selector).not.toContain('--accent');
  });
});

describe('contrast số dòng trên nền pha màu của gutter (AA)', () => {
  function block(selector: RegExp): Record<string, string> {
    const body = selector.exec(appCss)?.[1] ?? '';
    const tokens: Record<string, string> = {};
    for (const m of body.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})\s*;/gi)) {
      if (m[1] && m[2]) tokens[m[1]] = m[2];
    }
    return tokens;
  }
  const dark = block(/:root\s*\{([^}]*)\}/);
  const light = { ...dark, ...block(/:root\[data-theme='light'\]\s*\{([^}]*)\}/) };

  const rgb = (hex: string): number[] => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const lum = (c: number[]): number => {
    const [r = 0, g = 0, b = 0] = c.map((v) => {
      const x = v / 255;
      return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const ratio = (a: number[], b: number[]): number => {
    const [x = 0, y = 0] = [lum(a), lum(b)].sort((m, n) => n - m);
    return (x + 0.05) / (y + 0.05);
  };

  it.each([
    ['error', 'danger'],
    ['warning', 'warn'],
  ] as const)('%s', (level, token) => {
    const bg = decl(rule(editorCss, `.harm-gutter-line.is-${level}`), 'background') ?? '';
    const m = /color-mix\(in srgb, var\(--([\w-]+)\) (\d+)%, var\(--([\w-]+)\)\)/.exec(bg);
    expect(m, bg).not.toBeNull();
    const [, fg, pct, base] = m ?? [];
    expect(fg).toBe(token);
    for (const theme of [dark, light]) {
      const p = Number(pct) / 100;
      const a = rgb(theme[fg ?? ''] ?? '');
      const b = rgb(theme[base ?? ''] ?? '');
      const mixed = a.map((v, i) => v * p + (b[i] ?? 0) * (1 - p));
      expect(ratio(a, mixed)).toBeGreaterThanOrEqual(4.5);
    }
  });
});

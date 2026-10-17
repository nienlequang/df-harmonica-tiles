import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { MOD_COLORS } from './palette';

// `?raw` của .css bị pipeline CSS của Vitest làm rỗng → đọc file trực tiếp.
const appCss = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'app.css'), 'utf8');

/**
 * Contrast AA của token màu trong app.css (spec §9, CLAUDE.md): đọc token của cả hai theme
 * và tính tỉ lệ WCAG, để sửa màu sau này không làm tụt dưới ngưỡng.
 */

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

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function ratio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

describe.each([
  ['dark', dark],
  ['light', light],
])('app.css %s theme', (_name, t) => {
  const get = (name: string): string => {
    const v = t[name];
    if (!v) throw new Error(`thiếu token --${name}`);
    return v;
  };

  it('placeholder (= --text-muted) trên nền ô nhập ≥ 4.5:1', () => {
    expect(ratio(get('text-muted'), get('surface-2'))).toBeGreaterThanOrEqual(4.5);
  });

  it('viền control ≥ 3:1 với mọi nền nó nằm trên (WCAG 1.4.11)', () => {
    for (const bg of ['bg', 'surface', 'surface-2']) {
      expect(ratio(get('control-border'), get(bg)), bg).toBeGreaterThanOrEqual(3);
    }
  });

  it('chữ --accent-text trên nền accent (nút primary, nút đang bật, cả lúc hover) ≥ 4.5:1', () => {
    for (const bg of ['accent', 'accent-strong']) {
      expect(ratio(get('accent-text'), get(bg)), bg).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('chữ thường / chữ phụ trên mọi nền ≥ 4.5:1', () => {
    for (const fg of ['text', 'text-muted']) {
      for (const bg of ['bg', 'surface', 'surface-2', 'surface-3', 'accent-dim']) {
        expect(ratio(get(fg), get(bg)), `${fg} / ${bg}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('chữ màu accent / danger / warn (link, số menu, tag [ MẪU ], lỗi, cảnh báo) ≥ 4.5:1', () => {
    for (const fg of ['accent', 'danger', 'warn']) {
      for (const bg of ['bg', 'surface', 'surface-2']) {
        expect(ratio(get(fg), get(bg)), `${fg} / ${bg}`).toBeGreaterThanOrEqual(4.5);
      }
    }
    // Nút danger khi hover, huy hiệu "Đang phát giai điệu".
    expect(ratio(get('danger'), get('danger-bg'))).toBeGreaterThanOrEqual(4.5);
    // Chip / banner cảnh báo nền hổ phách.
    expect(ratio(get('warn-text'), get('warn'))).toBeGreaterThanOrEqual(4.5);
  });

  it('focus ring và viền accent (toggle bật, nút hover) ≥ 3:1 với nền', () => {
    for (const bg of ['bg', 'surface', 'surface-2']) {
      expect(ratio(get('focus'), get(bg)), `focus / ${bg}`).toBeGreaterThanOrEqual(3);
    }
    expect(ratio(get('accent'), get('accent-dim'))).toBeGreaterThanOrEqual(3);
    // Chốt của toggle tắt (--text-muted) trên nền toggle (--surface-3).
    expect(ratio(get('text-muted'), get('surface-3'))).toBeGreaterThanOrEqual(3);
  });
});

describe('app.css tokens theo docs/DESIGN.md', () => {
  it('giá trị chính của theme tối và "Desert"', () => {
    expect(dark).toMatchObject({
      bg: '#0a0c0e',
      surface: '#11151a',
      'surface-2': '#171c22',
      'surface-3': '#1f262e',
      text: '#e9edf1',
      'text-muted': '#9aa5b1',
      accent: '#0ff796',
      'accent-strong': '#5dffb6',
      'accent-text': '#04130c',
      'accent-dim': '#0c2a1e',
      warn: '#f2c230',
      danger: '#ff5a4f',
      success: '#3fd07a',
      focus: '#0ff796',
      'control-border': '#64717e',
    });
    expect(light).toMatchObject({
      bg: '#e8e3d3',
      surface: '#f4f0e4',
      text: '#1b1e18',
      'text-muted': '#4b4f42',
      accent: '#006b44',
      'accent-text': '#ffffff',
      warn: '#7a5c00',
      'control-border': '#7f7862',
    });
  });

  it('màu modifier giữ nguyên palette.ts ở cả hai theme (accent không bao giờ tô tile)', () => {
    for (const t of [dark, light]) {
      for (const key of ['normal', 'left', 'right', 'scroll'] as const) {
        expect(t[`mod-${key}`], key).toBe(MOD_COLORS[key].fill);
        expect(t[`mod-${key}-text`], key).toBe(MOD_COLORS[key].text);
      }
      expect(t.accent).not.toBe(MOD_COLORS.scroll.fill);
    }
  });
});

describe('app.css rules', () => {
  it('scanline tĩnh ≤ 3% ở cả hai theme; có rule prefers-reduced-motion', () => {
    const alphas = [...appCss.matchAll(/--bg-scanline:\s*rgb\([^/]*\/\s*([\d.]+)\s*\)/g)].map((m) =>
      Number(m[1]),
    );
    expect(alphas).toHaveLength(2);
    for (const a of alphas) expect(a).toBeLessThanOrEqual(0.03);
    expect(appCss).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
  });

  it('có rule ::placeholder dùng --text-muted, opacity 1', () => {
    expect(appCss).toMatch(
      /::placeholder\s*\{[^}]*color:\s*var\(--text-muted\);[^}]*opacity:\s*1;/,
    );
  });

  it('nút đang bật (aria-pressed) khi hover giữ nền accent, không lấy --surface-3 của .btn:hover', () => {
    // `.btn:hover:not(:disabled)` (0,3,0) thắng `.btn[aria-pressed='true']` (0,2,0) → cần rule
    // riêng, specificity cao hơn, đặt nền accent-strong (chữ vẫn --accent-text).
    const rule =
      /\.btn\[aria-pressed='true'\]:hover:not\(:disabled\)\s*\{([^}]*)\}/.exec(appCss)?.[1] ?? '';
    expect(rule).toContain('background: var(--accent-strong)');
    expect(rule).toContain('color: var(--accent-text)');
  });

  it('toggle dạng grid: label dài xuống dòng cạnh switch, không tách khỏi switch', () => {
    const rule = /\.field-toggle\s*\{([^}]*)\}/.exec(appCss)?.[1] ?? '';
    expect(rule).toContain('display: grid');
    expect(rule).not.toContain('flex-wrap');
  });

  it('input / select / textarea và toggle dùng --control-border', () => {
    const fields = /select,\s*textarea\s*\{([^}]*)\}/.exec(appCss)?.[1] ?? '';
    expect(fields).toContain('border: 1px solid var(--control-border)');
    const toggle = /\.toggle\s*\{([^}]*)\}/.exec(appCss)?.[1] ?? '';
    expect(toggle).toContain('border: 1px solid var(--control-border)');
  });
});

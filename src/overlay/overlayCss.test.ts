import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Bất biến CSS của game bar trong overlay OBS (đọc thẳng file — `?raw` của .css bị pipeline CSS của
 * Vitest làm rỗng): panel luôn tối nên chữ luôn theo bộ màu tối ở mọi theme (AA), nút chế độ sắp chạm
 * là vòng đặc tĩnh (không animation lặp, không quầng bán trong suốt trên chroma).
 */

const here = dirname(fileURLToPath(import.meta.url));
const read = (rel: string): string =>
  readFileSync(join(here, rel), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

function rulesOf(css: string): { selector: string; body: string }[] {
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
    selector: (m[1] ?? '').replace(/\s+/g, ' ').trim(),
    body: m[2] ?? '',
  }));
}

const overlay = rulesOf(read('overlay.css'));
const playerCss = read('../player/player.css');
const player = rulesOf(playerCss);

function rule(list: { selector: string; body: string }[], selector: string): string {
  const found = list.find((r) => r.selector === selector);
  if (!found) throw new Error(`thiếu rule ${selector}`);
  return found.body;
}

function prop(body: string, name: string): string {
  const m = new RegExp(`(?:^|;)\\s*${name.replace(/[-]/g, '\\-')}\\s*:\\s*([^;]+)`).exec(body);
  if (!m) throw new Error(`thiếu ${name}`);
  return (m[1] ?? '').trim();
}

function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe('overlay.css — game bar', () => {
  it('chữ / viền / hổ phách của game bar theo bộ màu tối ở mọi theme (keycap tối)', () => {
    const pinned = rule(overlay, '.overlay .game-bar');
    const cap = prop(rule(overlay, '.overlay'), '--gb-cap');
    for (const name of ['--text', '--text-muted', '--warn']) {
      expect(contrast(prop(pinned, name), cap), name).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('theme sáng: bỏ ghi đè "nốt thường nền đậm" của Player bên trong overlay', () => {
    expect(rule(overlay, ":root[data-theme='light'] .overlay .gb-tone-normal kbd.gb-cap")).toMatch(
      /background:\s*var\(--mod-normal\)/,
    );
    const btn = rule(overlay, ":root[data-theme='light'] .overlay .gb-tone-normal .gbm-btn");
    expect(btn).toMatch(/background:\s*var\(--mod-normal\)/);
    expect(btn).toMatch(/box-shadow:\s*none/);
    expect(
      rule(
        overlay,
        ":root[data-theme='light'] .overlay .gbm-mode-natural.is-selected .gbm-mode-btn",
      ),
    ).toMatch(/background:\s*var\(--mod-normal\)/);
  });

  it('nút chế độ sắp chạm: vòng hổ phách tĩnh, màu đặc (kể cả nền chroma)', () => {
    const cue = rule(player, '.gbm-mode.is-cue .gbm-mode-btn');
    expect(cue).not.toMatch(/animation/);
    expect(prop(cue, 'box-shadow')).toBe('0 0 0 3px var(--warn)');
    expect(playerCss).not.toMatch(/@keyframes gbm-cue/);
    expect(
      prop(
        rule(overlay, 'html.overlay-bg-chroma .overlay .gbm-mode.is-cue .gbm-mode-btn'),
        'box-shadow',
      ),
    ).toBe('0 0 0 3px var(--warn)');
  });
});

describe('overlay.css — cửa sổ "Xem trước" (preview=1, R6)', () => {
  it('nền tối đặc cho html / body / #root (đè nền trong suốt của app.css, kể cả #root có id)', () => {
    const bg = rule(
      overlay,
      'html.overlay-mode.overlay-preview, html.overlay-mode.overlay-preview body, html.overlay-mode.overlay-preview #root',
    );
    const color = prop(bg, 'background');
    expect(color).toMatch(/^#[0-9a-f]{6}$/i);
    expect(luminance(color)).toBeLessThan(0.01);
  });

  it('bảng phím game minh họa: xám trung tính, KHÔNG accent (accent không bao giờ tô keycap)', () => {
    for (const sel of ['.overlay-preview-keyboard', '.overlay-preview-key']) {
      const body = rule(overlay, sel);
      expect(body, sel).not.toMatch(/--accent|#0ff796/i);
    }
    // Chữ keycap đọc được trên nền keycap (AA cho chữ đậm nhỏ).
    const key = rule(overlay, '.overlay-preview-key');
    expect(contrast(prop(key, 'color'), prop(key, 'background'))).toBeGreaterThanOrEqual(4.5);
  });

  it('không còn nút "Toàn màn hình" của Window Capture', () => {
    expect(overlay.some((r) => r.selector.includes('overlay-fullscreen'))).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import { MOD_COLORS } from '../ui/palette';
import {
  CANVAS_FONT_STACK,
  CANVAS_THEMES,
  OVERLAY_CANVAS_THEMES,
  blendOver,
  canvasFont,
  canvasThemeFor,
} from './canvasTheme';

/** #rrggbb hoặc rgba(r,g,b,a) → [r, g, b, a]. */
function parse(color: string): [number, number, number, number] {
  const hex = /^#([0-9a-f]{6})$/i.exec(color);
  if (hex) {
    const n = parseInt(hex[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1];
  }
  const m = /^rgba?\(([^)]+)\)$/.exec(color.replace(/\s/g, ''));
  if (!m) throw new Error(`màu lạ: ${color}`);
  const [r, g, b, a = 1] = m[1].split(',').map(Number);
  return [r, g, b, a];
}

/** Màu `fg` (có thể bán trong suốt) phủ lên nền đặc `bg` → #rrggbb. */
function over(fg: string, bg: string): string {
  const [r, g, b, a] = parse(fg);
  const [R, G, B] = parse(bg);
  const mix = (c: number, base: number) => Math.round(base + (c - base) * a);
  return (
    '#' + [mix(r, R), mix(g, G), mix(b, B)].map((v) => v.toString(16).padStart(2, '0')).join('')
  );
}

function luminance(color: string): number {
  const [r, g, b] = parse(color)
    .slice(0, 3)
    .map((v) => {
      const c = v / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function ratio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe('canvasTheme — contrast (AA)', () => {
  it.each(['dark', 'light'] as const)('%s: nhãn section ≥ 4.5:1 trên tag của nó', (name) => {
    const p = CANVAS_THEMES[name];
    const tag = over(p.sectionBg, over(p.laneFill, p.bg));
    expect(ratio(p.sectionText, tag)).toBeGreaterThanOrEqual(4.5);
  });

  it('light: viền tile ≥ 3:1 với nền và cả hai màu lane (mép tile mang thông tin trường độ)', () => {
    const p = CANVAS_THEMES.light;
    for (const stroke of Object.values(p.tileStroke)) {
      for (const bg of [p.bg, p.laneFill, p.laneFillAlt]) {
        expect(ratio(stroke, bg), `${stroke} / ${bg}`).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it.each(['dark', 'light'] as const)('%s: lõi hit line nổi trên lane (≥ 4.5:1)', (name) => {
    const p = CANVAS_THEMES[name];
    for (const lane of [p.laneFill, p.laneFillAlt]) {
      expect(ratio(p.hitLine, lane)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('chữ trên tile (màu modifier không đổi) ≥ 4.5:1', () => {
    for (const c of Object.values(MOD_COLORS)) {
      expect(ratio(c.text, c.fill)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it.each(['dark', 'light'] as const)(
    '%s: nét vòng "CHẠM" ≥ 3:1 với nền / lane và với viền của nó; chữ "CHẠM" ≥ 4.5:1 trên viền chữ',
    (name) => {
      const p = CANVAS_THEMES[name];
      for (const ring of Object.values(p.cueRing)) {
        for (const bg of [p.bg, p.laneFill, p.laneFillAlt]) {
          expect(ratio(ring, bg), `${ring} / ${bg}`).toBeGreaterThanOrEqual(3);
          // Viền hai bên nét (halo bán trong suốt trên nền) tách nét khỏi tile / nút / hình game.
          expect(ratio(ring, over(p.cueHalo, bg)), `${ring} / halo`).toBeGreaterThanOrEqual(3);
          expect(ratio(p.cueText, over(p.cueHalo, bg))).toBeGreaterThanOrEqual(4.5);
        }
      }
      // Viền chữ đủ đậm để chữ đọc được trên cả tile sáng nhất / tối nhất.
      for (const tile of [MOD_COLORS.normal.fill, MOD_COLORS.left.fill, '#000000', '#ffffff']) {
        expect(ratio(p.cueText, over(p.cueHalo, tile)), `${name} / ${tile}`).toBeGreaterThanOrEqual(
          4.5,
        );
      }
    },
  );

  it('overlay (hình game phía sau): vòng "CHẠM" như theme tối — nét sáng, viền tối, chữ trắng', () => {
    const p = OVERLAY_CANVAS_THEMES.transparent;
    expect(p.cueRing).toEqual(CANVAS_THEMES.dark.cueRing);
    expect(ratio(p.cueText, over(p.cueHalo, '#ffffff'))).toBeGreaterThanOrEqual(4.5);
    // Chroma: viền đặc (không bị key mất).
    expect(parse(OVERLAY_CANVAS_THEMES.chroma.cueHalo)[3]).toBe(1);
  });
});

describe('canvasTheme — chroma / overlay', () => {
  it('chroma: vạch lưới, nhãn section, hit line đều màu đặc; không glow', () => {
    const p = OVERLAY_CANVAS_THEMES.chroma;
    for (const c of [
      p.laneSeparator,
      p.barLine,
      p.beatLine,
      p.sectionLine,
      p.sectionBg,
      p.hitLine,
      p.hitGlow,
      p.loopLine,
    ]) {
      expect(parse(c)[3], c).toBe(1);
    }
    expect(p.hitGlowOuter).toBe('');
    expect(p.glow).toBe(false);
    expect(p.translucent).toBe(false);
    expect(canvasThemeFor('light', 'chroma')).toBe(p);
  });

  it('accent xanh neon chỉ ở glow hit line, không ở viền tile', () => {
    for (const p of [CANVAS_THEMES.dark, OVERLAY_CANVAS_THEMES.transparent]) {
      expect(p.hitGlow.replace(/\s/g, '')).toContain('15,247,150');
      for (const s of Object.values(p.tileStroke)) expect(s.toLowerCase()).not.toBe('#0ff796');
    }
  });

  it('blendOver: trộn màu lên nền đặc, alpha kẹp 0..1, màu lạ trả nguyên', () => {
    expect(blendOver('#2563eb', 1, '#000000')).toBe('rgb(37,99,235)');
    expect(blendOver('#2563eb', 0, '#000000')).toBe('rgb(0,0,0)');
    expect(blendOver('#ffffff', 0.5, '#000000')).toBe('rgb(128,128,128)');
    expect(blendOver('#ffffff', 2, '#000000')).toBe('rgb(255,255,255)');
    expect(blendOver('#204060', 0.5, 'bad')).toBe('rgb(16,32,48)');
    expect(blendOver('rgba(1,2,3,0.5)', 0.5, '#000000')).toBe('rgba(1,2,3,0.5)');
  });
});

describe('canvasFont', () => {
  it('font HUD (Bahnschrift…) condensed mặc định, độ rộng thường khi yêu cầu', () => {
    expect(CANVAS_FONT_STACK.startsWith('Bahnschrift')).toBe(true);
    expect(canvasFont(800, 28.4)).toBe(`800 condensed 28px ${CANVAS_FONT_STACK}`);
    expect(canvasFont(700, 12, 'normal')).toBe(`700 12px ${CANVAS_FONT_STACK}`);
  });
});

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Bất biến "Tactical HUD" (docs/DESIGN.md) của khối "Gửi thẳng vào OBS", đọc thẳng obsConnect.css:
 * màu chỉ từ token, cảnh báo = --warn, xong = --success, viền ô mật khẩu = --control-border (≥ 3:1),
 * accent chỉ ở số bước / caret / focus / mũi tên mục đang mở.
 */

const css = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'obsConnect.css'),
  'utf8',
).replace(/\/\*[\s\S]*?\*\//g, '');

const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
  selector: (m[1] ?? '').replace(/\s+/g, ' ').trim(),
  body: m[2] ?? '',
}));

function rule(selector: string): string {
  const found = rules.find((r) => r.selector === selector);
  if (!found) throw new Error(`thiếu rule ${selector}`);
  return found.body;
}

describe('obsConnect.css', () => {
  it('màu chỉ từ token (không mã màu cứng)', () => {
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i);
  });

  it('cảnh báo dùng --warn, kết nối / thêm xong dùng --success', () => {
    expect(rule('.obs-connect-msg-warn')).toMatch(/border-left-color:\s*var\(--warn\)/);
    expect(rule('.obs-connect-msg-ok')).toMatch(/color:\s*var\(--success\)/);
  });

  it('ô mật khẩu viền --control-border (app.css không định dạng input password)', () => {
    expect(rule(".obs-connect input[type='password']")).toMatch(
      /border:\s*1px solid var\(--control-border\)/,
    );
  });

  it('accent chỉ ở khung UI (số bước, caret, focus, mũi tên mục đang mở)', () => {
    const allowed = /::marker|:focus|\[open\] > summary::before|input\[type='password'\]$/;
    const withAccent = rules.filter((r) => r.body.includes('--accent'));
    expect(withAccent.length).toBeGreaterThan(0);
    for (const r of withAccent) expect(r.selector).toMatch(allowed);
  });
});

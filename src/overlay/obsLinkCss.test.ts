import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Bất biến giao diện "Tactical HUD" của hộp thoại "Tạo link OBS" (docs/DESIGN.md), đọc thẳng
 * obsLink.css (`?raw` của .css bị pipeline CSS của Vitest làm rỗng): cảnh báo = --warn, xong =
 * --success; accent chỉ ở số thứ tự section, lựa chọn đang chọn, số bước hướng dẫn, caret.
 */

const css = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'obsLink.css'),
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

describe('obsLink.css', () => {
  it('cảnh báo dùng --warn, thông báo xong dùng --success', () => {
    expect(rule('.obs-link-warn')).toMatch(/border-left-color:\s*var\(--warn\)/);
    expect(rule('.obs-link-ok')).toMatch(/color:\s*var\(--success\)/);
  });

  it('accent chỉ ở khung UI (số section, mục đang chọn, số bước, caret)', () => {
    const allowed = /::before|:has\(input:checked\)|::marker|textarea/;
    const withAccent = rules.filter((r) => r.body.includes('--accent'));
    expect(withAccent.length).toBeGreaterThan(0);
    for (const r of withAccent) expect(r.selector).toMatch(allowed);
  });

  it('section đánh số bằng counter, số là trang trí (alt rỗng)', () => {
    const numbered = rule('.obs-link-presets > legend::before, .obs-link-section > h3::before');
    expect(numbered).toContain("counter(obs-sec, decimal-leading-zero) ' /' / ''");
    expect(rule('.obs-link')).toContain('counter-reset: obs-sec');
  });
});

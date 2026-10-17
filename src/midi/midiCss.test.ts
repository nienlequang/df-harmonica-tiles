import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Bất biến giao diện "Tactical HUD" của "Tạo bài từ file" (docs/DESIGN.md), đọc thẳng midi.css
 * (`?raw` của .css bị pipeline CSS của Vitest làm rỗng): mức thông báo → màu, accent của stepper chỉ
 * ở bước đã xong / đang làm.
 */

const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'midi.css'), 'utf8').replace(
  /\/\*[\s\S]*?\*\//g,
  '',
);

const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
  selector: (m[1] ?? '').replace(/\s+/g, ' ').trim(),
  body: m[2] ?? '',
}));

function rule(selector: string): string {
  const found = rules.find((r) => r.selector === selector);
  if (!found) throw new Error(`thiếu rule ${selector}`);
  return found.body;
}

describe('midi.css', () => {
  it('thông báo: lỗi = --danger, cảnh báo = --warn, ghi chú = muted', () => {
    expect(rule('.midi-error')).toContain('var(--danger)');
    expect(rule('.midi-warning')).toMatch(/border-left-color:\s*var\(--warn\)/);
    expect(rule('.midi-notice')).toMatch(/border-left-color:\s*var\(--text-muted\)/);
    for (const sel of ['.midi-error', '.midi-warning', '.midi-notice']) {
      expect(rule(sel), sel).not.toContain('--accent');
    }
  });

  it('stepper: accent chỉ ở bước đã xong / đang làm (ô số chưa tới giữ viền control)', () => {
    expect(rule('.midi-step-num')).toContain('var(--control-border)');
    expect(rule('.midi-step-num')).not.toContain('--accent');
    expect(rule('.midi-steps li.is-current .midi-step-num')).toMatch(
      /background:\s*var\(--accent\)/,
    );
    expect(rule('.midi-steps li.is-done .midi-step-num')).toMatch(/color:\s*var\(--accent\)/);
    for (const r of rules) {
      if (!r.selector.startsWith('.midi-steps') || !r.body.includes('--accent')) continue;
      expect(r.selector).toMatch(/is-(done|current)/);
    }
  });
});

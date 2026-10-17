import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Bất biến CSS của bàn nút Mobile + chữ kết quả luyện tập (đọc thẳng file — `?raw` của .css bị pipeline CSS
 * của Vitest làm rỗng):
 * - Giảm chuyển động: app.css tắt MỌI animation bằng `* { animation: none !important }` → hiệu ứng một lần
 *   (kết quả, tia sáng, vòng "cần chạm", ping) phải khai báo lại shorthand có `!important` (selector lớp ưu
 *   tiên hơn `*`), không thì chúng đứng yên mãi trên màn (D-289: giảm chuyển động → chỉ mờ dần).
 * - Tương phản cao: nhãn trong nút chế độ đang chọn (nền Highlight, forced-color-adjust: none kế thừa) phải
 *   là HighlightText.
 */

const here = dirname(fileURLToPath(import.meta.url));
const read = (rel: string): string =>
  readFileSync(join(here, rel), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

/** Nội dung các khối `@media <query> { … }` (ghép lại), theo cặp ngoặc. */
function mediaBlocks(css: string, query: string): string {
  const out: string[] = [];
  let from = 0;
  for (;;) {
    const at = css.indexOf(`@media ${query}`, from);
    if (at < 0) break;
    const open = css.indexOf('{', at);
    let depth = 0;
    let i = open;
    for (; i < css.length; i++) {
      if (css[i] === '{') depth++;
      else if (css[i] === '}' && --depth === 0) break;
    }
    out.push(css.slice(open + 1, i));
    from = i + 1;
  }
  return out.join('\n');
}

function rulesOf(css: string): { selector: string; body: string }[] {
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
    selector: (m[1] ?? '').replace(/\s+/g, ' ').trim(),
    body: m[2] ?? '',
  }));
}

function ruleFor(css: string, selector: string): string {
  const found = rulesOf(css).find((r) => r.selector.split(/\s*,\s*/).includes(selector));
  if (!found) throw new Error(`thiếu rule ${selector}`);
  return found.body;
}

const pad = read('mobilePad.css');
const player = read('player.css');
const app = read('../ui/app.css');

describe('giảm chuyển động: hiệu ứng một lần vẫn mờ rồi tắt', () => {
  it('app.css tắt mọi animation bằng !important (lý do của các luật dưới)', () => {
    expect(ruleFor(mediaBlocks(app, '(prefers-reduced-motion: reduce)'), '*')).toMatch(
      /animation:\s*none\s*!important/,
    );
  });

  it.each(['.mpad-pop', '.mpad-spark', '.mpad-need-ring', '.mpad-ping'])(
    '%s: shorthand mpad-fade … forwards !important',
    (selector) => {
      const body = ruleFor(mediaBlocks(pad, '(prefers-reduced-motion: reduce)'), selector);
      expect(body).toMatch(/animation:\s*mpad-fade\s[^;]*forwards\s*!important/);
    },
  );

  it('.practice-flash (chữ kết quả lớn của bố cục PC): practice-flash-fade … !important', () => {
    const body = ruleFor(
      mediaBlocks(player, '(prefers-reduced-motion: reduce)'),
      '.practice-flash',
    );
    expect(body).toMatch(/animation:\s*practice-flash-fade\s[^;]*forwards\s*!important/);
  });
});

describe('tương phản cao: nhãn nút chế độ đang chọn', () => {
  it('nhãn trong hình tròn = HighlightText (!important, thắng màu theo chế độ)', () => {
    const forced = mediaBlocks(pad, '(forced-colors: active)');
    expect(
      ruleFor(forced, ".mpad[data-label='inside'] .gbm-mode.is-selected .mpad-mode-name"),
    ).toMatch(/color:\s*HighlightText\s*!important/);
    expect(ruleFor(forced, ".mpad[data-label='below'] .mpad-mode-name")).toMatch(
      /color:\s*CanvasText/,
    );
  });
});

describe('tên nút chế độ trong hình tròn', () => {
  it('không cắt giữa từ ("SEMITON / E"): chỉ xuống dòng ở dấu cách, từ dài thu chữ theo --mpad-name-ch', () => {
    const body = ruleFor(pad, ".mpad[data-label='inside'] .mpad-mode-name");
    expect(body).toMatch(/overflow-wrap:\s*normal/);
    expect(body).toMatch(/font-size:\s*min\(1em,[^;]*var\(--mpad-mode-d\)[^;]*--mpad-name-ch/);
  });
});

describe('lớp vòng "CHẠM" (vòng R7)', () => {
  it('phủ cả hộp canvas từ đáy bàn nút, không nhận chạm (chạm vẫn tới nút chế độ / nút số)', () => {
    const body = ruleFor(pad, '.mpad-cues');
    expect(body).toMatch(/position:\s*absolute/);
    expect(body).toMatch(/bottom:\s*0/);
    expect(body).toMatch(/height:\s*var\(--mpad-box-h/);
    expect(body).toMatch(/pointer-events:\s*none/);
  });
});

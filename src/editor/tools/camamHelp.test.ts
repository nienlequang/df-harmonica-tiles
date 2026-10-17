import { describe, expect, it } from 'vitest';
import readme from '../../../README.md?raw';
import { parseCamAm } from '../../core/camam';

/**
 * Ví dụ cảm âm viết thường (D-258): với quy ước mặc định (chữ thường / chữ hoa) chữ HOA là quãng 2, nên
 * ví dụ viết hoa sẽ dạy sai quãng. (Hộp thoại Nhập cảm âm và chuỗi trợ giúp của nó đã bỏ — góp ý
 * 2026-10-16: kết quả AI dán thẳng vào trang "Tạo bài với AI" / ô dán của Editor.)
 */
const midis = (text: string) =>
  parseCamAm(text, { convention: 'case' })
    .melody.sections.flatMap((s) => s.lines)
    .flatMap((l) => l.events)
    .map((e) => e.midi);

describe('ví dụ cảm âm (D-258)', () => {
  it('ví dụ viết thường nằm ở quãng 1 với quy ước mặc định; chữ HOA = quãng 2', () => {
    expect(midis('đô rê mi')).toEqual([60, 62, 64]);
    expect(midis('fa# sib')).toEqual([66, 70]);
    expect(midis('dola')).toEqual([60, 69]);
    expect(midis('Đô')).toEqual([72]);
  });

  it('README không có ví dụ cảm âm viết hoa', () => {
    expect(readme).not.toContain('(`Dola`)');
    expect(readme).not.toMatch(/\(`(?:Đô|Fa#|Sib)/);
  });
});

import { describe, expect, it } from 'vitest';
import { repoPath, resolveLink } from '../guide/guideContent';
import { collectTargets, headingIds } from '../guide/markdown';
import type { Block } from '../guide/markdown';
import { demoteHeadings, devContent, resolveDevLink } from './devContent';

const ROOT = 'https://app.example/';

function headings(blocks: readonly Block[]): Extract<Block, { type: 'heading' }>[] {
  return blocks.filter((b): b is Extract<Block, { type: 'heading' }> => b.type === 'heading');
}

describe('devContent (#/dev = REFERENCE + CHANGELOG)', () => {
  const c = devContent(ROOT);

  it('hai tài liệu, tiêu đề hạ một bậc (trang có h1 riêng), id không trùng giữa hai tài liệu', () => {
    const ref = headings(c.reference.blocks);
    const log = headings(c.changelog.blocks);
    expect(ref[0]).toMatchObject({ level: 2, id: c.reference.firstId });
    expect(c.reference.firstId).toMatch(/^tài-liệu-tham-khảo/);
    expect(log[0]).toMatchObject({ level: 2, id: 'changelog' });
    expect(c.changelog.firstId).toBe('changelog');
    expect([...ref, ...log].every((h) => h.level >= 2)).toBe(true);
    const ids = [...headingIds(c.reference.blocks), ...headingIds(c.changelog.blocks)];
    expect(new Set(ids).size).toBe(ids.length);
    expect(c.sections).toEqual(new Set(ids));
    // Nội dung tham khảo mà trang cần có.
    for (const id of [
      'định-dạng-harm-đầy-đủ',
      'thông-báo-lỗi-và-ý-nghĩa',
      'tham-số-url-của-overlay',
      'giới-hạn-đã-biết',
    ]) {
      expect(c.sections.has(id), id).toBe(true);
    }
  });

  it('token VERCEL_URL_TODO được thay bằng gốc app; cache theo gốc', () => {
    expect(JSON.stringify(c.reference.blocks)).not.toContain('VERCEL_URL_TODO');
    expect(devContent(ROOT)).toBe(c);
    expect(devContent('https://other.example/')).not.toBe(c);
  });

  it('mọi link #mục của REFERENCE / CHANGELOG trỏ tới một tiêu đề trên trang', () => {
    const links = [
      ...collectTargets(c.reference.blocks).links,
      ...collectTargets(c.changelog.blocks).links,
    ].filter((l) => l.startsWith('#'));
    expect(links.length).toBeGreaterThan(5);
    expect(links.filter((l) => resolveDevLink(l, c.sections).kind === 'text')).toEqual([]);
  });

  it('demoteHeadings: h1 → h2 … tối đa h6, cả trong trích dẫn / danh sách', () => {
    const h = (level: number): Block => ({ type: 'heading', level, id: 'x', children: [] });
    expect(
      demoteHeadings([
        h(1),
        h(6),
        { type: 'quote', children: [h(2)] },
        { type: 'list', ordered: false, start: 1, items: [[h(3)]] },
        { type: 'hr' },
      ]),
    ).toEqual([
      h(2),
      h(6),
      { type: 'quote', children: [h(3)] },
      { type: 'list', ordered: false, start: 1, items: [[h(4)]] },
      { type: 'hr' },
    ]);
  });
});

describe('resolveDevLink', () => {
  const sections = new Set(['tham-số-url-của-overlay']);

  it('#mục trên trang; mục không có → chữ thường', () => {
    expect(resolveDevLink('#tham-số-url-của-overlay', sections)).toEqual({
      kind: 'dev',
      section: 'tham-số-url-của-overlay',
    });
    expect(resolveDevLink('#tham-s%E1%BB%91-url-c%E1%BB%A7a-overlay', sections)).toEqual({
      kind: 'dev',
      section: 'tham-số-url-của-overlay',
    });
    expect(resolveDevLink('#khong-co', sections)).toEqual({ kind: 'text' });
    expect(resolveDevLink('REFERENCE.md#tham-số-url-của-overlay', sections)).toEqual({
      kind: 'dev',
      section: 'tham-số-url-của-overlay',
    });
    expect(resolveDevLink('./REFERENCE.md#khong-co', sections)).toEqual({ kind: 'text' });
  });

  it('link tương đối tính từ docs/: README / prompt AI → trang Hướng dẫn; file repo khác → chữ; https → tab mới', () => {
    expect(resolveDevLink('../README.md', sections)).toEqual({
      kind: 'guide',
      doc: 'readme',
      section: null,
    });
    expect(resolveDevLink('AI-PROMPT-CAM-AM.md#english-version', sections)).toEqual({
      kind: 'guide',
      doc: 'cam-am',
      section: 'english-version',
    });
    expect(resolveDevLink('DECISIONS.md', sections)).toEqual({ kind: 'text' });
    expect(resolveDevLink('../../ngoai-repo.md', sections)).toEqual({ kind: 'text' });
    expect(resolveDevLink('https://semver.org/', sections)).toEqual({
      kind: 'external',
      href: 'https://semver.org/',
    });
  });
});

describe('guideContent: repoPath / link tới REFERENCE', () => {
  it('repoPath chuẩn hóa ./ và ../; ra ngoài gốc repo → null', () => {
    expect(repoPath('../README.md', 'docs/')).toBe('README.md');
    expect(repoPath('./images/x.png', 'docs/')).toBe('docs/images/x.png');
    expect(repoPath('docs/REFERENCE.md')).toBe('docs/REFERENCE.md');
    expect(repoPath('../x.md')).toBeNull();
  });

  it('link docs/REFERENCE.md từ README → trang Dev notes', () => {
    expect(resolveLink('docs/REFERENCE.md', 'readme')).toEqual({ kind: 'dev', section: null });
    expect(resolveLink('docs/REFERENCE.md#giới-hạn-đã-biết', 'readme')).toEqual({
      kind: 'dev',
      section: 'giới-hạn-đã-biết',
    });
    // Tên thuộc tính của Object không phải tài liệu.
    expect(resolveLink('constructor', 'readme')).toEqual({ kind: 'text' });
  });
});

import { describe, expect, it } from 'vitest';
import camamRaw from '../../docs/AI-PROMPT-CAM-AM.md?raw';
import readmeRaw from '../../README.md?raw';
import { AI_GUIDE_SECTION } from '../editor/aiPrompt';
import type { GuideDoc } from '../ui/router';
import {
  USER_PART_END,
  guideBlocks,
  guideSections,
  resolveImage,
  resolveLink,
  userPart,
  withAppUrl,
} from './guideContent';
import { collectTargets, headingIds, parseMarkdown } from './markdown';

const ROOT = 'https://app.example/';
const DOCS: readonly GuideDoc[] = ['readme', 'cam-am'];

describe('userPart / withAppUrl', () => {
  it('cắt từ tiêu đề phần người phát triển; không có thì giữ cả tài liệu', () => {
    expect(userPart('# A\nx\n## Cho người phát triển\ny', USER_PART_END.readme)).toBe('# A\nx');
    expect(userPart('a\r\nb', '## X')).toBe('a\nb');
  });

  it('thay token VERCEL_URL_TODO bằng gốc app đang mở', () => {
    const md =
      '**https://VERCEL_URL_TODO** _(link Vercel — cập nhật sau khi deploy)_ — x\n' +
      '`https://VERCEL_URL_TODO/#/s/…` `https://VERCEL_URL_TODO/?overlay=1`';
    expect(withAppUrl(md, 'https://app.example/')).toBe(
      '**https://app.example** — x\n`https://app.example/#/s/…` `https://app.example/?overlay=1`',
    );
    expect(withAppUrl(md, 'https://h.example/sub')).toContain('`https://h.example/sub/#/s/…`');
    // Bản 1 file: file:///…/index.html#/s/… (không chèn "/" sau index.html).
    expect(withAppUrl(md, 'file:///C:/x/index.html')).toContain('`file:///C:/x/index.html#/s/…`');
  });
});

describe('nội dung trang Hướng dẫn (D-257, D-260)', () => {
  it.each(DOCS)(
    '%s: phần người dùng không có phần người phát triển, không còn token Vercel',
    (doc) => {
      const blocks = guideBlocks(doc, ROOT);
      const ids = headingIds(blocks);
      expect(ids.length).toBeGreaterThan(3);
      expect(ids).not.toContain('cho-người-phát-triển');
      expect(ids).not.toContain('ghi-chú-cho-người-phát-triển');
      expect(JSON.stringify(blocks)).not.toContain('VERCEL_URL_TODO');
    },
  );

  it.each(DOCS)('%s: mọi link / ảnh của phần người dùng đều mở được trong bản web', (doc) => {
    const { links, images } = collectTargets(guideBlocks(doc, ROOT));
    const bad: string[] = [];
    for (const l of links) {
      const to = resolveLink(l, doc);
      // Link tới mục đã cắt (TOC "Cho người phát triển") được phép thành chữ; file repo thì không.
      if (to.kind === 'text' && !/^#cho-người-phát-triển$/.test(l)) bad.push(`không mở được: ${l}`);
    }
    for (const src of images) if (resolveImage(src) === null) bad.push(`thiếu ảnh: ${src}`);
    expect(bad).toEqual([]);
    expect(links.some((l) => /TAURI\.md|CLAUDE\.md|SPEC\.md|DECISIONS\.md/.test(l))).toBe(false);
  });

  it('README đầy đủ: mọi link #mục đều có tiêu đề (cả phần người phát triển)', () => {
    const blocks = parseMarkdown(readmeRaw);
    const ids = new Set(headingIds(blocks));
    const missing = collectTargets(blocks)
      .links.filter((l) => l.startsWith('#'))
      .filter((l) => !ids.has(decodeURIComponent(l.slice(1))));
    expect(missing).toEqual([]);
  });

  it('các mục mà app link tới đều tồn tại', () => {
    const readme = guideSections('readme');
    const camam = guideSections('cam-am');
    // Thư viện → "Cú pháp .harm"; trang "Tạo bài với AI" → "Tìm nguồn ở đâu" (vi / en).
    expect(readme.has('cú-pháp-harm')).toBe(true);
    expect(camam.has(AI_GUIDE_SECTION.vi)).toBe(true);
    expect(camam.has(AI_GUIDE_SECTION.en)).toBe(true);
    expect(camam.has('english-version')).toBe(true);
    // Tài liệu nguồn đúng là hai file này.
    expect(camamRaw).toContain('### Tìm nguồn ở đâu');
  });

  it('resolveLink: mục, file tài liệu, trang ngoài, file repo', () => {
    expect(resolveLink('#chia-sẻ-link', 'readme')).toEqual({
      kind: 'guide',
      doc: 'readme',
      section: 'chia-sẻ-link',
    });
    expect(resolveLink('#ch%C3%ACa-kh%C3%B4ng-c%C3%B3', 'readme')).toEqual({ kind: 'text' });
    expect(resolveLink('docs/AI-PROMPT-CAM-AM.md', 'readme')).toEqual({
      kind: 'guide',
      doc: 'cam-am',
      section: null,
    });
    expect(resolveLink('docs/AI-PROMPT-CAM-AM.md#english-version', 'readme')).toEqual({
      kind: 'guide',
      doc: 'cam-am',
      section: 'english-version',
    });
    expect(resolveLink('https://musescore.com', 'cam-am')).toEqual({
      kind: 'external',
      href: 'https://musescore.com',
    });
    expect(resolveLink('docs/TAURI.md', 'readme')).toEqual({ kind: 'text' });
    expect(resolveImage('docs/images/home.png')).toMatch(/home/);
    expect(resolveImage('docs/images/khong-co.png')).toBeNull();
    expect(resolveImage('https://x/y.png')).toBeNull();
  });
});

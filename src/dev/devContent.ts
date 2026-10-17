import changelogRaw from '../../CHANGELOG.md?raw';
import referenceRaw from '../../docs/REFERENCE.md?raw';
import { repoPath, resolveLink, withAppUrl } from '../guide/guideContent';
import type { LinkTarget } from '../guide/guideContent';
import { headingIds, parseMarkdown } from '../guide/markdown';
import type { Block } from '../guide/markdown';

/**
 * Nội dung trang Dev notes (`#/dev`, vòng 7 — R7-8): docs/REFERENCE.md + CHANGELOG.md nạp nguyên văn lúc build
 * (`?raw`, chunk tải lười của route — app thường không phải tải ~110 KB này), đọc bằng bộ markdown của trang Hướng
 * dẫn. Hai tài liệu chung một bộ đếm slug (id tiêu đề không trùng); tiêu đề hạ một bậc vì trang có h1 riêng.
 */

/** Một tài liệu của trang: khối đã hạ bậc tiêu đề + id tiêu đề đầu tiên (đích của mục lục trang). */
export interface DevDoc {
  blocks: Block[];
  firstId: string | null;
}

export interface DevContent {
  reference: DevDoc;
  changelog: DevDoc;
  /** Id mọi tiêu đề của trang (link `#mục` tới mục không có → chữ thường). */
  sections: ReadonlySet<string>;
}

/** Hạ mọi tiêu đề một bậc (h1 → h2 …, tối đa h6), kể cả trong trích dẫn / danh sách. */
export function demoteHeadings(blocks: readonly Block[]): Block[] {
  return blocks.map((b): Block => {
    switch (b.type) {
      case 'heading':
        return { ...b, level: Math.min(6, b.level + 1) };
      case 'quote':
        return { ...b, children: demoteHeadings(b.children) };
      case 'list':
        return { ...b, items: b.items.map(demoteHeadings) };
      default:
        return b;
    }
  });
}

let cache: { root: string; content: DevContent } | null = null;

/** Khối của trang (token `https://VERCEL_URL_TODO` → gốc app đang mở, như trang Hướng dẫn). Parse một lần mỗi gốc. */
export function devContent(root: string): DevContent {
  if (cache?.root === root) return cache.content;
  const slugs = new Map<string, number>();
  const doc = (raw: string): DevDoc => {
    const blocks = demoteHeadings(parseMarkdown(withAppUrl(raw, root), slugs));
    return { blocks, firstId: headingIds(blocks)[0] ?? null };
  };
  const reference = doc(referenceRaw);
  const changelog = doc(changelogRaw);
  const sections = new Set([...headingIds(reference.blocks), ...headingIds(changelog.blocks)]);
  const content: DevContent = { reference, changelog, sections };
  cache = { root, content };
  return content;
}

/** REFERENCE.md nằm trong `docs/`: link tương đối của nó tính từ đó (`../README.md` = README). */
const REFERENCE_DIR = 'docs/';

function decodeSection(s: string): string | null {
  if (!s) return null;
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/**
 * Link trong REFERENCE / CHANGELOG → đích trong app: `#mục` → `#/dev?s=mục` (mục phải có trên trang); README /
 * prompt AI → trang Hướng dẫn (qua `resolveLink`); https → tab mới; file repo khác (DECISIONS, SPEC…) → chữ thường.
 */
export function resolveDevLink(target: string, sections: ReadonlySet<string>): LinkTarget {
  if (/^https?:\/\//i.test(target)) return { kind: 'external', href: target };
  const hash = target.indexOf('#');
  const file = hash < 0 ? target : target.slice(0, hash);
  const inPage = (section: string | null): LinkTarget =>
    section === null || sections.has(section) ? { kind: 'dev', section } : { kind: 'text' };
  if (file === '') return inPage(hash < 0 ? null : decodeSection(target.slice(hash + 1)));
  const path = repoPath(file, REFERENCE_DIR);
  if (path === null) return { kind: 'text' };
  const to = resolveLink(`${path}${hash < 0 ? '' : target.slice(hash)}`, 'readme');
  // `REFERENCE.md#mục` = chính trang này: kiểm mục như link `#mục`.
  return to.kind === 'dev' ? inPage(to.section) : to;
}

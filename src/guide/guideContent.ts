import camamRaw from '../../docs/AI-PROMPT-CAM-AM.md?raw';
import readmeRaw from '../../README.md?raw';
import type { GuideDoc } from '../ui/router';
import { headingIds, parseMarkdown } from './markdown';
import type { Block } from './markdown';

/**
 * Nội dung trang Hướng dẫn (D-260): phần NGƯỜI DÙNG của README và của docs/AI-PROMPT-CAM-AM.md, nạp
 * nguyên văn lúc build (`?raw`, chunk tải lười của route) — một nguồn duy nhất, sửa tài liệu là trang đổi
 * theo. Phần cho người phát triển bị cắt (D-257).
 */

/** Tiêu đề mở đầu phần cho người phát triển (cắt từ đây trở xuống). */
export const USER_PART_END: Record<GuideDoc, string> = {
  readme: '## Cho người phát triển',
  'cam-am': '## Ghi chú cho người phát triển',
};

const RAW: Record<GuideDoc, string> = { readme: readmeRaw, 'cam-am': camamRaw };

/**
 * Đường dẫn trong repo → tài liệu của trang Hướng dẫn; `docs/REFERENCE.md` → trang Dev notes (`#/dev`, chunk riêng —
 * mục của nó không kiểm ở đây).
 */
const DOC_FILES: Record<string, GuideDoc | 'dev'> = {
  'README.md': 'readme',
  'docs/AI-PROMPT-CAM-AM.md': 'cam-am',
  'docs/REFERENCE.md': 'dev',
};

/**
 * Đường dẫn tương đối của một link (tính từ thư mục `dir` của tài liệu chứa nó, vd. `docs/`) → đường dẫn từ gốc
 * repo (`../README.md` từ `docs/` → `README.md`). Ra ngoài gốc repo → null.
 */
export function repoPath(file: string, dir = ''): string | null {
  const out: string[] = [];
  for (const seg of `${dir}${file}`.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg !== '..') out.push(seg);
    else if (out.pop() === undefined) return null;
  }
  return out.join('/');
}

/** Phần trên dòng `marker` (dòng đúng bằng marker); không có marker → cả tài liệu. */
export function userPart(md: string, marker: string): string {
  const text = md.replace(/\r\n?/g, '\n');
  const lines = text.split('\n');
  const end = lines.findIndex((l) => l.trimEnd() === marker);
  return end < 0 ? text : lines.slice(0, end).join('\n');
}

/** Gốc của app đang mở (không query / hash), vd. `https://x.vercel.app/` hay `file:///…/index.html`. */
export function appRoot(loc: Pick<Location, 'href'> = window.location): string {
  return loc.href.replace(/[?#].*$/, '');
}

/**
 * Thay token `https://VERCEL_URL_TODO` (D-232) bằng địa chỉ thật của app đang mở; bỏ ghi chú "(link Vercel —
 * cập nhật sau khi deploy)" vì trang đã ở đúng link.
 */
export function withAppUrl(md: string, root: string): string {
  const slashRoot = root.endsWith('/') || /\.html?$/i.test(root) ? root : `${root}/`;
  const bareRoot = root.endsWith('/') ? root.slice(0, -1) : root;
  return md
    .replace(/ ?_\(link Vercel — cập nhật sau khi deploy\)_/g, '')
    .replace(/https:\/\/VERCEL_URL_TODO(\/?)/g, (_m, slash: string) =>
      slash ? slashRoot : bareRoot,
    );
}

const cache = new Map<string, Block[]>();

/** Khối markdown của tài liệu (đã cắt phần người phát triển, đã thay link app). Parse một lần mỗi gốc. */
export function guideBlocks(doc: GuideDoc, root: string): Block[] {
  const key = `${doc}|${root}`;
  let blocks = cache.get(key);
  if (!blocks) {
    blocks = parseMarkdown(withAppUrl(userPart(RAW[doc], USER_PART_END[doc]), root));
    cache.set(key, blocks);
  }
  return blocks;
}

const sectionCache = new Map<GuideDoc, ReadonlySet<string>>();

/** Id các tiêu đề của tài liệu (phần người dùng) — link tới mục đã bị cắt (phần người phát triển) thành chữ. */
export function guideSections(doc: GuideDoc): ReadonlySet<string> {
  let ids = sectionCache.get(doc);
  if (!ids) {
    ids = new Set(headingIds(parseMarkdown(userPart(RAW[doc], USER_PART_END[doc]))));
    sectionCache.set(doc, ids);
  }
  return ids;
}

export type LinkTarget =
  /** Mục (hoặc đầu) của một tài liệu trong trang Hướng dẫn. */
  | { kind: 'guide'; doc: GuideDoc; section: string | null }
  /** Mục (hoặc đầu) của trang Dev notes (`#/dev`: REFERENCE + CHANGELOG). */
  | { kind: 'dev'; section: string | null }
  /** Trang web ngoài: mở tab mới. */
  | { kind: 'external'; href: string }
  /** Đường dẫn trong repo mà bản web không có: hiện như chữ, không link. */
  | { kind: 'text' };

/**
 * Link trong tài liệu → đích trong app. `#mục` không đi qua router hash của app (sẽ thành route lạ) mà thành
 * `#/guide…?s=mục`; file tài liệu khác → trang Hướng dẫn tương ứng (`docs/REFERENCE.md` → trang Dev notes);
 * https → tab mới; còn lại (file repo, dành cho người phát triển) → chữ thường.
 */
export function resolveLink(target: string, current: GuideDoc): LinkTarget {
  if (/^https?:\/\//i.test(target)) return { kind: 'external', href: target };
  const hash = target.indexOf('#');
  const file = hash < 0 ? target : target.slice(0, hash);
  const section = hash < 0 ? null : decodeSection(target.slice(hash + 1));
  const key = file.replace(/^\.\//, '');
  const doc = file === '' ? current : Object.hasOwn(DOC_FILES, key) ? DOC_FILES[key] : undefined;
  if (!doc) return { kind: 'text' };
  if (doc === 'dev') return { kind: 'dev', section };
  // Mục không có trong phần người dùng (vd. "Cho người phát triển" đã bị cắt) → chữ thường.
  if (section !== null && !guideSections(doc).has(section)) return { kind: 'text' };
  return { kind: 'guide', doc, section };
}

function decodeSection(s: string): string | null {
  if (!s) return null;
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/**
 * Ảnh README (`docs/images/*.png`) → URL trong bản build (asset có hash). Bản 1 file (`__SINGLE_FILE__`) không
 * nhúng ảnh (thêm ~600 KB base64) — trang hiện chú thích thay ảnh.
 */
const IMAGE_URLS: Record<string, string> = __SINGLE_FILE__
  ? {}
  : import.meta.glob<string>('../../docs/images/*.png', {
      query: '?url',
      import: 'default',
      eager: true,
    });

export function resolveImage(src: string): string | null {
  const m = /^(?:\.\/)?docs\/images\/([\w.-]+\.png)$/.exec(src);
  if (!m) return null;
  return IMAGE_URLS[`../../docs/images/${m[1]}`] ?? null;
}

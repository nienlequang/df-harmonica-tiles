/**
 * Markdown tối giản cho trang Hướng dẫn (D-260): đọc README (phần người dùng) và docs/AI-PROMPT-CAM-AM.md
 * thành cây khối / inline thuần dữ liệu — không HTML thô, không dangerouslySetInnerHTML, không thêm dependency.
 * Chỉ hỗ trợ tập con mà hai tài liệu đó dùng: tiêu đề ATX, đoạn văn, danh sách (lồng nhau, có số), bảng GFM,
 * khối code rào ``` / ````, trích dẫn >, kẻ ngang, **đậm**, _nghiêng_ / *nghiêng*, `code`, [link](x), ![ảnh](x),
 * URL trần (autolink GFM), ký tự thoát \x. HTML trong tài liệu được giữ nguyên như chữ.
 */

export type Inline =
  | { type: 'text'; text: string }
  | { type: 'code'; text: string }
  | { type: 'strong'; children: Inline[] }
  | { type: 'em'; children: Inline[] }
  | { type: 'link'; href: string; children: Inline[] }
  | { type: 'image'; src: string; alt: string };

export type Align = 'left' | 'center' | 'right' | null;

export type Block =
  | { type: 'heading'; level: number; id: string; children: Inline[] }
  | { type: 'paragraph'; children: Inline[] }
  | { type: 'code'; lang: string; text: string }
  | { type: 'quote'; children: Block[] }
  | { type: 'list'; ordered: boolean; start: number; items: Block[][] }
  | { type: 'table'; align: Align[]; header: Inline[][]; rows: Inline[][][] }
  | { type: 'hr' };

// ── Inline ──────────────────────────────────────────────────────────────

const ESCAPABLE = new Set('\\`*_{}[]()#+-.!|<>~"\''.split(''));
const PUNCT = /[\s\p{P}\p{S}]/u;

function isBoundary(ch: string | undefined): boolean {
  return ch === undefined || PUNCT.test(ch);
}

/** Vị trí `]` khớp với `[` tại `open` (đếm lồng, bỏ qua ký tự thoát và code span). */
function matchBracket(src: string, open: number): number {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const ch = src[i];
    if (ch === '\\') {
      i++;
    } else if (ch === '`') {
      const end = codeSpanEnd(src, i);
      if (end > 0) i = end - 1;
    } else if (ch === '[') {
      depth++;
    } else if (ch === ']') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** `(url)` ngay sau `]`: trả url + vị trí sau `)`. Url không có khoảng trắng (tài liệu không dùng title). */
function linkTarget(src: string, at: number): { url: string; end: number } | null {
  if (src[at] !== '(') return null;
  let depth = 0;
  for (let i = at; i < src.length; i++) {
    const ch = src[i];
    if (ch === '(') depth++;
    else if (ch === ')') {
      depth--;
      if (depth === 0) {
        const url = src.slice(at + 1, i).trim();
        return /\s/.test(url) ? null : { url, end: i + 1 };
      }
    }
  }
  return null;
}

/** Code span bắt đầu ở `at` (chuỗi backtick): vị trí ngay sau rào đóng, hoặc -1 nếu không có rào đóng. */
function codeSpanEnd(src: string, at: number): number {
  let n = 0;
  while (src[at + n] === '`') n++;
  const fence = '`'.repeat(n);
  let i = at + n;
  while (i < src.length) {
    const j = src.indexOf(fence, i);
    if (j < 0) return -1;
    let k = j + n;
    if (src[k] !== '`' && src[j - 1] !== '`') return k;
    while (src[k] === '`') k++;
    i = k;
  }
  return -1;
}

/** Dấu nhấn (`**`, `_`, `*`) đóng tương ứng: phải đứng sát chữ bên trái và không dính chữ bên phải. */
function findCloser(src: string, from: number, marker: string): number {
  for (let i = from; i < src.length; i++) {
    const ch = src[i];
    if (ch === '\\') {
      i++;
      continue;
    }
    if (ch === '`') {
      const end = codeSpanEnd(src, i);
      if (end > 0) i = end - 1;
      continue;
    }
    if (ch === '[') {
      // Không đóng bên trong text của link.
      const close = matchBracket(src, i);
      if (close > 0) i = close;
      continue;
    }
    if (!src.startsWith(marker, i)) continue;
    if (marker === '*' && src[i + 1] === '*') {
      i++;
      continue;
    }
    const before = src[i - 1];
    const after = src[i + marker.length];
    if (before !== undefined && /\s/.test(before)) continue;
    if (marker !== '**' && !isBoundary(after)) continue;
    return i;
  }
  return -1;
}

const AUTOLINK = /^https?:\/\/[^\s<>()]+/;

export function parseInline(src: string): Inline[] {
  const out: Inline[] = [];
  let text = '';
  const flush = () => {
    if (text) out.push({ type: 'text', text });
    text = '';
  };
  let i = 0;
  while (i < src.length) {
    const ch = src[i] ?? '';
    const prev = src[i - 1];

    if (ch === '\\' && i + 1 < src.length && ESCAPABLE.has(src[i + 1] ?? '')) {
      text += src[i + 1];
      i += 2;
      continue;
    }

    if (ch === '`') {
      const end = codeSpanEnd(src, i);
      if (end > 0) {
        let n = 0;
        while (src[i + n] === '`') n++;
        let code = src.slice(i + n, end - n);
        if (code.length > 2 && code.startsWith(' ') && code.endsWith(' ') && code.trim()) {
          code = code.slice(1, -1);
        }
        flush();
        out.push({ type: 'code', text: code });
        i = end;
        continue;
      }
      // Không có rào đóng: chuỗi backtick là chữ thường.
      let n = 0;
      while (src[i + n] === '`') n++;
      text += src.slice(i, i + n);
      i += n;
      continue;
    }

    if (ch === '!' && src[i + 1] === '[') {
      const close = matchBracket(src, i + 1);
      const target = close > 0 ? linkTarget(src, close + 1) : null;
      if (target) {
        flush();
        out.push({ type: 'image', src: target.url, alt: src.slice(i + 2, close) });
        i = target.end;
        continue;
      }
    }

    if (ch === '[') {
      const close = matchBracket(src, i);
      const target = close > 0 ? linkTarget(src, close + 1) : null;
      if (target) {
        flush();
        out.push({
          type: 'link',
          href: target.url,
          children: parseInline(src.slice(i + 1, close)),
        });
        i = target.end;
        continue;
      }
    }

    if (ch === '*' && src[i + 1] === '*' && src[i + 2] !== undefined && !/\s/.test(src[i + 2])) {
      const close = findCloser(src, i + 2, '**');
      if (close > i + 2) {
        flush();
        out.push({ type: 'strong', children: parseInline(src.slice(i + 2, close)) });
        i = close + 2;
        continue;
      }
    }

    if (
      (ch === '_' || ch === '*') &&
      isBoundary(prev) &&
      src[i + 1] !== undefined &&
      !/\s/.test(src[i + 1]) &&
      src[i + 1] !== ch
    ) {
      const close = findCloser(src, i + 1, ch);
      if (close > i + 1) {
        flush();
        out.push({ type: 'em', children: parseInline(src.slice(i + 1, close)) });
        i = close + 1;
        continue;
      }
    }

    if ((ch === 'h' || ch === 'H') && isBoundary(prev)) {
      const m = AUTOLINK.exec(src.slice(i));
      if (m) {
        // Dấu câu cuối URL (". , ; :") không thuộc link.
        const url = m[0].replace(/[.,;:!?'"*_]+$/, '');
        flush();
        out.push({ type: 'link', href: url, children: [{ type: 'text', text: url }] });
        i += url.length;
        continue;
      }
    }

    text += ch;
    i++;
  }
  flush();
  return out;
}

/** Chữ thuần của một dãy inline (cho slug tiêu đề, alt…). */
export function inlineText(nodes: readonly Inline[]): string {
  return nodes
    .map((n) => {
      switch (n.type) {
        case 'text':
        case 'code':
          return n.text;
        case 'image':
          return n.alt;
        default:
          return inlineText(n.children);
      }
    })
    .join('');
}

/**
 * Slug tiêu đề như GitHub: chữ thường, giữ chữ / dấu / số / khoảng trắng / `-` / `_`, khoảng trắng → `-`.
 * Vd. "Cửa sổ nổi (1 màn hình)" → "cửa-sổ-nổi-1-màn-hình".
 */
export function slugify(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N} _-]/gu, '')
    .replace(/ /g, '-');
}

// ── Khối ────────────────────────────────────────────────────────────────

const FENCE = /^(`{3,}|~{3,})\s*([^`\s]*)/;
const HEADING = /^(#{1,6})[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/;
const HR = /^ {0,3}(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$/;
const LIST_ITEM = /^( *)([-*+]|\d{1,9}[.)])( +|$)/;
const TABLE_DELIM = /^\s*\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?\s*$/;

function indentOf(line: string): number {
  return /^ */.exec(line)?.[0].length ?? 0;
}

function isBlank(line: string): boolean {
  return line.trim() === '';
}

/** Tách ô của một hàng bảng (bỏ `|` hai đầu; `\|` là ký tự `|` trong ô). */
function splitRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
  const cells: string[] = [];
  let cell = '';
  let inCode = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '\\' && s[i + 1] === '|') {
      cell += '|';
      i++;
    } else if (ch === '`') {
      inCode = !inCode;
      cell += ch;
    } else if (ch === '|' && !inCode) {
      cells.push(cell.trim());
      cell = '';
    } else {
      cell += ch;
    }
  }
  cells.push(cell.trim());
  return cells;
}

function alignOf(cell: string): Align {
  const c = cell.trim();
  const left = c.startsWith(':');
  const right = c.endsWith(':');
  if (left && right) return 'center';
  if (right) return 'right';
  if (left) return 'left';
  return null;
}

/** Dòng có mở một khối khác (cắt ngang đoạn văn)? */
function startsBlock(line: string, next: string | undefined): boolean {
  const t = line.trimStart();
  if (FENCE.test(t) || HEADING.test(t) || HR.test(line) || t.startsWith('>')) return true;
  const li = LIST_ITEM.exec(line);
  // Danh sách số chỉ cắt đoạn văn khi bắt đầu từ 1 (như CommonMark); dòng trống sau dấu thì không.
  if (li && li[3] !== '' && (!/\d/.test(li[2] ?? '') || /^1[.)]$/.test(li[2] ?? ''))) return true;
  return line.includes('|') && next !== undefined && TABLE_DELIM.test(next) && next.includes('-');
}

interface Ctx {
  /** Đếm slug đã dùng (tiêu đề trùng tên → `-1`, `-2` như GitHub). */
  slugs: Map<string, number>;
}

function parseLines(lines: readonly string[], ctx: Ctx): Block[] {
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? '';
    if (isBlank(line)) {
      i++;
      continue;
    }
    const trimmed = line.trimStart();

    // Khối code có rào (``` hoặc ````, đóng bằng rào cùng ký tự, dài ít nhất bằng rào mở).
    const fence = FENCE.exec(trimmed);
    if (fence && indentOf(line) <= 3) {
      const marker = fence[1] ?? '```';
      const pad = indentOf(line);
      const body: string[] = [];
      i++;
      while (i < lines.length) {
        const l = lines[i] ?? '';
        const t = l.trim();
        if (t.length >= marker.length && t === (marker[0] ?? '`').repeat(t.length)) break;
        body.push(l.slice(Math.min(pad, indentOf(l))));
        i++;
      }
      i++; // rào đóng (hoặc hết tài liệu)
      blocks.push({ type: 'code', lang: fence[2] ?? '', text: body.join('\n') });
      continue;
    }

    const heading = HEADING.exec(trimmed);
    if (heading && indentOf(line) <= 3) {
      const children = parseInline(heading[2] ?? '');
      const base = slugify(inlineText(children));
      const n = ctx.slugs.get(base) ?? 0;
      ctx.slugs.set(base, n + 1);
      blocks.push({
        type: 'heading',
        level: heading[1]?.length ?? 1,
        id: n === 0 ? base : `${base}-${n}`,
        children,
      });
      i++;
      continue;
    }

    if (HR.test(line)) {
      blocks.push({ type: 'hr' });
      i++;
      continue;
    }

    if (trimmed.startsWith('>')) {
      const body: string[] = [];
      while (i < lines.length && !isBlank(lines[i] ?? '')) {
        const l = (lines[i] ?? '').trimStart();
        body.push(l.startsWith('>') ? l.replace(/^> ?/, '') : l);
        i++;
      }
      blocks.push({ type: 'quote', children: parseLines(body, ctx) });
      continue;
    }

    const next = lines[i + 1];
    if (line.includes('|') && next !== undefined && TABLE_DELIM.test(next) && next.includes('-')) {
      const header = splitRow(line);
      const align = splitRow(next).map(alignOf);
      const rows: Inline[][][] = [];
      i += 2;
      while (i < lines.length && !isBlank(lines[i] ?? '') && (lines[i] ?? '').includes('|')) {
        const cells = splitRow(lines[i] ?? '');
        rows.push(header.map((_, c) => parseInline(cells[c] ?? '')));
        i++;
      }
      blocks.push({ type: 'table', align, header: header.map((h) => parseInline(h)), rows });
      continue;
    }

    const li = LIST_ITEM.exec(line);
    if (li) {
      i = parseList(lines, i, ctx, blocks);
      continue;
    }

    // Đoạn văn: gom tới dòng trống hoặc dòng mở khối khác; xuống dòng mềm = khoảng trắng.
    const para: string[] = [trimmed];
    i++;
    while (i < lines.length) {
      const l = lines[i] ?? '';
      if (isBlank(l) || startsBlock(l, lines[i + 1])) break;
      para.push(l.trim());
      i++;
    }
    blocks.push({ type: 'paragraph', children: parseInline(para.join(' ')) });
  }
  return blocks;
}

/** Danh sách bắt đầu ở dòng `start`: đẩy khối vào `out`, trả chỉ số dòng sau danh sách. */
function parseList(lines: readonly string[], start: number, ctx: Ctx, out: Block[]): number {
  const first = LIST_ITEM.exec(lines[start] ?? '');
  if (!first) return start + 1;
  const baseIndent = first[1]?.length ?? 0;
  const ordered = /\d/.test(first[2] ?? '');
  const items: Block[][] = [];
  let i = start;
  while (i < lines.length) {
    const m = LIST_ITEM.exec(lines[i] ?? '');
    if (!m) break;
    const indent = m[1]?.length ?? 0;
    if (indent < baseIndent || indent > baseIndent + 3) break;
    if (/\d/.test(m[2] ?? '') !== ordered) break;
    const contentCol = indent + (m[2]?.length ?? 1) + Math.max(1, Math.min(m[3]?.length ?? 1, 4));
    const body: string[] = [(lines[i] ?? '').slice(m[0].length)];
    i++;
    let lastBlank = false;
    while (i < lines.length) {
      const l = lines[i] ?? '';
      if (isBlank(l)) {
        // Dòng trống thuộc mục chỉ khi dòng có chữ kế tiếp còn thụt vào trong mục.
        let j = i;
        while (j < lines.length && isBlank(lines[j] ?? '')) j++;
        if (j < lines.length && indentOf(lines[j] ?? '') >= contentCol) {
          for (; i < j; i++) body.push('');
          lastBlank = true;
          continue;
        }
        break;
      }
      if (indentOf(l) >= contentCol) {
        body.push(l.slice(contentCol));
        lastBlank = false;
        i++;
        continue;
      }
      // Dòng nối lười (thụt ít hơn) của đoạn văn đang dở, miễn không mở mục / khối mới.
      if (!lastBlank && !LIST_ITEM.test(l) && !startsBlock(l, lines[i + 1])) {
        body.push(l.trim());
        i++;
        continue;
      }
      break;
    }
    items.push(parseLines(body, ctx));
    // Mục kế phải liền ngay (cho phép dòng trống giữa các mục).
    while (i < lines.length && isBlank(lines[i] ?? '')) {
      const n = LIST_ITEM.exec(lines[i + 1] ?? '');
      if (!n || (n[1]?.length ?? 0) !== baseIndent) break;
      i++;
    }
  }
  out.push({
    type: 'list',
    ordered,
    start: ordered ? Number.parseInt(first[2] ?? '1', 10) : 1,
    items,
  });
  return i;
}

/**
 * Tài liệu markdown → khối. `\r\n` và tab (4 cột) được chuẩn hóa trước. `slugs` dùng chung khi ghép nhiều tài liệu
 * vào một trang (trang Dev notes: REFERENCE + CHANGELOG) để id tiêu đề không trùng nhau.
 */
export function parseMarkdown(src: string, slugs: Map<string, number> = new Map()): Block[] {
  const lines = src.replace(/\r\n?/g, '\n').replace(/\t/g, '    ').split('\n');
  return parseLines(lines, { slugs });
}

/** Mọi id tiêu đề của cây khối (theo thứ tự tài liệu). */
export function headingIds(blocks: readonly Block[]): string[] {
  const ids: string[] = [];
  const walk = (bs: readonly Block[]) => {
    for (const b of bs) {
      if (b.type === 'heading') ids.push(b.id);
      else if (b.type === 'quote') walk(b.children);
      else if (b.type === 'list') b.items.forEach(walk);
    }
  };
  walk(blocks);
  return ids;
}

/** Mọi link / ảnh của cây khối (để kiểm tra link hỏng). */
export function collectTargets(blocks: readonly Block[]): { links: string[]; images: string[] } {
  const links: string[] = [];
  const images: string[] = [];
  const inl = (ns: readonly Inline[]) => {
    for (const n of ns) {
      if (n.type === 'link') {
        links.push(n.href);
        inl(n.children);
      } else if (n.type === 'image') images.push(n.src);
      else if (n.type === 'strong' || n.type === 'em') inl(n.children);
    }
  };
  const walk = (bs: readonly Block[]) => {
    for (const b of bs) {
      switch (b.type) {
        case 'heading':
        case 'paragraph':
          inl(b.children);
          break;
        case 'quote':
          walk(b.children);
          break;
        case 'list':
          b.items.forEach(walk);
          break;
        case 'table':
          b.header.forEach(inl);
          b.rows.forEach((r) => r.forEach(inl));
          break;
        default:
          break;
      }
    }
  };
  walk(blocks);
  return { links, images };
}

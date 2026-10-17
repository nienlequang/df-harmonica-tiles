import { describe, expect, it } from 'vitest';
import {
  collectTargets,
  headingIds,
  inlineText,
  parseInline,
  parseMarkdown,
  slugify,
} from './markdown';
import type { Block } from './markdown';

describe('slugify (như GitHub)', () => {
  it.each([
    ['Cửa sổ nổi (1 màn hình)', 'cửa-sổ-nổi-1-màn-hình'],
    ['Tìm nguồn ở đâu', 'tìm-nguồn-ở-đâu'],
    ['English version', 'english-version'],
    ['Định dạng .harm đầy đủ', 'định-dạng-harm-đầy-đủ'],
    ['b) Nhập file .harm / .json / .txt', 'b-nhập-file-harm--json--txt'],
    [
      'Cách khuyên dùng: một source, Window Capture + Chroma Key',
      'cách-khuyên-dùng-một-source-window-capture--chroma-key',
    ],
  ])('%j → %j', (text, slug) => {
    expect(slugify(text)).toBe(slug);
  });
});

describe('parseInline', () => {
  it('đậm, nghiêng (_ và *), code, link, ảnh', () => {
    expect(parseInline('a **b** _c_ *d* `e` [f](#g) ![h](i.png)')).toEqual([
      { type: 'text', text: 'a ' },
      { type: 'strong', children: [{ type: 'text', text: 'b' }] },
      { type: 'text', text: ' ' },
      { type: 'em', children: [{ type: 'text', text: 'c' }] },
      { type: 'text', text: ' ' },
      { type: 'em', children: [{ type: 'text', text: 'd' }] },
      { type: 'text', text: ' ' },
      { type: 'code', text: 'e' },
      { type: 'text', text: ' ' },
      { type: 'link', href: '#g', children: [{ type: 'text', text: 'f' }] },
      { type: 'text', text: ' ' },
      { type: 'image', src: 'i.png', alt: 'h' },
    ]);
  });

  it('lồng: link trong đậm, đậm trong link, nghiêng chứa code', () => {
    const nodes = parseInline('**[docs/A.md](docs/A.md)** [**x**](#y) _a `b` c_');
    expect(nodes[0]).toEqual({
      type: 'strong',
      children: [
        { type: 'link', href: 'docs/A.md', children: [{ type: 'text', text: 'docs/A.md' }] },
      ],
    });
    expect(nodes[2]).toEqual({
      type: 'link',
      href: '#y',
      children: [{ type: 'strong', children: [{ type: 'text', text: 'x' }] }],
    });
    expect(inlineText(nodes)).toBe('docs/A.md x a b c');
  });

  it('ký tự thoát và dấu không phải nhấn', () => {
    expect(inlineText(parseInline('Có độ dài (\\*dur) a\\|b'))).toBe('Có độ dài (*dur) a|b');
    // `_` giữa chữ, `*` có khoảng trắng hai bên, dấu nhân: giữ nguyên.
    expect(parseInline('snake_case_name 2 * 3 = 6')).toEqual([
      { type: 'text', text: 'snake_case_name 2 * 3 = 6' },
    ]);
    // Không có dấu đóng → chữ thường.
    expect(parseInline('**mở mà không đóng')).toEqual([
      { type: 'text', text: '**mở mà không đóng' },
    ]);
  });

  it('code span: dấu nhấn bên trong không có tác dụng; rào nhiều backtick', () => {
    expect(parseInline('`Z*2` và `_*.5`')).toEqual([
      { type: 'code', text: 'Z*2' },
      { type: 'text', text: ' và ' },
      { type: 'code', text: '_*.5' },
    ]);
    expect(parseInline('``a ` b``')).toEqual([{ type: 'code', text: 'a ` b' }]);
    expect(parseInline('a ` b')).toEqual([{ type: 'text', text: 'a ` b' }]);
  });

  it('URL trần thành link (bỏ dấu câu cuối)', () => {
    expect(parseInline('Mở https://example.com/x.')).toEqual([
      { type: 'text', text: 'Mở ' },
      {
        type: 'link',
        href: 'https://example.com/x',
        children: [{ type: 'text', text: 'https://example.com/x' }],
      },
      { type: 'text', text: '.' },
    ]);
    // Trong link markdown thì không lồng autolink.
    expect(parseInline('[https://a.b](https://a.b)')).toHaveLength(1);
  });
});

describe('parseMarkdown', () => {
  it('tiêu đề có id (trùng tên → -1), đoạn văn nối dòng mềm', () => {
    const blocks = parseMarkdown('# A b\n\nmột\nhai\n\n## A b\n### `x` y\n');
    expect(blocks).toEqual([
      { type: 'heading', level: 1, id: 'a-b', children: [{ type: 'text', text: 'A b' }] },
      { type: 'paragraph', children: [{ type: 'text', text: 'một hai' }] },
      { type: 'heading', level: 2, id: 'a-b-1', children: [{ type: 'text', text: 'A b' }] },
      {
        type: 'heading',
        level: 3,
        id: 'x-y',
        children: [
          { type: 'code', text: 'x' },
          { type: 'text', text: ' y' },
        ],
      },
    ]);
  });

  it('khối code rào 4 backtick chứa rào 3 backtick; không đọc markdown bên trong', () => {
    const src = '````text\nA\n```text\n# không phải tiêu đề\n```\n````\nsau';
    const blocks = parseMarkdown(src);
    expect(blocks[0]).toEqual({
      type: 'code',
      lang: 'text',
      text: 'A\n```text\n# không phải tiêu đề\n```',
    });
    expect(blocks[1]).toEqual({ type: 'paragraph', children: [{ type: 'text', text: 'sau' }] });
  });

  it('danh sách lồng: số + gạch đầu dòng, dòng nối thụt vào, dòng nối lười', () => {
    const src = [
      '1. Một',
      '   tiếp',
      '2. Hai:',
      '   - a',
      '   - b',
      '     b2',
      'lười',
      '3. Ba',
      '',
      'Đoạn sau.',
    ].join('\n');
    const [list, para] = parseMarkdown(src);
    expect(list?.type).toBe('list');
    if (list?.type !== 'list') return;
    expect(list.ordered).toBe(true);
    expect(list.items).toHaveLength(3);
    expect(list.items[0]).toEqual([
      { type: 'paragraph', children: [{ type: 'text', text: 'Một tiếp' }] },
    ]);
    const nested = list.items[1]?.[1];
    expect(nested?.type).toBe('list');
    if (nested?.type === 'list') {
      expect(nested.ordered).toBe(false);
      expect(
        nested.items.map((it) =>
          it.map((b) => (b.type === 'paragraph' ? inlineText(b.children) : b.type)),
        ),
      ).toEqual([['a'], ['b b2 lười']]);
    }
    expect(para).toEqual({ type: 'paragraph', children: [{ type: 'text', text: 'Đoạn sau.' }] });
  });

  it('danh sách số bắt đầu khác 1; đoạn văn không bị cắt bởi "2. "', () => {
    const [a, b] = parseMarkdown('3. x\n4. y\n\nNăm 2024 có\n2. không phải danh sách');
    expect(a).toMatchObject({ type: 'list', ordered: true, start: 3 });
    expect(b).toEqual({
      type: 'paragraph',
      children: [{ type: 'text', text: 'Năm 2024 có 2. không phải danh sách' }],
    });
  });

  it('bảng GFM: căn lề, `\\|` trong ô, ô thiếu', () => {
    const src = '| A | B |\n| :-- | --: |\n| `a\\|b` | **x** |\n| chỉ một |';
    const [table] = parseMarkdown(src);
    expect(table).toEqual({
      type: 'table',
      align: ['left', 'right'],
      header: [[{ type: 'text', text: 'A' }], [{ type: 'text', text: 'B' }]],
      rows: [
        [
          [{ type: 'code', text: 'a|b' }],
          [{ type: 'strong', children: [{ type: 'text', text: 'x' }] }],
        ],
        [[{ type: 'text', text: 'chỉ một' }], []],
      ],
    });
  });

  it('trích dẫn nhiều dòng, kẻ ngang', () => {
    const blocks = parseMarkdown('> **Lưu ý:** a\n> b\n\n---\n');
    expect(blocks).toEqual<Block[]>([
      {
        type: 'quote',
        children: [
          {
            type: 'paragraph',
            children: [
              { type: 'strong', children: [{ type: 'text', text: 'Lưu ý:' }] },
              { type: 'text', text: ' a b' },
            ],
          },
        ],
      },
      { type: 'hr' },
    ]);
  });

  it('CRLF và HTML thô giữ như chữ', () => {
    expect(parseMarkdown('a\r\n<b>x</b>\r\n')).toEqual([
      { type: 'paragraph', children: [{ type: 'text', text: 'a <b>x</b>' }] },
    ]);
  });

  it('slugs dùng chung: ghép hai tài liệu vào một trang không trùng id tiêu đề', () => {
    const slugs = new Map<string, number>();
    expect(headingIds(parseMarkdown('# Added\n## Âm thanh', slugs))).toEqual(['added', 'âm-thanh']);
    expect(headingIds(parseMarkdown('## Added\n## Âm thanh', slugs))).toEqual([
      'added-1',
      'âm-thanh-1',
    ]);
    // Không truyền: mỗi tài liệu đếm riêng (như trước).
    expect(headingIds(parseMarkdown('# Added'))).toEqual(['added']);
  });

  it('headingIds / collectTargets đi qua mọi khối', () => {
    const blocks = parseMarkdown(
      '# T\n\n- [a](#t)\n\n> ![i](docs/images/x.png)\n\n| h |\n| - |\n| [b](https://x.y) |',
    );
    expect(headingIds(blocks)).toEqual(['t']);
    expect(collectTargets(blocks)).toEqual({
      links: ['#t', 'https://x.y'],
      images: ['docs/images/x.png'],
    });
  });
});

import { useState } from 'react';
import type { MouseEvent, ReactNode } from 'react';
import { useT } from '../i18n/useT';
import { Button, copyText } from '../ui/components';
import { href, paths } from '../ui/router';
import { resolveImage } from './guideContent';
import type { LinkTarget } from './guideContent';
import type { Align, Block, Inline } from './markdown';

/**
 * Cây khối markdown → phần tử React (không HTML thô). Link được dịch qua `resolve` (trang Hướng dẫn:
 * `resolveLink(target, doc)`; trang Dev notes có bộ dịch riêng): mục trong tài liệu thành `#/guide…?s=…` /
 * `#/dev?s=…`, trang ngoài mở tab mới, file repo thành chữ thường; ảnh qua `resolveImage`.
 */

/** Link trong tài liệu → đích trong app. */
export type LinkResolver = (target: string) => LinkTarget;

/** Cuộn tới tiêu đề có id; trả false nếu không có. */
export function scrollToSection(id: string): boolean {
  const el = document.getElementById(id);
  if (!el) return false;
  el.scrollIntoView?.({ block: 'start' });
  el.focus({ preventScroll: true });
  return true;
}

function GuideLink({
  target,
  resolve,
  children,
}: {
  target: string;
  resolve: LinkResolver;
  children: ReactNode;
}) {
  const t = useT();
  const to = resolve(target);
  if (to.kind === 'text') return <>{children}</>;
  if (to.kind === 'external') {
    return (
      <a href={to.href} target="_blank" rel="noopener noreferrer">
        {children}
        <span className="sr-only"> {t('guide.newTab')}</span>
      </a>
    );
  }
  const section = to.section ?? undefined;
  const link = href(to.kind === 'dev' ? paths.dev(section) : paths.guide(to.doc, section));
  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    // Bấm lại đúng mục đang ở trong hash: hash không đổi → không có sự kiện → tự cuộn.
    if (to.section && window.location.hash === link && scrollToSection(to.section)) {
      e.preventDefault();
    }
  };
  return (
    <a href={link} onClick={onClick}>
      {children}
    </a>
  );
}

function GuideImage({ src, alt }: { src: string; alt: string }) {
  const url = resolveImage(src);
  const [failed, setFailed] = useState(false);
  // Không có ảnh (bản 1 file, ảnh ngoài bundle, offline chưa tải) → chú thích thay ảnh.
  if (!url || failed) return <span className="guide-img-missing">[{alt}]</span>;
  // Ảnh README chụp 1600 × 900 (D-255): khai tỉ lệ trước để giữ chỗ — cuộn tới mục (?s=) không bị ảnh tải sau
  // đẩy lệch.
  return (
    <img
      src={url}
      alt={alt}
      width={1600}
      height={900}
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
    />
  );
}

function Inlines({ nodes, resolve }: { nodes: readonly Inline[]; resolve: LinkResolver }) {
  return (
    <>
      {nodes.map((n, i) => {
        switch (n.type) {
          case 'text':
            return n.text;
          case 'code':
            return <code key={i}>{n.text}</code>;
          case 'strong':
            return (
              <strong key={i}>
                <Inlines nodes={n.children} resolve={resolve} />
              </strong>
            );
          case 'em':
            return (
              <em key={i}>
                <Inlines nodes={n.children} resolve={resolve} />
              </em>
            );
          case 'link':
            return (
              <GuideLink key={i} target={n.href} resolve={resolve}>
                <Inlines nodes={n.children} resolve={resolve} />
              </GuideLink>
            );
          case 'image':
            return <GuideImage key={i} src={n.src} alt={n.alt} />;
        }
      })}
    </>
  );
}

function CodeBlock({ text, lang }: { text: string; lang: string }) {
  const t = useT();
  const [copied, setCopied] = useState<boolean | null>(null);
  return (
    <div className="guide-code">
      <pre tabIndex={0} data-lang={lang || undefined}>
        <code>{text}</code>
      </pre>
      <Button
        size="sm"
        className="guide-code-copy"
        onClick={() => {
          void copyText(text).then(setCopied);
        }}
      >
        {copied === true ? t('common.copied') : t('common.copy')}
      </Button>
      <span className="sr-only" aria-live="polite">
        {copied === null ? '' : copied ? t('common.copied') : t('guide.copyFailed')}
      </span>
    </div>
  );
}

const HEADINGS = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'] as const;

function alignStyle(a: Align | undefined) {
  return a ? { textAlign: a } : undefined;
}

/** Ảnh duy nhất của một đoạn = hình minh họa (figure); null nếu đoạn có thứ khác. */
function figureImage(nodes: readonly Inline[]): Extract<Inline, { type: 'image' }> | null {
  const only = nodes.length === 1 ? nodes[0] : undefined;
  return only?.type === 'image' ? only : null;
}

export function MarkdownBlocks({
  blocks,
  resolve,
}: {
  blocks: readonly Block[];
  resolve: LinkResolver;
}) {
  return (
    <>
      {blocks.map((b, i) => {
        switch (b.type) {
          case 'heading': {
            const H = HEADINGS[Math.min(6, Math.max(1, b.level)) - 1] ?? 'h2';
            return (
              <H key={i} id={b.id} tabIndex={-1}>
                <Inlines nodes={b.children} resolve={resolve} />
              </H>
            );
          }
          case 'paragraph': {
            const img = figureImage(b.children);
            if (img) {
              return (
                <figure key={i} className="guide-figure">
                  <GuideImage src={img.src} alt={img.alt} />
                </figure>
              );
            }
            return (
              <p key={i}>
                <Inlines nodes={b.children} resolve={resolve} />
              </p>
            );
          }
          case 'code':
            return <CodeBlock key={i} text={b.text} lang={b.lang} />;
          case 'quote':
            return (
              <blockquote key={i}>
                <MarkdownBlocks blocks={b.children} resolve={resolve} />
              </blockquote>
            );
          case 'list': {
            const items = b.items.map((item, j) => (
              <li key={j}>
                <MarkdownBlocks blocks={item} resolve={resolve} />
              </li>
            ));
            return b.ordered ? (
              <ol key={i} start={b.start === 1 ? undefined : b.start}>
                {items}
              </ol>
            ) : (
              <ul key={i}>{items}</ul>
            );
          }
          case 'table':
            return (
              <div key={i} className="guide-table" tabIndex={0}>
                <table>
                  <thead>
                    <tr>
                      {b.header.map((cell, c) => (
                        <th key={c} scope="col" style={alignStyle(b.align[c])}>
                          <Inlines nodes={cell} resolve={resolve} />
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {b.rows.map((row, r) => (
                      <tr key={r}>
                        {row.map((cell, c) => (
                          <td key={c} style={alignStyle(b.align[c])}>
                            <Inlines nodes={cell} resolve={resolve} />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          case 'hr':
            return <hr key={i} />;
        }
      })}
    </>
  );
}

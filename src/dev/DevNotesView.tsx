import { useCallback, useEffect, useId, useMemo } from 'react';
import type { MouseEvent } from 'react';
import { appRoot } from '../guide/guideContent';
import { MarkdownBlocks, scrollToSection } from '../guide/MarkdownView';
import type { LinkResolver } from '../guide/MarkdownView';
import { useT } from '../i18n/useT';
import { href, paths } from '../ui/router';
import { BUILD_INFO, formatBuildDate } from './buildInfo';
import type { BuildInfo } from './buildInfo';
import { devContent, resolveDevLink } from './devContent';
import { SourceCodeLink } from './SourceCodeLink';
import { TakedownLine } from './TakedownLine';
import '../guide/guide.css';
import './dev.css';

export interface DevNotesViewProps {
  /** Id tiêu đề cần cuộn tới (`?s=`), null = đầu trang. */
  section: string | null;
  /** Thông tin bản build (mặc định: hằng chèn lúc build; test truyền giá trị cố định). */
  build?: BuildInfo;
}

/** Link mục lục của trang: bấm lại đúng mục đang ở trong hash (hash không đổi → không có sự kiện) thì tự cuộn. */
function SectionLink({ section, label }: { section: string | null; label: string }) {
  const link = href(paths.dev(section ?? undefined));
  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    if (section && window.location.hash === link && scrollToSection(section)) e.preventDefault();
  };
  return (
    <a href={link} onClick={onClick} className="btn btn-sm btn-secondary">
      {label}
    </a>
  );
}

/**
 * Route `#/dev` "Dev notes" (vòng 7 — R7-8): tài liệu tham khảo (docs/REFERENCE.md — cú pháp `.harm` đầy đủ, bảng
 * lỗi, tham số URL của overlay, giới hạn đã biết) + phiên bản / commit / ngày build của bản đang chạy + CHANGELOG.
 * Cố ý hơi ẩn: chỉ có link nhỏ ở chân trang Hướng dẫn và Cài đặt, không có trên thanh điều hướng. Đầu trang có link
 * "Mã nguồn (GitHub)" (D-444).
 */
export function DevNotesView({ section, build = BUILD_INFO }: DevNotesViewProps) {
  const t = useT();
  const titleId = useId();
  const buildId = useId();
  const content = useMemo(() => devContent(appRoot()), []);
  const resolve = useCallback<LinkResolver>(
    (target) => resolveDevLink(target, content.sections),
    [content],
  );

  useEffect(() => {
    const prev = document.title;
    document.title = `${t('dev.title')} — ${t('app.shortTitle')}`;
    return () => {
      document.title = prev;
    };
  }, [t]);

  useEffect(() => {
    if (section && scrollToSection(section)) return;
    try {
      window.scrollTo(0, 0);
    } catch {
      // jsdom
    }
  }, [section]);

  const unknown = t('dev.unknown');
  const builtAt = formatBuildDate(build.builtAt);

  return (
    <article className="guide dev-notes" aria-labelledby={titleId}>
      <header className="dev-header">
        <h1 id={titleId} lang="en">
          {t('dev.title')}
        </h1>
        <p className="muted">{t('dev.intro')}</p>
        <p className="dev-source">
          <SourceCodeLink />
        </p>
        <TakedownLine className="dev-takedown" />
        <section className="dev-build" aria-labelledby={buildId}>
          <h2 id={buildId} className="sr-only">
            {t('dev.build')}
          </h2>
          <dl>
            <div>
              <dt>{t('dev.version')}</dt>
              <dd>{build.version ? <code>{build.version}</code> : unknown}</dd>
            </div>
            <div>
              <dt>{t('dev.commit')}</dt>
              <dd>{build.commit ? <code>{build.commit}</code> : unknown}</dd>
            </div>
            <div>
              <dt>{t('dev.builtAt')}</dt>
              <dd>{builtAt || unknown}</dd>
            </div>
          </dl>
        </section>
        <nav className="guide-tabs" aria-label={t('dev.contents')}>
          <SectionLink section={content.reference.firstId} label={t('dev.reference')} />
          <SectionLink section={content.changelog.firstId} label={t('dev.changelog')} />
        </nav>
      </header>
      <section className="guide-body" lang="vi" aria-label={t('dev.reference')}>
        <MarkdownBlocks blocks={content.reference.blocks} resolve={resolve} />
      </section>
      <section className="guide-body dev-changelog" lang="vi" aria-label={t('dev.changelog')}>
        <MarkdownBlocks blocks={content.changelog.blocks} resolve={resolve} />
      </section>
    </article>
  );
}

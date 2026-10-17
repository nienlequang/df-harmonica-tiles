import { useCallback, useEffect, useMemo } from 'react';
import { DevNotesLink } from '../dev/DevNotesLink';
import { useT } from '../i18n/useT';
import { href, paths } from '../ui/router';
import type { GuideDoc } from '../ui/router';
import { useSettings } from '../ui/settings';
import { appRoot, guideBlocks, resolveLink } from './guideContent';
import { MarkdownBlocks, scrollToSection } from './MarkdownView';
import type { LinkResolver } from './MarkdownView';
import './guide.css';

export interface GuideViewProps {
  doc: GuideDoc;
  /** Id tiêu đề cần cuộn tới (`?s=`), null = đầu trang. */
  section: string | null;
}

/**
 * Route `#/guide` (README, phần người dùng) và `#/guide/cam-am` (prompt AI cho cảm âm) — D-260: người dùng chỉ
 * có link web nên hướng dẫn phải nằm trong bản build (D-257). Nội dung tiếng Việt (bản EN chỉ có tóm tắt đầu
 * README và mục "English version" của prompt AI).
 */
export function GuideView({ doc, section }: GuideViewProps) {
  const t = useT();
  const language = useSettings((s) => s.language);
  const blocks = useMemo(() => guideBlocks(doc, appRoot()), [doc]);
  const resolve = useCallback<LinkResolver>((target) => resolveLink(target, doc), [doc]);

  useEffect(() => {
    const prev = document.title;
    document.title = `${t(doc === 'cam-am' ? 'guide.camam' : 'guide.readme')} — ${t('app.shortTitle')}`;
    return () => {
      document.title = prev;
    };
  }, [doc, t]);

  useEffect(() => {
    if (section && scrollToSection(section)) return;
    try {
      window.scrollTo(0, 0);
    } catch {
      // jsdom
    }
  }, [doc, section]);

  return (
    <article className="guide">
      <nav className="guide-tabs" aria-label={t('guide.docs')}>
        <a
          href={href(paths.guide('readme'))}
          aria-current={doc === 'readme' ? 'page' : undefined}
          className="btn btn-sm btn-secondary"
        >
          {t('guide.readme')}
        </a>
        <a
          href={href(paths.guide('cam-am'))}
          aria-current={doc === 'cam-am' ? 'page' : undefined}
          className="btn btn-sm btn-secondary"
        >
          {t('guide.camam')}
        </a>
      </nav>
      {language === 'en' ? (
        <p className="guide-lang-note">
          {t('guide.viOnly')}{' '}
          <a href={href(paths.guide('cam-am', 'english-version'))}>{t('guide.camamEnglish')}</a>
        </p>
      ) : null}
      <div className="guide-body" lang="vi">
        <MarkdownBlocks blocks={blocks} resolve={resolve} />
      </div>
      {/* Tài liệu cho người phát triển + mã nguồn: cố ý chỉ là link nhỏ, mờ ở chân trang (R7-8, D-444). */}
      <DevNotesLink withSource />
    </article>
  );
}

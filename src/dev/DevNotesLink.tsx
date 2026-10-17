import { useT } from '../i18n/useT';
import { href, paths } from '../ui/router';
import { SourceCodeLink } from './SourceCodeLink';
import './devNotesLink.css';

export interface DevNotesLinkProps {
  /** Thêm link "Mã nguồn (GitHub)" ngay sau "Dev notes" (chân trang Hướng dẫn — D-444). */
  withSource?: boolean;
}

/**
 * Link "Dev notes" ở chân trang Hướng dẫn và Cài đặt (vòng 7 — R7-8): cố ý nhỏ, mờ, không có trên thanh điều hướng —
 * nhưng vẫn đủ tương phản AA (`--text-muted`) và Tab tới được. Chữ "Dev notes" giữ tiếng Anh ở cả hai ngôn ngữ.
 * `withSource`: cùng dòng có link "Mã nguồn (GitHub)" (mở tab mới).
 */
export function DevNotesLink({ withSource = false }: DevNotesLinkProps) {
  const t = useT();
  return (
    <p className="dev-notes-link">
      <a href={href(paths.dev())} title={t('dev.linkTitle')} lang="en">
        {t('dev.link')}
      </a>
      {withSource ? (
        <>
          <span className="dev-notes-sep" aria-hidden="true">
            ·
          </span>
          <SourceCodeLink />
        </>
      ) : null}
    </p>
  );
}

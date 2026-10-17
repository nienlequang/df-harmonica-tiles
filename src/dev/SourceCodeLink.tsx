import { useT } from '../i18n/useT';
import { SOURCE_REPO_URL } from './sourceRepo';

/**
 * Link "Mã nguồn (GitHub)" tới kho mã nguồn công khai (D-444): mở tab mới (`rel="noopener"`, như link ngoài của trang
 * Hướng dẫn — có chữ ẩn "(mở tab mới)" cho trình đọc màn hình). Kiểu chữ do chỗ đặt quyết định (chân trang Hướng dẫn:
 * devNotesLink.css; đầu trang Dev notes: dev.css).
 */
export function SourceCodeLink() {
  const t = useT();
  return (
    <a href={SOURCE_REPO_URL} target="_blank" rel="noopener" title={t('dev.sourceTitle')}>
      {t('dev.source')}
      <span className="sr-only"> {t('guide.newTab')}</span>
    </a>
  );
}

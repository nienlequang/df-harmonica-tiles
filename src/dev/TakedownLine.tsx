import { useT } from '../i18n/useT';
import { SOURCE_ISSUES_URL } from './sourceRepo';
import './devNotesLink.css';

export interface TakedownLineProps {
  /** Lớp của đoạn văn (mặc định `takedown-line` = chữ nhỏ, mờ, căn giữa như chân trang Hướng dẫn). */
  className?: string;
}

/**
 * "Nếu bạn là tác giả và muốn gỡ bài, hãy liên hệ qua GitHub Issues" — bài mẫu là bản ký âm giai điệu để minh họa,
 * bản quyền tác phẩm thuộc tác giả (NOTICE). Chân trang Hướng dẫn và đầu trang Dev notes. Link mở tab mới
 * (`rel="noopener"`, chữ ẩn "(mở tab mới)" như SourceCodeLink).
 */
export function TakedownLine({ className = 'takedown-line' }: TakedownLineProps) {
  const t = useT();
  return (
    <p className={className}>
      {t('dev.takedown')}{' '}
      <a href={SOURCE_ISSUES_URL} target="_blank" rel="noopener">
        {t('dev.takedownLink')}
        <span className="sr-only"> {t('guide.newTab')}</span>
      </a>
    </p>
  );
}

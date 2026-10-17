import type { ParseResult } from '../../core/types';

// Hợp đồng chung cho các modal công cụ của Editor (tap timing, cảm âm, tối ưu lại)
export interface EditorToolProps {
  open: boolean;
  onClose(): void;
  /** Văn bản .harm hiện tại trong editor */
  source: string;
  /** parseHarm(source, { id: songId }) — đã khớp với source */
  parsed: ParseResult;
  songId: string;
  /** Áp dụng văn bản mới (đẩy vào lịch sử Hoàn tác / Làm lại với nhãn label) */
  onApply(nextSource: string, label: string): void;
}

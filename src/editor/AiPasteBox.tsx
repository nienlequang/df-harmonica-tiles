import { useDeferredValue, useId, useMemo, useState } from 'react';
import type { ChangeEvent } from 'react';
import { PasteSummary, usePasteOptions } from '../ai/PasteSummary';
import { useT } from '../i18n/useT';
import { Button } from '../ui/components';
import { href, paths } from '../ui/router';
import { convertPasted } from './camamConvert';

/**
 * Ô "Dán kết quả của AI vào đây" ngay phía trên ô soạn `.harm` của Editor (góp ý 2026-10-16, mục 9 — thay
 * "Công cụ → Nhập cảm âm"). DÁN (Ctrl+V / menu Dán — `inputType` 'insertFromPaste' của chính lần nhập đó, không
 * cờ nào sống sang lần gõ sau) = chuyển ngay sang `.harm` (tông dễ nhất) và THAY nội dung bài, ghi lịch sử nên
 * Hoàn tác được (quyết định: không hỏi trước — Hoàn tác thay cho hộp xác nhận). Gõ tay / kéo thả chữ vào ô thì
 * chỉ xem trước, bấm "Áp dụng" mới thay. Đổi tông ở ô chọn khi bài vẫn đang là kết quả đã đưa vào → áp dụng
 * lại với tông đó. Bài đổi sau đó (Hoàn tác, sửa tay) → bỏ dòng "Đã đưa … vào bài", hiện lại "Áp dụng". AI trả
 * lời nhiều phần: dán tiếp phần sau vào cuối ô — các khối được ghép theo thứ tự (camamConvert). Sau đó bấm Lưu.
 *
 * A11y: dòng kết quả (PasteSummary) và dòng "Đã đưa …" là live region LUÔN có trong DOM (ẩn bằng sr-only khi
 * chưa có gì) — lần dán đầu tiên cũng được đọc.
 */

export interface AiPasteBoxProps {
  /** Nội dung hiện tại của ô soạn (biết bài còn đúng là kết quả đã đưa vào không). */
  source: string;
  /**
   * Đưa nguồn `.harm` đã chuyển vào ô soạn (EditorView ghi lịch sử Hoàn tác, giữ tên / tempo / nhịp của bài
   * khi văn bản dán `pasted` không có). Trả nội dung ô soạn sau đó.
   */
  onApply(harm: string, pasted: string): string;
}

interface Applied {
  text: string;
  transpose: number | null;
  notes: number;
  /** Nội dung ô soạn ngay sau khi đưa vào. */
  result: string;
}

/** Lần nhập là một lần DÁN (không phải gõ / kéo thả). */
function isPasteInput(e: ChangeEvent<HTMLTextAreaElement>): boolean {
  const native = e.nativeEvent as { inputType?: unknown };
  return native.inputType === 'insertFromPaste';
}

export function AiPasteBox({ source, onApply }: AiPasteBoxProps) {
  const t = useT();
  const opts = usePasteOptions();
  const [text, setText] = useState('');
  /** Tông chọn ở ô "Tông" (null = dễ nhất). */
  const [transpose, setTranspose] = useState<number | null>(null);
  /** Lần áp dụng gần nhất (để biết nội dung bài đang là kết quả của ô này). */
  const [applied, setApplied] = useState<Applied | null>(null);
  const inputId = useId();
  const hintId = useId();
  const statusId = useId();

  // gõ tay nhanh không phải chờ chuyển đổi mỗi phím
  const deferred = useDeferredValue(text);
  const conversion = useMemo(
    () => convertPasted(deferred, { ...opts, transpose }),
    [deferred, opts, transpose],
  );
  /** Bài trong ô soạn vẫn đúng là kết quả đã đưa vào (cùng văn bản dán, cùng tông, chưa Hoàn tác / sửa). */
  const appliedNow =
    applied !== null &&
    applied.text === text &&
    applied.transpose === transpose &&
    applied.result === source
      ? applied
      : null;

  /** Chuyển `value` với tông `tp` và đưa vào ô soạn; false nếu không có nốt nào để đưa. */
  const apply = (value: string, tp: number | null): boolean => {
    const c = convertPasted(value, { ...opts, transpose: tp });
    if (c.harm === null) return false;
    const result = onApply(c.harm, value);
    setApplied({ text: value, transpose: tp, notes: c.noteCount, result });
    return true;
  };

  const changeText = (value: string, pasted: boolean) => {
    setText(value);
    setTranspose(null);
    if (pasted) apply(value, null);
  };

  const changeKey = (tp: number | null) => {
    setTranspose(tp);
    // bài vẫn đang là kết quả của ô này → đổi tông là áp dụng lại luôn (bài đã đổi: chỉ xem trước + Áp dụng)
    if (applied !== null && applied.text === text && applied.result === source) apply(text, tp);
  };

  const clear = () => {
    setText('');
    setTranspose(null);
    setApplied(null);
    document.getElementById(inputId)?.focus();
  };

  const hasText = text.trim() !== '';
  const canApply = appliedNow === null && conversion.harm !== null && deferred === text;

  return (
    <div className="editor-ai">
      <div className="editor-ai-head">
        <label htmlFor={inputId} className="editor-ai-label">
          {t('ai.paste.label')}
        </label>
        {/* Prompt ở trang "Tạo bài với AI"; tab mới để không rời Editor (chưa lưu / hashGuard). */}
        <a className="editor-ai-prompt" href={href(paths.ai())} target="_blank" rel="noopener">
          {t('editor.aiPaste.getPrompt')}
          <span className="sr-only"> ({t('ai.step2.newTab')})</span>
        </a>
      </div>
      <textarea
        id={inputId}
        className="editor-ai-input"
        value={text}
        rows={2}
        spellCheck={false}
        autoComplete="off"
        autoCapitalize="off"
        placeholder={t('ai.paste.placeholder')}
        aria-describedby={hasText ? statusId : hintId}
        onChange={(e) => changeText(e.currentTarget.value, isPasteInput(e))}
      />
      {hasText ? null : (
        <p id={hintId} className="field-hint editor-ai-hint">
          {t('editor.aiPaste.hint')}
        </p>
      )}
      {/* Live region luôn có (chưa dán gì → ẩn bằng sr-only): lần dán đầu cũng được trình đọc màn hình đọc. */}
      <div className={hasText ? 'editor-ai-result' : 'sr-only'}>
        <PasteSummary
          conversion={conversion}
          statusId={statusId}
          onTransposeChange={changeKey}
          quietEmpty
        />
        <p className={appliedNow ? 'editor-ai-applied' : 'sr-only'} role="status">
          {appliedNow ? (
            <>
              <span className="paste-status-icon" aria-hidden="true">
                ✓
              </span>{' '}
              {t('editor.aiPaste.applied', { n: appliedNow.notes })}
            </>
          ) : null}
        </p>
        {hasText ? (
          <div className="row editor-ai-actions">
            {canApply ? (
              <Button size="sm" variant="primary" onClick={() => apply(text, transpose)}>
                {t('editor.aiPaste.apply')}
              </Button>
            ) : null}
            <Button size="sm" variant="ghost" onClick={clear}>
              {t('editor.aiPaste.clear')}
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

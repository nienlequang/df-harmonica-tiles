import { useId, useMemo } from 'react';
import { midiName, playableRange } from '../core/keys';
import { convertPasted } from '../editor/camamConvert';
import type { PasteConversion, PasteConvertOptions, PasteIssue } from '../editor/camamConvert';
import { transposeLabel } from '../editor/OptimizerPanel';
import { useT } from '../i18n/useT';
import type { TFunction } from '../i18n/useT';
import { Select } from '../ui/components';
import { formatDiagnostic } from '../ui/diagnostics';
import { useSettings } from '../ui/settings';
import './ai.css';

/**
 * Phần dùng chung của trang "Tạo bài với AI" và ô dán của Editor (góp ý 2026-10-16): tùy chọn chuyển đổi
 * theo Cài đặt, dòng kết quả ("N nốt · tông … · 0 lỗi" hoặc lời nhắc thân thiện), danh sách chỗ không
 * đọc được (chỉ tới đúng dòng đã dán) và ô chọn tông tùy chọn.
 */

/** Số chỗ không đọc được liệt kê (phần còn lại gộp "…và N chỗ khác"). */
const MAX_ISSUES = 5;

/** Tùy chọn của `convertPasted` theo Cài đặt (quãng gốc, kiểu điều khiển) + câu cảnh báo gập quãng. */
export function usePasteOptions(): PasteConvertOptions {
  const t = useT();
  const baseOctave = useSettings((s) => s.baseOctave);
  const scheme = useSettings((s) => s.controlScheme);
  const mobileSemitone = useSettings((s) => s.mobileSemitone);
  return useMemo(() => {
    const { min, max } = playableRange(baseOctave);
    const range = `${midiName(min)}–${midiName(max)}`;
    return {
      baseOctave,
      scheme,
      mobileSemitone,
      warningText: (n: number) => t('editor.tools.foldWarning', { n, range }),
    };
  }, [baseOctave, scheme, mobileSemitone, t]);
}

/** `convertPasted` theo Cài đặt, nhớ kết quả theo (văn bản, tông). */
export function usePasteConversion(text: string, transpose: number | null): PasteConversion {
  const opts = usePasteOptions();
  return useMemo(() => convertPasted(text, { ...opts, transpose }), [text, opts, transpose]);
}

function issueMessage(t: TFunction, issue: PasteIssue): string {
  switch (issue.kind) {
    case 'prose':
      return t('ai.result.issueProse');
    case 'camam':
      return issue.diag.code === 'invalid-duration'
        ? t('ai.result.issueDuration', { token: issue.diag.token })
        : t('ai.result.issueToken', { token: issue.diag.token });
    case 'harm':
      return formatDiagnostic(t, issue.diag);
  }
}

/** Nhãn phương án tông: phương án đầu (dễ nhất) có hậu tố "— dễ nhất". */
function keyOptionLabel(t: TFunction, transpose: number, best: boolean): string {
  const key = transposeLabel(t, transpose);
  return best ? t('ai.keyBest', { key }) : key;
}

export interface PasteSummaryProps {
  conversion: PasteConversion;
  /** Đổi tông (null = dễ nhất). Không truyền → không hiện ô chọn tông. */
  onTransposeChange?: (transpose: number | null) => void;
  /** id của dòng kết quả (ô dán trỏ `aria-describedby` tới đây). */
  statusId?: string;
  /**
   * Chưa dán gì → dòng kết quả rỗng (không câu "Chưa có kết quả…") nhưng VẪN là live region trong DOM, để
   * lần dán đầu được đọc (ô dán của Editor có câu hướng dẫn riêng).
   */
  quietEmpty?: boolean;
  className?: string;
}

export function PasteSummary({
  conversion: c,
  onTransposeChange,
  statusId,
  quietEmpty = false,
  className,
}: PasteSummaryProps) {
  const t = useT();
  const keyHintId = useId();
  const ok = c.kind === 'camam' || c.kind === 'harm';
  const warn = c.kind === 'prompt' || c.kind === 'invalid' || (ok && c.issues.length > 0);

  let status: string;
  if (c.kind === 'empty') status = quietEmpty ? '' : t('ai.result.empty');
  else if (c.kind === 'prompt') status = t('ai.result.prompt');
  else if (c.kind === 'invalid') status = t('ai.result.invalid');
  else {
    const parts = [t('ai.result.notes', { n: c.noteCount })];
    // Nhiều khối code đã ghép (AI chia bài dài thành nhiều phần) — nói rõ để người dùng biết không mất phần nào.
    if (c.blocks > 1) parts.push(t('ai.result.blocks', { n: c.blocks }));
    if (c.kind === 'harm') parts.push(t('ai.result.harm'));
    else if (c.placement) {
      parts.push(
        c.placement === c.keyOptions[0]
          ? t('ai.result.keyBest')
          : t('ai.result.key', { key: transposeLabel(t, c.placement.transpose) }),
      );
    }
    parts.push(
      c.issues.length > 0 ? t('ai.result.issues', { n: c.issues.length }) : t('ai.result.noErrors'),
    );
    status = parts.join(' · ');
  }

  const showKey = onTransposeChange !== undefined && c.kind === 'camam' && c.keyOptions.length > 1;
  const best = c.keyOptions[0];

  return (
    <div className={['paste-summary', className].filter(Boolean).join(' ')}>
      <p
        id={statusId}
        role="status"
        className={[
          'paste-status',
          ok ? 'is-ok' : '',
          warn ? 'is-warn' : '',
          c.kind === 'empty' ? 'muted' : '',
        ]
          .filter(Boolean)
          .join(' ')}
      >
        {ok ? (
          <span className="paste-status-icon" aria-hidden="true">
            {c.issues.length > 0 ? '!' : '✓'}
          </span>
        ) : null}
        {status ? <span>{status}</span> : null}
      </p>
      {ok && c.issues.length > 0 ? (
        <ul className="paste-issues" aria-label={t('ai.result.issuesLabel')}>
          {c.issues.slice(0, MAX_ISSUES).map((issue) => (
            <li key={`${issue.kind}:${issue.line}:${issue.column}`}>
              {t('ai.result.issueAt', { line: issue.line, message: issueMessage(t, issue) })}
            </li>
          ))}
          {c.issues.length > MAX_ISSUES ? (
            <li>{t('ai.result.issueMore', { n: c.issues.length - MAX_ISSUES })}</li>
          ) : null}
        </ul>
      ) : null}
      {showKey && c.placement && best ? (
        <div className="paste-key">
          <Select
            label={t('ai.key')}
            aria-describedby={keyHintId}
            value={String(c.placement.transpose)}
            options={c.keyOptions.map((p) => ({
              value: String(p.transpose),
              label: keyOptionLabel(t, p.transpose, p === best),
            }))}
            onChange={(v) => {
              const n = Number(v);
              onTransposeChange(n === best.transpose ? null : n);
            }}
          />
          <p id={keyHintId} className="field-hint">
            {t('ai.keyHint')}
          </p>
        </div>
      ) : null}
    </div>
  );
}

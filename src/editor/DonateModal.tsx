import { useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  DEFAULT_DONATE_LIMIT,
  MIN_DONATE_LIMIT,
  buildDonateText,
  chunkDonateText,
} from '../core/donate';
import { serializeMobileText } from '../core/mobileText';
import type { Song } from '../core/types';
import { useT } from '../i18n/useT';
import type { TFunction } from '../i18n/useT';
import { Button, Modal, Select, copyText } from '../ui/components';
import { useModifierLabels } from '../ui/modLabels';
import type { ModifierLabels } from '../ui/modLabels';
import { useSettings } from '../ui/settings';
import type { ControlScheme, MobileSemitone } from '../ui/settings';
import './tools/tools.css';

/**
 * Giới hạn ký tự mỗi tin trong UI. Sàn = MIN_DONATE_LIMIT của core (30): thấp hơn thì core vẫn dùng
 * 30 và các phần sẽ dài hơn số người dùng nhập.
 */
export const DONATE_LIMIT_MIN = Math.max(20, MIN_DONATE_LIMIT);
export const DONATE_LIMIT_MAX = 2000;
/** Nối các phần khi "Sao chép tất cả": dòng trống giữa các phần (parser bỏ qua dòng trống). */
export const DONATE_JOIN = '\n\n';
const COPIED_MS = 2000;

/** Chuỗi ô nhập → giới hạn hợp lệ, null nếu không phải số nguyên trong miền. */
export function parseDonateLimit(text: string): number | null {
  const s = text.trim();
  if (!/^\d+$/.test(s)) return null;
  const n = Number(s);
  return n >= DONATE_LIMIT_MIN && n <= DONATE_LIMIT_MAX ? n : null;
}

export interface DonateModalProps {
  open: boolean;
  onClose(): void;
  song: Song;
  /**
   * Số lỗi cú pháp của văn bản đang soạn. Donate text sinh từ model (D-084) nên token lỗi bị bỏ /
   * sửa lại — > 0 thì modal cảnh báo tin gửi đi khác văn bản.
   */
  errorCount?: number;
  /** Có thì cảnh báo lỗi kèm nút đóng modal và nhảy tới lỗi đầu tiên. */
  onShowErrors?(): void;
}

type Copied = { key: number | 'all'; ok: boolean } | null;

export interface MobileDonateOptions {
  durations: boolean;
  sectionHeaders: boolean;
  semitone: MobileSemitone;
  labels: ModifierLabels;
  /** Dòng chú thích đầu (không có `//`); bỏ trống = không ghi. */
  legend?: string;
}

/**
 * Donate text kiểu Mobile: `serializeMobileText` (số nút 1–8 + chạm đổi chế độ), bỏ dòng trống như
 * `buildDonateText`. Chỉ để người chơi đọc — không dán lại vào trình soạn.
 */
export function buildMobileDonateText(song: Song, opts: MobileDonateOptions): string {
  const text = serializeMobileText(song, {
    durations: opts.durations,
    sectionHeaders: opts.sectionHeaders,
    semitone: opts.semitone,
    labels: {
      left: opts.labels.left,
      right: opts.labels.right,
      natural: opts.labels.natural,
      scroll: opts.labels.scroll,
    },
    ...(opts.legend ? { legend: opts.legend } : {}),
  });
  return text
    .split(/\r\n?|\n/)
    .filter((l) => l.trim() !== '')
    .join('\n');
}

/** Dòng chú thích đầu của donate text Mobile (tên nút theo tên gọi người dùng đặt). */
export function mobileLegend(
  t: TFunction,
  labels: ModifierLabels,
  semitone: MobileSemitone,
): string {
  return t('editor.donateMobileLegend', {
    right: labels.right,
    natural: labels.natural,
    left: labels.left,
    scroll: labels.scroll,
    semitone:
      semitone === 'oneShot'
        ? t('editor.donateMobileSemitoneOneShot')
        : t('editor.donateMobileSemitoneToggle'),
  });
}

/**
 * "Donate text" (spec §6): chọn kiểu PC / Mobile, có/không độ dài, tên đoạn; chia theo giới hạn N
 * ký tự tại ranh giới dòng, đánh số `k/n`; xem trước trực tiếp, sao chép từng phần hoặc tất cả.
 */
export function DonateModal({
  open,
  onClose,
  song,
  errorCount = 0,
  onShowErrors,
}: DonateModalProps) {
  const t = useT();
  const { left, right, natural, scroll } = useModifierLabels();
  const labels = useMemo(
    (): ModifierLabels => ({ left, right, natural, scroll }),
    [left, right, natural, scroll],
  );
  const mobileSemitone = useSettings((s) => s.mobileSemitone);
  // mặc định theo Cài đặt → Kiểu điều khiển (modal chỉ mount khi mở)
  const [style, setStyle] = useState<ControlScheme>(() => useSettings.getState().controlScheme);
  const [durations, setDurations] = useState(true);
  const [sectionHeaders, setSectionHeaders] = useState(true);
  const [limitText, setLimitText] = useState(String(DEFAULT_DONATE_LIMIT));
  const [lastLimit, setLastLimit] = useState(DEFAULT_DONATE_LIMIT);
  const [copied, setCopied] = useState<Copied>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ids = {
    dur: useId(),
    durHint: useId(),
    sec: useId(),
    limit: useId(),
    mobileNote: useId(),
  };
  const limitHintId = useId();

  const parsedLimit = parseDonateLimit(limitText);
  // Ô nhập đang dở (rỗng, ngoài miền): giữ giới hạn hợp lệ gần nhất.
  const limit = parsedLimit ?? lastLimit;

  const legend = mobileLegend(t, labels, mobileSemitone);
  const text = useMemo(
    () =>
      style === 'mobile'
        ? buildMobileDonateText(song, {
            durations,
            sectionHeaders,
            semitone: mobileSemitone,
            labels,
            legend,
          })
        : buildDonateText(song, { durations, sectionHeaders }),
    [song, style, durations, sectionHeaders, mobileSemitone, labels, legend],
  );
  const chunks = useMemo(() => chunkDonateText(text, limit), [text, limit]);

  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = null;
    };
  }, []);

  const flash = (key: number | 'all', ok: boolean) => {
    // copyText là async: modal có thể đã đóng khi nó xong → không đặt timer mới.
    if (!alive.current) return;
    setCopied({ key, ok });
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      setCopied(null);
    }, COPIED_MS);
  };

  const copy = async (key: number | 'all', value: string) => {
    const ok = await copyText(value);
    flash(key, ok);
  };

  const copyLabel = (key: number | 'all', idle: string) => {
    if (copied?.key !== key) return idle;
    return copied.ok ? t('common.copied') : t('editor.donateCopyFailed');
  };

  const n = chunks.length;
  return (
    <Modal open={open} onClose={onClose} title={t('editor.donateTitle')} size="lg">
      <div className="donate stack">
        <p className="muted">{t('editor.donateIntro')}</p>
        {errorCount > 0 ? (
          <div className="tool-note tool-note-warn donate-errors" role="note">
            <p>{t('editor.donateErrors', { n: errorCount })}</p>
            {onShowErrors ? (
              <Button size="sm" onClick={onShowErrors}>
                {t('editor.donateShowError')}
              </Button>
            ) : null}
          </div>
        ) : null}
        <fieldset className="donate-options">
          <legend className="sr-only">{t('editor.donateTitle')}</legend>
          <Select
            className="donate-style"
            label={t('editor.donateStyle')}
            value={style}
            options={[
              { value: 'pc', label: t('editor.donateStylePc') },
              { value: 'mobile', label: t('editor.donateStyleMobile') },
            ]}
            aria-describedby={style === 'mobile' ? ids.mobileNote : undefined}
            onChange={setStyle}
          />

          <div className="donate-check">
            <input
              id={ids.dur}
              type="checkbox"
              checked={durations}
              aria-describedby={ids.durHint}
              onChange={(e) => setDurations(e.currentTarget.checked)}
            />
            <label htmlFor={ids.dur}>{t('editor.donateDurations')}</label>
            <span id={ids.durHint} className="field-hint">
              {t('editor.donateDurationsHint')}
            </span>
          </div>
          <div className="donate-check">
            <input
              id={ids.sec}
              type="checkbox"
              checked={sectionHeaders}
              onChange={(e) => setSectionHeaders(e.currentTarget.checked)}
            />
            <label htmlFor={ids.sec}>{t('editor.donateSections')}</label>
          </div>
          <div className="field donate-limit">
            <label htmlFor={ids.limit}>{t('editor.donateLimit')}</label>
            <input
              id={ids.limit}
              type="number"
              inputMode="numeric"
              min={DONATE_LIMIT_MIN}
              max={DONATE_LIMIT_MAX}
              step={1}
              value={limitText}
              aria-invalid={parsedLimit === null || undefined}
              aria-describedby={limitHintId}
              onChange={(e) => {
                const v = e.currentTarget.value;
                setLimitText(v);
                const p = parseDonateLimit(v);
                if (p !== null) setLastLimit(p);
              }}
            />
            <p id={limitHintId} className="field-hint" aria-live="polite">
              {parsedLimit === null
                ? t('editor.donateLimitInvalid', {
                    min: DONATE_LIMIT_MIN,
                    max: DONATE_LIMIT_MAX,
                    used: limit,
                  })
                : t('editor.donateLimitHint', {
                    min: DONATE_LIMIT_MIN,
                    max: DONATE_LIMIT_MAX,
                    def: DEFAULT_DONATE_LIMIT,
                  })}
            </p>
          </div>
        </fieldset>
        {style === 'mobile' ? (
          <p id={ids.mobileNote} className="tool-note donate-mobile-note">
            {t('editor.donateMobileNote')}
          </p>
        ) : null}

        {n === 0 ? (
          <p className="muted">{t('editor.donateEmpty')}</p>
        ) : (
          <>
            <div className="row donate-summary">
              <p className="muted" aria-live="polite">
                {t('editor.donateSummary', { chars: text.length, n })}
              </p>
              <span className="spacer" />
              <Button
                variant="primary"
                size="sm"
                onClick={() => void copy('all', chunks.join(DONATE_JOIN))}
              >
                {copyLabel('all', t('editor.donateCopyAll'))}
              </Button>
            </div>
            <ol className="donate-chunks" aria-label={t('editor.donateParts')}>
              {chunks.map((chunk, i) => (
                <li key={i} className="donate-chunk">
                  <div className="donate-chunk-head">
                    <span className="donate-chunk-title">
                      {t('editor.donatePart', { k: i + 1, n })}
                    </span>
                    <span className="muted donate-chunk-count">
                      {t('editor.donateChars', { n: chunk.length, limit })}
                    </span>
                    <span className="spacer" />
                    <Button
                      size="sm"
                      aria-label={
                        copied?.key === i
                          ? copyLabel(i, '')
                          : t('editor.donateCopyPart', { k: i + 1 })
                      }
                      onClick={() => void copy(i, chunk)}
                    >
                      {copyLabel(i, t('common.copy'))}
                    </Button>
                  </div>
                  <pre className="donate-chunk-text">{chunk}</pre>
                </li>
              ))}
            </ol>
          </>
        )}
        <p className="sr-only" role="status">
          {copied ? (copied.ok ? t('common.copied') : t('editor.donateCopyFailed')) : ''}
        </p>
      </div>
    </Modal>
  );
}

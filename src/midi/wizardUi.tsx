import type { ReactNode, RefObject } from 'react';
import { useEffect, useId, useRef, useState } from 'react';
import type { TimeSig } from '../core/types';
import type { StringKey } from '../i18n/strings';
import { useT } from '../i18n/useT';
import { Button } from '../ui/components';
import { toast } from '../ui/toast';
import type { OverlapPolicy } from './types';
import type { TrackPreview } from './useTrackPreview';
import { PREVIEW_MAX_SEC } from './useTrackPreview';

/** Khung dùng chung của wizard "Tạo bài từ file" / "Thu melody": bước, ô nhập, nút nghe thử. */

export const BPM_MIN = 20;
export const BPM_MAX = 400;
/** Số dòng .harm hiện ở bước 5. */
export const HARM_PREVIEW_LINES = 24;

/** Nhãn của QUANTIZE_GRIDS (cùng thứ tự). */
export const GRID_LABELS: readonly StringKey[] = [
  'midi.grid.quarter',
  'midi.grid.eighth',
  'midi.grid.triplet',
  'midi.grid.off',
];
export const OVERLAP_POLICIES: readonly OverlapPolicy[] = ['highest', 'lowest', 'longest'];

export function formatBpm(bpm: number): string {
  return String(Math.round(bpm * 100) / 100);
}

export function formatTimeSig(ts: TimeSig): string {
  return `${ts.num}/${ts.den}`;
}

export function StepIndicator({
  labels,
  current,
}: {
  labels: readonly StringKey[];
  current: number;
}) {
  const t = useT();
  return (
    <ol className="midi-steps" aria-label={t('midi.steps')}>
      {labels.map((key, i) => (
        <li
          key={i}
          className={i === current ? 'is-current' : i < current ? 'is-done' : undefined}
          aria-current={i === current ? 'step' : undefined}
        >
          <span className="midi-step-num" aria-hidden="true">
            {i + 1}
          </span>
          <span>{t(key)}</span>
        </li>
      ))}
    </ol>
  );
}

interface StepFrameProps {
  title: string;
  index: number;
  total: number;
  children: ReactNode;
  onBack?: () => void;
  onNext?: () => void;
  nextDisabled?: boolean;
  /** Nút chính thay cho "Tiếp" (bước cuối). */
  primary?: ReactNode;
}

/** Một bước: tiêu đề (nhận focus khi đổi bước), nội dung, nút Quay lại / Tiếp. */
export function StepFrame({
  title,
  index,
  total,
  children,
  onBack,
  onNext,
  nextDisabled,
  primary,
}: StepFrameProps) {
  const t = useT();
  const headingId = useId();
  return (
    <section className="midi-step card stack" aria-labelledby={headingId}>
      <header className="midi-step-head">
        <p className="midi-step-count muted">{t('midi.stepOf', { n: index + 1, total })}</p>
        <h2 id={headingId} tabIndex={-1} data-step-heading="">
          {title}
        </h2>
      </header>
      {children}
      {onBack || onNext || primary ? (
        <div className="midi-nav">
          {onBack ? <Button onClick={onBack}>{t('midi.back')}</Button> : null}
          <span className="spacer" />
          {primary ??
            (onNext ? (
              <Button variant="primary" onClick={onNext} disabled={nextDisabled}>
                {t('midi.next')}
              </Button>
            ) : null)}
        </div>
      ) : null}
    </section>
  );
}

/** Focus tiêu đề bước mỗi khi đổi bước (không làm lúc mount). */
export function useStepFocus(step: number, root: RefObject<HTMLElement | null>): void {
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    // bước đang hiện (bước "Thu" bị ẩn chứ không unmount khi sang bước sau)
    const headings = root.current?.querySelectorAll<HTMLElement>('[data-step-heading]') ?? [];
    Array.from(headings)
      .find((h) => h.closest('[hidden]') === null)
      ?.focus();
  }, [step, root]);
}

interface NumberFieldProps {
  label: ReactNode;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step?: number | 'any';
  integer?: boolean;
  hint?: ReactNode;
  disabled?: boolean;
}

/** Ô số: giữ chữ đang gõ, chỉ báo giá trị hợp lệ (trong [min, max]); rời ô thì về giá trị hiện tại. */
export function NumberField({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  integer = false,
  hint,
  disabled,
}: NumberFieldProps) {
  const id = useId();
  const hintId = useId();
  const [text, setText] = useState(() => formatBpm(value));
  const [synced, setSynced] = useState(value);
  if (synced !== value) {
    // giá trị đổi từ ngoài (vd. file mới) → hiện lại
    setSynced(value);
    setText(formatBpm(value));
  }
  const parse = (s: string): number | null => {
    if (s.trim() === '') return null;
    const n = Number(s);
    if (!Number.isFinite(n) || n < min || n > max) return null;
    if (integer && !Number.isInteger(n)) return null;
    return n;
  };
  const invalid = parse(text) === null;
  return (
    <div className="field midi-number">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type="number"
        inputMode="decimal"
        min={min}
        max={max}
        step={step}
        value={text}
        disabled={disabled}
        aria-invalid={invalid || undefined}
        aria-describedby={hint ? hintId : undefined}
        onChange={(e) => {
          const s = e.currentTarget.value;
          setText(s);
          const n = parse(s);
          if (n !== null && n !== value) {
            setSynced(n);
            onChange(n);
          }
        }}
        onBlur={() => setText(formatBpm(value))}
      />
      {hint ? (
        <p id={hintId} className="field-hint">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export function TextField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: ReactNode;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.currentTarget.value)}
      />
    </div>
  );
}

export function PreviewButton({
  preview,
  previewKey,
  notes,
  bpm,
  name,
}: {
  preview: TrackPreview;
  previewKey: string;
  notes: readonly { startBeat: number; beats: number; midi: number }[];
  bpm: number;
  name: string;
}) {
  const t = useT();
  const playing = preview.playingKey === previewKey;
  const onClick = () => {
    void preview.toggle(previewKey, notes, bpm).then((r) => {
      if (r === 'blocked') toast(t('midi.preview.audioBlocked'), 'error');
    });
  };
  return (
    <Button
      size="sm"
      onClick={onClick}
      aria-pressed={playing}
      aria-label={
        playing
          ? t('midi.preview.stopAria', { name })
          : t('midi.preview.playAria', { name, sec: PREVIEW_MAX_SEC })
      }
    >
      {playing ? t('midi.preview.stop') : t('midi.preview.play')}
    </Button>
  );
}

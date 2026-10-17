import { useEffect, useRef, useState } from 'react';
import type { Lang, StringKey } from '../i18n/strings';
import { useT } from '../i18n/useT';
import type { TFunction } from '../i18n/useT';
import { Button, Modal, Toggle } from '../ui/components';
import { useSettings } from '../ui/settings';
import type { PracticeScore } from './practice.types';
import { canVibrate, hasCoarsePointer, usePadVibrate } from './padPrefs';
import type { PracticeFlash, PracticeMidiStatus, PracticeUiState } from './usePlayerEngine';
import './player.css';

/**
 * Giao diện practice mode (spec §6): dải điểm trực tiếp (combo, perfect / good / miss, % chính
 * xác), chữ PERFECT / GOOD / MISS nháy gần hit line, bảng kết quả cuối bài. Luôn ghi rõ practice
 * chỉ nhận input khi tab đang focus. Modifier chỉ bằng chuột (không có phím bàn phím thay thế). Kiểu Mobile:
 * chỉ chạm / click bàn nút trên màn hình — HUD không nói gì về bàn phím / MIDI.
 */

/** Đọc kết quả cho screen reader không dày hơn mức này (ms). */
export const ANNOUNCE_INTERVAL_MS = 1500;

const GRADE_KEY: Readonly<Record<PracticeFlash['kind'], StringKey>> = {
  perfect: 'practice.grade.perfect',
  good: 'practice.grade.good',
  miss: 'practice.grade.miss',
  wrong: 'practice.grade.wrong',
  range: 'practice.grade.range',
};

/** Trạng thái MIDI thật (không có câu khi không dùng MIDI / đang xin quyền). */
const MIDI_STATUS_KEY: Readonly<Record<PracticeMidiStatus, StringKey | null>> = {
  off: null,
  pending: null,
  listening: 'practice.midiOn',
  denied: 'practice.midiDenied',
  disconnected: 'practice.midiDisconnected',
};

/** % chính xác theo ngôn ngữ, tối đa 1 chữ số thập phân ("87,5" / "87.5"). */
export function formatAccuracy(accuracy: number, lang: Lang): string {
  const v = Number.isFinite(accuracy) ? Math.min(100, Math.max(0, accuracy)) : 0;
  return new Intl.NumberFormat(lang === 'vi' ? 'vi-VN' : 'en-US', {
    maximumFractionDigits: 1,
  }).format(v);
}

/**
 * % chính xác "tới giờ" cho dải điểm trực tiếp: tính trên số nốt đã chấm (PracticeScore.accuracy
 * tính trên cả bài nên chỉ đúng nghĩa ở bảng kết quả cuối bài). Chưa chấm nốt nào → 0.
 */
export function liveAccuracy(score: PracticeScore): number {
  return score.judged > 0 ? ((score.perfect + 0.5 * score.good) / score.judged) * 100 : 0;
}

/** Lệch thời gian có dấu ("+35", "−12"); 0 → "0". */
export function formatDelta(ms: number): string {
  const r = Math.round(ms);
  if (r === 0) return '0';
  return r > 0 ? `+${r}` : `−${Math.abs(r)}`;
}

/** Giữ chữ mới nhất nhưng đổi không dày hơn `intervalMs` (aria-live không bị spam). */
function useThrottledText(text: string, intervalMs: number): string {
  const [shown, setShown] = useState('');
  const lastAt = useRef(-Infinity);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    if (!text) return;
    const wait = lastAt.current + intervalMs - Date.now();
    if (wait <= 0) {
      lastAt.current = Date.now();
      setShown(text);
      return;
    }
    timer.current = setTimeout(() => {
      timer.current = null;
      lastAt.current = Date.now();
      setShown(text);
    }, wait);
  }, [text, intervalMs]);
  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );
  return shown;
}

function announcement(t: TFunction, practice: PracticeUiState): string {
  const last = practice.last;
  if (!last) return '';
  return t('practice.announce', { grade: t(GRADE_KEY[last.kind]), combo: practice.score.combo });
}

export interface PracticeHudProps {
  practice: PracticeUiState;
}

/** Dải điểm trực tiếp dưới thanh điều khiển (không phủ lên khu tiles). */
export function PracticeHud({ practice }: PracticeHudProps) {
  const t = useT();
  const lang = useSettings((s) => s.language);
  // Kiểu điều khiển Mobile: bàn nút kiểu game chạm được (MobilePad) + công tắc rung cục bộ.
  const touch = useSettings((s) => s.controlScheme) === 'mobile';
  const [vibrate, setVibrate] = usePadVibrate();
  // Kiểu Mobile chỉ nhận chạm / click trên bàn nút (góp ý 2026-10-15): không có câu nào về bàn phím
  // (tab focus) hay đàn MIDI — engine không nghe chúng.
  const keyboardNotes = !touch;
  const { score } = practice;
  const midiKey = touch ? null : MIDI_STATUS_KEY[practice.midi];
  const spoken = useThrottledText(announcement(t, practice), ANNOUNCE_INTERVAL_MS);
  const status = practice.waiting
    ? t('practice.waiting')
    : practice.mode === 'wait'
      ? t(touch ? 'practice.mode.waitHintTouch' : 'practice.mode.waitHint')
      : t('practice.mode.scoreHint');
  return (
    <section className="practice-hud" aria-label={t('practice.hud')}>
      <dl className="practice-stats">
        <div className="practice-stat practice-stat-combo">
          <dt>{t('practice.combo')}</dt>
          <dd>{score.combo}</dd>
        </div>
        <div className="practice-stat practice-stat-perfect">
          <dt>{t('practice.perfect')}</dt>
          <dd>{score.perfect}</dd>
        </div>
        <div className="practice-stat practice-stat-good">
          <dt>{t('practice.good')}</dt>
          <dd>{score.good}</dd>
        </div>
        <div className="practice-stat practice-stat-miss">
          <dt>{t('practice.miss')}</dt>
          <dd>{score.miss}</dd>
        </div>
        <div className="practice-stat practice-stat-accuracy">
          <dt>{t('practice.accuracy')}</dt>
          <dd>{t('practice.percent', { n: formatAccuracy(liveAccuracy(score), lang) })}</dd>
        </div>
        <div className="practice-stat practice-stat-wrong">
          <dt>{t('practice.wrong')}</dt>
          <dd>{practice.wrong}</dd>
        </div>
      </dl>
      <div className="practice-notes">
        <p className={practice.waiting ? 'practice-status is-waiting' : 'practice-status'}>
          {status}
        </p>
        {touch ? (
          <p className="practice-note practice-touch-note">
            {t('practice.touchNote')}
            {hasCoarsePointer() ? null : ` ${t('practice.touchOnly')}`}
          </p>
        ) : null}
        {keyboardNotes || midiKey ? (
          <p className="practice-note">
            {keyboardNotes ? t('practice.focusNote') : null}
            {midiKey ? `${keyboardNotes ? ' ' : ''}${t(midiKey)}` : ''}
          </p>
        ) : null}

        {touch && canVibrate() ? (
          <Toggle
            className="practice-vibrate"
            label={t('practice.vibrate')}
            title={t('practice.vibrateHint')}
            checked={vibrate}
            onChange={setVibrate}
          />
        ) : null}
      </div>
      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {spoken}
      </p>
    </section>
  );
}

/** PERFECT / GOOD / MISS / SAI nháy ngay trên hit line (đặt trong hộp canvas, không bắt chuột). */
export function PracticeGradeFlash({ last }: { last: PracticeFlash | null }) {
  const t = useT();
  return (
    <div className="practice-flash-slot" aria-hidden="true">
      {last ? (
        <span key={last.seq} className={`practice-flash practice-flash-${last.kind}`}>
          {t(GRADE_KEY[last.kind])}
          {last.deltaMs !== null && last.kind !== 'miss' ? (
            <small className="practice-flash-delta">
              {t('practice.deltaMs', { n: formatDelta(last.deltaMs) })}
            </small>
          ) : null}
        </span>
      ) : null}
    </div>
  );
}

export interface PracticeResultsProps {
  /** null = đóng. */
  results: PracticeScore | null;
  wrong: number;
  onReplay: () => void;
  onClose: () => void;
}

/** Bảng kết quả cuối bài: % chính xác, số perfect / good / miss, combo cao nhất, "Chơi lại". */
export function PracticeResults({ results, wrong, onReplay, onClose }: PracticeResultsProps) {
  const t = useT();
  const lang = useSettings((s) => s.language);
  return (
    <Modal
      open={results !== null}
      title={t('practice.resultsTitle')}
      onClose={onClose}
      // Người chơi có thể còn đang bấm chuột (modifier) lúc bài hết: một cú bấm lên nền không được làm
      // mất bảng kết quả (không mở lại được) — chỉ Esc / nút đóng (D-144).
      closeOnBackdrop={false}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.close')}
          </Button>
          <Button variant="primary" onClick={onReplay} data-autofocus>
            {t('practice.replay')}
          </Button>
        </>
      }
    >
      {results ? (
        <div className="practice-results">
          <p className="practice-results-accuracy">
            <span>{t('practice.accuracy')}</span>
            <strong>{t('practice.percent', { n: formatAccuracy(results.accuracy, lang) })}</strong>
          </p>
          <dl className="practice-results-list">
            <div className="practice-stat-perfect">
              <dt>{t('practice.perfect')}</dt>
              <dd>{results.perfect}</dd>
            </div>
            <div className="practice-stat-good">
              <dt>{t('practice.good')}</dt>
              <dd>{results.good}</dd>
            </div>
            <div className="practice-stat-miss">
              <dt>{t('practice.miss')}</dt>
              <dd>{results.miss}</dd>
            </div>
            <div>
              <dt>{t('practice.maxCombo')}</dt>
              <dd>{results.maxCombo}</dd>
            </div>
            <div>
              <dt>{t('practice.wrong')}</dt>
              <dd>{wrong}</dd>
            </div>
            <div>
              <dt>{t('practice.totalNotes')}</dt>
              <dd>{results.total}</dd>
            </div>
          </dl>
        </div>
      ) : null}
    </Modal>
  );
}

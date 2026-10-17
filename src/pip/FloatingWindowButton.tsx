/**
 * Nút "Cửa sổ nổi" ở thanh dọc bên phải của màn chơi (kiểu điều khiển PC — góp ý 2026-10-15 B). Là nút
 * bật / tắt (aria-pressed): bấm khi đóng = mở cửa sổ nổi cho bài này; bấm khi đang mở = đóng cửa sổ nổi.
 * Đang mở: nhãn nhỏ "Đang mở" + câu trạng thái cho screen reader; cửa sổ nổi đang hiện bài khác → thêm
 * nút "Chuyển sang bài này". Trình duyệt không hỗ trợ / bị chặn → bấm vẫn được, hiện một dòng giải thích
 * (tự ẩn sau vài giây) thay vì lỗi. `onOpened` để nơi gọi tạm dừng Player của tab gốc.
 */
import { useEffect, useId, useState } from 'react';
import type { ReactNode } from 'react';
import { useT } from '../i18n/useT';
import { closeFloatingWindow, openFloatingWindow, useFloatingWindowState } from './FloatingWindow';
import './pip.css';

/** Dòng giải thích (không hỗ trợ / bị chặn) tự ẩn sau khoảng này. */
export const PIP_NOTE_MS = 8000;

export interface FloatingWindowButtonProps {
  songId: string;
  /** Cửa sổ nổi vừa mở (hoặc vừa chuyển sang bài này) — vd. tạm dừng Player ở tab gốc. */
  onOpened?: () => void;
  className?: string;
  /** Icon trước nhãn (thanh dọc của màn chơi). */
  icon?: ReactNode;
}

type Note = 'unsupported' | 'blocked' | null;

export function FloatingWindowButton({
  songId,
  onOpened,
  className,
  icon,
}: FloatingWindowButtonProps) {
  const t = useT();
  const { open, songId: openId, supported } = useFloatingWindowState();
  const [note, setNote] = useState<Note>(null);
  const noteId = useId();
  const cls = ['pip-control', className].filter(Boolean).join(' ');

  useEffect(() => {
    if (note === null) return;
    const id = setTimeout(() => setNote(null), PIP_NOTE_MS);
    return () => clearTimeout(id);
  }, [note]);

  const openHere = (): void => {
    // Không await trước openFloatingWindow: requestWindow cần user activation của click này.
    void openFloatingWindow(songId).then((r) => {
      if (r === 'opened') {
        setNote(null);
        onOpened?.();
      } else {
        setNote(r);
      }
    });
  };

  const title = open ? t('pip.close') : supported ? t('pip.buttonHint') : t('pip.unsupported');

  return (
    <span className={cls} data-state={open ? 'open' : 'closed'}>
      <button
        type="button"
        className="btn pip-toggle"
        aria-pressed={open}
        title={title}
        aria-describedby={note ? noteId : undefined}
        onClick={() => (open ? closeFloatingWindow() : openHere())}
      >
        {icon}
        <span className="pip-toggle-label">{t('pip.button')}</span>
        {open ? (
          <span className="pip-open-tag" aria-hidden="true">
            {t('pip.openTag')}
          </span>
        ) : null}
      </button>
      {open ? (
        <span className="sr-only" role="status">
          {t('pip.statusOpen')}
        </span>
      ) : null}
      {open && openId !== songId ? (
        <button type="button" className="btn btn-sm pip-switch" onClick={openHere}>
          {t('pip.switchSong')}
        </button>
      ) : null}
      {note ? (
        <span id={noteId} className="pip-note" role="status">
          {note === 'blocked' ? t('pip.blocked') : t('pip.unsupported')}
        </span>
      ) : null}
    </span>
  );
}

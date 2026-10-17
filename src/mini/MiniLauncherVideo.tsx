/**
 * Video nổi cho máy Apple, mở từ nút "Cửa sổ nổi" của màn chơi (góp ý R7-6 / R7-7; MiniLauncher tải lười
 * module này — videoPip + muxer WebM chỉ nạp khi cần). Safari iPhone không mở được "Trực tiếp" (luồng canvas)
 * nhưng "Dựng sẵn" (WebCodecs → WebM) chạy được — kể cả qua `http://<IP-LAN>` — nên ở đây chỉ có dựng sẵn:
 * hộp thoại hiện là DỰNG NGAY (tiến độ %, nhắc giữ trang mở; màn hình được giữ sáng), dựng xong thì nút lớn
 * "Mở video nổi" — một cú chạm, `openBuilt` gọi `requestPictureInPicture()` / `webkitSetPresentationMode()`
 * ĐỒNG BỘ trên video đã nạp sẵn (D-361: không await gì trước, Safari mới nhận là cú chạm).
 *
 * `SongVideoPip` sống cùng màn chơi sau lần mở đầu (MiniLauncher giữ mount): đóng hộp thoại KHÔNG đóng khung
 * video nổi đang mở; đóng lúc đang dựng = hủy dựng; video đã dựng xong được giữ cho lần mở sau (option đổi —
 * bài, theme, Cài đặt → Phát bài… — thì dựng lại). Rời màn chơi → đóng PiP, hủy dựng (useVideoPip).
 */
import { useEffect, useId, useMemo, useRef } from 'react';
import type { ReactNode } from 'react';
import { GAME_SCROLL_DIR } from '../core/keys';
import { buildTimeline } from '../core/timeline';
import type { Timeline } from '../core/types';
import { useT } from '../i18n/useT';
import { entryTitle } from '../library/store';
import type { LibraryEntry } from '../library/store';
import { floatingCountdownSec } from '../pip/pipPrefs';
import { MIN_VIDEO_COUNTDOWN } from '../pip/videoPip';
import type { GuideVideoOptions } from '../pip/videoPip';
import { Button, Modal } from '../ui/components';
import { useModifierLabels } from '../ui/modLabels';
import type { ModifierLabels } from '../ui/modLabels';
import { useSettings } from '../ui/settings';
import { formatBytes, useVideoPip, videoPipErrorText } from './VideoPipDialog';
import type { VideoPipController } from './VideoPipDialog';
import { useScreenWakeLock } from './wakeLock';

/**
 * Đếm ngược nằm trong video (giây): Cài đặt → Phát bài, tối thiểu 3 giây (Tắt → 3, 5 → 5) — bấm mở rồi còn
 * phải chuyển sang game. Cùng quy tắc với Cửa sổ nổi / trang mini (`floatingCountdownSec`, R7-5).
 */
export function songVideoCountdown(startDelaySec: unknown): number {
  return Math.max(MIN_VIDEO_COUNTDOWN, floatingCountdownSec(startDelaySec));
}

/** Tên 4 nút (theo Cài đặt), identity ổn định khi chuỗi không đổi (option đổi = dựng lại). */
function useStableLabels(): ModifierLabels {
  const l = useModifierLabels();
  return useMemo(
    () => ({ left: l.left, right: l.right, natural: l.natural, scroll: l.scroll }),
    [l.left, l.right, l.natural, l.scroll],
  );
}

/** Option của video theo bài + Cài đặt (giống video của trang mini). */
export function useSongVideoOptions(entry: LibraryEntry): GuideVideoOptions {
  const scheme = useSettings((s) => s.controlScheme);
  const mobileSemitone = useSettings((s) => s.mobileSemitone);
  const baseOctave = useSettings((s) => s.baseOctave);
  const theme = useSettings((s) => s.theme);
  const language = useSettings((s) => s.language);
  const subLabel = useSettings((s) => s.subLabel);
  const lookahead = useSettings((s) => s.lookahead);
  const countIn = useSettings((s) => s.countIn);
  const startDelaySec = useSettings((s) => s.startDelaySec);
  const labels = useStableLabels();
  const song = entry.parsed.song;
  const timeline = useMemo<Timeline>(
    () => buildTimeline(song, { baseOctave, scrollDir: GAME_SCROLL_DIR }),
    [song, baseOctave],
  );
  const countdownSec = songVideoCountdown(startDelaySec);
  return useMemo<GuideVideoOptions>(
    () => ({
      timeline,
      bpm: song.bpm,
      scheme,
      mobileSemitone,
      labels,
      theme,
      language,
      subLabel,
      lookahead,
      countdownSec,
      countIn,
    }),
    [
      timeline,
      song.bpm,
      scheme,
      mobileSemitone,
      labels,
      theme,
      language,
      subLabel,
      lookahead,
      countdownSec,
      countIn,
    ],
  );
}

export interface SongVideoPipProps {
  entry: LibraryEntry;
  /** Hộp thoại hiện (component vẫn sống khi đóng — giữ phiên PiP). */
  open: boolean;
  onClose: () => void;
  /** Chân hộp thoại (dòng "Điện thoại: … · Đổi loại điện thoại"). */
  footer?: ReactNode;
}

export function SongVideoPip({ entry, open, onClose, footer }: SongVideoPipProps) {
  const t = useT();
  const options = useSongVideoOptions(entry);
  const hostRef = useRef<HTMLDivElement>(null);
  const pip = useVideoPip(options, hostRef);
  const building = pip.build.status === 'building';
  // Màn hình sáng khi đang dựng (màn tắt / trang xuống nền thì dựng chậm hẳn hoặc dừng).
  useScreenWakeLock(building);
  const { cancelBuild } = pip;
  // Đóng hộp thoại lúc đang dựng = hủy dựng (video đã dựng xong thì giữ cho lần mở sau).
  useEffect(() => {
    if (!open && building) cancelBuild();
  }, [open, building, cancelBuild]);
  const title = entryTitle(entry) || t('common.untitled');
  return (
    <>
      {/* Video PiP phải gắn DOM nhưng không thấy (cùng kiểu trang mini — mini.css). */}
      <div ref={hostRef} className="mini-video-host" aria-hidden="true" />
      <Modal open={open} title={t('mini.video.title')} onClose={onClose}>
        <AppleVideoBody
          pip={pip}
          countdownSec={options.countdownSec}
          title={title}
          footer={footer}
        />
      </Modal>
    </>
  );
}

interface BodyProps {
  pip: VideoPipController;
  countdownSec: number;
  title: string;
  footer?: ReactNode;
}

/** Thân hộp thoại: dựng ngay → tiến độ → "Mở video nổi" (nút chính, một cú chạm). */
export function AppleVideoBody({ pip, countdownSec, title, footer }: BodyProps) {
  const t = useT();
  const { support, session, build, error, arm, startBuild } = pip;
  // Hộp thoại hiện = chuẩn bị video trước cú chạm (video dựng xong được nạp sẵn).
  useEffect(() => arm(), [arm]);
  // Hộp thoại hiện = dựng ngay; video cũ hết hợp lệ (option đổi → idle) cũng dựng lại ngay.
  const idle = build.status === 'idle';
  const canBuild = support.pip && support.prerender;
  useEffect(() => {
    if (idle && canBuild) startBuild();
  }, [idle, canBuild, startBuild]);

  const built = build.status === 'built';
  // Dựng xong mà focus còn ở khung hộp thoại (nút mở bị khóa lúc dựng) → focus nút "Mở video nổi".
  const openRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const btn = openRef.current;
    if (!built || !btn) return;
    const active = btn.ownerDocument.activeElement;
    if (active === null || active === btn.ownerDocument.body || active.matches('[role="dialog"]')) {
      btn.focus({ preventScroll: true });
    }
  }, [built]);

  const showProgress = build.status === 'building' || (idle && canBuild);
  const pct = build.status === 'building' ? Math.floor(build.progress * 100) : 0;
  // Nút "Mở video nổi" bị khóa lúc dựng: trình đọc màn hình đọc kèm "Đang dựng video… N%" + lời nhắc.
  const progressId = useId();
  const hintId = useId();
  return (
    <div className="mini-video mini-apple" data-build={build.status}>
      <p className="mini-launch-song">{t('mini.launcherFor', { title })}</p>
      <p className="mini-video-intro">{t('mini.apple.intro', { n: countdownSec })}</p>
      {!support.pip ? (
        <p className="mini-note" role="note" data-unsupported="pip">
          {t('mini.video.errorIos')}
        </p>
      ) : !support.prerender ? (
        <p className="mini-note" role="note" data-unsupported="prerender">
          {t('mini.apple.unsupported')}
        </p>
      ) : null}
      {session ? (
        <p className="mini-video-status" role="status">
          <span>{t('mini.apple.statusOpen')}</span>
          <Button size="sm" onClick={pip.close}>
            {t('mini.video.close')}
          </Button>
        </p>
      ) : null}
      {error !== null ? (
        <p className="mini-note" role="alert" data-error={error}>
          {t(videoPipErrorText(error, pip.apple))}
        </p>
      ) : null}

      {showProgress ? (
        <div className="mini-apple-progress">
          <div className="mini-video-progress">
            <progress max={100} value={pct} aria-label={t('mini.video.progress')} />
            {/* Không là live region: % đổi liên tục (screen reader đọc giá trị của <progress>). */}
            <span id={progressId} aria-live="off">
              {t('mini.apple.building', { pct })}
            </span>
          </div>
          <p id={hintId} className="mini-video-hint">
            {t('mini.apple.keepOpen')}
          </p>
        </div>
      ) : null}
      {build.status === 'built' ? (
        <p
          className="mini-video-built"
          role="status"
          data-bytes={build.result.blob.size}
          data-codec={build.result.codec}
        >
          {t('mini.video.built', {
            size: formatBytes(build.result.blob.size),
            sec: Math.round(build.result.durationSec),
          })}
        </p>
      ) : null}
      {build.status === 'failed' ? (
        <div className="mini-apple-failed">
          {/* Câu dễ hiểu; lỗi gốc chỉ để chẩn đoán (data-reason). */}
          <p className="mini-note" role="alert" data-reason={build.reason}>
            {t('mini.apple.buildFailed')}
          </p>
          <Button className="mini-video-build" onClick={startBuild}>
            {t('mini.video.build')}
          </Button>
        </div>
      ) : null}

      {canBuild ? (
        // Cú chạm gọi thẳng openBuilt: xin PiP ĐỒNG BỘ, không bọc async (Safari mất user activation).
        <button
          ref={openRef}
          type="button"
          className="btn btn-primary btn-lg mini-apple-open"
          disabled={!built}
          aria-describedby={showProgress ? `${progressId} ${hintId}` : undefined}
          data-ready={pip.builtReady ? 'true' : 'false'}
          onClick={pip.openBuilt}
        >
          {t('mini.apple.open')}
        </button>
      ) : null}
      {footer}
    </div>
  );
}

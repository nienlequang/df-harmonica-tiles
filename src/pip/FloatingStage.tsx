/**
 * Nội dung "Cửa sổ nổi" (mount bằng React root riêng trong document của cửa sổ PiP —
 * FloatingWindow.ts): chỉ 8 làn của bài theo bố cục "khớp bảng phím game" (khung = khung bảng phím PC — 8 làn
 * + đệm hai bên, hit line sát đáy, gutter ribbon bên phải), banner giữ / chế độ nhỏ ngay trên hit line, thanh công cụ gọn
 * tự ẩn khi đang chạy (hiện lại khi rê chuột / focus): ▶/❚❚, ↺, "Căn chỉnh" (8 vạch dẫn có nhãn phím +
 * mép dưới sáng + cách đặt cửa sổ), "Đặt lại cỡ chuẩn" (bổ sung trước deploy C: về cỡ theo màn hình — 8 cột
 * rộng đúng 8 phím, cao từ mép trên màn hình tới mép trên bảng phím; trình duyệt không cho đổi cỡ → dòng nhắc
 * đóng / mở lại), gợi ý ngắn. Giai điệu mẫu đang bật → huy hiệu đỏ "Đang phát giai
 * điệu" luôn hiện ở góc trên. Kiểu Mobile (vòng R6): bố cục bàn nút như màn chơi (`mobilePad` của
 * engine → `lanePadding: 'pad'` + MobilePad chỉ hiển thị ở đáy), vòng "CHẠM" đáp đồng tâm lên nút chế độ,
 * banner ở đầu khu làn.
 * Phím trong cửa sổ nổi: Space chạy/dừng, R chơi lại, Esc tắt căn chỉnh (hoặc hủy đếm ngược).
 * Đếm ngược / đếm vào theo Cài đặt → Phát bài (góp ý 2026-10-16: chỉ chỉnh ở Cài đặt — cửa sổ nổi không có
 * ô đếm ngược riêng); đếm ngược tối thiểu 3 giây kể cả khi Cài đặt = Tắt (vòng R7, `floatingCountdownSec`).
 * Số lớn chỉ hiện trong lúc đếm ngược (ô đứng yên ở frame đầu của đếm vào); đếm vào sau đó chỉ là
 * đoạn ô rơi dẫn vào, không có số (không đếm hai lần).
 *
 * Engine chạy bằng requestAnimationFrame / timer của CHÍNH cửa sổ nổi (`hostWindow`) — tab gốc
 * thường bị ẩn sau game. Âm thanh theo Cài đặt (mặc định tắt; tắt thì không tạo AudioContext).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { GAME_SCROLL_DIR, NOTE_KEYS } from '../core/keys';
import { jianpuLabel } from '../core/mobile';
import { buildTimeline } from '../core/timeline';
import { useT } from '../i18n/useT';
import { entryTitle, useSong } from '../library/store';
import type { LibraryEntry } from '../library/store';
import { FLOAT_FOLLOW_PRIORITY, useFollowBroadcast } from '../overlay/followBroadcast';
import { GAME_LAYOUT_HIT_LINE } from '../overlay/overlayParams';
import { JianpuDigit } from '../player/GameBar';
import { HoldBanner } from '../player/HoldBanner';
import { MelodyBadge } from '../player/MelodyBadge';
import { MobilePad } from '../player/MobilePad';
import { GAME_FRAME_PAD } from '../player/layout';
import type { RendererOptions } from '../player/renderer';
import { usePlayerEngine, usePlayerState } from '../player/usePlayerEngine';
import type { PlayerEngine } from '../player/usePlayerEngine';
import { Button, IconButton } from '../ui/components';
import { useSettings } from '../ui/settings';
import type { ControlScheme } from '../ui/settings';
import { PLAYER_HOTKEYS, useHotkeys } from '../ui/useHotkeys';
import {
  floatingCountdownSec,
  matchesSize,
  requestInitialPlacementOnce,
  resetToStandardSize,
  windowTileScale,
} from './pipPrefs';
import './pip.css';

/** "Đặt lại cỡ chuẩn": chờ chừng này (ms) rồi xem trình duyệt đã đổi cỡ chưa. */
export const RESET_SIZE_CHECK_MS = 400;
/** Dòng nhắc "không đổi cỡ được" tự ẩn sau chừng này (ms). */
export const RESET_SIZE_NOTE_MS = 8000;

/**
 * Option canvas cố định của cửa sổ nổi (cùng preset overlay `layout=game` + `fit=canvas`): khung = khung bảng
 * phím PC của game — 8 lane ở giữa, đệm GAME_FRAME_PAD bước mỗi bên (v1.0.1: ô ngoài cùng không sát mép cửa sổ;
 * pipPrefs.presetSize chừa đúng chỗ đó), hit line sát đáy, lưới mờ. Cửa sổ đục nên tile giữ độ đục 1. Phần còn
 * lại theo Cài đặt. Kiểu Mobile: engine đổi `lanePadding` sang 'pad' (`mobilePad` — `framePad` bị bỏ qua).
 */
export const PIP_RENDERER_OPTIONS: Readonly<Partial<RendererOptions>> = Object.freeze({
  orientation: 'vertical',
  hitLinePos: GAME_LAYOUT_HIT_LINE,
  lanePadding: 'none',
  framePad: GAME_FRAME_PAD,
  gridStyle: 'subtle',
  tileOpacity: 1,
  background: 'theme',
  showRibbons: true,
  showBarLines: true,
  showSectionLabels: true,
});

/** Banner nằm ngay trên hit line (hit line ở GAME_LAYOUT_HIT_LINE tính từ trên). */
const BANNER_STYLE: CSSProperties = {
  bottom: `calc(${Math.round((1 - GAME_LAYOUT_HIT_LINE) * 1000) / 10}% + 6px)`,
};

export interface FloatingStageProps {
  songId: string;
  /** Cửa sổ nổi chứa component này (rAF / timer / phím của engine dùng của cửa sổ này). */
  hostWindow: Window;
}

/** Tiêu đề cửa sổ nổi (hiện trên thanh tiêu đề của trình duyệt). */
function useHostTitle(hostWindow: Window, title: string): void {
  useEffect(() => {
    try {
      hostWindow.document.title = title;
    } catch {
      // cửa sổ đã đóng
    }
  }, [hostWindow, title]);
}

export function FloatingStage({ songId, hostWindow }: FloatingStageProps) {
  const t = useT();
  const entry = useSong(songId);
  const title = entry ? entryTitle(entry) || t('common.untitled') : '';
  useHostTitle(hostWindow, entry ? t('pip.windowTitle', { title }) : t('pip.region'));
  if (!entry) {
    return (
      <div className="pip-stage pip-stage-message" role="region" aria-label={t('pip.region')}>
        <p className="pip-message" role="alert">
          {t('pip.songMissing', { id: songId })}
        </p>
      </div>
    );
  }
  return <FloatingPlayer entry={entry} title={title} hostWindow={hostWindow} />;
}

interface FloatingPlayerProps {
  entry: LibraryEntry;
  title: string;
  hostWindow: Window;
}

function FloatingPlayer({ entry, title, hostWindow }: FloatingPlayerProps) {
  const t = useT();
  const baseOctave = useSettings((s) => s.baseOctave);
  const scheme = useSettings((s) => s.controlScheme);
  const audioEnabled = useSettings((s) => s.audioEnabled);
  const song = entry.parsed.song;
  const timeline = useMemo(
    () => buildTimeline(song, { baseOctave, scrollDir: GAME_SCROLL_DIR }),
    [song, baseOctave],
  );
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  // Gutter co giãn cùng vùng lane của preset (dpr, 1440p) → 8 cột thẳng 8 phím ngay lần mở đầu.
  const [rendererOptions] = useState<Partial<RendererOptions>>(() => ({
    ...PIP_RENDERER_OPTIONS,
    tileScale: windowTileScale(hostWindow),
  }));
  const engine = usePlayerEngine({
    timeline,
    songBpm: song.bpm,
    canvasRef,
    stageRef,
    hostWindow,
    rendererOptions,
    // Kiểu Mobile: bố cục bàn nút như màn chơi (vòng "CHẠM" đáp lên nút chế độ của MobilePad).
    mobilePad: true,
  });
  // Overlay OBS theo cửa sổ nổi khi nó đang mở (Player chính tạm dừng lúc mở — cùng id tab, ưu tiên hơn);
  // đóng cửa sổ thì overlay theo lại Player chính (src/overlay/followBroadcast.ts).
  useFollowBroadcast(engine, entry, { priority: FLOAT_FOLLOW_PRIORITY });
  // Đếm ngược = Cài đặt → Phát bài, tối thiểu 3 giây (vòng R7: bấm ▶ ở đây rồi còn phải chuyển vào game).
  const startDelaySec = useSettings((s) => s.startDelaySec);
  useEffect(
    () => engine.setStartDelay(floatingCountdownSec(startDelaySec)),
    [engine, startDelaySec],
  );

  const [align, setAlign] = useState(false);
  const pad = scheme === 'mobile';

  const playing = usePlayerState(engine, (s) => s.playing);
  const countdown = usePlayerState(engine, (s) => s.countdown);
  const hasNotes = timeline.notes.length > 0 && timeline.totalBeats > 0;

  const escape = align
    ? () => setAlign(false)
    : countdown !== null
      ? () => engine.cancelCountdown()
      : undefined;
  useHotkeys(
    {
      [PLAYER_HOTKEYS.playPause]: hasNotes ? () => engine.toggle() : undefined,
      [PLAYER_HOTKEYS.restart]: hasNotes ? () => engine.restart() : undefined,
      Escape: escape,
    },
    { target: hostWindow },
  );

  const playLabel = playing ? t('player.pause') : t('player.play');

  return (
    <div
      ref={stageRef}
      className="pip-stage"
      data-playing={playing ? 'true' : 'false'}
      data-align={align ? 'true' : 'false'}
      data-melody={audioEnabled ? 'true' : 'false'}
      data-scheme={scheme}
      role="region"
      aria-label={t('pip.region')}
    >
      <canvas
        ref={canvasRef}
        className="pip-canvas"
        role="img"
        aria-label={t('player.canvas', { title })}
      />
      {hasNotes ? null : (
        <p className="pip-message" role="status">
          {t('player.empty')}
        </p>
      )}
      {/* Mobile: bàn nút kiểu game ở đáy (chỉ hiển thị) — đích của vòng "CHẠM". */}
      {pad ? <FloatingMobilePad engine={engine} /> : null}
      {/* PC: banner ngay trên hit line; Mobile: ở đầu khu làn (dưới thanh công cụ — pip.css). */}
      <div className="pip-banner" style={pad ? undefined : BANNER_STYLE}>
        <FloatingBanner engine={engine} scheme={scheme} />
      </div>
      {align ? <AlignGuides scheme={scheme} /> : null}
      {/* Giai điệu mẫu đang bật: huy hiệu luôn hiện (ngoài thanh công cụ tự ẩn) — cửa sổ nổi thường là
          thứ duy nhất streamer nhìn thấy khi tab gốc nằm sau game. */}
      {audioEnabled ? <MelodyBadge className="pip-melody" /> : null}
      {countdown !== null ? (
        <div className="pip-countdown" role="status">
          <span key={countdown} className="pip-countdown-num" aria-hidden="true">
            {countdown}
          </span>
          <span className="pip-countdown-hint" aria-hidden="true">
            {t('pip.countdownHint')}
          </span>
          <span className="sr-only">{t('player.countdownAria', { n: countdown })}</span>
        </div>
      ) : null}
      <div className="pip-toolbar" role="group" aria-label={t('pip.toolbar')}>
        <IconButton
          variant="primary"
          size="sm"
          className="pip-play"
          label={playLabel}
          aria-keyshortcuts={PLAYER_HOTKEYS.playPause}
          data-playing={playing ? 'true' : 'false'}
          disabled={!hasNotes}
          onClick={() => engine.toggle()}
        >
          <span aria-hidden="true">{playing ? '❚❚' : '▶'}</span>
        </IconButton>
        <IconButton
          size="sm"
          className="pip-restart"
          label={t('player.restartAria')}
          aria-keyshortcuts={PLAYER_HOTKEYS.restart}
          disabled={!hasNotes}
          onClick={() => engine.restart()}
        >
          <span aria-hidden="true">↺</span>
        </IconButton>
        <Button
          size="sm"
          className="pip-align-toggle"
          aria-pressed={align}
          title={t('pip.alignHint')}
          onClick={() => setAlign((a) => !a)}
        >
          {t('pip.align')}
        </Button>
        <ResetSizeControl hostWindow={hostWindow} />
        <span className="pip-hint">{t('pip.hint')}</span>
      </div>
    </div>
  );
}

/** Dòng nhắc nằm riêng một hàng cuối thanh công cụ (thanh là flex-wrap). */
const RESET_NOTE_STYLE: CSSProperties = { flexBasis: '100%', order: 1 };

/**
 * "Đặt lại cỡ chuẩn" (bổ sung trước deploy C): bấm → `resetToStandardSize` (quên cỡ đã nhớ + `resizeTo` cỡ
 * chuẩn theo màn hình đang chứa cửa sổ — trình duyệt chỉ cho trong cú bấm). Sau RESET_SIZE_CHECK_MS mà cỡ
 * chưa đổi (trình duyệt không cho) → dòng nhắc đóng rồi mở lại (lần mở sau đã về cỡ chuẩn), tự ẩn sau
 * RESET_SIZE_NOTE_MS. Timer dùng của cửa sổ nổi, dọn khi gỡ.
 */
function ResetSizeControl({ hostWindow }: { hostWindow: Window }) {
  const t = useT();
  const [blocked, setBlocked] = useState(false);
  const checkTimer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (checkTimer.current !== null) hostWindow.clearTimeout(checkTimer.current);
      checkTimer.current = null;
    },
    [hostWindow],
  );
  useEffect(() => {
    if (!blocked) return undefined;
    const id = hostWindow.setTimeout(() => setBlocked(false), RESET_SIZE_NOTE_MS);
    return () => hostWindow.clearTimeout(id);
  }, [blocked, hostWindow]);

  const reset = (): void => {
    if (checkTimer.current !== null) hostWindow.clearTimeout(checkTimer.current);
    checkTimer.current = null;
    setBlocked(false);
    const { target, requested } = resetToStandardSize(hostWindow);
    // Không đổi được: dòng nhắc "đóng rồi mở lại" + lần mở sau bỏ cỡ / chỗ Chrome đã nhớ (D-419) — không thì Chrome
    // trả lại đúng cỡ người dùng đã kéo của lần trước.
    const refuse = (): void => {
      requestInitialPlacementOnce();
      setBlocked(true);
    };
    if (!requested) {
      refuse();
      return;
    }
    checkTimer.current = hostWindow.setTimeout(() => {
      checkTimer.current = null;
      if (!matchesSize(hostWindow, target)) refuse();
    }, RESET_SIZE_CHECK_MS);
  };

  return (
    <>
      <Button size="sm" className="pip-size-reset" title={t('pip.resetSizeHint')} onClick={reset}>
        {t('pip.resetSize')}
      </Button>
      {blocked ? (
        <p className="pip-note pip-size-note" role="alert" style={RESET_NOTE_STYLE}>
          {t('pip.resetSizeBlocked')}
        </p>
      ) : null}
    </>
  );
}

/** Mobile: bàn nút kiểu game của Player, chỉ hiển thị (người chơi chạm nút thật trong game). */
function FloatingMobilePad({ engine }: { engine: PlayerEngine }) {
  const noteIndex = usePlayerState(engine, (s) => s.noteIndex);
  const mobile = usePlayerState(engine, (s) => s.mobile);
  const note = noteIndex >= 0 ? (engine.timeline.notes[noteIndex] ?? null) : null;
  return <MobilePad className="pip-mpad" note={note} noteId={noteIndex} mobile={mobile} />;
}

/** Banner "ĐANG GIỮ" (PC) / "CHẾ ĐỘ" (Mobile) theo hit line — dùng lại HoldBanner của Player. */
function FloatingBanner({ engine, scheme }: { engine: PlayerEngine; scheme: ControlScheme }) {
  const runIndex = usePlayerState(engine, (s) => s.runIndex);
  const mobile = usePlayerState(engine, (s) => s.mobile);
  const run = runIndex >= 0 ? (engine.timeline.holdRuns[runIndex] ?? null) : null;
  return <HoldBanner modifiers={run ? run.modifiers : null} scheme={scheme} mobile={mobile} />;
}

/**
 * "Căn chỉnh": 8 vạch dẫn giữa 8 cột (theo đúng vùng lane của canvas qua --lane-left / --lane-right
 * do engine đặt) có nhãn Z X C V B N M , (PC) hoặc số giản phổ 1…7 1̇ (Mobile, chấm là phần tử
 * riêng), cộng một vạch sáng ở mép dưới cửa sổ = mép trên bảng phím game.
 */
function AlignGuides({ scheme }: { scheme: ControlScheme }) {
  const t = useT();
  return (
    <div className="pip-align" role="group" aria-label={t('pip.alignRegion')}>
      <p className="pip-align-help">{t('pip.help')}</p>
      <ol className="pip-align-cols">
        {NOTE_KEYS.map((k) => (
          <li key={k} className="pip-align-col" data-key={k}>
            <span className="pip-align-key">
              {scheme === 'mobile' ? <JianpuDigit label={jianpuLabel(k, 0)} /> : k}
            </span>
          </li>
        ))}
      </ol>
      <div className="pip-align-edge">
        <span className="pip-align-edge-label">{t('pip.alignEdge')}</span>
      </div>
    </div>
  );
}

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { ReactNode, RefObject } from 'react';
import { GAME_SCROLL_DIR } from '../core/keys';
import { buildShareUrl, isShareUrlLong, isShareableSource } from '../core/share';
import { buildTimeline } from '../core/timeline';
import type { Timeline } from '../core/types';
import { useT } from '../i18n/useT';
import {
  draftSavedAs,
  entryArtist,
  entryTitle,
  isDraftSong,
  isTransientSong,
  saveSharedSong,
  useSong,
} from '../library/store';
import type { LibraryEntry } from '../library/store';
import { useDfhtCommands } from '../overlay/commands';
import { MiniLauncher } from '../mini/MiniLauncher';
import { useFollowBroadcast } from '../overlay/followBroadcast';
import { ObsLinkModal } from '../overlay/ObsLinkModal';
import { Modal, copyText } from '../ui/components';
import { errorDiagnostics, formatDiagnostic } from '../ui/diagnostics';
import { FEATURES } from '../ui/features';
import { rememberLastPlayed } from '../ui/lastPlayed';
import { MelodyConfirmDialog, useMelodyToggle } from '../ui/MelodyConfirm';
import { useModifierLabels } from '../ui/modLabels';
import { PrefButtons } from '../ui/PrefButtons';
import { href, navigate, paths, useRoute } from '../ui/router';
import { useSettings } from '../ui/settings';
import { ShortcutsHelp } from '../ui/ShortcutsHelp';
import { toast } from '../ui/toast';
import { PLAYER_HOTKEYS, useHotkeys } from '../ui/useHotkeys';
import { GameBar } from './GameBar';
import { HoldBanner } from './HoldBanner';
import { MelodyBadge } from './MelodyBadge';
import { MobilePad, MobilePadCombo, MobilePadRotateHint } from './MobilePad';
import type { MobilePadPractice } from './MobilePad';
import { PlayerSideBar } from './PlayerSideBar';
import { PracticeGradeFlash, PracticeHud, PracticeResults } from './PracticePanel';
import { setTopCollapsed, useTopCollapsed } from './topBarPref';
import { Icon, SeekBar, TransportBar } from './TransportBar';
import type { SectionOption } from './TransportBar';
import type { PracticeInputEvent } from './practice.types';
import type { PlayerEngine } from './usePlayerEngine';
import {
  BPM_STEP,
  formatBpm,
  lineStartFromParam,
  usePlayerEngine,
  usePlayerState,
} from './usePlayerEngine';
import './player.css';

export interface PlayerViewProps {
  songId: string;
  /**
   * Màn chơi mặc định `#/` (bài mẫu — HomeView): nút "Về màn chơi" của các trang khác quay về `#/`
   * thay vì `#/play/<id>` (src/ui/lastPlayed.ts).
   */
  home?: boolean;
}

/**
 * Màn chơi (route `#/` với bài mẫu và `#/play/:id`, spec §5 + góp ý 2026-10-15 B):
 * - header: "◂ Thư viện", tên bài, chip (BPM, đoạn, giai điệu mẫu, cảnh báo), góc phải = ngôn ngữ + theme;
 * - thanh điều khiển (+ dải điểm khi luyện tập);
 * - thân 3 cột: TRÁI = danh sách phím tắt đầy đủ (màn rộng; màn hẹp hơn = nút "?" mở hộp thoại), GIỮA =
 *   khu tiles → banner giữ / chế độ → game bar (PC) hoặc bàn nút kiểu game (Mobile), PHẢI = thanh dọc
 *   Kiểu điều khiển · Cửa sổ nổi · OBS · Chia sẻ · Cài đặt (PlayerSideBar);
 * - đáy: thanh tiến độ trải hết bề ngang.
 * Lệnh `dfht:command` (desktop) = Space / R / → / ←. `?line=<index>` (0-based theo timeline.lines) mở ở
 * một dòng (vd. từ editor). Đếm ngược trước khi phát (settings.startDelaySec — chỉnh ở Cài đặt → Phát
 * bài, không có trên thanh điều khiển) hiện số lớn giữa khu tiles khi ô còn đứng yên; Space / Esc hủy.
 * Đếm vào (settings.countIn) chạy sau đó chỉ là đoạn ô rơi dẫn vào, không có số nào (góp ý 2026-10-16).
 */
export function PlayerView({ songId, home = false }: PlayerViewProps) {
  const entry = useSong(songId);
  const { query } = useRoute();
  // Bản nháp đã được Lưu thành bài thư viện (Forward về `#/play/draft-…`, link cũ): bản nháp trong bộ
  // nhớ còn nội dung LÚC PHÁT → mở bài đã lưu (như EditorView), giữ `?line=`.
  const savedAs = draftSavedAs(songId);
  const line = query.get('line');
  useEffect(() => {
    if (savedAs === null) return;
    navigate(`${paths.play(savedAs)}${line !== null ? `?line=${encodeURIComponent(line)}` : ''}`, {
      replace: true,
    });
  }, [savedAs, line]);
  if (savedAs !== null) return null;
  if (!entry) return <PlayerNotFound id={songId} />;
  // key: đổi bài → mount lại toàn bộ (engine, transport, renderer mới; cái cũ được dọn).
  return <PlayerScreen key={songId} entry={entry} home={home} />;
}

function PlayerNotFound({ id }: { id: string }) {
  const t = useT();
  return (
    <main className="player-notfound">
      <section className="card stack player-notfound-card">
        <h1>{t('common.songNotFound')}</h1>
        <p className="muted">{t('player.notFoundHint', { id })}</p>
        <p>
          <a className="btn btn-primary btn-md" href={href(paths.library())}>
            {t('common.goHome')}
          </a>
        </p>
      </section>
    </main>
  );
}

const fmtScroll = (d: number): string => (d > 0 ? '+1' : '−1');

/** Timeline theo bài + settings (base octave); Nửa Cung theo game (cố định thăng, GAME_SCROLL_DIR). */
function useSongTimeline(entry: LibraryEntry): Timeline {
  const song = entry.parsed.song;
  const baseOctave = useSettings((s) => s.baseOctave);
  return useMemo(
    () => buildTimeline(song, { baseOctave, scrollDir: GAME_SCROLL_DIR }),
    [song, baseOctave],
  );
}

function PlayerScreen({ entry, home }: { entry: LibraryEntry; home: boolean }) {
  const t = useT();
  const song = entry.parsed.song;
  const lookahead = useSettings((s) => s.lookahead);
  const audioEnabled = useSettings((s) => s.audioEnabled);
  const practiceMode = useSettings((s) => s.practiceMode);
  const setSettings = useSettings((s) => s.set);

  const timeline = useSongTimeline(entry);
  const { query } = useRoute();
  const lineParam = query.get('line');
  const [initialBeat] = useState(() => lineStartFromParam(timeline, lineParam));

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const engine = usePlayerEngine({
    timeline,
    songBpm: song.bpm,
    initialBeat,
    mobilePad: true,
    canvasRef,
    stageRef,
  });
  // Overlay OBS theo Player chính (BroadcastChannel / OBS WebSocket) — xem src/overlay/follow.ts.
  useFollowBroadcast(engine, entry);

  const playing = usePlayerState(engine, (s) => s.playing);
  const bpm = usePlayerState(engine, (s) => s.bpm);
  const bpmOverride = usePlayerState(engine, (s) => s.bpmOverride);
  const sectionIndex = usePlayerState(engine, (s) => s.sectionIndex);
  const loop = usePlayerState(engine, (s) => s.loop);
  const countdown = usePlayerState(engine, (s) => s.countdown);
  const practice = usePlayerState(engine, (s) => s.practice);
  const [helpOpen, setHelpOpen] = useState(false);
  const [obsOpen, setObsOpen] = useState(false);
  const [miniOpen, setMiniOpen] = useState(false);
  const results = practice?.results ?? null;
  // Nút loa của thanh điều khiển: cùng setting + cùng hộp cảnh báo bản quyền với Cài đặt → Âm thanh. Ghi qua
  // engine để "Tôi hiểu, bật" (một cú bấm) mở khóa âm thanh + giữ phiên "playback" của iPhone ngay trong cú bấm đó,
  // kể cả lúc đứng yên (D-423).
  const applyMelody = useCallback((on: boolean) => engine.setAudioEnabled(on), [engine]);
  const melody = useMelodyToggle(applyMelody);
  const dialogOpen = helpOpen || obsOpen || miniOpen || melody.confirmOpen || results !== null;
  // Bố cục kiểu game (Kiểu điều khiển Mobile, SPEC Phase 4m).
  const scheme = useSettings((s) => s.controlScheme);
  const padLayout = scheme === 'mobile';
  const shortcutsTitleId = useId();
  useScrollStageOnPlay(stageRef, padLayout && playing);
  const topCollapsed = useTopCollapsed();
  const topToggleRef = useRef<HTMLButtonElement>(null);
  const focusTopToggle = useRef(false);
  // Bấm thu gọn / mở rộng bằng nút: focus sang nút kia (nút vừa bấm biến mất).
  useEffect(() => {
    if (!focusTopToggle.current) return;
    focusTopToggle.current = false;
    topToggleRef.current?.focus();
  }, [topCollapsed]);
  const toggleTop = () => {
    focusTopToggle.current = true;
    setTopCollapsed(!topCollapsed);
  };

  const title = entryTitle(entry) || t('common.untitled');
  const artist = entryArtist(entry);
  const hasNotes = timeline.notes.length > 0 && timeline.totalBeats > 0;
  const errors = useMemo(
    () => errorDiagnostics(entry.parsed.diagnostics),
    [entry.parsed.diagnostics],
  );
  const errorCount = errors.length;
  // Chưa có Editor (D-060): chip lỗi không phải link, gợi ý chỉ tới danh sách lỗi trên thẻ thư viện
  // (D-062) kèm lỗi đầu tiên.
  const firstError = errors[0];
  const errorHint = FEATURES.editor
    ? t('player.parseErrorsHintEditor')
    : firstError
      ? `${t('player.parseErrorsHint')} ${t('player.firstError', {
          error: t('library.errorAt', {
            line: firstError.line,
            column: firstError.column,
            message: formatDiagnostic(t, firstError),
          }),
        })}`
      : t('player.parseErrorsHint');
  const hasScrollNotes = useMemo(() => timeline.notes.some((n) => n.sharp), [timeline]);
  // Bài cũ viết cho Nửa Cung giáng (@scroll -1) trong khi game cố định thăng (+1): nhắc sửa bằng Tối ưu lại.
  const scrollMismatch = hasScrollNotes && song.scrollDir !== GAME_SCROLL_DIR;
  // Tên nút Nửa Cung theo Cài đặt (người dùng đổi tên được — D-181).
  const modLabels = useModifierLabels();
  const mismatchArgs = {
    mod: modLabels.scroll,
    song: fmtScroll(song.scrollDir),
    game: fmtScroll(GAME_SCROLL_DIR),
  };
  const sections = useMemo<SectionOption[]>(
    () =>
      timeline.sections
        .filter((s) => s.lineCount > 0 && s.endBeat > s.startBeat)
        .map((s) => ({ index: s.index, name: s.name })),
    [timeline],
  );
  const sectionName = sectionIndex >= 0 ? (timeline.sections[sectionIndex]?.name ?? '') : '';

  // Nút "Về màn chơi" của các trang khác quay lại đây (`#/` cho bài mẫu của màn mặc định).
  useEffect(() => {
    rememberLastPlayed(home ? null : entry.id);
  }, [home, entry.id]);

  // Tiêu đề tab theo bài; trả lại khi rời Player.
  useEffect(() => {
    const prev = document.title;
    document.title = `${title} — ${t('app.shortTitle')}`;
    return () => {
      document.title = prev;
    };
  }, [title, t]);

  // Phím tắt (không bao giờ dùng phím nốt Z X C V B N M , — dành cho practice mode).
  useHotkeys(
    {
      [PLAYER_HOTKEYS.playPause]: () => engine.toggle(),
      [PLAYER_HOTKEYS.restart]: () => engine.restart(),
      [PLAYER_HOTKEYS.prevLine]: () => engine.prevLine(),
      [PLAYER_HOTKEYS.nextLine]: () => engine.nextLine(),
      [PLAYER_HOTKEYS.loop]: () => engine.cycleLoop(),
      [PLAYER_HOTKEYS.bpmDown]: () => engine.stepBpm(-BPM_STEP),
      [PLAYER_HOTKEYS.bpmUp]: () => engine.stepBpm(BPM_STEP),
      // Esc chỉ dùng để hủy đếm ngược trước khi phát.
      Escape: countdown !== null ? () => engine.cancelCountdown() : undefined,
    },
    { enabled: !dialogOpen },
  );
  // Lệnh từ ngoài (desktop global shortcut, src/overlay/commands.ts): như Space / R / → / ←.
  useDfhtCommands(
    {
      toggle: () => engine.toggle(),
      restart: () => engine.restart(),
      nextLine: () => engine.nextLine(),
      prevLine: () => engine.prevLine(),
    },
    !dialogOpen,
  );

  const closeHelp = useCallback(() => setHelpOpen(false), []);
  const closeObs = useCallback(() => setObsOpen(false), []);
  const closeMini = useCallback(() => setMiniOpen(false), []);
  const pause = useCallback(() => engine.pause(), [engine]);
  const openObs = useCallback(() => setObsOpen(true), []);
  const openMini = useCallback(() => setMiniOpen(true), []);
  const closeResults = useCallback(() => engine.dismissResults(), [engine]);
  const replay = useCallback(() => engine.replayPractice(), [engine]);
  const stepLine = useCallback(
    (dir: -1 | 1) => (dir < 0 ? engine.prevLine() : engine.nextLine()),
    [engine],
  );
  const seek = useCallback((b: number) => engine.seek(b), [engine]);

  // Chia sẻ: link `#/s/…` của nguồn .harm (kể cả bài tạm mở từ link — chia sẻ lại được).
  const share = async () => {
    const source = entry.source;
    if (!isShareableSource(source)) {
      toast(t('player.shareEmpty'), 'error');
      return;
    }
    const url = buildShareUrl(source, window.location);
    const ok = await copyText(url);
    if (!ok) {
      toast(t('player.shareCopyFailed'), 'error');
      return;
    }
    // Một toast duy nhất (vùng toast của Player chỉ giữ 1): link dài → thành công kèm lời khuyên.
    const n = url.length;
    toast(t(isShareUrlLong(url) ? 'player.shareCopiedLong' : 'player.shareCopied', { n }));
  };

  return (
    <div
      className={[
        'player',
        practice && 'is-practice',
        padLayout && 'is-mpad',
        topCollapsed && 'is-top-collapsed',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {topCollapsed ? <h1 className="sr-only">{title}</h1> : null}
      <header className="player-header">
        <div className="player-header-row">
          <a
            className="btn btn-ghost btn-sm player-back"
            href={href(paths.library())}
            aria-label={t('common.goHome')}
          >
            <span className="player-back-icon" aria-hidden="true">
              ◂
            </span>
            <span className="player-back-text">{t('common.library')}</span>
          </a>
          <div className="player-titles">
            <h1 className="player-title">{title}</h1>
            {/* Bài mẫu: dòng ghi công nhỏ thay cho dòng tác giả (vẫn có tên tác giả; không thuộc giấy phép MIT —
                NOTICE). Thay chứ không thêm dòng: header điện thoại không cao thêm / không xuống thêm hàng. */}
            {artist && entry.seed ? (
              <p className="player-artist player-credit">{t('common.seedCredit', { artist })}</p>
            ) : artist ? (
              <p className="player-artist">{artist}</p>
            ) : null}
          </div>
          <div className="player-chips">
            <span className={bpmOverride !== null ? 'player-chip is-override' : 'player-chip'}>
              {bpmOverride !== null
                ? t('player.bpmOverridden', { n: formatBpm(bpm), song: formatBpm(song.bpm) })
                : t('player.bpmValue', { n: formatBpm(bpm) })}
            </span>
            {sectionName ? (
              <span className="player-chip player-chip-section">
                <span className="sr-only">{t('player.section')}: </span>
                {sectionName}
              </span>
            ) : null}
            {audioEnabled ? <MelodyBadge /> : null}
            {scrollMismatch && FEATURES.editor ? (
              // Link tới trình soạn (Công cụ → Tối ưu lại) như chip lỗi: focus được, chạm được.
              <a
                className="player-chip player-chip-warning"
                href={href(paths.edit(entry.id))}
                title={t('player.scrollMismatchHint', mismatchArgs)}
              >
                <span aria-hidden="true">⚠ </span>
                {t('player.scrollMismatch', mismatchArgs)}
                <span className="sr-only"> {t('player.scrollMismatchHint', mismatchArgs)}</span>
              </a>
            ) : null}
            {scrollMismatch && !FEATURES.editor ? (
              <span
                className="player-chip player-chip-warning"
                title={t('player.scrollMismatchHint', mismatchArgs)}
              >
                <span aria-hidden="true">⚠ </span>
                {t('player.scrollMismatch', mismatchArgs)}
                <span className="sr-only"> {t('player.scrollMismatchHint', mismatchArgs)}</span>
              </span>
            ) : null}
            {errorCount > 0 && FEATURES.editor ? (
              <a
                className="player-chip player-chip-error"
                href={href(paths.edit(entry.id))}
                title={errorHint}
              >
                {t('player.parseErrors', { n: errorCount })}
              </a>
            ) : null}
            {errorCount > 0 && !FEATURES.editor ? (
              <span className="player-chip player-chip-error" title={errorHint}>
                {t('player.parseErrors', { n: errorCount })}
                <span className="sr-only"> {errorHint}</span>
              </span>
            ) : null}
          </div>
          <TransientNotice entry={entry} />
          <span className="spacer" />
          {/* Ngôn ngữ + giao diện ở góc trên phải như thanh điều hướng các trang khác. */}
          <PrefButtons className="player-prefs" />
          {topCollapsed ? null : (
            <button
              ref={topToggleRef}
              type="button"
              className="btn btn-ghost btn-sm btn-icon player-top-toggle"
              aria-label={t('player.topCollapse')}
              title={t('player.topCollapse')}
              aria-expanded="true"
              onClick={toggleTop}
            >
              <Icon name="collapseUp" />
            </button>
          )}
        </div>
      </header>

      <TransportBar
        playing={playing}
        disabled={!hasNotes}
        onTogglePlay={() => engine.toggle()}
        onRestart={() => engine.restart()}
        onPrevLine={() => engine.prevLine()}
        onNextLine={() => engine.nextLine()}
        sections={sections}
        sectionIndex={sectionIndex}
        onSection={(i) => engine.seekSection(i)}
        loop={loop}
        onLoop={() => engine.cycleLoop()}
        bpm={bpm}
        songBpm={song.bpm}
        bpmOverridden={bpmOverride !== null}
        onBpm={(v) => engine.setBpmOverride(v)}
        onBpmReset={() => engine.setBpmOverride(null)}
        lookahead={lookahead}
        onLookahead={(v) => setSettings({ lookahead: v })}
        audioEnabled={audioEnabled}
        onSound={melody.toggle}
        onHelp={() => setHelpOpen(true)}
        touchPractice={padLayout}
        practice={practice !== null}
        onPractice={(v) => engine.setPractice(v)}
        practiceMode={practiceMode}
        onPracticeMode={(m) => setSettings({ practiceMode: m })}
        guide={practice?.guide ?? false}
        onGuide={(v) => engine.setGuideAudible(v)}
      />

      {practice ? <PracticeHud practice={practice} /> : null}

      <div className="player-body">
        {/* Cột trái (màn rộng): phím tắt + cách bấm đầy đủ; màn hẹp hơn CSS ẩn cột, nút "?" mở hộp thoại. */}
        <aside className="player-shortcuts" aria-labelledby={shortcutsTitleId}>
          <h2 id={shortcutsTitleId} className="sr-only">
            {t('player.shortcutsRegion')}
          </h2>
          <ShortcutsHelp scheme={scheme} hideFocusHint />
        </aside>
        <main className="player-main" aria-label={t('player.region')}>
          {topCollapsed ? (
            // Thanh trên đã thu gọn: Phát / Tạm dừng + mở lại thanh trên ở góc trên phải khu tiles.
            <div className="player-top-mini">
              {hasNotes ? (
                <button
                  type="button"
                  className="btn btn-sm btn-icon"
                  aria-label={playing ? t('player.pause') : t('player.play')}
                  title={playing ? t('player.pause') : t('player.play')}
                  onClick={() => engine.toggle()}
                >
                  <Icon name={playing ? 'pause' : 'play'} />
                </button>
              ) : null}
              <button
                ref={topToggleRef}
                type="button"
                className="btn btn-sm btn-icon"
                aria-label={t('player.topExpand')}
                title={t('player.topExpand')}
                aria-expanded="false"
                onClick={toggleTop}
              >
                <Icon name="expandDown" />
              </button>
            </div>
          ) : null}
          <PlayerStage
            engine={engine}
            timeline={timeline}
            title={title}
            canvasRef={canvasRef}
            stageRef={stageRef}
            canvasExtras={
              <>
                {!hasNotes ? (
                  <div className="player-empty card">
                    <p>{t('player.empty')}</p>
                    {FEATURES.editor ? (
                      <a className="btn btn-primary btn-md" href={href(paths.edit(entry.id))}>
                        {t('player.openEditor')}
                      </a>
                    ) : null}
                  </div>
                ) : null}
                {practice ? <PracticeGradeFlash last={practice.last} /> : null}
                {padLayout && hasNotes ? (
                  <StageToggle playing={playing} onToggle={() => engine.toggle()} />
                ) : null}
              </>
            }
            wrapExtras={countdown !== null ? <StartCountdown seconds={countdown} /> : null}
          />
        </main>
        <PlayerSideBar
          songId={entry.id}
          onFloatOpened={pause}
          onOpenMini={openMini}
          onOpenObs={openObs}
          onShare={() => void share()}
        />
      </div>

      {/* Thanh tiến độ ở đáy màn chơi, trải hết bề ngang. */}
      <footer className="player-footer">
        <PlayerSeekBar
          engine={engine}
          timeline={timeline}
          disabled={!hasNotes}
          onSeek={seek}
          onStepLine={stepLine}
        />
      </footer>

      <Modal open={helpOpen} title={t('player.helpTitle')} onClose={closeHelp}>
        <ShortcutsHelp scheme={scheme} />
      </Modal>
      <MelodyConfirmDialog
        open={melody.confirmOpen}
        onCancel={melody.cancel}
        onConfirm={melody.confirm}
      />
      <ObsLinkModal open={obsOpen} onClose={closeObs} song={entry} />
      <MiniLauncher open={miniOpen} onClose={closeMini} songId={entry.id} />
      <PracticeResults
        results={results}
        wrong={practice?.wrong ?? 0}
        onReplay={replay}
        onClose={closeResults}
      />
    </div>
  );
}

/**
 * Bài chưa nằm trong Thư viện (góp ý 2026-10-15 B2 bỏ nút "Sửa" + C5 bản nháp): màn chơi phải có lối giữ
 * bài lại, không thì chỉ còn nút Back của trình duyệt.
 * - Bản nháp `draft-…` (Tạo bài từ file / Tự chơi / Tạo bài mới thủ công, phát khi chưa sửa): chip
 *   "Bản nháp — chưa lưu" + link "Mở trình soạn để lưu" (`#/edit/<draft>` — Lưu ở đó).
 * - Bài tạm `shared-…` (link chia sẻ → Phát ngay): chip "Bài tạm từ link — chưa lưu" + nút "Lưu vào thư
 *   viện" (lưu một lần như thẻ chia sẻ, rồi màn chơi chuyển sang bài đã lưu).
 * Bài mẫu / bài trong thư viện: không hiện gì.
 */
function TransientNotice({ entry }: { entry: LibraryEntry }) {
  const t = useT();
  const id = entry.id;
  if (entry.seed || !isTransientSong(id)) return null;
  const draft = isDraftSong(id);
  const saveShared = () => {
    const { id: savedId, created } = saveSharedSong(entry.source);
    if (created) {
      toast(t('share.savedToast', { title: entryTitle(entry) || t('common.untitled') }));
    }
    navigate(paths.play(savedId), { replace: true });
  };
  return (
    <div className="player-transient">
      <span
        className="player-chip player-chip-transient"
        title={t(draft ? 'player.draftChipHint' : 'player.sharedChipHint')}
      >
        {t(draft ? 'player.draftChip' : 'player.sharedChip')}
        <span className="sr-only">
          {' '}
          {t(draft ? 'player.draftChipHint' : 'player.sharedChipHint')}
        </span>
      </span>
      {draft ? (
        FEATURES.editor ? (
          <a className="btn btn-sm player-transient-action" href={href(paths.edit(id))}>
            {t('player.draftEdit')}
          </a>
        ) : null
      ) : (
        <button type="button" className="btn btn-sm player-transient-action" onClick={saveShared}>
          {t('share.save')}
        </button>
      )}
    </div>
  );
}

/**
 * Màn điện thoại (bố cục kiểu game): thấp (ngang — khu tiles chiếm trọn một màn) hoặc hẹp (dọc — header,
 * thanh điều khiển và HUD luyện tập đẩy khu tiles + bàn nút xuống dưới màn hình). Giữ khớp media query
 * của `.player-stage-toggle` trong mobilePad.css.
 */
const SHORT_SCREEN_QUERY = '(max-height: 520px), (max-width: 720px)';

/**
 * Bố cục kiểu game trên điện thoại: bấm Phát → cuộn cho khu tiles + bàn nút nằm trọn trong màn hình
 * (header / thanh điều khiển nằm phía trên, cuộn lên là thấy). Màn lớn: không làm gì.
 */
function useScrollStageOnPlay(stageRef: RefObject<HTMLElement>, active: boolean) {
  useEffect(() => {
    const stage = stageRef.current;
    if (!active || !stage || typeof window.matchMedia !== 'function') return;
    if (!window.matchMedia(SHORT_SCREEN_QUERY).matches) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    stage.scrollIntoView?.({ block: 'end', behavior: reduce ? 'auto' : 'smooth' });
  }, [stageRef, active]);
}

/**
 * Nút tạm dừng / phát nhỏ ở góc trên trái khu tiles (bố cục kiểu game trên màn thấp — thanh điều khiển đã
 * cuộn khuất). CSS chỉ hiện nó ở màn thấp.
 */
function StageToggle({ playing, onToggle }: { playing: boolean; onToggle: () => void }) {
  const t = useT();
  const label = playing ? t('player.pause') : t('player.play');
  return (
    <button
      type="button"
      className="stage-toggle player-stage-toggle"
      aria-label={label}
      title={label}
      data-playing={playing ? 'true' : 'false'}
      onClick={onToggle}
    >
      <Icon name={playing ? 'pause' : 'play'} />
    </button>
  );
}

/**
 * Số đếm ngược lớn giữa khu tiles (bấm Phát rồi Alt-Tab vào game) — chỉ trong lúc đếm ngược trước khi
 * phát (ô đứng yên); đếm vào sau đó không hiện số.
 */
function StartCountdown({ seconds }: { seconds: number }) {
  const t = useT();
  return (
    <div className="player-countdown" role="status">
      <span key={seconds} className="player-countdown-num" aria-hidden="true">
        {seconds}
      </span>
      <span className="sr-only">{t('player.countdownAria', { n: seconds })}</span>
      <span className="player-countdown-hint">{t('player.countdownCancel')}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Các phần nối engine — mỗi phần chỉ subscribe đúng lát state nó cần.
// ---------------------------------------------------------------------------

interface ConnectedProps {
  engine: PlayerEngine;
  timeline: Timeline;
}

interface PlayerStageProps extends ConnectedProps {
  title: string;
  canvasRef: RefObject<HTMLCanvasElement>;
  stageRef: RefObject<HTMLDivElement>;
  /** Lớp phủ trong hộp canvas (thông báo bài rỗng, chữ PERFECT…). */
  canvasExtras?: ReactNode;
  /** Lớp phủ cả khung sân khấu (đếm ngược). */
  wrapExtras?: ReactNode;
}

/**
 * Sân khấu: canvas → banner → game bar.
 * Kiểu điều khiển Mobile (SPEC Phase 4m): bố cục giống màn chơi kèn — sân khấu trải hết bề ngang, banner
 * gọn ở đầu khu tiles, bàn nút kiểu game (MobilePad) ở đáy khu tiles thay game bar; canvas dùng
 * `lanePadding: 'pad'` (engine `mobilePad`) nên 8 lane thẳng tâm 8 nút số.
 */
function PlayerStage({
  engine,
  timeline,
  title,
  canvasRef,
  stageRef,
  canvasExtras,
  wrapExtras,
}: PlayerStageProps) {
  const t = useT();
  const pad = useSettings((s) => s.controlScheme) === 'mobile';
  return (
    <div className={pad ? 'player-stage is-mpad' : 'player-stage'} ref={stageRef}>
      <div className="player-canvas-wrap">
        {pad ? <PlayerHoldBanner engine={engine} timeline={timeline} /> : null}
        <div className="player-canvas-box">
          <canvas
            ref={canvasRef}
            className="player-canvas"
            role="img"
            aria-label={t('player.canvas', { title })}
          />
          {pad ? <PlayerMobilePad engine={engine} timeline={timeline} /> : null}
          {pad ? <MobilePadRotateHint /> : null}
          {canvasExtras}
        </div>
        {wrapExtras}
      </div>
      {pad ? null : <PlayerHoldBanner engine={engine} timeline={timeline} />}
      {pad ? null : <PlayerGameBar engine={engine} timeline={timeline} />}
    </div>
  );
}

/** Bàn nút kiểu game (Mobile) nối engine: luyện tập → chạm được, kết quả hiện cạnh nút + combo. */
function PlayerMobilePad({ engine, timeline }: ConnectedProps) {
  const noteIndex = usePlayerState(engine, (s) => s.noteIndex);
  const mobile = usePlayerState(engine, (s) => s.mobile);
  const practice = usePlayerState(engine, (s) => s.practice);
  const pressedKeys = usePlayerState(engine, (s) => s.pressed.keys);
  const onInput = useCallback((ev: PracticeInputEvent) => engine.handlePracticeInput(ev), [engine]);
  const note = noteIndex >= 0 ? (timeline.notes[noteIndex] ?? null) : null;
  const last = practice?.last ?? null;
  const combo = practice?.score.combo ?? 0;
  const on = practice !== null;
  const nextIndex = practice?.next ?? -1;
  const next = nextIndex >= 0 ? (timeline.notes[nextIndex] ?? null) : null;
  const padPractice = useMemo<MobilePadPractice | null>(
    () => (on ? { last, combo, pressedKeys, next, onInput } : null),
    [on, last, combo, pressedKeys, next, onInput],
  );
  return (
    <>
      <MobilePad note={note} noteId={noteIndex} mobile={mobile} practice={padPractice} />
      {on ? <MobilePadCombo combo={combo} /> : null}
    </>
  );
}

function PlayerSeekBar({
  engine,
  timeline,
  disabled,
  onSeek,
  onStepLine,
}: ConnectedProps & {
  disabled: boolean;
  onSeek: (beat: number) => void;
  onStepLine: (dir: -1 | 1) => void;
}) {
  const beat = usePlayerState(engine, (s) => s.beat);
  const bpm = usePlayerState(engine, (s) => s.bpm);
  // Khấc trên thanh tiến độ tại đầu mỗi section không rỗng.
  const marks = useMemo(
    () =>
      timeline.sections
        .filter((s) => s.lineCount > 0 && s.endBeat > s.startBeat)
        .map((s) => s.startBeat),
    [timeline],
  );
  return (
    <SeekBar
      beat={beat}
      totalBeats={timeline.totalBeats}
      bpm={bpm}
      disabled={disabled}
      onSeek={onSeek}
      onStepLine={onStepLine}
      marks={marks}
    />
  );
}

function PlayerGameBar({ engine, timeline }: ConnectedProps) {
  const scheme = useSettings((s) => s.controlScheme);
  const noteIndex = usePlayerState(engine, (s) => s.noteIndex);
  const runIndex = usePlayerState(engine, (s) => s.runIndex);
  const practiceOn = usePlayerState(engine, (s) => s.practice !== null);
  const pressed = usePlayerState(engine, (s) => s.pressed);
  const mobile = usePlayerState(engine, (s) => s.mobile);
  const note = noteIndex >= 0 ? (timeline.notes[noteIndex] ?? null) : null;
  const run = runIndex >= 0 ? (timeline.holdRuns[runIndex] ?? null) : null;
  return (
    <GameBar
      note={note}
      noteId={noteIndex}
      run={run}
      pressed={practiceOn ? pressed : null}
      scheme={scheme}
      mobile={mobile}
    />
  );
}

function PlayerHoldBanner({ engine, timeline }: ConnectedProps) {
  const scheme = useSettings((s) => s.controlScheme);
  const runIndex = usePlayerState(engine, (s) => s.runIndex);
  const mobile = usePlayerState(engine, (s) => s.mobile);
  const run = runIndex >= 0 ? (timeline.holdRuns[runIndex] ?? null) : null;
  return <HoldBanner modifiers={run ? run.modifiers : null} scheme={scheme} mobile={mobile} />;
}

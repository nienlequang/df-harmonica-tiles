/**
 * Trang mini cho cửa sổ nổi Android — THỬ NGHIỆM (SPEC 2026-10-15 Phase 4m (c); route `#/mini/:id?delay=…`).
 * Thiết kế cho cửa sổ nổi nhỏ của hệ điều hành (~300×300 dp, dọc hay ngang): CHỈ có làn ô rơi + bàn nút
 * (kiểu Mobile như màn chơi kèn trên điện thoại, hoặc game bar PC theo Cài đặt) co theo khung, banner chế
 * độ gọn ngay trên hit line. ▶ → đếm ngược (theo Cài đặt → Phát bài, tối thiểu 3 giây — vòng R7; `?delay=` của
 * link đè được) → tự chạy, không cần chạm thêm (người chơi chạm vào game). Đếm vào theo Cài đặt → Phát bài. Chạm bất kỳ đâu = tạm dừng / chạy tiếp. Giữ màn hình sáng khi chạy.
 * Huy hiệu "Thử nghiệm", bảng ⓘ hướng dẫn theo hãng, "Cửa sổ video nổi (thử nghiệm)" (videoPip.ts), nút
 * "◂" về màn chơi của bài (chỉ khi đang dừng). Số lớn chỉ hiện lúc đếm ngược (ô đứng yên); đếm vào 1 ô
 * nhịp sau đó chỉ là đoạn ô rơi dẫn vào, không có số (góp ý 2026-10-16).
 *
 * Hai bố cục (nhớ theo máy — miniAlign.ts, góp ý 2026-10-16): "Khớp nút game" (mặc định của kiểu Mobile) =
 * cửa sổ nổi đặt NGAY TRÊN bảng nút kèn thật: 8 làn thẳng 8 nút số, hit line sát mép dưới, vòng "CHẠM" đáp
 * ngay trên nút chế độ thật (renderer `lanePadding: 'fit'`), không bàn nút / banner riêng, nhãn làn nhỏ;
 * "Căn chỉnh" (chỉ khi đang dừng) = vạch dẫn + bảng chỉnh một số mỗi lúc. "Thu nhỏ" (mặc định của kiểu PC) =
 * trang mini cũ (bàn nút / game bar riêng). Kiểu PC: panel lúc dừng nhắc "Đổi sang Mobile" (D-402).
 * Đúng tỉ lệ thật (D-405, D-412…D-415): máy Android cảm ứng đọc được cỡ màn hình (màn ngang, rộng hơn hẳn cửa sổ) →
 * lane đúng khoảng cách nút thật, hàng nút căn giữa cửa sổ; panel lúc dừng + Căn chỉnh có chỉ báo "Rộng" / "Cao" của
 * cửa sổ (MiniFitStatus).
 *
 * KHÔNG BAO GIỜ có âm thanh (kể cả khi bật trong Cài đặt): dùng OverlayEngine (không đụng src/audio).
 * Phím: Space chạy / dừng, R chơi lại (không phím nốt Z X C V B N M ,); Esc thoát Căn chỉnh.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { RefObject } from 'react';
import { GAME_SCROLL_DIR } from '../core/keys';
import { buildTimeline } from '../core/timeline';
import type { Timeline } from '../core/types';
import { useT } from '../i18n/useT';
import { entryTitle, useSong } from '../library/store';
import type { LibraryEntry } from '../library/store';
import { OverlayEngine } from '../overlay/overlayEngine';
import type { OverlayUiState } from '../overlay/overlayEngine';
import { GAME_LAYOUT_HIT_LINE } from '../overlay/overlayParams';
import { floatingCountdownSec } from '../pip/pipPrefs';
import { MIN_VIDEO_COUNTDOWN } from '../pip/videoPip';
import type { GuideVideoOptions } from '../pip/videoPip';
import { GameBar } from '../player/GameBar';
import { HoldBanner } from '../player/HoldBanner';
import { fitGeometry } from '../player/layout';
import type { FitGeometry, LaneFit } from '../player/layout';
import { MobilePad } from '../player/MobilePad';
import type { RendererOptions } from '../player/renderer';
import { Button, IconButton } from '../ui/components';
import { useModifierLabels } from '../ui/modLabels';
import type { ModifierLabels } from '../ui/modLabels';
import { href, paths } from '../ui/router';
import { useSettings } from '../ui/settings';
import type { ControlScheme } from '../ui/settings';
import { PLAYER_HOTKEYS, useHotkeys } from '../ui/useHotkeys';
import {
  MiniAlignGuides,
  MiniAlignPanel,
  MiniFitLabels,
  MiniFitNotice,
  MiniFitStatus,
  ShortLong,
  alignFocusOf,
} from './MiniCalibrate';
import type { AlignFocus } from './MiniCalibrate';
import {
  DEFAULT_CALIBRATION,
  MINI_LAYOUTS,
  NUDGE_FAST_PX,
  NUDGE_PX,
  browserChromeHeight,
  dismissFitWindowNotice,
  fitStatusOf,
  isAndroidTouch,
  laneFitOf,
  needsFitWindowNotice,
  nudgeCalibration,
  readCalibration,
  readMiniLayout,
  readScreenInfo,
  setCalibrationField,
  trueScaleOf,
  writeCalibration,
  writeMiniLayout,
} from './miniAlign';
import type {
  CalibrationField,
  FitStatus,
  MiniCalibration,
  MiniLayout,
  ScreenInfo,
  TrueScale,
} from './miniAlign';
import { MiniController, isMiniStopped, parseMiniDelay, rememberMiniSong } from './miniControl';
import type { MiniPhase, MiniState } from './miniControl';
import { MiniHelp } from './MiniHelp';
import type { MiniHelpSection } from './MiniHelp';
import { useVideoPip, VideoPipDialog } from './VideoPipDialog';
import { useScreenWakeLock } from './wakeLock';
import './mini.css';

export interface MiniViewProps {
  songId: string;
  /** Query đã gộp (router): `delay` = đếm ngược (giây 0..10) đè Cài đặt → Phát bài. */
  query: URLSearchParams;
}

/**
 * Option canvas cố định (PC): bố cục "khớp game" như cửa sổ nổi — 8 làn phủ kín, hit line sát đáy vùng
 * làn (game bar ngay dưới), lưới mờ, bỏ nhãn section (khung nhỏ). Mobile đè `lanePadding: 'pad'`
 * (`miniRendererOptions`): bàn nút giống màn chơi kèn phủ đáy khu làn, tâm lane = tâm nút số.
 */
export const MINI_RENDERER_OPTIONS: Readonly<Partial<RendererOptions>> = Object.freeze({
  orientation: 'vertical',
  hitLinePos: GAME_LAYOUT_HIT_LINE,
  lanePadding: 'none',
  gridStyle: 'subtle',
  tileOpacity: 1,
  background: 'theme',
  showRibbons: true,
  showBarLines: true,
  showSectionLabels: false,
});

/**
 * Option canvas cố định theo kiểu điều khiển + bố cục. "Khớp nút game" (`layout` = 'game'): lane theo nút thật
 * của game (`lanePadding: 'fit'` + `laneFit` từ Căn chỉnh) ở cả PC lẫn Mobile; "Thu nhỏ" (mặc định của hàm —
 * trang mini cũ): Mobile = bàn nút 'pad', PC = 'none' + game bar.
 */
export function miniRendererOptions(
  scheme: ControlScheme,
  layout: MiniLayout = 'compact',
  laneFit: LaneFit | null = null,
): Partial<RendererOptions> {
  if (layout === 'game') return { ...MINI_RENDERER_OPTIONS, lanePadding: 'fit', laneFit };
  return scheme === 'mobile'
    ? { ...MINI_RENDERER_OPTIONS, lanePadding: 'pad' }
    : { ...MINI_RENDERER_OPTIONS };
}

/** Hệ số ô theo bề rộng làn: 300 px → 0.6, ≥ 520 px → 1 (bậc 0.05 để không vẽ lại liên tục). */
export function miniTileScale(width: number): number {
  if (!Number.isFinite(width) || width <= 0) return 1;
  const raw = Math.min(1, Math.max(0.6, width / 520));
  return Math.round(raw * 20) / 20;
}

export function MiniView({ songId, query }: MiniViewProps) {
  const t = useT();
  const entry = useSong(songId);
  const scheme = useSettings((s) => s.controlScheme);
  const semitone = useSettings((s) => s.mobileSemitone);
  const countIn = useSettings((s) => s.countIn);
  // Đếm ngược theo Cài đặt → Phát bài (góp ý 2026-10-16: chỉ chỉnh ở Cài đặt), tối thiểu 3 giây (vòng R7: bấm
  // ▶ ở đây rồi còn phải chuyển vào game — Tắt → 3, 5 → 5); `?delay=` của link đè (link cũ / test).
  const settingsDelay = useSettings((s) => s.startDelaySec);
  const urlDelay = parseMiniDelay(query.get('delay'));
  const delay = urlDelay ?? floatingCountdownSec(settingsDelay);
  useEffect(() => {
    if (entry) rememberMiniSong(entry.id);
  }, [entry]);
  if (!entry) {
    return (
      <main className="mini mini-missing" role="region" aria-label={t('mini.region')}>
        <p className="mini-note" role="alert">
          {t('mini.songMissing', { id: songId })}
        </p>
        <a className="btn btn-secondary btn-md" href={href(paths.library())}>
          {t('mini.openLibrary')}
        </a>
      </main>
    );
  }
  // Đổi kiểu điều khiển / cách Nửa Cung / đếm vào trong Cài đặt → engine mới (option của OverlayEngine cố
  // định).
  return (
    <MiniStage
      key={`${entry.id}|${scheme}|${semitone}|${countIn ? 1 : 0}`}
      entry={entry}
      scheme={scheme}
      countIn={countIn}
      delay={delay}
    />
  );
}

function useEngineState<T>(engine: OverlayEngine, select: (s: OverlayUiState) => T): T {
  return useSyncExternalStore(
    engine.subscribe,
    () => select(engine.getState()),
    () => select(engine.getState()),
  );
}

function useMiniState<T>(control: MiniController, select: (s: MiniState) => T): T {
  return useSyncExternalStore(
    control.subscribe,
    () => select(control.getState()),
    () => select(control.getState()),
  );
}

/** Tên 4 nút (theo Cài đặt), identity ổn định khi chuỗi không đổi. */
function useStableLabels(): ModifierLabels {
  const l = useModifierLabels();
  return useMemo(
    () => ({ left: l.left, right: l.right, natural: l.natural, scroll: l.scroll }),
    [l.left, l.right, l.natural, l.scroll],
  );
}

/** Tiêu đề tab (thanh tiêu đề cửa sổ nổi); trả lại khi rời trang. */
function useDocumentTitle(title: string): void {
  useEffect(() => {
    const prev = document.title;
    document.title = title;
    return () => {
      document.title = prev;
    };
  }, [title]);
}

interface BoxSize {
  w: number;
  h: number;
}

/**
 * Kích thước vùng làn (px CSS, ResizeObserver) → tileScale + hình học "Khớp nút game" (vạch / nhãn DOM tính
 * bằng cùng `fitGeometry` với renderer). Object giữ nguyên khi không đổi (không render lại thừa).
 */
function useBoxSize(ref: RefObject<HTMLElement | null>): BoxSize {
  const [size, setSize] = useState<BoxSize>({ w: 0, h: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = (): void => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      setSize((prev) => (prev.w === w && prev.h === h ? prev : { w, h }));
    };
    update();
    if (typeof ResizeObserver !== 'function') {
      window.addEventListener('resize', update);
      return () => window.removeEventListener('resize', update);
    }
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return size;
}

/**
 * Chiều cao (px CSS, làm tròn lên) của phần tử `ref` khi `active` (ResizeObserver; đo trước khi vẽ để nhãn
 * không nhảy). Không active → giữ số cũ, người gọi không dùng tới.
 */
function useElementHeight(ref: RefObject<HTMLElement | null>, active: boolean): number {
  const [height, setHeight] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!active || !el) return;
    const update = (): void => setHeight(Math.ceil(el.getBoundingClientRect().height));
    update();
    if (typeof ResizeObserver !== 'function') {
      window.addEventListener('resize', update);
      return () => window.removeEventListener('resize', update);
    }
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, active]);
  return height;
}

/** Cỡ màn hình + phần trình duyệt chiếm trong cửa sổ (px CSS) — cho đúng tỉ lệ thật / chỉ báo "Cao". */
interface ViewportInfo {
  screen: ScreenInfo | null;
  /** outerHeight − innerHeight khi hợp lý (thanh địa chỉ của trình duyệt trong cửa sổ nổi), không thì 0. */
  chromeH: number;
}

function readChromeHeight(screen: ScreenInfo | null): number {
  try {
    return browserChromeHeight(
      window.innerHeight,
      window.outerHeight,
      screen ? Math.min(screen.width, screen.height) : 0,
    );
  } catch {
    return 0;
  }
}

function readViewportInfo(): ViewportInfo {
  const screen = readScreenInfo();
  return { screen, chromeH: readChromeHeight(screen) };
}

function sameViewportInfo(a: ViewportInfo, b: ViewportInfo): boolean {
  if (a.chromeH !== b.chromeH) return false;
  if (a.screen === b.screen) return true;
  if (!a.screen || !b.screen) return false;
  return (
    a.screen.width === b.screen.width &&
    a.screen.height === b.screen.height &&
    a.screen.landscape === b.screen.landscape
  );
}

/**
 * `window.screen` + phần trình duyệt, đọc lại khi cửa sổ đổi cỡ / xoay màn (object giữ nguyên khi không đổi). Cửa
 * sổ nổi kéo sang màn khác / xoay máy → cỡ màn mới.
 */
function useViewportInfo(): ViewportInfo {
  const [info, setInfo] = useState<ViewportInfo>(readViewportInfo);
  useEffect(() => {
    const update = (): void => {
      const next = readViewportInfo();
      setInfo((prev) => (sameViewportInfo(prev, next) ? prev : next));
    };
    update();
    window.addEventListener('resize', update);
    window.addEventListener('orientationchange', update);
    let orientation: ScreenOrientation | undefined;
    try {
      orientation = window.screen?.orientation;
      orientation?.addEventListener?.('change', update);
    } catch {
      orientation = undefined;
    }
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('orientationchange', update);
      orientation?.removeEventListener?.('change', update);
    };
  }, []);
  return info;
}

interface StageProps {
  entry: LibraryEntry;
  scheme: ControlScheme;
  /** Đếm vào (đoạn ô dẫn vào, không số — src/player/leadIn.ts) — Cài đặt → Phát bài. */
  countIn: boolean;
  /** Đếm ngược (giây). */
  delay: number;
}

function MiniStage({ entry, scheme, countIn, delay: delaySec }: StageProps) {
  const t = useT();
  const baseOctave = useSettings((s) => s.baseOctave);
  const mobileSemitone = useSettings((s) => s.mobileSemitone);
  const theme = useSettings((s) => s.theme);
  const language = useSettings((s) => s.language);
  const subLabel = useSettings((s) => s.subLabel);
  const lookahead = useSettings((s) => s.lookahead);
  const labels = useStableLabels();
  const song = entry.parsed.song;
  const title = entryTitle(entry) || t('common.untitled');
  useDocumentTitle(t('mini.windowTitle', { title }));

  const timeline = useMemo<Timeline>(
    () => buildTimeline(song, { baseOctave, scrollDir: GAME_SCROLL_DIR }),
    [song, baseOctave],
  );
  const hasNotes = timeline.notes.length > 0 && timeline.totalBeats > 0;

  // Engine im lặng của overlay: đếm vào (theo Cài đặt) bằng hình, đếm ngược do MiniController lo.
  const [engine] = useState(
    () =>
      new OverlayEngine(timeline, {
        bpm: song.bpm,
        countIn,
        loop: false,
        delaySec: 0,
        scheme,
        mobileSemitone,
      }),
  );
  const [control] = useState(() => new MiniController(engine, { delaySec }));
  useEffect(() => control.setDelay(delaySec), [control, delaySec]);

  const rootRef = useRef<HTMLDivElement>(null);
  const lanesRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const tapRef = useRef<HTMLButtonElement>(null);
  const playRef = useRef<HTMLButtonElement>(null);
  const videoHostRef = useRef<HTMLDivElement>(null);
  const alignFirstRef = useRef<HTMLButtonElement>(null);
  const alignOpenRef = useRef<HTMLButtonElement>(null);
  const alignPanelRef = useRef<HTMLDivElement>(null);
  const box = useBoxSize(lanesRef);
  const tileScale = miniTileScale(box.w);

  // Bố cục + số căn chỉnh: nhớ theo máy (localStorage, miniAlign.ts); chưa chọn → theo kiểu điều khiển.
  const [layout, setLayoutState] = useState<MiniLayout>(() => readMiniLayout(scheme));
  const [calib, setCalibState] = useState<MiniCalibration>(readCalibration);
  // Giá trị mới nhất cho nút − / + đang giữ (nhiều bước giữa hai lần render vẫn cộng dồn đúng).
  const calibRef = useRef(calib);
  const [calibrating, setCalibrating] = useState(false);
  // Thứ đang chỉnh trong Căn chỉnh (8 vạch / 4 vòng) — tô sáng trên vạch dẫn (D-416).
  const [alignFocus, setAlignFocus] = useState<AlignFocus>('lines');
  const game = layout === 'game';
  // Đúng tỉ lệ thật (D-405): màn ngang rộng hơn hẳn cửa sổ → bước cột theo px của màn; không → cửa sổ = hàng nút.
  const viewport = useViewportInfo();
  // Chỉ máy Android cảm ứng mới đặt cửa sổ nổi trên game (D-412): máy tính / iPhone → kiểu "cửa sổ = hàng nút".
  const [androidTouch] = useState(isAndroidTouch);
  const scale = useMemo<TrueScale | null>(
    () => trueScaleOf(viewport.screen, box.w, androidTouch),
    [viewport.screen, box.w, androidTouch],
  );
  const laneFit = useMemo(() => laneFitOf(calib, scale), [calib, scale]);
  // Hình học "Khớp nút game" của khung hiện tại (chưa đo được → chưa có vạch / nhãn).
  const fitGeo = useMemo<FitGeometry | null>(
    () => (game && box.w > 0 && box.h > 0 ? fitGeometry(box.w, box.h, laneFit) : null),
    [game, box, laneFit],
  );
  // Chỉ báo "Rộng" / "Cao" của cửa sổ so với hàng nút thật (chỉ khi biết cỡ màn).
  const fitStatus = useMemo<FitStatus | null>(
    () =>
      game && scale && box.w > 0 && box.h > 0
        ? fitStatusOf(box, viewport.chromeH, scale, calib)
        : null,
    [game, scale, box, viewport.chromeH, calib],
  );
  // Máy đã dùng trang mini trước v1.0.1, số căn chỉnh mặc định (D-441): cửa sổ vừa của kiểu "cửa sổ = 8 làn" rộng hơn
  // bản cũ ~1/4 nút mỗi bên mà kiểu này không có chỉ báo "Rộng" → nhắc một lần ở chỗ chỉ báo (đọc trước khi MiniView
  // ghi bài mở lần này). Chạm nhắc (mở hướng dẫn) / đổi số căn chỉnh → không nhắc nữa.
  const [fitNotice, setFitNotice] = useState(needsFitWindowNotice);
  const dismissFitNotice = (): void => {
    if (!fitNotice) return;
    setFitNotice(false);
    dismissFitWindowNotice();
  };
  const setLayout = (next: MiniLayout): void => {
    setLayoutState(next);
    writeMiniLayout(next);
    if (next !== 'game') setCalibrating(false);
  };
  const updateCalib = (next: MiniCalibration): void => {
    calibRef.current = next;
    setCalibState(next);
    writeCalibration(next);
    dismissFitNotice();
  };
  const onAlignField = (field: CalibrationField, value: number): void => {
    const cur = calibRef.current;
    const next = setCalibrationField(cur, field, value);
    if (next !== cur) updateCalib(next);
  };
  const onAlignNudge = (field: CalibrationField, dir: -1 | 1, fast: boolean): void => {
    const cur = calibRef.current;
    const next = nudgeCalibration(cur, field, dir, box.w, fast ? NUDGE_FAST_PX : NUDGE_PX, scale);
    if (next !== cur) updateCalib(next);
  };

  const rendererOptions = useMemo<Partial<RendererOptions>>(
    () => ({
      ...miniRendererOptions(scheme, layout, laneFit),
      theme,
      language,
      subLabel,
      lookahead,
      scheme,
      mobileSemitone,
      modLabels: labels,
      tileScale,
    }),
    [
      theme,
      language,
      subLabel,
      lookahead,
      scheme,
      mobileSemitone,
      labels,
      tileScale,
      layout,
      laneFit,
    ],
  );
  const optionsRef = useRef(rendererOptions);
  useLayoutEffect(() => {
    optionsRef.current = rendererOptions;
  });

  useEffect(() => {
    engine.attach({
      canvas: canvasRef.current,
      stage: rootRef.current,
      renderer: optionsRef.current,
    });
    return () => engine.detach();
  }, [engine]);
  useEffect(() => engine.setTimeline(timeline), [engine, timeline]);
  useEffect(() => engine.setRendererOptions(rendererOptions), [engine, rendererOptions]);
  useEffect(() => () => control.dispose(), [control]);

  const phase = useMiniState(control, (s) => s.phase);
  const countdown = useMiniState(control, (s) => s.countdown);
  const delay = useMiniState(control, (s) => s.delay);
  const ended = useEngineState(engine, (s) => s.ended);
  useEffect(() => {
    if (ended) control.markEnded();
  }, [ended, control]);

  const running = !isMiniStopped(phase);

  // Panel biến mất khi chạy → focus sang lớp chạm (Space / Enter vẫn dừng được); hiện lại → focus ▶.
  const prevPhase = useRef<MiniPhase>(phase);
  useEffect(() => {
    const was = prevPhase.current;
    prevPhase.current = phase;
    if (was === phase) return;
    const active = document.activeElement;
    const wasRunning = was === 'playing' || was === 'countdown';
    if (
      running &&
      !wasRunning &&
      (active === null ||
        active === document.body ||
        !active.isConnected ||
        rootRef.current?.contains(active))
    ) {
      tapRef.current?.focus({ preventScroll: true });
    } else if (!running && wasRunning && active === tapRef.current) {
      playRef.current?.focus({ preventScroll: true });
    }
  }, [phase, running]);

  const [helpOpen, setHelpOpen] = useState<MiniHelpSection | null>(null);
  const [videoOpen, setVideoOpen] = useState(false);

  // Căn chỉnh chỉ khi đang dừng; vào → focus nút chọn đầu ("Nút 1"), ra → focus lại nút "Căn chỉnh".
  const aligning = calibrating && game && !running;
  // Đáy bảng Căn chỉnh: nhãn số của vạch chỉ hiện bên dưới (không nằm sau bảng ở cửa sổ thấp).
  const alignPanelH = useElementHeight(alignPanelRef, aligning);
  const wasAligning = useRef(false);
  useEffect(() => {
    const was = wasAligning.current;
    wasAligning.current = aligning;
    if (aligning && !was) alignFirstRef.current?.focus({ preventScroll: true });
    else if (!aligning && was) alignOpenRef.current?.focus({ preventScroll: true });
  }, [aligning]);

  useHotkeys({
    // Đang căn chỉnh: Space / R không chạy bài (chạm nhầm khi kéo cửa sổ), Esc = Xong.
    [PLAYER_HOTKEYS.playPause]: hasNotes && !aligning ? () => control.tap() : undefined,
    [PLAYER_HOTKEYS.restart]: hasNotes && !aligning ? () => control.restart() : undefined,
    Escape:
      phase === 'countdown'
        ? () => control.cancelCountdown()
        : aligning
          ? () => setCalibrating(false)
          : undefined,
  });

  const videoCountdown = Math.max(MIN_VIDEO_COUNTDOWN, delay);
  const videoOptions = useMemo<GuideVideoOptions>(
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
      countdownSec: videoCountdown,
      countIn,
    }),
    [
      countIn,
      timeline,
      song.bpm,
      scheme,
      mobileSemitone,
      labels,
      theme,
      language,
      subLabel,
      lookahead,
      videoCountdown,
    ],
  );
  const pip = useVideoPip(videoOptions, videoHostRef);
  // Màn hình sáng khi đếm / chạy, và khi đang dựng video (màn tắt / trang xuống nền thì dựng chậm hẳn).
  useScreenWakeLock(running || pip.build.status === 'building');

  const tapLabel =
    phase === 'countdown'
      ? t('mini.tapCancel')
      : phase === 'playing'
        ? t('mini.tapPause')
        : phase === 'paused'
          ? t('mini.tapResume')
          : t('mini.start');

  return (
    <div
      ref={rootRef}
      className="mini"
      data-phase={phase}
      data-scheme={scheme}
      data-layout={layout}
      data-aligning={aligning ? 'true' : undefined}
      data-scale={game && scale ? 'true' : undefined}
      role="region"
      aria-label={t('mini.region')}
    >
      <div ref={lanesRef} className="mini-lanes">
        <canvas
          ref={canvasRef}
          className="mini-canvas"
          role="img"
          aria-label={t('player.canvas', { title })}
        />
        {/* Khớp nút game: không bàn nút riêng (nút thật nằm ngay dưới cửa sổ) — nhãn làn nhỏ ở đỉnh. */}
        {fitGeo && !aligning ? <MiniFitLabels geo={fitGeo} scheme={scheme} /> : null}
        {/* Banner ở đỉnh vùng làn (khung nhỏ: không che ô sắp chạm hit line). Khớp nút game + Mobile: không
            banner (D-403) — nó nằm chắn đường rơi của vòng "CHẠM" ở cột giữa, còn vòng + nút thật của game
            đã cho biết chế độ. PC vẫn có ("ĐANG GIỮ: …" chỉ lúc giữ). */}
        {game && scheme === 'mobile' ? null : (
          <div className="mini-banner">
            <MiniBanner engine={engine} scheme={scheme} labels={labels} />
          </div>
        )}
        {fitGeo && aligning ? (
          <MiniAlignGuides
            geo={fitGeo}
            scheme={scheme}
            labels={labels}
            topInset={alignPanelH}
            focus={alignFocus}
          />
        ) : null}
        {/* Thu nhỏ, Mobile: bàn nút giống màn chơi kèn phủ đáy khu làn (chỉ hiển thị — chạm là lớp chạm). */}
        {scheme === 'mobile' && !game ? (
          <MiniMobilePad engine={engine} timeline={timeline} />
        ) : null}
      </div>
      {scheme === 'mobile' || game ? null : (
        <MiniGameBar engine={engine} timeline={timeline} scheme={scheme} labels={labels} />
      )}

      {/* Lớp chạm phủ cả trang: chạm bất kỳ đâu = tạm dừng / chạy tiếp / hủy đếm ngược. Khi panel hiện,
          lớp chạm chỉ là nền (ẩn với trình đọc màn hình, ra khỏi thứ tự Tab) — nút ▶ là điểm chính. */}
      <button
        ref={tapRef}
        type="button"
        className="mini-tap"
        aria-label={tapLabel}
        aria-keyshortcuts={PLAYER_HOTKEYS.playPause}
        aria-hidden={running ? undefined : true}
        tabIndex={running ? 0 : -1}
        disabled={!hasNotes || aligning}
        onClick={() => control.tap()}
      />

      {phase === 'countdown' && countdown !== null ? (
        <div className="mini-countdown" role="status">
          <span key={countdown} className="mini-countdown-num" aria-hidden="true">
            {countdown}
          </span>
          <span className="mini-countdown-hint" aria-hidden="true">
            {t('mini.countdownHint')}
          </span>
          <span className="sr-only">{t('player.countdownAria', { n: countdown })}</span>
        </div>
      ) : null}

      {!running && !aligning ? (
        <MiniPanel
          backHref={href(paths.play(entry.id))}
          title={title}
          phase={phase}
          delay={delay}
          hasNotes={hasNotes}
          playRef={playRef}
          layout={layout}
          scheme={scheme}
          fit={fitStatus}
          fitNotice={
            // Chỉ khi đã đo khung (trước khi đo `scale` luôn null — máy biết cỡ màn không được nháy nhắc).
            fitNotice && game && !scale && box.w > 0
              ? () => {
                  dismissFitNotice();
                  setHelpOpen('fit');
                }
              : null
          }
          alignRef={alignOpenRef}
          onStart={() => control.start()}
          onRestart={() => control.restart()}
          onHelp={() => setHelpOpen('open')}
          onVideo={() => setVideoOpen(true)}
          onLayout={setLayout}
          onAlign={() => setCalibrating(true)}
          onUseMobile={() => useSettings.getState().set({ controlScheme: 'mobile' })}
        />
      ) : null}
      {aligning ? (
        <MiniAlignPanel
          calib={calib}
          scheme={scheme}
          scaled={scale !== null}
          status={fitStatus}
          onField={onAlignField}
          onNudge={onAlignNudge}
          onReset={() => updateCalib({ ...DEFAULT_CALIBRATION })}
          onDone={() => setCalibrating(false)}
          onHelp={() => setHelpOpen('fit')}
          firstRef={alignFirstRef}
          panelRef={alignPanelRef}
          onActiveField={(f) => setAlignFocus(alignFocusOf(f))}
        />
      ) : null}

      <div ref={videoHostRef} className="mini-video-host" aria-hidden="true" />
      <MiniHelp
        open={helpOpen !== null}
        section={helpOpen ?? 'open'}
        onClose={() => setHelpOpen(null)}
      />
      <VideoPipDialog
        open={videoOpen}
        onClose={() => setVideoOpen(false)}
        pip={pip}
        countdownSec={videoCountdown}
      />
    </div>
  );
}

interface PanelProps {
  /** Đích nút "◂": màn chơi chính của bài này (`#/play/<id>`). */
  backHref: string;
  title: string;
  phase: MiniPhase;
  delay: number;
  hasNotes: boolean;
  playRef: RefObject<HTMLButtonElement>;
  /** Bố cục đang dùng (nút "Khớp nút game" | "Thu nhỏ"; "Căn chỉnh" chỉ ở "Khớp nút game"). */
  layout: MiniLayout;
  /** Kiểu PC → dòng nhắc "Chơi bản điện thoại?" + nút "Đổi sang Mobile" (D-402). */
  scheme: ControlScheme;
  /** Chỉ báo cỡ cửa sổ (Khớp nút game + biết cỡ màn) — ở hàng đầu, trước ⓘ. */
  fit: FitStatus | null;
  /**
   * Nhắc một lần "cửa sổ rộng thêm ¼ nút mỗi bên" (máy dùng trang mini trước v1.0.1, Khớp nút game, không biết cỡ màn —
   * D-441): chạm = mở hướng dẫn + thôi nhắc. null = không nhắc. Ở chỗ chỉ báo (hai thứ không bao giờ cùng có).
   */
  fitNotice?: (() => void) | null;
  alignRef: RefObject<HTMLButtonElement>;
  onStart: () => void;
  onRestart: () => void;
  onHelp: () => void;
  onVideo: () => void;
  onLayout: (layout: MiniLayout) => void;
  onAlign: () => void;
  onUseMobile: () => void;
}

/**
 * Lớp điều khiển khi chưa chạy / tạm dừng / hết bài (ô rơi vẫn thấy phía sau). Nút "◂" (góp ý 2026-10-16:
 * trang mini không có nav app, iPhone ngang còn ẩn thanh công cụ Safari → không có lối ra) về màn chơi
 * chính của bài; chỉ có trong panel này nên không bao giờ hiện khi ô đang rơi / đang đếm ngược.
 * mini.css xếp lại theo cỡ cửa sổ (D-401): cửa sổ thấp (đặt ngay trên bảng nút, ~80–130 px) = 2 hàng [◂ tên … ⓘ]
 * và [▶ | bố cục | Căn chỉnh | Video nổi], không control nào chồng lên control khác.
 */
function MiniPanel({
  backHref,
  title,
  phase,
  delay,
  hasNotes,
  playRef,
  layout,
  alignRef,
  onStart,
  onRestart,
  onHelp,
  onVideo,
  onLayout,
  onAlign,
  scheme,
  fit,
  fitNotice = null,
  onUseMobile,
}: PanelProps) {
  const t = useT();
  const playText =
    phase === 'paused' ? t('mini.resume') : phase === 'ended' ? t('mini.replay') : t('mini.start');
  const pcNote = scheme === 'pc';
  return (
    <div className="mini-panel" data-layout={layout} data-note={pcNote ? 'pc' : undefined}>
      <div className="mini-top">
        <a
          className="btn btn-secondary btn-sm btn-icon mini-back"
          href={backHref}
          aria-label={t('mini.back')}
          title={t('mini.back')}
        >
          <span aria-hidden="true">◂</span>
        </a>
        <span className="mini-badge">{t('mini.experimental')}</span>
        <span className="mini-title">{title}</span>
        {fit ? (
          <MiniFitStatus status={fit} />
        ) : fitNotice ? (
          <MiniFitNotice onOpen={fitNotice} />
        ) : null}
        <IconButton size="sm" className="mini-help-btn" label={t('mini.help')} onClick={onHelp}>
          <span aria-hidden="true">ⓘ</span>
        </IconButton>
      </div>
      {pcNote ? (
        // Trang mini là cho cửa sổ nổi Android (bản mobile của game) mà Cài đặt mặc định là kiểu PC: nhắc +
        // đổi ngay tại đây (ghi settings.controlScheme như nút PC | Mobile của màn chơi).
        <div className="mini-scheme">
          <span className="mini-scheme-text">{t('mini.scheme.pcNote')}</span>
          <Button
            size="sm"
            className="mini-scheme-btn"
            title={t('mini.scheme.toMobileHint')}
            onClick={onUseMobile}
          >
            {t('mini.scheme.toMobile')}
          </Button>
        </div>
      ) : null}
      <div className="mini-center">
        {phase === 'paused' || phase === 'ended' ? (
          <p className="mini-state">{phase === 'paused' ? t('mini.paused') : t('mini.ended')}</p>
        ) : null}
        <div className="mini-center-row">
          <button
            ref={playRef}
            type="button"
            className="mini-play"
            disabled={!hasNotes}
            onClick={onStart}
          >
            <span className="mini-play-icon" aria-hidden="true">
              ▶
            </span>
            <span className="mini-play-text">{playText}</span>
          </button>
          {phase === 'paused' ? (
            <IconButton
              size="sm"
              className="mini-restart"
              label={t('mini.restart')}
              onClick={onRestart}
            >
              <span aria-hidden="true">↺</span>
            </IconButton>
          ) : null}
        </div>
        {!hasNotes ? (
          <p className="mini-note" role="status">
            {t('player.empty')}
          </p>
        ) : null}
      </div>
      <div className="mini-layout-row">
        {/* Bố cục (nhớ theo máy): hai nút bật / tắt kiểu PC | Mobile của thanh dọc màn chơi. */}
        <span className="mini-seg" role="group" aria-label={t('mini.layout.group')}>
          {MINI_LAYOUTS.map((value) => {
            const name = t(value === 'game' ? 'mini.layout.game' : 'mini.layout.compact');
            return (
              <button
                key={value}
                type="button"
                className="btn btn-sm mini-seg-btn"
                aria-pressed={layout === value}
                aria-label={name}
                title={t(value === 'game' ? 'mini.layout.gameHint' : 'mini.layout.compactHint')}
                onClick={() => onLayout(value)}
              >
                {value === 'game' ? (
                  <ShortLong long={name} short={t('mini.layout.gameShort')} />
                ) : (
                  name
                )}
              </button>
            );
          })}
        </span>
        {layout === 'game' ? (
          <button
            ref={alignRef}
            type="button"
            className="btn btn-secondary btn-sm mini-align-btn"
            title={t('mini.align.openHint')}
            onClick={onAlign}
          >
            {t('mini.align.open')}
          </button>
        ) : null}
      </div>
      <div className="mini-bottom">
        {/* Đếm ngược chỉ chỉnh ở Cài đặt → Phát bài (góp ý 2026-10-16) — ở đây chỉ nhắc giá trị. */}
        <span className="mini-delay">
          {t('mini.delayInfo', {
            value: delay > 0 ? t('mini.delayValue', { n: delay }) : t('mini.delayOff'),
          })}
        </span>
        <Button
          size="sm"
          className="mini-video-btn"
          aria-label={t('mini.video.button')}
          onClick={onVideo}
        >
          <ShortLong long={t('mini.video.button')} short={t('mini.video.buttonShort')} />
        </Button>
      </div>
    </div>
  );
}

interface ConnectedProps {
  engine: OverlayEngine;
  scheme: ControlScheme;
  labels: ModifierLabels;
}

/** Banner gọn trên hit line: "CHẾ ĐỘ: …" + "SẮP CHẠM: …" (Mobile) / "ĐANG GIỮ: …" (PC). */
function MiniBanner({ engine, scheme, labels }: ConnectedProps) {
  const runIndex = useEngineState(engine, (s) => s.runIndex);
  const mobile = useEngineState(engine, (s) => s.mobile);
  const run = runIndex >= 0 ? (engine.timeline.holdRuns[runIndex] ?? null) : null;
  return (
    <HoldBanner
      modifiers={run ? run.modifiers : null}
      scheme={scheme}
      mobile={mobile}
      labels={labels}
    />
  );
}

/** Mobile: bàn nút kiểu game (MobilePad của Player, không luyện tập → chỉ hiển thị). */
function MiniMobilePad({ engine, timeline }: { engine: OverlayEngine; timeline: Timeline }) {
  const noteIndex = useEngineState(engine, (s) => s.noteIndex);
  const mobile = useEngineState(engine, (s) => s.mobile);
  const note = noteIndex >= 0 ? (timeline.notes[noteIndex] ?? null) : null;
  return <MobilePad className="mini-mpad" note={note} noteId={noteIndex} mobile={mobile} />;
}

/** PC: game bar dưới làn (chỉ hiển thị — người chơi bấm phím thật trong game). */
function MiniGameBar({
  engine,
  timeline,
  scheme,
  labels,
}: ConnectedProps & { timeline: Timeline }) {
  const noteIndex = useEngineState(engine, (s) => s.noteIndex);
  const runIndex = useEngineState(engine, (s) => s.runIndex);
  const mobile = useEngineState(engine, (s) => s.mobile);
  const note = noteIndex >= 0 ? (timeline.notes[noteIndex] ?? null) : null;
  const run = runIndex >= 0 ? (timeline.holdRuns[runIndex] ?? null) : null;
  return (
    <GameBar
      className="mini-pad"
      note={note}
      noteId={noteIndex}
      run={run}
      scheme={scheme}
      mobile={mobile}
      labels={labels}
    />
  );
}

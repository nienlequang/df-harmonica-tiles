import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { CSSProperties } from 'react';
import { GAME_SCROLL_DIR, NOTE_KEYS } from '../core/keys';
import { decodeShareData } from '../core/share';
import { buildTimeline } from '../core/timeline';
import type { ParseResult, Timeline } from '../core/types';
import type { Lang } from '../i18n/strings';
import { useT } from '../i18n/useT';
import { parseSongSource, useSong } from '../library/store';
import { GameBar } from '../player/GameBar';
import { HoldBanner } from '../player/HoldBanner';
import type { RendererOptions } from '../player/renderer';
import { modifierLabels } from '../ui/modLabels';
import type { ModifierLabels } from '../ui/modLabels';
import { useSettings } from '../ui/settings';
import type { ControlScheme, Theme } from '../ui/settings';
import { PLAYER_HOTKEYS, useHotkeys } from '../ui/useHotkeys';
import { useDfhtCommands } from './commands';
import type { FollowDisplay, FollowMessage, FollowStateMessage } from './follow';
import {
  FOLLOW_CHANNEL,
  FOLLOW_EVENT,
  followNow,
  newFollowSenderId,
  sameFollowDisplay,
  songKeyOf,
} from './follow';
import { FollowReceiver } from './followReceiver';
import type { FollowMode, FollowReceiverState } from './followReceiver';
import { OverlayEngine } from './overlayEngine';
import type { OverlayUiState } from './overlayEngine';
import {
  GAME_LAYOUT_HIT_LINE,
  canvasFrame,
  canvasPlacement,
  gameKeyboardBox,
  overlayRendererOptions,
  parseOverlayParams,
  presetOf,
} from './overlayParams';
import type { Box, OverlayBackground, OverlayParams } from './overlayParams';
import './overlay.css';

export interface OverlayViewProps {
  /** id từ `#/overlay/:id` hoặc `?song=` (router); '' nếu không có. */
  songId: string;
  /** Query đã gộp (location.search + `?…` trong hash). */
  query: URLSearchParams;
}

/** id giả cho bài nhúng bằng `data=` (không nằm trong thư viện, không lưu). */
const DATA_SONG_ID = 'overlay-data';
/** id giả cho bài nhận từ Player chính. */
const FOLLOW_SONG_ID = 'overlay-follow';

const BG_CLASSES: Readonly<Record<OverlayBackground, string>> = {
  transparent: 'overlay-bg-transparent',
  chroma: 'overlay-bg-chroma',
  theme: 'overlay-bg-theme',
};

/** Class của cửa sổ "Xem trước" (`preview=1`): nền tối thường thay cho nền trong suốt (overlay.css). */
const PREVIEW_CLASS = 'overlay-preview';

/**
 * Nền trang theo `bg` + `html.overlay-mode` (App cũng bật cờ này cho route overlay; script inline trong
 * index.html đặt sẵn cả hai trước khi chunk overlay tải xong — bỏ class nền cũ nếu lệch). `preview` thêm
 * class nền tối của cửa sổ "Xem trước".
 */
function useOverlayDocument(bg: OverlayBackground, preview: boolean): void {
  useLayoutEffect(() => {
    const root = document.documentElement;
    const cls = BG_CLASSES[bg];
    root.classList.remove(...Object.values(BG_CLASSES));
    root.classList.add('overlay-mode', cls);
    root.classList.toggle(PREVIEW_CLASS, preview);
    return () => {
      root.classList.remove(cls, PREVIEW_CLASS);
    };
  }, [bg, preview]);
}

type SongError = 'noSong' | 'notFound' | 'badData' | 'empty';
type SongResult =
  | { ok: true; parsed: ParseResult; title: string; source: string }
  | { ok: false; error: SongError; id: string; title: string };

function hasNotesIn(parsed: ParseResult): boolean {
  return parsed.song.sections.some((s) =>
    s.lines.some((l) => l.units.some((u) => u.kind !== 'rest')),
  );
}

function songResult(parsed: ParseResult, source: string, id: string): SongResult {
  const title = parsed.song.title.trim();
  if (!hasNotesIn(parsed)) return { ok: false, error: 'empty', id, title };
  return { ok: true, parsed, title, source };
}

/** Bài nhúng trong link (`data=` thắng `song=` / id của route). */
function useLinkSong(songId: string, params: OverlayParams): SongResult {
  const id = songId || params.song || '';
  // Hook luôn được gọi (thứ tự hook cố định); data= thắng id.
  const entry = useSong(params.data !== null ? '' : id);
  return useMemo<SongResult>(() => {
    if (params.data !== null) {
      const source = decodeShareData(params.data);
      if (source === null) return { ok: false, error: 'badData', id, title: '' };
      return songResult(parseSongSource(DATA_SONG_ID, source), source, id);
    }
    if (id === '') return { ok: false, error: 'noSong', id, title: '' };
    if (!entry) return { ok: false, error: 'notFound', id, title: '' };
    return songResult(entry.parsed, entry.source, id);
  }, [entry, id, params.data]);
}

// ---------------------------------------------------------------------------
// Theo Player chính
// ---------------------------------------------------------------------------

/**
 * Bộ nhận tin của Player chính cho cả đời trang overlay: BroadcastChannel (overlay cùng trình duyệt) +
 * window CustomEvent `FOLLOW_EVENT` (obs-browser `emit_event` trong Browser Source của OBS). Gửi `hello`
 * khi mở; không nghe thấy Player sau ~2 s → tự chạy (receiver chuyển `standalone`).
 */
function useFollowReceiver(): FollowReceiverState {
  const [receiver] = useState(() => new FollowReceiver({ selfId: newFollowSenderId() }));
  const state = useSyncExternalStore(receiver.subscribe, receiver.getState, receiver.getState);
  useEffect(() => {
    let channel: BroadcastChannel | null = null;
    if (typeof BroadcastChannel === 'function') {
      try {
        channel = new BroadcastChannel(FOLLOW_CHANNEL);
      } catch {
        channel = null;
      }
    }
    const onChannel = (e: MessageEvent) => receiver.receive(e.data);
    const onObsEvent = (e: Event) => receiver.receive((e as CustomEvent<unknown>).detail);
    channel?.addEventListener('message', onChannel);
    window.addEventListener(FOLLOW_EVENT, onObsEvent);
    const ch = channel;
    receiver.start(ch ? (m: FollowMessage) => ch.postMessage(m) : null);
    return () => {
      receiver.stop();
      ch?.removeEventListener('message', onChannel);
      window.removeEventListener(FOLLOW_EVENT, onObsEvent);
      ch?.close();
    };
  }, [receiver]);
  return state;
}

/** Đang (hoặc vừa) theo một Player: bài + hiển thị lấy theo Player, không theo link. */
function isFollowing(mode: FollowMode): boolean {
  return mode === 'follow' || mode === 'lost';
}

/**
 * Trang overlay không bao giờ LƯU Cài đặt (cửa sổ "Xem trước" dùng chung localStorage với app: ghi cả bộ
 * Cài đặt cũ trong bộ nhớ sẽ đè lên thay đổi mới ở tab Player). Ngôn ngữ + theme theo Player / link chỉ
 * áp trong bộ nhớ → <html lang / data-theme> và chữ của banner / game bar theo ngay.
 */
function useOverlaySettingsMirror(language: Lang, theme: Theme): void {
  useLayoutEffect(() => {
    const api = useSettings.persist;
    const original = api.getOptions().storage;
    if (!original) return;
    api.setOptions({
      storage: {
        getItem: (name) => original.getItem(name),
        setItem: () => {},
        removeItem: () => {},
      },
    });
    return () => api.setOptions({ storage: original });
  }, []);
  useLayoutEffect(() => {
    const s = useSettings.getState();
    if (s.language !== language || s.theme !== theme) s.set({ language, theme });
  }, [language, theme]);
}

/**
 * Giữ nguyên object hiển thị khi giá trị không đổi: mỗi heartbeat (1 giây) mang một `display` mới — không
 * được đẩy option renderer / tên nút lại mỗi giây.
 */
function useStableDisplay(next: FollowDisplay): FollowDisplay {
  const ref = useRef(next);
  if (ref.current !== next && !sameFollowDisplay(ref.current, next)) ref.current = next;
  return ref.current;
}

/** Hiển thị dùng khi tự chạy: ảnh chụp Cài đặt của Player trong link; thiếu thì theo trình duyệt đang mở. */
function useLinkDisplay(params: OverlayParams): FollowDisplay {
  const language = useSettings((s) => s.language);
  const theme = useSettings((s) => s.theme);
  const subLabel = useSettings((s) => s.subLabel);
  return useMemo<FollowDisplay>(
    () => ({
      scheme: params.scheme,
      mobileSemitone: params.semitone,
      labels: params.names,
      lookahead: params.lookahead,
      tileScale: params.tileScale,
      subLabel: params.subLabel ?? subLabel,
      countIn: params.countIn,
      language: params.lang ?? language,
      theme: params.theme ?? theme,
    }),
    [params, language, theme, subLabel],
  );
}

// ---------------------------------------------------------------------------
// Khung cửa sổ (trình duyệt thường, không phải OBS)
// ---------------------------------------------------------------------------

/** Trang đang chạy trong Browser Source của OBS (obs-browser gắn `window.obsstudio`). */
function inObsBrowser(): boolean {
  return typeof window !== 'undefined' && 'obsstudio' in window;
}

function subscribeResize(cb: () => void): () => void {
  window.addEventListener('resize', cb);
  return () => window.removeEventListener('resize', cb);
}

const viewportKey = (): string => `${window.innerWidth}x${window.innerHeight}`;

/** Kích thước viewport (Browser Source = canvas OBS; cửa sổ "Xem trước" = cỡ cửa sổ). */
function useViewport(): { width: number; height: number } {
  const key = useSyncExternalStore(subscribeResize, viewportKey, () => '0x0');
  return useMemo(() => {
    const [w, h] = key.split('x').map(Number);
    return { width: w || 0, height: h || 0 };
  }, [key]);
}

/**
 * Chữ nhỏ ở góc của cửa sổ trình duyệt thường (không bao giờ vẽ trong OBS — không được lên stream): dòng
 * trạng thái "Đang chờ màn chơi…" (góc trên trái) và, ở cửa sổ "Xem trước", nhãn "Xem trước · không dùng để
 * quay" (góc trên phải). Vòng R6 bỏ nút "⛶ Toàn màn hình" cùng cách Window Capture.
 */
function OverlayWindowChrome({ waiting, preview }: { waiting: boolean; preview: boolean }) {
  const t = useT();
  const [obs] = useState(inObsBrowser);
  if (obs) return null;
  return (
    <>
      {preview ? <p className="overlay-preview-badge">{t('overlay.preview.badge')}</p> : null}
      <div className="overlay-status" role="status" aria-live="polite">
        {waiting ? <span className="overlay-status-text">{t('overlay.waiting')}</span> : null}
      </div>
    </>
  );
}

const boxStyle = (b: Box): CSSProperties => ({
  left: `${b.x}px`,
  top: `${b.y}px`,
  width: `${b.width}px`,
  height: `${b.height}px`,
});

/**
 * Nền của cửa sổ "Xem trước" ở bố cục cả canvas: khung 16:9 = màn stream (cửa sổ khác tỉ lệ thì thấy viền)
 * + bảng phím game MINH HỌA (8 keycap thẳng 8 làn, theo tinh chỉnh cỡ UI game) — trên stream ô rơi xuống bảng
 * phím thật của game; ở đây không có game nên vẽ phác. Kiểu Mobile: không phác keycap PC, cũng không bàn nút
 * (R7-4: overlay chỉ vẽ 4 vòng mờ ở hàng nút chế độ — đích của vòng "CHẠM"). Chỉ trang trí (aria-hidden); link
 * Browser Source không có `preview` nên OBS không bao giờ vẽ phần này.
 */
function OverlayPreviewBackdrop({ scale, scheme }: { scale: number; scheme: ControlScheme }) {
  const viewport = useViewport();
  const frame = canvasFrame(viewport.width, viewport.height);
  const kb = gameKeyboardBox(viewport.width, viewport.height, scale);
  const frameBox: Box = {
    x: Math.round(frame.x),
    y: Math.round(frame.y),
    width: Math.round(frame.width),
    height: Math.round(frame.height),
  };
  return (
    <div className="overlay-preview-backdrop" aria-hidden="true">
      <div className="overlay-preview-frame" style={boxStyle(frameBox)} />
      {scheme === 'mobile' ? null : (
        <>
          <div className="overlay-preview-keyboard" style={boxStyle(kb.panel)} />
          {kb.keys.map((k, i) => (
            <span
              key={NOTE_KEYS[i]}
              className="overlay-preview-key"
              style={{ ...boxStyle(k), fontSize: `${Math.max(7, Math.round(k.height * 0.55))}px` }}
            >
              {NOTE_KEYS[i]}
            </span>
          ))}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// View
// ---------------------------------------------------------------------------

/**
 * Overlay OBS (spec §7): route `#/overlay/:id?…` / `?overlay=1&song=…`. Không có chrome của app, nền
 * trong suốt (hoặc chroma / theme), KHÔNG BAO GIỜ có âm thanh (OverlayEngine không đụng src/audio).
 * Là màn hiển thị của Player chính (follow.ts): nghe thấy Player thì bài, phát / dừng / tua / tempo /
 * loop và hiển thị theo Player; không nghe thấy sau ~2 s thì tự chạy bài trong link (ảnh chụp Cài đặt
 * của Player). Tham số: overlayParams.ts. Link hỏng / thiếu bài (khi tự chạy) → thẻ báo lỗi nhỏ.
 */
export function OverlayView({ songId, query }: OverlayViewProps) {
  const params = useMemo(() => parseOverlayParams(query), [query]);
  useOverlayDocument(params.bg, params.preview);
  const link = useLinkSong(songId, params);
  const follow = useFollowReceiver();
  const linkDisplay = useLinkDisplay(params);
  const following = isFollowing(follow.mode);
  const display = useStableDisplay(following && follow.state ? follow.state.display : linkDisplay);
  useOverlaySettingsMirror(display.language, display.theme);

  const linkKey = useMemo(() => (link.ok ? songKeyOf(link.source) : null), [link]);
  const followSource = follow.song?.source ?? null;
  const followed = useMemo<SongResult | null>(
    () =>
      followSource === null
        ? null
        : songResult(parseSongSource(FOLLOW_SONG_ID, followSource), followSource, ''),
    [followSource],
  );

  let shown: { parsed: ParseResult; title: string; key: string } | null = null;
  let error: SongResult | null = null;
  if (following) {
    // Bài của Player: tin `song`; chưa tới thì dùng tạm bài trong link nếu đúng bài đó, không thì trống.
    const target = follow.state?.songKey ?? follow.song?.songKey ?? null;
    if (follow.song && followed?.ok && follow.song.songKey === target) {
      shown = { parsed: followed.parsed, title: followed.title, key: follow.song.songKey };
    } else if (link.ok && linkKey !== null && linkKey === target) {
      shown = { parsed: link.parsed, title: link.title, key: linkKey };
    }
  } else if (link.ok && linkKey !== null) {
    shown = { parsed: link.parsed, title: link.title, key: linkKey };
  } else if (follow.mode === 'standalone') {
    error = link;
  }

  return (
    <>
      {params.preview && params.fit === 'canvas' ? (
        <OverlayPreviewBackdrop scale={params.scale} scheme={display.scheme} />
      ) : null}
      {shown ? (
        // key: bài / URL đổi → engine mới với option mới.
        <OverlayStage
          key={`${shown.key}|${query.toString()}`}
          parsed={shown.parsed}
          title={shown.title}
          songKey={shown.key}
          params={params}
          display={display}
          mode={follow.mode}
          followState={follow.state}
        />
      ) : error && !error.ok ? (
        <OverlayError error={error.error} id={error.id} title={error.title} />
      ) : null}
      <OverlayWindowChrome
        waiting={!shown || follow.mode === 'waiting' || follow.mode === 'lost'}
        preview={params.preview}
      />
    </>
  );
}

function OverlayError({ error, id, title }: { error: SongError; id: string; title: string }) {
  const t = useT();
  const detail =
    error === 'notFound'
      ? t('overlay.error.notFound', { id })
      : error === 'badData'
        ? t('overlay.error.badData')
        : error === 'empty'
          ? t('overlay.error.empty', { title: title || t('common.untitled') })
          : t('overlay.error.noSong');
  return (
    <main className="overlay-error-wrap">
      <section className="overlay-error" role="alert" data-error={error}>
        <h1 className="overlay-error-title">{t('overlay.error.title')}</h1>
        <p>{detail}</p>
        <p className="overlay-error-hint">{t('overlay.error.hint')}</p>
      </section>
    </main>
  );
}

function useOverlayState<T>(engine: OverlayEngine, select: (s: OverlayUiState) => T): T {
  return useSyncExternalStore(
    engine.subscribe,
    () => select(engine.getState()),
    () => select(engine.getState()),
  );
}

function useOverlayTimeline(parsed: ParseResult): Timeline {
  const baseOctave = useSettings((s) => s.baseOctave);
  const song = parsed.song;
  return useMemo(
    () => buildTimeline(song, { baseOctave, scrollDir: GAME_SCROLL_DIR }),
    [song, baseOctave],
  );
}

/**
 * Tên 4 nút: theo Player (khi theo) hoặc link (`nl` / `nr` / `nn` / `ns` — Cài đặt của người tạo link),
 * thiếu thì tên mặc định theo ngôn ngữ. Không đọc tên tùy chỉnh trong Cài đặt của trình duyệt đang mở
 * (OBS có bộ nhớ riêng — Player / link là nguồn duy nhất, overlay và Player hiện cùng tên).
 */
function useDisplayLabels(display: FollowDisplay): ModifierLabels {
  return useMemo(
    () => modifierLabels(display.language, display.labels),
    [display.language, display.labels],
  );
}

interface StageProps {
  parsed: ParseResult;
  title: string;
  songKey: string;
  params: OverlayParams;
  display: FollowDisplay;
  mode: FollowMode;
  followState: FollowStateMessage | null;
}

function OverlayStage({ parsed, title, songKey, params, display, mode, followState }: StageProps) {
  const t = useT();
  const timeline = useOverlayTimeline(parsed);
  const labels = useDisplayLabels(display);
  const viewport = useViewport();
  const canvasFit = params.fit === 'canvas';
  const placement = useMemo(
    () =>
      canvasFit
        ? canvasPlacement(
            presetOf(params),
            viewport.width,
            viewport.height,
            params.scale,
            display.tileScale,
          )
        : null,
    [canvasFit, params, viewport.width, viewport.height, display.tileScale],
  );
  // Kiểu Mobile + lane dọc: hình học bàn nút như màn chơi (làn thẳng nút, hit line = đỉnh hàng nút số) nhưng
  // KHÔNG vẽ bàn nút đầy đủ (R7-4 — trên stream nút thật của game nằm bên dưới): renderer chỉ vẽ 4 vòng mờ ở
  // hàng nút chế độ, vòng "CHẠM" đáp vào đó (`modeTargets: 'outline'`). Lane ngang: 4 vòng mờ sau hit line.
  // Kiểu Mobile không bao giờ có game bar (bản game bar Mobile = 4 nút chế độ + 8 nút số, tức bàn nút đầy đủ),
  // kể cả lane ngang với `gamebar=1` — tên chế độ ở banner (D-390).
  const padLayout = display.scheme === 'mobile' && params.lanes === 'vertical';
  const showGameBar = params.gamebar && display.scheme !== 'mobile';
  const rendererOptions = useMemo<Partial<RendererOptions>>(
    () => ({
      ...overlayRendererOptions(params),
      ...(padLayout ? { lanePadding: 'pad' as const } : {}),
      modeTargets: 'outline',
      lookahead: display.lookahead,
      tileScale: placement ? placement.rendererScale : params.scale * display.tileScale,
      scheme: display.scheme,
      mobileSemitone: display.mobileSemitone,
      theme: display.theme,
      language: display.language,
      subLabel: display.subLabel,
      modLabels: labels,
    }),
    [params, display, placement, labels, padLayout],
  );
  const [engine] = useState(
    () =>
      new OverlayEngine(timeline, {
        bpm: params.bpm ?? parsed.song.bpm,
        countIn: params.countIn,
        loop: false,
        delaySec: params.delaySec,
        scheme: display.scheme,
        mobileSemitone: display.mobileSemitone,
      }),
  );
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  // Attach đọc option mới nhất qua ref (không gắn lại engine mỗi khi theme / ngôn ngữ đổi).
  const optionsRef = useRef(rendererOptions);
  useLayoutEffect(() => {
    optionsRef.current = rendererOptions;
  });

  useEffect(() => {
    engine.attach({
      canvas: canvasRef.current,
      stage: stageRef.current,
      renderer: optionsRef.current,
    });
    return () => engine.detach();
  }, [engine]);

  // Tiêu đề tab / cửa sổ riêng (cửa sổ "Xem trước" nói rõ là xem trước, không để quay); trả lại khi rời
  // overlay.
  const songTitle = title || t('common.untitled');
  const windowTitle = params.preview
    ? `${t('overlay.preview.title')} — ${songTitle}`
    : `${songTitle} — ${t('overlay.region')}`;
  useEffect(() => {
    const prev = document.title;
    document.title = windowTitle;
    return () => {
      document.title = prev;
    };
  }, [windowTitle]);

  useEffect(() => engine.setTimeline(timeline), [engine, timeline]);
  useEffect(() => engine.setRendererOptions(rendererOptions), [engine, rendererOptions]);
  useEffect(
    () => engine.setScheme(display.scheme, display.mobileSemitone),
    [engine, display.scheme, display.mobileSemitone],
  );

  // Theo Player: mỗi tin `state` của đúng bài này → chép trạng thái (engine tự bỏ qua lệch nhỏ).
  const following = mode === 'follow';
  const state = followState && followState.songKey === songKey ? followState : null;
  useEffect(() => {
    if (following && state) engine.applyFollow(state, followNow());
  }, [engine, following, state]);
  // Mất Player → dừng tại chỗ, chờ.
  useEffect(() => {
    if (mode === 'lost') engine.followPause();
  }, [engine, mode]);
  // Không nghe thấy Player → tự chạy bài trong link (đếm ngược + đếm vào theo link, không lặp).
  useEffect(() => {
    if (mode === 'standalone' && !engine.isFollowing && !engine.getState().started) engine.play();
  }, [engine, mode]);

  // Điều khiển tại chỗ (Space / R / ← / →, bấm, `dfht:command`) chỉ khi KHÔNG theo Player — đang theo
  // thì overlay chỉ hiển thị, mọi chỉnh ở Player chính.
  const local = mode !== 'follow';
  useHotkeys(
    {
      [PLAYER_HOTKEYS.playPause]: () => engine.toggle(),
      [PLAYER_HOTKEYS.restart]: () => engine.restart(),
      [PLAYER_HOTKEYS.prevLine]: () => engine.prevLine(),
      [PLAYER_HOTKEYS.nextLine]: () => engine.nextLine(),
    },
    { enabled: local },
  );
  useDfhtCommands(
    {
      toggle: () => engine.toggle(),
      restart: () => engine.restart(),
      nextLine: () => engine.nextLine(),
      prevLine: () => engine.prevLine(),
    },
    local,
  );

  const countdown = useOverlayState(engine, (s) => s.countdown);

  const vertical = params.lanes === 'vertical';
  // Bàn nút ở đáy khu làn → banner ở đầu khu làn (như màn chơi kiểu Mobile).
  const topBanner = params.banner && padLayout;
  const floatBanner = params.banner && !padLayout && params.layout === 'game' && vertical;
  const flowBanner = params.banner && !floatBanner && !topBanner;
  const label = t('overlay.canvas', { title: title || t('common.untitled') });

  // Bấm / chạm (OBS "Interact", hoặc cửa sổ trình duyệt) khi tự chạy: chạy khi đang dừng; không bao giờ
  // tạm dừng (bấm để focus cửa sổ không được làm dừng bài).
  const onClick = () => {
    if (local && !engine.getState().playing) engine.play();
  };

  const style: CSSProperties | undefined = placement
    ? {
        left: `${placement.x}px`,
        top: `${placement.y}px`,
        width: `${placement.width}px`,
        height: `${placement.height}px`,
      }
    : undefined;

  return (
    <div
      ref={stageRef}
      className={`overlay overlay-layout-${params.layout} overlay-lanes-${params.lanes} overlay-fit-${params.fit}`}
      role="region"
      aria-label={t('overlay.region')}
      data-mode={mode}
      data-scheme={display.scheme}
      style={style}
      onClick={onClick}
    >
      {flowBanner && !vertical ? (
        <OverlayBanner engine={engine} display={display} labels={labels} />
      ) : null}
      <div className="overlay-canvas-wrap">
        <div className="overlay-canvas-box">
          <canvas ref={canvasRef} className="overlay-canvas" role="img" aria-label={label} />
          {topBanner ? (
            <div className="overlay-banner-float overlay-banner-top">
              <OverlayBanner engine={engine} display={display} labels={labels} />
            </div>
          ) : null}
          {floatBanner ? (
            <div
              className="overlay-banner-float"
              style={{
                bottom: `calc(${Math.round((1 - GAME_LAYOUT_HIT_LINE) * 1000) / 10}% + 6px)`,
              }}
            >
              <OverlayBanner engine={engine} display={display} labels={labels} />
            </div>
          ) : null}
          {countdown !== null ? (
            <div className="overlay-countdown" role="status">
              <span key={countdown} className="overlay-countdown-num" aria-hidden="true">
                {countdown}
              </span>
              <span className="sr-only">{t('overlay.countdownAria', { n: countdown })}</span>
            </div>
          ) : null}
        </div>
      </div>
      {flowBanner && vertical ? (
        <OverlayBanner engine={engine} display={display} labels={labels} />
      ) : null}
      {showGameBar ? (
        <OverlayGameBar engine={engine} timeline={timeline} display={display} labels={labels} />
      ) : null}
    </div>
  );
}

interface ConnectedProps {
  engine: OverlayEngine;
  display: FollowDisplay;
  labels: ModifierLabels;
}

function OverlayBanner({ engine, display, labels }: ConnectedProps) {
  const runIndex = useOverlayState(engine, (s) => s.runIndex);
  const mobile = useOverlayState(engine, (s) => s.mobile);
  const run = runIndex >= 0 ? (engine.timeline.holdRuns[runIndex] ?? null) : null;
  return (
    <div className="overlay-banner">
      <HoldBanner
        modifiers={run ? run.modifiers : null}
        scheme={display.scheme}
        mobile={mobile}
        labels={labels}
      />
    </div>
  );
}

function OverlayGameBar({
  engine,
  timeline,
  display,
  labels,
}: ConnectedProps & {
  timeline: Timeline;
}) {
  const noteIndex = useOverlayState(engine, (s) => s.noteIndex);
  const runIndex = useOverlayState(engine, (s) => s.runIndex);
  const mobile = useOverlayState(engine, (s) => s.mobile);
  const note = noteIndex >= 0 ? (timeline.notes[noteIndex] ?? null) : null;
  const run = runIndex >= 0 ? (timeline.holdRuns[runIndex] ?? null) : null;
  return (
    <GameBar
      className="overlay-game-bar"
      note={note}
      noteId={noteIndex}
      run={run}
      scheme={display.scheme}
      mobile={mobile}
      labels={labels}
    />
  );
}

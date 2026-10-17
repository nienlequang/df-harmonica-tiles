/**
 * "Cửa sổ video nổi (thử nghiệm)" của trang mini: hộp thoại hai cách — "Trực tiếp" (luồng canvas) và
 * "Dựng sẵn" (WebCodecs → WebM, chỉ khi có `VideoEncoder`) — xem src/pip/videoPip.ts. Trình duyệt không
 * hỗ trợ → một dòng giải thích, nút bị khóa.
 *
 * State (phiên PiP đang mở, video đã dựng) nằm trong hook `useVideoPip` của trang (không trong hộp thoại):
 * đóng hộp thoại không được đóng khung PiP. Video PiP gắn vào `host` (phần tử ẩn trong trang mini).
 * Rời trang → đóng PiP, hủy dựng.
 *
 * Góp ý R6 (iPhone: "The request is not triggered by user activation"): hộp thoại hiện là CHUẨN BỊ video
 * ngay (trực tiếp: luồng canvas câm đang phát; dựng sẵn: blob đã nạp khi dựng xong) — chạm nút mở chỉ còn
 * gọi `enter()` ĐỒNG BỘ (không await / setState nào trước), Safari mới nhận là cú chạm của người dùng. Lỗi
 * mở PiP hiện câu dễ hiểu (iPhone: "iPhone chưa hỗ trợ…"), không hiện chữ lỗi thô của trình duyệt. Video
 * chuẩn bị không nạp được (dựng lỗi, hoặc quá PREPARE_STALL_MS chưa có metadata — vd. iOS chặn phát video ẩn)
 * hay iPhone báo "chưa sẵn sàng" lần thứ hai → không bắt người dùng chạm lại mãi: hiện câu "iPhone chưa hỗ
 * trợ…" (máy khác: "Trình duyệt này không hỗ trợ…").
 *
 * Góp ý R7-7: Safari iPhone không mở được "Trực tiếp" (luồng canvas), còn "Dựng sẵn" chạy được (kể cả qua
 * `http://<IP-LAN>`). Máy Apple — theo lựa chọn "Apple / Android" đã lưu (phonePref.ts; chưa chọn thì đoán
 * theo UA) — ẩn hẳn "Trực tiếp" (không chuẩn bị luồng canvas) và tự dựng sẵn khi hộp thoại hiện. Máy khác giữ
 * cả hai cách, "Trực tiếp" là nút chính khi có.
 */
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { MutableRefObject, RefObject } from 'react';
import type { StringKey } from '../i18n/strings';
import { useT } from '../i18n/useT';
import { useIsApplePhone } from '../pip/phonePref';
import {
  detectVideoPipSupport,
  prepareLiveVideoPip,
  prepareVideoBlobPip,
  prerenderGuideVideo,
  videoPipErrorKind,
} from '../pip/videoPip';
import type {
  GuideVideoOptions,
  PreparedVideoPip,
  PrerenderResult,
  VideoPipErrorKind,
  VideoPipSession,
  VideoPipSupport,
} from '../pip/videoPip';
import { Button, Modal } from '../ui/components';

/** Video chuẩn bị chưa có metadata sau chừng này ms → coi như trình duyệt không nạp được (không chờ mãi). */
export const PREPARE_STALL_MS = 4000;

export type BuildState =
  | { status: 'idle' }
  | { status: 'building'; progress: number }
  | { status: 'built'; result: PrerenderResult }
  | { status: 'failed'; reason: string };

export interface VideoPipController {
  support: VideoPipSupport;
  /**
   * Máy Apple (lựa chọn đã lưu; chưa chọn → UA): không có "Trực tiếp" (Safari không mở được PiP của luồng
   * canvas) — chỉ dựng sẵn; câu lỗi kiểu "iPhone chưa hỗ trợ…".
   */
  apple: boolean;
  /** "Trực tiếp" dùng được ở máy này (trình duyệt có + không phải máy Apple). */
  liveOffered: boolean;
  session: VideoPipSession | null;
  build: BuildState;
  /** Lỗi mở PiP gần nhất (loại — hộp thoại hiện câu dễ hiểu); null = không lỗi. */
  error: VideoPipErrorKind | null;
  /** Video "trực tiếp" đã chuẩn bị xong (có metadata): chạm là vào PiP ngay. */
  liveReady: boolean;
  /** Video dựng sẵn đã nạp xong. */
  builtReady: boolean;
  /**
   * Hộp thoại hiện → chuẩn bị video TRƯỚC cú chạm; trả hàm dọn (hộp thoại đóng → bỏ video chuẩn bị, phiên
   * PiP đang mở vẫn giữ).
   */
  arm: () => () => void;
  /** Handler của cú chạm "Mở video trực tiếp" — gọi đồng bộ, không bọc trong hàm async. */
  openLive: () => void;
  startBuild: () => void;
  cancelBuild: () => void;
  /** Handler của cú chạm "Mở video dựng sẵn" — như openLive. */
  openBuilt: () => void;
  close: () => void;
}

function reasonOf(e: unknown): string {
  if (e instanceof Error) return e.message || e.name;
  return String(e);
}

/** "123 KB" / "4.5 MB". */
export function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Câu báo lỗi mở PiP theo loại lỗi. iPhone / iPad: bị từ chối hay không hỗ trợ đều là "iPhone chưa hỗ trợ
 * cửa sổ video nổi cho trang web này" (Safari chặn — người dùng không làm gì thêm được).
 */
export function videoPipErrorText(kind: VideoPipErrorKind, appleMobile: boolean): StringKey {
  if (kind === 'notReady') return 'mini.video.errorNotReady';
  if (kind === 'failed') return 'mini.video.errorFailed';
  if (appleMobile) return 'mini.video.errorIos';
  return kind === 'unsupported' ? 'mini.video.unsupported' : 'mini.video.errorBlocked';
}

/**
 * Chuẩn bị một video PiP khi `enabled` (hộp thoại hiện); `gen` đổi = chuẩn bị video mới (video cũ đã dùng
 * để vào PiP). Video chưa dùng bị bỏ khi điều kiện đổi / unmount; video đã vào PiP thuộc về phiên.
 * `failed` = không chuẩn bị được (dựng ném lỗi) hoặc quá PREPARE_STALL_MS vẫn chưa có metadata.
 */
function usePrepared(
  enabled: boolean,
  hostRef: RefObject<HTMLElement | null>,
  make: ((host: HTMLElement) => PreparedVideoPip) | null,
  gen: number,
): { ref: MutableRefObject<PreparedVideoPip | null>; ready: boolean; failed: boolean } {
  const ref = useRef<PreparedVideoPip | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const host = hostRef.current;
    if (!enabled || !make || !host) return;
    let p: PreparedVideoPip;
    try {
      p = make(host);
    } catch {
      // Không chuẩn bị được (thiếu captureStream…): chạm nút báo câu dễ hiểu ngay (không "chạm lại").
      setFailed(true);
      return () => setFailed(false);
    }
    ref.current = p;
    let alive = true;
    const stall = setTimeout(() => {
      if (alive && !p.ready && !p.entered) setFailed(true);
    }, PREPARE_STALL_MS);
    void p.whenReady.then((ok) => {
      if (!alive || !ok) return;
      clearTimeout(stall);
      setReady(true);
      setFailed(false);
    });
    return () => {
      alive = false;
      clearTimeout(stall);
      if (ref.current === p) ref.current = null;
      setReady(false);
      setFailed(false);
      if (!p.entered) p.close();
    };
  }, [enabled, hostRef, make, gen]);
  return { ref, ready, failed };
}

/**
 * Phiên video PiP của trang mini. `options` đổi (bài, theme, đếm ngược…) → video đã dựng hết hợp lệ.
 */
export function useVideoPip(
  options: GuideVideoOptions,
  hostRef: RefObject<HTMLElement | null>,
): VideoPipController {
  const support = useMemo(() => detectVideoPipSupport(), []);
  const appleMobile = useIsApplePhone();
  const liveOffered = support.live && !appleMobile;
  const [session, setSession] = useState<VideoPipSession | null>(null);
  const [build, setBuild] = useState<BuildState>({ status: 'idle' });
  const [error, setError] = useState<VideoPipErrorKind | null>(null);
  const [armed, setArmed] = useState(0);
  const [liveGen, setLiveGen] = useState(0);
  const [builtGen, setBuiltGen] = useState(0);
  const sessionRef = useRef<VideoPipSession | null>(null);
  /** Số lần liên tiếp báo "chưa sẵn sàng" (iPhone: lần thứ hai → câu "iPhone chưa hỗ trợ…"). */
  const notReadyRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const optionsRef = useRef(options);
  useLayoutEffect(() => {
    optionsRef.current = options;
  });

  const arm = useCallback(() => {
    setArmed((n) => n + 1);
    return () => setArmed((n) => n - 1);
  }, []);
  const isArmed = armed > 0;

  // Máy Apple: không chuẩn bị luồng canvas (không dùng được, chỉ tốn pin).
  const makeLive = useMemo(
    () => (liveOffered ? (host: HTMLElement) => prepareLiveVideoPip(options, host) : null),
    [liveOffered, options],
  );
  const builtBlob = build.status === 'built' ? build.result.blob : null;
  const makeBuilt = useMemo(
    () => (builtBlob ? (host: HTMLElement) => prepareVideoBlobPip(builtBlob, host) : null),
    [builtBlob],
  );
  const live = usePrepared(isArmed, hostRef, makeLive, liveGen);
  const built = usePrepared(isArmed, hostRef, makeBuilt, builtGen);

  const closeSession = useCallback(() => {
    const s = sessionRef.current;
    sessionRef.current = null;
    s?.close();
    setSession(null);
  }, []);

  const onClosed = useCallback((s: VideoPipSession) => {
    if (sessionRef.current === s || sessionRef.current === null) {
      sessionRef.current = null;
      setSession(null);
    }
  }, []);

  /**
   * Báo "chưa sẵn sàng" — trừ khi video chuẩn bị đã hỏng / treo (`stuck`) hoặc iPhone đã báo vậy một lần:
   * khi đó chạm lại cũng vô ích → câu "không hỗ trợ" (iPhone: "iPhone chưa hỗ trợ…").
   */
  const reportNotReady = useCallback(
    (stuck: boolean) => {
      notReadyRef.current += 1;
      setError(stuck || (appleMobile && notReadyRef.current >= 2) ? 'unsupported' : 'notReady');
    },
    [appleMobile],
  );

  /**
   * Vào PiP bằng video đã chuẩn bị. ĐỒNG BỘ trong cú chạm: `enter()` là lời gọi đầu tiên. Đang có phiên
   * khác → trình duyệt chuyển khung PiP sang video mới; phiên cũ dọn sau khi video mới đã vào (không thoát
   * PiP).
   */
  const enterPrepared = useCallback(
    (p: PreparedVideoPip, renew: () => void) => {
      const entering = p.enter({ onClosed: () => onClosed(p) });
      const prev = sessionRef.current;
      setError(null);
      renew(); // video mới cho lần mở sau
      entering.then(
        (s) => {
          if (s.closed) return;
          notReadyRef.current = 0;
          sessionRef.current = s;
          setSession(s);
          if (prev && prev !== s) prev.close();
        },
        (e: unknown) => {
          const kind = videoPipErrorKind(e);
          if (kind === 'notReady') reportNotReady(false);
          else setError(kind);
        },
      );
    },
    [onClosed, reportNotReady],
  );

  const openLive = useCallback(() => {
    if (!liveOffered) return;
    const p = live.ref.current;
    // Chưa có video chuẩn bị (vừa mở hộp thoại / vừa dùng) → báo chạm lại, không mở kiểu cũ (sẽ mất cú chạm);
    // video chuẩn bị hỏng / treo → báo không hỗ trợ, không dùng mất video.
    if (!p || p.entered || p.closed || (!p.ready && live.failed)) {
      reportNotReady(live.failed);
      return;
    }
    live.ref.current = null;
    enterPrepared(p, () => setLiveGen((g) => g + 1));
  }, [enterPrepared, live.ref, live.failed, reportNotReady, liveOffered]);

  const openBuilt = useCallback(() => {
    if (build.status !== 'built') return;
    const p = built.ref.current;
    if (!p || p.entered || p.closed || (!p.ready && built.failed)) {
      reportNotReady(built.failed);
      return;
    }
    built.ref.current = null;
    enterPrepared(p, () => setBuiltGen((g) => g + 1));
  }, [build.status, built.ref, built.failed, enterPrepared, reportNotReady]);

  const startBuild = useCallback(() => {
    if (!support.prerender) return;
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setBuild({ status: 'building', progress: 0 });
    // Tiến độ báo mỗi 8 khung (~20 lần / giây): chỉ cập nhật state khi số % đổi — không vẽ lại cả trang mini
    // liên tục.
    let shownPct = 0;
    void prerenderGuideVideo(optionsRef.current, {
      signal: ac.signal,
      onProgress: (f) => {
        if (ac.signal.aborted) return;
        const pct = Math.floor(f * 100);
        if (pct === shownPct) return;
        shownPct = pct;
        setBuild({ status: 'building', progress: pct / 100 });
      },
    }).then(
      (result) => {
        if (ac.signal.aborted) return;
        abortRef.current = null;
        setBuild({ status: 'built', result });
      },
      (e: unknown) => {
        if (ac.signal.aborted) return;
        abortRef.current = null;
        setBuild({ status: 'failed', reason: reasonOf(e) });
      },
    );
  }, [support.prerender]);

  const cancelBuild = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setBuild({ status: 'idle' });
  }, []);

  // Option đổi → video đã dựng / đang dựng không còn đúng. Lần chạy đầu bỏ qua: hộp thoại (con) có thể vừa
  // tự bắt đầu dựng trong cùng lần mount (effect của con chạy trước) — không hủy lượt dựng đó.
  const builtFor = useRef(options);
  useEffect(() => {
    if (builtFor.current === options) return;
    builtFor.current = options;
    abortRef.current?.abort();
    abortRef.current = null;
    setBuild({ status: 'idle' });
  }, [options]);

  // Rời trang: đóng PiP, hủy dựng (video chuẩn bị do usePrepared dọn).
  useEffect(
    () => () => {
      abortRef.current?.abort();
      abortRef.current = null;
      const s = sessionRef.current;
      sessionRef.current = null;
      s?.close();
    },
    [],
  );

  return {
    support,
    apple: appleMobile,
    liveOffered,
    session,
    build,
    error,
    liveReady: live.ready,
    builtReady: built.ready,
    arm,
    openLive,
    startBuild,
    cancelBuild,
    openBuilt,
    close: closeSession,
  };
}

export interface VideoPipDialogProps {
  open: boolean;
  onClose: () => void;
  pip: VideoPipController;
  /** Đếm ngược nằm trong video (giây). */
  countdownSec: number;
}

export function VideoPipDialog({ open, onClose, pip, countdownSec }: VideoPipDialogProps) {
  const t = useT();
  return (
    <Modal open={open} title={t('mini.video.title')} onClose={onClose}>
      {open ? <DialogBody pip={pip} countdownSec={countdownSec} /> : null}
    </Modal>
  );
}

function DialogBody({ pip, countdownSec }: { pip: VideoPipController; countdownSec: number }) {
  const t = useT();
  const { support, session, build, error, arm, apple: appleMobile, startBuild } = pip;
  // Hộp thoại hiện = chuẩn bị video trước cú chạm (đóng hộp thoại → bỏ video chuẩn bị).
  useEffect(() => arm(), [arm]);
  // Máy Apple: chỉ có dựng sẵn → tự dựng ngay khi hộp thoại hiện (một lần mỗi lần mở; Hủy dựng vẫn hủy được).
  const autoBuild = useRef(appleMobile && support.prerender && build.status === 'idle');
  useEffect(() => {
    if (!autoBuild.current) return;
    autoBuild.current = false;
    startBuild();
  }, [startBuild]);
  const pct = build.status === 'building' ? Math.floor(build.progress * 100) : 0;
  const liveId = useId();
  const prerenderId = useId();
  return (
    <div className="mini-video" data-apple={appleMobile ? 'true' : 'false'}>
      <p className="mini-video-intro">{t('mini.video.intro', { n: countdownSec })}</p>
      {!support.pip ? (
        <p className="mini-note" role="note" data-unsupported="pip">
          {t(appleMobile ? 'mini.video.errorIos' : 'mini.video.unsupported')}
        </p>
      ) : null}
      {session ? (
        <p className="mini-video-status" role="status">
          <span>{t('mini.video.statusOpen')}</span>
          <Button size="sm" onClick={pip.close}>
            {t('mini.video.close')}
          </Button>
        </p>
      ) : null}
      {error !== null ? (
        <p className="mini-note" role="alert" data-error={error}>
          {t(videoPipErrorText(error, appleMobile))}
        </p>
      ) : null}

      {/* Máy Apple: không có "Trực tiếp" (Safari không mở được PiP của luồng canvas — R7-7). */}
      {!appleMobile ? (
        <section className="mini-video-mode" aria-labelledby={liveId}>
          <h3 id={liveId} className="mini-video-mode-title">
            {t('mini.video.live')}
          </h3>
          <p className="mini-video-hint">{t('mini.video.liveHint')}</p>
          {support.pip && !support.live ? (
            <p className="mini-note" role="note">
              {t('mini.video.liveUnsupported')}
            </p>
          ) : null}
          {/* Có "Trực tiếp" → là cách mặc định (nút chính). */}
          <Button
            variant={pip.liveOffered ? 'primary' : 'secondary'}
            className="mini-video-live"
            disabled={!pip.liveOffered}
            data-ready={pip.liveReady ? 'true' : 'false'}
            onClick={pip.openLive}
          >
            {t('mini.video.liveOpen')}
          </Button>
        </section>
      ) : null}

      <section className="mini-video-mode" aria-labelledby={prerenderId}>
        <h3 id={prerenderId} className="mini-video-mode-title">
          {t('mini.video.prerender')}
        </h3>
        <p className="mini-video-hint">{t('mini.video.prerenderHint')}</p>
        {support.pip && !support.prerender ? (
          <p className="mini-note" role="note">
            {/* Máy Apple chỉ còn cách này → nói cách khắc phục (cập nhật iOS / Safari). */}
            {t(appleMobile ? 'mini.apple.unsupported' : 'mini.video.prerenderUnsupported')}
          </p>
        ) : null}
        {build.status === 'building' ? (
          <div className="mini-video-progress">
            <progress max={100} value={pct} aria-label={t('mini.video.progress')} />
            {/* Không là live region: % đổi liên tục (screen reader đọc giá trị của <progress>). */}
            <span aria-live="off">{t('mini.video.building', { pct })}</span>
            <Button size="sm" onClick={pip.cancelBuild}>
              {t('mini.video.cancel')}
            </Button>
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
          <p className="mini-note" role="alert">
            {t('mini.video.buildFailed', { reason: build.reason })}
          </p>
        ) : null}
        <div className="mini-video-actions">
          {build.status !== 'building' ? (
            <Button
              className="mini-video-build"
              disabled={!support.prerender}
              onClick={pip.startBuild}
            >
              {t('mini.video.build')}
            </Button>
          ) : null}
          {build.status === 'built' ? (
            <Button
              variant="primary"
              className="mini-video-open-built"
              data-ready={pip.builtReady ? 'true' : 'false'}
              onClick={pip.openBuilt}
            >
              {t('mini.video.openBuilt')}
            </Button>
          ) : null}
        </div>
      </section>
    </div>
  );
}

/**
 * THỬ NGHIỆM "cửa sổ video nổi" (SPEC 2026-10-15 Phase 4m (c), docs/RESEARCH-MOBILE-FLOATING.md mục e):
 * ô rơi phát dưới dạng VIDEO trong khung Picture-in-Picture của trình duyệt — luôn nằm trên mọi app, kể
 * cả trên điện thoại không có cửa sổ nổi (Chrome Android có `requestPictureInPicture` từ bản 105;
 * Document PiP thì không có trên Android). KHÔNG BAO GIỜ có âm thanh (video câm, không có track tiếng).
 *
 * Hai cách:
 * - "Trực tiếp" (`prepareLiveVideoPip`): vẽ ô rơi vào canvas ẩn theo tempo bài, `captureStream()` →
 *   `<video muted playsinline>` → PiP. Nhanh, nhưng khi Chrome xuống nền, timer bị bóp → hình đứng.
 * - "Dựng sẵn" (`prerenderGuideVideo` + `prepareVideoBlobPip`, chỉ khi có WebCodecs `VideoEncoder`): vẽ
 *   cả bài (đếm ngược 3-2-1 nằm sẵn trong video) từng khung ~24 fps → VP8/VP9 → WebM (webm.ts, tự viết)
 *   → Blob → phát trong PiP: trình duyệt chỉ còn phát video nên vẫn chạy khi Chrome xuống nền.
 *
 * Mở PiP (góp ý R6, lỗi iPhone "The request is not triggered by user activation"): video được CHUẨN BỊ
 * trước cú chạm (lúc hộp thoại hiện: gắn DOM, câm, playsinline, đã nạp) và cú chạm gọi
 * `requestPictureInPicture()` — hoặc `webkitSetPresentationMode('picture-in-picture')` khi chỉ có cách đó —
 * ĐỒNG BỘ ngay trong handler, không `await` gì trước (Safari chỉ cho PiP khi còn trong cú chạm; Chrome dễ
 * tính hơn nên bản cũ `await video.play()` rồi mới xin PiP chỉ hỏng trên iPhone).
 *
 * Khung hình (`GuidePainter`): làn ô rơi (TilesRenderer, bố cục "khớp game": hit line sát đáy vùng làn)
 * + dải nút giống màn chơi kèn ở đáy (Mobile: 4 nút chế độ tròn nhỏ + 8 nút số tròn, nút đang chọn
 * sáng; PC: 8 keycap + dòng "ĐANG GIỮ") + số đếm ngược lớn. Chuỗi canvas lấy qua `tNow()`.
 */
import { jianpuLabel } from '../core/mobile';
import { NOTE_KEYS } from '../core/keys';
import { noteIndexAt, runIndexAt } from '../core/timelineQuery';
import type { Modifiers, Timeline } from '../core/types';
import type { Lang, StringKey } from '../i18n/strings';
import { tNow } from '../i18n/useT';
import { GAME_LAYOUT_HIT_LINE } from '../overlay/overlayParams';
import { canvasFont } from '../player/canvasTheme';
import { CUE_LAYER_ATTR, padGeometry } from '../player/layout';
import { leadInBeats } from '../player/leadIn';
import type { PadGeometry } from '../player/layout';
import {
  MOBILE_BUTTONS,
  cueButton,
  mobilePlanFor,
  mobileUiAt,
  modeButton,
} from '../player/mobilePlan';
import type { MobileButton, MobileUiState } from '../player/mobilePlan';
import { TilesRenderer } from '../player/renderer';
import type { RendererOptions } from '../player/renderer';
import type { ModifierLabels } from '../ui/modLabels';
import { MOD_COLORS, tileColorKey } from '../ui/palette';
import type { ModColorKey } from '../ui/palette';
import type { ControlScheme, MobileSemitone, SubLabel, Theme } from '../ui/settings';
import { WebmMuxer } from './webm';
import type { WebmCodecId } from './webm';

// ---------------------------------------------------------------------------
// Hỗ trợ của trình duyệt
// ---------------------------------------------------------------------------

export interface VideoPipSupport {
  /**
   * `HTMLVideoElement.requestPictureInPicture` có và không bị tắt (`pictureInPictureEnabled`), hoặc
   * `webkitSetPresentationMode` (Safari iOS kiểu cũ).
   */
  pip: boolean;
  /** PiP + `HTMLCanvasElement.captureStream` → "trực tiếp". */
  live: boolean;
  /**
   * PiP + WebCodecs (`VideoEncoder` + `VideoFrame`) + `<video>` phát được WebM VP8 / VP9 → "dựng sẵn".
   * Mã hóa được chưa chắc phát được (WebKit có thể có WebCodecs mà không phát WebM) — không hỏi trước thì
   * người dùng chờ dựng xong cả bài rồi mới gặp lỗi phát.
   */
  prerender: boolean;
}

/** `HTMLMediaElement.canPlayType`: '' = không, 'maybe' / 'probably' = có thể. */
export type CanPlayType = (type: string) => string;

/** Những gì `detectVideoPipSupport` đọc (test truyền bản giả). */
export interface VideoPipEnv {
  videoProto: object | null;
  canvasProto: object | null;
  pictureInPictureEnabled: boolean | undefined;
  VideoEncoder: unknown;
  VideoFrame: unknown;
  /** canPlayType của một `<video>`; null nếu không có. */
  canPlayType: CanPlayType | null;
}

function hasMethod(proto: object | null, name: string): boolean {
  if (!proto || !(name in proto)) return false;
  return typeof (proto as Record<string, unknown>)[name] === 'function';
}

function currentDocument(): Document | null {
  return typeof document !== 'undefined' ? document : null;
}

/** canPlayType của trình duyệt (một `<video>` tạm, không gắn vào trang); null nếu không có DOM. */
export function browserCanPlayType(doc: Document | null = currentDocument()): CanPlayType | null {
  if (!doc) return null;
  try {
    const v = doc.createElement('video');
    if (typeof v.canPlayType !== 'function') return null;
    return (type) => {
      try {
        return v.canPlayType(type);
      } catch {
        return '';
      }
    };
  } catch {
    return null;
  }
}

export function currentVideoPipEnv(): VideoPipEnv {
  const g = globalThis as Record<string, unknown>;
  const doc = currentDocument();
  return {
    videoProto: typeof HTMLVideoElement === 'function' ? HTMLVideoElement.prototype : null,
    canvasProto: typeof HTMLCanvasElement === 'function' ? HTMLCanvasElement.prototype : null,
    pictureInPictureEnabled: doc
      ? (doc as Document & { pictureInPictureEnabled?: boolean }).pictureInPictureEnabled
      : undefined,
    VideoEncoder: g.VideoEncoder,
    VideoFrame: g.VideoFrame,
    canPlayType: browserCanPlayType(doc),
  };
}

/** Phát hiện tính năng (không tạo gì, không cần chạm). */
export function detectVideoPipSupport(env: VideoPipEnv = currentVideoPipEnv()): VideoPipSupport {
  const standard =
    hasMethod(env.videoProto, 'requestPictureInPicture') && env.pictureInPictureEnabled !== false;
  // Safari iOS kiểu cũ: chỉ có API riêng của WebKit (hỗ trợ thật hay không chỉ biết khi gọi trên video).
  const pip = standard || hasMethod(env.videoProto, 'webkitSetPresentationMode');
  const live = pip && hasMethod(env.canvasProto, 'captureStream');
  const canPlay = env.canPlayType;
  const prerender =
    pip &&
    typeof env.VideoEncoder === 'function' &&
    typeof env.VideoFrame === 'function' &&
    canPlay !== null &&
    PRERENDER_CODECS.some((c) => canPlay(c.mime) !== '');
  return { pip, live, prerender };
}

// ---------------------------------------------------------------------------
// Thời gian của video
// ---------------------------------------------------------------------------

export const GUIDE_VIDEO_WIDTH = 480;
export const GUIDE_VIDEO_HEIGHT = 360;
/** Khung / giây của video dựng sẵn (đủ mượt cho ô rơi, nhẹ cho máy yếu). */
export const GUIDE_VIDEO_FPS = 24;
/** Khung / giây của luồng canvas trực tiếp. */
export const LIVE_STREAM_FPS = 30;
/** Đếm ngược tối thiểu trong video (giây) — luôn có 3-2-1 để kịp chạm vào game. */
export const MIN_VIDEO_COUNTDOWN = 3;
/** Giữ thêm sau nốt cuối (giây). */
export const VIDEO_TAIL_SEC = 1.5;

export interface GuideVideoTiming {
  bpm: number;
  totalBeats: number;
  /** Đếm ngược (giây) trước khi ô bắt đầu chạy. */
  countdownSec: number;
  /**
   * Beat dẫn vào trước beat 0 khi bật đếm vào (Cài đặt → Phát bài, như màn chơi / trang mini): nốt đầu đi 65 % quãng
   * "1 ô nhịp + khoảng lặng đầu bài" (src/player/leadIn.ts, v1.0.1); 0 = tắt.
   */
  leadBeats: number;
  tailSec: number;
}

export function guideVideoTiming(
  timeline: Pick<Timeline, 'totalBeats' | 'beatsPerBar' | 'notes'>,
  bpm: number,
  countdownSec: number,
  countIn = true,
): GuideVideoTiming {
  return {
    bpm: Number.isFinite(bpm) && bpm > 0 ? bpm : 90,
    totalBeats: Math.max(0, timeline.totalBeats),
    countdownSec: Math.max(
      MIN_VIDEO_COUNTDOWN,
      Math.round(Number.isFinite(countdownSec) ? countdownSec : 0),
    ),
    leadBeats: countIn ? leadInBeats(timeline, 0, Math.max(0, timeline.beatsPerBar)) : 0,
    tailSec: VIDEO_TAIL_SEC,
  };
}

/** Độ dài video (giây): đếm ngược + dẫn vào + bài + đuôi. */
export function guideVideoDurationSec(t: GuideVideoTiming): number {
  return t.countdownSec + ((t.leadBeats + t.totalBeats) * 60) / t.bpm + t.tailSec;
}

export interface GuideFrameInfo {
  /** Beat ở hit line (âm khi đang dẫn vào / đếm ngược). */
  beat: number;
  /** Số đang đếm ngược (3, 2, 1); null = hết đếm ngược. */
  countdown: number | null;
  /** Đã qua nốt cuối + đuôi. */
  ended: boolean;
}

/** Trạng thái của video tại `sec` giây tính từ đầu video. */
export function guideVideoFrameAt(t: GuideVideoTiming, sec: number): GuideFrameInfo {
  const s = Number.isFinite(sec) ? Math.max(0, sec) : 0;
  if (s < t.countdownSec) {
    return {
      beat: -t.leadBeats,
      countdown: Math.max(1, Math.ceil(t.countdownSec - s - 1e-9)),
      ended: false,
    };
  }
  const beat = -t.leadBeats + ((s - t.countdownSec) * t.bpm) / 60;
  return { beat, countdown: null, ended: s >= guideVideoDurationSec(t) };
}

// ---------------------------------------------------------------------------
// Vẽ khung hình
// ---------------------------------------------------------------------------

export interface GuideVideoOptions {
  timeline: Timeline;
  bpm: number;
  scheme: ControlScheme;
  mobileSemitone: MobileSemitone;
  labels: ModifierLabels;
  theme: Theme;
  language: Lang;
  subLabel: SubLabel;
  lookahead: number;
  /** Đếm ngược trước khi chạy (giây, tối thiểu MIN_VIDEO_COUNTDOWN). */
  countdownSec: number;
  /** Đếm vào (đoạn ô dẫn vào, không số — src/player/leadIn.ts) — Cài đặt → Phát bài. Bỏ trống = bật. */
  countIn?: boolean;
  width?: number;
  height?: number;
}

interface PadColors {
  bg: string;
  panel: string;
  /** Nền bàn nút Mobile (như `--gb-panel` của mobilePad.css: hơi trong để thấy hit line). */
  padGlass: string;
  cap: string;
  capBorder: string;
  text: string;
  muted: string;
  warn: string;
  natural: string;
  naturalText: string;
  scrim: string;
}

/** Màu dải nút: cùng token với app.css / player.css (DESIGN.md) — không dùng accent cho nút. */
const PAD_COLORS: Readonly<Record<Theme, PadColors>> = {
  dark: {
    bg: '#090b0d',
    panel: '#0c1013',
    padGlass: 'rgba(12,16,19,0.92)',
    cap: '#161c22',
    capBorder: '#3d4752',
    text: '#e9edf1',
    muted: '#9aa5b1',
    warn: '#f2c230',
    natural: MOD_COLORS.normal.fill,
    naturalText: MOD_COLORS.normal.text,
    scrim: 'rgba(3,5,7,0.62)',
  },
  light: {
    bg: '#e8e3d3',
    panel: '#f4f0e4',
    padGlass: 'rgba(244,240,228,0.94)',
    cap: '#e8e3d3',
    capBorder: '#7f7862',
    text: '#1b1e18',
    muted: '#4b4f42',
    warn: '#7a5c00',
    natural: '#15181d',
    naturalText: '#ffffff',
    scrim: 'rgba(40,36,24,0.55)',
  },
};

/**
 * Option canvas cố định của video. PC: 8 làn phủ kín, hit line sát đáy vùng làn, dải phím riêng bên
 * dưới. Mobile: `lanePadding: 'pad'` như Player — làn phủ cả khung, hit line = đỉnh hàng nút số, bàn nút
 * vẽ đè ở đáy theo cùng `padGeometry` (tâm lane = tâm nút).
 */
const VIDEO_RENDERER_OPTIONS: Readonly<Partial<RendererOptions>> = Object.freeze({
  orientation: 'vertical',
  hitLinePos: GAME_LAYOUT_HIT_LINE,
  gridStyle: 'subtle',
  tileOpacity: 1,
  background: 'theme',
  showRibbons: true,
  showBarLines: true,
  showSectionLabels: false,
  tileScale: 0.85,
});

const NO_MODS: Modifiers = { left: false, right: false, scroll: false };

function holdKey(m: Modifiers): StringKey | null {
  if (m.left) return m.scroll ? 'mod.bannerLeftScroll' : 'mod.bannerLeft';
  if (m.right) return m.scroll ? 'mod.bannerRightScroll' : 'mod.bannerRight';
  return m.scroll ? 'mod.bannerScroll' : null;
}

function buttonColor(b: MobileButton, c: PadColors): { fill: string; text: string } {
  if (b === 'natural') return { fill: c.natural, text: c.naturalText };
  const key: ModColorKey = b;
  return { fill: MOD_COLORS[key].fill, text: MOD_COLORS[key].text };
}

/**
 * Vẽ khung hình của video: làn (TilesRenderer trên canvas ẩn trong DOM — renderer cần kích thước
 * layout) chép vào canvas ra kích thước cố định + dải nút + (Mobile) lớp vòng "CHẠM" của renderer chép đè
 * lên dải nút (vòng đáp đồng tâm với nút chế độ, R7-1) + đếm ngược. `dispose()` gỡ canvas ẩn.
 */
export class GuidePainter {
  /** Canvas ra (kích thước cố định width × height) — nguồn của video. */
  readonly canvas: HTMLCanvasElement;
  readonly width: number;
  readonly height: number;
  readonly timing: GuideVideoTiming;
  private readonly opts: GuideVideoOptions;
  private readonly host: HTMLDivElement;
  private readonly tiles: HTMLCanvasElement;
  /** Lớp vòng "CHẠM" của renderer (Mobile), null ở kiểu PC. */
  private readonly cues: HTMLCanvasElement | null;
  private readonly renderer: TilesRenderer;
  private readonly ctx: CanvasRenderingContext2D | null;
  private readonly colors: PadColors;
  private readonly tilesH: number;
  private mobilePrev: MobileUiState | null = null;
  private disposed = false;

  constructor(opts: GuideVideoOptions, doc: Document = document) {
    this.opts = opts;
    this.width = Math.max(64, Math.round((opts.width ?? GUIDE_VIDEO_WIDTH) / 2) * 2);
    this.height = Math.max(64, Math.round((opts.height ?? GUIDE_VIDEO_HEIGHT) / 2) * 2);
    this.timing = guideVideoTiming(
      opts.timeline,
      opts.bpm,
      opts.countdownSec,
      opts.countIn !== false,
    );
    this.colors = PAD_COLORS[opts.theme];
    const mobile = opts.scheme === 'mobile';
    this.tilesH = mobile ? this.height : Math.round(this.height * 0.76);

    // Canvas làn nằm ngoài màn hình (renderer đo kích thước bằng layout của DOM).
    const host = doc.createElement('div');
    host.setAttribute('aria-hidden', 'true');
    host.className = 'guide-video-source';
    host.style.cssText = [
      'position:fixed',
      `left:${-(this.width + 200)}px`,
      'top:0',
      `width:${this.width}px`,
      `height:${this.tilesH}px`,
      'overflow:hidden',
      'pointer-events:none',
      'contain:strict',
    ].join(';');
    const tiles = doc.createElement('canvas');
    tiles.style.cssText = 'display:block;width:100%;height:100%';
    host.appendChild(tiles);
    // Mobile: lớp vòng "CHẠM" (renderer tìm `canvas[CUE_LAYER_ATTR]` cạnh canvas làn) — chép lên SAU bàn nút
    // để vòng đáp đè lên nút chế độ (như lớp của MobilePad ở màn chơi).
    let cues: HTMLCanvasElement | null = null;
    if (mobile) {
      cues = doc.createElement('canvas');
      cues.setAttribute(CUE_LAYER_ATTR, '');
      cues.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%';
      host.appendChild(cues);
    }
    doc.body.appendChild(host);
    this.host = host;
    this.tiles = tiles;
    this.cues = cues;
    // DPR 1: canvas nguồn đúng width × tilesH (video ra cố định — vẽ ở DPR màn hình chỉ tốn công thu nhỏ).
    this.renderer = new TilesRenderer(
      tiles,
      {
        ...VIDEO_RENDERER_OPTIONS,
        lanePadding: mobile ? 'pad' : 'none',
        theme: opts.theme,
        language: opts.language,
        subLabel: opts.subLabel,
        lookahead: opts.lookahead,
        scheme: opts.scheme,
        mobileSemitone: opts.mobileSemitone,
        modLabels: opts.labels,
      },
      { dpr: 1 },
    );
    this.renderer.setTimeline(opts.timeline);
    this.renderer.resize();

    const out = doc.createElement('canvas');
    out.width = this.width;
    out.height = this.height;
    this.canvas = out;
    let ctx: CanvasRenderingContext2D | null;
    try {
      ctx = out.getContext('2d') ?? null;
    } catch {
      ctx = null; // jsdom: không có canvas → paint chỉ tính trạng thái
    }
    this.ctx = ctx;
  }

  get durationSec(): number {
    return guideVideoDurationSec(this.timing);
  }

  /** Vẽ khung hình tại `sec` giây tính từ đầu video. */
  paint(sec: number): GuideFrameInfo {
    const f = guideVideoFrameAt(this.timing, sec);
    if (this.disposed) return f;
    // Đếm vào (beat < 0) chỉ là phần tile dẫn vào — không vẽ số (round 6); số lớn chỉ khi đếm ngược.
    this.renderer.render({ beat: f.beat, mobileEntry: null });
    const ctx = this.ctx;
    if (!ctx) return f;
    const c = this.colors;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.fillStyle = c.bg;
    ctx.fillRect(0, 0, this.width, this.height);
    if (this.tiles.width > 0 && this.tiles.height > 0) {
      ctx.drawImage(this.tiles, 0, 0, this.width, this.tilesH);
    }
    const at = Math.max(0, f.beat);
    if (this.opts.scheme === 'mobile') {
      this.drawMobilePad(ctx, at);
      // Vòng "CHẠM" nằm trên nút chế độ (renderer vẽ lên lớp riêng, cùng khung với canvas làn).
      const cues = this.cues;
      if (cues && cues.width > 0 && cues.height > 0) {
        ctx.drawImage(cues, 0, 0, this.width, this.tilesH);
      }
    } else {
      this.drawPcPad(ctx, at);
    }
    if (f.countdown !== null) this.drawCountdown(ctx, f.countdown);
    return f;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.renderer.dispose();
    this.host.remove();
  }

  /** Tâm 8 cột (theo vùng làn của renderer, toạ độ canvas ra) + bề rộng một cột. */
  private columns(): { centers: number[]; col: number } {
    const L = this.renderer.layout;
    const sx = L && L.width > 0 ? this.width / L.width : 1;
    const x0 = L ? L.laneArea.x * sx : 0;
    const w = L ? L.laneArea.w * sx : this.width;
    const col = w / NOTE_KEYS.length;
    return { centers: NOTE_KEYS.map((_, i) => x0 + col * (i + 0.5)), col };
  }

  private drawPanel(ctx: CanvasRenderingContext2D): void {
    const c = this.colors;
    ctx.fillStyle = c.panel;
    ctx.fillRect(0, this.tilesH, this.width, this.height - this.tilesH);
    ctx.fillStyle = c.capBorder;
    ctx.fillRect(0, this.tilesH, this.width, 1);
  }

  /** Hình học bàn nút của renderer ('pad'), cùng khung → nút thẳng tâm lane. */
  private padGeom(): PadGeometry {
    return this.renderer.layout?.pad ?? padGeometry(this.width, this.tilesH);
  }

  private drawMobilePad(ctx: CanvasRenderingContext2D, at: number): void {
    const { timeline: tl, labels } = this.opts;
    const c = this.colors;
    const plan = mobilePlanFor(tl, this.opts.mobileSemitone);
    const ui = mobileUiAt(plan, at, this.mobilePrev);
    this.mobilePrev = ui;
    const idx = noteIndexAt(tl, at);
    const note = idx >= 0 ? tl.notes[idx] : null;
    const g = this.padGeom();
    const y0 = this.height - g.height;
    // Nền bàn nút như MobilePad: trong suốt ở mép trên → panel.
    const grad = ctx.createLinearGradient(0, y0, 0, this.height);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(0.28, c.padGlass);
    grad.addColorStop(1, c.padGlass);
    ctx.fillStyle = grad;
    ctx.fillRect(0, y0, this.width, g.height);
    const centers = g.digitCx;
    const r = g.digitD / 2;
    const rm = g.modeD / 2;
    const digitY = y0 + g.digitTop + r;
    const modeY = y0 + g.modeTop + rm;

    // Hàng 4 nút chế độ trên ranh giới cột 3|4 … 6|7 (Nửa Cung · Ngẩng Lên · Ngẩng Tự Nhiên · Cúi
    // Xuống), nút đang chọn sáng; nút sắp phải chạm có vòng hổ phách.
    const selected = modeButton(ui.mode);
    const cues = new Set<MobileButton>(ui.cueSoon ? ui.nextCues.map((q) => cueButton(q)) : []);
    MOBILE_BUTTONS.forEach((b, j) => {
      const x = g.modeCx[j];
      const on = b === 'scroll' ? ui.semitoneOn : b === selected;
      ctx.beginPath();
      ctx.arc(x, modeY, rm, 0, Math.PI * 2);
      ctx.fillStyle = on ? buttonColor(b, c).fill : c.cap;
      ctx.fill();
      ctx.lineWidth = cues.has(b) ? 3 : 1;
      ctx.strokeStyle = cues.has(b) ? c.warn : on ? buttonColor(b, c).fill : c.capBorder;
      ctx.stroke();
    });

    // Chế độ hiện tại (chữ, to hơn nhãn của game — video bị thu nhỏ trong khung PiP) bên trái hàng chế
    // độ; lần chạm kế (hổ phách) khi sắp tới.
    const textX = 6;
    const textW = Math.max(20, g.modeCx[0] - rm - 8 - textX);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    const fs = Math.max(12, Math.round(rm * 1.15));
    ctx.font = canvasFont(700, fs);
    ctx.fillStyle = c.text;
    const modeText = ui.semitoneOn ? `${labels[selected]} + ${labels.scroll}` : labels[selected];
    ctx.fillText(modeText, textX, modeY - (ui.cueSoon ? fs * 0.6 : 0), textW);
    if (ui.cueSoon && ui.nextCues.length > 0) {
      ctx.fillStyle = c.warn;
      ctx.font = canvasFont(700, Math.max(9, fs - 2));
      const next = ui.nextCues.map((q) => labels[cueButton(q)]).join(' + ');
      ctx.fillText(tNow('player.mobile.upcoming', { label: next }), textX, modeY + fs * 0.6, textW);
    }

    // Hàng 8 nút số tròn, chấm quãng theo chế độ đang chọn.
    const tone = note ? tileColorKey(note.modifiers) : null;
    NOTE_KEYS.forEach((k, i) => {
      const x = centers[i];
      const active = note !== null && note.key === k;
      const fill = active && tone ? MOD_COLORS[tone].fill : c.cap;
      const ink = active && tone ? MOD_COLORS[tone].text : c.text;
      ctx.beginPath();
      ctx.arc(x, digitY, active ? r * 0.94 : r, 0, Math.PI * 2);
      ctx.fillStyle = tone === 'normal' && active && this.opts.theme === 'light' ? c.natural : fill;
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = active ? fill : c.capBorder;
      ctx.stroke();
      const label = jianpuLabel(k, ui.mode);
      const size = Math.max(10, Math.round(r * 1.05));
      ctx.font = canvasFont(700, size, 'normal');
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle =
        tone === 'normal' && active && this.opts.theme === 'light' ? c.naturalText : ink;
      ctx.fillText(label.digit, x, digitY + size * 0.04);
      const dotR = Math.max(1.4, size * 0.09);
      const gap = dotR * 2.6;
      for (let d = 0; d < label.dotsAbove; d++) {
        ctx.beginPath();
        ctx.arc(x, digitY - size * 0.55 - dotR - d * gap, dotR, 0, Math.PI * 2);
        ctx.fill();
      }
      for (let d = 0; d < label.dotsBelow; d++) {
        ctx.beginPath();
        ctx.arc(x, digitY + size * 0.55 + dotR + d * gap, dotR, 0, Math.PI * 2);
        ctx.fill();
      }
    });
  }

  private drawPcPad(ctx: CanvasRenderingContext2D, at: number): void {
    const tl = this.opts.timeline;
    const c = this.colors;
    this.drawPanel(ctx);
    const idx = noteIndexAt(tl, at);
    const note = idx >= 0 ? tl.notes[idx] : null;
    const runIdx = runIndexAt(tl, at);
    const run = runIdx >= 0 ? tl.holdRuns[runIdx] : null;
    const a = note?.modifiers ?? NO_MODS;
    const b = run?.modifiers ?? NO_MODS;
    const mods: Modifiers = {
      left: a.left || b.left,
      right: a.right || b.right,
      scroll: a.scroll || b.scroll,
    };
    const { centers, col } = this.columns();
    const padH = this.height - this.tilesH;
    const side = Math.min(col * 0.78, padH * 0.5);
    const capY = this.height - side - Math.max(4, padH * 0.08);
    const tone = note ? tileColorKey(note.modifiers) : null;
    NOTE_KEYS.forEach((k, i) => {
      const x = centers[i] - side / 2;
      const active = note !== null && note.key === k;
      ctx.fillStyle = active && tone ? MOD_COLORS[tone].fill : c.cap;
      ctx.fillRect(x, capY, side, side);
      ctx.lineWidth = 1;
      ctx.strokeStyle = active && tone ? MOD_COLORS[tone].stroke : c.capBorder;
      ctx.strokeRect(x + 0.5, capY + 0.5, side - 1, side - 1);
      ctx.fillStyle = active && tone ? MOD_COLORS[tone].text : c.text;
      ctx.font = canvasFont(700, Math.max(10, side * 0.5));
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(k, centers[i], capY + side / 2);
    });
    const key = holdKey(mods);
    const textY = capY - Math.max(8, (capY - this.tilesH) / 2);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = canvasFont(700, Math.max(10, Math.min(16, padH * 0.2)));
    if (key) {
      const tone2: ModColorKey = mods.left ? 'left' : mods.right ? 'right' : 'scroll';
      ctx.fillStyle = MOD_COLORS[tone2].fill;
      ctx.fillText(
        tNow('mod.holdingBanner', { what: tNow(key) }),
        this.width / 2,
        textY,
        this.width - 8,
      );
    }
  }

  private drawCountdown(ctx: CanvasRenderingContext2D, n: number): void {
    const c = this.colors;
    ctx.fillStyle = c.scrim;
    ctx.fillRect(0, 0, this.width, this.height);
    const cy = this.tilesH / 2;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const big = Math.round(Math.min(this.width, this.tilesH) * 0.42);
    ctx.font = canvasFont(700, big);
    ctx.lineWidth = Math.max(2, big * 0.05);
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.strokeText(String(n), this.width / 2, cy);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(String(n), this.width / 2, cy);
    ctx.font = canvasFont(700, Math.max(12, Math.round(big * 0.2)));
    ctx.fillStyle = '#ffffff';
    ctx.fillText(tNow('mini.countdownHint'), this.width / 2, cy + big * 0.62, this.width - 16);
  }
}

// ---------------------------------------------------------------------------
// Phiên PiP
// ---------------------------------------------------------------------------

export type VideoPipMode = 'live' | 'prerender';

export interface VideoPipSession {
  readonly mode: VideoPipMode;
  readonly video: HTMLVideoElement;
  readonly closed: boolean;
  /** Thoát PiP (nếu đang là video này), dừng vẽ / luồng, gỡ video. Gọi nhiều lần được. */
  close(): void;
}

export interface VideoPipHooks {
  /** Phiên kết thúc (người dùng đóng khung PiP, `close()`, hoặc vào PiP thất bại). */
  onClosed?: () => void;
}

/**
 * Video đã CHUẨN BỊ cho PiP: gắn vào host, câm, playsinline, đã nạp (trực tiếp: luồng canvas đang phát;
 * dựng sẵn: blob đã nạp, đứng ở 0 s) — tạo lúc hộp thoại hiện, TRƯỚC cú chạm. Chưa vào PiP thì `close()` =
 * bỏ video chuẩn bị (không báo `onClosed`).
 */
export interface PreparedVideoPip extends VideoPipSession {
  /** Video đã có metadata (readyState ≥ HAVE_METADATA) — vào PiP được ngay. */
  readonly ready: boolean;
  /** Resolve `true` khi có metadata, `false` nếu bị đóng trước. */
  readonly whenReady: Promise<boolean>;
  /** Đã gọi `enter()` (mỗi video chuẩn bị chỉ vào PiP một lần). */
  readonly entered: boolean;
  /**
   * Vào PiP. GỌI ĐỒNG BỘ trong handler của cú chạm: lời gọi `requestPictureInPicture()` /
   * `webkitSetPresentationMode()` của trình duyệt chạy ngay, trước mọi thứ có thể chờ (Safari mất "user
   * activation" sau một `await`). Resolve = đã vào PiP (phiên chạy); reject = video đã bị dọn, lỗi gốc giữ
   * nguyên (`videoPipErrorKind` đọc được).
   */
  enter(hooks?: VideoPipHooks): Promise<VideoPipSession>;
}

type PipDocument = Document & {
  pictureInPictureEnabled?: boolean;
  pictureInPictureElement?: Element | null;
  exitPictureInPicture?: () => Promise<void>;
};

/** API PiP riêng của WebKit (Safari iOS): đồng bộ, không promise, báo bằng `webkitpresentationmodechanged`. */
type WebkitVideo = HTMLVideoElement & {
  webkitSupportsPresentationMode?: (mode: string) => boolean;
  webkitSetPresentationMode?: (mode: string) => void;
  webkitPresentationMode?: string;
};

const WEBKIT_PIP = 'picture-in-picture';
const WEBKIT_MODE_EVENT = 'webkitpresentationmodechanged';
/** `webkitSetPresentationMode` không có promise: chừng này ms mà chưa vào PiP = bị từ chối. */
export const WEBKIT_PIP_TIMEOUT_MS = 1500;
/** `HTMLMediaElement.HAVE_METADATA`. */
const HAVE_METADATA = 1;

/** DOMException tên `name` (môi trường không có DOMException → Error có `name`). */
function domError(name: string, message: string): Error {
  try {
    return new DOMException(message, name);
  } catch {
    const e = new Error(message);
    e.name = name;
    return e;
  }
}

function hasStandardPip(video: HTMLVideoElement): boolean {
  const doc = video.ownerDocument as PipDocument;
  return (
    typeof video.requestPictureInPicture === 'function' && doc.pictureInPictureEnabled !== false
  );
}

function hasWebkitPip(video: WebkitVideo): boolean {
  if (typeof video.webkitSetPresentationMode !== 'function') return false;
  if (typeof video.webkitSupportsPresentationMode !== 'function') return true;
  try {
    return video.webkitSupportsPresentationMode(WEBKIT_PIP);
  } catch {
    return false;
  }
}

/** Safari iOS kiểu cũ: đổi chế độ trình chiếu, chờ sự kiện xác nhận (quá hạn = bị từ chối). */
function enterWebkitPip(video: WebkitVideo): Promise<void> {
  if (video.webkitPresentationMode === WEBKIT_PIP) return Promise.resolve();
  // Executor của Promise chạy ĐỒNG BỘ → webkitSetPresentationMode vẫn nằm trong cú chạm.
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onChange = (): void => {
      if (video.webkitPresentationMode === WEBKIT_PIP) finish(null);
    };
    const finish = (err: unknown): void => {
      if (settled) return;
      settled = true;
      video.removeEventListener(WEBKIT_MODE_EVENT, onChange);
      if (timer !== null) clearTimeout(timer);
      if (err === null) resolve();
      else reject(err);
    };
    video.addEventListener(WEBKIT_MODE_EVENT, onChange);
    try {
      video.webkitSetPresentationMode?.(WEBKIT_PIP);
    } catch (e) {
      finish(e);
      return;
    }
    if (video.webkitPresentationMode === WEBKIT_PIP) {
      finish(null);
      return;
    }
    timer = setTimeout(
      () => finish(domError('NotAllowedError', 'Picture-in-Picture was not entered')),
      WEBKIT_PIP_TIMEOUT_MS,
    );
  });
}

/**
 * Xin PiP cho `video` — lời gọi của trình duyệt chạy ĐỒNG BỘ ngay trong hàm này (không `await` gì trước):
 * chuẩn `requestPictureInPicture()`; chỉ có `webkitSetPresentationMode` (Safari iOS kiểu cũ) thì dùng nó.
 * Không có cách nào → reject `NotSupportedError`. Lỗi ném đồng bộ cũng thành reject.
 */
export function requestVideoPip(video: HTMLVideoElement): Promise<void> {
  try {
    if (hasStandardPip(video)) return video.requestPictureInPicture().then(() => undefined);
    const wk = video as WebkitVideo;
    if (hasWebkitPip(wk)) return enterWebkitPip(wk);
  } catch (e) {
    return Promise.reject(e);
  }
  return Promise.reject(domError('NotSupportedError', 'Picture-in-Picture unsupported'));
}

/** Loại lỗi mở PiP (hộp thoại đổi ra câu dễ hiểu — không hiện chữ lỗi thô của trình duyệt). */
export type VideoPipErrorKind = 'unsupported' | 'notAllowed' | 'notReady' | 'failed';

export function videoPipErrorKind(e: unknown): VideoPipErrorKind {
  const name =
    typeof e === 'object' && e !== null && 'name' in e ? String((e as { name: unknown }).name) : '';
  if (name === 'NotSupportedError') return 'unsupported';
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'notAllowed';
  if (name === 'InvalidStateError') return 'notReady';
  return 'failed';
}

/**
 * iPhone / iPod / iPad theo UA — nằm ở phonePref.ts (module nhẹ màn chơi nạp ngay); nhắc lại ở đây cho chỗ
 * dùng cũ. Quyết định "máy Apple" của hộp thoại video nổi theo lựa chọn đã lưu (`useIsApplePhone`), không
 * theo UA một mình (R7-6 / R7-7).
 */
export { isAppleMobile } from './phonePref';

function createPipVideo(host: HTMLElement): HTMLVideoElement {
  const video = host.ownerDocument.createElement('video');
  video.muted = true;
  video.defaultMuted = true;
  video.playsInline = true;
  video.setAttribute('playsinline', '');
  video.setAttribute('webkit-playsinline', '');
  video.setAttribute('muted', '');
  video.className = 'guide-video';
  host.appendChild(video);
  return video;
}

function inPip(video: HTMLVideoElement): boolean {
  if ((video.ownerDocument as PipDocument).pictureInPictureElement === video) return true;
  return (video as WebkitVideo).webkitPresentationMode === WEBKIT_PIP;
}

/** Thoát PiP nếu `video` đang ở PiP (chuẩn hoặc WebKit). */
function exitPip(video: HTMLVideoElement): void {
  const doc = video.ownerDocument as PipDocument;
  if (doc.pictureInPictureElement === video && typeof doc.exitPictureInPicture === 'function') {
    void doc.exitPictureInPicture().catch(() => undefined);
    return;
  }
  const wk = video as WebkitVideo;
  if (
    wk.webkitPresentationMode === WEBKIT_PIP &&
    typeof wk.webkitSetPresentationMode === 'function'
  ) {
    try {
      wk.webkitSetPresentationMode('inline');
    } catch {
      // đã thoát
    }
  }
}

/** Gọi play() không chờ, nuốt lỗi (video câm: không cần chạm; trong cú chạm thì càng chắc). */
function playQuietly(video: HTMLVideoElement): Promise<void> | null {
  try {
    const p = video.play() as Promise<void> | undefined;
    if (p && typeof p.then === 'function') {
      void p.catch(() => undefined);
      return p;
    }
  } catch {
    // jsdom / trình duyệt chặn
  }
  return null;
}

type PipState = 'prepared' | 'entering' | 'open' | 'closed';

class PipVideo implements PreparedVideoPip {
  readonly mode: VideoPipMode;
  readonly video: HTMLVideoElement;
  readonly whenReady: Promise<boolean>;
  private state: PipState = 'prepared';
  private readonly cleanups: (() => void)[] = [];
  private readonly onEntered: (() => void)[] = [];
  private hooks: VideoPipHooks = {};
  private settleReady: (ok: boolean) => void = () => undefined;

  constructor(mode: VideoPipMode, video: HTMLVideoElement) {
    this.mode = mode;
    this.video = video;
    this.whenReady = new Promise<boolean>((resolve) => {
      this.settleReady = resolve;
    });
    if (this.ready) this.settleReady(true);
    else this.listen('loadedmetadata', () => this.settleReady(true));
    // Rời PiP (nút đóng của khung PiP, hoặc trình duyệt chuyển khung sang video khác): video đã không còn
    // ở PiP → dọn, KHÔNG gọi exit (có thể đang thoát nhầm khung của video mới).
    this.listen('leavepictureinpicture', () => this.dispose(false));
    this.listen(WEBKIT_MODE_EVENT, () => {
      if (this.state === 'open' && (video as WebkitVideo).webkitPresentationMode === 'inline') {
        this.dispose(false);
      }
    });
  }

  get ready(): boolean {
    return this.video.readyState >= HAVE_METADATA;
  }

  get closed(): boolean {
    return this.state === 'closed';
  }

  get entered(): boolean {
    return this.state === 'entering' || this.state === 'open';
  }

  get isOpen(): boolean {
    return this.state === 'open';
  }

  listen(type: string, fn: () => void): void {
    this.video.addEventListener(type, fn);
    this.cleanups.push(() => this.video.removeEventListener(type, fn));
  }

  onCleanup(fn: () => void): void {
    this.cleanups.push(fn);
  }

  /** Chạy khi đã vào PiP (vòng vẽ, nút ▶ / ❚❚ của khung PiP…). */
  whenEntered(fn: () => void): void {
    this.onEntered.push(fn);
  }

  enter(hooks: VideoPipHooks = {}): Promise<VideoPipSession> {
    if (this.state !== 'prepared') {
      return Promise.reject(domError('InvalidStateError', 'video already used'));
    }
    // ĐỒNG BỘ, việc đầu tiên: xin PiP khi còn trong cú chạm.
    const request = requestVideoPip(this.video);
    this.state = 'entering';
    this.hooks = hooks;
    // Cùng cú chạm, không chờ: chạy video (iOS có thể đã dừng video ẩn; dựng sẵn bắt đầu từ 0 s).
    playQuietly(this.video);
    return request.then(
      () => {
        if (this.state !== 'entering') throw domError('AbortError', 'closed');
        this.state = 'open';
        for (const fn of this.onEntered.splice(0)) fn();
        return this;
      },
      (e: unknown) => {
        this.dispose(false);
        throw e;
      },
    );
  }

  close(): void {
    this.dispose(true);
  }

  private dispose(exit: boolean): void {
    if (this.state === 'closed') return;
    this.state = 'closed';
    if (exit) exitPip(this.video);
    for (const fn of this.cleanups.splice(0).reverse()) {
      try {
        fn();
      } catch {
        // dọn tiếp phần còn lại
      }
    }
    try {
      this.video.pause();
    } catch {
      // jsdom
    }
    this.video.removeAttribute('src');
    this.video.srcObject = null;
    this.video.remove();
    this.settleReady(false);
    this.hooks.onClosed?.();
  }
}

type MediaSessionLike = Pick<MediaSession, 'setActionHandler'>;

function mediaSessionOf(doc: Document): MediaSessionLike | null {
  const nav = (doc.defaultView ?? (typeof window !== 'undefined' ? window : null))?.navigator;
  const ms = nav && 'mediaSession' in nav ? (nav.mediaSession as MediaSessionLike | null) : null;
  return ms && typeof ms.setActionHandler === 'function' ? ms : null;
}

/**
 * "Trực tiếp": chuẩn bị luồng canvas → video câm đang phát (gọi lúc hộp thoại hiện, không cần chạm);
 * `enter()` trong cú chạm. Đồng hồ của video chạy khi khung PiP mở. Khung PiP của Chrome KHÔNG có nút ▶ /
 * ❚❚ cho video nguồn MediaStream trừ khi trang đăng ký Media Session 'play' / 'pause' → đăng ký trong lúc
 * phiên mở (gỡ khi đóng): ❚❚ dừng ô rơi, ▶ chạy tiếp — hết bài thì ▶ chạy lại từ đầu (cả đếm ngược). Đứng
 * yên (dừng / hết bài) thì không vẽ lại khung (đỡ pin cho máy đang chạy game). Không có `captureStream` →
 * ném `NotSupportedError` (không để lại gì).
 */
export function prepareLiveVideoPip(opts: GuideVideoOptions, host: HTMLElement): PreparedVideoPip {
  const painter = new GuidePainter(opts, host.ownerDocument);
  painter.paint(0);
  const capture = (
    painter.canvas as HTMLCanvasElement & { captureStream?: (fps?: number) => MediaStream }
  ).captureStream;
  if (typeof capture !== 'function') {
    painter.dispose();
    throw domError('NotSupportedError', 'captureStream unsupported');
  }
  let stream: MediaStream;
  try {
    stream = capture.call(painter.canvas, LIVE_STREAM_FPS);
  } catch (e) {
    painter.dispose();
    throw e;
  }
  const video = createPipVideo(host);
  video.srcObject = stream;
  const pv = new PipVideo('live', video);
  pv.onCleanup(() => {
    for (const tr of stream.getTracks()) tr.stop();
    painter.dispose();
  });
  // Khung đầu cho luồng: có trình duyệt chỉ đẩy khung khi canvas được vẽ SAU captureStream.
  painter.paint(0);

  // Đồng hồ: giây đã chạy = tích lũy + (đang chạy ? now − mốc : 0).
  let acc = 0;
  let since: number | null = null;
  let ended = false;
  /** Giây của khung vẽ gần nhất (khung 0 đã vẽ ở trên). */
  let painted = 0;
  const now = (): number => performance.now() / 1000;
  const elapsed = (): number => acc + (since !== null ? now() - since : 0);
  const pause = (): void => {
    if (since === null) return;
    acc += now() - since;
    since = null;
  };
  const resume = (): void => {
    if (ended) {
      // ▶ sau khi hết bài: chạy lại từ đầu.
      ended = false;
      acc = 0;
      since = null;
    }
    if (since === null) since = now();
  };

  pv.whenEntered(() => {
    const timer = setInterval(
      () => {
        const sec = elapsed();
        if (sec === painted) return; // đang dừng / đã hết: khung không đổi
        painted = sec;
        const f = painter.paint(sec);
        if (f.ended) {
          pause();
          ended = true;
          // Khung PiP đổi sang ▶ (chạm = chơi lại) thay vì ❚❚ của luồng vẫn "đang phát".
          video.pause();
        }
      },
      Math.round(1000 / LIVE_STREAM_FPS),
    );
    pv.onCleanup(() => clearInterval(timer));
    // Nút ▶ / ❚❚ của khung PiP (Media Session; Chrome ẩn nút cho nguồn MediaStream nếu không có handler).
    const ms = mediaSessionOf(host.ownerDocument);
    if (ms) {
      const set = (action: MediaSessionAction, fn: MediaSessionActionHandler | null): void => {
        try {
          ms.setActionHandler(action, fn);
        } catch {
          // trình duyệt không nhận action này
        }
      };
      set('play', () => {
        resume();
        playQuietly(video);
      });
      set('pause', () => {
        pause();
        video.pause();
      });
      pv.onCleanup(() => {
        set('play', null);
        set('pause', null);
      });
    }
    resume();
  });
  // Chỉ nút của khung PiP mới dừng / chạy tiếp ô rơi (video ẩn đang chuẩn bị, hay trình duyệt tự dừng
  // video ngoài PiP thì bỏ qua).
  pv.listen('pause', () => {
    if (pv.isOpen && inPip(video)) pause();
  });
  pv.listen('play', () => {
    if (pv.isOpen && inPip(video)) resume();
  });
  // Phát sẵn (câm — không cần chạm): video có metadata trước cú chạm.
  playQuietly(video);
  return pv;
}

/**
 * "Dựng sẵn": chuẩn bị Blob WebM câm (gọi khi dựng xong và hộp thoại đang hiện); `enter()` trong cú chạm
 * phát từ đầu trong PiP. Mồi trước: phát câm rồi dừng ngay ở 0 s (iOS không nạp video chưa từng phát) —
 * có metadata + khung đầu trước cú chạm. Đóng → thu hồi blob URL.
 */
export function prepareVideoBlobPip(blob: Blob, host: HTMLElement): PreparedVideoPip {
  const video = createPipVideo(host);
  video.preload = 'auto';
  const url = URL.createObjectURL(blob);
  video.src = url;
  const pv = new PipVideo('prerender', video);
  pv.onCleanup(() => URL.revokeObjectURL(url));
  const primed = playQuietly(video);
  const rewind = (): void => {
    // Đã chạm vào PiP trong lúc mồi → để video chạy.
    if (pv.entered || pv.closed) return;
    try {
      video.pause();
      video.currentTime = 0;
    } catch {
      // jsdom
    }
  };
  if (primed) void primed.then(rewind, () => undefined);
  else rewind();
  return pv;
}

// ---------------------------------------------------------------------------
// Dựng sẵn (WebCodecs → WebM)
// ---------------------------------------------------------------------------

/**
 * Cấu hình thử lần lượt: VP8 trước (mã hóa nhanh trên máy yếu), rồi VP9. `mime` = kiểu hỏi `canPlayType` —
 * chỉ dùng codec mà `<video>` phát được trong WebM.
 */
export const PRERENDER_CODECS: readonly { codec: string; id: WebmCodecId; mime: string }[] = [
  { codec: 'vp8', id: 'V_VP8', mime: 'video/webm; codecs="vp8"' },
  { codec: 'vp09.00.10.08', id: 'V_VP9', mime: 'video/webm; codecs="vp9"' },
];

/** Khung khóa mỗi chừng này giây (tua / chạy lại nhanh). */
export const KEYFRAME_EVERY_SEC = 2;
/** Ô rơi là hình phẳng ít chi tiết: ~0.7 Mbps đủ nét (bài 3 phút ≈ 15 MB). */
const VIDEO_BITRATE = 700_000;
/** Số khung chờ trong bộ mã hóa trước khi chờ bớt. */
const MAX_QUEUE = 6;
/** Nhường luồng chính (để UI vẽ tiến độ) mỗi chừng này khung. */
const YIELD_EVERY = 8;

/** Phần WebCodecs dùng ở đây (test truyền bản giả). */
export interface EncoderLike {
  readonly encodeQueueSize: number;
  configure(config: VideoEncoderConfig): void;
  encode(frame: VideoFrame, options?: VideoEncoderEncodeOptions): void;
  flush(): Promise<void>;
  close(): void;
}

export interface WebCodecsApi {
  VideoEncoder: {
    new (init: VideoEncoderInit): EncoderLike;
    isConfigSupported(config: VideoEncoderConfig): Promise<VideoEncoderSupport>;
  };
  VideoFrame: new (source: CanvasImageSource, init?: VideoFrameInit) => VideoFrame;
}

export interface PrerenderOptions {
  fps?: number;
  /** Hỏi `<video>` phát được WebM của codec nào (mặc định `browserCanPlayType()`; null = không hỏi). */
  canPlayType?: CanPlayType | null;
  /** Tiến độ 0..1 (sau mỗi lần nhường luồng). */
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
  /** Mặc định WebCodecs của trình duyệt. */
  api?: WebCodecsApi;
  doc?: Document;
  /** Giới hạn độ dài (giây) — mặc định cả bài. */
  maxSec?: number;
}

export interface PrerenderResult {
  blob: Blob;
  codec: WebmCodecId;
  frames: number;
  durationSec: number;
  width: number;
  height: number;
}

function abortError(): Error {
  const e = new Error('aborted');
  e.name = 'AbortError';
  return e;
}

function browserApi(): WebCodecsApi | null {
  const g = globalThis as Record<string, unknown>;
  if (typeof g.VideoEncoder !== 'function' || typeof g.VideoFrame !== 'function') return null;
  return { VideoEncoder: g.VideoEncoder, VideoFrame: g.VideoFrame } as unknown as WebCodecsApi;
}

/**
 * Nhường luồng chính một task. Dùng MessageChannel: task của nó không bị hãm như `setTimeout` ở trang nền
 * (Chrome cho timer nối tiếp của trang ẩn ~1 lần / giây, 1 lần / phút sau 5 phút — bài 3 phút có > 500 lần
 * nhường). Không có MessageChannel → setTimeout(0).
 */
export function nextTask(): Promise<void> {
  if (typeof MessageChannel !== 'function') return new Promise((r) => setTimeout(r, 0));
  return new Promise((resolve) => {
    const ch = new MessageChannel();
    ch.port1.onmessage = () => {
      ch.port1.onmessage = null;
      ch.port1.close();
      ch.port2.close();
      resolve();
    };
    ch.port2.postMessage(null);
  });
}

/**
 * Cấu hình mã hóa đầu tiên trình duyệt nhận MÀ `<video>` phát được (`canPlayType` khác ''); null nếu không
 * có. `canPlayType` null = không hỏi (coi như phát được).
 */
export async function pickPrerenderCodec(
  api: WebCodecsApi,
  width: number,
  height: number,
  fps: number,
  canPlayType: CanPlayType | null = browserCanPlayType(),
): Promise<{ config: VideoEncoderConfig; id: WebmCodecId } | null> {
  for (const c of PRERENDER_CODECS) {
    if (canPlayType && canPlayType(c.mime) === '') continue;
    const config: VideoEncoderConfig = {
      codec: c.codec,
      width,
      height,
      bitrate: VIDEO_BITRATE,
      framerate: fps,
      latencyMode: 'quality',
    };
    try {
      const r = await api.VideoEncoder.isConfigSupported(config);
      if (r.supported) return { config: r.config ?? config, id: c.id };
    } catch {
      // thử codec kế
    }
  }
  return null;
}

/**
 * Dựng cả bài thành video WebM câm (đếm ngược nằm sẵn trong video). Không cần chạm của người dùng;
 * chuẩn bị bằng `prepareVideoBlobPip` rồi `enter()` trong một lần chạm mới. Hủy bằng `signal`.
 */
export async function prerenderGuideVideo(
  opts: GuideVideoOptions,
  po: PrerenderOptions = {},
): Promise<PrerenderResult> {
  const api = po.api ?? browserApi();
  if (!api) throw new Error('WebCodecs unsupported');
  const fps = po.fps ?? GUIDE_VIDEO_FPS;
  const painter = new GuidePainter(opts, po.doc ?? document);
  let encoder: EncoderLike | null = null;
  try {
    const canPlay =
      po.canPlayType === undefined
        ? browserCanPlayType(po.doc ?? currentDocument())
        : po.canPlayType;
    const picked = await pickPrerenderCodec(api, painter.width, painter.height, fps, canPlay);
    if (!picked) throw new Error('no supported codec (VP8/VP9)');
    const full = painter.durationSec;
    const durationSec = po.maxSec !== undefined && po.maxSec > 0 ? Math.min(full, po.maxSec) : full;
    const total = Math.max(1, Math.ceil(durationSec * fps));
    const muxer = new WebmMuxer({
      codecId: picked.id,
      width: painter.width,
      height: painter.height,
      frameRate: fps,
    });
    let failure: unknown = null;
    encoder = new api.VideoEncoder({
      output: (chunk) => {
        const data = new Uint8Array(chunk.byteLength);
        chunk.copyTo(data);
        try {
          muxer.addFrame({ data, timestampUs: chunk.timestamp, keyframe: chunk.type === 'key' });
        } catch (e) {
          failure = e;
        }
      },
      error: (e) => {
        failure = e;
      },
    });
    encoder.configure(picked.config);
    const frameUs = 1_000_000 / fps;
    const keyEvery = Math.max(1, Math.round(KEYFRAME_EVERY_SEC * fps));
    for (let i = 0; i < total; i++) {
      if (po.signal?.aborted) throw abortError();
      if (failure) throw failure instanceof Error ? failure : new Error(String(failure));
      painter.paint(i / fps);
      const frame = new api.VideoFrame(painter.canvas, {
        timestamp: Math.round(i * frameUs),
        duration: Math.round(frameUs),
      });
      try {
        encoder.encode(frame, { keyFrame: i % keyEvery === 0 });
      } finally {
        frame.close();
      }
      while (encoder.encodeQueueSize > MAX_QUEUE) {
        await nextTask();
        if (po.signal?.aborted) throw abortError();
      }
      if (i % YIELD_EVERY === YIELD_EVERY - 1) {
        po.onProgress?.((i + 1) / total);
        await nextTask();
      }
    }
    await encoder.flush();
    if (failure) throw failure instanceof Error ? failure : new Error(String(failure));
    if (po.signal?.aborted) throw abortError();
    po.onProgress?.(1);
    const blob = muxer.finalize({ durationMs: durationSec * 1000 });
    return {
      blob,
      codec: picked.id,
      frames: muxer.frameCount,
      durationSec,
      width: painter.width,
      height: painter.height,
    };
  } finally {
    try {
      encoder?.close();
    } catch {
      // đã đóng
    }
    painter.dispose();
  }
}

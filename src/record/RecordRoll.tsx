import { useEffect, useRef, useState } from 'react';
import { NOTE_KEYS, keyIndex, modifiersOf } from '../core/keys';
import { jianpuLabel } from '../core/mobile';
import type { NoteKey, Octave } from '../core/types';
import { MOD_COLORS, tileColorKey } from '../ui/palette';
import { useSettings } from '../ui/settings';
import type { ControlScheme } from '../ui/settings';

/**
 * Cuộn nốt của màn thu: trục ngang = beat, 8 làn ngang theo phím (Z dưới cùng … `,` trên cùng) như
 * bảng phím game xoay ngang. Ô tô theo màu modifier (palette — giống tile), nốt thăng có `#`
 * (không chỉ dựa vào màu). Vạch vị trí = tia lõi sáng + glow mảnh (màu lấy từ CSS var của theme).
 * Chỉ để xem, không tương tác; canvas DPR aware, vẽ lại khi đổi dữ liệu / cỡ / theme.
 * Kiểu Mobile: cột tên làn và nhãn ô là số giản phổ (1 … 7, 1̇) với chấm quãng vẽ riêng — bàn nút
 * của game mobile không có chữ Z X C…; PC giữ tên phím.
 */

export interface RollNote {
  key: NoteKey;
  octave: Octave;
  sharp: boolean;
  startBeat: number;
  beats: number;
}

export interface RecordRollProps {
  notes: readonly RollNote[];
  /** Khung nhìn [from, to) theo beat. */
  from: number;
  to: number;
  beatsPerBar: number;
  /** Vạch vị trí hiện tại (beat). */
  playhead?: number | null;
  /** Chiều cao CSS (px). */
  height?: number;
  /** Bề rộng CSS tối thiểu (px) — bản thu dài cuộn ngang trong khung cha. */
  minWidth?: number;
  /** Nhãn cho screen reader (canvas là role="img"). */
  label: string;
  /** Kiểu điều khiển: nhãn PC (Z X C…) hay Mobile (số giản phổ). Mặc định PC. */
  scheme?: ControlScheme;
  className?: string;
}

export interface RollColors {
  bg: string;
  laneAlt: string;
  beatLine: string;
  barLine: string;
  gutterText: string;
  /** Viền ngoài 1 px của ô nốt. */
  noteEdge: string;
  playheadCore: string;
  playheadGlow: string;
  font: string;
}

/** Cột tên phím bên trái (px CSS). */
export const ROLL_GUTTER = 22;
const LANES = NOTE_KEYS.length;

function cssVar(style: CSSStyleDeclaration | null, name: string, fallback: string): string {
  const v = style?.getPropertyValue(name).trim();
  return v || fallback;
}

function get2d(canvas: HTMLCanvasElement): CanvasRenderingContext2D | null {
  try {
    return canvas.getContext('2d') ?? null;
  } catch {
    return null;
  }
}

function computedStyle(el: Element): CSSStyleDeclaration | null {
  try {
    return getComputedStyle(el);
  } catch {
    return null;
  }
}

/** Chấm quãng giản phổ (trên / dưới) quanh chữ số ở tâm (cx, cy), cỡ chữ `px` — vẽ riêng, không dùng dấu kết hợp. */
function drawJianpuDots(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  px: number,
  above: number,
  below: number,
): void {
  if (above <= 0 && below <= 0) return;
  const r = Math.max(1, px * 0.11);
  const step = r * 2.6;
  ctx.beginPath();
  for (let i = 0; i < above; i++) {
    const y = cy - px * 0.5 - r - i * step;
    ctx.moveTo(cx + r, y);
    ctx.arc(cx, y, r, 0, Math.PI * 2);
  }
  for (let i = 0; i < below; i++) {
    const y = cy + px * 0.5 + r + i * step;
    ctx.moveTo(cx + r, y);
    ctx.arc(cx, y, r, 0, Math.PI * 2);
  }
  ctx.fill();
}

/** Vẽ một khung (thuần theo tham số). */
export function drawRecordRoll(
  ctx: CanvasRenderingContext2D,
  size: { width: number; height: number; dpr: number },
  notes: readonly RollNote[],
  view: {
    from: number;
    to: number;
    beatsPerBar: number;
    playhead: number | null;
    scheme?: ControlScheme;
  },
  colors: RollColors,
): void {
  const mobile = view.scheme === 'mobile';
  const { width, height, dpr } = size;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = colors.bg;
  ctx.fillRect(0, 0, width, height);

  const laneH = height / LANES;
  const span = view.to - view.from > 0 ? view.to - view.from : 1;
  const plot = Math.max(1, width - ROLL_GUTTER);
  const xOf = (beat: number) => ROLL_GUTTER + ((beat - view.from) / span) * plot;
  const rowOf = (key: NoteKey) => LANES - 1 - keyIndex(key);

  // làn xen kẽ rất nhẹ
  ctx.fillStyle = colors.laneAlt;
  for (let r = 1; r < LANES; r += 2) ctx.fillRect(ROLL_GUTTER, r * laneH, plot, laneH);

  // vạch beat / ô nhịp (bỏ vạch beat khi quá dày)
  const bpb = view.beatsPerBar > 0 ? view.beatsPerBar : 4;
  const pxPerBeat = plot / span;
  for (let b = Math.ceil(view.from - 1e-9); b < view.to; b++) {
    const isBar = Math.abs(b / bpb - Math.round(b / bpb)) < 1e-6;
    if (!isBar && pxPerBeat < 6) continue;
    if (isBar && pxPerBeat * bpb < 4) continue;
    ctx.fillStyle = isBar ? colors.barLine : colors.beatLine;
    ctx.fillRect(Math.round(xOf(b)), 0, 1, height);
  }

  // cột tên phím
  ctx.fillStyle = colors.beatLine;
  ctx.fillRect(ROLL_GUTTER - 1, 0, 1, height);
  const labelPx = Math.max(9, Math.min(13, laneH * 0.62));
  ctx.font = `700 ${labelPx}px ${colors.font}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = colors.gutterText;
  for (const k of NOTE_KEYS) {
    const cy = rowOf(k) * laneH + laneH / 2;
    if (!mobile) {
      ctx.fillText(k, ROLL_GUTTER / 2, cy);
      continue;
    }
    // Mobile: số của nút ở quãng tự nhiên ("," = 1 chấm trên).
    const j = jianpuLabel(k, 0);
    ctx.fillText(j.digit, ROLL_GUTTER / 2, cy);
    drawJianpuDots(ctx, ROLL_GUTTER / 2, cy, labelPx, j.dotsAbove, j.dotsBelow);
  }

  // nốt: viền ngoài (tách khỏi nền — theme sáng) + thân màu modifier + viền trong tối 1 px +
  // highlight mép trên (như tile)
  const pad = laneH > 10 ? 2 : 1;
  for (const n of notes) {
    if (!(Number.isFinite(n.startBeat) && Number.isFinite(n.beats) && n.beats > 0)) continue;
    const end = n.startBeat + n.beats;
    if (end <= view.from || n.startBeat >= view.to) continue;
    const x0 = Math.max(ROLL_GUTTER, xOf(n.startBeat));
    const x1 = Math.min(width, xOf(end));
    const w = Math.max(3, x1 - x0 - 1);
    const y = rowOf(n.key) * laneH + pad;
    const h = Math.max(3, laneH - pad * 2);
    const c = MOD_COLORS[tileColorKey(modifiersOf(n.octave, n.sharp))];
    ctx.fillStyle = colors.noteEdge;
    ctx.fillRect(x0, y, w, h);
    const ix = x0 + 1;
    const iy = y + 1;
    const iw = Math.max(1, w - 2);
    const ih = Math.max(1, h - 2);
    ctx.fillStyle = c.fill;
    ctx.fillRect(ix, iy, iw, ih);
    ctx.fillStyle = c.stroke;
    ctx.fillRect(ix, iy + ih - 1, iw, 1);
    ctx.fillRect(ix + iw - 1, iy, 1, ih);
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.fillRect(ix, iy, iw, 1);
    const j = mobile ? jianpuLabel(n.key, n.octave) : null;
    const main = j ? j.digit : n.key;
    const text = n.sharp ? `${main}#` : main;
    if (w >= labelPx * (n.sharp ? 1.6 : 1) + 4 && h >= 9) {
      const cy = y + h / 2 + 0.5;
      ctx.fillStyle = c.text;
      ctx.textAlign = 'left';
      ctx.fillText(text, x0 + 3, cy);
      ctx.textAlign = 'center';
      // Chấm quãng quanh chữ số (bề rộng chữ số ≈ 0.6 cỡ chữ).
      if (j) drawJianpuDots(ctx, x0 + 3 + labelPx * 0.3, cy, labelPx, j.dotsAbove, j.dotsBelow);
    } else if (n.sharp && iw >= 3 && ih >= 4) {
      // ô quá hẹp cho nhãn "#": khấc tam giác góc trên-trái (không chỉ dựa vào màu)
      const s = Math.min(iw, ih, 6);
      ctx.fillStyle = c.text;
      ctx.beginPath();
      ctx.moveTo(ix, iy);
      ctx.lineTo(ix + s, iy);
      ctx.lineTo(ix, iy + s);
      ctx.closePath();
      ctx.fill();
    }
  }

  // vạch vị trí: glow mảnh + lõi sáng
  const ph = view.playhead;
  if (ph !== null && Number.isFinite(ph) && ph >= view.from && ph <= view.to) {
    const x = Math.round(xOf(ph));
    ctx.fillStyle = colors.playheadGlow;
    ctx.fillRect(x - 3, 0, 6, height);
    ctx.fillStyle = colors.playheadCore;
    ctx.fillRect(x - 1, 0, 2, height);
  }
}

/** Canvas cuộn nốt, DPR aware, tự vẽ lại khi đổi cỡ (ResizeObserver), dữ liệu hoặc theme. */
export function RecordRoll({
  notes,
  from,
  to,
  beatsPerBar,
  playhead = null,
  height = 160,
  minWidth,
  label,
  scheme = 'pc',
  className,
}: RecordRollProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const theme = useSettings((s) => s.theme);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    setWidth(canvas.clientWidth);
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setWidth(canvas.clientWidth));
    ro.observe(canvas);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || width <= 0) return;
    const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    const w = Math.round(width * dpr);
    const h = Math.round(height * dpr);
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
    const ctx = get2d(canvas);
    if (!ctx) return;
    const style = computedStyle(canvas);
    const colors: RollColors = {
      bg: cssVar(style, '--rec-roll-bg', '#0c1013'),
      laneAlt: cssVar(style, '--rec-roll-lane-alt', 'rgba(255,255,255,0.025)'),
      beatLine: cssVar(style, '--rec-roll-beat', '#1f262e'),
      barLine: cssVar(style, '--rec-roll-bar', '#3d4752'),
      gutterText: cssVar(style, '--rec-roll-gutter-text', '#9aa5b1'),
      noteEdge: cssVar(style, '--rec-roll-note-edge', 'rgba(0,0,0,0.55)'),
      playheadCore: cssVar(style, '--rec-roll-playhead', '#effff7'),
      playheadGlow: cssVar(style, '--rec-roll-playhead-glow', 'rgba(15,247,150,0.35)'),
      font: style?.fontFamily || 'system-ui, sans-serif',
    };
    drawRecordRoll(
      ctx,
      { width, height, dpr },
      notes,
      { from, to, beatsPerBar, playhead, scheme },
      colors,
    );
  }, [notes, from, to, beatsPerBar, playhead, height, width, theme, scheme]);

  return (
    <canvas
      ref={canvasRef}
      className={['rec-roll', className].filter(Boolean).join(' ')}
      style={{ height, minWidth }}
      role="img"
      aria-label={label}
    />
  );
}

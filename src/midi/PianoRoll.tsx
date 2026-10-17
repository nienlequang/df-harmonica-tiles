import { useEffect, useRef, useState } from 'react';
import { useSettings } from '../ui/settings';

/**
 * Piano roll mini bằng Canvas 2D (spec §6b A bước 2–3, thu melody): trục ngang = beat, trục dọc =
 * cao độ. Chỉ để xem nhanh, không tương tác. Màu lấy từ CSS var của theme nên tự đổi sáng/tối.
 */

export interface PianoRollNote {
  startBeat: number;
  beats: number;
  midi: number;
}

export interface PianoRollProps {
  notes: readonly PianoRollNote[];
  /** Nhãn cho screen reader (canvas là role="img"). */
  label: string;
  /** Beat bắt đầu khung nhìn (mặc định: 0 hoặc nốt sớm nhất nếu âm). */
  from?: number;
  /** Beat kết thúc khung nhìn (mặc định: cuối nốt muộn nhất). */
  to?: number;
  /** Vẽ vạch ô nhịp mỗi n beat (0 = không vẽ). */
  beatsPerBar?: number;
  /** Vạch vị trí hiện tại (beat), vd. lúc đang thu. */
  playhead?: number | null;
  /** Chiều cao CSS (px). */
  height?: number;
  className?: string;
}

export interface PianoRollColors {
  bg: string;
  grid: string;
  note: string;
  playhead: string;
}

export interface PianoRollView {
  from: number;
  to: number;
  minMidi: number;
  maxMidi: number;
}

/** Tầm hiển thị tối thiểu (bán cung) để vài nốt không bị phóng to quá mức. */
const MIN_PITCH_SPAN = 12;
const DEFAULT_HEIGHT = 48;

function finiteNotes(notes: readonly PianoRollNote[]): PianoRollNote[] {
  return notes.filter(
    (n) =>
      Number.isFinite(n.startBeat) &&
      Number.isFinite(n.beats) &&
      n.beats > 0 &&
      Number.isFinite(n.midi),
  );
}

/** Khung nhìn (thuần, test được): beat [from, to) và tầm cao độ [minMidi, maxMidi]. */
export function pianoRollView(
  notes: readonly PianoRollNote[],
  from?: number,
  to?: number,
): PianoRollView {
  const list = finiteNotes(notes);
  let lo = Infinity;
  let hi = -Infinity;
  let start = Infinity;
  let end = -Infinity;
  for (const n of list) {
    lo = Math.min(lo, n.midi);
    hi = Math.max(hi, n.midi);
    start = Math.min(start, n.startBeat);
    end = Math.max(end, n.startBeat + n.beats);
  }
  if (list.length === 0) {
    lo = 60;
    hi = 72;
    start = 0;
    end = 4;
  }
  // giữa tầm, nới cho đủ MIN_PITCH_SPAN
  const span = hi - lo;
  if (span < MIN_PITCH_SPAN) {
    const pad = MIN_PITCH_SPAN - span;
    lo -= Math.floor(pad / 2);
    hi += Math.ceil(pad / 2);
  }
  const f = from !== undefined && Number.isFinite(from) ? from : Math.min(0, start);
  let t = to !== undefined && Number.isFinite(to) ? to : end;
  if (!(t > f)) t = f + 1;
  return { from: f, to: t, minMidi: lo, maxMidi: hi };
}

function cssVar(el: Element, name: string, fallback: string): string {
  try {
    const v = getComputedStyle(el).getPropertyValue(name).trim();
    return v || fallback;
  } catch {
    return fallback;
  }
}

/**
 * Màu theo token của theme (DESIGN.md, D-238): nốt màu chữ trung tính (`--text`, đủ tương phản cả sáng
 * lẫn tối) — KHÔNG dùng accent neon (gần màu tile Nửa Cung); playhead là chỉ báo tiến độ của khung UI
 * → `--accent`, không phải hổ phách `--warn` (chỉ cho cảnh báo).
 */
export function pianoRollColors(el: Element): PianoRollColors {
  return {
    bg: cssVar(el, '--surface-2', '#171c22'),
    grid: cssVar(el, '--border', '#2b333c'),
    note: cssVar(el, '--text', '#e9edf1'),
    playhead: cssVar(el, '--accent', '#0ff796'),
  };
}

function get2d(canvas: HTMLCanvasElement): CanvasRenderingContext2D | null {
  try {
    return canvas.getContext('2d') ?? null;
  } catch {
    return null;
  }
}

/** Vẽ một khung (thuần theo tham số, gọi lại khi đổi kích thước / dữ liệu / theme). */
export function drawPianoRoll(
  ctx: CanvasRenderingContext2D,
  size: { width: number; height: number; dpr: number },
  notes: readonly PianoRollNote[],
  view: PianoRollView,
  colors: PianoRollColors,
  opts: { beatsPerBar?: number; playhead?: number | null } = {},
): void {
  const { width, height, dpr } = size;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = colors.bg;
  ctx.fillRect(0, 0, width, height);

  const beatSpan = view.to - view.from;
  const rows = view.maxMidi - view.minMidi + 1;
  const xOf = (beat: number) => ((beat - view.from) / beatSpan) * width;
  const rowH = height / rows;

  const bpb = opts.beatsPerBar ?? 0;
  if (bpb > 0 && Number.isFinite(bpb)) {
    // vạch ô nhịp (bỏ khi quá dày)
    const bars = beatSpan / bpb;
    if (bars <= width / 4) {
      ctx.fillStyle = colors.grid;
      const first = Math.ceil(view.from / bpb - 1e-9) * bpb;
      for (let b = first; b < view.to; b += bpb) {
        ctx.fillRect(Math.round(xOf(b)), 0, 1, height);
      }
    }
  }

  ctx.fillStyle = colors.note;
  const h = Math.max(1, Math.min(rowH, height / 6) - 0.5);
  for (const n of finiteNotes(notes)) {
    const end = n.startBeat + n.beats;
    if (end <= view.from || n.startBeat >= view.to) continue;
    const x0 = xOf(Math.max(view.from, n.startBeat));
    const x1 = xOf(Math.min(view.to, end));
    const row = view.maxMidi - n.midi;
    const y = row * rowH + (rowH - h) / 2;
    ctx.fillRect(x0, y, Math.max(1, x1 - x0 - 0.5), h);
  }

  const ph = opts.playhead;
  if (ph !== null && ph !== undefined && Number.isFinite(ph) && ph >= view.from && ph <= view.to) {
    ctx.fillStyle = colors.playhead;
    ctx.fillRect(Math.round(xOf(ph)) - 1, 0, 2, height);
  }
}

/** Canvas piano roll, DPR aware, tự vẽ lại khi đổi cỡ (ResizeObserver) hoặc theme. */
export function PianoRoll({
  notes,
  label,
  from,
  to,
  beatsPerBar = 0,
  playhead = null,
  height = DEFAULT_HEIGHT,
  className,
}: PianoRollProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const theme = useSettings((s) => s.theme);
  const [width, setWidth] = useState(0);

  // theo dõi bề rộng thật của canvas
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
    const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
    const w = Math.round(width * dpr);
    const h = Math.round(height * dpr);
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
    const ctx = get2d(canvas);
    if (!ctx) return;
    const view = pianoRollView(notes, from, to);
    const colors = pianoRollColors(canvas);
    drawPianoRoll(ctx, { width, height, dpr }, notes, view, colors, { beatsPerBar, playhead });
  }, [notes, from, to, beatsPerBar, playhead, height, width, theme]);

  return (
    <canvas
      ref={canvasRef}
      className={['midi-roll', className].filter(Boolean).join(' ')}
      style={{ height }}
      role="img"
      aria-label={label}
    />
  );
}

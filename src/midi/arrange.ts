import type { Melody, MelodyEvent, MelodySection } from '../core/melody';
import { isValidTimeSig } from '../core/parser';
import type { TimeSig } from '../core/types';
import { DEFAULT_SECTION_NAME, DEFAULT_TIME_SIG } from '../core/types';
import type { ArrangeOptions, MonoNote } from './types';

/**
 * Chia melody đơn âm thành dòng và section (spec §6b A bước 5) → `Melody` cho optimizer /
 * melodyToHarm. Thuần TS.
 *
 * - Bắt đầu từ ô nhịp chứa nốt đầu (rest đầu bài tính từ đầu ô nhịp đó).
 * - Khoảng trống ≥ grid (grid 0: mọi khoảng trống dương) thành rest; khoảng trống nhỏ hơn grid
 *   (đầu vào chưa quantize) được cộng vào nốt trước để vị trí các nốt sau không lệch.
 * - Rest nằm cuối dòng trước; dòng mới luôn bắt đầu bằng nốt (trừ dòng đầu).
 * - Xuống dòng: rest ≥ breakRestBeats, hoặc nốt bắt đầu tại / sau mốc ngắt kế tiếp — mốc là bội số
 *   barsPerLine ô nhịp tính từ ô nhịp đầu, cộng các mốc section. Dòng bắt đầu trong nửa ô nhịp
 *   trước một mốc (nốt đón / anacrusis) thì "nuốt" mốc đó: không bị ngắt ngay sau nốt đón, và
 *   thuộc section bắt đầu ở mốc đó. Dòng đầu tính từ nốt đầu (không phải đầu ô nhịp), nên nốt đón
 *   đầu bài cũng theo luật này; nốt đầu nằm ở nửa sau ô nhịp (nốt đón) thì lưới dòng / section
 *   tính từ ô nhịp đủ đầu tiên (dòng 1 = nốt đón + barsPerLine ô nhịp).
 * - Section: marker (marker ở beat b mở section tên = chữ marker từ dòng đầu tiên bắt đầu ≥ b,
 *   nới nửa ô nhịp cho nốt đón; dòng trước marker đầu → "Main"); không có marker thì mỗi
 *   barsPerSection ô nhịp một section "Phần N".
 * - Không cắt nốt: nốt dài vượt mốc vẫn nằm trọn ở dòng của nó.
 */

export const DEFAULT_ARRANGE: ArrangeOptions = {
  breakRestBeats: 1,
  barsPerLine: 2,
  barsPerSection: 8,
};

/** Tiền tố tên section tự sinh khi file không có marker ("Phần 1", "Phần 2"…). */
export const AUTO_SECTION_PREFIX = 'Phần';

export interface ArrangeContext {
  title: string;
  artist?: string;
  bpm: number;
  timeSig: TimeSig;
  /** Marker theo beat (markerBeats). */
  markers: ReadonlyArray<{ beat: number; text: string }>;
  /** Lưới quantize đã dùng khi trích melody (beat); 0 = tắt. */
  grid: number;
}

const EPS = 1e-6;
/** Mẫu số thử khi snap: mọi d ≤ 64 (như formatBeats của core, gồm 5, 7, 10…) rồi 96, 128, 192. */
const SNAP_DENOMS: readonly number[] = [
  ...Array.from({ length: 64 }, (_, i) => i + 1),
  96,
  128,
  192,
];

/**
 * Bỏ sai số float: x rất gần k/d (d nhỏ) → đúng k/d (serializer ghi `1/3`, `0.5`… gọn); còn lại
 * làm tròn 9 chữ số thập phân (vd. 1 − 0.9 → 0.1 khi tắt quantize).
 */
export function snapBeats(x: number): number {
  for (const d of SNAP_DENOMS) {
    const k = Math.round(x * d);
    if (Math.abs(x - k / d) < 1e-7) return k / d;
  }
  return Math.round(x * 1e9) / 1e9;
}

/** "my_song-final.mid" → "my song final". */
export function titleFromFileName(name: string): string {
  const base = name.trim().split(/[/\\]/).pop() ?? '';
  return base
    .replace(/\.[^.\s]{1,5}$/, '')
    .replace(/[_-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function positive(v: number, fallback: number): number {
  return v > 0 ? v : fallback;
}

interface WorkLine {
  /** Beat của nốt đầu dòng (xếp section theo đây). */
  start: number;
  events: MelodyEvent[];
  hasNote: boolean;
}

export function arrangeMelody(
  notes: readonly MonoNote[],
  ctx: ArrangeContext,
  opts: ArrangeOptions = DEFAULT_ARRANGE,
): Melody {
  const timeSig = isValidTimeSig(ctx.timeSig)
    ? { num: ctx.timeSig.num, den: ctx.timeSig.den }
    : { ...DEFAULT_TIME_SIG };
  const melody: Melody = {
    title: ctx.title,
    ...(ctx.artist !== undefined && ctx.artist.trim() !== '' ? { artist: ctx.artist } : {}),
    bpm: ctx.bpm,
    timeSig,
    sections: [],
  };

  const sorted = notes
    .filter(
      (n) =>
        Number.isFinite(n.startBeat) &&
        Number.isFinite(n.beats) &&
        n.beats > 0 &&
        Number.isFinite(n.midi),
    )
    .map((n, i) => ({ n, i }))
    .sort((a, b) => a.n.startBeat - b.n.startBeat || a.i - b.i)
    .map((x) => x.n);
  if (sorted.length === 0) return melody;

  const bpb = (timeSig.num * 4) / timeSig.den;
  const lineLen = positive(opts.barsPerLine, DEFAULT_ARRANGE.barsPerLine) * bpb;
  const secLen = positive(opts.barsPerSection, DEFAULT_ARRANGE.barsPerSection) * bpb;
  const breakRest = positive(opts.breakRestBeats, DEFAULT_ARRANGE.breakRestBeats);
  const grid = ctx.grid > 0 ? ctx.grid : 0;
  // nửa ô nhịp: dòng bắt đầu trong khoảng này trước một mốc thì thuộc về mốc đó (nốt đón)
  const pickup = bpb / 2;

  const first = snapBeats(sorted[0].startBeat);
  /** Đầu ô nhịp chứa nốt đầu (rest đầu bài tính từ đây). */
  const origin = Math.floor(first / bpb + 1e-9) * bpb;
  /** Gốc lưới dòng / section: nốt đầu ở nửa sau ô nhịp = nốt đón → ô nhịp đủ đầu tiên. */
  const gridOrigin = first >= origin + pickup - EPS ? origin + bpb : origin;

  const markers = ctx.markers
    .filter((m) => Number.isFinite(m.beat) && m.text.trim() !== '')
    .map((m, i) => ({ beat: m.beat, text: m.text.replace(/\s+/g, ' ').trim(), i }))
    .sort((a, b) => a.beat - b.beat || a.i - b.i);

  /** Mốc đầu tiên của lưới `step` (tính từ gridOrigin) lớn hơn hẳn `x`. */
  const nextOnGrid = (x: number, step: number): number =>
    gridOrigin + (Math.floor((x - gridOrigin) / step + 1e-9) + 1) * step;

  /** Mốc ngắt kế tiếp của dòng bắt đầu tại `start`. */
  const nextBreak = (start: number): number => {
    const reach = start + pickup + EPS;
    let p = nextOnGrid(reach, lineLen);
    if (markers.length > 0) {
      const m = markers.find((mk) => mk.beat > reach);
      if (m && m.beat < p) p = m.beat;
    } else {
      p = Math.min(p, nextOnGrid(reach, secLen));
    }
    return p;
  };

  // ── chia dòng ──
  const lines: WorkLine[] = [];
  // dòng đầu neo ở nốt đầu (nốt đón đầu bài cũng được nới nửa ô nhịp như mọi dòng)
  let cur: WorkLine = { start: first, events: [], hasNote: false };
  let breakAt = nextBreak(first);
  let cursor = origin;

  for (const n of sorted) {
    let s = snapBeats(n.startBeat);
    const e = snapBeats(n.startBeat + n.beats);
    if (s < cursor) s = cursor; // đầu vào chồng nhau (không nên xảy ra) → nốt sau bắt đầu muộn
    if (e - s <= EPS) continue;

    const gap = snapBeats(s - cursor);
    let restBreak = false;
    if (gap > EPS) {
      const last = cur.events[cur.events.length - 1] as MelodyEvent | undefined;
      if (grid > 0 && gap < grid - EPS && last !== undefined && last.midi !== null) {
        last.beats = snapBeats(last.beats + gap);
      } else {
        cur.events.push({ midi: null, beats: gap });
        if (cur.hasNote && gap >= breakRest - EPS) restBreak = true;
      }
    }

    if (cur.hasNote && (restBreak || s >= breakAt - EPS)) {
      lines.push(cur);
      cur = { start: s, events: [], hasNote: false };
      breakAt = nextBreak(s);
    }

    cur.events.push({ midi: n.midi, beats: snapBeats(e - s) });
    cur.hasNote = true;
    cursor = e;
  }
  if (cur.hasNote) lines.push(cur);

  // ── chia section ──
  const sectionKeyOf = (start: number): { key: number; name: string | null } => {
    const reach = start + pickup + EPS;
    if (markers.length > 0) {
      let idx = -1;
      for (let i = 0; i < markers.length; i++) if (markers[i].beat <= reach) idx = i;
      return { key: idx, name: idx >= 0 ? markers[idx].text : DEFAULT_SECTION_NAME };
    }
    return { key: Math.floor((reach - gridOrigin) / secLen + 1e-9), name: null };
  };

  const sections: MelodySection[] = [];
  let lastKey: number | null = null;
  for (const l of lines) {
    const { key, name } = sectionKeyOf(l.start);
    if (key !== lastKey) {
      sections.push({ name: name ?? `${AUTO_SECTION_PREFIX} ${sections.length + 1}`, lines: [] });
      lastKey = key;
    }
    sections[sections.length - 1].lines.push({ events: l.events });
  }
  melody.sections = sections;
  return melody;
}

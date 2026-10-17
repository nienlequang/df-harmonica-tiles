import type { ExtractOptions, MonoNote, OverlapPolicy } from './types';

/**
 * Trích melody đơn âm từ danh sách nốt (spec §6b A bước 3) — dùng chung cho MIDI file import
 * và "Thu melody" (recorder). Thuần TS, không DOM.
 */

export const DEFAULT_EXTRACT: ExtractOptions = { overlap: 'highest', grid: 0.25, minBeats: 1 / 32 };

/**
 * Gộp tie (nốt cùng cao độ nối liền): 'never' (mặc định) — không gộp: gộp sẽ nuốt mất các nốt lặp
 * (C C G G…) vốn rất hay nằm sát nhau trong file MIDI xuất từ bản nhạc (tie của MusicXML được nối
 * riêng khi đọc file); 'always': luôn gộp.
 */
export type TieMerge = 'always' | 'never';

export interface ExtractMelodyOptions extends ExtractOptions {
  mergeTies: TieMerge;
  /**
   * Đuôi nốt trước còn vang sau onset mới không quá ngần này (beat) thì coi là legato (nốt kế
   * của giai điệu), không phải "chồng". null = tự tính: max(1/8, grid/2).
   */
  legatoBeats: number | null;
}

export interface ExtractInputNote {
  startBeat: number;
  beats: number;
  midi: number;
}

/** Các onset lệch nhau trong ngần này (beat) coi là cùng lúc (hợp âm). */
export const ONSET_EPS_BEATS = 1 / 64;
/** Khoảng hở tối đa (beat) vẫn coi là "nối liền" khi gộp tie. */
const TIE_GAP_EPS_BEATS = 1 / 64;
const MIN_LEGATO_BEATS = 1 / 8;

export function defaultLegatoBeats(grid: number): number {
  return Math.max(MIN_LEGATO_BEATS, grid > 0 ? grid / 2 : 0);
}

/** Nốt đang xử lý — giữ nguyên `beats` gốc khi không bị cắt/gộp (không cộng trừ float thừa). */
interface Work {
  start: number;
  beats: number;
  midi: number;
  /** Độ dài gốc trước khi bị cắt (policy 'longest' so nốt dài nhất theo độ dài này). */
  full: number;
}

const endOf = (n: Work): number => n.start + n.beats;

/** Chọn 1 nốt trong nhóm onset cùng lúc theo policy (hòa: dài hơn / cao hơn, rồi thứ tự vào). */
function pickFromGroup(group: readonly Work[], policy: OverlapPolicy): Work {
  let best = group[0];
  for (const n of group) {
    let better: boolean;
    if (policy === 'highest') {
      better = n.midi > best.midi || (n.midi === best.midi && n.beats > best.beats);
    } else if (policy === 'lowest') {
      better = n.midi < best.midi || (n.midi === best.midi && n.beats > best.beats);
    } else {
      better = n.beats > best.beats || (n.beats === best.beats && n.midi > best.midi);
    }
    if (better) best = n;
  }
  return best;
}

/** Bước 2 + 3: giải quyết chồng nốt ("skyline") và cắt độ dài tới nốt kế. */
function resolveOverlaps(src: readonly Work[], policy: OverlapPolicy, legato: number): Work[] {
  const chosen: Work[] = [];
  let i = 0;
  while (i < src.length) {
    const t0 = src[i].start;
    let j = i + 1;
    while (j < src.length && src[j].start - t0 <= ONSET_EPS_BEATS) j++;
    const group = src.slice(i, j);
    i = j;

    const cand: Work = { ...pickFromGroup(group, policy) };

    const prev = chosen.length > 0 ? chosen[chosen.length - 1] : undefined;
    if (prev && endOf(prev) - cand.start > legato) {
      // Onset mới khi nốt trước còn vang: 'longest' so độ dài gốc (hòa → cao hơn), còn lại so cao độ
      let keep: boolean;
      if (policy === 'longest') {
        keep = cand.full > prev.full || (cand.full === prev.full && cand.midi > prev.midi);
      } else {
        keep = policy === 'highest' ? cand.midi > prev.midi : cand.midi < prev.midi;
      }
      if (!keep) continue;
    }
    if (prev && endOf(prev) > cand.start) prev.beats = cand.start - prev.start;
    chosen.push(cand);
  }
  return chosen;
}

/** Bước 4: gộp tie — nốt cùng cao độ nối liền thành một nốt. */
function mergeTies(notes: readonly Work[]): Work[] {
  const out: Work[] = [];
  for (const n of notes) {
    const last = out.length > 0 ? out[out.length - 1] : undefined;
    if (last && last.midi === n.midi && n.start - endOf(last) <= TIE_GAP_EPS_BEATS) {
      last.beats = Math.max(last.beats, endOf(n) - last.start);
    } else {
      out.push({ ...n });
    }
  }
  return out;
}

/**
 * Bước 6: quantize start/end về grid (làm tròn gần nhất). Khoảng trống < grid được lấp (nốt trước
 * kéo tới nốt kế) — chỉ khoảng trống >= grid thành rest (spec §6b A). Đầu vào không chồng nhau nên
 * sau khi làm tròn vẫn không chồng. Nốt bị co về 0 ô thì kéo dài 1 ô nếu ô đó còn trống, không thì
 * bỏ (nốt sau thắng — vd. nốt hoa mỹ ngay trước nốt chính).
 */
function quantize(notes: readonly Work[], grid: number): Work[] {
  const idx = notes.map((n, k) => {
    const next = k + 1 < notes.length ? notes[k + 1] : undefined;
    const end = next && next.start - endOf(n) < grid ? next.start : endOf(n);
    return { s: Math.round(n.start / grid + 1e-9), e: Math.round(end / grid + 1e-9) };
  });
  const out: Work[] = [];
  let prevE = -Infinity;
  for (let k = 0; k < notes.length; k++) {
    const s = Math.max(idx[k].s, prevE);
    let e = idx[k].e;
    if (e <= s) {
      const nextS = k + 1 < notes.length ? idx[k + 1].s : Infinity;
      e = Math.min(s + 1, nextS);
      if (e <= s) continue;
    }
    out.push({ ...notes[k], start: s * grid, beats: (e - s) * grid });
    prevE = e;
  }
  return out;
}

/** Bước 5: bỏ nốt < minBeats. */
function dropShort(notes: readonly Work[], minBeats: number): Work[] {
  return notes.filter((n) => n.beats > 0 && n.beats >= minBeats - 1e-9);
}

/**
 * Trích melody đơn âm: sắp xếp → giải chồng nốt theo policy → cắt độ dài tới nốt kế → gộp tie →
 * bỏ nốt < minBeats → quantize. Kết quả sắp theo thời gian, không chồng; khoảng trống = rest.
 */
export function extractMelody(
  notes: ReadonlyArray<ExtractInputNote>,
  opts: Partial<ExtractMelodyOptions> = {},
): MonoNote[] {
  const overlap = opts.overlap ?? DEFAULT_EXTRACT.overlap;
  const rawGrid = opts.grid ?? DEFAULT_EXTRACT.grid;
  const grid = Number.isFinite(rawGrid) && rawGrid > 0 ? rawGrid : 0;
  const rawMin = opts.minBeats ?? DEFAULT_EXTRACT.minBeats;
  const minBeats = Number.isFinite(rawMin) && rawMin > 0 ? rawMin : 0;
  const rawLegato = opts.legatoBeats;
  const legato =
    typeof rawLegato === 'number' && Number.isFinite(rawLegato) && rawLegato >= 0
      ? rawLegato
      : defaultLegatoBeats(grid);
  const tieMode = opts.mergeTies ?? 'never';

  // 1) lọc nốt hỏng, sắp theo onset
  const src: Work[] = notes
    .filter(
      (n) =>
        Number.isFinite(n.startBeat) &&
        Number.isFinite(n.beats) &&
        n.beats > 0 &&
        Number.isFinite(n.midi),
    )
    .map((n): Work => ({ start: n.startBeat, beats: n.beats, midi: n.midi, full: n.beats }))
    .sort((a, b) => a.start - b.start);

  // 2) + 3)
  let mono = resolveOverlaps(src, overlap, legato);

  // 4)
  if (tieMode === 'always') mono = mergeTies(mono);

  // 5)
  mono = dropShort(mono, minBeats);

  // 6)
  if (grid > 0) mono = quantize(mono, grid);

  return mono.map((n): MonoNote => ({ startBeat: n.start, beats: n.beats, midi: n.midi }));
}

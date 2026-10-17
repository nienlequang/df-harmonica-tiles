import { formatBeats, formatDecimal } from './beats';
import { keyIndex } from './keys';
import type { MobileCue, MobileSemitoneMode } from './mobile';
import { buildMobilePlan } from './mobile';
import { canonicalSong } from './serializer';
import { buildTimeline } from './timeline';
import type { Note, Song } from './types';

/**
 * Donate text kiểu Mobile (chỉ xuất, không đọc lại): cùng directive + section như serializeHarm,
 * nhưng token nốt = VỊ TRÍ NÚT 1..8 (Z = 1 … M = 7, `,` = 8 — quãng do token chế độ mang), và chèn
 * token chạm chế độ `[<tên>]` đúng chỗ cần chạm (theo buildMobilePlan):
 * `[Cúi Xuống] 6 6 [Ngẩng Tự Nhiên] 1 2`. Nửa Cung: `[<tên scroll>]` mỗi lần chạm (bật hoặc tắt).
 */

export interface MobileTextLabels {
  /** Cúi Xuống (chế độ −1). */
  left: string;
  /** Ngẩng Lên (chế độ +1). */
  right: string;
  /** Ngẩng Tự Nhiên (chế độ 0). */
  natural: string;
  /** Nửa Cung. */
  scroll: string;
}

export interface MobileTextOptions {
  durations: boolean;
  sectionHeaders: boolean;
  semitone: MobileSemitoneMode;
  /** Tên gọi nút (lấy từ useModifierLabels / currentModifierLabels ở UI). */
  labels: MobileTextLabels;
  /** Dòng chú thích đầu tiên `// <legend>` (bỏ qua nếu rỗng). */
  legend?: string;
}

/** Xuống dòng → dấu cách, bỏ khoảng trắng hai đầu (văn bản một dòng). */
function oneLine(s: string): string {
  return s.replace(/\r\n?|\n/g, ' ').trim();
}

/** Vị trí nút 1..8 theo thứ tự Z X C V B N M ,. */
function button(n: Note): string {
  return String(keyIndex(n.key) + 1);
}

export function serializeMobileText(input: Song, opts: MobileTextOptions): string {
  const song = canonicalSong(input);
  const plan = buildMobilePlan(buildTimeline(song), { semitone: opts.semitone });

  const label = (c: MobileCue): string => {
    if (c.kind === 'semitone') return opts.labels.scroll;
    return c.mode === -1
      ? opts.labels.left
      : c.mode === 1
        ? opts.labels.right
        : opts.labels.natural;
  };
  // cue theo index nốt (thứ tự đã đúng: octave trước, semitone sau)
  const cuesAt = new Map<number, string[]>();
  for (const c of plan.cues) {
    const list = cuesAt.get(c.noteIndex) ?? [];
    list.push(`[${oneLine(label(c))}]`);
    cuesAt.set(c.noteIndex, list);
  }

  const dur = (beats: number): string =>
    !opts.durations || beats === 1 ? '' : `*${formatBeats(beats)}`;

  const out: string[] = [];
  const legend = oneLine(opts.legend ?? '');
  if (legend !== '') out.push(`// ${legend}`);
  if (song.title !== '') out.push(`@title ${song.title}`);
  if (song.artist !== undefined) out.push(`@artist ${song.artist}`);
  out.push(`@bpm ${formatDecimal(song.bpm)}`);
  out.push(`@time ${song.timeSig.num}/${song.timeSig.den}`);
  out.push(`@scroll ${song.scrollDir === -1 ? '-1' : '+1'}`);
  // không có header: chỉ một dòng trống giữa directive và dòng nốt đầu tiên (như serializeHarm)
  let needBlank = true;

  let ni = 0; // index nốt trong timeline (cùng thứ tự section → dòng → đơn vị → nốt luyến)
  for (const section of song.sections) {
    if (opts.sectionHeaders) {
      out.push('');
      out.push(`# ${section.name}`);
      needBlank = false;
    }
    for (const line of section.lines) {
      const toks: string[] = [];
      for (const u of line.units) {
        if (u.kind === 'rest') {
          toks.push(`_${dur(u.beats)}`);
          continue;
        }
        const notes = u.kind === 'note' ? [u] : u.notes;
        const first = notes[0];
        if (!first) continue;
        // chạm trước nốt đầu: token riêng; chạm giữa luyến: dính vào nốt đó (`1-[Cúi Xuống]6`)
        toks.push(...(cuesAt.get(ni) ?? []));
        const body = notes
          .map((n, k) => (k === 0 ? '' : (cuesAt.get(ni + k) ?? []).join('')) + button(n))
          .join('-');
        ni += notes.length;
        // luyến: ghi tổng độ dài (các nốt đã chia đều sau canonicalSong)
        toks.push(`${body}${dur(first.beats * notes.length)}`);
      }
      if (toks.length === 0) continue;
      if (needBlank) {
        out.push('');
        needBlank = false;
      }
      out.push(toks.join(' '));
    }
  }

  return `${out.join('\n')}\n`;
}

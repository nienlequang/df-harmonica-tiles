import { DEFAULT_BASE_OCTAVE, midiName, noteMidi, playableRange } from './keys';
import type { Melody, MelodyEvent } from './melody';
import type { Placement } from './optimizer';
import { parseHarm } from './parser';
import { serializeHarm } from './serializer';
import type { Line, Note, ScrollDir, Section, Song, Unit } from './types';

/**
 * Melody (cao độ tuyệt đối) + Placement (lựa chọn phím của optimizer) → Song / văn bản `.harm`,
 * và chiều ngược Song → Melody (để "tối ưu lại bài hiện tại").
 */

export interface MelodyToSongOptions {
  /** Gán vào song.id (mặc định ''). */
  id?: string;
  /** `@scroll` của bài — phải trùng chiều đã dùng khi tối ưu (mặc định +1). */
  scrollDir?: ScrollDir;
}

export interface MelodyToHarmOptions extends MelodyToSongOptions {
  /** Câu cảnh báo cho dòng có n nốt bị gập quãng (mặc định tiếng Việt). */
  warningText?: (n: number) => string;
  /** Chỉ để ghi tầm trong câu cảnh báo mặc định (mặc định 4 → "C3–C6"). */
  baseOctave?: number;
}

export interface SongToMelodyOptions {
  baseOctave: number;
  scrollDir: ScrollDir;
}

/** Kết quả dựng: song + cảnh báo theo từng dòng model (flatten theo thứ tự section). */
interface Built {
  song: Song;
  /** Song song với các dòng của song: số nốt bị gập quãng. */
  lineFolded: number[];
  /** Song song với các dòng của song: cảnh báo riêng của event (không trùng lặp). */
  lineWarnings: string[][];
}

type Item = { kind: 'rest'; beats: number } | { kind: 'note'; note: Note; slurId?: number };

function countEvents(melody: Melody): number {
  let n = 0;
  for (const s of melody.sections) for (const l of s.lines) n += l.events.length;
  return n;
}

function checkBeats(ev: MelodyEvent, index: number): void {
  if (!(Number.isFinite(ev.beats) && ev.beats > 0)) {
    throw new RangeError(`melodyToSong: event ${index} có beats không hợp lệ (${ev.beats})`);
  }
}

/** Text một dòng (comment / tên): xuống dòng → dấu cách, trim. */
function oneLine(s: string): string {
  return s.replace(/\r?\n|\r/g, ' ').trim();
}

/** Các nốt liên tiếp cùng slurId (≥ 2 nốt, cùng beats) → Slur; còn lại → nốt rời / rest. */
function groupUnits(items: readonly Item[]): Unit[] {
  const units: Unit[] = [];
  let k = 0;
  while (k < items.length) {
    const it = items[k];
    if (it.kind === 'rest') {
      units.push({ kind: 'rest', beats: it.beats });
      k++;
      continue;
    }
    if (it.slurId === undefined) {
      units.push(it.note);
      k++;
      continue;
    }
    const group: Note[] = [it.note];
    let end = k + 1;
    for (; end < items.length; end++) {
      const nx = items[end];
      if (nx.kind !== 'note' || nx.slurId !== it.slurId) break;
      group.push(nx.note);
    }
    if (group.length >= 2 && group.every((n) => n.beats === it.note.beats)) {
      units.push({ kind: 'slur', notes: group });
    } else {
      units.push(...group);
    }
    k = end;
  }
  return units;
}

function build(melody: Melody, placement: Placement, opts: MelodyToSongOptions): Built {
  const total = countEvents(melody);
  if (placement.choices.length !== total) {
    throw new RangeError(
      `melodyToSong: placement có ${placement.choices.length} lựa chọn nhưng melody có ${total} event`,
    );
  }
  const lineFolded: number[] = [];
  const lineWarnings: string[][] = [];
  let gi = 0;

  const sections: Section[] = melody.sections.map((sec) => {
    const lines: Line[] = [];
    for (const ml of sec.lines) {
      const items: Item[] = [];
      let folded = 0;
      const warnings: string[] = [];
      for (const ev of ml.events) {
        const i = gi++;
        checkBeats(ev, i);
        const w = ev.warning !== undefined ? oneLine(ev.warning) : '';
        if (w !== '' && !warnings.includes(w)) warnings.push(w);
        if (ev.midi === null) {
          items.push({ kind: 'rest', beats: ev.beats });
          continue;
        }
        const c = placement.choices[i];
        if (!c) throw new RangeError(`melodyToSong: nốt ở event ${i} không có lựa chọn phím`);
        if (placement.folded[i] === true) folded++;
        const note: Note = {
          kind: 'note',
          key: c.key,
          octave: c.octave,
          sharp: c.sharp,
          beats: ev.beats,
        };
        items.push(
          ev.slurId !== undefined
            ? { kind: 'note', note, slurId: ev.slurId }
            : { kind: 'note', note },
        );
      }
      // dòng không có đơn vị nào không tồn tại trong model (D-013)
      if (items.length === 0) continue;
      lines.push({ units: groupUnits(items) });
      lineFolded.push(folded);
      lineWarnings.push(warnings);
    }
    return { name: sec.name, lines };
  });

  const artist = melody.artist !== undefined ? oneLine(melody.artist) : '';
  const song: Song = {
    id: opts.id ?? '',
    title: melody.title,
    ...(artist !== '' ? { artist } : {}),
    bpm: melody.bpm,
    timeSig: { num: melody.timeSig.num, den: melody.timeSig.den },
    scrollDir: opts.scrollDir ?? 1,
    sections,
  };
  return { song, lineFolded, lineWarnings };
}

/**
 * Melody + Placement → Song. Event theo thứ tự dùng `placement.choices`; các nốt liên tiếp cùng
 * slurId và cùng beats → Slur (không thì nốt rời); rest → Rest. Section / dòng giữ nguyên (dòng
 * không có event bị bỏ).
 * Throw RangeError khi placement không khớp melody hoặc beats ≤ 0.
 */
export function melodyToSong(
  melody: Melody,
  placement: Placement,
  opts: MelodyToSongOptions = {},
): Song {
  return build(melody, placement, opts).song;
}

function defaultWarningText(baseOctave: number): (n: number) => string {
  const { min, max } = playableRange(baseOctave);
  return (n) => `Có ${n} nốt bị gập quãng cho vừa tầm ${midiName(min)}–${midiName(max)}`;
}

/**
 * Melody + Placement → văn bản `.harm` (= serializeHarm(melodyToSong(...))), chèn comment
 * `//! cảnh báo` ngay trên mỗi dòng có nốt bị gập quãng hoặc có event mang `warning`. Parse lại
 * không lỗi; mỗi comment thành diagnostic `annotation` tại dòng đó (D-018).
 */
export function melodyToHarm(
  melody: Melody,
  placement: Placement,
  opts: MelodyToHarmOptions = {},
): string {
  const { song, lineFolded, lineWarnings } = build(melody, placement, opts);
  const text = serializeHarm(song);
  const warningText =
    opts.warningText ?? defaultWarningText(opts.baseOctave ?? DEFAULT_BASE_OCTAVE);

  const notes: string[][] = lineFolded.map((n, i) => {
    const list: string[] = [];
    if (n > 0) {
      const w = oneLine(warningText(n));
      if (w !== '') list.push(w);
    }
    for (const w of lineWarnings[i] ?? []) if (!list.includes(w)) list.push(w);
    return list;
  });
  if (notes.every((l) => l.length === 0)) return text;

  // dòng nguồn của từng dòng model lấy từ parser (không đoán định dạng serializer)
  const { lineSpans } = parseHarm(text);
  const before = new Map<number, string[]>();
  notes.forEach((list, i) => {
    const span = lineSpans[i];
    if (list.length === 0 || !span) return;
    before.set(
      span.line - 1,
      list.map((w) => `//! ${w}`),
    );
  });
  const out: string[] = [];
  text.split('\n').forEach((l, idx) => {
    const extra = before.get(idx);
    if (extra) out.push(...extra);
    out.push(l);
  });
  return out.join('\n');
}

/**
 * Song → Melody (để tối ưu lại bài hiện tại): midi của mỗi nốt qua noteMidi, rest = null, các nốt
 * của một luyến chung slurId.
 */
export function songToMelody(song: Song, opts: SongToMelodyOptions): Melody {
  const { baseOctave, scrollDir } = opts;
  const midiOf = (n: Note): number => noteMidi(n.key, n.octave, n.sharp, baseOctave, scrollDir);
  let slurId = 0;
  return {
    title: song.title,
    ...(song.artist !== undefined ? { artist: song.artist } : {}),
    bpm: song.bpm,
    timeSig: { num: song.timeSig.num, den: song.timeSig.den },
    sections: song.sections.map((s) => ({
      name: s.name,
      lines: s.lines.map((l) => {
        const events: MelodyEvent[] = [];
        for (const u of l.units) {
          if (u.kind === 'rest') events.push({ midi: null, beats: u.beats });
          else if (u.kind === 'note') events.push({ midi: midiOf(u), beats: u.beats });
          else if (u.notes.length === 1 && u.notes[0]) {
            events.push({ midi: midiOf(u.notes[0]), beats: u.notes[0].beats });
          } else if (u.notes.length > 1) {
            const id = slurId++;
            for (const n of u.notes) events.push({ midi: midiOf(n), beats: n.beats, slurId: id });
          }
        }
        return { events };
      }),
    })),
  };
}

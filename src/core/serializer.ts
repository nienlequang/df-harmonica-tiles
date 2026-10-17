import { formatBeats, formatDecimal } from './beats';
import { HOLD_LABELS } from './modifierLabels';
import { isValidTimeSig } from './parser';
import type { Line, Note, Octave, Section, SerializeOptions, Song, Unit } from './types';
import { DEFAULT_BPM, DEFAULT_SECTION_NAME, DEFAULT_TIME_SIG } from './types';

/** Trạng thái modifier của một đơn vị nốt (Rest không có). */
interface UnitState {
  octave: Octave;
  sharp: boolean;
}

/** Note → (octave, sharp); Slur → octave chung (khác nhau thì 0), sharp khi mọi nốt sharp. */
function unitState(u: Unit): UnitState | null {
  if (u.kind === 'rest') return null;
  if (u.kind === 'note') return { octave: u.octave, sharp: u.sharp };
  const first = u.notes[0];
  if (!first) return null;
  const octave = u.notes.every((n) => n.octave === first.octave) ? first.octave : 0;
  return { octave, sharp: u.notes.every((n) => n.sharp) };
}

const f64 = new Float64Array(1);
const u64 = new BigUint64Array(f64.buffer);

/** Số double kế tiếp (chỉ dùng cho số dương hữu hạn). */
function nextDouble(x: number, up: boolean): number {
  if (!(x > 0) || !Number.isFinite(x)) return x;
  f64[0] = x;
  const bits = u64[0] ?? 0n;
  u64[0] = up ? bits + 1n : bits - 1n;
  return f64[0] ?? x;
}

/**
 * Tổng độ dài luyến n nốt × b beat để ghi ra, chỉnh vài ulp nếu cần để parser chia lại
 * (`total / n`) ra đúng `b` (round-trip chính xác với mọi số double).
 */
function slurTotal(n: number, b: number): number {
  const t = b * n;
  if (t / n === b) return t;
  let lo = t;
  let hi = t;
  for (let i = 0; i < 16; i++) {
    hi = nextDouble(hi, true);
    if (hi / n === b) return hi;
    lo = nextDouble(lo, false);
    if (lo / n === b) return lo;
  }
  return t;
}

/**
 * Văn bản một dòng như parser đọc lại: xuống dòng (như `LINE_BREAK_RE` của parser: CRLF, LF và cả
 * CR lẻ) → dấu cách, bỏ khoảng trắng hai đầu. Văn bản ghi ra vì thế không bao giờ có CR.
 */
function oneLine(s: string): string {
  return s.replace(/\r\n?|\n/g, ' ').trim();
}

function canonicalNote(n: Note, beats: number): Note {
  return { kind: 'note', key: n.key, octave: n.octave, sharp: n.sharp, beats };
}

/**
 * Rest/nốt giữ nguyên; luyến rỗng → bỏ; luyến 1 nốt → nốt (parser không sinh luyến 1 nốt);
 * luyến có nốt dài khác nhau → giữ tổng, chia đều (D-014: `.harm` chỉ ghi được tổng); độ dài
 * mỗi nốt = tổng ghi ra / n, đúng như parser chia lại.
 */
function canonicalUnit(u: Unit): Unit | null {
  if (u.kind === 'rest') return { kind: 'rest', beats: u.beats };
  if (u.kind === 'note') return canonicalNote(u, u.beats);
  const first = u.notes[0];
  if (!first) return null;
  const n = u.notes.length;
  if (n === 1) return canonicalNote(first, first.beats);
  const equal = u.notes.every((x) => x.beats === first.beats);
  const each = equal ? first.beats : u.notes.reduce((sum, x) => sum + x.beats, 0) / n;
  const beats = slurTotal(n, each) / n;
  return { kind: 'slur', notes: u.notes.map((x) => canonicalNote(x, beats)) };
}

function canonicalLine(line: Line): Line | null {
  const units: Unit[] = [];
  for (const u of line.units) {
    const c = canonicalUnit(u);
    if (c) units.push(c);
  }
  // dòng không có đơn vị nào không vào model (D-013)
  if (units.length === 0) return null;
  return { units };
}

function canonicalSection(section: Section): Section {
  const lines: Line[] = [];
  for (const l of section.lines) {
    const c = canonicalLine(l);
    if (c) lines.push(c);
  }
  return { name: oneLine(section.name) || DEFAULT_SECTION_NAME, lines };
}

/**
 * Dạng chuẩn của một model: model gần nhất mà văn bản `.harm` biểu diễn được. Với mọi `Song`
 * đúng kiểu (beats > 0 hữu hạn), `parseHarm(serializeHarm(song)).song` deep-equal
 * `canonicalSong(song)` (cùng id) và không có diagnostic lỗi/cảnh báo; với model do parser đọc ra,
 * `canonicalSong` không đổi gì (round-trip spec mục 3). Không đụng vào `song` đầu vào.
 *
 * Chuẩn hóa: text một dòng + trim (title, artist, tên section); artist rỗng → bỏ key; tên
 * section rỗng → "Main"; luyến (xem `canonicalUnit`); dòng không có đơn vị → bỏ; key thừa của
 * dòng (vd. `lyric` của dữ liệu cũ) → bỏ; `@time` ngoài miền parser chấp nhận → 4/4; bpm không
 * dương → 90; scrollDir ≠ -1 → 1.
 * "Một dòng": CRLF, LF và CR lẻ (`LINE_BREAK_RE`, parser cũng tách dòng ở đó) thành dấu cách — văn
 * bản ghi ra không có CR, nên chuẩn hóa EOL của Editor (D-100) không tách lại dòng nào.
 */
export function canonicalSong(song: Song): Song {
  const title = oneLine(song.title ?? '');
  const artist = oneLine(song.artist ?? '');
  const bpm = Number.isFinite(song.bpm) && song.bpm > 0 ? song.bpm : DEFAULT_BPM;
  const ts = song.timeSig;
  const timeSig = ts && isValidTimeSig(ts) ? { num: ts.num, den: ts.den } : { ...DEFAULT_TIME_SIG };
  return {
    id: song.id,
    title,
    ...(artist !== '' ? { artist } : {}),
    bpm,
    timeSig,
    scrollDir: song.scrollDir === -1 ? -1 : 1,
    sections: song.sections.map(canonicalSection),
  };
}

function prefixOf(n: Note, st: UnitState): string {
  let p = '';
  if (n.octave !== st.octave) p += n.octave === -1 ? 'L' : n.octave === 1 ? 'R' : '';
  if (n.sharp && !st.sharp) p += 'S';
  return p === '' ? '' : `${p}:`;
}

function octaveButton(o: Octave): 'left' | 'right' {
  return o === -1 ? 'left' : 'right';
}

/**
 * Model → văn bản `.harm`. Luôn dùng hold/release với nhãn tiếng Việt đầy đủ, gom các nốt
 * liên tiếp cùng modifier thành một cặp giữ/thả (chiều quãng tám và chiều scroll theo dõi
 * riêng, xuyên dòng và section). Rest luôn nằm ngoài mọi hold (D-020).
 * Ghi dạng chuẩn `canonicalSong(song)`: `parseHarm(serializeHarm(song)).song` deep-equal
 * `canonicalSong(song)` (= `song` với model do parser đọc ra), trừ id.
 */
export function serializeHarm(input: Song, opts: SerializeOptions = {}): string {
  const song = canonicalSong(input);
  const withDur = opts.durations !== false;
  const withHeaders = opts.sectionHeaders !== false;
  const withDirectives = opts.directives !== false;

  const dur = (beats: number): string => (!withDur || beats === 1 ? '' : `*${formatBeats(beats)}`);

  const out: string[] = [];
  if (withDirectives) {
    if (song.title !== '') out.push(`@title ${song.title}`);
    if (song.artist !== undefined) out.push(`@artist ${song.artist}`);
    out.push(`@bpm ${formatDecimal(song.bpm)}`);
    out.push(`@time ${song.timeSig.num}/${song.timeSig.den}`);
    out.push(`@scroll ${song.scrollDir === -1 ? '-1' : '+1'}`);
  }
  // không có header: chỉ một dòng trống giữa directive và dòng nốt đầu tiên
  let needBlank = out.length > 0;

  // trạng thái của mọi đơn vị theo thứ tự cả bài, để biết "đơn vị kế tiếp"
  const states: (UnitState | null)[] = [];
  for (const section of song.sections) {
    for (const line of section.lines) {
      for (const u of line.units) states.push(unitState(u));
    }
  }

  let gi = 0;
  let heldOct: Octave = 0;
  let heldSharp = false;

  for (const section of song.sections) {
    if (withHeaders) {
      if (out.length > 0) out.push('');
      out.push(`# ${section.name}`);
      needBlank = false;
    }
    for (const line of section.lines) {
      const toks: string[] = [];
      for (const u of line.units) {
        const st = states[gi] ?? null;
        const next = states[gi + 1] ?? null;
        gi++;
        if (u.kind === 'rest') {
          // phòng hờ: rest không bao giờ nằm trong hold
          if (heldSharp) toks.push(HOLD_LABELS.scroll.release);
          if (heldOct !== 0) toks.push(HOLD_LABELS[octaveButton(heldOct)].release);
          heldSharp = false;
          heldOct = 0;
          toks.push(`_${dur(u.beats)}`);
          continue;
        }
        if (st === null) continue;
        // giữ: chiều quãng tám trước, rồi scroll
        if (heldSharp && !st.sharp) {
          toks.push(HOLD_LABELS.scroll.release);
          heldSharp = false;
        }
        if (heldOct !== st.octave) {
          if (heldOct !== 0) toks.push(HOLD_LABELS[octaveButton(heldOct)].release);
          if (st.octave !== 0) toks.push(HOLD_LABELS[octaveButton(st.octave)].hold);
          heldOct = st.octave;
        }
        if (!heldSharp && st.sharp) {
          toks.push(HOLD_LABELS.scroll.hold);
          heldSharp = true;
        }

        if (u.kind === 'note') {
          toks.push(`${u.key}${dur(u.beats)}`);
        } else {
          const body = u.notes.map((n) => `${prefixOf(n, st)}${n.key}`).join('-');
          toks.push(`${body}${dur(slurTotal(u.notes.length, u.notes[0]?.beats ?? 1))}`);
        }

        // thả nếu đơn vị kế là rest / hết bài / khác giá trị — scroll trước, rồi quãng tám
        if (heldSharp && (next === null || !next.sharp)) {
          toks.push(HOLD_LABELS.scroll.release);
          heldSharp = false;
        }
        if (heldOct !== 0 && (next === null || next.octave !== heldOct)) {
          toks.push(HOLD_LABELS[octaveButton(heldOct)].release);
          heldOct = 0;
        }
      }
      if (toks.length === 0) continue;
      if (needBlank) {
        out.push('');
        needBlank = false;
      }
      // không bao giờ ghi lời (tính năng lời đã bỏ — SPEC 2026-10-15)
      out.push(toks.join(' '));
    }
  }

  return `${out.join('\n')}\n`;
}

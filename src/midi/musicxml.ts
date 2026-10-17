import { isValidTimeSig } from '../core/parser';
import type { TimeSig } from '../core/types';
import { DEFAULT_TIME_SIG } from '../core/types';
import type { ExtractInputNote } from './extract';
import type { MelodyCandidate } from './melodySuggest';
import { melodyCost, monophonicRatio, notesPerBeat, pickMelody } from './melodySuggest';
import { MAX_MUSICXML_BYTES, MAX_MXL_BYTES } from './types';
import { isZip, readMxlScore } from './zip';

/**
 * Đọc bản nhạc MusicXML (spec Phase 2c): `score-partwise` (.musicxml / .xml, hoặc .mxl đã giải nén
 * bằng zip.ts) → các part, voice, nốt theo beat (beat = nốt đen, như MIDI tick / PPQ), tempo,
 * nhịp, rehearsal mark. Parse bằng DOMParser của trình duyệt, không dependency.
 *
 * - Thời gian tính bằng "tick" nguyên = BCNN mọi `divisions` trong file → chùm ba ra đúng 1/3 beat.
 *   `divisions` đổi giữa bài, `<backup>` / `<forward>`, `<chord/>` (trả mọi nốt — extractMelody
 *   chọn theo policy), nốt grace / cue bị bỏ (cue vẫn chiếm thời gian), nghỉ.
 * - Độ dài ô nhịp = vị trí xa nhất mọi part đạt tới (ô nhịp đón — pickup — ngắn hơn được dời sao
 *   cho vạch nhịp sau trùng bội số ô nhịp); ô nhịp trống dùng độ dài theo nhịp hiện hành.
 * - Tie (`<tie>` / `<tied>` start–stop) gộp thành một nốt; nhạc cụ dịch giọng (`<transpose>`
 *   chromatic + octave-change) đổi về cao độ thật.
 * - Dấu lặp đơn giản được trải ra theo thứ tự chơi (barline forward / backward, `times`, volta
 *   1., 2.); D.C. / D.S. / Coda KHÔNG trải (cảnh báo `jumps`).
 * - Chữ `<lyric>` không đọc (tính năng lời đã bỏ); chỉ ghi nhận part có lời (`ScorePart.sung` — bè
 *   hát, gợi ý melody).
 */

export const DEFAULT_BPM_SCORE = 120;

export type ScoreImportErrorCode =
  /** XML hỏng. */
  | 'invalid-xml'
  /** XML hợp lệ nhưng không phải bản nhạc MusicXML. */
  | 'not-musicxml'
  /** MusicXML dạng score-timewise (chưa hỗ trợ). */
  | 'timewise'
  /** Không có nốt có cao độ nào. */
  | 'no-notes'
  | 'too-large';

export class ScoreImportError extends Error {
  readonly code: ScoreImportErrorCode;
  constructor(code: ScoreImportErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'ScoreImportError';
    this.code = code;
  }
}

/** Cảnh báo (mã → chuỗi i18n ở UI). */
export type ScoreWarning =
  /** Có D.C. / D.S. / To Coda — không trải ra. */
  | 'jumps'
  /** Đổi nhịp giữa bài — bài chỉ dùng nhịp đầu tiên. */
  | 'time-changes';

export interface ScoreVoice {
  /** Id voice: số voice trong file; voice dùng chung số ở nhiều khuông thì `số/khuông`. */
  id: string;
  /** Số voice gốc trong file. */
  number: string;
  /** Khuông chứa phần lớn nốt của voice (1-based). */
  staff: number;
  noteCount: number;
  avgMidi: number;
  /** Số nốt / beat trên cả bài (như ScorePart.notesPerBeat). */
  notesPerBeat: number;
  /** 0..1 — tỉ lệ thời lượng nốt không chồng lên nhau trong voice. */
  monophonicRatio: number;
}

export interface ScorePart {
  id: string;
  name: string;
  instrument: string;
  /** Id các voice có nốt (theo khuông rồi số voice). */
  voices: string[];
  voiceInfo: ScoreVoice[];
  /** Số khuông lớn nhất (piano = 2). */
  staves: number;
  /** Số nốt (đã trải lặp, đã gộp tie). */
  noteCount: number;
  minMidi: number;
  maxMidi: number;
  avgMidi: number;
  /**
   * Mật độ: số nốt / beat (nốt đen) trên cả bài (nốt đầu của mọi part → hết nốt cuối) = số nốt mỗi
   * phút ÷ BPM. Giai điệu ≈ 1 (gợi ý melody — melodySuggest.ts).
   */
  notesPerBeat: number;
  /** 0..1 — tỉ lệ thời lượng nốt không chồng lên nhau (hợp âm, nhiều giọng → thấp). */
  monophonicRatio: number;
  /**
   * Part có `<lyric>` mang chữ (bè hát) — chỉ dùng nội bộ làm gợi ý melody, không hiện cho người
   * dùng, chữ không được đọc.
   */
  sung: boolean;
  /** Part có `<transpose>` khác 0 (đã đổi về cao độ thật). */
  transposing: boolean;
}

/** Nốt đã trải lặp và gộp tie (cao độ thật). */
export interface ScoreNote {
  startBeat: number;
  beats: number;
  midi: number;
  /** Id voice (ScoreVoice.id). */
  voice: string;
}

export interface ParsedScore {
  title: string;
  composer?: string;
  /** Tempo đầu tiên (nốt đen / phút), mặc định 120. */
  bpm: number;
  /** Số lần đổi tempo (chỉ để thông tin). */
  tempoChanges: number;
  /** Nhịp đầu tiên (mặc định 4/4). */
  timeSig: TimeSig;
  /** Mọi part trong file (kể cả part không có nốt có cao độ, vd. bộ gõ — UI ẩn). */
  parts: ScorePart[];
  /** Rehearsal mark (không có thì chữ `<words>` trong direction), theo beat đã trải lặp. */
  markers: Array<{ beat: number; text: string }>;
  warnings: ScoreWarning[];
  /** Có dấu lặp đã được trải ra. */
  repeats: boolean;
  /** Nốt theo part id (sắp theo thời gian). */
  notes: Record<string, ScoreNote[]>;
}

export interface ScorePartNoteOptions {
  /** Id voice, hoặc 'all' = mọi voice của part. */
  voice: string | 'all';
}

// ---------------------------------------------------------------------------
// DOM helper
// ---------------------------------------------------------------------------

function kids(el: Element, name?: string): Element[] {
  const out: Element[] = [];
  for (const c of Array.from(el.children))
    if (name === undefined || c.localName === name) out.push(c);
  return out;
}

function kid(el: Element, name: string): Element | undefined {
  for (const c of Array.from(el.children)) if (c.localName === name) return c;
  return undefined;
}

function textOf(el: Element | undefined): string {
  return el?.textContent ?? '';
}

function kidText(el: Element, name: string): string {
  return textOf(kid(el, name)).trim();
}

/** Số từ chuỗi; rỗng / sai → NaN. */
function num(s: string | null | undefined): number {
  if (s === null || s === undefined || s.trim() === '') return NaN;
  return Number(s.trim());
}

/** Gộp khoảng trắng, chuẩn NFC. */
function clean(s: string): string {
  return s.normalize('NFC').replace(/\s+/g, ' ').trim();
}

// ---------------------------------------------------------------------------
// Giải mã byte → chuỗi XML
// ---------------------------------------------------------------------------

/**
 * Byte → chuỗi: BOM (UTF-8 / UTF-16), UTF-16 không BOM (`<` + byte 0), `encoding` trong khai báo
 * XML, mặc định UTF-8. Khai báo encoding bị bỏ khỏi chuỗi trả về (DOMParser nhận chuỗi đã giải mã).
 */
export function decodeXmlBytes(bytes: Uint8Array): string {
  let label = 'utf-8';
  let start = 0;
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) start = 3;
  else if (bytes[0] === 0xff && bytes[1] === 0xfe) [label, start] = ['utf-16le', 2];
  else if (bytes[0] === 0xfe && bytes[1] === 0xff) [label, start] = ['utf-16be', 2];
  else if (bytes[0] === 0x3c && bytes[1] === 0) label = 'utf-16le';
  else if (bytes[0] === 0 && bytes[1] === 0x3c) label = 'utf-16be';
  else {
    let head = '';
    for (let i = 0; i < Math.min(bytes.length, 256); i++) head += String.fromCharCode(bytes[i]);
    const m = /^\s*<\?xml[^>]*?\sencoding\s*=\s*["']([A-Za-z0-9._:-]+)["']/.exec(head);
    if (m) label = m[1];
  }
  let text: string;
  try {
    text = new TextDecoder(label).decode(bytes.subarray(start));
  } catch {
    text = new TextDecoder('utf-8').decode(bytes.subarray(start)); // encoding lạ → UTF-8
  }
  // BOM còn sót (TextDecoder chỉ bỏ BOM khớp với encoding đã chọn)
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  return text.replace(/^(\s*<\?xml[^>]*?)\s+encoding\s*=\s*["'][^"']*["']/, '$1');
}

// ---------------------------------------------------------------------------
// Phần tử nhạc
// ---------------------------------------------------------------------------

const STEP_SEMITONES: Readonly<Record<string, number>> = {
  C: 0,
  D: 2,
  E: 4,
  F: 5,
  G: 7,
  A: 9,
  B: 11,
};

function pitchMidi(p: Element): number | null {
  const step = kidText(p, 'step').toUpperCase();
  const octave = num(kidText(p, 'octave'));
  const alter = num(kidText(p, 'alter'));
  const semi = STEP_SEMITONES[step];
  if (semi === undefined || !Number.isFinite(octave)) return null;
  return (octave + 1) * 12 + semi + (Number.isFinite(alter) ? Math.round(alter) : 0);
}

/** Độ dài (nốt đen) của beat-unit trong metronome. */
const UNIT_QUARTERS: Readonly<Record<string, number>> = {
  long: 16,
  breve: 8,
  whole: 4,
  half: 2,
  quarter: 1,
  eighth: 0.5,
  '16th': 0.25,
  '32nd': 0.125,
  '64th': 0.0625,
};

/** `<metronome>` → bpm theo nốt đen; metric modulation (2 beat-unit) / không số → null. */
function metronomeBpm(m: Element): number | null {
  const units = kids(m, 'beat-unit');
  if (units.length !== 1) return null;
  const q = UNIT_QUARTERS[textOf(units[0]).trim()];
  const per = /\d+(?:[.,]\d+)?/.exec(kidText(m, 'per-minute'));
  if (q === undefined || !per) return null;
  const dots = kids(m, 'beat-unit-dot').length;
  const v = Number(per[0].replace(',', '.')) * q * (2 - 0.5 ** dots);
  return Number.isFinite(v) && v > 0 ? v : null;
}

function validBpm(v: number): number | null {
  return Number.isFinite(v) && v > 0 ? v : null;
}

/** Chữ chỉ dẫn bước nhảy (D.C., D.S., To Coda…). */
const JUMP_WORDS = /(^|[^a-z])(d\.\s?c\.|d\.\s?s\.|da\s+capo|dal\s+segno|to\s+coda)/i;
/**
 * Chữ chỉ dẫn diễn tấu thường gặp — không dùng làm tên section khi bản nhạc không có rehearsal
 * mark (chữ `<words>` khác như "Verse", "Điệp khúc" thì dùng).
 */
const EXPRESSION_WORDS =
  /^(rit|ritard|ritardando|rall|rallentando|accel|accelerando|a tempo|tempo i|cresc|crescendo|dim|diminuendo|decresc|dolce|espress|espressivo|cantabile|legato|staccato|marcato|pizz|arco|sim|simile|poco|molto|sempre|subito|fine|swing|straight|rubato|tacet|ad lib|8va|8vb|15ma|loco|con sord|senza sord|let ring|fermata|mf|mp|f|ff|fff|p|pp|ppp|sfz|fp)(\b|\.|$)/i;

function parseEndingNumbers(s: string): number[] | null {
  const out: number[] = [];
  for (const m of s.matchAll(/(\d+)\s*(?:-\s*(\d+))?/g)) {
    const a = Number(m[1]);
    const b = m[2] !== undefined ? Number(m[2]) : a;
    for (let k = a; k <= Math.min(b, a + 32); k++) if (k > 0) out.push(k);
  }
  return out.length > 0 ? out : null;
}

function parseTime(t: Element): TimeSig | null {
  const beats = kids(t, 'beats');
  const types = kids(t, 'beat-type');
  if (beats.length === 0 || beats.length !== types.length) return null;
  // nhịp ghép "3+2", hoặc nhiều cặp beats/beat-type → cộng, quy về mẫu lớn nhất
  let quarters = 0;
  let den = 0;
  for (let k = 0; k < beats.length; k++) {
    const n = textOf(beats[k])
      .split('+')
      .reduce((sum, x) => sum + num(x), 0);
    const d = num(textOf(types[k]));
    if (!Number.isFinite(n) || !(n > 0) || !(d > 0)) return null;
    quarters += (n * 4) / d;
    den = Math.max(den, d);
  }
  return { num: Math.round((quarters * den) / 4), den };
}

const sameTs = (a: TimeSig, b: TimeSig): boolean => a.num === b.num && a.den === b.den;

// ---------------------------------------------------------------------------
// Đọc từng ô nhịp
// ---------------------------------------------------------------------------

interface RawNote {
  /** Tick tính từ đầu ô nhịp. */
  off: number;
  dur: number;
  midi: number;
  voice: string;
  staff: number;
  tieStart: boolean;
  tieStop: boolean;
  /** Nốt có `<lyric>` mang chữ (chỉ để đánh dấu part là bè hát). */
  sung: boolean;
}

interface RawDirection {
  off: number;
  tempo: number | null;
  rehearsal: string;
  words: string;
  /** Direction có metronome / tempo (chữ của nó là chữ tempo, không phải tên đoạn). */
  tempoish: boolean;
}

interface RawMeasure {
  notes: RawNote[];
  /** Vị trí xa nhất đạt tới (tick). */
  length: number;
  dirs: RawDirection[];
  forward: boolean;
  /** Số lần chơi đoạn lặp kết thúc ở ô này (0 = không có repeat backward). */
  backward: number;
  endingStart: string | null;
  endingStop: boolean;
  time: TimeSig | null;
}

interface RawPart {
  id: string;
  name: string;
  instrument: string;
  measures: RawMeasure[];
  staves: number;
  transposing: boolean;
}

interface Ctx {
  /** Tick mỗi nốt đen (BCNN các divisions). */
  tpq: number;
  jumps: boolean;
}

/** Nốt có `<lyric>` với chữ thật (`<extend/>`, `<humming/>`… không có chữ thì không tính). */
function hasSungText(note: Element): boolean {
  return kids(note, 'lyric').some((ly) => kids(ly, 'text').some((t) => clean(textOf(t)) !== ''));
}

function readPart(partEl: Element, meta: { name: string; instrument: string }, ctx: Ctx): RawPart {
  let divisions = 1;
  let transposeAll = 0;
  const transposeByStaff = new Map<number, number>();
  let staves = 1;
  let transposing = false;
  const toTicks = (d: number): number => (Number.isFinite(d) ? (d * ctx.tpq) / divisions : 0);

  const measures: RawMeasure[] = kids(partEl, 'measure').map((mEl) => {
    const m: RawMeasure = {
      notes: [],
      length: 0,
      dirs: [],
      forward: false,
      backward: 0,
      endingStart: null,
      endingStop: false,
      time: null,
    };
    let pos = 0;
    let chordStart = 0;
    const reach = () => {
      if (pos > m.length) m.length = pos;
    };
    const sound = (s: Element, d: RawDirection | null, off: number) => {
      const tempo = validBpm(num(s.getAttribute('tempo')));
      if (['dacapo', 'dalsegno', 'tocoda'].some((a) => (s.getAttribute(a) ?? '').trim() !== '')) {
        ctx.jumps = true;
      }
      if (tempo === null) return;
      if (d) {
        d.tempo = tempo; // <sound tempo> (giá trị phát) thắng metronome cùng direction
        d.tempoish = true;
      } else {
        m.dirs.push({ off, tempo, rehearsal: '', words: '', tempoish: true });
      }
    };

    for (const el of Array.from(mEl.children)) {
      switch (el.localName) {
        case 'attributes': {
          const div = num(kidText(el, 'divisions'));
          if (div > 0) divisions = div;
          const st = num(kidText(el, 'staves'));
          if (Number.isInteger(st) && st > staves) staves = st;
          const time = kid(el, 'time');
          if (time) m.time ??= parseTime(time);
          for (const tr of kids(el, 'transpose')) {
            const chrom = num(kidText(tr, 'chromatic'));
            const oct = num(kidText(tr, 'octave-change'));
            const semis =
              (Number.isFinite(chrom) ? chrom : 0) + 12 * (Number.isFinite(oct) ? oct : 0);
            if (semis !== 0) transposing = true;
            const staff = Number.parseInt(tr.getAttribute('number') ?? '', 10);
            if (staff > 0) transposeByStaff.set(staff, semis);
            else {
              transposeAll = semis;
              transposeByStaff.clear();
            }
          }
          break;
        }
        case 'note': {
          const grace = kid(el, 'grace') !== undefined;
          const chord = kid(el, 'chord') !== undefined;
          const dur = grace ? 0 : Math.max(0, toTicks(num(kidText(el, 'duration'))));
          let start: number;
          if (grace) start = pos;
          else if (chord) start = chordStart;
          else {
            start = pos;
            chordStart = pos;
            pos += dur;
            reach();
          }
          // grace bỏ hẳn; cue (nốt nhắc, không phát) vẫn chiếm thời gian ở trên
          if (grace || kid(el, 'cue') !== undefined || dur <= 0) break;
          const pitch = kid(el, 'pitch');
          if (!pitch) break; // nghỉ / unpitched
          const written = pitchMidi(pitch);
          if (written === null) break;
          const staff = Number.parseInt(kidText(el, 'staff'), 10) || 1;
          let tieStart = false;
          let tieStop = false;
          const tieTypes = [
            ...kids(el, 'tie'),
            ...kids(el, 'notations').flatMap((n) => kids(n, 'tied')),
          ].map((t) => t.getAttribute('type'));
          for (const type of tieTypes) {
            if (type === 'start' || type === 'continue') tieStart = true;
            if (type === 'stop' || type === 'continue') tieStop = true;
          }
          m.notes.push({
            off: start,
            dur,
            midi: written + (transposeByStaff.get(staff) ?? transposeAll),
            voice: kidText(el, 'voice') || '1',
            staff,
            tieStart,
            tieStop,
            sung: hasSungText(el),
          });
          break;
        }
        case 'backup':
          pos = Math.max(0, pos - Math.max(0, toTicks(num(kidText(el, 'duration')))));
          break;
        case 'forward':
          pos += Math.max(0, toTicks(num(kidText(el, 'duration'))));
          reach();
          break;
        case 'direction': {
          const offset = toTicks(num(kidText(el, 'offset')));
          const off = Math.max(0, pos + offset);
          const d: RawDirection = { off, tempo: null, rehearsal: '', words: '', tempoish: false };
          for (const dt of kids(el, 'direction-type')) {
            for (const c of kids(dt)) {
              if (c.localName === 'rehearsal') d.rehearsal += textOf(c);
              else if (c.localName === 'words') d.words += textOf(c);
              else if (c.localName === 'metronome') {
                d.tempoish = true;
                d.tempo ??= metronomeBpm(c);
              }
            }
          }
          if (JUMP_WORDS.test(d.words)) ctx.jumps = true;
          const s = kid(el, 'sound');
          if (s) sound(s, d, off);
          m.dirs.push(d);
          break;
        }
        case 'sound':
          sound(el, null, pos);
          break;
        case 'barline': {
          const rep = kid(el, 'repeat');
          if (rep?.getAttribute('direction') === 'forward') m.forward = true;
          if (rep?.getAttribute('direction') === 'backward') {
            const times = Number.parseInt(rep.getAttribute('times') ?? '', 10);
            m.backward = Math.max(m.backward, Number.isInteger(times) ? Math.min(times, 16) : 2);
          }
          const ending = kid(el, 'ending');
          const type = ending?.getAttribute('type');
          if (ending && type === 'start') m.endingStart = ending.getAttribute('number') ?? '';
          if (ending && (type === 'stop' || type === 'discontinue')) m.endingStop = true;
          break;
        }
        default:
          break;
      }
    }
    return m;
  });
  return { id: partEl.getAttribute('id') ?? '', ...meta, measures, staves, transposing };
}

// ---------------------------------------------------------------------------
// Trải dấu lặp
// ---------------------------------------------------------------------------

interface MeasureInfo {
  length: number;
  forward: boolean;
  backward: number;
  ending: number[] | null;
  /** Số volta lớn nhất của nhóm volta chứa ô này. */
  groupMax: number;
}

interface Visit {
  index: number;
  pass: number;
  /** Tick bắt đầu trên trục đã trải. */
  start: number;
}

/** Thứ tự chơi các ô nhịp (dấu lặp + volta). Chặn vòng lặp vô hạn bằng số lượt tối đa. */
function expandRepeats(info: readonly MeasureInfo[], startTick: number): Visit[] {
  const out: Visit[] = [];
  const limit = Math.max(1000, info.length * 16);
  let i = 0;
  let repeatStart = 0;
  let pass = 1;
  let inEnding = false;
  let t = startTick;
  while (i < info.length && out.length < limit) {
    const m = info[i];
    if (m.forward && i !== repeatStart) {
      repeatStart = i;
      pass = 1;
    }
    if (m.ending === null && inEnding) {
      // vừa ra khỏi nhóm volta: đoạn sau tính lại từ lần 1
      inEnding = false;
      if (pass > 1) {
        pass = 1;
        repeatStart = i;
      }
    }
    if (m.ending !== null) {
      inEnding = true;
      if (!m.ending.includes(pass)) {
        i++;
        continue;
      }
    }
    out.push({ index: i, pass, start: t });
    t += m.length;
    if (m.backward > 0) {
      // volta 1., 2., 3. mà chỉ ghi times mặc định → số lần = volta lớn nhất của nhóm
      const times = m.ending !== null ? Math.max(m.backward, m.groupMax) : m.backward;
      if (pass < times) {
        pass++;
        i = repeatStart;
        inEnding = false; // quay lại đầu đoạn lặp không phải "ra khỏi nhóm volta"
        continue;
      }
      repeatStart = i + 1;
      if (m.ending === null) pass = 1;
    }
    i++;
  }
  return out;
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

function gcd(a: number, b: number): number {
  while (b) [a, b] = [b, a % b];
  return a;
}

function titleOf(root: Element): string {
  const work = kid(root, 'work');
  const fromWork = work ? clean(kidText(work, 'work-title')) : '';
  if (fromWork) return fromWork;
  const movement = clean(kidText(root, 'movement-title'));
  if (movement) return movement;
  return creditText(root, 'title');
}

function creditText(root: Element, type: string): string {
  for (const c of kids(root, 'credit')) {
    if (kids(c, 'credit-type').some((t) => textOf(t).trim().toLowerCase() === type)) {
      const s = clean(
        kids(c, 'credit-words')
          .map((w) => textOf(w))
          .join(' '),
      );
      if (s) return s;
    }
  }
  return '';
}

function composerOf(root: Element): string {
  const ident = kid(root, 'identification');
  for (const c of ident ? kids(ident, 'creator') : []) {
    if ((c.getAttribute('type') ?? '').toLowerCase() === 'composer') {
      const s = clean(textOf(c));
      if (s) return s;
    }
  }
  return creditText(root, 'composer');
}

function voiceSort(a: ScoreVoice, b: ScoreVoice): number {
  const na = Number(a.number);
  const nb = Number(b.number);
  return (
    a.staff - b.staff ||
    (Number.isFinite(na) && Number.isFinite(nb) ? na - nb : a.number.localeCompare(b.number)) ||
    a.id.localeCompare(b.id)
  );
}

/**
 * Voice dùng chung một số ở nhiều khuông (vài phần mềm đánh số voice lại từ 1 cho mỗi khuông):
 * khuông phụ có ≥ 25% nốt của voice → tách thành voice riêng mỗi khuông. Ít hơn thì coi là nốt
 * "vắt khuông" (cross-staff) của cùng một voice.
 */
function voiceIdFn(part: RawPart): (n: RawNote) => string {
  const counts = new Map<string, Map<number, number>>();
  for (const m of part.measures) {
    for (const n of m.notes) {
      const byStaff = counts.get(n.voice) ?? new Map<number, number>();
      byStaff.set(n.staff, (byStaff.get(n.staff) ?? 0) + 1);
      counts.set(n.voice, byStaff);
    }
  }
  const split = new Set<string>();
  for (const [voice, byStaff] of counts) {
    const list = Array.from(byStaff.values()).sort((a, b) => b - a);
    const total = list.reduce((s, x) => s + x, 0);
    if (list.length >= 2 && list[1] >= 0.25 * total) split.add(voice);
  }
  return (n) => (split.has(n.voice) ? `${n.voice}/${n.staff}` : n.voice);
}

interface WorkNote {
  start: number;
  dur: number;
  midi: number;
  voice: string;
  rawVoice: string;
  staff: number;
  sung: boolean;
}

/** Trải nốt của một part theo thứ tự chơi, gộp tie. */
function emitPart(part: RawPart, order: readonly Visit[], ctx: Ctx): WorkNote[] {
  const voiceId = voiceIdFn(part);
  const out: WorkNote[] = [];
  /** key `voice|midi` → nốt đang chờ tie stop. */
  const open = new Map<string, WorkNote>();
  const eps = ctx.tpq * 1e-6;
  const adjacent = (w: WorkNote, s: number) => Math.abs(w.start + w.dur - s) <= eps;
  for (let vi = 0; vi < order.length; vi++) {
    const v = order[vi];
    const m = part.measures[v.index] as RawMeasure | undefined;
    if (!m) continue;
    for (const n of m.notes) {
      const s = v.start + n.off;
      const key = `${n.voice}|${n.midi}`;
      if (n.tieStop) {
        let head = open.get(key);
        let headKey = key;
        if (!head || !adjacent(head, s)) {
          // tie đổi voice qua vạch nhịp (hay gặp ở piano): tìm nốt cùng cao độ vừa hết đúng lúc này
          head = undefined;
          for (const [k, w] of open) {
            if (w.midi === n.midi && adjacent(w, s)) {
              head = w;
              headKey = k;
              break;
            }
          }
        }
        if (head) {
          head.dur = s + n.dur - head.start;
          if (n.sung) head.sung = true;
          open.delete(headKey);
          if (n.tieStart) open.set(key, head);
          continue;
        }
      }
      const w: WorkNote = {
        start: s,
        dur: n.dur,
        midi: n.midi,
        voice: voiceId(n),
        rawVoice: n.voice,
        staff: n.staff,
        sung: n.sung,
      };
      out.push(w);
      if (n.tieStart) open.set(key, w);
      else open.delete(key);
    }
  }
  return out
    .map((w, i) => ({ w, i }))
    .sort((a, b) => a.w.start - b.w.start || a.i - b.i)
    .map((x) => x.w);
}

/** Dung sai legato khi đo tỉ lệ đơn âm của MusicXML (beat): độ dài chính xác, chỉ chừa sai số. */
const SCORE_MONO_LEGATO_BEATS = 1 / 64;

/** Tỉ lệ đơn âm của các nốt (đã sắp theo start, tick) tính theo beat. */
function monoOf(notes: readonly WorkNote[], tpq: number): number {
  return monophonicRatio(
    notes.map((n) => ({ start: n.start, dur: n.dur })),
    SCORE_MONO_LEGATO_BEATS * tpq,
  );
}

function summarizePart(
  raw: RawPart,
  notes: readonly WorkNote[],
  tpq: number,
  spanBeats: number,
): ScorePart {
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  let sung = false;
  const voices = new Map<
    string,
    { number: string; staffs: Map<number, number>; n: number; sum: number }
  >();
  for (const n of notes) {
    min = Math.min(min, n.midi);
    max = Math.max(max, n.midi);
    sum += n.midi;
    if (n.sung) sung = true;
    const v = voices.get(n.voice) ?? { number: n.rawVoice, staffs: new Map(), n: 0, sum: 0 };
    v.n++;
    v.sum += n.midi;
    v.staffs.set(n.staff, (v.staffs.get(n.staff) ?? 0) + 1);
    voices.set(n.voice, v);
  }
  const voiceInfo: ScoreVoice[] = Array.from(voices, ([id, v]) => {
    let staff = 1;
    let best = -1;
    for (const [s, c] of v.staffs) {
      if (c > best || (c === best && s < staff)) [staff, best] = [s, c];
    }
    const own = notes.filter((n) => n.voice === id);
    return {
      id,
      number: v.number,
      staff,
      noteCount: v.n,
      avgMidi: v.sum / v.n,
      notesPerBeat: notesPerBeat(v.n, spanBeats),
      monophonicRatio: monoOf(own, tpq),
    };
  }).sort(voiceSort);
  return {
    id: raw.id,
    name: raw.name,
    instrument: raw.instrument,
    voices: voiceInfo.map((v) => v.id),
    voiceInfo,
    staves: raw.staves,
    noteCount: notes.length,
    minMidi: notes.length > 0 ? min : NaN,
    maxMidi: notes.length > 0 ? max : NaN,
    avgMidi: notes.length > 0 ? sum / notes.length : NaN,
    notesPerBeat: notesPerBeat(notes.length, spanBeats),
    monophonicRatio: monoOf(notes, tpq),
    sung,
    transposing: raw.transposing,
  };
}

function roundBpm(bpm: number): number {
  return Math.round(bpm * 100) / 100;
}

/**
 * Parse chuỗi MusicXML (score-partwise). Lỗi → ScoreImportError: 'invalid-xml', 'timewise',
 * 'not-musicxml', 'no-notes' (không part nào có nốt có cao độ).
 */
export function parseMusicXml(xml: string): ParsedScore {
  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(xml, 'application/xml');
  } catch (e) {
    throw new ScoreImportError('invalid-xml', e instanceof Error ? e.message : String(e));
  }
  const root = doc.documentElement as Element | null;
  if (!root || doc.getElementsByTagName('parsererror').length > 0) {
    throw new ScoreImportError('invalid-xml');
  }
  if (root.localName === 'score-timewise') throw new ScoreImportError('timewise');
  if (root.localName !== 'score-partwise') throw new ScoreImportError('not-musicxml');

  // tick / nốt đen = BCNN mọi divisions (nguyên) → mọi vị trí là số nguyên, chùm ba chính xác
  let tpq = 1;
  for (const d of Array.from(root.getElementsByTagName('divisions'))) {
    const v = Math.round(num(textOf(d)));
    if (!(v > 0)) continue;
    const next = (tpq / gcd(tpq, v)) * v;
    if (next > 2 ** 31) {
      tpq = Math.max(tpq, v); // BCNN quá lớn (file lạ) → chấp nhận sai số float
      continue;
    }
    tpq = next;
  }
  const ctx: Ctx = { tpq, jumps: false };

  const meta = new Map<string, { name: string; instrument: string }>();
  const partList = kid(root, 'part-list');
  for (const sp of partList ? kids(partList, 'score-part') : []) {
    const inst = kid(sp, 'score-instrument');
    meta.set(sp.getAttribute('id') ?? '', {
      name: clean(kidText(sp, 'part-name')),
      instrument: inst ? clean(kidText(inst, 'instrument-name')) : '',
    });
  }

  const raws = kids(root, 'part').map((p, i) => {
    const m = meta.get(p.getAttribute('id') ?? '');
    const name = m?.name || `Part ${i + 1}`;
    const raw = readPart(p, { name, instrument: m?.instrument ?? '' }, ctx);
    if (raw.id === '') raw.id = `P${i + 1}`;
    return raw;
  });

  // ── trục ô nhịp chung cho mọi part ──
  const count = Math.max(0, ...raws.map((r) => r.measures.length));
  let ts: TimeSig | null = null;
  let firstTs: TimeSig | null = null;
  let timeChanges = false;
  const info: MeasureInfo[] = [];
  let curEnding: number[] | null = null;
  for (let i = 0; i < count; i++) {
    const ms = raws.map((r) => r.measures[i]).filter((m): m is RawMeasure => m !== undefined);
    const time = ms.find((m) => m.time !== null)?.time ?? null;
    if (time && isValidTimeSig(time)) {
      if (firstTs === null) firstTs = time;
      else if (ts && !sameTs(ts, time)) timeChanges = true;
      ts = time;
    }
    const cur = ts ?? DEFAULT_TIME_SIG;
    const startEl = ms.find((m) => m.endingStart !== null);
    if (startEl) curEnding = parseEndingNumbers(startEl.endingStart ?? '');
    const length = Math.max(0, ...ms.map((m) => m.length));
    info.push({
      length: length > 0 ? length : ((cur.num * 4) / cur.den) * tpq,
      forward: ms.some((m) => m.forward),
      backward: Math.max(0, ...ms.map((m) => (m.backward >= 2 ? m.backward : 0))),
      ending: curEnding,
      groupMax: 0,
    });
    if (ms.some((m) => m.endingStop)) curEnding = null;
  }
  // số volta lớn nhất của mỗi nhóm volta liền nhau
  for (let i = 0; i < info.length;) {
    if (info[i].ending === null) {
      i++;
      continue;
    }
    let j = i;
    let max = 0;
    while (j < info.length && info[j].ending !== null)
      max = Math.max(max, ...(info[j++].ending ?? []));
    for (let k = i; k < j; k++) info[k].groupMax = max;
    i = j;
  }

  const timeSig = firstTs ?? { ...DEFAULT_TIME_SIG };
  // ô nhịp đón (pickup) ngắn hơn một ô → dời cả bài để vạch nhịp sau rơi đúng bội số ô nhịp
  const barTicks = ((timeSig.num * 4) / timeSig.den) * tpq;
  const pickup = info.length > 0 && info[0].length < barTicks ? barTicks - info[0].length : 0;
  const order = expandRepeats(info, pickup);
  const repeats = info.some((m) => m.backward > 0);

  // ── nốt ──
  const notes: Record<string, ScoreNote[]> = {};
  const works = raws.map((raw) => emitPart(raw, order, ctx));
  // độ dài cả bài: nốt đầu của mọi part → hết nốt cuối (mẫu số của mật độ nốt)
  let first = Infinity;
  let last = -Infinity;
  for (const work of works) {
    for (const w of work) {
      first = Math.min(first, w.start);
      last = Math.max(last, w.start + w.dur);
    }
  }
  const spanBeats = Number.isFinite(first) ? (last - first) / tpq : 0;
  const parts: ScorePart[] = raws.map((raw, i) => {
    const work = works[i];
    notes[raw.id] = work.map((w): ScoreNote => ({
      startBeat: w.start / tpq,
      beats: w.dur / tpq,
      midi: w.midi,
      voice: w.voice,
    }));
    return summarizePart(raw, work, tpq, spanBeats);
  });
  if (parts.every((p) => p.noteCount === 0)) throw new ScoreImportError('no-notes');

  // ── tempo, marker (theo trục đã trải; mọi part, bỏ trùng) ──
  const tempos: Array<{ beat: number; bpm: number }> = [];
  const rehearsal: Array<{ beat: number; text: string }> = [];
  const words: Array<{ beat: number; text: string }> = [];
  const seen = new Set<string>();
  const addMark = (list: Array<{ beat: number; text: string }>, beat: number, text: string) => {
    const key = `${list === rehearsal ? 'r' : 'w'}|${beat}|${text}`;
    if (text === '' || seen.has(key)) return;
    seen.add(key);
    list.push({ beat, text });
  };
  for (const v of order) {
    for (const raw of raws) {
      const m = raw.measures[v.index] as RawMeasure | undefined;
      for (const d of m?.dirs ?? []) {
        const beat = (v.start + d.off) / tpq;
        if (d.tempo !== null) tempos.push({ beat, bpm: roundBpm(d.tempo) });
        addMark(rehearsal, beat, clean(d.rehearsal));
        const w = clean(d.words);
        if (!d.tempoish && !JUMP_WORDS.test(w) && !EXPRESSION_WORDS.test(w))
          addMark(words, beat, w);
      }
    }
  }
  const byBeat = (a: { beat: number }, b: { beat: number }) => a.beat - b.beat;
  tempos.sort(byBeat);
  // nhiều tempo cùng beat → cái sau cùng có hiệu lực (như MIDI, D-168)
  const bpms: number[] = [];
  tempos.forEach((tp, k) => {
    const nextSame = k + 1 < tempos.length && tempos[k + 1].beat === tp.beat;
    if (!nextSame) bpms.push(tp.bpm);
  });
  let tempoChanges = 0;
  for (let k = 1; k < bpms.length; k++) if (bpms[k] !== bpms[k - 1]) tempoChanges++;
  const markers = (rehearsal.length > 0 ? rehearsal : words).sort(byBeat);

  const warnings: ScoreWarning[] = [];
  if (ctx.jumps) warnings.push('jumps');
  if (timeChanges) warnings.push('time-changes');

  const composer = composerOf(root);
  return {
    title: titleOf(root),
    ...(composer ? { composer } : {}),
    bpm: bpms[0] ?? DEFAULT_BPM_SCORE,
    tempoChanges,
    timeSig,
    parts,
    markers,
    warnings,
    repeats,
    notes,
  };
}

/**
 * Đọc file MusicXML (.musicxml / .xml, hoặc .mxl nén — nhận theo chữ ký ZIP, không theo đuôi).
 * Lỗi: ScoreImportError (kể cả 'too-large' khi vượt giới hạn), ZipError của zip.ts.
 */
export async function readScoreFile(data: ArrayBuffer | Uint8Array): Promise<ParsedScore> {
  const bytes = ArrayBuffer.isView(data)
    ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
    : new Uint8Array(data);
  let xml: Uint8Array;
  if (isZip(bytes)) {
    if (bytes.byteLength > MAX_MXL_BYTES) throw new ScoreImportError('too-large');
    xml = (await readMxlScore(bytes, { maxBytes: MAX_MUSICXML_BYTES })).data;
  } else {
    if (bytes.byteLength > MAX_MUSICXML_BYTES) throw new ScoreImportError('too-large');
    xml = bytes;
  }
  return parseMusicXml(decodeXmlBytes(xml));
}

/** Nốt của một part theo beat (đầu vào extractMelody), lọc theo voice. Part không tồn tại → []. */
export function scorePartNotes(
  score: ParsedScore,
  partId: string,
  opts: ScorePartNoteOptions,
): ExtractInputNote[] {
  const list = (score.notes[partId] as ScoreNote[] | undefined) ?? [];
  const out: ExtractInputNote[] = [];
  for (const n of list) {
    if (opts.voice !== 'all' && n.voice !== opts.voice) continue;
    out.push({ startBeat: n.startBeat, beats: n.beats, midi: n.midi });
  }
  return out;
}

/**
 * Gợi ý part mang giai điệu theo mật độ nốt so với tempo (melodySuggest.ts): số nốt mỗi beat trên cả
 * bài gần 1, đơn âm, không phải âm vực bass; bè có lời (bè hát) và tên gợi ý "melody / vocal / voice…"
 * được cộng điểm. Hòa → part đứng trước. null nếu không part nào có nốt.
 */
export function suggestScorePart(score: ParsedScore): string | null {
  const withNotes = score.parts.filter((p) => p.noteCount > 0);
  const i = pickMelody(withNotes);
  return i < 0 ? null : withNotes[i].id;
}

/** Ưu thế của voice đầu (voice 1, khuông trên — chỗ quen đặt giai điệu) khi chấm voice mặc định. */
const FIRST_VOICE_BONUS = 0.5;

/**
 * Voice mặc định của part: chấm từng voice như gợi ý melody (mật độ ≈ 1 nốt / beat, đơn âm, không
 * trầm), voice đầu tiên được ưu thế nhỏ; hòa → voice đứng trước. Part không có nốt → 'all'.
 */
export function defaultScoreVoice(part: ScorePart): string {
  if (part.voiceInfo.length === 0) return 'all';
  let best = part.voiceInfo[0];
  let bestCost = Infinity;
  part.voiceInfo.forEach((v, i) => {
    const cand: MelodyCandidate = {
      noteCount: v.noteCount,
      notesPerBeat: v.notesPerBeat,
      monophonicRatio: v.monophonicRatio,
      avgMidi: v.avgMidi,
      name: '',
    };
    const cost = melodyCost(cand) - (i === 0 ? FIRST_VOICE_BONUS : 0);
    if (cost < bestCost - 1e-9) {
      best = v;
      bestCost = cost;
    }
  });
  return best.id;
}

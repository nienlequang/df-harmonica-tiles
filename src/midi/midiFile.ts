import { Midi } from '@tonejs/midi';
import type { Track } from '@tonejs/midi';
import { isValidTimeSig } from '../core/parser';
import type { TimeSig } from '../core/types';
import { DEFAULT_TIME_SIG } from '../core/types';
import { DEFAULT_EXTRACT, defaultLegatoBeats } from './extract';
import { monophonicRatio, notesPerBeat, pickMelody } from './melodySuggest';
import type { MidiMetaText, MidiNote, MidiTrackSummary, ParsedMidi } from './types';
import { MAX_MIDI_BYTES, MidiImportError } from './types';

/**
 * Đọc file .mid (spec §6b A bước 1–2): parse bằng @tonejs/midi, tách track theo kênh, tóm tắt
 * từng track, gợi ý track melody, đổi nốt sang beat (tick / PPQ). Meta lời (FF 05) / text (FF 01)
 * không đọc — tính năng lời đã bỏ.
 *
 * @tonejs/midi kiểm tra file và cho PPQ, tempo, nhịp, tên nhạc cụ. Nhưng nó (1) chỉ đọc meta text
 * của track ĐẦU, giải mã chữ theo Latin-1, và (2) tách track theo cặp (program, kênh) TRƯỚC khi
 * ghép note on/off — nốt đang ngân lúc đổi program mất note off và bị bỏ. Nên ta quét file thêm
 * một lượt chặt chẽ (`scanSmf`): ghép nốt theo (track file, kênh), lấy marker / tên track
 * ở mọi track (UTF-8). Lượt quét hỏng (file cụt mà midi-file vẫn đọc được) → dùng dữ liệu tonejs;
 * file cụt / hỏng nhưng đọc được một phần thì `damaged` = true để UI cảnh báo.
 */

export const DEFAULT_BPM_MIDI = 120;

/** Nốt của một track tính theo beat (đầu vào của extractMelody). */
export interface BeatNote {
  startBeat: number;
  beats: number;
  midi: number;
}

// ---------------------------------------------------------------------------
// Quét SMF
// ---------------------------------------------------------------------------

type TextKind = 'name' | 'marker';

const META_TEXT_KIND: Readonly<Partial<Record<number, TextKind>>> = {
  0x03: 'name',
  0x06: 'marker',
};

interface ScannedText {
  /** Track của file (0-based, theo thứ tự chunk MTrk). */
  track: number;
  ticks: number;
  kind: TextKind;
  text: string;
}

/** Nốt của một kênh trong một track file. */
interface ScannedPart {
  track: number;
  channel: number;
  /** Program của kênh lúc nốt đầu tiên vang (mặc định 0). */
  program: number;
  notes: MidiNote[];
}

interface SmfScan {
  texts: ScannedText[];
  /** Theo thứ tự track file, rồi thứ tự kênh có nốt đầu tiên. */
  parts: ScannedPart[];
  /** Có chunk khai dài quá cuối file, hoặc file hết trước khi đủ số track trong header. */
  truncated: boolean;
}

class ScanError extends Error {}

function latin1(data: Uint8Array): string {
  let s = '';
  for (const b of data) s += String.fromCharCode(b);
  return s;
}

/** Byte meta text → chuỗi: UTF-8 nếu hợp lệ, không thì Latin-1; bỏ NUL. */
function decodeText(data: Uint8Array): string {
  let s: string;
  try {
    s = new TextDecoder('utf-8', { fatal: true }).decode(data);
  } catch {
    s = latin1(data);
  }
  return s.replaceAll('\u0000', '');
}

/** Chuỗi Latin-1 của tonejs/midi-file → giải mã lại như decodeText. */
function redecode(s: string): string {
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i) & 0xff;
  return decodeText(bytes);
}

/**
 * Quét chặt chẽ: đọc quá cuối chunk → ScanError. Ghép note on/off theo (kênh, cao độ) kiểu FIFO
 * (note on velocity 0 = note off, giống midi-file/tonejs); nốt không có note off bị bỏ.
 */
function scanSmf(bytes: Uint8Array): SmfScan {
  let pos = 0;
  let limit = bytes.length;
  const byte = (): number => {
    if (pos >= limit) throw new ScanError('eof');
    return bytes[pos++];
  };
  const take = (n: number): Uint8Array => {
    if (pos + n > limit) throw new ScanError('eof');
    const out = bytes.subarray(pos, pos + n);
    pos += n;
    return out;
  };
  const vlq = (): number => {
    let v = 0;
    for (;;) {
      const b = byte();
      v = v * 128 + (b & 0x7f);
      if ((b & 0x80) === 0) return v;
    }
  };
  let truncated = false;
  const chunk = (): { id: string; end: number } => {
    limit = bytes.length;
    const h = take(8);
    const id = String.fromCharCode(h[0], h[1], h[2], h[3]);
    const len = h[4] * 0x1000000 + (h[5] << 16) + (h[6] << 8) + h[7];
    if (pos + len > bytes.length) truncated = true;
    return { id, end: Math.min(bytes.length, pos + len) };
  };

  const head = chunk();
  if (head.id !== 'MThd') throw new ScanError('header');
  limit = head.end;
  byte(); // format (2 byte) — không cần
  byte();
  const numTracks = (byte() << 8) | byte();
  pos = head.end;

  const texts: ScannedText[] = [];
  const parts: ScannedPart[] = [];

  let t = 0;
  for (; t < numTracks && pos < bytes.length; t++) {
    const c = chunk();
    if (c.id !== 'MTrk') throw new ScanError('track');
    limit = c.end;
    const program = new Array<number>(16).fill(0);
    const byChannel = new Map<number, ScannedPart>();
    /** key = kênh * 128 + cao độ → các note on chưa tắt (FIFO). */
    const open = new Map<number, Array<{ ticks: number; velocity: number }>>();
    let running = -1;
    let ticks = 0;
    while (pos < limit) {
      ticks += vlq();
      let status = byte();
      if (status >= 0xf0) {
        if (status === 0xff) {
          const type = byte();
          const data = take(vlq());
          const kind = META_TEXT_KIND[type];
          if (kind) texts.push({ track: t, ticks, kind, text: decodeText(data) });
        } else if (status === 0xf0 || status === 0xf7) {
          take(vlq());
        } else {
          throw new ScanError('status');
        }
        continue;
      }
      let p1: number;
      if (status < 0x80) {
        // running status (midi-file không reset sau meta/sysex)
        if (running < 0) throw new ScanError('running');
        p1 = status;
        status = running;
      } else {
        p1 = byte();
        running = status;
      }
      const type = status >> 4;
      const p2 = type === 0xc || type === 0xd ? 0 : byte();
      const ch = status & 0x0f;
      if (type === 0xc) {
        program[ch] = p1;
      } else if (type === 0x9 && p2 > 0) {
        if (!byChannel.has(ch)) {
          const part: ScannedPart = { track: t, channel: ch, program: program[ch], notes: [] };
          byChannel.set(ch, part);
          parts.push(part);
        }
        const key = ch * 128 + p1;
        const q = open.get(key);
        if (q) q.push({ ticks, velocity: p2 });
        else open.set(key, [{ ticks, velocity: p2 }]);
      } else if (type === 0x8 || type === 0x9) {
        const on = open.get(ch * 128 + p1)?.shift();
        const part = byChannel.get(ch);
        if (on && part) {
          part.notes.push({
            midi: p1,
            ticks: on.ticks,
            durationTicks: ticks - on.ticks,
            velocity: on.velocity,
            channel: ch,
          });
        }
      }
    }
    pos = c.end;
  }
  if (t < numTracks) truncated = true;
  return { texts, parts, truncated };
}

// ---------------------------------------------------------------------------
// Tóm tắt track
// ---------------------------------------------------------------------------

/**
 * Tóm tắt một track. Tỉ lệ đơn âm: đuôi nốt vang quá onset kế tiếp không quá dung sai legato của
 * extractMelody là chơi liền tiếng, không phải chồng (D-126). Mật độ = số nốt / độ dài cả bài (beat).
 */
function summarize(
  index: number,
  name: string,
  instrument: string,
  channel: number,
  notes: readonly MidiNote[],
  ppq: number,
  spanBeats: number,
): MidiTrackSummary {
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  for (const n of notes) {
    if (n.midi < min) min = n.midi;
    if (n.midi > max) max = n.midi;
    sum += n.midi;
  }
  const trimmed = name.trim();
  return {
    index,
    name: trimmed !== '' ? trimmed : `Track ${index + 1}`,
    instrument,
    channel,
    isDrum: channel === 9,
    noteCount: notes.length,
    minMidi: min,
    maxMidi: max,
    avgMidi: sum / notes.length,
    monophonicRatio: monophonicRatio(
      notes.map((n) => ({ start: n.ticks, dur: n.durationTicks })),
      ppq * defaultLegatoBeats(DEFAULT_EXTRACT.grid),
    ),
    notesPerBeat: notesPerBeat(notes.length, spanBeats),
  };
}

// ---------------------------------------------------------------------------
// Marker
// ---------------------------------------------------------------------------

function byTicks(a: MidiMetaText, b: MidiMetaText): number {
  return a.ticks - b.ticks;
}

/** Sắp theo tick (ổn định theo thứ tự track), bỏ trùng (cùng tick + cùng chữ). */
function metaList(texts: readonly ScannedText[], kind: TextKind): MidiMetaText[] {
  const seen = new Set<string>();
  const out: MidiMetaText[] = [];
  for (const t of texts) {
    if (t.kind !== kind) continue;
    const key = `${t.ticks}|${t.text}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ticks: t.ticks, text: t.text });
  }
  return out.sort(byTicks);
}

// ---------------------------------------------------------------------------
// Track ảo
// ---------------------------------------------------------------------------

interface Group {
  name: string;
  instrument: string;
  channel: number;
  notes: MidiNote[];
}

/** Track nháp của tonejs để tra tên nhạc cụ GM (bảng tên không được export trực tiếp). */
let lookupTrack: Track | null = null;

function instrumentName(program: number, channel: number): string {
  lookupTrack ??= new Midi().addTrack();
  lookupTrack.channel = channel;
  lookupTrack.instrument.number = program;
  // tonejs trả undefined cho số drum kit không có trong bảng
  const name: string | undefined = lookupTrack.instrument.name;
  return name ?? '';
}

/** Track ảo theo (track file, kênh) từ lượt quét: track đổi program giữa bài vẫn là một track. */
function groupsFromScan(scan: SmfScan): Group[] {
  const names = new Map<number, string>();
  for (const t of scan.texts) {
    if (t.kind === 'name' && !names.has(t.track)) names.set(t.track, t.text);
  }
  return scan.parts
    .filter((p) => p.notes.length > 0)
    .map((p) => ({
      name: names.get(p.track) ?? '',
      instrument: instrumentName(p.program, p.channel),
      channel: p.channel,
      notes: p.notes,
    }));
}

/** Dự phòng: mỗi track con (program, kênh) của tonejs là một track. */
function groupsFromTonejs(midi: Midi): Group[] {
  return midi.tracks
    .filter((t) => t.notes.length > 0)
    .map((t) => ({
      name: redecode(t.name),
      instrument: instrumentName(t.instrument.number, t.channel),
      channel: t.channel,
      notes: t.notes.map((n) => ({
        midi: n.midi,
        ticks: n.ticks,
        durationTicks: n.durationTicks,
        velocity: Math.round(n.velocity * 127),
        channel: t.channel,
      })),
    }));
}

/** Meta text dự phòng: chỉ có của track đầu (tonejs header.meta). */
function textsFromTonejs(midi: Midi): ScannedText[] {
  const kinds: Readonly<Partial<Record<string, TextKind>>> = {
    marker: 'marker',
  };
  const out: ScannedText[] = [];
  for (const m of midi.header.meta) {
    const kind = kinds[m.type];
    if (kind) out.push({ track: 0, ticks: m.ticks, kind, text: redecode(m.text) });
  }
  return out;
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

function toBytes(data: ArrayBuffer | Uint8Array): Uint8Array {
  // ArrayBuffer.isView: nhận cả Uint8Array khác realm (jsdom / iframe)
  return ArrayBuffer.isView(data)
    ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
    : new Uint8Array(data);
}

/**
 * RIFF-RMID (.rmi, D-198): bản SMF nằm trong chunk `data` của RIFF → trả phần SMF đó. Không phải
 * RIFF-RMID → trả nguyên. RIFF-RMID không có chunk `data` → MidiImportError('invalid'); chunk `data`
 * khai dài hơn file thì lấy phần có (file cụt — để bước đọc SMF xử lý như D-169).
 */
export function unwrapRmid(bytes: Uint8Array): Uint8Array {
  const tag = (off: number, s: string) =>
    off + s.length <= bytes.length &&
    Array.from(s).every((c, i) => bytes[off + i] === c.charCodeAt(0));
  if (!tag(0, 'RIFF') || !tag(8, 'RMID')) return bytes;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let off = 12;
  while (off + 8 <= bytes.length) {
    const size = view.getUint32(off + 4, true);
    if (tag(off, 'data')) {
      return bytes.subarray(off + 8, Math.min(off + 8 + size, bytes.length));
    }
    off += 8 + size + (size & 1);
  }
  throw new MidiImportError('invalid', 'RIFF-RMID without a data chunk');
}

function roundBpm(bpm: number): number {
  return Math.round(bpm * 100) / 100;
}

/** Event đã sắp theo tick → chỉ giữ event CUỐI của mỗi tick (các event trước bị ghi đè tại chỗ). */
function lastPerTick<T extends { ticks: number }>(events: readonly T[]): T[] {
  const out: T[] = [];
  for (const e of events) {
    if (out.length > 0 && out[out.length - 1].ticks === e.ticks) out[out.length - 1] = e;
    else out.push(e);
  }
  return out;
}

/**
 * Parse file .mid / .midi / .kar / .rmi (type 0 và 1; .rmi = SMF bọc RIFF-RMID). Track = (track file, kênh) có nốt; track kênh 10
 * (drum) vẫn có trong kết quả (isDrum) — UI tự ẩn. Velocity nốt 1..127.
 * Lỗi (MidiImportError): > MAX_MIDI_BYTES → 'too-large'; không đọc được (kể cả SMPTE, không có
 * PPQ) → 'invalid'; không có nốt nào → 'no-notes'.
 */
export function parseMidiFile(data: ArrayBuffer | Uint8Array, fileName: string): ParsedMidi {
  const raw = toBytes(data);
  if (raw.byteLength > MAX_MIDI_BYTES) {
    throw new MidiImportError('too-large', `${raw.byteLength} bytes`);
  }
  const bytes = unwrapRmid(raw);

  let midi: Midi;
  try {
    midi = new Midi(bytes);
  } catch (e) {
    throw new MidiImportError('invalid', e instanceof Error ? e.message : String(e));
  }
  const ppq = midi.header.ppq;
  if (!Number.isInteger(ppq) || ppq <= 0) {
    throw new MidiImportError('invalid', 'unsupported time division');
  }

  let scan: SmfScan | null;
  try {
    scan = scanSmf(bytes);
  } catch {
    scan = null;
  }

  const groups = scan ? groupsFromScan(scan) : groupsFromTonejs(midi);
  if (groups.length === 0) throw new MidiImportError('no-notes');
  for (const g of groups) g.notes.sort((a, b) => a.ticks - b.ticks || a.midi - b.midi);
  const notes = groups.map((g) => g.notes);

  // độ dài cả bài: nốt đầu của mọi track (kể cả trống) → hết nốt cuối — mẫu số của mật độ nốt
  let durationTicks = 0;
  let firstTick = Infinity;
  for (const list of notes) {
    for (const n of list) {
      durationTicks = Math.max(durationTicks, n.ticks + n.durationTicks);
      firstTick = Math.min(firstTick, n.ticks);
    }
  }
  const spanBeats = Number.isFinite(firstTick) ? (durationTicks - firstTick) / ppq : 0;
  const tracks = groups.map((g, i) =>
    summarize(i, g.name, g.instrument, g.channel, g.notes, ppq, spanBeats),
  );

  // tonejs gom tempo / nhịp của mọi track, đã sắp (ổn định) theo tick. Nhiều event cùng tick → event
  // sau cùng có hiệu lực (vd. DAW ghi 120 / 4/4 mặc định rồi giá trị thật ngay tại tick 0).
  const bpms = lastPerTick(
    midi.header.tempos
      .map((t) => ({ ticks: t.ticks, bpm: roundBpm(t.bpm) }))
      .filter((t) => Number.isFinite(t.bpm) && t.bpm > 0), // tempo 0 µs → Infinity
  ).map((t) => t.bpm);
  let tempoChanges = 0;
  for (let i = 1; i < bpms.length; i++) if (bpms[i] !== bpms[i - 1]) tempoChanges++;

  const ts0 = lastPerTick(midi.header.timeSignatures)[0] as { timeSignature: number[] } | undefined;
  const ts: TimeSig = { num: ts0?.timeSignature[0] ?? NaN, den: ts0?.timeSignature[1] ?? NaN };

  const texts = scan ? scan.texts : textsFromTonejs(midi);

  return {
    fileName,
    ppq,
    bpm: bpms[0] ?? DEFAULT_BPM_MIDI,
    tempoChanges,
    timeSig: isValidTimeSig(ts) ? ts : { ...DEFAULT_TIME_SIG },
    durationTicks,
    tracks,
    notes,
    markers: metaList(texts, 'marker').filter((m) => m.text.trim() !== ''),
    // lượt quét chặt chẽ lỗi mà tonejs vẫn đọc được = file cụt / hỏng (D-119)
    damaged: scan ? scan.truncated : true,
  };
}

/**
 * Gợi ý track melody (index vào `parsed.tracks`) theo mật độ nốt so với tempo (melodySuggest.ts): số
 * nốt mỗi beat trên cả bài gần 1, đơn âm, không phải âm vực bass, tên gợi ý "melody / vocal / lead…".
 * -1 nếu chỉ có drum.
 */
export function suggestMelodyTrack(parsed: ParsedMidi): number {
  const i = pickMelody(parsed.tracks);
  return i < 0 ? -1 : parsed.tracks[i].index;
}

/**
 * Nốt của một track theo beat (tick / PPQ — tempo change không ảnh hưởng). Index sai → [].
 */
export function trackNotesInBeats(parsed: ParsedMidi, trackIndex: number): BeatNote[] {
  const notes = parsed.notes[trackIndex] as MidiNote[] | undefined;
  return notes ? notesInBeats(parsed, notes) : [];
}

/**
 * Nốt của NHIỀU track gộp lại (giai điệu chia ở nhiều track — Phase 2c), theo beat, sắp theo thời
 * gian. Index sai / trùng bị bỏ.
 */
export function tracksNotesInBeats(
  parsed: ParsedMidi,
  trackIndices: readonly number[],
): BeatNote[] {
  const merged: MidiNote[] = [];
  for (const i of new Set(trackIndices)) {
    const list = parsed.notes[i] as MidiNote[] | undefined;
    for (const n of list ?? []) merged.push(n); // không spread: track rất dài vượt giới hạn tham số
  }
  merged.sort((a, b) => a.ticks - b.ticks || a.midi - b.midi);
  return notesInBeats(parsed, merged);
}

/** `notes` sắp theo tick → BeatNote. */
function notesInBeats(parsed: ParsedMidi, notes: readonly MidiNote[]): BeatNote[] {
  const ppq = parsed.ppq;
  return notes.map((n) => ({
    startBeat: n.ticks / ppq,
    beats: n.durationTicks / ppq,
    midi: n.midi,
  }));
}

/** Marker theo beat (chữ đã gộp khoảng trắng thành 1 dòng, bỏ marker rỗng). */
export function markerBeats(parsed: ParsedMidi): Array<{ beat: number; text: string }> {
  const out: Array<{ beat: number; text: string }> = [];
  for (const m of parsed.markers) {
    const text = m.text.replace(/\s+/g, ' ').trim();
    if (text !== '') out.push({ beat: m.ticks / parsed.ppq, text });
  }
  return out;
}

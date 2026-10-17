import { isNoteKey } from '../core/keys';
import { isValidTimeSig, parseHarm } from '../core/parser';
import { canonicalSong, serializeHarm } from '../core/serializer';
import type { Line, Note, ParseResult, Section, Song, TimeSig, Unit } from '../core/types';
import { DEFAULT_BPM, DEFAULT_SECTION_NAME, DEFAULT_TIME_SIG } from '../core/types';
import type { StringKey } from '../i18n/strings';
import { tNow } from '../i18n/useT';
import { FEATURES } from '../ui/features';
import { getDirective, slugify } from './songSource';

/**
 * Import / export file bài hát. Input là dữ liệu ngoài (unknown) → kiểm shape phòng thủ,
 * không bao giờ throw: lỗi trả về dạng chuỗi đã dịch.
 */

export const SONG_FILE_FORMAT = 'dfht-song';
export const SONG_FILE_VERSION = 1;
/** Giới hạn kích thước file nhập (.harm/.json). */
export const MAX_IMPORT_BYTES = 2 * 1024 * 1024;
export const IMPORT_ACCEPT = '.harm,.json,.txt';

/** Đuôi file nhạc chuẩn mà wizard "Tạo bài từ file" (#/midi) nhận — Nhập file chỉ trỏ sang đó. */
const MIDI_EXTS: ReadonlySet<string> = new Set(['mid', 'midi', 'kar', 'rmi']);
const SCORE_EXTS: ReadonlySet<string> = new Set(['musicxml', 'xml', 'mxl']);

export interface ImportResult {
  sources: string[];
  errors: string[];
}

export interface ExportFile {
  filename: string;
  text: string;
  mime: string;
}

/** Đủ để export: bài trong thư viện hoặc nội dung editor chưa lưu. */
export interface ExportInput {
  id?: string;
  source: string;
  parsed: ParseResult;
}

// ---------------------------------------------------------------------------
// Kiểm shape model (JSON ngoài)
// ---------------------------------------------------------------------------

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** So số beat/bpm bỏ qua sai số float (1/3 × 3, tổng chia đều…). */
function near(a: number, b: number): boolean {
  return Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
}

function positive(v: unknown, fallback: number | null): number | null {
  if (v === undefined) return fallback;
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null;
}

function toNote(raw: unknown): Note | null {
  if (!isRecord(raw) || (raw.kind !== undefined && raw.kind !== 'note')) return null;
  const key = typeof raw.key === 'string' ? raw.key.toUpperCase() : '';
  if (!isNoteKey(key)) return null;
  const octave = raw.octave ?? 0;
  if (octave !== -1 && octave !== 0 && octave !== 1) return null;
  const sharp = raw.sharp ?? false;
  if (typeof sharp !== 'boolean') return null;
  const beats = positive(raw.beats, 1);
  if (beats === null) return null;
  return { kind: 'note', key, octave, sharp, beats };
}

function toUnit(raw: unknown): Unit | null {
  if (!isRecord(raw)) return null;
  if (raw.kind === 'rest') {
    const beats = positive(raw.beats, 1);
    return beats === null ? null : { kind: 'rest', beats };
  }
  if (raw.kind === 'slur') {
    if (!Array.isArray(raw.notes) || raw.notes.length === 0) return null;
    const notes = raw.notes.map(toNote);
    if (!notes.every((n): n is Note => n !== null)) return null;
    // D-014: nốt trong luyến dài bằng nhau (`.harm` chỉ ghi được tổng). JSON tự viết có thể lệch
    // → giữ tổng độ dài, chia đều (D-068), thay vì để serializer gộp sai mà không báo.
    const first = notes[0]?.beats ?? 1;
    if (notes.every((n) => near(n.beats, first))) return { kind: 'slur', notes };
    const each = notes.reduce((sum, n) => sum + n.beats, 0) / notes.length;
    return { kind: 'slur', notes: notes.map((n) => ({ ...n, beats: each })) };
  }
  return toNote(raw);
}

/** Dòng của JSON: chỉ lấy `units` (key `lyric` của dữ liệu cũ bị bỏ qua — đã bỏ tính năng lời). */
function toLine(raw: unknown): Line | null {
  if (!isRecord(raw) || !Array.isArray(raw.units)) return null;
  const units = raw.units.map(toUnit);
  if (!units.every((u): u is Unit => u !== null)) return null;
  return { units };
}

function toSection(raw: unknown): Section | null {
  if (!isRecord(raw) || !Array.isArray(raw.lines)) return null;
  const lines = raw.lines.map(toLine);
  if (!lines.every((l): l is Line => l !== null)) return null;
  const name = typeof raw.name === 'string' && raw.name.trim() ? raw.name : DEFAULT_SECTION_NAME;
  // Dòng không có đơn vị nốt không có trong model parse ra (D-013) → bỏ trước khi serialize.
  return { name, lines: lines.filter((l) => l.units.length > 0) };
}

function toTimeSig(raw: unknown): TimeSig | null {
  if (raw === undefined) return { ...DEFAULT_TIME_SIG };
  if (!isRecord(raw)) return null;
  const { num, den } = raw;
  const ok = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v > 0;
  // Chỉ nhận nhịp mà `@time` ghi được (miền của parser); không thì serializer sẽ âm thầm đổi
  // thành 4/4 (canonicalSong) — coi như sai định dạng thay vì nhập bài đã bị đổi nhịp.
  return ok(num) && ok(den) && isValidTimeSig({ num, den }) ? { num, den } : null;
}

/** Song-like bất kỳ → Song hợp lệ, null nếu sai shape. Field phụ thiếu → mặc định. */
export function toSong(raw: unknown): Song | null {
  if (!isRecord(raw) || !Array.isArray(raw.sections)) return null;
  const sections = raw.sections.map(toSection);
  if (!sections.every((s): s is Section => s !== null)) return null;
  const bpm = positive(raw.bpm, DEFAULT_BPM);
  const timeSig = toTimeSig(raw.timeSig);
  const scrollDir = raw.scrollDir ?? 1;
  if (bpm === null || timeSig === null || (scrollDir !== 1 && scrollDir !== -1)) return null;
  const title = typeof raw.title === 'string' ? raw.title : '';
  const artist = typeof raw.artist === 'string' && raw.artist.trim() ? raw.artist : null;
  return {
    id: typeof raw.id === 'string' ? raw.id : '',
    title,
    ...(artist ? { artist } : {}),
    bpm,
    timeSig,
    scrollDir,
    sections,
  };
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

function normalizeText(text: string): string {
  return (text.startsWith('﻿') ? text.slice(1) : text).replace(/\r\n?/g, '\n');
}

type ItemResult = { ok: true; source: string } | { ok: false; reason: 'shape' | 'serialize' };

const normText = (s: string | undefined): string => (s ?? '').replace(/\s+/g, ' ').trim();

function sameNote(a: Note, b: Note): boolean {
  return a.key === b.key && a.octave === b.octave && a.sharp === b.sharp && near(a.beats, b.beats);
}

function sameUnit(a: Unit, b: Unit): boolean {
  if (a.kind === 'note') return b.kind === 'note' && sameNote(a, b);
  if (a.kind === 'rest') return b.kind === 'rest' && near(a.beats, b.beats);
  return (
    b.kind === 'slur' &&
    a.notes.length === b.notes.length &&
    a.notes.every((n, i) => {
      const other = b.notes[i];
      return other !== undefined && sameNote(n, other);
    })
  );
}

function sameLine(a: Line, b: Line): boolean {
  return (
    a.units.length === b.units.length &&
    a.units.every((u, i) => {
      const other = b.units[i];
      return other !== undefined && sameUnit(u, other);
    })
  );
}

function sameSection(a: Section, b: Section): boolean {
  return (
    normText(a.name) === normText(b.name) &&
    a.lines.length === b.lines.length &&
    a.lines.every((l, i) => {
      const other = b.lines[i];
      return other !== undefined && sameLine(l, other);
    })
  );
}

/**
 * Hai model có cùng nội dung bài không (bỏ qua id, khoảng trắng thừa trong chuỗi, sai số float).
 * Dùng để kiểm `parse(serialize(song))` khi nhập JSON chỉ có model (D-068).
 */
export function sameSongContent(a: Song, b: Song): boolean {
  return (
    normText(a.title) === normText(b.title) &&
    normText(a.artist) === normText(b.artist) &&
    near(a.bpm, b.bpm) &&
    a.timeSig.num === b.timeSig.num &&
    a.timeSig.den === b.timeSig.den &&
    a.scrollDir === b.scrollDir &&
    a.sections.length === b.sections.length &&
    a.sections.every((s, i) => {
      const other = b.sections[i];
      return other !== undefined && sameSection(s, other);
    })
  );
}

function itemSource(value: unknown): ItemResult {
  if (!isRecord(value)) return { ok: false, reason: 'shape' };
  // Ưu tiên văn bản nguồn (giữ comment/@repeat), rồi tới model.
  for (const k of ['source', 'text'] as const) {
    const v = value[k];
    if (typeof v === 'string' && v.trim()) return { ok: true, source: normalizeText(v) };
  }
  const song = value.song !== undefined ? toSong(value.song) : toSong(value);
  if (!song) return { ok: false, reason: 'shape' };
  try {
    const source = serializeHarm(song);
    if (typeof source === 'string' && source.trim()) {
      // Serializer ghi dạng chuẩn `canonicalSong(song)` (luyến 1 nốt thành nốt, luyến lệch độ dài
      // chia đều…). Chỉ nhận khi đọc lại ra đúng dạng chuẩn đó, không thì báo lỗi thay vì lưu bài
      // đã bị đổi (D-068).
      const back = parseHarm(source);
      if (back.ok && sameSongContent(back.song, canonicalSong(song))) return { ok: true, source };
      console.warn('[library] model → .harm round-trip mismatch', back.diagnostics);
    }
  } catch (e) {
    console.warn('[library] serializeHarm failed', e);
  }
  return { ok: false, reason: 'serialize' };
}

function fileExt(name: string): string {
  const m = /\.([a-z0-9]+)$/i.exec(name.trim());
  return m?.[1]?.toLowerCase() ?? '';
}

function looksLikeJson(text: string): boolean {
  const t = text.trimStart();
  return t.startsWith('{') || t.startsWith('[');
}

/**
 * File nhập → danh sách nguồn `.harm`.
 * - `.harm` / `.txt`: nguyên văn (bỏ BOM, CRLF → LF).
 * - `.json`: `{ format:'dfht-song', version, source }` | `{ source }` | `{ song: Song }` |
 *   Song-like `{ sections, … }` | mảng các dạng đó | `{ songs: [...] }`.
 */
export function parseImportFile(name: string, text: string): ImportResult {
  const file = name || '?';
  const ext = fileExt(name);
  if (!text.trim()) return { sources: [], errors: [tNow('library.importErrorEmpty', { file })] };

  const isJson = ext === 'json' || (ext === '' && looksLikeJson(text));
  if (!isJson) {
    if (ext === 'harm' || ext === 'txt' || ext === '') {
      return { sources: [normalizeText(text)], errors: [] };
    }
    // File nhạc chuẩn (MIDI / MusicXML) → chỉ tới "Tạo bài từ file"; cờ tắt thì không chỉ người dùng
    // tới nút không tồn tại.
    let key: StringKey = 'library.importErrorType';
    if (MIDI_EXTS.has(ext)) {
      key = FEATURES.midiImport ? 'library.importErrorMidi' : 'library.importErrorMidiSoon';
    } else if (SCORE_EXTS.has(ext) && FEATURES.midiImport) {
      key = 'library.importErrorScore';
    }
    return { sources: [], errors: [tNow(key, { file })] };
  }

  let data: unknown;
  try {
    data = JSON.parse(normalizeText(text));
  } catch {
    return { sources: [], errors: [tNow('library.importErrorJson', { file })] };
  }

  const reasonText = (reason: 'shape' | 'serialize', index: number | null): string => {
    if (reason === 'serialize') return tNow('library.importErrorSerialize', { file });
    return index === null
      ? tNow('library.importErrorShape', { file })
      : tNow('library.importErrorItem', { file, n: index + 1 });
  };

  // Danh sách: mảng, hoặc gói `{ songs: [...] }` (không phải một bài).
  let list: unknown[] | null = null;
  if (Array.isArray(data)) list = data;
  else if (
    isRecord(data) &&
    Array.isArray(data.songs) &&
    data.source === undefined &&
    data.song === undefined &&
    data.sections === undefined
  ) {
    list = data.songs;
  }

  const sources: string[] = [];
  const errors: string[] = [];
  if (list) {
    if (list.length === 0) errors.push(tNow('library.importErrorEmpty', { file }));
    list.forEach((item, i) => {
      const r = itemSource(item);
      if (r.ok) sources.push(r.source);
      else errors.push(reasonText(r.reason, i));
    });
  } else {
    const r = itemSource(data);
    if (r.ok) sources.push(r.source);
    else errors.push(reasonText(r.reason, null));
  }
  return { sources, errors };
}

/** Đọc File/Blob thành text (UTF-8). */
export function readFileText(file: Blob): Promise<string> {
  if (typeof file.text === 'function') return file.text();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => reject(reader.error ?? new Error('read failed'));
    reader.readAsText(file);
  });
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

/** Tên file từ title (bỏ dấu tiếng Việt), fallback theo id rồi "song". */
export function exportBaseName(entry: ExportInput): string {
  const title = entry.parsed.song.title.trim() || getDirective(entry.source, 'title') || '';
  return slugify(title) || slugify(entry.id ?? '') || 'song';
}

export function exportHarm(entry: ExportInput): ExportFile {
  return {
    filename: `${exportBaseName(entry)}.harm`,
    text: entry.source,
    mime: 'text/plain',
  };
}

export function exportJson(entry: ExportInput): ExportFile {
  const payload = {
    format: SONG_FILE_FORMAT,
    version: SONG_FILE_VERSION,
    source: entry.source,
    song: entry.parsed.song,
  };
  return {
    filename: `${exportBaseName(entry)}.json`,
    text: JSON.stringify(payload, null, 2),
    mime: 'application/json',
  };
}

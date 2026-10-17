import { MAX_MIDI_BYTES, MAX_MUSICXML_BYTES, MAX_MXL_BYTES } from './types';

/**
 * Bước 1 của "Tạo bài từ file": nhận dạng loại file (đuôi, rồi chữ ký byte), giới hạn kích thước,
 * đọc file, lấy file từ thao tác kéo-thả (kể cả kéo thẳng từ thanh tải xuống của trình duyệt).
 * Không React.
 */

export type FileKind = 'midi' | 'mxl' | 'musicxml';

/** `accept` của ô chọn file. */
export const FILE_ACCEPT = [
  '.mid',
  '.midi',
  '.kar',
  '.rmi',
  '.musicxml',
  '.xml',
  '.mxl',
  'audio/midi',
  'audio/x-midi',
  'application/vnd.recordare.musicxml+xml',
  'application/vnd.recordare.musicxml',
].join(',');

export const MAX_BYTES: Readonly<Record<FileKind, number>> = {
  midi: MAX_MIDI_BYTES,
  mxl: MAX_MXL_BYTES,
  musicxml: MAX_MUSICXML_BYTES,
};

/** Không đọc được file (khác lỗi định dạng). */
export class FileReadError extends Error {}
/** File MIDI chỉ có trống. */
export class DrumsOnlyError extends Error {}
/** Không phải MIDI / MusicXML. */
export class UnsupportedFileError extends Error {}
/** Thả vào chỉ có đường dẫn (link, mục tải xuống không kèm file) — không đọc được. */
export class UrlOnlyDropError extends Error {}
export class FileTooLargeError extends Error {
  readonly maxBytes: number;
  readonly size: number;
  constructor(size: number, maxBytes: number) {
    super(`${size} > ${maxBytes} bytes`);
    this.size = size;
    this.maxBytes = maxBytes;
  }
}

export function kindFromName(name: string): FileKind | null {
  const m = /\.([a-z0-9]+)$/i.exec(name.trim());
  switch (m?.[1].toLowerCase()) {
    case 'mid':
    case 'midi':
    case 'kar':
    case 'rmi':
      return 'midi';
    case 'mxl':
      return 'mxl';
    case 'musicxml':
    case 'xml':
      return 'musicxml';
    default:
      return null;
  }
}

/** Loại file theo chữ ký đầu file: `MThd` / RIFF-RMID, ZIP, XML (sau BOM / khoảng trắng). */
export function kindFromBytes(b: Uint8Array): FileKind | null {
  const ascii = (o: number, s: string) =>
    b.length >= o + s.length && Array.from(s).every((c, i) => b[o + i] === c.charCodeAt(0));
  if (ascii(0, 'MThd') || (ascii(0, 'RIFF') && ascii(8, 'RMID'))) return 'midi';
  if (b[0] === 0x50 && b[1] === 0x4b && (b[2] === 3 || b[2] === 5) && (b[3] === 4 || b[3] === 6)) {
    return 'mxl';
  }
  if ((b[0] === 0xff && b[1] === 0xfe) || (b[0] === 0xfe && b[1] === 0xff)) return 'musicxml';
  let i = b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf ? 3 : 0;
  while (i < b.length && (b[i] === 0x20 || b[i] === 0x09 || b[i] === 0x0a || b[i] === 0x0d)) i++;
  return b[i] === 0x3c ? 'musicxml' : null;
}

export function readFileBuffer(file: Blob): Promise<ArrayBuffer> {
  if (typeof file.arrayBuffer === 'function') return file.arrayBuffer();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      reader.result instanceof ArrayBuffer
        ? resolve(reader.result)
        : reject(new Error('read failed'));
    reader.onerror = () => reject(reader.error ?? new Error('read failed'));
    reader.readAsArrayBuffer(file);
  });
}

/** Đọc cả file; lỗi đọc → FileReadError. */
export async function readWholeFile(file: Blob): Promise<Uint8Array> {
  try {
    return new Uint8Array(await readFileBuffer(file));
  } catch (err) {
    throw new FileReadError(err instanceof Error ? err.message : String(err));
  }
}

/**
 * Loại file: theo đuôi; không có đuôi quen thì theo chữ ký đầu file (file tải về từ vài trang web
 * không có đuôi). Không nhận ra → null.
 */
export async function detectFileKind(file: File): Promise<FileKind | null> {
  const byName = kindFromName(file.name);
  if (byName) return byName;
  try {
    return kindFromBytes(new Uint8Array(await readFileBuffer(file.slice(0, 64))));
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Kéo-thả
// ---------------------------------------------------------------------------

/**
 * Thứ đang được kéo: 'file' (có file — `types` có "Files" / "application/x-moz-file", hoặc
 * `items` có kind "file": kéo từ Explorer / Finder và từ thanh tải xuống của Chrome / Edge /
 * Firefox), 'uri' (chỉ có đường dẫn), null (chữ, phần tử trong trang… — không đụng tới).
 */
export function dragPayload(dt: DataTransfer | null | undefined): 'file' | 'uri' | null {
  if (!dt) return null;
  const types = Array.from((dt.types as ArrayLike<string> | undefined) ?? []);
  if (types.includes('Files') || types.includes('application/x-moz-file')) return 'file';
  const items = dt.items as DataTransferItemList | undefined;
  if (items && Array.from(items).some((it) => it.kind === 'file')) return 'file';
  if (types.includes('text/uri-list') || types.includes('DownloadURL')) return 'uri';
  return null;
}

/** File trong lần thả: `files`, không có thì `items` kind "file" (getAsFile). */
export function droppedFiles(dt: DataTransfer | null | undefined): File[] {
  if (!dt) return [];
  const files = Array.from((dt.files as FileList | undefined) ?? []);
  if (files.length > 0) return files;
  const out: File[] = [];
  for (const it of Array.from((dt.items as DataTransferItemList | undefined) ?? [])) {
    if (it.kind !== 'file') continue;
    const f = it.getAsFile();
    if (f) out.push(f);
  }
  return out;
}

/** Thả nhiều file: lấy file đầu tiên có đuôi nhận được, không có thì file đầu. */
export function pickDroppedFile(files: readonly File[]): File | undefined {
  return files.find((f) => kindFromName(f.name) !== null) ?? files[0];
}

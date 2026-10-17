/**
 * Đọc ZIP tối thiểu, bất đồng bộ — đủ cho MusicXML nén `.mxl` (spec Phase 2c), không dependency.
 * EOCD → central directory → local header; method 0 (stored) và 8 (deflate, giải nén bằng
 * `DecompressionStream('deflate-raw')` của trình duyệt). Không hỗ trợ ZIP64, mã hóa, nhiều đĩa.
 * Kích thước giải nén bị chặn khi đang giải nén (không tin số khai trong header — chống zip bomb),
 * và CRC-32 được kiểm để phát hiện file hỏng.
 */

export type ZipErrorCode =
  /** Không phải ZIP / cấu trúc hỏng / ZIP64. */
  | 'invalid'
  | 'encrypted'
  /** Phương pháp nén khác stored / deflate. */
  | 'unsupported-method'
  /** Vượt giới hạn kích thước giải nén. */
  | 'too-large'
  /** Dữ liệu nén lỗi hoặc sai CRC. */
  | 'corrupt'
  /** .mxl không có bản nhạc MusicXML. */
  | 'no-score'
  /** Trình duyệt không có DecompressionStream('deflate-raw'). */
  | 'no-decompress';

export class ZipError extends Error {
  readonly code: ZipErrorCode;
  constructor(code: ZipErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'ZipError';
    this.code = code;
  }
}

export interface ZipEntry {
  /** Đường dẫn trong ZIP (thư mục kết thúc bằng `/`). */
  name: string;
  /** 0 = stored, 8 = deflate. */
  method: number;
  flags: number;
  crc32: number;
  compressedSize: number;
  uncompressedSize: number;
  /** Offset local header. */
  localOffset: number;
}

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_EOCD = 0x06054b50;
const EOCD_SIZE = 22;
const CENTRAL_SIZE = 46;
const LOCAL_SIZE = 30;
const FLAG_ENCRYPTED = 0x1;
const FLAG_UTF8 = 0x800;
/** container.xml chỉ vài trăm byte — chặn riêng cho chắc. */
const CONTAINER_MAX_BYTES = 1024 * 1024;

function toBytes(data: ArrayBuffer | Uint8Array): Uint8Array {
  return ArrayBuffer.isView(data)
    ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
    : new Uint8Array(data);
}

const u16 = (b: Uint8Array, o: number): number => b[o] | (b[o + 1] << 8);
// nhân thay vì << 24 để không ra số âm
const u32 = (b: Uint8Array, o: number): number =>
  (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16)) + b[o + 3] * 0x1000000;

/** File bắt đầu bằng chữ ký ZIP (local header, hoặc ZIP rỗng chỉ có EOCD). */
export function isZip(data: ArrayBuffer | Uint8Array): boolean {
  const b = toBytes(data);
  if (b.length < 4) return false;
  const sig = u32(b, 0);
  return sig === SIG_LOCAL || sig === SIG_EOCD;
}

// ---------------------------------------------------------------------------
// CRC-32 (đa thức 0xEDB88320, như ZIP)
// ---------------------------------------------------------------------------

let crcTable: Uint32Array | null = null;

export function crc32(data: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) crc = crcTable[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

// ---------------------------------------------------------------------------
// Central directory
// ---------------------------------------------------------------------------

function latin1(b: Uint8Array): string {
  let s = '';
  for (const x of b) s += String.fromCharCode(x);
  return s;
}

function decodeName(b: Uint8Array, utf8: boolean): string {
  try {
    return new TextDecoder('utf-8', { fatal: !utf8 }).decode(b);
  } catch {
    return latin1(b); // tên không cờ UTF-8 và không phải UTF-8 hợp lệ (CP437…)
  }
}

/** Tìm End Of Central Directory từ cuối file (comment tối đa 65535 byte). */
function findEocd(b: Uint8Array): number {
  const min = Math.max(0, b.length - EOCD_SIZE - 0xffff);
  for (let i = b.length - EOCD_SIZE; i >= min; i--) {
    if (u32(b, i) === SIG_EOCD && i + EOCD_SIZE + u16(b, i + 20) <= b.length) return i;
  }
  return -1;
}

/** Danh sách entry theo central directory. Lỗi cấu trúc → ZipError('invalid'). */
export function listZipEntries(data: ArrayBuffer | Uint8Array): ZipEntry[] {
  const b = toBytes(data);
  const eocd = findEocd(b);
  if (eocd < 0) throw new ZipError('invalid', 'end of central directory not found');
  const count = u16(b, eocd + 10);
  const size = u32(b, eocd + 12);
  const offset = u32(b, eocd + 16);
  if (count === 0xffff || size === 0xffffffff || offset === 0xffffffff) {
    throw new ZipError('invalid', 'zip64 not supported');
  }
  if (offset + size > eocd) throw new ZipError('invalid', 'central directory out of range');

  const out: ZipEntry[] = [];
  let p = offset;
  for (let i = 0; i < count; i++) {
    if (p + CENTRAL_SIZE > eocd || u32(b, p) !== SIG_CENTRAL) {
      throw new ZipError('invalid', 'bad central directory entry');
    }
    const flags = u16(b, p + 8);
    const nameLen = u16(b, p + 28);
    const extraLen = u16(b, p + 30);
    const commentLen = u16(b, p + 32);
    if (p + CENTRAL_SIZE + nameLen > eocd) throw new ZipError('invalid', 'bad entry name');
    out.push({
      name: decodeName(
        b.subarray(p + CENTRAL_SIZE, p + CENTRAL_SIZE + nameLen),
        (flags & FLAG_UTF8) !== 0,
      ),
      method: u16(b, p + 10),
      flags,
      crc32: u32(b, p + 16),
      compressedSize: u32(b, p + 20),
      uncompressedSize: u32(b, p + 24),
      localOffset: u32(b, p + 42),
    });
    p += CENTRAL_SIZE + nameLen + extraLen + commentLen;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Đọc entry
// ---------------------------------------------------------------------------

function concat(chunks: readonly Uint8Array[], total: number): Uint8Array {
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.byteLength;
  }
  return out;
}

/** Giải nén deflate thô; vượt `maxBytes` thì dừng ngay (không đọc hết). */
async function inflateRaw(raw: Uint8Array, maxBytes: number): Promise<Uint8Array> {
  if (typeof DecompressionStream === 'undefined') throw new ZipError('no-decompress');
  let ds: DecompressionStream;
  try {
    ds = new DecompressionStream('deflate-raw');
  } catch {
    throw new ZipError('no-decompress'); // trình duyệt cũ: có stream nhưng không có deflate-raw
  }
  const writer = ds.writable.getWriter();
  // lỗi phía ghi (dữ liệu hỏng, bị hủy) cũng hiện ở phía đọc → nuốt ở đây cho khỏi unhandled
  writer.write(new Uint8Array(raw)).catch(() => undefined);
  writer.close().catch(() => undefined);
  const reader = ds.readable.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new ZipError('too-large', `> ${maxBytes} bytes`);
      }
      chunks.push(value);
    }
  } catch (err) {
    if (err instanceof ZipError) throw err;
    throw new ZipError('corrupt', err instanceof Error ? err.message : String(err));
  }
  return concat(chunks, total);
}

/**
 * Nội dung một entry (đã giải nén, đã kiểm CRC). `maxBytes`: giới hạn kích thước giải nén (mặc
 * định không giới hạn) — kiểm cả số khai trong header lẫn số byte thật khi giải nén.
 */
export async function readZipEntry(
  data: ArrayBuffer | Uint8Array,
  entry: ZipEntry,
  opts: { maxBytes?: number } = {},
): Promise<Uint8Array> {
  const b = toBytes(data);
  const maxBytes = opts.maxBytes ?? Infinity;
  if ((entry.flags & FLAG_ENCRYPTED) !== 0) throw new ZipError('encrypted');
  if (entry.method !== 0 && entry.method !== 8) {
    throw new ZipError('unsupported-method', `method ${entry.method}`);
  }
  if (entry.uncompressedSize > maxBytes) {
    throw new ZipError('too-large', `${entry.uncompressedSize} bytes`);
  }
  const lo = entry.localOffset;
  if (lo + LOCAL_SIZE > b.length || u32(b, lo) !== SIG_LOCAL) {
    throw new ZipError('invalid', 'bad local header');
  }
  const start = lo + LOCAL_SIZE + u16(b, lo + 26) + u16(b, lo + 28);
  const end = start + entry.compressedSize;
  if (end > b.length) throw new ZipError('corrupt', 'entry data truncated');
  const raw = b.subarray(start, end);

  let out: Uint8Array;
  if (entry.method === 0) {
    if (entry.compressedSize !== entry.uncompressedSize) {
      throw new ZipError('corrupt', 'stored size mismatch');
    }
    out = raw.slice();
  } else {
    out = await inflateRaw(raw, maxBytes);
  }
  if (out.byteLength !== entry.uncompressedSize) throw new ZipError('corrupt', 'size mismatch');
  if (crc32(out) !== entry.crc32) throw new ZipError('corrupt', 'crc mismatch');
  return out;
}

// ---------------------------------------------------------------------------
// MusicXML nén (.mxl)
// ---------------------------------------------------------------------------

/** Chuẩn hóa đường dẫn trong ZIP: `\` → `/`, bỏ `./` và `/` đầu. */
function normPath(p: string): string {
  return p
    .replace(/\\/g, '/')
    .replace(/^(\.\/|\/)+/, '')
    .trim();
}

function unescapeXmlAttr(s: string): string {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, '&');
}

function attrOf(tag: string, name: string): string | null {
  const m = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`).exec(tag);
  return m ? unescapeXmlAttr(m[1] ?? m[2] ?? '') : null;
}

/**
 * Đường dẫn bản nhạc khai trong META-INF/container.xml, theo thứ tự (rootfile đầu tiên là bản nhạc
 * chính; bỏ rootfile khai media-type khác MusicXML, vd. PDF đính kèm).
 */
export function containerRootfiles(xml: string): string[] {
  const out: string[] = [];
  for (const m of xml.matchAll(/<(?:[\w.-]+:)?rootfile\b[^>]*>/g)) {
    const tag = m[0];
    const path = attrOf(tag, 'full-path');
    if (path === null || path.trim() === '') continue;
    const media = attrOf(tag, 'media-type');
    if (media !== null && media.trim() !== '' && !/musicxml|\/xml$|\+xml$/i.test(media)) continue;
    out.push(path);
  }
  return out;
}

const isScoreName = (name: string): boolean => {
  const n = normPath(name).toLowerCase();
  return !n.startsWith('meta-inf/') && !n.endsWith('/') && /\.(musicxml|xml)$/.test(n);
};

/**
 * Lấy bản nhạc MusicXML từ file .mxl: rootfile đầu tiên trong META-INF/container.xml; không có
 * (hoặc container hỏng / trỏ tới file không tồn tại) thì file *.musicxml / *.xml đầu tiên ngoài
 * META-INF. `maxBytes` chặn kích thước bản nhạc giải nén.
 */
export async function readMxlScore(
  data: ArrayBuffer | Uint8Array,
  opts: { maxBytes?: number } = {},
): Promise<{ path: string; data: Uint8Array }> {
  const entries = listZipEntries(data).filter((e) => !e.name.endsWith('/'));
  const byPath = (path: string): ZipEntry | undefined => {
    const want = normPath(path);
    return (
      entries.find((e) => normPath(e.name) === want) ??
      entries.find((e) => normPath(e.name).toLowerCase() === want.toLowerCase())
    );
  };

  let target: ZipEntry | undefined;
  const container = byPath('META-INF/container.xml');
  if (container) {
    try {
      const bytes = await readZipEntry(data, container, { maxBytes: CONTAINER_MAX_BYTES });
      const xml = new TextDecoder('utf-8').decode(bytes);
      for (const path of containerRootfiles(xml)) {
        target = byPath(path);
        if (target) break;
      }
    } catch {
      // container hỏng → tìm thẳng file .musicxml / .xml
    }
  }
  target ??= entries.find((e) => isScoreName(e.name));
  if (!target) throw new ZipError('no-score');
  return { path: target.name, data: await readZipEntry(data, target, opts) };
}

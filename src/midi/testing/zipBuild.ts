import { crc32, deflateRawSync } from 'node:zlib';

/**
 * Ghi file ZIP thật cho test (chỉ test dùng — app không import; cần node:zlib). Entry stored (0)
 * hoặc deflate (8, bằng `deflateRawSync`); CRC-32 theo zlib để kiểm chéo bộ đọc trong zip.ts.
 */

export interface ZipSpecEntry {
  name: string;
  data: Uint8Array | string;
  /** 0 = stored, 8 = deflate (mặc định). Số khác: ghi nguyên văn (để thử method lạ). */
  method?: number;
  /** Ghi đè CRC (thử file hỏng). */
  crc?: number;
  /** Bật cờ mã hóa (dữ liệu vẫn để thô). */
  encrypted?: boolean;
  /** Ghi đè kích thước giải nén khai trong header (thử header nói dối). */
  declaredSize?: number;
}

const enc = new TextEncoder();

function u16(n: number): number[] {
  return [n & 0xff, (n >>> 8) & 0xff];
}

function u32(n: number): number[] {
  return [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff];
}

/** Mảng byte nối dần (không dùng spread cho dữ liệu lớn — tránh tràn stack). */
class Bytes {
  private parts: Uint8Array[] = [];
  length = 0;
  push(...xs: ReadonlyArray<number | Uint8Array | readonly number[]>): void {
    for (const x of xs) {
      const part =
        typeof x === 'number' ? Uint8Array.of(x) : x instanceof Uint8Array ? x : Uint8Array.from(x);
      this.parts.push(part);
      this.length += part.length;
    }
  }
  bytes(): Uint8Array<ArrayBuffer> {
    const out = new Uint8Array(this.length);
    let o = 0;
    for (const p of this.parts) {
      out.set(p, o);
      o += p.length;
    }
    return out;
  }
}

export function buildZip(entries: readonly ZipSpecEntry[], comment = ''): Uint8Array<ArrayBuffer> {
  const local = new Bytes();
  const central = new Bytes();
  for (const e of entries) {
    const raw = typeof e.data === 'string' ? enc.encode(e.data) : e.data;
    const method = e.method ?? 8;
    const body = method === 8 ? new Uint8Array(deflateRawSync(raw)) : raw;
    const crc = e.crc ?? crc32(raw);
    const size = e.declaredSize ?? raw.length;
    const name = enc.encode(e.name);
    const flags = 0x800 | (e.encrypted ? 1 : 0);
    const offset = local.length;
    const common = [
      ...u16(20), // version needed
      ...u16(flags),
      ...u16(method),
      ...u16(0), // giờ
      ...u16(0x21), // ngày (1980-01-01)
      ...u32(crc),
      ...u32(body.length),
      ...u32(size),
      ...u16(name.length),
      ...u16(0), // extra
    ];
    local.push(u32(0x04034b50), common, name, body);
    central.push(
      u32(0x02014b50),
      u16(20), // version made by
      common,
      u16(0), // comment
      u16(0), // disk
      u16(0), // internal attr
      u32(0), // external attr
      u32(offset),
      name,
    );
  }
  const commentBytes = enc.encode(comment);
  const out = new Bytes();
  out.push(
    local.bytes(),
    central.bytes(),
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(entries.length),
    u16(entries.length),
    u32(central.length),
    u32(local.length),
    u16(commentBytes.length),
    commentBytes,
  );
  return out.bytes();
}

/** META-INF/container.xml trỏ tới `path`. */
export function containerXml(...paths: string[]): string {
  const files = paths
    .map(
      (p) => `    <rootfile full-path="${p}" media-type="application/vnd.recordare.musicxml+xml"/>`,
    )
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<container>
  <rootfiles>
${files}
  </rootfiles>
</container>`;
}

/** File .mxl chuẩn: mimetype (stored) + container + bản nhạc (deflate). */
export function buildMxl(scoreXml: string, path = 'score.musicxml'): Uint8Array<ArrayBuffer> {
  return buildZip([
    { name: 'mimetype', data: 'application/vnd.recordare.musicxml', method: 0 },
    { name: 'META-INF/container.xml', data: containerXml(path) },
    { name: path, data: scoreXml },
  ]);
}

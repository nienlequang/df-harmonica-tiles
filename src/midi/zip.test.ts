import { crc32 as zlibCrc32 } from 'node:zlib';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildMxl, buildZip, containerXml } from './testing/zipBuild';
import {
  containerRootfiles,
  crc32,
  isZip,
  listZipEntries,
  readMxlScore,
  readZipEntry,
  ZipError,
} from './zip';

const text = (b: Uint8Array) => new TextDecoder().decode(b);

async function zipError(p: Promise<unknown>): Promise<ZipError> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(ZipError);
    return e as ZipError;
  }
  throw new Error('không ném lỗi');
}

function syncZipError(fn: () => unknown): ZipError {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(ZipError);
    return e as ZipError;
  }
  throw new Error('không ném lỗi');
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('crc32', () => {
  it('khớp zlib', () => {
    const data = new TextEncoder().encode('Đồ Rê Mi — harmonica');
    expect(crc32(data)).toBe(zlibCrc32(data));
    expect(crc32(new Uint8Array())).toBe(0);
  });
});

describe('listZipEntries / readZipEntry', () => {
  it('đọc entry stored và deflate (tên UTF-8, comment cuối file)', async () => {
    const big = 'Lời bài hát tiếng Việt có dấu. '.repeat(500);
    const zip = buildZip(
      [
        { name: 'a.txt', data: 'stored text', method: 0 },
        { name: 'thư mục/bài.xml', data: big },
        { name: 'empty/', data: '', method: 0 },
      ],
      'comment ở cuối',
    );
    expect(isZip(zip)).toBe(true);
    const entries = listZipEntries(zip.buffer as ArrayBuffer);
    expect(entries.map((e) => [e.name, e.method])).toEqual([
      ['a.txt', 0],
      ['thư mục/bài.xml', 8],
      ['empty/', 0],
    ]);
    expect(text(await readZipEntry(zip, entries[0]))).toBe('stored text');
    const inflated = await readZipEntry(zip, entries[1]);
    expect(entries[1].compressedSize).toBeLessThan(entries[1].uncompressedSize);
    expect(text(inflated)).toBe(big);
  });

  it('không phải ZIP / cụt / ZIP64 → invalid', () => {
    expect(isZip(new TextEncoder().encode('<score-partwise/>'))).toBe(false);
    expect(syncZipError(() => listZipEntries(new Uint8Array(10))).code).toBe('invalid');
    const zip = buildZip([{ name: 'a.xml', data: '<a/>' }]);
    // cắt mất EOCD
    expect(syncZipError(() => listZipEntries(zip.slice(0, zip.length - 10))).code).toBe('invalid');
    // central directory trỏ sai chỗ
    const broken = zip.slice();
    const eocd = broken.length - 22;
    broken[eocd + 16] ^= 0x05;
    expect(syncZipError(() => listZipEntries(broken)).code).toBe('invalid');
    // ZIP64 (số entry = 0xFFFF)
    const z64 = zip.slice();
    z64[eocd + 10] = 0xff;
    z64[eocd + 11] = 0xff;
    expect(syncZipError(() => listZipEntries(z64)).code).toBe('invalid');
  });

  it('dữ liệu hỏng: sai CRC, deflate lỗi, dữ liệu cụt → corrupt', async () => {
    const badCrc = buildZip([{ name: 'a.xml', data: '<a/>', crc: 123 }]);
    expect((await zipError(readZipEntry(badCrc, listZipEntries(badCrc)[0]))).code).toBe('corrupt');

    const zip = buildZip([{ name: 'a.xml', data: 'x'.repeat(2000) }]);
    const entry = listZipEntries(zip)[0];
    const garbled = zip.slice();
    // phá dữ liệu nén ngay sau local header (30 byte + tên 5 byte)
    for (let i = 35; i < 35 + entry.compressedSize; i++) garbled[i] = 0xff;
    expect((await zipError(readZipEntry(garbled, entry))).code).toBe('corrupt');

    expect((await zipError(readZipEntry(zip, { ...entry, compressedSize: zip.length }))).code).toBe(
      'corrupt',
    );
    expect((await zipError(readZipEntry(zip, { ...entry, localOffset: 3 }))).code).toBe('invalid');
  });

  it('mã hóa / method lạ / quá giới hạn (kể cả header khai sai kích thước)', async () => {
    const enc = buildZip([{ name: 'a.xml', data: '<a/>', encrypted: true }]);
    expect((await zipError(readZipEntry(enc, listZipEntries(enc)[0]))).code).toBe('encrypted');

    const bz = buildZip([{ name: 'a.xml', data: '<a/>', method: 12 }]);
    expect((await zipError(readZipEntry(bz, listZipEntries(bz)[0]))).code).toBe(
      'unsupported-method',
    );

    const zeros = new Uint8Array(200_000);
    const honest = buildZip([{ name: 'z.xml', data: zeros }]);
    const e1 = listZipEntries(honest)[0];
    expect((await zipError(readZipEntry(honest, e1, { maxBytes: 1000 }))).code).toBe('too-large');

    // header nói dối (khai 10 byte) → vẫn chặn khi đang giải nén
    const liar = buildZip([{ name: 'z.xml', data: zeros, declaredSize: 10 }]);
    const e2 = listZipEntries(liar)[0];
    expect(e2.uncompressedSize).toBe(10);
    expect((await zipError(readZipEntry(liar, e2, { maxBytes: 1000 }))).code).toBe('too-large');
  });

  it('trình duyệt không có DecompressionStream → no-decompress (stored vẫn đọc được)', async () => {
    vi.stubGlobal('DecompressionStream', undefined);
    const zip = buildZip([
      { name: 'a.xml', data: '<a/>' },
      { name: 'b.xml', data: '<b/>', method: 0 },
    ]);
    const [a, b] = listZipEntries(zip);
    expect((await zipError(readZipEntry(zip, a))).code).toBe('no-decompress');
    expect(text(await readZipEntry(zip, b))).toBe('<b/>');

    vi.stubGlobal(
      'DecompressionStream',
      class {
        constructor() {
          throw new TypeError('unsupported format');
        }
      },
    );
    expect((await zipError(readZipEntry(zip, a))).code).toBe('no-decompress');
  });
});

describe('readMxlScore', () => {
  it('container.xml → rootfile đầu tiên', async () => {
    const zip = buildMxl('<score-partwise/>', 'scores/My Song.musicxml');
    const got = await readMxlScore(zip);
    expect(got.path).toBe('scores/My Song.musicxml');
    expect(text(got.data)).toBe('<score-partwise/>');
  });

  it('rootfile PDF bị bỏ qua; đường dẫn khác hoa thường / ./ / \\ vẫn khớp', async () => {
    const container = `<container><rootfiles>
      <rootfile full-path="print.pdf" media-type="application/pdf"/>
      <rootfile media-type='application/vnd.recordare.musicxml+xml' full-path='./Score\\Main.XML'/>
    </rootfiles></container>`;
    const zip = buildZip([
      { name: 'META-INF/container.xml', data: container },
      { name: 'print.pdf', data: '%PDF' },
      { name: 'other.xml', data: '<other/>' },
      { name: 'score/main.xml', data: '<main/>' },
    ]);
    expect(containerRootfiles(container)).toEqual(['./Score\\Main.XML']);
    const got = await readMxlScore(zip);
    expect(got.path).toBe('score/main.xml');
    expect(text(got.data)).toBe('<main/>');
  });

  it('không có container (hoặc container trỏ sai) → *.musicxml / *.xml đầu tiên ngoài META-INF', async () => {
    const zip = buildZip([
      { name: 'META-INF/other.xml', data: '<meta/>' },
      { name: 'readme.txt', data: 'hi' },
      { name: 'song.musicxml', data: '<song/>' },
    ]);
    expect(text((await readMxlScore(zip)).data)).toBe('<song/>');

    const wrong = buildZip([
      { name: 'META-INF/container.xml', data: containerXml('missing.xml') },
      { name: 'real.xml', data: '<real/>' },
    ]);
    expect(text((await readMxlScore(wrong)).data)).toBe('<real/>');

    const corruptContainer = buildZip([
      { name: 'META-INF/container.xml', data: containerXml('a.xml'), crc: 1 },
      { name: 'b.xml', data: '<b/>' },
    ]);
    expect(text((await readMxlScore(corruptContainer)).data)).toBe('<b/>');
  });

  it('không có bản nhạc → no-score; giới hạn kích thước áp cho bản nhạc', async () => {
    const empty = buildZip([{ name: 'readme.txt', data: 'hi' }]);
    expect((await zipError(readMxlScore(empty))).code).toBe('no-score');
    const big = buildMxl(`<score-partwise>${'x'.repeat(5000)}</score-partwise>`);
    expect((await zipError(readMxlScore(big, { maxBytes: 1000 }))).code).toBe('too-large');
  });
});

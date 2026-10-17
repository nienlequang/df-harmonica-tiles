import { describe, expect, it } from 'vitest';
import { CLUSTER_MAX_SPAN_MS, WEBM_IDS, WebmMuxer, encodeVint } from './webm';

// ---------------------------------------------------------------------------
// Bộ đọc EBML tí hon (chỉ cho test): đọc lại file để kiểm cấu trúc.
// ---------------------------------------------------------------------------

interface El {
  id: number;
  /** Vị trí đầu phần tử (byte của ID) trong file. */
  start: number;
  /** Vị trí đầu dữ liệu. */
  dataStart: number;
  size: number;
  children: El[] | null;
}

/** Phần tử chứa phần tử con (master) mà test cần đi vào. */
const MASTER = new Set<number>([
  WEBM_IDS.EBML,
  WEBM_IDS.Segment,
  WEBM_IDS.SeekHead,
  WEBM_IDS.Seek,
  WEBM_IDS.Info,
  WEBM_IDS.Tracks,
  WEBM_IDS.TrackEntry,
  WEBM_IDS.Video,
  WEBM_IDS.Cluster,
  WEBM_IDS.Cues,
  WEBM_IDS.CuePoint,
  WEBM_IDS.CueTrackPositions,
]);

function readId(b: Uint8Array, pos: number): { id: number; len: number } {
  const first = b[pos];
  let len = 1;
  while (len <= 4 && !(first & (0x80 >> (len - 1)))) len++;
  if (len > 4) throw new Error(`bad id at ${pos}`);
  let id = 0;
  for (let i = 0; i < len; i++) id = id * 256 + b[pos + i];
  return { id, len };
}

function readSize(b: Uint8Array, pos: number): { size: number; len: number } {
  const first = b[pos];
  let len = 1;
  while (len <= 8 && !(first & (0x80 >> (len - 1)))) len++;
  if (len > 8) throw new Error(`bad size at ${pos}`);
  let v = first & (0xff >> len);
  for (let i = 1; i < len; i++) v = v * 256 + b[pos + i];
  return { size: v, len };
}

function parse(b: Uint8Array, from: number, to: number): El[] {
  const out: El[] = [];
  let pos = from;
  while (pos < to) {
    const { id, len: il } = readId(b, pos);
    const { size, len: sl } = readSize(b, pos + il);
    const dataStart = pos + il + sl;
    if (dataStart + size > to) throw new Error(`element 0x${id.toString(16)} overflows its parent`);
    out.push({
      id,
      start: pos,
      dataStart,
      size,
      children: MASTER.has(id) ? parse(b, dataStart, dataStart + size) : null,
    });
    pos = dataStart + size;
  }
  expect(pos).toBe(to);
  return out;
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const n = parts.reduce((a, p) => a + p.length, 0);
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

const child = (el: El, id: number): El => {
  const c = el.children?.find((x) => x.id === id);
  if (!c) throw new Error(`missing 0x${id.toString(16)}`);
  return c;
};
const all = (el: El, id: number): El[] => (el.children ?? []).filter((x) => x.id === id);
const uint = (b: Uint8Array, el: El): number => {
  let v = 0;
  for (let i = 0; i < el.size; i++) v = v * 256 + b[el.dataStart + i];
  return v;
};
const str = (b: Uint8Array, el: El): string =>
  new TextDecoder().decode(b.subarray(el.dataStart, el.dataStart + el.size));

function frame(n: number, len = 5): Uint8Array {
  return new Uint8Array(len).fill(n % 256);
}

/** 24 fps, khung khóa mỗi 48 khung. */
function sampleMuxer(frames = 100): WebmMuxer {
  const m = new WebmMuxer({ codecId: 'V_VP8', width: 480, height: 360, frameRate: 24 });
  for (let i = 0; i < frames; i++) {
    m.addFrame({
      data: frame(i, 3 + (i % 7)),
      timestampUs: Math.round((i * 1e6) / 24),
      keyframe: i % 48 === 0,
    });
  }
  return m;
}

describe('encodeVint', () => {
  it('dùng độ dài ngắn nhất, bỏ giá trị toàn bit 1 (dành cho "unknown")', () => {
    expect([...encodeVint(0)]).toEqual([0x80]);
    expect([...encodeVint(126)]).toEqual([0xfe]);
    expect([...encodeVint(127)]).toEqual([0x40, 0x7f]);
    expect([...encodeVint(16382)]).toEqual([0x7f, 0xfe]);
    expect(encodeVint(16383)).toHaveLength(3);
    expect(encodeVint(2 ** 40)).toHaveLength(6);
  });

  it('từ chối số âm / không nguyên / quá lớn', () => {
    expect(() => encodeVint(-1)).toThrow(RangeError);
    expect(() => encodeVint(1.5)).toThrow(RangeError);
    expect(() => encodeVint(2 ** 56)).toThrow(RangeError);
  });
});

describe('WebmMuxer', () => {
  it('file hợp lệ về cấu trúc: EBML header, Segment, SeekHead, Info, Tracks, Cluster, Cues', () => {
    const m = sampleMuxer();
    const bytes = concat(m.finalizeParts());
    const top = parse(bytes, 0, bytes.length);
    expect(top.map((e) => e.id)).toEqual([WEBM_IDS.EBML, WEBM_IDS.Segment]);

    const ebml = top[0];
    expect(str(bytes, child(ebml, WEBM_IDS.DocType))).toBe('webm');
    expect(uint(bytes, child(ebml, WEBM_IDS.EBMLVersion))).toBe(1);
    expect(uint(bytes, child(ebml, WEBM_IDS.DocTypeReadVersion))).toBe(2);

    const seg = top[1];
    // Segment kéo tới hết file (kích thước biết trước, không "unknown").
    expect(seg.dataStart + seg.size).toBe(bytes.length);
    const ids = (seg.children ?? []).map((e) => e.id);
    expect(ids[0]).toBe(WEBM_IDS.SeekHead);
    expect(ids[1]).toBe(WEBM_IDS.Info);
    expect(ids[2]).toBe(WEBM_IDS.Tracks);
    expect(ids[ids.length - 1]).toBe(WEBM_IDS.Cues);
    expect(ids.slice(3, -1).every((id) => id === WEBM_IDS.Cluster)).toBe(true);

    const info = child(seg, WEBM_IDS.Info);
    expect(uint(bytes, child(info, WEBM_IDS.TimecodeScale))).toBe(1_000_000);
    const dur = child(info, WEBM_IDS.Duration);
    expect(dur.size).toBe(8);
    const durMs = new DataView(bytes.buffer, dur.dataStart, 8).getFloat64(0, false);
    // khung cuối (99 / 24 s) + 1 khung
    expect(durMs).toBeCloseTo((99 * 1000) / 24 + 1000 / 24, 0);

    const entry = child(child(seg, WEBM_IDS.Tracks), WEBM_IDS.TrackEntry);
    expect(uint(bytes, child(entry, WEBM_IDS.TrackNumber))).toBe(1);
    expect(uint(bytes, child(entry, WEBM_IDS.TrackType))).toBe(1);
    expect(str(bytes, child(entry, WEBM_IDS.CodecID))).toBe('V_VP8');
    expect(uint(bytes, child(entry, WEBM_IDS.DefaultDuration))).toBe(Math.round(1e9 / 24));
    const video = child(entry, WEBM_IDS.Video);
    expect(uint(bytes, child(video, WEBM_IDS.PixelWidth))).toBe(480);
    expect(uint(bytes, child(video, WEBM_IDS.PixelHeight))).toBe(360);
  });

  it('SimpleBlock: thời gian tăng dần, mỗi Cluster mở bằng khung khóa, dữ liệu khung giữ nguyên', () => {
    const m = sampleMuxer(100);
    expect(m.frameCount).toBe(100);
    const bytes = concat(m.finalizeParts());
    const seg = parse(bytes, 0, bytes.length)[1];
    const clusters = all(seg, WEBM_IDS.Cluster);
    expect(clusters).toHaveLength(3); // khung khóa ở 0, 48, 96
    const times: number[] = [];
    let n = 0;
    for (const c of clusters) {
      const base = uint(bytes, child(c, WEBM_IDS.Timecode));
      const blocks = all(c, WEBM_IDS.SimpleBlock);
      blocks.forEach((blk, j) => {
        const d = blk.dataStart;
        expect(bytes[d]).toBe(0x81); // track 1 (vint)
        const rel = new DataView(bytes.buffer, d + 1, 2).getInt16(0, false);
        expect(rel).toBeGreaterThanOrEqual(0);
        const key = (bytes[d + 3] & 0x80) !== 0;
        expect(key).toBe(j === 0);
        times.push(base + rel);
        const payload = bytes.subarray(d + 4, blk.dataStart + blk.size);
        expect([...payload]).toEqual([...frame(n, 3 + (n % 7))]);
        n++;
      });
    }
    expect(n).toBe(100);
    for (let i = 1; i < times.length; i++) expect(times[i]).toBeGreaterThanOrEqual(times[i - 1]);
    expect(times[47]).toBe(Math.round((47 * 1000) / 24));
  });

  it('SeekHead trỏ đúng Info / Tracks / Cues; Cues trỏ đúng từng Cluster', () => {
    const bytes = concat(sampleMuxer(100).finalizeParts());
    const seg = parse(bytes, 0, bytes.length)[1];
    const base = seg.dataStart;
    const at = (pos: number): number => readId(bytes, base + pos).id;
    for (const s of all(child(seg, WEBM_IDS.SeekHead), WEBM_IDS.Seek)) {
      const idEl = child(s, WEBM_IDS.SeekID);
      const target = uint(bytes, idEl);
      expect(at(uint(bytes, child(s, WEBM_IDS.SeekPosition)))).toBe(target);
    }
    const clusters = all(seg, WEBM_IDS.Cluster);
    const points = all(child(seg, WEBM_IDS.Cues), WEBM_IDS.CuePoint);
    expect(points).toHaveLength(clusters.length);
    points.forEach((p, i) => {
      const pos = uint(
        bytes,
        child(child(p, WEBM_IDS.CueTrackPositions), WEBM_IDS.CueClusterPosition),
      );
      expect(base + pos).toBe(clusters[i].start);
      expect(uint(bytes, child(p, WEBM_IDS.CueTime))).toBe(
        uint(bytes, child(clusters[i], WEBM_IDS.Timecode)),
      );
    });
  });

  it('không có khung khóa lâu quá giới hạn int16 → cắt Cluster mới', () => {
    const m = new WebmMuxer({ codecId: 'V_VP9', width: 64, height: 64 });
    m.addFrame({ data: frame(1), timestampUs: 0, keyframe: true });
    m.addFrame({
      data: frame(2),
      timestampUs: (CLUSTER_MAX_SPAN_MS + 500) * 1000,
      keyframe: false,
    });
    m.addFrame({
      data: frame(3),
      timestampUs: (CLUSTER_MAX_SPAN_MS + 900) * 1000,
      keyframe: false,
    });
    const bytes = concat(m.finalizeParts({ durationMs: 40_000 }));
    const seg = parse(bytes, 0, bytes.length)[1];
    const clusters = all(seg, WEBM_IDS.Cluster);
    expect(clusters).toHaveLength(2);
    expect(uint(bytes, child(clusters[1], WEBM_IDS.Timecode))).toBe(CLUSTER_MAX_SPAN_MS + 500);
    const entry = child(child(seg, WEBM_IDS.Tracks), WEBM_IDS.TrackEntry);
    expect(str(bytes, child(entry, WEBM_IDS.CodecID))).toBe('V_VP9');
    // Không frameRate → không DefaultDuration.
    expect(entry.children?.some((e) => e.id === WEBM_IDS.DefaultDuration)).toBe(false);
    const dur = child(child(seg, WEBM_IDS.Info), WEBM_IDS.Duration);
    expect(new DataView(bytes.buffer, dur.dataStart, 8).getFloat64(0, false)).toBe(40_000);
  });

  it('lỗi: khung đầu không phải khung khóa, thời gian lùi, thời gian âm, kích thước rỗng', () => {
    const m = new WebmMuxer({ codecId: 'V_VP8', width: 16, height: 16 });
    expect(() => m.addFrame({ data: frame(1), timestampUs: 0, keyframe: false })).toThrow(
      /keyframe/,
    );
    m.addFrame({ data: frame(1), timestampUs: 10_000, keyframe: true });
    expect(() => m.addFrame({ data: frame(2), timestampUs: 5_000, keyframe: false })).toThrow(
      /backwards/,
    );
    expect(() => m.addFrame({ data: frame(2), timestampUs: -1, keyframe: false })).toThrow(
      RangeError,
    );
    expect(() => m.addFrame({ data: frame(2), timestampUs: Number.NaN, keyframe: false })).toThrow(
      RangeError,
    );
    expect(() => new WebmMuxer({ codecId: 'V_VP8', width: 0, height: 16 })).toThrow(RangeError);
    expect(() => new WebmMuxer({ codecId: 'V_VP8', width: 1.5, height: 16 })).toThrow(RangeError);
  });

  it('không có khung nào: vẫn là file hợp lệ (không Cluster)', () => {
    const bytes = concat(
      new WebmMuxer({ codecId: 'V_VP8', width: 32, height: 32 }).finalizeParts(),
    );
    const seg = parse(bytes, 0, bytes.length)[1];
    expect(all(seg, WEBM_IDS.Cluster)).toHaveLength(0);
    expect(all(child(seg, WEBM_IDS.Cues), WEBM_IDS.CuePoint)).toHaveLength(0);
  });

  it('finalize → Blob video/webm đúng tổng số byte', () => {
    const m = sampleMuxer(10);
    const size = m.finalizeParts().reduce((a, p) => a + p.length, 0);
    const blob = m.finalize();
    expect(blob.type).toBe('video/webm');
    expect(blob.size).toBe(size);
  });
});

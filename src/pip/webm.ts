/**
 * Bộ ghép WebM tối giản, không dependency — cho video "dựng sẵn" của cửa sổ video nổi (videoPip.ts):
 * MỘT track video VP8 / VP9 (khung lấy từ WebCodecs `VideoEncoder`), khung là SimpleBlock trong
 * Cluster; mỗi khung khóa (keyframe) mở Cluster mới, Cluster cũng được cắt trước khi thời gian tương đối
 * vượt giới hạn int16 (ms). Có SeekHead + Cues (tua / chạy lại được) và Duration trong Info.
 *
 * Mọi kích thước biết trước (ghép khi `finalize`) → không phần tử nào có kích thước "unknown". Dữ liệu
 * khung KHÔNG bị chép: Blob ghép thẳng từ các Uint8Array (chỉ thêm vài byte header mỗi khung).
 * Đơn vị thời gian: TimecodeScale = 1 ms.
 */

/** ID phần tử EBML / Matroska dùng ở đây (giá trị gồm cả bit đánh dấu độ dài). */
export const WEBM_IDS = {
  EBML: 0x1a45dfa3,
  EBMLVersion: 0x4286,
  EBMLReadVersion: 0x42f7,
  EBMLMaxIDLength: 0x42f2,
  EBMLMaxSizeLength: 0x42f3,
  DocType: 0x4282,
  DocTypeVersion: 0x4287,
  DocTypeReadVersion: 0x4285,
  Segment: 0x18538067,
  SeekHead: 0x114d9b74,
  Seek: 0x4dbb,
  SeekID: 0x53ab,
  SeekPosition: 0x53ac,
  Info: 0x1549a966,
  TimecodeScale: 0x2ad7b1,
  MuxingApp: 0x4d80,
  WritingApp: 0x5741,
  Duration: 0x4489,
  Tracks: 0x1654ae6b,
  TrackEntry: 0xae,
  TrackNumber: 0xd7,
  TrackUID: 0x73c5,
  TrackType: 0x83,
  FlagLacing: 0x9c,
  CodecID: 0x86,
  DefaultDuration: 0x23e383,
  Video: 0xe0,
  PixelWidth: 0xb0,
  PixelHeight: 0xba,
  Cluster: 0x1f43b675,
  Timecode: 0xe7,
  SimpleBlock: 0xa3,
  Cues: 0x1c53bb6b,
  CuePoint: 0xbb,
  CueTime: 0xb3,
  CueTrackPositions: 0xb7,
  CueTrack: 0xf7,
  CueClusterPosition: 0xf1,
} as const;

export type WebmCodecId = 'V_VP8' | 'V_VP9';

export interface WebmVideoTrack {
  codecId: WebmCodecId;
  width: number;
  height: number;
  /** Số khung / giây (ghi DefaultDuration); bỏ trống = không ghi. */
  frameRate?: number;
}

export interface WebmFrame {
  /** Dữ liệu khung đã mã hóa (không bị chép — đừng sửa sau khi thêm). */
  data: Uint8Array;
  /** Thời điểm bắt đầu khung (micro giây, như `EncodedVideoChunk.timestamp`). */
  timestampUs: number;
  keyframe: boolean;
}

/** Thời gian tương đối tối đa trong một Cluster trước khi cắt (int16 ms, chừa biên). */
export const CLUSTER_MAX_SPAN_MS = 30_000;

const TRACK_NUMBER = 1;
const MUXING_APP = 'dfht-webm';
const WRITING_APP = 'Delta Force Harmonica Tiles';

type Part = Uint8Array;

/** Tổng số byte của các phần. */
function lengthOf(parts: readonly Part[]): number {
  let n = 0;
  for (const p of parts) n += p.length;
  return n;
}

/** Số nguyên không âm → `width` byte big-endian (an toàn tới 2^53). */
function bigEndian(n: number, width: number): Uint8Array {
  const out = new Uint8Array(width);
  let v = n;
  for (let i = width - 1; i >= 0; i--) {
    out[i] = v % 256;
    v = Math.floor(v / 256);
  }
  return out;
}

/** Số byte tối thiểu để chứa `n` (≥ 1). */
function byteWidth(n: number): number {
  let w = 1;
  let v = Math.floor(n / 256);
  while (v > 0) {
    w++;
    v = Math.floor(v / 256);
  }
  return w;
}

function assertUint(n: number, what: string): void {
  if (!Number.isSafeInteger(n) || n < 0) throw new RangeError(`webm: ${what} must be a uint`);
}

/**
 * Kích thước phần tử dạng vint EBML (1–8 byte, bit đánh dấu độ dài ở byte đầu). Giá trị "toàn bit 1"
 * của mỗi độ dài để dành cho "unknown" nên bị bỏ qua.
 */
export function encodeVint(n: number): Uint8Array {
  assertUint(n, 'size');
  for (let len = 1; len <= 8; len++) {
    const max = 2 ** (7 * len) - 1;
    if (n < max) {
      const out = bigEndian(n, len);
      out[0] |= 1 << (8 - len);
      return out;
    }
  }
  throw new RangeError('webm: size too large');
}

/** ID (đã gồm bit đánh dấu) → 1–4 byte. */
function idBytes(id: number): Uint8Array {
  return bigEndian(id, byteWidth(id));
}

/** Phần tử = ID + kích thước + nội dung (giữ nguyên các phần của nội dung, không chép). */
function element(id: number, children: readonly Part[]): Part[] {
  return [idBytes(id), encodeVint(lengthOf(children)), ...children];
}

function uintEl(id: number, n: number, width?: number): Part[] {
  assertUint(n, 'value');
  return element(id, [bigEndian(n, width ?? byteWidth(n))]);
}

function stringEl(id: number, s: string): Part[] {
  return element(id, [new TextEncoder().encode(s)]);
}

function float64El(id: number, n: number): Part[] {
  const out = new Uint8Array(8);
  new DataView(out.buffer).setFloat64(0, n, false);
  return element(id, [out]);
}

interface PendingBlock {
  timeMs: number;
  keyframe: boolean;
  data: Uint8Array;
}

interface PendingCluster {
  timeMs: number;
  blocks: PendingBlock[];
}

/**
 * Ghép khung video thành WebM. Dùng: `addFrame` theo thứ tự thời gian (khung đầu phải là khung khóa)
 * rồi `finalize()` lấy Blob (hoặc `finalizeParts()` lấy các mảng byte — test đọc lại).
 */
export class WebmMuxer {
  private readonly track: WebmVideoTrack;
  private readonly clusters: PendingCluster[] = [];
  private lastMs = -Infinity;
  private frames = 0;

  constructor(track: WebmVideoTrack) {
    assertUint(track.width, 'width');
    assertUint(track.height, 'height');
    if (track.width === 0 || track.height === 0) throw new RangeError('webm: empty frame size');
    this.track = { ...track };
  }

  get frameCount(): number {
    return this.frames;
  }

  /** Thời điểm (ms) của khung cuối; -Infinity khi chưa có khung. */
  get lastTimestampMs(): number {
    return this.lastMs;
  }

  addFrame(frame: WebmFrame): void {
    if (!Number.isFinite(frame.timestampUs) || frame.timestampUs < 0) {
      throw new RangeError('webm: bad timestamp');
    }
    const timeMs = Math.round(frame.timestampUs / 1000);
    if (timeMs < this.lastMs) throw new RangeError('webm: timestamps must not go backwards');
    const current = this.clusters[this.clusters.length - 1];
    if (!current && !frame.keyframe) throw new Error('webm: the first frame must be a keyframe');
    if (!current || frame.keyframe || timeMs - current.timeMs > CLUSTER_MAX_SPAN_MS) {
      this.clusters.push({
        timeMs,
        blocks: [{ timeMs, keyframe: frame.keyframe, data: frame.data }],
      });
    } else {
      current.blocks.push({ timeMs, keyframe: frame.keyframe, data: frame.data });
    }
    this.lastMs = timeMs;
    this.frames++;
  }

  /** Các phần byte của file WebM hoàn chỉnh (theo thứ tự). `durationMs` mặc định = khung cuối + 1 khung. */
  finalizeParts(opts: { durationMs?: number } = {}): Uint8Array[] {
    const t = this.track;
    const frameMs = t.frameRate && t.frameRate > 0 ? 1000 / t.frameRate : 0;
    const lastEnd = this.frames > 0 ? this.lastMs + frameMs : 0;
    const durationMs =
      opts.durationMs !== undefined && Number.isFinite(opts.durationMs)
        ? Math.max(opts.durationMs, lastEnd)
        : lastEnd;

    const header = element(WEBM_IDS.EBML, [
      ...uintEl(WEBM_IDS.EBMLVersion, 1),
      ...uintEl(WEBM_IDS.EBMLReadVersion, 1),
      ...uintEl(WEBM_IDS.EBMLMaxIDLength, 4),
      ...uintEl(WEBM_IDS.EBMLMaxSizeLength, 8),
      ...stringEl(WEBM_IDS.DocType, 'webm'),
      ...uintEl(WEBM_IDS.DocTypeVersion, 2),
      ...uintEl(WEBM_IDS.DocTypeReadVersion, 2),
    ]);

    const info = element(WEBM_IDS.Info, [
      ...uintEl(WEBM_IDS.TimecodeScale, 1_000_000),
      ...stringEl(WEBM_IDS.MuxingApp, MUXING_APP),
      ...stringEl(WEBM_IDS.WritingApp, WRITING_APP),
      ...float64El(WEBM_IDS.Duration, durationMs),
    ]);

    const trackEntry: Part[] = [
      ...uintEl(WEBM_IDS.TrackNumber, TRACK_NUMBER),
      ...uintEl(WEBM_IDS.TrackUID, 1),
      ...uintEl(WEBM_IDS.TrackType, 1),
      ...uintEl(WEBM_IDS.FlagLacing, 0),
      ...stringEl(WEBM_IDS.CodecID, t.codecId),
    ];
    if (frameMs > 0) {
      trackEntry.push(...uintEl(WEBM_IDS.DefaultDuration, Math.round(frameMs * 1_000_000)));
    }
    trackEntry.push(
      ...element(WEBM_IDS.Video, [
        ...uintEl(WEBM_IDS.PixelWidth, t.width),
        ...uintEl(WEBM_IDS.PixelHeight, t.height),
      ]),
    );
    const tracks = element(WEBM_IDS.Tracks, element(WEBM_IDS.TrackEntry, trackEntry));

    const clusters = this.clusters.map((c) => clusterParts(c));

    // Vị trí tính từ đầu phần dữ liệu của Segment. SeekPosition ghi cố định 8 byte → độ dài SeekHead
    // không phụ thuộc vị trí (tính trước được).
    const seekLen = lengthOf(seekHead(0, 0, 0));
    const infoPos = seekLen;
    const tracksPos = infoPos + lengthOf(info);
    let pos = tracksPos + lengthOf(tracks);
    const clusterPos: number[] = [];
    for (const c of clusters) {
      clusterPos.push(pos);
      pos += lengthOf(c);
    }
    const cuesPos = pos;
    const cues = element(
      WEBM_IDS.Cues,
      this.clusters.flatMap((c, i) =>
        element(WEBM_IDS.CuePoint, [
          ...uintEl(WEBM_IDS.CueTime, c.timeMs),
          ...element(WEBM_IDS.CueTrackPositions, [
            ...uintEl(WEBM_IDS.CueTrack, TRACK_NUMBER),
            ...uintEl(WEBM_IDS.CueClusterPosition, clusterPos[i]),
          ]),
        ]),
      ),
    );
    const segmentBody: Part[] = [
      ...seekHead(infoPos, tracksPos, cuesPos),
      ...info,
      ...tracks,
      ...clusters.flat(),
      ...cues,
    ];
    return [...header, ...element(WEBM_IDS.Segment, segmentBody)];
  }

  /** File WebM hoàn chỉnh (`video/webm`). */
  finalize(opts: { durationMs?: number } = {}): Blob {
    return new Blob(this.finalizeParts(opts) as BlobPart[], { type: 'video/webm' });
  }
}

function seekEntry(id: number, pos: number): Part[] {
  return element(WEBM_IDS.Seek, [
    ...element(WEBM_IDS.SeekID, [idBytes(id)]),
    ...uintEl(WEBM_IDS.SeekPosition, pos, 8),
  ]);
}

function seekHead(infoPos: number, tracksPos: number, cuesPos: number): Part[] {
  return element(WEBM_IDS.SeekHead, [
    ...seekEntry(WEBM_IDS.Info, infoPos),
    ...seekEntry(WEBM_IDS.Tracks, tracksPos),
    ...seekEntry(WEBM_IDS.Cues, cuesPos),
  ]);
}

/** Header SimpleBlock: track (vint) + thời gian tương đối int16 + cờ (0x80 = khung khóa). */
function simpleBlockHeader(rel: number, keyframe: boolean): Uint8Array {
  const out = new Uint8Array(4);
  out[0] = 0x80 | TRACK_NUMBER;
  new DataView(out.buffer).setInt16(1, rel, false);
  out[3] = keyframe ? 0x80 : 0;
  return out;
}

function clusterParts(c: PendingCluster): Part[] {
  const body: Part[] = [...uintEl(WEBM_IDS.Timecode, c.timeMs)];
  for (const b of c.blocks) {
    body.push(
      ...element(WEBM_IDS.SimpleBlock, [
        simpleBlockHeader(b.timeMs - c.timeMs, b.keyframe),
        b.data,
      ]),
    );
  }
  return element(WEBM_IDS.Cluster, body);
}

/**
 * Ghi file Standard MIDI (SMF) thật từ mô tả gọn — chỉ dùng cho test / e2e (fixture tự sinh,
 * spec §6b). Không dùng running status; nốt = note on (9n) + note off (8n); text meta UTF-8.
 */

export type SmfEvent = { tick: number } & (
  | { type: 'note'; midi: number; duration: number; velocity?: number; channel?: number }
  | { type: 'tempo'; bpm: number }
  | { type: 'timeSig'; num: number; den: number }
  | { type: 'marker' | 'lyric' | 'text'; text: string }
  /** Program change (Cn pp) — để thử track đổi tiếng giữa bài. */
  | { type: 'program'; program: number; channel?: number }
  /** Byte thô sau delta-time (vd. running status, sysex) — ghi nguyên văn. */
  | { type: 'raw'; bytes: number[] }
);

export interface SmfTrackSpec {
  /** Tên track (FF 03 ở tick 0). */
  name?: string;
  events: SmfEvent[];
}

export interface SmfSpec {
  format: 0 | 1;
  /** Ticks per quarter note (1..32767). */
  ppq: number;
  tracks: SmfTrackSpec[];
}

// Thứ tự trong cùng tick: meta/program → note off của nốt trước → note on → note off nốt dài 0
const ORDER_META = 0;
const ORDER_OFF = 1;
const ORDER_ON = 2;
const ORDER_OFF_ZERO = 3;

interface RawEvent {
  tick: number;
  order: number;
  seq: number;
  bytes: number[];
}

const TEXT_META: Readonly<Record<'marker' | 'lyric' | 'text', number>> = {
  text: 0x01,
  lyric: 0x05,
  marker: 0x06,
};

function check(cond: boolean, msg: string): void {
  if (!cond) throw new RangeError(`writeSmf: ${msg}`);
}

function isUint(n: number, max: number): boolean {
  return Number.isInteger(n) && n >= 0 && n <= max;
}

/** Variable-length quantity (7 bit / byte, bit cao = còn tiếp). */
export function vlq(n: number): number[] {
  check(isUint(n, 0x0fffffff), `VLQ ngoài miền: ${n}`);
  const out = [n & 0x7f];
  let v = Math.floor(n / 128);
  while (v > 0) {
    out.unshift((v & 0x7f) | 0x80);
    v = Math.floor(v / 128);
  }
  return out;
}

function u16(n: number): number[] {
  return [(n >> 8) & 0xff, n & 0xff];
}

function u32(n: number): number[] {
  return [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
}

function meta(type: number, data: ArrayLike<number>): number[] {
  return [0xff, type, ...vlq(data.length), ...Array.from(data)];
}

function utf8(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function channelOf(ch: number | undefined): number {
  const c = ch ?? 0;
  check(isUint(c, 15), `channel ngoài 0..15: ${c}`);
  return c;
}

function trackEvents(track: SmfTrackSpec): RawEvent[] {
  const out: RawEvent[] = [];
  let seq = 0;
  const push = (tick: number, order: number, bytes: number[]): void => {
    out.push({ tick, order, seq: seq++, bytes });
  };
  if (track.name !== undefined) push(0, ORDER_META - 1, meta(0x03, utf8(track.name)));

  for (const ev of track.events) {
    check(isUint(ev.tick, 0x0fffffff), `tick không hợp lệ: ${ev.tick}`);
    switch (ev.type) {
      case 'note': {
        const ch = channelOf(ev.channel);
        const vel = ev.velocity ?? 100;
        check(isUint(ev.midi, 127), `midi ngoài 0..127: ${ev.midi}`);
        check(isUint(vel, 127) && vel > 0, `velocity ngoài 1..127: ${vel}`);
        check(isUint(ev.duration, 0x0fffffff), `duration không hợp lệ: ${ev.duration}`);
        push(ev.tick, ORDER_ON, [0x90 | ch, ev.midi, vel]);
        push(ev.tick + ev.duration, ev.duration === 0 ? ORDER_OFF_ZERO : ORDER_OFF, [
          0x80 | ch,
          ev.midi,
          0x40,
        ]);
        break;
      }
      case 'tempo': {
        check(Number.isFinite(ev.bpm) && ev.bpm > 0, `bpm không hợp lệ: ${ev.bpm}`);
        const us = Math.round(60_000_000 / ev.bpm);
        check(isUint(us, 0xffffff), `bpm ngoài miền: ${ev.bpm}`);
        push(ev.tick, ORDER_META, meta(0x51, [(us >> 16) & 0xff, (us >> 8) & 0xff, us & 0xff]));
        break;
      }
      case 'timeSig': {
        const pow = Math.log2(ev.den);
        check(isUint(ev.num, 255) && ev.num > 0, `tử số không hợp lệ: ${ev.num}`);
        check(isUint(pow, 255), `mẫu số phải là lũy thừa của 2: ${ev.den}`);
        push(ev.tick, ORDER_META, meta(0x58, [ev.num, pow, 24, 8]));
        break;
      }
      case 'program': {
        const ch = channelOf(ev.channel);
        check(isUint(ev.program, 127), `program ngoài 0..127: ${ev.program}`);
        push(ev.tick, ORDER_META, [0xc0 | ch, ev.program]);
        break;
      }
      case 'raw':
        check(
          ev.bytes.length > 0 && ev.bytes.every((b) => isUint(b, 255)),
          'raw bytes không hợp lệ',
        );
        push(ev.tick, ORDER_META, [...ev.bytes]);
        break;
      default:
        push(ev.tick, ORDER_META, meta(TEXT_META[ev.type], utf8(ev.text)));
    }
  }
  return out.sort((a, b) => a.tick - b.tick || a.order - b.order || a.seq - b.seq);
}

function trackChunk(track: SmfTrackSpec): number[] {
  const body: number[] = [];
  let last = 0;
  for (const ev of trackEvents(track)) {
    body.push(...vlq(ev.tick - last), ...ev.bytes);
    last = ev.tick;
  }
  body.push(0x00, 0xff, 0x2f, 0x00); // end of track
  return [0x4d, 0x54, 0x72, 0x6b, ...u32(body.length), ...body]; // "MTrk"
}

/** Mô tả → byte SMF (MThd + các MTrk). Tham số sai → RangeError. */
export function writeSmf(spec: SmfSpec): Uint8Array {
  check(spec.format === 0 || spec.format === 1, `format phải là 0 hoặc 1: ${String(spec.format)}`);
  check(isUint(spec.ppq, 0x7fff) && spec.ppq > 0, `ppq ngoài 1..32767: ${spec.ppq}`);
  check(spec.format === 1 || spec.tracks.length === 1, 'format 0 phải có đúng 1 track');
  check(spec.tracks.length <= 0xffff, 'quá nhiều track');
  const bytes: number[] = [
    0x4d,
    0x54,
    0x68,
    0x64, // "MThd"
    ...u32(6),
    ...u16(spec.format),
    ...u16(spec.tracks.length),
    ...u16(spec.ppq),
  ];
  for (const t of spec.tracks) bytes.push(...trackChunk(t));
  return Uint8Array.from(bytes);
}

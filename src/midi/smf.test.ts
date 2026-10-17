import { Midi } from '@tonejs/midi';
import { describe, expect, it } from 'vitest';
import type { SmfSpec } from './testing/smf';
import { vlq, writeSmf } from './testing/smf';

const ascii = (s: string): number[] => [...s].map((c) => c.charCodeAt(0));

/** Bytes của chunk MTrk đầu tiên (bỏ 8 byte tiêu đề chunk). */
function firstTrackBody(bytes: Uint8Array): number[] {
  const start = 14; // MThd (8 + 6)
  expect([...bytes.slice(start, start + 4)]).toEqual(ascii('MTrk'));
  const len =
    (bytes[start + 4] << 24) |
    (bytes[start + 5] << 16) |
    (bytes[start + 6] << 8) |
    bytes[start + 7];
  const body = [...bytes.slice(start + 8, start + 8 + len)];
  expect(body.length).toBe(len);
  return body;
}

describe('vlq', () => {
  it('encodes variable-length quantities', () => {
    expect(vlq(0)).toEqual([0x00]);
    expect(vlq(0x7f)).toEqual([0x7f]);
    expect(vlq(0x80)).toEqual([0x81, 0x00]);
    expect(vlq(480)).toEqual([0x83, 0x60]);
    expect(vlq(0x3fff)).toEqual([0xff, 0x7f]);
    expect(vlq(0x4000)).toEqual([0x81, 0x80, 0x00]);
    expect(vlq(0x0fffffff)).toEqual([0xff, 0xff, 0xff, 0x7f]);
  });

  it('rejects out-of-range values', () => {
    expect(() => vlq(-1)).toThrow(RangeError);
    expect(() => vlq(0x10000000)).toThrow(RangeError);
    expect(() => vlq(1.5)).toThrow(RangeError);
  });
});

describe('writeSmf', () => {
  it('writes the MThd header', () => {
    const bytes = writeSmf({ format: 1, ppq: 480, tracks: [{ events: [] }, { events: [] }] });
    expect([...bytes.slice(0, 14)]).toEqual([
      ...ascii('MThd'),
      0,
      0,
      0,
      6,
      0,
      1, // format
      0,
      2, // tracks
      0x01,
      0xe0, // 480
    ]);
  });

  it('writes notes as note on / note off with delta times and end of track', () => {
    const bytes = writeSmf({
      format: 0,
      ppq: 480,
      tracks: [{ events: [{ tick: 0, type: 'note', midi: 60, duration: 480 }] }],
    });
    expect(firstTrackBody(bytes)).toEqual([
      0x00, 0x90, 60, 100, 0x83, 0x60, 0x80, 60, 0x40, 0x00, 0xff, 0x2f, 0x00,
    ]);
  });

  it('orders meta first, then note off before note on at the same tick; zero-length off last', () => {
    const bytes = writeSmf({
      format: 0,
      ppq: 96,
      tracks: [
        {
          events: [
            { tick: 96, type: 'note', midi: 62, duration: 0, channel: 2, velocity: 90 },
            { tick: 96, type: 'note', midi: 64, duration: 96 },
            { tick: 0, type: 'note', midi: 60, duration: 96 },
            { tick: 96, type: 'lyric', text: 'a' },
          ],
        },
      ],
    });
    // prettier-ignore
    expect(firstTrackBody(bytes)).toEqual([
      0x00, 0x90, 60, 100,
      0x60, 0xff, 0x05, 0x01, 0x61, // lyric 'a' tại tick 96
      0x00, 0x80, 60, 0x40, // off nốt trước
      0x00, 0x92, 62, 90, // on (kênh 2)
      0x00, 0x90, 64, 100,
      0x00, 0x82, 62, 0x40, // off nốt dài 0 sau on của nó
      0x60, 0x80, 64, 0x40,
      0x00, 0xff, 0x2f, 0x00,
    ]);
  });

  it('writes tempo, time signature, program, raw and UTF-8 text metas', () => {
    const bytes = writeSmf({
      format: 0,
      ppq: 480,
      tracks: [
        {
          name: 'Sáo',
          events: [
            { tick: 0, type: 'tempo', bpm: 120 },
            { tick: 0, type: 'timeSig', num: 6, den: 8 },
            { tick: 0, type: 'program', program: 73, channel: 1 },
            { tick: 0, type: 'marker', text: 'Điệp khúc' },
            { tick: 0, type: 'text', text: 'hi' },
            { tick: 0, type: 'raw', bytes: [0xf0, 0x01, 0xf7] },
          ],
        },
      ],
    });
    const enc = (s: string): number[] => [...new TextEncoder().encode(s)];
    // prettier-ignore
    expect(firstTrackBody(bytes)).toEqual([
      0x00, 0xff, 0x03, enc('Sáo').length, ...enc('Sáo'),
      0x00, 0xff, 0x51, 0x03, 0x07, 0xa1, 0x20,
      0x00, 0xff, 0x58, 0x04, 6, 3, 24, 8,
      0x00, 0xc1, 73,
      0x00, 0xff, 0x06, enc('Điệp khúc').length, ...enc('Điệp khúc'),
      0x00, 0xff, 0x01, 0x02, 0x68, 0x69,
      0x00, 0xf0, 0x01, 0xf7,
      0x00, 0xff, 0x2f, 0x00,
    ]);
  });

  it('round-trips through @tonejs/midi', () => {
    const spec: SmfSpec = {
      format: 1,
      ppq: 480,
      tracks: [
        {
          events: [
            { tick: 0, type: 'tempo', bpm: 90 },
            { tick: 1920, type: 'tempo', bpm: 140 },
            { tick: 0, type: 'timeSig', num: 3, den: 4 },
          ],
        },
        {
          name: 'Lead',
          events: [
            { tick: 0, type: 'note', midi: 72, duration: 240, velocity: 127 },
            { tick: 240, type: 'note', midi: 74, duration: 720, channel: 3 },
          ],
        },
      ],
    };
    const midi = new Midi(writeSmf(spec));
    expect(midi.header.ppq).toBe(480);
    expect(midi.header.tempos.map((t) => [t.ticks, Math.round(t.bpm)])).toEqual([
      [0, 90],
      [1920, 140],
    ]);
    expect(midi.header.timeSignatures[0].timeSignature).toEqual([3, 4]);
    const notes = midi.tracks.flatMap((t) =>
      t.notes.map((n) => [t.channel, n.midi, n.ticks, n.durationTicks]),
    );
    expect(notes).toEqual([
      [0, 72, 0, 240],
      [3, 74, 240, 720],
    ]);
    expect(midi.tracks[0].name).toBe('Lead');
  });

  it('rejects invalid specs', () => {
    const one = (events: SmfSpec['tracks'][number]['events']): SmfSpec => ({
      format: 0,
      ppq: 480,
      tracks: [{ events }],
    });
    expect(() => writeSmf({ format: 0, ppq: 480, tracks: [] })).toThrow(RangeError);
    expect(() =>
      writeSmf({ format: 0, ppq: 480, tracks: [{ events: [] }, { events: [] }] }),
    ).toThrow(/format 0/);
    expect(() => writeSmf({ format: 2 as 1, ppq: 480, tracks: [] })).toThrow(RangeError);
    expect(() => writeSmf({ format: 1, ppq: 0, tracks: [] })).toThrow(/ppq/);
    expect(() => writeSmf({ format: 1, ppq: 0x8000, tracks: [] })).toThrow(/ppq/);
    expect(() => writeSmf(one([{ tick: -1, type: 'text', text: 'x' }]))).toThrow(/tick/);
    expect(() => writeSmf(one([{ tick: 0, type: 'note', midi: 128, duration: 1 }]))).toThrow(
      /midi/,
    );
    expect(() =>
      writeSmf(one([{ tick: 0, type: 'note', midi: 60, duration: 1, velocity: 0 }])),
    ).toThrow(/velocity/);
    expect(() =>
      writeSmf(one([{ tick: 0, type: 'note', midi: 60, duration: 1, channel: 16 }])),
    ).toThrow(/channel/);
    expect(() => writeSmf(one([{ tick: 0, type: 'note', midi: 60, duration: -1 }]))).toThrow(
      /duration/,
    );
    expect(() => writeSmf(one([{ tick: 0, type: 'tempo', bpm: 0 }]))).toThrow(/bpm/);
    expect(() => writeSmf(one([{ tick: 0, type: 'tempo', bpm: 1 }]))).toThrow(/bpm/);
    expect(() => writeSmf(one([{ tick: 0, type: 'timeSig', num: 4, den: 3 }]))).toThrow(/mẫu số/);
    expect(() => writeSmf(one([{ tick: 0, type: 'timeSig', num: 0, den: 4 }]))).toThrow(/tử số/);
    expect(() => writeSmf(one([{ tick: 0, type: 'program', program: 128 }]))).toThrow(/program/);
    expect(() => writeSmf(one([{ tick: 0, type: 'raw', bytes: [] }]))).toThrow(/raw/);
    expect(() => writeSmf(one([{ tick: 0, type: 'raw', bytes: [256] }]))).toThrow(/raw/);
  });
});

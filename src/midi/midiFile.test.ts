import { Midi } from '@tonejs/midi';
import { describe, expect, it } from 'vitest';
import {
  markerBeats,
  parseMidiFile,
  suggestMelodyTrack,
  trackNotesInBeats,
  tracksNotesInBeats,
  unwrapRmid,
} from './midiFile';
import type { SmfEvent, SmfTrackSpec } from './testing/smf';
import { writeSmf } from './testing/smf';
import type { MidiTrackSummary, ParsedMidi } from './types';
import { MAX_MIDI_BYTES, MidiImportError } from './types';

const PPQ = 480;

/** Chuỗi nốt liền nhau (mỗi nốt `dur` tick) bắt đầu từ `start`. */
function seq(
  pitches: readonly number[],
  opts: { start?: number; dur?: number; channel?: number } = {},
): SmfEvent[] {
  const dur = opts.dur ?? PPQ;
  const start = opts.start ?? 0;
  return pitches.map((midi, i) => ({
    tick: start + i * dur,
    type: 'note' as const,
    midi,
    duration: dur,
    channel: opts.channel,
  }));
}

function file1(...tracks: SmfTrackSpec[]): Uint8Array {
  return writeSmf({ format: 1, ppq: PPQ, tracks });
}

function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(MidiImportError);
    return (e as MidiImportError).code;
  }
  throw new Error('không throw');
}

describe('parseMidiFile — errors', () => {
  it('rejects files over MAX_MIDI_BYTES', () => {
    expect(codeOf(() => parseMidiFile(new Uint8Array(MAX_MIDI_BYTES + 1), 'big.mid'))).toBe(
      'too-large',
    );
    // đúng giới hạn thì vẫn được đọc (ở đây hỏng → invalid, không phải too-large)
    expect(codeOf(() => parseMidiFile(new Uint8Array(MAX_MIDI_BYTES), 'max.mid'))).toBe('invalid');
  });

  it('rejects unreadable data as invalid', () => {
    const ok = file1({ events: seq([60]) });
    const cases: Uint8Array[] = [
      new Uint8Array(0),
      new TextEncoder().encode('hello, this is not a midi file'),
      ok.slice(0, 10), // MThd bị cắt
      (() => {
        const b = ok.slice();
        b[14 + 3] = 0x78; // "MTrx"
        return b;
      })(),
    ];
    for (const c of cases) expect(codeOf(() => parseMidiFile(c, 'bad.mid'))).toBe('invalid');
  });

  it('rejects SMPTE time division (no PPQ)', () => {
    const b = file1({ events: seq([60]) }).slice();
    b[12] = 0xe7; // -25 fps
    b[13] = 0x28;
    expect(codeOf(() => parseMidiFile(b, 'smpte.mid'))).toBe('invalid');
  });

  it('reports no-notes when no track has notes', () => {
    const b = file1(
      { events: [{ tick: 0, type: 'tempo', bpm: 100 }] },
      { name: 'Empty', events: [{ tick: 0, type: 'text', text: 'nothing' }] },
    );
    expect(codeOf(() => parseMidiFile(b, 'empty.mid'))).toBe('no-notes');
  });
});

describe('parseMidiFile — RIFF-RMID (.rmi)', () => {
  const ascii = (t: string) => Array.from(t, (c) => c.charCodeAt(0));
  const u32 = (v: number) => [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff];
  /** RIFF 'RMID' với các chunk (id, dữ liệu); chunk lẻ byte được đệm 1 byte. */
  function riff(chunks: ReadonlyArray<[string, Uint8Array]>): Uint8Array {
    const body: number[] = ascii('RMID');
    for (const [id, data] of chunks) {
      body.push(...ascii(id), ...u32(data.length), ...data);
      if (data.length % 2 === 1) body.push(0);
    }
    return new Uint8Array([...ascii('RIFF'), ...u32(body.length), ...body]);
  }

  it('reads the SMF inside the data chunk (after other chunks, odd sizes padded)', () => {
    const smf = file1({ name: 'Giai điệu', events: seq([60, 62, 64]) });
    const rmi = riff([
      ['INFO', new Uint8Array([1, 2, 3])],
      ['data', smf],
    ]);
    expect(unwrapRmid(rmi)).toEqual(smf);
    expect(unwrapRmid(smf)).toBe(smf);
    const parsed = parseMidiFile(rmi, 'song.rmi');
    expect(parsed).toEqual(parseMidiFile(smf, 'song.rmi'));
    expect(parsed.tracks[0].noteCount).toBe(3);
  });

  it('RIFF-RMID without a data chunk is invalid', () => {
    expect(codeOf(() => parseMidiFile(riff([['INFO', new Uint8Array(4)]]), 'x.rmi'))).toBe(
      'invalid',
    );
  });
});

describe('parseMidiFile — format 1, monophonic', () => {
  const bytes = file1(
    {
      events: [
        { tick: 0, type: 'tempo', bpm: 100 },
        { tick: 0, type: 'timeSig', num: 3, den: 4 },
        { tick: 0, type: 'marker', text: 'Intro' },
      ],
    },
    {
      name: 'Giai điệu',
      events: [{ tick: 0, type: 'program', program: 73 }, ...seq([60, 62, 64, 65, 67])],
    },
  );

  it('summarizes the melody track and drops the empty conductor track', () => {
    const p = parseMidiFile(bytes, 'simple.mid');
    expect(p.fileName).toBe('simple.mid');
    expect(p.ppq).toBe(PPQ);
    expect(p.bpm).toBe(100);
    expect(p.tempoChanges).toBe(0);
    expect(p.timeSig).toEqual({ num: 3, den: 4 });
    expect(p.durationTicks).toBe(5 * PPQ);
    expect(p.tracks).toEqual<MidiTrackSummary[]>([
      {
        index: 0,
        name: 'Giai điệu',
        instrument: 'flute',
        channel: 0,
        isDrum: false,
        noteCount: 5,
        minMidi: 60,
        maxMidi: 67,
        avgMidi: (60 + 62 + 64 + 65 + 67) / 5,
        monophonicRatio: 1,
        notesPerBeat: 1,
      },
    ]);
    expect(p.notes[0][1]).toEqual({
      midi: 62,
      ticks: PPQ,
      durationTicks: PPQ,
      velocity: 100,
      channel: 0,
    });
    expect(p.markers).toEqual([{ ticks: 0, text: 'Intro' }]);
    expect(p).not.toHaveProperty('lyrics');
    expect(suggestMelodyTrack(p)).toBe(0);
  });

  it('converts notes to beats', () => {
    const p = parseMidiFile(bytes, 'simple.mid');
    expect(trackNotesInBeats(p, 0)).toEqual([
      { startBeat: 0, beats: 1, midi: 60 },
      { startBeat: 1, beats: 1, midi: 62 },
      { startBeat: 2, beats: 1, midi: 64 },
      { startBeat: 3, beats: 1, midi: 65 },
      { startBeat: 4, beats: 1, midi: 67 },
    ]);
    expect(trackNotesInBeats(p, 1)).toEqual([]);
    expect(trackNotesInBeats(p, -1)).toEqual([]);
  });

  it('accepts an ArrayBuffer and a Uint8Array view with an offset', () => {
    const fromBuffer = parseMidiFile(bytes.slice().buffer, 'a.mid');
    expect(fromBuffer.tracks[0].noteCount).toBe(5);
    const big = new Uint8Array(bytes.length + 7);
    big.set(bytes, 7);
    const view = parseMidiFile(big.subarray(7), 'b.mid');
    expect(view.tracks[0].noteCount).toBe(5);
  });
});

describe('parseMidiFile — header values', () => {
  it('defaults to 120 bpm and 4/4', () => {
    const p = parseMidiFile(file1({ events: seq([60]) }), 'x.mid');
    expect(p.bpm).toBe(120);
    expect(p.timeSig).toEqual({ num: 4, den: 4 });
    expect(p.tempoChanges).toBe(0);
  });

  it('rounds bpm to 2 decimals and rejects time signatures .harm cannot express', () => {
    const p = parseMidiFile(
      file1({
        events: [
          { tick: 0, type: 'tempo', bpm: 133.333 },
          { tick: 0, type: 'timeSig', num: 5, den: 64 },
          ...seq([60]),
        ],
      }),
      'x.mid',
    );
    expect(p.bpm).toBe(133.33);
    expect(p.timeSig).toEqual({ num: 4, den: 4 });
  });

  it('counts tempo changes; beats come from ticks, not tempo (spec §6b)', () => {
    const p = parseMidiFile(
      file1(
        {
          events: [
            { tick: 0, type: 'tempo', bpm: 120 },
            { tick: 4 * PPQ, type: 'tempo', bpm: 120 }, // lặp lại, không đổi
            { tick: 8 * PPQ, type: 'tempo', bpm: 90 },
            { tick: 12 * PPQ, type: 'tempo', bpm: 150 },
          ],
        },
        { events: seq([60, 62, 64, 65], { dur: 4 * PPQ }) },
      ),
      'tempo.mid',
    );
    expect(p.bpm).toBe(120);
    expect(p.tempoChanges).toBe(2);
    expect(trackNotesInBeats(p, 0).map((n) => [n.startBeat, n.beats])).toEqual([
      [0, 4],
      [4, 4],
      [8, 4],
      [12, 4],
    ]);
  });

  it('several tempo / time signature events at one tick: the last one is in effect', () => {
    // DAW ghi mặc định 120 + 4/4 rồi giá trị thật ngay tại tick 0
    const p = parseMidiFile(
      file1(
        {
          events: [
            { tick: 0, type: 'tempo', bpm: 120 },
            { tick: 0, type: 'timeSig', num: 4, den: 4 },
            { tick: 0, type: 'tempo', bpm: 72 },
            { tick: 0, type: 'timeSig', num: 3, den: 4 },
            { tick: 6 * PPQ, type: 'tempo', bpm: 72 }, // lặp lại, không đổi
          ],
        },
        { events: seq([60, 62, 64]) },
      ),
      'defaults.mid',
    );
    expect(p.bpm).toBe(72);
    expect(p.timeSig).toEqual({ num: 3, den: 4 });
    expect(p.tempoChanges).toBe(0);

    // event của track sau cùng tick ghi đè track trước (theo thứ tự file); đổi tempo thật vẫn đếm
    const q = parseMidiFile(
      file1(
        { events: [{ tick: 0, type: 'tempo', bpm: 100 }] },
        {
          events: [
            { tick: 0, type: 'tempo', bpm: 90 },
            { tick: 4 * PPQ, type: 'tempo', bpm: 60 },
            { tick: 4 * PPQ, type: 'tempo', bpm: 90 },
            ...seq([60, 62, 64]),
          ],
        },
      ),
      'two.mid',
    );
    expect(q.bpm).toBe(90);
    expect(q.tempoChanges).toBe(0);
  });
});

describe('parseMidiFile — tracks and channels', () => {
  it('splits a format 0 track into one virtual track per channel', () => {
    const p = parseMidiFile(
      writeSmf({
        format: 0,
        ppq: PPQ,
        tracks: [
          {
            name: 'Song',
            events: [
              { tick: 0, type: 'program', program: 0, channel: 0 },
              { tick: 0, type: 'program', program: 73, channel: 1 },
              ...seq([48, 50, 52], { channel: 0 }),
              ...seq([72, 74, 76, 77], { channel: 1 }),
              ...seq([36, 38], { channel: 9 }),
            ],
          },
        ],
      }),
      'type0.mid',
    );
    expect(p.tracks.map((t) => [t.name, t.channel, t.instrument, t.isDrum, t.noteCount])).toEqual([
      ['Song', 0, 'acoustic grand piano', false, 3],
      ['Song', 1, 'flute', false, 4],
      ['Song', 9, 'standard kit', true, 2],
    ]);
    expect(p.notes[1].every((n) => n.channel === 1)).toBe(true);
    expect(suggestMelodyTrack(p)).toBe(1);
  });

  it('keeps a channel that changes program mid-song as one track', () => {
    const bytes = file1({
      name: 'Lead',
      events: [
        { tick: 0, type: 'program', program: 0 },
        ...seq([60, 62, 64, 65]),
        { tick: 4 * PPQ, type: 'program', program: 40 },
        ...seq([67, 69, 71, 72], { start: 4 * PPQ }),
      ],
    });
    // tonejs tự tách theo (program, kênh) thành 2 track
    expect(new Midi(bytes).tracks.filter((t) => t.notes.length > 0)).toHaveLength(2);
    const p = parseMidiFile(bytes, 'prog.mid');
    expect(p.tracks).toHaveLength(1);
    expect(p.tracks[0]).toMatchObject({
      name: 'Lead',
      instrument: 'acoustic grand piano',
      noteCount: 8,
    });
    expect(p.notes[0].map((n) => n.midi)).toEqual([60, 62, 64, 65, 67, 69, 71, 72]);
  });

  it('keeps separate file tracks on the same channel apart; unnamed → "Track N"', () => {
    const p = parseMidiFile(
      file1({ events: seq([72, 74]) }, { events: seq([48, 50, 52]) }),
      'two.mid',
    );
    expect(p.tracks.map((t) => [t.index, t.name, t.channel, t.noteCount])).toEqual([
      [0, 'Track 1', 0, 2],
      [1, 'Track 2', 0, 3],
    ]);
  });

  it('reads running status, sysex and channel prefix events', () => {
    const p = parseMidiFile(
      writeSmf({
        format: 0,
        ppq: PPQ,
        tracks: [
          {
            name: 'Raw',
            events: [
              { tick: 0, type: 'raw', bytes: [0xff, 0x20, 0x01, 0x05] }, // channel prefix kênh 5
              { tick: 0, type: 'raw', bytes: [0xf0, 0x02, 0x7e, 0xf7] }, // sysex
              { tick: 0, type: 'raw', bytes: [0x90, 60, 100] },
              { tick: 0, type: 'raw', bytes: [64, 100] }, // running status
              { tick: PPQ, type: 'raw', bytes: [0x80, 60, 64] },
              { tick: PPQ, type: 'raw', bytes: [64, 64] }, // running status note off
              { tick: PPQ, type: 'raw', bytes: [0x90, 67, 0] }, // note on vel 0 = off… không có on
            ],
          },
        ],
      }),
      'raw.mid',
    );
    expect(p.tracks).toHaveLength(1);
    // tên lấy từ lượt quét (tonejs đặt tên vào track con của channel prefix, track nốt không tên)
    expect(p.tracks[0]).toMatchObject({ name: 'Raw', channel: 0, noteCount: 2 });
    expect(p.notes[0].map((n) => [n.midi, n.ticks, n.durationTicks])).toEqual([
      [60, 0, PPQ],
      [64, 0, PPQ],
    ]);
    expect(p.tracks[0].monophonicRatio).toBe(0);
  });

  it('pairs note on/off per channel and pitch (FIFO, velocity 0 = off, unterminated dropped)', () => {
    const p = parseMidiFile(
      writeSmf({
        format: 0,
        ppq: PPQ,
        tracks: [
          {
            events: [
              { tick: 0, type: 'raw', bytes: [0x90, 60, 90] },
              { tick: PPQ / 2, type: 'raw', bytes: [0x90, 60, 80] }, // cùng cao độ chồng lên
              { tick: PPQ / 2, type: 'raw', bytes: [0x91, 60, 70] }, // kênh khác
              { tick: PPQ, type: 'raw', bytes: [0x90, 60, 0] }, // vel 0 = off → tắt nốt đầu
              { tick: 2 * PPQ, type: 'raw', bytes: [0x80, 60, 0] },
              { tick: 2 * PPQ, type: 'raw', bytes: [0x81, 60, 0] },
              { tick: 2 * PPQ, type: 'raw', bytes: [0x90, 72, 100] }, // không có off → bỏ
            ],
          },
        ],
      }),
      'pairs.mid',
    );
    expect(p.tracks.map((t) => [t.channel, t.noteCount])).toEqual([
      [0, 2],
      [1, 1],
    ]);
    expect(p.notes[0].map((n) => [n.ticks, n.durationTicks, n.velocity])).toEqual([
      [0, PPQ, 90],
      [PPQ / 2, (3 * PPQ) / 2, 80],
    ]);
    expect(p.notes[1][0]).toEqual({
      midi: 60,
      ticks: PPQ / 2,
      durationTicks: (3 * PPQ) / 2,
      velocity: 70,
      channel: 1,
    });
    expect(p.durationTicks).toBe(2 * PPQ);
  });

  it('falls back to tonejs data when the strict scan fails (truncated last event)', () => {
    const ok = writeSmf({
      format: 0,
      ppq: PPQ,
      tracks: [
        {
          name: 'Sáo',
          events: [{ tick: 0, type: 'lyric', text: 'Em' }, ...seq([60, 62])],
        },
      ],
    });
    // bỏ end-of-track, thêm meta bị cắt cụt (midi-file vẫn đọc được, lượt quét chặt thì không)
    const body = [...ok.slice(22, ok.length - 4), 0x00, 0xff, 0x05];
    const len = body.length;
    const bytes = Uint8Array.from([
      ...ok.slice(0, 14),
      0x4d,
      0x54,
      0x72,
      0x6b,
      (len >>> 24) & 0xff,
      (len >>> 16) & 0xff,
      (len >>> 8) & 0xff,
      len & 0xff,
      ...body,
    ]);
    const p = parseMidiFile(bytes, 'trunc.mid');
    expect(p.tracks[0]).toMatchObject({ name: 'Sáo', noteCount: 2 });
    expect(trackNotesInBeats(p, 0).map((n) => n.midi)).toEqual([60, 62]);
    // đọc được một phần nhưng phải báo (spec: "File lỗi thì báo rõ")
    expect(p.damaged).toBe(true);
  });

  it('flags a file cut short (chunk longer than the file, missing tracks) as damaged', () => {
    const scale = [60, 62, 64, 65, 67, 69, 71, 72];
    const whole = writeSmf({
      format: 0,
      ppq: PPQ,
      tracks: [{ events: seq([...scale, ...scale, ...scale, ...scale]) }],
    });
    expect(parseMidiFile(whole, 'ok.mid').damaged).toBe(false);
    // cắt còn 60% (giữa một event hoặc đúng ranh giới event) → vẫn đọc phần đầu, có cờ damaged
    for (const cut of [Math.floor(whole.length * 0.6), Math.floor(whole.length * 0.6) + 1]) {
      const p = parseMidiFile(whole.slice(0, cut), 'truncated.mid');
      expect(p.damaged).toBe(true);
      expect(p.tracks[0].noteCount).toBeGreaterThan(0);
      expect(p.tracks[0].noteCount).toBeLessThan(32);
    }
    // header khai 2 track nhưng file chỉ có 1
    const two = file1({ events: seq([60, 62]) }, { events: seq([64, 65]) });
    const firstTrackEnd = 14 + 8 + ((two[18] << 24) | (two[19] << 16) | (two[20] << 8) | two[21]);
    const p = parseMidiFile(two.slice(0, firstTrackEnd), 'one-of-two.mid');
    expect(p.damaged).toBe(true);
    expect(p.tracks.map((tr) => tr.noteCount)).toEqual([2]);
  });
});

describe('monophonicRatio', () => {
  it('counts overlapped duration of every overlapping note', () => {
    const p = parseMidiFile(
      file1(
        {
          events: [
            { tick: 0, type: 'note', midi: 60, duration: PPQ },
            { tick: PPQ / 2, type: 'note', midi: 64, duration: PPQ },
          ],
        },
        { events: seq([60, 62, 64]) }, // nối liền: không chồng
        {
          events: [
            ...seq([60, 64, 67], { dur: 0, start: 0 }).map((e) => ({ ...e, tick: 0 })),
            { tick: 0, type: 'note', midi: 48, duration: 2 * PPQ },
            { tick: 0, type: 'note', midi: 55, duration: 2 * PPQ },
          ],
        },
      ),
      'mono.mid',
    );
    // [0,480) và [240,720): 2 nốt chồng 240 tick → 480 / 960
    expect(p.tracks[0].monophonicRatio).toBe(0.5);
    expect(p.tracks[1].monophonicRatio).toBe(1);
    // nốt dài 0 không tính; 2 nốt dài 2 beat chồng hoàn toàn
    expect(p.tracks[2].monophonicRatio).toBe(0);
  });

  it('a legato tail (≤ 1/8 beat past the next onset) is not polyphony', () => {
    const held = (pitches: readonly number[], hold: number): SmfEvent[] =>
      pitches.map((midi, i) => ({
        tick: i * PPQ,
        type: 'note' as const,
        midi,
        duration: PPQ + hold,
      }));
    const p = parseMidiFile(
      file1(
        { events: held([60, 62, 64, 65, 67], PPQ / 10) }, // chồng 0,1 beat → legato
        { events: held([60, 62, 64, 65, 67], PPQ / 8) }, // đúng ngưỡng 1/8 beat
        { events: held([60, 62, 64, 65, 67], PPQ / 4) }, // 0,25 beat → chồng thật
      ),
      'legato.mid',
    );
    expect(p.tracks[0].monophonicRatio).toBe(1);
    expect(p.tracks[1].monophonicRatio).toBe(1);
    expect(p.tracks[2].monophonicRatio).toBeLessThan(0.9);
  });
});

describe('lyric / text meta events (tính năng lời đã bỏ)', () => {
  it('are ignored: the notes import exactly as without them, notes carry no lyric', () => {
    const voice: SmfEvent[] = [
      ...seq([67, 69, 71]),
      { tick: 0, type: 'lyric', text: 'Em' },
      { tick: PPQ, type: 'lyric', text: 'của' },
      { tick: 2 * PPQ, type: 'text', text: 'ngày' },
    ];
    const withWords = parseMidiFile(file1({ name: 'Voice', events: voice }), 'w.mid');
    const plain = parseMidiFile(file1({ name: 'Voice', events: seq([67, 69, 71]) }), 'p.mid');
    expect(withWords).not.toHaveProperty('lyrics');
    expect(withWords.tracks).toEqual(plain.tracks);
    expect(trackNotesInBeats(withWords, 0)).toEqual(trackNotesInBeats(plain, 0));
    expect(trackNotesInBeats(withWords, 0).every((n) => !('lyric' in n))).toBe(true);
  });

  it('a .kar file (karaoke text events) still imports its notes', () => {
    const kar = file1(
      { events: [{ tick: 0, type: 'text', text: '@KMIDI KARAOKE FILE' }] },
      { name: 'Words', events: [{ tick: 0, type: 'text', text: 'Ma' }, ...seq([64, 62, 60])] },
    );
    const p = parseMidiFile(kar, 'mary.kar');
    expect(p.tracks.map((t) => t.name)).toEqual(['Words']);
    expect(trackNotesInBeats(p, 0).map((n) => n.midi)).toEqual([64, 62, 60]);
  });
});

describe('markers', () => {
  it('collects markers from all tracks; markerBeats normalizes text', () => {
    const p = parseMidiFile(
      file1(
        {
          events: [
            { tick: 8 * PPQ, type: 'marker', text: 'Điệp\nkhúc ' },
            { tick: 0, type: 'marker', text: 'Intro' },
            { tick: 4 * PPQ, type: 'marker', text: '   ' },
          ],
        },
        { events: [{ tick: 16 * PPQ, type: 'marker', text: 'Coda' }, ...seq([60])] },
      ),
      'm.mid',
    );
    expect(p.markers.map((m) => m.ticks)).toEqual([0, 8 * PPQ, 16 * PPQ]);
    expect(markerBeats(p)).toEqual([
      { beat: 0, text: 'Intro' },
      { beat: 8, text: 'Điệp khúc' },
      { beat: 16, text: 'Coda' },
    ]);
  });
});

describe('suggestMelodyTrack (mật độ nốt so với tempo — góp ý 2026-10-15)', () => {
  const t = (over: Partial<MidiTrackSummary>, index: number): MidiTrackSummary => ({
    index,
    name: `T${index}`,
    instrument: '',
    channel: 0,
    isDrum: false,
    noteCount: 100,
    minMidi: 40,
    maxMidi: 80,
    avgMidi: 60,
    monophonicRatio: 1,
    notesPerBeat: 1,
    ...over,
  });
  const parsed = (tracks: Array<Partial<MidiTrackSummary>>): ParsedMidi => ({
    fileName: 'x.mid',
    ppq: PPQ,
    bpm: 120,
    tempoChanges: 0,
    timeSig: { num: 4, den: 4 },
    durationTicks: 0,
    tracks: tracks.map(t),
    notes: tracks.map(() => []),
    markers: [],
    damaged: false,
  });

  it('prefers ~1 note per beat over the track with the most notes', () => {
    expect(
      suggestMelodyTrack(
        parsed([
          { noteCount: 100, notesPerBeat: 1, avgMidi: 40 }, // bass
          { noteCount: 600, notesPerBeat: 3.5, avgMidi: 62, monophonicRatio: 0.1 }, // hợp âm
          { noteCount: 120, notesPerBeat: 1.2, avgMidi: 72, monophonicRatio: 0.92 }, // melody
          { noteCount: 30, notesPerBeat: 0.3, avgMidi: 90 }, // điểm xuyết thưa
          { noteCount: 400, notesPerBeat: 3.3, avgMidi: 95, isDrum: true, channel: 9 },
        ]),
      ),
    ).toBe(2);
  });

  it('equal candidates keep file order; a melody-like name breaks a near tie', () => {
    expect(suggestMelodyTrack(parsed([{ avgMidi: 70 }, { avgMidi: 70 }]))).toBe(0);
    expect(
      suggestMelodyTrack(
        parsed([
          { avgMidi: 71, name: 'Strings' },
          { avgMidi: 69, name: 'Vocal' },
        ]),
      ),
    ).toBe(1);
  });

  it('nothing in band → the least bad track', () => {
    expect(
      suggestMelodyTrack(
        parsed([
          { notesPerBeat: 5, monophonicRatio: 0.2, avgMidi: 64 },
          { notesPerBeat: 0.1, avgMidi: 72 },
          { notesPerBeat: 2.9, monophonicRatio: 0.9, avgMidi: 70 },
        ]),
      ),
    ).toBe(2);
  });

  it('returns -1 when there are only drum tracks', () => {
    expect(suggestMelodyTrack(parsed([{ isDrum: true, channel: 9 }]))).toBe(-1);
    expect(suggestMelodyTrack(parsed([]))).toBe(-1);
  });

  it('one melodic track (plus drums) → that track whatever its density', () => {
    expect(
      suggestMelodyTrack(
        parsed([
          { isDrum: true, channel: 9 },
          { notesPerBeat: 6, monophonicRatio: 0, avgMidi: 50 },
        ]),
      ),
    ).toBe(1);
  });

  it('density = notes / beats of the whole song (first note of any track → last note end)', () => {
    // melody 16 nốt đen ở beat 4..20, trống từ beat 0 tới 32 → bài dài 32 beat
    const p = parseMidiFile(
      file1(
        {
          name: 'Lead',
          events: seq(
            Array.from({ length: 16 }, (_, i) => 70 + (i % 4)),
            { start: 4 * PPQ },
          ),
        },
        {
          name: 'Drums',
          events: seq(
            Array.from({ length: 32 }, () => 42),
            { channel: 9 },
          ),
        },
      ),
      'span.mid',
    );
    expect(p.tracks.map((x) => [x.name, x.notesPerBeat])).toEqual([
      ['Lead', 0.5],
      ['Drums', 1],
    ]);
  });

  it('picks the melody in a realistic file (chords + bass + melody + drums)', () => {
    const chords: SmfEvent[] = [];
    for (let bar = 0; bar < 8; bar++) {
      for (const m of [60, 64, 67]) {
        chords.push({ tick: bar * 4 * PPQ, type: 'note', midi: m, duration: 4 * PPQ, channel: 1 });
      }
    }
    const melody = seq(
      Array.from({ length: 32 }, (_, i) => 72 + (i % 5)),
      { channel: 2 },
    );
    const bass = seq(
      Array.from({ length: 16 }, (_, i) => 36 + (i % 3)),
      { dur: 2 * PPQ, channel: 3 },
    );
    const drums = seq(
      Array.from({ length: 64 }, () => 42),
      { dur: PPQ / 2, channel: 9 },
    );
    const p = parseMidiFile(
      file1(
        { name: 'Chords', events: chords },
        { name: 'Bass', events: bass },
        { name: 'Melody', events: melody },
        { name: 'Drums', events: drums },
      ),
      'band.mid',
    );
    expect(p.tracks.map((x) => x.name)).toEqual(['Chords', 'Bass', 'Melody', 'Drums']);
    expect(p.tracks[3].isDrum).toBe(true);
    expect(p.tracks.map((x) => x.notesPerBeat)).toEqual([0.75, 0.5, 1, 2]);
    expect(suggestMelodyTrack(p)).toBe(2);
  });

  it('a chordal piano with far more notes (unnamed tracks) does not win', () => {
    // piano: hợp âm 4 nốt mỗi phách (128 nốt / 32 beat = 4 nốt mỗi beat); melody 1 nốt mỗi beat
    const piano: SmfEvent[] = [];
    for (let beat = 0; beat < 32; beat++) {
      for (const m of [55, 60, 64, 67]) {
        piano.push({ tick: beat * PPQ, type: 'note', midi: m, duration: PPQ, channel: 0 });
      }
    }
    const melody = seq(
      Array.from({ length: 32 }, (_, i) => 67 + (i % 6)),
      { channel: 1 },
    );
    const p = parseMidiFile(file1({ events: piano }, { events: melody }), 'piano.mid');
    expect(p.tracks[0].noteCount).toBe(128);
    expect(p.tracks[0].notesPerBeat).toBe(4);
    expect(p.tracks[0].monophonicRatio).toBe(0);
    expect(suggestMelodyTrack(p)).toBe(1);
  });

  it('a sparse pad high above the melody does not win', () => {
    // pad: 1 nốt ngân 8 beat mỗi 2 ô nhịp, rất cao; melody: nốt móc đơn + nghỉ ≈ 1,25 nốt / beat
    const pad = seq([84, 86, 88, 89], { dur: 8 * PPQ, channel: 0 });
    const melody: SmfEvent[] = [];
    for (let bar = 0; bar < 8; bar++) {
      for (let k = 0; k < 5; k++) {
        melody.push({
          tick: bar * 4 * PPQ + k * (PPQ / 2),
          type: 'note',
          midi: 64 + k,
          duration: PPQ / 2,
          channel: 1,
        });
      }
    }
    const p = parseMidiFile(file1({ events: pad }, { events: melody }), 'pad.mid');
    expect(p.tracks[0].notesPerBeat).toBe(0.125);
    expect(p.tracks[1].notesPerBeat).toBe(1.25);
    expect(suggestMelodyTrack(p)).toBe(1);
  });

  it('tempo changes do not distort the density (beats come from ticks)', () => {
    // nửa đầu 60 BPM, nửa sau 240 BPM: số nốt mỗi phút thật đổi gấp 4 nhưng mật độ theo beat vẫn 1
    const p = parseMidiFile(
      file1(
        {
          events: [
            { tick: 0, type: 'tempo', bpm: 60 },
            { tick: 16 * PPQ, type: 'tempo', bpm: 240 },
          ],
        },
        {
          name: 'Line',
          events: seq(
            Array.from({ length: 32 }, (_, i) => 70 + (i % 3)),
            { channel: 0 },
          ),
        },
        {
          name: 'Bed',
          events: seq(
            Array.from({ length: 128 }, (_, i) => 60 + (i % 4)),
            { dur: PPQ / 4, channel: 1 },
          ),
        },
      ),
      'tempo-melody.mid',
    );
    expect(p.tempoChanges).toBe(1);
    expect(p.tracks.map((x) => x.notesPerBeat)).toEqual([1, 4]);
    expect(p.tracks[suggestMelodyTrack(p)].name).toBe('Line');
  });

  it('a melody played legato (notes held 1.1 beat) still beats a monophonic bass', () => {
    const melody: SmfEvent[] = Array.from({ length: 32 }, (_, i) => ({
      tick: i * PPQ,
      type: 'note' as const,
      midi: 72 + (i % 5),
      duration: Math.round(1.1 * PPQ),
    }));
    const bass = seq(
      Array.from({ length: 16 }, (_, i) => 36 + (i % 3)),
      { dur: 2 * PPQ },
    );
    const p = parseMidiFile(
      file1({ name: 'Melody', events: melody }, { name: 'Bass', events: bass }),
      'legato.mid',
    );
    expect(p.tracks.map((x) => [x.name, x.monophonicRatio])).toEqual([
      ['Melody', 1],
      ['Bass', 1],
    ]);
    expect(p.tracks[suggestMelodyTrack(p)].name).toBe('Melody');
  });
});

describe('tracksNotesInBeats (gộp nhiều track — Phase 2c)', () => {
  // giai điệu chia ở 2 track: track 1 câu đầu, track 2 câu sau; meta lời ở track conductor bị bỏ qua
  const bytes = file1(
    {
      events: [
        { tick: 0, type: 'lyric', text: 'Em' },
        { tick: 2 * PPQ, type: 'lyric', text: 'ơi' },
        { tick: 4 * PPQ, type: 'lyric', text: 'về' },
      ],
    },
    { name: 'Lead A', events: seq([60, 62, 64, 65]) },
    { name: 'Lead B', events: seq([67, 69], { start: 4 * PPQ }) },
    { name: 'Double', events: seq([48], { start: 2 * PPQ, dur: 2 * PPQ }) },
  );

  it('gộp theo thời gian (thứ tự track không quan trọng)', () => {
    const p = parseMidiFile(bytes, 'split.mid');
    expect(p.tracks.map((t) => t.name)).toEqual(['Lead A', 'Lead B', 'Double']);
    const merged = tracksNotesInBeats(p, [1, 0]);
    expect(merged.map((n) => [n.startBeat, n.midi])).toEqual([
      [0, 60],
      [1, 62],
      [2, 64],
      [3, 65],
      [4, 67],
      [5, 69],
    ]);
    // nốt cùng lúc ở hai track: cả hai đều có (extractMelody chọn sau), sắp theo cao độ
    const withDouble = tracksNotesInBeats(p, [0, 2]);
    expect(withDouble.filter((n) => n.startBeat === 2).map((n) => n.midi)).toEqual([48, 64]);
  });

  it('một track = trackNotesInBeats; index sai / trùng bị bỏ', () => {
    const p = parseMidiFile(bytes, 'split.mid');
    expect(tracksNotesInBeats(p, [0])).toEqual(trackNotesInBeats(p, 0));
    expect(tracksNotesInBeats(p, [0, 0, 9, -1])).toEqual(trackNotesInBeats(p, 0));
    expect(tracksNotesInBeats(p, [])).toEqual([]);
  });
});

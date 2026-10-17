import { describe, expect, it } from 'vitest';
import { melodyPitches } from '../core/melody';
import { melodyToHarm } from '../core/melodyBuild';
import { optimizeTranspose } from '../core/optimizer';
import { parseHarm } from '../core/parser';
import type { Song } from '../core/types';
import { arrangeMelody, titleFromFileName } from './arrange';
import { extractMelody } from './extract';
import { markerBeats, parseMidiFile, suggestMelodyTrack, trackNotesInBeats } from './midiFile';
import type { SmfEvent, SmfSpec } from './testing/smf';
import { writeSmf } from './testing/smf';

/**
 * Spec §6b A, test: file MIDI tự sinh → parse → chọn track → trích melody → chia dòng/section →
 * optimizer → .harm; kiểm tra văn bản .harm từng case (monophonic, hợp âm, chùm ba, đổi tempo,
 * meta lời bị bỏ qua, marker) và parse lại không lỗi.
 */

const PPQ = 480;

function notes(
  list: ReadonlyArray<readonly [beat: number, beats: number, midi: number, lyric?: string]>,
  channel = 0,
): SmfEvent[] {
  const out: SmfEvent[] = [];
  for (const [beat, beats, midi, lyric] of list) {
    const tick = Math.round(beat * PPQ);
    out.push({ tick, type: 'note', midi, duration: Math.round(beats * PPQ), channel });
    if (lyric !== undefined) out.push({ tick, type: 'lyric', text: lyric });
  }
  return out;
}

/** Nốt đen liền nhau từ beat `start`. */
const run = (start: number, pitches: readonly number[]): Array<[number, number, number]> =>
  pitches.map((m, i) => [start + i, 1, m]);

function pipeline(spec: SmfSpec, fileName: string, grid = 0.25) {
  const parsed = parseMidiFile(writeSmf(spec), fileName);
  const track = suggestMelodyTrack(parsed);
  const mono = extractMelody(trackNotesInBeats(parsed, track), {
    overlap: 'highest',
    grid,
    minBeats: 1 / 32,
  });
  const melody = arrangeMelody(mono, {
    title: titleFromFileName(fileName),
    bpm: parsed.bpm,
    timeSig: parsed.timeSig,
    markers: markerBeats(parsed),
    grid,
  });
  const [best] = optimizeTranspose(melodyPitches(melody));
  const harm = melodyToHarm(melody, best);
  const reparsed = parseHarm(harm);
  return { parsed, track, melody, best, harm, reparsed };
}

function totalBeats(song: Song): number {
  let t = 0;
  for (const s of song.sections) {
    for (const l of s.lines) {
      for (const u of l.units) {
        t += u.kind === 'slur' ? u.notes.reduce((a, x) => a + x.beats, 0) : u.beats;
      }
    }
  }
  return t;
}

/** Parse lại: không diagnostic nào. */
function expectClean(r: ReturnType<typeof parseHarm>): void {
  expect(r.ok).toBe(true);
  expect(r.diagnostics).toEqual([]);
}

const harm = (...lines: string[]): string => `${lines.join('\n')}\n`;

describe('MIDI file → .harm pipeline', () => {
  it('monophonic simple melody', () => {
    const r = pipeline(
      {
        format: 1,
        ppq: PPQ,
        tracks: [
          {
            events: [
              { tick: 0, type: 'tempo', bpm: 100 },
              { tick: 0, type: 'timeSig', num: 4, den: 4 },
            ],
          },
          {
            name: 'Melody',
            events: notes(run(0, [60, 62, 64, 65, 67, 69, 71, 72, 72, 71, 69, 67, 65, 64, 62, 60])),
          },
        ],
      },
      'Do_Re-Mi.mid',
    );
    expect(r.track).toBe(0);
    expect(r.best.transpose).toBe(0);
    expect(r.harm).toBe(
      harm(
        '@title Do Re Mi',
        '@bpm 100',
        '@time 4/4',
        '@scroll +1',
        '',
        '# Phần 1',
        'Z X C V B N M ,',
        ', M N B V C X Z',
      ),
    );
    expectClean(r.reparsed);
    expect(totalBeats(r.reparsed.song)).toBe(16);
  });

  it('stacked chords: keeps the top note, transposes to the cheapest key', () => {
    // G trưởng, melody ở nốt cao nhất; bè giữa, bass ngân dài và nốt lót lệch phách bên dưới
    const melody = [71, 71, 72, 74, 74, 72, 71, 69];
    const events: SmfEvent[] = [
      { tick: 0, type: 'program', program: 0 },
      ...notes(run(0, melody)),
      ...notes(melody.flatMap((_, i) => [[i, 1, 55] as const, [i, 1, 59] as const])),
      ...notes([
        [0, 4, 43],
        [4, 4, 43],
        [0.5, 1, 62],
        [4.5, 1, 62],
      ]),
    ];
    const r = pipeline(
      { format: 0, ppq: PPQ, tracks: [{ name: 'Piano', events }] },
      'ode-to-joy.mid',
    );
    expect(r.parsed.tracks).toHaveLength(1);
    expect(r.parsed.tracks[0].monophonicRatio).toBeLessThan(0.9);
    // B B C D D C B A dời −7 → E E F G G F E D: không cần modifier
    expect(r.best.transpose).toBe(-7);
    expect(r.best.cost).toBe(0);
    expect(r.harm).toBe(
      harm(
        '@title ode to joy',
        '@bpm 120',
        '@time 4/4',
        '@scroll +1',
        '',
        '# Phần 1',
        'C C V B B V C X',
      ),
    );
    expectClean(r.reparsed);
  });

  it('triplets with the 1/3 grid', () => {
    const t = 1 / 3;
    const r = pipeline(
      {
        format: 1,
        ppq: PPQ,
        tracks: [
          { events: [{ tick: 0, type: 'tempo', bpm: 90 }] },
          {
            events: notes([
              [0, t, 60],
              [t, t, 62],
              [2 * t, t, 64],
              [1, 1, 65],
              [2, t, 67],
              [2 + t, t, 65],
              [2 + 2 * t, t, 64],
              [3, 1, 62],
              [4, 2, 60],
            ]),
          },
        ],
      },
      'triplets.mid',
      1 / 3,
    );
    expect(r.harm).toBe(
      harm(
        '@title triplets',
        '@bpm 90',
        '@time 4/4',
        '@scroll +1',
        '',
        '# Phần 1',
        'Z*1/3 X*1/3 C*1/3 V B*1/3 V*1/3 C*1/3 X Z*2',
      ),
    );
    expectClean(r.reparsed);
    expect(totalBeats(r.reparsed.song)).toBeCloseTo(6, 9);
  });

  it('tempo change mid-song: @bpm = first tempo, durations from ticks', () => {
    const r = pipeline(
      {
        format: 1,
        ppq: PPQ,
        tracks: [
          {
            events: [
              { tick: 0, type: 'tempo', bpm: 120 },
              { tick: 0, type: 'timeSig', num: 3, den: 4 },
              { tick: 4 * PPQ, type: 'tempo', bpm: 60 },
              { tick: 6 * PPQ, type: 'tempo', bpm: 72 },
            ],
          },
          { events: notes(run(0, [60, 62, 64, 65, 67, 69, 71, 72, 72])) },
        ],
      },
      'tempo_change.mid',
    );
    expect(r.parsed.tempoChanges).toBe(2);
    expect(r.harm).toBe(
      harm(
        '@title tempo change',
        '@bpm 120',
        '@time 3/4',
        '@scroll +1',
        '',
        '# Phần 1',
        'Z X C V B N',
        'M , ,',
      ),
    );
    expectClean(r.reparsed);
    expect(totalBeats(r.reparsed.song)).toBe(9);
  });

  it('lyric meta events are ignored: no lyric in the .harm, notes unchanged', () => {
    const r = pipeline(
      {
        format: 1,
        ppq: PPQ,
        tracks: [
          { events: [{ tick: 0, type: 'tempo', bpm: 80 }] },
          { name: 'Piano', events: notes(run(0, [48, 52, 55, 48, 52, 55, 48, 52, 55, 48, 52])) },
          {
            name: 'Voice',
            events: notes([
              [0, 1, 64, 'Một '],
              [1, 1, 64, 'hai '],
              [2, 1, 62, 'ba '],
              [3, 1, 60, 'bốn '],
              [4, 1, 62, 'năm'],
              [6, 1, 60, '/sáu '],
              [7, 1, 62, 'bảy '],
              [8, 1, 64, 'tám '],
              [9, 1, 64, 'chín'],
              [10, 1, 64], // nốt lặp cùng cao độ: không gộp (mặc định)
            ]),
          },
        ],
      },
      'Bai_thu_loi.mid',
    );
    expect(r.parsed.tracks.map((t) => t.name)).toEqual(['Piano', 'Voice']);
    expect(r.track).toBe(1);
    expect(r.harm).toBe(
      harm(
        '@title Bai thu loi',
        '@bpm 80',
        '@time 4/4',
        '@scroll +1',
        '',
        '# Phần 1',
        'C C X Z X _',
        'Z X C C C',
      ),
    );
    expectClean(r.reparsed);
    expect(r.reparsed.song.sections[0].lines.every((l) => !('lyric' in l))).toBe(true);
  });

  it('a file with an instrumental intro: repeated notes stay separate everywhere', () => {
    const r = pipeline(
      {
        format: 1,
        ppq: PPQ,
        tracks: [
          {
            name: 'Melody',
            events: notes([
              // intro không lời C C G G A A G — 7 lần bấm
              ...run(0, [60, 60, 67, 67, 69, 69, 67]),
              [8, 1, 64, 'Em'],
              [9, 1, 64], // cùng cao độ: vẫn là nốt riêng
              [10, 1, 65, 'ơi'],
              [11, 1, 67, 'Hà'],
              [12, 2, 67, 'Nội'],
            ]),
          },
        ],
      },
      'intro.mid',
    );
    expect(r.harm).toBe(
      harm(
        '@title intro',
        '@bpm 120',
        '@time 4/4',
        '@scroll +1',
        '',
        '# Phần 1',
        'Z Z B B N N B _',
        'C C V B B*2',
      ),
    );
    expectClean(r.reparsed);
  });

  it('markers become sections; a pickup line opens the next section', () => {
    const r = pipeline(
      {
        format: 1,
        ppq: PPQ,
        tracks: [
          {
            events: [
              { tick: 0, type: 'tempo', bpm: 100 },
              { tick: 0, type: 'marker', text: 'Verse' },
              { tick: 8 * PPQ, type: 'marker', text: 'Điệp khúc' },
            ],
          },
          {
            name: 'Lead',
            events: notes([
              ...run(0, [60, 62, 64, 65, 67, 69]),
              [7.5, 0.5, 67],
              ...run(8, [72, 71, 69, 67, 65, 64, 62, 60]),
            ]),
          },
        ],
      },
      'markers.mid',
    );
    expect(r.harm).toBe(
      harm(
        '@title markers',
        '@bpm 100',
        '@time 4/4',
        '@scroll +1',
        '',
        '# Verse',
        'Z X C V B N _*1.5',
        '',
        '# Điệp khúc',
        'B*0.5 , M N B V C X Z',
      ),
    );
    expectClean(r.reparsed);
    expect(totalBeats(r.reparsed.song)).toBe(16);
  });

  it('without markers splits sections every 8 bars ("Phần N")', () => {
    const pitches = Array.from({ length: 40 }, (_, i) => [60, 64, 67, 72][i % 4]);
    const r = pipeline(
      { format: 0, ppq: PPQ, tracks: [{ events: notes(run(5, pitches)) }] },
      'long.mid',
    );
    // bắt đầu từ ô nhịp [4, 8) → rest 1 beat; section 2 từ beat 36 của file
    expect(r.reparsed.song.sections.map((s) => [s.name, s.lines.length])).toEqual([
      ['Phần 1', 4],
      ['Phần 2', 2],
    ]);
    expect(r.harm).toContain('# Phần 1\n_ Z C B , Z C B\n');
    expectClean(r.reparsed);
    expect(totalBeats(r.reparsed.song)).toBe(41);
  });
});

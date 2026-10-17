import { describe, expect, it } from 'vitest';
import { melodyPitches } from '../core/melody';
import { melodyToHarm } from '../core/melodyBuild';
import { optimizeTranspose } from '../core/optimizer';
import { parseHarm } from '../core/parser';
import { arrangeMelody } from './arrange';
import { extractMelody } from './extract';
import type { ParsedScore } from './musicxml';
import {
  decodeXmlBytes,
  defaultScoreVoice,
  parseMusicXml,
  readScoreFile,
  ScoreImportError,
  scorePartNotes,
  suggestScorePart,
} from './musicxml';
import {
  attributes,
  backup,
  barline,
  direction,
  forward,
  measure,
  n,
  rest,
  scoreXml,
  singlePart,
} from './testing/musicxml';
import { buildMxl, buildZip } from './testing/zipBuild';
import { MAX_MUSICXML_BYTES } from './types';
import { ZipError } from './zip';

/** [startBeat, beats, midi] của part / voice. */
function triples(score: ParsedScore, part = 'P1', voice = 'all') {
  return scorePartNotes(score, part, { voice }).map((x) => [x.startBeat, x.beats, x.midi] as const);
}

function importError(fn: () => unknown): ScoreImportError {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(ScoreImportError);
    return e as ScoreImportError;
  }
  throw new Error('không ném lỗi');
}

const div4 = attributes({ divisions: 4, time: [4, 4] });

describe('parseMusicXml — cơ bản', () => {
  it('giai điệu đơn (bè hát có <lyric>), tiêu đề, tác giả, tempo — chữ không được đọc', () => {
    const xml = singlePart(
      [
        measure(
          div4 +
            direction({ metronome: ['quarter', 96] }) +
            n('C4', 4, { lyric: 'Một' }) +
            n('D4', 4, { lyric: 'hai' }) +
            n('E4', 4, { lyric: 'ba' }) +
            n('F#4', 4, { lyric: 'bốn' }),
        ),
        measure(n('G4', 8, { lyric: 'Năm' }) + rest(4) + n('Bb4', 4, { lyric: 'sáu' })),
      ],
      { title: 'Bài Thử Tiếng Việt', composer: 'Tác Giả Thử' },
    );
    const s = parseMusicXml(xml);
    expect(s.title).toBe('Bài Thử Tiếng Việt');
    expect(s.composer).toBe('Tác Giả Thử');
    expect(s.bpm).toBe(96);
    expect(s.tempoChanges).toBe(0);
    expect(s.timeSig).toEqual({ num: 4, den: 4 });
    expect(s.warnings).toEqual([]);
    expect(s.repeats).toBe(false);
    expect(triples(s)).toEqual([
      [0, 1, 60],
      [1, 1, 62],
      [2, 1, 64],
      [3, 1, 66],
      [4, 2, 67],
      [7, 1, 70],
    ]);
    expect(scorePartNotes(s, 'P1', { voice: 'all' }).every((x) => !('lyric' in x))).toBe(true);
    const p = s.parts[0];
    expect(p).toMatchObject({
      id: 'P1',
      name: 'Melody',
      noteCount: 6,
      minMidi: 60,
      maxMidi: 70,
      sung: true,
      voices: ['1'],
      staves: 1,
      transposing: false,
    });
    expect(suggestScorePart(s)).toBe('P1');
    expect(defaultScoreVoice(p)).toBe('1');
  });

  it('sung = có <lyric> mang chữ (mọi lượt, syllabic, elision); <lyric> chỉ có <extend/> không tính', () => {
    const nfd = 'Ngày'.normalize('NFD');
    const xml = singlePart([
      measure(
        div4 +
          n('C4', 4, {
            lyric: [
              { n: 1, text: 'Ha', syllabic: 'begin' },
              { n: 2, text: nfd },
            ],
          }) +
          n('D4', 4, { lyric: [{ n: 1, text: 'le', syllabic: 'middle' }] }) +
          n('E4', 4, { lyric: [{ n: 1, text: 'lu', syllabic: 'end' }] }) +
          '<note><pitch><step>F</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice>' +
          '<lyric number="1"><text>a</text><elision>‿</elision><text>e</text></lyric></note>',
      ),
    ]);
    const s = parseMusicXml(xml);
    expect(s.parts[0].sung).toBe(true);
    expect(triples(s).map((x) => x[2])).toEqual([60, 62, 64, 65]);
    const extendOnly = singlePart([
      measure(
        div4 +
          '<note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice>' +
          '<lyric number="1"><extend/></lyric></note>',
      ),
    ]);
    expect(parseMusicXml(extendOnly).parts[0].sung).toBe(false);
    expect(parseMusicXml(singlePart([measure(div4 + n('C4', 4))])).parts[0].sung).toBe(false);
  });

  it('tie qua vạch nhịp gộp thành một nốt (cả <tied> không có <tie>); nốt lặp không tie giữ riêng', () => {
    const xml = singlePart([
      measure(div4 + n('C4', 8) + n('E4', 8, { tie: 'start' })),
      measure(
        n('E4', 4, { tie: 'both' }) + n('E4', 4, { tie: 'stop', tiedOnly: true }) + n('E4', 8),
      ),
    ]);
    expect(triples(parseMusicXml(xml))).toEqual([
      [0, 2, 60],
      [2, 4, 64],
      [6, 2, 64],
    ]);
  });

  it('chùm ba: duration theo divisions ra đúng 1/3 beat; divisions đổi giữa bài', () => {
    const xml = singlePart([
      measure(
        attributes({ divisions: 3, time: [2, 4] }) +
          n('C4', 1, { tuplet: [3, 2] }) +
          n('D4', 1, { tuplet: [3, 2] }) +
          n('E4', 1, { tuplet: [3, 2] }) +
          n('F4', 3),
      ),
      measure(attributes({ divisions: 2 }) + n('G4', 1) + n('A4', 1) + n('B4', 2)),
    ]);
    const s = parseMusicXml(xml);
    expect(s.timeSig).toEqual({ num: 2, den: 4 });
    expect(triples(s)).toEqual([
      [0, 1 / 3, 60],
      [1 / 3, 1 / 3, 62],
      [2 / 3, 1 / 3, 64],
      [1, 1, 65],
      [2, 0.5, 67],
      [2.5, 0.5, 69],
      [3, 1, 71],
    ]);
  });

  it('hợp âm: trả mọi nốt cùng onset; extractMelody chọn theo policy', () => {
    const xml = singlePart([
      measure(
        div4 +
          n('C4', 8) +
          n('E4', 8, { chord: true }) +
          n('G4', 8, { chord: true }) +
          n('D4', 8) +
          n('F4', 8, { chord: true }),
      ),
    ]);
    const s = parseMusicXml(xml);
    expect(triples(s)).toEqual([
      [0, 2, 60],
      [0, 2, 64],
      [0, 2, 67],
      [2, 2, 62],
      [2, 2, 65],
    ]);
    const notes = scorePartNotes(s, 'P1', { voice: 'all' });
    const hi = extractMelody(notes, { overlap: 'highest', grid: 0, mergeTies: 'never' });
    expect(hi.map((x) => x.midi)).toEqual([67, 65]);
    const lo = extractMelody(notes, { overlap: 'lowest', grid: 0, mergeTies: 'never' });
    expect(lo.map((x) => x.midi)).toEqual([60, 62]);
  });

  it('2 voice trên một khuông (backup), forward, grace / cue bị bỏ', () => {
    const xml = singlePart([
      measure(
        div4 +
          n('D5', 4, { grace: true }) +
          n('E5', 8) +
          n('G5', 8) +
          backup(16) +
          n('C4', 4, { voice: 2 }) +
          forward(4) +
          n('E4', 4, { voice: 2, cue: true }) +
          n('G4', 4, { voice: 2 }),
      ),
    ]);
    const s = parseMusicXml(xml);
    expect(s.parts[0].voices).toEqual(['1', '2']);
    expect(triples(s, 'P1', '1')).toEqual([
      [0, 2, 76],
      [2, 2, 79],
    ]);
    // forward 1 beat, cue chiếm 1 beat nhưng không phát
    expect(triples(s, 'P1', '2')).toEqual([
      [0, 1, 60],
      [3, 1, 67],
    ]);
    expect(triples(s, 'P1', 'all').map((x) => x[2])).toEqual([76, 60, 79, 67]);
    expect(defaultScoreVoice(s.parts[0])).toBe('1');
  });

  it('piano 2 khuông: voice 1 (khuông 1) / voice 5 (khuông 2); voice dùng chung số ở 2 khuông thì tách', () => {
    const rh = n('E5', 4, { staff: 1 }) + n('F5', 4, { staff: 1 }) + n('G5', 8, { staff: 1 });
    const lh = (v: number) =>
      n('C3', 8, { voice: v, staff: 2 }) + n('G2', 8, { voice: v, staff: 2 });
    const piano = (v: number) =>
      scoreXml({
        parts: [
          {
            id: 'P1',
            name: 'Piano',
            instrument: 'Piano',
            measures: [
              measure(
                attributes({ divisions: 4, time: [4, 4], staves: 2 }) + rh + backup(16) + lh(v),
              ),
            ],
          },
        ],
      });
    const s = parseMusicXml(piano(5));
    const part = s.parts[0];
    expect(part.staves).toBe(2);
    expect(part.voiceInfo.map((v) => [v.id, v.staff, v.noteCount])).toEqual([
      ['1', 1, 3],
      ['5', 2, 2],
    ]);
    expect(defaultScoreVoice(part)).toBe('1');
    expect(triples(s, 'P1', '5').map((x) => x[2])).toEqual([48, 43]);

    const shared = parseMusicXml(piano(1)).parts[0];
    expect(shared.voices).toEqual(['1/1', '1/2']);
    expect(shared.voiceInfo.map((v) => [v.number, v.staff])).toEqual([
      ['1', 1],
      ['1', 2],
    ]);
  });

  it('nhạc cụ dịch giọng (clarinet Si giáng): đổi về cao độ thật; octave-change', () => {
    const clarinet = scoreXml({
      parts: [
        {
          id: 'P1',
          name: 'Clarinet in B♭',
          instrument: 'Clarinet',
          measures: [
            measure(
              attributes({
                divisions: 1,
                time: [4, 4],
                transpose: { chromatic: -2, diatonic: -1 },
              }) +
                n('D4', 1) +
                n('E4', 1) +
                n('F#4', 2),
            ),
          ],
        },
        {
          id: 'P2',
          name: 'Guitar',
          measures: [
            measure(
              attributes({ divisions: 1, time: [4, 4], transpose: { chromatic: 0, octave: -1 } }) +
                n('E4', 4),
            ),
          ],
        },
      ],
    });
    const s = parseMusicXml(clarinet);
    // D4 viết = C4 thật
    expect(triples(s, 'P1').map((x) => x[2])).toEqual([60, 62, 64]);
    expect(s.parts[0].transposing).toBe(true);
    expect(triples(s, 'P2').map((x) => x[2])).toEqual([52]);
    expect(s.parts.map((p) => p.instrument)).toEqual(['Clarinet', '']);
  });

  it('ô nhịp đón (pickup): dời để vạch nhịp sau đúng bội số ô nhịp', () => {
    const xml = singlePart([
      measure(div4 + n('G4', 4, { lyric: 'Một' }), { implicit: true }),
      measure(n('C5', 16)),
    ]);
    const s = parseMusicXml(xml);
    expect(triples(s)).toEqual([
      [3, 1, 67],
      [4, 4, 72],
    ]);
  });
});

describe('parseMusicXml — dấu lặp, tempo, nhịp, marker', () => {
  it('lặp có volta 1., 2.: trải theo thứ tự chơi (lời nhiều lượt không ảnh hưởng)', () => {
    // |: A  B [1. C :| [2. D | E
    const A = (lyr: boolean) =>
      n('C4', 1, {
        lyric: lyr
          ? [
              { n: 1, text: 'một' },
              { n: 2, text: 'hai' },
            ]
          : undefined,
      });
    const xml = singlePart([
      measure(
        attributes({ divisions: 1, time: [1, 4] }) +
          barline('left', { repeat: 'forward' }) +
          A(true),
      ),
      measure(n('D4', 1, { lyric: [{ n: 1, text: 'ba' }] })),
      measure(
        barline('left', { ending: { number: '1', type: 'start' } }) +
          n('E4', 1) +
          barline('right', { repeat: 'backward', ending: { number: '1', type: 'stop' } }),
      ),
      measure(
        barline('left', { ending: { number: '2', type: 'start' } }) +
          n('F4', 1) +
          barline('right', { ending: { number: '2', type: 'discontinue' } }),
      ),
      measure(n('G4', 1)),
    ]);
    const s = parseMusicXml(xml);
    expect(s.repeats).toBe(true);
    expect(triples(s).map(([b, , m]) => [b, m])).toEqual([
      [0, 60],
      [1, 62],
      [2, 64],
      [3, 60],
      [4, 62],
      [5, 65],
      [6, 67],
    ]);
    expect(s.parts[0].sung).toBe(true);
  });

  it('lặp không có forward (từ đầu bài), times="3", volta "1, 2" / "3"', () => {
    const one = attributes({ divisions: 1, time: [1, 4] });
    const simple = singlePart([
      measure(one + n('C4', 1)),
      measure(n('D4', 1) + barline('right', { repeat: 'backward' })),
      measure(n('E4', 1)),
    ]);
    expect(triples(parseMusicXml(simple)).map((x) => x[2])).toEqual([60, 62, 60, 62, 64]);

    const thrice = singlePart([
      measure(one + barline('left', { repeat: 'forward' }) + n('C4', 1)),
      measure(
        barline('left', { ending: { number: '1, 2', type: 'start' } }) +
          n('D4', 1) +
          barline('right', {
            repeat: 'backward',
            times: 3,
            ending: { number: '1, 2', type: 'stop' },
          }),
      ),
      measure(
        barline('left', { ending: { number: '3', type: 'start' } }) +
          n('E4', 1) +
          barline('right', { ending: { number: '3', type: 'stop' } }),
      ),
    ]);
    expect(triples(parseMusicXml(thrice)).map((x) => x[2])).toEqual([60, 62, 60, 62, 60, 64]);

    // volta 1., 2., 3. chỉ ghi times mặc định → vẫn đủ 3 lần
    const voltas = singlePart([
      measure(one + n('C4', 1)),
      measure(
        barline('left', { ending: { number: '1', type: 'start' } }) +
          n('D4', 1) +
          barline('right', { repeat: 'backward', ending: { number: '1', type: 'stop' } }),
      ),
      measure(
        barline('left', { ending: { number: '2', type: 'start' } }) +
          n('E4', 1) +
          barline('right', { repeat: 'backward', ending: { number: '2', type: 'stop' } }),
      ),
      measure(
        barline('left', { ending: { number: '3', type: 'start' } }) +
          n('F4', 1) +
          barline('right', { ending: { number: '3', type: 'stop' } }),
      ),
    ]);
    expect(triples(parseMusicXml(voltas)).map((x) => x[2])).toEqual([60, 62, 60, 64, 60, 65]);
  });

  it('tempo (sound tempo thắng metronome; nốt đen chấm), đổi tempo, đổi nhịp, rehearsal → marker', () => {
    const xml = scoreXml({
      parts: [
        {
          id: 'P1',
          name: 'Lead',
          measures: [
            measure(
              attributes({ divisions: 2, time: [6, 8] }) +
                direction({ rehearsal: 'A', metronome: ['quarter', 50, 1], words: 'Allegro' }) +
                n('C4', 6),
            ),
            measure(direction({ soundTempo: 80, metronome: ['quarter', 70] }) + n('D4', 6)),
            measure(
              attributes({ time: [2, 4] }) +
                direction({ rehearsal: 'B' }) +
                direction({ words: 'rit.' }) +
                n('E4', 4),
            ),
          ],
        },
        {
          id: 'P2',
          name: 'Bass',
          measures: [
            measure(
              attributes({ divisions: 1, time: [6, 8] }) +
                direction({ rehearsal: 'A' }) +
                n('C3', 3),
            ),
            measure(n('D3', 3)),
            measure(attributes({ time: [2, 4] }) + n('E3', 2)),
          ],
        },
      ],
    });
    const s = parseMusicXml(xml);
    expect(s.bpm).toBe(75); // 50 × 1.5
    expect(s.tempoChanges).toBe(1);
    expect(s.timeSig).toEqual({ num: 6, den: 8 });
    expect(s.warnings).toEqual(['time-changes']);
    expect(s.markers).toEqual([
      { beat: 0, text: 'A' },
      { beat: 6, text: 'B' },
    ]);
    expect(triples(s, 'P2')).toEqual([
      [0, 3, 48],
      [3, 3, 50],
      [6, 2, 52],
    ]);
    // không có tempo nào → 120
    expect(parseMusicXml(singlePart([measure(div4 + n('C4', 4))])).bpm).toBe(120);
  });

  it('không có rehearsal: chữ <words> làm marker (bỏ chữ diễn tấu); D.C. → cảnh báo', () => {
    const xml = singlePart([
      measure(
        attributes({ divisions: 1, time: [2, 4] }) +
          direction({ words: 'Verse 1' }) +
          direction({ words: 'dolce' }) +
          n('C4', 2),
      ),
      measure(direction({ words: 'Điệp khúc' }) + n('D4', 2)),
      measure(direction({ words: 'D.C. al Fine' }) + n('E4', 2)),
    ]);
    const s = parseMusicXml(xml);
    expect(s.markers).toEqual([
      { beat: 0, text: 'Verse 1' },
      { beat: 2, text: 'Điệp khúc' },
    ]);
    expect(s.warnings).toEqual(['jumps']);
    const viaSound = singlePart([
      measure(div4 + direction({ sound: { dalsegno: 'segno' } }) + n('C4', 4)),
    ]);
    expect(parseMusicXml(viaSound).warnings).toEqual(['jumps']);
  });
});

describe('parseMusicXml — lỗi', () => {
  it('XML hỏng / không phải MusicXML / timewise / không có nốt', () => {
    expect(importError(() => parseMusicXml('<score-partwise><part>')).code).toBe('invalid-xml');
    expect(importError(() => parseMusicXml('not xml at all')).code).toBe('invalid-xml');
    expect(importError(() => parseMusicXml('<html><body/></html>')).code).toBe('not-musicxml');
    expect(
      importError(() =>
        parseMusicXml('<score-timewise version="4.0"><measure number="1"/></score-timewise>'),
      ).code,
    ).toBe('timewise');
    const restsOnly = singlePart([measure(div4 + rest(16, { measure: true }))]);
    expect(importError(() => parseMusicXml(restsOnly)).code).toBe('no-notes');
    const drums =
      '<score-partwise><part-list><score-part id="P1"><part-name>Drums</part-name></score-part></part-list>' +
      '<part id="P1"><measure number="1"><attributes><divisions>1</divisions></attributes>' +
      '<note><unpitched><display-step>C</display-step><display-octave>5</display-octave></unpitched>' +
      '<duration>1</duration></note></measure></part></score-partwise>';
    expect(importError(() => parseMusicXml(drums)).code).toBe('no-notes');
  });

  it('part không có nốt (bộ gõ) vẫn có trong danh sách nhưng không được gợi ý', () => {
    const xml = scoreXml({
      parts: [
        { id: 'D', name: 'Drums', measures: [measure(div4 + rest(16))] },
        { id: 'V', name: 'Violin', measures: [measure(div4 + n('A4', 16))] },
      ],
    });
    const s = parseMusicXml(xml);
    expect(s.parts.map((p) => [p.id, p.noteCount])).toEqual([
      ['D', 0],
      ['V', 1],
    ]);
    expect(suggestScorePart(s)).toBe('V');
    expect(defaultScoreVoice(s.parts[0])).toBe('all');
    expect(scorePartNotes(s, 'missing', { voice: 'all' })).toEqual([]);
  });
});

describe('suggestScorePart (mật độ nốt so với tempo — góp ý 2026-10-15)', () => {
  /** n ô nhịp 4/4 lặp lại cùng một nội dung (div 4). */
  const bars = (count: number, content: string, first = div4) =>
    Array.from({ length: count }, (_, i) => measure((i === 0 ? first : '') + content));

  it('bè hát (có <lyric>) được cộng điểm; không có lời thì bè gần 1 nốt / beat, cao hơn thắng', () => {
    const withLyric = scoreXml({
      parts: [
        {
          id: 'F',
          name: 'Flute',
          measures: [measure(div4 + n('C6', 4) + n('D6', 4) + n('E6', 8))],
        },
        {
          id: 'V',
          name: 'Voice',
          measures: [measure(div4 + n('C4', 8, { lyric: 'Em' }) + n('D4', 8, { lyric: 'ơi' }))],
        },
      ],
    });
    expect(suggestScorePart(parseMusicXml(withLyric))).toBe('V');
    const noLyric = withLyric.replace(/<lyric[^]*?<\/lyric>/g, '');
    expect(suggestScorePart(parseMusicXml(noLyric))).toBe('F');
  });

  it('bè piano đánh hợp âm (nhiều nốt nhất) không thắng bè giai điệu 1 nốt / beat', () => {
    const chord = (p: string) => n(p, 4, { chord: true });
    const piano = n('C4', 4) + chord('E4') + chord('G4') + chord('C5');
    const xml = scoreXml({
      parts: [
        { id: 'PN', name: 'Piano', measures: bars(8, piano + piano + piano + piano) },
        {
          id: 'FL',
          name: 'Flute',
          measures: bars(8, n('G4', 4) + n('A4', 4) + n('B4', 4) + n('D5', 4)),
        },
      ],
    });
    const s = parseMusicXml(xml);
    const [pn, fl] = s.parts;
    expect(pn.noteCount).toBe(128);
    expect(pn.notesPerBeat).toBe(4);
    expect(pn.monophonicRatio).toBe(0);
    expect(fl.notesPerBeat).toBe(1);
    expect(fl.monophonicRatio).toBe(1);
    expect(suggestScorePart(s)).toBe('FL');
  });

  it('bè bass cùng mật độ thua bè giai điệu; bè ngân thưa (pad) cũng thua', () => {
    const xml = scoreXml({
      parts: [
        {
          id: 'B',
          name: 'Contrabass',
          measures: bars(8, n('C2', 4) + n('G2', 4) + n('A2', 4) + n('E2', 4)),
        },
        { id: 'S', name: 'Strings', measures: bars(8, n('C6', 32 / 2)) },
        {
          id: 'M',
          name: 'Oboe',
          measures: bars(8, n('E4', 4) + n('G4', 4) + rest(4) + n('A4', 4)),
        },
      ],
    });
    const s = parseMusicXml(xml);
    expect(s.parts.map((p) => [p.id, p.notesPerBeat])).toEqual([
      ['B', 1],
      ['S', 0.25],
      ['M', 0.75],
    ]);
    expect(suggestScorePart(s)).toBe('M');
  });

  it('chỉ một bè có nốt → bè đó; không bè nào có nốt → null', () => {
    const one = scoreXml({
      parts: [
        { id: 'D', name: 'Drums', measures: [measure(div4 + rest(16))] },
        {
          id: 'P',
          name: 'Piano',
          measures: bars(2, n('C3', 4) + n('C3', 4, { chord: true }) + rest(12)),
        },
      ],
    });
    expect(suggestScorePart(parseMusicXml(one))).toBe('P');
    const s = parseMusicXml(one);
    expect(
      suggestScorePart({ ...s, parts: s.parts.map((p) => ({ ...p, noteCount: 0 })) }),
    ).toBeNull();
  });
});

describe('defaultScoreVoice', () => {
  it('voice đầu được ưu thế nhỏ, nhưng voice hợp âm dày / trầm thì nhường voice giống giai điệu', () => {
    // voice 1 (khuông 1) = hợp âm 3 nốt mỗi phách; voice 2 = giai điệu đơn 1 nốt / beat
    const rh =
      n('C4', 4) +
      n('E4', 4, { chord: true }) +
      n('G4', 4, { chord: true }) +
      n('C4', 4) +
      n('E4', 4, { chord: true }) +
      n('G4', 4, { chord: true }) +
      n('C4', 4) +
      n('E4', 4, { chord: true }) +
      n('G4', 4, { chord: true }) +
      n('C4', 4) +
      n('E4', 4, { chord: true }) +
      n('G4', 4, { chord: true });
    const mel =
      n('A5', 4, { voice: 2 }) +
      n('B5', 4, { voice: 2 }) +
      n('C6', 4, { voice: 2 }) +
      n('D6', 4, { voice: 2 });
    const xml = singlePart(
      Array.from({ length: 4 }, (_, i) => measure((i === 0 ? div4 : '') + rh + backup(16) + mel)),
    );
    const part = parseMusicXml(xml).parts[0];
    expect(part.voiceInfo.map((v) => [v.id, v.notesPerBeat, v.monophonicRatio])).toEqual([
      ['1', 3, 0],
      ['2', 1, 1],
    ]);
    expect(defaultScoreVoice(part)).toBe('2');
  });

  it('hai voice giống nhau → voice đầu', () => {
    const v1 = n('E5', 4) + n('F5', 4) + n('G5', 4) + n('A5', 4);
    const v2 =
      n('C5', 4, { voice: 2 }) +
      n('D5', 4, { voice: 2 }) +
      n('E5', 4, { voice: 2 }) +
      n('F5', 4, { voice: 2 });
    const part = parseMusicXml(singlePart([measure(div4 + v1 + backup(16) + v2)])).parts[0];
    expect(defaultScoreVoice(part)).toBe('1');
    // đổi chỗ: voice đầu thấp hơn chút vẫn giữ ưu thế
    const swapped = parseMusicXml(
      singlePart([
        measure(
          div4 +
            v2.replaceAll('<voice>2</voice>', '<voice>1</voice>') +
            backup(16) +
            v1.replaceAll('<voice>1</voice>', '<voice>2</voice>'),
        ),
      ]),
    ).parts[0];
    expect(swapped.voiceInfo.length).toBe(2);
    expect(defaultScoreVoice(swapped)).toBe(swapped.voiceInfo[0].id);
  });
});

describe('decodeXmlBytes / readScoreFile', () => {
  const xml = singlePart([measure(div4 + n('C4', 16, { lyric: 'Đời' }))], { title: 'Bài' });

  it('UTF-16 có BOM, encoding khai trong XML (Latin-1)', () => {
    const utf16 = new Uint8Array(2 + xml.length * 2);
    utf16[0] = 0xff;
    utf16[1] = 0xfe;
    for (let i = 0; i < xml.length; i++) {
      utf16[2 + i * 2] = xml.charCodeAt(i) & 0xff;
      utf16[3 + i * 2] = xml.charCodeAt(i) >> 8;
    }
    const decoded = decodeXmlBytes(utf16);
    expect(decoded).not.toMatch(/encoding=/);
    const fromUtf16 = parseMusicXml(decoded);
    expect(fromUtf16.title).toBe('Bài');
    expect(fromUtf16.parts[0].sung).toBe(true);

    const latin = '<?xml version="1.0" encoding="ISO-8859-1"?><a>café</a>';
    const bytes = Uint8Array.from(latin, (c) => c.charCodeAt(0));
    expect(decodeXmlBytes(bytes)).toBe('<?xml version="1.0"?><a>café</a>');
  });

  it('.mxl (ZIP + container.xml) và .musicxml thường cho cùng kết quả', async () => {
    const plain = await readScoreFile(new TextEncoder().encode(xml));
    const zipped = await readScoreFile(buildMxl(xml, 'Bài/score.xml'));
    expect(zipped).toEqual(plain);
    expect(plain.title).toBe('Bài');
  });

  it('lỗi: .mxl không có bản nhạc, XML quá lớn', async () => {
    await expect(readScoreFile(buildZip([{ name: 'a.txt', data: 'x' }]))).rejects.toBeInstanceOf(
      ZipError,
    );
    await expect(readScoreFile(new Uint8Array(MAX_MUSICXML_BYTES + 1))).rejects.toMatchObject({
      code: 'too-large',
    });
  });
});

describe('MusicXML → .harm', () => {
  it('rest, nhịp, tempo, section; không ghi lời; parse lại không lỗi', () => {
    const xml = singlePart(
      [
        measure(
          attributes({ divisions: 2, time: [3, 4] }) +
            direction({ rehearsal: 'Điệp khúc', soundTempo: 72 }) +
            n('C4', 2, { lyric: 'Anh' }) +
            n('D4', 2, { lyric: 'vẫn' }) +
            n('E4', 2, { lyric: 'đợi' }),
        ),
        measure(n('G4', 4, { lyric: 'em', tie: 'start' }) + n('G4', 2, { tie: 'stop' })),
        measure(rest(2) + n('E4', 1, { lyric: 'về' }) + n('D4', 1, { lyric: 'đây' }) + n('C4', 2)),
      ],
      { title: 'Đợi' },
    );
    const s = parseMusicXml(xml);
    const mono = extractMelody(scorePartNotes(s, 'P1', { voice: '1' }), {
      overlap: 'highest',
      grid: 0,
      mergeTies: 'never',
    });
    const melody = arrangeMelody(mono, {
      title: s.title,
      bpm: s.bpm,
      timeSig: s.timeSig,
      markers: s.markers,
      grid: 0,
    });
    const [best] = optimizeTranspose(melodyPitches(melody));
    const harm = melodyToHarm(melody, best);
    expect(harm).toContain('@title Đợi');
    expect(harm).toContain('@bpm 72');
    expect(harm).toContain('@time 3/4');
    expect(harm).toContain('# Điệp khúc');
    expect(harm).toMatch(/^Z X C B\*3\b/m);
    expect(harm).toMatch(/^C\*0\.5 X\*0\.5 Z\b/m);
    expect(harm).not.toMatch(/Anh|vẫn|đợi|đây/);
    const reparsed = parseHarm(harm);
    expect(reparsed.ok).toBe(true);
  });

  it('ô nhịp đón + rehearsal ở ô nhịp 1: nốt đón vào section đó', () => {
    const xml = singlePart([
      measure(
        attributes({ divisions: 2, time: [4, 4] }) +
          n('G4', 1, { lyric: 'Em' }) +
          n('A4', 1, { lyric: 'ơi' }),
        { implicit: true, number: '0' },
      ),
      measure(
        direction({ rehearsal: 'Verse' }) +
          n('B4', 4, { lyric: 'có' }) +
          n('C5', 4, { lyric: 'biết' }),
      ),
      measure(n('D5', 2, { lyric: 'không' }) + n('E5', 2) + n('G5', 4, { lyric: 'la' })),
    ]);
    const s = parseMusicXml(xml);
    const mono = extractMelody(scorePartNotes(s, 'P1', { voice: '1' }), {
      overlap: 'highest',
      grid: 0,
      mergeTies: 'never',
    });
    const melody = arrangeMelody(mono, {
      title: s.title,
      bpm: s.bpm,
      timeSig: s.timeSig,
      markers: s.markers,
      grid: 0,
    });
    const [best] = optimizeTranspose(melodyPitches(melody));
    const harm = melodyToHarm(melody, best);
    expect(harm).not.toContain('# Main');
    expect(harm).toMatch(
      /# Verse\n(?:\/\/.*\n)*_\*3 \S+\*0\.5 \S+\*0\.5 \S+\*2 \S+\*2 \S+ \S+ \S+\*2\n/,
    );
    const reparsed = parseHarm(harm);
    expect(reparsed.ok).toBe(true);
    expect(reparsed.diagnostics.filter((d) => d.severity !== 'warning')).toEqual([]);
  });
});

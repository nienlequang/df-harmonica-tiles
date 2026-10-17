/**
 * Viết MusicXML (score-partwise) dạng chuỗi cho test / e2e — fixture tự sinh, ngắn gọn.
 * Chỉ test dùng; app không import.
 */

export interface NoteOpts {
  voice?: number | string;
  staff?: number;
  chord?: boolean;
  /** 'start' | 'stop' | 'both' — ghi cả `<tie>` và `<tied>`. */
  tie?: 'start' | 'stop' | 'both';
  /** Chỉ ghi `<tied>` (không `<tie>`), như vài phần mềm. */
  tiedOnly?: boolean;
  /** Chữ (lượt 1) hoặc danh sách lời theo lượt. */
  lyric?: string | ReadonlyArray<{ n?: number; text: string; syllabic?: string }>;
  grace?: boolean;
  cue?: boolean;
  /** Chùm (actual, normal), vd. [3, 2] — chỉ để giống file thật, thời gian lấy từ duration. */
  tuplet?: readonly [number, number];
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** "C4", "F#4", "Bb3", "C##5" → step / alter / octave. */
function parsePitch(p: string): { step: string; alter: number; octave: number } {
  const m = /^([A-G])(#{1,2}|b{1,2})?(-?\d)$/.exec(p);
  if (!m) throw new Error(`pitch? ${p}`);
  const acc = m[2] ?? '';
  const alter = acc.startsWith('#') ? acc.length : -acc.length;
  return { step: m[1], alter, octave: Number(m[3]) };
}

function lyricXml(lyric: NoteOpts['lyric']): string {
  if (lyric === undefined) return '';
  const list = typeof lyric === 'string' ? [{ text: lyric }] : lyric;
  return list
    .map(
      (l, i) =>
        `<lyric number="${l.n ?? i + 1}">${
          l.syllabic ? `<syllabic>${l.syllabic}</syllabic>` : ''
        }<text>${esc(l.text)}</text></lyric>`,
    )
    .join('');
}

/** Nốt có cao độ, `dur` theo divisions. */
export function n(pitch: string, dur: number, o: NoteOpts = {}): string {
  const { step, alter, octave } = parsePitch(pitch);
  const tieStart = o.tie === 'start' || o.tie === 'both';
  const tieStop = o.tie === 'stop' || o.tie === 'both';
  const ties = o.tiedOnly
    ? ''
    : `${tieStop ? '<tie type="stop"/>' : ''}${tieStart ? '<tie type="start"/>' : ''}`;
  const tied =
    tieStart || tieStop
      ? `<notations>${tieStop ? '<tied type="stop"/>' : ''}${tieStart ? '<tied type="start"/>' : ''}</notations>`
      : '';
  return [
    '<note>',
    o.grace ? '<grace/>' : '',
    o.cue ? '<cue/>' : '',
    o.chord ? '<chord/>' : '',
    `<pitch><step>${step}</step>${alter ? `<alter>${alter}</alter>` : ''}<octave>${octave}</octave></pitch>`,
    o.grace ? '' : `<duration>${dur}</duration>`,
    ties,
    `<voice>${o.voice ?? 1}</voice>`,
    '<type>quarter</type>',
    o.tuplet
      ? `<time-modification><actual-notes>${o.tuplet[0]}</actual-notes><normal-notes>${o.tuplet[1]}</normal-notes></time-modification>`
      : '',
    o.staff !== undefined ? `<staff>${o.staff}</staff>` : '',
    tied,
    lyricXml(o.lyric),
    '</note>',
  ].join('');
}

export function rest(
  dur: number,
  o: { voice?: number | string; staff?: number; measure?: boolean } = {},
): string {
  return `<note><rest${o.measure ? ' measure="yes"' : ''}/><duration>${dur}</duration><voice>${
    o.voice ?? 1
  }</voice>${o.staff !== undefined ? `<staff>${o.staff}</staff>` : ''}</note>`;
}

export const backup = (d: number) => `<backup><duration>${d}</duration></backup>`;
export const forward = (d: number) => `<forward><duration>${d}</duration></forward>`;

export interface AttrOpts {
  divisions?: number;
  time?: readonly [number, number];
  staves?: number;
  transpose?: { chromatic: number; diatonic?: number; octave?: number };
}

export function attributes(a: AttrOpts): string {
  return [
    '<attributes>',
    a.divisions !== undefined ? `<divisions>${a.divisions}</divisions>` : '',
    a.time ? `<time><beats>${a.time[0]}</beats><beat-type>${a.time[1]}</beat-type></time>` : '',
    a.staves !== undefined ? `<staves>${a.staves}</staves>` : '',
    a.transpose
      ? `<transpose><diatonic>${a.transpose.diatonic ?? 0}</diatonic><chromatic>${
          a.transpose.chromatic
        }</chromatic>${
          a.transpose.octave !== undefined
            ? `<octave-change>${a.transpose.octave}</octave-change>`
            : ''
        }</transpose>`
      : '',
    '</attributes>',
  ].join('');
}

export interface DirectionOpts {
  words?: string;
  rehearsal?: string;
  /** Metronome [beat-unit, per-minute, số chấm]. */
  metronome?: readonly [string, number, number?];
  soundTempo?: number;
  /** Thuộc tính khác của <sound> (vd. { dacapo: 'yes' }). */
  sound?: Readonly<Record<string, string>>;
}

export function direction(d: DirectionOpts): string {
  const types = [
    d.rehearsal !== undefined ? `<rehearsal>${esc(d.rehearsal)}</rehearsal>` : '',
    d.words !== undefined ? `<words>${esc(d.words)}</words>` : '',
    d.metronome
      ? `<metronome><beat-unit>${d.metronome[0]}</beat-unit>${'<beat-unit-dot/>'.repeat(
          d.metronome[2] ?? 0,
        )}<per-minute>${d.metronome[1]}</per-minute></metronome>`
      : '',
  ]
    .filter(Boolean)
    .map((x) => `<direction-type>${x}</direction-type>`)
    .join('');
  const attrs = {
    ...(d.soundTempo !== undefined ? { tempo: String(d.soundTempo) } : {}),
    ...d.sound,
  };
  const sound = Object.keys(attrs).length
    ? `<sound ${Object.entries(attrs)
        .map(([k, v]) => `${k}="${v}"`)
        .join(' ')}/>`
    : '';
  return `<direction placement="above">${types}${sound}</direction>`;
}

export function barline(
  location: 'left' | 'right',
  o: { repeat?: 'forward' | 'backward'; times?: number; ending?: { number: string; type: string } },
): string {
  return `<barline location="${location}">${
    o.ending ? `<ending number="${o.ending.number}" type="${o.ending.type}"/>` : ''
  }${
    o.repeat
      ? `<repeat direction="${o.repeat}"${o.times !== undefined ? ` times="${o.times}"` : ''}/>`
      : ''
  }</barline>`;
}

export function measure(content: string, o: { implicit?: boolean; number?: string } = {}): string {
  return `<measure number="${o.number ?? '1'}"${o.implicit ? ' implicit="yes"' : ''}>${content}</measure>`;
}

export interface PartSpec {
  id: string;
  name: string;
  instrument?: string;
  measures: readonly string[];
}

export interface ScoreSpec {
  title?: string;
  movementTitle?: string;
  composer?: string;
  parts: readonly PartSpec[];
}

/** Bản nhạc đầy đủ (có khai báo XML + DOCTYPE như file MuseScore xuất). */
export function scoreXml(s: ScoreSpec): string {
  const partList = s.parts
    .map(
      (p) =>
        `<score-part id="${p.id}"><part-name>${esc(p.name)}</part-name>${
          p.instrument
            ? `<score-instrument id="${p.id}-I1"><instrument-name>${esc(p.instrument)}</instrument-name></score-instrument>`
            : ''
        }</score-part>`,
    )
    .join('');
  const parts = s.parts
    .map(
      (p) =>
        `<part id="${p.id}">${p.measures
          .map((m, i) => m.replace(/^<measure number="1"/, `<measure number="${i + 1}"`))
          .join('')}</part>`,
    )
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="4.0">
${s.title !== undefined ? `<work><work-title>${esc(s.title)}</work-title></work>` : ''}
${s.movementTitle !== undefined ? `<movement-title>${esc(s.movementTitle)}</movement-title>` : ''}
${
  s.composer !== undefined
    ? `<identification><creator type="composer">${esc(s.composer)}</creator></identification>`
    : ''
}
<part-list>${partList}</part-list>
${parts}
</score-partwise>`;
}

/** Bản nhạc một part. */
export function singlePart(measures: readonly string[], o: Omit<ScoreSpec, 'parts'> = {}): string {
  return scoreXml({ ...o, parts: [{ id: 'P1', name: 'Melody', measures }] });
}

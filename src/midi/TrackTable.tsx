import { midiName } from '../core/keys';
import { useT } from '../i18n/useT';
import { notesPerMinute } from './melodySuggest';
import type { BeatNote } from './midiFile';
import { PianoRoll } from './PianoRoll';
import type { MidiTrackSummary, ParsedMidi } from './types';
import type { TrackPreview } from './useTrackPreview';
import { formatBpm, PreviewButton } from './wizardUi';

/**
 * Bước 2 (MIDI): bảng track có nốt, chọn NHIỀU track (checkbox) — giai điệu chia ở nhiều track
 * thì nốt các track được gộp rồi mới trích melody. Track gợi ý (mật độ nốt gần bằng BPM —
 * melodySuggest.ts) được chọn sẵn; mỗi dòng ghi "≈ N nốt/phút · BPM M" để người dùng thấy vì sao.
 * Dưới bảng: số nốt / tầm của tập đã gộp, piano roll và nghe thử khi chọn ≥ 2 track.
 */

export interface TrackTableProps {
  parsed: ParsedMidi;
  suggested: number;
  /** Nốt theo beat của từng track (piano roll / nghe thử từng dòng). */
  beatNotes: readonly BeatNote[][];
  /** Index track đã chọn, tăng dần. */
  selected: readonly number[];
  onChange: (next: number[]) => void;
  /** Nốt đã gộp của các track đang chọn. */
  selectedNotes: readonly BeatNote[];
  beatsPerBar: number;
  bpm: number;
  preview: TrackPreview;
}

export function TrackTable({
  parsed,
  suggested,
  beatNotes,
  selected,
  onChange,
  selectedNotes,
  beatsPerBar,
  bpm,
  preview,
}: TrackTableProps) {
  const t = useT();
  const visible = parsed.tracks.filter((tr) => !tr.isDrum);
  const hidden = parsed.tracks.length - visible.length;
  const toggle = (i: number) =>
    onChange(
      selected.includes(i)
        ? selected.filter((x) => x !== i)
        : [...selected, i].sort((a, b) => a - b),
    );
  // Tên dùng cho aria-label / nghe thử: trùng tên (vd. track ảo theo kênh của file type 0, D-120)
  // thì thêm kênh, vẫn trùng thì thêm số thứ tự track — mỗi dòng một tên riêng.
  const countOf = (key: (tr: MidiTrackSummary) => string) => {
    const m = new Map<string, number>();
    for (const tr of visible) m.set(key(tr), (m.get(key(tr)) ?? 0) + 1);
    return (tr: MidiTrackSummary) => m.get(key(tr)) ?? 0;
  };
  const sameName = countOf((tr) => tr.name);
  const sameNameChannel = countOf((tr) => `${tr.channel}|${tr.name}`);
  const nameOf = (tr: MidiTrackSummary): string => {
    if (sameName(tr) < 2) return tr.name;
    const params = { name: tr.name, n: tr.channel + 1, i: tr.index + 1 };
    return sameNameChannel(tr) < 2
      ? t('midi.track.nameWithChannel', params)
      : t('midi.track.nameWithIndex', params);
  };

  let min = Infinity;
  let max = -Infinity;
  for (const n of selectedNotes) {
    if (n.midi < min) min = n.midi;
    if (n.midi > max) max = n.midi;
  }
  const mergedName = t('midi.track.mergedName');

  return (
    <div className="stack">
      <p className="muted">{t('midi.track.intro')}</p>
      <div className="midi-table-wrap">
        <table className="midi-tracks">
          <caption className="sr-only">{t('midi.track.caption')}</caption>
          <thead>
            <tr>
              <th scope="col">
                <span className="sr-only">{t('midi.track.col.select')}</span>
              </th>
              <th scope="col">{t('midi.track.col.name')}</th>
              <th scope="col">{t('midi.track.col.instrument')}</th>
              <th scope="col" className="num">
                {t('midi.track.col.notes')}
              </th>
              <th scope="col">{t('midi.track.col.range')}</th>
              <th scope="col" className="num">
                {t('midi.track.col.mono')}
              </th>
              <th scope="col">{t('midi.track.col.roll')}</th>
              <th scope="col">
                <span className="sr-only">{t('midi.track.col.preview')}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {visible.map((tr) => {
              const isSel = selected.includes(tr.index);
              const notes = beatNotes[tr.index] ?? [];
              const name = nameOf(tr);
              return (
                <tr
                  key={tr.index}
                  className={isSel ? 'is-selected' : undefined}
                  onClick={(e) => {
                    if ((e.target as HTMLElement).closest('button, input')) return;
                    toggle(tr.index);
                  }}
                >
                  <td>
                    <input
                      type="checkbox"
                      checked={isSel}
                      onChange={() => toggle(tr.index)}
                      aria-label={t('midi.track.selectAria', { name })}
                    />
                  </td>
                  <td className="midi-track-cell">
                    <span className="midi-track-name">{tr.name}</span>{' '}
                    {tr.index === suggested ? (
                      <span className="badge midi-badge" title={t('midi.track.suggestedHint')}>
                        {t('midi.track.suggested')}
                      </span>
                    ) : null}
                    <div className="muted midi-small">
                      {t('midi.track.channel', { n: tr.channel + 1 })} ·{' '}
                      <span className="midi-density">
                        {t('midi.track.density', {
                          n: notesPerMinute(tr.notesPerBeat, bpm),
                          bpm: formatBpm(bpm),
                        })}
                      </span>
                    </div>
                  </td>
                  <td>{tr.instrument || t('midi.track.unknownInstrument')}</td>
                  <td className="num">{tr.noteCount}</td>
                  <td className="mono">
                    {midiName(tr.minMidi)}–{midiName(tr.maxMidi)}
                  </td>
                  <td className="num">
                    {t('midi.percent', { n: Math.round(tr.monophonicRatio * 100) })}
                  </td>
                  <td className="midi-roll-cell">
                    <PianoRoll
                      notes={notes}
                      label={t('midi.track.rollAria', { name })}
                      beatsPerBar={beatsPerBar}
                      height={36}
                    />
                  </td>
                  <td>
                    <PreviewButton
                      preview={preview}
                      previewKey={`track-${tr.index}`}
                      notes={notes}
                      bpm={bpm}
                      name={name}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {hidden > 0 ? (
        <p className="muted midi-small">{t('midi.track.hiddenDrums', { n: hidden })}</p>
      ) : null}
      <div className="midi-selection stack">
        <p className="midi-count" role="status" aria-live="polite">
          {selected.length === 0
            ? t('midi.track.noneSelected')
            : t('midi.track.selected', {
                tracks: selected.length,
                n: selectedNotes.length,
                range: selectedNotes.length > 0 ? `${midiName(min)}–${midiName(max)}` : '—',
              })}
        </p>
        {selected.length >= 2 ? (
          <div className="row midi-merged">
            <PianoRoll
              className="midi-merged-roll"
              notes={selectedNotes}
              label={t('midi.track.mergedRollAria')}
              beatsPerBar={beatsPerBar}
              height={56}
            />
            <PreviewButton
              preview={preview}
              previewKey="merged"
              notes={selectedNotes}
              bpm={bpm}
              name={mergedName}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}

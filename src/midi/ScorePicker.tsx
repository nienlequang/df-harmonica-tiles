import { useId, useMemo } from 'react';
import { midiName } from '../core/keys';
import type { StringKey } from '../i18n/strings';
import { useT } from '../i18n/useT';
import { Select } from '../ui/components';
import type { SelectOption } from '../ui/components';
import type { ExtractInputNote } from './extract';
import { notesPerMinute } from './melodySuggest';
import type { ParsedScore, ScorePart, ScoreWarning } from './musicxml';
import { scorePartNotes } from './musicxml';
import { PianoRoll } from './PianoRoll';
import type { TrackPreview } from './useTrackPreview';
import { formatBpm, formatTimeSig, PreviewButton } from './wizardUi';

/**
 * Bước 2 (MusicXML): chọn MỘT bè (part) trong bảng, rồi giọng (voice) của bè đó. Bè không có nốt có
 * cao độ (bộ gõ) bị ẩn. Mỗi bè ghi "≈ N nốt/phút · BPM M" (cơ sở của gợi ý — melodySuggest.ts).
 * Dưới cùng: số nốt / tầm của lựa chọn, piano roll và nghe thử.
 */

export interface ScorePickerProps {
  score: ParsedScore;
  suggested: string;
  partId: string;
  onPart: (id: string) => void;
  /** Id voice hoặc 'all'. */
  voice: string;
  onVoice: (v: string) => void;
  /** Nốt của lựa chọn hiện tại (part + voice). */
  selectedNotes: readonly ExtractInputNote[];
  beatsPerBar: number;
  bpm: number;
  preview: TrackPreview;
}

const WARNING_KEYS: Readonly<Record<ScoreWarning, StringKey>> = {
  jumps: 'midi.score.warn.jumps',
  'time-changes': 'midi.score.warn.timeChanges',
};

function rangeText(min: number, max: number): string {
  return Number.isFinite(min) && Number.isFinite(max) ? `${midiName(min)}–${midiName(max)}` : '—';
}

export function ScorePicker({
  score,
  suggested,
  partId,
  onPart,
  voice,
  onVoice,
  selectedNotes,
  beatsPerBar,
  bpm,
  preview,
}: ScorePickerProps) {
  const t = useT();
  const radioName = useId();
  const visible = score.parts.filter((p) => p.noteCount > 0);
  const hidden = score.parts.length - visible.length;
  const part = score.parts.find((p) => p.id === partId);
  const allNotes = useMemo(
    () => new Map(score.parts.map((p) => [p.id, scorePartNotes(score, p.id, { voice: 'all' })])),
    [score],
  );
  // tên truy cập riêng cho mỗi dòng khi hai bè trùng tên
  const nameOf = (p: ScorePart): string => {
    const dup = visible.filter((q) => q.name === p.name).length > 1;
    return dup
      ? t('midi.score.nameWithIndex', { name: p.name, i: score.parts.indexOf(p) + 1 })
      : p.name;
  };

  const voiceOptions: SelectOption<string>[] = part
    ? [
        { value: 'all', label: t('midi.score.voiceAll') },
        ...part.voiceInfo.map((v) => ({
          value: v.id,
          label:
            part.staves > 1
              ? t('midi.score.voiceStaff', { voice: v.number, staff: v.staff, n: v.noteCount })
              : t('midi.score.voice', { voice: v.number, n: v.noteCount }),
        })),
      ]
    : [];

  let min = Infinity;
  let max = -Infinity;
  for (const n of selectedNotes) {
    if (n.midi < min) min = n.midi;
    if (n.midi > max) max = n.midi;
  }
  const selectionName = part ? nameOf(part) : '';

  return (
    <div className="stack">
      <p className="muted">{t('midi.score.intro')}</p>
      {score.warnings.map((w) => (
        <p key={w} className="midi-warning">
          {t(WARNING_KEYS[w], { time: formatTimeSig(score.timeSig) })}
        </p>
      ))}
      {score.repeats ? <p className="muted midi-small">{t('midi.score.repeats')}</p> : null}
      <div className="midi-table-wrap">
        <table className="midi-tracks">
          <caption className="sr-only">{t('midi.score.caption')}</caption>
          <thead>
            <tr>
              <th scope="col">
                <span className="sr-only">{t('midi.track.col.select')}</span>
              </th>
              <th scope="col">{t('midi.score.col.part')}</th>
              <th scope="col">{t('midi.track.col.instrument')}</th>
              <th scope="col" className="num">
                {t('midi.track.col.notes')}
              </th>
              <th scope="col">{t('midi.track.col.range')}</th>
              <th scope="col">{t('midi.track.col.roll')}</th>
              <th scope="col">
                <span className="sr-only">{t('midi.track.col.preview')}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {visible.map((p) => {
              const isSel = p.id === partId;
              const notes = allNotes.get(p.id) ?? [];
              const name = nameOf(p);
              const details = [
                t('midi.track.density', {
                  n: notesPerMinute(p.notesPerBeat, bpm),
                  bpm: formatBpm(bpm),
                }),
                p.staves > 1 ? t('midi.score.staves', { n: p.staves }) : '',
                p.transposing ? t('midi.score.transposing') : '',
              ].filter(Boolean);
              return (
                <tr
                  key={p.id}
                  className={isSel ? 'is-selected' : undefined}
                  onClick={(e) => {
                    if ((e.target as HTMLElement).closest('button, input')) return;
                    onPart(p.id);
                  }}
                >
                  <td>
                    <input
                      type="radio"
                      name={radioName}
                      checked={isSel}
                      onChange={() => onPart(p.id)}
                      aria-label={t('midi.score.selectAria', { name })}
                    />
                  </td>
                  <td className="midi-track-cell">
                    <span className="midi-track-name">{p.name}</span>{' '}
                    {p.id === suggested ? (
                      <span className="badge midi-badge" title={t('midi.score.suggestedHint')}>
                        {t('midi.track.suggested')}
                      </span>
                    ) : null}
                    <div className="muted midi-small">{details.join(' · ')}</div>
                  </td>
                  <td>{p.instrument || t('midi.track.unknownInstrument')}</td>
                  <td className="num">{p.noteCount}</td>
                  <td className="mono">{rangeText(p.minMidi, p.maxMidi)}</td>
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
                      previewKey={`part-${p.id}`}
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
        <p className="muted midi-small">{t('midi.score.hiddenParts', { n: hidden })}</p>
      ) : null}
      {part && part.voiceInfo.length > 1 ? (
        <div className="midi-fields">
          <Select
            label={t('midi.score.voiceLabel')}
            value={voice}
            options={voiceOptions}
            onChange={onVoice}
          />
        </div>
      ) : null}
      <div className="midi-selection stack">
        <p className="midi-count" role="status" aria-live="polite">
          {t('midi.score.selected', {
            n: selectedNotes.length,
            range: rangeText(min, max),
          })}
        </p>
        {selectedNotes.length > 0 ? (
          <div className="row midi-merged">
            <PianoRoll
              className="midi-merged-roll"
              notes={selectedNotes}
              label={t('midi.score.selectionRollAria', { name: selectionName })}
              beatsPerBar={beatsPerBar}
              height={56}
            />
            <PreviewButton
              preview={preview}
              previewKey="selection"
              notes={selectedNotes}
              bpm={bpm}
              name={t('midi.score.selectionName', { name: selectionName })}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}

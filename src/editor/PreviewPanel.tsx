import { memo, useMemo } from 'react';
import type { ReactNode } from 'react';
import { formatBeats } from '../core/beats';
import { modifiersOf } from '../core/keys';
import { buildMobilePlan } from '../core/mobile';
import { songStats } from '../core/stats';
import { buildTimeline } from '../core/timeline';
import type { Diagnostic, DiagnosticSeverity, Note, ParseResult, Unit } from '../core/types';
import type { TFunction } from '../i18n/useT';
import { useT } from '../i18n/useT';
import { formatDuration } from '../library/songSource';
import { formatDiagnostic } from '../ui/diagnostics';
import { useModifierLabels } from '../ui/modLabels';
import type { ModifierLabels } from '../ui/modLabels';
import { tileColorKey } from '../ui/palette';
import { useSettings } from '../ui/settings';

/** Giới hạn phần tử vẽ trong preview (bài rất dài vẫn mượt khi gõ). */
export const MAX_PREVIEW_DIAGNOSTICS = 200;
export const MAX_PREVIEW_LINES = 400;

export interface PreviewPanelProps {
  parsed: ParseResult;
  /** Đưa con trỏ textarea tới (dòng, cột) nguồn, 1-based. */
  onJump(line: number, column: number): void;
}

const SEVERITY_RANK: Record<DiagnosticSeverity, number> = { error: 0, warning: 1, info: 2 };
const SEVERITY_GLYPH: Record<DiagnosticSeverity, string> = { error: '●', warning: '▲', info: 'i' };

/** Diagnostic theo thứ tự nguồn (dòng, cột), cùng chỗ thì nặng trước. */
export function sortDiagnostics(diagnostics: readonly Diagnostic[]): Diagnostic[] {
  return [...diagnostics].sort(
    (a, b) =>
      a.line - b.line ||
      a.column - b.column ||
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity],
  );
}

/** Số beat hiển thị gọn (bỏ nhiễu float: 33.3333 → 33.33). */
function beatsText(n: number): string {
  return formatBeats(Math.round(n * 100) / 100 || 0);
}

/** " (Cúi Xuống, Nửa Cung)" — tên modifier theo tên gọi người dùng đặt (modLabels). */
export function modsText(labels: ModifierLabels, note: Note): string {
  const parts: string[] = [];
  if (note.octave === -1) parts.push(labels.left);
  if (note.octave === 1) parts.push(labels.right);
  if (note.sharp) parts.push(labels.scroll);
  return parts.length > 0 ? ` (${parts.join(', ')})` : '';
}

function NoteFace({ note, labels }: { note: Note; labels: ModifierLabels }) {
  const color = tileColorKey(modifiersOf(note.octave, note.sharp));
  return (
    <span className={`pv-note pv-note-${color}`}>
      {note.key}
      {note.sharp ? (
        <span className="pv-sharp" aria-hidden="true">
          #
        </span>
      ) : null}
      <span className="sr-only">{modsText(labels, note)}</span>
    </span>
  );
}

function UnitChip({ unit, t, labels }: { unit: Unit; t: TFunction; labels: ModifierLabels }) {
  let body: ReactNode;
  let beats: number;
  if (unit.kind === 'rest') {
    beats = unit.beats;
    body = (
      <span className="pv-note pv-rest">
        <span aria-hidden="true">_</span>
        <span className="sr-only">{t('editor.unitRest')}</span>
      </span>
    );
  } else if (unit.kind === 'slur') {
    beats = unit.notes.reduce((s, n) => s + n.beats, 0);
    body = unit.notes.map((n, i) => (
      <span key={i} className="pv-slur-part">
        {i > 0 ? (
          <span className="pv-slur-join" aria-hidden="true">
            -
          </span>
        ) : null}
        <NoteFace note={n} labels={labels} />
      </span>
    ));
  } else {
    beats = unit.beats;
    body = <NoteFace note={unit} labels={labels} />;
  }
  return (
    <li className={unit.kind === 'slur' ? 'pv-chip pv-chip-slur' : 'pv-chip'}>
      {body}
      {Math.abs(beats - 1) > 1e-9 ? <span className="pv-dur">*{beatsText(beats)}</span> : null}
    </li>
  );
}

function DiagnosticsList({
  parsed,
  onJump,
  t,
}: {
  parsed: ParseResult;
  onJump: PreviewPanelProps['onJump'];
  t: TFunction;
}) {
  const sorted = useMemo(() => sortDiagnostics(parsed.diagnostics), [parsed.diagnostics]);
  const counts = { error: 0, warning: 0, info: 0 };
  for (const d of sorted) counts[d.severity]++;
  const shown = sorted.slice(0, MAX_PREVIEW_DIAGNOSTICS);
  return (
    <section className="pv-section" aria-labelledby="pv-diag-heading">
      <h3 id="pv-diag-heading">{t('editor.diagnostics')}</h3>
      {sorted.length === 0 ? (
        <p className="muted pv-diag-none">{t('editor.diagNone')}</p>
      ) : (
        <>
          <p className="muted pv-diag-summary">
            {t('editor.diagSummary', {
              errors: counts.error,
              warnings: counts.warning,
              infos: counts.info,
            })}
          </p>
          <ul className="pv-diags">
            {shown.map((d, i) => {
              const message = formatDiagnostic(t, d);
              const severity = t(`editor.severity.${d.severity}`);
              return (
                <li key={`${d.line}:${d.column}:${d.code}:${i}`}>
                  <button
                    type="button"
                    className={`pv-diag is-${d.severity}`}
                    title={t('editor.diagJump', {
                      severity,
                      line: d.line,
                      column: d.column,
                      message,
                    })}
                    onClick={() => onJump(d.line, d.column)}
                  >
                    <span className="pv-diag-glyph" aria-hidden="true">
                      {SEVERITY_GLYPH[d.severity]}
                    </span>
                    <span className="sr-only">{severity}: </span>
                    <span className="pv-diag-loc">
                      {t('editor.diagLocation', { line: d.line, column: d.column })}
                    </span>
                    <span className="pv-diag-msg">{message}</span>
                  </button>
                </li>
              );
            })}
          </ul>
          {sorted.length > shown.length ? (
            <p className="muted">{t('editor.diagMore', { n: sorted.length - shown.length })}</p>
          ) : null}
        </>
      )}
    </section>
  );
}

function LinesList({
  parsed,
  onJump,
  t,
  labels,
}: {
  parsed: ParseResult;
  onJump: PreviewPanelProps['onJump'];
  t: TFunction;
  labels: ModifierLabels;
}) {
  const { song, lineOrigins } = parsed;
  let index = 0;
  let rendered = 0;
  const groups: ReactNode[] = [];
  song.sections.forEach((section, si) => {
    const items: ReactNode[] = [];
    for (const line of section.lines) {
      const i = index++;
      if (rendered >= MAX_PREVIEW_LINES) continue;
      rendered++;
      const origin = lineOrigins[i];
      const sourceLine = origin?.sourceLine ?? 0;
      const total = line.units.reduce(
        (s, u) => s + (u.kind === 'slur' ? u.notes.reduce((a, n) => a + n.beats, 0) : u.beats),
        0,
      );
      items.push(
        <li key={i} className={origin?.repeatLine !== undefined ? 'pv-line is-repeat' : 'pv-line'}>
          <div className="pv-line-head">
            {sourceLine > 0 ? (
              <button
                type="button"
                className="pv-line-jump"
                aria-label={t('editor.lineJumpAria', { line: sourceLine })}
                onClick={() => onJump(sourceLine, 1)}
              >
                {t('editor.lineJump', { line: sourceLine })}
              </button>
            ) : null}
            {origin?.repeatLine !== undefined ? (
              <span className="pv-repeat">
                {t('editor.lineRepeated', { line: origin.repeatLine })}
              </span>
            ) : null}
            <span className="pv-line-beats muted">
              {t('common.beats', { n: beatsText(total) })}
            </span>
          </div>

          <ul className="pv-chips">
            {line.units.map((u, j) => (
              <UnitChip key={j} unit={u} t={t} labels={labels} />
            ))}
          </ul>
        </li>,
      );
    }
    // Đoạn rỗng (vd. `# RAP` chỉ có comment) vẫn hiện; đoạn bị cắt bởi giới hạn thì không.
    const show = section.lines.length === 0 ? rendered < MAX_PREVIEW_LINES : items.length > 0;
    if (show) {
      groups.push(
        <li key={`s${si}`} className="pv-group">
          <h4 className="pv-group-name">{section.name}</h4>
          {items.length > 0 ? (
            <ol className="pv-lines">{items}</ol>
          ) : (
            <p className="muted pv-group-empty">{t('editor.sectionEmpty')}</p>
          )}
        </li>,
      );
    }
  });
  const hidden = index - rendered;
  return (
    <section className="pv-section" aria-labelledby="pv-lines-heading">
      <h3 id="pv-lines-heading">{t('editor.lines')}</h3>
      {index === 0 ? <p className="muted">{t('editor.linesEmpty')}</p> : null}
      {groups.length > 0 ? <ul className="pv-groups">{groups}</ul> : null}
      {hidden > 0 ? <p className="muted">{t('editor.linesMore', { n: hidden })}</p> : null}
    </section>
  );
}

/**
 * Preview bên phải Editor: thông tin bài (directive), thống kê (nốt, beat + thời lượng, số lần
 * giữ chuột — kiểu Mobile: số lần chạm đổi chế độ —, nốt scroll), danh sách lỗi (bấm → tới vị trí
 * trong ô soạn) và các dòng theo đoạn (chip nốt tô màu modifier).
 */
export const PreviewPanel = memo(function PreviewPanel({ parsed, onJump }: PreviewPanelProps) {
  const t = useT();
  const labels = useModifierLabels();
  const mobile = useSettings((s) => s.controlScheme === 'mobile');
  const mobileSemitone = useSettings((s) => s.mobileSemitone);
  const { song } = parsed;
  const timeline = useMemo(() => buildTimeline(song), [song]);
  const stats = useMemo(() => songStats(timeline), [timeline]);
  const taps = useMemo(
    () => (mobile ? buildMobilePlan(timeline, { semitone: mobileSemitone }).stats : null),
    [mobile, timeline, mobileSemitone],
  );

  return (
    <div className="pv">
      <section className="pv-section" aria-labelledby="pv-info-heading">
        <h3 id="pv-info-heading">{t('editor.info')}</h3>
        <dl className="pv-dl">
          <div>
            <dt>{t('editor.dirTitle')}</dt>
            <dd>{song.title.trim() || t('common.untitled')}</dd>
          </div>
          <div>
            <dt>{t('editor.dirArtist')}</dt>
            <dd>{song.artist?.trim() || t('common.unknownArtist')}</dd>
          </div>
          <div>
            <dt>{t('editor.dirBpm')}</dt>
            <dd>{t('common.bpm', { n: song.bpm })}</dd>
          </div>
          <div>
            <dt>{t('editor.dirTime')}</dt>
            <dd>{`${song.timeSig.num}/${song.timeSig.den}`}</dd>
          </div>
          <div>
            <dt>{t('editor.dirScroll', { mod: labels.scroll })}</dt>
            <dd>{song.scrollDir > 0 ? '+1' : '−1'}</dd>
          </div>
        </dl>
      </section>

      <section className="pv-section" aria-labelledby="pv-stats-heading">
        <h3 id="pv-stats-heading">{t('editor.stats')}</h3>
        <dl className="pv-dl">
          <div>
            <dt>{t('editor.statNotes')}</dt>
            <dd data-stat="notes">{stats.noteCount}</dd>
          </div>
          <div>
            <dt>{t('editor.statBeats')}</dt>
            <dd data-stat="beats">
              {t('editor.statBeatsValue', {
                beats: beatsText(stats.totalBeats),
                time: formatDuration(stats.durationSec),
              })}
            </dd>
          </div>
          {taps ? (
            <div>
              <dt>{t('editor.statTaps')}</dt>
              <dd data-stat="taps">
                {t('editor.statTapsValue', {
                  octave: taps.octaveTaps,
                  semitone: taps.semitoneTaps,
                  name: labels.scroll,
                })}
              </dd>
            </div>
          ) : (
            <div>
              <dt>{t('editor.statHolds')}</dt>
              <dd data-stat="holds">
                {t('editor.statHoldsValue', {
                  left: stats.presses.left,
                  right: stats.presses.right,
                  runs: stats.holdRunCount,
                })}
              </dd>
            </div>
          )}
          <div>
            <dt>
              {taps ? t('editor.statSharpMobile', { name: labels.scroll }) : t('editor.statScroll')}
            </dt>
            <dd data-stat="scroll">{stats.scrollNoteCount}</dd>
          </div>
        </dl>
      </section>

      <DiagnosticsList parsed={parsed} onJump={onJump} t={t} />
      <LinesList parsed={parsed} onJump={onJump} t={t} labels={labels} />
    </div>
  );
});

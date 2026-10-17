import { Fragment, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { formatBeats } from '../../core/beats';
import { modifiersOf } from '../../core/keys';
import { setUnitBeats } from '../../core/sourceEdit';
import {
  DEFAULT_TAP_GRID,
  TapSession,
  collectTapTargets,
  computeTapDurations,
} from '../../core/tapTiming';
import type { TapTarget } from '../../core/tapTiming';
import type { Note, Unit } from '../../core/types';
import { useT } from '../../i18n/useT';
import type { TFunction } from '../../i18n/useT';
import { Button, Modal, Select, Toggle } from '../../ui/components';
import { useModifierLabels } from '../../ui/modLabels';
import type { ModifierLabels } from '../../ui/modLabels';
import { tileColorKey } from '../../ui/palette';
import { toast } from '../../ui/toast';
import type { EditorToolProps } from './types';
import './tools.css';

/**
 * Tap timing (spec §6): chọn cả bài hoặc một section, bấm Space theo nhịp bài gốc (mở ở chỗ khác),
 * mỗi lần bấm = 1 nốt / cụm luyến. Khoảng cách giữa các lần bấm → độ dài, ghi `*dur` vào văn bản.
 */

/**
 * Giá trị đánh dấu "không đo được" (nốt bấm cuối, nốt ngay trước chỗ đứt) — không ai bấm một nốt
 * dài 10^12 beat nên không lẫn với số đo thật. Nốt đó giữ nguyên độ dài đang có trong văn bản.
 */
const UNMEASURED = 1e12;
/** Số nốt sắp tới hiện bên dưới nốt hiện tại. */
const NEXT_COUNT = 5;

type Phase = 'setup' | 'tapping';

function isRepeatedLine(parsed: EditorToolProps['parsed'], i: number): boolean {
  const span = parsed.lineSpans[i];
  return span !== undefined ? span.repeated : parsed.lineOrigins[i]?.repeatLine !== undefined;
}

function unitNotes(unit: Unit | undefined): Note[] {
  if (!unit || unit.kind === 'rest') return [];
  return unit.kind === 'note' ? [unit] : unit.notes;
}

/** Phím của unit, tô màu theo modifier (luyến X-C tô từng nốt). */
function UnitKeys({ unit }: { unit: Unit | undefined }) {
  const notes = unitNotes(unit);
  if (notes.length === 0) {
    return (
      <span className="tap-keys">
        <span className="tap-key is-rest">_</span>
      </span>
    );
  }
  return (
    <span className="tap-keys">
      {notes.map((n, i) => (
        <Fragment key={i}>
          {i > 0 ? (
            <span className="tap-sep" aria-hidden="true">
              -
            </span>
          ) : null}
          <span className={`tap-key mod-${tileColorKey(modifiersOf(n.octave, n.sharp))}`}>
            {n.key}
            {n.sharp && n.octave !== 0 ? <sup>#</sup> : null}
          </span>
        </Fragment>
      ))}
    </span>
  );
}

/** "Cúi Xuống + Nửa Cung" / "thường"; luyến có modifier khác nhau: "Z: thường · N: Cúi Xuống". */
export function modifierText(t: TFunction, labels: ModifierLabels, unit: Unit | undefined): string {
  const notes = unitNotes(unit);
  const one = (n: Note): string => {
    const names: string[] = [];
    if (n.octave === -1) names.push(labels.left);
    if (n.octave === 1) names.push(labels.right);
    if (n.sharp) names.push(labels.scroll);
    return names.length > 0 ? names.join(' + ') : t('editor.tools.tap.modNone');
  };
  const parts = notes.map(one);
  if (parts.every((p) => p === parts[0])) return parts[0] ?? '';
  return notes.map((n, i) => `${n.key}: ${parts[i] ?? ''}`).join(' · ');
}

export function TapTimingModal(props: EditorToolProps) {
  if (!props.open) return null;
  return <TapTimingDialog {...props} />;
}

function TapTimingDialog({ onClose, source, parsed, onApply }: EditorToolProps) {
  const t = useT();
  const labels = useModifierLabels();
  const instructionsId = useId();
  const currentId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const padRef = useRef<HTMLButtonElement>(null);

  const sections = parsed.song.sections;
  const bpm = parsed.song.bpm;
  const [scope, setScope] = useState('all');
  const [quantize, setQuantize] = useState(true);
  const [phase, setPhase] = useState<Phase>('setup');
  // số lần bấm — chỉ để render lại sau mỗi thao tác trên session (session là đối tượng mutable)
  const [, setTapCount] = useState(0);
  /** Đang hỏi "bỏ các lần tap?" (Esc / × / Hủy / bấm nền khi đã tap). */
  const [confirmClose, setConfirmClose] = useState(false);

  const sectionIndex = scope === 'all' ? null : Number(scope);
  const targets = useMemo(() => collectTapTargets(parsed, sectionIndex), [parsed, sectionIndex]);
  const session = useMemo(() => new TapSession(targets), [targets]);
  const lines = useMemo(() => parsed.song.sections.flatMap((s) => s.lines), [parsed]);
  const unitOf = (tg: TapTarget | undefined): Unit | undefined =>
    tg ? lines[tg.lineIndex]?.units[tg.unitIndex] : undefined;

  const sync = () => setTapCount(session.count);

  /**
   * Mọi đường đóng (Esc, ×, Hủy, bấm nền) đi qua đây: đang tap dở thì không đóng ngay mà hỏi lại
   * — phiên tap có thể dài vài phút, đóng nhầm là mất hết (modal trả null khi đóng, D-111). Focus
   * về ô tap để Space vẫn tap tiếp được (tap tiếp = bỏ câu hỏi).
   */
  const requestClose = () => {
    if (phase === 'tapping' && session.count > 0) {
      setConfirmClose(true);
      padRef.current?.focus();
      return;
    }
    onClose();
  };
  const keepTapping = () => {
    setConfirmClose(false);
    padRef.current?.focus();
  };

  // Space = tap; chỉ lắng nghe trên dialog (không phải window), bỏ phím lặp khi giữ
  useEffect(() => {
    if (phase !== 'tapping') return;
    const dialog = rootRef.current?.closest('[role="dialog"]');
    if (!dialog) return;
    const onKey = (e: Event) => {
      if (!(e instanceof KeyboardEvent)) return;
      if (e.code !== 'Space' && e.key !== ' ') return;
      if (e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return;
      const el = e.target;
      if (el instanceof Element && el.closest('select, textarea, input[type="text"]')) return;
      // đang hỏi bỏ tap: Space trên nút của câu hỏi là bấm nút đó, không phải tap
      if (el instanceof Element && el.closest('.tap-confirm')) return;
      e.preventDefault();
      if (e.repeat) return;
      session.tap(e.timeStamp);
      setTapCount(session.count);
      setConfirmClose(false);
    };
    dialog.addEventListener('keydown', onKey);
    return () => dialog.removeEventListener('keydown', onKey);
  }, [phase, session]);

  useEffect(() => {
    if (phase === 'tapping') padRef.current?.focus();
  }, [phase]);

  const onPadPointerDown = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return;
    session.tap(e.timeStamp);
    sync();
    setConfirmClose(false);
  };

  const changeScope = (v: string) => {
    setScope(v);
    setPhase('setup');
    setConfirmClose(false);
  };

  const durations = computeTapDurations(targets, session.taps(), {
    bpm,
    quantize,
    grid: DEFAULT_TAP_GRID,
    lastBeats: UNMEASURED,
  });
  const measured = durations.filter((d) => d.beats !== UNMEASURED);
  const lastMeasured = session.count >= 2 ? durations[session.count - 2] : undefined;

  const apply = () => {
    const current = new Map(targets.map((tg) => [`${tg.lineIndex}:${tg.unitIndex}`, tg.beats]));
    const changes = measured.filter((d) => {
      const before = current.get(`${d.lineIndex}:${d.unitIndex}`);
      return before === undefined || Math.abs(before - d.beats) > 1e-9;
    });
    let next: string;
    try {
      next = setUnitBeats(source, parsed, changes);
    } catch (err) {
      console.error(err);
      toast(t('editor.tools.applyFailed'), 'error');
      return;
    }
    if (next === source) toast(t('editor.tools.noChanges'));
    else onApply(next, t('editor.tools.tap.undoLabel'));
    onClose();
  };

  const scopeOptions = [
    { value: 'all', label: t('editor.tools.tap.scopeAll') },
    ...sections.flatMap((s, i) =>
      s.lines.length > 0
        ? [
            {
              value: String(i),
              label: t('editor.tools.tap.scopeSection', { name: s.name, n: s.lines.length }),
            },
          ]
        : [],
    ),
  ];
  const hasRepeatLines = lines.some((_, i) => isRepeatedLine(parsed, i));
  const targetsRepeated = targets.some((tg) => tg.repeated);

  const current = session.done ? undefined : targets[session.index];
  const upcoming: TapTarget[] = [];
  for (let i = session.index + 1, n = 0; i < targets.length && n < NEXT_COUNT; i++) {
    const tg = targets[i];
    if (!tg) break;
    upcoming.push(tg);
    if (tg.kind !== 'rest') n++;
  }

  const footer = (
    <>
      <Button onClick={requestClose}>{t('common.cancel')}</Button>
      <Button variant="primary" disabled={measured.length === 0} onClick={apply}>
        {t('editor.tools.apply')}
      </Button>
    </>
  );

  return (
    <Modal
      open
      title={t('editor.tools.tap.title')}
      onClose={requestClose}
      footer={footer}
      size="lg"
    >
      <div ref={rootRef} className="tool-stack">
        <div className="tool-note" id={instructionsId}>
          <p>{t('editor.tools.tap.instructions')}</p>
          <p>{t('editor.tools.tap.lastNote')}</p>
        </div>

        <div className="tool-row">
          <Select
            label={t('editor.tools.tap.scope')}
            value={scope}
            options={scopeOptions}
            onChange={changeScope}
          />
          <Toggle
            label={t('editor.tools.tap.quantize')}
            checked={quantize}
            onChange={setQuantize}
          />
          <p className="field-hint">{t('editor.tools.tap.bpm', { n: bpm })}</p>
        </div>

        {scope === 'all' && hasRepeatLines ? (
          <p className="field-hint">{t('editor.tools.tap.repeatSkipped')}</p>
        ) : null}
        {targetsRepeated ? (
          <div className="tool-note tool-note-warn">
            <p>{t('editor.tools.tap.repeatNote')}</p>
          </div>
        ) : null}

        {phase === 'setup' ? (
          <div className="row">
            <Button
              variant="primary"
              size="lg"
              data-autofocus
              disabled={session.total === 0}
              onClick={() => {
                session.reset();
                sync();
                setPhase('tapping');
              }}
            >
              {t('editor.tools.tap.start')}
            </Button>
            <span className="muted">
              {session.total === 0
                ? t('editor.tools.tap.nothing')
                : t('editor.tools.tap.count', { n: session.total })}
            </span>
          </div>
        ) : (
          <>
            {confirmClose && session.count > 0 ? (
              <div className="tool-note tool-note-warn tap-confirm" role="alert">
                <p>{t('editor.tools.tap.discardPrompt', { n: session.count })}</p>
                <span className="row tool-row-tight">
                  <Button variant="danger" onClick={onClose}>
                    {t('editor.tools.tap.discardConfirm', { n: session.count })}
                  </Button>
                  <Button onClick={keepTapping}>{t('editor.tools.tap.discardKeep')}</Button>
                </span>
              </div>
            ) : null}
            <button
              ref={padRef}
              type="button"
              className="tap-pad"
              aria-label={t('editor.tools.tap.pad')}
              aria-describedby={`${currentId} ${instructionsId}`}
              onPointerDown={onPadPointerDown}
            >
              {current ? (
                <span id={currentId} className="tap-current tool-stack tool-stack-tight">
                  <UnitKeys unit={unitOf(current)} />
                  <span className="tap-mods">{modifierText(t, labels, unitOf(current))}</span>
                </span>
              ) : (
                <span id={currentId} className="tap-done">
                  {t('editor.tools.tap.done', { n: session.total })}
                </span>
              )}
            </button>

            {upcoming.length > 0 ? (
              <div className="tool-stack tool-stack-tight">
                <span className="muted">{t('editor.tools.tap.next')}</span>
                <ol className="tap-next">
                  {upcoming.map((tg) => (
                    <li key={`${tg.lineIndex}:${tg.unitIndex}`}>
                      <UnitKeys unit={unitOf(tg)} />
                      <span>
                        {tg.kind === 'rest'
                          ? t('editor.tools.tap.rest', { beats: formatBeats(tg.beats) })
                          : '\u00A0'}
                      </span>
                    </li>
                  ))}
                </ol>
              </div>
            ) : null}

            <div className="tap-status">
              <span className="tap-progress">
                {t('editor.tools.tap.progress', { n: session.count, total: session.total })}
              </span>
              {lastMeasured && lastMeasured.beats !== UNMEASURED ? (
                <span className="muted">
                  {t('editor.tools.tap.lastMeasured', { beats: formatBeats(lastMeasured.beats) })}
                </span>
              ) : null}
              <span className="row tool-row-tight">
                <Button
                  disabled={session.count === 0}
                  onClick={() => {
                    session.undo();
                    sync();
                  }}
                >
                  {t('editor.tools.tap.undo')}
                </Button>
                <Button
                  disabled={session.count === 0}
                  onClick={() => {
                    session.reset();
                    sync();
                    padRef.current?.focus();
                  }}
                >
                  {t('editor.tools.tap.restart')}
                </Button>
              </span>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

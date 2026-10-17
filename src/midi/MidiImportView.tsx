import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { installHashGuard } from '../editor/hashGuard';
import type { StringKey } from '../i18n/strings';
import { useT } from '../i18n/useT';
import { Button, Modal } from '../ui/components';
import { FileWizard } from './FileWizard';
import type { FinishSource } from './finishSteps';
import { ArrangeStep, KeyStep, useFinish } from './finishSteps';
import { RecordPanel } from './RecordPanel';
import type { RecordResult } from './RecordPanel';
import { StepFrame, StepIndicator, useStepFocus } from './wizardUi';
import './midi.css';

export {
  BPM_MAX,
  BPM_MIN,
  formatBpm,
  formatTimeSig,
  GRID_LABELS,
  HARM_PREVIEW_LINES,
  OVERLAP_POLICIES,
} from './wizardUi';
export type { FinishSource } from './finishSteps';

/**
 * Route #/midi — "Tạo bài từ file" (MIDI / MusicXML, spec §6b A + Phase 2c, FileWizard.tsx) và
 * "Thu melody" (§6b B Dùng 2). Thu: thu từ đàn MIDI → 4 chọn cung → 5 xem trước → Editor (bản nháp).
 */

// ---------------------------------------------------------------------------
// Luồng "Thu melody"
// ---------------------------------------------------------------------------

const RECORD_STEPS: readonly StringKey[] = [
  'midi.step.record',
  'midi.step.key',
  'midi.step.arrange',
];

function RecordWizard({
  active,
  onBusyChange,
  onHasTakeChange,
  onCreated,
}: {
  active: boolean;
  onBusyChange: (busy: boolean) => void;
  onHasTakeChange: (hasTake: boolean) => void;
  onCreated: () => void;
}) {
  const t = useT();
  const rootRef = useRef<HTMLDivElement>(null);
  const [step, setStep] = useState(0);
  const [result, setResult] = useState<RecordResult | null>(null);
  useStepFocus(step, rootRef);

  const source = useMemo<FinishSource | null>(
    () =>
      result && result.mono.length > 0
        ? {
            mono: result.mono,
            bpm: result.bpm,
            timeSig: result.timeSig,
            grid: result.grid,
            markers: [],
          }
        : null,
    [result],
  );
  const finish = useFinish(source, step >= 1, t('midi.record.defaultTitle'), 0);
  const total = RECORD_STEPS.length;

  return (
    <div ref={rootRef} className="stack">
      <StepIndicator labels={RECORD_STEPS} current={step} />
      <div hidden={step !== 0}>
        <StepFrame title={t('midi.step.record')} index={0} total={total}>
          <RecordPanel
            active={active && step === 0}
            onBusyChange={onBusyChange}
            onHasTakeChange={onHasTakeChange}
            onContinue={(r) => {
              setResult(r);
              setStep(1);
            }}
          />
        </StepFrame>
      </div>
      {step === 1 && source ? (
        <KeyStep
          finish={finish}
          index={1}
          total={total}
          onBack={() => setStep(0)}
          onNext={() => setStep(2)}
        />
      ) : null}
      {step === 2 && source ? (
        <ArrangeStep
          finish={finish}
          index={2}
          total={total}
          onBack={() => setStep(1)}
          onCreated={onCreated}
        />
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// View
// ---------------------------------------------------------------------------

type Tab = 'file' | 'record';
const TABS: readonly Tab[] = ['file', 'record'];

export function MidiImportView() {
  const t = useT();
  const titleId = useId();
  const baseId = useId();
  const [tab, setTab] = useState<Tab>('file');
  const [busy, setBusy] = useState(false);
  const tabRefs = useRef<Partial<Record<Tab, HTMLButtonElement | null>>>({});

  // ── Chặn rời trang khi còn việc dở (file đang tạo bài, đang thu, có bản thu) — như Editor (D-104)
  const work = useRef({ file: false, take: false, busy: false, created: false });
  const [pendingLeave, setPendingLeave] = useState<string | null>(null);
  const onBusy = useCallback((b: boolean) => {
    work.current.busy = b;
    setBusy(b);
  }, []);
  const onFileDirty = useCallback((dirty: boolean) => {
    work.current.file = dirty;
  }, []);
  const onHasTake = useCallback((has: boolean) => {
    work.current.take = has;
  }, []);
  const onCreated = useCallback(() => {
    work.current.created = true;
  }, []);
  useEffect(() => {
    const shouldBlock = () => {
      const w = work.current;
      return !w.created && (w.file || w.take || w.busy);
    };
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!shouldBlock()) return;
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    const removeGuard = installHashGuard(window, {
      shouldBlock,
      onBlocked: (next) => setPendingLeave(next),
    });
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      removeGuard();
    };
  }, []);
  const leave = () => {
    const target = pendingLeave;
    setPendingLeave(null);
    if (target === null) return;
    work.current.created = true; // cho qua; unmount sẽ hủy bản thu đang chạy
    window.location.hash = target;
  };

  const select = (next: Tab, focus: boolean) => {
    if (busy && next !== tab) return;
    setTab(next);
    if (focus) tabRefs.current[next]?.focus();
  };

  const onTabKey = (e: ReactKeyboardEvent<HTMLButtonElement>) => {
    const i = TABS.indexOf(tab);
    let next: Tab | null = null;
    if (e.key === 'ArrowRight') next = TABS[(i + 1) % TABS.length];
    else if (e.key === 'ArrowLeft') next = TABS[(i - 1 + TABS.length) % TABS.length];
    else if (e.key === 'Home') next = TABS[0];
    else if (e.key === 'End') next = TABS[TABS.length - 1];
    if (next) {
      e.preventDefault();
      select(next, true);
    }
  };

  const tabLabel: Record<Tab, StringKey> = { file: 'midi.tab.file', record: 'midi.tab.record' };

  return (
    <section className="midi-import stack" aria-labelledby={titleId}>
      <header className="midi-header">
        <h1 id={titleId}>{t('midi.title')}</h1>
        <p className="muted">{t('midi.subtitle')}</p>
      </header>
      <div role="tablist" aria-label={t('midi.tabs')} className="midi-tabs">
        {TABS.map((k) => (
          <button
            key={k}
            ref={(el) => {
              tabRefs.current[k] = el;
            }}
            type="button"
            role="tab"
            id={`${baseId}-tab-${k}`}
            aria-selected={tab === k}
            aria-controls={`${baseId}-panel-${k}`}
            tabIndex={tab === k ? 0 : -1}
            disabled={busy && tab !== k}
            className="midi-tab"
            onClick={() => select(k, false)}
            onKeyDown={onTabKey}
          >
            {t(tabLabel[k])}
          </button>
        ))}
      </div>
      {TABS.map((k) => (
        <div
          key={k}
          role="tabpanel"
          id={`${baseId}-panel-${k}`}
          aria-labelledby={`${baseId}-tab-${k}`}
          hidden={tab !== k}
        >
          {k === 'file' ? (
            <FileWizard active={tab === 'file'} onDirtyChange={onFileDirty} onCreated={onCreated} />
          ) : (
            <RecordWizard
              active={tab === 'record'}
              onBusyChange={onBusy}
              onHasTakeChange={onHasTake}
              onCreated={onCreated}
            />
          )}
        </div>
      ))}
      <Modal
        open={pendingLeave !== null}
        title={t('midi.leave.title')}
        onClose={() => setPendingLeave(null)}
        footer={
          <>
            <Button onClick={() => setPendingLeave(null)} data-autofocus>
              {t('midi.leave.stay')}
            </Button>
            <Button variant="danger" onClick={leave}>
              {t('midi.leave.discard')}
            </Button>
          </>
        }
      >
        <p>{busy ? t('midi.leave.bodyRecording') : t('midi.leave.body')}</p>
      </Modal>
    </section>
  );
}

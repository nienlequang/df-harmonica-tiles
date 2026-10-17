import { useEffect, useMemo, useRef, useState } from 'react';
import { GAME_SCROLL_DIR } from '../../core/keys';
import { melodyPitches } from '../../core/melody';
import { melodyToHarm, songToMelody } from '../../core/melodyBuild';
import { buildMobilePlan } from '../../core/mobile';
import { placementCost } from '../../core/optimizer';
import type { Placement } from '../../core/optimizer';
import { songStats } from '../../core/stats';
import { buildTimeline } from '../../core/timeline';
import type { Song } from '../../core/types';
import { useT } from '../../i18n/useT';
import { Button, Modal } from '../../ui/components';
import { useModifierLabels } from '../../ui/modLabels';
import { useSettings } from '../../ui/settings';
import type { ControlScheme, MobileSemitone } from '../../ui/settings';
import { toast } from '../../ui/toast';
import { OptimizerPanel, playableRangeLabel } from '../OptimizerPanel';
import type { EditorToolProps } from './types';
import './tools.css';

/**
 * "Tối ưu tông" (spec §6): đọc cao độ của bài hiện tại, chạy optimizer, chọn phương án rồi viết lại
 * toàn bộ `.harm` (giữ title/artist/bpm/time, section). Văn bản được viết lại theo dạng chuẩn nên
 * comment mất và `@repeat` bị trải ra — luôn hỏi xác nhận trước khi thay. Bài cũ `@scroll -1`: cao độ
 * đọc theo @scroll của bài, bài mới luôn ghi `@scroll +1` (GAME_SCROLL_DIR).
 */

type Phase = 'choose' | 'confirm';

interface Selection {
  pitches: readonly (number | null)[];
  placement: Placement;
}

const COMMENT_RE = /^[\uFEFF\s]*\/\//m;
const REPEAT_RE = /^[\uFEFF\s]*@repeat\b/im;

function scrollText(dir: 1 | -1): string {
  return dir === -1 ? '\u22121' : '+1';
}

/** Thống kê "Bài hiện tại" theo kiểu điều khiển — cùng cost model với OptimizerPanel. */
export type CurrentStats =
  | { scheme: 'pc'; scroll: number; holds: number; modified: number; cost: number }
  | { scheme: 'mobile'; scroll: number; octaveTaps: number; semitoneTaps: number; cost: number };

export function currentSongStats(
  song: Song,
  opts: { baseOctave: number; scheme: ControlScheme; mobileSemitone: MobileSemitone },
): CurrentStats {
  const tl = buildTimeline(song, { baseOctave: opts.baseOctave });
  const st = songStats(tl);
  const base = {
    noteCount: st.noteCount,
    scrollNotes: st.scrollNoteCount,
    holdRuns: st.holdRunCount,
    modifiedNotes: st.modifiedNoteCount,
    foldedNotes: 0,
  };
  if (opts.scheme === 'mobile') {
    // chế độ giữ qua chỗ nghỉ — buildMobilePlan đếm đúng các lần chạm mà optimizer Mobile tính cost
    const { octaveTaps, semitoneTaps } = buildMobilePlan(tl, {
      semitone: opts.mobileSemitone,
    }).stats;
    return {
      scheme: 'mobile',
      scroll: st.scrollNoteCount,
      octaveTaps,
      semitoneTaps,
      cost: placementCost({ ...base, octaveTaps, semitoneTaps }),
    };
  }
  return {
    scheme: 'pc',
    scroll: st.scrollNoteCount,
    holds: st.holdRunCount,
    modified: st.modifiedNoteCount,
    cost: placementCost(base),
  };
}

export function ReoptimizeModal(props: EditorToolProps) {
  if (!props.open) return null;
  return <ReoptimizeDialog {...props} />;
}

function ReoptimizeDialog({ onClose, source, parsed, onApply }: EditorToolProps) {
  const t = useT();
  const baseOctave = useSettings((s) => s.baseOctave);
  const scheme = useSettings((s) => s.controlScheme);
  const mobileSemitone = useSettings((s) => s.mobileSemitone);
  const labels = useModifierLabels();
  const song = parsed.song;

  const [selection, setSelection] = useState<Selection | null>(null);
  const [phase, setPhase] = useState<Phase>('choose');
  const rootRef = useRef<HTMLDivElement>(null);

  // đổi bước: nút vừa bấm biến mất → đưa focus tới nút chính của bước mới
  useEffect(() => {
    if (phase !== 'confirm') return;
    const dialog = rootRef.current?.closest('[role="dialog"]');
    dialog?.querySelector<HTMLElement>('[data-autofocus]')?.focus();
  }, [phase]);

  // cao độ theo ý người soạn: nốt scroll đọc theo @scroll của bài (D-030), bài mới ghi theo game (+1)
  const melody = useMemo(
    () => songToMelody(song, { baseOctave, scrollDir: song.scrollDir }),
    [song, baseOctave],
  );
  const pitches = useMemo(() => melodyPitches(melody), [melody]);
  const noteCount = useMemo(() => pitches.filter((p) => p !== null).length, [pitches]);
  const value = selection && selection.pitches === pitches ? selection.placement : null;
  const range = playableRangeLabel(baseOctave);

  const current = useMemo(
    () => currentSongStats(song, { baseOctave, scheme, mobileSemitone }),
    [song, baseOctave, scheme, mobileSemitone],
  );

  const harm = useMemo(() => {
    if (!value || noteCount === 0) return null;
    try {
      return melodyToHarm(melody, value, {
        scrollDir: GAME_SCROLL_DIR,
        baseOctave,
        warningText: (n) => t('editor.tools.foldWarning', { n, range }),
      });
    } catch (err) {
      console.error(err);
      return null;
    }
  }, [value, noteCount, melody, baseOctave, t, range]);

  const apply = () => {
    if (harm === null) {
      toast(t('editor.tools.applyFailed'), 'error');
      return;
    }
    if (harm === source) toast(t('editor.tools.noChanges'));
    else onApply(harm, t('editor.tools.reopt.undoLabel'));
    onClose();
  };

  const footer =
    phase === 'choose' ? (
      <>
        <Button onClick={onClose}>{t('common.cancel')}</Button>
        <Button variant="primary" disabled={harm === null} onClick={() => setPhase('confirm')}>
          {t('editor.tools.reopt.continue')}
        </Button>
      </>
    ) : (
      <>
        <Button onClick={() => setPhase('choose')}>{t('common.back')}</Button>
        <Button variant="primary" data-autofocus onClick={apply}>
          {t('editor.tools.reopt.confirm')}
        </Button>
      </>
    );

  return (
    <Modal open title={t('editor.tools.reopt.title')} onClose={onClose} footer={footer} size="lg">
      {phase === 'choose' ? (
        <div ref={rootRef} className="tool-stack">
          <p className="muted">{t('editor.tools.reopt.intro')}</p>
          {noteCount > 0 ? (
            <p>
              {current.scheme === 'mobile'
                ? t('editor.tools.reopt.currentMobile', {
                    scroll: current.scroll,
                    octaveTaps: current.octaveTaps,
                    semitoneTaps: current.semitoneTaps,
                    cost: current.cost,
                    name: labels.scroll,
                  })
                : t('editor.tools.reopt.current', {
                    scroll: current.scroll,
                    holds: current.holds,
                    modified: current.modified,
                    cost: current.cost,
                  })}
            </p>
          ) : null}
          {song.scrollDir !== GAME_SCROLL_DIR ? (
            <div className="tool-note tool-note-warn">
              <p>
                {t('editor.tools.reopt.scrollNote', {
                  song: scrollText(song.scrollDir),
                  game: scrollText(GAME_SCROLL_DIR),
                  mod: labels.scroll,
                })}
              </p>
            </div>
          ) : null}
          <OptimizerPanel
            pitches={pitches}
            baseOctave={baseOctave}
            value={value}
            onChange={(p) => setSelection({ pitches, placement: p })}
          />
        </div>
      ) : (
        <div ref={rootRef} className="tool-stack">
          <div className="tool-note tool-note-warn" role="alert">
            <p>
              <strong>{t('editor.tools.reopt.confirmIntro')}</strong>
            </p>
            <ul>
              {COMMENT_RE.test(source) ? <li>{t('editor.tools.reopt.lossComments')}</li> : null}
              {REPEAT_RE.test(source) ? <li>{t('editor.tools.reopt.lossRepeat')}</li> : null}
              {!parsed.ok ? <li>{t('editor.tools.reopt.lossErrors')}</li> : null}
              <li>{t('editor.tools.reopt.lossFormat')}</li>
            </ul>
            <p>{t('editor.tools.reopt.undoHint')}</p>
          </div>
        </div>
      )}
    </Modal>
  );
}

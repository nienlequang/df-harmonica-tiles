import type { ReactNode } from 'react';
import { useCallback, useId, useMemo, useState } from 'react';
import {
  baseMidi,
  DEFAULT_BASE_OCTAVE,
  GAME_SCROLL_DIR,
  midiName,
  playableRange,
} from '../core/keys';
import type { Melody } from '../core/melody';
import { melodyPitches } from '../core/melody';
import { melodyToHarm } from '../core/melodyBuild';
import type { OptimizerOptions, Placement } from '../core/optimizer';
import { evaluateTranspose, optimizeTranspose } from '../core/optimizer';
import type { TimeSig } from '../core/types';
import { OptimizerPanel } from '../editor/OptimizerPanel';
import { useT } from '../i18n/useT';
import { openDraftSong, useLibrary } from '../library/store';
import { Button } from '../ui/components';
import { FEATURES } from '../ui/features';
import { navigate, paths } from '../ui/router';
import { useSettings } from '../ui/settings';
import { toast } from '../ui/toast';
import { autoArrangeMelody } from './autoArrange';
import type { MonoNote } from './types';
import { HARM_PREVIEW_LINES, StepFrame, TextField } from './wizardUi';

/**
 * Bước 4 (chọn cung) và 5 (xem trước → Editor), dùng chung cho file và bản thu. Gộp nốt vượt tầm
 * luôn bật, chia dòng / section do máy tự chọn (góp ý 2026-10-15 C — không còn ô chỉnh).
 */

/**
 * Tùy chọn optimizer theo Cài đặt (tầm, kiểu điều khiển PC / Mobile; Nửa Cung luôn thăng; gộp nốt
 * vượt tầm luôn bật) — cùng cost model với OptimizerPanel, để phương án "tối ưu" chọn sẵn khớp dòng
 * đầu của bảng.
 */
function useOptimizerOptions(): OptimizerOptions {
  const baseOctave = useSettings((s) => s.baseOctave);
  const scheme = useSettings((s) => s.controlScheme);
  const mobileSemitone = useSettings((s) => s.mobileSemitone);
  return useMemo(
    () =>
      scheme === 'mobile'
        ? { baseOctave, scrollDir: GAME_SCROLL_DIR, fold: true, scheme, mobileSemitone }
        : { baseOctave, scrollDir: GAME_SCROLL_DIR, fold: true },
    [baseOctave, scheme, mobileSemitone],
  );
}

function optionsKey(o: OptimizerOptions): string {
  return `${o.baseOctave}|${o.scrollDir}|${o.fold ? 1 : 0}|${o.scheme ?? 'pc'}|${o.mobileSemitone ?? ''}`;
}

/** Đầu vào của bước 4–5: melody đơn âm + thông tin nhịp. */
export interface FinishSource {
  mono: readonly MonoNote[];
  bpm: number;
  timeSig: TimeSig;
  /** Grid đã dùng khi trích (beat), 0 = tắt. */
  grid: number;
  markers: ReadonlyArray<{ beat: number; text: string }>;
}

export interface FinishState {
  /** Phương án đang chọn (người dùng chọn, không thì tối ưu nhất). */
  placement: Placement | null;
  choose: (p: Placement | null) => void;
  pitches: (number | null)[];
  shape: Melody | null;
  /** Số section theo marker của file (0 = section chia tự động). */
  markerSections: number;
  /** Tên đang hiện trong ô (chưa sửa = tên mặc định, theo ngôn ngữ hiện tại). */
  title: string;
  setTitle: (v: string) => void;
  /** Tác giả đang hiện (chưa sửa = tác giả lấy từ file, vd. composer của MusicXML). */
  artist: string;
  setArtist: (v: string) => void;
  defaultTitle: string;
}

/**
 * State bước 4–5. `resetKey` đổi (file mới) → về mặc định. Phương án chọn gắn với khóa
 * (cao độ, base, scroll, kiểu điều khiển): melody / setting đổi thì tự về phương án tối ưu mới.
 */
export function useFinish(
  source: FinishSource | null,
  optimizeActive: boolean,
  defaultTitle: string,
  resetKey: number,
  defaultArtist = '',
): FinishState {
  const optOpts = useOptimizerOptions();
  const [choice, setChoice] = useState<{ key: string; placement: Placement } | null>(null);
  // null = chưa sửa tay → dùng tên / tác giả mặc định (tên file, "Bản thu MIDI" theo ngôn ngữ…)
  const [titleEdit, setTitle] = useState<string | null>(null);
  const [artistEdit, setArtist] = useState<string | null>(null);
  const [forKey, setForKey] = useState(resetKey);
  if (forKey !== resetKey) {
    // file mới → bước 4–5 về mặc định (D-135)
    setForKey(resetKey);
    setChoice(null);
    setTitle(null);
    setArtist(null);
  }

  // Melody không gồm title/artist: gõ tên bài không làm tính lại optimizer. Chia dòng / section tự
  // động (autoArrangeMelody), marker của file chỉ dùng khi hợp lý.
  const arranged = useMemo(
    () =>
      source && source.mono.length > 0
        ? autoArrangeMelody(source.mono, {
            title: '',
            bpm: source.bpm,
            timeSig: source.timeSig,
            markers: source.markers,
            grid: source.grid,
          })
        : null,
    [source],
  );
  const shape = arranged ? arranged.melody : null;
  const pitches = useMemo(() => (shape ? melodyPitches(shape) : []), [shape]);
  // khóa = (cao độ, base, scroll, kiểu điều khiển): đổi gì cũng về phương án tối ưu mới
  const optKey = `${optionsKey(optOpts)}|${pitches.join(',')}`;
  const best = useMemo(
    () =>
      optimizeActive && shape
        ? (optimizeTranspose(pitches, { ...optOpts, top: 1 })[0] ?? null)
        : null,
    [optimizeActive, shape, pitches, optOpts],
  );
  const placement = choice && choice.key === optKey ? choice.placement : best;
  const choose = useCallback(
    (p: Placement | null) => setChoice(p ? { key: optKey, placement: p } : null),
    [optKey],
  );
  return {
    placement,
    choose,
    pitches,
    shape,
    markerSections: arranged ? arranged.markerSections : 0,
    title: titleEdit ?? defaultTitle,
    setTitle,
    artist: artistEdit ?? defaultArtist,
    setArtist,
    defaultTitle,
  };
}

interface FinishStepProps {
  finish: FinishState;
  index: number;
  total: number;
  onBack: () => void;
}

/** Bước 4: chọn cung và quãng (OptimizerPanel). */
export function KeyStep({
  finish,
  index,
  total,
  onBack,
  onNext,
}: FinishStepProps & { onNext: () => void }) {
  const t = useT();
  const baseOctave = useSettings((s) => s.baseOctave);
  const scheme = useSettings((s) => s.controlScheme);
  const mobileSemitone = useSettings((s) => s.mobileSemitone);
  const range = playableRange(baseOctave);
  return (
    <StepFrame
      title={t('midi.step.key')}
      index={index}
      total={total}
      onBack={onBack}
      onNext={onNext}
      nextDisabled={finish.placement === null}
    >
      <p className="muted">
        {t('midi.key.intro', {
          range: `${midiName(range.min)}–${midiName(range.max)}`,
          base: midiName(baseMidi(baseOctave)),
        })}
      </p>
      <OptimizerPanel
        pitches={finish.pitches}
        baseOctave={baseOctave}
        value={finish.placement}
        onChange={finish.choose}
        scheme={scheme}
        mobileSemitone={mobileSemitone}
      />
      {finish.placement && finish.placement.stats.foldedNotes > 0 ? (
        <p className="midi-warning" role="status">
          {t('midi.key.foldNote', { n: finish.placement.stats.foldedNotes })}
        </p>
      ) : null}
    </StepFrame>
  );
}

interface BuiltHarm {
  text: string;
  sections: number;
  lines: number;
  notes: number;
  foldedNotes: number;
}

/** Melody + phương án → văn bản .harm (null nếu chưa đủ, 'error' nếu lỗi). */
function useBuiltHarm(finish: FinishState): BuiltHarm | null | 'error' {
  const t = useT();
  const untitled = t('common.untitled');
  const { shape, placement, pitches, title, artist, defaultTitle } = finish;
  const optOpts = useOptimizerOptions();
  return useMemo(() => {
    if (!shape || !placement) return null;
    const { baseOctave = DEFAULT_BASE_OCTAVE, scrollDir = GAME_SCROLL_DIR } = optOpts;
    try {
      // phương án phải khớp từng event của melody (phòng khi melody vừa đổi)
      const aligned =
        placement.choices.length === pitches.length
          ? placement
          : evaluateTranspose(pitches, placement.transpose, optOpts);
      if (!aligned) return 'error';
      const range = playableRange(baseOctave);
      const rangeText = `${midiName(range.min)}–${midiName(range.max)}`;
      const name = title.trim() || defaultTitle.trim() || untitled;
      const by = artist.trim();
      const melody: Melody = { ...shape, title: name, ...(by ? { artist: by } : {}) };
      const text = melodyToHarm(melody, aligned, {
        scrollDir,
        baseOctave,
        warningText: (n) => t('midi.foldWarning', { n, range: rangeText }),
      });
      return {
        text,
        sections: melody.sections.length,
        lines: melody.sections.reduce((sum, s) => sum + s.lines.length, 0),
        notes: aligned.stats.noteCount,
        foldedNotes: aligned.stats.foldedNotes,
      };
    } catch (err) {
      console.error(err);
      return 'error';
    }
  }, [shape, placement, pitches, optOpts, title, artist, defaultTitle, untitled, t]);
}

/**
 * Bước 5: tên bài, xem trước .harm (dòng / section đã chia tự động), mở trong Editor dạng BẢN NHÁP —
 * chưa vào Thư viện cho tới khi người dùng Lưu trong Editor (góp ý 2026-10-15 C).
 */
export function ArrangeStep({
  finish,
  index,
  total,
  onBack,
  onCreated,
}: FinishStepProps & { onCreated: () => void }) {
  const t = useT();
  const built = useBuiltHarm(finish);
  const previewId = useId();

  const open = () => {
    if (!built || built === 'error') return;
    // việc dở đã chuyển sang Editor (bản nháp) → rời trang không cần hỏi nữa
    onCreated();
    if (FEATURES.editor) {
      navigate(paths.edit(openDraftSong(built.text)));
      return;
    }
    // không có Editor (cờ tắt): không có chỗ Lưu bản nháp → lưu thẳng vào thư viện rồi phát
    const id = useLibrary.getState().addSong(built.text);
    const name = finish.title.trim() || finish.defaultTitle.trim() || t('common.untitled');
    toast(t('midi.arrange.created', { title: name }));
    navigate(paths.play(id));
  };

  let preview: ReactNode = null;
  if (built === 'error') {
    preview = (
      <p className="midi-error" role="alert">
        {t('midi.arrange.buildError')}
      </p>
    );
  } else if (built) {
    const all = built.text.split('\n');
    const shown = all.slice(0, HARM_PREVIEW_LINES).join('\n');
    const more = all.length - HARM_PREVIEW_LINES;
    preview = (
      <div className="stack midi-harm">
        <p className="muted">
          {t('midi.arrange.summary', {
            sections: built.sections,
            lines: built.lines,
            notes: built.notes,
          })}
        </p>
        {built.foldedNotes > 0 ? (
          <p className="midi-warning">{t('midi.arrange.folded', { n: built.foldedNotes })}</p>
        ) : null}
        <h3 id={previewId} className="midi-subhead">
          {t('midi.arrange.preview')}
        </h3>
        <pre className="midi-harm-preview mono" aria-labelledby={previewId} tabIndex={0}>
          {shown}
        </pre>
        {more > 0 ? <p className="muted">{t('midi.arrange.previewMore', { n: more })}</p> : null}
      </div>
    );
  }

  return (
    <StepFrame
      title={t('midi.step.arrange')}
      index={index}
      total={total}
      onBack={onBack}
      primary={
        <Button variant="primary" onClick={open} disabled={!built || built === 'error'}>
          {FEATURES.editor ? t('midi.arrange.open') : t('midi.arrange.openPlay')}
        </Button>
      }
    >
      <div className="midi-fields">
        <TextField
          label={t('midi.arrange.title')}
          value={finish.title}
          onChange={finish.setTitle}
        />
        <TextField
          label={t('midi.arrange.artist')}
          value={finish.artist}
          onChange={finish.setArtist}
        />
      </div>
      <p className="field-hint">
        {finish.markerSections > 0
          ? t('midi.arrange.autoMarkers', { n: finish.markerSections })
          : t('midi.arrange.auto')}
      </p>
      {preview}
      {FEATURES.editor ? <p className="field-hint">{t('midi.arrange.draftHint')}</p> : null}
    </StepFrame>
  );
}

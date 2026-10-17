import type { ReactNode } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { StringKey } from '../i18n/strings';
import type { TFunction } from '../i18n/useT';
import { useT } from '../i18n/useT';
import { Button, Select } from '../ui/components';
import type { SelectOption } from '../ui/components';
import { titleFromFileName } from './arrange';
import type { ExtractInputNote, ExtractMelodyOptions } from './extract';
import { DEFAULT_EXTRACT, extractMelody } from './extract';
import type { FileKind } from './fileLoad';
import {
  detectFileKind,
  dragPayload,
  droppedFiles,
  DrumsOnlyError,
  FILE_ACCEPT,
  FileReadError,
  FileTooLargeError,
  kindFromBytes,
  MAX_BYTES,
  pickDroppedFile,
  readWholeFile,
  UnsupportedFileError,
  UrlOnlyDropError,
} from './fileLoad';
import type { FinishSource } from './finishSteps';
import { ArrangeStep, KeyStep, useFinish } from './finishSteps';
import type { BeatNote } from './midiFile';
import type * as MidiFileModule from './midiFile';
import type { ParsedScore } from './musicxml';
import {
  defaultScoreVoice,
  readScoreFile,
  ScoreImportError,
  scorePartNotes,
  suggestScorePart,
} from './musicxml';
import { PianoRoll } from './PianoRoll';
import { ScorePicker } from './ScorePicker';
import { TrackTable } from './TrackTable';
import type { OverlapPolicy, ParsedMidi } from './types';
import { MAX_MIDI_BYTES, MAX_MUSICXML_BYTES, MidiImportError, QUANTIZE_GRIDS } from './types';
import { useTrackPreview } from './useTrackPreview';
import { ZipError } from './zip';
import {
  BPM_MAX,
  BPM_MIN,
  formatBpm,
  formatTimeSig,
  GRID_LABELS,
  NumberField,
  OVERLAP_POLICIES,
  PreviewButton,
  StepFrame,
  StepIndicator,
  useStepFocus,
} from './wizardUi';

/**
 * Luồng "Tạo bài từ file" (spec §6b A + Phase 2c): 1 chọn file (MIDI .mid/.midi, MusicXML
 * .musicxml/.xml/.mxl; kéo-thả cả từ thanh tải xuống) → 2 chọn track (MIDI, nhiều track gộp lại)
 * hoặc bè + giọng (MusicXML) → 3 trích melody → 4 chọn cung → 5 xem trước (dòng / section chia tự
 * động) → Editor (bản nháp, chưa lưu). Track / bè gợi ý theo mật độ nốt so với tempo (melodySuggest).
 * @tonejs/midi (midiFile.ts) chỉ tải khi chọn file MIDI đầu tiên (dynamic import).
 */

type MidiFileApi = typeof MidiFileModule;

let midiModulePromise: Promise<MidiFileApi> | null = null;
function loadMidiModule(): Promise<MidiFileApi> {
  if (!midiModulePromise) {
    midiModulePromise = import('./midiFile').catch((err: unknown) => {
      midiModulePromise = null; // lần sau thử lại
      throw err;
    });
  }
  return midiModulePromise;
}

const MB = 1024 * 1024;
/** Index "Tắt" trong QUANTIZE_GRIDS — mặc định cho MusicXML (nhịp trong bản nhạc đã chính xác). */
const GRID_OFF_INDEX = QUANTIZE_GRIDS.indexOf(0);
/** Dung sai legato của MusicXML: độ dài chính xác, chỉ chừa sai số float. */
const SCORE_LEGATO_BEATS = 1 / 256;

interface LoadedBase {
  id: number;
  fileName: string;
}

interface LoadedMidi extends LoadedBase {
  kind: 'midi';
  parsed: ParsedMidi;
  suggested: number;
  beatNotes: BeatNote[][];
  markers: Array<{ beat: number; text: string }>;
  /** Gộp nốt của nhiều track (sắp theo thời gian). */
  merge: (tracks: readonly number[]) => BeatNote[];
}

interface LoadedScore extends LoadedBase {
  kind: 'score';
  score: ParsedScore;
  suggested: string;
}

type Loaded = LoadedMidi | LoadedScore;

const ZIP_ERROR_KEYS: Readonly<Record<ZipError['code'], StringKey>> = {
  invalid: 'midi.error.zipInvalid',
  corrupt: 'midi.error.zipCorrupt',
  encrypted: 'midi.error.zipEncrypted',
  'unsupported-method': 'midi.error.zipMethod',
  'no-score': 'midi.error.zipNoScore',
  'too-large': 'midi.error.zipTooLarge',
  'no-decompress': 'midi.error.zipNoDecompress',
};

const SCORE_ERROR_KEYS: Readonly<Record<ScoreImportError['code'], StringKey>> = {
  'invalid-xml': 'midi.error.xmlInvalid',
  'not-musicxml': 'midi.error.notMusicXml',
  timewise: 'midi.error.timewise',
  'no-notes': 'midi.error.scoreNoNotes',
  'too-large': 'midi.error.too-large',
};

export function fileErrorMessage(
  t: TFunction,
  err: unknown,
  file: { name: string; size: number },
): string {
  const base = { file: file.name };
  const tooLarge = (max: number) =>
    t('midi.error.too-large', { ...base, size: (file.size / MB).toFixed(1), max: max / MB });
  if (err instanceof FileTooLargeError) return tooLarge(err.maxBytes);
  if (err instanceof UrlOnlyDropError) return t('midi.error.urlOnly');
  if (err instanceof UnsupportedFileError) return t('midi.error.unsupported', base);
  if (err instanceof DrumsOnlyError) return t('midi.error.drums-only', base);
  if (err instanceof FileReadError) return t('midi.error.read', base);
  if (err instanceof ZipError) {
    return t(ZIP_ERROR_KEYS[err.code], { ...base, max: MAX_MUSICXML_BYTES / MB });
  }
  if (err instanceof ScoreImportError) {
    if (err.code === 'too-large') return tooLarge(MAX_MUSICXML_BYTES);
    return t(SCORE_ERROR_KEYS[err.code], base);
  }
  if (err instanceof MidiImportError) {
    if (err.code === 'too-large') return tooLarge(MAX_MIDI_BYTES);
    if (err.code === 'no-notes') return t('midi.error.no-notes', base);
  }
  return t('midi.error.invalid', base);
}

/** Đọc + parse một file (MIDI hoặc MusicXML). Ném lỗi để `fileErrorMessage` diễn giải. */
async function loadAnyFile(file: File, id: number): Promise<Loaded> {
  let kind: FileKind | null = await detectFileKind(file);
  if (!kind) throw new UnsupportedFileError();
  if (file.size > MAX_BYTES[kind]) throw new FileTooLargeError(file.size, MAX_BYTES[kind]);
  const [bytes, mod] = await Promise.all([
    readWholeFile(file),
    kind === 'midi' ? loadMidiModule() : Promise.resolve(null),
  ]);
  // đuôi sai (vd. .xml thật ra là .mxl, .mid thật ra là MusicXML) → theo nội dung
  const sniffed = kindFromBytes(bytes.subarray(0, 64));
  if (sniffed && sniffed !== kind) {
    kind = sniffed;
    if (bytes.byteLength > MAX_BYTES[kind]) {
      throw new FileTooLargeError(bytes.byteLength, MAX_BYTES[kind]);
    }
  }

  if (kind === 'midi') {
    const api = mod ?? (await loadMidiModule());
    const parsed = api.parseMidiFile(bytes, file.name);
    const suggested = api.suggestMelodyTrack(parsed);
    if (suggested < 0) throw new DrumsOnlyError();
    return {
      kind: 'midi',
      id,
      fileName: file.name,
      parsed,
      suggested,
      beatNotes: parsed.tracks.map((_, i) => api.trackNotesInBeats(parsed, i)),
      markers: api.markerBeats(parsed),
      merge: (tracks) => api.tracksNotesInBeats(parsed, tracks),
    };
  }
  const score = await readScoreFile(bytes);
  const suggested = suggestScorePart(score);
  if (suggested === null) throw new ScoreImportError('no-notes');
  return { kind: 'score', id, fileName: file.name, score, suggested };
}

export function FileWizard({
  active,
  onDirtyChange,
  onCreated,
}: {
  active: boolean;
  /** Có file đang làm dở (chưa thành bài) — nơi gọi hỏi trước khi rời trang. */
  onDirtyChange: (dirty: boolean) => void;
  onCreated: () => void;
}) {
  const t = useT();
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState(0);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [loadingName, setLoadingName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  // MIDI: các track đã chọn; MusicXML: bè, giọng
  const [tracks, setTracks] = useState<number[]>([]);
  const [partId, setPartId] = useState('');
  const [voice, setVoice] = useState('all');
  const [overlap, setOverlap] = useState<OverlapPolicy>(DEFAULT_EXTRACT.overlap);
  const [gridIndex, setGridIndex] = useState(0);
  const [bpm, setBpm] = useState(120);
  const loadToken = useRef(0);
  const loadSeq = useRef(0);
  const preview = useTrackPreview();
  const stopPreview = preview.stop;
  useStepFocus(step, rootRef);

  const grid = QUANTIZE_GRIDS[gridIndex] ?? DEFAULT_EXTRACT.grid;

  const hasFile = loaded !== null;
  useEffect(() => {
    onDirtyChange(hasFile);
  }, [hasFile, onDirtyChange]);

  // đổi bước hoặc ẩn tab → dừng nghe thử
  useEffect(() => {
    stopPreview();
  }, [step, stopPreview]);
  useEffect(() => {
    if (!active) stopPreview();
  }, [active, stopPreview]);

  const choosePart = useCallback((score: ParsedScore, id: string) => {
    const part = score.parts.find((p) => p.id === id);
    setPartId(id);
    setVoice(part ? defaultScoreVoice(part) : 'all');
  }, []);

  const loadFile = useCallback(
    async (file: File) => {
      const token = ++loadToken.current;
      stopPreview();
      setError(null);
      setLoadingName(file.name);
      try {
        const next = await loadAnyFile(file, loadSeq.current + 1);
        if (token !== loadToken.current) return;
        loadSeq.current = next.id;
        setLoaded(next);
        if (next.kind === 'midi') {
          setTracks([next.suggested]);
          setGridIndex(0);
          setBpm(Math.min(BPM_MAX, Math.max(BPM_MIN, next.parsed.bpm)));
        } else {
          choosePart(next.score, next.suggested);
          setGridIndex(GRID_OFF_INDEX);
          setBpm(Math.min(BPM_MAX, Math.max(BPM_MIN, next.score.bpm)));
        }
        setStep(1);
      } catch (err) {
        if (token !== loadToken.current) return;
        if (!(
          err instanceof MidiImportError ||
          err instanceof ScoreImportError ||
          err instanceof ZipError ||
          err instanceof FileTooLargeError ||
          err instanceof UnsupportedFileError ||
          err instanceof DrumsOnlyError
        )) {
          console.warn(err);
        }
        setError(fileErrorMessage(t, err, file));
      } finally {
        if (token === loadToken.current) setLoadingName(null);
      }
    },
    [stopPreview, t, choosePart],
  );

  // kéo-thả lên cả trang (thả trượt khỏi ô cũng không mở file trong tab). Nhận cả file kéo thẳng
  // từ thanh tải xuống của trình duyệt (files hoặc items kind "file"); thả chỉ có đường dẫn thì báo
  // cách làm thay vì để trình duyệt mở link. Ở bước 2–5 cũng chặn để trình duyệt không điều hướng
  // tới file: thả file = chọn file mới (về bước 1, đọc xong sang bước 2 như nút Chọn file).
  useEffect(() => {
    if (!active) return;
    let depth = 0;
    const onEnter = (e: DragEvent) => {
      const payload = dragPayload(e.dataTransfer);
      if (!payload) return;
      e.preventDefault();
      depth += 1;
      if (payload === 'file') setDragOver(true);
    };
    const onOver = (e: DragEvent) => {
      if (!dragPayload(e.dataTransfer)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    };
    const onLeave = (e: DragEvent) => {
      if (!dragPayload(e.dataTransfer)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragOver(false);
    };
    const onDrop = (e: DragEvent) => {
      const payload = dragPayload(e.dataTransfer);
      const file = pickDroppedFile(droppedFiles(e.dataTransfer));
      if (!payload && !file) return;
      e.preventDefault();
      depth = 0;
      setDragOver(false);
      // trạng thái đọc file / lỗi chỉ hiện ở bước 1
      if (step !== 0) setStep(0);
      if (file) void loadFile(file);
      else setError(fileErrorMessage(t, new UrlOnlyDropError(), { name: '', size: 0 }));
    };
    window.addEventListener('dragenter', onEnter);
    window.addEventListener('dragover', onOver);
    window.addEventListener('dragleave', onLeave);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragenter', onEnter);
      window.removeEventListener('dragover', onOver);
      window.removeEventListener('dragleave', onLeave);
      window.removeEventListener('drop', onDrop);
      setDragOver(false);
    };
  }, [active, step, loadFile, t]);

  const timeSig = useMemo(
    () =>
      (loaded?.kind === 'midi' ? loaded.parsed.timeSig : loaded?.score.timeSig) ?? {
        num: 4,
        den: 4,
      },
    [loaded],
  );
  const beatsPerBar = (timeSig.num * 4) / timeSig.den;

  // nốt đầu vào của bước 3: các track đã chọn (gộp) hoặc bè + giọng
  const sourceNotes = useMemo<readonly ExtractInputNote[]>(() => {
    if (!loaded) return [];
    if (loaded.kind === 'midi') {
      if (tracks.length === 1) return loaded.beatNotes[tracks[0]] ?? [];
      return tracks.length > 0 ? loaded.merge(tracks) : [];
    }
    return scorePartNotes(loaded.score, partId, { voice });
  }, [loaded, tracks, partId, voice]);

  const kind = loaded?.kind;
  const mono = useMemo(() => {
    if (!kind) return [];
    const base: Partial<ExtractMelodyOptions> = {
      overlap,
      grid,
      minBeats: DEFAULT_EXTRACT.minBeats,
    };
    // MusicXML: nốt lặp là nốt thật (tie đã gộp lúc đọc), độ dài chính xác → không gộp tie,
    // dung sai legato chỉ chừa sai số float
    const opts: Partial<ExtractMelodyOptions> =
      kind === 'score' ? { ...base, mergeTies: 'never', legatoBeats: SCORE_LEGATO_BEATS } : base;
    return extractMelody(sourceNotes, opts);
  }, [kind, sourceNotes, overlap, grid]);

  const markers = useMemo(
    () => (loaded?.kind === 'midi' ? loaded.markers : (loaded?.score.markers ?? [])),
    [loaded],
  );
  const source = useMemo<FinishSource | null>(
    () => (loaded && mono.length > 0 ? { mono, bpm, timeSig, grid, markers } : null),
    [loaded, mono, bpm, timeSig, grid, markers],
  );
  const defaultTitle = loaded
    ? (loaded.kind === 'score' ? loaded.score.title : '') || titleFromFileName(loaded.fileName)
    : '';
  const finish = useFinish(
    source,
    step >= 3,
    defaultTitle,
    loaded?.id ?? 0,
    loaded?.kind === 'score' ? (loaded.score.composer ?? '') : '',
  );

  const steps: readonly StringKey[] = [
    'midi.step.file',
    kind === 'score' ? 'midi.step.part' : kind === 'midi' ? 'midi.step.track' : 'midi.step.source',
    'midi.step.extract',
    'midi.step.key',
    'midi.step.arrange',
  ];
  const total = steps.length;
  let body: ReactNode;

  if (step === 0) {
    let status: string | null = null;
    if (loadingName !== null) status = t('midi.file.loading', { file: loadingName });
    else if (loaded?.kind === 'midi') {
      status = t('midi.file.loaded', {
        file: loaded.fileName,
        tracks: loaded.parsed.tracks.filter((tr) => !tr.isDrum).length,
        bpm: formatBpm(loaded.parsed.bpm),
        time: formatTimeSig(loaded.parsed.timeSig),
      });
    } else if (loaded?.kind === 'score') {
      status = t('midi.file.loadedScore', {
        file: loaded.fileName,
        parts: loaded.score.parts.filter((p) => p.noteCount > 0).length,
        bpm: formatBpm(loaded.score.bpm),
        time: formatTimeSig(loaded.score.timeSig),
      });
    }
    body = (
      <StepFrame
        title={t('midi.step.file')}
        index={0}
        total={total}
        onNext={loaded ? () => setStep(1) : undefined}
      >
        <div className={dragOver ? 'midi-dropzone is-over' : 'midi-dropzone'}>
          <p className="midi-dropzone-text">
            {dragOver ? t('midi.file.dropActive') : t('midi.file.drop')}
          </p>
          <Button
            variant="primary"
            onClick={() => inputRef.current?.click()}
            disabled={loadingName !== null}
          >
            {t('midi.file.pick')}
          </Button>
          <input
            ref={inputRef}
            type="file"
            className="sr-only"
            tabIndex={-1}
            accept={FILE_ACCEPT}
            aria-label={t('midi.file.inputLabel')}
            onChange={(e) => {
              const file = e.currentTarget.files?.[0];
              e.currentTarget.value = '';
              if (file) void loadFile(file);
            }}
          />
          <p className="field-hint">
            {t('midi.file.hint', {
              midi: MAX_MIDI_BYTES / MB,
              mxl: MAX_BYTES.mxl / MB,
              xml: MAX_MUSICXML_BYTES / MB,
            })}
          </p>
          <p className="field-hint">{t('midi.file.webHint')}</p>
        </div>
        <div role="status" aria-live="polite" className="midi-status">
          {status}
        </div>
        {loadingName === null && loaded?.kind === 'midi' && loaded.parsed.damaged ? (
          <p className="midi-warning">{t('midi.file.damaged')}</p>
        ) : null}
        {error ? (
          <p className="midi-error" role="alert">
            {error}
          </p>
        ) : null}
      </StepFrame>
    );
  } else if (step === 1 && loaded?.kind === 'midi') {
    body = (
      <StepFrame
        title={t('midi.step.track')}
        index={1}
        total={total}
        onBack={() => setStep(0)}
        onNext={() => setStep(2)}
        nextDisabled={tracks.length === 0}
      >
        {loaded.parsed.damaged ? (
          // bước 1 tự chuyển sang đây ngay khi đọc xong → cảnh báo phải hiện ở cả bước này
          <p className="midi-warning" role="status">
            {t('midi.file.damaged')}
          </p>
        ) : null}
        <TrackTable
          parsed={loaded.parsed}
          suggested={loaded.suggested}
          beatNotes={loaded.beatNotes}
          selected={tracks}
          onChange={setTracks}
          selectedNotes={sourceNotes}
          beatsPerBar={beatsPerBar}
          bpm={bpm}
          preview={preview}
        />
      </StepFrame>
    );
  } else if (step === 1 && loaded?.kind === 'score') {
    body = (
      <StepFrame
        title={t('midi.step.part')}
        index={1}
        total={total}
        onBack={() => setStep(0)}
        onNext={() => setStep(2)}
        nextDisabled={sourceNotes.length === 0}
      >
        <ScorePicker
          score={loaded.score}
          suggested={loaded.suggested}
          partId={partId}
          onPart={(id) => choosePart(loaded.score, id)}
          voice={voice}
          onVoice={setVoice}
          selectedNotes={sourceNotes}
          beatsPerBar={beatsPerBar}
          bpm={bpm}
          preview={preview}
        />
      </StepFrame>
    );
  } else if (step === 2 && loaded) {
    const tempoChanges =
      loaded.kind === 'midi' ? loaded.parsed.tempoChanges : loaded.score.tempoChanges;
    const overlapOptions: SelectOption<OverlapPolicy>[] = OVERLAP_POLICIES.map((p) => ({
      value: p,
      label: t(`midi.extract.overlap.${p}`),
    }));
    const gridOptions: SelectOption<string>[] = GRID_LABELS.map((key, i) => ({
      value: String(i),
      label: t(key),
    }));
    body = (
      <StepFrame
        title={t('midi.step.extract')}
        index={2}
        total={total}
        onBack={() => setStep(1)}
        onNext={() => setStep(3)}
        nextDisabled={mono.length === 0}
      >
        <div className="midi-fields">
          <Select
            label={t('midi.extract.overlap')}
            value={overlap}
            options={overlapOptions}
            onChange={setOverlap}
          />
          <Select
            label={t('midi.extract.grid')}
            value={String(gridIndex)}
            options={gridOptions}
            onChange={(v) => setGridIndex(Number(v))}
          />
          <NumberField
            label={t('midi.extract.bpm')}
            value={bpm}
            min={BPM_MIN}
            max={BPM_MAX}
            step="any"
            onChange={setBpm}
            hint={t(loaded.kind === 'midi' ? 'midi.extract.bpmHint' : 'midi.extract.bpmHintScore')}
          />
        </div>
        {loaded.kind === 'score' ? (
          <p className="field-hint">{t('midi.extract.gridHintScore')}</p>
        ) : null}
        <p className="muted">
          {t('midi.extract.timeSig', { time: formatTimeSig(timeSig) })}
          {tempoChanges > 0 ? ` ${t('midi.extract.tempoChanges', { n: tempoChanges })}` : null}
        </p>
        <p className="midi-count" role="status" aria-live="polite">
          {t('midi.extract.noteCount', { n: mono.length })}
        </p>
        {mono.length === 0 ? (
          <p className="midi-error" role="alert">
            {t(loaded.kind === 'midi' ? 'midi.extract.empty' : 'midi.extract.emptyScore')}
          </p>
        ) : (
          <>
            <PianoRoll
              notes={mono}
              label={t('midi.extract.rollAria')}
              beatsPerBar={beatsPerBar}
              height={120}
            />
            <div className="row">
              <PreviewButton
                preview={preview}
                previewKey="melody"
                notes={mono}
                bpm={bpm}
                name={t('midi.extract.melodyName')}
              />
              <span className="muted midi-small">
                {loaded.kind === 'midi' && tracks.length > 1
                  ? t('midi.extract.compareTracks', {
                      tracks: tracks.length,
                      n: sourceNotes.length,
                    })
                  : t(
                      loaded.kind === 'midi' ? 'midi.extract.compare' : 'midi.extract.compareScore',
                      { n: sourceNotes.length },
                    )}
              </span>
            </div>
          </>
        )}
      </StepFrame>
    );
  } else if (step === 3 && loaded) {
    body = (
      <KeyStep
        finish={finish}
        index={3}
        total={total}
        onBack={() => setStep(2)}
        onNext={() => setStep(4)}
      />
    );
  } else if (step === 4 && loaded) {
    body = (
      <ArrangeStep
        finish={finish}
        index={4}
        total={total}
        onBack={() => setStep(3)}
        onCreated={onCreated}
      />
    );
  }

  return (
    <div ref={rootRef} className="stack">
      <StepIndicator labels={steps} current={step} />
      {body}
    </div>
  );
}

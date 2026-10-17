import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { buildShareUrl, isShareUrlLong, isShareableSource } from '../core/share';
import { tNow, useT } from '../i18n/useT';
import { Button, Modal, copyText, downloadText } from '../ui/components';
import { errorDiagnostics, formatDiagnostic } from '../ui/diagnostics';
import { FEATURES } from '../ui/features';
import { href, paths } from '../ui/router';
import { toast } from '../ui/toast';
import {
  IMPORT_ACCEPT,
  MAX_IMPORT_BYTES,
  exportHarm,
  exportJson,
  parseImportFile,
  readFileText,
} from './io';
import type { ExportFile } from './io';
import { formatDuration, matchesQuery, quickSongStats } from './songSource';
import { entryArtist, entryTitle, getSong, useLibrary, useSongList } from './store';
import type { LibraryEntry } from './store';
import './library.css';

/**
 * Mục "Cú pháp .harm" của README trên trang Hướng dẫn (slug tiêu đề). Cú pháp ĐẦY ĐỦ (bảng lỗi…) ở
 * docs/REFERENCE.md — không hiện trong app (góp ý 2026-10-16: trang Hướng dẫn gọn).
 */
const GUIDE_HARM_SECTION = 'cú-pháp-harm';

const MAX_ERROR_TOASTS = 3;
/** Số lỗi cú pháp liệt kê trên thẻ bài (phần còn lại gộp thành "…và N lỗi khác"). */
const MAX_CARD_ERRORS = 5;

/** Nhập nhiều file vào thư viện, báo kết quả bằng toast. */
async function importFiles(files: readonly File[]): Promise<void> {
  if (files.length === 0) return;
  const sources: string[] = [];
  const errors: string[] = [];
  for (const file of files) {
    if (file.size > MAX_IMPORT_BYTES) {
      errors.push(
        tNow('library.importErrorTooLarge', {
          file: file.name,
          max: MAX_IMPORT_BYTES / (1024 * 1024),
        }),
      );
      continue;
    }
    let text: string;
    try {
      text = await readFileText(file);
    } catch {
      errors.push(tNow('library.importErrorRead', { file: file.name }));
      continue;
    }
    const r = parseImportFile(file.name, text);
    sources.push(...r.sources);
    errors.push(...r.errors);
  }

  const ids = useLibrary.getState().importSongs(sources);
  if (ids.length > 0) {
    toast(tNow('library.imported', { n: ids.length }));
    const broken = ids.filter((id) => getSong(id)?.parsed.ok === false).length;
    if (broken > 0) toast(tNow('library.importedWithErrors', { n: broken }), 'error');
  } else if (errors.length === 0) {
    toast(tNow('library.importNothing'), 'error');
  }
  errors.slice(0, MAX_ERROR_TOASTS).forEach((e) => toast(e, 'error'));
  if (errors.length > MAX_ERROR_TOASTS) {
    toast(tNow('library.importMoreErrors', { n: errors.length - MAX_ERROR_TOASTS }), 'error');
  }
}

function hasFiles(e: DragEvent): boolean {
  const types = e.dataTransfer?.types;
  return types ? Array.from(types).includes('Files') : false;
}

/** Kéo-thả file lên cả trang (window) khi đang ở thư viện. Trả về true khi đang kéo. */
function useFileDrop(onFiles: (files: File[]) => void): boolean {
  const [active, setActive] = useState(false);
  useEffect(() => {
    let depth = 0;
    const onEnter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth += 1;
      setActive(true);
    };
    const onOver = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      // preventDefault để trình duyệt cho phép drop (không mở file).
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    };
    const onLeave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setActive(false);
    };
    const onDrop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setActive(false);
      const files = Array.from(e.dataTransfer?.files ?? []);
      if (files.length > 0) onFiles(files);
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
    };
  }, [onFiles]);
  return active;
}

function download(file: ExportFile): void {
  downloadText(file.filename, file.text, file.mime);
  toast(tNow('library.exported', { file: file.filename }));
}

/**
 * Chia sẻ bài từ thẻ thư viện (SPEC 2c "chia sẻ dễ hơn"): link `#/s/…` → clipboard → toast; link quá
 * dài thì cảnh báo thêm (như nút Chia sẻ của Editor). Bài rỗng không tạo link (chỉ mở ra "link hỏng").
 */
async function shareEntry(entry: LibraryEntry, title: string): Promise<void> {
  if (!isShareableSource(entry.source)) {
    toast(tNow('library.shareEmpty', { title }), 'error');
    return;
  }
  const url = buildShareUrl(entry.source, window.location);
  const ok = await copyText(url);
  if (!ok) {
    toast(tNow('library.shareCopyFailed'), 'error');
    return;
  }
  toast(tNow('library.shareCopied', { title }));
  if (isShareUrlLong(url)) toast(tNow('library.shareLong', { n: url.length }), 'error');
}

interface SongCardProps {
  entry: LibraryEntry;
  onDelete: (entry: LibraryEntry) => void;
}

function SongCard({ entry, onDelete }: SongCardProps) {
  const t = useT();
  const titleId = useId();
  const title = entryTitle(entry) || t('common.untitled');
  const artist = entryArtist(entry);
  const stats = useMemo(() => quickSongStats(entry.parsed.song), [entry.parsed]);
  const errors = useMemo(() => errorDiagnostics(entry.parsed.diagnostics), [entry.parsed]);
  const errorCount = errors.length;

  const duplicate = () => {
    const id = useLibrary.getState().duplicateSong(entry.id);
    const copy = id ? getSong(id) : null;
    if (copy) toast(t('library.duplicated', { title: entryTitle(copy) || t('common.untitled') }));
  };

  return (
    <li className="card library-card" aria-labelledby={titleId}>
      <div className="library-card-head">
        <h2 id={titleId} className="library-card-title">
          {title}
        </h2>
        <div className="library-card-badges">
          <span className={`badge tag ${entry.seed ? 'library-badge-seed' : 'library-badge-user'}`}>
            {entry.seed ? t('library.badgeSeed') : t('library.badgeUser')}
          </span>
          {entry.parsed.ok ? null : (
            <span className="badge tag library-badge-error" title={t('library.badgeErrorHint')}>
              {errorCount > 0
                ? t('library.badgeErrorCount', { n: errorCount })
                : t('library.badgeError')}
            </span>
          )}
        </div>
      </div>
      <p className="library-card-artist muted">{artist || t('common.unknownArtist')}</p>
      {/* Bài mẫu là bản ký âm để minh họa, không thuộc giấy phép MIT của mã nguồn (NOTICE). */}
      {entry.seed && artist ? (
        <p className="library-card-credit">{t('common.seedCredit', { artist })}</p>
      ) : null}
      <dl className="library-card-stats">
        <div>
          <dt>{t('library.statBpm')}</dt>
          <dd>{t('common.bpm', { n: entry.parsed.song.bpm })}</dd>
        </div>
        <div>
          <dt>{t('library.statLength')}</dt>
          <dd>{formatDuration(stats.durationSec)}</dd>
        </div>
        <div>
          <dt>{t('library.statNotes')}</dt>
          <dd>{stats.noteCount}</dd>
        </div>
      </dl>
      {errorCount > 0 ? (
        // Phase 1 chưa có Editor: người dùng vẫn phải biết dòng nào hỏng để sửa file (D-060).
        <details className="library-card-errors">
          <summary>{t('library.errorsShow')}</summary>
          <ul>
            {errors.slice(0, MAX_CARD_ERRORS).map((d, i) => (
              <li key={i}>
                {t('library.errorAt', {
                  line: d.line,
                  column: d.column,
                  message: formatDiagnostic(t, d),
                })}
              </li>
            ))}
          </ul>
          {errorCount > MAX_CARD_ERRORS ? (
            <p className="muted">{t('library.errorsMore', { n: errorCount - MAX_CARD_ERRORS })}</p>
          ) : null}
          {FEATURES.editor ? null : <p className="muted">{t('library.errorsFixHint')}</p>}
        </details>
      ) : null}
      <div
        className="library-card-actions"
        role="group"
        aria-label={t('library.cardActions', { title })}
      >
        <div className="library-card-main">
          <a
            className="btn btn-primary btn-md"
            href={href(paths.play(entry.id))}
            aria-label={t('library.playAria', { title })}
          >
            <span aria-hidden="true">▶</span> {t('common.play')}
          </a>
          {FEATURES.editor ? (
            <a
              className="btn btn-secondary btn-md"
              href={href(paths.edit(entry.id))}
              aria-label={t('library.editAria', { title })}
            >
              {t('common.edit')}
            </a>
          ) : null}
        </div>
        <div className="library-card-more">
          {/* Cờ share tắt thì route #/s chỉ là trang "sắp có" → không tạo link dẫn vào đó (D-060). */}
          {FEATURES.share ? (
            <Button
              size="sm"
              onClick={() => void shareEntry(entry, title)}
              aria-label={t('library.shareAria', { title })}
            >
              {t('library.share')}
            </Button>
          ) : null}
          <Button size="sm" onClick={duplicate} aria-label={t('library.duplicateAria', { title })}>
            {t('common.duplicate')}
          </Button>
          <span className="library-card-export">
            <span className="muted" aria-hidden="true">
              {t('common.export')}
            </span>
            <Button
              size="sm"
              onClick={() => download(exportHarm(entry))}
              aria-label={t('library.exportHarmAria', { title })}
            >
              {t('library.exportHarm')}
            </Button>
            <Button
              size="sm"
              onClick={() => download(exportJson(entry))}
              aria-label={t('library.exportJsonAria', { title })}
            >
              {t('library.exportJson')}
            </Button>
          </span>
          {entry.seed ? null : (
            <Button
              size="sm"
              variant="danger"
              onClick={() => onDelete(entry)}
              aria-label={t('library.deleteAria', { title })}
            >
              {t('common.delete')}
            </Button>
          )}
        </div>
      </div>
    </li>
  );
}

/** Route `#/library` (`paths.library()`): thư viện bài hát (seed + bài user). */
export function LibraryView() {
  const t = useT();
  const songs = useSongList();
  const removeSong = useLibrary((s) => s.removeSong);
  const [query, setQuery] = useState('');
  const [pendingDelete, setPendingDelete] = useState<LibraryEntry | null>(null);
  const [deletedTick, setDeletedTick] = useState(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const searchId = useId();
  const createHeadingId = useId();
  const aiHintId = useId();
  const importHintId = useId();
  const fromFileHintId = useId();
  const recordHintId = useId();
  const dragging = useFileDrop(importFiles);

  const filtered = useMemo(
    () => songs.filter((e) => matchesQuery(query, entryTitle(e), entryArtist(e))),
    [songs, query],
  );
  const searching = query.trim().length > 0;

  // Sau khi xóa, nút Xóa đã biến mất → đưa focus về ô tìm kiếm.
  useEffect(() => {
    if (deletedTick > 0) searchRef.current?.focus();
  }, [deletedTick]);

  const onPickFiles = (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.currentTarget.files ?? []);
    // Reset để chọn lại cùng file vẫn kích hoạt onChange.
    e.currentTarget.value = '';
    void importFiles(files);
  };

  const closeDelete = useCallback(() => setPendingDelete(null), []);
  const confirmDelete = () => {
    if (!pendingDelete) return;
    const title = entryTitle(pendingDelete) || t('common.untitled');
    if (removeSong(pendingDelete.id)) {
      toast(t('library.deleted', { title }));
      setDeletedTick((n) => n + 1);
    }
    setPendingDelete(null);
  };

  const pendingTitle = pendingDelete ? entryTitle(pendingDelete) || t('common.untitled') : '';

  return (
    <section className="library stack">
      <header className="library-header">
        <div className="library-heading">
          <h1>{t('library.title')}</h1>
          <p className="muted">
            {t(FEATURES.editor ? 'library.subtitleWithEditor' : 'library.subtitle')}
          </p>
        </div>
      </header>

      {/* Các cách thêm bài (góp ý 2026-10-16, mục 7), theo thứ tự: Tạo bài với AI → từ file MIDI /
          MusicXML → nhập file ký tự → tự chơi. "Tạo bài mới thủ công" thành link nhỏ "hoặc tự gõ từ đầu"
          của trang Tạo bài với AI. Mỗi mục một dòng giải thích ngay dưới nút. */}
      <section className="library-create" aria-labelledby={createHeadingId}>
        <h2 id={createHeadingId} className="hud-section-title library-create-title">
          {t('library.createHeading')}
        </h2>
        <ol className="library-create-list" aria-label={t('library.actions')}>
          {/* Cần Editor (Mở trong Editor / tự gõ từ đầu) — chưa có Editor thì không có lối vào (D-060). */}
          {FEATURES.editor ? (
            <li className="library-create-item">
              <a
                className="btn btn-secondary btn-md"
                href={href(paths.ai())}
                aria-describedby={aiHintId}
              >
                {t('library.aiCreate')}
              </a>
              <p id={aiHintId} className="library-create-hint muted">
                {t('library.aiCreateHint')}
              </p>
            </li>
          ) : null}
          {FEATURES.midiImport ? (
            <li className="library-create-item">
              <a
                className="btn btn-secondary btn-md"
                href={href(paths.midi())}
                aria-describedby={fromFileHintId}
              >
                {t('library.fromMidi')}
              </a>
              <p id={fromFileHintId} className="library-create-hint muted">
                {t('library.fromMidiHint')}
              </p>
            </li>
          ) : null}
          <li className="library-create-item">
            <Button onClick={() => fileInput.current?.click()} aria-describedby={importHintId}>
              {t('library.importFile')}
            </Button>
            <input
              ref={fileInput}
              type="file"
              accept={IMPORT_ACCEPT}
              multiple
              hidden
              tabIndex={-1}
              aria-label={t('library.importInputLabel')}
              onChange={onPickFiles}
            />
            {/* .harm / .json / .txt là định dạng riêng của app; file nhạc chuẩn đi đường "Tạo bài từ file". */}
            <p id={importHintId} className="library-create-hint library-import-hint muted">
              {t(FEATURES.midiImport ? 'library.importHint' : 'library.importHintNoMidi')}{' '}
              {/* Cú pháp đầy đủ trên trang Hướng dẫn (D-260). */}
              <a href={href(paths.guide('readme', GUIDE_HARM_SECTION))}>
                {t('library.syntaxLink')}
              </a>
            </p>
          </li>
          <li className="library-create-item">
            <a
              className="btn btn-secondary btn-md"
              href={href(paths.record())}
              aria-describedby={recordHintId}
            >
              {t('library.record')}
            </a>
            <p id={recordHintId} className="library-create-hint muted">
              {t('library.recordHint')}
            </p>
          </li>
        </ol>
      </section>

      <div className="library-toolbar">
        <label htmlFor={searchId} className="sr-only">
          {t('library.searchLabel')}
        </label>
        <input
          id={searchId}
          ref={searchRef}
          type="search"
          className="library-search"
          value={query}
          placeholder={t('library.searchPlaceholder')}
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => setQuery(e.currentTarget.value)}
        />
        <span className="muted library-count tag" aria-live="polite">
          {searching
            ? t('library.countFiltered', { n: filtered.length, total: songs.length })
            : t('library.count', { n: songs.length })}
        </span>
      </div>
      <p className="library-drop-hint muted">{t('library.dropHint')}</p>

      {filtered.length === 0 ? (
        <div className="card library-empty" role="status">
          <p>{t('library.empty', { q: query.trim() })}</p>
          <Button
            onClick={() => {
              setQuery('');
              // Nút này biến mất cùng trạng thái rỗng → giữ focus ở ô tìm kiếm.
              searchRef.current?.focus();
            }}
          >
            {t('library.clearSearch')}
          </Button>
        </div>
      ) : (
        <ul className="library-grid" aria-label={t('library.listLabel')}>
          {filtered.map((entry) => (
            <SongCard key={entry.id} entry={entry} onDelete={setPendingDelete} />
          ))}
        </ul>
      )}

      {dragging ? (
        <div className="library-drop-overlay" aria-hidden="true">
          <p>{t('library.dropOverlay')}</p>
        </div>
      ) : null}

      <footer className="library-footer muted">{t('library.fanMade')}</footer>

      <Modal
        open={pendingDelete !== null}
        title={t('library.deleteTitle')}
        onClose={closeDelete}
        footer={
          <>
            {/* Hộp xác nhận xóa: focus mặc định vào lựa chọn an toàn. */}
            <Button onClick={closeDelete} data-autofocus>
              {t('common.cancel')}
            </Button>
            <Button variant="danger" onClick={confirmDelete}>
              {t('common.delete')}
            </Button>
          </>
        }
      >
        <p>{t('library.deleteBody', { title: pendingTitle })}</p>
      </Modal>
    </section>
  );
}

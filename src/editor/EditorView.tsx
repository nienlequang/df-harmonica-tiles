import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ComponentType } from 'react';
import { parseHarm } from '../core/parser';
import { buildShareUrl, isShareUrlLong, isShareableSource } from '../core/share';
import type { DiagnosticSeverity, ParseResult } from '../core/types';
import type { StringKey } from '../i18n/strings';
import { useT } from '../i18n/useT';
import { exportHarm, exportJson } from '../library/io';
import { getDirective, setDirectiveInSource, setTitleInSource } from '../library/songSource';
import {
  DRAFT_ID_PREFIX,
  draftSavedAs,
  entryTitle,
  getSong,
  isDraftSong,
  isTransientSong,
  saveDraftSong,
  useLibrary,
  useSong,
} from '../library/store';
import type { LibraryEntry } from '../library/store';
import { Button, Modal, copyText, downloadText } from '../ui/components';
import { formatDiagnostic } from '../ui/diagnostics';
import { FEATURES } from '../ui/features';
import { href, navigate, paths } from '../ui/router';
import { toast } from '../ui/toast';
import { AiPasteBox } from './AiPasteBox';
import { DonateModal } from './DonateModal';
import { HarmTextarea, moveCaret } from './HarmTextarea';
import type { LineMarker } from './HarmTextarea';
import { PreviewPanel } from './PreviewPanel';
import { modelLineAtSource, normalizeEol, offsetAt, positionAt } from './editorText';
import { installHashGuard, sameHash } from './hashGuard';
import { ReoptimizeModal } from './tools/ReoptimizeModal';
import { TapTimingModal } from './tools/TapTimingModal';
import type { EditorToolProps } from './tools/types';
import { useSourceHistory } from './useSourceHistory';
import './editor.css';

/** Parse lại sau khi ngừng gõ 150 ms (spec §6). */
export const PARSE_DEBOUNCE_MS = 150;

// "Nhập cảm âm" không còn trong Công cụ (góp ý 2026-10-16): ô "Dán kết quả của AI" phía trên ô soạn.
type ToolId = 'tap' | 'reoptimize';

const TOOLS: ReadonlyArray<{
  id: ToolId;
  label: StringKey;
  Component: ComponentType<EditorToolProps>;
}> = [
  { id: 'tap', label: 'editor.menu.tap', Component: TapTimingModal },
  { id: 'reoptimize', label: 'editor.menu.reoptimize', Component: ReoptimizeModal },
];

const SEVERITY_RANK: Record<DiagnosticSeverity, number> = { error: 0, warning: 1, info: 2 };

/** Directive của bài hiện tại được giữ khi văn bản dán vào ô AI không có (R6: dán vài dòng nốt). */
const CARRIED_DIRECTIVES = ['title', 'artist', 'bpm', 'time'] as const;

/**
 * Phiên soạn: `seq` là key của EditorScreen. Đổi sang bài khác → phiên mới (mount lại với nội dung
 * mới). Riêng "Lưu" bài mẫu / bài tạm: editor báo `handoff` = id bản sao trước khi điều hướng, route
 * đổi sang bản sao vẫn giữ phiên (lịch sử Công cụ, con trỏ, cuộn, focus, undo gốc của textarea).
 */
interface EditorSession {
  id: string;
  seq: number;
  handoff: string | null;
}

/** Route `#/edit/:id`: trình soạn `.harm` (spec §6). */
export function EditorView({ songId }: { songId: string }) {
  const entry = useSong(songId);
  const [session, setSession] = useState<EditorSession>(() => ({
    id: songId,
    seq: 0,
    handoff: null,
  }));
  let current = session;
  if (session.id !== songId) {
    // điều chỉnh state theo prop ngay trong render (không mount EditorScreen cũ với bài mới)
    current = {
      id: songId,
      seq: session.handoff === songId ? session.seq : session.seq + 1,
      handoff: null,
    };
    setSession(current);
  }
  const onHandoff = useCallback((to: string) => setSession((s) => ({ ...s, handoff: to })), []);
  // Bản nháp đã Lưu thành bài thư viện (vd. Back về `#/edit/draft-…`) → mở bài đã lưu.
  useEffect(() => {
    const savedId = draftSavedAs(songId);
    if (savedId !== null) navigate(paths.edit(savedId), { replace: true });
  }, [songId]);
  if (!entry) return <EditorNotFound id={songId} />;
  return <EditorScreen key={current.seq} entry={entry} onHandoff={onHandoff} />;
}

function EditorNotFound({ id }: { id: string }) {
  const t = useT();
  return (
    <section className="card stack">
      <h1>{t('common.songNotFound')}</h1>
      <p className="muted">
        {id.startsWith(DRAFT_ID_PREFIX) ? t('editor.draftGone') : t('editor.notFoundHint', { id })}
      </p>
      <p>
        <a href={href(paths.library())}>{t('common.goHome')}</a>
      </p>
    </section>
  );
}

function titleOfSaved(id: string, fallback: string): string {
  const e = getSong(id);
  return (e ? entryTitle(e) : '') || fallback;
}

/** Lỗi đầu tiên theo dòng / cột (null nếu không có lỗi). */
function firstError(parsed: ParseResult): { line: number; column: number } | null {
  let best: { line: number; column: number } | null = null;
  for (const d of parsed.diagnostics) {
    if (d.severity !== 'error') continue;
    if (!best || d.line < best.line || (d.line === best.line && d.column < best.column)) {
      best = { line: d.line, column: d.column };
    }
  }
  return best;
}

function EditorScreen({
  entry,
  onHandoff,
}: {
  entry: LibraryEntry;
  /** Lưu bài chỉ đọc thành bản sao `to`: route sắp đổi sang bản sao, giữ phiên soạn. */
  onHandoff(to: string): void;
}) {
  const t = useT();
  const id = entry.id;
  // Bản nháp (bài vừa tạo, chưa vào Thư viện — góp ý 2026-10-15 C): sửa được; Lưu = thêm vào thư viện
  // rồi editor đi tiếp với bài đã lưu. Chưa sửa gì thì rời trang không hỏi, không lưu.
  const draft = isDraftSong(id);
  // Bài mẫu và bài tạm (link chia sẻ) chỉ đọc: Lưu = tạo bản sao trong thư viện.
  const readOnly = !draft && (entry.seed || isTransientSong(id));
  const saved = useMemo(() => normalizeEol(entry.source), [entry.source]);

  const [text, setText] = useState(saved);
  const [parsedText, setParsedText] = useState(saved);
  const parsed = useMemo(() => parseHarm(parsedText, { id }), [parsedText, id]);
  const [caret, setCaret] = useState(0);
  const [tool, setTool] = useState<ToolId | null>(null);
  const [donateOpen, setDonateOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [pendingLeave, setPendingLeave] = useState<string | null>(null);
  const history = useSourceHistory();

  const taRef = useRef<HTMLTextAreaElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const textRef = useRef(text);
  const savedRef = useRef(saved);
  /** Hash do chính editor điều hướng tới (Lưu bản sao, Phát…) — guard không chặn. */
  const allowedRef = useRef(new Set<string>());
  const taId = useId();
  const hintId = useId();
  const previewHeadingId = useId();
  const menuId = useId();

  const dirty = text !== saved;
  useLayoutEffect(() => {
    textRef.current = text;
  }, [text]);
  useLayoutEffect(() => {
    savedRef.current = saved;
  }, [saved]);

  // Debounce parse: chỉ parse lại khi ngừng gõ.
  useEffect(() => {
    if (parsedText === text) return;
    const h = setTimeout(() => setParsedText(text), PARSE_DEBOUNCE_MS);
    return () => clearTimeout(h);
  }, [text, parsedText]);

  /** Kết quả parse khớp đúng văn bản hiện tại (không chờ debounce). */
  const freshParse = useCallback(
    (current: string): ParseResult =>
      current === parsedText ? parsed : parseHarm(current, { id }),
    [parsedText, parsed, id],
  );
  // Công cụ / donate cần parse khớp `source` → chỉ tính khi đang mở.
  const modalParsed = useMemo(
    () => (tool !== null || donateOpen ? freshParse(text) : null),
    [tool, donateOpen, freshParse, text],
  );

  const title = parsed.song.title.trim() || t('common.untitled');
  useEffect(() => {
    const prev = document.title;
    document.title = `${t('editor.docTitle', { title })} — ${t('app.shortTitle')}`;
    return () => {
      document.title = prev;
    };
  }, [title, t]);

  const markers = useMemo(() => {
    const map = new Map<number, LineMarker>();
    for (const d of parsed.diagnostics) {
      const m = map.get(d.line);
      const msg = formatDiagnostic(t, d);
      if (!m) map.set(d.line, { severity: d.severity, messages: [msg] });
      else {
        m.messages.push(msg);
        if (SEVERITY_RANK[d.severity] < SEVERITY_RANK[m.severity]) m.severity = d.severity;
      }
    }
    return map;
  }, [parsed.diagnostics, t]);

  const applyText = useCallback((next: string) => {
    textRef.current = next;
    setText(next);
    setParsedText(next);
  }, []);

  /**
   * Việc chạy sau khi hộp thoại (công cụ / donate) đã đóng và Modal đã trả focus — vd. focus ô soạn
   * sau Áp dụng, nhảy tới lỗi từ Donate. Effect của EditorScreen chạy sau cleanup của Modal con.
   */
  const afterModalRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    if (tool !== null || donateOpen) return;
    const run = afterModalRef.current;
    afterModalRef.current = null;
    run?.();
  }, [tool, donateOpen]);

  /** Kết quả của một công cụ: ghi lịch sử (Hoàn tác được) rồi thay văn bản. */
  const applyTool = useCallback(
    (next: string, label: string) => {
      const current = textRef.current;
      if (typeof next !== 'string' || next === current) return;
      history.record(current, label);
      applyText(normalizeEol(next));
      // đóng công cụ xong thì quay về ô soạn (không cuộn trang, giữ vị trí cuộn của ô)
      afterModalRef.current = () => taRef.current?.focus({ preventScroll: true });
    },
    [history, applyText],
  );

  /** Nội dung vừa đưa vào từ ô "Dán kết quả của AI" (đổi tông ngay sau đó không thêm bước Hoàn tác). */
  const lastAiRef = useRef<string | null>(null);
  /**
   * Ô dán kết quả AI: thay toàn bộ bài bằng `.harm` đã chuyển, ghi lịch sử (Hoàn tác về nội dung trước khi
   * dán). Văn bản đã dán (`pasted`) không có `@title` / `@artist` / `@bpm` / `@time` thì giữ của bài hiện
   * tại (dán vài dòng nốt không được đổi tempo / nhịp / tên bài — như công cụ Nhập cảm âm cũ). Đổi tông ngay
   * sau khi dán (bài chưa sửa gì) thay luôn, không thêm bước Hoàn tác. Trả nội dung ô soạn sau đó.
   */
  const applyAiPaste = useCallback(
    (harm: string, pasted: string): string => {
      const current = textRef.current;
      let next = harm;
      for (const name of CARRIED_DIRECTIVES) {
        if (getDirective(pasted, name) !== null) continue;
        const mine = getDirective(current, name);
        if (!mine) continue;
        next =
          name === 'title' ? setTitleInSource(next, mine) : setDirectiveInSource(next, name, mine);
      }
      next = normalizeEol(next);
      if (next === current) return current;
      if (lastAiRef.current === null || current !== lastAiRef.current) {
        history.record(current, t('editor.aiPaste.undoLabel'));
      }
      applyText(next);
      lastAiRef.current = next;
      return next;
    },
    [history, applyText, t],
  );

  const undo = () => {
    const prev = history.undo(textRef.current);
    if (prev !== null) applyText(prev);
  };
  const redo = () => {
    const next = history.redo(textRef.current);
    if (next !== null) applyText(next);
  };

  /** Điều hướng do editor chủ động (không hỏi xác nhận). */
  const leave = (path: string, opts?: { replace?: boolean }) => {
    allowedRef.current.add(href(path));
    navigate(path, opts);
  };

  /**
   * Lưu. Bài của người dùng: cập nhật. Bản nháp: thêm vào thư viện (kể cả khi chưa sửa — người dùng
   * chủ động bấm Lưu). Bài mẫu / bài tạm: thêm bản sao vào thư viện. Bản nháp / bản sao: (mặc định)
   * chuyển editor sang bài đã lưu. Trả id của bài vừa lưu.
   */
  const save = (opts: { openCopy?: boolean } = {}): string => {
    const current = textRef.current;
    if (draft) {
      const newId = saveDraftSong(id, current);
      toast(t('editor.draftSaved', { title: titleOfSaved(newId, t('common.untitled')) }));
      if (opts.openCopy !== false) {
        onHandoff(newId);
        leave(paths.edit(newId), { replace: true });
      }
      return newId;
    }
    if (readOnly) {
      const newId = useLibrary.getState().addSong(current);
      toast(t('editor.savedCopy', { title: titleOfSaved(newId, t('common.untitled')) }));
      if (opts.openCopy !== false) {
        // phiên soạn đi tiếp với bản sao (không mount lại → không mất Hoàn tác / con trỏ / focus)
        onHandoff(newId);
        leave(paths.edit(newId), { replace: true });
      }
      return newId;
    }
    useLibrary.getState().updateSong(id, current);
    savedRef.current = current;
    toast(t('editor.saved'));
    return id;
  };
  const saveRef = useRef(save);
  useLayoutEffect(() => {
    saveRef.current = save;
  });

  const playFromCursor = () => {
    const current = textRef.current;
    const ta = taRef.current;
    const caretLine = positionAt(current, ta ? ta.selectionStart : caret).line;
    const lineIndex = modelLineAtSource(freshParse(current).lineOrigins, caretLine);
    let targetId = id;
    if (current !== savedRef.current) {
      // bản nháp đã sửa: phát = lưu vào thư viện trước (như bài mẫu), chưa sửa thì phát thẳng bản nháp
      if (readOnly || draft) {
        // Bản sao thay chỗ editor bài mẫu trong history (Back từ Player về bản sao).
        targetId = save({ openCopy: false });
        leave(paths.edit(targetId), { replace: true });
      } else {
        save();
      }
    }
    leave(`${paths.play(targetId)}${lineIndex >= 0 ? `?line=${lineIndex}` : ''}`);
  };

  const onJump = useCallback((line: number, column: number) => {
    const ta = taRef.current;
    if (!ta) return;
    const offset = offsetAt(ta.value, line, column);
    moveCaret(ta, offset);
    setCaret(offset);
  }, []);

  const doExport = (kind: 'harm' | 'json') => {
    const current = textRef.current;
    const input = { id, source: current, parsed: freshParse(current) };
    const file = kind === 'harm' ? exportHarm(input) : exportJson(input);
    downloadText(file.filename, file.text, file.mime);
    toast(t('library.exported', { file: file.filename }));
  };

  const share = async () => {
    const current = textRef.current;
    // Bài rỗng / toàn khoảng trắng: link chỉ mở ra màn hình "link hỏng" (D-085) → không sao chép.
    if (!isShareableSource(current)) {
      toast(t('editor.shareEmpty'), 'error');
      return;
    }
    const url = buildShareUrl(current, window.location);
    const ok = await copyText(url);
    if (!ok) {
      toast(t('editor.shareCopyFailed'), 'error');
      return;
    }
    toast(t('editor.shareCopied', { n: url.length }));
    if (isShareUrlLong(url)) toast(t('editor.shareLong', { n: url.length }), 'error');
  };

  const openTool = (next: ToolId) => {
    // Mục menu sắp bị ẩn: Modal ghi nhớ phần tử đang focus để trả về khi đóng → đưa focus về nút
    // Công cụ (còn hiện) trước, không thì focus rơi về <body> (D-061).
    menuButtonRef.current?.focus();
    setMenuOpen(false);
    setParsedText(textRef.current);
    setTool(next);
  };
  const closeTool = useCallback(() => setTool(null), []);
  const openDonate = () => {
    setParsedText(textRef.current);
    setDonateOpen(true);
  };
  const closeDonate = useCallback(() => setDonateOpen(false), []);
  /** Từ Donate: đóng hộp thoại rồi đưa con trỏ tới lỗi đầu tiên. */
  const showFirstError = () => {
    const err = modalParsed ? firstError(modalParsed) : null;
    if (err) afterModalRef.current = () => onJump(err.line, err.column);
    setDonateOpen(false);
  };

  // Ctrl+S = Lưu (không chạy khi hộp thoại đang mở).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return;
      if (e.code !== 'KeyS' && e.key.toLowerCase() !== 's') return;
      if (document.querySelector('[aria-modal="true"]')) return;
      e.preventDefault();
      saveRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Có thay đổi chưa lưu: hỏi trước khi đóng tab / tải lại, và trước khi đổi route trong app.
  useEffect(() => {
    const isDirty = () => textRef.current !== savedRef.current;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!isDirty()) return;
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    const removeGuard = installHashGuard(window, {
      shouldBlock: (next) => {
        if (!isDirty()) return false;
        for (const allowed of allowedRef.current) if (sameHash(allowed, next)) return false;
        return true;
      },
      onBlocked: (next) => setPendingLeave(next),
    });
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      removeGuard();
    };
  }, []);

  const goPending = (alsoSave: boolean) => {
    const target = pendingLeave;
    setPendingLeave(null);
    if (target === null) return;
    if (alsoSave) save({ openCopy: false });
    allowedRef.current.add(target);
    window.location.hash = target;
  };

  // Menu Công cụ: đóng khi bấm ra ngoài hoặc Esc (trả focus về nút).
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (e.target instanceof Node && menuRef.current?.contains(e.target)) return;
      setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setMenuOpen(false);
      menuButtonRef.current?.focus();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  const caretPos = positionAt(text, caret);
  const activeTool = tool === null ? null : (TOOLS.find((x) => x.id === tool) ?? null);

  return (
    <section className="editor" aria-label={t('editor.region')}>
      <header className="editor-header">
        <div className="editor-heading">
          <h1>{t('editor.heading', { title })}</h1>
          <span className={dirty || draft ? 'editor-status is-dirty' : 'editor-status'}>
            {dirty ? (
              <>
                <span aria-hidden="true">● </span>
                {t('editor.unsaved')}
              </>
            ) : draft ? (
              t('editor.draftStatus')
            ) : (
              t('editor.allSaved')
            )}
          </span>
        </div>
        <div className="editor-toolbar" role="group" aria-label={t('editor.toolbar')}>
          <Button variant="primary" onClick={playFromCursor} title={t('editor.playFromCursorHint')}>
            <span aria-hidden="true">▶</span> {t('editor.playFromCursor')}
          </Button>
          <Button onClick={() => save()} title={t('editor.saveHint')} aria-keyshortcuts="Control+S">
            {t('common.save')}
          </Button>
          <Button
            onClick={undo}
            disabled={!history.canUndo}
            title={
              history.undoLabel
                ? t('editor.undoLabel', { label: history.undoLabel })
                : t('editor.undoEmpty')
            }
          >
            <span aria-hidden="true">↶</span> {t('editor.undo')}
          </Button>
          <Button
            onClick={redo}
            disabled={!history.canRedo}
            title={
              history.redoLabel
                ? t('editor.redoLabel', { label: history.redoLabel })
                : t('editor.redoEmpty')
            }
          >
            <span aria-hidden="true">↷</span> {t('editor.redo')}
          </Button>
          <div
            className="editor-menu"
            ref={menuRef}
            onBlur={(e) => {
              // Tab ra khỏi menu → đóng (relatedTarget null = click chỗ không focus được / đổi
              // cửa sổ: để mousedown-ngoài xử lý, tránh đóng menu trước khi click mục trên Safari)
              const next = e.relatedTarget;
              if (next instanceof Node && !menuRef.current?.contains(next)) setMenuOpen(false);
            }}
          >
            {/* Nút thường (Button không nhận ref) để Esc trả focus về đây. */}
            <button
              ref={menuButtonRef}
              type="button"
              className="btn btn-secondary btn-md"
              aria-expanded={menuOpen}
              aria-controls={menuId}
              onClick={() => setMenuOpen((o) => !o)}
            >
              {t('editor.tools')} <span aria-hidden="true">▾</span>
            </button>
            <ul
              id={menuId}
              className="editor-menu-list"
              aria-label={t('editor.toolsMenu')}
              hidden={!menuOpen}
            >
              {TOOLS.map((x) => (
                <li key={x.id}>
                  <button type="button" className="editor-menu-item" onClick={() => openTool(x.id)}>
                    {t(x.label)}
                  </button>
                </li>
              ))}
            </ul>
          </div>
          <Button onClick={() => doExport('harm')}>{t('editor.exportHarm')}</Button>
          <Button onClick={() => doExport('json')}>{t('editor.exportJson')}</Button>
          {FEATURES.share ? (
            <Button onClick={() => void share()} title={t('editor.shareLinkHint')}>
              {t('editor.shareLink')}
            </Button>
          ) : null}
          <Button onClick={openDonate}>{t('editor.donate')}</Button>
        </div>
      </header>

      {draft ? (
        <p className="editor-notice" role="note">
          {t('editor.draftNotice')}
        </p>
      ) : readOnly ? (
        <p className="editor-notice" role="note">
          {entry.seed ? t('editor.readOnlySeed') : t('editor.readOnlyShared')}
        </p>
      ) : null}

      <div className="editor-split">
        <div className="editor-pane editor-source">
          <AiPasteBox source={text} onApply={applyAiPaste} />
          <label htmlFor={taId} className="editor-label">
            {t('editor.sourceLabel')}
          </label>
          <HarmTextarea
            id={taId}
            value={text}
            onChange={setText}
            markers={markers}
            textareaRef={taRef}
            onCaretChange={setCaret}
            describedBy={hintId}
            invalid={!parsed.ok}
          />
          <div className="editor-statusbar">
            <span id={hintId} className="muted">
              {t('editor.sourceHint')}
            </span>
            <span className="muted editor-caret">
              {t('editor.caret', { line: caretPos.line, column: caretPos.column })}
            </span>
          </div>
        </div>
        <section className="editor-pane editor-preview" aria-labelledby={previewHeadingId}>
          <h2 id={previewHeadingId} className="editor-label">
            {t('editor.preview')}
          </h2>
          <PreviewPanel parsed={parsed} onJump={onJump} />
        </section>
      </div>

      <Modal
        open={pendingLeave !== null}
        title={t('editor.leaveTitle')}
        onClose={() => setPendingLeave(null)}
        footer={
          <>
            <Button onClick={() => setPendingLeave(null)} data-autofocus>
              {t('editor.leaveStay')}
            </Button>
            <Button variant="danger" onClick={() => goPending(false)}>
              {t('editor.leaveDiscard')}
            </Button>
            <Button variant="primary" onClick={() => goPending(true)}>
              {t('editor.leaveSave')}
            </Button>
          </>
        }
      >
        <p>{t('editor.leaveBody')}</p>
      </Modal>

      {donateOpen && modalParsed ? (
        <DonateModal
          open
          onClose={closeDonate}
          song={modalParsed.song}
          errorCount={modalParsed.diagnostics.filter((d) => d.severity === 'error').length}
          onShowErrors={showFirstError}
        />
      ) : null}
      {activeTool && modalParsed ? (
        <activeTool.Component
          open
          onClose={closeTool}
          source={text}
          parsed={modalParsed}
          songId={id}
          onApply={applyTool}
        />
      ) : null}
    </section>
  );
}

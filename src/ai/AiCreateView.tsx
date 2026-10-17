import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { AI_CHATS, AI_GUIDE_SECTION, aiPromptFor } from '../editor/aiPrompt';
import { createNewSong } from '../home/newSong';
import { useT } from '../i18n/useT';
import { setTitleInSource } from '../library/songSource';
import { openDraftSong, useLibrary } from '../library/store';
import { Button, copyText } from '../ui/components';
import { href, navigate, paths } from '../ui/router';
import { useSettings } from '../ui/settings';
import { toast } from '../ui/toast';
import { PasteSummary, usePasteConversion } from './PasteSummary';
import './ai.css';

/**
 * Route `#/ai` — "Tạo bài với AI" (góp ý 2026-10-16, thay "Tạo bài mới thủ công"): 4 bước rõ ràng —
 * (1) sao chép prompt (theo ngôn ngữ giao diện), (2) dán vào ChatGPT / Claude / Gemini kèm ảnh / chữ của
 * bài (+ mẹo tìm nguồn), (3) dán câu trả lời của AI vào ô lớn → tự đổi sang `.harm` với tông dễ nhất
 * (`camamConvert.ts`), (4) "Lưu" = bài vào Thư viện (thêm thẳng — người dùng chủ động bấm Lưu) rồi hiện
 * xác nhận với "Phát"; phụ: "Mở trong Editor" = bản nháp (D-318). Link nhỏ "hoặc tự gõ từ đầu" = bản nháp
 * trống trong Editor (cách thủ công cũ). Người dùng không phải thấy cú pháp cảm âm do1 / do2.
 */

/** Hiện "Đã sao chép prompt" bao lâu (ms). */
const COPIED_MS = 2500;

export function AiCreateView() {
  const t = useT();
  const lang = useSettings((s) => s.language);
  const [text, setText] = useState('');
  /** Tông người dùng chọn (null = dễ nhất). Dán bài mới → về dễ nhất. */
  const [transpose, setTranspose] = useState<number | null>(null);
  /** Tên bài người dùng sửa (null = theo `@title` của kết quả AI). */
  const [titleDraft, setTitleDraft] = useState<string | null>(null);
  const [copied, setCopied] = useState<'ok' | 'failed' | null>(null);
  const [showPrompt, setShowPrompt] = useState(false);
  /** Bài vừa lưu (hiện xác nhận + Phát) — đổi nội dung ô dán thì bỏ. */
  const [saved, setSaved] = useState<{ id: string; title: string } | null>(null);

  const titleId = useId();
  const pasteId = useId();
  const pasteHintId = useId();
  const statusId = useId();
  const songTitleId = useId();
  const songTitleHintId = useId();
  const saveHintId = useId();
  const editorHintId = useId();
  const promptBoxId = useId();
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const alive = useRef(true);
  const savedRef = useRef<HTMLParagraphElement>(null);
  const promptRef = useRef<HTMLTextAreaElement>(null);

  const conversion = usePasteConversion(text, transpose);
  const harm = conversion.harm;
  const songTitle = titleDraft ?? conversion.title;

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (copiedTimer.current !== null) clearTimeout(copiedTimer.current);
    };
  }, []);

  useEffect(() => {
    const prev = document.title;
    document.title = `${t('ai.title')} — ${t('app.shortTitle')}`;
    return () => {
      document.title = prev;
    };
  }, [t]);

  // Vừa lưu: đưa focus tới dòng xác nhận (nút Lưu đã biến mất).
  useLayoutEffect(() => {
    if (saved) savedRef.current?.focus();
  }, [saved]);

  // Chép prompt thất bại → mở ô prompt và chọn sẵn để người dùng tự sao chép.
  useEffect(() => {
    if (copied === 'failed' && showPrompt) promptRef.current?.select();
  }, [copied, showPrompt]);

  const copyPrompt = async () => {
    const ok = await copyText(aiPromptFor(lang));
    // copyText là async: trang có thể đã đóng khi nó xong
    if (!alive.current) return;
    setCopied(ok ? 'ok' : 'failed');
    if (!ok) setShowPrompt(true);
    if (copiedTimer.current !== null) clearTimeout(copiedTimer.current);
    copiedTimer.current = ok
      ? setTimeout(() => {
          copiedTimer.current = null;
          setCopied(null);
        }, COPIED_MS)
      : null;
  };

  const changeText = (next: string, pasted: boolean) => {
    setText(next);
    setTranspose(null);
    setSaved(null);
    // Dán câu trả lời mới → tên bài lại theo `@title` của nó (gõ tay trong ô thì giữ tên đã sửa). "Dán" theo
    // chính lần nhập này (`inputType`), không theo cờ còn sót từ một lần dán không đổi gì.
    if (pasted) setTitleDraft(null);
  };

  /** Nguồn sẽ lưu: kết quả chuyển đổi + tên bài người dùng sửa (nếu có). */
  const finalSource = (): string | null => {
    if (harm === null) return null;
    const title = songTitle.trim();
    return title === conversion.title ? harm : setTitleInSource(harm, title);
  };

  const save = () => {
    const source = finalSource();
    if (source === null) return;
    const id = useLibrary.getState().addSong(source);
    const title = songTitle.trim() || t('common.untitled');
    toast(t('ai.saved', { title }));
    setSaved({ id, title });
  };

  const openInEditor = () => {
    const source = finalSource();
    if (source === null) return;
    navigate(paths.edit(openDraftSong(source)));
  };

  const startOver = () => {
    setText('');
    setTranspose(null);
    setTitleDraft(null);
    setSaved(null);
    document.getElementById(pasteId)?.focus();
  };

  return (
    <section className="ai-view stack" aria-labelledby={titleId}>
      <header className="ai-header">
        <h1 id={titleId}>{t('ai.title')}</h1>
        <p className="muted">{t('ai.intro')}</p>
        {/* Cách thủ công cũ ("Tạo bài mới thủ công"): bản nháp trống trong Editor. */}
        <button
          type="button"
          className="ai-link-btn"
          onClick={() => navigate(paths.edit(createNewSong()))}
        >
          {t('ai.manual')}
        </button>
      </header>

      <ol className="ai-steps hud-numbered" aria-label={t('ai.steps')}>
        <li className="card ai-step ai-step-prompt">
          <h2 className="hud-section-title">{t('ai.step1.title')}</h2>
          <p className="ai-step-body">{t('ai.step1.body')}</p>
          <div className="row ai-step-actions">
            <Button variant="primary" onClick={() => void copyPrompt()}>
              {copied === 'ok' ? `✓ ${t('ai.step1.copied')}` : t('ai.step1.copy')}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              aria-expanded={showPrompt}
              aria-controls={promptBoxId}
              onClick={() => setShowPrompt((v) => !v)}
            >
              {t('ai.step1.show')} <span aria-hidden="true">{showPrompt ? '▴' : '▾'}</span>
            </Button>
          </div>
          <p
            className={copied === 'failed' ? 'ai-copy-failed' : 'sr-only'}
            role={copied === 'failed' ? 'alert' : undefined}
            aria-live="polite"
          >
            {copied === 'failed'
              ? t('ai.step1.copyFailed')
              : copied === 'ok'
                ? t('ai.step1.copied')
                : ''}
          </p>
          <div id={promptBoxId} className="field ai-prompt-box" hidden={!showPrompt}>
            <label htmlFor={`${promptBoxId}-text`}>{t('ai.step1.promptLabel')}</label>
            <textarea
              id={`${promptBoxId}-text`}
              ref={promptRef}
              readOnly
              rows={8}
              spellCheck={false}
              value={aiPromptFor(lang)}
              onFocus={(e) => e.currentTarget.select()}
            />
          </div>
        </li>

        <li className="card ai-step ai-step-ai">
          <h2 className="hud-section-title">{t('ai.step2.title')}</h2>
          <p className="ai-step-body">{t('ai.step2.body')}</p>
          <ul className="ai-chat-links" aria-label={t('ai.step2.links')}>
            {AI_CHATS.map((chat) => (
              <li key={chat.name}>
                <a
                  className="btn btn-secondary btn-sm"
                  href={chat.url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {chat.name} <span aria-hidden="true">↗</span>
                  <span className="sr-only"> ({t('ai.step2.newTab')})</span>
                </a>
              </li>
            ))}
          </ul>
          <details className="ai-tips">
            <summary>{t('ai.tips.title')}</summary>
            <ul>
              <li>{t('ai.tips.search')}</li>
              <li>{t('ai.tips.melody')}</li>
              <li>{t('ai.tips.nameOnly')}</li>
            </ul>
            {/* Trang Hướng dẫn trong app (D-260), mục "Tìm nguồn ở đâu"; tab mới để không mất ô đã dán. */}
            <a
              href={href(paths.guide('cam-am', AI_GUIDE_SECTION[lang]))}
              target="_blank"
              rel="noopener"
            >
              {t('ai.tips.more')}
              <span className="sr-only"> ({t('ai.step2.newTab')})</span>
            </a>
          </details>
        </li>

        <li className="card ai-step ai-step-paste">
          <h2 className="hud-section-title">{t('ai.step3.title')}</h2>
          <p id={pasteHintId} className="ai-step-body">
            {t('ai.step3.body')}
          </p>
          <div className="field ai-paste-field">
            <label htmlFor={pasteId} className="ai-paste-label">
              {t('ai.paste.label')}
            </label>
            <textarea
              id={pasteId}
              className="ai-paste"
              value={text}
              rows={9}
              spellCheck={false}
              autoComplete="off"
              autoCapitalize="off"
              placeholder={t('ai.paste.placeholder')}
              aria-describedby={`${pasteHintId} ${statusId}`}
              onChange={(e) =>
                changeText(
                  e.currentTarget.value,
                  (e.nativeEvent as { inputType?: unknown }).inputType === 'insertFromPaste',
                )
              }
            />
          </div>
          <PasteSummary
            conversion={conversion}
            statusId={statusId}
            onTransposeChange={(v) => {
              setTranspose(v);
              setSaved(null);
            }}
          />
        </li>

        <li className="card ai-step ai-step-save">
          <h2 className="hud-section-title">{t('ai.step4.title')}</h2>
          {saved ? (
            <div className="ai-saved">
              <p ref={savedRef} tabIndex={-1} className="ai-saved-text">
                <span className="paste-status-icon" aria-hidden="true">
                  ✓
                </span>{' '}
                {t('ai.saved', { title: saved.title })}
              </p>
              <div className="row">
                <a className="btn btn-primary btn-md" href={href(paths.play(saved.id))}>
                  <span aria-hidden="true">▶</span> {t('common.play')}
                </a>
                <a className="btn btn-secondary btn-md" href={href(paths.edit(saved.id))}>
                  {t('ai.edit')}
                </a>
                <a className="btn btn-ghost btn-md" href={href(paths.library())}>
                  {t('common.library')}
                </a>
                <Button variant="ghost" onClick={startOver}>
                  {t('ai.another')}
                </Button>
              </div>
            </div>
          ) : (
            <>
              <div className="field ai-title-field">
                <label htmlFor={songTitleId}>{t('ai.songTitle')}</label>
                <input
                  id={songTitleId}
                  type="text"
                  value={songTitle}
                  placeholder={t('common.untitled')}
                  disabled={harm === null}
                  aria-describedby={songTitleHintId}
                  onChange={(e) => setTitleDraft(e.currentTarget.value)}
                />
                <p id={songTitleHintId} className="field-hint">
                  {t('ai.songTitleHint')}
                </p>
              </div>
              <div className="ai-save-actions">
                <div className="ai-save-action">
                  <Button
                    variant="primary"
                    size="lg"
                    disabled={harm === null}
                    aria-describedby={saveHintId}
                    onClick={save}
                  >
                    {t('common.save')}
                  </Button>
                  <p id={saveHintId} className="field-hint">
                    {t('ai.saveHint')}
                  </p>
                </div>
                <div className="ai-save-action">
                  <Button
                    disabled={harm === null}
                    aria-describedby={editorHintId}
                    onClick={openInEditor}
                  >
                    {t('ai.openEditor')}
                  </Button>
                  <p id={editorHintId} className="field-hint">
                    {t('ai.openEditorHint')}
                  </p>
                </div>
              </div>
            </>
          )}
        </li>
      </ol>
    </section>
  );
}

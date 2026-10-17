import { useMemo } from 'react';
import { parseHarm } from '../core/parser';
import { decodeShareData } from '../core/share';
import { useT } from '../i18n/useT';
import { formatDuration, quickSongStats } from '../library/songSource';
import {
  openTransientSong,
  resetSavedShares as resetSharedSaves,
  saveSharedSong,
  sharedSavedId,
  useLibrary,
} from '../library/store';
import { Button } from '../ui/components';
import { errorDiagnostics, formatDiagnostic } from '../ui/diagnostics';
import { FEATURES } from '../ui/features';
import { href, navigate, paths } from '../ui/router';
import { toast } from '../ui/toast';
import './editor.css';

/** Số lỗi liệt kê trên thẻ (phần còn lại gộp thành "…và N mục khác"). */
const MAX_SHARE_ERRORS = 5;

/** Route `#/s/<data>`: mở bài chia sẻ (lz-string trong hash, không server). */
export function ShareView({ data }: { data: string }) {
  const source = useMemo(() => decodeShareData(data), [data]);
  if (source === null) return <ShareInvalid />;
  // key: link khác → trạng thái "đã lưu" mới.
  return <ShareCard key={data} source={source} />;
}

function ShareInvalid() {
  const t = useT();
  return (
    <section className="card stack share-card" role="alert">
      <h1>{t('share.invalidTitle')}</h1>
      <p>{t('share.invalidBody')}</p>
      <p>
        <a href={href(paths.library())}>{t('common.goHome')}</a>
      </p>
    </section>
  );
}

/** Quên các bài đã lưu từ link (test). */
export function resetSavedShares(): void {
  resetSharedSaves();
}

function ShareCard({ source }: { source: string }) {
  const t = useT();
  const parsed = useMemo(() => parseHarm(source), [source]);
  const { song } = parsed;
  const stats = useMemo(() => quickSongStats(song), [song]);
  const errors = useMemo(() => errorDiagnostics(parsed.diagnostics), [parsed.diagnostics]);
  const warnings = parsed.diagnostics.filter((d) => d.severity === 'warning').length;
  // Lưu một lần (D-106): suy từ thư viện, các nút sau đó dùng lại bài đã lưu (không nhân bản).
  const savedId = useLibrary((s) => sharedSavedId(s.songs, source));
  const title = song.title.trim() || t('common.untitled');

  const saveOnce = (): string => {
    const { id, created } = saveSharedSong(source);
    if (created) toast(t('share.savedToast', { title }));
    return id;
  };

  const play = () => navigate(paths.play(savedId ?? openTransientSong(source)));
  const openEditor = () => navigate(paths.edit(saveOnce()));

  return (
    <section className="card stack share-card" aria-labelledby="share-title">
      <p className="muted share-kicker">{t('share.title')}</p>
      <h1 id="share-title">{title}</h1>
      <p className="muted">{song.artist?.trim() || t('common.unknownArtist')}</p>
      <dl className="pv-dl share-stats">
        <div>
          <dt>{t('library.statBpm')}</dt>
          <dd>{t('common.bpm', { n: song.bpm })}</dd>
        </div>
        <div>
          <dt>{t('library.statLength')}</dt>
          <dd>{formatDuration(stats.durationSec)}</dd>
        </div>
        <div>
          <dt>{t('library.statNotes')}</dt>
          <dd>{stats.noteCount}</dd>
        </div>
        <div>
          <dt>{t('share.statSections')}</dt>
          <dd>{song.sections.length}</dd>
        </div>
      </dl>

      {errors.length === 0 && warnings === 0 ? (
        <p className="share-diag-ok">{t('share.diagOk')}</p>
      ) : (
        <div className="share-diag">
          <p>
            <strong>{t('share.diagSummary', { errors: errors.length, warnings })}</strong>
          </p>
          {errors.length > 0 ? (
            <>
              <p className="muted">{t('share.diagErrorsHint')}</p>
              <ul>
                {errors.slice(0, MAX_SHARE_ERRORS).map((d, i) => (
                  <li key={i}>
                    {t('library.errorAt', {
                      line: d.line,
                      column: d.column,
                      message: formatDiagnostic(t, d),
                    })}
                  </li>
                ))}
              </ul>
              {errors.length > MAX_SHARE_ERRORS ? (
                <p className="muted">
                  {t('editor.diagMore', { n: errors.length - MAX_SHARE_ERRORS })}
                </p>
              ) : null}
            </>
          ) : null}
        </div>
      )}

      <div className="row share-actions" role="group" aria-label={t('share.actions')}>
        <Button variant="primary" onClick={play}>
          <span aria-hidden="true">▶</span> {t('share.play')}
        </Button>
        {/* Đã lưu: aria-disabled thay vì disabled để nút vừa bấm giữ focus (không rơi về <body>). */}
        <Button
          aria-disabled={savedId !== null || undefined}
          onClick={() => {
            if (savedId === null) saveOnce();
          }}
        >
          {savedId ? t('share.savedState') : t('share.save')}
        </Button>
        {FEATURES.editor ? <Button onClick={openEditor}>{t('share.openEditor')}</Button> : null}
      </div>
      {savedId ? null : <p className="muted share-hint">{t('share.playHint')}</p>}

      <details className="share-source">
        <summary>{t('share.source')}</summary>
        <pre className="mono">{source}</pre>
      </details>
    </section>
  );
}

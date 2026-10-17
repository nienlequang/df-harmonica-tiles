import { useEffect, useId, useMemo, useState } from 'react';
import { isShareUrlLong } from '../core/share';
import type { StringKey } from '../i18n/strings';
import { useT } from '../i18n/useT';
import { entryTitle } from '../library/store';
import type { LibraryEntry } from '../library/store';
import { Button, Modal, Slider, copyText } from '../ui/components';
import { useSettings } from '../ui/settings';
import { ObsConnectPanel } from './ObsConnectPanel';
import { readObsLinkPrefs, rememberObsLinkPrefs } from './obsLinkPrefs';
import {
  OBS_PRESETS,
  OVERLAY_OPACITY_MAX,
  OVERLAY_OPACITY_MIN,
  OVERLAY_UI_SCALE_MAX,
  OVERLAY_UI_SCALE_MIN,
  buildOverlayUrl,
  presetOptions,
} from './overlayParams';
import type { ObsPreset, OverlayLinkOptions } from './overlayParams';
import './obsLink.css';

export interface ObsLinkModalProps {
  open: boolean;
  onClose: () => void;
  /** Bài đang mở ở Player (overlay luôn là bài của Player — không có ô chọn bài). */
  song?: LibraryEntry | null;
}

const PRESET_LABEL: Readonly<Record<ObsPreset, StringKey>> = {
  game: 'overlay.preset.game',
  strip: 'overlay.preset.strip',
  full: 'overlay.preset.full',
};

const PRESET_HINT: Readonly<Record<ObsPreset, StringKey>> = {
  game: 'overlay.preset.gameHint',
  strip: 'overlay.preset.stripHint',
  full: 'overlay.preset.fullHint',
};

/** Cỡ canvas OBS hay gặp (ví dụ ở bước "Width × Height" của Browser Source thủ công). */
const CANVAS_EXAMPLES = ['1920 × 1080', '2560 × 1440'] as const;
/** Cửa sổ "Xem trước" = nửa cỡ 1080p (16:9, bố cục cả canvas tự co theo). */
const PREVIEW_FEATURES = 'popup=yes,width=960,height=540';

interface Status {
  kind: 'ok' | 'error';
  text: string;
  /** Hiện cạnh nút vừa bấm: Sao chép link (thủ công) hay Xem trước. */
  at: 'copy' | 'preview';
}

/** Bài có nốt (không phải toàn rest / rỗng) — link của bài rỗng chỉ mở ra thẻ lỗi. */
function entryHasNotes(entry: LibraryEntry): boolean {
  return entry.parsed.song.sections.some((s) =>
    s.lines.some((l) => l.units.some((u) => u.kind !== 'rest')),
  );
}

/**
 * Hộp thoại "Tạo link OBS" (góp ý 2026-10-15 "OBS chỉ lo hiển thị"): overlay là màn hiển thị của Player
 * — bài, phát / dừng / tua / tempo và kiểu điều khiển theo Player (follow.ts), nên ở đây chỉ còn cách
 * hiển thị riêng của overlay: kiểu overlay, độ đậm của ô, tinh chỉnh cỡ UI game. Link dùng bố cục cả canvas
 * (`fit=canvas`, tự nằm đúng trên bảng phím game) và nhúng ảnh chụp Cài đặt của Player (cho lúc overlay tự
 * chạy một mình). Hai cách đưa lên OBS (vòng R6 bỏ Window Capture — màn hình thứ 2 đã hiện màn chơi chính):
 * (1) Gửi thẳng vào OBS (obs-websocket — ObsConnectPanel, khuyên dùng), (2) Browser Source thủ công cỡ
 * canvas. Nút "Xem trước" mở cửa sổ nhỏ nền tối (`preview=1`) chạy theo màn chơi — chỉ để xem, không để quay.
 */
export function ObsLinkModal({ open, onClose, song = null }: ObsLinkModalProps) {
  const t = useT();
  return (
    <Modal open={open} title={t('overlay.modal.title')} onClose={onClose} size="lg">
      {song ? <ObsLinkBody song={song} /> : <p className="muted">{t('overlay.modal.noSong')}</p>}
    </Modal>
  );
}

/** Ảnh chụp Cài đặt của Player đi vào link (overlay trong OBS có bộ nhớ riêng, không thấy Cài đặt này). */
function usePlayerSnapshot(): Omit<
  OverlayLinkOptions,
  'layout' | 'lanes' | 'gamebar' | 'banner' | 'opacity' | 'bg' | 'fit' | 'scale' | 'preview'
> {
  const scheme = useSettings((s) => s.controlScheme);
  const semitone = useSettings((s) => s.mobileSemitone);
  const names = useSettings((s) => s.labelOverrides);
  const lookahead = useSettings((s) => s.lookahead);
  const tileScale = useSettings((s) => s.tileScale);
  const subLabel = useSettings((s) => s.subLabel);
  const countIn = useSettings((s) => s.countIn);
  const delaySec = useSettings((s) => s.startDelaySec);
  const lang = useSettings((s) => s.language);
  const theme = useSettings((s) => s.theme);
  return useMemo(
    () => ({
      scheme,
      semitone,
      names,
      lookahead,
      tileScale,
      subLabel,
      countIn,
      delaySec,
      lang,
      theme,
    }),
    [scheme, semitone, names, lookahead, tileScale, subLabel, countIn, delaySec, lang, theme],
  );
}

function ObsLinkBody({ song }: { song: LibraryEntry }) {
  const t = useT();
  const snapshot = usePlayerSnapshot();
  // Nhớ trong trình duyệt này: mở lại hộp thoại (vd. nối lại OBS) giữ đúng tùy chọn đã căn — "Thêm overlay
  // vào OBS" không ghi đè source đã căn bằng giá trị mặc định (obsLinkPrefs.ts).
  const [initial] = useState(readObsLinkPrefs);
  const [preset, setPreset] = useState<ObsPreset>(initial.preset);
  const [opacity, setOpacity] = useState(initial.opacity);
  const [uiScale, setUiScale] = useState(initial.uiScale);
  useEffect(() => {
    rememberObsLinkPrefs({ preset, opacity, uiScale });
  }, [preset, opacity, uiScale]);
  const [status, setStatus] = useState<Status | null>(null);
  const id = useId();

  const title = entryTitle(song) || t('common.untitled');
  const hasNotes = entryHasNotes(song);

  const choosePreset = (p: ObsPreset) => {
    setPreset(p);
    setOpacity(presetOptions(p).opacity);
  };

  const options = useMemo<OverlayLinkOptions>(
    () => ({
      ...snapshot,
      ...presetOptions(preset),
      opacity,
      fit: 'canvas',
      bg: 'transparent',
      scale: uiScale,
      preview: false,
    }),
    [snapshot, preset, opacity, uiScale],
  );
  const linkSong = useMemo(
    () => ({ id: song.id, seed: song.seed, source: song.source }),
    [song.id, song.seed, song.source],
  );
  // Browser Source (gửi thẳng / thủ công): nền trong suốt. "Xem trước": cùng link + `preview=1` (nền tối
  // thường, bảng phím game minh họa).
  const url = useMemo(
    () => buildOverlayUrl(window.location, linkSong, options),
    [linkSong, options],
  );
  const previewUrl = useMemo(
    () => buildOverlayUrl(window.location, linkSong, { ...options, preview: true }),
    [linkSong, options],
  );
  const long = isShareUrlLong(url);

  // Link đổi → thông báo "đã sao chép" cũ không còn đúng.
  useEffect(() => setStatus(null), [url]);

  const copy = async () => {
    const ok = await copyText(url);
    setStatus(
      ok
        ? { kind: 'ok', text: t('overlay.modal.copied', { n: url.length }), at: 'copy' }
        : { kind: 'error', text: t('overlay.modal.copyFailed'), at: 'copy' },
    );
  };

  const openPreview = () => {
    const w = window.open(previewUrl, '_blank', PREVIEW_FEATURES);
    if (!w) {
      setStatus({ kind: 'error', text: t('overlay.modal.popupBlocked'), at: 'preview' });
      return;
    }
    try {
      w.opener = null;
    } catch {
      // cửa sổ khác origin / đã đóng: bỏ qua
    }
  };

  const pct = (v: number) => `${Math.round(v * 100)}%`;
  const statusAt = (at: Status['at']) => (
    <div aria-live="polite" className="obs-link-status">
      {status && status.at === at ? (
        <p className={status.kind === 'error' ? 'obs-link-warn' : 'obs-link-ok'}>{status.text}</p>
      ) : null}
    </div>
  );

  return (
    <div className="obs-link stack">
      <p className="muted obs-link-intro">{t('overlay.modal.intro')}</p>
      <p className="obs-link-song">
        <span className="obs-link-song-label">{t('overlay.modal.song')}: </span>
        <strong>{title}</strong>
      </p>
      {!hasNotes ? (
        <p className="obs-link-warn" role="note">
          {t('overlay.error.empty', { title })}
        </p>
      ) : null}

      <fieldset className="obs-link-presets">
        <legend>{t('overlay.modal.preset')}</legend>
        {OBS_PRESETS.map((p) => (
          <label key={p} className="obs-link-choice">
            <input
              type="radio"
              name={`${id}-preset`}
              value={p}
              checked={preset === p}
              onChange={() => choosePreset(p)}
              aria-describedby={`${id}-${p}`}
              data-autofocus={p === 'game' ? true : undefined}
            />
            <span className="obs-link-choice-text">
              <span className="obs-link-choice-label">{t(PRESET_LABEL[p])}</span>
              <span id={`${id}-${p}`} className="obs-link-choice-hint">
                {t(PRESET_HINT[p])}
              </span>
            </span>
          </label>
        ))}
      </fieldset>

      <section className="obs-link-section" aria-labelledby={`${id}-look`}>
        <h3 id={`${id}-look`}>{t('overlay.modal.look')}</h3>
        <div className="obs-link-grid">
          <div>
            <Slider
              label={t('overlay.modal.opacity')}
              value={opacity}
              min={OVERLAY_OPACITY_MIN}
              max={OVERLAY_OPACITY_MAX}
              step={0.05}
              onChange={setOpacity}
              format={pct}
              aria-valuetext={pct(opacity)}
              aria-describedby={`${id}-opacity`}
            />
            <p id={`${id}-opacity`} className="field-hint">
              {t('overlay.modal.opacityHint')}
            </p>
          </div>
          <div>
            <Slider
              label={t('overlay.modal.uiScale')}
              value={uiScale}
              min={OVERLAY_UI_SCALE_MIN}
              max={OVERLAY_UI_SCALE_MAX}
              step={0.01}
              onChange={setUiScale}
              format={pct}
              aria-valuetext={pct(uiScale)}
              aria-describedby={`${id}-ui`}
            />
            <p id={`${id}-ui`} className="field-hint">
              {t('overlay.modal.uiScaleHint')}
            </p>
          </div>
        </div>
      </section>

      <section className="obs-link-section obs-link-method" aria-labelledby={`${id}-direct`}>
        <h3 id={`${id}-direct`}>{t('overlay.modal.direct')}</h3>
        <p className="muted obs-link-method-hint">{t('overlay.modal.directHint')}</p>
        <ObsConnectPanel overlayUrl={url} />
      </section>

      <section className="obs-link-section obs-link-method" aria-labelledby={`${id}-manual`}>
        <h3 id={`${id}-manual`}>{t('overlay.modal.manual')}</h3>
        <div className="field obs-link-url">
          <label htmlFor={`${id}-url`}>{t('overlay.modal.url')}</label>
          <textarea
            id={`${id}-url`}
            readOnly
            rows={3}
            value={url}
            spellCheck={false}
            onFocus={(e) => e.currentTarget.select()}
          />
        </div>
        <div className="row obs-link-actions">
          <Button variant="primary" disabled={!hasNotes} onClick={() => void copy()}>
            {t('overlay.modal.copy')}
          </Button>
        </div>
        {statusAt('copy')}
        {long ? (
          <p className="obs-link-warn" role="note">
            {t('overlay.modal.long', { n: url.length })}
          </p>
        ) : null}
        <ol>
          <li>{t('overlay.manual.step1')}</li>
          <li>{t('overlay.manual.step2')}</li>
          <li>{t('overlay.manual.step3', { a: CANVAS_EXAMPLES[0], b: CANVAS_EXAMPLES[1] })}</li>
        </ol>
        <p className="field-hint">{t('overlay.manual.note')}</p>
      </section>

      {/* Xem trước: không phải một cách đưa lên OBS (không đánh số) — chỉ để xem người xem thấy gì. */}
      <div className="obs-link-preview">
        <Button disabled={!hasNotes} aria-describedby={`${id}-preview`} onClick={openPreview}>
          {t('overlay.modal.preview')}
        </Button>
        <p id={`${id}-preview`} className="field-hint obs-link-preview-hint">
          {t('overlay.modal.previewHint')}
        </p>
        {statusAt('preview')}
      </div>
    </div>
  );
}

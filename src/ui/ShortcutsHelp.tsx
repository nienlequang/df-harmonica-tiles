import type { ReactNode } from 'react';
import { KEY_SOLFEGE_EN, KEY_SOLFEGE_VI, NOTE_KEYS } from '../core/keys';
import type { NoteKey } from '../core/types';
import type { StringKey } from '../i18n/strings';
import type { TFunction } from '../i18n/useT';
import { useT } from '../i18n/useT';
import { useModifierLabels } from './modLabels';
import { href, paths } from './router';
import { useSettings } from './settings';
import type { ControlScheme } from './settings';
import { PLAYER_HOTKEYS } from './useHotkeys';
import './settings.css';

/** Nhãn hiển thị cho một KeyboardEvent.code. Mũi tên có chữ ẩn cho screen reader. */
function KeyCap({ code, t }: { code: string; t: TFunction }) {
  let content: ReactNode;
  if (code === 'Space') content = t('shortcuts.key.space');
  else if (code === 'Escape') content = t('shortcuts.key.esc');
  else if (code === 'ArrowLeft' || code === 'ArrowRight') {
    const left = code === 'ArrowLeft';
    content = (
      <>
        <span aria-hidden="true">{left ? '←' : '→'}</span>
        <span className="sr-only">{t(left ? 'shortcuts.key.left' : 'shortcuts.key.right')}</span>
      </>
    );
  } else if (code === 'BracketLeft') content = '[';
  else if (code === 'BracketRight') content = ']';
  else if (code.startsWith('Key')) content = code.slice(3);
  else if (code.startsWith('Digit')) content = code.slice(5);
  else content = code;
  return <kbd>{content}</kbd>;
}

interface ShortcutRow {
  id: string;
  codes: readonly string[];
  action: StringKey;
}

/** Phím tắt của màn chơi (useHotkeys trong PlayerView) — kể cả Esc hủy đếm ngược. */
const ROWS: readonly ShortcutRow[] = [
  { id: 'play', codes: [PLAYER_HOTKEYS.playPause], action: 'shortcuts.playPause' },
  { id: 'restart', codes: [PLAYER_HOTKEYS.restart], action: 'shortcuts.restart' },
  {
    id: 'seek',
    codes: [PLAYER_HOTKEYS.prevLine, PLAYER_HOTKEYS.nextLine],
    action: 'shortcuts.seekLine',
  },
  { id: 'loop', codes: [PLAYER_HOTKEYS.loop], action: 'shortcuts.loop' },
  { id: 'bpm', codes: [PLAYER_HOTKEYS.bpmDown, PLAYER_HOTKEYS.bpmUp], action: 'shortcuts.bpm' },
  { id: 'esc', codes: ['Escape'], action: 'shortcuts.cancelCountdown' },
];

/** Số giản phổ 1…7, 1̇ của 8 phím (chấm của Đố vẽ bằng CSS — DESIGN.md: không dùng U+0307 trong DOM). */
const DEGREE: Readonly<Record<NoteKey, string>> = {
  Z: '1',
  X: '2',
  C: '3',
  V: '4',
  B: '5',
  N: '6',
  M: '7',
  ',': '1',
};

function Degree({ k }: { k: NoteKey }) {
  const high = k === ',';
  return (
    <span className={high ? 'shortcuts-degree is-high' : 'shortcuts-degree'}>{DEGREE[k]}</span>
  );
}

export interface ShortcutsHelpProps {
  className?: string;
  /** Kiểu điều khiển để mô tả phím game / modifier; mặc định theo Cài đặt. */
  scheme?: ControlScheme;
  /** Ẩn dòng ghi chú "phím tắt không chạy khi đang gõ" (vd. khi chỗ hiển thị chật). */
  hideFocusHint?: boolean;
  /** Ẩn link "Xem hướng dẫn". */
  hideGuideLink?: boolean;
}

/**
 * Danh sách ĐẦY ĐỦ phím tắt + cách bấm (góp ý 2026-10-15 B): phím tắt màn chơi (Space, R, ← / →, L,
 * [ / ], Esc), 8 phím / nút game (Z X C V B N M , = 1 … 1̇, Đồ … Đố), modifier theo kiểu điều khiển (PC:
 * giữ chuột trái / phải, chuột giữa / cuộn — tên gọi theo Cài đặt, D-181; Mobile: chạm chế độ rồi nốt,
 * giữ cho nốt dài), ghi chú luyện tập và link Hướng dẫn. Dùng chung cho cột trái của màn chơi, hộp thoại
 * "?" (màn hẹp) và thẻ Phím tắt ở Cài đặt.
 */
export function ShortcutsHelp({
  className,
  scheme: schemeProp,
  hideFocusHint,
  hideGuideLink,
}: ShortcutsHelpProps) {
  const t = useT();
  const settingsScheme = useSettings((s) => s.controlScheme);
  const lang = useSettings((s) => s.language);
  const labels = useModifierLabels();
  const scheme = schemeProp ?? settingsScheme;
  const mobile = scheme === 'mobile';
  const solfege = lang === 'vi' ? KEY_SOLFEGE_VI : KEY_SOLFEGE_EN;

  return (
    <div className={['shortcuts', className].filter(Boolean).join(' ')} data-scheme={scheme}>
      <section className="shortcuts-group">
        <h3 className="shortcuts-title">{t('shortcuts.group.app')}</h3>
        <dl className="shortcuts-list">
          {ROWS.map((row) => (
            <div className="shortcuts-row" key={row.id}>
              <dt>
                {row.codes.map((code, i) => (
                  <span key={code}>
                    {i > 0 ? (
                      <span className="shortcuts-sep" aria-hidden="true">
                        /
                      </span>
                    ) : null}
                    <KeyCap code={code} t={t} />
                  </span>
                ))}
              </dt>
              <dd>{t(row.action)}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="shortcuts-group">
        <h3 className="shortcuts-title">
          {t(mobile ? 'shortcuts.group.gameMobile' : 'shortcuts.group.game')}
        </h3>
        <p className="shortcuts-hint">
          {t(mobile ? 'shortcuts.gameDigitsHint' : 'shortcuts.gameKeysHint')}
        </p>
        <ol className="shortcuts-notes">
          {NOTE_KEYS.map((k) => (
            <li key={k} className="shortcuts-note">
              {mobile ? (
                <span className="shortcuts-digit">
                  <Degree k={k} />
                </span>
              ) : (
                <>
                  <kbd>{k}</kbd>
                  <Degree k={k} />
                </>
              )}
              <span className="shortcuts-solfege">{solfege[k]}</span>
            </li>
          ))}
        </ol>
      </section>

      <section className="shortcuts-group">
        <h3 className="shortcuts-title">
          {t(mobile ? 'shortcuts.group.touch' : 'shortcuts.group.mouse')}
        </h3>
        {mobile ? (
          <dl className="shortcuts-list is-stacked">
            <div className="shortcuts-row">
              <dt>{t('shortcuts.touch.mode')}</dt>
              <dd>
                {t('shortcuts.touch.modeHint', {
                  right: labels.right,
                  natural: labels.natural,
                  left: labels.left,
                })}
              </dd>
            </div>
            <div className="shortcuts-row">
              <dt>{t('shortcuts.touch.semitone', { name: labels.scroll })}</dt>
              <dd>{t('shortcuts.touch.semitoneHint')}</dd>
            </div>
            <div className="shortcuts-row">
              <dt>{t('shortcuts.touch.hold')}</dt>
              <dd>{t('shortcuts.touch.holdHint')}</dd>
            </div>
          </dl>
        ) : (
          <dl className="shortcuts-list is-stacked">
            <div className="shortcuts-row">
              <dt>
                <span className="shortcuts-swatch is-left" aria-hidden="true" />
                {t('shortcuts.mouse.left')}
              </dt>
              <dd>{t('shortcuts.mod.left', { name: labels.left })}</dd>
            </div>
            <div className="shortcuts-row">
              <dt>
                <span className="shortcuts-swatch is-right" aria-hidden="true" />
                {t('shortcuts.mouse.right')}
              </dt>
              <dd>{t('shortcuts.mod.right', { name: labels.right })}</dd>
            </div>
            <div className="shortcuts-row">
              <dt>
                <span className="shortcuts-swatch is-scroll" aria-hidden="true" />
                {t('shortcuts.mouse.middle')}
              </dt>
              <dd>{t('shortcuts.mod.scroll', { name: labels.scroll })}</dd>
            </div>
          </dl>
        )}
      </section>

      <p className="shortcuts-practice">
        {t(mobile ? 'shortcuts.practiceMobile' : 'shortcuts.practicePc')}
      </p>
      {hideFocusHint ? null : <p className="field-hint">{t('shortcuts.focusHint')}</p>}
      {hideGuideLink ? null : (
        <p className="shortcuts-guide">
          <a href={href(paths.guide())}>{t('shortcuts.guideLink')}</a>
        </p>
      )}
    </div>
  );
}

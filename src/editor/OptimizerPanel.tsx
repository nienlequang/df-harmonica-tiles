import { useEffect, useId, useLayoutEffect, useMemo, useRef } from 'react';
import type { MouseEvent } from 'react';
import { GAME_SCROLL_DIR, midiName, playableRange } from '../core/keys';
import { keepOriginalKey, optimizeTranspose } from '../core/optimizer';
import type { OptimizerOptions, Placement } from '../core/optimizer';
import { useT } from '../i18n/useT';
import type { TFunction } from '../i18n/useT';
import { Button } from '../ui/components';
import { useModifierLabels } from '../ui/modLabels';
import { useSettings } from '../ui/settings';
import type { ControlScheme, MobileSemitone } from '../ui/settings';
import './tools/tools.css';

/**
 * Bảng chọn cung / quãng của transpose optimizer (spec §6, §6b A bước 4): top 3 phương án + phương
 * án giữ cung gốc, mỗi dòng là một radio. Dùng chung cho cảm âm, tối ưu lại bài và MIDI import.
 * Cột thống kê theo kiểu điều khiển: PC = lần giữ chuột + nốt có modifier; Mobile = lần chạm đổi
 * chế độ quãng + lần chạm Nửa Cung (cột nốt Nửa Cung có ở cả hai). Nửa Cung luôn thăng
 * (GAME_SCROLL_DIR). Gộp nốt vượt tầm về quãng gần nhất LUÔN BẬT (góp ý 2026-10-15 C, không còn
 * công tắc): phương án có nốt bị gộp bị phạt nặng nên chỉ thắng khi giai điệu rộng hơn tầm.
 */
export interface OptimizerPanelProps {
  /** Cao độ midi theo thứ tự event (null = nghỉ) — `melodyPitches(melody)`. */
  pitches: readonly (number | null)[];
  baseOctave: number;
  /** Phương án đang chọn; null (hoặc không khớp `pitches`) → panel tự chọn phương án tốt nhất. */
  value: Placement | null;
  onChange(p: Placement): void;
  /**
   * Cost model: 'pc' (giữ chuột) hoặc 'mobile' (chạm đổi chế độ, giữ trạng thái). Không truyền =
   * theo Cài đặt → Kiểu điều khiển.
   */
  scheme?: ControlScheme;
  /** Mobile: Nửa Cung bật/tắt hay chỉ 1 nốt. Không truyền = theo Cài đặt. */
  mobileSemitone?: MobileSemitone;
}

const TOP = 3;
const MINUS = '\u2212';

/** "C3–C6" cho baseOctave 4. */
export function playableRangeLabel(baseOctave: number): string {
  const { min, max } = playableRange(baseOctave);
  return `${midiName(min)}–${midiName(max)}`;
}

/** Nhãn transpose: "Giữ cung gốc", "+5 bán cung", "-12 (hạ 1 quãng)". */
export function transposeLabel(t: TFunction, transpose: number): string {
  if (transpose === 0) return t('editor.optimizer.original');
  const abs = Math.abs(transpose);
  const num = transpose > 0 ? `+${abs}` : `${MINUS}${abs}`;
  if (abs % 12 === 0) {
    return t(transpose > 0 ? 'editor.optimizer.octaveUp' : 'editor.optimizer.octaveDown', {
      num,
      n: abs / 12,
    });
  }
  return t('editor.optimizer.semitones', { num, n: abs });
}

/** Hai phương án coi như một (cùng transpose + cùng kết quả) — solver tất định. */
function samePlacement(a: Placement, b: Placement): boolean {
  return (
    a === b ||
    (a.transpose === b.transpose &&
      a.cost === b.cost &&
      a.choices.length === b.choices.length &&
      a.stats.foldedNotes === b.stats.foldedNotes)
  );
}

interface Row {
  placement: Placement;
  best: boolean;
}

/** Số lần chạm (mobile); thiếu (optimizer không điền) → gạch ngang. */
function tapText(n: number | undefined): string {
  return typeof n === 'number' ? String(n) : '—';
}

function safeOptimize(pitches: readonly (number | null)[], opts: OptimizerOptions) {
  try {
    return {
      top: optimizeTranspose(pitches, { ...opts, top: TOP }),
      original: keepOriginalKey(pitches, opts),
    };
  } catch (err) {
    // baseOctave sai (không xảy ra với settings đã sanitize) — coi như không có phương án
    console.error(err);
    return { top: [] as Placement[], original: null };
  }
}

export function OptimizerPanel({
  pitches,
  baseOctave,
  value,
  onChange,
  scheme: schemeProp,
  mobileSemitone: semitoneProp,
}: OptimizerPanelProps) {
  const t = useT();
  const labels = useModifierLabels();
  const settingsScheme = useSettings((s) => s.controlScheme);
  const settingsSemitone = useSettings((s) => s.mobileSemitone);
  const scheme = schemeProp ?? settingsScheme;
  const mobileSemitone = semitoneProp ?? settingsSemitone;
  const mobile = scheme === 'mobile';
  const name = useId();
  const hintId = useId();
  const onChangeRef = useRef(onChange);
  useLayoutEffect(() => {
    onChangeRef.current = onChange;
  });

  const { top, original } = useMemo(
    () =>
      safeOptimize(
        pitches,
        mobile
          ? { baseOctave, scrollDir: GAME_SCROLL_DIR, fold: true, scheme: 'mobile', mobileSemitone }
          : { baseOctave, scrollDir: GAME_SCROLL_DIR, fold: true },
      ),
    [pitches, baseOctave, mobile, mobileSemitone],
  );
  const noteCount = useMemo(() => pitches.filter((p) => p !== null).length, [pitches]);
  const range = playableRangeLabel(baseOctave);

  // value cũ (melody khác) không dùng được → coi như chưa chọn
  const valid = value !== null && value.choices.length === pitches.length;
  const best = top[0] ?? null;

  useEffect(() => {
    if (!valid && best) onChangeRef.current(best);
  }, [valid, best]);

  const rows: Row[] = top.map((placement, i) => ({ placement, best: i === 0 }));
  if (original && !rows.some((r) => r.placement.transpose === original.transpose)) {
    rows.push({ placement: original, best: false });
  }
  // phương án nơi gọi tự đưa vào (vd. gập quãng cũ) vẫn hiện để thấy đang dùng gì
  if (valid && !rows.some((r) => samePlacement(r.placement, value))) {
    rows.push({ placement: value, best: false });
  }
  const selected = valid ? rows.find((r) => samePlacement(r.placement, value)) : undefined;
  const showFolded = rows.some((r) => r.placement.stats.foldedNotes > 0);

  const select = (p: Placement) => {
    if (!selected || selected.placement !== p) onChangeRef.current(p);
  };
  const onRowClick = (e: MouseEvent<HTMLTableRowElement>, p: Placement) => {
    // click vào label/radio đã được radio xử lý
    if (e.target instanceof Element && e.target.closest('label, input')) return;
    select(p);
  };

  if (noteCount === 0) {
    return (
      <div className="opt-panel">
        <p className="muted">{t('editor.optimizer.noNotes')}</p>
      </div>
    );
  }

  if (rows.length === 0) {
    // chỉ xảy ra khi cao độ không hợp lệ (gộp nốt luôn bật nên mọi giai điệu đều đặt được)
    return (
      <div className="opt-panel">
        <div className="tool-note tool-note-warn" role="status">
          <p>{t('editor.optimizer.empty', { range })}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="opt-panel">
      <fieldset className="opt-fieldset" aria-describedby={hintId}>
        <legend>{t('editor.optimizer.legend')}</legend>
        <div className="tool-table-wrap">
          <table className="tool-table opt-table">
            <thead>
              <tr>
                <th scope="col">{t('editor.optimizer.colKey')}</th>
                <th scope="col" className="num">
                  {mobile
                    ? t('editor.optimizer.colSharpMobile', { scroll: labels.scroll })
                    : t('editor.optimizer.colScroll')}
                </th>
                {mobile ? (
                  <>
                    <th scope="col" className="num">
                      {t('editor.optimizer.colOctaveTaps')}
                    </th>
                    <th scope="col" className="num">
                      {t('editor.optimizer.colSemitoneTaps', { scroll: labels.scroll })}
                    </th>
                  </>
                ) : (
                  <>
                    <th scope="col" className="num">
                      {t('editor.optimizer.colHolds')}
                    </th>
                    <th scope="col" className="num">
                      {t('editor.optimizer.colModified')}
                    </th>
                  </>
                )}
                {showFolded ? (
                  <th scope="col" className="num">
                    {t('editor.optimizer.colFolded')}
                  </th>
                ) : null}
                <th scope="col" className="num">
                  {t('editor.optimizer.colCost')}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const p = r.placement;
                const id = `${name}-${p.transpose}-${p.cost}`;
                const isSel = selected === r;
                return (
                  <tr
                    key={id}
                    className={isSel ? 'opt-row is-selected' : 'opt-row'}
                    onClick={(e) => onRowClick(e, p)}
                  >
                    <th scope="row">
                      <span className="opt-choice">
                        <input
                          id={id}
                          type="radio"
                          name={name}
                          checked={isSel}
                          onChange={() => select(p)}
                        />
                        <label htmlFor={id}>{transposeLabel(t, p.transpose)}</label>
                        {r.best ? (
                          <span className="tool-badge tool-badge-ok">
                            {t('editor.optimizer.best')}
                          </span>
                        ) : null}
                        {p.shift === 0 && p.transpose !== 0 ? (
                          <span className="tool-badge">{t('editor.optimizer.originalBadge')}</span>
                        ) : null}
                      </span>
                    </th>
                    <td className="num">{p.stats.scrollNotes}</td>
                    {mobile ? (
                      <>
                        <td className="num">{tapText(p.stats.octaveTaps)}</td>
                        <td className="num">{tapText(p.stats.semitoneTaps)}</td>
                      </>
                    ) : (
                      <>
                        <td className="num">{p.stats.holdRuns}</td>
                        <td className="num">{p.stats.modifiedNotes}</td>
                      </>
                    )}
                    {showFolded ? (
                      <td className={p.stats.foldedNotes > 0 ? 'num tool-text-warn' : 'num'}>
                        {p.stats.foldedNotes}
                      </td>
                    ) : null}
                    <td className="num">{p.cost}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p id={hintId} className="field-hint">
          {mobile
            ? t('editor.optimizer.costHintMobile', { scroll: labels.scroll })
            : t('editor.optimizer.costHint')}
        </p>
      </fieldset>
      <div className="row opt-actions">
        <Button
          size="sm"
          disabled={!original}
          onClick={() => {
            if (original) select(original);
          }}
        >
          {t('editor.optimizer.keepOriginal')}
        </Button>
        {!original ? (
          <span className="field-hint">{t('editor.optimizer.keepOriginalNone', { range })}</span>
        ) : null}
      </div>
      {showFolded ? <p className="field-hint">{t('editor.optimizer.foldHint')}</p> : null}
    </div>
  );
}

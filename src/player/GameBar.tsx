import { KEY_DEGREE, NOTE_KEYS } from '../core/keys';
import { jianpuLabel, jianpuText } from '../core/mobile';
import type { JianpuLabel } from '../core/mobile';
import type { HoldRun, Modifiers, NoteKey, TimelineNote } from '../core/types';
import type { StringKey } from '../i18n/strings';
import { useT } from '../i18n/useT';
import { useModifierLabels } from '../ui/modLabels';
import type { ModifierLabels } from '../ui/modLabels';
import { tileColorKey } from '../ui/palette';
import type { ControlScheme } from '../ui/settings';
import { MOBILE_BUTTONS, cueButton, modeButton } from './mobilePlan';
import type { MobileButton, MobileUiState } from './mobilePlan';
import './player.css';

/**
 * "Game bar" mô phỏng UI gợi ý phím của Delta Force (spec §5).
 *
 * PC: hàng số 1..1̇, hàng phím Z X C V B N M , (thẳng hàng với lane nhờ CSS var --lane-left /
 * --lane-right), hàng modifier "Cúi Xuống [chuột trái] | Nửa Cung [scroll] | Ngẩng Lên [chuột phải]"
 * (tên lấy từ ModifierLabels — người dùng đổi được). Phím của nốt đang ở hit line sáng theo màu tile;
 * modifier cần cho nốt đó HOẶC hold run đang chạy sáng theo màu của nó.
 *
 * Mobile (docs/GAME-UI-REFERENCE.md "Bản mobile"): hàng trên 4 nút tròn Nửa Cung · Ngẩng Lên ·
 * Ngẩng Tự Nhiên · Cúi Xuống — nút của chế độ đang chọn sáng như trong game (chạm để chọn, giữ trạng
 * thái), nút sắp phải chạm (≤ ~1 beat) có vòng hổ phách; hàng dưới 8 nút tròn số giản phổ, chấm
 * trên/dưới theo chế độ quãng hiện tại (−1: 1̣…7̣ 1 · 0: 1…7 1̇ · +1: 1̇…7̇ 1̈), nút của nốt ở hit line sáng.
 *
 * Mỗi nốt mới (`noteId` đổi) phím "nhấn lại" — kể cả khi cùng phím với nốt trước (X X X…).
 * Practice mode: phím / modifier người chơi ĐANG GIỮ có viền riêng (`is-pressed`).
 * Không dùng aria-live (tránh spam screen reader) — mục đang sáng có aria-current.
 */
export interface GameBarProps {
  /** Nốt đang ở hit line. */
  note: Pick<TimelineNote, 'key' | 'modifiers'> | null;
  /**
   * Định danh nốt đang ở hit line (vd. index trong timeline). Đổi giá trị → keycap chạy lại hiệu
   * ứng nhấn (remount) dù phím không đổi.
   */
  noteId?: number | null;
  /** Hold run đang cắt qua hit line (PC). */
  run: Pick<HoldRun, 'modifiers'> | null;
  /** Practice: phím + modifier người chơi đang giữ (null = không hiện). */
  pressed?: PressedKeys | null;
  /** Kiểu điều khiển (mặc định PC). */
  scheme?: ControlScheme;
  /** Mobile: chế độ tại hit line + lần chạm kế (null → coi như Ngẩng Tự Nhiên, Nửa Cung tắt). */
  mobile?: MobileUiState | null;
  /** Tên 4 nút; mặc định theo Cài đặt (useModifierLabels). Overlay OBS truyền tên từ link. */
  labels?: ModifierLabels;
  className?: string;
}

/** Phím / modifier đang giữ (bàn phím, chuột, hoặc suy ra từ nốt MIDI). */
export interface PressedKeys {
  keys: readonly NoteKey[];
  left: boolean;
  right: boolean;
  scroll: boolean;
}

const NO_MODS: Readonly<Modifiers> = Object.freeze({ left: false, right: false, scroll: false });
const COMBINING_DOT_ABOVE = '̇';

/**
 * Bậc "1̇" (Đố): font hệ thống đặt dấu chấm kết hợp U+0307 lệch sang phải chữ số ("1˙") → vẽ chấm
 * bằng CSS ngay trên chữ số; screen reader vẫn đọc ký tự gốc.
 */
function Degree({ text }: { text: string }) {
  if (!text.includes(COMBINING_DOT_ABOVE)) return <span className="gb-degree">{text}</span>;
  return (
    <span className="gb-degree">
      <span className="gb-degree-dot" aria-hidden="true">
        {text.replace(COMBINING_DOT_ABOVE, '')}
      </span>
      <span className="sr-only">{text}</span>
    </span>
  );
}

/** Key React cho 0 / 1 / 2 chấm. */
const DOT_COUNTS: readonly (readonly number[])[] = [[], [0], [0, 1]];

/** Số giản phổ có chấm vẽ bằng CSS (U+0307 / U+0323 của font hệ thống lệch); SR đọc jianpuText. */
export function JianpuDigit({ label }: { label: JianpuLabel }) {
  return (
    <span className="jp">
      <span className="jp-glyph" aria-hidden="true">
        {label.dotsAbove > 0 ? (
          <span className="jp-dots jp-dots-above">
            {DOT_COUNTS[label.dotsAbove].map((i) => (
              <span key={i} className="jp-dot" />
            ))}
          </span>
        ) : null}
        <span className="jp-digit">{label.digit}</span>
        {label.dotsBelow > 0 ? (
          <span className="jp-dots jp-dots-below">
            {DOT_COUNTS[label.dotsBelow].map((i) => (
              <span key={i} className="jp-dot" />
            ))}
          </span>
        ) : null}
      </span>
      <span className="sr-only">{jianpuText(label)}</span>
    </span>
  );
}

/** Modifier cần bấm = của nốt OR của hold run đang chạy. */
export function activeModifiers(
  note: Pick<TimelineNote, 'modifiers'> | null,
  run: Pick<HoldRun, 'modifiers'> | null,
): Modifiers {
  if (!note && !run) return NO_MODS;
  const a = note?.modifiers ?? NO_MODS;
  const b = run?.modifiers ?? NO_MODS;
  return { left: a.left || b.left, right: a.right || b.right, scroll: a.scroll || b.scroll };
}

interface ModItem {
  id: keyof Modifiers;
  button: StringKey;
}

/** Thứ tự như trong game: trái | scroll | phải. */
const MOD_ITEMS: readonly ModItem[] = [
  { id: 'left', button: 'mod.leftMouse' },
  { id: 'scroll', button: 'mod.scrollMouse' },
  { id: 'right', button: 'mod.rightMouse' },
];

export function GameBar(props: GameBarProps) {
  return props.scheme === 'mobile' ? <MobileGameBar {...props} /> : <PcGameBar {...props} />;
}

function PcGameBar({
  note,
  noteId = null,
  run,
  pressed = null,
  labels: labelsProp,
  className,
}: GameBarProps) {
  const t = useT();
  const settingsLabels = useModifierLabels();
  const labels = labelsProp ?? settingsLabels;
  const mods = activeModifiers(note, run);
  const activeKey = note?.key ?? null;
  const tone = note ? tileColorKey(note.modifiers) : 'normal';
  return (
    <div
      className={['game-bar', className].filter(Boolean).join(' ')}
      role="group"
      aria-label={t('player.gameBar')}
      data-scheme="pc"
    >
      <div className="game-bar-keys">
        {NOTE_KEYS.map((k) => {
          const active = k === activeKey;
          const down = pressed?.keys.includes(k) === true;
          const cls = ['gb-key', active && `is-active gb-tone-${tone}`, down && 'is-pressed'];
          return (
            <div
              key={k}
              className={cls.filter(Boolean).join(' ')}
              data-key={k}
              data-pressed={down ? 'true' : undefined}
              aria-current={active ? 'true' : undefined}
            >
              <Degree text={KEY_DEGREE[k]} />
              <kbd
                key={active ? `on:${noteId ?? ''}` : 'off'}
                className={k === ',' ? 'gb-cap gb-cap-comma' : 'gb-cap'}
              >
                {k}
              </kbd>
            </div>
          );
        })}
      </div>
      <div className="game-bar-mods">
        {MOD_ITEMS.map((m, i) => {
          const active = mods[m.id];
          const down = pressed?.[m.id] === true;
          const cls = ['gb-mod', `gb-mod-${m.id}`, active && 'is-active', down && 'is-pressed'];
          return (
            <span key={m.id} className="gb-mod-wrap">
              {i > 0 ? (
                <span className="gb-sep" aria-hidden="true">
                  |
                </span>
              ) : null}
              <span
                className={cls.filter(Boolean).join(' ')}
                data-mod={m.id}
                data-pressed={down ? 'true' : undefined}
                aria-current={active ? 'true' : undefined}
              >
                <span className="gb-mod-name">{labels[m.id]}</span>{' '}
                <span className="gb-mod-button">
                  {t('player.modButton', { button: t(m.button) })}
                </span>
              </span>
            </span>
          );
        })}
      </div>
    </div>
  );
}

/** Practice (bàn phím + chuột PC) → nút mobile tương ứng đang được giữ. */
function pressedButton(b: MobileButton, pressed: PressedKeys | null): boolean {
  if (!pressed || b === 'natural') return false;
  return pressed[b];
}

function MobileGameBar({
  note,
  noteId = null,
  pressed = null,
  mobile = null,
  labels: labelsProp,
  className,
}: GameBarProps) {
  const t = useT();
  const settingsLabels = useModifierLabels();
  const labels = labelsProp ?? settingsLabels;
  const mode = mobile?.mode ?? 0;
  const semitoneOn = mobile?.semitoneOn ?? false;
  const selected = modeButton(mode);
  const cueSet = new Set<MobileButton>(
    mobile?.cueSoon ? mobile.nextCues.map((c) => cueButton(c)) : [],
  );
  const activeKey = note?.key ?? null;
  const tone = note ? tileColorKey(note.modifiers) : 'normal';
  return (
    <div
      className={['game-bar', 'game-bar-mobile', className].filter(Boolean).join(' ')}
      role="group"
      aria-label={t('player.gameBar')}
      data-scheme="mobile"
    >
      <div className="gbm-modes" role="group" aria-label={t('player.mobile.modes')}>
        {MOBILE_BUTTONS.map((b) => {
          const on = b === 'scroll' ? semitoneOn : b === selected;
          const cue = cueSet.has(b);
          const down = pressedButton(b, pressed);
          const cls = [
            'gbm-mode',
            `gbm-mode-${b}`,
            on && 'is-selected',
            cue && 'is-cue',
            down && 'is-pressed',
          ];
          return (
            <span
              key={b}
              className={cls.filter(Boolean).join(' ')}
              data-mode={b}
              data-cue={cue ? 'true' : undefined}
              aria-current={on ? 'true' : undefined}
            >
              <span className="gbm-mode-btn" aria-hidden="true" />
              <span className="gbm-mode-name">{labels[b]}</span>
            </span>
          );
        })}
      </div>
      <div className="game-bar-keys gbm-digits" role="group" aria-label={t('player.mobile.digits')}>
        {NOTE_KEYS.map((k) => {
          const active = k === activeKey;
          const down = pressed?.keys.includes(k) === true;
          const cls = [
            'gb-key',
            'gbm-key',
            active && `is-active gb-tone-${tone}`,
            down && 'is-pressed',
          ];
          return (
            <div
              key={k}
              className={cls.filter(Boolean).join(' ')}
              data-key={k}
              data-pressed={down ? 'true' : undefined}
              aria-current={active ? 'true' : undefined}
            >
              <span key={active ? `on:${noteId ?? ''}` : 'off'} className="gbm-btn">
                <JianpuDigit label={jianpuLabel(k, mode)} />
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

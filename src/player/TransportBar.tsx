import { useId, useRef, useState } from 'react';
import type {
  CSSProperties,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
} from 'react';
import { flushSync } from 'react-dom';
import type { StringKey } from '../i18n/strings';
import { useT } from '../i18n/useT';
import { Button, IconButton } from '../ui/components';
import type { PracticeMode } from '../ui/settings';
import { PLAYER_HOTKEYS, RESERVED_NOTE_CODES } from '../ui/useHotkeys';
import type { LoopState } from './usePlayerEngine';
import { BPM_SLIDER_MAX, BPM_SLIDER_MIN, formatBpm, formatClock } from './usePlayerEngine';
import './player.css';
import './TransportBar.css';

// ---------------------------------------------------------------------------
// Icon (SVG inline, aria-hidden — nhãn nằm ở aria-label / chữ bên cạnh)
// ---------------------------------------------------------------------------

type IconName =
  | 'play'
  | 'pause'
  | 'restart'
  | 'prev'
  | 'next'
  | 'loop'
  | 'pc'
  | 'mobile'
  | 'pip'
  | 'obs'
  | 'share'
  | 'settings'
  | 'soundOn'
  | 'soundOff';

const ICON_PATHS: Readonly<Record<IconName, string>> = {
  play: 'M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z',
  pause: 'M6.5 5h3.5v14H6.5zM14 5h3.5v14H14z',
  restart: 'M12 5V2L7.5 6.5 12 11V7.5a5 5 0 1 1-5 5H4.5a7.5 7.5 0 1 0 7.5-7.5z',
  prev: 'M6 6h2.2v12H6zM9.6 12 18 18V6z',
  next: 'M15.8 6H18v12h-2.2zM6 18l8.4-6L6 6z',
  loop: 'M7 7h9.5V4.5L20.5 8l-4 3.5V9H9v3H7zM17 17H7.5v2.5L3.5 16l4-3.5V15H15v-3h2z',
  // Thanh dọc bên phải của màn chơi (tự vẽ, không lấy icon của game / bộ icon ngoài).
  pc: 'M2 4h20v13H2zM4 6v9h16V6zM8 19h8v2H8z',
  mobile:
    'M7 2h10a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1zM8 4v14h8V4zM11 19h2v1.6h-2z',
  pip: 'M2 4h20v16H2zM4 6v12h16V6zM12 11h7v6h-7z',
  obs: 'M3 6h12v12H3zM15 10.2l6-3.7v11l-6-3.7z',
  share:
    'M18 2a3 3 0 1 1 0 6 3 3 0 0 1 0-6zM6 9a3 3 0 1 1 0 6 3 3 0 0 1 0-6zM18 16a3 3 0 1 1 0 6 3 3 0 0 1 0-6zM7.2 10.6l9.6-5.6 1 1.7-9.6 5.6zM8.2 12.3l9.6 5.6-1 1.7-9.6-5.6z',
  settings:
    'M3 5h9v2H3zM18 5h3v2h-3zM13 3.5h4v5h-4zM3 11h3v2H3zM12 11h9v2h-9zM7 9.5h4v5H7zM3 17h11v2H3zM20 17h1v2h-1zM15 15.5h4v5h-4z',
  // Nút loa: loa + 2 sóng (đang phát giai điệu) / loa + dấu × (tắt tiếng).
  soundOn:
    'M3 9h3.5L11 5v14l-4.5-4H3zM15.39 8.61a4.8 4.8 0 0 1 0 6.78l-1.27-1.27a3 3 0 0 0 0-4.24zM17.66 6.34a8 8 0 0 1 0 11.32l-1.28-1.28a6.2 6.2 0 0 0 0-8.76z',
  soundOff:
    'M3 9h3.5L11 5v14l-4.5-4H3zM21.6 9.81 20.19 8.4 18 10.59 15.81 8.4 14.4 9.81 16.59 12 14.4 14.19 15.81 15.6 18 13.41 20.19 15.6 21.6 14.19 19.41 12z',
};

/** Icon có lỗ (khung viền): tô theo even-odd. */
const EVEN_ODD: ReadonlySet<IconName> = new Set<IconName>(['pc', 'mobile', 'pip']);

export function Icon({ name }: { name: IconName }) {
  return (
    <svg className="player-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        d={ICON_PATHS[name]}
        fill="currentColor"
        fillRule={EVEN_ODD.has(name) ? 'evenodd' : undefined}
      />
    </svg>
  );
}

const PLAYER_HOTKEY_CODES: readonly string[] = Object.values(PLAYER_HOTKEYS);
/**
 * Phím mà <select> mở bằng chuột phải trả lại cho Player: phím tắt + phím nốt (practice mode bỏ
 * qua phím khi focus đang ở <select>).
 */
const RETURNED_CODES: readonly string[] = [...PLAYER_HOTKEY_CODES, ...RESERVED_NOTE_CODES];

/** Chuột kéo xong thì trả focus (để Space/←/→ lại là phím tắt); bàn phím thì giữ focus. */
function blurAfterPointer(e: ReactPointerEvent<HTMLElement>): void {
  e.currentTarget.blur();
}

/** Bỏ focus khỏi `el` rồi phát lại keydown trên window (phím tắt / practice nhận như bình thường). */
function returnKeyToPlayer(e: ReactKeyboardEvent<HTMLElement>): void {
  e.preventDefault();
  const init: KeyboardEventInit = {
    code: e.code,
    key: e.key,
    shiftKey: e.shiftKey,
    repeat: e.repeat,
    bubbles: true,
    cancelable: true,
  };
  e.currentTarget.blur();
  window.dispatchEvent(new KeyboardEvent('keydown', init));
}

const isPlainReturnedKey = (e: ReactKeyboardEvent<HTMLElement>): boolean =>
  !e.ctrlKey && !e.metaKey && !e.altKey && RETURNED_CODES.includes(e.code);

// ---------------------------------------------------------------------------
// SeekBar (progress bar kéo/bấm để seek)
// ---------------------------------------------------------------------------

export interface SeekBarProps {
  /** Vị trí hiện tại (beat). */
  beat: number;
  totalBeats: number;
  /** Tempo đang dùng — để đổi beat → thời gian. */
  bpm: number;
  onSeek: (beat: number) => void;
  /** Phím ←/→ khi thanh đang focus: nhảy dòng (giống phím tắt). */
  onStepLine?: (dir: -1 | 1) => void;
  disabled?: boolean;
  /** Beat bắt đầu các section → khấc trên thanh (trang trí, aria-hidden). Bỏ trống = không khấc. */
  marks?: readonly number[];
}

/** Thanh tiến độ = input range (a11y sẵn); kéo/bấm để seek, hiện thời gian đã phát / tổng. */
export function SeekBar({
  beat,
  totalBeats,
  bpm,
  onSeek,
  onStepLine,
  disabled,
  marks,
}: SeekBarProps) {
  const t = useT();
  const [scrub, setScrub] = useState<number | null>(null);
  const max = totalBeats > 0 ? totalBeats : 1;
  const value = Math.min(max, Math.max(0, scrub ?? beat));
  const spb = bpm > 0 ? 60 / bpm : 0;
  const elapsed = formatClock(value * spb);
  const total = formatClock(totalBeats * spb);
  const pct = (value / max) * 100;
  // Khấc section: bỏ khấc ở đầu bài (trùng mép trái) và ngoài [0, max].
  const notches = (marks ?? []).filter((b) => b > 0 && b < max);

  const onKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (onStepLine && (e.key === 'ArrowLeft' || e.key === 'ArrowDown')) {
      e.preventDefault();
      onStepLine(-1);
    } else if (onStepLine && (e.key === 'ArrowRight' || e.key === 'ArrowUp')) {
      e.preventDefault();
      onStepLine(1);
    } else if (e.key === 'Home') {
      e.preventDefault();
      onSeek(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      onSeek(totalBeats);
    }
  };

  return (
    <div className="seekbar">
      <div className="seekbar-track">
        <input
          type="range"
          className="seekbar-input"
          min={0}
          max={max}
          step="any"
          value={value}
          disabled={disabled}
          aria-label={t('player.progress')}
          aria-valuetext={t('player.time', { elapsed, total })}
          style={{ '--seek-pct': `${pct}%`, '--seek-frac': value / max } as CSSProperties}
          onPointerDown={() => setScrub(value)}
          onPointerUp={(e) => {
            setScrub(null);
            blurAfterPointer(e);
          }}
          onPointerCancel={() => setScrub(null)}
          onChange={(e) => {
            const v = Number(e.currentTarget.value);
            if (!Number.isFinite(v)) return;
            if (scrub !== null) setScrub(v);
            onSeek(v);
          }}
          onKeyDown={onKeyDown}
        />
        {notches.length > 0 ? (
          <span className="seekbar-marks" aria-hidden="true">
            {notches.map((b) => (
              <span
                key={b}
                className="seekbar-mark"
                style={{ '--mark': b / max } as CSSProperties}
              />
            ))}
          </span>
        ) : null}
      </div>
      <span className="seekbar-time" aria-hidden="true">
        {t('player.time', { elapsed, total })}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// TransportBar
// ---------------------------------------------------------------------------

export interface SectionOption {
  index: number;
  name: string;
}

export interface TransportBarProps {
  playing: boolean;
  /** Bài không có nốt → khóa các nút phát. */
  disabled?: boolean;
  onTogglePlay: () => void;
  onRestart: () => void;
  onPrevLine: () => void;
  onNextLine: () => void;
  /** Section không rỗng. */
  sections: readonly SectionOption[];
  sectionIndex: number;
  onSection: (index: number) => void;
  loop: LoopState | null;
  onLoop: () => void;
  bpm: number;
  songBpm: number;
  bpmOverridden: boolean;
  onBpm: (bpm: number) => void;
  onBpmReset: () => void;
  lookahead: number;
  onLookahead: (beats: number) => void;
  /**
   * Giai điệu mẫu đang bật (settings.audioEnabled): trạng thái của nút loa (`onSound`) + có hiện nút "Nghe
   * giai điệu mẫu" khi luyện tập hay không. Không có metronome / tiếng click trên thanh này (Cài đặt → Âm
   * thanh).
   */
  audioEnabled: boolean;
  /**
   * Nút loa cạnh Tempo (trước deploy, chủ dự án duyệt): đang tắt → nơi gọi mở hộp cảnh báo bản quyền dùng
   * chung với Cài đặt (src/ui/MelodyConfirm.tsx); đang bật → tắt ngay. Bỏ trống = không có nút.
   */
  onSound?: () => void;
  /**
   * Mở danh sách phím tắt (hộp thoại). Màn rộng có cột phím tắt bên trái → CSS ẩn nút "?"
   * (`.transport-help`, player.css).
   */
  onHelp: () => void;
  /** Kiểu điều khiển Mobile: luyện tập chỉ bằng chạm bàn nút (gợi ý của nút Luyện tập đổi theo). */
  touchPractice?: boolean;
  /** Practice mode (spec §6). Bỏ trống `onPractice` = ẩn nhóm luyện tập. */
  practice?: boolean;
  onPractice?: (on: boolean) => void;
  practiceMode?: PracticeMode;
  onPracticeMode?: (mode: PracticeMode) => void;
  /** Nghe giai điệu mẫu khi luyện tập (chỉ hiện khi `audioEnabled`). */
  guide?: boolean;
  onGuide?: (on: boolean) => void;
}

const PRACTICE_MODES: readonly {
  mode: PracticeMode;
  label: StringKey;
  hint: StringKey;
}[] = [
  { mode: 'wait', label: 'practice.mode.wait', hint: 'practice.mode.waitHint' },
  { mode: 'score', label: 'practice.mode.score', hint: 'practice.mode.scoreHint' },
];

/**
 * Thanh điều khiển (spec §5 "Transport"). Thuần props; PlayerView nối với engine.
 * Góp ý 2026-10-16: "Đếm vào" và "Đếm ngược" chỉ còn ở Cài đặt → Phát bài (không nằm trên thanh này);
 * Lookahead thì ngược lại — chỉ còn ở đây.
 */
export function TransportBar(p: TransportBarProps) {
  const t = useT();
  const sectionId = useId();
  const bpmId = useId();
  const lookId = useId();
  const loopHintId = useId();
  const soundStateId = useId();
  // <select> section là nút "nhảy tới": mở bằng chuột thì giá trị tạm là '' (option ẩn mang tên
  // section hiện tại) để chọn lại CHÍNH section đang ở (vd. tập lại điệp khúc) vẫn có `change`.
  // Focus đến từ chuột → phím tắt Player không bị <select> nuốt (D-033).
  const [pickMode, setPickMode] = useState(false);
  const selectByPointer = useRef(false);
  const endPick = () => {
    selectByPointer.current = false;
    setPickMode(false);
  };
  const currentSection = p.sections.find((s) => s.index === p.sectionIndex)?.name ?? '—';

  const loopState = p.loop === null ? 'off' : p.loop.b === null ? 'a' : 'ab';
  const loopHint =
    p.loop === null
      ? t('player.loopOffHint')
      : p.loop.b === null
        ? t('player.loopAHint', { a: p.loop.a + 1 })
        : t('player.loopABHint', { a: p.loop.a + 1, b: p.loop.b + 1 });
  const playLabel = p.playing ? t('player.pause') : t('player.play');
  // Nút loa: tên đọc CỐ ĐỊNH + aria-pressed = trạng thái (D-424, review A11Y-1); tooltip = việc sẽ làm khi bấm.
  const soundAction = p.audioEnabled ? t('player.soundOff') : t('player.soundOn');
  const sliderBpm = Math.min(BPM_SLIDER_MAX, Math.max(BPM_SLIDER_MIN, Math.round(p.bpm)));

  return (
    <div className="transport" role="group" aria-label={t('player.transport')}>
      <div className="transport-group">
        <Button
          variant="primary"
          className="transport-play"
          aria-label={playLabel}
          title={`${playLabel} (${t('shortcuts.key.space')})`}
          aria-keyshortcuts={PLAYER_HOTKEYS.playPause}
          data-playing={p.playing ? 'true' : 'false'}
          disabled={p.disabled}
          onClick={p.onTogglePlay}
        >
          <Icon name={p.playing ? 'pause' : 'play'} />
          <span className="transport-text">{playLabel}</span>
        </Button>
        <IconButton
          label={t('player.restartAria')}
          title={`${t('player.restartAria')} (R)`}
          aria-keyshortcuts="R"
          disabled={p.disabled}
          onClick={p.onRestart}
        >
          <Icon name="restart" />
        </IconButton>
        <IconButton
          label={t('player.prevLine')}
          title={`${t('player.prevLine')} (←)`}
          aria-keyshortcuts="ArrowLeft"
          disabled={p.disabled}
          onClick={p.onPrevLine}
        >
          <Icon name="prev" />
        </IconButton>
        <IconButton
          label={t('player.nextLine')}
          title={`${t('player.nextLine')} (→)`}
          aria-keyshortcuts="ArrowRight"
          disabled={p.disabled}
          onClick={p.onNextLine}
        >
          <Icon name="next" />
        </IconButton>
      </div>

      <div className="transport-group">
        <label htmlFor={sectionId} className="sr-only">
          {t('player.sectionJump')}
        </label>
        <select
          id={sectionId}
          className="transport-section"
          value={pickMode || p.sectionIndex < 0 ? '' : String(p.sectionIndex)}
          disabled={p.disabled || p.sections.length === 0}
          title={t('player.sectionJump')}
          onPointerDown={() => {
            selectByPointer.current = true;
            // Cập nhật DOM ngay, trước khi trình duyệt mở danh sách (default của mousedown).
            if (!pickMode) flushSync(() => setPickMode(true));
          }}
          onKeyDown={(e) => {
            if (selectByPointer.current && isPlainReturnedKey(e)) {
              // Mở bằng chuột rồi đóng mà không chọn: focus còn kẹt ở <select> → trả phím tắt
              // (Space, ←/→, L, R, [ ]) và phím nốt (practice) cho Player thay vì để <select> nuốt.
              returnKeyToPlayer(e);
              return;
            }
            // Bàn phím điều khiển <select> như bình thường (mũi tên đổi section tương đối).
            if (selectByPointer.current || pickMode) flushSync(endPick);
          }}
          onChange={(e) => {
            const raw = e.currentTarget.value;
            const v = Number(raw);
            if (raw !== '' && Number.isInteger(v)) p.onSection(v);
            if (selectByPointer.current) e.currentTarget.blur();
            endPick();
          }}
          onBlur={endPick}
        >
          {pickMode || p.sectionIndex < 0 ? (
            <option value="" disabled={pickMode} hidden={pickMode}>
              {pickMode ? currentSection : '—'}
            </option>
          ) : null}
          {p.sections.map((s) => (
            <option key={s.index} value={String(s.index)}>
              {s.name}
            </option>
          ))}
        </select>
        <Button
          className="transport-loop"
          aria-pressed={p.loop !== null}
          aria-keyshortcuts="L"
          aria-describedby={loopHintId}
          title={`${loopHint} (L)`}
          data-state={loopState}
          disabled={p.disabled}
          onClick={p.onLoop}
        >
          <Icon name="loop" />
          <span>{t('player.loop')}</span>
          {loopState !== 'off' ? (
            <span className="transport-loop-state">
              {loopState === 'a' ? t('player.loopA') : t('player.loopAB')}
            </span>
          ) : null}
        </Button>
        <span id={loopHintId} className="sr-only">
          {loopHint}
        </span>
      </div>

      {p.onPractice ? (
        <div className="transport-group transport-practice">
          <Button
            size="sm"
            className="transport-practice-toggle"
            aria-pressed={p.practice === true}
            title={t(p.touchPractice ? 'practice.toggleHintTouch' : 'practice.toggleHint')}
            disabled={p.disabled}
            onClick={() => p.onPractice?.(!p.practice)}
          >
            {t('practice.toggle')}
          </Button>
          {p.practice ? (
            <>
              <div className="transport-segmented" role="group" aria-label={t('practice.mode')}>
                {PRACTICE_MODES.map((m) => (
                  <Button
                    key={m.mode}
                    size="sm"
                    aria-pressed={p.practiceMode === m.mode}
                    title={t(m.hint)}
                    onClick={() => p.onPracticeMode?.(m.mode)}
                  >
                    {t(m.label)}
                  </Button>
                ))}
              </div>
              {p.audioEnabled ? (
                <Button
                  size="sm"
                  aria-pressed={p.guide === true}
                  title={t('practice.guideHint')}
                  onClick={() => p.onGuide?.(!p.guide)}
                >
                  {t('practice.guide')}
                </Button>
              ) : null}
            </>
          ) : null}
        </div>
      ) : null}

      {p.onSound ? (
        <div className="transport-group transport-sound">
          {/* Không khóa khi bài rỗng: đây là một setting (cùng công tắc với Cài đặt → Âm thanh). Bấm bằng
              chuột rồi nhấn Space vẫn là phát / dừng; chỉ khi Tab tới nút thì Space mới bấm nút (D-345). */}
          <IconButton
            className="transport-sound-toggle"
            label={t('player.sound')}
            title={soundAction}
            aria-pressed={p.audioEnabled}
            aria-describedby={soundStateId}
            aria-haspopup={p.audioEnabled ? undefined : 'dialog'}
            data-sound={p.audioEnabled ? 'on' : 'off'}
            onClick={p.onSound}
          >
            <Icon name={p.audioEnabled ? 'soundOn' : 'soundOff'} />
          </IconButton>
          <span id={soundStateId} className="sr-only">
            {t(p.audioEnabled ? 'player.soundStateOn' : 'player.soundStateOff')}
          </span>
        </div>
      ) : null}

      <div className="transport-group transport-slider">
        <label htmlFor={bpmId} className="transport-slider-label">
          <span>{t('player.tempo')}</span>
          <output
            htmlFor={bpmId}
            className={p.bpmOverridden ? 'transport-value is-override' : 'transport-value'}
          >
            {t('player.bpmValue', { n: formatBpm(p.bpm) })}
          </output>
        </label>
        <input
          id={bpmId}
          type="range"
          min={BPM_SLIDER_MIN}
          max={BPM_SLIDER_MAX}
          step={1}
          value={sliderBpm}
          aria-keyshortcuts="BracketLeft BracketRight"
          aria-valuetext={t('player.bpmValue', { n: formatBpm(p.bpm) })}
          onChange={(e) => p.onBpm(Number(e.currentTarget.value))}
          onPointerUp={blurAfterPointer}
        />
        <IconButton
          size="sm"
          variant="ghost"
          label={t('player.bpmReset', { n: formatBpm(p.songBpm) })}
          disabled={!p.bpmOverridden}
          onClick={p.onBpmReset}
        >
          <span aria-hidden="true">↺</span>
        </IconButton>
      </div>

      <div className="transport-group transport-slider">
        <label htmlFor={lookId} className="transport-slider-label">
          <span>{t('player.lookahead')}</span>
          <output htmlFor={lookId} className="transport-value">
            {t('player.lookaheadValue', { n: p.lookahead })}
          </output>
        </label>
        <input
          id={lookId}
          type="range"
          min={4}
          max={12}
          step={1}
          value={p.lookahead}
          aria-valuetext={t('player.lookaheadValue', { n: p.lookahead })}
          onChange={(e) => p.onLookahead(Number(e.currentTarget.value))}
          onPointerUp={blurAfterPointer}
        />
      </div>

      <div className="transport-group transport-help">
        <IconButton
          size="sm"
          variant="ghost"
          label={t('player.help')}
          aria-haspopup="dialog"
          onClick={p.onHelp}
        >
          <span aria-hidden="true">?</span>
        </IconButton>
      </div>
    </div>
  );
}

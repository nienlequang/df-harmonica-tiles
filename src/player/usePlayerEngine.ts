/**
 * Bộ máy Player (spec §5 "Transport", "Clock", "Audio"; §6 "Practice mode"): nối Transport +
 * TilesRenderer + AudioScheduler + vòng requestAnimationFrame + practice mode. Không phụ thuộc
 * React — `usePlayerEngine` tạo một engine cho mỗi Player đang mount; React chỉ nhận state rời rạc
 * (nốt / run / dòng / section đổi, tiến độ ~10 Hz, điểm practice) qua `usePlayerState`, không
 * re-render 60 Hz.
 *
 * Clock: mặc định performance.now; bật âm thanh và mở khóa được AudioContext (trong user gesture
 * Play/Space) thì chuyển sang audio clock (master) và chạy scheduler. Bị chặn → vẫn chạy hình.
 * - Trang đã có user activation (vd. vừa bấm bài ở Library) → tạo AudioContext sẵn lúc rảnh ngay
 *   sau khi mount (constructor của Chromium chặn main thread 0.5–1 s; đừng để nó rơi vào phím Play).
 * - Play khi AudioContext chưa chạy: chờ unlock (≤ UNLOCK_TIMEOUT_MS = 3 s, iOS lần đầu có thể chậm — D-422) rồi
 *   mới bắt đầu đoạn phát, thẳng trên audio clock — bắt đầu trên performance clock rồi đổi clock sẽ làm mất
 *   click/nốt đầu tiên. Đã thất bại một lần thì Play phát hình ngay, tiếng gắn vào khi mở khóa được.
 * - iPhone / iPad: mỗi cú chạm cần tiếng (Phát, "Tôi hiểu, bật" của nút loa, chạm bàn nút khi bật tiếng phản hồi)
 *   giữ phiên "playback" của AudioEngine (kêu cả khi gạt nút im lặng — src/audio/playbackSession.ts, D-421); tắt
 *   hết tiếng hoặc detach (rời màn chơi) thì trả. Âm thanh tắt (mặc định) → không đụng tới gì.
 * - Context không chạy sau khi mở khóa (bị chặn, 'suspended' / 'interrupted' do cuộc gọi / Siri / app khác): hình
 *   vẫn chạy trên performance clock; cú chạm / phím kế tiếp ở bất cứ đâu thử resume() lại (không bỏ cuộc cả phiên),
 *   context tự chạy lại thì gắn lại audio clock; câu nhắc thân thiện hiện MỘT lần mỗi lần tải trang (D-422).
 *
 * Đếm ngược trước khi phát (`settings.startDelaySec`, chỉnh ở Cài đặt → Phát bài): bấm Play / Restart →
 * đếm N…1 giây (ô đứng yên, `state.countdown` → số lớn ở DOM) rồi mới phát để streamer kịp Alt-Tab vào
 * game. Space / Esc hủy. Đếm vào (nếu bật) chạy SAU đó và chỉ là đoạn ô rơi dẫn vào — không
 * có số đếm nào (góp ý 2026-10-16: không đếm hai lần); `state.countdown` đã về null lúc đó. Từ v1.0.1 đoạn dẫn
 * vào ngắn lại: nốt đầu đi 65 % quãng của "1 ô nhịp + khoảng lặng trước nốt" (leadIn.ts).
 * Trong lúc đếm ngược (và lúc chờ mở khóa âm thanh) canvas vẽ ĐÚNG frame đầu của đếm vào (`preRoll`: ô
 * đứng yên ở vị trí đầu ô nhịp đếm vào) — hết đếm ngược ô chỉ việc chạy, không nhảy lùi một ô nhịp
 * (vòng R7: trước đây ô thấy lúc đếm ngược biến mất khỏi đỉnh, Quốc ca trống làn ~0.56 s → "khựng").
 * Bước khung đứng yên ↔ khung pre-roll (bấm Phát, hủy đếm ngược, đếm ngược = Tắt mà đếm vào bật) không nhảy
 * mà trượt mượt trong PRE_ROLL_GLIDE_SEC (preRollGlide.ts, D-389).
 *
 * Practice mode: input (phím thật, chuột trên stage, phím thay thế, MIDI) → PracticeSession.
 * Thời điểm bấm (event.timeStamp, trục performance.now) đổi sang beat trên clock của transport.
 * - Chấm điểm: mỗi frame `tick` sinh miss; hết bài → nốt còn lại là miss → bảng kết quả.
 * - Chờ: playhead chạm nốt chưa bấm → giữ transport đúng tại startBeat của nốt (pause + seek), tile
 *   nhấp nháy; bấm đúng → phát tiếp ngay từ đó.
 * Giai điệu mẫu tắt mặc định khi luyện tập (scheduler nhận timeline không có nốt; click vẫn chạy).
 *
 * Âm thanh mặc định TẮT (SPEC 2026-10-14): nốt giai điệu chỉ phát khi `settings.audioEnabled`, click
 * đếm vào / metronome chỉ khi `settings.clickSound`; AudioContext chỉ mở khi một trong hai bật (hoặc
 * tiếng phản hồi practice). Tắt cả hai → đếm vào chỉ bằng hình, clock là performance.now.
 *
 * Kiểu điều khiển Mobile: `state.mobile` = chế độ quãng / Nửa Cung tại hit line + lần chạm kế tiếp
 * (kế hoạch từ core/mobile, cache trong mobilePlan.ts) cho game bar và banner.
 *
 * `instantStart` (màn chơi thử ở Home): Play / Restart phát ngay — bỏ qua đếm vào và đếm ngược.
 *
 * `hostWindow` ("Cửa sổ nổi", src/pip): canvas nằm trong cửa sổ khác → rAF, timer đếm ngược,
 * ResizeObserver, matchMedia/devicePixelRatio, idle callback, phím practice và nhịp "bơm" scheduler
 * đều dùng của cửa sổ đó (tab gốc thường bị ẩn sau game nên rAF / timer của nó đứng hoặc bị bóp).
 * Không truyền = window chính, hành vi y như trước.
 */
import { useEffect, useState, useSyncExternalStore } from 'react';
import type { RefObject } from 'react';
import { getAudioEngine, hasStickyActivation, isAudioSupported } from '../audio/engine';
import type { AudioEngine } from '../audio/engine';
import { AudioScheduler } from '../audio/scheduler';
import type { SchedulerOptions } from '../audio/scheduler';
import { NOTE_KEYS, noteMidi } from '../core/keys';
import type { KeyChoice } from '../core/keys';
import type { MobilePlan } from '../core/mobile';
import {
  lineIndexAt,
  nextLineStart,
  noteIndexAt,
  prevLineStart,
  runIndexAt,
  sectionIndexAt,
} from '../core/timelineQuery';
import type { NoteKey, Timeline, TimelineNote } from '../core/types';
import { tNow } from '../i18n/useT';
import { mapMidiNote, midiMapOptionsFromSettings, transposeMidi } from '../midi/mapping';
import type { LiveMidiEvent } from '../midi/types';
import { getMidiInputManager, isWebMidiSupported } from '../midi/webmidi';
import type { MidiInputManager } from '../midi/webmidi';
import { isAppleMobile } from '../pip/phonePref';
import { modifierLabels } from '../ui/modLabels';
import { useSettings } from '../ui/settings';
import type { PracticeMode, Settings } from '../ui/settings';
import { toast } from '../ui/toast';
import { createAudioClock, createPerformanceClock } from './clock';
import { warmDomEffects, warmTileGlow } from './glowWarmup';
import { leadInBeats, playStartBeat } from './leadIn';
import { MobileEntryTracker, mobilePlanFor, mobileUiAt } from './mobilePlan';
import type { MobileUiState } from './mobilePlan';
import { PracticeSession, keyboardPress } from './practice';
import type { LoopWrap } from './practice';
import type { Grade, Judgement, PracticeInputEvent, PracticeScore } from './practice.types';
import { attachPracticeInput } from './practiceInput';
import { PreRollGlide } from './preRollGlide';
import type { DrawMode } from './preRollGlide';
import { TilesRenderer } from './renderer';
import type { RendererOptions } from './renderer';
import { Transport, wrapEndOf } from './transport';
import type { BeatRange, Clock, TransportSnapshot } from './transport.types';

/** Slider BPM override (spec: 40–200, phím [ ] bước 2). */
export const BPM_SLIDER_MIN = 40;
export const BPM_SLIDER_MAX = 200;
export const BPM_STEP = 2;
/** Chu kỳ tối thiểu đẩy tiến độ (beat) lên React khi đang phát. */
export const PROGRESS_INTERVAL_MS = 100;
/** ← trong khoảng này (giây) sau đầu dòng thì về dòng trước thay vì đầu dòng hiện tại. */
export const PREV_LINE_GRACE_SEC = 0.6;
/** Bấm xong phát tiếp từ ngay sau đầu nốt (không phát lại nốt vừa chờ). */
const RESUME_EPS_BEATS = 1e-6;
/** timeStamp của input cũ hơn mức này (hoặc ở tương lai) → coi như trục khác, dùng "bây giờ". */
const MAX_INPUT_AGE_SEC = 1;
/** Độ dài tiếng phản hồi khi bấm (giây). */
const FEEDBACK_SEC = 0.35;
/** Chế độ chờ + nghe giai điệu mẫu: phát nốt đang chờ tối đa chừng này (giây). */
const WAIT_PREVIEW_MAX_SEC = 1.2;
/**
 * Cú chạm / phím "kế tiếp" thử mở khóa lại âm thanh sau khi bị chặn / bị gián đoạn (D-422): touchend / pointerup /
 * click đều là user gesture của Safari iOS (pointerdown của ngón tay thì không), keydown cho bàn phím.
 */
export const AUDIO_RETRY_EVENTS = ['pointerup', 'touchend', 'click', 'keydown'] as const;

/** Câu nhắc "chưa bật được âm thanh" đã hiện trong trang này chưa — một lần mỗi lần tải trang, không spam (D-422). */
let audioHintShown = false;

/** Chỉ cho test: cho câu nhắc "chưa bật được âm thanh" hiện lại. */
export function resetAudioHintForTests(): void {
  audioHintShown = false;
}

/**
 * Câu nhắc "chưa bật được âm thanh" — MỘT lần mỗi lần tải trang (D-422); iPhone / iPad nhắc âm lượng, chế độ tập
 * trung, nút gạt bên hông. Chữ không bảo bấm nút loa (đang bật thì nút loa là TẮT — D-426).
 */
function showAudioHint(): void {
  if (audioHintShown) return;
  audioHintShown = true;
  toast(
    tNow(isAppleMobile() ? 'player.audioBlockedToastApple' : 'player.audioBlockedToast'),
    'error',
  );
}

export type AudioStatus = 'off' | 'idle' | 'starting' | 'on' | 'blocked' | 'unsupported';

/** Loop A-B theo dòng: `b === null` = mới đặt A (chưa lặp). Index vào timeline.lines. */
export interface LoopState {
  a: number;
  b: number | null;
}

/**
 * Kết quả lần bấm gần nhất (để nháy PERFECT / GOOD / MISS / SAI gần hit line). 'range' = nốt MIDI
 * ngoài tầm harmonica: bỏ qua (không tính sai), chỉ báo nhẹ.
 */
export interface PracticeFlash {
  kind: Grade | 'wrong' | 'range';
  /** Tăng mỗi lần → React remount hiệu ứng kể cả khi cùng loại. */
  seq: number;
  deltaMs: number | null;
  /**
   * Cột (phím) để hiện kết quả cạnh nút (bàn chạm Mobile): nốt được chấm (perfect / good / miss) hoặc
   * phím vừa bấm sai; null khi không rõ (MIDI ngoài tầm, MIDI chỉ theo pitch class…).
   */
  key?: NoteKey | null;
  /**
   * Bấm sai nhưng đúng PHÍM của nốt lẽ ra phải bấm (chỉ chế độ / modifier sai) — bàn chạm Mobile ghi "SAI CHẾ
   * ĐỘ" thay cho "SAI PHÍM". Chỉ có khi `kind === 'wrong'`.
   */
  rightKey?: boolean;
}

/**
 * Kết quả một input practice cho chính nguồn input (bàn chạm Mobile phản hồi ngay tại nút). null =
 * input không được xét (practice tắt, không phải lần bấm, ngoài lượt chơi).
 */
export interface PracticeInputOutcome {
  kind: Grade | 'wrong' | 'range' | 'none';
  /**
   * Bấm sai: nốt lẽ ra phải bấm lúc đó (chờ → nốt mục tiêu; chấm điểm → nốt chưa chấm gần nhất trong
   * cửa sổ good) — để chỉ nút chế độ cần chạm; null nếu không có.
   */
  expected: TimelineNote | null;
}

/**
 * MIDI trong practice: 'off' = không dùng (chưa bật trong Cài đặt / chưa chọn thiết bị / trình
 * duyệt không có Web MIDI); 'pending' = đang xin quyền; 'listening' = đang nghe thiết bị đã chọn;
 * 'denied' = không được cấp quyền; 'disconnected' = có quyền nhưng thiết bị đã chọn không cắm.
 */
export type PracticeMidiStatus = 'off' | 'pending' | 'listening' | 'denied' | 'disconnected';

/** State practice cho React (null khi tắt practice). Đổi theo sự kiện, không theo frame. */
export interface PracticeUiState {
  mode: PracticeMode;
  /** Chế độ chờ: transport đang đứng ở nốt chờ người chơi bấm. */
  waiting: boolean;
  score: PracticeScore;
  /** Số lần bấm sai từ lần chơi gần nhất. */
  wrong: number;
  last: PracticeFlash | null;
  /** Hết bài → bảng kết quả (null khi chưa xong / đã đóng). */
  results: PracticeScore | null;
  /** Nghe giai điệu mẫu (mặc định tắt khi luyện tập). */
  guide: boolean;
  /** Trạng thái thật của thiết bị MIDI đã chọn trong Cài đặt (quyền, đang cắm). */
  midi: PracticeMidiStatus;
  /**
   * Nốt chưa chấm kế tiếp (index trong timeline.notes, -1 = hết) — bàn chạm Mobile nhắc nút chế độ cần
   * chạm trước nốt đó.
   */
  next: number;
}

/** Phím / modifier người chơi đang giữ (game bar sáng kiểu "đang bấm"). */
export interface PressedInput {
  keys: readonly NoteKey[];
  left: boolean;
  right: boolean;
  scroll: boolean;
}

export const NO_PRESSED: Readonly<PressedInput> = Object.freeze({
  keys: Object.freeze([]) as readonly NoteKey[],
  left: false,
  right: false,
  scroll: false,
});

export interface PlayerUiState {
  /** Đang phát — tính cả lúc chờ unlock âm thanh, đếm ngược trước khi phát và chờ bấm (practice). */
  playing: boolean;
  /** Đang trong ô nhịp đếm vào. */
  countingIn: boolean;
  /**
   * Vị trí hiển thị (beat) kẹp [0, totalBeats]; trong lúc đếm vào đứng ở điểm bắt đầu.
   * Khi đang phát chỉ cập nhật ~10 Hz.
   */
  beat: number;
  /** Tempo đang dùng (= override ?? bpm của bài, đã kẹp theo transport). */
  bpm: number;
  bpmOverride: number | null;
  /** Nốt đang ở hit line (-1 nếu không có). Lúc đếm vào: nốt tại điểm bắt đầu. */
  noteIndex: number;
  /** Hold run đang cắt qua hit line (-1 nếu không có). */
  runIndex: number;
  lineIndex: number;
  sectionIndex: number;
  loop: LoopState | null;
  audio: AudioStatus;
  /** Số giây còn lại của đếm ngược trước khi phát; null = không đếm. */
  countdown: number | null;
  /** null = practice tắt. */
  practice: PracticeUiState | null;
  pressed: PressedInput;
  /** Đã phát hết bài và đang đứng ở cuối (không phát, không đếm ngược / chờ). */
  ended: boolean;
  /** Kiểu điều khiển Mobile: chế độ tại hit line + lần chạm kế; null ở kiểu PC. */
  mobile: MobileUiState | null;
}

export interface PlayerEngineOptions {
  /** Beat bắt đầu (vd. `?line=` từ editor). */
  initialBeat?: number;
  /** Clock khi không dùng audio (mặc định performance.now) — test truyền ManualClock. */
  clock?: Clock;
  /** Phát ngay khi bấm Play / Restart: bỏ đếm vào và đếm ngược (màn chơi thử). */
  instantStart?: boolean;
  /**
   * Cửa sổ chủ của canvas (vd. "Cửa sổ nổi" Document Picture-in-Picture): vòng render dùng
   * requestAnimationFrame của CHÍNH cửa sổ này (tab gốc thường bị ẩn sau game → rAF của nó đứng),
   * cùng timer đếm ngược, ResizeObserver, matchMedia / devicePixelRatio, requestIdleCallback và
   * listener bàn phím practice; scheduler âm thanh được "bơm" thêm bằng interval của cửa sổ này.
   * Bỏ trống = window chính (hành vi cũ, không đổi gì).
   */
  hostWindow?: Window;
  /**
   * Option canvas cố định đè lên phần lấy từ settings (vd. bố cục "khớp bảng phím game":
   * `lanePadding: 'none'`, hit line sát đáy). Bỏ trống = chỉ theo settings.
   */
  rendererOptions?: Partial<RendererOptions>;
  /**
   * Màn chơi có bàn nút kiểu game Mobile (PlayerView, SPEC Phase 4m): khi Kiểu điều khiển = Mobile,
   * canvas dùng `lanePadding: 'pad'` (8 cột thẳng tâm 8 nút số, hit line ở đỉnh nút) — thắng cả
   * `lanePadding` của `rendererOptions`; kiểu PC dùng `lanePadding` đó (cửa sổ nổi: 'none'), không có thì
   * 'normal'. Theo setting trực tiếp (đổi PC ↔ Mobile không cần mount lại). Option khác của
   * `rendererOptions` vẫn đè lên.
   */
  mobilePad?: boolean;
}

/** Số frame đứng yên đầu tiên (mỗi lần attach) vẽ kèm hình làm nóng glow (glowWarmup.ts). */
export const GLOW_WARMUP_FRAMES = 6;

/** Chu kỳ "bơm" scheduler bằng interval của cửa sổ chủ (= TICK_MS của AudioScheduler). */
export const HOST_PUMP_MS = 25;

/** Window kèm constructor (ResizeObserver…) — `Window` của lib DOM không khai báo chúng. */
type HostWindow = Window & typeof globalThis;
type TimerId = ReturnType<typeof setTimeout>;

export interface PlayerAttachTargets {
  canvas: HTMLCanvasElement | null;
  /**
   * Nhận CSS var `--lane-left` / `--lane-right` (px) để game bar căn theo lane; cũng là vùng
   * nhận chuột của practice mode.
   */
  stage?: HTMLElement | null;
}

/** Phần settings ảnh hưởng tới canvas. */
export function rendererOptionsFrom(s: Settings): Partial<RendererOptions> {
  return {
    theme: s.theme,
    language: s.language,
    tileScale: s.tileScale,
    subLabel: s.subLabel,
    lookahead: s.lookahead,
    scheme: s.controlScheme,
    mobileSemitone: s.mobileSemitone,
    modLabels: modifierLabels(s.language, s.labelOverrides),
  };
}

/** Có tiếng nào cần AudioContext không: giai điệu mẫu hoặc click (SPEC "Âm thanh mặc định TẮT"). */
export function wantsAudio(s: Pick<Settings, 'audioEnabled' | 'clickSound'>): boolean {
  return s.audioEnabled || s.clickSound;
}

/** Giây → "m:ss" (làm tròn xuống, để thời gian đã phát không nhảy trước). */
export function formatClock(seconds: number): string {
  const total = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds + 1e-6) : 0;
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** Hiển thị bpm gọn: 76 → "76", 76.5 → "76.5". */
export function formatBpm(bpm: number): string {
  return String(Math.round(bpm * 100) / 100);
}

/** Beat bắt đầu của dòng `?line=<index>` (0-based theo timeline.lines); sai → 0. */
export function lineStartFromParam(tl: Timeline, param: string | null): number {
  if (param === null || !/^\d+$/.test(param.trim())) return 0;
  const line = tl.lines[Number(param.trim())];
  return line ? line.startBeat : 0;
}

const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v));

const nowMs = (): number =>
  typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();

function initialAudioStatus(enabled: boolean): AudioStatus {
  if (!enabled) return 'off';
  return isAudioSupported() ? 'idle' : 'unsupported';
}

function applyAudioSettings(eng: AudioEngine, s: Settings): void {
  eng.setMusicVolume(s.musicVolume);
  eng.setClickVolume(s.clickVolume);
  eng.setTimbre(s.timbre);
}

const samePressed = (a: PressedInput, b: PressedInput): boolean =>
  a.left === b.left &&
  a.right === b.right &&
  a.scroll === b.scroll &&
  a.keys.length === b.keys.length &&
  a.keys.every((k, i) => b.keys[i] === k);

/**
 * Một Player đang mount. Vòng đời: `new` (thuần, không side effect) → `attach()` (renderer, rAF,
 * listener, audio) → `detach()` dọn sạch. attach lại được sau detach (StrictMode mount 2 lần).
 */
export class PlayerEngine {
  readonly transport: Transport;
  private tl: Timeline;
  private songBpm: number;
  private bpmOverride: number | null = null;
  private readonly baseClock: Clock;
  private state: PlayerUiState;
  private readonly listeners = new Set<() => void>();
  private attached = false;
  private unsubs: (() => void)[] = [];
  /** > 0 khi engine tự gọi transport (play/pause/seek) — listener chỉ phân loại thay đổi từ ngoài. */
  private internal = 0;
  private seenEpoch = -1;
  /** Transport đang phát ở thông báo trước (để nhận ra "vừa hết bài", không nhầm khi đứng ở cuối). */
  private seenPlaying = false;
  /** Loop ở thông báo trước (đổi loop → bỏ phần practice vắt qua loop wrap). */
  private seenLoop: BeatRange | null = null;

  // Canvas
  private renderer: TilesRenderer | null = null;
  private canvas: HTMLCanvasElement | null = null;
  /** Số frame đứng yên đã vẽ kèm hình làm nóng glow (glowWarmup.ts) từ lần attach. */
  private glowWarmups = 0;
  /** Gỡ keycap / banner làm nóng (glowWarmup.ts) nếu còn. */
  private cancelDomWarm: (() => void) | null = null;
  private stage: HTMLElement | null = null;
  private surface: HTMLElement | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private windowResize: (() => void) | null = null;
  private laneLeft = Number.NaN;
  private laneRight = Number.NaN;

  // Frame loop
  private rafId: number | null = null;
  private rafIsTimeout = false;
  private lastProgressAt = -Infinity;

  // Audio
  private scheduler: AudioScheduler | null = null;
  private schedulerOwner: AudioEngine | null = null;
  private audioCtx: AudioContext | null = null;
  private unsubAudio: (() => void) | null = null;
  private audioToken = 0;
  /** Lần unlock gần nhất thất bại → Play không chờ unlock nữa (tránh chờ tới 3 s mỗi lần). */
  private audioFailed = false;
  /** AudioEngine mà engine này đang giữ phiên "playback" (iPhone — nút gạt im lặng); null = không giữ. */
  private playbackEngine: AudioEngine | null = null;
  /** Gỡ listener "cú chạm kế tiếp thử mở khóa lại" (null = không chờ). */
  private retryOff: (() => void) | null = null;
  /** Gỡ listener chờ context tự chạy lại sau khi bị gián đoạn (null = không chờ). */
  private unsubAudioWatch: (() => void) | null = null;
  /** Đã bấm Play, đang chờ unlock AudioContext để bắt đầu trên audio clock. */
  private playPending = false;
  /** Hủy lịch tạo AudioContext sẵn (idle callback / timeout). */
  private cancelWarm: (() => void) | null = null;
  /** Timeline không có nốt (giai điệu mẫu tắt) — cache theo `tl` để scheduler không plan lại vô cớ. */
  private silentTl: Timeline | null = null;
  private silentFor: Timeline | null = null;

  // Đếm ngược trước khi phát
  private countdownTimer: TimerId | null = null;
  private countdownLeft = 0;
  /** Đếm ngược riêng của engine này (giây); null = theo settings.startDelaySec. */
  private startDelayOverride: number | null = null;
  /** Object `preRoll` trả lần trước (giữ identity khi giá trị không đổi). */
  private preRollCache: BeatRange | null = null;
  /** Trượt mượt vào / ra khung pre-roll (bấm Phát, hủy đếm ngược — preRollGlide.ts, D-389). */
  private readonly glide = new PreRollGlide();

  // Cửa sổ chủ (Document PiP…); null = window chính, gọi thẳng global như cũ.
  private readonly host: HostWindow | null;
  private readonly rendererOverrides: Partial<RendererOptions> | null;
  /** Bàn nút kiểu game khi Kiểu điều khiển = Mobile (PlayerEngineOptions.mobilePad). */
  private readonly mobilePad: boolean;
  private windowResizeTarget: Window | null = null;
  private pumpTimer: number | null = null;
  private hostMql: MediaQueryList | null = null;

  // Practice
  private practiceOn = false;
  private session: PracticeSession | null = null;
  private guideAudible = false;
  /** Chế độ chờ: index nốt transport đang giữ; null = không giữ. */
  private waitHold: number | null = null;
  private flashSeq = 0;
  private lastFlash: PracticeFlash | null = null;
  private results: PracticeScore | null = null;
  private detachInput: (() => void) | null = null;
  private unsubMidi: (() => void) | null = null;
  private midiStatus: PracticeMidiStatus = 'off';
  /** Tăng mỗi lần gắn / gỡ MIDI — kết quả enable() về muộn của lần gắn cũ bị bỏ. */
  private midiToken = 0;
  private readonly keysDown = new Set<NoteKey>();
  private readonly midiDown = new Map<number, KeyChoice | null>();

  /** Màn chơi thử: không đếm vào, không đếm ngược. */
  private readonly instantStart: boolean;
  /** Kế hoạch chạm mobile dùng ở lần sync trước (nhận ra bài / setting đổi). */
  private mobilePlanSeen: object | null = null;
  /**
   * Chế độ mobile người chơi đang giữ qua các lần phát / nhảy / lặp → cue "vào lại" (game giữ chế
   * độ đã chọn; kế hoạch chỉ giả định đầu bài là Ngẩng Tự Nhiên). Theo dõi cả ở scheme PC.
   */
  private readonly mobileTrack: MobileEntryTracker;
  /** Vị trí hit line ngay trước lần đổi transport do engine gọi (`own`); null = không theo dõi. */
  private moveFrom: number | null = null;

  constructor(timeline: Timeline, songBpm: number, opts: PlayerEngineOptions = {}) {
    this.tl = timeline;
    this.songBpm = songBpm;
    this.instantStart = opts.instantStart === true;
    this.host = opts.hostWindow ? (opts.hostWindow as HostWindow) : null;
    this.rendererOverrides = opts.rendererOptions ? { ...opts.rendererOptions } : null;
    this.mobilePad = opts.mobilePad === true;
    this.baseClock = opts.clock ?? createPerformanceClock();
    this.transport = new Transport({
      clock: this.baseClock,
      bpm: songBpm,
      endBeat: Math.max(0, timeline.totalBeats),
    });
    const start = opts.initialBeat ?? 0;
    if (Number.isFinite(start) && start > 0) this.transport.seek(start);
    this.mobileTrack = new MobileEntryTracker(this.transport.getBeat());
    this.state = {
      playing: false,
      countingIn: false,
      beat: 0,
      bpm: this.transport.bpm,
      bpmOverride: null,
      noteIndex: -1,
      runIndex: -1,
      lineIndex: -1,
      sectionIndex: -1,
      loop: null,
      audio: initialAudioStatus(wantsAudio(useSettings.getState())),
      countdown: null,
      practice: null,
      pressed: NO_PRESSED,
      ended: false,
      mobile: null,
    };
    this.sync(true);
  }

  // -------------------------------------------------------------------------
  // React bridge
  // -------------------------------------------------------------------------

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  readonly getState = (): PlayerUiState => this.state;

  get timeline(): Timeline {
    return this.tl;
  }

  get isAttached(): boolean {
    return this.attached;
  }

  /** Scheduler đang chạy (đã mở khóa audio và gắn audio clock). */
  get audioActive(): boolean {
    return this.scheduler?.running === true;
  }

  /** Phiên chấm điểm hiện tại (null khi tắt practice). */
  get practiceSession(): PracticeSession | null {
    return this.session;
  }

  /** Cửa sổ chủ đã truyền qua `hostWindow` (null = window chính). */
  get hostWindow(): Window | null {
    return this.host;
  }

  // -------------------------------------------------------------------------
  // Vòng đời
  // -------------------------------------------------------------------------

  attach(targets: PlayerAttachTargets): void {
    if (this.attached) this.detach();
    this.attached = true;
    this.stage = targets.stage ?? null;
    this.surface = targets.stage ?? targets.canvas ?? null;
    const s = useSettings.getState();
    const canvas = targets.canvas;
    if (canvas) {
      const r = new TilesRenderer(canvas, this.rendererOptionsFor(s));
      this.canvas = canvas;
      this.glowWarmups = 0;
      this.glide.reset();
      r.setTimeline(this.tl);
      this.renderer = r;
      this.observeResize(canvas);
      this.watchHostDpr();
      r.resize();
      this.updateLaneVars();
    }
    this.seenEpoch = this.transport.epoch;
    this.seenPlaying = this.transport.playing;
    this.seenLoop = this.transport.loop;
    this.unsubs.push(this.transport.subscribe(this.onTransportChange));
    this.unsubs.push(useSettings.subscribe(this.onSettings));
    this.patch({ audio: initialAudioStatus(wantsAudio(s)) });
    // AudioContext đã mở từ trước (vd. vừa phát bài khác) → gắn audio clock luôn, không cần gesture.
    this.ensureAudio(false);
    this.scheduleWarm();
    if (this.practiceOn) {
      this.connectPracticeInputs();
      this.publishPractice();
    }
    this.sync(true);
    this.drawFrame();
    // Keycap sáng (drop-shadow + hiệu ứng nhấn) và banner "ĐANG GIỮ …" của kiểu PC: làm nóng lúc còn đứng yên để
    // lần đầu chúng hiện (nốt đầu chạm vạch, hold đầu) không khựng (glowWarmup.ts, v1.0.1).
    if (this.stage) {
      this.cancelDomWarm = warmDomEffects(
        this.stage,
        (fn, ms) => this.hostSetTimeout(fn, ms),
        (id) => this.hostClearTimeout(id as TimerId),
      );
    }
  }

  detach(): void {
    if (!this.attached) return;
    this.attached = false;
    this.cancelDomWarm?.();
    this.cancelDomWarm = null;
    this.cancelWarm?.();
    this.cancelWarm = null;
    this.playPending = false;
    this.clearCountdownTimer();
    this.patch({ countdown: null });
    this.cancelFrame();
    this.disconnectPracticeInputs();
    for (const u of this.unsubs.splice(0)) u();
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    if (this.windowResize) {
      (this.windowResizeTarget ?? window).removeEventListener('resize', this.windowResize);
      this.windowResize = null;
      this.windowResizeTarget = null;
    }
    this.unwatchHostDpr();
    this.audioToken++; // bỏ kết quả unlock() còn đang chờ
    this.detachAudio();
    // Rời màn chơi: thôi chờ cú chạm, trả phiên "playback" (iPhone) — nhạc của app khác chạy lại được.
    this.releaseSound();
    this.scheduler?.dispose();
    this.scheduler = null;
    this.schedulerOwner = null;
    this.syncPump();
    this.waitHold = null;
    if (this.transport.playing) this.transport.pause();
    this.transport.dispose();
    this.renderer?.dispose();
    this.renderer = null;
    this.canvas = null;
    this.stage = null;
    this.surface = null;
    this.laneLeft = Number.NaN;
    this.laneRight = Number.NaN;
    this.sync(true);
  }

  /** Bài/settings đổi (baseOctave) → timeline mới, giữ vị trí. */
  setTimeline(tl: Timeline): void {
    if (tl === this.tl) return;
    this.tl = tl;
    this.renderer?.setTimeline(tl);
    this.own(() => this.transport.setEndBeat(Math.max(0, tl.totalBeats)));
    const loop = this.state.loop;
    if (loop && Math.max(loop.a, loop.b ?? 0) >= tl.lines.length) this.clearLoop();
    if (this.practiceOn) {
      // Nốt (midi / modifier) đổi → phiên chấm mới tại vị trí hiện tại.
      this.clearHold(false);
      this.results = null;
      this.createSession();
      this.publishPractice();
    }
    this.scheduler?.poke();
    this.sync(true);
    this.requestFrame();
  }

  setSongBpm(bpm: number): void {
    if (bpm === this.songBpm) return;
    this.songBpm = bpm;
    if (this.bpmOverride === null) this.transport.setBpm(bpm);
    this.sync(true);
  }

  // -------------------------------------------------------------------------
  // Điều khiển (gọi từ nút / phím tắt — tức là trong user gesture)
  // -------------------------------------------------------------------------

  /**
   * Phát (kèm đếm vào nếu bật). Lần đầu: mở khóa âm thanh trong gesture này. Có `startDelaySec`
   * thì đếm ngược trước.
   */
  play(): void {
    if (!this.hasNotes()) return;
    if (this.countdownTimer !== null || this.waitHold !== null) return;
    if (this.transport.playing || this.playPending) {
      this.ensureAudio(true);
      return;
    }
    const delay = this.startDelay();
    if (delay > 0) {
      this.beginCountdown(delay);
      return;
    }
    this.start(undefined);
  }

  pause(): void {
    if (this.countdownTimer !== null) {
      this.cancelCountdown();
      return;
    }
    if (this.waitHold !== null) {
      // Đang chờ bấm (transport đã đứng) → thoát lượt chơi, giữ nguyên vị trí.
      this.clearHold(false);
      this.publishPractice();
      this.sync(true);
      this.requestFrame();
      return;
    }
    if (this.playPending) {
      // Bấm lại trong lúc chờ unlock → hủy lần Play đó.
      this.playPending = false;
      this.sync(true);
      this.requestFrame(); // bỏ frame đầu đếm vào
      return;
    }
    const tr = this.transport;
    if (!tr.playing) return;
    const ci = tr.countIn;
    const target = ci !== null && tr.getBeat() < ci.end ? ci.end : null;
    this.own(() => {
      tr.pause();
      // Dừng giữa lúc đếm vào → về đúng điểm định bắt đầu (không lùi vào ô nhịp đếm).
      if (target !== null) tr.seek(target);
    });
    this.checkResults();
  }

  toggle(): void {
    if (
      this.countdownTimer !== null ||
      this.waitHold !== null ||
      this.transport.playing ||
      this.playPending
    ) {
      this.pause();
    } else {
      this.play();
    }
  }

  /** Phát lại từ beat 0 (kèm đếm vào nếu bật; có `startDelaySec` thì đếm ngược trước), kể cả khi đang phát. */
  restart(): void {
    if (!this.hasNotes()) return;
    this.clearCountdownTimer();
    this.clearHold(false);
    this.results = null;
    const delay = this.startDelay();
    if (delay > 0) {
      this.playPending = false;
      this.own(() => {
        if (this.transport.playing) this.transport.pause();
        this.transport.seek(0);
      });
      this.resetPractice(0);
      this.beginCountdown(delay);
      return;
    }
    this.start(0);
  }

  /** Hủy đếm ngược trước khi phát (Space / Esc / nút Tạm dừng). */
  cancelCountdown(): void {
    if (this.countdownTimer === null) return;
    this.clearCountdownTimer();
    this.patch({ countdown: null });
    this.sync(true);
    this.requestFrame(); // bỏ frame đầu đếm vào → về đúng vị trí đang đứng
  }

  /**
   * Ô nhịp đếm vào của lần phát đang chờ bắt đầu (đếm ngược / chờ mở khóa âm thanh): canvas vẽ frame đầu
   * của nó (beat = `start`, ô đứng yên) để lúc transport chạy không có bước nhảy nào. null = không chờ phát
   * hoặc không đếm vào. Overlay theo Player nhận nó qua tin `state` (followBroadcast) và vẽ y hệt.
   */
  get preRoll(): BeatRange | null {
    const tr = this.transport;
    if (tr.playing || (this.countdownTimer === null && !this.playPending)) return null;
    // Cùng chuẩn hóa điểm bắt đầu như Transport.play: beat âm → 0, đứng ở cuối bài → 0.
    const from = playStartBeat(undefined, tr.getBeat(), tr.endBeat);
    const n = this.countInBeats(from);
    if (!(n > 0)) return null;
    const cur = this.preRollCache;
    if (cur !== null && cur.start === from - n && cur.end === from) return cur;
    this.preRollCache = Object.freeze({ start: from - n, end: from });
    return this.preRollCache;
  }

  /**
   * Bắt đầu đoạn phát. Âm thanh bật mà AudioContext chưa chạy và đang đứng yên → chờ unlock rồi mới
   * `transport.play` (neo thẳng trên audio clock nên click đếm vào / nốt đầu không bị mất). Đang phát
   * (vd. Restart) hoặc audio từng bị chặn → phát ngay, audio gắn vào sau nếu mở khóa được.
   */
  private start(fromBeat: number | undefined): void {
    this.preparePracticeRun(fromBeat);
    const waiting = this.ensureAudio(true);
    if (waiting && !this.transport.playing && !this.audioFailed) {
      if (fromBeat !== undefined) this.own(() => this.transport.seek(fromBeat));
      this.playPending = true;
      this.sync(true);
      this.requestFrame(); // chờ unlock: ô đứng ở frame đầu đếm vào (preRoll)
      return;
    }
    this.playPending = false;
    this.own(() => this.transport.play({ fromBeat, countInBeats: this.countInBeatsFor(fromBeat) }));
  }

  /** Unlock xong (được hoặc bị chặn) → chạy lần Play đang chờ. */
  private flushPendingPlay(): void {
    if (!this.playPending) return;
    this.playPending = false;
    if (!this.attached || !this.hasNotes()) {
      this.sync(true);
      return;
    }
    this.own(() => this.transport.play({ countInBeats: this.countInBeatsFor(undefined) }));
  }

  /** Nhảy tới beat; đang phát thì phát tiếp từ đó. */
  seek(beat: number): void {
    if (!Number.isFinite(beat)) return;
    const b = clamp(beat, 0, Math.max(0, this.tl.totalBeats));
    const holding = this.waitHold !== null;
    this.clearHold(false);
    this.results = null;
    this.resetPractice(b);
    // Đang chờ bấm = đang trong lượt chơi → nhảy rồi chạy tiếp như khi đang phát.
    this.own(() => (holding ? this.transport.play({ fromBeat: b }) : this.transport.seek(b)));
  }

  prevLine(): void {
    const grace = Math.max(0.5, (PREV_LINE_GRACE_SEC * this.transport.bpm) / 60);
    this.seek(prevLineStart(this.tl, this.positionBeat(), grace));
  }

  nextLine(): void {
    const at = this.positionBeat();
    const next = nextLineStart(this.tl, at);
    if (next >= this.tl.totalBeats || next <= at) return; // dòng cuối: không nhảy tới hết bài
    this.seek(next);
  }

  seekSection(index: number): void {
    const sec = this.tl.sections[index];
    if (sec) this.seek(sec.startBeat);
  }

  /** L: lần 1 đặt A = dòng hiện tại, lần 2 đặt B → loop [A.start, B.end], lần 3 tắt. */
  cycleLoop(): void {
    const lines = this.tl.lines;
    if (lines.length === 0) return;
    const cur = Math.max(0, lineIndexAt(this.tl, this.positionBeat()));
    const loop = this.state.loop;
    if (loop === null) {
      this.patch({ loop: { a: cur, b: null } });
      return;
    }
    if (loop.b === null) {
      const a = Math.min(loop.a, cur);
      const b = Math.max(loop.a, cur);
      const start = lines[a].startBeat;
      const end = lines[b].endBeat;
      if (!(end > start)) {
        this.patch({ loop: null });
        return;
      }
      this.transport.setLoop({ start, end });
      this.patch({ loop: { a, b } });
      return;
    }
    this.clearLoop();
  }

  clearLoop(): void {
    this.transport.setLoop(null);
    this.patch({ loop: null });
  }

  /** Tempo cho phiên này (null = về bpm của bài). Kẹp 40..200. */
  setBpmOverride(bpm: number | null): void {
    let next: number | null = null;
    if (bpm !== null && Number.isFinite(bpm)) {
      const v = clamp(bpm, BPM_SLIDER_MIN, BPM_SLIDER_MAX);
      next = v === this.songBpm ? null : v;
    }
    this.bpmOverride = next;
    this.transport.setBpm(next ?? this.songBpm);
    this.sync(true);
  }

  /** [ / ]: ±2 BPM trong 40..200 (không đi ngược chiều khi bpm gốc nằm ngoài khoảng). */
  stepBpm(delta: number): void {
    const cur = this.transport.bpm;
    const next = clamp(Math.round((cur + delta) * 1000) / 1000, BPM_SLIDER_MIN, BPM_SLIDER_MAX);
    if ((delta > 0 && next <= cur) || (delta < 0 && next >= cur)) return;
    this.setBpmOverride(next);
  }

  /**
   * Bật/tắt giai điệu mẫu (gesture): lưu setting; bật thì mở khóa âm thanh + giữ phiên "playback" của iPhone NGAY
   * trong cú bấm này — cả lúc đứng yên (D-423: lần Phát đầu đã có tiếng, không phải chờ) lẫn lúc đang đếm ngược
   * (`start()` chạy từ hẹn giờ, không còn user activation — D-404). Nơi gọi: nút loa trên thanh điều khiển màn chơi —
   * bật chỉ sau "Tôi hiểu, bật" của hộp cảnh báo bản quyền dùng chung với Cài đặt → Âm thanh
   * (src/ui/MelodyConfirm.tsx, D-392); tắt thì gọi thẳng (hết tiếng → trả phiên ở onSettings).
   */
  setAudioEnabled(on: boolean): void {
    if (on) this.audioFailed = false; // người dùng chủ động bật lại → Play lần sau chờ unlock lại
    useSettings.getState().set({ audioEnabled: on });
    if (on) this.ensureAudio(true);
  }

  /**
   * Đếm ngược trước khi phát riêng cho engine này (giây, kẹp 0..10; vd. bộ chọn của cửa sổ nổi),
   * không đụng settings. null = về settings.startDelaySec. Áp từ lần Play / Restart kế tiếp.
   */
  setStartDelay(seconds: number | null): void {
    this.startDelayOverride =
      seconds === null || !Number.isFinite(seconds) ? null : clamp(Math.round(seconds), 0, 10);
  }

  // -------------------------------------------------------------------------
  // Practice mode
  // -------------------------------------------------------------------------

  /** Bật/tắt practice: gắn/gỡ input (phím, chuột trên stage, MIDI), tạo phiên chấm mới. */
  setPractice(on: boolean): void {
    if (on === this.practiceOn) return;
    if (on) {
      this.practiceOn = true;
      this.guideAudible = false;
      this.results = null;
      this.lastFlash = null;
      this.createSession();
      this.connectPracticeInputs();
    } else {
      this.disconnectPracticeInputs();
      this.clearHold(true);
      this.practiceOn = false;
      this.session = null;
      this.results = null;
      this.lastFlash = null;
      // Chỉ tiếng phản hồi giữ phiên "playback" → hết luyện tập là hết tiếng.
      if (!this.soundWanted(useSettings.getState())) this.releaseSound();
    }
    this.scheduler?.poke(); // giai điệu mẫu bật/tắt theo practice
    this.publishPractice();
    this.sync(true);
    this.requestFrame();
  }

  /** "Nghe giai điệu mẫu" khi luyện tập (mặc định tắt). */
  setGuideAudible(on: boolean): void {
    if (!this.practiceOn || on === this.guideAudible) return;
    this.guideAudible = on;
    // Cú bấm "Nghe giai điệu mẫu" = muốn nghe: mở khóa / giữ phiên "playback" ngay trong cú bấm.
    if (on) this.ensureAudio(true);
    this.scheduler?.poke();
    this.publishPractice();
  }

  /** Đóng bảng kết quả (giữ nguyên vị trí). */
  dismissResults(): void {
    if (this.results === null) return;
    this.results = null;
    this.publishPractice();
  }

  /** "Chơi lại" trên bảng kết quả: phiên mới từ đầu bài. */
  replayPractice(): void {
    this.results = null;
    this.publishPractice();
    this.restart();
  }

  /**
   * Một input practice đã chuẩn hóa (bàn phím / chuột từ practiceInput.ts, MIDI đã transpose, bàn
   * chạm Mobile). Public để test và nguồn input khác gọi thẳng. Trả kết quả của lần bấm (null nếu
   * input không được xét) để nguồn input phản hồi tại chỗ (bàn chạm: chỉ nút chế độ cần chạm).
   */
  handlePracticeInput(ev: PracticeInputEvent): PracticeInputOutcome | null {
    if (!this.practiceOn || !this.session) return null;
    const press =
      ev.type === 'key-down' ||
      ev.type === 'tap-down' ||
      (ev.type === 'midi-on' && ev.velocity > 0);
    // Loop wrap / hết bài đã tới hạn mà frame chưa chạy → áp trước, để lần bấm rơi đúng vòng.
    if (press && this.transport.playing) this.transport.update();
    const session = this.session;
    if (!session) return null;
    this.trackPressed(ev);
    if (press) this.feedback(ev, session);
    // Bấm nốt chỉ được chấm khi đang trong lượt chơi (đang phát / đang chờ bấm); modifier thì luôn
    // cập nhật để trạng thái giữ không bị lệch.
    const live = this.transport.playing || this.waitHold !== null;
    if (press && !live) {
      this.updatePressed();
      return null;
    }
    if (
      ev.type === 'midi-on' &&
      press &&
      this.midiDown.get(ev.midi) === null &&
      !useSettings.getState().midiPitchClassOnly
    ) {
      // Nốt MIDI ngoài tầm C3..C6 (sau transpose): bỏ qua, báo nhẹ, không phá combo (spec §6b B).
      this.updatePressed();
      this.flash('range', null, null);
      this.publishPractice();
      return { kind: 'range', expected: null };
    }
    const ctx = { beatAt: this.beatAtTimestamp, bpm: this.transport.bpm, loop: this.loopWrap() };
    const r = session.handleInput(ev, ctx);
    this.updatePressed();
    if (!press) return null;
    if (r.judgement && r.lap !== undefined) {
      // Vòng loop khác (bấm sớm cho vòng kế / muộn cho vòng vừa qua): chỉ nháy kết quả; 'next'
      // được tính vào lượt mới lúc wrap.
      this.flash(r.judgement.grade, r.judgement.deltaMs, this.noteKey(r.judgement.noteIndex));
      this.publishPractice();
      return { kind: r.judgement.grade, expected: null };
    }
    if (r.judgement) {
      this.onJudged([r.judgement]);
      if (this.waitHold !== null && r.judgement.noteIndex === this.waitHold) this.releaseHold();
      return { kind: r.judgement.grade, expected: null };
    }
    if (r.wrong) {
      const expected = session.expectedNoteAt(ctx.beatAt(ev.timeStamp), ctx.bpm);
      const key =
        ev.type === 'key-down' || ev.type === 'tap-down'
          ? ev.key
          : ev.type === 'midi-on'
            ? (this.midiDown.get(ev.midi)?.key ?? null)
            : null;
      const expectedNote = this.tl.notes[expected] ?? null;
      this.flash('wrong', null, key, key !== null && expectedNote?.key === key);
      this.publishPractice();
      return { kind: 'wrong', expected: expectedNote };
    }
    return { kind: 'none', expected: null };
  }

  // -------------------------------------------------------------------------
  // Nội bộ: frame loop
  // -------------------------------------------------------------------------

  private hasNotes(): boolean {
    return this.tl.totalBeats > 0 && this.tl.notes.length > 0;
  }

  /** Loop mà đoạn phát đang chạy sẽ wrap (cùng điều kiện `wrapEndOf`); null nếu không. */
  private loopWrap(): LoopWrap | null {
    const tr = this.transport;
    const loop = tr.loop;
    if (!tr.playing || loop === null) return null;
    const end = wrapEndOf({ loop, endBeat: tr.endBeat, segmentStart: tr.segmentStart });
    return end === null ? null : { start: loop.start, end };
  }

  /**
   * Số beat đếm vào của lần phát từ `from` (đã chuẩn hóa): đếm vào bật → quãng dẫn vào rút còn 65 % (leadIn.ts,
   * v1.0.1) — nốt đầu đi 0,65 × (1 ô nhịp + khoảng lặng trước nó) từ chỗ đứng yên tới hit line.
   */
  private countInBeats(from: number): number {
    if (this.instantStart || !useSettings.getState().countIn) return 0;
    return leadInBeats(this.tl, from, this.tl.beatsPerBar > 0 ? this.tl.beatsPerBar : 4);
  }

  /** Như `countInBeats` cho `transport.play({ fromBeat })` (không truyền = beat đang đứng). */
  private countInBeatsFor(fromBeat: number | undefined): number {
    const tr = this.transport;
    return this.countInBeats(playStartBeat(fromBeat, tr.getBeat(), tr.endBeat));
  }

  private startDelay(): number {
    if (this.instantStart) return 0;
    const v = this.startDelayOverride ?? useSettings.getState().startDelaySec;
    return Number.isFinite(v) && v > 0 ? Math.round(v) : 0;
  }

  /** Beat dùng cho seek/loop: đang đếm vào thì là điểm bắt đầu. */
  private positionBeat(): number {
    const tr = this.transport;
    const ci = tr.countIn;
    const b = tr.getBeat();
    if (tr.playing && ci !== null && b < ci.end) return ci.end;
    return Math.max(0, b);
  }

  /**
   * Engine tự đổi transport: listener không coi là wrap / hết bài từ ngoài. `track` = vị trí nhảy thì
   * ghi nhận cho cue vào lại của Mobile (giữ transport chờ bấm ở practice thì không — vẫn là lượt đó).
   */
  private own(fn: () => void, track = true): void {
    const prevFrom = this.moveFrom;
    this.moveFrom = track ? this.positionBeat() : null;
    this.internal++;
    try {
      fn();
    } finally {
      this.internal--;
      this.moveFrom = prevFrom;
    }
  }

  /** Kế hoạch chạm mobile theo cách Nửa Cung hiện tại (cache theo timeline — rẻ, kể cả ở PC). */
  private mobilePlan(): MobilePlan {
    return mobilePlanFor(this.tl, useSettings.getState().mobileSemitone);
  }

  /** Loop A-B mà đoạn phát hiện tại sẽ wrap (cùng điều kiện `wrapEndOf`); null nếu không. */
  private wrappingLoop(): BeatRange | null {
    const tr = this.transport;
    const loop = tr.loop;
    const end = wrapEndOf({ loop, endBeat: tr.endBeat, segmentStart: tr.segmentStart });
    return loop !== null && end !== null ? { start: loop.start, end } : null;
  }

  /**
   * Transport đổi epoch: lần đổi do engine gọi nhảy khỏi vị trí cũ (chạy lại, seek, phát lại sau khi
   * hết bài) hoặc loop A-B wrap → chế độ người chơi đang giữ có thể khác chế độ nốt đầu lượt mới.
   */
  private trackMobileMove(snap: TransportSnapshot): void {
    let from: number | null = null;
    let to = snap.segmentStart;
    if (this.internal > 0) {
      from = this.moveFrom;
      // Nhiều lần đổi trong một lệnh (pause + seek): lần sau tính từ chỗ lần trước để lại.
      if (from !== null) this.moveFrom = to;
    } else if (
      snap.playing &&
      snap.loop !== null &&
      snap.countIn === null &&
      snap.anchorBeat === snap.loop.start &&
      snap.segmentStart === snap.loop.start
    ) {
      from = wrapEndOf(snap);
      to = snap.loop.start;
    }
    if (from !== null) this.mobileTrack.move(this.mobilePlan(), this.tl, from, to);
  }

  private requestFrame(): void {
    if (!this.attached || this.rafId !== null) return;
    const h = this.host;
    if (h) {
      // Cửa sổ chủ (PiP): rAF của chính nó — rAF của tab gốc đứng khi tab bị ẩn sau game.
      if (typeof h.requestAnimationFrame === 'function') {
        this.rafIsTimeout = false;
        this.rafId = h.requestAnimationFrame(this.onFrame);
      } else {
        this.rafIsTimeout = true;
        this.rafId = h.setTimeout(this.onFrame, 16);
      }
      return;
    }
    if (typeof requestAnimationFrame === 'function') {
      this.rafIsTimeout = false;
      this.rafId = requestAnimationFrame(this.onFrame);
    } else {
      this.rafIsTimeout = true;
      this.rafId = window.setTimeout(this.onFrame, 16);
    }
  }

  private cancelFrame(): void {
    if (this.rafId === null) return;
    const h = this.host;
    if (h) {
      if (this.rafIsTimeout) h.clearTimeout(this.rafId);
      else if (typeof h.cancelAnimationFrame === 'function') h.cancelAnimationFrame(this.rafId);
    } else if (this.rafIsTimeout) {
      window.clearTimeout(this.rafId);
    } else if (typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(this.rafId);
    }
    this.rafId = null;
  }

  /** setTimeout của cửa sổ chủ (đếm ngược) — timer của tab gốc bị bóp khi tab bị ẩn. */
  private hostSetTimeout(fn: () => void, ms: number): TimerId {
    const h = this.host;
    return h ? (h.setTimeout(fn, ms) as unknown as TimerId) : setTimeout(fn, ms);
  }

  private hostClearTimeout(id: TimerId): void {
    const h = this.host;
    if (h) h.clearTimeout(id as unknown as number);
    else clearTimeout(id);
  }

  /** Option canvas: settings + phần cố định truyền qua `rendererOptions` (nếu có). */
  private rendererOptionsFor(s: Settings): Partial<RendererOptions> {
    const base = rendererOptionsFrom(s);
    const merged: Partial<RendererOptions> = this.rendererOverrides
      ? { ...base, ...this.rendererOverrides }
      : base;
    if (!this.mobilePad) return merged;
    // Bàn nút kiểu game khi Mobile (thắng lanePadding cố định của `rendererOptions`); PC → lanePadding cố định
    // nếu có (cửa sổ nổi: 'none'), không thì mặc định 'normal' — setOptions gộp lên option cũ nên phải ghi rõ
    // khi đổi Mobile → PC.
    return {
      ...merged,
      lanePadding:
        s.controlScheme === 'mobile' ? 'pad' : (this.rendererOverrides?.lanePadding ?? 'normal'),
    };
  }

  /**
   * Cửa sổ chủ khác window chính: "bơm" scheduler bằng interval của cửa sổ chủ khi đang phát có
   * âm thanh (interval riêng của scheduler chạy trên tab gốc, bị trình duyệt bóp khi tab bị ẩn).
   * Tick thừa vô hại: scheduler chỉ lên lịch phần chưa lên lịch.
   */
  private syncPump(): void {
    const h = this.host;
    if (!h) return;
    const want = this.attached && this.scheduler?.running === true && this.transport.playing;
    if (want && this.pumpTimer === null) {
      this.pumpTimer = h.setInterval(this.onPump, HOST_PUMP_MS);
    } else if (!want && this.pumpTimer !== null) {
      h.clearInterval(this.pumpTimer);
      this.pumpTimer = null;
    }
  }

  private readonly onPump = (): void => {
    if (this.attached) this.scheduler?.poke();
  };

  /**
   * Cửa sổ chủ: theo dõi devicePixelRatio của chính nó (kéo cửa sổ nổi sang màn hình khác) bằng
   * matchMedia của nó → đo lại canvas. Window chính: renderer tự theo dõi như cũ.
   */
  private watchHostDpr(): void {
    this.unwatchHostDpr();
    const h = this.host;
    if (!h || typeof h.matchMedia !== 'function') return;
    const dpr = h.devicePixelRatio;
    if (typeof dpr !== 'number' || !Number.isFinite(dpr) || dpr <= 0) return;
    try {
      const mql = h.matchMedia(`(resolution: ${dpr}dppx)`);
      mql.addEventListener('change', this.onHostDprChange);
      this.hostMql = mql;
    } catch {
      this.hostMql = null;
    }
  }

  private unwatchHostDpr(): void {
    if (!this.hostMql) return;
    this.hostMql.removeEventListener('change', this.onHostDprChange);
    this.hostMql = null;
  }

  private readonly onHostDprChange = (): void => {
    if (!this.attached || !this.renderer) return;
    this.watchHostDpr(); // query mới theo DPR mới
    this.renderer.resize();
    this.updateLaneVars();
    this.drawFrame();
  };

  private readonly onFrame = (): void => {
    this.rafId = null;
    if (!this.attached) return;
    this.drawFrame();
    // Đang chờ bấm: transport đứng nhưng tile chờ vẫn nhấp nháy. Đang trượt vào / ra khung pre-roll: vẽ tiếp.
    if (this.transport.playing || this.waitHold !== null || this.glide.active) this.requestFrame();
  };

  /** Một frame: áp wrap/end, chấm practice, vẽ canvas, đẩy state rời rạc lên React. */
  private drawFrame(): void {
    const tr = this.transport;
    tr.update(); // có thể notify (wrap/end) → onTransportChange
    this.practiceStep();
    // Đang đếm ngược / chờ unlock: vẽ frame đầu của đếm vào sắp chạy (ô đứng yên tại đó).
    const pre = this.preRoll;
    const target = pre ? pre.start : tr.getBeat();
    const live = tr.countIn;
    const ci = pre ?? (tr.playing && live !== null && target < live.end ? live : null);
    // Bấm Phát / hủy đếm ngược: không nhảy một ô nhịp giữa khung đứng yên và khung pre-roll — trượt mượt.
    const mode: DrawMode = pre ? 'pre' : ci ? 'countIn' : tr.playing ? 'play' : 'idle';
    const beat = this.glide.beatFor(target, mode, ci ? ci.end - ci.start : 0, this.baseClock.now());
    // Loop chỉ vẽ dạng "vòng kế" khi transport thật sự sẽ wrap (cùng điều kiện `wrapEndOf`):
    // play/seek từ loop end trở đi (kể cả lúc đếm vào trước loop end) thì vẽ như không loop.
    const loop =
      wrapEndOf({ loop: tr.loop, endBeat: tr.endBeat, segmentStart: tr.segmentStart }) !== null
        ? tr.loop
        : null;
    // Mobile: cue vào lại của lượt này (vòng hiện tại) và của mỗi vòng loop kế.
    const mobile = useSettings.getState().controlScheme === 'mobile';
    const plan = mobile ? this.mobilePlan() : null;
    const wrapLoop = plan ? this.wrappingLoop() : null;
    this.renderer?.render({
      beat,
      countInRemaining: ci ? ci.end - beat : null,
      countIn: ci,
      loop,
      noteStates: this.session?.noteStates ?? null,
      mobileEntry: plan ? this.mobileTrack.entry(plan, this.tl) : null,
      mobileLoopEntry:
        plan && wrapLoop ? this.mobileTrack.loopEntry(plan, this.tl, wrapLoop) : null,
    });
    // Ô đứng yên (vừa mở, đếm ngược…): vẽ kèm hình làm nóng glow để lần đầu tile sáng ở hit line không
    // khựng (glowWarmup.ts). Vài frame đầu — frame vẽ đè trước khi lên màn hình làm mất hình của frame trước.
    if (!tr.playing && this.glowWarmups < GLOW_WARMUP_FRAMES && this.canvas && this.renderer) {
      if (warmTileGlow(this.canvas, this.renderer.layout)) this.glowWarmups++;
    }
    this.sync(false);
  }

  /** Practice mỗi frame: chấm điểm → miss quá cửa sổ; chờ → giữ transport tại nốt chưa bấm. */
  private practiceStep(): void {
    const session = this.session;
    const tr = this.transport;
    if (!session || !tr.playing) return;
    const beat = tr.getBeat();
    const ci = tr.countIn;
    if (ci !== null && beat < ci.end) return;
    if (session.mode === 'score') {
      const misses = session.tick(beat, tr.bpm);
      if (misses.length > 0) this.onJudged(misses);
      return;
    }
    if (this.waitHold !== null) return;
    const target = session.waitTarget(beat);
    if (target >= 0) this.holdAt(target);
  }

  /** Tính state UI từ transport; chỉ tạo object mới + notify khi có giá trị đổi. */
  private sync(force: boolean): void {
    const tr = this.transport;
    const tl = this.tl;
    const raw = tr.getBeat();
    const ci = tr.countIn;
    const countingIn = tr.playing && ci !== null && raw < ci.end;
    const at = countingIn && ci !== null ? ci.end : raw;
    const noteIndex = noteIndexAt(tl, at);
    const runIndex = runIndexAt(tl, at);
    const lineIndex = lineIndexAt(tl, at);
    const sectionIndex = sectionIndexAt(tl, at);
    const prev = this.state;
    let beat = prev.beat;
    const now = nowMs();
    if (
      force ||
      !tr.playing ||
      countingIn !== prev.countingIn ||
      now - this.lastProgressAt >= PROGRESS_INTERVAL_MS
    ) {
      beat = clamp(at, 0, Math.max(0, tl.totalBeats));
      this.lastProgressAt = now;
    }
    // Chờ unlock / đếm ngược / chờ bấm (practice): UI coi như đang phát (nút hiện Pause, bấm = hủy).
    const playing =
      tr.playing || this.playPending || this.countdownTimer !== null || this.waitHold !== null;
    const bpm = tr.bpm;
    const bpmOverride = this.bpmOverride;
    const ended = !playing && this.hasNotes() && raw >= tl.totalBeats - 1e-9;
    const mobile = this.mobileAt(at, prev.mobile);
    if (
      prev.playing === playing &&
      prev.countingIn === countingIn &&
      prev.beat === beat &&
      prev.bpm === bpm &&
      prev.bpmOverride === bpmOverride &&
      prev.noteIndex === noteIndex &&
      prev.runIndex === runIndex &&
      prev.lineIndex === lineIndex &&
      prev.sectionIndex === sectionIndex &&
      prev.ended === ended &&
      prev.mobile === mobile
    ) {
      return;
    }
    this.state = {
      ...prev,
      playing,
      countingIn,
      beat,
      bpm,
      bpmOverride,
      noteIndex,
      runIndex,
      lineIndex,
      sectionIndex,
      ended,
      mobile,
    };
    this.emit();
  }

  /** State mobile tại hit line (null ở kiểu PC); giữ object cũ khi không đổi. */
  private mobileAt(at: number, prev: MobileUiState | null): MobileUiState | null {
    const s = useSettings.getState();
    if (s.controlScheme !== 'mobile') return null;
    const plan = mobilePlanFor(this.tl, s.mobileSemitone);
    // Kế hoạch đổi (bài / cách Nửa Cung đổi) → tính lại từ đầu, không tái dùng cue của kế hoạch cũ.
    const reuse = prev !== null && this.mobilePlanSeen === plan ? prev : null;
    this.mobilePlanSeen = plan;
    const loop = this.wrappingLoop();
    return mobileUiAt(plan, at, reuse, {
      entry: this.mobileTrack.entry(plan, this.tl),
      loop: loop ? { ...loop, entry: this.mobileTrack.loopEntry(plan, this.tl, loop) } : null,
    });
  }

  private patch(p: Partial<PlayerUiState>): void {
    const prev = this.state;
    let changed = false;
    for (const k of Object.keys(p) as (keyof PlayerUiState)[]) {
      if (prev[k] !== p[k]) {
        changed = true;
        break;
      }
    }
    if (!changed) return;
    this.state = { ...prev, ...p };
    this.emit();
  }

  private emit(): void {
    for (const fn of Array.from(this.listeners)) {
      try {
        fn();
      } catch (err) {
        console.error(err);
      }
    }
  }

  private readonly onTransportChange = (snap: TransportSnapshot): void => {
    const jumped = snap.epoch !== this.seenEpoch;
    const wasPlaying = this.seenPlaying;
    const loopChanged = snap.loop !== this.seenLoop;
    this.seenEpoch = snap.epoch;
    this.seenPlaying = snap.playing;
    this.seenLoop = snap.loop;
    if (jumped) this.trackMobileMove(snap);
    const wrapped = jumped && this.internal === 0 && this.onExternalJump(snap, wasPlaying);
    // Bấm chấm trước cho vòng loop kế / nốt cuối vòng vừa qua chỉ còn nghĩa khi transport chạy liền
    // qua wrap: gián đoạn khác (pause, seek, chờ bấm, đổi clock, hết bài) hoặc đổi loop → bỏ.
    if ((jumped && !wrapped) || loopChanged) this.session?.dropLoopCarry();
    this.scheduler?.poke();
    this.syncPump();
    this.sync(true);
    this.requestFrame();
  };

  /**
   * Gián đoạn không do engine gọi: loop wrap / hết bài (transport.update từ frame, scheduler hoặc
   * lần bấm practice). Trả true nếu là loop wrap.
   */
  private onExternalJump(snap: TransportSnapshot, wasPlaying: boolean): boolean {
    const session = this.session;
    if (!session) return false;
    if (wasPlaying && !snap.playing && snap.anchorBeat >= snap.endBeat) {
      // Hết bài: nốt chưa chấm (chấm điểm) là miss, rồi hiện bảng kết quả.
      if (session.mode === 'score' && !session.finished) {
        session.tick(snap.endBeat + 1e6, snap.bpm);
      }
      this.publishPractice();
      this.checkResults();
      this.requestFrame();
      return false;
    }
    const loop = snap.loop;
    if (
      !snap.playing ||
      loop === null ||
      snap.countIn !== null ||
      snap.anchorBeat !== loop.start ||
      snap.segmentStart !== loop.start
    ) {
      return false;
    }
    // Loop wrap → lượt chơi mới từ loop start; lần bấm sớm ngay trước wrap (đã chấm trước cho vòng
    // này) được tính vào lượt mới, chữ nháy của nó giữ nguyên.
    const end = wrapEndOf(snap);
    let carried: readonly Judgement[] = [];
    if (end === null) session.reset(loop.start);
    else carried = session.wrapLoop({ start: loop.start, end }, snap.bpm);
    if (carried.length === 0) this.lastFlash = null;
    this.publishPractice();
    this.requestFrame();
    return true;
  }

  private readonly onSettings = (s: Settings, prev: Settings): void => {
    if (this.renderer) {
      this.renderer.setOptions(this.rendererOptionsFor(s));
      this.updateLaneVars();
    }
    if (
      s.musicVolume !== prev.musicVolume ||
      s.clickVolume !== prev.clickVolume ||
      s.timbre !== prev.timbre
    ) {
      if (isAudioSupported()) applyAudioSettings(getAudioEngine(), s);
    }
    const wanted = wantsAudio(s);
    if (wanted !== wantsAudio(prev)) {
      if (wanted) {
        this.audioFailed = false;
        this.patch({ audio: initialAudioStatus(true) });
        this.ensureAudio(false);
        this.scheduleWarm();
      } else {
        this.audioToken++;
        this.detachAudio();
        this.unwatchAudio();
        this.patch({ audio: 'off' });
        this.flushPendingPlay(); // không chờ unlock nữa → phát hình ngay
      }
    } else if (
      s.audioEnabled !== prev.audioEnabled ||
      s.clickSound !== prev.clickSound ||
      s.metronome !== prev.metronome
    ) {
      // Vẫn có tiếng nhưng đổi loại (giai điệu ↔ chỉ click): lên lịch lại phần chưa phát.
      this.scheduler?.poke();
    }
    if (s.controlScheme !== prev.controlScheme || s.mobileSemitone !== prev.mobileSemitone) {
      this.sync(true);
    }
    if (this.practiceOn && s.controlScheme !== prev.controlScheme) {
      // PC ↔ Mobile: nguồn input luyện tập khác nhau (Mobile chỉ nhận chạm bàn nút) → nối lại.
      this.connectPracticeInputs();
      this.publishPractice();
    }
    if (this.practiceOn) this.onPracticeSettings(s, prev);
    // Tắt hết tiếng (giai điệu + click, và tiếng phản hồi khi đang luyện tập) → trả phiên "playback" của iPhone,
    // thôi chờ cú chạm để mở khóa lại.
    if (!this.soundWanted(s)) this.releaseSound();
    this.requestFrame();
  };

  private onPracticeSettings(s: Settings, prev: Settings): void {
    const session = this.session;
    if (session && s.practiceMode !== prev.practiceMode) {
      // Đổi chế độ = lượt chơi mới tại vị trí hiện tại (đang chờ bấm thì chạy tiếp).
      this.clearHold(true);
      session.setMode(s.practiceMode);
      this.results = null;
      this.resetPractice(this.positionBeat());
    }
    if (session && s.midiPitchClassOnly !== prev.midiPitchClassOnly) {
      session.setMidiPitchClassOnly(s.midiPitchClassOnly);
    }
    if (s.midiEnabled !== prev.midiEnabled || s.midiInputId !== prev.midiInputId) {
      this.connectPracticeInputs();
      this.publishPractice();
    }
  }

  private observeResize(canvas: HTMLCanvasElement): void {
    const onResize = (): void => {
      if (!this.attached || !this.renderer) return;
      this.renderer.resize();
      this.updateLaneVars();
      // Đổi kích thước xóa backing store → vẽ lại ngay (callback chạy trước paint, không nháy).
      this.drawFrame();
    };
    // Cửa sổ chủ: ResizeObserver của chính nó (observer của tab gốc chỉ chạy theo nhịp render của
    // tab gốc — đứng khi tab bị ẩn).
    const h = this.host;
    const RO = h ? h.ResizeObserver : typeof ResizeObserver === 'function' ? ResizeObserver : null;
    if (typeof RO === 'function') {
      this.resizeObserver = new RO(onResize);
      this.resizeObserver.observe(canvas);
    } else {
      const target: Window = h ?? window;
      this.windowResize = onResize;
      this.windowResizeTarget = target;
      target.addEventListener('resize', onResize);
    }
  }

  /** Đặt --lane-left/--lane-right theo layout canvas để keycap thẳng hàng với lane. */
  private updateLaneVars(): void {
    const st = this.stage;
    const L = this.renderer?.layout;
    if (!st || !L || L.orientation !== 'vertical') return;
    const left = Math.round(L.laneArea.x);
    const right = Math.max(0, Math.round(L.width - L.laneArea.x - L.laneArea.w));
    if (left === this.laneLeft && right === this.laneRight) return;
    this.laneLeft = left;
    this.laneRight = right;
    st.style.setProperty('--lane-left', `${left}px`);
    st.style.setProperty('--lane-right', `${right}px`);
  }

  // -------------------------------------------------------------------------
  // Nội bộ: đếm ngược trước khi phát
  // -------------------------------------------------------------------------

  private beginCountdown(seconds: number): void {
    this.clearCountdownTimer();
    // Đang trong gesture: mở khóa âm thanh ngay để hết đếm là phát được trên audio clock.
    this.ensureAudio(true);
    this.countdownLeft = seconds;
    this.countdownTimer = this.hostSetTimeout(this.onCountdownTick, 1000);
    this.patch({ countdown: seconds });
    this.sync(true);
    // Ô đứng yên ở frame đầu của đếm vào suốt lúc đếm ngược (preRoll).
    this.requestFrame();
  }

  private readonly onCountdownTick = (): void => {
    this.countdownTimer = null;
    if (!this.attached) return;
    this.countdownLeft--;
    if (this.countdownLeft > 0) {
      this.countdownTimer = this.hostSetTimeout(this.onCountdownTick, 1000);
      this.patch({ countdown: this.countdownLeft });
      return;
    }
    // Phát (hoặc chờ unlock) TRƯỚC khi bỏ số đếm: không có lúc nào engine (và tin follow cho overlay) đứng
    // ở điểm bắt đầu không kèm frame đầu đếm vào → ô không nhảy giữa đếm ngược và đếm vào.
    if (this.hasNotes()) this.start(undefined);
    this.patch({ countdown: null });
    this.sync(true);
    this.requestFrame();
  };

  private clearCountdownTimer(): void {
    if (this.countdownTimer === null) return;
    this.hostClearTimeout(this.countdownTimer);
    this.countdownTimer = null;
  }

  // -------------------------------------------------------------------------
  // Nội bộ: practice
  // -------------------------------------------------------------------------

  private createSession(): void {
    const s = useSettings.getState();
    const session = new PracticeSession(this.tl, {
      mode: s.practiceMode,
      midiPitchClassOnly: s.midiPitchClassOnly,
    });
    session.reset(this.positionBeat());
    this.session = session;
    this.lastFlash = null;
  }

  /** Lượt chơi mới từ `fromBeat` (seek / restart / đổi chế độ; loop wrap: `onExternalJump`). */
  private resetPractice(fromBeat: number): void {
    const session = this.session;
    if (!session) return;
    session.reset(fromBeat);
    this.lastFlash = null;
    this.publishPractice();
    this.requestFrame();
  }

  /**
   * Trước mỗi lần bắt đầu phát: phát lại sau khi đã xong bài (hoặc từ cuối bài) = lượt mới;
   * phát tiếp sau Pause thì giữ kết quả.
   */
  private preparePracticeRun(fromBeat: number | undefined): void {
    const session = this.session;
    if (!session) return;
    let from = fromBeat;
    if (from === undefined) {
      const at = this.transport.getBeat();
      if (at >= this.transport.endBeat) from = 0;
      else if (session.finished || this.results !== null) from = Math.max(0, at);
    }
    this.results = null;
    if (from !== undefined) session.reset(from);
    this.publishPractice();
  }

  private connectPracticeInputs(): void {
    this.disconnectPracticeInputs();
    if (!this.attached || !this.practiceOn) return;
    const s = useSettings.getState();
    // Kiểu điều khiển Mobile (góp ý 2026-10-15): luyện tập CHỈ bằng chạm / giữ trên bàn nút của màn hình
    // (MobilePad gọi thẳng handlePracticeInput; click chuột lên bàn nút cũng tính) — không nghe bàn phím,
    // chuột-modifier trên khu tiles hay đàn MIDI.
    if (s.controlScheme === 'mobile') return;
    // Không có stage (test) → vùng chuột là phần tử rời, không nhận gì. Cửa sổ chủ (PiP): phím
    // nghe trên chính cửa sổ đó.
    const win: Window = this.host ?? window;
    const surface = this.surface ?? win.document.createElement('div');
    this.detachInput = attachPracticeInput(
      { window: win, surface },
      { onEvent: this.onPracticeEvent },
    );
    this.connectMidi(s);
  }

  private disconnectPracticeInputs(): void {
    this.detachInput?.();
    this.detachInput = null;
    this.unsubMidi?.();
    this.unsubMidi = null;
    this.midiToken++;
    this.midiStatus = 'off';
    this.session?.releaseModifiers();
    this.keysDown.clear();
    this.midiDown.clear();
    this.patch({ pressed: NO_PRESSED });
  }

  /**
   * MIDI: chỉ khi người dùng đã bật trong Cài đặt và chọn thiết bị (quyền xin ở Cài đặt). Trạng
   * thái HUD theo thực tế: chờ quyền → đang nghe / bị từ chối / thiết bị chưa cắm (theo hot-plug).
   */
  private connectMidi(s: Settings): void {
    const id = s.midiInputId;
    if (!s.midiEnabled || id === null || !isWebMidiSupported()) return;
    const mgr = getMidiInputManager();
    const token = ++this.midiToken;
    const offEvent = mgr.onEvent(this.onMidiEvent);
    const offDevices = mgr.onDevicesChange(() => {
      if (token === this.midiToken) this.refreshMidiStatus(mgr, id);
    });
    this.unsubMidi = () => {
      offEvent();
      offDevices();
    };
    if (mgr.selectedId !== id) mgr.select(id);
    if (mgr.enabled) {
      this.refreshMidiStatus(mgr, id);
      return;
    }
    // Đã cho phép ở Cài đặt (vd. trước khi tải lại trang) → lấy lại quyền để nghe thiết bị.
    this.midiStatus = 'pending';
    void mgr.enable().then(
      (res) => {
        if (token !== this.midiToken) return;
        if (res === 'ok') this.refreshMidiStatus(mgr, id);
        else this.setMidiStatus('denied');
      },
      () => {
        if (token === this.midiToken) this.setMidiStatus('denied');
      },
    );
  }

  private refreshMidiStatus(mgr: MidiInputManager, id: string): void {
    if (!mgr.enabled) return;
    this.setMidiStatus(mgr.connected && mgr.selectedId === id ? 'listening' : 'disconnected');
  }

  private setMidiStatus(status: PracticeMidiStatus): void {
    if (status === this.midiStatus) return;
    this.midiStatus = status;
    this.publishPractice();
  }

  private readonly onPracticeEvent = (ev: PracticeInputEvent): void => {
    this.handlePracticeInput(ev);
  };

  private readonly onMidiEvent = (e: LiveMidiEvent): void => {
    if (!this.practiceOn) return;
    // So khớp theo cao độ đã cộng offset transpose trong Cài đặt.
    const midi = transposeMidi(e.midi, midiMapOptionsFromSettings(useSettings.getState()));
    this.handlePracticeInput({
      type: e.type === 'on' ? 'midi-on' : 'midi-off',
      midi,
      velocity: e.velocity,
      source: 'midi',
      timeStamp: e.timeStamp,
    });
  };

  /** timeStamp (ms, trục performance.now) → beat trên clock của transport. */
  private readonly beatAtTimestamp = (timeStampMs: number): number => {
    let age = (nowMs() - timeStampMs) / 1000;
    if (!Number.isFinite(age) || age < 0 || age > MAX_INPUT_AGE_SEC) age = 0;
    return this.transport.timeToBeat(this.transport.clock.now() - age);
  };

  private onJudged(list: readonly Judgement[]): void {
    const last = list[list.length - 1];
    if (last) this.flash(last.grade, last.deltaMs, this.noteKey(last.noteIndex));
    this.publishPractice();
    this.requestFrame();
    this.checkResults();
  }

  private flash(
    kind: PracticeFlash['kind'],
    deltaMs: number | null,
    key: NoteKey | null,
    rightKey = false,
  ): void {
    this.flashSeq++;
    this.lastFlash = rightKey
      ? { kind, seq: this.flashSeq, deltaMs, key, rightKey }
      : { kind, seq: this.flashSeq, deltaMs, key };
  }

  /** Phím của nốt `index` (cột hiện kết quả trên bàn chạm); null nếu ngoài bài. */
  private noteKey(index: number): NoteKey | null {
    return this.tl.notes[index]?.key ?? null;
  }

  /** Xong hết nốt và transport đã dừng (hết bài / pause) → bảng kết quả. */
  private checkResults(): void {
    const session = this.session;
    if (!session || this.results !== null) return;
    if (this.transport.playing || this.waitHold !== null) return;
    const score = session.score();
    if (!session.finished || score.total === 0) return;
    this.results = score;
    this.publishPractice();
  }

  private holdAt(index: number): void {
    const note = this.tl.notes[index];
    if (!note) return;
    this.waitHold = index;
    this.own(() => {
      this.transport.pause();
      this.transport.seek(note.startBeat);
    }, false);
    if (this.guideAudible) {
      const sec = ((note.endBeat - note.startBeat) * 60) / this.transport.bpm;
      this.previewMidi(note.midi, Math.min(WAIT_PREVIEW_MAX_SEC, sec), false);
    }
    this.publishPractice();
    this.sync(true);
  }

  /** Bấm đúng nốt đang chờ → phát tiếp ngay sau đầu nốt (không phát lại nốt đó). */
  private releaseHold(): void {
    const index = this.waitHold;
    if (index === null) return;
    this.waitHold = null;
    const note = this.tl.notes[index];
    const from = note ? note.startBeat + RESUME_EPS_BEATS : this.transport.getBeat();
    this.own(() => this.transport.play({ fromBeat: from }));
    this.publishPractice();
  }

  /** Thôi chờ bấm; `resume` = phát tiếp từ nốt đang chờ (vd. tắt practice / đổi chế độ). */
  private clearHold(resume: boolean): void {
    const index = this.waitHold;
    if (index === null) return;
    this.waitHold = null;
    // Bỏ đánh dấu waiting của nốt (waitTarget với beat trước mọi nốt).
    this.session?.waitTarget(Number.NEGATIVE_INFINITY);
    const note = this.tl.notes[index];
    if (resume && note) this.own(() => this.transport.play({ fromBeat: note.startBeat }));
  }

  private publishPractice(): void {
    const session = this.session;
    if (!this.practiceOn || !session) {
      this.patch({ practice: null });
      return;
    }
    this.patch({
      practice: {
        mode: session.mode,
        waiting: this.waitHold !== null,
        score: session.score(),
        wrong: session.wrongPresses,
        last: this.lastFlash,
        results: this.results,
        guide: this.guideAudible,
        midi: this.midiStatus,
        next: session.nextNoteIndex,
      },
    });
  }

  private trackPressed(ev: PracticeInputEvent): void {
    switch (ev.type) {
      case 'key-down':
      case 'tap-down':
        this.keysDown.add(ev.key);
        break;
      case 'key-up':
      case 'tap-up':
        this.keysDown.delete(ev.key);
        break;
      case 'midi-on':
        if (ev.velocity > 0) {
          this.midiDown.set(
            ev.midi,
            mapMidiNote(ev.midi, {
              baseOctave: this.tl.baseOctave,
              scrollDir: this.tl.scrollDir,
              transposeSemitones: 0,
              transposeOctaves: 0,
            }),
          );
        } else {
          this.midiDown.delete(ev.midi);
        }
        break;
      case 'midi-off':
        this.midiDown.delete(ev.midi);
        break;
      default:
        break;
    }
  }

  /** Game bar: phím đang giữ + modifier đang giữ (bàn phím thay thế, chuột, hoặc từ nốt MIDI). */
  private updatePressed(): void {
    const held = this.session?.heldModifiers ?? NO_PRESSED;
    let { left, right, scroll } = held;
    const keys = new Set<NoteKey>(this.keysDown);
    for (const c of this.midiDown.values()) {
      if (!c) continue;
      keys.add(c.key);
      if (c.octave < 0) left = true;
      if (c.octave > 0) right = true;
      if (c.sharp) scroll = true;
    }
    const next: PressedInput = {
      keys: NOTE_KEYS.filter((k) => keys.has(k)),
      left,
      right,
      scroll,
    };
    if (samePressed(next, this.state.pressed)) return;
    this.patch({ pressed: keys.size === 0 && !left && !right && !scroll ? NO_PRESSED : next });
  }

  /** Tiếng phản hồi khi bấm (settings.practiceFeedback, mặc định tắt). */
  private feedback(ev: PracticeInputEvent, session: PracticeSession): void {
    if (!useSettings.getState().practiceFeedback) return;
    let midi: number | null = null;
    if (ev.type === 'key-down') {
      const p = keyboardPress(ev.key, session.heldModifiers);
      if (p) midi = noteMidi(p.key, p.octave, p.sharp, this.tl.baseOctave, this.tl.scrollDir);
    } else if (ev.type === 'tap-down') {
      midi = noteMidi(ev.key, ev.octave, ev.sharp, this.tl.baseOctave, this.tl.scrollDir);
    } else if (ev.type === 'midi-on') {
      midi = ev.midi;
    }
    if (midi !== null) this.previewMidi(midi, FEEDBACK_SEC, true);
  }

  /**
   * Phát một nốt ngay bằng synth của app. `gesture` = đang trong keydown/MIDI → được mở khóa.
   * Tiếng phản hồi (gesture) theo riêng settings.practiceFeedback (người gọi đã kiểm); nốt mẫu ở chế
   * độ chờ (không gesture) là giai điệu → cần settings.audioEnabled.
   */
  private previewMidi(midi: number, sec: number, gesture: boolean): void {
    const s = useSettings.getState();
    if ((!gesture && !s.audioEnabled) || !isAudioSupported()) return;
    const eng = getAudioEngine();
    if (!eng.ready) {
      if (!gesture) return;
      // Có giai điệu / click → gắn audio clock như khi Play; chỉ phản hồi → chỉ mở khóa context. Cả hai giữ phiên
      // "playback" của iPhone (cú chạm này muốn nghe — D-421).
      if (wantsAudio(s)) this.ensureAudio(true);
      else this.unlockFeedback(eng);
    } else if (gesture) {
      this.holdPlayback(eng);
    }
    eng.playPreview(midi, sec);
  }

  // -------------------------------------------------------------------------
  // Nội bộ: audio
  // -------------------------------------------------------------------------

  /** Click (đếm vào + metronome suốt bài) chỉ khi bật "Tiếng click" trong Cài đặt → Âm thanh. */
  private readonly schedulerOptions = (): SchedulerOptions => {
    const s = useSettings.getState();
    return { metronome: s.clickSound && s.metronome, clicks: s.clickSound, timbre: s.timbre };
  };

  /**
   * Timeline cho scheduler: giai điệu mẫu tắt (settings.audioEnabled) hoặc luyện tập mà tắt "nghe giai
   * điệu mẫu" → bản không có nốt (click đếm vào / metronome vẫn chạy nếu bật). Đổi object = scheduler
   * hủy nốt chưa phát và lên lịch lại.
   */
  private readonly scheduledTimeline = (): Timeline => {
    const melody = useSettings.getState().audioEnabled && (!this.practiceOn || this.guideAudible);
    if (melody) return this.tl;
    if (this.silentFor !== this.tl || this.silentTl === null) {
      this.silentFor = this.tl;
      this.silentTl = { ...this.tl, notes: [] };
    }
    return this.silentTl;
  };

  /**
   * Bật âm thanh nếu settings cho phép. `gesture` = đang trong handler của user gesture → được gọi
   * unlock(); ngoài gesture chỉ gắn khi AudioContext đã chạy sẵn. Trả true nếu đang chờ unlock
   * (kết quả về sau, khi đó lần Play đang chờ được chạy).
   */
  private ensureAudio(gesture: boolean): boolean {
    if (!this.attached) return false;
    const s = useSettings.getState();
    // Không giai điệu, không click → không đụng tới AudioContext (đếm vào chỉ bằng hình).
    if (!wantsAudio(s)) {
      this.patch({ audio: 'off' });
      return false;
    }
    if (!isAudioSupported()) {
      this.patch({ audio: 'unsupported' });
      return false;
    }
    const eng = getAudioEngine();
    applyAudioSettings(eng, s);
    const ctx = eng.context;
    if (ctx && eng.ready) {
      // Trong cú chạm: giữ phiên "playback" của iPhone kể cả khi context đã chạy sẵn (vd. mở khóa ở Cài đặt, hoặc
      // Chrome tạo sẵn lúc rảnh). Ngoài cú chạm: chỉ làm mới phiên đang giữ (iOS dừng phần tử im lặng sau cuộc gọi).
      if (gesture || this.playbackEngine === eng) this.holdPlayback(eng);
      this.attachAudio(eng, ctx);
      return false;
    }
    if (!gesture) return false;
    const token = ++this.audioToken;
    this.patch({ audio: 'starting' });
    let pending: Promise<boolean>;
    try {
      // iPhone: phiên "playback" TRƯỚC resume(), cùng cú chạm (AudioEngine.unlock).
      this.adoptPlayback(eng);
      pending = eng.unlock({ playback: this });
    } catch {
      pending = Promise.resolve(false);
    }
    // Đang chờ: cú này có thể không được tính là gesture (vd. `pointerdown` của ngón tay ở bàn nút) → pointerup /
    // touchend / click của chính cú chạm đó gọi resume() lại (D-422). Gắn được audio thì gỡ.
    if (!eng.ready) this.armAudioRetry();
    pending
      .catch(() => false)
      .then((ok) => {
        if (token !== this.audioToken || !this.attached) return;
        if (!wantsAudio(useSettings.getState())) {
          this.patch({ audio: 'off' });
        } else {
          const c = eng.context;
          if (ok && c && eng.ready) this.attachAudio(eng, c);
          else this.audioBlocked();
        }
        this.flushPendingPlay();
      });
    return true;
  }

  /**
   * Trang đã có user activation → tạo AudioContext sẵn lúc rảnh (sau khi Player vẽ xong), để
   * constructor chặn main thread không rơi vào lần bấm Play đầu tiên. Không có activation (mở thẳng
   * link) thì vẫn tạo trong gesture Play như cũ.
   */
  private scheduleWarm(): void {
    if (!this.attached || this.cancelWarm !== null) return;
    if (!wantsAudio(useSettings.getState()) || !isAudioSupported()) return;
    if (getAudioEngine().context !== null || !hasStickyActivation()) return;
    const run = (): void => {
      this.cancelWarm = null;
      if (!this.attached || !wantsAudio(useSettings.getState())) return;
      const eng = getAudioEngine();
      if (eng.context !== null || this.playPending) return; // Play đã tự tạo trong gesture
      eng.warm();
      this.ensureAudio(false);
    };
    const g = (this.host ?? globalThis) as {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    if (typeof g.requestIdleCallback === 'function') {
      const id = g.requestIdleCallback(run, { timeout: 500 });
      this.cancelWarm = () => g.cancelIdleCallback?.(id);
    } else {
      const id = this.hostSetTimeout(run, 50);
      this.cancelWarm = () => this.hostClearTimeout(id);
    }
  }

  /**
   * Mở khóa không thành (context vẫn không chạy sau UNLOCK_TIMEOUT_MS / bị từ chối): hình chạy tiếp, cú chạm kế tiếp
   * thử lại; câu nhắc MỘT lần mỗi lần tải trang — iPhone / iPad nhắc âm lượng, chế độ tập trung, nút gạt bên hông.
   */
  private audioBlocked(): void {
    this.audioFailed = true;
    this.patch({ audio: 'blocked' });
    this.armAudioRetry();
    showAudioHint();
  }

  /** Tiếng phản hồi khi giai điệu / click đều tắt: chỉ mở khóa context (không gắn audio clock) + giữ phiên. */
  private unlockFeedback(eng: AudioEngine): void {
    this.adoptPlayback(eng);
    let pending: Promise<boolean>;
    try {
      pending = eng.unlock({ playback: this });
    } catch {
      pending = Promise.resolve(false);
    }
    // Chạm bàn nút đến bằng `pointerdown` — Safari / Chrome chỉ tính pointerup / touchend của ngón tay là gesture → cú
    // thả tay của chính lần chạm này thử lại ngay (D-422), không phải đợi hết UNLOCK_TIMEOUT_MS.
    if (!eng.ready) this.armAudioRetry();
    pending
      .catch(() => false)
      .then((ok) => {
        const s = useSettings.getState();
        // Mở khóa được: thôi chờ cú chạm (giai điệu / click bật thì ensureAudio tự lo phần audio clock).
        if (ok) {
          if (!wantsAudio(s)) this.disarmAudioRetry();
        } else if (this.attached && this.soundWanted(s) && !eng.ready) {
          // Context vẫn không chạy sau lượt chờ: cú chạm kế tiếp thử lại + câu nhắc một lần mỗi trang (D-426 —
          // REQUIRED 2 áp cho cả tiếng phản hồi; cú `pointerdown` bị treo mà `pointerup` mở được thì lượt chờ này
          // cũng xong `true` qua statechange → không nhắc nhầm).
          this.armAudioRetry();
          showAudioHint();
        }
      });
  }

  /** Engine này sẽ giữ phiên "playback" trên `eng` (trả phiên trên engine cũ nếu singleton đã đổi). */
  private adoptPlayback(eng: AudioEngine): void {
    const prev = this.playbackEngine;
    if (prev && prev !== eng) prev.releasePlayback(this);
    this.playbackEngine = eng;
  }

  /** Giữ phiên "playback" (iPhone) trên `eng` — chỉ gọi trong cú chạm muốn nghe, hoặc làm mới phiên đang giữ. */
  private holdPlayback(eng: AudioEngine): void {
    this.adoptPlayback(eng);
    eng.holdPlayback(this);
  }

  private releasePlayback(): void {
    const eng = this.playbackEngine;
    this.playbackEngine = null;
    eng?.releasePlayback(this);
  }

  /** Không còn tiếng nào (hoặc rời màn chơi): trả phiên, thôi chờ cú chạm / context chạy lại. */
  private releaseSound(): void {
    this.disarmAudioRetry();
    this.unwatchAudio();
    this.releasePlayback();
  }

  /**
   * Có tiếng nào đang được muốn không: giai điệu / click (wantsAudio), hoặc tiếng phản hồi khi đang luyện tập.
   * Quyết định giữ phiên "playback" và chờ cú chạm để mở khóa lại.
   */
  private soundWanted(s: Settings): boolean {
    return wantsAudio(s) || (s.practiceFeedback && this.practiceOn);
  }

  /**
   * Context không chạy mà vẫn muốn tiếng (bị chặn / 'suspended' / 'interrupted'): cú chạm / phím kế tiếp ở bất cứ đâu
   * trên cửa sổ chủ (Phát, bàn nút, nút loa…) thử mở khóa lại trong chính cú đó. Chỉ gắn SAU một lần thử — không
   * bao giờ lúc tải trang.
   */
  private armAudioRetry(): void {
    if (this.retryOff !== null || !this.attached) return;
    const win: Window = this.host ?? window;
    const onGesture = this.onAudioRetryGesture;
    for (const type of AUDIO_RETRY_EVENTS) {
      win.addEventListener(type, onGesture, { capture: true, passive: true });
    }
    this.retryOff = () => {
      for (const type of AUDIO_RETRY_EVENTS) {
        win.removeEventListener(type, onGesture, { capture: true });
      }
    };
  }

  private disarmAudioRetry(): void {
    const off = this.retryOff;
    this.retryOff = null;
    off?.();
  }

  /** Đang chờ cú chạm kế tiếp để mở khóa lại âm thanh (test / chẩn đoán). */
  get audioRetryArmed(): boolean {
    return this.retryOff !== null;
  }

  private readonly onAudioRetryGesture = (): void => {
    const s = useSettings.getState();
    if (!this.attached || !this.soundWanted(s) || !isAudioSupported()) {
      this.disarmAudioRetry();
      return;
    }
    const eng = getAudioEngine();
    if (wantsAudio(s)) {
      // Đã chạy + đã gắn → xong; còn lại: mở khóa (+ giữ phiên) trong cú này, như bấm Phát.
      if (eng.ready && this.audioActive && this.audioCtx === eng.context) {
        this.holdPlayback(eng);
        this.disarmAudioRetry();
        return;
      }
      this.ensureAudio(true);
      return;
    }
    // Chỉ tiếng phản hồi (luyện tập).
    if (eng.ready) {
      this.holdPlayback(eng);
      this.disarmAudioRetry();
    } else {
      this.unlockFeedback(eng);
    }
  };

  /** Chờ context tự chạy lại (iOS sau cuộc gọi / Siri) → gắn lại audio clock, không cần cú chạm. */
  private watchAudio(eng: AudioEngine): void {
    if (this.unsubAudioWatch !== null) return;
    this.unsubAudioWatch = eng.subscribe(() => {
      if (!this.attached || !wantsAudio(useSettings.getState())) {
        this.unwatchAudio();
        return;
      }
      if (eng.context && eng.ready && !this.audioActive) {
        this.unwatchAudio();
        this.ensureAudio(false);
      }
    });
  }

  private unwatchAudio(): void {
    const off = this.unsubAudioWatch;
    this.unsubAudioWatch = null;
    off?.();
  }

  private attachAudio(eng: AudioEngine, ctx: AudioContext): void {
    if (this.audioCtx !== ctx || this.schedulerOwner !== eng || !this.scheduler?.running) {
      this.detachAudio();
      let scheduler = this.scheduler;
      if (!scheduler || this.schedulerOwner !== eng) {
        scheduler?.dispose();
        scheduler = new AudioScheduler(eng);
        this.scheduler = scheduler;
        this.schedulerOwner = eng;
      }
      this.audioCtx = ctx;
      this.unsubAudio = eng.subscribe(this.onAudioEngineChange);
      // Giữ nguyên beat + trạng thái phát; từ giờ hình bám theo thời điểm nghe thấy. Đang phát thì
      // transport neo lại sau `lead` (output latency) để nốt từ đây trở đi kịp lên lịch đúng giờ.
      this.transport.setClock(createAudioClock(ctx));
      scheduler.start(this.transport, this.scheduledTimeline, this.schedulerOptions);
    }
    this.audioFailed = false;
    this.disarmAudioRetry();
    this.unwatchAudio();
    this.patch({ audio: 'on' });
    this.syncPump();
  }

  /**
   * Context bị suspend / 'interrupted' (iOS: cuộc gọi, Siri, app khác) / đóng từ bên ngoài → về performance clock để
   * hình không bị đứng; vẫn muốn tiếng thì chờ context tự chạy lại và thử resume() ở cú chạm kế tiếp (D-422).
   */
  private readonly onAudioEngineChange = (): void => {
    const eng = this.schedulerOwner;
    if (!this.audioCtx || !eng) return;
    if (eng.context !== this.audioCtx || !eng.ready) {
      this.detachAudio();
      const wanted = wantsAudio(useSettings.getState());
      this.patch({ audio: initialAudioStatus(wanted) });
      if (wanted && this.attached) {
        this.watchAudio(eng);
        this.armAudioRetry();
      }
    }
  };

  private detachAudio(): void {
    this.unsubAudio?.();
    this.unsubAudio = null;
    this.scheduler?.stop();
    this.audioCtx = null;
    if (this.transport.clock !== this.baseClock) this.transport.setClock(this.baseClock);
    this.syncPump();
  }
}

// ---------------------------------------------------------------------------
// React hooks
// ---------------------------------------------------------------------------

export interface UsePlayerEngineArgs {
  timeline: Timeline;
  songBpm: number;
  /** Chỉ đọc lúc tạo engine. */
  initialBeat?: number;
  /** Chỉ đọc lúc tạo engine: phát ngay, không đếm vào / đếm ngược (màn chơi thử). */
  instantStart?: boolean;
  /** Chỉ đọc lúc tạo engine: cửa sổ chủ của canvas (PlayerEngineOptions.hostWindow). */
  hostWindow?: Window;
  /** Chỉ đọc lúc tạo engine: option canvas cố định (PlayerEngineOptions.rendererOptions). */
  rendererOptions?: Partial<RendererOptions>;
  /** Chỉ đọc lúc tạo engine: bàn nút kiểu game khi điều khiển Mobile (PlayerEngineOptions.mobilePad). */
  mobilePad?: boolean;
  canvasRef: RefObject<HTMLCanvasElement | null>;
  stageRef?: RefObject<HTMLElement | null>;
}

/**
 * Một PlayerEngine cho mỗi lần mount (đổi bài → component cha đổi `key` để mount lại).
 * attach trong effect, detach khi unmount: hủy rAF, dừng scheduler, gỡ mọi listener.
 */
export function usePlayerEngine({
  timeline,
  songBpm,
  initialBeat,
  instantStart,
  hostWindow,
  rendererOptions,
  mobilePad,
  canvasRef,
  stageRef,
}: UsePlayerEngineArgs): PlayerEngine {
  const [engine] = useState(
    () =>
      new PlayerEngine(timeline, songBpm, {
        initialBeat,
        instantStart,
        hostWindow,
        rendererOptions,
        mobilePad,
      }),
  );
  useEffect(() => {
    engine.attach({ canvas: canvasRef.current, stage: stageRef?.current ?? null });
    return () => engine.detach();
  }, [engine, canvasRef, stageRef]);
  useEffect(() => {
    engine.setTimeline(timeline);
  }, [engine, timeline]);
  useEffect(() => {
    engine.setSongBpm(songBpm);
  }, [engine, songBpm]);
  return engine;
}

/** Đọc một phần state của engine; chỉ re-render khi giá trị chọn đổi (so sánh ===). */
export function usePlayerState<T>(engine: PlayerEngine, select: (s: PlayerUiState) => T): T {
  return useSyncExternalStore(
    engine.subscribe,
    () => select(engine.getState()),
    () => select(engine.getState()),
  );
}

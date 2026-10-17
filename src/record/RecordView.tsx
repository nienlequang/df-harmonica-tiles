import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import type { AudioEngine } from '../audio/engine';
import { getAudioEngine, isAudioSupported } from '../audio/engine';
import { scheduleClick } from '../audio/metronome';
import type { Voice } from '../audio/synth';
import { GAME_SCROLL_DIR, NOTE_KEYS, modifiersOf, noteMidi } from '../core/keys';
import { jianpuLabel } from '../core/mobile';
import type { Modifiers, NoteKey, TimeSig } from '../core/types';
import { installHashGuard } from '../editor/hashGuard';
import type { StringKey } from '../i18n/strings';
import { useT } from '../i18n/useT';
import { openDraftSong, useLibrary } from '../library/store';
import { createAudioClock } from '../player/clock';
import { GameBar, JianpuDigit } from '../player/GameBar';
import { MOBILE_BUTTONS } from '../player/mobilePlan';
import type { MobileButton } from '../player/mobilePlan';
import { attachPracticeInput } from '../player/practiceInput';
import type { PracticeInputEvent } from '../player/practice.types';
import { Button, Modal, Select, Toggle } from '../ui/components';
import type { SelectOption } from '../ui/components';
import { FEATURES } from '../ui/features';
import { useModifierLabels } from '../ui/modLabels';
import { tileColorKey } from '../ui/palette';
import { href, navigate, paths } from '../ui/router';
import { getSettings, useSettings } from '../ui/settings';
import { toast } from '../ui/toast';
import { RecordRoll } from './RecordRoll';
import type { RollNote } from './RecordRoll';
import {
  MobileCapture,
  PcCapture,
  RECORD_GRIDS,
  beatsPerBar,
  hitsToHarm,
  quantizeHits,
  takeSummary,
} from './recorder';
import type { CapturePressed, RecordedHit, SoundingHit } from './recorder';
import './record.css';

/**
 * Màn "Tự chơi để tạo bài" (route `#/record`, SPEC 2026-10-14 Phase 3b): chọn tên / BPM / nhịp /
 * lưới → "● Thu" → đếm vào 1 ô nhịp BẰNG HÌNH (đèn nhịp 4-3-2-1; tiếng click chỉ khi bật trong Cài
 * đặt) → bấm như trong game, ô hiện ngay trên cuộn nốt + game bar → "■ Dừng" → xem bản thu (số nốt,
 * độ dài, cuộn nốt đã quantize) → Thu lại / Hoàn tác / Mở trong Editor.
 *
 * - PC: attachPracticeInput (phím Z…, giữ chuột trên khung thu — không có phím bàn phím thay chuột)
 *   chỉ gắn trong lúc đếm vào / thu. Mobile: 8 nút số + 4 nút chế độ trên màn hình (chỉ con trỏ / chạm,
 *   không nhận phím số).
 * - Trục thời gian: performance.now(); timeStamp của sự kiện được dùng nếu cùng trục.
 * - Tiếng phản hồi khi bấm: toggle riêng của màn này (mặc định tắt), không đổi Cài đặt.
 * - Rời trang khi đang thu / còn bản thu chưa mở: hộp thoại xác nhận (như "Tạo bài từ file").
 */

export const RECORD_BPM_MIN = 40;
export const RECORD_BPM_MAX = 200;
export const RECORD_BPM_DEFAULT = 90;
export const RECORD_TIME_SIGS: readonly TimeSig[] = [
  { num: 4, den: 4 },
  { num: 3, den: 4 },
  { num: 6, den: 8 },
];
/** Chu kỳ cập nhật hình + lên lịch click (ms). */
export const RECORD_TICK_MS = 50;
/** Trễ trước beat đầu của ô nhịp đếm vào (giây). */
export const RECORD_START_LEAD_SEC = 0.12;
/** Tự dừng sau ngần này phút (quên tắt). */
export const RECORD_MAX_MINUTES = 15;
/** Giữ tối đa ngần này bản thu để Hoàn tác. */
const MAX_TAKES = 10;
/** Lên lịch click trước (giây). */
const CLICK_LOOKAHEAD_SEC = 0.15;
/** Số ô nhịp hiện trong cuộn nốt lúc thu. */
const LIVE_BARS = 4;
/** Đèn nhịp sáng mạnh trong phần đầu mỗi beat. */
const FLASH_FRACTION = 0.3;
/** Tiếng phản hồi: độ dài tối đa (giây) — nhả phím thì dừng sớm. */
const FEEDBACK_MAX_SEC = 8;
/** timeStamp sự kiện lệch performance.now() hơn ngần này (ms) → trục khác, dùng now(). */
const EVENT_SKEW_MS = 1000;
/** Bề rộng tối thiểu (px) mỗi beat của cuộn nốt bản thu (dài thì cuộn ngang). */
const PREVIEW_PX_PER_BEAT = 32;
const PREVIEW_MAX_WIDTH = 8000;

const GRID_KEYS: readonly StringKey[] = [
  'midi.grid.quarter',
  'midi.grid.eighth',
  'midi.grid.triplet',
  'midi.grid.off',
];

type Phase = 'idle' | 'arming' | 'countin' | 'recording';

interface Take {
  id: number;
  hits: RecordedHit[];
  /** performance-ms của beat 0. */
  startMs: number;
  bpm: number;
  timeSig: TimeSig;
}

interface Setup {
  bpm: number;
  timeSig: TimeSig;
}

interface Session extends Setup {
  /** Beat (đen) mỗi ô nhịp. */
  bpb: number;
  /** Giây mỗi beat. */
  spb: number;
  /** performance-ms của beat 0 (hết đếm vào). */
  beat0: number;
  audio: { ctx: AudioContext; dest: AudioNode; a0: number; next: number } | null;
  clicks: Set<Voice>;
  timer: ReturnType<typeof setInterval>;
  /** PC: bộ ghi của phiên (null = Mobile, dùng bộ ghi của nút cảm ứng). */
  pc: PcCapture | null;
  detach: (() => void) | null;
}

interface LiveState {
  pressed: CapturePressed;
  sounding: SoundingHit | null;
}

const NO_LIVE: LiveState = {
  pressed: { keys: [], left: false, right: false, scroll: false },
  sounding: null,
};

const nowMs = (): number =>
  typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();

/** timeStamp của sự kiện nếu cùng trục performance.now() (trình duyệt hiện đại), không thì now(). */
function eventTime(ts: number): number {
  const n = nowMs();
  return Number.isFinite(ts) && ts <= n + 1 && n - ts < EVENT_SKEW_MS ? ts : n;
}

const tsKey = (ts: TimeSig): string => `${ts.num}/${ts.den}`;

/** BPM gõ tay hợp lệ (40..200), không thì null. */
export function parseRecordBpm(text: string): number | null {
  if (text.trim() === '') return null;
  const n = Number(text);
  return Number.isFinite(n) && n >= RECORD_BPM_MIN && n <= RECORD_BPM_MAX ? n : null;
}

function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000 + 1e-6));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function formatHm(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function applyAudioSettings(engine: AudioEngine): void {
  const s = getSettings();
  engine.setMusicVolume(s.musicVolume);
  engine.setClickVolume(s.clickVolume);
  engine.setTimbre(s.timbre);
}

/** Beat hiện tại của phiên (âm khi đang đếm vào). */
function beatOf(s: Session, at: number): number {
  return (at - s.beat0) / 1000 / s.spb;
}

/** Đèn nhịp: một đèn mỗi beat của ô nhịp, đèn của beat hiện tại sáng (đầu beat sáng mạnh). */
function BeatLamps({ count, beat, label }: { count: number; beat: number | null; label: string }) {
  const n = Math.max(1, Math.round(count));
  const floor = beat === null ? null : Math.floor(beat);
  const index = floor === null ? -1 : ((floor % n) + n) % n;
  const flash = beat !== null && floor !== null && beat - floor < FLASH_FRACTION;
  return (
    <span className="rec-lamps" role="img" aria-label={label}>
      {Array.from({ length: n }, (_, i) => (
        <span
          key={i}
          className={[
            'rec-lamp',
            i === 0 && 'is-downbeat',
            i === index && 'is-on',
            i === index && flash && 'is-flash',
          ]
            .filter(Boolean)
            .join(' ')}
        />
      ))}
    </span>
  );
}

interface MobilePadProps {
  capture: MobileCapture;
  /** Nốt đang kêu (tô màu theo chế độ đã bấm). */
  sounding: SoundingHit | null;
  onNoteDown: (key: NoteKey, e: ReactPointerEvent<HTMLButtonElement>) => void;
  onNoteUp: (key: NoteKey, e: ReactPointerEvent<HTMLButtonElement>) => void;
  onMode: (b: MobileButton) => void;
}

/**
 * Nút cảm ứng kiểu Mobile của game (docs/GAME-UI-REFERENCE.md "Bản mobile"): hàng chế độ Nửa Cung ·
 * Ngẩng Lên · Ngẩng Tự Nhiên · Cúi Xuống (chạm để chọn, giữ trạng thái — aria-pressed), hàng 8 nút
 * tròn số giản phổ (chấm theo chế độ quãng). Nút số chỉ nhận con trỏ / chạm (không nhận phím).
 */
function MobilePad({ capture, sounding, onNoteDown, onNoteUp, onMode }: MobilePadProps) {
  const t = useT();
  const labels = useModifierLabels();
  const mode = capture.mode;
  const selected: MobileButton = mode < 0 ? 'left' : mode > 0 ? 'right' : 'natural';
  const down = capture.pressedKeys;
  const tone = sounding ? tileColorKey(modifiersOf(sounding.octave, sounding.sharp)) : null;
  return (
    <div className="rec-pad" role="group" aria-label={t('record.pad.aria')}>
      <div className="rec-pad-modes" role="group" aria-label={t('record.pad.modes')}>
        {MOBILE_BUTTONS.map((b) => {
          const on = b === 'scroll' ? capture.semitoneOn : b === selected;
          return (
            <button
              key={b}
              type="button"
              className={['rec-pad-mode', `rec-pad-mode-${b}`, on && 'is-on']
                .filter(Boolean)
                .join(' ')}
              data-mode={b}
              aria-pressed={on}
              onClick={() => onMode(b)}
            >
              <span className="rec-pad-mode-dot" aria-hidden="true" />
              <span className="rec-pad-mode-name">{labels[b]}</span>
            </button>
          );
        })}
      </div>
      <div className="rec-pad-digits" role="group" aria-label={t('record.pad.digits')}>
        {NOTE_KEYS.map((k) => {
          const pressed = down.includes(k);
          const lit = sounding?.key === k && tone !== null;
          return (
            <button
              key={k}
              type="button"
              className={[
                'rec-pad-digit',
                pressed && 'is-pressed',
                lit && `is-lit rec-tone-${tone}`,
              ]
                .filter(Boolean)
                .join(' ')}
              data-key={k}
              // chỉ nhận con trỏ / chạm: không làm điểm dừng Tab vô dụng
              tabIndex={-1}
              onPointerDown={(e) => onNoteDown(k, e)}
              onPointerUp={(e) => onNoteUp(k, e)}
              onPointerLeave={(e) => onNoteUp(k, e)}
              onPointerCancel={(e) => onNoteUp(k, e)}
              onContextMenu={(e) => e.preventDefault()}
            >
              <JianpuDigit label={jianpuLabel(k, mode)} />
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function RecordView() {
  const t = useT();
  const labels = useModifierLabels();
  const scheme = useSettings((s) => s.controlScheme);
  const mobileSemitone = useSettings((s) => s.mobileSemitone);
  const clickSound = useSettings((s) => s.clickSound);

  const titleId = useId();
  const bpmId = useId();
  const songTitleId = useId();
  const resultTitleId = useId();

  const [mountedAt] = useState(() => new Date());
  const [title, setTitle] = useState('');
  const [bpm, setBpm] = useState(RECORD_BPM_DEFAULT);
  const [bpmText, setBpmText] = useState(String(RECORD_BPM_DEFAULT));
  const [timeSigKey, setTimeSigKey] = useState('4/4');
  const [gridIndex, setGridIndex] = useState(0);
  const [feedback, setFeedback] = useState(false);
  const [phase, setPhase] = useState<Phase>('idle');
  const [now, setNow] = useState(0);
  const [takes, setTakes] = useState<Take[]>([]);
  /** Thông báo (key i18n — đổi ngôn ngữ thì dịch lại). */
  const [message, setMessage] = useState<StringKey | null>(null);
  const [live, setLive] = useState<LiveState>(NO_LIVE);
  const [, setPadVersion] = useState(0);
  const [pendingLeave, setPendingLeave] = useState<string | null>(null);

  const sessionRef = useRef<Session | null>(null);
  const tokenRef = useRef(0);
  const takeSeq = useRef(0);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const stopRef = useRef<HTMLButtonElement>(null);
  const resultRef = useRef<HTMLElement>(null);
  const voiceRef = useRef<Voice | null>(null);
  const mobileRef = useRef<MobileCapture | null>(null);
  if (mobileRef.current === null) mobileRef.current = new MobileCapture(mobileSemitone);
  const mobile = mobileRef.current;
  /** Giá trị mới nhất cho callback ổn định (listener, cleanup). */
  const latest = useRef({ feedback, grid: 0.25 as number, busy: false, hasTake: false });
  const createdRef = useRef(false);
  /** Vừa dừng thu có bản mới → đưa focus tới phần kết quả. */
  const focusResultRef = useRef(false);
  /** Vừa bấm Thu → đưa focus tới nút Dừng. */
  const focusStopRef = useRef(false);

  const timeSig = RECORD_TIME_SIGS.find((ts) => tsKey(ts) === timeSigKey) ?? RECORD_TIME_SIGS[0];
  const grid = RECORD_GRIDS[gridIndex] ?? 0.25;
  const busy = phase !== 'idle';
  const current = takes.length > 0 ? takes[takes.length - 1] : null;
  useLayoutEffect(() => {
    latest.current = { feedback, grid, busy, hasTake: current !== null };
  });

  useEffect(() => {
    mobile.semitone = mobileSemitone;
  }, [mobile, mobileSemitone]);

  /**
   * Phiên "playback" của iPhone (kêu cả khi gạt nút im lặng — D-421, D-426): object này là holder; `engine` = engine
   * đang giữ (null = không giữ). Xin trong cú bấm cần tiếng (Thu khi bật click / tiếng phản hồi, bật tiếng phản hồi) —
   * `unlock({ playback })` đặt TRƯỚC resume(); trả khi hết tiếng (dừng thu mà tiếng phản hồi tắt, tắt tiếng phản hồi
   * lúc không có click) và khi rời màn. Âm thanh tắt (mặc định) thì không đụng tới.
   */
  const playbackRef = useRef<{ engine: AudioEngine | null }>({ engine: null });
  const holdSound = (engine: AudioEngine): Promise<boolean> => {
    const holder = playbackRef.current;
    if (holder.engine !== null && holder.engine !== engine) holder.engine.releasePlayback(holder);
    holder.engine = engine;
    return engine.unlock({ playback: holder }); // trong gesture
  };
  const releaseSound = useCallback(() => {
    const holder = playbackRef.current;
    const engine = holder.engine;
    holder.engine = null;
    engine?.releasePlayback(holder);
  }, []);

  // ── tiếng phản hồi (toggle riêng của màn này) ──
  const sound = useCallback((before: SoundingHit | null, after: SoundingHit | null) => {
    if (before === after) return;
    voiceRef.current?.stop();
    voiceRef.current = null;
    if (!after || !latest.current.feedback || !isAudioSupported()) return;
    const s = getSettings();
    const midi = noteMidi(after.key, after.octave, after.sharp, s.baseOctave, GAME_SCROLL_DIR);
    voiceRef.current = getAudioEngine().playPreview(midi, FEEDBACK_MAX_SEC);
  }, []);

  // ── phiên thu ──
  const stopSession = useCallback(
    (save: boolean) => {
      const s = sessionRef.current;
      if (!s) return;
      sessionRef.current = null;
      tokenRef.current++;
      clearInterval(s.timer);
      for (const v of Array.from(s.clicks)) v.stop();
      s.clicks.clear();
      s.detach?.();
      const end = nowMs();
      const recorder = s.pc ? s.pc.recorder : mobileRef.current?.recorder;
      const hits = recorder ? recorder.stop(end) : [];
      voiceRef.current?.stop();
      voiceRef.current = null;
      // Hết click; tiếng phản hồi tắt thì màn này không còn tiếng → trả phiên "playback" (D-426).
      if (!latest.current.feedback) releaseSound();
      if (!save) return;
      setPhase('idle');
      setLive(NO_LIVE);
      if (end < s.beat0) {
        setMessage('record.cancelled');
        return;
      }
      const take: Take = {
        id: ++takeSeq.current,
        hits,
        startMs: s.beat0,
        bpm: s.bpm,
        timeSig: { ...s.timeSig },
      };
      const placed = quantizeHits(hits, {
        bpm: s.bpm,
        startMs: s.beat0,
        grid: latest.current.grid,
      });
      if (placed.length === 0) {
        setMessage('record.empty');
        return;
      }
      setMessage(null);
      focusResultRef.current = true;
      setTakes((prev) => [...prev, take].slice(-MAX_TAKES));
    },
    // ổn định suốt đời component: cleanup lúc unmount không chạy lại khi đổi ngôn ngữ (releaseSound cũng ổn định)
    [releaseSound],
  );

  const tick = useCallback(() => {
    const s = sessionRef.current;
    if (!s) return;
    const n = nowMs();
    if (s.audio) {
      const { ctx, dest } = s.audio;
      const horizon = ctx.currentTime + CLICK_LOOKAHEAD_SEC;
      const perBar = Math.max(1, Math.round(s.bpb));
      for (;;) {
        const k = s.audio.next;
        const when = s.audio.a0 + k * s.spb;
        if (when >= horizon) break;
        let voice: Voice | null = null;
        voice = scheduleClick(ctx, dest, when, k % perBar === 0, () => {
          if (voice) s.clicks.delete(voice);
        });
        s.clicks.add(voice);
        s.audio.next = k + 1;
      }
    }
    const beat = beatOf(s, n);
    setNow(n);
    setPhase(beat < 0 ? 'countin' : 'recording');
    if (beat * s.spb > RECORD_MAX_MINUTES * 60) stopSession(true);
  }, [stopSession]);

  const onPcEvent = useCallback(
    (ev: PracticeInputEvent) => {
      const s = sessionRef.current;
      const cap = s?.pc;
      if (!cap) return;
      const before = cap.recorder.sounding;
      if (!cap.handle({ ...ev, timeStamp: eventTime(ev.timeStamp) })) return;
      sound(before, cap.recorder.sounding);
      setLive({ pressed: cap.pressed, sounding: cap.recorder.sounding });
    },
    [sound],
  );

  const begin = useCallback(
    (setup: Setup, engine: AudioEngine | null) => {
      if (sessionRef.current) return;
      const bpb = beatsPerBar(setup.timeSig);
      const spb = 60 / setup.bpm;
      const perf = nowMs();
      const ctx = engine?.getContext() ?? null;
      const dest = engine?.clickDestination() ?? null;
      let audio: Session['audio'] = null;
      let beat0: number;
      if (ctx && dest && ctx.state === 'running') {
        const a0 = ctx.currentTime + RECORD_START_LEAD_SEC;
        // click lên lịch tại a0 được NGHE thấy lúc đồng hồ audio "đang nghe" đọc a0
        const heard = createAudioClock(ctx).now();
        beat0 = perf + (a0 + bpb * spb - heard) * 1000;
        audio = { ctx, dest, a0, next: 0 };
      } else {
        beat0 = perf + (RECORD_START_LEAD_SEC + bpb * spb) * 1000;
      }
      let pc: PcCapture | null = null;
      let detach: (() => void) | null = null;
      if (getSettings().controlScheme === 'mobile') {
        mobileRef.current?.recorder.reset();
      } else {
        pc = new PcCapture();
        const surface = surfaceRef.current ?? document.createElement('div');
        detach = attachPracticeInput({ window, surface }, { onEvent: onPcEvent });
      }
      sessionRef.current = {
        ...setup,
        timeSig: { ...setup.timeSig },
        bpb,
        spb,
        beat0,
        audio,
        clicks: new Set(),
        timer: setInterval(() => tick(), RECORD_TICK_MS),
        pc,
        detach,
      };
      tick();
    },
    [onPcEvent, tick],
  );

  const start = () => {
    if (busy || sessionRef.current) return;
    setMessage(null);
    focusStopRef.current = true;
    const setup: Setup = { bpm, timeSig: { ...timeSig } };
    const s = getSettings();
    let engine: AudioEngine | null = null;
    let unlock: Promise<boolean> = Promise.resolve(false);
    if ((s.clickSound || feedback) && isAudioSupported()) {
      engine = getAudioEngine();
      applyAudioSettings(engine);
      unlock = holdSound(engine); // trong gesture, kèm phiên "playback" của iPhone
    }
    if (!s.clickSound) {
      // Đếm vào chỉ bằng hình: bắt đầu ngay, không chờ âm thanh.
      begin(setup, null);
      return;
    }
    const token = ++tokenRef.current;
    setPhase('arming');
    void unlock.then((ok) => {
      if (token !== tokenRef.current) return;
      if (!ok) setMessage('record.noAudio');
      begin(setup, ok ? engine : null);
    });
  };

  const stop = () => {
    if (phase === 'arming') {
      tokenRef.current++;
      setPhase('idle');
      if (!feedback) releaseSound(); // hủy lúc chờ mở khóa: không còn click
      return;
    }
    stopSession(true);
  };

  const undo = () => {
    if (takes.length < 2 || busy) return;
    setTakes((prev) => prev.slice(0, -1));
    setMessage(null);
  };

  const defaultTitle = t('record.defaultTitle', { time: formatHm(mountedAt) });

  const open = () => {
    if (!current || busy) return;
    const name = title.trim() || defaultTitle;
    const harm = hitsToHarm(current.hits, {
      bpm: current.bpm,
      startMs: current.startMs,
      grid,
      timeSig: current.timeSig,
      title: name,
      scrollDir: GAME_SCROLL_DIR,
    });
    // bản thu đã chuyển sang Editor → rời trang không cần hỏi nữa
    createdRef.current = true;
    if (FEATURES.editor) {
      // BẢN NHÁP (góp ý 2026-10-15 C): chưa vào Thư viện cho tới khi người dùng Lưu trong Editor
      navigate(paths.edit(openDraftSong(harm)));
      return;
    }
    const id = useLibrary.getState().addSong(harm);
    toast(t('record.created', { title: name }));
    navigate(paths.play(id));
  };

  const toggleFeedback = (on: boolean) => {
    setFeedback(on);
    // bật trong gesture: mở khóa âm thanh ngay để nốt đầu tiên đã có tiếng (+ phiên "playback" của iPhone)
    if (on && isAudioSupported()) {
      const engine = getAudioEngine();
      applyAudioSettings(engine);
      void holdSound(engine);
    }
    if (!on) {
      voiceRef.current?.stop();
      voiceRef.current = null;
      // Còn click của phiên đang thu (hoặc đang chờ mở khóa cho click) thì giữ; không thì trả phiên.
      if (phase !== 'arming' && !sessionRef.current?.audio) releaseSound();
    }
  };

  // ── nút cảm ứng (Mobile) ──
  const bumpPad = () => setPadVersion((v) => v + 1);
  const onNoteDown = (key: NoteKey, e: ReactPointerEvent<HTMLButtonElement>) => {
    // chuột: chỉ nút trái; không chuyển focus / bôi đen
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    const before = mobile.recorder.sounding;
    mobile.noteOn(key, eventTime(e.timeStamp));
    sound(before, mobile.recorder.sounding);
    bumpPad();
  };
  const onNoteUp = (key: NoteKey, e: ReactPointerEvent<HTMLButtonElement>) => {
    if (!mobile.pressedKeys.includes(key)) return;
    const before = mobile.recorder.sounding;
    mobile.noteOff(key, eventTime(e.timeStamp));
    sound(before, mobile.recorder.sounding);
    bumpPad();
  };
  const onMode = (b: MobileButton) => {
    mobile.tapMode(b);
    bumpPad();
  };

  // focus sau khi đổi pha: Thu → nút Dừng; Dừng (có bản mới) → phần kết quả
  useEffect(() => {
    if (busy && focusStopRef.current) {
      focusStopRef.current = false;
      stopRef.current?.focus();
    }
  }, [busy]);
  useEffect(() => {
    if (!busy && focusResultRef.current && current) {
      focusResultRef.current = false;
      resultRef.current?.focus();
    }
  }, [busy, current]);

  // ── chặn rời trang khi đang thu / còn bản thu chưa mở (như "Tạo bài từ file") ──
  useEffect(() => {
    const shouldBlock = () => {
      const l = latest.current;
      return !createdRef.current && (l.busy || l.hasTake);
    };
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!shouldBlock()) return;
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    const removeGuard = installHashGuard(window, {
      shouldBlock,
      onBlocked: (next) => setPendingLeave(next),
    });
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      removeGuard();
    };
  }, []);

  const leave = () => {
    const target = pendingLeave;
    setPendingLeave(null);
    if (target === null) return;
    createdRef.current = true; // cho qua; unmount sẽ hủy bản đang thu
    window.location.hash = target;
  };

  // unmount: dừng thu (không lưu), dọn timer / click / listener / tiếng; trả phiên "playback" của iPhone
  useEffect(
    () => () => {
      tokenRef.current++;
      stopSession(false);
      voiceRef.current?.stop();
      voiceRef.current = null;
      releaseSound();
    },
    [stopSession, releaseSound],
  );

  // ── kết quả ──
  const placed = useMemo(
    () =>
      current
        ? quantizeHits(current.hits, { bpm: current.bpm, startMs: current.startMs, grid })
        : [],
    [current, grid],
  );
  const summary = current ? takeSummary(placed, current.bpm, current.timeSig) : null;

  // ── render ──
  const session = sessionRef.current;
  const beat =
    session && (phase === 'countin' || phase === 'recording') ? beatOf(session, now) : null;
  const bpbNow = session ? session.bpb : beatsPerBar(timeSig);

  let liveRoll: { notes: RollNote[]; from: number; to: number } | null = null;
  if (session && beat !== null) {
    const toBeat = (ms: number) => beatOf(session, ms);
    const rec = session.pc ? session.pc.recorder : mobile.recorder;
    const notes: RollNote[] = rec.hits.map((h) => ({
      key: h.key,
      octave: h.octave,
      sharp: h.sharp,
      startBeat: toBeat(h.onMs),
      beats: Math.max(1e-3, toBeat(h.offMs) - toBeat(h.onMs)),
    }));
    const cur = rec.sounding;
    if (cur) {
      notes.push({
        key: cur.key,
        octave: cur.octave,
        sharp: cur.sharp,
        startBeat: toBeat(cur.onMs),
        beats: Math.max(1e-3, beat - toBeat(cur.onMs)),
      });
    }
    const span = LIVE_BARS * session.bpb;
    const from = Math.max(-session.bpb, beat - span + session.bpb);
    liveRoll = { notes, from, to: from + span };
  }

  // Đếm vào: số beat còn lại của ô nhịp đếm vào (bpb … 1); khoảng trễ trước beat đầu vẫn hiện bpb.
  const countIn =
    session && beat !== null && beat < 0
      ? Math.min(Math.max(1, Math.round(session.bpb)), Math.max(1, Math.ceil(-beat - 1e-9)))
      : null;
  // Đèn nhịp: chưa tới beat đầu của ô nhịp đếm vào thì chưa sáng đèn nào.
  const lampBeat = session && beat !== null && beat >= -session.bpb - 1e-9 ? beat : null;

  let readout: string;
  let announce: string;
  if (phase === 'arming') {
    readout = t('record.phase.arming');
    announce = readout;
  } else if (countIn !== null) {
    readout = t('record.phase.countIn', { n: countIn });
    announce = readout;
  } else if (session && beat !== null) {
    const elapsed = now - session.beat0;
    const bar = Math.floor(beat / session.bpb) + 1;
    readout = t('record.phase.recording', { bar, time: formatClock(elapsed) });
    announce = t('record.phase.recordingAnnounce');
  } else {
    readout = t('record.phase.idle');
    announce = '';
  }

  const tsOptions: SelectOption<string>[] = RECORD_TIME_SIGS.map((ts) => ({
    value: tsKey(ts),
    label: tsKey(ts),
  }));
  const gridOptions: SelectOption<string>[] = GRID_KEYS.map((key, i) => ({
    value: String(i),
    label: t(key),
  }));

  const pcNote: { key: NoteKey; modifiers: Modifiers } | null = live.sounding
    ? { key: live.sounding.key, modifiers: modifiersOf(live.sounding.octave, live.sounding.sharp) }
    : null;

  // Nút Dừng là <button> thường (cần ref để đưa focus tới khi bắt đầu thu); cùng class với Button.
  const mainButton = busy ? (
    <button
      ref={stopRef}
      type="button"
      className="btn btn-danger btn-lg rec-main-btn"
      onClick={stop}
    >
      <span className="rec-glyph" aria-hidden="true">
        ■
      </span>{' '}
      {t('record.stop')}
    </button>
  ) : (
    <Button variant="primary" size="lg" className="rec-main-btn" onClick={start}>
      <span className="rec-glyph rec-glyph-rec" aria-hidden="true">
        ●
      </span>{' '}
      {t('record.start')}
    </Button>
  );

  return (
    <section className="rec-view stack" aria-labelledby={titleId}>
      <header className="rec-header">
        <h1 id={titleId}>{t('record.title')}</h1>
        <p className="muted">{t('record.subtitle')}</p>
      </header>

      <div className="rec-layout hud-numbered">
        <section className="card rec-setup stack" aria-labelledby={`${titleId}-setup`}>
          <h2 id={`${titleId}-setup`} className="hud-section-title">
            {t('record.setup')}
          </h2>
          <div className="field">
            <label htmlFor={songTitleId}>{t('record.songTitle')}</label>
            <input
              id={songTitleId}
              type="text"
              value={title}
              placeholder={defaultTitle}
              maxLength={120}
              onChange={(e) => setTitle(e.currentTarget.value)}
            />
          </div>
          <div className="rec-fields">
            <div className="field rec-bpm">
              <label htmlFor={bpmId}>{t('record.bpm')}</label>
              <input
                id={bpmId}
                type="number"
                inputMode="numeric"
                min={RECORD_BPM_MIN}
                max={RECORD_BPM_MAX}
                step={1}
                value={bpmText}
                disabled={busy}
                aria-invalid={parseRecordBpm(bpmText) === null || undefined}
                onChange={(e) => {
                  const v = e.currentTarget.value;
                  setBpmText(v);
                  const n = parseRecordBpm(v);
                  if (n !== null) setBpm(n);
                }}
                onBlur={() => setBpmText(String(bpm))}
              />
            </div>
            <Select
              label={t('record.timeSig')}
              value={timeSigKey}
              options={tsOptions}
              disabled={busy}
              onChange={setTimeSigKey}
            />
          </div>
          <Select
            label={t('record.grid')}
            value={String(gridIndex)}
            options={gridOptions}
            onChange={(v) => setGridIndex(Number(v))}
          />
          <div className="field rec-scheme">
            <span className="rec-label">{t('record.scheme')}</span>
            <p className="rec-scheme-value">
              <span className="tag">
                {t(
                  scheme === 'mobile'
                    ? 'settings.controlScheme.mobile'
                    : 'settings.controlScheme.pc',
                )}
              </span>{' '}
              <a href={href(paths.settings())}>{t('record.changeScheme')}</a>
            </p>
          </div>
          <Toggle
            label={t('record.feedback')}
            hint={t('record.feedbackHint')}
            checked={feedback}
            onChange={toggleFeedback}
          />
          <p className="field-hint">{t(clickSound ? 'record.clickOn' : 'record.clickOff')}</p>
        </section>

        <div className="rec-main stack">
          <section
            className="card rec-stage stack"
            data-phase={phase}
            aria-labelledby={`${titleId}-stage`}
          >
            <h2 id={`${titleId}-stage`} className="hud-section-title">
              {t('record.stage')}
            </h2>
            <div className="rec-hud">
              <span className="rec-hud-tags">
                <span className="tag">{t('record.tagBpm', { bpm: session?.bpm ?? bpm })}</span>
                <span className="tag">{tsKey(session?.timeSig ?? timeSig)}</span>
              </span>
              <BeatLamps count={bpbNow} beat={lampBeat} label={t('record.beatsAria')} />
              <span
                className={['rec-readout', phase === 'recording' && 'is-recording']
                  .filter(Boolean)
                  .join(' ')}
                aria-hidden="true"
              >
                {phase === 'recording' ? <span className="rec-rec-dot" aria-hidden="true" /> : null}
                {readout}
              </span>
              <span className="sr-only" role="status" aria-live="polite">
                {announce}
              </span>
            </div>

            <div
              ref={surfaceRef}
              className="rec-surface"
              data-scheme={scheme}
              aria-label={t('record.surfaceAria')}
              role="group"
            >
              <div className="rec-roll-wrap">
                <RecordRoll
                  notes={liveRoll?.notes ?? []}
                  from={liveRoll?.from ?? 0}
                  to={liveRoll?.to ?? LIVE_BARS * bpbNow}
                  beatsPerBar={bpbNow}
                  playhead={beat}
                  height={168}
                  label={t('record.liveAria')}
                  scheme={scheme}
                />
                {countIn !== null ? (
                  <span className="rec-countin" aria-hidden="true">
                    <span className="rec-countin-label">{t('record.countInLabel')}</span>
                    <span className="rec-countin-num">{countIn}</span>
                  </span>
                ) : null}
                {!busy ? (
                  <p className="rec-roll-hint">
                    {t(scheme === 'mobile' ? 'record.idleHintMobile' : 'record.idleHint')}
                  </p>
                ) : null}
              </div>
              {scheme === 'mobile' ? (
                <MobilePad
                  capture={mobile}
                  sounding={mobile.recorder.sounding}
                  onNoteDown={onNoteDown}
                  onNoteUp={onNoteUp}
                  onMode={onMode}
                />
              ) : (
                <GameBar
                  className="rec-gamebar"
                  scheme="pc"
                  note={pcNote}
                  noteId={live.sounding?.onMs ?? null}
                  run={null}
                  pressed={live.pressed}
                />
              )}
            </div>

            <div className="rec-controls row">
              {busy || !current ? mainButton : null}
              <span className="rec-controls-hint muted">
                {scheme === 'mobile'
                  ? t('record.mobileHint', {
                      semitone: t(
                        mobileSemitone === 'oneShot'
                          ? 'settings.mobileSemitone.oneShot'
                          : 'settings.mobileSemitone.toggle',
                      ),
                      mod: labels.scroll,
                    })
                  : t('record.pcHint', {
                      left: labels.left,
                      right: labels.right,
                      scroll: labels.scroll,
                    })}
              </span>
            </div>
            {scheme === 'pc' ? (
              <div className="rec-notes">
                <p className="field-hint">{t('record.focusNote')}</p>
              </div>
            ) : null}
            {message ? (
              <p className="rec-message" role="alert">
                {t(message)}
              </p>
            ) : null}
          </section>

          {!busy && current && summary ? (
            <section
              ref={resultRef}
              className="card rec-result stack"
              aria-labelledby={resultTitleId}
              tabIndex={-1}
            >
              <h2 id={resultTitleId} className="hud-section-title">
                {t('record.result')}
              </h2>
              <p className="rec-summary">
                {t('record.take', {
                  n: summary.notes,
                  bars: summary.bars,
                  time: formatClock(summary.seconds * 1000),
                })}
                <span className="tag">{t('record.tagBpm', { bpm: current.bpm })}</span>
                <span className="tag">{tsKey(current.timeSig)}</span>
              </p>
              {current.bpm !== bpm || tsKey(current.timeSig) !== timeSigKey ? (
                <p className="field-hint">{t('record.bpmNext')}</p>
              ) : null}
              <div className="rec-preview-scroll">
                <RecordRoll
                  notes={placed}
                  from={summary.origin}
                  to={summary.origin + Math.max(1, summary.bars) * beatsPerBar(current.timeSig)}
                  beatsPerBar={beatsPerBar(current.timeSig)}
                  height={140}
                  minWidth={Math.min(
                    PREVIEW_MAX_WIDTH,
                    Math.round(summary.bars * beatsPerBar(current.timeSig) * PREVIEW_PX_PER_BEAT),
                  )}
                  label={t('record.takeAria')}
                  scheme={scheme}
                />
              </div>
              <p className="field-hint">{t('record.gridHint')}</p>
              <div className="rec-actions row">
                <Button onClick={start}>
                  <span className="rec-glyph rec-glyph-rec" aria-hidden="true">
                    ●
                  </span>{' '}
                  {t('record.retake')}
                </Button>
                <Button
                  onClick={undo}
                  disabled={takes.length < 2}
                  aria-label={t('record.undoAria')}
                >
                  {t('record.undo')}
                </Button>
                <span className="spacer" />
                <Button variant="primary" onClick={open}>
                  {t('record.open')}
                </Button>
              </div>
            </section>
          ) : null}
        </div>
      </div>

      <Modal
        open={pendingLeave !== null}
        title={t('record.leave.title')}
        onClose={() => setPendingLeave(null)}
        footer={
          <>
            <Button onClick={() => setPendingLeave(null)} data-autofocus>
              {t('record.leave.stay')}
            </Button>
            <Button variant="danger" onClick={leave}>
              {t('record.leave.discard')}
            </Button>
          </>
        }
      >
        <p>{busy ? t('record.leave.bodyRecording') : t('record.leave.body')}</p>
      </Modal>
    </section>
  );
}

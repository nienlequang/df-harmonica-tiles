import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { AudioEngine } from '../audio/engine';
import { getAudioEngine, isAudioSupported } from '../audio/engine';
import { scheduleClick } from '../audio/metronome';
import type { Voice } from '../audio/synth';
import type { TimeSig } from '../core/types';
import type { StringKey } from '../i18n/strings';
import { useT } from '../i18n/useT';
import { Button, Select, Toggle } from '../ui/components';
import type { SelectOption } from '../ui/components';
import { getSettings, useSettings } from '../ui/settings';
import { midiMapOptionsFromSettings, transposeMidi } from './mapping';
import { PianoRoll } from './PianoRoll';
import type { PianoRollNote } from './PianoRoll';
import { MelodyRecorder, recordingToMonoNotes } from './recorder';
import type { RecordedNote } from './recorder';
import type { LiveMidiEvent, MidiInputInfo, MonoNote, OverlapPolicy } from './types';
import { QUANTIZE_GRIDS } from './types';
import { getMidiInputManager, isWebMidiSupported } from './webmidi';
import type { MidiEnableResult } from './webmidi';

/**
 * "Thu melody" (spec §6b B Dùng 2): bật Web MIDI, chọn thiết bị (nhớ trong settings.midiInputId),
 * bấm Thu → đếm vào 1 ô nhịp → ghi note on/off kèm timestamp của MIDI event →
 * Dừng → quantize theo bpm / grid (recordingToMonoNotes). Thu lại giữ bản cũ để Hoàn tác.
 * Âm thanh mặc định tắt (SPEC 2026-10-14, D-183, D-248): đếm vào chỉ bằng hình; click chỉ khi bật
 * `settings.clickSound` (Cài đặt → Âm thanh); tiếng phản hồi là toggle riêng của màn này, mặc định tắt,
 * không lưu. Không có tiếng nào bật thì không tạo / unlock AudioContext.
 * Trục thời gian: performance.now() (= MIDIMessageEvent.timeStamp); click metronome trên trục
 * AudioContext được quy đổi qua getOutputTimestamp() (thời điểm nghe thấy).
 */

/** Kết quả gửi sang bước chọn cung. */
export interface RecordResult {
  mono: MonoNote[];
  bpm: number;
  timeSig: TimeSig;
  grid: number;
}

export interface RecordPanelProps {
  /** Tab / bước đang hiện (ẩn thì không bật MIDI, không chọn / gắn thiết bị). */
  active: boolean;
  /** Đang đếm vào / thu — nơi gọi khóa đổi tab. */
  onBusyChange?: (busy: boolean) => void;
  /** Có / hết bản thu (nơi gọi hỏi trước khi rời trang làm mất bản thu). */
  onHasTakeChange?: (hasTake: boolean) => void;
  onContinue: (result: RecordResult) => void;
}

interface Take {
  id: number;
  notes: RecordedNote[];
  /** performance-ms của beat 0. */
  startMs: number;
  bpm: number;
  timeSig: TimeSig;
}

type Phase = 'idle' | 'arming' | 'countin' | 'recording';

interface Session {
  bpm: number;
  timeSig: TimeSig;
  /** Số beat (đen) mỗi ô nhịp. */
  bpb: number;
  /** Giây mỗi beat. */
  spb: number;
  /** performance-ms của beat 0 (hết đếm vào). */
  beat0: number;
  metronome: boolean;
  audio: {
    ctx: AudioContext;
    dest: AudioNode;
    /** Thời điểm (trục audio) của click đếm vào đầu tiên. */
    a0: number;
    next: number;
  } | null;
  clicks: Set<Voice>;
  /** midi → note on (ms) của nốt đang giữ — để vẽ live. */
  held: Map<number, number>;
  feedback: Map<number, Voice>;
  timer: ReturnType<typeof setInterval>;
}

export const RECORD_BPM_DEFAULT = 90;
export const RECORD_BPM_MIN = 30;
export const RECORD_BPM_MAX = 300;
export const RECORD_TIME_SIGS: readonly TimeSig[] = [
  { num: 4, den: 4 },
  { num: 3, den: 4 },
  { num: 6, den: 8 },
];
/** Chu kỳ cập nhật UI + lên lịch click (ms). */
export const RECORD_TICK_MS = 50;
/** Lên lịch click trước (giây). */
const CLICK_LOOKAHEAD_SEC = 0.15;
/** Trễ trước click đếm vào đầu tiên (giây). */
export const RECORD_START_LEAD_SEC = 0.12;
/** Tự dừng sau ngần này phút (tránh thu quên tắt). */
export const RECORD_MAX_MINUTES = 15;
/** Giữ tối đa ngần này bản thu để Hoàn tác. */
const MAX_TAKES = 10;
/** Đèn báo nốt sáng trong (ms). */
const ACTIVITY_FLASH_MS = 120;
/** Số ô nhịp hiện trong piano roll live. */
const LIVE_BARS = 8;

const GRID_KEYS: readonly StringKey[] = [
  'midi.grid.quarter',
  'midi.grid.eighth',
  'midi.grid.triplet',
  'midi.grid.off',
];
const OVERLAPS: readonly OverlapPolicy[] = ['highest', 'lowest', 'longest'];

const nowMs = (): number =>
  typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();

const tsKey = (ts: TimeSig): string => `${ts.num}/${ts.den}`;

/** BPM gõ tay hợp lệ (RECORD_BPM_MIN..MAX), không thì null. */
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

/**
 * Hàm đổi thời điểm trục AudioContext (giây) → performance-ms lúc NGHE thấy. Ưu tiên
 * getOutputTimestamp() (đã gồm độ trễ ra loa); không có thì ước lượng bằng outputLatency.
 */
export function audioToPerfMs(ctx: AudioContext, perfNow: number = nowMs()): (t: number) => number {
  try {
    const ts = typeof ctx.getOutputTimestamp === 'function' ? ctx.getOutputTimestamp() : null;
    const ct = ts?.contextTime;
    const pt = ts?.performanceTime;
    if (
      ct !== undefined &&
      pt !== undefined &&
      Number.isFinite(ct) &&
      Number.isFinite(pt) &&
      pt > 0
    ) {
      return (t) => pt + (t - ct) * 1000;
    }
  } catch {
    // dùng ước lượng bên dưới
  }
  const ctxNow = ctx.currentTime;
  const lat = (Number(ctx.outputLatency) || 0) + (Number(ctx.baseLatency) || 0);
  return (t) => perfNow + (t - ctxNow + lat) * 1000;
}

function applyAudioSettings(engine: AudioEngine): void {
  const s = getSettings();
  engine.setMusicVolume(s.musicVolume);
  engine.setClickVolume(s.clickVolume);
  engine.setTimbre(s.timbre);
}

function quantize(take: Take, grid: number, overlap: OverlapPolicy): MonoNote[] {
  return recordingToMonoNotes(take.notes, {
    bpm: take.bpm,
    startMs: take.startMs,
    grid,
    overlap,
  });
}

export function RecordPanel({
  active,
  onBusyChange,
  onHasTakeChange,
  onContinue,
}: RecordPanelProps) {
  const t = useT();
  const supported = isWebMidiSupported();
  const manager = getMidiInputManager();
  const midiEnabled = useSettings((s) => s.midiEnabled);
  const midiInputId = useSettings((s) => s.midiInputId);
  const clickSound = useSettings((s) => s.clickSound);
  const setSettings = useSettings((s) => s.set);

  const [enableState, setEnableState] = useState<'idle' | 'pending' | MidiEnableResult>('idle');
  const [, setDevicesVersion] = useState(0);
  const [activity, setActivity] = useState(false);
  const [bpm, setBpm] = useState(RECORD_BPM_DEFAULT);
  const [bpmText, setBpmText] = useState(String(RECORD_BPM_DEFAULT));
  const [timeSigKey, setTimeSigKey] = useState('4/4');
  const [gridIndex, setGridIndex] = useState(0);
  const [overlap, setOverlap] = useState<OverlapPolicy>('highest');
  /** Click tiếp tục trong lúc thu — chỉ có tác dụng khi `clickSound` bật ở Cài đặt. */
  const [metronome, setMetronome] = useState(true);
  /** Tiếng phản hồi khi bấm: riêng màn này, mặc định tắt, không lưu (D-248). */
  const [feedback, setFeedback] = useState(false);
  const [phase, setPhase] = useState<Phase>('idle');
  const [now, setNow] = useState(0);
  const [takes, setTakes] = useState<Take[]>([]);
  /** Thông báo (key i18n — đổi ngôn ngữ thì dịch lại). */
  const [message, setMessage] = useState<StringKey | null>(null);

  const recorderRef = useRef<MelodyRecorder | null>(null);
  if (recorderRef.current === null) recorderRef.current = new MelodyRecorder();
  const sessionRef = useRef<Session | null>(null);
  const tokenRef = useRef(0);
  const takeSeq = useRef(0);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const busyRef = useRef(onBusyChange);
  const hasTakeRef = useRef(onHasTakeChange);
  /** grid / policy hiện tại cho lúc Dừng (callback không phụ thuộc state). */
  const quantRef = useRef({ grid: 0.25, overlap: 'highest' as OverlapPolicy });
  /** Người dùng chủ động chọn "— Chọn thiết bị —": không tự chọn lại thiết bị đầu tiên. */
  const choseNoneRef = useRef(false);
  /** `feedback` cho listener MIDI (đăng ký một lần). */
  const feedbackRef = useRef(false);
  useLayoutEffect(() => {
    busyRef.current = onBusyChange;
    hasTakeRef.current = onHasTakeChange;
    feedbackRef.current = feedback;
  });

  const statusId = useId();
  const bpmId = useId();

  // MIDI tắt trong Cài đặt (dù quyền đã cấp trong phiên này) → coi như chưa bật: hiện "Bật MIDI",
  // không chọn / gắn thiết bị (D-118: tắt MIDI → select(null)).
  const enabled = supported && midiEnabled && manager.enabled;
  const timeSig = RECORD_TIME_SIGS.find((ts) => tsKey(ts) === timeSigKey) ?? RECORD_TIME_SIGS[0];
  const grid = QUANTIZE_GRIDS[gridIndex] ?? 0.25;
  const current = takes.length > 0 ? takes[takes.length - 1] : null;
  useLayoutEffect(() => {
    quantRef.current = { grid, overlap };
  });

  const mono = useMemo(
    () => (current ? quantize(current, grid, overlap) : []),
    [current, grid, overlap],
  );

  const hasTake = current !== null;
  useEffect(() => {
    hasTakeRef.current?.(hasTake);
  }, [hasTake]);

  // ── Web MIDI: danh sách thiết bị, đèn báo ──
  useEffect(() => {
    if (!supported) return;
    const offDevices = manager.onDevicesChange(() => setDevicesVersion((v) => v + 1));
    const offActivity = manager.onActivity(() => {
      setActivity(true);
      if (flashTimer.current !== null) clearTimeout(flashTimer.current);
      flashTimer.current = setTimeout(() => {
        flashTimer.current = null;
        setActivity(false);
      }, ACTIVITY_FLASH_MS);
    });
    return () => {
      offDevices();
      offActivity();
      if (flashTimer.current !== null) clearTimeout(flashTimer.current);
      flashTimer.current = null;
    };
  }, [supported, manager]);

  const enable = useCallback(async () => {
    setEnableState('pending');
    const r = await manager.enable();
    setEnableState(r);
    if (r === 'ok') {
      if (!getSettings().midiEnabled) setSettings({ midiEnabled: true });
      setDevicesVersion((v) => v + 1);
    }
  }, [manager, setSettings]);

  // Người dùng đã bật MIDI trong Settings → bật luôn khi mở tab (không xin quyền lúc tải app)
  useEffect(() => {
    if (active && supported && midiEnabled && !manager.enabled && enableState === 'idle') {
      void enable();
    }
  }, [active, supported, midiEnabled, manager, enableState, enable]);

  const inputs: MidiInputInfo[] = enabled ? manager.inputs() : [];
  const inputsKey = inputs.map((i) => `${i.id}:${i.state}`).join('|');

  // Tab đang hiện: chọn thiết bị đã nhớ; chưa nhớ thì lấy thiết bị đầu tiên đang cắm (D-138) —
  // trừ khi người dùng vừa chủ động chọn "không thiết bị". Tab ẩn thì không đụng tới thiết bị.
  useEffect(() => {
    if (!enabled || !active) return;
    if (midiInputId !== null) {
      if (manager.selectedId !== midiInputId) {
        manager.select(midiInputId);
        setDevicesVersion((v) => v + 1);
      }
      return;
    }
    if (choseNoneRef.current) return;
    const first = manager.inputs().find((i) => i.state === 'connected');
    if (first) {
      manager.select(first.id);
      setSettings({ midiInputId: first.id });
    }
  }, [enabled, active, midiInputId, inputsKey, manager, setSettings]);

  // ── Thu ──
  const stopSession = useCallback(
    (save: boolean) => {
      const s = sessionRef.current;
      if (!s) return;
      sessionRef.current = null;
      tokenRef.current++;
      clearInterval(s.timer);
      for (const v of Array.from(s.clicks)) v.stop();
      s.clicks.clear();
      for (const v of s.feedback.values()) v.stop();
      s.feedback.clear();
      const end = nowMs();
      const notes = recorderRef.current?.stop(end) ?? [];
      busyRef.current?.(false);
      if (!save) return;
      setPhase('idle');
      if (end < s.beat0) return; // dừng lúc đếm vào = hủy
      const take: Take = {
        id: ++takeSeq.current,
        notes,
        startMs: s.beat0,
        bpm: s.bpm,
        timeSig: s.timeSig,
      };
      // không còn nốt nào sau quantize (chỉ có nốt đếm vào / chạm nhầm) → không lưu
      if (quantize(take, quantRef.current.grid, quantRef.current.overlap).length === 0) {
        setMessage('midi.record.empty');
        return;
      }
      setMessage(null);
      setTakes((prev) => [...prev, take].slice(-MAX_TAKES));
    },
    // ổn định suốt đời component: cleanup lúc unmount không chạy lại khi đổi ngôn ngữ
    [],
  );

  const tick = useCallback(() => {
    const s = sessionRef.current;
    if (!s) return;
    const n = nowMs();
    if (s.audio) {
      const { ctx, dest } = s.audio;
      const horizon = ctx.currentTime + CLICK_LOOKAHEAD_SEC;
      const countInClicks = Math.round(s.bpb);
      for (;;) {
        const k = s.audio.next;
        if (k >= countInClicks && !s.metronome) break;
        const when = s.audio.a0 + k * s.spb;
        if (when >= horizon) break;
        let voice: Voice | null = null;
        voice = scheduleClick(ctx, dest, when, k % countInClicks === 0, () => {
          if (voice) s.clicks.delete(voice);
        });
        s.clicks.add(voice);
        s.audio.next = k + 1;
      }
    }
    const beat = (n - s.beat0) / 1000 / s.spb;
    setNow(n);
    setPhase(beat < 0 ? 'countin' : 'recording');
    if (beat * s.spb > RECORD_MAX_MINUTES * 60) stopSession(true);
  }, [stopSession]);

  const begin = useCallback(
    (engine: AudioEngine | null) => {
      const s0 = sessionRef.current;
      if (s0) return;
      const ts = timeSig;
      const bpb = (ts.num * 4) / ts.den;
      const spb = 60 / bpm;
      const perf = nowMs();
      const ctx = engine?.getContext() ?? null;
      const dest = engine?.clickDestination() ?? null;
      let audio: Session['audio'] = null;
      let beat0: number;
      if (ctx && dest && ctx.state === 'running') {
        const a0 = ctx.currentTime + RECORD_START_LEAD_SEC;
        beat0 = audioToPerfMs(ctx, perf)(a0 + bpb * spb);
        audio = { ctx, dest, a0, next: 0 };
      } else {
        // Đếm vào chỉ bằng hình (click tắt, hoặc không bật được âm thanh).
        beat0 = perf + (RECORD_START_LEAD_SEC + bpb * spb) * 1000;
        if (engine) setMessage('midi.record.noAudio');
      }
      recorderRef.current?.start(beat0);
      const session: Session = {
        bpm,
        timeSig: { ...ts },
        bpb,
        spb,
        beat0,
        metronome,
        audio,
        clicks: new Set(),
        held: new Map(),
        feedback: new Map(),
        timer: setInterval(() => tick(), RECORD_TICK_MS),
      };
      sessionRef.current = session;
      tick();
    },
    [timeSig, bpm, metronome, tick],
  );

  const start = () => {
    if (phase !== 'idle' || sessionRef.current) return;
    setMessage(null);
    // Cổng âm thanh như #/record (D-183, D-248): chỉ unlock AudioContext khi có tiếng được bật.
    const clicks = getSettings().clickSound;
    let unlock: Promise<boolean> = Promise.resolve(false);
    let engine: AudioEngine | null = null;
    if ((clicks || feedbackRef.current) && isAudioSupported()) {
      engine = getAudioEngine();
      applyAudioSettings(engine);
      unlock = engine.unlock(); // trong gesture
    }
    busyRef.current?.(true);
    if (!clicks) {
      // Click tắt: đếm vào chỉ bằng hình, bắt đầu ngay, không chờ âm thanh.
      begin(null);
      return;
    }
    const token = ++tokenRef.current;
    setPhase('arming');
    void unlock.then((ok) => {
      if (token !== tokenRef.current) return;
      if (!ok) setMessage('midi.record.noAudio');
      begin(ok ? engine : null);
    });
  };

  const toggleFeedback = (on: boolean) => {
    setFeedback(on);
    feedbackRef.current = on;
    if (on && isAudioSupported()) {
      // bật trong gesture: mở khóa âm thanh ngay để nốt đầu tiên đã có tiếng
      const engine = getAudioEngine();
      applyAudioSettings(engine);
      void engine.unlock();
    }
    const s = sessionRef.current;
    if (!on && s) {
      for (const v of s.feedback.values()) v.stop();
      s.feedback.clear();
    }
  };

  const stop = () => {
    if (phase === 'arming') {
      tokenRef.current++;
      setPhase('idle');
      busyRef.current?.(false);
      return;
    }
    stopSession(true);
  };

  // nốt MIDI → recorder (đã dịch theo transpose trong Settings), phản hồi synth nếu bật
  useEffect(() => {
    if (!supported) return;
    return manager.onEvent((e: LiveMidiEvent) => {
      const s = sessionRef.current;
      if (!s) return;
      const midi = transposeMidi(e.midi, midiMapOptionsFromSettings(getSettings()));
      if (!Number.isInteger(midi) || midi < 0 || midi > 127) return;
      const ev: LiveMidiEvent = { ...e, midi };
      recorderRef.current?.handle(ev);
      if (ev.type === 'on') s.held.set(midi, ev.timeStamp);
      else s.held.delete(midi);
      if (ev.type === 'on' && feedbackRef.current) {
        const v = getAudioEngine().playPreview(midi, 8);
        if (v) s.feedback.set(midi, v);
      } else if (ev.type === 'off') {
        s.feedback.get(midi)?.stop();
        s.feedback.delete(midi);
      }
    });
  }, [supported, manager]);

  // unmount: dừng thu (không lưu), dọn timer / click
  useEffect(
    () => () => {
      tokenRef.current++;
      stopSession(false);
    },
    [stopSession],
  );

  const undo = () => {
    if (takes.length < 2 || phase !== 'idle') return;
    setTakes((prev) => prev.slice(0, -1));
    setMessage(null);
  };

  // ── render ──
  if (!supported) {
    return <p className="midi-notice">{t('midi.record.unsupported')}</p>;
  }

  const busy = phase !== 'idle';
  const session = sessionRef.current;
  const selectedId = manager.selectedId;
  const connected = manager.connected;
  const selectedInfo = inputs.find((i) => i.id === selectedId) ?? null;

  let status: string;
  if (connected && selectedInfo) {
    status = t('midi.record.status.connected', { name: selectedInfo.name });
  } else if (selectedId !== null) {
    status = t('midi.record.status.waiting');
  } else {
    status = t('midi.record.status.none');
  }

  const deviceOptions: SelectOption<string>[] = [
    { value: '', label: t('midi.record.deviceNone') },
    ...inputs.map((i) => ({
      value: i.id,
      label:
        i.state === 'connected' ? i.name : t('midi.record.deviceDisconnected', { name: i.name }),
    })),
  ];
  if (selectedId !== null && !inputs.some((i) => i.id === selectedId)) {
    deviceOptions.push({
      value: selectedId,
      label: t('midi.record.deviceDisconnected', { name: selectedId }),
    });
  }

  const tsOptions: SelectOption<string>[] = RECORD_TIME_SIGS.map((ts) => ({
    value: tsKey(ts),
    label: tsKey(ts),
  }));
  const gridOptions: SelectOption<string>[] = GRID_KEYS.map((key, i) => ({
    value: String(i),
    label: t(key),
  }));
  const overlapOptions: SelectOption<OverlapPolicy>[] = OVERLAPS.map((p) => ({
    value: p,
    label: t(`midi.extract.overlap.${p}`),
  }));

  // piano roll live (nốt đã xong + nốt đang giữ)
  let live: { notes: PianoRollNote[]; from: number; to: number; beat: number } | null = null;
  if (session && (phase === 'countin' || phase === 'recording')) {
    const toBeat = (ms: number) => (ms - session.beat0) / 1000 / session.spb;
    const beat = toBeat(now);
    const notes: PianoRollNote[] = (recorderRef.current?.notes ?? []).map((n) => ({
      startBeat: toBeat(n.onMs),
      beats: Math.max(1e-3, toBeat(n.offMs) - toBeat(n.onMs)),
      midi: n.midi,
    }));
    for (const [midi, on] of session.held) {
      notes.push({ startBeat: toBeat(on), beats: Math.max(1e-3, beat - toBeat(on)), midi });
    }
    const span = LIVE_BARS * session.bpb;
    const from = Math.max(-session.bpb, beat - span + session.bpb);
    live = { notes, from, to: from + span, beat };
  }

  const canRecord = enabled && connected && !busy;

  let phaseText: string | null = null;
  if (phase === 'arming') phaseText = t('midi.record.arming');
  else if (session && phase === 'countin') {
    const beat = (now - session.beat0) / 1000 / session.spb;
    const count = Math.min(
      Math.round(session.bpb),
      Math.max(1, Math.floor(beat + session.bpb) + 1),
    );
    phaseText = t('midi.record.countIn', { n: count });
  } else if (session && phase === 'recording') {
    const elapsed = now - session.beat0;
    const bar = Math.floor(elapsed / 1000 / session.spb / session.bpb) + 1;
    phaseText = t('midi.record.recording', { bar, time: formatClock(elapsed) });
  }

  return (
    <div className="midi-record stack">
      <p className="muted">{t('midi.record.intro')}</p>

      {!enabled ? (
        <div className="row">
          <Button
            variant="primary"
            onClick={() => void enable()}
            disabled={enableState === 'pending'}
          >
            {enableState === 'pending' ? t('midi.record.enabling') : t('midi.record.enable')}
          </Button>
          <span className="field-hint">{t('midi.record.enableHint')}</span>
        </div>
      ) : (
        <div className="midi-fields midi-device">
          <Select
            label={t('midi.record.device')}
            value={selectedId ?? ''}
            options={deviceOptions}
            disabled={busy}
            aria-describedby={statusId}
            onChange={(v) => {
              const id = v === '' ? null : v;
              choseNoneRef.current = id === null;
              manager.select(id);
              setSettings({ midiInputId: id });
            }}
          />
          <p id={statusId} className="midi-device-status" role="status">
            <span
              className={activity ? 'midi-activity is-on' : 'midi-activity'}
              aria-hidden="true"
              title={t('midi.record.activity')}
            />
            {status}
          </p>
          {inputs.length === 0 ? <p className="field-hint">{t('midi.record.noDevices')}</p> : null}
        </div>
      )}
      {enableState === 'denied' ? (
        <p className="midi-error" role="alert">
          {t('midi.record.denied')}
        </p>
      ) : null}
      {enableState === 'unsupported' ? (
        <p className="midi-error" role="alert">
          {t('midi.record.unsupported')}
        </p>
      ) : null}

      <div className="midi-fields">
        <div className="field midi-number">
          <label htmlFor={bpmId}>{t('midi.record.bpm')}</label>
          <input
            id={bpmId}
            type="number"
            inputMode="decimal"
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
          label={t('midi.record.timeSig')}
          value={timeSigKey}
          options={tsOptions}
          disabled={busy}
          onChange={setTimeSigKey}
        />
        <Select
          label={t('midi.extract.grid')}
          value={String(gridIndex)}
          options={gridOptions}
          onChange={(v) => setGridIndex(Number(v))}
        />
        <Select
          label={t('midi.extract.overlap')}
          value={overlap}
          options={overlapOptions}
          onChange={setOverlap}
        />
      </div>
      <div className="midi-fields">
        <Toggle
          label={t('midi.record.metronome')}
          hint={t(clickSound ? 'midi.record.clickOn' : 'midi.record.clickOff')}
          checked={clickSound && metronome}
          disabled={busy || !clickSound}
          onChange={setMetronome}
        />
        <Toggle
          label={t('midi.record.feedback')}
          hint={t('midi.record.feedbackHint')}
          checked={feedback}
          onChange={toggleFeedback}
        />
      </div>

      <div className="row midi-record-controls">
        {busy ? (
          <Button variant="danger" onClick={stop}>
            {t('midi.record.stop')}
          </Button>
        ) : (
          <Button variant="primary" onClick={start} disabled={!canRecord}>
            {current ? t('midi.record.retake') : t('midi.record.start')}
          </Button>
        )}
        <Button
          onClick={undo}
          disabled={busy || takes.length < 2}
          aria-label={t('midi.record.undoAria')}
        >
          {t('midi.record.undo')}
        </Button>
        <span className="midi-phase" role="status" aria-live="polite">
          {phaseText}
        </span>
      </div>
      {enabled && !connected && !busy ? (
        <p className="field-hint">{t('midi.record.needDevice')}</p>
      ) : null}
      {message ? (
        <p className="midi-warning" role="alert">
          {t(message)}
        </p>
      ) : null}

      {live ? (
        <PianoRoll
          notes={live.notes}
          from={live.from}
          to={live.to}
          playhead={live.beat}
          beatsPerBar={session?.bpb ?? 4}
          height={120}
          label={t('midi.record.liveAria')}
        />
      ) : null}

      {!busy && current ? (
        <div className="stack midi-take">
          <p className="midi-count">
            {t('midi.record.take', {
              n: mono.length,
              bpm: Math.round(current.bpm * 100) / 100,
              time: tsKey(current.timeSig),
            })}
          </p>
          {current.bpm !== bpm || tsKey(current.timeSig) !== timeSigKey ? (
            <p className="field-hint">{t('midi.record.bpmNext')}</p>
          ) : null}
          {mono.length > 0 ? (
            <PianoRoll
              notes={mono}
              beatsPerBar={(current.timeSig.num * 4) / current.timeSig.den}
              height={120}
              label={t('midi.record.takeAria')}
            />
          ) : (
            <p className="midi-warning">{t('midi.record.empty')}</p>
          )}
          <div className="midi-nav">
            <span className="spacer" />
            <Button
              variant="primary"
              disabled={mono.length === 0}
              onClick={() =>
                onContinue({
                  mono,
                  bpm: current.bpm,
                  timeSig: { ...current.timeSig },
                  grid,
                })
              }
            >
              {t('midi.next')}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

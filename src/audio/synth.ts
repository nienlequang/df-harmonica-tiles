/**
 * Synth một nốt (spec mục 5 "Audio"): timbre "harmonica" = mẫu thu harmonica thật khi bộ mẫu của context đã tải xong
 * (harmonicaSamples.ts — góp ý 2026-10-19), chưa có thì synth (2 saw detune ±6 cent → lowpass 2.2 kHz, vibrato 5 Hz
 * nhẹ); hoặc "sine"; ADSR 10/80/0.7/120 ms. Mỗi voice tự dọn node khi 'ended'.
 */
import { midiToFrequency } from '../core/keys';
import type { Timbre } from '../ui/settings';
import { harmonicaSample } from './harmonicaSamples';

export type { Timbre };

/** ADSR (giây; sustain là tỉ lệ so với đỉnh). */
export const ENVELOPE = { attack: 0.01, decay: 0.08, sustain: 0.7, release: 0.12 } as const;
/** Release nhanh khi pause/seek. */
export const QUICK_RELEASE = 0.015;
/** Dừng oscillator sau khi gain đã về 0 một chút. */
const STOP_PAD = 0.005;
/** Nốt ngắn nhất (tránh duration 0/âm). */
export const MIN_DURATION = 0.02;

export const HARMONICA = {
  detuneCents: 6,
  lowpassHz: 2200,
  lowpassQ: 0.7,
  vibratoHz: 5,
  vibratoCents: 6,
  /** Vibrato tăng dần trong khoảng này sau khi bắt đầu nốt. */
  vibratoOnset: 0.15,
  /** 2 saw cộng lại khá to → đỉnh vừa phải để không clip. */
  peak: 0.2,
} as const;

export const SINE_PEAK = 0.32;
/**
 * Đỉnh envelope khi phát mẫu harmonica thật: mẫu FluidR3 rất nhỏ (đỉnh ~0,1, RMS ~0,018) → ×8 cho to ngang synth cũ
 * (RMS synth ≈ 0,7 × 0,2), đỉnh sau nhân ~0,8 nên không méo.
 */
export const SAMPLE_PEAK = 8;
/** Nốt dài hơn mẫu: lặp đoạn thân giữa của mẫu (tỉ lệ theo độ dài mẫu). */
export const SAMPLE_LOOP = { start: 0.45, end: 0.85 } as const;

export interface Voice {
  /** Thời điểm bắt đầu (trục AudioContext). */
  readonly when: number;
  /** Thời điểm oscillator dừng (sau release); đổi khi gọi stop(). */
  readonly end: number;
  /**
   * Release nhanh tại `at` (mặc định ngay bây giờ) rồi dừng; dùng khi pause/seek. `fade` = độ dài
   * fade (giây, mặc định QUICK_RELEASE ~15 ms; click: 5 ms).
   */
  stop(at?: number, fade?: number): void;
}

export interface VoiceOptions {
  midi: number;
  /** Thời điểm bắt đầu (trục AudioContext); quá khứ thì kẹp về currentTime. */
  when: number;
  /** Thời gian giữ nốt (giây) trước khi release. */
  duration: number;
  timbre: Timbre;
  /** Hệ số nhân âm lượng (mặc định 1). */
  gain?: number;
  /** Gọi đúng một lần khi voice kết thúc và đã ngắt mọi node. */
  onEnded?: () => void;
}

export interface EnvelopePoint {
  time: number;
  value: number;
}

/**
 * Các điểm envelope: điểm đầu là setValueAtTime, các điểm sau là linearRamp.
 * Nốt ngắn hơn attack+decay thì release bắt đầu từ mức đang có tại lúc nhả.
 */
export function envelopePoints(when: number, duration: number, peak: number): EnvelopePoint[] {
  const { attack, decay, sustain, release } = ENVELOPE;
  const off = when + Math.max(MIN_DURATION, duration);
  const ads: EnvelopePoint[] = [
    { time: when, value: 0 },
    { time: when + attack, value: peak },
    { time: when + attack + decay, value: peak * sustain },
  ];
  const points = ads.filter((p) => p.time < off);
  points.push({ time: off, value: envelopeLevel(ads, off) });
  points.push({ time: off + release, value: 0 });
  return points;
}

/** Giá trị envelope tại `t` (nội suy tuyến tính giữa các điểm; sau điểm cuối giữ nguyên). */
export function envelopeLevel(points: readonly EnvelopePoint[], t: number): number {
  const first = points[0];
  if (!first || t <= first.time) return first ? first.value : 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    if (t <= b.time) {
      const span = b.time - a.time;
      return span <= 0 ? b.value : a.value + ((b.value - a.value) * (t - a.time)) / span;
    }
  }
  return points[points.length - 1].value;
}

function applyEnvelope(param: AudioParam, points: readonly EnvelopePoint[]): void {
  points.forEach((p, i) => {
    if (i === 0) param.setValueAtTime(p.value, p.time);
    else param.linearRampToValueAtTime(p.value, p.time);
  });
}

function safeStop(node: AudioScheduledSourceNode, at: number): void {
  try {
    node.stop(at);
  } catch {
    // node đã dừng hẳn — bỏ qua
  }
}

function safeDisconnect(node: AudioNode): void {
  try {
    node.disconnect();
  } catch {
    // đã ngắt
  }
}

/** Lên lịch một nốt vào `destination`. Trả về Voice để dừng sớm khi pause/seek. */
export function scheduleVoice(
  ctx: BaseAudioContext,
  destination: AudioNode,
  opts: VoiceOptions,
): Voice {
  const when = Math.max(opts.when, ctx.currentTime);
  const duration = Math.max(MIN_DURATION, Number.isFinite(opts.duration) ? opts.duration : 0);
  const sample = opts.timbre === 'sine' ? null : harmonicaSample(ctx, opts.midi);
  const base = opts.timbre === 'sine' ? SINE_PEAK : sample ? SAMPLE_PEAK : HARMONICA.peak;
  const peak = base * Math.max(0, opts.gain ?? 1);
  let points = envelopePoints(when, duration, peak);
  let end = when + duration + ENVELOPE.release;

  const env = ctx.createGain();
  env.gain.value = 0;
  applyEnvelope(env.gain, points);
  env.connect(destination);

  const freq = midiToFrequency(opts.midi);
  const sources: AudioScheduledSourceNode[] = [];
  const nodes: AudioNode[] = [env];

  if (opts.timbre === 'sine') {
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = freq;
    osc.connect(env);
    sources.push(osc);
  } else if (sample) {
    const src = ctx.createBufferSource();
    src.buffer = sample.buffer;
    src.playbackRate.value = sample.rate;
    if ((end - when) * sample.rate > sample.buffer.duration - 0.05) {
      src.loop = true;
      src.loopStart = sample.buffer.duration * SAMPLE_LOOP.start;
      src.loopEnd = sample.buffer.duration * SAMPLE_LOOP.end;
    }
    src.connect(env);
    sources.push(src);
  } else {
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = HARMONICA.lowpassHz;
    filter.Q.value = HARMONICA.lowpassQ;
    filter.connect(env);

    // Vibrato: LFO → gain (độ sâu tính bằng cent) → detune của cả hai saw.
    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = HARMONICA.vibratoHz;
    const depth = ctx.createGain();
    depth.gain.value = 0;
    depth.gain.setValueAtTime(0, when);
    depth.gain.linearRampToValueAtTime(HARMONICA.vibratoCents, when + HARMONICA.vibratoOnset);
    lfo.connect(depth);

    for (const cents of [-HARMONICA.detuneCents, HARMONICA.detuneCents]) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = freq;
      osc.detune.value = cents;
      depth.connect(osc.detune);
      osc.connect(filter);
      sources.push(osc);
    }
    sources.push(lfo);
    nodes.push(filter, depth);
  }

  for (const s of sources) {
    s.start(when);
    s.stop(end);
  }

  let finished = false;
  const main = sources[0];
  main.onended = () => {
    if (finished) return;
    finished = true;
    main.onended = null;
    for (const n of sources) safeDisconnect(n);
    for (const n of nodes) safeDisconnect(n);
    opts.onEnded?.();
  };

  return {
    when,
    get end() {
      return end;
    },
    stop(at?: number, fade?: number): void {
      if (finished) return;
      const now = ctx.currentTime;
      const t = Math.max(at ?? now, now);
      const rel = fade !== undefined && Number.isFinite(fade) && fade > 0 ? fade : QUICK_RELEASE;
      // Đã (hoặc sắp) tắt tự nhiên trước khi release nhanh kịp xong → không cần làm gì.
      if (t + rel >= end) return;
      const level = envelopeLevel(points, t);
      env.gain.cancelScheduledValues(t);
      env.gain.setValueAtTime(level, t);
      env.gain.linearRampToValueAtTime(0, t + rel);
      points = [
        ...points.filter((p) => p.time < t),
        { time: t, value: level },
        { time: t + rel, value: 0 },
      ];
      // Chưa bắt đầu thì dừng đúng lúc start (không phát mẫu nào).
      end = Math.max(when, t + rel + STOP_PAD);
      for (const s of sources) safeStop(s, end);
    },
  };
}

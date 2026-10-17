/**
 * Click metronome bằng noise burst: buffer nhiễu trắng ngắn (decay mũ có sẵn trong mẫu), cache
 * theo AudioContext. Accent sáng hơn (tần số lọc cao hơn) và to hơn.
 */
import type { Voice } from './synth';

/** Độ dài burst (giây). */
export const CLICK_LENGTH = 0.03;

export const CLICK_SOUND = {
  accent: { frequency: 3200, Q: 0.9, gain: 1 },
  normal: { frequency: 1800, Q: 0.9, gain: 0.55 },
} as const;

/** Fade ngắn khi dừng click giữa chừng. */
const CLICK_FADE = 0.005;

const noiseCache = new WeakMap<BaseAudioContext, AudioBuffer>();

/** Buffer nhiễu trắng mono ~30 ms, biên độ giảm theo hàm mũ (cache mỗi context). */
export function getClickBuffer(ctx: BaseAudioContext): AudioBuffer {
  const cached = noiseCache.get(ctx);
  if (cached) return cached;
  const length = Math.max(1, Math.round(ctx.sampleRate * CLICK_LENGTH));
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  // PRNG xorshift32 cố định seed → click giống nhau mọi lần (và test được).
  let seed = 0x2545f491;
  for (let i = 0; i < length; i++) {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    const noise = ((seed >>> 0) / 0xffffffff) * 2 - 1;
    data[i] = noise * Math.exp((-6 * i) / length);
  }
  noiseCache.set(ctx, buffer);
  return buffer;
}

/**
 * Lên lịch một click tại `when` (quá khứ thì kẹp về currentTime). Node tự ngắt khi 'ended'.
 */
export function scheduleClick(
  ctx: BaseAudioContext,
  destination: AudioNode,
  when: number,
  accent: boolean,
  onEnded?: () => void,
): Voice {
  const start = Math.max(when, ctx.currentTime);
  const sound = accent ? CLICK_SOUND.accent : CLICK_SOUND.normal;

  const src = ctx.createBufferSource();
  src.buffer = getClickBuffer(ctx);
  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = sound.frequency;
  filter.Q.value = sound.Q;
  const gain = ctx.createGain();
  gain.gain.value = sound.gain;

  src.connect(filter);
  filter.connect(gain);
  gain.connect(destination);

  let end = start + CLICK_LENGTH;
  src.start(start);
  src.stop(end);

  let finished = false;
  src.onended = () => {
    if (finished) return;
    finished = true;
    src.onended = null;
    for (const n of [src, filter, gain]) {
      try {
        n.disconnect();
      } catch {
        // đã ngắt
      }
    }
    onEnded?.();
  };

  return {
    when: start,
    get end() {
      return end;
    },
    stop(at?: number, fade?: number): void {
      if (finished) return;
      const now = ctx.currentTime;
      const t = Math.max(at ?? now, now);
      if (t >= end) return;
      if (t > start) {
        const f = fade !== undefined && Number.isFinite(fade) && fade > 0 ? fade : CLICK_FADE;
        gain.gain.cancelScheduledValues(t);
        gain.gain.setValueAtTime(sound.gain, t);
        gain.gain.linearRampToValueAtTime(0, t + f);
        end = Math.min(end, t + f);
      } else {
        // Chưa phát: dừng đúng lúc start → không phát mẫu nào.
        end = start;
      }
      try {
        src.stop(end);
      } catch {
        // đã dừng
      }
    },
  };
}

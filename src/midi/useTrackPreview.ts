import { useCallback, useEffect, useRef, useState } from 'react';
import type { AudioEngine } from '../audio/engine';
import { getAudioEngine } from '../audio/engine';
import { scheduleVoice } from '../audio/synth';
import type { Voice } from '../audio/synth';
import { getSettings } from '../ui/settings';

/**
 * "Nghe thử" track / melody (spec §6b A bước 2): phát ~12 giây đầu bằng synth của app trên bus
 * nhạc của AudioEngine. Lên lịch dần (lookahead) để không tạo hàng trăm node một lúc; dừng thì
 * fade nhanh mọi voice; unmount / stopAll() của engine cũng dừng.
 */

export interface PreviewNote {
  startBeat: number;
  beats: number;
  midi: number;
}

/** Thời lượng nghe thử tối đa (giây, tính từ nốt đầu). */
export const PREVIEW_MAX_SEC = 12;
/** Lên lịch trước bấy nhiêu giây. */
export const PREVIEW_LOOKAHEAD_SEC = 0.5;
/** Chu kỳ lên lịch (ms). */
export const PREVIEW_TICK_MS = 100;
/** Trễ trước nốt đầu để envelope bắt đầu sạch. */
const START_LEAD_SEC = 0.06;
/** Âm lượng tương đối (hợp âm nhiều nốt dễ to). */
const PREVIEW_GAIN = 0.7;
const FALLBACK_BPM = 120;

export interface PreviewEvent {
  midi: number;
  /** Giây tính từ nốt đầu. */
  at: number;
  /** Giây. */
  dur: number;
}

/**
 * Lịch phát (thuần): đổi beat → giây theo bpm, bắt đầu từ nốt sớm nhất, chỉ giữ nốt bắt đầu
 * trong `maxSec` và cắt đuôi tại `maxSec`. Sắp theo thời điểm.
 */
export function previewSchedule(
  notes: readonly PreviewNote[],
  bpm: number,
  maxSec: number = PREVIEW_MAX_SEC,
): PreviewEvent[] {
  const spb = 60 / (Number.isFinite(bpm) && bpm > 0 ? bpm : FALLBACK_BPM);
  const valid = notes.filter(
    (n) =>
      Number.isFinite(n.startBeat) &&
      Number.isFinite(n.beats) &&
      n.beats > 0 &&
      Number.isInteger(n.midi) &&
      n.midi >= 0 &&
      n.midi <= 127,
  );
  if (valid.length === 0) return [];
  const first = Math.min(...valid.map((n) => n.startBeat));
  const out: PreviewEvent[] = [];
  for (const n of valid) {
    const at = (n.startBeat - first) * spb;
    if (at >= maxSec) continue;
    out.push({ midi: n.midi, at, dur: Math.min(n.beats * spb, maxSec - at) });
  }
  return out.sort((a, b) => a.at - b.at || a.midi - b.midi);
}

/**
 * Kết quả play(): 'playing' = đang phát; 'blocked' = không bật được âm thanh; 'empty' = không có
 * nốt; 'cancelled' = bị lượt play/stop khác chen ngang; 'stopped' = toggle vừa dừng bản đang phát.
 */
export type PreviewResult = 'playing' | 'blocked' | 'empty' | 'cancelled' | 'stopped';

/**
 * Trình phát nghe thử (không React). Một bản phát mỗi lúc; `onChange(key)` báo khóa đang phát
 * (null khi dừng / hết).
 */
export class TrackPreviewPlayer {
  private key: string | null = null;
  private voices = new Set<Voice>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private unlisten: (() => void) | null = null;
  /** Tăng mỗi lần play/stop — lần unlock về muộn của lượt cũ bị bỏ. */
  private token = 0;
  /**
   * Engine đang giữ phiên "playback" của iPhone cho lần nghe thử này (kêu cả khi gạt nút im lặng — D-421, D-426);
   * null = không giữ. Chỉ giữ trong lúc nghe thử: dừng / hết / bị chặn / dispose là trả.
   */
  private heldEngine: AudioEngine | null = null;

  constructor(
    private readonly onChange: (key: string | null) => void,
    private readonly engineOf: () => AudioEngine = getAudioEngine,
  ) {}

  get playingKey(): string | null {
    return this.key;
  }

  /**
   * Gọi trong handler của user gesture (unlock AudioContext đồng bộ ở đầu hàm — kèm phiên "playback" của iPhone,
   * đặt TRƯỚC resume() trong `AudioEngine.unlock`).
   */
  async play(key: string, notes: readonly PreviewNote[], bpm: number): Promise<PreviewResult> {
    // Lượt mới thay lượt cũ: dọn lượt cũ nhưng giữ phiên — lượt mới xin lại ngay trong cú bấm này (không lật
    // 'auto' ↔ 'playback', không tạo lại phần tử im lặng của iOS cũ).
    this.token++;
    this.clear(true, false);
    const token = ++this.token;
    const events = previewSchedule(notes, bpm);
    const engine = this.engineOf();
    const s = getSettings();
    engine.setMusicVolume(s.musicVolume);
    engine.setTimbre(s.timbre);
    if (this.heldEngine !== null && this.heldEngine !== engine) this.releaseSession();
    let unlocking: Promise<boolean>;
    if (events.length > 0) {
      this.heldEngine = engine;
      unlocking = engine.unlock({ playback: this });
    } else {
      this.releaseSession(); // không có nốt để nghe → không giữ phiên
      unlocking = engine.unlock();
    }
    const unlocked = await unlocking;
    // Lượt mới hơn / stop() đã lo phiên (giữ tiếp hoặc trả) — lượt cũ không đụng tới.
    if (token !== this.token) return 'cancelled';
    if (events.length === 0) return 'empty';
    const ctx = engine.getContext();
    const dest = engine.musicDestination();
    if (!unlocked || !ctx || !dest) {
      this.releaseSession();
      return 'blocked';
    }

    this.key = key;
    this.onChange(key);
    const t0 = ctx.currentTime + START_LEAD_SEC;
    const end = t0 + Math.max(...events.map((e) => e.at + e.dur)) + 0.2;
    let next = 0;
    const tick = (): void => {
      if (token !== this.token) return;
      const horizon = ctx.currentTime + PREVIEW_LOOKAHEAD_SEC;
      while (next < events.length && t0 + events[next].at < horizon) {
        const e = events[next++];
        let voice: Voice | null = null;
        voice = scheduleVoice(ctx, dest, {
          midi: e.midi,
          when: t0 + e.at,
          duration: e.dur,
          timbre: engine.timbre,
          gain: PREVIEW_GAIN,
          onEnded: () => {
            if (voice) this.voices.delete(voice);
          },
        });
        this.voices.add(voice);
      }
      if (next >= events.length && ctx.currentTime >= end) this.finish();
    };
    // engine.stopAll() (vd. Player khác) cũng dừng nghe thử
    this.unlisten = engine.addStopListener(() => this.stop());
    this.timer = setInterval(tick, PREVIEW_TICK_MS);
    tick();
    return 'playing';
  }

  /** Dừng ngay (fade nhanh), dọn timer và listener. */
  stop(): void {
    this.token++;
    this.clear(true);
  }

  dispose(): void {
    this.stop();
  }

  /** Hết bài: voice đã tự kết thúc, chỉ dọn. */
  private finish(): void {
    this.token++;
    this.clear(false);
  }

  /** Dọn timer / listener / voice; `release` = trả phiên "playback" (mọi đường trừ lượt mới thay lượt cũ). */
  private clear(stopVoices: boolean, release = true): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    const unlisten = this.unlisten;
    this.unlisten = null;
    unlisten?.();
    if (stopVoices) {
      for (const v of Array.from(this.voices)) v.stop();
    }
    this.voices.clear();
    if (release) this.releaseSession();
    if (this.key !== null) {
      this.key = null;
      this.onChange(null);
    }
  }

  /** Trả phiên "playback" (iPhone: `type = 'auto'` / dừng phần tử im lặng nếu không còn ai giữ). */
  private releaseSession(): void {
    const eng = this.heldEngine;
    this.heldEngine = null;
    eng?.releasePlayback(this);
  }
}

export interface TrackPreview {
  /** Khóa của bản đang phát (vd. "track-2", "melody"), null nếu không phát. */
  playingKey: string | null;
  play(key: string, notes: readonly PreviewNote[], bpm: number): Promise<PreviewResult>;
  stop(): void;
  /** Đang phát `key` thì dừng ('stopped'), không thì phát. */
  toggle(key: string, notes: readonly PreviewNote[], bpm: number): Promise<PreviewResult>;
}

/** Hook nghe thử: một trình phát mỗi component, tự dừng khi unmount. */
export function useTrackPreview(): TrackPreview {
  const [playingKey, setPlayingKey] = useState<string | null>(null);
  const playerRef = useRef<TrackPreviewPlayer | null>(null);
  if (playerRef.current === null) playerRef.current = new TrackPreviewPlayer(setPlayingKey);

  useEffect(() => {
    const player = playerRef.current;
    return () => player?.dispose();
  }, []);

  const play = useCallback(
    (key: string, notes: readonly PreviewNote[], bpm: number) =>
      playerRef.current?.play(key, notes, bpm) ?? Promise.resolve<PreviewResult>('cancelled'),
    [],
  );
  const stop = useCallback(() => playerRef.current?.stop(), []);
  const toggle = useCallback((key: string, notes: readonly PreviewNote[], bpm: number) => {
    const player = playerRef.current;
    if (!player) return Promise.resolve<PreviewResult>('cancelled');
    if (player.playingKey === key) {
      player.stop();
      return Promise.resolve<PreviewResult>('stopped');
    }
    return player.play(key, notes, bpm);
  }, []);
  return { playingKey, play, stop, toggle };
}

import { useEffect, useRef } from 'react';
import type { LibraryEntry } from '../library/store';
import { wrapEndOf } from '../player/transport';
import type { Transport } from '../player/transport';
import type { BeatRange } from '../player/transport.types';
import type { PlayerEngine } from '../player/usePlayerEngine';
import { useSettings } from '../ui/settings';
import type { Settings } from '../ui/settings';
import type { FollowCause, FollowDisplay, FollowMessage, FollowStateMessage } from './follow';
import {
  FOLLOW_CHANNEL,
  FOLLOW_HEARTBEAT_MS,
  FOLLOW_SONG_REPEAT_MS,
  followNow,
  newFollowSenderId,
  parseFollowMessage,
  sameFollowDisplay,
  songKeyOf,
} from './follow';
import { relayToObs } from './obsBridge';

/**
 * Player chính phát bài + trạng thái transport + tùy chọn hiển thị cho overlay đi theo (contract ở
 * `follow.ts`): BroadcastChannel `FOLLOW_CHANNEL` cho overlay cùng trình duyệt, `relayToObs` (obsBridge)
 * cho Browser Source của OBS. Gọi một lần trong PlayerScreen (src/player/PlayerView.tsx).
 *
 * Gửi: `song` khi mở / đổi bài + nhắc lại mỗi FOLLOW_SONG_REPEAT_MS; `state` mỗi khi transport đổi
 * (phát, dừng, tua, nhảy dòng, chạy lại, đếm ngược bắt đầu / hủy, đếm vào, tempo, loop A-B) hoặc tùy
 * chọn hiển thị đổi, kèm heartbeat mỗi FOLLOW_HEARTBEAT_MS (cả khi đang dừng) và khi tab ẩn / hiện;
 * trả lời `hello` ngay bằng `song` + `state`; `bye` khi rời Player / đóng tab.
 *
 * Một tab có thể có hai bộ phát cùng id tab: Player chính và "Cửa sổ nổi" (FloatingStage — engine riêng,
 * cùng JS context, mở từ thanh dọc của Player; Player chính tạm dừng lúc mở). Chỉ MỘT bộ "nói" thay tab
 * (`priority` cao nhất, bằng nhau thì bộ start sau cùng): cửa sổ nổi đang mở thì overlay theo cửa sổ
 * nổi; đóng cửa sổ thì Player chính nói tiếp (bài + trạng thái ngay, không `bye` vì tab vẫn còn Player).
 */

/** Phần PlayerEngine mà broadcaster đọc (test truyền transport thật + state giả). */
export interface FollowSource {
  readonly transport: Transport;
  getState(): { countdown: number | null };
  subscribe(listener: () => void): () => void;
  /**
   * Đang chờ phát (đếm ngược / chờ mở khóa âm thanh): ô nhịp đếm vào sắp chạy — Player vẽ frame đầu của
   * nó. Gửi trong `countIn` của tin `state` khi chưa phát để overlay vẽ y hệt (không nhảy lúc bắt đầu chạy).
   * Thiếu = không có.
   */
  readonly preRoll?: BeatRange | null;
}

/** Phần BroadcastChannel dùng tới (test truyền kênh giả). */
export interface FollowChannelLike {
  postMessage(message: unknown): void;
  addEventListener(type: 'message', listener: (e: MessageEvent) => void): void;
  removeEventListener(type: 'message', listener: (e: MessageEvent) => void): void;
  close(): void;
}

export interface FollowBroadcasterDeps {
  /** Kênh BroadcastChannel; null = không có (trình duyệt cũ). Mặc định: mở FOLLOW_CHANNEL nếu có. */
  channel?: FollowChannelLike | null;
  /** Relay qua OBS WebSocket. Mặc định relayToObs. */
  relay?: (message: FollowMessage) => void;
  /** Đồng hồ chung (epoch ms). Mặc định followNow. */
  now?: () => number;
  /** id tab gửi. Mặc định một id cố định cho cả tab (overlay thấy cùng một Player khi đổi bài). */
  senderId?: string;
  /** Tùy chọn hiển thị hiện tại. Mặc định đọc Cài đặt. */
  getDisplay?: () => FollowDisplay;
  /** Nghe tùy chọn hiển thị đổi. Mặc định useSettings.subscribe. */
  subscribeDisplay?: (listener: () => void) => () => void;
  /** Tab đang ẩn? Mặc định document.visibilityState. */
  isHidden?: () => boolean;
  /** Cửa sổ nghe pagehide / pageshow / visibilitychange; null = không nghe. Mặc định window. */
  win?: Window | null;
  /**
   * Ưu tiên giữa các bộ phát cùng id tab: cao hơn thì nói thay tab (cửa sổ nổi = 1, Player chính = 0).
   * Mặc định 0.
   */
  priority?: number;
}

/** Tùy chọn hiển thị của Player từ Cài đặt. */
export function displayFromSettings(s: Settings): FollowDisplay {
  return {
    scheme: s.controlScheme,
    mobileSemitone: s.mobileSemitone,
    labels: { ...s.labelOverrides },
    lookahead: s.lookahead,
    tileScale: s.tileScale,
    subLabel: s.subLabel,
    countIn: s.countIn,
    language: s.language,
    theme: s.theme,
  };
}

let tabSenderId: string | null = null;
/** id cố định của tab này (tạo lười). */
function tabSender(): string {
  tabSenderId ??= newFollowSenderId();
  return tabSenderId;
}

/**
 * Số thứ tự tin `state` dùng chung cho mọi bộ phát của module (Player chính và cửa sổ nổi cùng id tab):
 * overlay bỏ tin có `seq` không tăng — hai bộ đếm riêng sẽ làm tin của bộ nói sau bị coi là cũ.
 */
let stateSeq = 0;

/** Các bộ phát đang chạy theo id tab, theo thứ tự start. */
const tabBroadcasters = new Map<string, FollowBroadcaster[]>();

/** Bộ đang nói thay id tab: priority cao nhất, bằng nhau thì start sau cùng. */
function speakerOf(from: string): FollowBroadcaster | null {
  let best: FollowBroadcaster | null = null;
  for (const b of tabBroadcasters.get(from) ?? []) {
    if (!best || b.priority >= best.priority) best = b;
  }
  return best;
}

function openChannel(): FollowChannelLike | null {
  if (typeof BroadcastChannel !== 'function') return null;
  try {
    return new BroadcastChannel(FOLLOW_CHANNEL);
  } catch {
    return null;
  }
}

/**
 * Bộ phát của một Player đang mount. `start()` mở kênh + timer + listener và gửi ngay `song` + `state`;
 * `stop()` gửi `bye` rồi dọn sạch. Không đụng tới transport (chỉ đọc).
 */
export class FollowBroadcaster {
  private readonly source: FollowSource;
  private songSource: string;
  private songKey: string;
  private readonly deps: FollowBroadcasterDeps;
  private readonly now: () => number;
  private readonly relay: (message: FollowMessage) => void;
  private readonly from: string;
  private readonly getDisplay: () => FollowDisplay;
  readonly priority: number;
  private channel: FollowChannelLike | null = null;
  private running = false;
  /**
   * Đã gửi `bye` vì trang bị ẩn để rời / đóng (pagehide): không gửi gì nữa — visibilitychange hay
   * heartbeat bắn SAU pagehide sẽ kéo overlay về `follow` với Player đã đóng. pageshow (bfcache) mở lại.
   */
  private departed = false;
  private cleanups: (() => void)[] = [];
  /** Chữ ký transport đã gửi gần nhất (nhận ra đổi thật trong đống thông báo của engine). */
  private lastSig = '';
  private lastDisplay: FollowDisplay;
  private lastCountdown: number | null = null;
  private countdownEndsAt: number | null = null;

  constructor(source: FollowSource, songSource: string, deps: FollowBroadcasterDeps = {}) {
    this.source = source;
    this.songSource = songSource;
    this.songKey = songKeyOf(songSource);
    this.deps = deps;
    this.now = deps.now ?? followNow;
    this.relay = deps.relay ?? relayToObs;
    this.from = deps.senderId ?? tabSender();
    this.getDisplay = deps.getDisplay ?? (() => displayFromSettings(useSettings.getState()));
    this.priority = deps.priority ?? 0;
    this.lastDisplay = this.getDisplay();
  }

  get senderId(): string {
    return this.from;
  }

  /** Bộ này đang nói thay tab (xem `priority`). */
  get speaking(): boolean {
    return this.running && speakerOf(this.from) === this;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    tabBroadcasters.set(this.from, [...(tabBroadcasters.get(this.from) ?? []), this]);
    this.channel = this.deps.channel !== undefined ? this.deps.channel : openChannel();
    const ch = this.channel;
    if (ch) {
      ch.addEventListener('message', this.onChannelMessage);
      this.cleanups.push(() => ch.removeEventListener('message', this.onChannelMessage));
    }
    this.cleanups.push(this.source.subscribe(this.onEngineChange));
    const subscribeDisplay =
      this.deps.subscribeDisplay ?? ((l: () => void) => useSettings.subscribe(l));
    this.cleanups.push(subscribeDisplay(this.onDisplayChange));
    const heartbeat = setInterval(() => this.sendState('tick'), FOLLOW_HEARTBEAT_MS);
    const songRepeat = setInterval(() => this.sendSong('tick'), FOLLOW_SONG_REPEAT_MS);
    this.cleanups.push(() => {
      clearInterval(heartbeat);
      clearInterval(songRepeat);
    });
    const win =
      this.deps.win !== undefined ? this.deps.win : typeof window !== 'undefined' ? window : null;
    if (win) {
      win.addEventListener('pagehide', this.onPageHide);
      win.addEventListener('pageshow', this.onPageShow);
      win.document.addEventListener('visibilitychange', this.onVisibility);
      this.cleanups.push(() => {
        win.removeEventListener('pagehide', this.onPageHide);
        win.removeEventListener('pageshow', this.onPageShow);
        win.document.removeEventListener('visibilitychange', this.onVisibility);
      });
    }
    this.lastCountdown = this.source.getState().countdown;
    this.countdownEndsAt =
      this.lastCountdown !== null ? this.now() + this.lastCountdown * 1000 : null;
    // Mount KHÔNG phải thao tác của người dùng: `announce` (overlay đang theo tab khác không bị cướp;
    // overlay chưa theo ai / mất Player / đang theo chính tab này thì nhận ngay).
    this.sendSong('announce');
    this.sendState('announce');
  }

  /**
   * Rời Player: dọn timer / listener, đóng kênh. Đang nói thay tab: còn bộ khác cùng tab (đóng cửa sổ nổi
   * khi Player chính còn mở) → bộ đó nói tiếp ngay; không còn ai → `bye`.
   */
  stop(): void {
    if (!this.running) return;
    const wasSpeaking = this.speaking;
    const list = (tabBroadcasters.get(this.from) ?? []).filter((b) => b !== this);
    if (list.length > 0) tabBroadcasters.set(this.from, list);
    else tabBroadcasters.delete(this.from);
    const next = wasSpeaking ? speakerOf(this.from) : null;
    if (wasSpeaking && !next) this.post({ v: 1, from: this.from, kind: 'bye' });
    this.running = false;
    for (const c of this.cleanups.splice(0)) c();
    this.channel?.close();
    this.channel = null;
    next?.resume();
  }

  /** Lại được nói thay tab (bộ ưu tiên hơn vừa dừng): báo ngay bài + trạng thái của mình. */
  private resume(): void {
    if (!this.running) return;
    this.lastCountdown = this.source.getState().countdown;
    this.countdownEndsAt =
      this.lastCountdown !== null ? this.now() + this.lastCountdown * 1000 : null;
    this.sendSong('announce');
    this.sendState('announce');
  }

  /** Nguồn bài đổi (sửa ở chỗ khác khi Player đang mở) → `song` + `state` mới (`announce`). */
  setSong(source: string): void {
    if (source === this.songSource) return;
    this.songSource = source;
    this.songKey = songKeyOf(source);
    if (!this.running) return;
    this.sendSong('announce');
    this.sendState('announce');
  }

  // -------------------------------------------------------------------------

  private post(message: FollowMessage): void {
    try {
      this.channel?.postMessage(message);
    } catch {
      // kênh đã đóng / dữ liệu không clone được: bỏ qua lần này
    }
    try {
      this.relay(message);
    } catch {
      // relay OBS lỗi không được làm hỏng Player
    }
  }

  private sendSong(cause: FollowCause): void {
    if (!this.speaking || this.departed) return;
    this.post({
      v: 1,
      from: this.from,
      kind: 'song',
      songKey: this.songKey,
      source: this.songSource,
      cause,
    });
  }

  private sendState(cause: FollowCause): void {
    if (!this.speaking || this.departed) return;
    const message = this.snapshot(cause);
    this.lastSig = this.signature();
    this.post(message);
  }

  /**
   * Trạng thái tại bây giờ, đọc thẳng transport (đồng hồ thật của Player — audio clock khi bật âm
   * thanh): beat ở `sentAt` đúng như Player đang vẽ. Đoạn phát chưa bắt đầu (khoảng chờ output latency)
   * → sentAt là lúc nó bắt đầu. Loop / hết bài chưa kịp áp (tab ẩn không có rAF) thì tự quy đổi.
   */
  private snapshot(cause: FollowCause): FollowStateMessage {
    const tr = this.source.transport;
    const snap = tr.snapshot();
    const now = this.now();
    const clockNow = tr.clock.now();
    let playing = snap.playing;
    let sentAt = now;
    let beat = tr.getBeat();
    if (playing && clockNow < snap.anchorTime) {
      sentAt = now + (snap.anchorTime - clockNow) * 1000;
      beat = snap.anchorBeat;
    }
    if (playing) {
      const wrapEnd = wrapEndOf(snap);
      if (wrapEnd !== null && snap.loop !== null && beat >= wrapEnd) {
        beat = snap.loop.start + ((beat - wrapEnd) % (wrapEnd - snap.loop.start));
      } else if (beat >= snap.endBeat) {
        playing = false;
        beat = snap.endBeat;
      }
    }
    const ci = snap.countIn;
    // Chưa phát mà đang chờ phát (đếm ngược): ô nhịp đếm vào sắp chạy (overlay cũ bỏ qua `countIn` khi
    // `playing` = false nên vẫn tương thích).
    const pre = playing ? null : (this.source.preRoll ?? null);
    const hidden = this.deps.isHidden
      ? this.deps.isHidden()
      : typeof document !== 'undefined' && document.visibilityState === 'hidden';
    this.lastDisplay = this.getDisplay();
    return {
      v: 1,
      from: this.from,
      kind: 'state',
      seq: ++stateSeq,
      songKey: this.songKey,
      sentAt,
      playing,
      beat,
      bpm: snap.bpm,
      countdownEndsAt: this.countdownEndsAt,
      loop: snap.loop ? { startBeat: snap.loop.start, endBeat: snap.loop.end } : null,
      display: this.lastDisplay,
      countIn:
        playing && ci !== null && beat < ci.end
          ? { startBeat: ci.start, endBeat: ci.end }
          : pre
            ? { startBeat: pre.start, endBeat: pre.end }
            : null,
      hidden,
      cause,
    };
  }

  /** Những gì đổi thì overlay phải biết ngay (vị trí liên tục không tính — overlay tự chạy theo tempo). */
  private signature(): string {
    const snap = this.source.transport.snapshot();
    const loop = snap.loop ? `${snap.loop.start}-${snap.loop.end}` : '';
    const ci = snap.countIn ? `${snap.countIn.start}-${snap.countIn.end}` : '';
    const p = snap.playing ? null : (this.source.preRoll ?? null);
    const pre = p ? `${p.start}-${p.end}` : '';
    return `${snap.epoch}|${snap.playing ? 1 : 0}|${snap.bpm}|${loop}|${ci}|${pre}|${this.countdownEndsAt ?? ''}`;
  }

  private readonly onEngineChange = (): void => {
    if (!this.running) return;
    const countdown = this.source.getState().countdown;
    if (countdown !== this.lastCountdown) {
      // Đếm ngược bắt đầu / mỗi giây giảm (tick đúng ranh giới giây) / hủy / hết.
      this.lastCountdown = countdown;
      this.countdownEndsAt = countdown !== null ? this.now() + countdown * 1000 : null;
    }
    if (this.signature() !== this.lastSig) this.sendState('change');
  };

  private readonly onDisplayChange = (): void => {
    if (!this.running) return;
    if (sameFollowDisplay(this.getDisplay(), this.lastDisplay)) return;
    this.sendState('change');
  };

  private readonly onChannelMessage = (e: MessageEvent): void => {
    const msg = parseFollowMessage(e.data);
    if (!msg || msg.kind !== 'hello' || msg.from === this.from) return;
    this.sendSong('reply');
    this.sendState('reply');
  };

  private readonly onPageHide = (): void => {
    if (!this.running || this.departed) return;
    const speaking = this.speaking;
    this.departed = true;
    if (speaking) this.post({ v: 1, from: this.from, kind: 'bye' });
  };

  private readonly onPageShow = (e: PageTransitionEvent): void => {
    // Trở lại từ bfcache: báo lại cho overlay (đã nhận `bye` lúc rời trang) — không giành overlay.
    if (!this.running || !e.persisted) return;
    this.departed = false;
    this.sendSong('announce');
    this.sendState('announce');
  };

  private readonly onVisibility = (): void => {
    this.sendState('tick');
  };
}

/** Ưu tiên của bộ phát "Cửa sổ nổi" (FloatingStage) — hơn Player chính (0). */
export const FLOAT_FOLLOW_PRIORITY = 1;

/**
 * Hook trong PlayerScreen (và FloatingStage với `priority` FLOAT_FOLLOW_PRIORITY): một broadcaster cho
 * mỗi engine (đổi bài = mount lại Player = broadcaster mới, cùng id tab); nguồn bài đổi tại chỗ → `song`
 * mới.
 */
export function useFollowBroadcast(
  engine: PlayerEngine,
  entry: LibraryEntry,
  opts: { priority?: number } = {},
): void {
  const sourceRef = useRef(entry.source);
  const broadcasterRef = useRef<FollowBroadcaster | null>(null);
  const priority = opts.priority ?? 0;
  useEffect(() => {
    const b = new FollowBroadcaster(engine, sourceRef.current, { priority });
    broadcasterRef.current = b;
    b.start();
    return () => {
      b.stop();
      if (broadcasterRef.current === b) broadcasterRef.current = null;
    };
  }, [engine, priority]);
  useEffect(() => {
    sourceRef.current = entry.source;
    broadcasterRef.current?.setSong(entry.source);
  }, [entry.source]);
}

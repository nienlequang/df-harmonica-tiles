/**
 * Phía overlay của "overlay = màn hiển thị của Player chính" (contract ở follow.ts). Thuần (không React /
 * DOM): nhận dữ liệu thô từ BroadcastChannel / CustomEvent của OBS (`receive`), quyết định chế độ, giữ
 * bài + trạng thái mới nhất của Player đang theo. OverlayView nối kênh vào đây và đọc state qua
 * `subscribe` / `getState` (useSyncExternalStore).
 *
 * Chế độ:
 * - `waiting`: vừa tải, chưa nghe thấy Player (tối đa FOLLOW_STANDALONE_AFTER_MS);
 * - `follow`: đang theo một Player (tin `song` / `state` hợp lệ đầu tiên);
 * - `standalone`: không nghe thấy Player sau FOLLOW_STANDALONE_AFTER_MS → tự chạy theo link (tin tới sau
 *   vẫn chuyển sang `follow`);
 * - `lost`: Player đang theo gửi `bye` hoặc im lặng quá FOLLOW_LOST_AFTER_MS (tab ẩn:
 *   FOLLOW_LOST_HIDDEN_AFTER_MS) → tạm dừng, chờ (tin mới của Player bất kỳ → `follow`).
 *
 * Theo Player gửi gần nhất: chỉ đổi sang Player khác khi chưa theo ai / mất Player đang theo, hoặc khi tin
 * của Player kia là đổi thật (`cause` 'change' — người dùng vừa bấm ở tab đó), không phải heartbeat hay
 * `announce` (tab vừa mở). Tin `song` của mọi Player đều được nhớ (vài Player gần nhất) — kể cả khi đang theo
 * Player khác — để lúc chuyển sang Player đó bằng một tin `state` đã có ngay bài, không phải chờ lần nhắc lại.
 */
import type { FollowMessage, FollowSongMessage, FollowStateMessage } from './follow';
import {
  FOLLOW_LOST_AFTER_MS,
  FOLLOW_LOST_HIDDEN_AFTER_MS,
  FOLLOW_STANDALONE_AFTER_MS,
  parseFollowMessage,
} from './follow';

export type FollowMode = 'waiting' | 'follow' | 'standalone' | 'lost';

export interface FollowReceiverState {
  mode: FollowMode;
  /** id Player đang theo (null = chưa theo ai). */
  sender: string | null;
  /** Bài mới nhất của Player đang theo (null = chưa nhận). */
  song: FollowSongMessage | null;
  /** Trạng thái mới nhất của Player đang theo (null = chưa nhận). */
  state: FollowStateMessage | null;
}

export interface FollowReceiverOptions {
  /** id của overlay này (cho `hello`). */
  selfId?: string;
  standaloneAfterMs?: number;
  lostAfterMs?: number;
  lostHiddenAfterMs?: number;
}

const INITIAL: FollowReceiverState = { mode: 'waiting', sender: null, song: null, state: null };

/** Số Player (tab) mà overlay nhớ bài gần nhất của chúng. */
const KNOWN_SONGS_MAX = 8;

/**
 * Vòng đời: `start(send)` (gửi `hello`, hẹn giờ) ↔ `stop()` (dọn timer, giữ state) — gọi lại được
 * (StrictMode mount 2 lần). `receive` nhận tin bất cứ lúc nào.
 */
export class FollowReceiver {
  private st: FollowReceiverState = INITIAL;
  private readonly listeners = new Set<() => void>();
  private readonly opts: Required<FollowReceiverOptions>;
  private standaloneTimer: ReturnType<typeof setTimeout> | null = null;
  private lostTimer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  /** Tab Player đang theo đang ẩn (theo tin `state` gần nhất) — chờ lâu hơn trước khi coi là mất. */
  private senderHidden = false;
  /** Tin `song` gần nhất của từng Player (cả Player chưa theo), cũ nhất trước. */
  private readonly knownSongs = new Map<string, FollowSongMessage>();

  constructor(opts: FollowReceiverOptions = {}) {
    this.opts = {
      selfId: opts.selfId ?? 'overlay',
      standaloneAfterMs: opts.standaloneAfterMs ?? FOLLOW_STANDALONE_AFTER_MS,
      lostAfterMs: opts.lostAfterMs ?? FOLLOW_LOST_AFTER_MS,
      lostHiddenAfterMs: opts.lostHiddenAfterMs ?? FOLLOW_LOST_HIDDEN_AFTER_MS,
    };
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  readonly getState = (): FollowReceiverState => this.st;

  /**
   * Gửi `hello` qua `send` (BroadcastChannel — Player trả lời ngay bằng bài + trạng thái; null = không
   * gửi được) và hẹn giờ: đang chờ → tự chạy sau FOLLOW_STANDALONE_AFTER_MS; đang theo → hạn mất Player.
   */
  start(send: ((message: FollowMessage) => void) | null = null): void {
    if (this.running) return;
    this.running = true;
    try {
      send?.({ v: 1, from: this.opts.selfId, kind: 'hello' });
    } catch {
      // kênh lỗi: vẫn chờ heartbeat / tự chạy
    }
    if (this.st.mode === 'waiting') {
      this.clearStandalone();
      this.standaloneTimer = setTimeout(this.onStandalone, this.opts.standaloneAfterMs);
    } else if (this.st.mode === 'follow') {
      this.armLost(this.senderHidden);
    }
  }

  /** Dọn timer (giữ bài / trạng thái); `start` lại được. */
  stop(): void {
    this.running = false;
    this.clearStandalone();
    this.clearLost();
  }

  /** Dữ liệu thô từ kênh; dữ liệu lạ / `hello` của overlay khác bị bỏ qua. */
  receive(data: unknown): void {
    const msg = parseFollowMessage(data);
    if (!msg || msg.kind === 'hello') return;
    const cur = this.st;
    if (msg.kind === 'bye') {
      this.knownSongs.delete(msg.from);
      if (msg.from === cur.sender && cur.mode === 'follow') this.toLost();
      return;
    }
    if (msg.kind === 'song') this.rememberSong(msg);
    const lost = cur.mode !== 'follow' || cur.sender === null;
    const cause = msg.cause ?? 'change';
    if (msg.from !== cur.sender && !lost && cause !== 'change') return;
    const switching = msg.from !== cur.sender;
    // Chuyển sang Player khác: dùng bài đã nhớ của nó (trạng thái thì chờ tin của nó).
    let song = switching ? (this.knownSongs.get(msg.from) ?? null) : cur.song;
    let state = switching ? null : cur.state;
    if (msg.kind === 'song') {
      song = msg;
      // Bài đổi mà trạng thái còn của bài cũ → bỏ trạng thái cũ (chờ trạng thái của bài mới).
      if (state && state.songKey !== msg.songKey) state = null;
    } else {
      // Tin cũ hơn tin đã có (relay giao lệch thứ tự) → bỏ.
      if (state && !switching && msg.seq <= state.seq && msg.sentAt <= state.sentAt) return;
      state = msg;
      if (song && song.songKey !== msg.songKey) song = null;
    }
    this.clearStandalone();
    this.senderHidden = msg.kind === 'state' ? msg.hidden === true : (state?.hidden ?? false);
    if (this.running) this.armLost(this.senderHidden);
    this.set({ mode: 'follow', sender: msg.from, song, state });
  }

  // -------------------------------------------------------------------------

  private rememberSong(msg: FollowSongMessage): void {
    this.knownSongs.delete(msg.from);
    this.knownSongs.set(msg.from, msg);
    while (this.knownSongs.size > KNOWN_SONGS_MAX) {
      const oldest = this.knownSongs.keys().next();
      if (oldest.done) break;
      this.knownSongs.delete(oldest.value);
    }
  }

  private set(next: FollowReceiverState): void {
    this.st = next;
    for (const l of Array.from(this.listeners)) l();
  }

  private readonly onStandalone = (): void => {
    this.standaloneTimer = null;
    if (this.st.mode !== 'waiting') return;
    this.set({ ...this.st, mode: 'standalone' });
  };

  private readonly onLost = (): void => {
    this.lostTimer = null;
    if (this.st.mode !== 'follow') return;
    this.toLost();
  };

  private toLost(): void {
    this.clearLost();
    this.set({ ...this.st, mode: 'lost' });
  }

  private armLost(hidden: boolean): void {
    this.clearLost();
    this.lostTimer = setTimeout(
      this.onLost,
      hidden ? this.opts.lostHiddenAfterMs : this.opts.lostAfterMs,
    );
  }

  private clearStandalone(): void {
    if (this.standaloneTimer !== null) clearTimeout(this.standaloneTimer);
    this.standaloneTimer = null;
  }

  private clearLost(): void {
    if (this.lostTimer !== null) clearTimeout(this.lostTimer);
    this.lostTimer = null;
  }
}

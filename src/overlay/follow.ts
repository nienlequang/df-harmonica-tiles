/**
 * Overlay OBS = màn hiển thị của Player chính (góp ý 2026-10-15 "OBS chỉ lo hiển thị"): Player chính
 * phát bài + trạng thái transport + tùy chọn hiển thị; overlay chỉ đi theo. Hai đường truyền:
 * BroadcastChannel `FOLLOW_CHANNEL` (overlay cùng trình duyệt — cửa sổ "Xem trước") và relay
 * qua OBS WebSocket (obs-browser vendor request `emit_event` → window CustomEvent `FOLLOW_EVENT` trong
 * Browser Source). Module thuần: không React / DOM ngoài `crypto` / `Date`.
 *
 * Đồng hồ chung là `followNow()` = Date.now() (epoch ms): Player (trình duyệt) và Browser Source (CEF của
 * OBS) là hai tiến trình khác nhau — đồng hồ hệ thống là thứ duy nhất chúng cùng đọc (performance.timeOrigin
 * của hai tiến trình lệch nhau nếu đồng hồ hệ thống được chỉnh giữa lúc hai bên mở).
 */
import type { Lang } from '../i18n/strings';
import type {
  ControlScheme,
  MobileSemitone,
  ModifierLabelOverrides,
  SubLabel,
  Theme,
} from '../ui/settings';

/** BroadcastChannel cho overlay cùng trình duyệt (cửa sổ "Xem trước"). */
export const FOLLOW_CHANNEL = 'dfht-follow';
/** Tên event của obs-browser `emit_event` → window CustomEvent(detail = message) trong Browser Source của OBS. */
export const FOLLOW_EVENT = 'dfht-follow';

/** Player gửi lại `state` (heartbeat) mỗi chừng này ms, cả khi đang dừng. */
export const FOLLOW_HEARTBEAT_MS = 1000;
/** Player nhắc lại `song` mỗi chừng này ms (cho overlay mở sau / OBS refresh source). */
export const FOLLOW_SONG_REPEAT_MS = 5000;
/** Overlay không nghe thấy Player trong chừng này ms sau khi tải → tự chạy theo link (standalone). */
export const FOLLOW_STANDALONE_AFTER_MS = 2000;
/** Không có tin của Player đang theo trong chừng này ms → coi như mất Player (tạm dừng, chờ). */
export const FOLLOW_LOST_AFTER_MS = 4000;
/**
 * Như trên nhưng khi tab Player đang ẩn (người chơi Alt-Tab vào game): trình duyệt hãm timer của tab ẩn
 * (1 lần / giây, sau 5 phút còn 1 lần / phút) nên heartbeat thưa đi — overlay vẫn tự chạy tiếp theo tempo.
 */
export const FOLLOW_LOST_HIDDEN_AFTER_MS = 90_000;
/** Lệch quá chừng này beat so với vị trí mong đợi → nhảy thẳng tới đó (nhỏ hơn thì để yên, không giật). */
export const FOLLOW_SNAP_BEATS = 0.05;

/** Độ dài tối đa của nguồn bài trong một tin (bài rất dài vẫn lọt; dữ liệu lạ thì bỏ). */
export const FOLLOW_SOURCE_MAX = 2_000_000;
const ID_MAX = 128;
const KEY_MAX = 64;
const LABEL_MAX = 24;

/** Hiển thị lấy từ Player chính (overlay không có chỉnh riêng). */
export interface FollowDisplay {
  scheme: ControlScheme;
  mobileSemitone: MobileSemitone;
  labels: ModifierLabelOverrides;
  lookahead: number;
  tileScale: number;
  subLabel: SubLabel;
  countIn: boolean;
  language: Lang;
  theme: Theme;
}

/**
 * Vì sao Player gửi tin: `change` = đổi thật (người dùng bấm play / dừng / tua / tempo / loop / hiển thị
 * ở tab đó), `tick` = nhắc lại định kỳ / heartbeat, `reply` = trả lời `hello`, `announce` = Player vừa
 * mount / bài vừa đổi tại chỗ / trang trở lại từ bfcache (KHÔNG phải thao tác của người dùng). Overlay chỉ
 * chuyển sang theo một Player KHÁC khi tin của nó là `change` — hai tab Player cùng mở không giành nhau
 * mỗi giây, và mở thêm một tab app (`#/` cũng là màn chơi) không cướp overlay của tab đang chơi.
 */
export type FollowCause = 'change' | 'tick' | 'reply' | 'announce';

interface FollowBase {
  v: 1;
  /** id ngẫu nhiên của tab Player gửi */
  from: string;
}
/** Bài đang mở ở Player chính (gửi khi đổi bài + nhắc lại định kỳ cho overlay mở sau). */
export interface FollowSongMessage extends FollowBase {
  kind: 'song';
  songKey: string;
  source: string;
  /** Thiếu = 'change'. */
  cause?: FollowCause;
}
/** Trạng thái transport (gửi khi đổi + heartbeat). */
export interface FollowStateMessage extends FollowBase {
  kind: 'state';
  seq: number;
  songKey: string;
  /**
   * epoch ms (`followNow()`) mà tại đó transport ở `beat`. Đang phát mà đoạn phát chưa bắt đầu (khoảng
   * chờ output latency của audio) thì là thời điểm TƯƠNG LAI lúc beat bắt đầu chạy.
   */
  sentAt: number;
  playing: boolean;
  /** beat của transport tại sentAt (lúc đếm vào: nằm trong `countIn`, có thể âm) */
  beat: number;
  bpm: number;
  /** epoch ms lúc đếm ngược (start delay) kết thúc; null = không đếm ngược */
  countdownEndsAt: number | null;
  loop: { startBeat: number; endBeat: number } | null;
  display: FollowDisplay;
  /**
   * Ô nhịp đếm vào (beat); null / thiếu = không có. `playing` = true: ô nhịp đếm vào của lần phát hiện tại.
   * `playing` = false (vòng R7): Player đang chờ phát (đếm ngược / chờ mở khóa âm thanh) — ô nhịp đếm vào SẮP
   * chạy; overlay vẽ frame đầu của nó (ô đứng yên) như Player để lúc chạy không nhảy. Overlay cũ bỏ qua trường
   * này khi chưa phát nên vẫn tương thích.
   */
  countIn?: { startBeat: number; endBeat: number } | null;
  /** Tab Player đang ẩn (heartbeat có thể thưa — xem FOLLOW_LOST_HIDDEN_AFTER_MS). Thiếu = false. */
  hidden?: boolean;
  /** Thiếu = 'change'. */
  cause?: FollowCause;
}
/** Overlay mới mở hỏi lại bài + trạng thái (chỉ qua BroadcastChannel). */
export interface FollowHelloMessage extends FollowBase {
  kind: 'hello';
}
/** Player chính đóng / rời trang. */
export interface FollowByeMessage extends FollowBase {
  kind: 'bye';
}
export type FollowMessage =
  FollowSongMessage | FollowStateMessage | FollowHelloMessage | FollowByeMessage;

// ---------------------------------------------------------------------------
// Kiểm dữ liệu
// ---------------------------------------------------------------------------

type Rec = Record<string, unknown>;

const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isStr = (v: unknown, max: number): v is string =>
  typeof v === 'string' && v.length > 0 && v.length <= max;
const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v));

function oneOf<T extends string>(v: unknown, allowed: readonly T[]): T | null {
  return typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : null;
}

function readCause(v: unknown): FollowCause | undefined | null {
  if (v === undefined) return undefined;
  return oneOf(v, ['change', 'tick', 'reply', 'announce'] as const);
}

/** Khoảng beat {startBeat, endBeat} hợp lệ (start < end) hoặc null; dữ liệu lạ → undefined. */
function readRange(v: unknown): { startBeat: number; endBeat: number } | null | undefined {
  if (v === null) return null;
  if (!isRec(v) || !isNum(v.startBeat) || !isNum(v.endBeat) || !(v.startBeat < v.endBeat)) {
    return undefined;
  }
  return { startBeat: v.startBeat, endBeat: v.endBeat };
}

/** Tên nút: chuỗi (bỏ xuống dòng / tab, trim, tối đa 24 ký tự); thiếu → ''. Kiểu khác → null. */
function readLabel(v: unknown): string | null {
  if (v === undefined) return '';
  if (typeof v !== 'string') return null;
  return v
    .replace(/[\r\n\t]+/g, ' ')
    .trim()
    .slice(0, LABEL_MAX);
}

function readDisplay(v: unknown): FollowDisplay | null {
  if (!isRec(v)) return null;
  const scheme = oneOf(v.scheme, ['pc', 'mobile'] as const);
  const mobileSemitone = oneOf(v.mobileSemitone, ['toggle', 'oneShot'] as const);
  const subLabel = oneOf(v.subLabel, ['solfege', 'number', 'none'] as const);
  const language = oneOf(v.language, ['vi', 'en'] as const);
  const theme = oneOf(v.theme, ['dark', 'light'] as const);
  if (!scheme || !mobileSemitone || !subLabel || !language || !theme) return null;
  if (!isNum(v.lookahead) || !isNum(v.tileScale) || typeof v.countIn !== 'boolean') return null;
  if (!isRec(v.labels)) return null;
  const left = readLabel(v.labels.left);
  const right = readLabel(v.labels.right);
  const natural = readLabel(v.labels.natural);
  const scroll = readLabel(v.labels.scroll);
  if (left === null || right === null || natural === null || scroll === null) return null;
  return {
    scheme,
    mobileSemitone,
    labels: { left, right, natural, scroll },
    lookahead: Math.round(clamp(v.lookahead, 4, 12)),
    tileScale: clamp(v.tileScale, 0.5, 3),
    subLabel,
    countIn: v.countIn,
    language,
    theme,
  };
}

function readState(d: Rec, from: string): FollowStateMessage | null {
  if (!isNum(d.seq) || d.seq < 0) return null;
  if (!isStr(d.songKey, KEY_MAX)) return null;
  if (!isNum(d.sentAt) || d.sentAt <= 0) return null;
  if (typeof d.playing !== 'boolean' || !isNum(d.beat) || !isNum(d.bpm) || d.bpm <= 0) return null;
  // Thiếu trường = null: obs_data (đường relay OBS WebSocket → Browser Source) làm rơi mọi giá trị
  // JSON null, nên `countdownEndsAt` / `loop` (và `countIn`) có thể đến dưới dạng "không có".
  const countdownEndsAt = d.countdownEndsAt === undefined ? null : d.countdownEndsAt;
  if (countdownEndsAt !== null && !isNum(countdownEndsAt)) return null;
  const loop = d.loop === undefined ? null : readRange(d.loop);
  if (loop === undefined) return null;
  const display = readDisplay(d.display);
  if (!display) return null;
  const countIn = d.countIn === undefined ? null : readRange(d.countIn);
  if (countIn === undefined) return null;
  if (d.hidden !== undefined && typeof d.hidden !== 'boolean') return null;
  const cause = readCause(d.cause);
  if (cause === null) return null;
  const msg: FollowStateMessage = {
    v: 1,
    from,
    kind: 'state',
    seq: d.seq,
    songKey: d.songKey,
    sentAt: d.sentAt,
    playing: d.playing,
    beat: d.beat,
    bpm: clamp(d.bpm, 20, 400),
    countdownEndsAt,
    loop,
    display,
    countIn,
    hidden: d.hidden === true,
  };
  if (cause !== undefined) msg.cause = cause;
  return msg;
}

/**
 * Kiểm + thu hẹp dữ liệu nhận được (BroadcastChannel `MessageEvent.data` hoặc CustomEvent `detail`)
 * thành FollowMessage MỚI (không giữ tham chiếu tới dữ liệu gốc); dữ liệu lạ / hỏng / sai version /
 * kind lạ → null. Số kẹp vào tầm hợp lệ (bpm 20..400, lookahead 4..12, tileScale 0.5..3).
 */
export function parseFollowMessage(data: unknown): FollowMessage | null {
  if (!isRec(data) || data.v !== 1 || !isStr(data.from, ID_MAX)) return null;
  const from = data.from;
  switch (data.kind) {
    case 'hello':
      return { v: 1, from, kind: 'hello' };
    case 'bye':
      return { v: 1, from, kind: 'bye' };
    case 'song': {
      if (!isStr(data.songKey, KEY_MAX)) return null;
      if (typeof data.source !== 'string' || data.source.length > FOLLOW_SOURCE_MAX) return null;
      const cause = readCause(data.cause);
      if (cause === null) return null;
      const msg: FollowSongMessage = {
        v: 1,
        from,
        kind: 'song',
        songKey: data.songKey,
        source: data.source,
      };
      if (cause !== undefined) msg.cause = cause;
      return msg;
    }
    case 'state':
      return readState(data, from);
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Tiện ích
// ---------------------------------------------------------------------------

/** Hai bộ hiển thị giống hệt nhau (so từng trường, cả 4 tên nút). */
export function sameFollowDisplay(a: FollowDisplay, b: FollowDisplay): boolean {
  return (
    a.scheme === b.scheme &&
    a.mobileSemitone === b.mobileSemitone &&
    a.lookahead === b.lookahead &&
    a.tileScale === b.tileScale &&
    a.subLabel === b.subLabel &&
    a.countIn === b.countIn &&
    a.language === b.language &&
    a.theme === b.theme &&
    a.labels.left === b.labels.left &&
    a.labels.right === b.labels.right &&
    a.labels.natural === b.labels.natural &&
    a.labels.scroll === b.labels.scroll
  );
}

/** id ngẫu nhiên cho tab Player gửi (`FollowBase.from`). */
export function newFollowSenderId(): string {
  const c = (globalThis as { crypto?: Partial<Crypto> }).crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Đồng hồ chung của Player và overlay (epoch ms) — xem đầu file. */
export function followNow(): number {
  return Date.now();
}

/**
 * Khóa của một bài = FNV-1a 32 bit trên nguồn .harm (mã UTF-16) + độ dài. Overlay so khóa này với bài
 * nhúng trong link để biết có dùng tạm được bài đó trong lúc chờ tin `song` không.
 */
export function songKeyOf(source: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < source.length; i++) {
    h ^= source.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `${h.toString(16).padStart(8, '0')}-${source.length.toString(36)}`;
}

/**
 * Beat mong đợi ở thời điểm `t` (epoch ms) theo một tin `state`: đang phát thì
 * `beat + (t − sentAt) · bpm / 60000` (t trước sentAt → đứng ở `beat`); qua loop end thì quay về loop
 * start (như transport — chỉ khi đoạn đang phát nằm trước loop end). Đang dừng = `beat`.
 */
export function expectedBeatAt(
  s: Pick<FollowStateMessage, 'playing' | 'beat' | 'bpm' | 'sentAt' | 'loop'>,
  t: number,
): number {
  if (!s.playing) return s.beat;
  const beat = s.beat + (Math.max(0, t - s.sentAt) * s.bpm) / 60_000;
  const loop = s.loop;
  if (loop && s.beat < loop.endBeat && beat >= loop.endBeat) {
    const len = loop.endBeat - loop.startBeat;
    return loop.startBeat + ((beat - loop.endBeat) % len);
  }
  return beat;
}

/** Số giây đếm ngược còn lại (làm tròn lên) tại `t`; null khi không đếm / đã hết. */
export function countdownLeftAt(endsAt: number | null, t: number): number | null {
  if (endsAt === null) return null;
  const ms = endsAt - t;
  return ms > 0 ? Math.ceil(ms / 1000 - 1e-6) : null;
}

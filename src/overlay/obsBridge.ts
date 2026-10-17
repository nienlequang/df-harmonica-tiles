import { useSyncExternalStore } from 'react';
import { FOLLOW_EVENT } from './follow';
import type { FollowMessage, FollowSongMessage, FollowStateMessage } from './follow';
import {
  OBS_DEFAULT_HOST,
  OBS_DEFAULT_PORT,
  OBS_STATUS,
  ObsClient,
  ObsError,
  isObsError,
  obsConnectUrl,
} from './obsWebsocket';
import type { ObsErrorKind } from './obsWebsocket';

/**
 * Cầu nối OBS WebSocket (OBS 28+) dùng chung cho cả tab (module singleton):
 * - một kết nối obs-websocket (`connectObs` / `disconnectObs`), trạng thái cho giao diện qua
 *   `useObsBridge` (useSyncExternalStore);
 * - "Nhớ trên máy này" (mặc định bật): địa chỉ + cổng + mật khẩu trong localStorage, lần dùng đầu tiên
 *   của module (Player gửi tin đầu tiên qua `relayToObs`, hoặc khối kết nối mở ra) tự kết nối lại lặng lẽ;
 *   hỏng thì thử lại giãn dần (1 s → 30 s) rồi thôi, không báo lỗi;
 * - `relayToObs`: chuyển FollowMessage của Player chính tới MỌI Browser Source trong OBS bằng vendor
 *   request `obs-browser` / `emit_event` (trong source: window CustomEvent `FOLLOW_EVENT`, detail = tin) —
 *   gửi rồi quên, không bao giờ throw, gộp loạt tin dồn dập (≤ 20 lần / giây, luôn gửi tin mới nhất);
 * - `addOverlayToObs`: tạo / cập nhật Browser Source "DF Harmonica Tiles" cỡ canvas tại 0,0 trên cùng của
 *   cảnh đang phát → overlay bố cục cả canvas tự khớp bảng phím game, không phải kéo.
 */

/** Tên Browser Source app tạo trong OBS (tìm lại theo tên để cập nhật thay vì tạo thêm). */
export const OBS_INPUT_NAME = 'DF Harmonica Tiles';
/** Khóa localStorage của "Nhớ trên máy này". */
export const OBS_PREFS_KEY = 'dfht-obs-ws';
/** Khoảng cách tối thiểu giữa hai lượt gửi relay (≤ 20 lượt / giây). */
export const OBS_RELAY_MIN_INTERVAL_MS = 50;
/** Socket còn nhiều hơn chừng này byte chưa gửi → hoãn lượt relay (giữ tin mới nhất). */
export const OBS_RELAY_MAX_BUFFERED = 256 * 1024;
export const OBS_RELAY_CONGESTED_RETRY_MS = 200;
/** Thời gian chờ trước mỗi lần tự kết nối lại (hết danh sách → thôi). */
export const OBS_RECONNECT_DELAYS_MS: readonly number[] = [1000, 2000, 4000, 8000, 16_000, 30_000];
/** Sau khi thêm / cập nhật source (OBS tải lại trang overlay): gửi lại bài sau chừng này ms. */
export const OBS_SONG_RESEND_AFTER_ADD_MS = 1500;

/**
 * Loop "không có" đi qua được OBS: obs-websocket / obs-browser chuyển dữ liệu qua `obs_data`, mà
 * `obs_data` BỎ MẤT trường JSON `null` — `loop: null` tới Browser Source thành thiếu trường và
 * `parseFollowMessage` bỏ cả tin. Đoạn beat âm rất xa có cùng nghĩa với không loop: `expectedBeatAt` không
 * bao giờ quay vòng (beat của bài không bao giờ < endBeat) và overlay bỏ loop có endBeat ≤ 0.
 */
export const OBS_NO_LOOP: Readonly<{ startBeat: number; endBeat: number }> = {
  startBeat: -2e9,
  endBeat: -1e9,
};

// ---------------------------------------------------------------------------
// Trạng thái
// ---------------------------------------------------------------------------

export type ObsStatus = 'off' | 'connecting' | 'connected' | 'error';

export interface ObsBridgeState {
  status: ObsStatus;
  /** Phiên bản OBS (GetVersion), vd. "31.0.2"; null = chưa biết. */
  obsVersion: string | null;
  /** Phiên bản obs-websocket (Hello), vd. "5.5.4". */
  wsVersion: string | null;
  /** Lỗi khi `status` = 'error'. */
  error: ObsError | null;
  /** Đang tự kết nối lại (lúc mở app với mật khẩu đã nhớ / sau khi mất kết nối) — không phải người bấm. */
  auto: boolean;
  /** Địa chỉ của kết nối hiện tại / gần nhất. */
  host: string;
  port: number;
}

const INITIAL: ObsBridgeState = {
  status: 'off',
  obsVersion: null,
  wsVersion: null,
  error: null,
  auto: false,
  host: OBS_DEFAULT_HOST,
  port: OBS_DEFAULT_PORT,
};

let state: ObsBridgeState = INITIAL;
const listeners = new Set<() => void>();

function setState(patch: Partial<ObsBridgeState>): void {
  state = { ...state, ...patch };
  for (const l of Array.from(listeners)) l();
}

export function getObsBridgeState(): ObsBridgeState {
  return state;
}

export function subscribeObsBridge(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Trạng thái kết nối OBS cho React. */
export function useObsBridge(): ObsBridgeState {
  return useSyncExternalStore(subscribeObsBridge, getObsBridgeState, getObsBridgeState);
}

/** Đang có kết nối OBS WebSocket để relay không. */
export function isObsRelayActive(): boolean {
  return state.status === 'connected' && client !== null;
}

// ---------------------------------------------------------------------------
// "Nhớ trên máy này"
// ---------------------------------------------------------------------------

export interface ObsPrefs {
  host: string;
  port: number;
  password: string;
  /** Ô "Nhớ trên máy này" (mặc định bật). */
  remember: boolean;
  /** Có địa chỉ + mật khẩu đã lưu. */
  saved: boolean;
  /** Tự kết nối khi mở app (tắt khi người dùng bấm Ngắt kết nối). */
  auto: boolean;
}

interface StoredPrefs {
  v: 1;
  remember: boolean;
  host?: string;
  port?: number;
  password?: string;
  auto?: boolean;
}

const DEFAULT_PREFS: ObsPrefs = {
  host: OBS_DEFAULT_HOST,
  port: OBS_DEFAULT_PORT,
  password: '',
  remember: true,
  saved: false,
  auto: false,
};

function readStored(): StoredPrefs | null {
  try {
    const text = localStorage.getItem(OBS_PREFS_KEY);
    if (!text) return null;
    const v: unknown = JSON.parse(text);
    if (typeof v !== 'object' || v === null) return null;
    const r = v as Record<string, unknown>;
    if (r.v !== 1 || typeof r.remember !== 'boolean') return null;
    const out: StoredPrefs = { v: 1, remember: r.remember };
    if (typeof r.host === 'string' && r.host.length <= 255) out.host = r.host;
    if (typeof r.port === 'number' && Number.isInteger(r.port) && r.port > 0 && r.port < 65536) {
      out.port = r.port;
    }
    if (typeof r.password === 'string' && r.password.length <= 1024) out.password = r.password;
    if (typeof r.auto === 'boolean') out.auto = r.auto;
    return out;
  } catch {
    return null;
  }
}

function writeStored(p: StoredPrefs): void {
  try {
    localStorage.setItem(OBS_PREFS_KEY, JSON.stringify(p));
  } catch {
    // bộ nhớ bị chặn / đầy: chỉ mất phần "nhớ"
  }
}

/** Địa chỉ / mật khẩu đã nhớ (không có → mặc định 127.0.0.1:4455, ô Nhớ bật). */
export function loadObsPrefs(): ObsPrefs {
  const s = readStored();
  if (!s) return { ...DEFAULT_PREFS };
  const saved = s.remember && s.host !== undefined && s.port !== undefined;
  return {
    host: s.host ?? DEFAULT_PREFS.host,
    port: s.port ?? DEFAULT_PREFS.port,
    password: s.password ?? '',
    remember: s.remember,
    saved,
    auto: saved && s.auto !== false,
  };
}

function storeCreds(c: Creds, auto: boolean): void {
  writeStored({ v: 1, remember: true, host: c.host, port: c.port, password: c.password, auto });
}

/**
 * Ô "Nhớ trên máy này" đổi: tắt → xóa ngay địa chỉ + mật khẩu đã lưu; bật khi đang kết nối → lưu kết nối
 * hiện tại.
 */
export function setObsRemember(remember: boolean): void {
  if (!remember) {
    writeStored({ v: 1, remember: false });
    return;
  }
  if (creds && state.status === 'connected') storeCreds(creds, true);
  else writeStored({ ...(readStored() ?? { v: 1 }), remember: true });
}

// ---------------------------------------------------------------------------
// Kết nối
// ---------------------------------------------------------------------------

interface Creds {
  host: string;
  port: number;
  password: string;
}

export interface ObsConnectOptions extends Creds {
  /** "Nhớ trên máy này". */
  remember: boolean;
}

/** Lỗi không tự hết khi thử lại (sai mật khẩu, sai địa chỉ…) → thôi tự kết nối lại. */
const FATAL: ReadonlySet<ObsErrorKind> = new Set<ObsErrorKind>([
  'authFailed',
  'authRequired',
  'insecureHost',
  'invalidHost',
  'insecureContext',
  'unsupported',
  'protocol',
  'blocked',
]);

let client: ObsClient | null = null;
/** Client đang bắt tay (để hủy khi bấm Ngắt / Kết nối lại). */
let inflight: ObsClient | null = null;
let unsubscribeClose: (() => void) | null = null;
/** Thông tin của kết nối hiện tại (giữ trong bộ nhớ để tự kết nối lại khi mất). */
let creds: Creds | null = null;
let attemptSeq = 0;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let retryIndex = 0;
/** Tự kết nối lại vì: mở app (`start` — hết lượt thì im lặng về 'off') / mất kết nối (`drop`). */
let retryReason: 'start' | 'drop' = 'start';
let autoStarted = false;

function pageProtocol(): string {
  return typeof location !== 'undefined' ? location.protocol : '';
}

function toObsError(e: unknown): ObsError {
  return isObsError(e) ? e : new ObsError('protocol');
}

const LNA_PERMISSIONS = ['loopback-network', 'local-network-access', 'local-network'] as const;

/**
 * Quyền truy cập mạng cục bộ của trang (Chrome / Edge: "Local Network Access"). Tên quyền đổi theo phiên
 * bản trình duyệt nên hỏi lần lượt; có một tên bị từ chối → 'denied'. Không hỏi được → null.
 */
export async function localNetworkPermission(): Promise<PermissionState | null> {
  const perms = typeof navigator !== 'undefined' ? navigator.permissions : undefined;
  if (!perms || typeof perms.query !== 'function') return null;
  let result: PermissionState | null = null;
  for (const name of LNA_PERMISSIONS) {
    try {
      const st = await perms.query({ name } as unknown as PermissionDescriptor);
      if (st.state === 'denied') return 'denied';
      result ??= st.state;
    } catch {
      // trình duyệt không biết tên quyền này
    }
  }
  return result;
}

/** Một lần thử: null = đã kết nối; 'stale' = có lần thử mới hơn / đã ngắt (bỏ kết quả). */
async function attempt(c: Creds): Promise<ObsError | null | 'stale'> {
  const seq = ++attemptSeq;
  let url: string;
  try {
    url = obsConnectUrl(c.host, c.port, pageProtocol());
  } catch (e) {
    return toObsError(e);
  }
  const cl = new ObsClient({ url, password: c.password });
  inflight = cl;
  try {
    const hello = await cl.connect();
    let obsVersion: string | null = null;
    if (seq === attemptSeq) {
      try {
        const v = await cl.request<{ obsVersion?: unknown }>('GetVersion');
        if (typeof v.obsVersion === 'string' && v.obsVersion) obsVersion = v.obsVersion;
      } catch {
        // không biết phiên bản vẫn dùng được
      }
    }
    if (seq !== attemptSeq || !cl.isIdentified) {
      cl.close();
      return seq !== attemptSeq ? 'stale' : new ObsError('closed');
    }
    if (inflight === cl) inflight = null;
    client = cl;
    unsubscribeClose = cl.onClose(onDropped);
    setState({
      status: 'connected',
      obsVersion,
      wsVersion: hello.obsWebSocketVersion || null,
      error: null,
      auto: false,
      host: c.host,
      port: c.port,
    });
    // Browser Source đang mở nhận ngay bài của Player (không phải chờ lượt nhắc lại 5 giây).
    if (lastSong) enqueue(lastSong);
    return null;
  } catch (e) {
    if (inflight === cl) inflight = null;
    cl.close();
    if (seq !== attemptSeq) return 'stale';
    let err = toObsError(e);
    if (err.kind === 'unreachable' && (await localNetworkPermission()) === 'denied') {
      err = new ObsError('blocked', { code: err.code });
    }
    return seq !== attemptSeq ? 'stale' : err;
  }
}

function cancelRetry(): void {
  if (retryTimer !== null) clearTimeout(retryTimer);
  retryTimer = null;
}

/** Bỏ kết nối hiện tại + lần thử đang chạy (không gọi onDropped). */
function teardown(): void {
  attemptSeq++;
  cancelRetry();
  resetRelay();
  unsubscribeClose?.();
  unsubscribeClose = null;
  const cl = client;
  client = null;
  cl?.close();
  const pend = inflight;
  inflight = null;
  pend?.close();
}

/**
 * Kết nối theo ô nhập (người bấm "Kết nối"). Không throw: kết quả nằm ở trạng thái (`connected` /
 * `error` + `error`). "Nhớ" bật → lưu địa chỉ + mật khẩu sau khi kết nối được; tắt → xóa ngay.
 */
export async function connectObs(opts: ObsConnectOptions): Promise<boolean> {
  autoStarted = true;
  teardown();
  creds = null;
  const c: Creds = {
    host: opts.host.trim() || OBS_DEFAULT_HOST,
    port: opts.port,
    password: opts.password,
  };
  if (!opts.remember) writeStored({ v: 1, remember: false });
  setState({
    status: 'connecting',
    error: null,
    auto: false,
    obsVersion: null,
    wsVersion: null,
    host: c.host,
    port: c.port,
  });
  const r = await attempt(c);
  if (r === 'stale') return false;
  if (r) {
    setState({ status: 'error', error: r });
    return false;
  }
  creds = c;
  if (opts.remember) storeCreds(c, true);
  return true;
}

/** Ngắt (người bấm): hủy cả lần tự kết nối lại; lần mở app sau không tự kết nối (vẫn nhớ mật khẩu). */
export function disconnectObs(): void {
  autoStarted = true;
  teardown();
  creds = null;
  const s = readStored();
  if (s && s.remember && s.host !== undefined) writeStored({ ...s, auto: false });
  setState({ status: 'off', error: null, auto: false, obsVersion: null, wsVersion: null });
}

/** Mất kết nối ngoài ý muốn (OBS đóng / tắt server) → tự kết nối lại giãn dần. */
function onDropped(err: ObsError): void {
  unsubscribeClose?.();
  unsubscribeClose = null;
  client = null;
  resetRelay();
  if (!creds) {
    setState({ status: 'error', error: err, auto: false });
    return;
  }
  retryIndex = 0;
  retryReason = 'drop';
  setState({ status: 'connecting', error: null, auto: true, obsVersion: null, wsVersion: null });
  scheduleRetry();
}

function scheduleRetry(): void {
  cancelRetry();
  if (retryIndex >= OBS_RECONNECT_DELAYS_MS.length) {
    giveUp(null);
    return;
  }
  const delay = OBS_RECONNECT_DELAYS_MS[retryIndex++] ?? 30_000;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    void runAuto();
  }, delay);
}

async function runAuto(): Promise<void> {
  const c = creds;
  if (!c) return;
  setState({ status: 'connecting', auto: true, error: null, host: c.host, port: c.port });
  const r = await attempt(c);
  if (r === 'stale' || r === null) return;
  if (FATAL.has(r.kind)) giveUp(r);
  else scheduleRetry();
}

/** Thôi tự kết nối lại: lúc mở app → im lặng về 'off'; sau khi mất kết nối → báo lỗi trong khối OBS. */
function giveUp(err: ObsError | null): void {
  cancelRetry();
  const dropped = retryReason === 'drop';
  creds = null;
  if (dropped) setState({ status: 'error', error: err ?? new ObsError('closed'), auto: false });
  else setState({ status: 'off', error: null, auto: false });
}

/**
 * Lần dùng đầu của module (Player gửi tin đầu tiên / khối kết nối mở ra): có mật khẩu đã nhớ và chưa
 * bấm Ngắt → tự kết nối lặng lẽ. Chỉ một lần mỗi lần mở app.
 */
export function ensureObsAutoConnect(): void {
  if (autoStarted) return;
  autoStarted = true;
  if (typeof (globalThis as { WebSocket?: unknown }).WebSocket !== 'function') return;
  const p = loadObsPrefs();
  if (!p.saved || !p.auto || state.status !== 'off') return;
  creds = { host: p.host, port: p.port, password: p.password };
  retryIndex = 0;
  retryReason = 'start';
  void runAuto();
}

// ---------------------------------------------------------------------------
// Relay Player → Browser Source
// ---------------------------------------------------------------------------

/** Tin chờ gửi (mỗi loại tối đa một — tin mới thay tin cũ cùng loại, xếp cuối hàng). */
let queue: FollowMessage[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let lastFlushAt = Number.NEGATIVE_INFINITY;
/** Bài mới nhất của Player (gửi ngay khi vừa kết nối / sau khi thêm source). */
let lastSong: FollowSongMessage | null = null;
let resendTimer: ReturnType<typeof setTimeout> | null = null;

function resetRelay(): void {
  queue = [];
  if (flushTimer !== null) clearTimeout(flushTimer);
  flushTimer = null;
  if (resendTimer !== null) clearTimeout(resendTimer);
  resendTimer = null;
}

/**
 * Bản tin đi qua được `obs_data` (bỏ mất `null` — xem OBS_NO_LOOP): `countdownEndsAt: null` → 0 (đã
 * hết từ lâu = không đếm ngược), `loop: null` → OBS_NO_LOOP, `countIn: null` → bỏ trường (thiếu = null).
 * Tin khác giữ nguyên.
 */
export function obsSafeMessage(message: FollowMessage): FollowMessage {
  if (message.kind !== 'state') return message;
  const { countIn, ...rest } = message;
  const out: FollowStateMessage = {
    ...rest,
    countdownEndsAt: message.countdownEndsAt ?? 0,
    loop: message.loop ?? { ...OBS_NO_LOOP },
  };
  if (countIn) out.countIn = countIn;
  return out;
}

/** requestData của CallVendorRequest obs-browser / emit_event cho một tin. */
export function emitEventRequest(message: FollowMessage): Record<string, unknown> {
  return {
    vendorName: 'obs-browser',
    requestType: 'emit_event',
    requestData: { event_name: FOLLOW_EVENT, event_data: obsSafeMessage(message) },
  };
}

function enqueue(m: FollowMessage): void {
  queue = queue.filter((q) => q.kind !== m.kind);
  queue.push(m);
  scheduleFlush();
}

function scheduleFlush(): void {
  if (flushTimer !== null) return;
  const wait = lastFlushAt + OBS_RELAY_MIN_INTERVAL_MS - Date.now();
  if (wait <= 0) {
    flush();
    return;
  }
  flushTimer = setTimeout(onFlushTimer, wait);
}

function onFlushTimer(): void {
  flushTimer = null;
  flush();
}

function flush(): void {
  const cl = client;
  if (!cl || state.status !== 'connected') {
    queue = [];
    return;
  }
  if (queue.length === 0) return;
  if (cl.bufferedAmount > OBS_RELAY_MAX_BUFFERED) {
    // Socket nghẽn (bài dài, OBS bận): đợi rồi gửi tin mới nhất.
    flushTimer = setTimeout(onFlushTimer, OBS_RELAY_CONGESTED_RETRY_MS);
    return;
  }
  lastFlushAt = Date.now();
  const batch = queue;
  queue = [];
  for (const m of batch) cl.send('CallVendorRequest', emitEventRequest(m));
}

/**
 * Player chính → mọi Browser Source của OBS (gửi rồi quên, không bao giờ throw). Chưa kết nối thì bỏ
 * qua (lần gọi đầu tiên kích hoạt tự kết nối bằng mật khẩu đã nhớ).
 */
export function relayToObs(message: FollowMessage): void {
  try {
    ensureObsAutoConnect();
    if (message.kind === 'hello') return;
    if (message.kind === 'song') lastSong = message;
    else if (message.kind === 'bye' && lastSong?.from === message.from) lastSong = null;
    if (!client || state.status !== 'connected') return;
    enqueue(message);
  } catch {
    // relay không bao giờ được làm hỏng Player
  }
}

// ---------------------------------------------------------------------------
// Thêm overlay vào OBS
// ---------------------------------------------------------------------------

export interface AddOverlayResult {
  /** Tạo source mới hay cập nhật source "DF Harmonica Tiles" đã có. */
  action: 'created' | 'updated';
  /** Cảnh đang phát (program) chứa source. */
  sceneName: string;
  /** Cỡ canvas OBS (Base Resolution) = cỡ Browser Source. */
  width: number;
  height: number;
  inputName: string;
  sceneItemId: number;
}

/** Transform của source: 0,0, tỉ lệ 1, không bounds, neo góc trên-trái (OBS_ALIGN_LEFT | OBS_ALIGN_TOP = 5). */
export const OBS_OVERLAY_TRANSFORM = {
  positionX: 0,
  positionY: 0,
  scaleX: 1,
  scaleY: 1,
  rotation: 0,
  alignment: 5,
  boundsType: 'OBS_BOUNDS_NONE',
  cropLeft: 0,
  cropRight: 0,
  cropTop: 0,
  cropBottom: 0,
} as const;

type Rec = Record<string, unknown>;

const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);

function posInt(v: unknown): number | null {
  return typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : null;
}

function itemId(v: unknown, requestType: string): number {
  if (typeof v === 'number' && Number.isInteger(v) && v >= 0) return v;
  throw new ObsError('protocol', { requestType });
}

/** Item của source trong cảnh (thêm vào cảnh nếu source chỉ nằm ở cảnh khác). */
async function sceneItemOf(cl: ObsClient, sceneName: string): Promise<number> {
  try {
    const r = await cl.request<Rec>('GetSceneItemId', { sceneName, sourceName: OBS_INPUT_NAME });
    const id = itemId(r.sceneItemId, 'GetSceneItemId');
    await cl.request('SetSceneItemEnabled', { sceneName, sceneItemId: id, sceneItemEnabled: true });
    return id;
  } catch (e) {
    if (!(isObsError(e) && e.kind === 'request' && e.code === OBS_STATUS.ResourceNotFound)) throw e;
  }
  const r = await cl.request<Rec>('CreateSceneItem', {
    sceneName,
    sourceName: OBS_INPUT_NAME,
    sceneItemEnabled: true,
  });
  return itemId(r.sceneItemId, 'CreateSceneItem');
}

/**
 * Tạo (hoặc cập nhật) Browser Source "DF Harmonica Tiles" = `url`, cỡ canvas, ở cảnh đang phát: vị trí
 * 0,0, tỉ lệ 1, không bounds, neo trên-trái, nằm trên cùng. Lỗi → ObsError (chưa kết nối, OBS từ chối,
 * trùng tên với source không phải Browser Source…).
 */
export async function addOverlayToObs(url: string): Promise<AddOverlayResult> {
  const cl = client;
  if (!cl || state.status !== 'connected') throw new ObsError('notConnected');

  const video = await cl.request<Rec>('GetVideoSettings');
  const width = posInt(video.baseWidth);
  const height = posInt(video.baseHeight);
  if (width === null || height === null) {
    throw new ObsError('protocol', { requestType: 'GetVideoSettings' });
  }
  const scene = await cl.request<Rec>('GetCurrentProgramScene');
  const sceneName =
    typeof scene.sceneName === 'string' && scene.sceneName
      ? scene.sceneName
      : typeof scene.currentProgramSceneName === 'string' && scene.currentProgramSceneName
        ? scene.currentProgramSceneName
        : null;
  if (sceneName === null) throw new ObsError('protocol', { requestType: 'GetCurrentProgramScene' });

  const list = await cl.request<Rec>('GetInputList');
  const inputs = Array.isArray(list.inputs) ? list.inputs.filter(isRec) : [];
  const existing = inputs.find((i) => i.inputName === OBS_INPUT_NAME);

  let action: AddOverlayResult['action'];
  let sceneItemId: number;
  if (existing) {
    const kind = existing.unversionedInputKind ?? existing.inputKind;
    if (kind !== 'browser_source') throw new ObsError('nameTaken');
    await cl.request('SetInputSettings', {
      inputName: OBS_INPUT_NAME,
      inputSettings: { url, width, height },
      overlay: true,
    });
    sceneItemId = await sceneItemOf(cl, sceneName);
    action = 'updated';
  } else {
    let created: Rec;
    try {
      created = await cl.request<Rec>('CreateInput', {
        sceneName,
        inputName: OBS_INPUT_NAME,
        inputKind: 'browser_source',
        inputSettings: {
          url,
          width,
          height,
          fps: 60,
          reroute_audio: false,
          restart_when_active: false,
          shutdown: false,
        },
        sceneItemEnabled: true,
      });
    } catch (e) {
      // Trùng tên với một cảnh / source khác loại.
      if (isObsError(e) && e.kind === 'request' && e.code === OBS_STATUS.ResourceAlreadyExists) {
        throw new ObsError('nameTaken', { code: e.code, comment: e.comment });
      }
      throw e;
    }
    sceneItemId = itemId(created.sceneItemId, 'CreateInput');
    action = 'created';
  }

  await cl.request('SetSceneItemTransform', {
    sceneName,
    sceneItemId,
    sceneItemTransform: OBS_OVERLAY_TRANSFORM,
  });

  // Lên trên cùng (index cao nhất = trên cùng trong danh sách Sources).
  const items = await cl.request<Rec>('GetSceneItemList', { sceneName });
  const arr = Array.isArray(items.sceneItems) ? items.sceneItems.filter(isRec) : [];
  let top = -1;
  let mine = -1;
  for (const it of arr) {
    const idx = typeof it.sceneItemIndex === 'number' ? it.sceneItemIndex : -1;
    top = Math.max(top, idx);
    if (it.sceneItemId === sceneItemId) mine = idx;
  }
  if (top >= 0 && mine !== top) {
    await cl.request('SetSceneItemIndex', { sceneName, sceneItemId, sceneItemIndex: top });
  }

  // OBS tải lại trang overlay: gửi lại bài khi trang mới đã kịp nghe.
  if (resendTimer !== null) clearTimeout(resendTimer);
  resendTimer = setTimeout(() => {
    resendTimer = null;
    if (lastSong && client === cl) enqueue(lastSong);
  }, OBS_SONG_RESEND_AFTER_ADD_MS);

  return { action, sceneName, width, height, inputName: OBS_INPUT_NAME, sceneItemId };
}

// ---------------------------------------------------------------------------

/** Chỉ cho test: về trạng thái lúc mới nạp module. */
export function resetObsBridgeForTests(): void {
  teardown();
  creds = null;
  autoStarted = false;
  retryIndex = 0;
  retryReason = 'start';
  lastFlushAt = Number.NEGATIVE_INFINITY;
  lastSong = null;
  state = INITIAL;
  for (const l of Array.from(listeners)) l();
}

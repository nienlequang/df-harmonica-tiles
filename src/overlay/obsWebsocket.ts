/**
 * Client obs-websocket v5 tối giản (có sẵn trong OBS 28+: Tools → WebSocket Server Settings), không
 * thư viện ngoài. Chỉ phần app cần: bắt tay Hello → Identify (mật khẩu: chuỗi auth SHA-256 / base64 tính
 * bằng `crypto.subtle`) → Identified, gửi request (op 6) và nhận kết quả (op 7). Không đăng ký event
 * (`eventSubscriptions: 0`). Lỗi luôn là `ObsError` có `kind` (giao diện dịch ra câu cho người dùng).
 *
 * Giao thức: https://github.com/obsproject/obs-websocket/blob/master/docs/generated/protocol.md
 * Không import React / store — obsBridge.ts giữ kết nối dùng chung cho cả app.
 */

/** Địa chỉ / cổng mặc định của obs-websocket (OBS → Tools → WebSocket Server Settings). */
export const OBS_DEFAULT_HOST = '127.0.0.1';
export const OBS_DEFAULT_PORT = 4455;
/** Phiên bản RPC app nói (obs-websocket 5.x đều là 1). */
export const OBS_RPC_VERSION = 1;
/** Subprotocol JSON của obs-websocket 5 (không gửi thì server cũng mặc định JSON). */
export const OBS_SUBPROTOCOL = 'obswebsocket.json';

/** Mã lệnh (op) của giao thức. */
export const OBS_OP = {
  Hello: 0,
  Identify: 1,
  Identified: 2,
  Reidentify: 3,
  Event: 5,
  Request: 6,
  RequestResponse: 7,
  RequestBatch: 8,
  RequestBatchResponse: 9,
} as const;

/** Mã đóng WebSocket do obs-websocket dùng (WebSocketCloseCode). */
export const OBS_CLOSE = {
  UnknownReason: 4000,
  MessageDecodeError: 4002,
  MissingDataField: 4003,
  InvalidDataFieldType: 4004,
  InvalidDataFieldValue: 4005,
  UnknownOpCode: 4006,
  NotIdentified: 4007,
  AlreadyIdentified: 4008,
  AuthenticationFailed: 4009,
  UnsupportedRpcVersion: 4010,
  SessionInvalidated: 4011,
  UnsupportedFeature: 4012,
} as const;

/** Mã kết quả request (RequestStatus) app cần phân biệt. */
export const OBS_STATUS = {
  Success: 100,
  NotReady: 207,
  ResourceNotFound: 600,
  ResourceAlreadyExists: 601,
} as const;

/** Hạn chờ mặc định (ms). */
export const OBS_OPEN_TIMEOUT_MS = 15_000;
export const OBS_IDENTIFY_TIMEOUT_MS = 5_000;
export const OBS_REQUEST_TIMEOUT_MS = 8_000;

/**
 * Loại lỗi (mỗi loại một câu hướng dẫn trong strings `obsws.error.*`):
 * - `unreachable`: không mở được kết nối (OBS chưa mở / chưa bật WebSocket server / sai cổng / trình
 *   duyệt chặn — trình duyệt không cho biết lý do, chỉ có mã 1006);
 * - `blocked`: trình duyệt đã từ chối quyền truy cập mạng cục bộ cho trang này;
 * - `insecureHost`: trang https chỉ được nối `ws://` tới chính máy này (127.0.0.1 / localhost);
 * - `invalidHost`: địa chỉ / cổng không hợp lệ;
 * - `authRequired`: OBS bật mật khẩu mà ô mật khẩu trống; `authFailed`: sai mật khẩu (mã 4009);
 * - `insecureContext`: trang không bảo mật (http lạ) nên không có `crypto.subtle` để tính mật khẩu;
 * - `timeout`: mở được kết nối nhưng không thấy Hello / Identified;
 * - `unsupported`: không phải obs-websocket 5 (RPC không hợp, mã 4010);
 * - `protocol`: server trả dữ liệu lạ / đóng với mã 4xxx khác;
 * - `closed`: đang kết nối thì mất (OBS đóng / tắt WebSocket server);
 * - `notConnected`: gọi request khi chưa kết nối;
 * - `request`: OBS từ chối một request (`code`, `comment`); `requestTimeout`: OBS không trả lời request;
 * - `nameTaken`: đã có source trùng tên mà không phải Browser Source.
 */
export type ObsErrorKind =
  | 'unreachable'
  | 'blocked'
  | 'insecureHost'
  | 'invalidHost'
  | 'authRequired'
  | 'authFailed'
  | 'insecureContext'
  | 'timeout'
  | 'unsupported'
  | 'protocol'
  | 'closed'
  | 'notConnected'
  | 'request'
  | 'requestTimeout'
  | 'nameTaken';

export interface ObsErrorInfo {
  /** Mã đóng WebSocket hoặc mã RequestStatus. */
  code?: number | null;
  requestType?: string | null;
  /** Ghi chú của OBS (RequestStatus.comment / lý do đóng). */
  comment?: string | null;
}

export class ObsError extends Error {
  readonly kind: ObsErrorKind;
  readonly code: number | null;
  readonly requestType: string | null;
  readonly comment: string | null;

  constructor(kind: ObsErrorKind, info: ObsErrorInfo = {}) {
    const detail = [info.requestType, info.code, info.comment]
      .filter((x) => x !== null && x !== undefined)
      .join(' ');
    super(detail ? `obs-websocket ${kind}: ${detail}` : `obs-websocket ${kind}`);
    this.name = 'ObsError';
    this.kind = kind;
    this.code = info.code ?? null;
    this.requestType = info.requestType ?? null;
    this.comment = info.comment ?? null;
  }
}

export function isObsError(e: unknown): e is ObsError {
  return e instanceof ObsError;
}

// ---------------------------------------------------------------------------
// Địa chỉ
// ---------------------------------------------------------------------------

const HOST_RE = /^[A-Za-z0-9._-]+$/;
const IPV6_RE = /^[0-9A-Fa-f:.]+$/;

/** Host trỏ về chính máy này (loopback): trang https được nối `ws://` tới các host này. */
export function isLoopbackHost(host: string): boolean {
  const h = host
    .trim()
    .toLowerCase()
    .replace(/^\[(.*)\]$/, '$1');
  return (
    h === 'localhost' ||
    h.endsWith('.localhost') ||
    h === '::1' ||
    /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h)
  );
}

/**
 * `ws://host:port` từ ô nhập; host lạ (khoảng trắng, `/`, `:` thừa…) hoặc cổng ngoài 1..65535 →
 * ObsError('invalidHost'). IPv6 (`::1`) được bọc ngoặc vuông.
 */
export function obsUrl(host: string, port: number): string {
  const h = host.trim().replace(/^\[(.*)\]$/, '$1');
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new ObsError('invalidHost');
  if (h.includes(':')) {
    if (!IPV6_RE.test(h)) throw new ObsError('invalidHost');
    return `ws://[${h}]:${port}`;
  }
  if (!h || !HOST_RE.test(h)) throw new ObsError('invalidHost');
  return `ws://${h}:${port}`;
}

/**
 * Như `obsUrl`, thêm luật của trình duyệt: trang `https:` chỉ được mở `ws://` tới chính máy này
 * (mixed content) → host khác: ObsError('insecureHost') thay vì để constructor WebSocket throw.
 */
export function obsConnectUrl(host: string, port: number, pageProtocol: string): string {
  const url = obsUrl(host, port);
  if (pageProtocol === 'https:' && !isLoopbackHost(host)) throw new ObsError('insecureHost');
  return url;
}

// ---------------------------------------------------------------------------
// Mật khẩu
// ---------------------------------------------------------------------------

function bytesToBase64(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

/** base64(sha256(text UTF-8)) bằng `crypto.subtle` (chỉ có ở trang bảo mật: https / localhost / file). */
export async function sha256Base64(text: string): Promise<string> {
  const subtle = (globalThis as { crypto?: Partial<Crypto> }).crypto?.subtle;
  if (!subtle || typeof subtle.digest !== 'function') throw new ObsError('insecureContext');
  const digest = await subtle.digest('SHA-256', new TextEncoder().encode(text));
  return bytesToBase64(new Uint8Array(digest));
}

/**
 * Chuỗi `authentication` của Identify:
 * `base64(sha256(base64(sha256(password + salt)) + challenge))`.
 */
export async function obsAuthString(
  password: string,
  salt: string,
  challenge: string,
): Promise<string> {
  const secret = await sha256Base64(password + salt);
  return sha256Base64(secret + challenge);
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

type Rec = Record<string, unknown>;

const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Hello của server (sau khi đã Identified). */
export interface ObsHello {
  obsWebSocketVersion: string;
  rpcVersion: number;
  /** Server có bật mật khẩu không. */
  authRequired: boolean;
}

export interface ObsClientOptions {
  /** `ws://host:port` (xem `obsUrl`). */
  url: string;
  /** Server Password ('' = không có). */
  password?: string;
  openTimeoutMs?: number;
  identifyTimeoutMs?: number;
  requestTimeoutMs?: number;
}

interface Pending {
  requestType: string;
  resolve: (data: Rec) => void;
  reject: (e: ObsError) => void;
  timer: ReturnType<typeof setTimeout>;
}

type Phase = 'idle' | 'connecting' | 'identified' | 'closed';

const WS_OPEN = 1;

/**
 * Một kết nối tới obs-websocket. `connect()` một lần; `request` chờ kết quả (lỗi → ObsError), `send`
 * gửi rồi quên (relay). Mất kết nối sau khi đã Identified → `onClose` (không gọi khi tự `close()`).
 */
export class ObsClient {
  private readonly opts: Required<ObsClientOptions>;
  private ws: WebSocket | null = null;
  private phase: Phase = 'idle';
  private readonly pending = new Map<string, Pending>();
  private nextId = 0;
  private readonly closeListeners = new Set<(e: ObsError) => void>();
  /** Hủy `connect()` đang chờ (close() giữa lúc bắt tay). */
  private abortConnect: ((e: ObsError) => void) | null = null;

  constructor(opts: ObsClientOptions) {
    this.opts = {
      url: opts.url,
      password: opts.password ?? '',
      openTimeoutMs: opts.openTimeoutMs ?? OBS_OPEN_TIMEOUT_MS,
      identifyTimeoutMs: opts.identifyTimeoutMs ?? OBS_IDENTIFY_TIMEOUT_MS,
      requestTimeoutMs: opts.requestTimeoutMs ?? OBS_REQUEST_TIMEOUT_MS,
    };
  }

  get isIdentified(): boolean {
    return this.phase === 'identified';
  }

  /** Số byte đang chờ gửi trong socket (relay bỏ bớt khi nghẽn). */
  get bufferedAmount(): number {
    return this.ws?.bufferedAmount ?? 0;
  }

  /** Nghe mất kết nối ngoài ý muốn (sau Identified). */
  onClose(listener: (e: ObsError) => void): () => void {
    this.closeListeners.add(listener);
    return () => {
      this.closeListeners.delete(listener);
    };
  }

  /**
   * Mở kết nối + bắt tay. Hạn: `openTimeoutMs` tới khi socket mở (lâu: trình duyệt có thể đang hỏi quyền
   * truy cập mạng cục bộ), rồi `identifyTimeoutMs` tới Identified.
   */
  connect(): Promise<ObsHello> {
    if (this.phase !== 'idle') return Promise.reject(new ObsError('protocol'));
    this.phase = 'connecting';
    return new Promise<ObsHello>((resolve, reject) => {
      let opened = false;
      let hello: ObsHello | null = null;
      let timer: ReturnType<typeof setTimeout> | null = null;
      const arm = (ms: number, kind: ObsErrorKind) => {
        if (timer !== null) clearTimeout(timer);
        timer = setTimeout(() => fail(new ObsError(kind)), ms);
      };
      const fail = (e: ObsError) => {
        if (this.phase !== 'connecting') return;
        if (timer !== null) clearTimeout(timer);
        this.abortConnect = null;
        this.phase = 'closed';
        this.detach();
        reject(e);
      };
      this.abortConnect = fail;

      const Ctor = (globalThis as { WebSocket?: typeof WebSocket }).WebSocket;
      if (typeof Ctor !== 'function') {
        fail(new ObsError('unreachable'));
        return;
      }
      let ws: WebSocket;
      try {
        ws = new Ctor(this.opts.url, OBS_SUBPROTOCOL);
      } catch (e) {
        // Chrome / Firefox: ws:// không phải loopback từ trang https → SecurityError ngay ở constructor.
        const name = (e as { name?: unknown } | null)?.name;
        fail(new ObsError(name === 'SecurityError' ? 'insecureHost' : 'invalidHost'));
        return;
      }
      this.ws = ws;
      arm(this.opts.openTimeoutMs, 'unreachable');

      ws.addEventListener('open', () => {
        opened = true;
        // obs-websocket 4.x (OBS cũ) không gửi Hello: hết hạn → 'unsupported'.
        arm(this.opts.identifyTimeoutMs, hello ? 'timeout' : 'unsupported');
      });

      ws.addEventListener('message', (ev: MessageEvent) => {
        if (this.phase === 'identified') {
          this.onMessage(ev.data);
          return;
        }
        if (this.phase !== 'connecting') return;
        const msg = parseFrame(ev.data);
        if (!msg) {
          fail(new ObsError('protocol'));
          return;
        }
        if (msg.op === OBS_OP.Hello) {
          const d = msg.d;
          const rpc = d.rpcVersion;
          if (typeof rpc !== 'number' || rpc < OBS_RPC_VERSION) {
            fail(new ObsError('unsupported'));
            return;
          }
          const auth = isRec(d.authentication) ? d.authentication : null;
          hello = {
            obsWebSocketVersion:
              typeof d.obsWebSocketVersion === 'string' ? d.obsWebSocketVersion : '',
            rpcVersion: rpc,
            authRequired: auth !== null,
          };
          arm(this.opts.identifyTimeoutMs, 'timeout');
          void this.identify(auth).catch((e: unknown) =>
            fail(isObsError(e) ? e : new ObsError('protocol')),
          );
          return;
        }
        if (msg.op === OBS_OP.Identified) {
          if (!hello) {
            fail(new ObsError('protocol'));
            return;
          }
          if (timer !== null) clearTimeout(timer);
          this.abortConnect = null;
          this.phase = 'identified';
          resolve(hello);
        }
      });

      ws.addEventListener('close', (ev: Event) => {
        const code = (ev as CloseEvent).code;
        const reason = (ev as CloseEvent).reason || null;
        if (this.phase === 'connecting') {
          fail(closeError(code, reason, opened));
          return;
        }
        if (this.phase !== 'identified') return;
        this.phase = 'closed';
        this.detach();
        const err = new ObsError('closed', { code, comment: reason });
        for (const l of Array.from(this.closeListeners)) {
          try {
            l(err);
          } catch {
            // listener lỗi không chặn listener khác
          }
        }
      });
      // 'error' luôn đi kèm 'close' (mã 1006) ở trình duyệt — xử lý ở 'close'.
    });
  }

  /** Gửi request và chờ `responseData` (thiếu → {}). Lỗi → ObsError('request' | 'requestTimeout' | …). */
  request<T extends object = Rec>(
    requestType: string,
    requestData?: object,
    timeoutMs: number = this.opts.requestTimeoutMs,
  ): Promise<T> {
    if (this.phase !== 'identified' || !this.ws) {
      return Promise.reject(new ObsError('notConnected', { requestType }));
    }
    const requestId = `r${++this.nextId}`;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new ObsError('requestTimeout', { requestType }));
      }, timeoutMs);
      this.pending.set(requestId, {
        requestType,
        resolve: (d) => resolve(d as T),
        reject,
        timer,
      });
      if (!this.write(OBS_OP.Request, { requestType, requestId, requestData })) {
        clearTimeout(timer);
        this.pending.delete(requestId);
        reject(new ObsError('notConnected', { requestType }));
      }
    });
  }

  /** Gửi request không chờ kết quả (kết quả trả về bị bỏ qua). false = chưa kết nối / gửi lỗi. */
  send(requestType: string, requestData?: object): boolean {
    if (this.phase !== 'identified') return false;
    return this.write(OBS_OP.Request, {
      requestType,
      requestId: `f${++this.nextId}`,
      requestData,
    });
  }

  /**
   * Đóng (không gọi onClose): đang bắt tay → `connect()` bị từ chối ObsError('closed'); request đang
   * chờ → ObsError('closed').
   */
  close(): void {
    if (this.phase === 'connecting' && this.abortConnect) {
      this.abortConnect(new ObsError('closed'));
      return;
    }
    this.phase = 'closed';
    this.detach();
  }

  // -------------------------------------------------------------------------

  private async identify(auth: Rec | null): Promise<void> {
    const d: Rec = { rpcVersion: OBS_RPC_VERSION, eventSubscriptions: 0 };
    if (auth) {
      if (!this.opts.password) throw new ObsError('authRequired');
      const salt = typeof auth.salt === 'string' ? auth.salt : '';
      const challenge = typeof auth.challenge === 'string' ? auth.challenge : '';
      d.authentication = await obsAuthString(this.opts.password, salt, challenge);
    }
    if (this.phase !== 'connecting') return;
    this.write(OBS_OP.Identify, d);
  }

  private write(op: number, d: Rec): boolean {
    const ws = this.ws;
    if (!ws || ws.readyState !== WS_OPEN) return false;
    try {
      ws.send(JSON.stringify({ op, d }));
      return true;
    } catch {
      return false;
    }
  }

  private onMessage(data: unknown): void {
    const msg = parseFrame(data);
    if (!msg || msg.op !== OBS_OP.RequestResponse) return;
    const id = msg.d.requestId;
    if (typeof id !== 'string') return;
    const p = this.pending.get(id);
    if (!p) return;
    this.pending.delete(id);
    clearTimeout(p.timer);
    const st = isRec(msg.d.requestStatus) ? msg.d.requestStatus : {};
    if (st.result === true) {
      p.resolve(isRec(msg.d.responseData) ? msg.d.responseData : {});
      return;
    }
    p.reject(
      new ObsError('request', {
        requestType: p.requestType,
        code: typeof st.code === 'number' ? st.code : null,
        comment: typeof st.comment === 'string' ? st.comment : null,
      }),
    );
  }

  /** Bỏ socket + từ chối mọi request đang chờ. */
  private detach(): void {
    const ws = this.ws;
    this.ws = null;
    for (const [, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(new ObsError('closed', { requestType: p.requestType }));
    }
    this.pending.clear();
    if (ws && ws.readyState <= WS_OPEN) {
      try {
        ws.close(1000);
      } catch {
        // đã đóng
      }
    }
  }
}

/** Khung JSON `{op, d}` hợp lệ hoặc null. */
function parseFrame(data: unknown): { op: number; d: Rec } | null {
  if (typeof data !== 'string') return null;
  let v: unknown;
  try {
    v = JSON.parse(data);
  } catch {
    return null;
  }
  if (!isRec(v) || typeof v.op !== 'number' || !isRec(v.d)) return null;
  return { op: v.op, d: v.d };
}

/** Lý do đóng trong lúc đang kết nối → loại lỗi. */
function closeError(code: number, reason: string | null, opened: boolean): ObsError {
  const info = { code, comment: reason };
  if (code === OBS_CLOSE.AuthenticationFailed) return new ObsError('authFailed', info);
  if (code === OBS_CLOSE.UnsupportedRpcVersion) return new ObsError('unsupported', info);
  if (code >= 4000 && code < 5000) return new ObsError('protocol', info);
  // Mở được rồi bị đóng không lời (1006 / 1000…) — server ở cổng này không nói obs-websocket 5.
  if (opened) return new ObsError('unsupported', info);
  return new ObsError('unreachable', info);
}

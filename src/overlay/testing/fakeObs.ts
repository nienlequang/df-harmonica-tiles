/**
 * OBS giả cho test của obsWebsocket / obsBridge / ObsConnectPanel (app không import file này).
 *
 * `FakeWebSocket` (gắn vào globalThis.WebSocket bằng `installFakeObs`) nói chuyện với một `FakeObsServer`
 * mô phỏng obs-websocket 5: Hello (có / không mật khẩu) → Identify (kiểm chuỗi auth thật) → Identified,
 * request → response, mã đóng 4009 / 4010 / 1006, và một "OBS" nhỏ (canvas, cảnh, input, scene item) cho
 * các request mà "Thêm overlay vào OBS" dùng. CallVendorRequest `obs-browser` / `emit_event` được "phát"
 * lại thành window CustomEvent như Browser Source của OBS — sau khi đi qua mô phỏng `obs_data` (bỏ `null`,
 * mảng chỉ giữ object), để test thấy đúng thứ overlay trong OBS nhận được.
 */
import { createHash } from 'node:crypto';
import { vi } from 'vitest';

type Rec = Record<string, unknown>;

const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);

/** base64(sha256(text)) bằng node:crypto (độc lập với `crypto.subtle` mà app dùng). */
export function nodeSha256Base64(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('base64');
}

/** Chuỗi auth đúng theo tài liệu obs-websocket 5, tính bằng node:crypto. */
export function expectedAuth(password: string, salt: string, challenge: string): string {
  return nodeSha256Base64(nodeSha256Base64(password + salt) + challenge);
}

/**
 * Dữ liệu sau khi đi qua `obs_data` của OBS (obs-websocket JsonToObsData → obs-browser obs_data_get_json):
 * trường `null` / `undefined` bị bỏ, mảng chỉ giữ phần tử object.
 */
export function obsDataRoundTrip(v: unknown): unknown {
  if (Array.isArray(v)) return v.filter(isRec).map(obsDataRoundTrip);
  if (isRec(v)) {
    const out: Rec = {};
    for (const [k, x] of Object.entries(v)) {
      if (x === null || x === undefined) continue;
      out[k] = obsDataRoundTrip(x);
    }
    return out;
  }
  return v;
}

export interface FakeReply {
  ok?: boolean;
  code?: number;
  comment?: string;
  data?: Rec;
}

export type FakeHandler = (data: Rec) => FakeReply | null;

export interface FakeObsOptions {
  /** Server Password; null / '' = tắt Enable Authentication. */
  password?: string | null;
  salt?: string;
  challenge?: string;
  rpcVersion?: number;
  obsWebSocketVersion?: string;
  obsVersion?: string;
  /** Không có server ở cổng (OBS tắt): đóng 1006, không mở. */
  refuse?: boolean;
  /** Mở nhưng không bao giờ gửi Hello (obs-websocket 4 / server khác). */
  silent?: boolean;
  /** Gửi khung này thay cho Hello (dữ liệu lạ). */
  helloRaw?: string;
  /** Đúng mật khẩu mà vẫn đóng với mã này sau Identify (vd. 4010). */
  closeAfterIdentify?: number;
}

export interface FakeInput {
  inputName: string;
  inputKind: string;
  inputSettings: Rec;
}

export interface FakeSceneItem {
  sceneItemId: number;
  sourceName: string;
  enabled: boolean;
  transform: Rec;
}

export interface LoggedRequest {
  requestType: string;
  requestId: string;
  requestData: Rec | undefined;
}

export class FakeObsServer {
  opts: Required<FakeObsOptions>;
  sockets: FakeWebSocket[] = [];
  requests: LoggedRequest[] = [];
  /** Chuỗi auth nhận được trong Identify gần nhất. */
  lastAuth: string | null = null;
  /** false = giữ request không trả lời (test hết hạn). */
  respond = true;
  /** Ghi đè cách trả lời một requestType. */
  overrides = new Map<string, FakeHandler>();
  /** Tin `emit_event` đã phát vào "Browser Source" (sau obs_data). */
  emitted: { eventName: string; detail: unknown }[] = [];

  // "OBS" nhỏ
  baseWidth = 1920;
  baseHeight = 1080;
  programScene = 'Game';
  /** Chỉ trả `currentProgramSceneName` (obs-websocket 5.0–5.2). */
  legacySceneField = false;
  inputs: FakeInput[] = [];
  /** Cảnh → danh sách item, index 0 = dưới cùng. */
  scenes = new Map<string, FakeSceneItem[]>([['Game', []]]);
  private nextItemId = 1;

  constructor(opts: FakeObsOptions = {}) {
    this.opts = {
      password: opts.password ?? null,
      salt: opts.salt ?? 'lM1GncleQOaCu9lT1yeUZhFYnqhsLLP1G5lAGo3ixaI=',
      challenge: opts.challenge ?? '+IxH4CnCiqpX1rM9scsNynZzbOe4KhDeYcTNS3PDaeY=',
      rpcVersion: opts.rpcVersion ?? 1,
      obsWebSocketVersion: opts.obsWebSocketVersion ?? '5.5.4',
      obsVersion: opts.obsVersion ?? '31.0.2',
      refuse: opts.refuse ?? false,
      silent: opts.silent ?? false,
      helloRaw: opts.helloRaw ?? '',
      closeAfterIdentify: opts.closeAfterIdentify ?? 0,
    };
  }

  /** Thêm một item (source đã có) vào cảnh. */
  addItem(scene: string, sourceName: string, enabled = true): FakeSceneItem {
    const item: FakeSceneItem = {
      sceneItemId: this.nextItemId++,
      sourceName,
      enabled,
      transform: { positionX: 120, positionY: 40, scaleX: 0.5, scaleY: 0.5 },
    };
    const list = this.scenes.get(scene) ?? [];
    list.push(item);
    this.scenes.set(scene, list);
    return item;
  }

  sceneItems(scene: string = this.programScene): FakeSceneItem[] {
    return this.scenes.get(scene) ?? [];
  }

  requestTypes(): string[] {
    return this.requests.map((r) => r.requestType);
  }

  /** Socket đang mở gần nhất (để "OBS đóng" giữa chừng). */
  get socket(): FakeWebSocket | undefined {
    return [...this.sockets].reverse().find((s) => s.readyState === FakeWebSocket.OPEN);
  }

  // -------------------------------------------------------------------------

  accept(ws: FakeWebSocket): void {
    this.sockets.push(ws);
    queueMicrotask(() => {
      if (ws.readyState !== FakeWebSocket.CONNECTING) return;
      if (this.opts.refuse) {
        ws.serverClose(1006, '');
        return;
      }
      ws.serverOpen();
      if (this.opts.silent) return;
      if (this.opts.helloRaw) {
        ws.serverSendRaw(this.opts.helloRaw);
        return;
      }
      const d: Rec = {
        obsWebSocketVersion: this.opts.obsWebSocketVersion,
        rpcVersion: this.opts.rpcVersion,
      };
      if (this.opts.password) {
        d.authentication = { challenge: this.opts.challenge, salt: this.opts.salt };
      }
      ws.serverSend({ op: 0, d });
    });
  }

  receive(ws: FakeWebSocket, text: string): void {
    const msg: unknown = JSON.parse(text);
    if (!isRec(msg) || !isRec(msg.d)) {
      ws.serverClose(4002, 'decode');
      return;
    }
    const d = msg.d;
    if (msg.op === 1) {
      this.lastAuth = typeof d.authentication === 'string' ? d.authentication : null;
      if (this.opts.password) {
        const want = expectedAuth(this.opts.password, this.opts.salt, this.opts.challenge);
        if (d.authentication !== want) {
          ws.serverClose(4009, 'Authentication failed.');
          return;
        }
      }
      if (this.opts.closeAfterIdentify) {
        ws.serverClose(this.opts.closeAfterIdentify, '');
        return;
      }
      ws.serverSend({ op: 2, d: { negotiatedRpcVersion: 1 } });
      return;
    }
    if (msg.op === 6) {
      const requestType = String(d.requestType);
      const requestId = String(d.requestId);
      const requestData = isRec(d.requestData) ? d.requestData : undefined;
      this.requests.push({ requestType, requestId, requestData });
      if (!this.respond) return;
      const reply = this.handle(requestType, requestData ?? {});
      const ok = reply.ok !== false;
      const out: Rec = {
        requestType,
        requestId,
        requestStatus: ok
          ? { result: true, code: 100 }
          : { result: false, code: reply.code ?? 702, comment: reply.comment },
      };
      if (ok && reply.data) out.responseData = reply.data;
      ws.serverSend({ op: 7, d: out });
    }
  }

  private handle(type: string, data: Rec): FakeReply {
    const o = this.overrides.get(type);
    if (o) {
      const r = o(data);
      if (r) return r;
    }
    const scene = typeof data.sceneName === 'string' ? data.sceneName : '';
    const items = this.scenes.get(scene);
    const notFound = { ok: false, code: 600, comment: 'not found' };
    switch (type) {
      case 'GetVersion':
        return {
          data: {
            obsVersion: this.opts.obsVersion,
            obsWebSocketVersion: this.opts.obsWebSocketVersion,
            rpcVersion: 1,
            availableRequests: ['GetVersion'],
          },
        };
      case 'GetVideoSettings':
        return {
          data: {
            baseWidth: this.baseWidth,
            baseHeight: this.baseHeight,
            outputWidth: 1280,
            outputHeight: 720,
            fpsNumerator: 60,
            fpsDenominator: 1,
          },
        };
      case 'GetCurrentProgramScene':
        return {
          data: this.legacySceneField
            ? { currentProgramSceneName: this.programScene }
            : { sceneName: this.programScene, currentProgramSceneName: this.programScene },
        };
      case 'GetInputList':
        return {
          data: {
            inputs: this.inputs.map((i) => ({
              inputName: i.inputName,
              inputKind: i.inputKind,
              unversionedInputKind: i.inputKind,
            })),
          },
        };
      case 'CreateInput': {
        if (!items) return notFound;
        const name = String(data.inputName);
        if (this.inputs.some((i) => i.inputName === name) || this.scenes.has(name)) {
          return { ok: false, code: 601, comment: 'exists' };
        }
        this.inputs.push({
          inputName: name,
          inputKind: String(data.inputKind),
          inputSettings: isRec(data.inputSettings) ? { ...data.inputSettings } : {},
        });
        const item = this.addItem(scene, name, data.sceneItemEnabled !== false);
        return { data: { inputUuid: 'uuid-1', sceneItemId: item.sceneItemId } };
      }
      case 'SetInputSettings': {
        const input = this.inputs.find((i) => i.inputName === data.inputName);
        if (!input) return notFound;
        const settings = isRec(data.inputSettings) ? data.inputSettings : {};
        input.inputSettings =
          data.overlay === false ? { ...settings } : { ...input.inputSettings, ...settings };
        return {};
      }
      case 'GetSceneItemId': {
        const it = items?.find((i) => i.sourceName === data.sourceName);
        return it ? { data: { sceneItemId: it.sceneItemId } } : notFound;
      }
      case 'CreateSceneItem': {
        if (!items) return notFound;
        if (!this.inputs.some((i) => i.inputName === data.sourceName)) return notFound;
        const item = this.addItem(scene, String(data.sourceName), data.sceneItemEnabled !== false);
        return { data: { sceneItemId: item.sceneItemId } };
      }
      case 'SetSceneItemEnabled': {
        const it = items?.find((i) => i.sceneItemId === data.sceneItemId);
        if (!it) return notFound;
        it.enabled = data.sceneItemEnabled === true;
        return {};
      }
      case 'SetSceneItemTransform': {
        const it = items?.find((i) => i.sceneItemId === data.sceneItemId);
        if (!it) return notFound;
        it.transform = {
          ...it.transform,
          ...(isRec(data.sceneItemTransform) ? data.sceneItemTransform : {}),
        };
        return {};
      }
      case 'GetSceneItemList':
        if (!items) return notFound;
        return {
          data: {
            sceneItems: items.map((i, idx) => ({
              sceneItemId: i.sceneItemId,
              sceneItemIndex: idx,
              sourceName: i.sourceName,
              sceneItemEnabled: i.enabled,
            })),
          },
        };
      case 'SetSceneItemIndex': {
        if (!items) return notFound;
        const at = items.findIndex((i) => i.sceneItemId === data.sceneItemId);
        if (at < 0) return notFound;
        const [it] = items.splice(at, 1);
        if (it) items.splice(Number(data.sceneItemIndex), 0, it);
        return {};
      }
      case 'CallVendorRequest': {
        if (data.vendorName !== 'obs-browser') {
          return { ok: false, code: 600, comment: 'No vendor was found by that name.' };
        }
        if (data.requestType !== 'emit_event') return { ok: false, code: 204 };
        const rd = isRec(data.requestData) ? data.requestData : {};
        const eventName = typeof rd.event_name === 'string' ? rd.event_name : '';
        // obs-browser: event_data qua obs_data → JSON → window CustomEvent(detail) trong Browser Source.
        const detail = obsDataRoundTrip(JSON.parse(JSON.stringify(rd.event_data ?? {})));
        this.emitted.push({ eventName, detail });
        window.dispatchEvent(new CustomEvent(eventName, { detail }));
        return {
          data: { vendorName: 'obs-browser', requestType: 'emit_event', responseData: {} },
        };
      }
      default:
        return { ok: false, code: 204, comment: 'unknown request' };
    }
  }
}

export class FakeWebSocket extends EventTarget {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static server: FakeObsServer = new FakeObsServer();

  readonly url: string;
  readonly protocol: string;
  readyState = FakeWebSocket.CONNECTING;
  bufferedAmount = 0;
  /** Mã đóng client gửi khi tự đóng. */
  clientCloseCode: number | null = null;
  private readonly server: FakeObsServer;

  constructor(url: string, protocols?: string | string[]) {
    super();
    this.url = url;
    this.protocol = Array.isArray(protocols) ? (protocols[0] ?? '') : (protocols ?? '');
    this.server = FakeWebSocket.server;
    this.server.accept(this);
  }

  send(data: string): void {
    if (this.readyState !== FakeWebSocket.OPEN) throw new Error('InvalidStateError');
    this.server.receive(this, data);
  }

  close(code = 1000, reason = ''): void {
    if (this.readyState >= FakeWebSocket.CLOSING) return;
    this.clientCloseCode = code;
    this.readyState = FakeWebSocket.CLOSING;
    queueMicrotask(() => this.finishClose(code, reason));
  }

  // phía server ---------------------------------------------------------------

  serverOpen(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.dispatchEvent(new Event('open'));
  }

  serverSend(obj: unknown): void {
    this.serverSendRaw(JSON.stringify(obj));
  }

  serverSendRaw(data: string): void {
    queueMicrotask(() => {
      if (this.readyState !== FakeWebSocket.OPEN) return;
      this.dispatchEvent(new MessageEvent('message', { data }));
    });
  }

  /** Server đóng kết nối (mã obs-websocket / 1006). */
  serverClose(code: number, reason: string): void {
    queueMicrotask(() => this.finishClose(code, reason));
  }

  private finishClose(code: number, reason: string): void {
    if (this.readyState === FakeWebSocket.CLOSED) return;
    this.readyState = FakeWebSocket.CLOSED;
    if (code === 1006) this.dispatchEvent(new Event('error'));
    this.dispatchEvent(new CloseEvent('close', { code, reason, wasClean: code !== 1006 }));
  }
}

/** Gắn FakeWebSocket vào globalThis.WebSocket với một server mới; trả về server. */
export function installFakeObs(opts: FakeObsOptions = {}): FakeObsServer {
  const server = new FakeObsServer(opts);
  FakeWebSocket.server = server;
  vi.stubGlobal('WebSocket', FakeWebSocket);
  return server;
}

/** Chờ các microtask / promise đang treo chạy hết (không cần timer thật). */
export async function flushMicrotasks(rounds = 20): Promise<void> {
  for (let i = 0; i < rounds; i++) await Promise.resolve();
}

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  OBS_SUBPROTOCOL,
  ObsClient,
  ObsError,
  isLoopbackHost,
  obsAuthString,
  obsConnectUrl,
  obsUrl,
  sha256Base64,
} from './obsWebsocket';
import { FakeWebSocket, expectedAuth, flushMicrotasks, installFakeObs } from './testing/fakeObs';

const URL4455 = 'ws://127.0.0.1:4455';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function connected(password = '', opts: Parameters<typeof installFakeObs>[0] = {}) {
  const server = installFakeObs(opts);
  const client = new ObsClient({ url: URL4455, password });
  const hello = await client.connect();
  return { server, client, hello };
}

async function failKind(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(ObsError);
    return (e as ObsError).kind;
  }
  throw new Error('không lỗi');
}

describe('chuỗi auth', () => {
  it('sha256Base64 = base64(sha256(UTF-8)) như node:crypto', async () => {
    expect(await sha256Base64('abc')).toBe('ungWv48Bz+pBQUDeXa4iI7ADYaOWF3qctBD/YfIAFa0=');
    // Ký tự ngoài ASCII được mã hóa UTF-8 (mật khẩu tiếng Việt).
    const { nodeSha256Base64 } = await import('./testing/fakeObs');
    expect(await sha256Base64('mật khẩu ✓')).toBe(nodeSha256Base64('mật khẩu ✓'));
  });

  it('base64(sha256(base64(sha256(password + salt)) + challenge)) — ví dụ của tài liệu obs-websocket', async () => {
    const salt = 'lM1GncleQOaCu9lT1yeUZhFYnqhsLLP1G5lAGo3ixaI=';
    const challenge = '+IxH4CnCiqpX1rM9scsNynZzbOe4KhDeYcTNS3PDaeY=';
    const got = await obsAuthString('supersecretpassword', salt, challenge);
    expect(got).toBe(expectedAuth('supersecretpassword', salt, challenge));
    expect(got).not.toBe(await obsAuthString('supersecretpassworD', salt, challenge));
  });

  it('không có crypto.subtle (trang http lạ) → insecureContext', async () => {
    vi.stubGlobal('crypto', {});
    expect(await failKind(sha256Base64('x'))).toBe('insecureContext');
  });
});

describe('địa chỉ', () => {
  it('obsUrl dựng ws://host:port, IPv6 trong ngoặc vuông', () => {
    expect(obsUrl('127.0.0.1', 4455)).toBe(URL4455);
    expect(obsUrl(' localhost ', 4456)).toBe('ws://localhost:4456');
    expect(obsUrl('::1', 4455)).toBe('ws://[::1]:4455');
    expect(obsUrl('[::1]', 4455)).toBe('ws://[::1]:4455');
  });

  it.each([
    ['', 4455],
    ['127.0.0.1', 0],
    ['127.0.0.1', 70000],
    ['127.0.0.1', 44.5],
    ['127.0.0.1/x', 4455],
    ['ws://127.0.0.1', 4455],
    ['a b', 4455],
  ])('obsUrl(%j, %j) → invalidHost', (host, port) => {
    expect(() => obsUrl(host, port)).toThrow(ObsError);
    try {
      obsUrl(host, port);
    } catch (e) {
      expect((e as ObsError).kind).toBe('invalidHost');
    }
  });

  it('obsConnectUrl: trang https chỉ được nối tới chính máy này (mixed content)', () => {
    expect(obsConnectUrl('127.0.0.1', 4455, 'https:')).toBe(URL4455);
    expect(obsConnectUrl('localhost', 4455, 'https:')).toBe('ws://localhost:4455');
    expect(obsConnectUrl('192.168.1.5', 4455, 'http:')).toBe('ws://192.168.1.5:4455');
    expect(() => obsConnectUrl('192.168.1.5', 4455, 'https:')).toThrow(
      expect.objectContaining({ kind: 'insecureHost' }),
    );
    expect(() => obsConnectUrl('x y', 4455, 'https:')).toThrow(
      expect.objectContaining({ kind: 'invalidHost' }),
    );
  });

  it('isLoopbackHost: chỉ chính máy này', () => {
    for (const h of [
      '127.0.0.1',
      '127.1.2.3',
      'localhost',
      'LOCALHOST',
      'obs.localhost',
      '::1',
      '[::1]',
    ]) {
      expect(isLoopbackHost(h)).toBe(true);
    }
    for (const h of ['192.168.1.5', '10.0.0.2', 'example.com', '128.0.0.1', 'localhost.evil.com']) {
      expect(isLoopbackHost(h)).toBe(false);
    }
  });
});

describe('ObsClient — bắt tay', () => {
  it('không mật khẩu: Hello → Identify (rpcVersion 1, không event) → Identified', async () => {
    const { server, hello } = await connected('');
    expect(hello).toEqual({ obsWebSocketVersion: '5.5.4', rpcVersion: 1, authRequired: false });
    const ws = server.sockets[0];
    expect(ws?.url).toBe(URL4455);
    expect(ws?.protocol).toBe(OBS_SUBPROTOCOL);
    expect(server.lastAuth).toBeNull();
  });

  it('có mật khẩu đúng: gửi chuỗi auth đúng', async () => {
    const { server, hello } = await connected('hunter2', { password: 'hunter2' });
    expect(hello.authRequired).toBe(true);
    expect(server.lastAuth).toBe(expectedAuth('hunter2', server.opts.salt, server.opts.challenge));
  });

  it('sai mật khẩu → OBS đóng 4009 → authFailed', async () => {
    installFakeObs({ password: 'hunter2' });
    const client = new ObsClient({ url: URL4455, password: 'hunter3' });
    const err = await client.connect().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ObsError);
    expect((err as ObsError).kind).toBe('authFailed');
    expect((err as ObsError).code).toBe(4009);
    expect(client.isIdentified).toBe(false);
  });

  it('OBS cần mật khẩu mà ô trống → authRequired, không gửi Identify', async () => {
    const server = installFakeObs({ password: 'hunter2' });
    const client = new ObsClient({ url: URL4455, password: '' });
    expect(await failKind(client.connect())).toBe('authRequired');
    expect(server.lastAuth).toBeNull();
    await flushMicrotasks();
    expect(server.sockets[0]?.readyState).toBe(FakeWebSocket.CLOSED);
  });

  it('OBS tắt / chưa bật WebSocket server (1006, không mở) → unreachable', async () => {
    installFakeObs({ refuse: true });
    const err = await new ObsClient({ url: URL4455 }).connect().catch((e: unknown) => e);
    expect((err as ObsError).kind).toBe('unreachable');
    expect((err as ObsError).code).toBe(1006);
  });

  it('mã 4010 (RPC không hợp) → unsupported; mã 4xxx khác → protocol', async () => {
    installFakeObs({ closeAfterIdentify: 4010 });
    expect(await failKind(new ObsClient({ url: URL4455 }).connect())).toBe('unsupported');
    installFakeObs({ closeAfterIdentify: 4011 });
    expect(await failKind(new ObsClient({ url: URL4455 }).connect())).toBe('protocol');
  });

  it('Hello với rpcVersion < 1 → unsupported', async () => {
    installFakeObs({ rpcVersion: 0 });
    expect(await failKind(new ObsClient({ url: URL4455 }).connect())).toBe('unsupported');
  });

  it('khung lạ thay vì Hello → protocol', async () => {
    installFakeObs({ helloRaw: 'xin chào' });
    expect(await failKind(new ObsClient({ url: URL4455 }).connect())).toBe('protocol');
  });

  it('mở được mà không có Hello (obs-websocket 4 / server khác) → unsupported sau hạn', async () => {
    vi.useFakeTimers();
    installFakeObs({ silent: true });
    const p = new ObsClient({ url: URL4455, identifyTimeoutMs: 3000 }).connect();
    const kind = failKind(p);
    await vi.advanceTimersByTimeAsync(3001);
    expect(await kind).toBe('unsupported');
  });

  it('socket không mở trong hạn (trình duyệt đang hỏi quyền / host không trả lời) → unreachable', async () => {
    vi.useFakeTimers();
    const server = installFakeObs();
    // Giữ socket ở CONNECTING: server không bao giờ nhận.
    server.accept = (ws) => {
      server.sockets.push(ws);
    };
    const p = new ObsClient({ url: URL4455, openTimeoutMs: 15_000 }).connect();
    const kind = failKind(p);
    await vi.advanceTimersByTimeAsync(14_000);
    await vi.advanceTimersByTimeAsync(1001);
    expect(await kind).toBe('unreachable');
    await vi.advanceTimersByTimeAsync(0);
    expect(server.sockets[0]?.clientCloseCode).toBe(1000);
  });

  it('constructor throw SecurityError (ws:// lạ từ trang https) → insecureHost; lỗi khác → invalidHost', async () => {
    class Throwing {
      constructor() {
        throw Object.assign(new Error('insecure'), { name: 'SecurityError' });
      }
    }
    vi.stubGlobal('WebSocket', Throwing);
    expect(await failKind(new ObsClient({ url: 'ws://192.168.1.5:4455' }).connect())).toBe(
      'insecureHost',
    );
    class Syntax {
      constructor() {
        throw new SyntaxError('bad url');
      }
    }
    vi.stubGlobal('WebSocket', Syntax);
    expect(await failKind(new ObsClient({ url: 'ws://x:1' }).connect())).toBe('invalidHost');
  });

  it('close() giữa lúc bắt tay → connect bị từ chối closed', async () => {
    installFakeObs({ silent: true });
    const client = new ObsClient({ url: URL4455 });
    const p = client.connect();
    await flushMicrotasks();
    client.close();
    expect(await failKind(p)).toBe('closed');
  });

  it('connect() hai lần → lần sau bị từ chối', async () => {
    const { client } = await connected('');
    expect(await failKind(client.connect())).toBe('protocol');
  });
});

describe('ObsClient — request', () => {
  it('request → responseData; requestId duy nhất; requestData gửi nguyên', async () => {
    const { server, client } = await connected('');
    const v = await client.request<{ obsVersion: string }>('GetVersion');
    expect(v.obsVersion).toBe('31.0.2');
    await client.request('GetSceneItemList', { sceneName: 'Game' });
    expect(server.requests.map((r) => r.requestType)).toEqual(['GetVersion', 'GetSceneItemList']);
    expect(server.requests[1]?.requestData).toEqual({ sceneName: 'Game' });
    expect(new Set(server.requests.map((r) => r.requestId)).size).toBe(2);
  });

  it('OBS từ chối → ObsError request (mã + ghi chú + tên request)', async () => {
    const { server, client } = await connected('');
    server.overrides.set('GetSceneItemId', () => ({ ok: false, code: 600, comment: 'No item' }));
    const err = await client
      .request('GetSceneItemId', { sceneName: 'Game', sourceName: 'x' })
      .catch((e: unknown) => e);
    expect(err).toMatchObject({
      kind: 'request',
      code: 600,
      comment: 'No item',
      requestType: 'GetSceneItemId',
    });
  });

  it('OBS không trả lời → requestTimeout', async () => {
    const { server, client } = await connected('');
    vi.useFakeTimers();
    server.respond = false;
    const kind = failKind(client.request('GetVersion', undefined, 2000));
    await vi.advanceTimersByTimeAsync(2001);
    expect(await kind).toBe('requestTimeout');
  });

  it('chưa kết nối → notConnected; send() trả false', async () => {
    installFakeObs();
    const client = new ObsClient({ url: URL4455 });
    expect(await failKind(client.request('GetVersion'))).toBe('notConnected');
    expect(client.send('GetVersion')).toBe(false);
  });

  it('send() gửi rồi quên (kết quả trả về bị bỏ qua, không lỗi)', async () => {
    const { server, client } = await connected('');
    expect(
      client.send('CallVendorRequest', {
        vendorName: 'obs-browser',
        requestType: 'emit_event',
        requestData: { event_name: 'x', event_data: { a: 1 } },
      }),
    ).toBe(true);
    await flushMicrotasks();
    expect(server.emitted).toEqual([{ eventName: 'x', detail: { a: 1 } }]);
  });

  it('OBS đóng khi đang kết nối → onClose(closed) + request đang chờ bị từ chối', async () => {
    const { server, client } = await connected('');
    server.respond = false;
    const onClose = vi.fn();
    client.onClose(onClose);
    const pending = failKind(client.request('GetVersion'));
    server.socket?.serverClose(1001, 'OBS quit');
    expect(await pending).toBe('closed');
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onClose.mock.calls[0]?.[0]).toMatchObject({ kind: 'closed', code: 1001 });
    expect(client.isIdentified).toBe(false);
  });

  it('tự close() → không gọi onClose', async () => {
    const { client } = await connected('');
    const onClose = vi.fn();
    client.onClose(onClose);
    client.close();
    await flushMicrotasks();
    expect(onClose).not.toHaveBeenCalled();
    expect(await failKind(client.request('GetVersion'))).toBe('notConnected');
  });
});

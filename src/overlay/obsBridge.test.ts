import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FollowDisplay, FollowMessage, FollowSongMessage, FollowStateMessage } from './follow';
import { FOLLOW_EVENT, countdownLeftAt, expectedBeatAt, parseFollowMessage } from './follow';
import {
  OBS_INPUT_NAME,
  OBS_NO_LOOP,
  OBS_PREFS_KEY,
  OBS_RECONNECT_DELAYS_MS,
  OBS_RELAY_MAX_BUFFERED,
  OBS_SONG_RESEND_AFTER_ADD_MS,
  addOverlayToObs,
  connectObs,
  disconnectObs,
  emitEventRequest,
  ensureObsAutoConnect,
  getObsBridgeState,
  isObsRelayActive,
  loadObsPrefs,
  obsSafeMessage,
  relayToObs,
  resetObsBridgeForTests,
  setObsRemember,
} from './obsBridge';
import type { FakeObsOptions, FakeObsServer } from './testing/fakeObs';
import {
  FakeWebSocket,
  flushMicrotasks,
  installFakeObs,
  obsDataRoundTrip,
} from './testing/fakeObs';

const URL = 'https://app.example/#/overlay/seed-x?layout=game&fit=canvas';

const display: FollowDisplay = {
  scheme: 'pc',
  mobileSemitone: 'toggle',
  labels: { left: '', right: '', natural: '', scroll: '' },
  lookahead: 8,
  tileScale: 1,
  subLabel: 'none',
  countIn: true,
  language: 'vi',
  theme: 'dark',
};

function stateMsg(seq: number, over: Partial<FollowStateMessage> = {}): FollowStateMessage {
  return {
    v: 1,
    from: 'p1',
    kind: 'state',
    seq,
    songKey: 'k1',
    sentAt: 1_700_000_000_000 + seq,
    playing: true,
    beat: seq,
    bpm: 76,
    countdownEndsAt: null,
    loop: null,
    display,
    countIn: null,
    hidden: false,
    cause: 'change',
    ...over,
  };
}

function songMsg(source = '@title A\nZ X C', from = 'p1'): FollowSongMessage {
  return { v: 1, from, kind: 'song', songKey: 'k1', source, cause: 'change' };
}

const emits = (server: FakeObsServer) =>
  server.requests.filter((r) => r.requestType === 'CallVendorRequest');

/** event_data của lượt relay thứ i. */
function emittedData(server: FakeObsServer, i: number): unknown {
  const rd = emits(server)[i]?.requestData;
  return (rd?.requestData as { event_data?: unknown } | undefined)?.event_data;
}

async function connect(opts: FakeObsOptions = {}, remember = false, password = '') {
  const server = installFakeObs(opts);
  const ok = await connectObs({ host: '127.0.0.1', port: 4455, password, remember });
  return { server, ok };
}

function store(prefs: object): void {
  localStorage.setItem(OBS_PREFS_KEY, JSON.stringify(prefs));
}

beforeEach(() => {
  resetObsBridgeForTests();
});

afterEach(() => {
  resetObsBridgeForTests();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('kết nối', () => {
  it('Kết nối: connecting → connected (phiên bản OBS + WebSocket), relay bật', async () => {
    const server = installFakeObs();
    const seen: string[] = [];
    const p = connectObs({ host: '127.0.0.1', port: 4455, password: '', remember: false });
    seen.push(getObsBridgeState().status);
    expect(await p).toBe(true);
    const s = getObsBridgeState();
    expect(seen).toEqual(['connecting']);
    expect(s).toMatchObject({
      status: 'connected',
      obsVersion: '31.0.2',
      wsVersion: '5.5.4',
      error: null,
      host: '127.0.0.1',
      port: 4455,
    });
    expect(isObsRelayActive()).toBe(true);
    expect(server.sockets[0]?.url).toBe('ws://127.0.0.1:4455');
  });

  it('Nhớ trên máy này: lưu địa chỉ + mật khẩu sau khi kết nối được; không nhớ → không lưu', async () => {
    await connect({ password: 'pw' }, true, 'pw');
    expect(JSON.parse(localStorage.getItem(OBS_PREFS_KEY) ?? 'null')).toEqual({
      v: 1,
      remember: true,
      host: '127.0.0.1',
      port: 4455,
      password: 'pw',
      auto: true,
    });
    expect(loadObsPrefs()).toMatchObject({ saved: true, auto: true, password: 'pw' });
    disconnectObs();
    await connect({}, false);
    expect(JSON.parse(localStorage.getItem(OBS_PREFS_KEY) ?? 'null')).toEqual({
      v: 1,
      remember: false,
    });
    expect(loadObsPrefs()).toMatchObject({ remember: false, saved: false, password: '' });
  });

  it('sai mật khẩu → error authFailed, không lưu mật khẩu sai', async () => {
    const { ok } = await connect({ password: 'right' }, true, 'wrong');
    expect(ok).toBe(false);
    const s = getObsBridgeState();
    expect(s.status).toBe('error');
    expect(s.error?.kind).toBe('authFailed');
    expect(localStorage.getItem(OBS_PREFS_KEY)).toBeNull();
    expect(isObsRelayActive()).toBe(false);
  });

  it('OBS chưa mở → error unreachable; trình duyệt từ chối quyền mạng cục bộ → blocked', async () => {
    await connect({ refuse: true });
    expect(getObsBridgeState().error?.kind).toBe('unreachable');

    const query = vi.fn(async ({ name }: { name: string }) => {
      if (name === 'loopback-network') throw new TypeError('unknown permission');
      return { state: 'denied' as PermissionState };
    });
    Object.defineProperty(navigator, 'permissions', { configurable: true, value: { query } });
    try {
      await connect({ refuse: true });
      expect(getObsBridgeState().error?.kind).toBe('blocked');
      expect(query).toHaveBeenCalled();
    } finally {
      Reflect.deleteProperty(navigator, 'permissions');
    }
  });

  it('địa chỉ / cổng sai → invalidHost (không mở socket); ô địa chỉ trống = 127.0.0.1', async () => {
    const server = installFakeObs();
    await connectObs({ host: '127.0.0.1', port: 0, password: '', remember: false });
    expect(getObsBridgeState().error?.kind).toBe('invalidHost');
    await connectObs({ host: 'a/b', port: 4455, password: '', remember: false });
    expect(getObsBridgeState().error?.kind).toBe('invalidHost');
    expect(server.sockets).toHaveLength(0);
    await connectObs({ host: '  ', port: 4455, password: '', remember: false });
    expect(getObsBridgeState()).toMatchObject({ status: 'connected', host: '127.0.0.1' });
  });

  it('Ngắt kết nối: về off, lần mở app sau không tự kết nối (vẫn nhớ mật khẩu)', async () => {
    const { server } = await connect({}, true);
    disconnectObs();
    expect(getObsBridgeState().status).toBe('off');
    expect(isObsRelayActive()).toBe(false);
    await flushMicrotasks();
    expect(server.sockets[0]?.readyState).toBe(FakeWebSocket.CLOSED);
    expect(loadObsPrefs()).toMatchObject({ saved: true, auto: false });
    resetObsBridgeForTests();
    ensureObsAutoConnect();
    expect(getObsBridgeState().status).toBe('off');
    expect(server.sockets).toHaveLength(1);
  });

  it('ô Nhớ: tắt → xóa ngay; bật khi đang kết nối → lưu kết nối hiện tại', async () => {
    await connect({ password: 'pw' }, true, 'pw');
    setObsRemember(false);
    expect(loadObsPrefs()).toMatchObject({ remember: false, saved: false, password: '' });
    setObsRemember(true);
    expect(loadObsPrefs()).toMatchObject({ remember: true, saved: true, password: 'pw' });
  });

  it('localStorage hỏng / bị chặn → mặc định, không throw', () => {
    localStorage.setItem(OBS_PREFS_KEY, '{oops');
    expect(loadObsPrefs()).toMatchObject({ host: '127.0.0.1', port: 4455, remember: true });
    store({ v: 1, remember: true, host: 5, port: 'x', password: 1 });
    expect(loadObsPrefs()).toMatchObject({ host: '127.0.0.1', port: 4455, saved: false });
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(loadObsPrefs().saved).toBe(false);
    expect(() => setObsRemember(false)).not.toThrow();
    get.mockRestore();
    set.mockRestore();
  });
});

describe('tự kết nối lại', () => {
  it('mở app với mật khẩu đã nhớ: lần relay đầu tiên tự kết nối lặng lẽ', async () => {
    store({ v: 1, remember: true, host: '127.0.0.1', port: 4455, password: 'pw', auto: true });
    const server = installFakeObs({ password: 'pw' });
    relayToObs(songMsg());
    expect(getObsBridgeState()).toMatchObject({ status: 'connecting', auto: true });
    await vi.waitFor(() => expect(getObsBridgeState().status).toBe('connected'));
    // Bài của Player (gửi lúc chưa kết nối) được gửi ngay khi vừa kết nối.
    await vi.waitFor(() => expect(emits(server)).toHaveLength(1));
    expect(emittedData(server, 0)).toMatchObject({ kind: 'song', source: '@title A\nZ X C' });
    // Chỉ một lần mỗi lần mở app.
    relayToObs(stateMsg(1));
    expect(server.sockets).toHaveLength(1);
  });

  it('không có gì đã nhớ / auto tắt → không kết nối', () => {
    const server = installFakeObs();
    ensureObsAutoConnect();
    expect(server.sockets).toHaveLength(0);
    resetObsBridgeForTests();
    store({ v: 1, remember: true, host: '127.0.0.1', port: 4455, password: '', auto: false });
    ensureObsAutoConnect();
    expect(server.sockets).toHaveLength(0);
    expect(getObsBridgeState().status).toBe('off');
  });

  it('OBS chưa mở: thử lại giãn dần rồi thôi lặng lẽ (status off, không lỗi)', async () => {
    vi.useFakeTimers();
    store({ v: 1, remember: true, host: '127.0.0.1', port: 4455, password: '', auto: true });
    const server = installFakeObs({ refuse: true });
    ensureObsAutoConnect();
    await flushMicrotasks();
    expect(server.sockets).toHaveLength(1);
    let elapsed = 0;
    for (const [i, d] of OBS_RECONNECT_DELAYS_MS.entries()) {
      expect(getObsBridgeState()).toMatchObject({ status: 'connecting', auto: true });
      await vi.advanceTimersByTimeAsync(d - 1);
      expect(server.sockets).toHaveLength(i + 1);
      await vi.advanceTimersByTimeAsync(1);
      elapsed += d;
      expect(server.sockets).toHaveLength(i + 2);
      await flushMicrotasks();
    }
    expect(elapsed).toBe(OBS_RECONNECT_DELAYS_MS.reduce((a, b) => a + b, 0));
    expect(getObsBridgeState()).toMatchObject({ status: 'off', error: null, auto: false });
    await vi.advanceTimersByTimeAsync(120_000);
    expect(server.sockets).toHaveLength(OBS_RECONNECT_DELAYS_MS.length + 1);
  });

  it('OBS mở muộn: lần thử lại sau kết nối được', async () => {
    vi.useFakeTimers();
    store({ v: 1, remember: true, host: '127.0.0.1', port: 4455, password: '', auto: true });
    const server = installFakeObs({ refuse: true });
    ensureObsAutoConnect();
    await vi.advanceTimersByTimeAsync(0);
    server.opts.refuse = false;
    await vi.advanceTimersByTimeAsync(OBS_RECONNECT_DELAYS_MS[0] ?? 1000);
    expect(getObsBridgeState().status).toBe('connected');
  });

  it('mật khẩu đã nhớ không còn đúng → thôi ngay, không thử lại', async () => {
    store({ v: 1, remember: true, host: '127.0.0.1', port: 4455, password: 'old', auto: true });
    const server = installFakeObs({ password: 'new' });
    ensureObsAutoConnect();
    await vi.waitFor(() => expect(getObsBridgeState().status).toBe('off'));
    expect(getObsBridgeState().error).toBeNull();
    expect(server.sockets).toHaveLength(1);
  });

  it('mất kết nối (OBS đóng) → tự kết nối lại; hết lượt → error closed', async () => {
    vi.useFakeTimers();
    const { server } = await connect();
    server.opts.refuse = true;
    server.socket?.serverClose(1001, 'bye');
    await vi.advanceTimersByTimeAsync(0);
    expect(getObsBridgeState()).toMatchObject({ status: 'connecting', auto: true });
    expect(isObsRelayActive()).toBe(false);
    for (const d of OBS_RECONNECT_DELAYS_MS) {
      await vi.advanceTimersByTimeAsync(d);
      await flushMicrotasks();
    }
    expect(getObsBridgeState().status).toBe('error');
    expect(getObsBridgeState().error?.kind).toBe('closed');
  });

  it('mất kết nối rồi OBS mở lại → connected, relay chạy tiếp', async () => {
    vi.useFakeTimers();
    const { server } = await connect();
    server.socket?.serverClose(1001, 'restart');
    await vi.advanceTimersByTimeAsync(OBS_RECONNECT_DELAYS_MS[0] ?? 1000);
    expect(getObsBridgeState().status).toBe('connected');
    relayToObs(stateMsg(1));
    expect(emits(server)).toHaveLength(1);
  });

  it('Ngắt kết nối trong lúc đang tự thử lại → dừng hẳn', async () => {
    vi.useFakeTimers();
    store({ v: 1, remember: true, host: '127.0.0.1', port: 4455, password: '', auto: true });
    const server = installFakeObs({ refuse: true });
    ensureObsAutoConnect();
    await vi.advanceTimersByTimeAsync(0);
    disconnectObs();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(server.sockets).toHaveLength(1);
    expect(getObsBridgeState().status).toBe('off');
  });
});

describe('relay Player → Browser Source', () => {
  it('chưa kết nối: bỏ qua, không throw; hello không bao giờ relay', async () => {
    expect(() => relayToObs(stateMsg(1))).not.toThrow();
    const { server } = await connect();
    relayToObs({ v: 1, from: 'o', kind: 'hello' });
    expect(emits(server)).toHaveLength(0);
  });

  it('CallVendorRequest obs-browser / emit_event với event FOLLOW_EVENT', async () => {
    const { server } = await connect();
    relayToObs(songMsg());
    expect(emits(server)[0]?.requestData).toEqual({
      vendorName: 'obs-browser',
      requestType: 'emit_event',
      requestData: { event_name: FOLLOW_EVENT, event_data: songMsg() },
    });
  });

  it('gộp loạt tin: ≤ 20 lượt / giây, luôn gửi trạng thái mới nhất', async () => {
    vi.useFakeTimers();
    const { server } = await connect();
    // Một loạt 10 tin trong 1 ms: tin đầu đi ngay, 9 tin sau gộp thành 1 (tin mới nhất) sau 50 ms.
    for (let i = 1; i <= 10; i++) relayToObs(stateMsg(i));
    expect(emits(server)).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(49);
    expect(emits(server)).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(emits(server)).toHaveLength(2);
    expect(emittedData(server, 1)).toMatchObject({ kind: 'state', seq: 10 });

    // 1 giây tin dồn dập (mỗi 2 ms): ≤ 21 lượt, lượt cuối là tin cuối.
    const before = emits(server).length;
    for (let i = 11; i <= 510; i++) {
      relayToObs(stateMsg(i));
      await vi.advanceTimersByTimeAsync(2);
    }
    await vi.advanceTimersByTimeAsync(100);
    const sent = emits(server).length - before;
    expect(sent).toBeLessThanOrEqual(21);
    expect(sent).toBeGreaterThanOrEqual(15);
    expect(emittedData(server, emits(server).length - 1)).toMatchObject({ seq: 510 });
  });

  it('gộp giữ thứ tự: bài trước trạng thái; bye rồi tin mới thì tin mới đi sau', async () => {
    vi.useFakeTimers();
    const { server } = await connect();
    relayToObs(stateMsg(1)); // đi ngay
    relayToObs(songMsg('@title B\nZ'));
    relayToObs(stateMsg(2));
    relayToObs({ v: 1, from: 'p1', kind: 'bye' });
    relayToObs(stateMsg(3));
    await vi.advanceTimersByTimeAsync(60);
    const kinds = emits(server).map((_, i) => (emittedData(server, i) as FollowMessage).kind);
    expect(kinds).toEqual(['state', 'song', 'bye', 'state']);
    expect(emittedData(server, 3)).toMatchObject({ seq: 3 });
  });

  it('socket nghẽn → hoãn, vẫn gửi tin mới nhất khi thông', async () => {
    vi.useFakeTimers();
    const { server } = await connect();
    const ws = server.socket;
    if (!ws) throw new Error('no socket');
    relayToObs(stateMsg(1));
    ws.bufferedAmount = OBS_RELAY_MAX_BUFFERED + 1;
    relayToObs(stateMsg(2));
    relayToObs(stateMsg(3));
    await vi.advanceTimersByTimeAsync(500);
    expect(emits(server)).toHaveLength(1);
    ws.bufferedAmount = 0;
    await vi.advanceTimersByTimeAsync(250);
    expect(emits(server)).toHaveLength(2);
    expect(emittedData(server, 1)).toMatchObject({ seq: 3 });
  });

  it('send lỗi (socket hỏng) → relay vẫn không throw', async () => {
    const { server } = await connect();
    const ws = server.socket;
    if (!ws) throw new Error('no socket');
    ws.send = () => {
      throw new Error('boom');
    };
    expect(() => relayToObs(stateMsg(1))).not.toThrow();
  });

  it('tới Browser Source qua obs_data (null bị bỏ) mà overlay vẫn đọc được, cùng nghĩa', async () => {
    const { server } = await connect();
    const got: unknown[] = [];
    const onEvent = (e: Event) => got.push((e as CustomEvent<unknown>).detail);
    window.addEventListener(FOLLOW_EVENT, onEvent);
    try {
      const plain = stateMsg(7, { beat: 3.5, countdownEndsAt: null, loop: null, countIn: null });
      const withLoop = stateMsg(8, {
        beat: -2,
        countdownEndsAt: 1_700_000_003_000,
        loop: { startBeat: 4, endBeat: 12 },
        countIn: { startBeat: -4, endBeat: 0 },
      });
      relayToObs(plain);
      await flushMicrotasks();
      await new Promise((r) => setTimeout(r, 60));
      relayToObs(withLoop);
      await flushMicrotasks();
      expect(emits(server)).toHaveLength(2);
      expect(got).toHaveLength(2);

      // obs_data làm mất đúng các trường null của tin gốc (vì vậy mới cần obsSafeMessage).
      expect(obsDataRoundTrip(plain)).not.toHaveProperty('loop');
      expect(obsDataRoundTrip(plain)).not.toHaveProperty('countdownEndsAt');

      const a = parseFollowMessage(got[0]) as FollowStateMessage | null;
      expect(a).not.toBeNull();
      expect(a?.loop).toEqual(OBS_NO_LOOP);
      for (const t of [plain.sentAt, plain.sentAt + 1000, plain.sentAt + 600_000]) {
        expect(expectedBeatAt(a as FollowStateMessage, t)).toBeCloseTo(expectedBeatAt(plain, t), 9);
        expect(countdownLeftAt(a?.countdownEndsAt ?? null, t)).toBeNull();
      }
      const b = parseFollowMessage(got[1]) as FollowStateMessage | null;
      expect(b).toMatchObject({
        loop: { startBeat: 4, endBeat: 12 },
        countdownEndsAt: 1_700_000_003_000,
        countIn: { startBeat: -4, endBeat: 0 },
        display,
      });
    } finally {
      window.removeEventListener(FOLLOW_EVENT, onEvent);
    }
  });

  it('obsSafeMessage / emitEventRequest không đổi tin gốc', () => {
    const m = stateMsg(1);
    const safe = obsSafeMessage(m) as FollowStateMessage;
    expect(m.loop).toBeNull();
    expect(safe).toMatchObject({ countdownEndsAt: 0, loop: OBS_NO_LOOP });
    expect('countIn' in safe).toBe(false);
    expect(obsSafeMessage(songMsg())).toEqual(songMsg());
    expect(emitEventRequest(m)).toMatchObject({
      vendorName: 'obs-browser',
      requestType: 'emit_event',
    });
  });
});

describe('Thêm overlay vào OBS', () => {
  it('chưa kết nối → notConnected', async () => {
    await expect(addOverlayToObs(URL)).rejects.toMatchObject({ kind: 'notConnected' });
  });

  it('tạo mới: Browser Source cỡ canvas tại 0,0, neo trên-trái, trên cùng của cảnh đang phát', async () => {
    const { server } = await connect();
    server.inputs.push({ inputName: 'Game Capture', inputKind: 'game_capture', inputSettings: {} });
    server.addItem('Game', 'Game Capture');
    server.addItem('Game', 'Webcam');
    const r = await addOverlayToObs(URL);
    expect(r).toEqual({
      action: 'created',
      sceneName: 'Game',
      width: 1920,
      height: 1080,
      inputName: OBS_INPUT_NAME,
      sceneItemId: 3,
    });
    const create = server.requests.find((q) => q.requestType === 'CreateInput');
    expect(create?.requestData).toEqual({
      sceneName: 'Game',
      inputName: 'DF Harmonica Tiles',
      inputKind: 'browser_source',
      inputSettings: {
        url: URL,
        width: 1920,
        height: 1080,
        fps: 60,
        reroute_audio: false,
        restart_when_active: false,
        shutdown: false,
      },
      sceneItemEnabled: true,
    });
    const transform = server.requests.find((q) => q.requestType === 'SetSceneItemTransform');
    expect(transform?.requestData).toEqual({
      sceneName: 'Game',
      sceneItemId: 3,
      sceneItemTransform: {
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
      },
    });
    // CreateInput thêm ở trên cùng sẵn → không cần SetSceneItemIndex.
    const items = server.sceneItems();
    expect(items[items.length - 1]?.sourceName).toBe(OBS_INPUT_NAME);
    expect(server.requestTypes()).not.toContain('SetSceneItemIndex');
    expect(server.requestTypes()).not.toContain('SetInputSettings');
  });

  it('đã có (ở cảnh khác): cập nhật link + cỡ, thêm vào cảnh đang phát, 0,0, lên trên cùng', async () => {
    const { server } = await connect();
    server.baseWidth = 2560;
    server.baseHeight = 1440;
    server.programScene = 'Live';
    server.scenes.set('Live', []);
    server.inputs.push({
      inputName: OBS_INPUT_NAME,
      inputKind: 'browser_source',
      inputSettings: { url: 'old', width: 800, height: 600, css: 'x' },
    });
    server.addItem('Game', OBS_INPUT_NAME);
    server.inputs.push({ inputName: 'Cam', inputKind: 'dshow_input', inputSettings: {} });
    server.addItem('Live', 'Cam');
    const r = await addOverlayToObs(URL);
    expect(r).toMatchObject({ action: 'updated', sceneName: 'Live', width: 2560, height: 1440 });
    expect(server.requests.find((q) => q.requestType === 'SetInputSettings')?.requestData).toEqual({
      inputName: OBS_INPUT_NAME,
      inputSettings: { url: URL, width: 2560, height: 1440 },
      overlay: true,
    });
    // Giữ các thiết lập khác của người dùng (overlay: true).
    expect(server.inputs[0]?.inputSettings).toEqual({
      url: URL,
      width: 2560,
      height: 1440,
      css: 'x',
    });
    expect(server.requestTypes()).toContain('CreateSceneItem');
    expect(server.requestTypes()).not.toContain('CreateInput');
    const live = server.sceneItems('Live');
    expect(live.map((i) => i.sourceName)).toEqual(['Cam', OBS_INPUT_NAME]);
    expect(live[1]?.transform).toMatchObject({
      positionX: 0,
      positionY: 0,
      scaleX: 1,
      alignment: 5,
    });
  });

  it('đã có trong cảnh nhưng bị ẩn, nằm dưới cùng, bị kéo lệch → bật, về 0,0, lên trên cùng', async () => {
    const { server } = await connect();
    server.inputs.push({
      inputName: OBS_INPUT_NAME,
      inputKind: 'browser_source',
      inputSettings: {},
    });
    const mine = server.addItem('Game', OBS_INPUT_NAME, false);
    server.addItem('Game', 'Game Capture');
    server.addItem('Game', 'Alerts');
    const r = await addOverlayToObs(URL);
    expect(r.action).toBe('updated');
    expect(r.sceneItemId).toBe(mine.sceneItemId);
    expect(mine.enabled).toBe(true);
    expect(mine.transform).toMatchObject({ positionX: 0, positionY: 0, scaleX: 1, scaleY: 1 });
    expect(server.requests.find((q) => q.requestType === 'SetSceneItemIndex')?.requestData).toEqual(
      { sceneName: 'Game', sceneItemId: mine.sceneItemId, sceneItemIndex: 2 },
    );
    expect(server.sceneItems().map((i) => i.sourceName)).toEqual([
      'Game Capture',
      'Alerts',
      OBS_INPUT_NAME,
    ]);
  });

  it('obs-websocket 5.0–5.2 (chỉ có currentProgramSceneName) vẫn được', async () => {
    const { server } = await connect();
    server.legacySceneField = true;
    expect((await addOverlayToObs(URL)).sceneName).toBe('Game');
  });

  it('trùng tên với source khác loại / với một cảnh → nameTaken', async () => {
    const { server } = await connect();
    server.inputs.push({ inputName: OBS_INPUT_NAME, inputKind: 'image_source', inputSettings: {} });
    await expect(addOverlayToObs(URL)).rejects.toMatchObject({ kind: 'nameTaken' });
    server.inputs = [];
    server.scenes.set(OBS_INPUT_NAME, []);
    await expect(addOverlayToObs(URL)).rejects.toMatchObject({ kind: 'nameTaken', code: 601 });
  });

  it('OBS từ chối giữa chừng → ObsError request (giữ mã)', async () => {
    const { server } = await connect();
    server.overrides.set('GetVideoSettings', () => ({
      ok: false,
      code: 207,
      comment: 'not ready',
    }));
    await expect(addOverlayToObs(URL)).rejects.toMatchObject({ kind: 'request', code: 207 });
  });

  it('sau khi thêm: gửi lại bài cho trang overlay vừa được OBS tải lại', async () => {
    vi.useFakeTimers();
    const { server } = await connect();
    relayToObs(songMsg());
    await addOverlayToObs(URL);
    const n = emits(server).length;
    await vi.advanceTimersByTimeAsync(OBS_SONG_RESEND_AFTER_ADD_MS);
    expect(emits(server)).toHaveLength(n + 1);
    expect(emittedData(server, n)).toMatchObject({ kind: 'song' });
  });
});

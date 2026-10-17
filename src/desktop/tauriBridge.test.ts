import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DfhtCommand, DfhtCommandDetail } from '../overlay/commands';
import { DFHT_COMMAND_EVENT, DFHT_COMMANDS, readDfhtCommand } from '../overlay/commands';
import type { BridgeTarget } from './tauriBridge';
import { TAURI_COMMAND_EVENT, commandFromPayload, installTauriBridge } from './tauriBridge';

type Handler = (event: { payload: unknown }) => void;

/** `window.__TAURI__` giả: ghi lại listener để test tự "emit" như phía Rust. */
function fakeTauri(opts: { reject?: boolean } = {}) {
  const handlers = new Map<string, Handler[]>();
  const unlisten = vi.fn((event: string, handler: Handler) => {
    handlers.set(
      event,
      (handlers.get(event) ?? []).filter((h) => h !== handler),
    );
  });
  const listen = vi.fn((event: string, handler: Handler): Promise<() => void> => {
    if (opts.reject) return Promise.reject(new Error('event.listen not allowed'));
    handlers.set(event, [...(handlers.get(event) ?? []), handler]);
    return Promise.resolve(() => unlisten(event, handler));
  });
  const emit = (event: string, payload: unknown) => {
    for (const h of handlers.get(event) ?? []) h({ payload });
  };
  return { api: { event: { listen } }, listen, unlisten, emit, handlers };
}

/** Target giả (EventTarget thật) — mỗi test một target nên không dính trạng thái cài đặt. */
function makeTarget(tauri?: unknown): BridgeTarget & EventTarget {
  return Object.assign(new EventTarget(), { __TAURI__: tauri });
}

function recordCommands(target: EventTarget): DfhtCommand[] {
  const got: DfhtCommand[] = [];
  target.addEventListener(DFHT_COMMAND_EVENT, (e) => {
    got.push((e as CustomEvent<DfhtCommandDetail>).detail.command);
  });
  return got;
}

afterEach(() => {
  delete (window as Window & { __TAURI__?: unknown }).__TAURI__;
});

describe('commandFromPayload', () => {
  it('chỉ nhận đúng các lệnh của contract dfht:command', () => {
    expect(DFHT_COMMANDS).toEqual(['toggle', 'restart', 'nextLine', 'prevLine']);
    for (const c of DFHT_COMMANDS) expect(commandFromPayload(c)).toBe(c);
    for (const bad of ['play', 'Toggle', '', ' toggle', 1, null, undefined, {}, ['toggle']]) {
      expect(commandFromPayload(bad)).toBeNull();
    }
  });

  it('payload là chuỗi hoặc object { command }', () => {
    expect(commandFromPayload('nextLine')).toBe('nextLine');
    expect(commandFromPayload({ command: 'prevLine' })).toBe('prevLine');
    expect(commandFromPayload({ command: 'stop' })).toBeNull();
    expect(commandFromPayload({ cmd: 'toggle' })).toBeNull();
    expect(commandFromPayload(null)).toBeNull();
    expect(commandFromPayload(42)).toBeNull();
  });
});

describe('installTauriBridge', () => {
  it('không có window.__TAURI__ (trình duyệt thường) → null, không làm gì', async () => {
    await expect(installTauriBridge(makeTarget())).resolves.toBeNull();
    await expect(installTauriBridge(makeTarget({}))).resolves.toBeNull();
    await expect(installTauriBridge(makeTarget({ event: {} }))).resolves.toBeNull();
    await expect(installTauriBridge(makeTarget({ event: { listen: 'x' } }))).resolves.toBeNull();
    await expect(installTauriBridge(makeTarget(null))).resolves.toBeNull();
  });

  it('nghe "dfht-command" và chuyển mọi lệnh hợp lệ thành dfht:command', async () => {
    const tauri = fakeTauri();
    const target = makeTarget(tauri.api);
    const got = recordCommands(target);
    const unlisten = await installTauriBridge(target);
    expect(unlisten).toBeTypeOf('function');
    expect(tauri.listen).toHaveBeenCalledTimes(1);
    expect(tauri.listen.mock.calls[0]?.[0]).toBe(TAURI_COMMAND_EVENT);

    for (const c of DFHT_COMMANDS) tauri.emit(TAURI_COMMAND_EVENT, c);
    tauri.emit(TAURI_COMMAND_EVENT, { command: 'toggle' });
    expect(got).toEqual(['toggle', 'restart', 'nextLine', 'prevLine', 'toggle']);
  });

  it('event phát ra đúng contract mà Player / Overlay đọc (readDfhtCommand)', async () => {
    const tauri = fakeTauri();
    const target = makeTarget(tauri.api);
    const read: (DfhtCommand | null)[] = [];
    target.addEventListener(DFHT_COMMAND_EVENT, (e) => read.push(readDfhtCommand(e)));
    await installTauriBridge(target);
    tauri.emit(TAURI_COMMAND_EVENT, 'restart');
    expect(read).toEqual(['restart']);
  });

  it('bỏ qua payload không hợp lệ', async () => {
    const tauri = fakeTauri();
    const target = makeTarget(tauri.api);
    const got = recordCommands(target);
    await installTauriBridge(target);
    for (const bad of ['play', '', 7, null, undefined, { command: 'quit' }, ['toggle']]) {
      tauri.emit(TAURI_COMMAND_EVENT, bad);
    }
    expect(got).toEqual([]);
  });

  it('idempotent: gọi nhiều lần chỉ nghe một lần, cùng một promise', async () => {
    const tauri = fakeTauri();
    const target = makeTarget(tauri.api);
    const got = recordCommands(target);
    const a = installTauriBridge(target);
    const b = installTauriBridge(target);
    expect(b).toBe(a);
    await a;
    await installTauriBridge(target);
    expect(tauri.listen).toHaveBeenCalledTimes(1);
    tauri.emit(TAURI_COMMAND_EVENT, 'toggle');
    expect(got).toEqual(['toggle']);
  });

  it('hàm gỡ: ngừng chuyển lệnh, gọi unlisten của Tauri một lần, cài lại được', async () => {
    const tauri = fakeTauri();
    const target = makeTarget(tauri.api);
    const got = recordCommands(target);
    const unlisten = await installTauriBridge(target);
    unlisten?.();
    unlisten?.();
    expect(tauri.unlisten).toHaveBeenCalledTimes(1);
    tauri.emit(TAURI_COMMAND_EVENT, 'toggle');
    expect(got).toEqual([]);

    await installTauriBridge(target);
    expect(tauri.listen).toHaveBeenCalledTimes(2);
    tauri.emit(TAURI_COMMAND_EVENT, 'nextLine');
    expect(got).toEqual(['nextLine']);
  });

  it('listen bị từ chối (thiếu quyền) → null + một cảnh báo, không throw; thử lại được', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const tauri = fakeTauri({ reject: true });
    const target = makeTarget(tauri.api);
    await expect(installTauriBridge(target)).resolves.toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    await expect(installTauriBridge(target)).resolves.toBeNull();
    expect(tauri.listen).toHaveBeenCalledTimes(2);
  });

  it('listen trả về thứ không phải hàm → vẫn chạy, gỡ không lỗi', async () => {
    const handlers: Handler[] = [];
    const listen = vi.fn((_event: string, handler: Handler) => {
      handlers.push(handler);
      return Promise.resolve(undefined);
    });
    const target = makeTarget({ event: { listen } });
    const got = recordCommands(target);
    const unlisten = await installTauriBridge(target);
    handlers[0]?.({ payload: 'restart' });
    expect(got).toEqual(['restart']);
    expect(() => unlisten?.()).not.toThrow();
    handlers[0]?.({ payload: 'restart' });
    expect(got).toEqual(['restart']);
  });

  it('import module tự cài trên window khi có window.__TAURI__ (đường main.tsx)', async () => {
    const tauri = fakeTauri();
    (window as Window & { __TAURI__?: unknown }).__TAURI__ = tauri.api;
    vi.resetModules();
    const mod = await import('./tauriBridge');
    const got = recordCommands(window);
    const unlisten = await mod.installTauriBridge(window);
    expect(tauri.listen).toHaveBeenCalledTimes(1);
    tauri.emit(TAURI_COMMAND_EVENT, 'prevLine');
    expect(got).toEqual(['prevLine']);
    unlisten?.();
  });

  it('import module trên trình duyệt thường không throw và không phát gì', async () => {
    vi.resetModules();
    const got = recordCommands(window);
    const mod = await import('./tauriBridge');
    await expect(mod.installTauriBridge(window)).resolves.toBeNull();
    expect(got).toEqual([]);
  });
});

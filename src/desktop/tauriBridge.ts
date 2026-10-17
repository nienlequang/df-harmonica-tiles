/**
 * Cầu nối phím tắt toàn cục của bản desktop (Tauri, `src-tauri/`, docs/TAURI.md) → lệnh điều khiển trong
 * trang (SPEC mục 8).
 *
 * Phía Rust đăng ký global shortcut (Ctrl+Alt+P / R / → / ←) và `emit("dfht-command", "<lệnh>")` tới
 * webview. Ở đây nghe sự kiện đó qua API toàn cục `window.__TAURI__` (có khi `app.withGlobalTauri = true`)
 * rồi phát lại thành `CustomEvent('dfht:command', { detail: { command } })` trên `window` — contract dùng
 * chung với PlayerView / OverlayView (src/overlay/commands.ts; cùng hành động với Space / R / → / ←).
 *
 * Trình duyệt thường không có `window.__TAURI__` → không làm gì. Gọi nhiều lần chỉ nghe một lần.
 * Không import gì từ Tauri (không thêm dependency): kiểu tối thiểu khai báo tại chỗ, thu hẹp từ `unknown`.
 */
import type { DfhtCommand, DfhtCommandDetail } from '../overlay/commands';
import { DFHT_COMMAND_EVENT, DFHT_COMMANDS } from '../overlay/commands';

/** Tên sự kiện Tauri do `src-tauri/src/main.rs` emit (payload = chuỗi lệnh). */
export const TAURI_COMMAND_EVENT = 'dfht-command';

function isCommand(value: unknown): value is DfhtCommand {
  return typeof value === 'string' && (DFHT_COMMANDS as readonly string[]).includes(value);
}

/** Payload Tauri → lệnh hợp lệ, hoặc null. Nhận chuỗi `"toggle"` hoặc object `{ command: "toggle" }`. */
export function commandFromPayload(payload: unknown): DfhtCommand | null {
  if (isCommand(payload)) return payload;
  if (payload !== null && typeof payload === 'object' && 'command' in payload) {
    const { command } = payload as { command: unknown };
    if (isCommand(command)) return command;
  }
  return null;
}

/** Hàm gỡ listener (cùng hình dạng `UnlistenFn` của @tauri-apps/api). */
export type Unlisten = () => void;

/** Phần tối thiểu của `window.__TAURI__.event` mà cầu nối dùng. */
interface TauriEventApi {
  listen: (event: string, handler: (event: { payload: unknown }) => void) => Promise<unknown>;
}

/** Nơi cài cầu nối: `window` thật, hoặc EventTarget giả trong test. */
export interface BridgeTarget {
  dispatchEvent: (event: Event) => boolean;
  __TAURI__?: unknown;
}

function tauriEventApi(tauri: unknown): TauriEventApi | null {
  if (tauri === null || typeof tauri !== 'object' || !('event' in tauri)) return null;
  const { event } = tauri as { event: unknown };
  if (event === null || typeof event !== 'object' || !('listen' in event)) return null;
  const { listen } = event as { listen: unknown };
  if (typeof listen !== 'function') return null;
  return event as TauriEventApi;
}

function dispatchCommand(target: BridgeTarget, command: DfhtCommand): void {
  const detail: DfhtCommandDetail = { command };
  target.dispatchEvent(new CustomEvent<DfhtCommandDetail>(DFHT_COMMAND_EVENT, { detail }));
}

const installs = new WeakMap<BridgeTarget, Promise<Unlisten | null>>();

/**
 * Cài cầu nối trên `target` (mặc định `window`). Không có API sự kiện Tauri → `null` (không ghi nhớ, gọi
 * lại sau vẫn kiểm tra). Đã cài → trả đúng promise cũ (không nghe hai lần). `listen` lỗi (vd. thiếu quyền
 * `core:event:allow-listen` trong capabilities) → cảnh báo một dòng, `null`. Hàm gỡ trả về cho phép cài lại.
 */
export function installTauriBridge(target: BridgeTarget = window): Promise<Unlisten | null> {
  const existing = installs.get(target);
  if (existing) return existing;
  const api = tauriEventApi(target.__TAURI__);
  if (!api) return Promise.resolve(null);

  let active = true;
  const forget = (): void => {
    active = false;
    if (installs.get(target) === pending) installs.delete(target);
  };
  const pending: Promise<Unlisten | null> = Promise.resolve()
    .then(() =>
      api.listen(TAURI_COMMAND_EVENT, (event) => {
        if (!active) return;
        const command = commandFromPayload(event.payload);
        if (command) dispatchCommand(target, command);
      }),
    )
    .then((raw): Unlisten => {
      const unlistenTauri = typeof raw === 'function' ? (raw as () => unknown) : null;
      return () => {
        if (!active) return;
        forget();
        unlistenTauri?.();
      };
    })
    .catch((err: unknown) => {
      forget();
      console.warn('[dfht] Tauri: không nghe được phím tắt toàn cục', err);
      return null;
    });
  installs.set(target, pending);
  return pending;
}

// Cài ngay khi được import từ main.tsx (Tauri chèn `window.__TAURI__` trước script của trang).
if (typeof window !== 'undefined') void installTauriBridge(window);

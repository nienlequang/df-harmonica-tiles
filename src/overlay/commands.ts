import { useEffect, useLayoutEffect, useRef } from 'react';

/**
 * Contract lệnh điều khiển từ ngoài (desktop Tauri global shortcut — src/desktop/tauriBridge.ts —
 * hoặc remote khác): `window.dispatchEvent(new CustomEvent('dfht:command', { detail: { command } }))`
 * với `command` ∈ DFHT_COMMANDS. PlayerView và OverlayView làm đúng hành động của Space / R / → / ←.
 */
export const DFHT_COMMAND_EVENT = 'dfht:command';

export type DfhtCommand = 'toggle' | 'restart' | 'nextLine' | 'prevLine';

export const DFHT_COMMANDS: readonly DfhtCommand[] = ['toggle', 'restart', 'nextLine', 'prevLine'];

export interface DfhtCommandDetail {
  command: DfhtCommand;
}

/** Lệnh hợp lệ trong event, hoặc null (event khác loại / detail sai). Không throw. */
export function readDfhtCommand(e: Event): DfhtCommand | null {
  if (!('detail' in e)) return null;
  const detail: unknown = (e as CustomEvent<unknown>).detail;
  if (detail === null || typeof detail !== 'object' || !('command' in detail)) return null;
  const command: unknown = detail.command;
  return typeof command === 'string' && (DFHT_COMMANDS as readonly string[]).includes(command)
    ? (command as DfhtCommand)
    : null;
}

/** Gửi một lệnh (tiện cho bridge / test). */
export function dispatchDfhtCommand(command: DfhtCommand, target: Window = window): void {
  target.dispatchEvent(
    new CustomEvent<DfhtCommandDetail>(DFHT_COMMAND_EVENT, { detail: { command } }),
  );
}

export type DfhtCommandHandlers = Partial<Record<DfhtCommand, () => void>>;

/**
 * Nghe `dfht:command` trên window. Handler đọc qua ref (đổi identity mỗi render không gắn lại
 * listener); `enabled: false` = bỏ qua lệnh (vd. đang mở hộp thoại).
 */
export function useDfhtCommands(handlers: DfhtCommandHandlers, enabled = true): void {
  const ref = useRef(handlers);
  const enabledRef = useRef(enabled);
  useLayoutEffect(() => {
    ref.current = handlers;
    enabledRef.current = enabled;
  });
  useEffect(() => {
    const onCommand = (e: Event): void => {
      if (!enabledRef.current) return;
      const command = readDfhtCommand(e);
      if (command === null) return;
      ref.current[command]?.();
    };
    window.addEventListener(DFHT_COMMAND_EVENT, onCommand);
    return () => window.removeEventListener(DFHT_COMMAND_EVENT, onCommand);
  }, []);
}

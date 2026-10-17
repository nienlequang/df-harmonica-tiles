import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  DFHT_COMMAND_EVENT,
  DFHT_COMMANDS,
  dispatchDfhtCommand,
  readDfhtCommand,
  useDfhtCommands,
} from './commands';

describe('readDfhtCommand', () => {
  it('đọc lệnh hợp lệ, còn lại null', () => {
    for (const c of DFHT_COMMANDS) {
      expect(readDfhtCommand(new CustomEvent(DFHT_COMMAND_EVENT, { detail: { command: c } }))).toBe(
        c,
      );
    }
    expect(DFHT_COMMANDS).toEqual(['toggle', 'restart', 'nextLine', 'prevLine']);
    const bad: unknown[] = [null, 'toggle', { command: 'play' }, { command: 1 }, {}, [], undefined];
    for (const detail of bad) {
      expect(readDfhtCommand(new CustomEvent(DFHT_COMMAND_EVENT, { detail }))).toBeNull();
    }
    expect(readDfhtCommand(new Event(DFHT_COMMAND_EVENT))).toBeNull();
  });
});

describe('useDfhtCommands', () => {
  it('gọi handler theo lệnh; enabled=false bỏ qua; gỡ listener khi unmount', () => {
    const toggle = vi.fn();
    const restart = vi.fn();
    const { rerender, unmount } = renderHook(
      ({ enabled }: { enabled: boolean }) => useDfhtCommands({ toggle, restart }, enabled),
      { initialProps: { enabled: true } },
    );
    act(() => dispatchDfhtCommand('toggle'));
    act(() => dispatchDfhtCommand('restart'));
    act(() => dispatchDfhtCommand('nextLine')); // không có handler: bỏ qua
    expect(toggle).toHaveBeenCalledTimes(1);
    expect(restart).toHaveBeenCalledTimes(1);
    rerender({ enabled: false });
    act(() => dispatchDfhtCommand('toggle'));
    expect(toggle).toHaveBeenCalledTimes(1);
    rerender({ enabled: true });
    act(() => dispatchDfhtCommand('toggle'));
    expect(toggle).toHaveBeenCalledTimes(2);
    unmount();
    act(() => dispatchDfhtCommand('toggle'));
    expect(toggle).toHaveBeenCalledTimes(2);
  });

  it('handler mới nhất được dùng (không gắn lại listener)', () => {
    const a = vi.fn();
    const b = vi.fn();
    const add = vi.spyOn(window, 'addEventListener');
    const { rerender } = renderHook(
      ({ fn }: { fn: () => void }) => useDfhtCommands({ toggle: fn }),
      {
        initialProps: { fn: a },
      },
    );
    rerender({ fn: b });
    act(() => dispatchDfhtCommand('toggle'));
    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledTimes(1);
    expect(add.mock.calls.filter(([type]) => type === DFHT_COMMAND_EVENT)).toHaveLength(1);
  });
});

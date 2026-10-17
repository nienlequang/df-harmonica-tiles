import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getAudioEngine } from '../audio/engine';
import { FakeAudioContext } from '../audio/fakeAudioContext';
import { MelodyConfirmDialog, useMelodyToggle } from './MelodyConfirm';
import type { MelodyToggle } from './MelodyConfirm';
import { useSettings } from './settings';

/** Cầm kết quả hook để gọi từ test; render kèm hộp thoại như nơi dùng thật. */
let api: MelodyToggle;
function Harness({ apply }: { apply?: (on: boolean) => void }) {
  api = useMelodyToggle(apply);
  return (
    <>
      <span data-testid="state">{api.on ? 'on' : 'off'}</span>
      <MelodyConfirmDialog open={api.confirmOpen} onCancel={api.cancel} onConfirm={api.confirm} />
    </>
  );
}

const DIALOG = 'Bật phát giai điệu mẫu?';

beforeEach(() => {
  act(() => useSettings.getState().reset());
});

describe('useMelodyToggle + MelodyConfirmDialog (dùng chung Cài đặt và màn chơi)', () => {
  it('toggle khi tắt → chỉ mở hộp cảnh báo; Hủy giữ tắt; "Tôi hiểu, bật" bật', () => {
    render(<Harness />);
    act(() => api.toggle());
    const dialog = screen.getByRole('dialog', { name: DIALOG });
    expect(useSettings.getState().audioEnabled).toBe(false);
    act(() => fireEvent.click(within(dialog).getByRole('button', { name: 'Hủy' })));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(useSettings.getState().audioEnabled).toBe(false);

    act(() => api.toggle());
    act(() => fireEvent.click(screen.getByRole('button', { name: 'Tôi hiểu, bật' })));
    expect(useSettings.getState().audioEnabled).toBe(true);
    expect(screen.getByTestId('state').textContent).toBe('on');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('toggle khi bật → tắt ngay, không hỏi; request(true) khi đã bật → không hỏi lại', () => {
    act(() => useSettings.getState().set({ audioEnabled: true }));
    render(<Harness />);
    act(() => api.request(true));
    expect(screen.queryByRole('dialog')).toBeNull();
    act(() => api.toggle());
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(useSettings.getState().audioEnabled).toBe(false);
  });

  it('apply riêng (màn chơi = engine.setAudioEnabled) được gọi cho cả bật lẫn tắt', () => {
    const apply = vi.fn((on: boolean) => useSettings.getState().set({ audioEnabled: on }));
    render(<Harness apply={apply} />);
    act(() => api.toggle());
    expect(apply).not.toHaveBeenCalled(); // chỉ mở hộp
    act(() => api.confirm());
    expect(apply).toHaveBeenLastCalledWith(true);
    act(() => api.toggle());
    expect(apply).toHaveBeenLastCalledWith(false);
    expect(useSettings.getState().audioEnabled).toBe(false);
  });

  it('chữ hộp thoại: cảnh báo bản quyền, tiếng Anh theo ngôn ngữ', () => {
    act(() => useSettings.getState().set({ language: 'en' }));
    render(<Harness />);
    act(() => api.toggle());
    const dialog = screen.getByRole('dialog', { name: 'Turn on the sample melody?' });
    expect(dialog.textContent).toContain('YouTube / Facebook / TikTok');
    expect(within(dialog).getByRole('button', { name: 'I understand, turn on' })).toBeTruthy();
    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Cancel' }));
  });
});

describe('useMelodyToggle — mặc định (Cài đặt) mở khóa âm thanh trong cú bấm "Tôi hiểu, bật" (D-423)', () => {
  afterEach(() => {
    getAudioEngine().dispose();
    vi.unstubAllGlobals();
  });

  it('confirm → AudioContext tạo + resume ngay; request(false) / cancel không tạo', () => {
    const created: FakeAudioContext[] = [];
    class StubCtx extends FakeAudioContext {
      constructor() {
        super({ state: 'suspended' });
        created.push(this);
      }
    }
    vi.stubGlobal('AudioContext', StubCtx);
    render(<Harness />);
    act(() => api.toggle());
    act(() => api.cancel());
    act(() => api.request(false));
    expect(created).toHaveLength(0);
    act(() => api.toggle());
    act(() => fireEvent.click(screen.getByRole('button', { name: 'Tôi hiểu, bật' })));
    expect(useSettings.getState().audioEnabled).toBe(true);
    expect(created).toHaveLength(1);
    expect(created[0].resumeCalls).toBe(1);
    expect(getAudioEngine().ready).toBe(true);
  });

  it('không có Web Audio → bật vẫn chạy, không lỗi', () => {
    vi.stubGlobal('AudioContext', undefined);
    render(<Harness />);
    act(() => api.toggle());
    act(() => api.confirm());
    expect(useSettings.getState().audioEnabled).toBe(true);
    expect(getAudioEngine().context).toBeNull();
  });
});

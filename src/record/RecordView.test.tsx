/**
 * Màn "Tự chơi để tạo bài" (#/record): timer + performance.now giả, phím / chuột / chạm mô phỏng
 * bằng sự kiện DOM (attachPracticeInput thật), canvas không vẽ (getContext → null).
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import { AudioEngine, getAudioEngine } from '../audio/engine';
import { FakeAudioContext } from '../audio/fakeAudioContext';
import { installFakeAudioSession } from '../audio/fakePlaybackEnv';
import { getSong, isDraftSong, useLibrary } from '../library/store';
import type * as Router from '../ui/router';
import { navigate, parseLocation, paths } from '../ui/router';
import { useSettings } from '../ui/settings';
import { useToasts } from '../ui/toast';
import { RECORD_START_LEAD_SEC, RECORD_TICK_MS, RecordView, parseRecordBpm } from './RecordView';

vi.mock('../ui/router', async (importOriginal) => ({
  ...(await importOriginal<typeof Router>()),
  navigate: vi.fn(),
}));

const btn = (name: string | RegExp) => screen.getByRole('button', { name });
const readout = () => document.querySelector('.rec-readout')?.textContent ?? '';
const surface = () =>
  screen.getByRole('group', { name: 'Khung thu: giữ chuột trong khung này làm modifier' });

/** Tiến đồng hồ (timer + performance) tới performance-ms `t`. */
function advanceTo(t: number) {
  const dt = t - performance.now();
  if (dt > 0) act(() => vi.advanceTimersByTime(dt));
}

function setBpm(bpm: number) {
  fireEvent.change(screen.getByLabelText('Tempo (BPM)'), { target: { value: String(bpm) } });
}

/** Bấm Thu / Thu lại (tiếng click tắt → đếm vào bằng hình ngay); trả performance-ms của beat 0. */
function startTake(bpm: number, beatsPerBar = 4): number {
  const t0 = performance.now();
  fireEvent.click(btn(/^Thu( lại)?$/));
  return t0 + (RECORD_START_LEAD_SEC + (beatsPerBar * 60) / bpm) * 1000;
}

function key(type: 'keydown' | 'keyup', code: string, k = code.replace(/^Key/, '').toLowerCase()) {
  act(() => {
    window.dispatchEvent(
      new KeyboardEvent(type, { code, key: k, bubbles: true, cancelable: true }),
    );
  });
}

function mouse(type: 'pointerdown' | 'pointerup', button: number, buttons: number) {
  act(() => {
    (type === 'pointerdown' ? surface() : window).dispatchEvent(
      new PointerEvent(type, { button, buttons, pointerType: 'mouse', bubbles: true }),
    );
  });
}

/** Phần dòng nốt của `.harm`. */
function body(harm: string): string[] {
  return harm.split('\n').filter((l) => l !== '' && !l.startsWith('@') && !l.startsWith('#'));
}

const songs = () => useLibrary.getState().songs;

/** Id bản nháp mà lần navigate gần nhất mở trong Editor ("Mở trong Editor" không lưu vào thư viện). */
function openedId(): string {
  const target = vi.mocked(navigate).mock.calls.at(-1)?.[0] ?? '';
  expect(target.startsWith('/edit/')).toBe(true);
  return decodeURIComponent(target.slice('/edit/'.length));
}
const openedSource = () => getSong(openedId())?.source ?? '';

beforeEach(() => {
  vi.useFakeTimers({
    toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'performance', 'Date'],
  });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => null);
  useLibrary.setState({ songs: [] });
  useToasts.setState({ toasts: [] });
});

afterEach(() => {
  getAudioEngine().dispose();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  useSettings.getState().reset();
  window.history.replaceState(null, '', '/');
});

describe('route + helpers', () => {
  it('#/record → route record; paths.record()', () => {
    expect(paths.record()).toBe('/record');
    expect(parseLocation('#/record', '').route).toEqual({ name: 'record' });
    expect(parseLocation('#/record/x', '').route).toEqual({
      name: 'not-found',
      path: '/record/x',
    });
  });

  it('parseRecordBpm: 40..200', () => {
    expect(parseRecordBpm('90')).toBe(90);
    expect(parseRecordBpm('40')).toBe(40);
    expect(parseRecordBpm('201')).toBeNull();
    expect(parseRecordBpm('39')).toBeNull();
    expect(parseRecordBpm('')).toBeNull();
    expect(parseRecordBpm('x')).toBeNull();
  });

  it('App: #/record hiện màn thu (tải lười) trong khung app có thanh điều hướng', async () => {
    vi.useRealTimers();
    window.history.replaceState(null, '', '#/record');
    render(<App />);
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Tự chơi để tạo bài' }),
    ).toBeTruthy();
    expect(screen.getByRole('navigation', { name: /./ })).toBeTruthy();
  });
});

describe('RecordView — PC', () => {
  it('đếm vào bằng hình, thu phím + modifier, quantize, mở trong Editor', () => {
    render(<RecordView />);
    // mặc định: 90 BPM, 4/4, tiếng phản hồi tắt, nút Thu
    expect((screen.getByLabelText('Tempo (BPM)') as HTMLInputElement).value).toBe('90');
    expect(
      (screen.getByRole('switch', { name: 'Tiếng phản hồi khi bấm' }) as HTMLInputElement).checked,
    ).toBe(false);
    expect(readout()).toBe('Sẵn sàng');
    fireEvent.change(screen.getByLabelText('Tên bài'), { target: { value: 'Bài thử' } });
    setBpm(120);
    const spb = 500;
    const beat0 = startTake(120);
    const at = (beat: number) => advanceTo(beat0 + beat * spb);

    // đếm vào 1 ô nhịp: 4-3-2-1, đèn nhịp
    expect(readout()).toBe('Đếm vào: 4');
    expect(document.querySelector('.rec-countin-num')?.textContent).toBe('4');
    expect(document.activeElement).toBe(btn('Dừng'));
    at(-2.5);
    expect(readout()).toBe('Đếm vào: 3');
    expect(document.querySelectorAll('.rec-lamp.is-on')).toHaveLength(1);
    // phím bấm quá sớm (trước beat 0 − 1/4) bị bỏ
    key('keydown', 'KeyM');
    key('keyup', 'KeyM');

    at(0);
    act(() => vi.advanceTimersByTime(0));
    // beat 0: Z một beat
    key('keydown', 'KeyZ');
    advanceTo(beat0 + RECORD_TICK_MS);
    expect(readout()).toMatch(/^Đang thu · ô nhịp 1 · 0:00$/);
    expect(document.querySelector('.gb-key[data-key="Z"]')?.className).toMatch(/is-pressed/);
    expect(document.querySelector('.gb-key[data-key="Z"]')?.className).toMatch(/is-active/);
    at(0.9);
    key('keyup', 'KeyZ');
    // beat 1: giữ chuột phải TRƯỚC khi bấm X; nhả chuột giữa nốt không đổi nốt
    at(0.95);
    mouse('pointerdown', 2, 2);
    expect(document.querySelector('.gb-mod-right')?.className).toMatch(/is-pressed/);
    at(1);
    key('keydown', 'KeyX');
    at(1.5);
    mouse('pointerup', 2, 0);
    at(1.9);
    key('keyup', 'KeyX');
    // beat 2: C, V bấm khi C còn giữ → cắt C (đơn âm)
    at(2);
    key('keydown', 'KeyC');
    at(2.5);
    key('keydown', 'KeyV');
    at(2.7);
    key('keyup', 'KeyC');
    at(2.9);
    key('keyup', 'KeyV');
    // beat 3: chuột trái + nút cuộn (Nửa Cung) → B quãng thấp, thăng; Shift không còn thay chuột
    mouse('pointerdown', 0, 1);
    key('keydown', 'ShiftLeft', 'Shift');
    mouse('pointerdown', 1, 5);
    at(3);
    key('keydown', 'KeyB');
    at(3.9);
    key('keyup', 'KeyB');
    key('keyup', 'ShiftLeft', 'Shift');
    mouse('pointerup', 1, 1);
    // beat 4: giữ cả trái lẫn phải → lần bấm N bị bỏ
    mouse('pointerup', 0, 0);
    act(() => {
      surface().dispatchEvent(
        new PointerEvent('pointerdown', {
          button: 0,
          buttons: 3,
          pointerType: 'mouse',
          bubbles: true,
        }),
      );
    });
    at(4);
    key('keydown', 'KeyN');
    at(4.3);
    key('keyup', 'KeyN');
    mouse('pointerup', 0, 0);
    // beat 4.5: M nửa beat
    at(4.5);
    key('keydown', 'KeyM');
    at(4.9);
    key('keyup', 'KeyM');
    at(5.6);
    expect(readout()).toMatch(/^Đang thu · ô nhịp 2 · 0:02$/);
    expect(screen.getByRole('img', { name: 'Cuộn nốt đang thu' })).toBeTruthy();

    fireEvent.click(btn('Dừng'));
    expect(readout()).toBe('Sẵn sàng');
    expect(vi.getTimerCount()).toBe(0);
    const result = screen.getByRole('region', { name: 'Bản thu' });
    expect(document.activeElement).toBe(result);
    expect(result.textContent).toContain('6 nốt · 2 ô nhịp · 0:02');
    // Hoàn tác chỉ bật khi có bản thu trước
    expect((btn(/^Hoàn tác/) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(btn('Mở trong Editor'));
    // bản nháp: chưa vào thư viện cho tới khi người dùng Lưu trong Editor
    expect(songs()).toHaveLength(0);
    expect(isDraftSong(openedId())).toBe(true);
    const harm = openedSource();
    expect(harm.startsWith('@title Bài thử\n@bpm 120\n@time 4/4\n')).toBe(true);
    expect(body(harm)).toEqual([
      'Z [giữ chuột phải] X [thả chuột phải] C*0.5 V*0.5 [giữ chuột trái] [giữ scroll] B [thả scroll] [thả chuột trái] _*0.5 M*0.5',
    ]);
    expect(navigate).toHaveBeenCalledWith(paths.edit(openedId()));
    expect(useToasts.getState().toasts).toEqual([]);
  });

  it('Thu lại / Hoàn tác; đổi lưới quantize xem lại bản thu; tên mặc định', () => {
    render(<RecordView />);
    setBpm(120);
    let beat0 = startTake(120);
    // bản 1: Z X C nửa beat mỗi nốt, lệch nhẹ khỏi lưới
    for (const [i, code] of ['KeyZ', 'KeyX', 'KeyC'].entries()) {
      advanceTo(beat0 + (i * 0.5 + 0.06) * 500);
      key('keydown', code);
      advanceTo(beat0 + (i * 0.5 + 0.4) * 500);
      key('keyup', code);
    }
    advanceTo(beat0 + 2000);
    fireEvent.click(btn('Dừng'));
    expect(screen.getByRole('region', { name: 'Bản thu' }).textContent).toContain('3 nốt');

    // bản 2 (Thu lại): một nốt
    beat0 = startTake(120);
    expect(screen.queryByRole('region', { name: 'Bản thu' })).toBeNull();
    advanceTo(beat0 + 10);
    key('keydown', 'KeyV');
    advanceTo(beat0 + 900);
    key('keyup', 'KeyV');
    advanceTo(beat0 + 1200);
    fireEvent.click(btn('Dừng'));
    expect(screen.getByRole('region', { name: 'Bản thu' }).textContent).toContain('1 nốt');

    // Hoàn tác → bản 1
    fireEvent.click(btn(/^Hoàn tác/));
    expect(screen.getByRole('region', { name: 'Bản thu' }).textContent).toContain('3 nốt');
    expect((btn(/^Hoàn tác/) as HTMLButtonElement).disabled).toBe(true);

    // lưới 1/4 beat (mặc định): đầu / cuối nốt về mốc gần nhất
    fireEvent.click(btn('Mở trong Editor'));
    const first = openedId();
    const harm = openedSource();
    expect(harm).toMatch(/^@title Bản thu \d\d:\d\d\n/);
    expect(body(harm)).toEqual(['Z*0.5 X*0.5 C*0.5']);
    // lưới tắt: giữ thời điểm thật (làm tròn 1/1000 beat), khe hở thành rest
    fireEvent.change(screen.getByLabelText('Lưới quantize'), { target: { value: '3' } });
    fireEvent.click(btn('Mở trong Editor'));
    // mỗi lần mở là một bản nháp mới
    expect(openedId()).not.toBe(first);
    expect(songs()).toHaveLength(0);
    expect(body(openedSource())).toEqual(['_*0.06 Z*0.34 _*0.16 X*0.34 _*0.16 C*0.34']);
  });

  it('Dừng trong lúc đếm vào = hủy; bản thu không có nốt → báo, không có kết quả', () => {
    render(<RecordView />);
    const beat0 = startTake(90);
    advanceTo(beat0 - 1000);
    fireEvent.click(btn('Dừng'));
    expect(screen.getByRole('alert').textContent).toBe('Đã hủy: dừng trước khi hết đếm vào.');
    expect(vi.getTimerCount()).toBe(0);

    const b2 = startTake(90);
    // phím trong đếm vào (sớm hơn dung sai) không tính
    advanceTo(b2 - 1500);
    key('keydown', 'KeyZ');
    key('keyup', 'KeyZ');
    advanceTo(b2 + 1000);
    fireEvent.click(btn('Dừng'));
    expect(screen.getByRole('alert').textContent).toBe('Không thu được nốt nào.');
    expect(screen.queryByRole('region', { name: 'Bản thu' })).toBeNull();
  });

  it('chỉ nhận phím khi đang đếm vào / thu; ô nhập tên bài không bị nuốt phím', () => {
    render(<RecordView />);
    key('keydown', 'KeyZ');
    expect(document.querySelector('.gb-key.is-pressed')).toBeNull();
    const beat0 = startTake(90);
    advanceTo(beat0 + 100);
    const title = screen.getByLabelText('Tên bài');
    title.focus();
    act(() => {
      title.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyX', key: 'x', bubbles: true }));
    });
    expect(document.querySelector('.gb-key.is-pressed')).toBeNull();
    title.blur();
    key('keydown', 'KeyX');
    expect(document.querySelector('.gb-key[data-key="X"]')?.className).toMatch(/is-pressed/);
  });

  it('ghi chú focus; không còn phím thay chuột / cảnh báo Ctrl+N', () => {
    render(<RecordView />);
    expect(screen.getByText(/Chỉ nhận phím khi tab đang được chọn/)).toBeTruthy();
    expect(screen.queryByText(/Ctrl \+ N/)).toBeNull();
    expect(screen.queryByText(/Phím thay thế/)).toBeNull();
  });

  it('tiếng phản hồi: chỉ khi bật toggle của màn này; unlock trong cú bấm', async () => {
    class Stub extends FakeAudioContext {
      constructor(o?: unknown) {
        super({ state: 'running' }, o);
      }
    }
    vi.stubGlobal('AudioContext', Stub);
    const preview = vi.spyOn(AudioEngine.prototype, 'playPreview');
    const unlock = vi.spyOn(AudioEngine.prototype, 'unlock');
    render(<RecordView />);
    // tắt (mặc định): không mở âm thanh, không phát
    let beat0 = startTake(120);
    expect(unlock).not.toHaveBeenCalled();
    advanceTo(beat0 + 10);
    key('keydown', 'KeyZ');
    key('keyup', 'KeyZ');
    expect(preview).not.toHaveBeenCalled();
    fireEvent.click(btn('Dừng'));

    await act(async () => {
      fireEvent.click(screen.getByRole('switch', { name: 'Tiếng phản hồi khi bấm' }));
    });
    expect(useSettings.getState().practiceFeedback).toBe(false); // không đổi Cài đặt
    beat0 = startTake(120);
    expect(unlock).toHaveBeenCalled();
    await act(async () => {
      await Promise.resolve();
    });
    advanceTo(beat0 + 10);
    act(() => {
      surface().dispatchEvent(
        new PointerEvent('pointerdown', {
          button: 2,
          buttons: 2,
          pointerType: 'mouse',
          bubbles: true,
        }),
      );
    });
    key('keydown', 'KeyZ');
    // Z quãng cao (phải) = C5 = 72
    expect(preview).toHaveBeenCalledTimes(1);
    expect(preview.mock.calls[0][0]).toBe(72);
    key('keyup', 'KeyZ');
    fireEvent.click(btn('Dừng'));
  });

  it('iPhone (D-426): giữ phiên "playback" TRƯỚC resume() khi màn này có tiếng; trả khi hết tiếng / rời màn; tắt tiếng thì không đụng gì', async () => {
    class Stub extends FakeAudioContext {
      constructor(o?: unknown) {
        super({ state: 'suspended' }, o);
      }
    }
    vi.stubGlobal('AudioContext', Stub);
    let resumesAtSet = -1;
    const session = installFakeAudioSession('auto', (type) => {
      if (type !== 'playback') return;
      const ctx = getAudioEngine().context as unknown as FakeAudioContext | null;
      resumesAtSet = ctx?.resumeCalls ?? -1;
    });
    try {
      // Mặc định (click + tiếng phản hồi tắt): thu một lượt không đụng tới gì.
      const quiet = render(<RecordView />);
      await act(async () => {
        fireEvent.click(btn(/^Thu( lại)?$/));
      });
      fireEvent.click(btn('Dừng'));
      quiet.unmount();
      expect(session.log).toEqual([]);
      expect(getAudioEngine().context).toBeNull();

      const view = render(<RecordView />);
      const feedbackSwitch = () => screen.getByRole('switch', { name: 'Tiếng phản hồi khi bấm' });
      await act(async () => {
        fireEvent.click(feedbackSwitch());
      });
      expect(session.type).toBe('playback');
      expect(resumesAtSet).toBe(0); // đặt trước resume(), cùng cú bấm
      await act(async () => {
        fireEvent.click(feedbackSwitch());
      });
      expect(session.type).toBe('auto');

      // Tiếng click: Thu → giữ; Dừng (tiếng phản hồi tắt) → trả.
      useSettings.getState().set({ clickSound: true });
      await act(async () => {
        fireEvent.click(btn(/^Thu( lại)?$/));
        await Promise.resolve();
      });
      expect(session.type).toBe('playback');
      await act(async () => {
        fireEvent.click(btn('Dừng'));
      });
      expect(session.type).toBe('auto');

      // Rời màn khi đang bật tiếng phản hồi → trả.
      await act(async () => {
        fireEvent.click(feedbackSwitch());
      });
      expect(session.type).toBe('playback');
      view.unmount();
      expect(session.type).toBe('auto');
      expect(session.log).toEqual(['playback', 'auto', 'playback', 'auto', 'playback', 'auto']);
    } finally {
      session.restore();
    }
  });

  it('rời trang lúc đang thu / khi còn bản thu: hỏi trước; Ở lại thì vẫn thu', () => {
    window.history.replaceState(null, '', '#/record');
    render(
      <>
        <a href="#/library">Thư viện</a>
        <RecordView />
      </>,
    );
    setBpm(120);
    const beat0 = startTake(120);
    advanceTo(beat0 + 10);
    const link = () => screen.getByRole('link', { name: 'Thư viện', hidden: true });
    fireEvent.click(link());
    let dialog = screen.getByRole('dialog', { name: 'Rời màn thu?' });
    expect(dialog.textContent).toMatch(/Đang thu\./);
    fireEvent.click(screen.getByRole('button', { name: 'Ở lại' }));
    expect(window.location.hash).toBe('#/record');
    key('keydown', 'KeyZ');
    advanceTo(beat0 + 400);
    key('keyup', 'KeyZ');
    expect(readout()).toMatch(/^Đang thu/);
    fireEvent.click(btn('Dừng'));

    fireEvent.click(link());
    dialog = screen.getByRole('dialog', { name: 'Rời màn thu?' });
    expect(dialog.textContent).toMatch(/chưa lưu/);
    fireEvent.click(screen.getByRole('button', { name: 'Bỏ và rời đi' }));
    expect(window.location.hash).toBe('#/library');
  });

  it('unmount lúc đang thu: gỡ mọi listener / timer, không lưu', () => {
    const add = vi.spyOn(window, 'addEventListener');
    const remove = vi.spyOn(window, 'removeEventListener');
    const { unmount } = render(<RecordView />);
    const beat0 = startTake(120);
    advanceTo(beat0 + 10);
    key('keydown', 'KeyZ');
    unmount();
    expect(vi.getTimerCount()).toBe(0);
    const count = (spy: typeof add) => {
      const m = new Map<string, number>();
      for (const [type] of spy.mock.calls) m.set(type, (m.get(type) ?? 0) + 1);
      return m;
    };
    const added = count(add);
    const removed = count(remove);
    for (const type of ['keydown', 'keyup', 'pointerup', 'blur', 'beforeunload', 'hashchange']) {
      expect(removed.get(type) ?? 0, type).toBe(added.get(type) ?? 0);
    }
    expect(added.get('keydown')).toBeGreaterThan(0);
    // phím sau khi rời màn không làm gì (không lỗi)
    key('keyup', 'KeyZ');
    expect(songs()).toHaveLength(0);
  });
});

describe('RecordView — Mobile', () => {
  const digit = (k: string) =>
    document.querySelector(`.rec-pad-digit[data-key="${k}"]`) as HTMLButtonElement;
  const tap = (k: string, from: number, to: number, leave = false) => {
    advanceTo(from);
    fireEvent.pointerDown(digit(k), { pointerType: 'touch', button: 0 });
    advanceTo(to);
    if (leave) fireEvent.pointerLeave(digit(k), { pointerType: 'touch' });
    else fireEvent.pointerUp(digit(k), { pointerType: 'touch', button: 0 });
  };

  it('8 nút số + 4 nút chế độ (thứ tự game); chế độ quãng giữ trạng thái; Nửa Cung 1 nốt', () => {
    useSettings.getState().set({ controlScheme: 'mobile', mobileSemitone: 'oneShot' });
    render(<RecordView />);
    const modes = screen.getByRole('group', { name: 'Chế độ (chạm để chọn)' });
    expect(Array.from(modes.querySelectorAll('button')).map((b) => b.textContent)).toEqual([
      'Nửa Cung',
      'Ngẩng Lên',
      'Ngẩng Tự Nhiên',
      'Cúi Xuống',
    ]);
    expect(document.querySelectorAll('.rec-pad-digit')).toHaveLength(8);
    // không có game bar PC, không gắn phím
    expect(document.querySelector('.game-bar')).toBeNull();
    expect(screen.queryByText(/Ctrl \+ N/)).toBeNull();
    expect(btn('Ngẩng Tự Nhiên').getAttribute('aria-pressed')).toBe('true');

    setBpm(120);
    const beat0 = startTake(120);
    const at = (beat: number) => beat0 + beat * 500;
    // phím số trên bàn phím KHÔNG kích hoạt nút
    advanceTo(at(0));
    key('keydown', 'KeyZ');
    key('keydown', 'Digit1', '1');
    expect(digit('Z').className).not.toMatch(/is-pressed/);

    fireEvent.click(btn('Ngẩng Lên'));
    expect(btn('Ngẩng Lên').getAttribute('aria-pressed')).toBe('true');
    tap('Z', at(0), at(0.9));
    // vẫn Ngẩng Lên (giữ trạng thái); Nửa Cung chỉ áp nốt kế tiếp
    fireEvent.click(btn('Nửa Cung'));
    expect(btn('Nửa Cung').getAttribute('aria-pressed')).toBe('true');
    advanceTo(at(1));
    fireEvent.pointerDown(digit('X'), { pointerType: 'touch', button: 0 });
    expect(digit('X').className).toMatch(/is-pressed/);
    expect(digit('X').className).toMatch(/rec-tone-right/);
    expect(btn('Nửa Cung').getAttribute('aria-pressed')).toBe('false');
    advanceTo(at(1.9));
    fireEvent.pointerUp(digit('X'), { pointerType: 'touch', button: 0 });
    tap('C', at(2), at(2.9), true); // kéo ngón ra khỏi nút = nhả
    fireEvent.click(btn('Cúi Xuống'));
    tap('V', at(3), at(3.4));
    advanceTo(at(4.2));
    fireEvent.click(btn('Dừng'));
    // chế độ đã chọn không mất sau khi dừng (như game)
    expect(btn('Cúi Xuống').getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(btn('Mở trong Editor'));
    expect(body(openedSource())).toEqual([
      '[giữ chuột phải] Z [giữ scroll] X [thả scroll] C [thả chuột phải] [giữ chuột trái] V*0.5 [thả chuột trái]',
    ]);
  });

  it("Nửa Cung 'toggle' giữ trạng thái tới lần chạm lại", () => {
    useSettings.getState().set({ controlScheme: 'mobile', mobileSemitone: 'toggle' });
    render(<RecordView />);
    setBpm(120);
    const beat0 = startTake(120);
    fireEvent.click(btn('Nửa Cung'));
    tap('Z', beat0, beat0 + 450);
    tap('X', beat0 + 500, beat0 + 950);
    expect(btn('Nửa Cung').getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(btn('Nửa Cung'));
    tap('C', beat0 + 1000, beat0 + 1450);
    advanceTo(beat0 + 1600);
    fireEvent.click(btn('Dừng'));
    fireEvent.click(btn('Mở trong Editor'));
    expect(body(openedSource())).toEqual(['[giữ scroll] Z X [thả scroll] C']);
  });
});

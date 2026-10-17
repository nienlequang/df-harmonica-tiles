/**
 * "Thu melody" (spec §6b B Dùng 2) qua MidiImportView: MidiInputManager giả, AudioContext giả,
 * timer + performance.now giả. OptimizerPanel được thay bằng bản giả tối thiểu.
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getAudioEngine } from '../audio/engine';
import { FakeAudioContext } from '../audio/fakeAudioContext';
import type { Placement } from '../core/optimizer';
import { getSong, isDraftSong, useLibrary } from '../library/store';
import type * as Router from '../ui/router';
import { navigate } from '../ui/router';
import { useSettings } from '../ui/settings';
import { MidiImportView } from './MidiImportView';
import {
  audioToPerfMs,
  parseRecordBpm,
  RECORD_START_LEAD_SEC,
  RECORD_TICK_MS,
} from './RecordPanel';
import type { LiveMidiEvent, MidiInputInfo } from './types';
import type { MidiEnableResult } from './webmidi';

vi.mock('../ui/router', async (importOriginal) => ({
  ...(await importOriginal<typeof Router>()),
  navigate: vi.fn(),
}));
vi.mock('../ui/features', () => ({
  FEATURES: { editor: true, share: false, midiImport: true },
}));
vi.mock('../editor/OptimizerPanel', () => ({
  OptimizerPanel: (props: { value: Placement | null }) => (
    <p data-testid="fake-optimizer">{`t=${props.value?.transpose ?? 'none'}`}</p>
  ),
}));

const fake = vi.hoisted(() => {
  class FakeMidiManager {
    enabled = false;
    selectedId: string | null = null;
    enableResult: MidiEnableResult = 'ok';
    enableCalls = 0;
    devices: MidiInputInfo[] = [
      { id: 'kb1', name: 'Keyboard', manufacturer: 'ACME', state: 'connected' },
    ];
    readonly events = new Set<(e: LiveMidiEvent) => void>();
    readonly deviceCbs = new Set<() => void>();
    readonly activityCbs = new Set<() => void>();
    get connected(): boolean {
      return (
        this.enabled &&
        this.devices.some((d) => d.id === this.selectedId && d.state === 'connected')
      );
    }
    enable(): Promise<MidiEnableResult> {
      this.enableCalls++;
      if (this.enableResult === 'ok') {
        this.enabled = true;
        this.deviceCbs.forEach((cb) => cb());
      }
      return Promise.resolve(this.enableResult);
    }
    inputs(): MidiInputInfo[] {
      return this.enabled ? this.devices.map((d) => ({ ...d })) : [];
    }
    select(id: string | null): void {
      this.selectedId = id;
    }
    onEvent(cb: (e: LiveMidiEvent) => void): () => void {
      this.events.add(cb);
      return () => this.events.delete(cb);
    }
    onDevicesChange(cb: () => void): () => void {
      this.deviceCbs.add(cb);
      return () => this.deviceCbs.delete(cb);
    }
    onActivity(cb: () => void): () => void {
      this.activityCbs.add(cb);
      return () => this.activityCbs.delete(cb);
    }
    emit(e: LiveMidiEvent): void {
      if (e.type === 'on') this.activityCbs.forEach((cb) => cb());
      this.events.forEach((cb) => cb(e));
    }
    listenerCount(): number {
      return this.events.size + this.deviceCbs.size + this.activityCbs.size;
    }
  }
  return { FakeMidiManager, manager: new FakeMidiManager(), supported: true };
});
vi.mock('./webmidi', () => ({
  getMidiInputManager: () => fake.manager,
  isWebMidiSupported: () => fake.supported,
}));

const contexts: FakeAudioContext[] = [];
/** AudioContext giả mới nhất (tạo khi engine unlock). */
const audio = (): FakeAudioContext | null => contexts.at(-1) ?? null;

function installAudio() {
  class Stub extends FakeAudioContext {
    constructor(o?: unknown) {
      super({ state: 'running' }, o);
      contexts.push(this);
    }
  }
  vi.stubGlobal('AudioContext', Stub);
}

/** Tiến cả đồng hồ timer/performance lẫn đồng hồ audio. */
function advance(ms: number) {
  act(() => {
    audio()?.advance(ms / 1000);
    vi.advanceTimersByTime(ms);
  });
}

const btn = (name: string | RegExp) => screen.getByRole('button', { name });
const phase = () => document.querySelector('.midi-phase')?.textContent ?? '';

async function openRecordTab() {
  render(<MidiImportView />);
  fireEvent.click(screen.getByRole('tab', { name: 'Thu melody' }));
  await act(async () => {
    fireEvent.click(btn('Bật MIDI'));
  });
}

function setBpm(bpm: number) {
  fireEvent.change(screen.getByLabelText('Tempo (BPM)'), { target: { value: String(bpm) } });
}

/** Tiến tới ngay sau beat 0 (qua ít nhất một tick). */
function toBeat0(beat0: number) {
  advance(beat0 - performance.now() + RECORD_TICK_MS + 10);
}

/** Bấm Thu; trả performance-ms của beat 0 (bpm đã đặt trong ô, 4/4). */
async function startTake(bpm: number): Promise<number> {
  const t0 = performance.now();
  await act(async () => {
    fireEvent.click(btn(/^Thu( lại)?$/));
  });
  return t0 + (RECORD_START_LEAD_SEC + (4 * 60) / bpm) * 1000;
}

function play(beat0: number, spbMs: number, list: ReadonlyArray<[beat: number, midi: number]>) {
  act(() => {
    for (const [beat, midi] of list) {
      const on = beat0 + beat * spbMs;
      fake.manager.emit({ type: 'on', midi, velocity: 90, timeStamp: on, inputId: 'kb1' });
      fake.manager.emit({
        type: 'off',
        midi,
        velocity: 0,
        timeStamp: on + spbMs * 0.9,
        inputId: 'kb1',
      });
    }
  });
}

beforeEach(() => {
  vi.useFakeTimers({
    toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'performance', 'Date'],
  });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => null);
  fake.manager = new fake.FakeMidiManager();
  fake.supported = true;
  contexts.length = 0;
  useLibrary.setState({ songs: [] });
});

afterEach(() => {
  getAudioEngine().dispose();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  useSettings.getState().reset();
});

describe('RecordPanel helpers', () => {
  it('parseRecordBpm', () => {
    expect(parseRecordBpm('120')).toBe(120);
    expect(parseRecordBpm('')).toBeNull();
    expect(parseRecordBpm('10')).toBeNull();
    expect(parseRecordBpm('abc')).toBeNull();
  });

  it('audioToPerfMs: dùng getOutputTimestamp nếu có, không thì ước lượng theo latency', () => {
    const withTs = {
      currentTime: 5,
      getOutputTimestamp: () => ({ contextTime: 4.9, performanceTime: 1000 }),
    } as unknown as AudioContext;
    expect(audioToPerfMs(withTs, 0)(5.9)).toBeCloseTo(2000);
    const noTs = {
      currentTime: 2,
      outputLatency: 0.05,
      baseLatency: 0.01,
    } as unknown as AudioContext;
    expect(audioToPerfMs(noTs, 500)(3)).toBeCloseTo(500 + 1060);
    const zeroTs = {
      currentTime: 1,
      getOutputTimestamp: () => ({ contextTime: 0, performanceTime: 0 }),
    } as unknown as AudioContext;
    expect(audioToPerfMs(zeroTs, 100)(2)).toBeCloseTo(1100);
  });
});

describe('Thu melody', () => {
  it('bật MIDI, nhớ thiết bị, đếm vào có click (clickSound bật), thu, Thu lại / Hoàn tác, ra Editor', async () => {
    installAudio();
    useSettings.getState().set({ clickSound: true });
    await openRecordTab();
    expect(fake.manager.enableCalls).toBe(1);
    expect(useSettings.getState().midiEnabled).toBe(true);
    // tự chọn thiết bị đầu tiên đang cắm + nhớ
    expect(useSettings.getState().midiInputId).toBe('kb1');
    expect(fake.manager.selectedId).toBe('kb1');
    expect((screen.getByLabelText('Thiết bị MIDI') as HTMLSelectElement).value).toBe('kb1');
    expect(screen.getByText('Đã kết nối: Keyboard')).toBeTruthy();

    // đèn báo nốt
    act(() =>
      fake.manager.emit({ type: 'on', midi: 60, velocity: 1, timeStamp: 0, inputId: 'kb1' }),
    );
    expect(document.querySelector('.midi-activity.is-on')).toBeTruthy();
    advance(200);
    expect(document.querySelector('.midi-activity.is-on')).toBeNull();

    setBpm(120);
    const spb = 500;
    const beat0 = await startTake(120);
    expect(phase()).toBe('Đếm vào: 1');
    // đang thu: khóa đổi tab
    expect((screen.getByRole('tab', { name: 'Từ file' }) as HTMLButtonElement).disabled).toBe(true);
    // click đếm vào đầu tiên (accent) đã lên lịch trên bus click
    const clicks = () => audio()?.bufferSources() ?? [];
    expect(clicks()).toHaveLength(1);
    expect(audio()?.filters()[0].frequency.value).toBe(3200);
    advance(1150);
    expect(phase()).toBe('Đếm vào: 3');
    expect(clicks().length).toBe(3);

    // hết đếm vào → đang thu
    toBeat0(beat0);
    expect(phase()).toBe('Đang thu · ô nhịp 1 · 0:00');
    expect(performance.now() - beat0).toBeLessThan(1000);
    play(beat0, spb, [
      [0, 60],
      [1, 62],
      [2, 64],
      [3, 65],
    ]);
    advance(2100);
    expect(phase()).toBe('Đang thu · ô nhịp 2 · 0:02');
    expect(screen.getByRole('img', { name: 'Piano roll đang thu' })).toBeTruthy();
    // metronome tiếp tục trong lúc thu
    expect(clicks().length).toBeGreaterThanOrEqual(8);

    fireEvent.click(btn('Dừng'));
    expect(screen.getByText('Bản thu: 4 nốt · 120 BPM · nhịp 4/4')).toBeTruthy();
    expect((screen.getByRole('tab', { name: 'Từ file' }) as HTMLButtonElement).disabled).toBe(
      false,
    );
    expect((btn(/^Hoàn tác/) as HTMLButtonElement).disabled).toBe(true);
    // click chưa phát bị hủy khi dừng
    expect(vi.getTimerCount()).toBe(0);

    // Thu lại: bản mới 2 nốt
    const beat0b = await startTake(120);
    toBeat0(beat0b);
    play(beat0b, spb, [
      [0, 67],
      [1, 69],
    ]);
    advance(1200);
    fireEvent.click(btn('Dừng'));
    expect(screen.getByText('Bản thu: 2 nốt · 120 BPM · nhịp 4/4')).toBeTruthy();

    // Hoàn tác → bản 4 nốt
    fireEvent.click(btn(/^Hoàn tác/));
    expect(screen.getByText('Bản thu: 4 nốt · 120 BPM · nhịp 4/4')).toBeTruthy();

    // bước 4–5 dùng chung với file MIDI
    fireEvent.click(btn('Tiếp'));
    expect(screen.getByRole('heading', { level: 2, name: 'Chọn cung và quãng' })).toBeTruthy();
    expect(screen.getByTestId('fake-optimizer').textContent).toBe('t=0');
    fireEvent.click(btn('Tiếp'));
    expect(screen.getByRole('heading', { level: 2, name: 'Xem trước và tạo bài' })).toBeTruthy();
    const text = screen.getByLabelText('Xem trước .harm').textContent ?? '';
    expect(text).toContain('@title Bản thu MIDI');
    expect(text).toContain('@bpm 120');
    expect(text).toContain('Z X C V');

    // quay về bước thu: bản thu vẫn còn
    fireEvent.click(btn('Quay lại'));
    fireEvent.click(btn('Quay lại'));
    expect(screen.getByText('Bản thu: 4 nốt · 120 BPM · nhịp 4/4')).toBeTruthy();
    fireEvent.click(btn('Tiếp'));
    fireEvent.click(btn('Tiếp'));
    fireEvent.click(btn('Mở trong Editor'));
    // bản nháp trong Editor — chưa vào thư viện cho tới khi Lưu
    expect(useLibrary.getState().songs).toHaveLength(0);
    const target = vi.mocked(navigate).mock.calls.at(-1)?.[0] ?? '';
    expect(target.startsWith('/edit/')).toBe(true);
    const draftId = decodeURIComponent(target.slice('/edit/'.length));
    expect(isDraftSong(draftId)).toBe(true);
    expect(getSong(draftId)?.source).toBe(text);
  });

  it('mặc định không có tiếng nào: không tạo AudioContext, không click, đếm vào chỉ bằng hình', async () => {
    installAudio();
    // kể cả khi giai điệu / tiếng phản hồi Luyện tập đều tắt (mặc định) — SPEC 2026-10-14
    await openRecordTab();
    const metro = screen.getByRole('switch', {
      name: 'Metronome trong lúc thu',
    }) as HTMLInputElement;
    expect(metro.checked).toBe(false);
    expect(metro.disabled).toBe(true);
    expect(screen.getByText(/Tiếng click bật ở Cài đặt → Âm thanh/)).toBeTruthy();
    setBpm(120);
    const beat0 = await startTake(120);
    // không chờ âm thanh: vào đếm ngay, không báo lỗi âm thanh
    expect(phase()).toBe('Đếm vào: 1');
    expect(screen.queryByRole('alert')).toBeNull();
    advance(1150);
    expect(phase()).toBe('Đếm vào: 3');
    toBeat0(beat0);
    play(beat0, 500, [
      [0, 60],
      [1, 62],
    ]);
    advance(2100);
    expect(phase()).toBe('Đang thu · ô nhịp 2 · 0:02');
    expect(contexts).toHaveLength(0);
    fireEvent.click(btn('Dừng'));
    expect(screen.getByText('Bản thu: 2 nốt · 120 BPM · nhịp 4/4')).toBeTruthy();
    expect(contexts).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('clickSound bật: toggle Metronome dùng được; tắt thì chỉ đếm vào có click', async () => {
    installAudio();
    useSettings.getState().set({ clickSound: true });
    await openRecordTab();
    const metro = screen.getByRole('switch', {
      name: 'Metronome trong lúc thu',
    }) as HTMLInputElement;
    expect(metro.checked).toBe(true);
    expect(metro.disabled).toBe(false);
    expect(screen.getByText(/Tiếng click metronome đang bật/)).toBeTruthy();
    fireEvent.click(metro);
    expect(metro.checked).toBe(false);
    setBpm(120);
    const beat0 = await startTake(120);
    toBeat0(beat0);
    advance(2000);
    // chỉ 4 click đếm vào, không click nào khi thu
    expect(audio()?.bufferSources() ?? []).toHaveLength(4);
    fireEvent.click(btn('Dừng'));
  });

  it('nốt chơi sớm trong đếm vào bị bỏ; Dừng lúc đếm vào = hủy, không có bản thu', async () => {
    installAudio();
    await openRecordTab();
    const beat0 = await startTake(90);
    advance(500);
    // nốt trong đếm vào (sớm hơn 1/4 beat) + Dừng trước beat 0
    play(beat0, 60000 / 90, [[-2, 60]]);
    fireEvent.click(btn('Dừng'));
    expect(screen.queryByText(/^Bản thu:/)).toBeNull();
    expect(btn('Thu')).toBeTruthy();
    advance(200); // đèn báo nốt tắt
    expect(vi.getTimerCount()).toBe(0);

    // bản thu chỉ có nốt đếm vào → không thu được nốt nào
    const b2 = await startTake(90);
    play(b2, 60000 / 90, [[-2, 60]]);
    advance(b2 - performance.now() + 1000);
    fireEvent.click(btn('Dừng'));
    expect(screen.getByRole('alert').textContent).toBe('Không thu được nốt nào.');
  });

  it('tiếng phản hồi: toggle riêng (không lưu, mặc định tắt), phát synth khi bấm, tắt khi nhả', async () => {
    installAudio();
    // practiceFeedback của Luyện tập không ảnh hưởng màn này
    useSettings.getState().set({ timbre: 'sine', practiceFeedback: true });
    await openRecordTab();
    const toggle = () => screen.getByRole('switch', { name: /Tiếng phản hồi/ }) as HTMLInputElement;
    expect(toggle().checked).toBe(false);
    expect(screen.getByText(/Đừng bật khi đang stream/)).toBeTruthy();
    expect(contexts).toHaveLength(0);
    fireEvent.click(toggle());
    expect(toggle().checked).toBe(true);
    // bật trong gesture → mở khóa âm thanh ngay; không ghi vào settings
    expect(contexts).toHaveLength(1);
    expect(useSettings.getState().practiceFeedback).toBe(true);
    useSettings.getState().set({ practiceFeedback: false });
    expect(toggle().checked).toBe(true);
    const beat0 = await startTake(120);
    // click tắt (mặc định): không lên lịch click nào
    expect(audio()?.bufferSources() ?? []).toHaveLength(0);
    toBeat0(beat0);
    expect(audio()?.bufferSources() ?? []).toHaveLength(0);
    const before = audio()?.oscillators().length ?? 0;
    act(() =>
      fake.manager.emit({ type: 'on', midi: 64, velocity: 80, timeStamp: beat0, inputId: 'kb1' }),
    );
    const oscs = audio()?.oscillators() ?? [];
    expect(oscs.length).toBe(before + 1);
    const planned = oscs.at(-1)?.stopTime ?? 0;
    advance(100);
    act(() =>
      fake.manager.emit({
        type: 'off',
        midi: 64,
        velocity: 0,
        timeStamp: beat0 + 100,
        inputId: 'kb1',
      }),
    );
    expect(oscs.at(-1)?.stopTime ?? Infinity).toBeLessThan(planned);
    fireEvent.click(btn('Dừng'));
  });

  it('click bật nhưng không có âm thanh: báo, đếm vào bằng hình, vẫn thu được', async () => {
    vi.stubGlobal('AudioContext', undefined);
    useSettings.getState().set({ clickSound: true });
    await openRecordTab();
    const beat0 = await startTake(90);
    expect(screen.getByRole('alert').textContent).toBe(
      'Không bật được âm thanh — chỉ đếm vào bằng hình.',
    );
    toBeat0(beat0);
    play(beat0, 60000 / 90, [
      [0, 60],
      [1, 64],
    ]);
    advance(1500);
    fireEvent.click(btn('Dừng'));
    expect(screen.getByText('Bản thu: 2 nốt · 90 BPM · nhịp 4/4')).toBeTruthy();
  });

  it('unmount lúc đang thu: gỡ listener MIDI, xóa timer, hủy click chưa phát', async () => {
    installAudio();
    useSettings.getState().set({ clickSound: true });
    const { unmount } = render(<MidiImportView />);
    fireEvent.click(screen.getByRole('tab', { name: 'Thu melody' }));
    await act(async () => {
      fireEvent.click(btn('Bật MIDI'));
    });
    expect(fake.manager.listenerCount()).toBeGreaterThan(0);
    setBpm(120);
    await startTake(120);
    advance(480);
    const click = audio()?.bufferSources().at(-1);
    // click kế tiếp đã lên lịch nhưng chưa phát
    expect(click?.startTime ?? 0).toBeGreaterThan(audio()?.currentTime ?? Infinity);
    unmount();
    expect(fake.manager.listenerCount()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    expect(click?.stopTime).toBe(click?.startTime);
  });

  it('thiết bị đã nhớ được chọn lại; đổi thiết bị lưu vào settings; rút ra thì báo', async () => {
    useSettings.getState().set({ midiEnabled: true, midiInputId: 'kb2' });
    fake.manager.devices.push({ id: 'kb2', name: 'Piano', manufacturer: '', state: 'connected' });
    render(<MidiImportView />);
    fireEvent.click(screen.getByRole('tab', { name: 'Thu melody' }));
    // midiEnabled đã bật trong Settings → tự bật khi mở tab
    await act(async () => {});
    expect(fake.manager.enableCalls).toBe(1);
    expect(fake.manager.selectedId).toBe('kb2');
    expect(screen.getByText('Đã kết nối: Piano')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Thiết bị MIDI'), { target: { value: 'kb1' } });
    expect(useSettings.getState().midiInputId).toBe('kb1');
    expect(fake.manager.selectedId).toBe('kb1');

    act(() => {
      fake.manager.devices[0].state = 'disconnected';
      fake.manager.deviceCbs.forEach((cb) => cb());
    });
    expect(screen.getByText('Thiết bị đã chọn chưa được cắm')).toBeTruthy();
    expect((btn('Thu') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('Chọn và cắm thiết bị MIDI để thu.')).toBeTruthy();
  });

  it('bị từ chối quyền → báo, bấm lại được; không hỗ trợ → 1 dòng giải thích', async () => {
    fake.manager.enableResult = 'denied';
    await openRecordTab();
    expect(screen.getByRole('alert').textContent).toMatch(/từ chối quyền MIDI/);
    expect((btn('Bật MIDI') as HTMLButtonElement).disabled).toBe(false);
    expect(useSettings.getState().midiEnabled).toBe(false);
  });

  it('trình duyệt không có Web MIDI', () => {
    fake.supported = false;
    render(<MidiImportView />);
    fireEvent.click(screen.getByRole('tab', { name: 'Thu melody' }));
    expect(screen.getByText(/Trình duyệt này không hỗ trợ Web MIDI/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Bật MIDI' })).toBeNull();
    expect(fake.manager.enableCalls).toBe(0);
  });

  it('đổi ngôn ngữ giữa lúc thu không làm mất bản thu', async () => {
    installAudio();
    await openRecordTab();
    setBpm(120);
    const beat0 = await startTake(120);
    toBeat0(beat0);
    play(beat0, 500, [
      [0, 60],
      [1, 62],
    ]);
    act(() => useSettings.getState().set({ language: 'en' }));
    advance(1200);
    expect(phase()).toMatch(/^Recording · bar 1 · 0:01$/);
    fireEvent.click(btn('Stop'));
    expect(screen.getByText('Take: 2 notes · 120 BPM · 4/4 time')).toBeTruthy();
  });

  it('mỗi tick cập nhật đồng hồ thu', async () => {
    installAudio();
    await openRecordTab();
    setBpm(60);
    const beat0 = await startTake(60);
    toBeat0(beat0);
    advance(13_000);
    expect(phase()).toBe('Đang thu · ô nhịp 4 · 0:13');
    // bpm / nhịp khóa trong lúc thu
    expect((screen.getByLabelText('Tempo (BPM)') as HTMLInputElement).disabled).toBe(true);
    fireEvent.click(btn('Dừng'));
    expect(screen.getByRole('alert').textContent).toBe('Không thu được nốt nào.');
  });

  it('tab ẩn không tự chọn thiết bị; chọn "— Chọn thiết bị —" thì giữ nguyên', async () => {
    // Cài đặt đã bật MIDI trong phiên này (quyền đã cấp), chưa chọn thiết bị
    fake.manager.enabled = true;
    useSettings.getState().set({ midiEnabled: true, midiInputId: null });
    render(<MidiImportView />);
    await act(async () => {});
    // đang ở tab "Từ file": RecordPanel (vẫn mount) không chọn / nhớ thiết bị nào
    expect(fake.manager.selectedId).toBeNull();
    expect(useSettings.getState().midiInputId).toBeNull();

    // mở tab Thu → chọn thiết bị đầu tiên đang cắm (D-138)
    fireEvent.click(screen.getByRole('tab', { name: 'Thu melody' }));
    expect(fake.manager.selectedId).toBe('kb1');
    expect(useSettings.getState().midiInputId).toBe('kb1');

    // chủ động bỏ chọn → không tự chọn lại, kể cả khi danh sách thiết bị cập nhật
    const select = () => screen.getByLabelText('Thiết bị MIDI') as HTMLSelectElement;
    fireEvent.change(select(), { target: { value: '' } });
    act(() => {
      fake.manager.devices.push({ id: 'kb2', name: 'Piano', manufacturer: '', state: 'connected' });
      fake.manager.deviceCbs.forEach((cb) => cb());
    });
    expect(select().value).toBe('');
    expect(fake.manager.selectedId).toBeNull();
    expect(useSettings.getState().midiInputId).toBeNull();
    expect(screen.getByText('Chưa chọn thiết bị')).toBeTruthy();
  });

  it('MIDI đã tắt trong Cài đặt: không gắn thiết bị đã nhớ, phải bấm "Bật MIDI"', async () => {
    // quyền đã cấp trong phiên, rồi người dùng tắt MIDI ở Cài đặt (select(null), nhớ midiInputId)
    fake.manager.enabled = true;
    useSettings.getState().set({ midiEnabled: false, midiInputId: 'kb1' });
    render(<MidiImportView />);
    fireEvent.click(screen.getByRole('tab', { name: 'Thu melody' }));
    await act(async () => {});
    expect(fake.manager.selectedId).toBeNull();
    expect(screen.queryByText('Đã kết nối: Keyboard')).toBeNull();
    expect(screen.queryByLabelText('Thiết bị MIDI')).toBeNull();
    expect((btn('Thu') as HTMLButtonElement).disabled).toBe(true);

    await act(async () => {
      fireEvent.click(btn('Bật MIDI'));
    });
    expect(useSettings.getState().midiEnabled).toBe(true);
    expect(fake.manager.selectedId).toBe('kb1');
    expect(screen.getByText('Đã kết nối: Keyboard')).toBeTruthy();
  });

  it('rời trang lúc đang thu / khi có bản thu: hỏi trước, Ở lại thì vẫn thu tiếp', async () => {
    installAudio();
    window.history.replaceState(null, '', '#/midi');
    render(
      <>
        <a href="#/">Thư viện</a>
        <MidiImportView />
      </>,
    );
    fireEvent.click(screen.getByRole('tab', { name: 'Thu melody' }));
    await act(async () => {
      fireEvent.click(btn('Bật MIDI'));
    });
    setBpm(120);
    const beat0 = await startTake(120);
    toBeat0(beat0);
    const link = () => screen.getByRole('link', { name: 'Thư viện', hidden: true });

    fireEvent.click(link());
    let dialog = screen.getByRole('dialog', { name: 'Rời trang tạo bài?' });
    expect(dialog.textContent).toMatch(/Đang thu melody/);
    fireEvent.click(screen.getByRole('button', { name: 'Ở lại' }));
    expect(window.location.hash).toBe('#/midi');
    play(beat0, 500, [
      [0, 60],
      [1, 62],
    ]);
    advance(1500);
    expect(phase()).toMatch(/^Đang thu/);
    fireEvent.click(btn('Dừng'));
    expect(screen.getByText(/^Bản thu: 2 nốt/)).toBeTruthy();

    // có bản thu (chưa thành bài) → vẫn hỏi
    fireEvent.click(link());
    dialog = screen.getByRole('dialog', { name: 'Rời trang tạo bài?' });
    expect(dialog.textContent).toMatch(/chưa được lưu/);
    fireEvent.click(screen.getByRole('button', { name: 'Bỏ và rời đi' }));
    expect(window.location.hash).toBe('#/');
    window.history.replaceState(null, '', '/');
  });
});

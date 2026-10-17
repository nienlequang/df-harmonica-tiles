/**
 * PlayerEngine + practice mode + đếm ngược trước khi phát. Clock tay (ManualClock), rAF chạy tay,
 * input thật qua practiceInput.ts (KeyboardEvent trên window) hoặc gọi thẳng handlePracticeInput.
 * Web MIDI giả (vi.mock) để kiểm tra đường MIDI → practice có transpose.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getAudioEngine } from '../audio/engine';
import { FakeAudioContext } from '../audio/fakeAudioContext';
import { AudioScheduler } from '../audio/scheduler';
import { buildTimeline } from '../core/timeline';
import type { Note, NoteKey, Octave, Song, Timeline } from '../core/types';
import type { LiveMidiEvent } from '../midi/types';
import { useSettings } from '../ui/settings';
import { useToasts } from '../ui/toast';
import { createManualClock } from './clock';
import type { ManualClock } from './clock';
import { PRACTICE_NOTE_STATE } from './practice';
import { TilesRenderer } from './renderer';
import { PlayerEngine } from './usePlayerEngine';

// Web MIDI giả: chỉ bật khi test đặt supported = true.
const midi = vi.hoisted(() => {
  const listeners = new Set<(e: LiveMidiEvent) => void>();
  const deviceListeners = new Set<() => void>();
  const state = {
    supported: false,
    enabled: true,
    /** Thiết bị đã chọn đang cắm. */
    plugged: true,
    enableResult: 'ok' as 'ok' | 'denied' | 'unsupported',
    selected: null as string | null,
    enableCalls: 0,
    selectCalls: [] as (string | null)[],
  };
  const devicesChanged = () => {
    for (const cb of Array.from(deviceListeners)) cb();
  };
  const manager = {
    get enabled() {
      return state.enabled;
    },
    get connected() {
      return state.enabled && state.plugged && state.selected !== null;
    },
    get selectedId() {
      return state.selected;
    },
    enable: async () => {
      state.enableCalls++;
      await Promise.resolve(); // như requestMIDIAccess thật: kết quả về sau
      if (state.enableResult !== 'ok') return state.enableResult;
      state.enabled = true;
      devicesChanged();
      return 'ok' as const;
    },
    select: (id: string | null) => {
      state.selectCalls.push(id);
      state.selected = id;
    },
    onEvent: (cb: (e: LiveMidiEvent) => void) => {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    onDevicesChange: (cb: () => void) => {
      deviceListeners.add(cb);
      return () => {
        deviceListeners.delete(cb);
      };
    },
  };
  return { listeners, deviceListeners, devicesChanged, state, manager };
});
vi.mock('../midi/webmidi', () => ({
  isWebMidiSupported: () => midi.state.supported,
  getMidiInputManager: () => midi.manager,
}));

// ---------------------------------------------------------------------------
// Bài test: 120 BPM (0.5 s/beat), 4/4.
//   line0 [0,4)  Z X C V
//   line1 [4,8)  R:N R:N _*2     (N quãng trên: cần chuột phải / phím Alt)
//   line2 [8,12) S:V Z*3
// ---------------------------------------------------------------------------

const n = (key: NoteKey, beats = 1, octave: Octave = 0, sharp = false): Note => ({
  kind: 'note',
  key,
  octave,
  sharp,
  beats,
});

const SONG: Song = {
  id: 't',
  title: 'T',
  bpm: 120,
  timeSig: { num: 4, den: 4 },
  scrollDir: 1,
  sections: [
    {
      name: 'A',
      lines: [
        { units: [n('Z'), n('X'), n('C'), n('V')] },
        { units: [n('N', 1, 1), n('N', 1, 1), { kind: 'rest', beats: 2 }] },
        { units: [n('V', 1, 0, true), n('Z', 3)] },
      ],
    },
  ],
};

const TL: Timeline = buildTimeline(SONG);

let frames = new Map<number, FrameRequestCallback>();
let nextFrame = 1;
const raf = vi.fn((cb: FrameRequestCallback) => {
  const id = nextFrame++;
  frames.set(id, cb);
  return id;
});
const caf = vi.fn((id: number) => {
  frames.delete(id);
});
function flushFrames(count = 1): void {
  for (let i = 0; i < count; i++) {
    const list = Array.from(frames.values());
    frames.clear();
    for (const cb of list) cb(0);
  }
}

let clock: ManualClock;
let engines: PlayerEngine[] = [];
let stage: HTMLDivElement;

function makeEngine(): PlayerEngine {
  const e = new PlayerEngine(TL, SONG.bpm, { clock });
  engines.push(e);
  e.attach({ canvas: null, stage });
  return e;
}

/** Tiến clock tới `sec` giây sau mốc ban đầu (100) rồi chạy 1 frame. */
function at(sec: number): void {
  clock.set(100 + sec);
  flushFrames();
}

function key(type: 'keydown' | 'keyup', code: string, k = code): KeyboardEvent {
  const e = new KeyboardEvent(type, { code, key: k, bubbles: true, cancelable: true });
  window.dispatchEvent(e);
  return e;
}
const tap = (code: string, k = code): void => {
  key('keydown', code, k);
  key('keyup', code, k);
};

/** Giữ / nhả chuột phải trên khu tiles (Ngẩng Lên) — không còn phím bàn phím thay chuột. */
function rightMouse(down: boolean): void {
  const init = { bubbles: true, cancelable: true, pointerType: 'mouse', button: 2 };
  if (down) stage.dispatchEvent(new PointerEvent('pointerdown', { ...init, buttons: 2 }));
  else window.dispatchEvent(new PointerEvent('pointerup', { ...init, buttons: 0 }));
}

const practice = (e: PlayerEngine) => {
  const p = e.getState().practice;
  if (!p) throw new Error('practice is off');
  return p;
};

beforeEach(() => {
  frames = new Map();
  nextFrame = 1;
  vi.stubGlobal('requestAnimationFrame', raf);
  vi.stubGlobal('cancelAnimationFrame', caf);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => null);
  useSettings.getState().reset();
  // mặc định v4 đếm ngược 3 giây — các test cần phát ngay (test đếm ngược tự đặt giá trị)
  useSettings.getState().set({ audioEnabled: false, countIn: false, startDelaySec: 0 });
  useToasts.setState({ toasts: [] });
  clock = createManualClock(100);
  stage = document.createElement('div');
  document.body.appendChild(stage);
  midi.state.supported = false;
  midi.state.enabled = true;
  midi.state.plugged = true;
  midi.state.enableResult = 'ok';
  midi.state.selected = null;
  midi.state.enableCalls = 0;
  midi.state.selectCalls = [];
  midi.listeners.clear();
  midi.deviceListeners.clear();
});

afterEach(() => {
  for (const e of engines) e.detach();
  engines = [];
  stage.remove();
  getAudioEngine().dispose();
  vi.unstubAllGlobals();
});

describe('practice — bật / tắt', () => {
  it('toggling attaches and detaches every listener (no leaks)', () => {
    const add = vi.spyOn(window, 'addEventListener');
    const remove = vi.spyOn(window, 'removeEventListener');
    const docAdd = vi.spyOn(document, 'addEventListener');
    const docRemove = vi.spyOn(document, 'removeEventListener');
    const stageAdd = vi.spyOn(stage, 'addEventListener');
    const stageRemove = vi.spyOn(stage, 'removeEventListener');
    const e = makeEngine();
    const before = add.mock.calls.length;
    e.setPractice(true);
    expect(add.mock.calls.length).toBeGreaterThan(before);
    expect(stageAdd).toHaveBeenCalled();
    e.setPractice(false);
    e.setPractice(true);
    e.detach(); // gỡ cả khi practice còn bật
    const count = (spy: { mock: { calls: unknown[][] } }, type: string) =>
      spy.mock.calls.filter((c) => c[0] === type).length;
    const windowTypes = ['keydown', 'keyup', 'pointermove', 'pointerup', 'pointercancel', 'blur'];
    for (const type of [...windowTypes, 'contextmenu']) {
      expect({ type, n: count(remove, type) }).toEqual({ type, n: count(add, type) });
    }
    expect(count(docRemove, 'visibilitychange')).toBe(count(docAdd, 'visibilitychange'));
    for (const type of ['pointerdown', 'mousedown', 'contextmenu', 'auxclick', 'selectstart']) {
      expect({ type, n: count(stageRemove, type) }).toEqual({ type, n: count(stageAdd, type) });
    }
    // Sau khi gỡ: phím nốt không còn bị practice chặn.
    expect(key('keydown', 'KeyZ', 'z').defaultPrevented).toBe(false);
  });

  it('exposes practice state only while on; note keys are consumed by practice', () => {
    const e = makeEngine();
    expect(e.getState().practice).toBeNull();
    expect(key('keydown', 'KeyZ', 'z').defaultPrevented).toBe(false);
    key('keyup', 'KeyZ', 'z');
    e.setPractice(true);
    expect(practice(e)).toMatchObject({ mode: 'score', waiting: false, guide: false, wrong: 0 });
    expect(practice(e).score.total).toBe(TL.notes.length);
    expect(key('keydown', 'KeyZ', 'z').defaultPrevented).toBe(true);
    key('keyup', 'KeyZ', 'z');
    e.setPractice(false);
    expect(e.getState().practice).toBeNull();
    expect(e.practiceSession).toBeNull();
  });

  it('Mobile scheme: only the on-screen pad counts — keyboard, mouse modifiers and MIDI are ignored', async () => {
    midi.state.supported = true;
    useSettings
      .getState()
      .set({ controlScheme: 'mobile', midiEnabled: true, midiInputId: 'dev-1' });
    const e = makeEngine();
    e.setPractice(true);
    // Không nghe bàn phím (phím nốt không bị chặn), không nghe MIDI.
    expect(key('keydown', 'KeyZ', 'z').defaultPrevented).toBe(false);
    key('keyup', 'KeyZ', 'z');
    expect(midi.listeners.size).toBe(0);
    expect(practice(e).midi).toBe('off');
    e.play();
    at(0);
    tap('KeyZ', 'z');
    rightMouse(true);
    rightMouse(false);
    expect(practice(e).score.judged).toBe(0);
    expect(practice(e).wrong).toBe(0);
    expect(e.getState().pressed.keys).toEqual([]);
    // Chạm bàn nút (MobilePad → handlePracticeInput) vẫn được chấm.
    const tapDown = {
      type: 'tap-down',
      key: 'Z',
      octave: 0,
      sharp: false,
      source: 'touch',
      pointerId: 1,
      timeStamp: performance.now(),
    } as const;
    expect(e.handlePracticeInput(tapDown)?.kind).toBe('perfect');

    // Đổi sang PC giữa chừng → nghe bàn phím + MIDI lại; đổi về Mobile → bỏ lại.
    useSettings.getState().set({ controlScheme: 'pc' });
    expect(midi.listeners.size).toBe(1);
    expect(key('keydown', 'KeyX', 'x').defaultPrevented).toBe(true);
    key('keyup', 'KeyX', 'x');
    useSettings.getState().set({ controlScheme: 'mobile' });
    expect(midi.listeners.size).toBe(0);
    expect(key('keydown', 'KeyC', 'c').defaultPrevented).toBe(false);
    key('keyup', 'KeyC', 'c');
    await Promise.resolve();
  });

  it('starting practice mid-song only counts the notes from the playhead on', () => {
    const e = makeEngine();
    e.seek(4);
    e.setPractice(true);
    expect(practice(e).score.total).toBe(4); // N N V Z
  });

  it('passes the session note states to the renderer', () => {
    const render = vi.spyOn(TilesRenderer.prototype, 'render');
    const e = new PlayerEngine(TL, SONG.bpm, { clock });
    engines.push(e);
    e.attach({ canvas: document.createElement('canvas'), stage });
    flushFrames();
    const last = () => render.mock.calls[render.mock.calls.length - 1][0];
    expect(last().noteStates ?? null).toBeNull();
    e.setPractice(true);
    flushFrames();
    expect(last().noteStates).toBe(e.practiceSession?.noteStates);
  });
});

describe('practice — chấm điểm', () => {
  it('scores real key presses against the manual clock, misses late notes, ends with results', () => {
    useSettings.getState().set({ practiceMode: 'score' });
    const e = makeEngine();
    e.setPractice(true);
    e.play();
    expect(e.transport.playing).toBe(true);

    // Z ở beat 0: bấm đúng lúc → perfect.
    tap('KeyZ', 'z');
    expect(practice(e).score).toMatchObject({ perfect: 1, combo: 1 });
    expect(practice(e).last).toMatchObject({ kind: 'perfect', deltaMs: 0 });
    expect(e.practiceSession?.noteStates[0]).toBe(PRACTICE_NOTE_STATE.perfect);

    // X ở beat 1 (0.5 s): trễ 150 ms → good.
    at(0.65);
    tap('KeyX', 'x');
    expect(practice(e).score).toMatchObject({ perfect: 1, good: 1, combo: 2 });
    expect(practice(e).last?.kind).toBe('good');
    expect(practice(e).last?.deltaMs).toBeCloseTo(150);

    // Bỏ qua C (beat 2 = 1 s): frame ở 1.25 s (> 220 ms) → miss, mất combo.
    at(1.25);
    expect(practice(e).score).toMatchObject({ miss: 1, combo: 0 });
    expect(practice(e).last?.kind).toBe('miss');

    // Bấm phím không có nốt nào gần → sai.
    tap('KeyM', 'm');
    expect(practice(e).wrong).toBe(1);
    expect(practice(e).last?.kind).toBe('wrong');

    // V đúng lúc (beat 3).
    at(1.5);
    tap('KeyV', 'v');
    expect(practice(e).score.combo).toBe(1);

    // N quãng trên (beat 4): cần giữ chuột phải; Alt không còn thay chuột.
    at(2);
    tap('KeyN', 'n'); // thiếu modifier → sai
    expect(practice(e).wrong).toBe(2);
    key('keydown', 'AltLeft', 'Alt');
    expect(e.getState().pressed.right).toBe(false);
    key('keyup', 'AltLeft', 'Alt');
    rightMouse(true);
    expect(e.getState().pressed.right).toBe(true);
    tap('KeyN', 'n');
    expect(practice(e).score.combo).toBe(1);
    at(2.5);
    tap('KeyN', 'n');
    rightMouse(false);
    expect(e.getState().pressed.right).toBe(false);
    expect(practice(e).score.combo).toBe(2);
    expect(practice(e).results).toBeNull();

    // Hết bài (12 beat = 6 s): nốt còn lại là miss → bảng kết quả.
    at(7);
    expect(e.transport.playing).toBe(false);
    const res = practice(e).results;
    expect(res).not.toBeNull();
    expect(res).toMatchObject({ total: 8, perfect: 4, good: 1, miss: 3, maxCombo: 2 });
    expect(res?.accuracy).toBeCloseTo((4.5 / 8) * 100);
    expect(e.getState().playing).toBe(false);

    // Chơi lại: lượt mới từ đầu.
    e.replayPractice();
    expect(practice(e).results).toBeNull();
    expect(practice(e).score).toMatchObject({ judged: 0, perfect: 0, miss: 0 });
    expect(e.transport.playing).toBe(true);
    expect(e.transport.getBeat()).toBe(0);
  });

  it('an audio clock switch while parked at the end does not reopen dismissed results', () => {
    const e = makeEngine();
    e.setPractice(true);
    e.play();
    at(7);
    expect(practice(e).results).not.toBeNull();
    e.dismissResults();
    expect(practice(e).results).toBeNull();
    // Gián đoạn từ ngoài (vd. gắn audio clock) khi đang đứng ở cuối bài.
    e.transport.setClock(createManualClock(500));
    expect(practice(e).results).toBeNull();
    // Play lại từ cuối bài = lượt mới từ đầu.
    e.play();
    expect(practice(e).score.judged).toBe(0);
    expect(e.transport.getBeat()).toBe(0);
  });

  it('presses while paused are not judged; pause / resume keeps the run', () => {
    const e = makeEngine();
    e.setPractice(true);
    tap('KeyZ', 'z'); // chưa phát
    expect(practice(e).score.judged).toBe(0);
    expect(practice(e).wrong).toBe(0);
    e.play();
    tap('KeyZ', 'z');
    e.pause();
    e.play();
    expect(practice(e).score.perfect).toBe(1);
  });

  it('seek and loop wrap start a fresh run from that point', () => {
    const e = makeEngine();
    e.setPractice(true);
    e.play();
    tap('KeyZ', 'z');
    expect(practice(e).score.perfect).toBe(1);
    e.nextLine(); // seek beat 4
    expect(practice(e).score).toMatchObject({ judged: 0, total: 4 });

    // Loop dòng 1 = [4, 8): wrap → lượt mới tại 4.
    e.cycleLoop();
    e.cycleLoop();
    at(0.05); // beat 4.1 → lệch 50 ms
    rightMouse(true);
    tap('KeyN', 'n');
    rightMouse(false);
    expect(practice(e).score.perfect).toBe(1);
    at(2.05); // 4.1 beat sau → wrap về 4.1
    expect(e.transport.getBeat()).toBeCloseTo(4.1);
    expect(practice(e).score.perfect).toBe(0);
    expect(practice(e).results).toBeNull();
  });

  it('switching mode starts a new run at the current position', () => {
    const e = makeEngine();
    e.setPractice(true);
    e.play();
    tap('KeyZ', 'z');
    useSettings.getState().set({ practiceMode: 'wait' });
    expect(practice(e).mode).toBe('wait');
    expect(practice(e).score.judged).toBe(0);
  });
});

describe('practice — chế độ chờ', () => {
  it('holds the transport exactly at each unplayed note and resumes on the right press', () => {
    useSettings.getState().set({ practiceMode: 'wait' });
    const render = vi.spyOn(TilesRenderer.prototype, 'render');
    const e = new PlayerEngine(TL, SONG.bpm, { clock });
    engines.push(e);
    e.attach({ canvas: document.createElement('canvas'), stage });
    e.setPractice(true);
    e.play();
    flushFrames(); // beat 0 = nốt Z → giữ
    expect(e.transport.playing).toBe(false);
    expect(e.transport.getBeat()).toBe(0);
    expect(e.getState().playing).toBe(true); // UI vẫn coi là đang chơi
    expect(practice(e).waiting).toBe(true);
    expect(e.practiceSession?.noteStates[0]).toBe(PRACTICE_NOTE_STATE.waiting);

    // Chờ bao lâu cũng đứng yên, frame vẫn chạy (tile nhấp nháy).
    at(3);
    expect(frames.size).toBe(1);
    expect(e.transport.getBeat()).toBe(0);
    const calls = render.mock.calls.length;
    at(3.1);
    expect(render.mock.calls.length).toBe(calls + 1);

    tap('KeyX', 'x'); // sai phím
    expect(practice(e).wrong).toBe(1);
    expect(practice(e).waiting).toBe(true);

    tap('KeyZ', 'z');
    expect(practice(e).score).toMatchObject({ perfect: 1, combo: 1 });
    expect(practice(e).waiting).toBe(false);
    expect(e.transport.playing).toBe(true);

    // Frame trễ (beat 1.4) vẫn giữ đúng tại đầu nốt X (beat 1).
    at(3.1 + 0.7);
    expect(e.transport.playing).toBe(false);
    expect(e.transport.getBeat()).toBe(1);
    expect(e.getState().noteIndex).toBe(1);
    tap('KeyX', 'x');
    expect(practice(e).score.combo).toBe(2);
    expect(e.transport.playing).toBe(true);
  });

  it('Space (toggle) while waiting stops the run; Play resumes and holds again', () => {
    useSettings.getState().set({ practiceMode: 'wait' });
    const e = makeEngine();
    e.setPractice(true);
    e.play();
    flushFrames();
    expect(practice(e).waiting).toBe(true);
    e.toggle();
    expect(e.getState().playing).toBe(false);
    expect(practice(e).waiting).toBe(false);
    expect(e.practiceSession?.noteStates[0]).toBe(PRACTICE_NOTE_STATE.none);
    e.toggle();
    flushFrames();
    expect(practice(e).waiting).toBe(true);
  });

  it('seeking while waiting keeps playing from the new point', () => {
    useSettings.getState().set({ practiceMode: 'wait' });
    const e = makeEngine();
    e.setPractice(true);
    e.play();
    flushFrames();
    e.seek(0.5);
    expect(e.transport.playing).toBe(true);
    expect(practice(e).waiting).toBe(false);
  });

  it('turning practice off while waiting just keeps playing', () => {
    useSettings.getState().set({ practiceMode: 'wait' });
    const e = makeEngine();
    e.setPractice(true);
    e.play();
    flushFrames();
    e.setPractice(false);
    expect(e.transport.playing).toBe(true);
    expect(e.getState().practice).toBeNull();
  });

  it('a hit just before the note reaches the hit line does not stop the song', () => {
    useSettings.getState().set({ practiceMode: 'wait' });
    const e = makeEngine();
    e.seek(0.5);
    e.setPractice(true); // nốt X (beat 1) là mục tiêu
    e.play();
    at(0.2); // beat 0.9 → còn 50 ms
    tap('KeyX', 'x');
    expect(practice(e).score.perfect).toBe(1);
    at(0.3); // beat 1.1
    expect(e.transport.playing).toBe(true);
    expect(practice(e).waiting).toBe(false);
  });
});

describe('practice — MIDI', () => {
  it('handlePracticeInput judges MIDI note-ons by pitch (velocity 0 = off)', () => {
    const e = makeEngine();
    e.setPractice(true);
    e.play();
    const ts = performance.now();
    e.handlePracticeInput({
      type: 'midi-on',
      midi: 60,
      velocity: 0,
      source: 'midi',
      timeStamp: ts,
    });
    expect(practice(e).score.judged).toBe(0);
    e.handlePracticeInput({
      type: 'midi-on',
      midi: 60,
      velocity: 80,
      source: 'midi',
      timeStamp: ts,
    });
    expect(practice(e).score.perfect).toBe(1);
    expect(e.getState().pressed.keys).toEqual(['Z']);
    e.handlePracticeInput({
      type: 'midi-off',
      midi: 60,
      velocity: 0,
      source: 'midi',
      timeStamp: ts,
    });
    expect(e.getState().pressed.keys).toEqual([]);
  });

  it('MIDI notes outside the harmonica range are ignored with a light notice (no combo break)', () => {
    const e = makeEngine();
    e.setPractice(true);
    e.play();
    const ts = performance.now();
    const on = (m: number) =>
      e.handlePracticeInput({
        type: 'midi-on',
        midi: m,
        velocity: 80,
        source: 'midi',
        timeStamp: ts,
      });
    on(60); // Z đúng lúc
    expect(practice(e).score.combo).toBe(1);
    on(30); // F#1: ngoài C3..C6
    expect(practice(e).last?.kind).toBe('range');
    expect(practice(e).wrong).toBe(0);
    expect(practice(e).score.combo).toBe(1);
    // Chỉ cần đúng pitch class: quãng nào cũng được chấm (ở đây không khớp nốt nào → sai).
    useSettings.getState().set({ midiPitchClassOnly: true });
    on(31);
    expect(practice(e).wrong).toBe(1);
  });

  it('listens to the selected device only when MIDI is enabled in settings, transposed', async () => {
    midi.state.supported = true;
    midi.state.enabled = false;
    useSettings.getState().set({ midiEnabled: false, midiInputId: 'dev-1' });
    const e = makeEngine();
    e.setPractice(true);
    expect(midi.listeners.size).toBe(0);
    expect(practice(e).midi).toBe('off');

    useSettings.getState().set({ midiEnabled: true, midiTransposeOctaves: 1 });
    expect(midi.listeners.size).toBe(1);
    expect(midi.state.selectCalls).toEqual(['dev-1']);
    expect(midi.state.enableCalls).toBe(1);
    expect(practice(e).midi).toBe('pending');
    await vi.waitFor(() => expect(practice(e).midi).toBe('listening'));

    e.play();
    const emit = (ev: Omit<LiveMidiEvent, 'inputId' | 'timeStamp'>) => {
      for (const cb of Array.from(midi.listeners)) {
        cb({ ...ev, inputId: 'dev-1', timeStamp: performance.now() });
      }
    };
    // C3 trên đàn + 1 quãng = C4 = Z.
    emit({ type: 'on', midi: 48, velocity: 90 });
    expect(practice(e).score.perfect).toBe(1);
    expect(e.getState().pressed.keys).toEqual(['Z']);
    emit({ type: 'off', midi: 48, velocity: 0 });
    // Nốt quãng trên (N +1 = A5 = 81) hiện kèm modifier phải trên game bar.
    emit({ type: 'on', midi: 69, velocity: 90 });
    expect(e.getState().pressed).toMatchObject({ keys: ['N'], right: true });
    emit({ type: 'off', midi: 69, velocity: 0 });
    expect(e.getState().pressed.right).toBe(false);

    e.setPractice(false);
    expect(midi.listeners.size).toBe(0);
    expect(midi.deviceListeners.size).toBe(0);
  });

  it('the HUD MIDI state is the real one: permission denied, device unplugged, hot-plug', async () => {
    midi.state.supported = true;
    midi.state.enabled = false;
    midi.state.enableResult = 'denied';
    useSettings.getState().set({ midiEnabled: true, midiInputId: 'fake-1' });
    const e = makeEngine();
    e.setPractice(true);
    await vi.waitFor(() => expect(practice(e).midi).toBe('denied'));
    e.setPractice(false);

    // Có quyền nhưng thiết bị đã chọn chưa cắm; cắm / rút (statechange) cập nhật ngay.
    midi.state.enableResult = 'ok';
    midi.state.plugged = false;
    e.setPractice(true);
    await vi.waitFor(() => expect(practice(e).midi).toBe('disconnected'));
    midi.state.plugged = true;
    midi.devicesChanged();
    expect(practice(e).midi).toBe('listening');
    midi.state.plugged = false;
    midi.devicesChanged();
    expect(practice(e).midi).toBe('disconnected');

    // Đã có quyền từ trước: trạng thái đúng ngay khi bật practice.
    midi.state.plugged = true;
    e.setPractice(false);
    e.setPractice(true);
    expect(practice(e).midi).toBe('listening');
  });

  it('a late permission answer after practice was turned off is ignored', async () => {
    midi.state.supported = true;
    midi.state.enabled = false;
    useSettings.getState().set({ midiEnabled: true, midiInputId: 'dev-1' });
    const e = makeEngine();
    e.setPractice(true);
    expect(practice(e).midi).toBe('pending');
    e.setPractice(false);
    await vi.waitFor(() => expect(midi.state.enabled).toBe(true));
    expect(e.getState().practice).toBeNull();
    e.setPractice(true);
    expect(practice(e).midi).toBe('listening');
  });
});

describe('practice — loop A-B', () => {
  /** Loop dòng 0 = [0, 4) (Z X C V, 0.5 s mỗi nốt). */
  function loopLine0(e: PlayerEngine): void {
    e.cycleLoop();
    e.cycleLoop();
    expect(e.getState().loop).toEqual({ a: 0, b: 0 });
  }

  /** Vòng 1 bấm đúng cả 4 nốt (chấm điểm). */
  function perfectLap(e: PlayerEngine): void {
    tap('KeyZ', 'z');
    at(0.5);
    tap('KeyX', 'x');
    at(1.0);
    tap('KeyC', 'c');
    at(1.5);
    tap('KeyV', 'v');
    expect(practice(e).score).toMatchObject({ perfect: 4, combo: 4 });
  }

  it('a hit just before the wrap counts for the next lap: no SAI, no MISS', () => {
    const e = makeEngine();
    e.setPractice(true);
    loopLine0(e);
    e.play();
    perfectLap(e);
    at(1.95); // beat 3.9: 50 ms trước Z của vòng 2
    tap('KeyZ', 'z');
    expect(practice(e).last).toMatchObject({ kind: 'perfect' });
    expect(practice(e).last?.deltaMs).toBeCloseTo(-50);
    expect(practice(e).wrong).toBe(0);
    expect(practice(e).score.combo).toBe(4); // vòng 1 giữ nguyên
    const flashSeq = practice(e).last?.seq;
    at(2.0); // wrap
    expect(e.transport.getBeat()).toBeCloseTo(0);
    expect(practice(e).score).toMatchObject({ judged: 1, perfect: 1, miss: 0, combo: 1 });
    expect(e.practiceSession?.noteStates[0]).toBe(PRACTICE_NOTE_STATE.perfect);
    expect(practice(e).last?.seq).toBe(flashSeq); // không nháy lại
    at(2.3); // quá cửa sổ của Z: không miss
    expect(practice(e).score).toMatchObject({ judged: 1, perfect: 1, miss: 0 });
    expect(practice(e).last?.kind).toBe('perfect');
  });

  it('wait mode: the early press is accepted and the song does not hold at Z again', () => {
    useSettings.getState().set({ practiceMode: 'wait' });
    const e = makeEngine();
    e.setPractice(true);
    loopLine0(e);
    e.play();
    tap('KeyZ', 'z');
    for (const [t, code, k] of [
      [0.5, 'KeyX', 'x'],
      [1.0, 'KeyC', 'c'],
      [1.5, 'KeyV', 'v'],
    ] as const) {
      at(t); // tới nốt → giữ bài
      expect(practice(e).waiting).toBe(true);
      tap(code, k);
    }
    expect(practice(e).score.perfect).toBe(4);
    at(1.95);
    tap('KeyZ', 'z');
    expect(practice(e).last?.kind).toBe('perfect');
    expect(practice(e).wrong).toBe(0);
    at(2.0); // wrap
    at(2.3);
    expect(e.transport.playing).toBe(true);
    expect(practice(e).waiting).toBe(false);
    expect(practice(e).score).toMatchObject({ judged: 1, perfect: 1 });
    at(2.5); // X của vòng 2 → giữ
    expect(practice(e).waiting).toBe(true);
    expect(e.transport.getBeat()).toBe(1);
  });

  it('a press after the loop end, before the frame wrapped, is judged in the new lap', () => {
    const e = makeEngine();
    e.setPractice(true);
    loopLine0(e);
    e.play();
    at(1.99); // beat 3.98
    clock.set(102.01); // beat 4.02, chưa có frame nào áp wrap
    tap('KeyZ', 'z');
    expect(practice(e).last).toMatchObject({ kind: 'perfect' });
    expect(practice(e).last?.deltaMs).toBeCloseTo(10);
    expect(practice(e).wrong).toBe(0);
    expect(practice(e).score).toMatchObject({ judged: 1, perfect: 1 });
  });

  it('pausing between the early press and the wrap drops it (not carried into a later lap)', () => {
    const e = makeEngine();
    e.setPractice(true);
    loopLine0(e);
    e.play();
    perfectLap(e);
    at(1.95);
    tap('KeyZ', 'z');
    e.pause();
    e.play();
    at(2.0); // wrap
    expect(practice(e).score.judged).toBe(0);
    at(2.3);
    expect(practice(e).score).toMatchObject({ judged: 1, miss: 1 });
  });
});

describe('practice — giai điệu mẫu', () => {
  it('the scheduler gets a note-less timeline while practicing unless "Hear the melody" is on', async () => {
    class RunningCtx extends FakeAudioContext {
      constructor() {
        super({ state: 'running' });
      }
    }
    vi.stubGlobal('AudioContext', RunningCtx);
    const start = vi.spyOn(AudioScheduler.prototype, 'start');
    const poke = vi.spyOn(AudioScheduler.prototype, 'poke');
    useSettings.getState().set({ audioEnabled: true });
    const e = makeEngine();
    e.play();
    await vi.waitFor(() => expect(e.audioActive).toBe(true));
    const getTimeline = start.mock.calls[start.mock.calls.length - 1][1];
    expect(getTimeline()).toBe(TL);

    e.setPractice(true);
    const silent = getTimeline();
    expect(silent?.notes).toEqual([]);
    expect(silent?.totalBeats).toBe(TL.totalBeats);
    expect(getTimeline()).toBe(silent); // cùng object → scheduler không plan lại vô cớ

    poke.mockClear();
    e.setGuideAudible(true);
    expect(poke).toHaveBeenCalled();
    expect(getTimeline()).toBe(TL);
    expect(practice(e).guide).toBe(true);
    e.setPractice(false);
    expect(getTimeline()).toBe(TL);
  });
});

describe('đếm ngược trước khi phát', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('Play counts N…1 seconds, then starts; the UI shows it as playing', () => {
    useSettings.getState().set({ startDelaySec: 3, countIn: true });
    const e = makeEngine();
    e.play();
    expect(e.getState().countdown).toBe(3);
    expect(e.getState().playing).toBe(true);
    expect(e.transport.playing).toBe(false);
    e.play(); // bấm lại Play trong lúc đếm: không làm gì
    expect(e.getState().countdown).toBe(3);
    vi.advanceTimersByTime(1000);
    expect(e.getState().countdown).toBe(2);
    vi.advanceTimersByTime(1000);
    expect(e.getState().countdown).toBe(1);
    expect(e.transport.playing).toBe(false);
    vi.advanceTimersByTime(1000);
    expect(e.getState().countdown).toBeNull();
    expect(e.transport.playing).toBe(true);
    // Đếm vào vẫn chạy sau đó (0,65 ô nhịp — leadIn.ts, v1.0.1).
    expect(e.transport.countIn).toEqual({ start: -2.6, end: 0 });
  });

  it('toggle (Space) and cancelCountdown (Esc) cancel it; nothing starts later', () => {
    useSettings.getState().set({ startDelaySec: 5 });
    const e = makeEngine();
    e.toggle();
    vi.advanceTimersByTime(2000);
    expect(e.getState().countdown).toBe(3);
    e.toggle();
    expect(e.getState().countdown).toBeNull();
    expect(e.getState().playing).toBe(false);
    vi.advanceTimersByTime(10_000);
    expect(e.transport.playing).toBe(false);

    e.play();
    e.cancelCountdown();
    expect(e.getState().countdown).toBeNull();
    vi.advanceTimersByTime(10_000);
    expect(e.transport.playing).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('Restart stops, rewinds to 0 and counts down again', () => {
    useSettings.getState().set({ startDelaySec: 3 });
    const e = makeEngine();
    e.play();
    vi.advanceTimersByTime(3000);
    at(1);
    expect(e.transport.getBeat()).toBeCloseTo(2);
    e.restart();
    expect(e.transport.playing).toBe(false);
    expect(e.transport.getBeat()).toBe(0);
    expect(e.getState().countdown).toBe(3);
    vi.advanceTimersByTime(3000);
    expect(e.transport.playing).toBe(true);
  });

  it('no delay → plays right away; detach clears the timer', () => {
    const e = makeEngine();
    e.play();
    expect(e.getState().countdown).toBeNull();
    expect(e.transport.playing).toBe(true);
    e.pause();
    useSettings.getState().set({ startDelaySec: 10 });
    e.play();
    expect(vi.getTimerCount()).toBe(1);
    e.detach();
    expect(vi.getTimerCount()).toBe(0);
    expect(e.getState().countdown).toBeNull();
  });
});

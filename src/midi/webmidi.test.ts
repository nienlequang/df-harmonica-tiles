import { describe, expect, it, vi } from 'vitest';
import {
  MidiInputManager,
  getMidiInputManager,
  isWebMidiSupported,
  parseMidiMessage,
} from './webmidi';
import type { LiveMidiEvent } from './types';

// ── Fake Web MIDI (chỉ phần manager dùng) ──

type FakeMessage = { data: Uint8Array; timeStamp: number };

class FakeInput extends EventTarget {
  readonly type = 'input';
  readonly id: string;
  readonly name: string | null;
  readonly manufacturer: string | null;
  state: 'connected' | 'disconnected' = 'connected';
  onmidimessage: ((ev: FakeMessage) => void) | null = null;
  closeCalls = 0;

  constructor(
    id: string,
    name: string | null = `Keyboard ${id}`,
    manufacturer: string | null = 'Acme',
  ) {
    super();
    this.id = id;
    this.name = name;
    this.manufacturer = manufacturer;
  }

  close(): Promise<this> {
    this.closeCalls++;
    return Promise.resolve(this);
  }

  /** Thiết bị gửi 1 message. */
  send(bytes: number[], timeStamp: number): void {
    this.onmidimessage?.({ data: Uint8Array.from(bytes), timeStamp });
  }
}

class FakeAccess extends EventTarget {
  readonly inputs = new Map<string, FakeInput>();
  readonly outputs = new Map<string, unknown>();
  readonly sysexEnabled = false;

  constructor(...inputs: FakeInput[]) {
    super();
    for (const i of inputs) this.inputs.set(i.id, i);
  }

  plug(input: FakeInput): void {
    input.state = 'connected';
    this.inputs.set(input.id, input);
    this.fire(input);
  }

  /** remove = trình duyệt bỏ hẳn cổng khỏi map (kiểu Firefox). */
  unplug(id: string, remove = false): void {
    const input = this.inputs.get(id);
    if (!input) return;
    input.state = 'disconnected';
    if (remove) this.inputs.delete(id);
    this.fire(input);
  }

  fire(port: { type: string } | null): void {
    const ev = new Event('statechange');
    Object.defineProperty(ev, 'port', { value: port });
    this.dispatchEvent(ev);
  }
}

function fakeNav(result: () => Promise<unknown>) {
  const requestMIDIAccess = vi.fn((_opts?: unknown) => result());
  return { nav: { requestMIDIAccess } as unknown as Navigator, requestMIDIAccess };
}

const domError = (name: string): Error => {
  const e = new Error(name);
  e.name = name;
  return e;
};

async function enabledManager(...inputs: FakeInput[]) {
  const access = new FakeAccess(...inputs);
  const { nav, requestMIDIAccess } = fakeNav(() => Promise.resolve(access));
  const mgr = new MidiInputManager(nav);
  expect(await mgr.enable()).toBe('ok');
  return { mgr, access, requestMIDIAccess };
}

const NOTE_ON = 0x90;
const NOTE_OFF = 0x80;

describe('parseMidiMessage', () => {
  it('note on with velocity > 0 → on, any channel', () => {
    expect(parseMidiMessage([NOTE_ON, 60, 100], 12.5, 'a')).toEqual({
      type: 'on',
      midi: 60,
      velocity: 100,
      timeStamp: 12.5,
      inputId: 'a',
    });
    expect(parseMidiMessage([NOTE_ON | 9, 72, 1], 0, 'a')?.type).toBe('on');
  });

  it('note off and note on velocity 0 → off (velocity 0)', () => {
    expect(parseMidiMessage([NOTE_OFF | 3, 60, 64], 5, 'a')).toEqual({
      type: 'off',
      midi: 60,
      velocity: 0,
      timeStamp: 5,
      inputId: 'a',
    });
    expect(parseMidiMessage(Uint8Array.from([NOTE_ON, 60, 0]), 6, 'a')).toEqual({
      type: 'off',
      midi: 60,
      velocity: 0,
      timeStamp: 6,
      inputId: 'a',
    });
  });

  it('ignores everything else', () => {
    expect(parseMidiMessage([0xb0, 64, 127], 0, 'a')).toBeNull(); // sustain CC
    expect(parseMidiMessage([0xe0, 0, 64], 0, 'a')).toBeNull(); // pitch bend
    expect(parseMidiMessage([0xa0, 60, 10], 0, 'a')).toBeNull(); // aftertouch
    expect(parseMidiMessage([0xf8], 0, 'a')).toBeNull(); // clock
    expect(parseMidiMessage([0xfe], 0, 'a')).toBeNull(); // active sensing
    expect(parseMidiMessage([NOTE_ON, 60], 0, 'a')).toBeNull(); // cụt
    expect(parseMidiMessage([60, 100, 0], 0, 'a')).toBeNull(); // không có status byte
    expect(parseMidiMessage(null, 0, 'a')).toBeNull();
  });
});

describe('isWebMidiSupported', () => {
  it('feature-detects navigator.requestMIDIAccess', () => {
    expect(isWebMidiSupported({} as Navigator)).toBe(false);
    expect(isWebMidiSupported(fakeNav(() => Promise.resolve(new FakeAccess())).nav)).toBe(true);
    expect(isWebMidiSupported(undefined)).toBe(isWebMidiSupported(navigator));
  });
});

describe('MidiInputManager — permission', () => {
  it('never requests access until enable() is called', async () => {
    const { nav, requestMIDIAccess } = fakeNav(() => Promise.resolve(new FakeAccess()));
    const mgr = new MidiInputManager(nav);
    mgr.select('x');
    mgr.onEvent(() => {});
    expect(mgr.inputs()).toEqual([]);
    expect(mgr.enabled).toBe(false);
    expect(requestMIDIAccess).not.toHaveBeenCalled();
    expect(await mgr.enable()).toBe('ok');
    expect(requestMIDIAccess).toHaveBeenCalledTimes(1);
    expect(requestMIDIAccess).toHaveBeenCalledWith({ sysex: false });
    expect(mgr.enabled).toBe(true);
    mgr.dispose();
  });

  it('shares one request between concurrent calls and does not ask again once granted', async () => {
    const { nav, requestMIDIAccess } = fakeNav(() => Promise.resolve(new FakeAccess()));
    const mgr = new MidiInputManager(nav);
    const [a, b] = await Promise.all([mgr.enable(), mgr.enable()]);
    expect([a, b]).toEqual(['ok', 'ok']);
    expect(await mgr.enable()).toBe('ok');
    expect(requestMIDIAccess).toHaveBeenCalledTimes(1);
    mgr.dispose();
  });

  it('unsupported browser → "unsupported" without throwing', async () => {
    const mgr = new MidiInputManager({} as Navigator);
    expect(await mgr.enable()).toBe('unsupported');
    expect(mgr.enabled).toBe(false);
    expect(mgr.inputs()).toEqual([]);
  });

  it('permission denied → "denied", and enable() can be retried', async () => {
    let deny = true;
    const access = new FakeAccess(new FakeInput('a'));
    const { nav, requestMIDIAccess } = fakeNav(() =>
      deny ? Promise.reject(domError('NotAllowedError')) : Promise.resolve(access),
    );
    const mgr = new MidiInputManager(nav);
    expect(await mgr.enable()).toBe('denied');
    expect(mgr.enabled).toBe(false);
    deny = false;
    expect(await mgr.enable()).toBe('ok');
    expect(requestMIDIAccess).toHaveBeenCalledTimes(2);
    expect(mgr.inputs().map((i) => i.id)).toEqual(['a']);
    mgr.dispose();
  });

  it('classifies other failures', async () => {
    const reject = (name: string) =>
      new MidiInputManager(fakeNav(() => Promise.reject(domError(name))).nav).enable();
    expect(await reject('SecurityError')).toBe('denied');
    expect(await reject('NotSupportedError')).toBe('unsupported');
    expect(await reject('AbortError')).toBe('denied');
    const throwing = {
      requestMIDIAccess: () => {
        throw domError('SecurityError');
      },
    } as unknown as Navigator;
    expect(await new MidiInputManager(throwing).enable()).toBe('denied');
    const weird = fakeNav(() => Promise.reject('nope')).nav;
    expect(await new MidiInputManager(weird).enable()).toBe('denied');
  });
});

describe('MidiInputManager — devices and events', () => {
  it('lists inputs with connection state and fallbacks for missing names', async () => {
    const a = new FakeInput('a', 'Piano A', 'Yamaha');
    const b = new FakeInput('b', null, null);
    b.state = 'disconnected';
    const { mgr } = await enabledManager(a, b);
    expect(mgr.inputs()).toEqual([
      { id: 'a', name: 'Piano A', manufacturer: 'Yamaha', state: 'connected' },
      { id: 'b', name: 'b', manufacturer: '', state: 'disconnected' },
    ]);
    mgr.dispose();
  });

  it('delivers note on / off (velocity 0 = off) from the selected input with its timestamp', async () => {
    const a = new FakeInput('a');
    const { mgr } = await enabledManager(a);
    const events: LiveMidiEvent[] = [];
    const activity = vi.fn();
    mgr.onEvent((e) => events.push(e));
    mgr.onActivity(activity);
    mgr.select('a');
    expect(mgr.selectedId).toBe('a');
    expect(mgr.connected).toBe(true);
    a.send([NOTE_ON, 60, 90], 1000.25);
    a.send([0xb0, 64, 127], 1001); // CC bỏ qua
    a.send([NOTE_ON, 60, 0], 1200);
    a.send([NOTE_ON | 1, 62, 70], 1300);
    a.send([NOTE_OFF | 1, 62, 40], 1400);
    expect(events).toEqual([
      { type: 'on', midi: 60, velocity: 90, timeStamp: 1000.25, inputId: 'a' },
      { type: 'off', midi: 60, velocity: 0, timeStamp: 1200, inputId: 'a' },
      { type: 'on', midi: 62, velocity: 70, timeStamp: 1300, inputId: 'a' },
      { type: 'off', midi: 62, velocity: 0, timeStamp: 1400, inputId: 'a' },
    ]);
    expect(activity).toHaveBeenCalledTimes(2);
    mgr.dispose();
  });

  it('unsubscribe stops callbacks', async () => {
    const a = new FakeInput('a');
    const { mgr, access } = await enabledManager(a);
    const onEvent = vi.fn();
    const onActivity = vi.fn();
    const onDevices = vi.fn();
    const offs = [mgr.onEvent(onEvent), mgr.onActivity(onActivity), mgr.onDevicesChange(onDevices)];
    mgr.select('a');
    offs.forEach((off) => off());
    a.send([NOTE_ON, 60, 90], 1);
    access.plug(new FakeInput('b'));
    expect(onEvent).not.toHaveBeenCalled();
    expect(onActivity).not.toHaveBeenCalled();
    expect(onDevices).not.toHaveBeenCalled();
    mgr.dispose();
  });

  it('a throwing listener does not block the others', async () => {
    const queued = vi.spyOn(globalThis, 'queueMicrotask').mockImplementation(() => {});
    const a = new FakeInput('a');
    const { mgr } = await enabledManager(a);
    const good = vi.fn();
    mgr.onEvent(() => {
      throw new Error('boom');
    });
    mgr.onEvent(good);
    mgr.select('a');
    a.send([NOTE_ON, 60, 90], 1);
    expect(good).toHaveBeenCalledTimes(1);
    expect(queued).toHaveBeenCalledTimes(1);
    mgr.dispose();
  });

  it('select before enable attaches once access is granted', async () => {
    const a = new FakeInput('a');
    const access = new FakeAccess(a);
    const mgr = new MidiInputManager(fakeNav(() => Promise.resolve(access)).nav);
    const devices = vi.fn();
    mgr.onDevicesChange(devices);
    mgr.select('a');
    expect(mgr.connected).toBe(false);
    await mgr.enable();
    expect(mgr.connected).toBe(true);
    expect(devices).toHaveBeenCalledTimes(1);
    const events = vi.fn();
    mgr.onEvent(events);
    a.send([NOTE_ON, 64, 50], 3);
    expect(events).toHaveBeenCalledTimes(1);
    mgr.dispose();
  });

  it('switching device removes the old handler and closes the old port', async () => {
    const a = new FakeInput('a');
    const b = new FakeInput('b');
    const { mgr } = await enabledManager(a, b);
    const events: LiveMidiEvent[] = [];
    mgr.onEvent((e) => events.push(e));

    mgr.select('a');
    expect(a.onmidimessage).not.toBeNull();
    mgr.select('b');
    expect(a.onmidimessage).toBeNull();
    expect(a.closeCalls).toBe(1);
    expect(b.onmidimessage).not.toBeNull();
    a.send([NOTE_ON, 60, 90], 1);
    b.send([NOTE_ON, 67, 90], 2);
    expect(events.map((e) => [e.inputId, e.midi])).toEqual([['b', 67]]);

    // chọn lại đúng thiết bị đang nghe: không gỡ, không close
    mgr.select('b');
    expect(b.closeCalls).toBe(0);
    expect(b.onmidimessage).not.toBeNull();

    mgr.select(null);
    expect(b.onmidimessage).toBeNull();
    expect(mgr.connected).toBe(false);
    b.send([NOTE_ON, 69, 90], 3);
    expect(events).toHaveLength(1);
    mgr.dispose();
  });

  it('does not clobber a handler someone else installed', async () => {
    const a = new FakeInput('a');
    const { mgr } = await enabledManager(a);
    mgr.select('a');
    const foreign = vi.fn();
    a.onmidimessage = foreign;
    mgr.select(null);
    expect(a.onmidimessage).toBe(foreign);
    mgr.dispose();
  });
});

describe('MidiInputManager — hot-plug', () => {
  it('re-attaches automatically when the selected device is plugged back in', async () => {
    const a = new FakeInput('a');
    const { mgr, access } = await enabledManager(a);
    const devices = vi.fn();
    const events = vi.fn();
    mgr.onDevicesChange(devices);
    mgr.onEvent(events);
    mgr.select('a');

    access.unplug('a');
    expect(devices).toHaveBeenCalledTimes(1);
    expect(mgr.connected).toBe(false);
    expect(a.onmidimessage).toBeNull();
    expect(mgr.inputs()[0].state).toBe('disconnected');
    expect(mgr.selectedId).toBe('a');

    access.plug(a);
    expect(devices).toHaveBeenCalledTimes(2);
    expect(mgr.connected).toBe(true);
    a.send([NOTE_ON, 60, 90], 10);
    expect(events).toHaveBeenCalledTimes(1);
    mgr.dispose();
  });

  it('attaches to a new port object with the same id (port removed then re-added)', async () => {
    const a1 = new FakeInput('a');
    const { mgr, access } = await enabledManager(a1);
    const events = vi.fn();
    mgr.onEvent(events);
    mgr.select('a');
    access.unplug('a', true);
    expect(mgr.inputs()).toEqual([]);
    const a2 = new FakeInput('a');
    access.plug(a2);
    expect(a2.onmidimessage).not.toBeNull();
    a2.send([NOTE_ON, 61, 90], 1);
    a1.send([NOTE_ON, 62, 90], 2);
    expect(events).toHaveBeenCalledTimes(1);
    mgr.dispose();
  });

  it('a device selected before it was ever plugged in attaches when it appears', async () => {
    const { mgr, access } = await enabledManager();
    mgr.select('later');
    expect(mgr.connected).toBe(false);
    const dev = new FakeInput('later');
    access.plug(dev);
    expect(mgr.connected).toBe(true);
    expect(dev.onmidimessage).not.toBeNull();
    mgr.dispose();
  });

  it('plugging other devices notifies but keeps the current attachment', async () => {
    const a = new FakeInput('a');
    const { mgr, access } = await enabledManager(a);
    const devices = vi.fn();
    mgr.onDevicesChange(devices);
    mgr.select('a');
    const handler = a.onmidimessage;
    access.plug(new FakeInput('b'));
    access.fire(null);
    expect(devices).toHaveBeenCalledTimes(2);
    expect(a.onmidimessage).toBe(handler);
    // statechange của cổng output không liên quan
    access.fire({ type: 'output' });
    expect(devices).toHaveBeenCalledTimes(2);
    mgr.dispose();
  });
});

describe('MidiInputManager — dispose and singleton', () => {
  it('dispose removes the message handler, statechange listener and callbacks', async () => {
    const a = new FakeInput('a');
    const { mgr, access } = await enabledManager(a);
    const removeSpy = vi.spyOn(access, 'removeEventListener');
    const devices = vi.fn();
    const events = vi.fn();
    mgr.onDevicesChange(devices);
    mgr.onEvent(events);
    mgr.select('a');

    mgr.dispose();
    expect(a.onmidimessage).toBeNull();
    expect(a.closeCalls).toBe(1);
    expect(removeSpy).toHaveBeenCalledWith('statechange', expect.any(Function));
    expect(mgr.enabled).toBe(false);
    expect(mgr.selectedId).toBeNull();
    expect(mgr.inputs()).toEqual([]);

    access.plug(new FakeInput('b'));
    access.unplug('a');
    access.plug(a);
    a.send([NOTE_ON, 60, 90], 1);
    expect(devices).not.toHaveBeenCalled();
    expect(events).not.toHaveBeenCalled();
    expect(a.onmidimessage).toBeNull();
  });

  it('an enable() still pending at dispose time is discarded', async () => {
    let resolve: (v: unknown) => void = () => {};
    const access = new FakeAccess(new FakeInput('a'));
    const addSpy = vi.spyOn(access, 'addEventListener');
    const mgr = new MidiInputManager(
      fakeNav(
        () =>
          new Promise((r) => {
            resolve = r;
          }),
      ).nav,
    );
    const pending = mgr.enable();
    mgr.select('a');
    mgr.dispose();
    resolve(access);
    await pending;
    expect(mgr.enabled).toBe(false);
    expect(addSpy).not.toHaveBeenCalled();
  });

  it('getMidiInputManager is a lazy singleton that never asks for permission by itself', () => {
    const first = getMidiInputManager();
    expect(getMidiInputManager()).toBe(first);
    expect(first.enabled).toBe(false);
    first.dispose();
    const second = getMidiInputManager();
    expect(second).not.toBe(first);
    second.dispose();
  });
});

import type { LiveMidiEvent, MidiInputInfo } from './types';

/**
 * Web MIDI live input (spec §6b B) — dùng thẳng navigator.requestMIDIAccess, không dep.
 * Chỉ xin quyền khi gọi enable() (user bật MIDI trong Settings), không bao giờ lúc load app.
 */

export type MidiEnableResult = 'ok' | 'denied' | 'unsupported';

function defaultNavigator(): Navigator | undefined {
  return typeof navigator === 'undefined' ? undefined : navigator;
}

/** Trình duyệt có Web MIDI không (Chromium, Firefox 108+; Safari không; chỉ secure context). */
export function isWebMidiSupported(nav: Navigator | undefined = defaultNavigator()): boolean {
  return !!nav && typeof nav.requestMIDIAccess === 'function';
}

/**
 * Chuẩn hóa 1 message MIDI: 0x9n vel>0 → on; 0x8n hoặc 0x9n vel 0 → off (velocity của off luôn 0);
 * mọi thứ khác (CC, pitch bend, clock, sysex…) → null. Mọi kênh đều nhận.
 */
export function parseMidiMessage(
  data: ArrayLike<number> | null | undefined,
  timeStamp: number,
  inputId: string,
): LiveMidiEvent | null {
  if (!data || data.length < 3) return null;
  const status = data[0];
  const cmd = status & 0xf0;
  const midi = data[1] & 0x7f;
  const velocity = data[2] & 0x7f;
  if (cmd === 0x90 && velocity > 0) return { type: 'on', midi, velocity, timeStamp, inputId };
  if (cmd === 0x90 || cmd === 0x80) return { type: 'off', midi, velocity: 0, timeStamp, inputId };
  return null;
}

function classifyError(err: unknown): MidiEnableResult {
  const name =
    err && typeof err === 'object' && 'name' in err && typeof err.name === 'string' ? err.name : '';
  return name === 'NotSupportedError' ? 'unsupported' : 'denied';
}

/** Gọi từng listener; listener lỗi không chặn các listener khác (lỗi được ném lại ở microtask). */
function emit<A extends unknown[]>(listeners: Set<(...args: A) => void>, ...args: A): void {
  for (const cb of [...listeners]) {
    try {
      cb(...args);
    } catch (err) {
      queueMicrotask(() => {
        throw err;
      });
    }
  }
}

function subscribe<T>(set: Set<T>, cb: T): () => void {
  set.add(cb);
  return () => {
    set.delete(cb);
  };
}

export class MidiInputManager {
  private readonly nav: Navigator | undefined;
  private access: MIDIAccess | null = null;
  private pending: Promise<MidiEnableResult> | null = null;
  /** Tăng mỗi lần dispose — kết quả enable() về muộn của "đời" cũ bị bỏ. */
  private generation = 0;
  private selected: string | null = null;
  private attached: MIDIInput | null = null;
  private attachedHandler: ((ev: MIDIMessageEvent) => void) | null = null;
  private readonly eventListeners = new Set<(e: LiveMidiEvent) => void>();
  private readonly deviceListeners = new Set<() => void>();
  private readonly activityListeners = new Set<() => void>();

  constructor(nav?: Navigator) {
    this.nav = nav ?? defaultNavigator();
  }

  /** Xin quyền MIDI (sysex: false). Gọi lặp/đồng thời chỉ xin 1 lần; bị từ chối thì gọi lại được. */
  enable(): Promise<MidiEnableResult> {
    if (this.access) return Promise.resolve('ok');
    if (this.pending) return this.pending;
    const nav = this.nav;
    if (!nav || !isWebMidiSupported(nav)) return Promise.resolve('unsupported');
    const gen = this.generation;
    let request: Promise<MIDIAccess>;
    try {
      request = nav.requestMIDIAccess({ sysex: false });
    } catch (err) {
      return Promise.resolve(classifyError(err));
    }
    const pending = request.then(
      (access): MidiEnableResult => {
        if (gen !== this.generation) return 'ok';
        this.pending = null;
        this.access = access;
        access.addEventListener('statechange', this.onStateChange);
        this.reattach();
        emit(this.deviceListeners);
        return 'ok';
      },
      (err: unknown): MidiEnableResult => {
        if (gen === this.generation) this.pending = null;
        return classifyError(err);
      },
    );
    this.pending = pending;
    return pending;
  }

  /** Đã có MIDIAccess. */
  get enabled(): boolean {
    return this.access !== null;
  }

  /** Thiết bị đã chọn đang cắm và đang nghe. */
  get connected(): boolean {
    return this.attached !== null;
  }

  get selectedId(): string | null {
    return this.selected;
  }

  /** Danh sách input (cả thiết bị vừa rút nếu trình duyệt còn giữ). Rỗng khi chưa enable. */
  inputs(): MidiInputInfo[] {
    const out: MidiInputInfo[] = [];
    this.access?.inputs.forEach((input) => {
      out.push({
        id: input.id,
        name: input.name || input.id,
        manufacturer: input.manufacturer ?? '',
        state: input.state === 'connected' ? 'connected' : 'disconnected',
      });
    });
    return out;
  }

  /** Chọn thiết bị (null = không nghe). Thiết bị chưa cắm thì tự gắn khi nó cắm vào. */
  select(id: string | null): void {
    this.selected = id;
    this.reattach();
  }

  onEvent(cb: (e: LiveMidiEvent) => void): () => void {
    return subscribe(this.eventListeners, cb);
  }

  /** Danh sách / trạng thái thiết bị đổi (statechange, enable xong). */
  onDevicesChange(cb: () => void): () => void {
    return subscribe(this.deviceListeners, cb);
  }

  /** Mỗi note on từ thiết bị đang chọn — cho đèn nháy. */
  onActivity(cb: () => void): () => void {
    return subscribe(this.activityListeners, cb);
  }

  /** Gỡ handler, listener và MIDIAccess; quên lựa chọn. Có thể enable() lại sau đó. */
  dispose(): void {
    this.generation++;
    this.pending = null;
    this.detach(true);
    this.access?.removeEventListener('statechange', this.onStateChange);
    this.access = null;
    this.selected = null;
    this.eventListeners.clear();
    this.deviceListeners.clear();
    this.activityListeners.clear();
    if (singleton === this) singleton = null;
  }

  private readonly onStateChange = (ev: MIDIConnectionEvent): void => {
    if (ev.port && ev.port.type !== 'input') return;
    this.reattach();
    emit(this.deviceListeners);
  };

  private findInput(id: string): MIDIInput | null {
    let found: MIDIInput | null = null;
    this.access?.inputs.forEach((input) => {
      if (input.id === id) found = input;
    });
    return found;
  }

  /** Gắn handler vào thiết bị đã chọn nếu nó đang cắm; gỡ khỏi thiết bị cũ / vừa rút. */
  private reattach(): void {
    const target = this.selected !== null ? this.findInput(this.selected) : null;
    const usable = target && target.state === 'connected' ? target : null;
    if (usable === this.attached) return;
    // Cùng cổng (object mới) thì không close — tránh close về muộn đóng mất cổng vừa mở lại
    this.detach(usable === null || usable.id !== this.attached?.id);
    if (usable) this.attach(usable);
  }

  private attach(input: MIDIInput): void {
    const inputId = input.id;
    const handler = (ev: MIDIMessageEvent): void => {
      const e = parseMidiMessage(ev.data, ev.timeStamp, inputId);
      if (!e) return;
      if (e.type === 'on') emit(this.activityListeners);
      emit(this.eventListeners, e);
    };
    // Gán onmidimessage tự mở cổng (implicit open) trên mọi trình duyệt có Web MIDI
    input.onmidimessage = handler;
    this.attached = input;
    this.attachedHandler = handler;
  }

  private detach(closePort: boolean): void {
    const input = this.attached;
    if (!input) return;
    if (input.onmidimessage === this.attachedHandler) input.onmidimessage = null;
    this.attached = null;
    this.attachedHandler = null;
    if (closePort && typeof input.close === 'function') {
      try {
        void input.close().catch(() => undefined);
      } catch {
        // cổng đã mất — bỏ qua
      }
    }
  }
}

let singleton: MidiInputManager | null = null;

/** Singleton lười — tạo khi gọi lần đầu, KHÔNG tự xin quyền (phải gọi enable()). */
export function getMidiInputManager(): MidiInputManager {
  if (!singleton) singleton = new MidiInputManager();
  return singleton;
}

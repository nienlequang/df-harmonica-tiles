/**
 * AudioContext giả tối thiểu cho test (jsdom không có Web Audio). Ghi lại mọi lệnh gọi:
 * automation của AudioParam, connect/disconnect, start/stop. `advance(sec)` tiến currentTime và
 * bắn 'ended' cho các source đã tới thời điểm stop.
 */

export type ParamEventType = 'set' | 'linear' | 'exp' | 'target' | 'cancel' | 'cancelHold';

export interface ParamEvent {
  type: ParamEventType;
  time: number;
  value?: number;
  timeConstant?: number;
}

export class FakeAudioParam {
  value: number;
  readonly defaultValue: number;
  readonly events: ParamEvent[] = [];

  constructor(value = 0) {
    this.value = value;
    this.defaultValue = value;
  }

  setValueAtTime(value: number, time: number): this {
    this.events.push({ type: 'set', value, time });
    return this;
  }
  linearRampToValueAtTime(value: number, time: number): this {
    this.events.push({ type: 'linear', value, time });
    return this;
  }
  exponentialRampToValueAtTime(value: number, time: number): this {
    this.events.push({ type: 'exp', value, time });
    return this;
  }
  setTargetAtTime(value: number, time: number, timeConstant: number): this {
    this.events.push({ type: 'target', value, time, timeConstant });
    return this;
  }
  cancelScheduledValues(time: number): this {
    this.events.push({ type: 'cancel', time });
    return this;
  }
  cancelAndHoldAtTime(time: number): this {
    this.events.push({ type: 'cancelHold', time });
    return this;
  }
  /** Các event kể từ lần cancel gần nhất (lịch đang có hiệu lực, gần đúng). */
  activeEvents(): ParamEvent[] {
    const i = this.events.map((e) => e.type).lastIndexOf('cancel');
    return this.events.slice(i + 1);
  }
}

export type FakeConnectTarget = FakeAudioNode | FakeAudioParam;

export class FakeAudioNode {
  readonly context: FakeAudioContext;
  readonly kind: string;
  connections: FakeConnectTarget[] = [];
  disconnectCount = 0;

  constructor(context: FakeAudioContext, kind: string) {
    this.context = context;
    this.kind = kind;
    context.nodes.push(this);
  }

  connect(target: FakeConnectTarget): FakeAudioNode | undefined {
    this.connections.push(target);
    return target instanceof FakeAudioNode ? target : undefined;
  }

  disconnect(): void {
    this.connections = [];
    this.disconnectCount++;
  }

  get disconnected(): boolean {
    return this.disconnectCount > 0;
  }
}

export class FakeScheduledSourceNode extends FakeAudioNode {
  startTime: number | null = null;
  stopTime: number | null = null;
  readonly stopCalls: number[] = [];
  onended: ((ev: Event) => void) | null = null;
  ended = false;
  private readonly endedListeners: Array<(ev: Event) => void> = [];

  start(when = 0): void {
    if (this.startTime !== null) throw new Error('InvalidStateError: start() called twice');
    this.startTime = when;
  }

  stop(when = 0): void {
    if (this.startTime === null) throw new Error('InvalidStateError: stop() before start()');
    this.stopTime = when;
    this.stopCalls.push(when);
  }

  addEventListener(type: string, listener: (ev: Event) => void): void {
    if (type === 'ended') this.endedListeners.push(listener);
  }

  removeEventListener(type: string, listener: (ev: Event) => void): void {
    if (type !== 'ended') return;
    const i = this.endedListeners.indexOf(listener);
    if (i >= 0) this.endedListeners.splice(i, 1);
  }

  /** Bắn 'ended' (một lần). */
  fireEnded(): void {
    if (this.ended) return;
    this.ended = true;
    const ev = new Event('ended');
    this.onended?.(ev);
    for (const l of [...this.endedListeners]) l(ev);
  }
}

export class FakeOscillatorNode extends FakeScheduledSourceNode {
  type: OscillatorType = 'sine';
  readonly frequency = new FakeAudioParam(440);
  readonly detune = new FakeAudioParam(0);

  constructor(context: FakeAudioContext) {
    super(context, 'oscillator');
  }
}

export class FakeAudioBuffer {
  readonly numberOfChannels: number;
  readonly length: number;
  readonly sampleRate: number;
  private readonly channels: Float32Array[];

  constructor(numberOfChannels: number, length: number, sampleRate: number) {
    this.numberOfChannels = numberOfChannels;
    this.length = length;
    this.sampleRate = sampleRate;
    this.channels = Array.from({ length: numberOfChannels }, () => new Float32Array(length));
  }

  get duration(): number {
    return this.length / this.sampleRate;
  }

  getChannelData(channel: number): Float32Array {
    const data = this.channels[channel];
    if (!data) throw new Error('IndexSizeError');
    return data;
  }
}

export class FakeAudioBufferSourceNode extends FakeScheduledSourceNode {
  buffer: FakeAudioBuffer | null = null;
  readonly playbackRate = new FakeAudioParam(1);
  loop = false;

  constructor(context: FakeAudioContext) {
    super(context, 'bufferSource');
  }
}

export class FakeGainNode extends FakeAudioNode {
  readonly gain = new FakeAudioParam(1);

  constructor(context: FakeAudioContext) {
    super(context, 'gain');
  }
}

export class FakeBiquadFilterNode extends FakeAudioNode {
  type: BiquadFilterType = 'lowpass';
  readonly frequency = new FakeAudioParam(350);
  readonly Q = new FakeAudioParam(1);
  readonly gain = new FakeAudioParam(0);
  readonly detune = new FakeAudioParam(0);

  constructor(context: FakeAudioContext) {
    super(context, 'biquad');
  }
}

export type FakeResumeBehavior = 'resolve' | 'reject' | 'hang';

export interface FakeAudioContextOptions {
  state?: AudioContextState;
  sampleRate?: number;
  currentTime?: number;
  /** Hành vi resume(): 'resolve' (mặc định, chuyển running), 'reject', 'hang' (không bao giờ xong). */
  resume?: FakeResumeBehavior;
  /**
   * 'resolve' chậm (ms, setTimeout — chạy theo fake timers): chuyển running rồi resolve sau chừng này, như iOS lần đầu.
   * 0 / bỏ trống = ngay.
   */
  resumeDelayMs?: number;
  /** Output latency (giây) — audio clock đọc thời điểm nghe thấy = currentTime - output - base. */
  outputLatency?: number;
  baseLatency?: number;
}

export class FakeAudioContext extends EventTarget {
  currentTime: number;
  readonly sampleRate: number;
  state: AudioContextState;
  readonly nodes: FakeAudioNode[] = [];
  readonly destination: FakeAudioNode;
  readonly ctorOptions: unknown;
  outputLatency: number;
  baseLatency: number;
  resumeBehavior: FakeResumeBehavior;
  resumeDelayMs: number;
  resumeCalls = 0;
  closeCalls = 0;

  constructor(opts: FakeAudioContextOptions = {}, ctorOptions?: unknown) {
    super();
    this.currentTime = opts.currentTime ?? 0;
    this.sampleRate = opts.sampleRate ?? 48000;
    this.state = opts.state ?? 'running';
    this.resumeBehavior = opts.resume ?? 'resolve';
    this.resumeDelayMs = opts.resumeDelayMs ?? 0;
    this.outputLatency = opts.outputLatency ?? 0;
    this.baseLatency = opts.baseLatency ?? 0;
    this.ctorOptions = ctorOptions;
    this.destination = new FakeAudioNode(this, 'destination');
  }

  createOscillator(): FakeOscillatorNode {
    return new FakeOscillatorNode(this);
  }
  createGain(): FakeGainNode {
    return new FakeGainNode(this);
  }
  createBiquadFilter(): FakeBiquadFilterNode {
    return new FakeBiquadFilterNode(this);
  }
  createBufferSource(): FakeAudioBufferSourceNode {
    return new FakeAudioBufferSourceNode(this);
  }
  createBuffer(numberOfChannels: number, length: number, sampleRate: number): FakeAudioBuffer {
    return new FakeAudioBuffer(numberOfChannels, length, sampleRate);
  }

  resume(): Promise<void> {
    this.resumeCalls++;
    if (this.state === 'closed') return Promise.reject(new Error('InvalidStateError'));
    if (this.resumeBehavior === 'reject') return Promise.reject(new Error('NotAllowedError'));
    if (this.resumeBehavior === 'hang') return new Promise<void>(() => undefined);
    if (this.resumeDelayMs > 0) {
      return new Promise<void>((resolve) => {
        setTimeout(() => {
          if (this.state !== 'closed') this.setState('running');
          resolve();
        }, this.resumeDelayMs);
      });
    }
    this.setState('running');
    return Promise.resolve();
  }

  suspend(): Promise<void> {
    this.setState('suspended');
    return Promise.resolve();
  }

  close(): Promise<void> {
    this.closeCalls++;
    this.setState('closed');
    return Promise.resolve();
  }

  setState(state: AudioContextState): void {
    if (this.state === state) return;
    this.state = state;
    this.dispatchEvent(new Event('statechange'));
  }

  /** Tiến currentTime và bắn 'ended' cho source đã start và tới thời điểm stop. */
  advance(sec: number): void {
    this.currentTime += sec;
    this.flushEnded();
  }

  /** Bắn 'ended' cho mọi source có stopTime <= currentTime. */
  flushEnded(): void {
    for (const n of [...this.nodes]) {
      if (
        n instanceof FakeScheduledSourceNode &&
        !n.ended &&
        n.startTime !== null &&
        n.stopTime !== null &&
        n.stopTime <= this.currentTime + 1e-9
      ) {
        n.fireEnded();
      }
    }
  }

  oscillators(): FakeOscillatorNode[] {
    return this.nodes.filter((n): n is FakeOscillatorNode => n instanceof FakeOscillatorNode);
  }
  gains(): FakeGainNode[] {
    return this.nodes.filter((n): n is FakeGainNode => n instanceof FakeGainNode);
  }
  filters(): FakeBiquadFilterNode[] {
    return this.nodes.filter((n): n is FakeBiquadFilterNode => n instanceof FakeBiquadFilterNode);
  }
  bufferSources(): FakeAudioBufferSourceNode[] {
    return this.nodes.filter(
      (n): n is FakeAudioBufferSourceNode => n instanceof FakeAudioBufferSourceNode,
    );
  }

  /** Dùng ở chỗ code nhận AudioContext thật. */
  asAudioContext(): AudioContext {
    return this as unknown as AudioContext;
  }
}

/** Node giả bất kỳ dưới dạng AudioNode (làm destination). */
export function asAudioNode(node: FakeAudioNode): AudioNode {
  return node as unknown as AudioNode;
}

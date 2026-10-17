import { describe, expect, it, vi } from 'vitest';
import { createManualClock } from './clock';
import type { ManualClock } from './clock';
import {
  BPM_MAX,
  BPM_MIN,
  Transport,
  clampBpm,
  snapshotBeatAt,
  snapshotTimeAt,
  wrapEndOf,
} from './transport';
import type { TransportSnapshot } from './transport.types';

const P = 12; // số chữ số thập phân cho toBeCloseTo

function setup(bpm = 120, endBeat?: number, start = 0): { clock: ManualClock; t: Transport } {
  const clock = createManualClock(start);
  const t = new Transport({ clock, bpm, endBeat });
  return { clock, t };
}

describe('Transport — cơ bản', () => {
  it('khởi tạo pause tại beat 0, endBeat mặc định Infinity', () => {
    const { clock, t } = setup();
    expect(t.playing).toBe(false);
    expect(t.getBeat()).toBe(0);
    expect(t.epoch).toBe(0);
    expect(t.endBeat).toBe(Infinity);
    expect(t.loop).toBeNull();
    expect(t.countIn).toBeNull();
    expect(t.clock).toBe(clock);
    clock.advance(5);
    expect(t.getBeat()).toBe(0);
  });

  it('kẹp bpm ở constructor; endBeat sai thì RangeError', () => {
    expect(setup(5).t.bpm).toBe(BPM_MIN);
    expect(setup(1000).t.bpm).toBe(BPM_MAX);
    expect(setup(Number.NaN).t.bpm).toBe(120);
    expect(clampBpm(90)).toBe(90);
    expect(() => setup(120, -1)).toThrow(RangeError);
    expect(() => setup(120, Number.NaN)).toThrow(RangeError);
  });

  it('beat chạy theo bpm', () => {
    const { clock, t } = setup(120, undefined, 50);
    t.play();
    expect(t.playing).toBe(true);
    clock.advance(1);
    expect(t.getBeat()).toBeCloseTo(2, P);
    clock.advance(0.25);
    expect(t.getBeat()).toBeCloseTo(2.5, P);
  });

  it('snapshot đúng shape và công thức beat(t)', () => {
    const { clock, t } = setup(90, 64, 3);
    t.play({ fromBeat: 8 });
    const s = t.snapshot();
    expect(s).toEqual({
      playing: true,
      anchorTime: 3,
      anchorBeat: 8,
      bpm: 90,
      epoch: 1,
      loop: null,
      countIn: null,
      segmentStart: 8,
      endBeat: 64,
    });
    clock.advance(2);
    expect(snapshotBeatAt(s, clock.now())).toBeCloseTo(t.getBeat(), P);
    expect(snapshotTimeAt(s, 11)).toBeCloseTo(t.beatToTime(11), P);
    t.pause();
    const paused = t.snapshot();
    expect(snapshotBeatAt(paused, 1e6)).toBe(paused.anchorBeat);
  });

  it('toggle play/pause', () => {
    const { clock, t } = setup();
    t.toggle({ fromBeat: 4 });
    expect(t.playing).toBe(true);
    clock.advance(0.5);
    t.toggle();
    expect(t.playing).toBe(false);
    expect(t.getBeat()).toBeCloseTo(5, P);
  });

  it('play khi đang phát mà không có fromBeat thì bỏ qua; có fromBeat thì phát lại', () => {
    const { clock, t } = setup();
    t.play();
    clock.advance(1);
    const e = t.epoch;
    t.play({ countInBeats: 4 });
    expect(t.epoch).toBe(e);
    expect(t.getBeat()).toBeCloseTo(2, P);
    t.play({ fromBeat: 0 });
    expect(t.epoch).toBe(e + 1);
    expect(t.getBeat()).toBe(0);
  });

  it('fromBeat âm / NaN → 0', () => {
    const { t } = setup();
    t.play({ fromBeat: -3 });
    expect(t.getBeat()).toBe(0);
    t.play({ fromBeat: Number.NaN });
    expect(t.getBeat()).toBe(0);
  });
});

describe('Transport — pause / resume', () => {
  it('giữ vị trí chính xác qua nhiều chu kỳ', () => {
    const { clock, t } = setup(137);
    let played = 0;
    for (let i = 0; i < 200; i++) {
      t.play();
      const dt = 0.1 + (i % 7) * 0.037;
      clock.advance(dt);
      played += dt;
      t.pause();
      const frozen = t.getBeat();
      clock.advance(0.5 + (i % 3) * 1.13); // thời gian pause không tính
      expect(t.getBeat()).toBe(frozen);
    }
    expect(t.getBeat()).toBeCloseTo((played * 137) / 60, 9);
  });

  it('pause khi đã pause là no-op', () => {
    const { t } = setup();
    const fn = vi.fn();
    t.subscribe(fn);
    t.pause();
    expect(t.epoch).toBe(0);
    expect(fn).not.toHaveBeenCalled();
  });
});

describe('Transport — seek', () => {
  it('seek khi pause', () => {
    const { clock, t } = setup(120, 32);
    t.seek(10);
    expect(t.getBeat()).toBe(10);
    clock.advance(3);
    expect(t.getBeat()).toBe(10);
    t.play();
    clock.advance(1);
    expect(t.getBeat()).toBeCloseTo(12, P);
  });

  it('seek khi đang phát, neo lại tại now', () => {
    const { clock, t } = setup(120, 32);
    t.play();
    clock.advance(3);
    t.seek(20);
    expect(t.playing).toBe(true);
    expect(t.getBeat()).toBe(20);
    clock.advance(0.5);
    expect(t.getBeat()).toBeCloseTo(21, P);
  });

  it('kẹp [0, endBeat], NaN → 0', () => {
    const { t } = setup(120, 32);
    t.seek(-5);
    expect(t.getBeat()).toBe(0);
    t.seek(99);
    expect(t.getBeat()).toBe(32);
    t.seek(Number.NaN);
    expect(t.getBeat()).toBe(0);
    t.seek(Infinity);
    expect(t.getBeat()).toBe(32);
    const inf = setup().t;
    inf.seek(Infinity);
    expect(inf.getBeat()).toBe(0);
  });

  it('seek xóa countIn', () => {
    const { t } = setup();
    t.play({ fromBeat: 8, countInBeats: 4 });
    expect(t.countIn).not.toBeNull();
    t.seek(2);
    expect(t.countIn).toBeNull();
  });
});

describe('Transport — bpm', () => {
  it('đổi bpm giữa chừng không nhảy, beat sau theo tempo mới', () => {
    const { clock, t } = setup(120);
    t.play();
    clock.advance(2); // beat 4
    const before = t.getBeat();
    t.setBpm(60);
    expect(t.bpm).toBe(60);
    expect(t.getBeat()).toBeCloseTo(before, P);
    clock.advance(2); // +2 beat ở 60 bpm
    expect(t.getBeat()).toBeCloseTo(6, P);
    t.setBpm(180);
    clock.advance(1); // +3 beat
    expect(t.getBeat()).toBeCloseTo(9, P);
  });

  it('kẹp 20..400, NaN bỏ qua, bpm trùng không tăng epoch', () => {
    const { t } = setup(120);
    t.setBpm(1);
    expect(t.bpm).toBe(20);
    t.setBpm(9999);
    expect(t.bpm).toBe(400);
    const e = t.epoch;
    t.setBpm(Number.NaN);
    t.setBpm(400);
    t.setBpm(500);
    expect(t.epoch).toBe(e);
  });

  it('đổi bpm khi pause giữ beat, play sau dùng tempo mới', () => {
    const { clock, t } = setup(120);
    t.seek(4);
    t.setBpm(240);
    expect(t.getBeat()).toBe(4);
    t.play();
    clock.advance(1);
    expect(t.getBeat()).toBeCloseTo(8, P);
  });
});

describe('Transport — đổi clock', () => {
  it('giữ beat khi chuyển sang clock có gốc thời gian khác', () => {
    const perf = createManualClock(1000, 'performance');
    const audio = createManualClock(2.5, 'audio');
    const t = new Transport({ clock: perf, bpm: 120 });
    t.play();
    perf.advance(3); // beat 6
    t.setClock(audio);
    expect(t.clock).toBe(audio);
    expect(t.clock.kind).toBe('audio');
    expect(t.playing).toBe(true);
    expect(t.getBeat()).toBeCloseTo(6, P);
    expect(t.snapshot().anchorTime).toBe(2.5);
    perf.advance(100); // clock cũ không còn ảnh hưởng
    audio.advance(0.5);
    expect(t.getBeat()).toBeCloseTo(7, P);
    expect(t.beatToTime(8)).toBeCloseTo(3.5, P);
    expect(t.timeToBeat(3.5)).toBeCloseTo(8, P);
  });

  it('khi pause vẫn giữ beat; cùng clock là no-op', () => {
    const a = createManualClock(10);
    const b = createManualClock(-50);
    const t = new Transport({ clock: a, bpm: 100 });
    t.seek(12.5);
    const e = t.epoch;
    t.setClock(a);
    expect(t.epoch).toBe(e);
    t.setClock(b);
    expect(t.epoch).toBe(e + 1);
    expect(t.playing).toBe(false);
    expect(t.getBeat()).toBe(12.5);
    t.play();
    b.advance(0.6);
    expect(t.getBeat()).toBeCloseTo(13.5, P);
  });

  it('giữ countIn khi đổi clock giữa lúc đếm vào', () => {
    const a = createManualClock(0);
    const b = createManualClock(500);
    const t = new Transport({ clock: a, bpm: 120 });
    t.play({ fromBeat: 0, countInBeats: 4 });
    a.advance(1); // beat -2
    t.setClock(b);
    expect(t.getBeat()).toBeCloseTo(-2, P);
    expect(t.countIn).toEqual({ start: -4, end: 0 });
  });
});

describe('Transport — count-in', () => {
  it('beat âm khi đếm vào và snapshot.countIn', () => {
    const { clock, t } = setup(120);
    t.play({ fromBeat: 0, countInBeats: 4 });
    expect(t.getBeat()).toBe(-4);
    expect(t.snapshot().countIn).toEqual({ start: -4, end: 0 });
    clock.advance(1);
    expect(t.update()).toEqual({ wrapped: false, ended: false });
    expect(t.getBeat()).toBeCloseTo(-2, P);
    expect(t.countIn).toEqual({ start: -4, end: 0 });
    const e = t.epoch;
    clock.advance(1.25); // beat 0.5
    t.update();
    expect(t.countIn).toBeNull();
    expect(t.epoch).toBe(e); // hết count-in không phải gián đoạn
    expect(t.getBeat()).toBeCloseTo(0.5, P);
  });

  it('count-in từ giữa bài', () => {
    const { clock, t } = setup(120, 64);
    t.play({ fromBeat: 16, countInBeats: 4 });
    expect(t.countIn).toEqual({ start: 12, end: 16 });
    expect(t.getBeat()).toBe(12);
    clock.advance(2);
    expect(t.getBeat()).toBeCloseTo(16, P);
  });

  it('countInBeats <= 0 / NaN → không đếm vào', () => {
    const { t } = setup();
    t.play({ fromBeat: 4, countInBeats: 0 });
    expect(t.countIn).toBeNull();
    expect(t.getBeat()).toBe(4);
    t.play({ fromBeat: 4, countInBeats: Number.NaN });
    expect(t.countIn).toBeNull();
  });

  it('pause giữa lúc đếm vào: đóng băng đúng beat, xóa countIn; play lại từ 0', () => {
    const { clock, t } = setup(120);
    t.play({ fromBeat: 0, countInBeats: 4 });
    clock.advance(0.5); // beat -3
    t.pause();
    expect(t.getBeat()).toBeCloseTo(-3, P);
    expect(t.countIn).toBeNull();
    t.play();
    expect(t.getBeat()).toBe(0);
  });
});

describe('Transport — loop', () => {
  it('wrap chính xác khi update() gọi trễ 0.3 s', () => {
    const { clock, t } = setup(120, 64);
    t.setLoop({ start: 4, end: 8 });
    t.play({ fromBeat: 0 });
    clock.set(3.9); // beat 7.8
    expect(t.update().wrapped).toBe(false);
    clock.set(4.3); // vượt loop end (t = 4) 0.3 s
    const e = t.epoch;
    expect(t.update()).toEqual({ wrapped: true, ended: false });
    expect(t.epoch).toBe(e + 1);
    expect(t.getBeat()).toBeCloseTo(4.6, P);
    const s = t.snapshot();
    expect(s.anchorBeat).toBe(4);
    expect(s.anchorTime).toBeCloseTo(4, P);
    clock.advance(0.5);
    expect(t.getBeat()).toBeCloseTo(5.6, P);
  });

  it('wrap qua nhiều vòng loop (modulo)', () => {
    const { clock, t } = setup(120, 64);
    t.setLoop({ start: 4, end: 8 });
    t.play({ fromBeat: 0 });
    // loop end lần đầu ở t=4, mỗi vòng 2 s → vượt lần cuối ở t=10
    clock.set(10.3);
    expect(t.update().wrapped).toBe(true);
    expect(t.getBeat()).toBeCloseTo(4.6, P);
    expect(t.snapshot().anchorTime).toBeCloseTo(10, P);
    expect(t.update().wrapped).toBe(false);
  });

  it('nhiều lần wrap liên tiếp không trôi', () => {
    const { clock, t } = setup(97, 64);
    t.setLoop({ start: 2, end: 5 });
    t.play({ fromBeat: 2 });
    const lap = (3 * 60) / 97;
    for (let i = 1; i <= 50; i++) {
      clock.set(i * lap + 0.01);
      expect(t.update().wrapped).toBe(true);
      expect(t.getBeat()).toBeCloseTo(2 + (0.01 * 97) / 60, 9);
    }
  });

  it('wrap đúng ngay tại loop end', () => {
    const { clock, t } = setup(120, 64);
    t.setLoop({ start: 0, end: 4 });
    t.play();
    clock.set(2); // beat đúng 4
    expect(t.update().wrapped).toBe(true);
    expect(t.getBeat()).toBeCloseTo(0, P);
  });

  it('playhead trước vùng loop: chạy vào rồi wrap, không nhảy ngay', () => {
    const { clock, t } = setup(120, 64);
    t.play({ fromBeat: 0 });
    clock.set(0.5); // beat 1
    t.setLoop({ start: 8, end: 12 });
    expect(t.getBeat()).toBeCloseTo(1, P);
    clock.set(5.5); // beat 11
    expect(t.update().wrapped).toBe(false);
    clock.set(6.25); // beat 12.5
    expect(t.update().wrapped).toBe(true);
    expect(t.getBeat()).toBeCloseTo(8.5, P);
  });

  it('đặt loop phía sau playhead: không nhảy, chạy tới hết bài', () => {
    const { clock, t } = setup(120, 20);
    t.play({ fromBeat: 0 });
    clock.set(7.5); // beat 15
    t.setLoop({ start: 4, end: 8 });
    expect(t.update().wrapped).toBe(false);
    expect(t.getBeat()).toBeCloseTo(15, P);
    clock.set(11);
    expect(t.update()).toEqual({ wrapped: false, ended: true });
    expect(t.getBeat()).toBe(20);
    // play lại từ 0 → loop có hiệu lực
    t.play();
    clock.advance(4.1);
    expect(t.update().wrapped).toBe(true);
    expect(t.getBeat()).toBeCloseTo(4.2, P);
  });

  it('loop end vượt endBeat thì wrap tại endBeat', () => {
    const { clock, t } = setup(120, 10);
    t.setLoop({ start: 6, end: 40 });
    t.play({ fromBeat: 6 });
    clock.set(2.5); // beat 11
    expect(t.update()).toEqual({ wrapped: true, ended: false });
    expect(t.getBeat()).toBeCloseTo(7, P);
  });

  it('loop không hợp lệ ném RangeError; start âm kẹp về 0', () => {
    const { t } = setup();
    expect(() => t.setLoop({ start: 4, end: 4 })).toThrow(RangeError);
    expect(() => t.setLoop({ start: 5, end: 2 })).toThrow(RangeError);
    expect(() => t.setLoop({ start: Number.NaN, end: 2 })).toThrow(RangeError);
    expect(() => t.setLoop({ start: 0, end: Infinity })).toThrow(RangeError);
    t.setLoop({ start: -2, end: 4 });
    expect(t.loop).toEqual({ start: 0, end: 4 });
  });

  it('tắt loop thì chạy tiếp và dừng ở endBeat', () => {
    const { clock, t } = setup(120, 12);
    t.setLoop({ start: 0, end: 4 });
    t.play();
    clock.set(1.5);
    t.setLoop(null);
    expect(t.loop).toBeNull();
    clock.set(3); // beat 6
    expect(t.update().wrapped).toBe(false);
    expect(t.getBeat()).toBeCloseTo(6, P);
  });

  it('wrap xóa countIn', () => {
    const { clock, t } = setup(120, 64);
    t.setLoop({ start: 0, end: 4 });
    t.play({ fromBeat: 0, countInBeats: 4 });
    clock.set(4.1); // beat 4.2 > loop end; count-in còn chưa được xóa vì chưa update
    expect(t.update().wrapped).toBe(true);
    expect(t.countIn).toBeNull();
    expect(t.getBeat()).toBeCloseTo(0.2, P);
  });

  it('pause áp wrap còn treo trước khi đóng băng', () => {
    const { clock, t } = setup(120, 64);
    t.setLoop({ start: 4, end: 8 });
    t.play({ fromBeat: 4 });
    clock.set(2.3); // beat 8.6, chưa update
    t.pause();
    expect(t.getBeat()).toBeCloseTo(4.6, P);
  });
});

describe('Transport — loop + count-in (điều kiện wrap theo điểm bắt đầu thật)', () => {
  const LOOP = { start: 0, end: 6.5 };

  it('play từ loop end: có hay không count-in đều chạy tiếp, không wrap', () => {
    for (const countInBeats of [0, 4]) {
      const { clock, t } = setup(60, 64);
      t.setLoop(LOOP);
      t.seek(6.5);
      t.play({ countInBeats });
      expect(t.segmentStart).toBe(6.5);
      clock.advance(countInBeats + 2);
      expect(t.update().wrapped).toBe(false);
      expect(t.getBeat()).toBeCloseTo(8.5, P);
    }
  });

  it('play trong 1 ô nhịp sau loop end kèm count-in: không cắt count-in, không nhảy về loop start', () => {
    for (const from of [6.5, 8]) {
      const { clock, t } = setup(60, 64);
      t.setLoop(LOOP);
      t.play({ fromBeat: from, countInBeats: 4 });
      clock.advance(3); // vẫn trong count-in
      expect(t.update()).toEqual({ wrapped: false, ended: false });
      expect(t.getBeat()).toBeCloseTo(from - 1, P);
      expect(t.countIn).toEqual({ start: from - 4, end: from });
      clock.advance(3);
      expect(t.update().wrapped).toBe(false);
      expect(t.getBeat()).toBeCloseTo(from + 2, P);
    }
  });

  it('play trước loop end kèm count-in vẫn wrap ở loop end', () => {
    const { clock, t } = setup(60, 64);
    t.setLoop(LOOP);
    t.play({ fromBeat: 2, countInBeats: 4 });
    clock.advance(4 + 5); // beat 7 > 6.5
    expect(t.update().wrapped).toBe(true);
    expect(t.getBeat()).toBeCloseTo(0.5, P);
    expect(t.segmentStart).toBe(0);
  });

  it('đặt loop lúc đang đếm vào: so với điểm định bắt đầu, không phải beat âm', () => {
    const { clock, t } = setup(60, 64);
    t.play({ fromBeat: 8, countInBeats: 4 });
    clock.advance(1); // beat 5 (đếm vào)
    t.setLoop(LOOP);
    expect(t.segmentStart).toBe(8);
    clock.advance(5);
    expect(t.update().wrapped).toBe(false);
    expect(t.getBeat()).toBeCloseTo(10, P);
  });

  it('wrapEndOf: loop end kẹp endBeat; null khi không loop / loop rỗng / đoạn bắt đầu từ end', () => {
    const base = { loop: LOOP, endBeat: 64, segmentStart: 0 };
    expect(wrapEndOf(base)).toBe(6.5);
    expect(wrapEndOf({ ...base, endBeat: 5 })).toBe(5);
    expect(wrapEndOf({ ...base, loop: null })).toBeNull();
    expect(wrapEndOf({ ...base, segmentStart: 6.5 })).toBeNull();
    expect(wrapEndOf({ ...base, loop: { start: 6, end: 9 }, endBeat: 6 })).toBeNull();
  });
});

describe('Transport — lead (chờ output latency khi bắt đầu đoạn phát)', () => {
  function leadClock(start: number, lead: number): ManualClock {
    return Object.assign(createManualClock(start, 'audio'), { lead: () => lead });
  }

  it('play/seek neo tại now + lead; hình đứng ở điểm bắt đầu trong lúc chờ', () => {
    const clock = leadClock(10, 0.1);
    const t = new Transport({ clock, bpm: 120 });
    t.play({ fromBeat: 4 });
    expect(t.snapshot().anchorTime).toBeCloseTo(10.1, P);
    clock.advance(0.05);
    expect(t.getBeat()).toBe(4);
    expect(snapshotBeatAt(t.snapshot(), clock.now())).toBe(4);
    clock.advance(0.3); // 0.25 s sau anchor
    expect(t.getBeat()).toBeCloseTo(4.5, P);
    t.seek(8);
    expect(t.getBeat()).toBe(8);
    expect(t.snapshot().anchorTime).toBeCloseTo(10.45, P);
    clock.advance(0.35);
    expect(t.getBeat()).toBeCloseTo(8.5, P);
  });

  it('seek khi pause và pause không chừa lead', () => {
    const clock = leadClock(0, 0.1);
    const t = new Transport({ clock, bpm: 120 });
    t.seek(2);
    expect(t.snapshot().anchorTime).toBe(0);
    t.play();
    clock.advance(0.05);
    t.pause(); // trong lúc chờ: giữ điểm bắt đầu
    expect(t.getBeat()).toBe(2);
    expect(t.snapshot().anchorTime).toBeCloseTo(0.05, P);
  });

  it('setClock khi đang phát chừa lead của clock mới', () => {
    const perf = createManualClock(100);
    const audio = leadClock(3, 0.08);
    const t = new Transport({ clock: perf, bpm: 120 });
    t.play({ fromBeat: 0 });
    perf.advance(1); // beat 2
    t.setClock(audio);
    expect(t.getBeat()).toBeCloseTo(2, P);
    expect(t.snapshot().anchorTime).toBeCloseTo(3.08, P);
    audio.advance(0.58);
    expect(t.getBeat()).toBeCloseTo(3, P);
  });

  it('setBpm trong lúc chờ giữ anchor; sau anchor đi theo tempo mới', () => {
    const clock = leadClock(0, 0.1);
    const t = new Transport({ clock, bpm: 120 });
    t.play({ fromBeat: 4 });
    clock.advance(0.05);
    const e = t.epoch;
    t.setBpm(60);
    expect(t.epoch).toBe(e); // không phải gián đoạn
    expect(t.snapshot().anchorTime).toBeCloseTo(0.1, P);
    expect(t.getBeat()).toBe(4);
    clock.advance(1.05); // 1 s sau anchor ở 60 bpm
    expect(t.getBeat()).toBeCloseTo(5, P);
  });

  it('startDelaySec: chờ thêm (cộng vào lead) rồi mới chạy — beat đứng ở đầu đoạn kể cả đếm vào', () => {
    const clock = leadClock(10, 0.1);
    const t = new Transport({ clock, bpm: 120 });
    t.play({ fromBeat: 4, countInBeats: 4, startDelaySec: 0.25 });
    expect(t.snapshot().anchorTime).toBeCloseTo(10.35, P);
    expect(t.countIn).toEqual({ start: 0, end: 4 });
    clock.advance(0.3);
    expect(t.getBeat()).toBe(0);
    clock.advance(0.55); // 0.5 s sau anchor
    expect(t.getBeat()).toBeCloseTo(1, P);
  });

  it('startDelaySec âm / NaN / Infinity = không chờ thêm', () => {
    for (const bad of [-1, Number.NaN, Infinity]) {
      const { clock, t } = setup(120, undefined, 5);
      t.play({ fromBeat: 0, startDelaySec: bad });
      expect(t.snapshot().anchorTime).toBe(5);
      clock.advance(0.5);
      expect(t.getBeat()).toBeCloseTo(1, P);
    }
  });
});

describe('Transport — kết thúc bài', () => {
  it('dừng đúng endBeat kể cả khi update trễ', () => {
    const { clock, t } = setup(120, 16);
    t.play();
    clock.set(7.9);
    expect(t.update().ended).toBe(false);
    clock.set(8.3);
    const e = t.epoch;
    expect(t.update()).toEqual({ wrapped: false, ended: true });
    expect(t.playing).toBe(false);
    expect(t.getBeat()).toBe(16);
    expect(t.epoch).toBe(e + 1);
    clock.advance(5);
    expect(t.update()).toEqual({ wrapped: false, ended: false });
    expect(t.getBeat()).toBe(16);
  });

  it('play sau khi hết bài phát lại từ 0', () => {
    const { clock, t } = setup(120, 16);
    t.play();
    clock.set(9);
    t.update();
    t.play();
    expect(t.getBeat()).toBe(0);
    clock.advance(1);
    expect(t.getBeat()).toBeCloseTo(2, P);
    t.seek(16);
    t.pause();
    t.play({ fromBeat: 20 });
    expect(t.getBeat()).toBe(0);
  });

  it('setEndBeat: kẹp vị trí khi pause, dừng ở endBeat mới khi đang phát', () => {
    const { clock, t } = setup(120, 32);
    t.seek(20);
    t.setEndBeat(10);
    expect(t.endBeat).toBe(10);
    expect(t.getBeat()).toBe(10);
    t.play({ fromBeat: 0 });
    t.setEndBeat(4);
    clock.set(2.2);
    expect(t.update().ended).toBe(true);
    expect(t.getBeat()).toBe(4);
    expect(() => t.setEndBeat(-1)).toThrow(RangeError);
    t.setEndBeat(Infinity);
    expect(t.endBeat).toBe(Infinity);
  });
});

describe('Transport — epoch và subscribe', () => {
  it('epoch tăng ở mỗi gián đoạn, không tăng khi update() thường, setBpm hoặc setLoop', () => {
    const a = createManualClock(0);
    const b = createManualClock(9);
    const t = new Transport({ clock: a, bpm: 120, endBeat: 40 });
    const seen: number[] = [t.epoch];
    const step = (): void => {
      seen.push(t.epoch);
    };
    t.play();
    step(); // play
    for (let i = 0; i < 10; i++) {
      a.advance(0.016);
      t.update();
    }
    step(); // update thường
    t.pause();
    step();
    t.seek(2);
    step();
    t.setBpm(100);
    step(); // đổi bpm: vị trí liên tục → không tăng
    t.setClock(b);
    step();
    t.setLoop({ start: 2, end: 4 });
    step(); // setLoop: không tăng
    t.play();
    step();
    b.advance(1.3); // beat 2 + 100/60*1.3 ≈ 4.17 → wrap
    t.update();
    step();
    t.setLoop(null);
    t.seek(39);
    step();
    b.advance(1);
    t.update(); // end
    step();
    expect(seen).toEqual([0, 1, 1, 2, 3, 3, 4, 4, 5, 6, 7, 8]);
  });

  it('notify đúng số lần thay đổi rời rạc, không theo frame', () => {
    const { clock, t } = setup(120, 12);
    const snaps: TransportSnapshot[] = [];
    const unsub = t.subscribe((s) => snaps.push(s));
    t.play(); // 1
    for (let i = 0; i < 60; i++) {
      clock.advance(1 / 60);
      t.update();
    }
    expect(snaps).toHaveLength(1);
    t.setBpm(240); // 2
    t.setLoop({ start: 4, end: 8 }); // 3
    t.setLoop({ start: 4, end: 8 }); // trùng → không notify
    clock.advance(1.2); // beat 2 + 4.8 = 6.8
    t.update();
    clock.advance(0.5); // beat 8.8 → wrap về 4
    t.update(); // 4
    expect(snaps).toHaveLength(4);
    expect(snaps[3]?.anchorBeat).toBe(4);
    t.setLoop(null); // 5
    t.seek(11); // 6
    clock.advance(1);
    t.update(); // end → 7
    expect(snaps).toHaveLength(7);
    expect(snaps[6]?.playing).toBe(false);
    unsub();
    t.play();
    expect(snaps).toHaveLength(7);
  });

  it('snapshot gửi cho listener phản ánh trạng thái mới', () => {
    const { t } = setup();
    const fn = vi.fn<(s: TransportSnapshot) => void>();
    t.subscribe(fn);
    t.play({ fromBeat: 3, countInBeats: 2 });
    expect(fn).toHaveBeenCalledTimes(1);
    const snap = fn.mock.calls[0]?.[0];
    expect(snap?.playing).toBe(true);
    expect(snap?.anchorBeat).toBe(1);
    expect(snap?.countIn).toEqual({ start: 1, end: 3 });
  });

  it('listener ném lỗi không chặn listener khác; dispose gỡ hết', () => {
    const { t } = setup();
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const good = vi.fn();
    t.subscribe(() => {
      throw new Error('boom');
    });
    t.subscribe(good);
    t.play();
    expect(good).toHaveBeenCalledTimes(1);
    expect(err).toHaveBeenCalledTimes(1);
    t.dispose();
    t.pause();
    expect(good).toHaveBeenCalledTimes(1);
  });

  it('pause notify 1 lần kể cả khi kèm wrap còn treo', () => {
    const { clock, t } = setup(120, 64);
    t.setLoop({ start: 0, end: 4 });
    t.play();
    const fn = vi.fn();
    t.subscribe(fn);
    clock.set(2.5);
    t.pause();
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe('Transport — beatToTime / timeToBeat', () => {
  it('khi đang phát dùng anchor, đảo ngược nhau', () => {
    const { clock, t } = setup(150, undefined, 7);
    t.play({ fromBeat: 10 });
    clock.advance(3);
    expect(t.beatToTime(10)).toBeCloseTo(7, P);
    expect(t.beatToTime(20)).toBeCloseTo(7 + 4, P);
    expect(t.timeToBeat(t.beatToTime(17.25))).toBeCloseTo(17.25, P);
  });

  it('khi pause: timeToBeat = beat đang dừng, beatToTime dự phóng từ now', () => {
    const { clock, t } = setup(120);
    t.seek(4);
    clock.set(100);
    expect(t.timeToBeat(5000)).toBe(4);
    expect(t.beatToTime(6)).toBeCloseTo(101, P);
  });
});

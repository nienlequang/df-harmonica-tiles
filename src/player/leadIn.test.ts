import { describe, expect, it } from 'vitest';
import { planEvents } from '../audio/scheduler';
import { parseHarm } from '../core/parser';
import { buildTimeline } from '../core/timeline';
import type { Timeline } from '../core/types';
import quocCa from '../library/seeds/quoc-ca-viet-nam.harm?raw';
import takedisk from '../library/seeds/takediskrush.harm?raw';
import {
  LEAD_IN_CLICK_MARGIN,
  LEAD_IN_MIN_CLICKS,
  LEAD_IN_TRAVEL_RATIO,
  firstNoteStartFrom,
  leadInBeats,
  playStartBeat,
} from './leadIn';
import type { TransportSnapshot } from './transport.types';

function timelineOf(src: string): Timeline {
  const r = parseHarm(src);
  if (!r.song) throw new Error('parse lỗi');
  return buildTimeline(r.song);
}

/** Timeline tối thiểu cho planEvents: nốt ở các beat cho trước (mỗi nốt dài 1 beat), `bar` beat mỗi ô nhịp. */
function makeTl(starts: number[], bar: number): Timeline {
  const base = timelineOf(['@bpm 120', '# A', 'Z', ''].join('\n'));
  return {
    ...base,
    beatsPerBar: bar,
    notes: starts.map((s, i) => ({ ...base.notes[0], index: i, startBeat: s, endBeat: s + 1 })),
    totalBeats: Math.max(...starts) + 1,
  };
}

/** Bài giả: nốt bắt đầu ở các beat cho trước (mỗi nốt dài 1 beat). */
function fakeTl(starts: number[]): Pick<Timeline, 'notes'> {
  return {
    notes: starts.map((s) => ({ startBeat: s, endBeat: s + 1 })) as unknown as Timeline['notes'],
  };
}

describe('leadIn', () => {
  it('tỉ lệ = 65 % (góp ý v1.0.1: bớt 35 %)', () => {
    expect(LEAD_IN_TRAVEL_RATIO).toBe(0.65);
  });

  it('firstNoteStartFrom: nốt đầu từ `from` trở đi (nốt bắt đầu đúng `from` tính), hết nốt → null', () => {
    const tl = fakeTl([0, 2.75, 3, 8]);
    expect(firstNoteStartFrom(tl, 0)).toBe(0);
    expect(firstNoteStartFrom(tl, 0.5)).toBe(2.75);
    expect(firstNoteStartFrom(tl, 2.75)).toBe(2.75);
    expect(firstNoteStartFrom(tl, 3.1)).toBe(8);
    expect(firstNoteStartFrom(tl, 9)).toBeNull();
    expect(firstNoteStartFrom(fakeTl([]), 0)).toBeNull();
  });

  it('bài vào ngay beat 0: đếm vào 0,65 ô nhịp (4/4 → 2,6 beat; 6/4 → 3,9 beat)', () => {
    const tl = fakeTl([0, 1, 2]);
    expect(leadInBeats(tl, 0, 4)).toBe(2.6);
    expect(leadInBeats(tl, 0, 6)).toBe(3.9);
  });

  it('ít nhất 2 beat nguyên trước nốt đầu (D-439): 3/4 / 2/4 vào ngay đầu ô nhịp → 2 beat (+0,001), không một tick lẻ', () => {
    expect(LEAD_IN_MIN_CLICKS).toBe(2);
    const tl = fakeTl([0, 1, 2]);
    // 0,65 × 3 = 1,95 beat chỉ chứa beat −1 → nới tới beat −2.
    expect(leadInBeats(tl, 0, 3)).toBe(2 + LEAD_IN_CLICK_MARGIN);
    // 0,65 × 2 = 1,3 beat → 2 beat (= 1 ô nhịp như trước v1.0.1 — ngắn nhất có 2 tick; trần = đếm vào cũ).
    expect(leadInBeats(tl, 0, 2)).toBe(2);
    // Nhịp 1/4: không dài hơn đếm vào cũ (1 beat).
    expect(leadInBeats(tl, 0, 1)).toBe(1);
    // 3/4, nốt đầu ở beat 1: 1,95 − 0,35 = 1,6 → đã chứa −1, 0 → không đổi.
    expect(leadInBeats(fakeTl([1]), 0, 3)).toBe(1.6);
    // 2/4, nốt đầu ở beat 1: 1,3 − 0,35 = 0,95 → chỉ chứa 0 → nới tới −1 (1,001).
    expect(leadInBeats(fakeTl([1]), 0, 2)).toBe(1 + LEAD_IN_CLICK_MARGIN);
    // Phát từ giữa bài (from 10,5 — nốt ở 10,5): 3/4 → 1,95 chứa 9, 10 → không đổi.
    expect(leadInBeats(fakeTl([10.5]), 10.5, 3)).toBe(1.95);
    // Khoảng lặng dài → không đếm vào, quy tắc không áp.
    expect(leadInBeats(fakeTl([8]), 0, 3)).toBe(0);
  });

  it('mọi nhịp / khoảng lặng / điểm phát: click dẫn vào thật (planEvents) ≥ 2 tick, đều 1 beat, ngay trước nốt đầu', () => {
    for (const bar of [1, 2, 3, 4, 5, 6, 7, 12]) {
      for (const gap of [0, 0.25, 0.5, 0.75, 1, 1.5, 2, 2.75, 3.5]) {
        for (const from of [0, 0.37, 4, 10.5]) {
          const first = from + gap;
          const tl = makeTl([first, first + 1], bar);
          const n = leadInBeats(tl, from, bar);
          const where = `bar ${bar}, gap ${gap}, from ${from}: đếm vào ${n}`;
          // Không bao giờ dài hơn đếm vào cũ (1 ô nhịp).
          expect(n, where).toBeLessThanOrEqual(bar);
          if (n === 0) {
            // Không đếm vào chỉ khi khoảng lặng đủ dài (≥ 0,65 / 0,35 ô nhịp).
            expect(gap, where).toBeGreaterThanOrEqual((0.65 / 0.35) * bar - 1e-6);
            continue;
          }
          // Quãng nốt đầu đi: 0,65 × cũ, hoặc dài hơn chỉ để đủ 2 tick.
          expect(n + gap, where).toBeGreaterThanOrEqual(LEAD_IN_TRAVEL_RATIO * (bar + gap) - 1e-6);
          const start = from - n;
          const snap: TransportSnapshot = {
            playing: true,
            anchorTime: 0,
            anchorBeat: start,
            bpm: 120,
            epoch: 1,
            loop: null,
            countIn: { start, end: from },
            segmentStart: from,
            endBeat: 1000,
          };
          const clicks = planEvents(tl, snap, start, first, { metronome: false })
            .filter((e) => e.type === 'click')
            .map((e) => e.beat + 0); // −0 → 0
          // Ô nhịp ≥ 2 beat: ≥ 2 tick (1/4 chỉ có 1 beat — như trước v1.0.1).
          if (bar >= 2) {
            expect(clicks.length, `${where} → click ${clicks.join(', ')}`).toBeGreaterThanOrEqual(
              2,
            );
          }
          // Tick cuối là beat nguyên ngay trước nốt đầu; các tick cách nhau đúng 1 beat.
          expect(clicks.at(-1), where).toBe(Math.ceil(first - 1e-6) - 1);
          clicks.forEach((b, i) => i > 0 && expect(b - clicks[i - 1], where).toBe(1));
          // Bài 4/4 trở lên không bao giờ bị nới.
          if (bar >= 4) expect(n + gap, where).toBeCloseTo(LEAD_IN_TRAVEL_RATIO * (bar + gap), 6);
        }
      }
    }
  });

  it('quãng nốt đầu đi = 0,65 × quãng cũ (ô nhịp + khoảng lặng trước nốt)', () => {
    for (const gap of [0, 0.5, 1, 2.75, 4, 7]) {
      const tl = fakeTl([10 + gap]);
      const n = leadInBeats(tl, 10, 4);
      // quãng mới = đếm vào + khoảng lặng
      expect(n + gap).toBeCloseTo(LEAD_IN_TRAVEL_RATIO * (4 + gap), 6);
    }
  });

  it('khoảng lặng ≥ 0,65 / 0,35 ô nhịp → không đếm vào (không bỏ qua phần nào của bài)', () => {
    const limit = (LEAD_IN_TRAVEL_RATIO / (1 - LEAD_IN_TRAVEL_RATIO)) * 4; // ≈ 7,43 beat
    expect(leadInBeats(fakeTl([limit + 0.01]), 0, 4)).toBe(0);
    expect(leadInBeats(fakeTl([16]), 0, 4)).toBe(0);
    expect(leadInBeats(fakeTl([limit - 0.5]), 0, 4)).toBeGreaterThan(0);
  });

  it('không còn nốt phía trước → 0,65 ô nhịp; đếm vào tắt (bar ≤ 0 / NaN) → 0', () => {
    expect(leadInBeats(fakeTl([0]), 5, 4)).toBe(2.6);
    expect(leadInBeats(fakeTl([0]), 0, 0)).toBe(0);
    expect(leadInBeats(fakeTl([0]), 0, Number.NaN)).toBe(0);
  });

  it('phát giữa nốt: nốt đang ngân (bắt đầu trước `from`) không tính — lấy nốt kế', () => {
    const tl = fakeTl([4, 6]);
    // from = 4.5 → nốt kế ở 6: khoảng lặng 1,5 → 2,6 − 0,525 = 2,075
    expect(leadInBeats(tl, 4.5, 4)).toBe(2.075);
  });

  it('bài mẫu: Quốc ca 6,75 → 4,3875 beat (đếm vào 1,6375); TAKEDISKRUSH 4 → 2,6 beat', () => {
    const qc = timelineOf(quocCa);
    expect(qc.beatsPerBar).toBe(4);
    expect(firstNoteStartFrom(qc, 0)).toBe(2.75);
    const nQc = leadInBeats(qc, 0, qc.beatsPerBar);
    expect(nQc).toBe(1.6375);
    expect(nQc + 2.75).toBeCloseTo(0.65 * 6.75, 9);
    const tdk = timelineOf(takedisk);
    expect(firstNoteStartFrom(tdk, 0)).toBe(0);
    expect(leadInBeats(tdk, 0, tdk.beatsPerBar)).toBe(2.6);
  });

  it('playStartBeat chuẩn hóa như Transport.play', () => {
    expect(playStartBeat(undefined, 3, 10)).toBe(3);
    expect(playStartBeat(5, 3, 10)).toBe(5);
    expect(playStartBeat(-1, 3, 10)).toBe(0);
    expect(playStartBeat(undefined, 10, 10)).toBe(0);
    expect(playStartBeat(Number.NaN, 3, 10)).toBe(0);
  });
});

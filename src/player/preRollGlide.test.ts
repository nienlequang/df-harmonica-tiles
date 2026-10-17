import { describe, expect, it } from 'vitest';
import { PRE_ROLL_GLIDE_SEC, PreRollGlide } from './preRollGlide';

const G = PRE_ROLL_GLIDE_SEC;

describe('PreRollGlide (D-389)', () => {
  it('đứng yên → pre-roll: khung đầu vẫn là khung đứng yên, trượt đơn điệu về pre-roll trong PRE_ROLL_GLIDE_SEC', () => {
    const g = new PreRollGlide();
    expect(g.beatFor(0, 'idle', 0, 10)).toBe(0);
    expect(g.active).toBe(false);
    // Bấm Phát (đếm ngược): đích = -4, khung đầu = 0 (không nhảy).
    expect(g.beatFor(-4, 'pre', 4, 10.01)).toBe(0);
    expect(g.active).toBe(true);
    let prev = 0;
    for (let t = 0.03; t < G; t += 0.03) {
      const b = g.beatFor(-4, 'pre', 4, 10.01 + t);
      expect(b).toBeLessThanOrEqual(prev);
      expect(b).toBeGreaterThan(-4);
      prev = b;
    }
    expect(g.beatFor(-4, 'pre', 4, 10.01 + G)).toBe(-4);
    expect(g.active).toBe(false);
    // Hết đếm ngược → đếm vào chạy từ đúng khung đó: không trượt thêm.
    expect(g.beatFor(-4, 'countIn', 4, 13)).toBe(-4);
    expect(g.beatFor(-3.9, 'countIn', 4, 13.05)).toBe(-3.9);
    expect(g.active).toBe(false);
  });

  it('nửa đường smoothstep: đúng giữa hai khung', () => {
    const g = new PreRollGlide();
    g.beatFor(2, 'idle', 0, 0);
    g.beatFor(-2, 'pre', 4, 1);
    expect(g.beatFor(-2, 'pre', 4, 1 + G / 2)).toBeCloseTo(0, 9);
  });

  it('đếm ngược = Tắt (đứng yên → đếm vào đang chạy): phần bù mờ dần trên beat đang chạy, hết trượt thì đúng beat transport', () => {
    const g = new PreRollGlide();
    g.beatFor(0, 'idle', 0, 0);
    // Khung đầu sau khi bấm: transport ở -4 + một chút, vẽ vẫn ≈ khung đứng yên.
    expect(g.beatFor(-3.98, 'countIn', 4, 0.016)).toBeCloseTo(0, 9);
    const mid = g.beatFor(-3.8, 'countIn', 4, 0.016 + G / 2);
    expect(mid).toBeCloseTo(-3.8 + 3.98 / 2, 9);
    expect(g.beatFor(-3.4, 'countIn', 4, 0.016 + G)).toBe(-3.4);
  });

  it('hủy đếm ngược (pre-roll → đứng yên) và dừng giữa lúc đếm vào → trượt ngược về điểm bắt đầu', () => {
    const g = new PreRollGlide();
    g.beatFor(-4, 'pre', 4, 0);
    expect(g.beatFor(0, 'idle', 0, 1)).toBe(-4);
    expect(g.beatFor(0, 'idle', 0, 1 + G)).toBe(0);
    g.beatFor(-4, 'pre', 4, 2);
    g.beatFor(-4, 'pre', 4, 2 + G);
    for (let b = -4; b <= -2.5; b += 0.25) g.beatFor(b, 'countIn', 4, 7 + b);
    expect(g.active).toBe(false);
    expect(g.beatFor(0, 'idle', 0, 4.6)).toBe(-2.5);
    expect(g.beatFor(0, 'idle', 0, 4.6 + G)).toBe(0);
  });

  it('đang trượt mà lại đổi hướng (hủy ngay sau khi bấm) → trượt tiếp từ chỗ đang vẽ, không nhảy', () => {
    const g = new PreRollGlide();
    g.beatFor(0, 'idle', 0, 0);
    g.beatFor(-4, 'pre', 4, 0.01);
    const at = g.beatFor(-4, 'pre', 4, 0.01 + G / 2);
    expect(at).toBeCloseTo(-2, 9);
    expect(g.beatFor(0, 'idle', 0, 0.2)).toBeCloseTo(at, 9);
    expect(g.beatFor(0, 'idle', 0, 0.2 + G)).toBe(0);
  });

  it('không trượt: chơi lại / dừng từ giữa bài, nhảy xa hơn một ô nhịp, đếm vào tắt, pre-roll → đếm vào', () => {
    const g = new PreRollGlide();
    g.beatFor(9, 'play', 0, 0);
    // Chơi lại khi đang phát: nhảy thẳng về pre-roll của đầu bài.
    expect(g.beatFor(-4, 'pre', 4, 0.02)).toBe(-4);
    expect(g.active).toBe(false);
    // Đứng yên giữa bài (beat 10) → Chơi lại (pre-roll đầu bài): xa hơn một ô nhịp → nhảy.
    g.beatFor(10, 'idle', 0, 1);
    expect(g.beatFor(-4, 'pre', 4, 1.02)).toBe(-4);
    expect(g.active).toBe(false);
    // Đếm vào tắt: không có khoảng nào để trượt.
    g.beatFor(3, 'idle', 0, 2);
    expect(g.beatFor(3, 'play', 0, 2.02)).toBe(3);
    expect(g.active).toBe(false);
    // Dừng giữa bài: khung đứng yên đúng chỗ dừng.
    expect(g.beatFor(3.5, 'idle', 0, 2.5)).toBe(3.5);
    expect(g.active).toBe(false);
  });

  it('đang trượt mà vị trí nhảy thật (tua / đổi dòng) → bỏ phần bù', () => {
    const g = new PreRollGlide();
    g.beatFor(-4, 'pre', 4, 0);
    g.beatFor(0, 'idle', 0, 0.01);
    expect(g.active).toBe(true);
    expect(g.beatFor(8, 'idle', 0, 0.05)).toBe(8);
    expect(g.active).toBe(false);
  });

  it('reset: khung kế vẽ thẳng (attach lại)', () => {
    const g = new PreRollGlide();
    g.beatFor(0, 'idle', 0, 0);
    g.reset();
    expect(g.beatFor(-4, 'pre', 4, 0.01)).toBe(-4);
    expect(g.active).toBe(false);
  });

  it('đồng hồ lùi / NaN không kẹt trượt mãi', () => {
    const g = new PreRollGlide();
    g.beatFor(0, 'idle', 0, 5);
    g.beatFor(-4, 'pre', 4, 5);
    expect(g.beatFor(-4, 'pre', 4, 4)).toBe(0);
    expect(g.beatFor(-4, 'pre', 4, Number.NaN)).toBe(-4);
    expect(g.active).toBe(false);
  });
});

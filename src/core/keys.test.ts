import { describe, expect, it } from 'vitest';
import {
  GAME_SCROLL_DIR,
  KEY_DEGREE,
  keyChoicesForMidi,
  midiName,
  noteMidi,
  playableRange,
} from './keys';

describe('keys', () => {
  it('Z = C4 by default, modifiers shift octave / semitone', () => {
    expect(noteMidi('Z', 0, false)).toBe(60);
    expect(noteMidi('Z', -1, false)).toBe(48);
    expect(noteMidi(',', 1, false)).toBe(84);
    expect(noteMidi('N', 0, true, 4, 1)).toBe(70);
    expect(noteMidi('M', 0, true, 4, -1)).toBe(70);
    expect(noteMidi('Z', 0, false, 3)).toBe(48);
  });

  it('playable range is C3..C6 for base octave 4', () => {
    expect(playableRange()).toEqual({ min: 48, max: 84 });
    expect(midiName(48)).toBe('C3');
    expect(midiName(84)).toBe('C6');
  });

  it('lists every way to play a pitch, plain choices first', () => {
    const c5 = keyChoicesForMidi(72);
    expect(c5[0]).toEqual({ key: ',', octave: 0, sharp: false });
    expect(c5).toContainEqual({ key: 'Z', octave: 1, sharp: false });
    expect(KEY_DEGREE[',']).toBe('1̇');
  });

  it('Nửa Cung of the game is fixed sharp (+1): GAME_SCROLL_DIR', () => {
    expect(GAME_SCROLL_DIR).toBe(1);
    // Z + Nửa Cung = C#4 trong game
    expect(noteMidi('Z', 0, true, 4, GAME_SCROLL_DIR)).toBe(61);
  });
});

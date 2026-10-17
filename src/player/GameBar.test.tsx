import { render, screen, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { KEY_DEGREE, NOTE_KEYS } from '../core/keys';
import type { MobileCue, MobileOctaveMode } from '../core/mobile';
import type { Modifiers, NoteKey } from '../core/types';
import { useSettings } from '../ui/settings';
import { GameBar, activeModifiers } from './GameBar';
import { HoldBanner, holdBannerKey } from './HoldBanner';
import type { MobileUiState } from './mobilePlan';

const mods = (p: Partial<Modifiers> = {}): Modifiers => ({
  left: false,
  right: false,
  scroll: false,
  ...p,
});
const note = (key: NoteKey, m: Partial<Modifiers> = {}) => ({ key, modifiers: mods(m) });

function bar(container: HTMLElement) {
  const group = within(container).getByRole('group', { name: 'Gợi ý phím như trong game' });
  const keyCell = (k: NoteKey) => group.querySelector(`[data-key="${k}"]`);
  const mod = (id: keyof Modifiers) => group.querySelector(`[data-mod="${id}"]`);
  const activeKeys = () =>
    Array.from(group.querySelectorAll('.gb-key[aria-current="true"]')).map(
      (el) => (el as HTMLElement).dataset.key,
    );
  const activeMods = () =>
    Array.from(group.querySelectorAll('.gb-mod[aria-current="true"]')).map(
      (el) => (el as HTMLElement).dataset.mod,
    );
  return { group, keyCell, mod, activeKeys, activeMods };
}

describe('GameBar', () => {
  beforeEach(() => useSettings.getState().reset());

  it('renders the number row, the 8 keycaps in lane order and the modifier row', () => {
    const { container } = render(<GameBar note={null} run={null} />);
    const { group, activeKeys, activeMods } = bar(container);
    const caps = Array.from(group.querySelectorAll('kbd')).map((k) => k.textContent);
    expect(caps).toEqual([...NOTE_KEYS]);
    // Chữ đọc được (screen reader): bậc gốc, kể cả "1̇".
    const spoken = (d: Element): string =>
      d.querySelector('.sr-only')?.textContent ?? d.textContent ?? '';
    const degrees = Array.from(group.querySelectorAll('.gb-degree')).map(spoken);
    expect(degrees).toEqual(NOTE_KEYS.map((k) => KEY_DEGREE[k]));
    expect(degrees.at(-1)).toBe('1̇');
    // Hiển thị: "1" + chấm CSS (không dùng dấu kết hợp U+0307 — font hệ thống đặt lệch sang phải).
    const high = group.querySelector('[data-key=","] .gb-degree-dot');
    expect(high?.textContent).toBe('1');
    expect(high?.getAttribute('aria-hidden')).toBe('true');
    // Thứ tự như trong game: Cúi Xuống [chuột trái] | Nửa Cung [scroll] | Ngẩng Lên [chuột phải]
    const modText = Array.from(group.querySelectorAll('.gb-mod')).map((m) => m.textContent);
    expect(modText).toEqual([
      'Cúi Xuống [chuột trái]',
      'Nửa Cung [scroll]',
      'Ngẩng Lên [chuột phải]',
    ]);
    expect(group.querySelectorAll('.gb-sep')).toHaveLength(2);
    expect(activeKeys()).toEqual([]);
    expect(activeMods()).toEqual([]);
  });

  it('lights only the key of the note at the hit line, toned by its modifier', () => {
    const { container, rerender } = render(<GameBar note={note('N')} run={null} />);
    const b = bar(container);
    expect(b.activeKeys()).toEqual(['N']);
    expect(b.keyCell('N')?.className).toContain('gb-tone-normal');
    expect(b.activeMods()).toEqual([]);

    rerender(
      <GameBar note={note(',', { right: true })} run={{ modifiers: mods({ right: true }) }} />,
    );
    expect(b.activeKeys()).toEqual([',']);
    expect(b.keyCell(',')?.className).toContain('gb-tone-right');
    expect(b.activeMods()).toEqual(['right']);
    expect(b.mod('right')?.className).toContain('is-active');
    expect(b.mod('left')?.className).not.toContain('is-active');
  });

  it('lights modifiers needed by the note OR by the active hold run', () => {
    const { container, rerender } = render(
      <GameBar note={note('Z', { left: true })} run={{ modifiers: mods({ scroll: true }) }} />,
    );
    const b = bar(container);
    expect(b.activeMods().sort()).toEqual(['left', 'scroll']);
    expect(b.keyCell('Z')?.className).toContain('gb-tone-left');

    // Run đang chạy nhưng không có nốt ngay hit line: vẫn sáng modifier của run.
    rerender(<GameBar note={null} run={{ modifiers: mods({ right: true, scroll: true }) }} />);
    expect(b.activeKeys()).toEqual([]);
    expect(b.activeMods().sort()).toEqual(['right', 'scroll']);

    // Chỉ scroll → tile xanh lá.
    rerender(<GameBar note={note('V', { scroll: true })} run={null} />);
    expect(b.keyCell('V')?.className).toContain('gb-tone-scroll');
    expect(b.activeMods()).toEqual(['scroll']);
  });

  it('each new note re-triggers the keycap, even on the same key (X X X…)', () => {
    const { container, rerender } = render(<GameBar note={note('X')} noteId={1} run={null} />);
    const cap = () => container.querySelector('[data-key="X"] kbd');
    const first = cap();
    expect(first?.closest('.gb-key')?.className).toContain('is-active');
    // cùng nốt (re-render vì lý do khác) → giữ nguyên phần tử, không nháy lại
    rerender(<GameBar note={note('X')} noteId={1} run={null} />);
    expect(cap()).toBe(first);
    // nốt kế cùng phím → keycap mới (animation "nhấn" chạy lại)
    rerender(<GameBar note={note('X')} noteId={2} run={null} />);
    const second = cap();
    expect(second).not.toBe(first);
    expect(second?.closest('.gb-key')?.className).toContain('is-active');
    rerender(<GameBar note={note('X')} noteId={3} run={null} />);
    expect(cap()).not.toBe(second);
  });

  it('light theme: the lit keycap of a normal note contrasts ≥ 3:1 with unlit keycaps', () => {
    const css = readFileSync('src/player/player.css', 'utf8');
    const rule = /:root\[data-theme='light'\] \.gb-tone-normal kbd\.gb-cap \{([^}]*)\}/.exec(css);
    expect(rule).not.toBeNull();
    const bg = /background:\s*(#[0-9a-f]{6})/i.exec(rule![1])![1];
    const lum = (hex: string): number => {
      const n = parseInt(hex.slice(1), 16);
      const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
        const x = v / 255;
        return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    };
    const ratio = (a: string, b: string): number => {
      const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m);
      return (x + 0.05) / (y + 0.05);
    };
    // --surface-3 của theme sáng (keycap chưa sáng) và --surface/-2 (nền game bar)
    for (const unlit of ['#e1e6ee', '#eef1f6', '#ffffff']) {
      expect(ratio(bg, unlit)).toBeGreaterThanOrEqual(3);
    }
  });

  it('practice: pressed keys / modifiers get their own style, separate from the expected highlight', () => {
    const pressed = { keys: ['Z', 'N'] as NoteKey[], left: false, right: true, scroll: false };
    const { container, rerender } = render(
      <GameBar note={note('N', { right: true })} run={null} pressed={pressed} />,
    );
    const b = bar(container);
    const n = b.keyCell('N') as HTMLElement;
    const z = b.keyCell('Z') as HTMLElement;
    // N vừa cần bấm vừa đang bấm; Z chỉ đang bấm (không sáng kiểu "cần bấm").
    expect(n.className).toContain('is-active');
    expect(n.className).toContain('is-pressed');
    expect(z.className).toContain('is-pressed');
    expect(z.className).not.toContain('is-active');
    expect(z.dataset.pressed).toBe('true');
    expect(b.activeKeys()).toEqual(['N']);
    expect((b.mod('right') as HTMLElement).dataset.pressed).toBe('true');
    expect(b.mod('left')?.className).not.toContain('is-pressed');

    rerender(<GameBar note={note('N', { right: true })} run={null} pressed={null} />);
    expect(container.querySelectorAll('.is-pressed')).toHaveLength(0);
    expect(container.querySelectorAll('[data-pressed]')).toHaveLength(0);
  });

  it('follows the UI language', () => {
    useSettings.getState().set({ language: 'en' });
    render(<GameBar note={null} run={null} />);
    const group = screen.getByRole('group', { name: 'Key hints like in the game' });
    expect(group.textContent).toContain('Crouch [left mouse]');
    expect(group.textContent).toContain('Look Up [right mouse]');
  });

  it('activeModifiers merges note and run', () => {
    expect(activeModifiers(null, null)).toEqual(mods());
    expect(
      activeModifiers(note('Z', { left: true }), { modifiers: mods({ scroll: true }) }),
    ).toEqual(mods({ left: true, scroll: true }));
  });
});

describe('HoldBanner', () => {
  beforeEach(() => useSettings.getState().reset());

  it('keeps an empty slot when nothing is held', () => {
    const { container } = render(<HoldBanner modifiers={null} />);
    const slot = container.querySelector('.hold-banner-slot');
    expect(slot).not.toBeNull();
    expect(slot?.textContent).toBe('');
  });

  it('shows "ĐANG GIỮ: …" colored by modifier, combos with a # badge', () => {
    const { container, rerender } = render(<HoldBanner modifiers={mods({ right: true })} />);
    const banner = () => container.querySelector('.hold-banner');
    expect(banner()?.textContent).toBe('ĐANG GIỮ: CHUỘT PHẢI');
    expect(banner()?.className).toContain('hold-banner-right');

    rerender(<HoldBanner modifiers={mods({ left: true, scroll: true })} />);
    expect(banner()?.textContent).toContain('ĐANG GIỮ: CHUỘT TRÁI + SCROLL');
    expect(banner()?.className).toContain('hold-banner-left');
    expect(banner()?.className).toContain('hold-banner-combo');
    expect(container.querySelector('.hold-banner-badge')?.textContent).toBe('#');

    rerender(<HoldBanner modifiers={mods({ scroll: true })} />);
    expect(banner()?.textContent).toBe('ĐANG GIỮ: SCROLL');
    expect(banner()?.className).toContain('hold-banner-scroll');
    expect(container.querySelector('.hold-banner-badge')).toBeNull();
  });

  it('holdBannerKey maps every combination', () => {
    expect(holdBannerKey(mods())).toBeNull();
    expect(holdBannerKey(mods({ left: true }))).toBe('mod.bannerLeft');
    expect(holdBannerKey(mods({ right: true }))).toBe('mod.bannerRight');
    expect(holdBannerKey(mods({ scroll: true }))).toBe('mod.bannerScroll');
    expect(holdBannerKey(mods({ left: true, scroll: true }))).toBe('mod.bannerLeftScroll');
    expect(holdBannerKey(mods({ right: true, scroll: true }))).toBe('mod.bannerRightScroll');
  });

  it('mobile: always shows the selected mode and the Nửa Cung state; "SẮP CHẠM" before a cue', () => {
    const { container, rerender } = render(<HoldBanner modifiers={null} scheme="mobile" />);
    const banner = () => container.querySelector('.hold-banner');
    // Mặc định (đầu bài): Ngẩng Tự Nhiên, Nửa Cung tắt — banner luôn hiện, không "ĐANG GIỮ".
    expect(banner()?.textContent).toBe('CHẾ ĐỘ: Ngẩng Tự Nhiên · Nửa Cung: TẮT');
    expect(banner()?.className).toContain('hold-banner-natural');

    rerender(
      <HoldBanner
        modifiers={mods({ left: true })}
        scheme="mobile"
        mobile={mobileState(-1, true)}
      />,
    );
    expect(banner()?.textContent).toBe('CHẾ ĐỘ: Cúi Xuống · Nửa Cung: BẬT');
    expect(banner()?.className).toContain('hold-banner-left');
    expect(banner()?.className).toContain('hold-banner-combo');
    expect(container.querySelector('.hold-banner-next')).toBeNull();

    rerender(
      <HoldBanner
        modifiers={null}
        scheme="mobile"
        mobile={mobileState(-1, true, [octaveCue(8, 1), semitoneCue(8, false)], true)}
      />,
    );
    expect(container.querySelector('.hold-banner-next')?.textContent).toBe(
      'SẮP CHẠM: Ngẩng Lên + Nửa Cung',
    );
    // Chưa tới ~1 beat → chưa nhắc.
    rerender(
      <HoldBanner
        modifiers={null}
        scheme="mobile"
        mobile={mobileState(0, true, [octaveCue(8, 1)], false)}
      />,
    );
    expect(container.querySelector('.hold-banner-next')).toBeNull();
    expect(banner()?.className).toContain('hold-banner-scroll');
  });

  it('mobile banner uses the custom button names; PC banner keeps the mouse names', () => {
    useSettings.getState().set({
      labelOverrides: { left: 'Nút A', right: '', natural: 'Giữa', scroll: 'Thăng' },
    });
    const { container, rerender } = render(
      <HoldBanner
        modifiers={null}
        scheme="mobile"
        mobile={mobileState(0, false, [octaveCue(2, -1)], true)}
      />,
    );
    expect(container.querySelector('.hold-banner-text')?.textContent).toBe(
      'CHẾ ĐỘ: Giữa · Thăng: TẮT',
    );
    expect(container.querySelector('.hold-banner-next')?.textContent).toBe('SẮP CHẠM: Nút A');
    rerender(<HoldBanner modifiers={mods({ right: true })} />);
    expect(container.querySelector('.hold-banner')?.textContent).toBe('ĐANG GIỮ: CHUỘT PHẢI');
  });
});

// ---------------------------------------------------------------------------
// Mobile + tên gọi tùy chỉnh
// ---------------------------------------------------------------------------

function octaveCue(beat: number, mode: MobileOctaveMode): MobileCue {
  return { beat, noteIndex: 0, kind: 'octave', mode };
}
function semitoneCue(beat: number, on: boolean): MobileCue {
  return { beat, noteIndex: 0, kind: 'semitone', on };
}
function mobileState(
  mode: MobileOctaveMode,
  semitoneOn: boolean,
  nextCues: MobileCue[] = [],
  cueSoon = false,
): MobileUiState {
  return { mode, semitoneOn, nextCues, cueSoon };
}

describe('GameBar — custom names and mobile layout', () => {
  beforeEach(() => useSettings.getState().reset());

  /** Chữ hiển thị của nút số: chữ số + số chấm (trên/dưới). */
  const digitOf = (cell: Element | null) => ({
    digit: cell?.querySelector('.jp-digit')?.textContent,
    above: cell?.querySelectorAll('.jp-dots-above .jp-dot').length ?? 0,
    below: cell?.querySelectorAll('.jp-dots-below .jp-dot').length ?? 0,
  });

  it('PC: the modifier row uses the names set in Settings', () => {
    useSettings
      .getState()
      .set({ labelOverrides: { left: 'Nút A', right: '', natural: '', scroll: 'S' } });
    const { container } = render(<GameBar note={null} run={null} />);
    const modText = Array.from(container.querySelectorAll('.gb-mod')).map((m) => m.textContent);
    expect(modText).toEqual(['Nút A [chuột trái]', 'S [scroll]', 'Ngẩng Lên [chuột phải]']);
  });

  it('mobile: 4 round mode buttons in game order, 8 digit buttons, no Z X C keycaps', () => {
    const { container } = render(<GameBar note={null} run={null} scheme="mobile" />);
    const group = within(container).getByRole('group', { name: 'Gợi ý phím như trong game' });
    expect(group.querySelectorAll('kbd')).toHaveLength(0);
    const names = Array.from(group.querySelectorAll('.gbm-mode-name')).map((n) => n.textContent);
    expect(names).toEqual(['Nửa Cung', 'Ngẩng Lên', 'Ngẩng Tự Nhiên', 'Cúi Xuống']);
    // Mặc định: Ngẩng Tự Nhiên đang chọn, Nửa Cung tắt.
    const selected = Array.from(group.querySelectorAll('.gbm-mode.is-selected')).map(
      (el) => (el as HTMLElement).dataset.mode,
    );
    expect(selected).toEqual(['natural']);
    const digits = NOTE_KEYS.map((k) => digitOf(group.querySelector(`[data-key="${k}"]`)));
    expect(digits.map((d) => d.digit)).toEqual(['1', '2', '3', '4', '5', '6', '7', '1']);
    expect(digits.map((d) => d.above)).toEqual([0, 0, 0, 0, 0, 0, 0, 1]);
    expect(digits.map((d) => d.below)).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
    // Screen reader đọc chữ số + dấu chấm kết hợp.
    expect(group.querySelector('[data-key=","] .sr-only')?.textContent).toBe('1̇');
  });

  it('mobile: digit dots follow the selected mode (−1: 1̣…7̣ 1 · +1: 1̇…7̇ 1̈)', () => {
    const { container, rerender } = render(
      <GameBar note={null} run={null} scheme="mobile" mobile={mobileState(-1, false)} />,
    );
    const all = () => NOTE_KEYS.map((k) => digitOf(container.querySelector(`[data-key="${k}"]`)));
    expect(all().map((d) => d.below)).toEqual([1, 1, 1, 1, 1, 1, 1, 0]);
    expect(all().map((d) => d.above)).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
    expect(container.querySelector('.gbm-mode-left')?.className).toContain('is-selected');

    rerender(<GameBar note={null} run={null} scheme="mobile" mobile={mobileState(1, true)} />);
    expect(all().map((d) => d.above)).toEqual([1, 1, 1, 1, 1, 1, 1, 2]);
    expect(all().map((d) => d.below)).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
    const selected = Array.from(container.querySelectorAll('.gbm-mode.is-selected')).map(
      (el) => (el as HTMLElement).dataset.mode,
    );
    expect(selected).toEqual(['scroll', 'right']);
  });

  it('mobile: the button to tap pulses only when the cue is near; the active digit lights by tone', () => {
    const cues = [octaveCue(4, 0), semitoneCue(4, true)];
    const { container, rerender } = render(
      <GameBar
        note={note('N', { left: true })}
        noteId={2}
        run={null}
        scheme="mobile"
        mobile={mobileState(-1, false, cues, false)}
      />,
    );
    expect(container.querySelectorAll('.gbm-mode.is-cue')).toHaveLength(0);
    rerender(
      <GameBar
        note={note('N', { left: true })}
        noteId={2}
        run={null}
        scheme="mobile"
        mobile={mobileState(-1, false, cues, true)}
      />,
    );
    const cued = Array.from(container.querySelectorAll('.gbm-mode.is-cue')).map(
      (el) => (el as HTMLElement).dataset.mode,
    );
    expect(cued).toEqual(['scroll', 'natural']);
    const n = container.querySelector('[data-key="N"]') as HTMLElement;
    expect(n.getAttribute('aria-current')).toBe('true');
    expect(n.className).toContain('gb-tone-left');
  });

  it('mobile: names come from Settings; practice presses map to the mode buttons', () => {
    useSettings.getState().set({
      labelOverrides: { left: 'A', right: 'B', natural: 'C', scroll: 'D' },
    });
    const pressed = { keys: ['Z'] as NoteKey[], left: true, right: false, scroll: false };
    const { container } = render(
      <GameBar note={null} run={null} scheme="mobile" pressed={pressed} />,
    );
    const names = Array.from(container.querySelectorAll('.gbm-mode-name')).map(
      (n) => n.textContent,
    );
    expect(names).toEqual(['D', 'B', 'C', 'A']);
    expect(container.querySelector('.gbm-mode-left')?.className).toContain('is-pressed');
    expect((container.querySelector('[data-key="Z"]') as HTMLElement).dataset.pressed).toBe('true');
  });
});

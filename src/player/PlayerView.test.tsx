/**
 * PlayerView với parser + seed thật (library). Canvas getContext → null (renderer bỏ qua),
 * rAF chạy tay, audio engine mock (không cần AudioContext).
 */
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildTimeline } from '../core/timeline';
import { getSong, useLibrary } from '../library/store';
import { closeFloatingWindow } from '../pip/FloatingWindow';
import { createFakePipWindow } from '../pip/testing/fakePipWindow';
import { href, paths } from '../ui/router';
import { useSettings } from '../ui/settings';

import { PlayerView } from './PlayerView';
import FIXTURE_SONG from '../test/fixtures/bai-thu-nhip-dieu.harm?raw';

vi.mock('../audio/engine', () => ({
  isAudioSupported: () => false,
  getAudioEngine: () => {
    throw new Error('audio engine must not be used when unsupported');
  },
  UNLOCK_TIMEOUT_MS: 1000,
}));

// Cờ tính năng (D-060) đổi được trong từng test.
const flags = vi.hoisted(() => ({ editor: false, share: false, midiImport: false }));
vi.mock('../ui/features', () => ({ FEATURES: flags }));

// Bài tự soạn chỉ dùng cho test (src/test/fixtures/), thêm vào thư viện như bài user một lần: các test dưới ghim
// nội dung của nó (ĐOẠN 1 / ĐOẠN 2 / ĐIỆP KHÚC, 76 BPM, nốt đầu N ở beat 0).
const SEED = useLibrary.getState().addSong(FIXTURE_SONG);

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

function press(code: string, init: KeyboardEventInit = {}): void {
  act(() => {
    fireEvent.keyDown(window, { code, ...init });
    fireEvent.keyUp(window, { code, ...init });
  });
}

// Helper gọi rất nhiều lần: querySelector theo nhãn thay vì getByRole (tính accessible name trên cả
// DOM Player rất chậm trong jsdom → test chạm timeout khi cả suite chạy song song). Vai trò / tên
// truy cập được kiểm riêng trong test đầu tiên.
function bySelector<T extends Element>(selector: string): T {
  const el = document.querySelector<T>(selector);
  if (!el) throw new Error(`not found: ${selector}`);
  return el;
}
const seekBar = () =>
  bySelector<HTMLInputElement>('input[type="range"][aria-label="Vị trí trong bài"]');
const position = () => Number(seekBar().value);
const playButton = () => bySelector<HTMLButtonElement>('button.transport-play');

function seedTimeline() {
  const entry = getSong(SEED);
  if (!entry) throw new Error('seed missing');
  return buildTimeline(entry.parsed.song);
}

beforeEach(() => {
  frames = new Map();
  nextFrame = 1;
  raf.mockClear();
  caf.mockClear();
  vi.stubGlobal('requestAnimationFrame', raf);
  vi.stubGlobal('cancelAnimationFrame', caf);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => null);
  useSettings.getState().reset();
  // mặc định v4 đếm ngược 3 giây — test transport cần phát ngay
  useSettings.getState().set({ startDelaySec: 0 });
  window.location.hash = `#/play/${SEED}`;
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.location.hash = '';
});

describe('PlayerView', () => {
  it('renders the seed with title, BPM, section, game bar and transport', () => {
    render(<PlayerView songId={SEED} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Bài thử nhịp điệu' })).toBeTruthy();
    expect(document.querySelector('.player-chips')?.textContent).toContain('76 BPM');
    expect(document.querySelector('.player-chip-section')?.textContent).toBe('Đoạn: ĐOẠN 1');

    const bar = screen.getByRole('group', { name: 'Gợi ý phím như trong game' });
    const caps = Array.from(bar.querySelectorAll('kbd')).map((k) => k.textContent);
    expect(caps).toEqual(['Z', 'X', 'C', 'V', 'B', 'N', 'M', ',']);
    expect(bar.textContent).toContain('Cúi Xuống [chuột trái]');
    expect(bar.textContent).toContain('Nửa Cung [scroll]');
    expect(bar.textContent).toContain('Ngẩng Lên [chuột phải]');
    // Nốt đầu (N) đang ở hit line lúc beat 0.
    expect(bar.querySelector('[aria-current="true"]')?.getAttribute('data-key')).toBe('N');

    expect(screen.getByRole('group', { name: 'Điều khiển phát' })).toBeTruthy();
    // Helper querySelector trỏ đúng control có vai trò + tên truy cập.
    expect(screen.getByRole('button', { name: 'Phát' })).toBe(playButton());
    expect(screen.getByRole('slider', { name: 'Vị trí trong bài' })).toBe(seekBar());
    expect(screen.getByRole('img', { name: /Bài thử nhịp điệu/ })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Về thư viện' }).getAttribute('href')).toBe(
      href(paths.library()),
    );
    // Phase 1 chưa có Editor (D-060): không có lối vào #/edit.
    expect(screen.queryByRole('link', { name: 'Sửa bài "Bài thử nhịp điệu"' })).toBeNull();
    expect(document.querySelector('a[href^="#/edit"]')).toBeNull();
    // Section dropdown chỉ có section không rỗng.
    const select = screen.getByRole('combobox', { name: 'Nhảy tới đoạn' }) as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual([
      'ĐOẠN 1',
      'ĐOẠN 2',
      'ĐIỆP KHÚC',
    ]);
    // Không còn dải lời karaoke (góp ý 2026-10-15).
    expect(screen.queryByRole('region', { name: 'Lời bài hát' })).toBeNull();
    expect(document.querySelector('.lyrics')).toBeNull();
    expect(document.title).toContain('Bài thử nhịp điệu');
  });

  it('Space toggles play / pause', () => {
    render(<PlayerView songId={SEED} />);
    expect(playButton().getAttribute('aria-label')).toBe('Phát');
    press('Space', { key: ' ' });
    expect(playButton().getAttribute('aria-label')).toBe('Tạm dừng');
    expect(raf).toHaveBeenCalled();
    press('Space', { key: ' ' });
    expect(playButton().getAttribute('aria-label')).toBe('Phát');
    // Dừng giữa lúc đếm vào → vẫn ở đầu bài.
    expect(position()).toBe(0);
  });

  it('thanh dọc "Cửa sổ nổi" (PC): không hỗ trợ → một dòng giải thích; mở được → tạm dừng Player ở tab này', async () => {
    const { unmount } = render(<PlayerView songId={SEED} />);
    const pipBtn = () => bySelector<HTMLButtonElement>('.player-sidebar .pip-toggle');
    expect(screen.getByRole('button', { name: 'Cửa sổ nổi' })).toBe(pipBtn());
    fireEvent.click(pipBtn());
    expect(await screen.findByText(/dùng Chrome hoặc Edge trên máy tính/)).toBeTruthy();

    const fake = createFakePipWindow();
    const requestWindow = vi.fn(async () => fake.win);
    Object.defineProperty(window, 'documentPictureInPicture', {
      configurable: true,
      value: { requestWindow },
    });
    try {
      press('Space', { key: ' ' });
      expect(playButton().getAttribute('aria-label')).toBe('Tạm dừng');
      fireEvent.click(pipBtn());
      expect(requestWindow).toHaveBeenCalledTimes(1);
      await screen.findByRole('button', { name: 'Cửa sổ nổi', pressed: true });
      expect(pipBtn().getAttribute('title')).toBe('Đóng cửa sổ nổi');
      expect(playButton().getAttribute('aria-label')).toBe('Phát');
    } finally {
      act(() => closeFloatingWindow());
      delete (window as Window & { documentPictureInPicture?: unknown }).documentPictureInPicture;
      unmount();
    }
  });

  it('→ / ← seek by line, R restarts from 0 and plays', () => {
    const tl = seedTimeline();
    render(<PlayerView songId={SEED} />);
    expect(position()).toBe(0);
    press('ArrowRight');
    expect(position()).toBe(tl.lines[1].startBeat);
    press('ArrowRight');
    expect(position()).toBe(tl.lines[2].startBeat);
    press('ArrowLeft');
    expect(position()).toBe(tl.lines[1].startBeat);
    press('ArrowLeft');
    expect(position()).toBe(0);
    press('ArrowRight');
    press('KeyR');
    expect(position()).toBe(0);
    expect(playButton().getAttribute('aria-label')).toBe('Tạm dừng');
  });

  it('section dropdown seeks to the section start', () => {
    const tl = seedTimeline();
    render(<PlayerView songId={SEED} />);
    const select = screen.getByRole('combobox', { name: 'Nhảy tới đoạn' }) as HTMLSelectElement;
    act(() => {
      fireEvent.change(select, { target: { value: '2' } });
    });
    expect(position()).toBe(tl.sections[2].startBeat);
    expect(select.value).toBe('2');
    expect(document.querySelector('.player-chip-section')?.textContent).toBe('Đoạn: ĐIỆP KHÚC');
  });

  it('section dropdown: picking the section already shown restarts it (mouse)', () => {
    const tl = seedTimeline();
    render(<PlayerView songId={SEED} />);
    press('ArrowRight');
    press('ArrowRight');
    expect(position()).toBeGreaterThan(0);
    expect(document.querySelector('.player-chip-section')?.textContent).toBe('Đoạn: ĐOẠN 1');
    const select = screen.getByRole('combobox', { name: 'Nhảy tới đoạn' }) as HTMLSelectElement;
    expect(select.value).toBe('0');
    // Mở bằng chuột: vẫn hiện tên section hiện tại, nhưng chọn lại ĐOẠN 1 phải nhảy về đầu đoạn.
    act(() => {
      fireEvent.pointerDown(select);
    });
    expect(select.selectedOptions[0]?.textContent).toBe('ĐOẠN 1');
    act(() => {
      fireEvent.change(select, { target: { value: '0' } });
    });
    expect(position()).toBe(tl.sections[0].startBeat);
    expect(select.value).toBe('0');
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual([
      'ĐOẠN 1',
      'ĐOẠN 2',
      'ĐIỆP KHÚC',
    ]);
  });

  it('section dropdown opened with the mouse and closed without a pick does not swallow hotkeys', () => {
    const tl = seedTimeline();
    render(<PlayerView songId={SEED} />);
    const select = screen.getByRole('combobox', { name: 'Nhảy tới đoạn' }) as HTMLSelectElement;
    act(() => {
      select.focus();
      fireEvent.pointerDown(select);
    });
    // → khi focus còn ở <select>: nhảy dòng (phím tắt), không đổi section.
    act(() => {
      fireEvent.keyDown(select, { code: 'ArrowRight', key: 'ArrowRight' });
    });
    expect(position()).toBe(tl.lines[1].startBeat);
    expect(document.activeElement).not.toBe(select);
    act(() => {
      select.focus();
      fireEvent.pointerDown(select);
    });
    act(() => {
      fireEvent.keyDown(select, { code: 'Space', key: ' ' });
    });
    expect(playButton().getAttribute('aria-label')).toBe('Tạm dừng');
  });

  it('section dropdown focused from the keyboard keeps native keys (D-033)', () => {
    render(<PlayerView songId={SEED} />);
    const select = screen.getByRole('combobox', { name: 'Nhảy tới đoạn' }) as HTMLSelectElement;
    act(() => select.focus());
    act(() => {
      fireEvent.keyDown(select, { code: 'Space', key: ' ' });
    });
    expect(playButton().getAttribute('aria-label')).toBe('Phát');
    expect(document.activeElement).toBe(select);
  });

  it('the canvas sits directly in its box (no lyric strip above it)', () => {
    render(<PlayerView songId={SEED} />);
    const canvas = screen.getByRole('img', { name: /Bài thử nhịp điệu/ });
    expect(canvas.parentElement?.className).toBe('player-canvas-box');
    expect(canvas.parentElement?.parentElement?.firstElementChild).toBe(canvas.parentElement);
  });

  it('L sets A, then A–B, third press clears', () => {
    render(<PlayerView songId={SEED} />);
    const loopBtn = () => screen.getByRole('button', { name: /^Loop/ });
    expect(loopBtn().getAttribute('aria-pressed')).toBe('false');
    press('KeyL');
    expect(loopBtn().getAttribute('aria-pressed')).toBe('true');
    expect(loopBtn().textContent).toContain('A…');
    press('ArrowRight');
    press('KeyL');
    expect(loopBtn().textContent).toContain('A–B');
    expect(screen.getByText('Đang lặp dòng 1–2. Bấm lần nữa để tắt loop.')).toBeTruthy();
    press('KeyL');
    expect(loopBtn().getAttribute('aria-pressed')).toBe('false');
    expect(loopBtn().textContent).not.toContain('A');
  });

  it('] raises BPM by 2 and [ lowers it (override for this session)', () => {
    render(<PlayerView songId={SEED} />);
    const tempo = () => screen.getByRole('slider', { name: /Tempo/ }) as HTMLInputElement;
    expect(tempo().value).toBe('76');
    press('BracketRight');
    expect(tempo().value).toBe('78');
    expect(screen.getByText('78 BPM (gốc 76)')).toBeTruthy();
    press('BracketRight', { repeat: true }); // giữ phím: được lặp
    expect(tempo().value).toBe('80');
    press('BracketLeft');
    press('BracketLeft');
    expect(tempo().value).toBe('76');
    expect(screen.queryByText(/gốc 76/)).toBeNull();
    // Bài không bị đổi: settings/library không lưu tempo.
    expect(getSong(SEED)?.parsed.song.bpm).toBe(76);
  });

  it('lookahead slider (default 6) updates settings; no count-in / countdown / lyrics controls', () => {
    render(<PlayerView songId={SEED} />);
    // góp ý 2026-10-16: Đếm vào + Đếm ngược chỉ ở Cài đặt → Phát bài.
    expect(screen.queryByRole('button', { name: 'Đếm vào' })).toBeNull();
    expect(screen.queryByRole('combobox', { name: 'Đếm ngược' })).toBeNull();
    // không còn nút "Lời"
    expect(screen.queryByRole('button', { name: 'Lời' })).toBeNull();
    const look = screen.getByRole('slider', { name: /Lookahead/ }) as HTMLInputElement;
    expect(look.value).toBe('6');
    act(() => {
      fireEvent.change(look, { target: { value: '10' } });
    });
    expect(useSettings.getState().lookahead).toBe(10);
  });

  it('shortcuts help opens in a modal and suspends the hotkeys', () => {
    render(<PlayerView songId={SEED} />);
    act(() => screen.getByRole('button', { name: 'Phím tắt' }).click());
    const dialog = screen.getByRole('dialog', { name: 'Phím tắt của màn chơi' });
    expect(within(dialog).getByText('Phát / Tạm dừng')).toBeTruthy();
    press('Space', { key: ' ' });
    expect(playButton().getAttribute('aria-label')).toBe('Phát');
  });

  it('?line= opens at that line', () => {
    const tl = seedTimeline();
    window.location.hash = `#/play/${SEED}?line=2`;
    render(<PlayerView songId={SEED} />);
    expect(position()).toBe(tl.lines[2].startBeat);
  });

  it('switches to English', () => {
    useSettings.getState().set({ language: 'en' });
    render(<PlayerView songId={SEED} />);
    expect(screen.getByRole('button', { name: 'Play' })).toBeTruthy();
    expect(screen.getByRole('group', { name: 'Key hints like in the game' }).textContent).toContain(
      'Crouch [left mouse]',
    );
  });

  describe('songs written for a flat Nửa Cung (@scroll -1) — the game is always sharp', () => {
    const added: string[] = [];
    const addSong = (source: string): string => {
      const id = useLibrary.getState().addSong(source);
      added.push(id);
      return id;
    };
    afterEach(() => {
      for (const id of added.splice(0)) useLibrary.getState().removeSong(id);
    });

    it('chip only when the song has scroll notes and @scroll -1; fix via Tối ưu lại', () => {
      const flat = addSong('@title Giáng\n@scroll -1\nZ [S] X [/S] C\n');
      const { unmount } = render(<PlayerView songId={flat} />);
      const chip = document.querySelector('.player-chip-warning');
      expect(chip?.textContent).toContain('Nửa Cung: bài viết cho giáng (−1), game là thăng (+1)');
      expect(chip?.getAttribute('title')).toContain('Công cụ → Tối ưu lại cung / quãng');
      // Màn chơi không có nút "Sửa": gợi ý không được chỉ tới nút đó.
      expect(chip?.getAttribute('title')).not.toContain('Sửa →');
      unmount();
      // @scroll -1 nhưng không có nốt scroll → không cảnh báo
      const plain = addSong('@title Không nốt scroll\n@scroll -1\nZ X C\n');
      const second = render(<PlayerView songId={plain} />);
      expect(document.querySelector('.player-chip-warning')).toBeNull();
      second.unmount();
      // bài +1 có nốt scroll → không cảnh báo
      render(<PlayerView songId={addSong('@title Thăng\n@scroll +1\nZ [S] X [/S]\n')} />);
      expect(document.querySelector('.player-chip-warning')).toBeNull();
    });

    it('scroll-mismatch chip + tooltip use the custom Nửa Cung name (D-181)', () => {
      useSettings.getState().set({
        labelOverrides: { left: '', right: '', natural: '', scroll: 'Thăng' },
      });
      const flat = addSong('@title Giáng\n@scroll -1\nZ [S] X [/S]\n');
      render(<PlayerView songId={flat} />);
      const chip = document.querySelector('.player-chip-warning');
      expect(chip?.textContent).toContain('Thăng: bài viết cho giáng (−1), game là thăng (+1)');
      expect(chip?.getAttribute('title')).toContain('trong game Thăng luôn là thăng');
      expect(chip?.textContent).not.toContain('Nửa Cung');
    });
  });

  it('switching songs while mounted tears down the old player', () => {
    const { rerender } = render(<PlayerView songId={SEED} />);
    press('Space', { key: ' ' });
    expect(frames.size).toBe(1);
    const pending = Array.from(frames.keys())[0];
    rerender(<PlayerView songId="seed-takediskrush" />);
    expect(caf).toHaveBeenCalledWith(pending);
    expect(screen.getByRole('heading', { level: 1, name: 'TAKEDISKRUSH!' })).toBeTruthy();
    expect(playButton().getAttribute('aria-label')).toBe('Phát');
    expect(position()).toBe(0);
  });

  it('unknown id shows a friendly not-found message with a link home', () => {
    render(<PlayerView songId="khong-co-bai-nay" />);
    expect(screen.getByRole('heading', { name: 'Không tìm thấy bài hát' })).toBeTruthy();
    expect(screen.getByText(/khong-co-bai-nay/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Về thư viện' }).getAttribute('href')).toBe(
      href(paths.library()),
    );
  });

  it('unmount cancels the rAF loop and removes every window listener', () => {
    const add = vi.spyOn(window, 'addEventListener');
    const remove = vi.spyOn(window, 'removeEventListener');
    const { unmount } = render(<PlayerView songId={SEED} />);
    press('Space', { key: ' ' }); // đang phát → vòng rAF chạy
    for (let i = 0; i < 5; i++) {
      const list = Array.from(frames.values());
      frames.clear();
      act(() => list.forEach((cb) => cb(0)));
    }
    expect(frames.size).toBe(1);
    const pending = Array.from(frames.keys())[0];
    press('Space', { key: ' ' });
    press('Space', { key: ' ' });
    press('ArrowRight');
    unmount();
    expect(caf).toHaveBeenCalledWith(pending);
    expect(frames.size).toBe(0);

    const types = new Set(add.mock.calls.map((c) => c[0]));
    expect(types.has('keydown')).toBe(true);
    for (const type of types) {
      const added = add.mock.calls.filter((c) => c[0] === type).length;
      const removed = remove.mock.calls.filter((c) => c[0] === type).length;
      expect({ type, removed }).toEqual({ type, removed: added });
    }
    // Sau unmount phím tắt không còn tác dụng (không lỗi, không rAF mới).
    const before = raf.mock.calls.length;
    press('Space', { key: ' ' });
    expect(raf.mock.calls.length).toBe(before);
  });
});

describe('PlayerView — phase feature flags (D-060)', () => {
  const added: string[] = [];
  const addSong = (source: string): string => {
    const id = useLibrary.getState().addSong(source);
    added.push(id);
    return id;
  };

  afterEach(() => {
    flags.editor = false;
    for (const id of added.splice(0)) useLibrary.getState().removeSong(id);
  });

  it('without the editor: error chip is plain text with the first broken line, no edit links', () => {
    const id = addSong('@title Lỗi\nZ X Q\n');
    render(<PlayerView songId={id} />);
    const chip = document.querySelector('.player-chip-error');
    expect(chip?.tagName).toBe('SPAN');
    expect(chip?.textContent).toContain('1 lỗi cú pháp');
    const hint = chip?.getAttribute('title') ?? '';
    expect(hint).toContain('Xem dòng bị lỗi trên thẻ bài ở Thư viện');
    expect(hint).not.toContain('Mở Sửa');
    expect(hint).toContain('Dòng 2, cột 5: Token lạ: "Q"');
    expect(chip?.querySelector('.sr-only')?.textContent).toContain(hint);
    expect(document.querySelector('a[href^="#/edit"]')).toBeNull();
  });

  it('empty song without the editor shows the message but no "Open editor" button', () => {
    const id = addSong('@title Trống\n');
    render(<PlayerView songId={id} />);
    expect(screen.getByText('Bài này chưa có nốt nào để phát.')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Mở trình soạn' })).toBeNull();
  });

  it('with the editor flag on, the error chip link and empty-state button come back (no "Sửa" button)', () => {
    flags.editor = true;
    const broken = addSong('@title Lỗi\nZ X Q\nC V Q\n');
    const { unmount } = render(<PlayerView songId={broken} />);
    const chip = document.querySelector('.player-chip-error');
    expect(chip?.tagName).toBe('A');
    expect(chip?.getAttribute('href')).toBe(`#/edit/${broken}`);
    expect(chip?.textContent).toBe('2 lỗi cú pháp');
    expect(chip?.getAttribute('title')).toContain('Bấm vào đây để mở trình soạn');
    expect(chip?.getAttribute('title')).not.toContain('Mở Sửa');
    // Góp ý 2026-10-15: bỏ nút "Sửa" khỏi màn chơi — chỉ chip lỗi còn dẫn tới Editor.
    expect(screen.queryByRole('link', { name: /^Sửa/ })).toBeNull();
    expect(document.querySelectorAll('a[href^="#/edit"]')).toHaveLength(1);
    unmount();

    const empty = addSong('@title Trống\n');
    render(<PlayerView songId={empty} />);
    expect(screen.getByRole('link', { name: 'Mở trình soạn' }).getAttribute('href')).toBe(
      `#/edit/${empty}`,
    );
  });

  it('with the editor: the @scroll -1 chip is a focusable link to the editor (R5 fix)', () => {
    flags.editor = true;
    const flat = addSong('@title Giáng\n@scroll -1\nZ [S] X [/S] C\n');
    render(<PlayerView songId={flat} />);
    const chip = document.querySelector('.player-chip-warning');
    expect(chip?.tagName).toBe('A');
    expect(chip?.getAttribute('href')).toBe(`#/edit/${flat}`);
    expect(chip?.getAttribute('title')).toContain(
      'Bấm vào đây để mở trình soạn → Công cụ → Tối ưu lại cung / quãng',
    );
  });

  it('singular / plural error count in English', () => {
    useSettings.getState().set({ language: 'en' });
    const one = addSong('@title One\nZ X Q\n');
    const { unmount } = render(<PlayerView songId={one} />);
    expect(document.querySelector('.player-chip-error')?.textContent).toMatch(/^1 syntax error\b/);
    expect(document.querySelector('.player-chip-error')?.getAttribute('title')).toContain(
      'See the broken lines on its card in the Library.',
    );
    unmount();
    const two = addSong('@title Two\nZ Q\nX Q\n');
    render(<PlayerView songId={two} />);
    expect(document.querySelector('.player-chip-error')?.textContent).toMatch(/^2 syntax errors\b/);
  });
});

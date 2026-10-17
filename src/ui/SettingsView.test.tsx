import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getAudioEngine } from '../audio/engine';
import { FakeAudioContext } from '../audio/fakeAudioContext';
import { installFakeAudioSession } from '../audio/fakePlaybackEnv';
import type { FakeAudioSessionHandle } from '../audio/fakePlaybackEnv';
import type { MidiInputInfo } from '../midi/types';
import { DEFAULT_SETTINGS, LABEL_OVERRIDE_MAX, getSettings, useSettings } from './settings';
import { SettingsView, describeKeyChoice, signedNumber } from './SettingsView';

// Web MIDI giả (mặc định: trình duyệt không hỗ trợ, như jsdom).
const midi = vi.hoisted(() => {
  const state = {
    supported: false,
    enabled: false,
    result: 'ok' as 'ok' | 'denied' | 'unsupported',
    inputs: [] as MidiInputInfo[],
    selected: null as string | null,
    enableCalls: 0,
    deviceCbs: new Set<() => void>(),
    activityCbs: new Set<() => void>(),
  };
  const manager = {
    get enabled() {
      return state.enabled;
    },
    get connected() {
      return state.inputs.some((i) => i.id === state.selected && i.state === 'connected');
    },
    get selectedId() {
      return state.selected;
    },
    enable: async () => {
      state.enableCalls++;
      if (state.result === 'ok') state.enabled = true;
      return state.result;
    },
    inputs: () => (state.enabled ? state.inputs.map((i) => ({ ...i })) : []),
    select: (id: string | null) => {
      state.selected = id;
    },
    onEvent: () => () => {},
    onDevicesChange: (cb: () => void) => {
      state.deviceCbs.add(cb);
      return () => {
        state.deviceCbs.delete(cb);
      };
    },
    onActivity: (cb: () => void) => {
      state.activityCbs.add(cb);
      return () => {
        state.activityCbs.delete(cb);
      };
    },
  };
  return { state, manager };
});
vi.mock('../midi/webmidi', () => ({
  isWebMidiSupported: () => midi.state.supported,
  getMidiInputManager: () => midi.manager,
}));

beforeEach(() => {
  act(() => useSettings.getState().reset());
  Object.assign(midi.state, {
    supported: false,
    enabled: false,
    result: 'ok',
    inputs: [],
    selected: null,
    enableCalls: 0,
  });
  midi.state.deviceCbs.clear();
  midi.state.activityCbs.clear();
});

/** Card "Âm thanh" (card thường, không còn <details> "Nâng cao" — góp ý 2026-10-16). */
function sound(name = 'Âm thanh'): HTMLElement {
  return screen.getByRole('region', { name });
}

/** Thứ tự card (tiêu đề h2) như trên trang (DOM = thứ tự đánh số 01…07). */
const cardTitles = () =>
  screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent ?? '');

describe('SettingsView', () => {
  it('renders every group in Vietnamese by default', () => {
    render(<SettingsView />);
    expect(screen.getByRole('heading', { level: 1, name: 'Cài đặt' })).toBeTruthy();
    for (const name of [
      'Kiểu điều khiển',
      'Giao diện',
      'Phát bài',
      'Harmonica',
      'Âm thanh',
      'Luyện tập',
      'MIDI',
    ]) {
      expect(screen.getByRole('heading', { level: 2, name })).toBeTruthy();
      // mỗi nhóm là một region có tên
      expect(screen.getByRole('region', { name })).toBeTruthy();
    }
    // control chính có label
    expect(screen.getByLabelText('Chủ đề màu')).toBeTruthy();
    expect(screen.getByLabelText('Ngôn ngữ')).toBeTruthy();
    expect(screen.getByRole('slider', { name: /Cỡ tile/ })).toBeTruthy();
    expect(screen.getByLabelText('Nhãn phụ trên tile')).toBeTruthy();
    expect(screen.getByRole('switch', { name: /Đếm vào khi bấm Phát/ })).toBeTruthy();
    expect(screen.getByLabelText('Quãng tám gốc')).toBeTruthy();
    // góp ý 2026-10-15: không còn công tắc lời, chiều Nửa Cung cố định thăng (không chọn được)
    expect(screen.queryByRole('switch', { name: /lời|karaoke/i })).toBeNull();
    expect(screen.queryByLabelText(/^Chiều .* \(scroll\)$/)).toBeNull();
    // mặc định v4: nhãn phụ ẩn, đếm ngược 3 giây
    expect((screen.getByLabelText('Nhãn phụ trên tile') as HTMLSelectElement).value).toBe('none');
    expect(screen.getByRole('slider', { name: /Đếm ngược/ }).getAttribute('aria-valuetext')).toBe(
      '3 giây',
    );
    // giá trị hiển thị
    expect(screen.getByText('×1.00')).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Z = C4 (mặc định)' })).toBeTruthy();
    expect(screen.getByText('Tầm chơi được: C3 – C6')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Đặt lại mặc định' })).toBeTruthy();
  });

  it('card order: 01 control … 05 sound … 07 MIDI last; no shortcuts card, no lookahead control, no "Nâng cao"', () => {
    render(<SettingsView />);
    expect(cardTitles()).toEqual([
      'Kiểu điều khiển',
      'Giao diện',
      'Phát bài',
      'Harmonica',
      'Âm thanh',
      'Luyện tập',
      'MIDI',
    ]);
    // Hai cột cố định: trái 01–04, phải 05–07 (MIDI cuối cột phải = cuối trang).
    const cols = Array.from(document.querySelectorAll('.settings-grid > .settings-col'));
    expect(cols).toHaveLength(2);
    const titlesIn = (col: Element) =>
      Array.from(col.querySelectorAll('h2')).map((h) => h.textContent);
    expect(titlesIn(cols[0])).toEqual(['Kiểu điều khiển', 'Giao diện', 'Phát bài', 'Harmonica']);
    expect(titlesIn(cols[1])).toEqual(['Âm thanh', 'Luyện tập', 'MIDI']);
    // Thẻ Phím tắt đã bỏ (cột trái màn chơi có danh sách đầy đủ).
    expect(screen.queryByRole('region', { name: 'Phím tắt' })).toBeNull();
    expect(screen.queryByText('Phát / Tạm dừng')).toBeNull();
    expect(screen.queryByRole('link', { name: 'Xem hướng dẫn' })).toBeNull();
    // Lookahead chỉ còn ở thanh điều khiển màn chơi.
    expect(screen.queryByRole('slider', { name: /Lookahead/ })).toBeNull();
    expect(screen.queryByText(/Lookahead/)).toBeNull();
    // Âm thanh không còn giấu trong mục thu gọn.
    expect(document.querySelector('details')).toBeNull();
    expect(screen.queryByText(/Nâng cao/)).toBeNull();
  });

  it('switching the language to English relabels the screen', () => {
    render(<SettingsView />);
    fireEvent.change(screen.getByLabelText('Ngôn ngữ'), { target: { value: 'en' } });
    expect(getSettings().language).toBe('en');
    expect(screen.getByRole('heading', { level: 1, name: 'Settings' })).toBeTruthy();
    expect(cardTitles()).toEqual([
      'Control scheme',
      'Appearance',
      'Playback',
      'Harmonica',
      'Sound',
      'Practice',
      'MIDI',
    ]);
    expect(screen.getByLabelText('Language')).toBeTruthy();
    expect(screen.queryByLabelText('Semitone direction (scroll)')).toBeNull();
    expect(screen.queryByText(/Advanced|Keyboard shortcuts/)).toBeNull();
    expect(screen.queryByText('Giao diện')).toBeNull();
    fireEvent.change(screen.getByLabelText('Language'), { target: { value: 'vi' } });
    expect(screen.getByRole('heading', { level: 2, name: 'Giao diện' })).toBeTruthy();
  });

  it('sliders, selects and toggles update the store', () => {
    render(<SettingsView />);

    const scale = screen.getByRole('slider', { name: /Cỡ tile/ });
    fireEvent.change(scale, { target: { value: '1.25' } });
    expect(getSettings().tileScale).toBe(1.25);
    expect(screen.getByText('×1.25')).toBeTruthy();
    expect(scale.getAttribute('aria-valuetext')).toBe('×1.25');

    fireEvent.change(screen.getByLabelText('Chủ đề màu'), { target: { value: 'light' } });
    expect(getSettings().theme).toBe('light');
    fireEvent.change(screen.getByLabelText('Nhãn phụ trên tile'), { target: { value: 'number' } });
    expect(getSettings().subLabel).toBe('number');

    fireEvent.change(screen.getByLabelText('Quãng tám gốc'), { target: { value: '3' } });
    expect(getSettings().baseOctave).toBe(3);
    expect(screen.getByText('Tầm chơi được: C2 – C5')).toBeTruthy();

    fireEvent.click(screen.getByRole('switch', { name: /Đếm vào khi bấm Phát/ }));
    expect(getSettings().countIn).toBe(false);
  });

  it('reset asks for confirmation, cancel keeps settings, confirm restores defaults', () => {
    act(() =>
      useSettings.getState().set({ language: 'en', theme: 'light', tileScale: 1.4, lookahead: 6 }),
    );
    render(<SettingsView />);
    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Reset to defaults' }));
    let dialog = screen.getByRole('dialog', { name: 'Reset settings?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(getSettings().tileScale).toBe(1.4);

    // Esc cũng đóng
    fireEvent.click(screen.getByRole('button', { name: 'Reset to defaults' }));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Reset to defaults' }));
    dialog = screen.getByRole('dialog', { name: 'Reset settings?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Reset' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(getSettings()).toEqual(DEFAULT_SETTINGS);
    // ngôn ngữ mặc định là vi → nhãn đổi lại tiếng Việt
    expect(screen.getByRole('heading', { level: 2, name: 'Giao diện' })).toBeTruthy();
    expect(screen.getByText('×1.00')).toBeTruthy();
  });

  it('cuối trang (sau nút đặt lại): link nhỏ "Dev notes" tới #/dev (R7-8)', () => {
    const { container } = render(<SettingsView />);
    const link = screen.getByRole('link', { name: 'Dev notes' });
    expect(link.getAttribute('href')).toBe('#/dev');
    expect(link.parentElement?.className).toBe('dev-notes-link');
    // Link "Mã nguồn (GitHub)" chỉ ở trang Hướng dẫn + Dev notes (D-444).
    expect(screen.queryByRole('link', { name: /Mã nguồn/ })).toBeNull();
    const reset = screen.getByRole('button', { name: 'Đặt lại mặc định' });
    expect(reset.compareDocumentPosition(link) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(container.querySelector('.settings-view')?.contains(link)).toBe(true);
  });
});

describe('SettingsView — phát bài', () => {
  it('count-in and countdown live in the playback card (count-in works without sound)', () => {
    render(<SettingsView />);
    const playback = screen.getByRole('region', { name: 'Phát bài' });
    const countIn = within(playback).getByRole('switch', { name: /Đếm vào khi bấm Phát/ });
    expect((countIn as HTMLInputElement).checked).toBe(true);
    const hintId = countIn.getAttribute('aria-describedby') ?? '';
    // góp ý 2026-10-16: đếm vào chỉ là đoạn ô rơi dẫn vào, không hiện số (không đếm hai lần).
    expect(document.getElementById(hintId)?.textContent).toMatch(/không hiện số đếm/);
    expect(document.getElementById(hintId)?.textContent).toMatch(/mục Âm thanh/);
    // không có control âm thanh nào ở đây
    expect(
      within(playback).queryByRole('switch', { name: /giai điệu|click|Metronome/ }),
    ).toBeNull();
    expect(sound().contains(countIn)).toBe(false);
    // Lookahead không còn ở đây (chỉ ở thanh điều khiển màn chơi).
    expect(within(playback).getAllByRole('switch')).toHaveLength(1);
    expect(within(playback).getAllByRole('slider')).toHaveLength(1);

    const slider = within(playback).getByRole('slider', { name: /Đếm ngược trước khi phát/ });
    // mặc định v4: 3 giây
    expect(slider.getAttribute('aria-valuetext')).toBe('3 giây');
    fireEvent.change(slider, { target: { value: '0' } });
    expect(slider.getAttribute('aria-valuetext')).toBe('Tắt');
    fireEvent.change(slider, { target: { value: '5' } });
    expect(getSettings().startDelaySec).toBe(5);
    expect(slider.getAttribute('aria-valuetext')).toBe('5 giây');
    const [delayHint, floatHint] = (slider.getAttribute('aria-describedby') ?? '').split(' ');
    expect(document.getElementById(delayHint)?.textContent).toMatch(/Alt-Tab/);
    // Vòng R7: dòng nhắc Cửa sổ nổi + trang mini đếm tối thiểu 3 giây (kể cả khi Tắt).
    const float = document.getElementById(floatHint ?? '');
    expect(float?.textContent).toMatch(/Cửa sổ nổi.*trang mini.*ít nhất 3 giây/);
    expect(playback.contains(float)).toBe(true);
  });
});

describe('SettingsView — kiểu điều khiển', () => {
  const card = () => screen.getByRole('region', { name: 'Kiểu điều khiển' });

  it('PC / Mobile radios; mobile shows the semitone behaviour with a not-confirmed note', () => {
    render(<SettingsView />);
    const group = within(card()).getByRole('radiogroup', { name: 'Kiểu điều khiển' });
    const pc = within(group).getByRole('radio', { name: 'PC (bàn phím + giữ chuột)' });
    const mobile = within(group).getByRole('radio', { name: 'Mobile (nút cảm ứng)' });
    expect((pc as HTMLInputElement).checked).toBe(true);
    expect((mobile as HTMLInputElement).checked).toBe(false);
    // hint đọc kèm radio, không nằm trong tên
    const hint = document.getElementById(mobile.getAttribute('aria-describedby') ?? '');
    expect(hint?.textContent).toMatch(/8 nút số/);
    expect(within(card()).queryByRole('group', { name: /hoạt động kiểu/ })).toBeNull();

    fireEvent.click(mobile);
    expect(getSettings().controlScheme).toBe('mobile');
    expect((pc as HTMLInputElement).checked).toBe(false);
    const semitone = within(card()).getByRole('group', { name: 'Nút Nửa Cung hoạt động kiểu' });
    const toggle = within(semitone).getByRole('radio', {
      name: 'Bật / tắt (giữ trạng thái tới khi chạm lại)',
    });
    const oneShot = within(semitone).getByRole('radio', { name: 'Chỉ áp cho 1 nốt' });
    expect((toggle as HTMLInputElement).checked).toBe(true);
    const noteId = semitone.getAttribute('aria-describedby') ?? '';
    expect(document.getElementById(noteId)?.textContent).toMatch(/Chưa xác nhận trong game/);
    fireEvent.click(oneShot);
    expect(getSettings().mobileSemitone).toBe('oneShot');
    expect((toggle as HTMLInputElement).checked).toBe(false);

    // Hai nhóm radio độc lập (khác name).
    expect((mobile as HTMLInputElement).checked).toBe(true);
    expect(pc.getAttribute('name')).not.toBe(oneShot.getAttribute('name'));

    fireEvent.click(pc);
    expect(getSettings().controlScheme).toBe('pc');
    expect(within(card()).queryByRole('group', { name: /hoạt động kiểu/ })).toBeNull();
    expect(getSettings().mobileSemitone).toBe('oneShot'); // vẫn nhớ lựa chọn
  });

  it('English labels', () => {
    act(() => useSettings.getState().set({ language: 'en', controlScheme: 'mobile' }));
    render(<SettingsView />);
    const c = screen.getByRole('region', { name: 'Control scheme' });
    expect(within(c).getByRole('radio', { name: 'Mobile (touch buttons)' })).toBeTruthy();
    const semitone = within(c).getByRole('group', { name: 'Behavior of the Semitone button' });
    expect(within(semitone).getByRole('radio', { name: 'Applies to one note only' })).toBeTruthy();
  });
});

describe('SettingsView — tên gọi nút', () => {
  const group = () => screen.getByRole('group', { name: 'Tên gọi nút' });
  const box = (name: RegExp) => within(group()).getByRole('textbox', { name }) as HTMLInputElement;

  it('4 inputs, placeholder = default name, empty by default, max length 24', () => {
    render(<SettingsView />);
    const g = group();
    expect(within(g).getAllByRole('textbox')).toHaveLength(4);
    const expected: [RegExp, string][] = [
      [/^Cúi Xuống \(hạ 1 quãng tám\)$/, 'Cúi Xuống'],
      [/^Ngẩng Lên \(lên 1 quãng tám\)$/, 'Ngẩng Lên'],
      [/^Ngẩng Tự Nhiên \(về quãng thường, chỉ có ở mobile\)$/, 'Ngẩng Tự Nhiên'],
      [/^Nửa Cung \(nửa cung\)$/, 'Nửa Cung'],
    ];
    for (const [name, placeholder] of expected) {
      const input = box(name);
      expect(input.value).toBe('');
      expect(input.placeholder).toBe(placeholder);
      expect(input.maxLength).toBe(LABEL_OVERRIDE_MAX);
      expect(input.maxLength).toBe(24);
    }
    // nút "Mặc định" tắt khi đang dùng tên mặc định
    const resets = within(g).getAllByRole('button', { name: /về mặc định/ });
    expect(resets).toHaveLength(4);
    expect(resets.every((b) => (b as HTMLButtonElement).disabled)).toBe(true);
    expect(g.getAttribute('aria-describedby')).toBeTruthy();
    // Hiện ở cả kiểu PC (tên dùng cho game bar PC).
    expect(getSettings().controlScheme).toBe('pc');
  });

  it('typing keeps spaces while editing, saves trimmed, renames everywhere; Default resets', () => {
    render(<SettingsView />);
    const scroll = box(/^Nửa Cung/);
    act(() => scroll.focus());
    fireEvent.change(scroll, { target: { value: 'Thăng ' } });
    // đang gõ: dấu cách cuối chưa bị nuốt (gõ tiếp được chữ thứ hai)
    expect(scroll.value).toBe('Thăng ');
    expect(getSettings().labelOverrides.scroll).toBe('Thăng');
    fireEvent.change(scroll, { target: { value: 'Thăng nửa' } });
    expect(getSettings().labelOverrides).toEqual({
      left: '',
      right: '',
      natural: '',
      scroll: 'Thăng nửa',
    });
    // tên mới dùng ở chỗ khác trong Cài đặt (từ modLabels)
    const practice = () => screen.getByRole('region', { name: 'Luyện tập' });
    expect(practice().textContent).toContain('Ngẩng Lên / Thăng nửa = giữ chuột trái');
    // ô của chính nó vẫn ghi tên mặc định để biết đang đổi nút nào
    expect(box(/^Nửa Cung \(nửa cung\)$/)).toBe(scroll);

    fireEvent.change(scroll, { target: { value: '  Lên nửa  ' } });
    fireEvent.blur(scroll);
    expect(scroll.value).toBe('Lên nửa');

    const reset = within(group()).getByRole('button', {
      name: 'Đặt tên nút "Nửa Cung" về mặc định',
    });
    expect((reset as HTMLButtonElement).disabled).toBe(false);
    expect(reset.textContent).toBe('Mặc định');
    fireEvent.click(reset);
    expect(getSettings().labelOverrides.scroll).toBe('');
    expect(scroll.value).toBe('');
    expect((reset as HTMLButtonElement).disabled).toBe(true);
    expect(document.activeElement).toBe(scroll);
    expect(practice().textContent).toContain('Ngẩng Lên / Nửa Cung = giữ chuột trái');
  });

  it('mobile semitone legend and practice messages use the custom names', () => {
    act(() =>
      useSettings.getState().set({
        controlScheme: 'mobile',
        labelOverrides: { left: 'Xuống', right: 'Lên', natural: 'Giữa', scroll: 'Thăng' },
      }),
    );
    render(<SettingsView />);
    expect(screen.getByRole('group', { name: 'Nút Thăng hoạt động kiểu' })).toBeTruthy();
    const practice = screen.getByRole('region', { name: 'Luyện tập' });
    expect(practice.textContent).toContain('Xuống / Lên / Thăng = giữ chuột trái');
    // ô nhập hiện tên đã lưu
    expect(box(/^Ngẩng Tự Nhiên/).value).toBe('Giữa');
  });

  it('English placeholders follow the language', () => {
    act(() => useSettings.getState().set({ language: 'en' }));
    render(<SettingsView />);
    const g = screen.getByRole('group', { name: 'Button names' });
    const left = within(g).getByRole('textbox', { name: 'Crouch (one octave down)' });
    expect((left as HTMLInputElement).placeholder).toBe('Crouch');
    expect(
      within(g).getByRole('button', { name: 'Reset the "Natural" button name to its default' }),
    ).toBeTruthy();
  });
});

describe('SettingsView — Âm thanh (card thường, góp ý 2026-10-16)', () => {
  const melodySwitch = () =>
    within(sound()).getByRole('switch', { name: 'Phát giai điệu mẫu' }) as HTMLInputElement;

  it('a visible card (no collapsed "Nâng cao"), holds every sound option, all off', () => {
    render(<SettingsView />);
    const card = sound();
    expect(card.tagName).toBe('SECTION');
    expect(card.closest('details')).toBeNull();
    // Card 05, ở cột phải, trước Luyện tập và MIDI.
    expect(card.closest('.settings-col')).toBe(document.querySelectorAll('.settings-col')[1]);

    const d = within(card);
    expect(melodySwitch().checked).toBe(false);
    expect(d.getByLabelText('Âm sắc')).toBeTruthy();
    expect(d.getByRole('slider', { name: /Âm lượng synth/ })).toBeTruthy();
    const click = d.getByRole('switch', { name: 'Tiếng click metronome / đếm vào' });
    expect((click as HTMLInputElement).checked).toBe(false);
    expect(d.getByRole('switch', { name: 'Metronome suốt bài' })).toBeTruthy();
    expect(d.getByRole('slider', { name: /Âm lượng click/ })).toBeTruthy();
    const feedback = d.getByRole('switch', { name: 'Phát tiếng khi bấm phím / nốt' });
    expect((feedback as HTMLInputElement).checked).toBe(false);
    expect(card.textContent).toContain('Mặc định app không phát tiếng nào');
    for (const name of [
      'Giai điệu mẫu',
      'Synth của app',
      'Metronome / đếm vào',
      'Tiếng khi luyện tập',
    ]) {
      expect(d.getByRole('heading', { level: 3, name })).toBeTruthy();
    }
    // Không có control âm thanh nào ngoài card Âm thanh.
    expect(screen.getAllByRole('switch', { name: /giai điệu|click|Metronome|Phát tiếng/ })).toEqual(
      d.getAllByRole('switch', { name: /giai điệu|click|Metronome|Phát tiếng/ }),
    );
    expect(screen.getAllByRole('slider', { name: /Âm lượng/ })).toEqual(
      d.getAllByRole('slider', { name: /Âm lượng/ }),
    );
    // Chưa bật gì → không huy hiệu.
    expect(d.queryByText('Đang bật giai điệu')).toBeNull();
    expect(d.queryByText('Đang bật tiếng click')).toBeNull();

    // Âm sắc + âm lượng synth dùng chung cho giai điệu, tiếng phản hồi và "Nghe thử" → luôn chỉnh được
    // (kể cả khi giai điệu tắt), ghi chú liệt kê mọi tiếng chúng áp vào.
    const timbre = d.getByLabelText('Âm sắc') as HTMLSelectElement;
    const music = d.getByRole('slider', { name: /Âm lượng synth/ }) as HTMLInputElement;
    expect(timbre.disabled).toBe(false);
    expect(music.disabled).toBe(false);
    for (const el of [timbre, music]) {
      const hint = document.getElementById(el.getAttribute('aria-describedby') ?? '')?.textContent;
      expect(hint).toMatch(/giai điệu mẫu/);
      expect(hint).toMatch(/tiếng khi bấm phím/);
      expect(hint).toMatch(/Nghe thử/);
    }
    fireEvent.change(music, { target: { value: '30' } });
    expect(getSettings().musicVolume).toBeCloseTo(0.3);
    fireEvent.change(timbre, { target: { value: 'sine' } });
    expect(getSettings().timbre).toBe('sine');
    // chỉnh synth không bật tiếng nào
    expect(getSettings().audioEnabled).toBe(false);
    expect(getSettings().practiceFeedback).toBe(false);
    // Click tắt → metronome + âm lượng click bị tắt.
    expect(
      (d.getByRole('switch', { name: 'Metronome suốt bài' }) as HTMLInputElement).disabled,
    ).toBe(true);
    expect((d.getByRole('slider', { name: /Âm lượng click/ }) as HTMLInputElement).disabled).toBe(
      true,
    );
  });

  it('turning the melody ON asks first; cancel / Esc keep it off', () => {
    render(<SettingsView />);
    // bấm chuột thật cũng focus switch (fireEvent.click thì không)
    act(() => melodySwitch().focus());
    fireEvent.click(melodySwitch());
    const dialog = screen.getByRole('dialog', { name: 'Bật phát giai điệu mẫu?' });
    expect(dialog.textContent).toContain('YouTube / Facebook / TikTok');
    expect(dialog.textContent).toContain('bản quyền');
    expect(dialog.textContent).toContain('Chỉ nên bật khi luyện riêng, không stream');
    // focus mặc định vào lựa chọn an toàn
    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Hủy' }));
    expect(getSettings().audioEnabled).toBe(false);
    expect(melodySwitch().checked).toBe(false);

    fireEvent.click(within(dialog).getByRole('button', { name: 'Hủy' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(getSettings().audioEnabled).toBe(false);
    expect(melodySwitch().checked).toBe(false);
    // focus về lại switch
    expect(document.activeElement).toBe(melodySwitch());

    fireEvent.click(melodySwitch());
    expect(screen.getByRole('dialog', { name: 'Bật phát giai điệu mẫu?' })).toBeTruthy();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(getSettings().audioEnabled).toBe(false);

    // bấm nền cũng là hủy
    fireEvent.click(melodySwitch());
    const backdrop = screen.getByRole('dialog').parentElement as HTMLElement;
    fireEvent.mouseDown(backdrop, { button: 0 });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(getSettings().audioEnabled).toBe(false);
  });

  it('"Tôi hiểu, bật" enables it (red badge next to the title, synth stays usable); OFF needs no confirm', () => {
    render(<SettingsView />);
    const d = within(sound());
    expect(d.queryByText('Đang bật giai điệu')).toBeNull();
    fireEvent.click(melodySwitch());
    const dialog = screen.getByRole('dialog', { name: 'Bật phát giai điệu mẫu?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Tôi hiểu, bật' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(getSettings().audioEnabled).toBe(true);
    expect(melodySwitch().checked).toBe(true);
    const badge = d.getByText('Đang bật giai điệu');
    expect(badge.classList.contains('settings-badge-melody')).toBe(true);
    expect(badge.closest('.settings-card-head')).not.toBeNull();
    // Huy hiệu nằm ngoài <h2> → tên vùng vẫn là "Âm thanh".
    expect(screen.getByRole('region', { name: 'Âm thanh' })).toBeTruthy();

    const timbre = d.getByLabelText('Âm sắc') as HTMLSelectElement;
    const music = d.getByRole('slider', { name: /Âm lượng synth/ }) as HTMLInputElement;
    expect(timbre.disabled).toBe(false);
    expect(music.disabled).toBe(false);
    fireEvent.change(timbre, { target: { value: 'sine' } });
    expect(getSettings().timbre).toBe('sine');
    fireEvent.change(music, { target: { value: '40' } });
    expect(getSettings().musicVolume).toBeCloseTo(0.4);
    expect(music.getAttribute('aria-valuetext')).toBe('40%');

    fireEvent.click(melodySwitch());
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(getSettings().audioEnabled).toBe(false);
    expect(d.queryByText('Đang bật giai điệu')).toBeNull();
    expect(timbre.disabled).toBe(false); // synth dùng chung, không phụ thuộc giai điệu
  });

  it('click sound unlocks the metronome and click volume; practice feedback toggles', () => {
    render(<SettingsView />);
    const d = within(sound());
    fireEvent.click(d.getByRole('switch', { name: 'Tiếng click metronome / đếm vào' }));
    expect(getSettings().clickSound).toBe(true);
    expect(screen.queryByRole('dialog')).toBeNull(); // không cần xác nhận
    expect(d.getByText('Đang bật tiếng click').closest('.settings-card-head')).not.toBeNull();
    const metronome = d.getByRole('switch', { name: 'Metronome suốt bài' }) as HTMLInputElement;
    const clickVol = d.getByRole('slider', { name: /Âm lượng click/ }) as HTMLInputElement;
    expect(metronome.disabled).toBe(false);
    expect(clickVol.disabled).toBe(false);
    fireEvent.click(metronome);
    expect(getSettings().metronome).toBe(true);
    fireEvent.change(clickVol, { target: { value: '0' } });
    expect(getSettings().clickVolume).toBe(0);
    fireEvent.click(d.getByRole('switch', { name: 'Phát tiếng khi bấm phím / nốt' }));
    expect(getSettings().practiceFeedback).toBe(true);
    // âm thanh giai điệu vẫn tắt
    expect(getSettings().audioEnabled).toBe(false);
  });

  it('reset to defaults turns every sound off again', () => {
    act(() =>
      useSettings
        .getState()
        .set({ audioEnabled: true, clickSound: true, metronome: true, practiceFeedback: true }),
    );
    render(<SettingsView />);
    fireEvent.click(screen.getByRole('button', { name: 'Đặt lại mặc định' }));
    const dialog = screen.getByRole('dialog', { name: 'Đặt lại cài đặt?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Đặt lại' }));
    const s = getSettings();
    expect([s.audioEnabled, s.clickSound, s.metronome, s.practiceFeedback]).toEqual([
      false,
      false,
      false,
      false,
    ]);
    expect(melodySwitch().checked).toBe(false);
  });

  it('English: "Sound" card and confirm dialog wording', () => {
    act(() => useSettings.getState().set({ language: 'en' }));
    render(<SettingsView />);
    const card = sound('Sound');
    fireEvent.click(within(card).getByRole('switch', { name: 'Play the sample melody' }));
    const dialog = screen.getByRole('dialog', { name: 'Turn on the sample melody?' });
    expect(dialog.textContent).toContain('YouTube / Facebook / TikTok');
    fireEvent.click(within(dialog).getByRole('button', { name: 'I understand, turn on' }));
    expect(getSettings().audioEnabled).toBe(true);
    expect(within(card).getByText('Melody on')).toBeTruthy();
  });
});

describe('SettingsView — Âm thanh: bật trong cú bấm = mở khóa âm thanh ngay (D-423)', () => {
  /** AudioContext giả, bắt đầu 'suspended' như trình duyệt thật; đếm số lần tạo. */
  let created: FakeAudioContext[] = [];
  let session: FakeAudioSessionHandle | null = null;
  beforeEach(() => {
    created = [];
    class StubCtx extends FakeAudioContext {
      constructor() {
        super({ state: 'suspended' });
        created.push(this);
      }
    }
    vi.stubGlobal('AudioContext', StubCtx);
    session = installFakeAudioSession();
  });
  afterEach(() => {
    getAudioEngine().dispose();
    session?.restore();
    session = null;
    vi.unstubAllGlobals();
  });

  it('"Tôi hiểu, bật" của giai điệu mẫu → context chạy ngay (lần Phát đầu không phải chờ); không giữ phiên "playback"', () => {
    render(<SettingsView />);
    const d = within(sound());
    fireEvent.click(d.getByRole('switch', { name: 'Phát giai điệu mẫu' }));
    expect(created).toHaveLength(0); // mới mở hộp cảnh báo
    fireEvent.click(screen.getByRole('button', { name: 'Tôi hiểu, bật' }));
    expect(created).toHaveLength(1);
    expect(created[0].resumeCalls).toBe(1);
    expect(getAudioEngine().ready).toBe(true);
    // Phiên của iPhone chỉ giữ ở màn chơi (trả được khi rời màn chơi).
    expect(session?.log).toEqual([]);
  });

  it('Hủy / Esc → không tạo AudioContext', () => {
    render(<SettingsView />);
    const d = within(sound());
    fireEvent.click(d.getByRole('switch', { name: 'Phát giai điệu mẫu' }));
    fireEvent.click(screen.getByRole('button', { name: 'Hủy' }));
    expect(created).toHaveLength(0);
    expect(getAudioEngine().context).toBeNull();
  });

  it('bật tiếng click / tiếng khi bấm → mở khóa trong cú bấm; tắt không tạo gì', () => {
    render(<SettingsView />);
    const d = within(sound());
    fireEvent.click(d.getByRole('switch', { name: 'Tiếng click metronome / đếm vào' }));
    expect(getSettings().clickSound).toBe(true);
    expect(created).toHaveLength(1);
    expect(getAudioEngine().ready).toBe(true);
    getAudioEngine().dispose();
    fireEvent.click(d.getByRole('switch', { name: 'Tiếng click metronome / đếm vào' }));
    expect(getSettings().clickSound).toBe(false);
    expect(created).toHaveLength(1); // tắt: không mở khóa
    fireEvent.click(d.getByRole('switch', { name: 'Phát tiếng khi bấm phím / nốt' }));
    expect(getSettings().practiceFeedback).toBe(true);
    expect(created).toHaveLength(2);
    expect(getAudioEngine().ready).toBe(true);
    expect(session?.log).toEqual([]);
  });

  it('mở trang Cài đặt (âm thanh tắt) không đụng tới âm thanh', () => {
    render(<SettingsView />);
    expect(created).toHaveLength(0);
    expect(session?.log).toEqual([]);
  });
});

describe('SettingsView — luyện tập', () => {
  const region = () => screen.getByRole('region', { name: 'Luyện tập' });

  it('default mode, mouse-only modifiers and the focus note (feedback sound lives in the Sound card)', () => {
    render(<SettingsView />);
    const r = region();
    const mode = within(r).getByLabelText('Chế độ luyện tập mặc định') as HTMLSelectElement;
    expect(mode.value).toBe('score');
    fireEvent.change(mode, { target: { value: 'wait' } });
    expect(getSettings().practiceMode).toBe('wait');

    // góp ý 2026-10-15: không còn phím bàn phím thay chuột — chỉ còn select chế độ
    expect(within(r).getAllByRole('combobox')).toEqual([mode]);
    expect(r.textContent).toContain(
      'Cúi Xuống / Ngẩng Lên / Nửa Cung = giữ chuột trái / chuột phải / nút cuộn trên khu tiles',
    );
    expect(r.textContent).not.toMatch(/Ctrl|Phím thay/);
    expect(r.querySelector('.settings-warning')).toBeNull();

    expect(within(r).queryByRole('switch', { name: 'Phát tiếng khi bấm phím / nốt' })).toBeNull();
    expect(r.textContent).toContain('Luyện tập chỉ nhận phím / chuột khi tab app đang được chọn');
    expect(r.textContent).not.toContain('Practice');
    expect(r.textContent).toContain('Kiểu Mobile: chỉ chạm / click bàn nút trên màn hình');
  });

  it('English labels', () => {
    act(() => useSettings.getState().set({ language: 'en' }));
    render(<SettingsView />);
    const r = screen.getByRole('region', { name: 'Practice' });
    expect(r.textContent).toContain(
      'Crouch / Look Up / Semitone = hold the left / right / wheel mouse button over the tiles',
    );
  });
});

describe('SettingsView — MIDI', () => {
  const region = () => screen.getByRole('region', { name: 'MIDI' });
  const device = (
    id: string,
    name: string,
    state: 'connected' | 'disconnected' = 'connected',
  ): MidiInputInfo => ({ id, name, manufacturer: '', state });

  it('unsupported browser: one explanatory line and nothing else', () => {
    render(<SettingsView />);
    const r = region();
    expect(r.textContent).toContain('Chrome, Edge hoặc Firefox 108+');
    expect(within(r).queryByRole('switch')).toBeNull();
    expect(within(r).queryByRole('slider')).toBeNull();
    expect(within(r).queryByRole('combobox')).toBeNull();
    expect(midi.state.enableCalls).toBe(0);
  });

  it('asks for MIDI access only when turned on, lists devices, remembers the choice', async () => {
    midi.state.supported = true;
    midi.state.inputs = [device('in-1', 'Piano A'), device('in-2', 'Pad B')];
    render(<SettingsView />);
    const r = region();
    expect(midi.state.enableCalls).toBe(0); // không xin quyền lúc mở trang
    expect(within(r).queryByLabelText('Thiết bị MIDI')).toBeNull();

    const toggle = within(r).getByRole('switch', { name: 'Bật MIDI' });
    await act(async () => {
      fireEvent.click(toggle);
    });
    expect(midi.state.enableCalls).toBe(1);
    expect(getSettings().midiEnabled).toBe(true);
    const select = within(r).getByLabelText('Thiết bị MIDI') as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual([
      '— Chọn thiết bị —',
      'Piano A',
      'Pad B',
    ]);
    expect(r.querySelector('.midi-status')?.textContent).toContain('Chưa chọn thiết bị');

    fireEvent.change(select, { target: { value: 'in-2' } });
    expect(getSettings().midiInputId).toBe('in-2');
    expect(midi.state.selected).toBe('in-2');
    expect(r.querySelector('.midi-status')?.textContent).toContain('Đã kết nối');

    // Hot-plug: thiết bị rút ra → trạng thái + nhãn cập nhật.
    act(() => {
      midi.state.inputs = [device('in-1', 'Piano A'), device('in-2', 'Pad B', 'disconnected')];
      midi.state.deviceCbs.forEach((cb) => cb());
    });
    expect(r.querySelector('.midi-status')?.textContent).toContain('Chưa kết nối');
    expect(Array.from(select.options).map((o) => o.textContent)).toContain('Pad B (chưa cắm)');

    // Đèn nháy khi nhận nốt.
    expect(r.querySelector('.midi-activity')?.className).not.toContain('is-blink');
    act(() => midi.state.activityCbs.forEach((cb) => cb()));
    const light = r.querySelector('.midi-activity');
    expect(light?.className).toContain('is-blink');
    expect(light?.getAttribute('aria-hidden')).toBe('true');
    act(() => midi.state.activityCbs.forEach((cb) => cb()));
    expect(r.querySelector('.midi-activity')).not.toBe(light); // remount → chạy lại hiệu ứng

    // Tắt MIDI: bỏ nghe thiết bị nhưng vẫn nhớ lựa chọn.
    fireEvent.click(toggle);
    expect(getSettings().midiEnabled).toBe(false);
    expect(midi.state.selected).toBeNull();
    expect(getSettings().midiInputId).toBe('in-2');
    expect(within(r).queryByLabelText('Thiết bị MIDI')).toBeNull();
  });

  it('already enabled from a previous visit → re-acquires access and re-selects the saved device', async () => {
    midi.state.supported = true;
    midi.state.inputs = [device('in-1', 'Piano A')];
    act(() => useSettings.getState().set({ midiEnabled: true, midiInputId: 'in-1' }));
    await act(async () => {
      render(<SettingsView />);
    });
    expect(midi.state.enableCalls).toBe(1);
    expect(midi.state.selected).toBe('in-1');
    expect((within(region()).getByLabelText('Thiết bị MIDI') as HTMLSelectElement).value).toBe(
      'in-1',
    );
  });

  it('denied access turns MIDI back off and explains how to allow it', async () => {
    midi.state.supported = true;
    midi.state.result = 'denied';
    render(<SettingsView />);
    const r = region();
    await act(async () => {
      fireEvent.click(within(r).getByRole('switch', { name: 'Bật MIDI' }));
    });
    expect(getSettings().midiEnabled).toBe(false);
    expect(within(r).getByRole('alert').textContent).toContain('Trình duyệt từ chối quyền MIDI');
    expect(within(r).queryByLabelText('Thiết bị MIDI')).toBeNull();
  });

  it('unsupported result (e.g. insecure context) is reported too', async () => {
    midi.state.supported = true;
    midi.state.result = 'unsupported';
    render(<SettingsView />);
    const r = region();
    await act(async () => {
      fireEvent.click(within(r).getByRole('switch', { name: 'Bật MIDI' }));
    });
    expect(within(r).getByRole('alert').textContent).toContain('không có Web MIDI');
  });

  it('transposition sliders with a live "C4 on the keyboard → key" hint; pitch class toggle', () => {
    midi.state.supported = true;
    render(<SettingsView />);
    const r = region();
    const hint = () => r.querySelector('.midi-map-hint')?.textContent ?? '';
    expect(hint()).toContain('Phím C4 trên đàn → Z.');
    expect(hint()).toContain('Tầm đàn dùng được: C3 – C6.');
    const semis = within(r).getByRole('slider', { name: /Dịch bán cung/ });
    const octs = within(r).getByRole('slider', { name: /Dịch quãng tám/ });
    fireEvent.change(semis, { target: { value: '1' } });
    expect(getSettings().midiTransposeSemitones).toBe(1);
    expect(semis.getAttribute('aria-valuetext')).toBe('+1 bán cung');
    expect(hint()).toContain('Phím C4 trên đàn → Nửa Cung + Z.');
    fireEvent.change(semis, { target: { value: '0' } });
    fireEvent.change(octs, { target: { value: '1' } });
    expect(getSettings().midiTransposeOctaves).toBe(1);
    expect(hint()).toContain('Phím C4 trên đàn → ,.');
    expect(hint()).toContain('Tầm đàn dùng được: C2 – C5.');
    fireEvent.change(octs, { target: { value: '-1' } });
    expect(hint()).toContain('Phím C4 trên đàn → Cúi Xuống + Z.');
    fireEvent.change(octs, { target: { value: '-3' } });
    expect(hint()).toContain('Phím C4 trên đàn nằm ngoài tầm harmonica');
    const pc = within(r).getByRole('switch', { name: /pitch class/ });
    fireEvent.click(pc);
    expect(getSettings().midiPitchClassOnly).toBe(true);
  });

  it('helpers: signedNumber / describeKeyChoice', () => {
    expect(signedNumber(0)).toBe('0');
    expect(signedNumber(3)).toBe('+3');
    expect(signedNumber(-2)).toBe('−2');
    const labels = { left: 'L', right: 'R', scroll: 'S' };
    expect(describeKeyChoice(labels, { key: 'N', octave: 1, sharp: true })).toBe('R + S + N');
    expect(describeKeyChoice(labels, { key: 'Z', octave: -1, sharp: false })).toBe('L + Z');
    expect(describeKeyChoice(labels, { key: 'Z', octave: 0, sharp: false })).toBe('Z');
  });

  it('the "C4 → key" hint uses the custom button names', () => {
    midi.state.supported = true;
    act(() =>
      useSettings.getState().set({
        midiTransposeSemitones: 1,
        labelOverrides: { left: '', right: '', natural: '', scroll: 'Thăng' },
      }),
    );
    render(<SettingsView />);
    expect(region().querySelector('.midi-map-hint')?.textContent).toContain(
      'Phím C4 trên đàn → Thăng + Z.',
    );
  });
});

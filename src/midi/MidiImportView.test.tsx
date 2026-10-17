/**
 * Wizard "Tạo bài từ file" (luồng MIDI) (spec §6b A) với file SMF tự sinh (writeSmf) và parser/optimizer thật.
 * OptimizerPanel (module của agent khác) được thay bằng bản giả tối thiểu — bản thật chạy trong
 * MidiImportView.integration.test.tsx. navigate được mock; thư viện (zustand) là thật.
 */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getAudioEngine } from '../audio/engine';
import { FakeAudioContext } from '../audio/fakeAudioContext';
import type { Placement } from '../core/optimizer';
import { DRAFT_ID_PREFIX, getSong, isDraftSong, useLibrary } from '../library/store';
import type * as Router from '../ui/router';
import { navigate } from '../ui/router';
import { useSettings } from '../ui/settings';
import { useToasts } from '../ui/toast';
import { MidiImportView } from './MidiImportView';
import type { SmfEvent, SmfSpec } from './testing/smf';
import { writeSmf } from './testing/smf';
import { MAX_MIDI_BYTES } from './types';

vi.mock('../ui/router', async (importOriginal) => ({
  ...(await importOriginal<typeof Router>()),
  navigate: vi.fn(),
}));
const flags = vi.hoisted(() => ({ editor: true, share: false, midiImport: true }));
vi.mock('../ui/features', () => ({ FEATURES: flags }));

interface FakePanelProps {
  pitches: readonly (number | null)[];
  baseOctave: number;
  value: Placement | null;
  onChange: (p: Placement) => void;
}
const panelProps = vi.hoisted(() => ({ last: null as unknown }));
vi.mock('../editor/OptimizerPanel', async () => {
  const { optimizeTranspose } = await import('../core/optimizer');
  return {
    OptimizerPanel: (props: FakePanelProps) => {
      panelProps.last = props;
      const list = optimizeTranspose(props.pitches, {
        baseOctave: props.baseOctave,
        scrollDir: 1, // Nửa Cung của game luôn thăng (GAME_SCROLL_DIR)
        fold: true, // gộp nốt vượt tầm luôn bật
        top: 3,
      });
      return (
        <div data-testid="fake-optimizer">
          {list.map((p) => (
            <button
              key={p.transpose}
              type="button"
              aria-pressed={props.value?.transpose === p.transpose}
              onClick={() => props.onChange(p)}
            >
              {`t=${p.transpose}`}
            </button>
          ))}
        </div>
      );
    },
  };
});

const PPQ = 480;

function notes(
  list: ReadonlyArray<readonly [beat: number, beats: number, midi: number]>,
  channel = 0,
): SmfEvent[] {
  return list.map(([beat, beats, midi]) => ({
    tick: Math.round(beat * PPQ),
    type: 'note' as const,
    midi,
    duration: Math.round(beats * PPQ),
    channel,
  }));
}

/** Bài mẫu: conductor (tempo 100, 4/4, marker), melody (flute), hợp âm, trống. */
function songSpec(): SmfSpec {
  return {
    format: 1,
    ppq: PPQ,
    tracks: [
      {
        name: 'Conductor',
        events: [
          { tick: 0, type: 'tempo', bpm: 100 },
          { tick: 0, type: 'timeSig', num: 4, den: 4 },
          { tick: 0, type: 'marker', text: 'Verse' },
        ],
      },
      {
        name: 'Melody',
        events: [
          { tick: 0, type: 'program', program: 73, channel: 0 },
          ...notes([60, 62, 64, 65, 67, 69, 71, 72].map((m, i) => [i, 1, m] as const)),
        ],
      },
      {
        name: 'Chords',
        events: notes(
          [
            [0, 4, 48],
            [0, 4, 52],
            [0, 4, 55],
            [4, 4, 53],
            [4, 4, 57],
            [4, 4, 60],
          ],
          1,
        ),
      },
      {
        name: 'Drums',
        events: notes(
          [0, 1, 2, 3].map((b) => [b, 0.5, 36] as const),
          9,
        ),
      },
    ],
  };
}

function midiFile(spec: SmfSpec, name: string): File {
  return new File([new Uint8Array(writeSmf(spec))], name, { type: 'audio/midi' });
}

function fileInput(): HTMLInputElement {
  return screen.getByLabelText(
    'Chọn file MIDI (.mid, .midi) hoặc MusicXML (.musicxml, .xml, .mxl)',
  ) as HTMLInputElement;
}

const checkbox = (name: string) =>
  screen.getByRole('checkbox', { name: `Chọn track "${name}"` }) as HTMLInputElement;

async function pick(file: File) {
  await act(async () => {
    fireEvent.change(fileInput(), { target: { files: [file] } });
  });
}

// đọc file + import động có thể chậm khi cả suite chạy song song
const stepHeading = (name: string) =>
  screen.findByRole('heading', { level: 2, name }, { timeout: 10_000 });
const next = () => fireEvent.click(screen.getByRole('button', { name: 'Tiếp' }));
const preview = () => screen.getByLabelText('Xem trước .harm').textContent ?? '';
const ARRANGE = 'Xem trước và tạo bài';

/** Id bản nháp mà lần navigate gần nhất mở trong Editor. */
function lastDraftId(): string {
  const target = vi.mocked(navigate).mock.calls.at(-1)?.[0] ?? '';
  expect(target.startsWith('/edit/')).toBe(true);
  return decodeURIComponent(target.slice('/edit/'.length));
}

// @tonejs/midi được import động trong view — nạp trước để lần chọn file đầu không chậm
beforeAll(async () => {
  await import('./midiFile');
});

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => null);
  flags.editor = true;
  useLibrary.setState({ songs: [] });
  useToasts.setState({ toasts: [] });
});

afterEach(() => {
  getAudioEngine().dispose();
  vi.unstubAllGlobals();
  useSettings.getState().reset();
});

describe('MidiImportView — từ file MIDI', () => {
  it('đi hết 5 bước tới bản nháp trong Editor (chưa lưu vào thư viện)', async () => {
    render(<MidiImportView />);
    expect(
      screen.getByRole('heading', { level: 1, name: 'Tạo bài từ file MIDI / MusicXML' }),
    ).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Từ file' }).getAttribute('aria-selected')).toBe('true');

    // 1 → 2: chọn file tự sang bước chọn track
    await pick(midiFile(songSpec(), 'my_song.mid'));
    await stepHeading('Chọn track');
    const table = screen.getByRole('table');
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows.map((r) => r.querySelector('.midi-track-name')?.textContent)).toEqual([
      'Melody',
      'Chords',
    ]);
    expect(within(table).queryByText('Drums')).toBeNull();
    expect(screen.getByText('Đã ẩn 1 track trống (kênh 10).')).toBeTruthy();
    // gợi ý + chọn sẵn track melody
    expect(within(rows[0]).getByText('Gợi ý')).toBeTruthy();
    expect(within(rows[1]).queryByText('Gợi ý')).toBeNull();
    expect(checkbox('Melody').checked).toBe(true);
    expect(checkbox('Chords').checked).toBe(false);
    expect(screen.getByText('Đã chọn 1 track · 8 nốt · tầm C4–C5')).toBeTruthy();
    expect(within(rows[0]).getByText('C4–C5')).toBeTruthy();
    expect(within(rows[0]).getByText('100%')).toBeTruthy();
    expect(within(rows[0]).getByText('8')).toBeTruthy();
    expect(
      within(rows[0]).getByRole('img', { name: 'Piano roll của track "Melody"' }),
    ).toBeTruthy();

    // chọn thêm track (gộp), bỏ chọn bằng click vào dòng; không còn track nào → khóa Tiếp
    fireEvent.click(checkbox('Chords'));
    expect(checkbox('Melody').checked).toBe(true);
    expect(screen.getByText('Đã chọn 2 track · 14 nốt · tầm C3–C5')).toBeTruthy();
    expect(screen.getByRole('img', { name: 'Piano roll các track đã chọn (đã gộp)' })).toBeTruthy();
    fireEvent.click(within(rows[1]).getByText('C3–C4'));
    fireEvent.click(within(rows[0]).getByText('C4–C5'));
    expect(checkbox('Melody').checked).toBe(false);
    expect(screen.getByText('Chưa chọn track nào — chọn ít nhất một track.')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Tiếp' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(checkbox('Melody'));
    expect(checkbox('Melody').checked).toBe(true);

    // 3: trích melody
    next();
    // focus chuyển tới tiêu đề bước mới (bàn phím / screen reader)
    expect(document.activeElement).toBe(await stepHeading('Trích melody'));
    expect(screen.getByText(/8 nốt sau khi trích/)).toBeTruthy();
    expect(screen.getByText(/Nhịp 4\/4/)).toBeTruthy();
    const bpm = screen.getByLabelText('Tempo (BPM)') as HTMLInputElement;
    expect(bpm.value).toBe('100');
    fireEvent.change(bpm, { target: { value: '120' } });
    expect(screen.getByRole('img', { name: 'Piano roll của melody đã trích' })).toBeTruthy();

    // 4: chọn cung — mặc định phương án tối ưu (transpose 0)
    next();
    await stepHeading('Chọn cung và quãng');
    expect(screen.getByText(/tầm harmonica C3–C6 \(Z = C4\)/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 't=0' }).getAttribute('aria-pressed')).toBe('true');

    // 5: xem trước — dòng / section chia tự động (một marker ở đầu bài không đủ để chia section)
    next();
    await stepHeading(ARRANGE);
    expect((screen.getByLabelText('Tên bài') as HTMLInputElement).value).toBe('my song');
    let text = preview();
    expect(text).toContain('@title my song');
    expect(text).toContain('@bpm 120');
    expect(text).toContain('# Phần 1');
    expect(text).not.toContain('# Verse');
    expect(text).toContain('Z X C V B N M ,');
    expect(screen.getByText('1 section · 1 dòng · 8 nốt')).toBeTruthy();
    expect(screen.getByText(/Dòng và section do app tự chia/)).toBeTruthy();
    // không còn ô chỉnh chia dòng / section / marker
    expect(screen.queryByLabelText(/Ngắt dòng|Mỗi dòng|Mỗi section/)).toBeNull();
    expect(screen.queryByRole('switch')).toBeNull();
    expect(screen.getByText(/dạng bản nháp — chỉ vào Thư viện khi bạn bấm Lưu/)).toBeTruthy();

    // đổi tên + tác giả
    fireEvent.change(screen.getByLabelText('Tên bài'), { target: { value: 'Thang âm' } });
    fireEvent.change(screen.getByLabelText('Tác giả (không bắt buộc)'), {
      target: { value: 'Tôi' },
    });
    text = preview();
    expect(text).toContain('@title Thang âm');
    expect(text).toContain('@artist Tôi');

    fireEvent.click(screen.getByRole('button', { name: 'Mở trong Editor' }));
    // bản nháp: chưa có gì trong thư viện, Editor mở bản nháp đúng nội dung
    expect(useLibrary.getState().songs).toHaveLength(0);
    const draftId = lastDraftId();
    expect(draftId.startsWith(DRAFT_ID_PREFIX)).toBe(true);
    expect(isDraftSong(draftId)).toBe(true);
    expect(getSong(draftId)?.source).toBe(text);
    expect(useToasts.getState().toasts.map((t) => t.text)).not.toContain('Đã tạo bài "Thang âm"');
  });

  it('file có marker hợp lý → section theo marker (dòng ngắt đúng chỗ marker)', async () => {
    const spec: SmfSpec = {
      format: 1,
      ppq: PPQ,
      tracks: [
        {
          name: 'Conductor',
          events: [
            { tick: 0, type: 'tempo', bpm: 100 },
            { tick: 0, type: 'marker', text: 'Verse' },
            { tick: 16 * PPQ, type: 'marker', text: 'Chorus' },
          ],
        },
        {
          name: 'Melody',
          events: notes(Array.from({ length: 32 }, (_, i) => [i, 1, 60 + (i % 8)] as const)),
        },
      ],
    };
    render(<MidiImportView />);
    await pick(midiFile(spec, 'markers.mid'));
    await stepHeading('Chọn track');
    next();
    await stepHeading('Trích melody');
    next();
    await stepHeading('Chọn cung và quãng');
    next();
    await stepHeading(ARRANGE);
    const text = preview();
    expect(text).toMatch(/# Verse\n[^#]*# Chorus\n/);
    expect(screen.getByText(/section theo marker trong file \(2 section\)/)).toBeTruthy();
    expect(screen.getByText('2 section · 4 dòng · 32 nốt')).toBeTruthy();
  });

  it('chọn phương án khác ở bước 4 thì .harm đổi theo; Editor tắt cờ → mở Player', async () => {
    flags.editor = false;
    render(<MidiImportView />);
    await pick(midiFile(songSpec(), 'scale.midi'));
    await stepHeading('Chọn track');
    next();
    await stepHeading('Trích melody');
    next();
    await stepHeading('Chọn cung và quãng');
    const options = screen.getAllByRole('button', { name: /^t=/ });
    expect(options.length).toBeGreaterThan(1);
    const other = options[1];
    fireEvent.click(other);
    expect(other.getAttribute('aria-pressed')).toBe('true');
    next();
    await stepHeading(ARRANGE);
    expect(preview()).not.toContain('Z X C V B N M ,');
    // quay lại bước 4 vẫn giữ lựa chọn
    fireEvent.click(screen.getByRole('button', { name: 'Quay lại' }));
    await stepHeading('Chọn cung và quãng');
    expect(
      screen.getByRole('button', { name: other.textContent ?? '' }).getAttribute('aria-pressed'),
    ).toBe('true');
    next();
    await stepHeading(ARRANGE);
    // không có Editor (cờ tắt) → không có chỗ Lưu bản nháp: lưu thẳng vào thư viện rồi phát
    expect(screen.queryByText(/dạng bản nháp/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Lưu và mở bài' }));
    const id = useLibrary.getState().songs[0].id;
    expect(navigate).toHaveBeenCalledWith(`/play/${encodeURIComponent(id)}`);
  });

  it('file quá lớn: báo lỗi rõ, không đọc file, vẫn ở bước 1', async () => {
    render(<MidiImportView />);
    const big = new File([new Uint8Array(MAX_MIDI_BYTES + 1)], 'big.mid');
    const read = vi.spyOn(big, 'arrayBuffer');
    await pick(big);
    expect((await screen.findByRole('alert', {}, { timeout: 10_000 })).textContent).toBe(
      'big.mid: file quá lớn (2.0 MB, tối đa 2 MB)',
    );
    expect(read).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { level: 2, name: 'Chọn file' })).toBeTruthy();
  });

  it('file hỏng / không có nốt / chỉ có trống: báo lỗi, không crash', async () => {
    render(<MidiImportView />);
    await pick(new File([new TextEncoder().encode('hello, not midi')], 'bad.mid'));
    expect((await screen.findByRole('alert', {}, { timeout: 10_000 })).textContent).toMatch(
      /^bad\.mid: không đọc được — file hỏng/,
    );

    await pick(
      midiFile(
        { format: 0, ppq: PPQ, tracks: [{ events: [{ tick: 0, type: 'tempo', bpm: 90 }] }] },
        'empty.mid',
      ),
    );
    await waitFor(
      () =>
        expect(screen.getByRole('alert').textContent).toBe('empty.mid: file MIDI không có nốt nào'),
      { timeout: 10_000 },
    );

    await pick(
      midiFile({ format: 0, ppq: PPQ, tracks: [{ events: notes([[0, 1, 36]], 9) }] }, 'drums.mid'),
    );
    await waitFor(
      () =>
        expect(screen.getByRole('alert').textContent).toBe(
          'drums.mid: file chỉ có track trống (kênh 10) — không có giai điệu để lấy',
        ),
      { timeout: 10_000 },
    );
    expect(screen.getByRole('heading', { level: 2, name: 'Chọn file' })).toBeTruthy();

    // file tốt sau lỗi: lỗi biến mất, sang bước 2
    await pick(midiFile(songSpec(), 'ok.mid'));
    await stepHeading('Chọn track');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('kéo thả file vào trang ở bước 1', async () => {
    render(<MidiImportView />);
    const file = midiFile(songSpec(), 'dropped.mid');
    const dataTransfer = { types: ['Files'], files: [file], dropEffect: 'none' };
    fireEvent.dragEnter(window, { dataTransfer });
    expect(screen.getByText('Thả file để mở')).toBeTruthy();
    await act(async () => {
      fireEvent.drop(window, { dataTransfer });
    });
    await stepHeading('Chọn track');
    // quay lại bước 1: thông tin file đã đọc + Tiếp
    fireEvent.click(screen.getByRole('button', { name: 'Quay lại' }));
    await stepHeading('Chọn file');
    expect(screen.getByText(/dropped\.mid: 2 track có nốt · 100 BPM · nhịp 4\/4/)).toBeTruthy();
    next();
    await stepHeading('Chọn track');
  });

  it('thả file ở bước sau: không để trình duyệt mở file, đọc file mới như chọn file', async () => {
    render(<MidiImportView />);
    await pick(midiFile(songSpec(), 'first.mid'));
    await stepHeading('Chọn track');
    next();
    await stepHeading('Trích melody');
    const file = midiFile(songSpec(), 'second.mid');
    const dataTransfer = { types: ['Files'], files: [file], dropEffect: 'none' };
    const over = new Event('dragover', { cancelable: true });
    Object.defineProperty(over, 'dataTransfer', { value: dataTransfer });
    window.dispatchEvent(over);
    expect(over.defaultPrevented).toBe(true);
    const drop = new Event('drop', { cancelable: true });
    Object.defineProperty(drop, 'dataTransfer', { value: dataTransfer });
    await act(async () => {
      window.dispatchEvent(drop);
    });
    expect(drop.defaultPrevented).toBe(true);
    await stepHeading('Chọn track');
    fireEvent.click(screen.getByRole('button', { name: 'Quay lại' }));
    await stepHeading('Chọn file');
    expect(screen.getByText(/second\.mid: 2 track có nốt/)).toBeTruthy();
  });

  it('nghe thử track: lên lịch synth, dừng khi bấm lại / đổi bước / unmount', async () => {
    const created: FakeAudioContext[] = [];
    class Stub extends FakeAudioContext {
      constructor(o?: unknown) {
        super({ state: 'running' }, o);
        created.push(this);
      }
    }
    vi.stubGlobal('AudioContext', Stub);
    useSettings.getState().set({ timbre: 'sine' });
    const { unmount } = render(<MidiImportView />);
    await pick(midiFile(songSpec(), 'p.mid'));
    await stepHeading('Chọn track');

    const play = screen.getByRole('button', { name: /^Nghe thử "Melody"/ });
    await act(async () => {
      fireEvent.click(play);
    });
    const stopBtn = screen.getByRole('button', { name: 'Dừng nghe thử "Melody"' });
    expect(stopBtn.getAttribute('aria-pressed')).toBe('true');
    const ctx = created[0];
    const oscs = ctx.oscillators();
    expect(oscs.length).toBeGreaterThan(0);
    const firstStop = oscs[0].stopTime ?? 0;

    // bấm lại = dừng
    await act(async () => {
      fireEvent.click(stopBtn);
    });
    expect(oscs[0].stopTime ?? Infinity).toBeLessThan(firstStop);
    expect(screen.getByRole('button', { name: /^Nghe thử "Melody"/ })).toBeTruthy();

    // đang phát mà sang bước khác → dừng
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^Nghe thử "Chords"/ }));
    });
    const chordOsc = ctx.oscillators().at(-1);
    const planned = chordOsc?.stopTime ?? 0;
    next();
    await stepHeading('Trích melody');
    expect(chordOsc?.stopTime ?? Infinity).toBeLessThan(planned);

    // nghe thử melody ở bước 3 rồi unmount → dừng
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^Nghe thử "melody đã trích"/ }));
    });
    const melOsc = ctx.oscillators().at(-1);
    const melPlanned = melOsc?.stopTime ?? 0;
    unmount();
    expect(melOsc?.stopTime ?? Infinity).toBeLessThan(melPlanned);
  });

  it('âm thanh bị chặn → toast lỗi, không đổi trạng thái', async () => {
    vi.stubGlobal('AudioContext', undefined);
    render(<MidiImportView />);
    await pick(midiFile(songSpec(), 'p.mid'));
    await stepHeading('Chọn track');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^Nghe thử "Melody"/ }));
    });
    expect(useToasts.getState().toasts.map((t) => t.text)).toContain(
      'Không bật được âm thanh để nghe thử',
    );
    expect(screen.queryByRole('button', { name: /^Dừng nghe thử/ })).toBeNull();
  });

  it('bước 3: đổi grid / policy chồng nốt cập nhật số nốt; không còn nốt thì khóa Tiếp', async () => {
    render(<MidiImportView />);
    await pick(midiFile(songSpec(), 'x.mid'));
    await stepHeading('Chọn track');
    fireEvent.click(checkbox('Chords'));
    fireEvent.click(checkbox('Melody'));
    next();
    await stepHeading('Trích melody');
    // hợp âm → 1 nốt mỗi hợp âm
    expect(screen.getByText(/2 nốt sau khi trích/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Khi nốt chồng nhau'), { target: { value: 'lowest' } });
    expect(screen.getByText(/2 nốt sau khi trích/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Lượng tử hóa (grid)'), { target: { value: '3' } });
    expect(screen.getByText(/2 nốt sau khi trích/)).toBeTruthy();
    // bpm ngoài miền: không nhận, ô báo invalid, Tiếp vẫn dùng bpm cũ
    const bpm = screen.getByLabelText('Tempo (BPM)') as HTMLInputElement;
    fireEvent.change(bpm, { target: { value: '5' } });
    expect(bpm.getAttribute('aria-invalid')).toBe('true');
    fireEvent.blur(bpm);
    expect(bpm.value).toBe('100');
  });

  it('file bị cụt: vẫn đọc phần còn lại nhưng cảnh báo rõ ở bước 1 và 2', async () => {
    const damaged = /File có vẻ bị cụt hoặc hỏng/;
    const whole = writeSmf({
      format: 0,
      ppq: PPQ,
      tracks: [{ events: notes(Array.from({ length: 32 }, (_, i) => [i, 1, 60 + (i % 12)])) }],
    });
    render(<MidiImportView />);
    await pick(
      new File([whole.slice(0, Math.floor(whole.length * 0.6))], 'truncated.mid', {
        type: 'audio/midi',
      }),
    );
    await stepHeading('Chọn track');
    expect(screen.getByText(damaged)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Quay lại' }));
    await stepHeading('Chọn file');
    expect(screen.getByText(damaged)).toBeTruthy();
    // file lành → hết cảnh báo
    await pick(midiFile(songSpec(), 'ok.mid'));
    await stepHeading('Chọn track');
    expect(screen.queryByText(damaged)).toBeNull();
  });

  it('track trùng tên (file type 0 tách theo kênh): mỗi dòng có tên truy cập riêng', async () => {
    const run = (pitches: readonly number[]) => pitches.map((m, i) => [i, 1, m] as const);
    render(<MidiImportView />);
    await pick(
      midiFile(
        {
          format: 0,
          ppq: PPQ,
          tracks: [
            {
              name: 'All',
              events: [...notes(run([72, 74, 76, 77]), 0), ...notes(run([48, 50, 52, 53]), 1)],
            },
          ],
        },
        'fmt0.mid',
      ),
    );
    await stepHeading('Chọn track');
    expect(checkbox('All · kênh 1')).toBeTruthy();
    expect(checkbox('All · kênh 2')).toBeTruthy();
    expect(screen.getByRole('img', { name: 'Piano roll của track "All · kênh 2"' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Nghe thử "All · kênh 1"/ })).toBeTruthy();
    // tên hiển thị vẫn là tên track
    expect(
      Array.from(document.querySelectorAll('.midi-track-name')).map((e) => e.textContent),
    ).toEqual(['All', 'All']);

    // trùng cả tên lẫn kênh (hai track file) → thêm số thứ tự track
    fireEvent.click(screen.getByRole('button', { name: 'Quay lại' }));
    await stepHeading('Chọn file');
    await pick(
      midiFile(
        {
          format: 1,
          ppq: PPQ,
          tracks: [
            { name: 'Piano', events: notes(run([72, 74, 76])) },
            { name: 'Piano', events: notes(run([48, 50, 52])) },
          ],
        },
        'pianos.mid',
      ),
    );
    await stepHeading('Chọn track');
    expect(checkbox('Piano · kênh 1 · track 1')).toBeTruthy();
    expect(checkbox('Piano · kênh 1 · track 2')).toBeTruthy();
  });

  it('chọn file mới: bước 5 về mặc định (D-135); mở bản nháp xong thì rời trang không hỏi', async () => {
    window.history.replaceState(null, '', '#/midi');
    render(
      <>
        <a href="#/">Thư viện</a>
        <MidiImportView />
      </>,
    );
    const toArrange = async () => {
      await stepHeading('Chọn track');
      next();
      await stepHeading('Trích melody');
      next();
      await stepHeading('Chọn cung và quãng');
      next();
      await stepHeading(ARRANGE);
    };
    const titleBox = () => screen.getByLabelText('Tên bài') as HTMLInputElement;
    await pick(midiFile(songSpec(), 'a.mid'));
    await toArrange();
    expect(titleBox().value).toBe('a');
    fireEvent.change(titleBox(), { target: { value: 'Tên tự đặt' } });
    expect(titleBox().value).toBe('Tên tự đặt');
    for (const h of ['Chọn cung và quãng', 'Trích melody', 'Chọn track', 'Chọn file']) {
      fireEvent.click(screen.getByRole('button', { name: 'Quay lại' }));
      await stepHeading(h);
    }
    await pick(midiFile(songSpec(), 'b.mid'));
    await toArrange();
    expect(titleBox().value).toBe('b');

    fireEvent.click(screen.getByRole('button', { name: 'Mở trong Editor' }));
    expect(navigate).toHaveBeenCalled();
    // việc dở đã sang Editor (bản nháp) → link / đổi hash đi thẳng, không hỏi
    fireEvent.click(screen.getByRole('link', { name: 'Thư viện' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    await act(async () => {
      window.location.hash = '#/';
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(window.location.hash).toBe('#/');
    window.history.replaceState(null, '', '/');
  });

  it('rời trang khi đang tạo dở: hỏi trước; Ở lại giữ nguyên, Bỏ và rời đi thì đi', async () => {
    window.history.replaceState(null, '', '#/midi');
    render(
      <>
        <a href="#/">Thư viện</a>
        <MidiImportView />
      </>,
    );
    const link = () => screen.getByRole('link', { name: 'Thư viện', hidden: true });
    await pick(midiFile(songSpec(), 'a.mid'));
    await stepHeading('Chọn track');

    fireEvent.click(link());
    const dialog = screen.getByRole('dialog', { name: 'Rời trang tạo bài?' });
    expect(dialog.textContent).toMatch(/chưa được lưu/);
    expect(window.location.hash).toBe('#/midi');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Ở lại' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('heading', { level: 2, name: 'Chọn track' })).toBeTruthy();

    // Back / đổi hash cũng bị chặn (trả URL cũ) rồi hỏi
    act(() => {
      window.location.hash = '#/settings';
    });
    const asked = await screen.findByRole('dialog', { name: 'Rời trang tạo bài?' });
    expect(window.location.hash).toBe('#/midi');
    fireEvent.click(within(asked).getByRole('button', { name: 'Bỏ và rời đi' }));
    expect(window.location.hash).toBe('#/settings');

    // đóng tab / tải lại: beforeunload
    const ev = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false); // đã chọn rời đi → không chặn nữa
    window.history.replaceState(null, '', '/');
  });

  it('beforeunload chỉ chặn khi có việc dở', async () => {
    render(<MidiImportView />);
    const fire = () => {
      const ev = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(ev);
      return ev.defaultPrevented;
    };
    expect(fire()).toBe(false);
    await pick(midiFile(songSpec(), 'a.mid'));
    await stepHeading('Chọn track');
    expect(fire()).toBe(true);
  });
});

describe('MidiImportView — tab', () => {
  it('phím mũi tên đổi tab; trình duyệt không có Web MIDI → giải thích 1 dòng', () => {
    render(<MidiImportView />);
    const fileTab = screen.getByRole('tab', { name: 'Từ file' });
    fireEvent.keyDown(fileTab, { key: 'ArrowRight' });
    const recTab = screen.getByRole('tab', { name: 'Thu melody' });
    expect(recTab.getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(recTab);
    expect(
      screen.getByText(/Trình duyệt này không hỗ trợ Web MIDI/, { selector: 'p' }),
    ).toBeTruthy();
    fireEvent.keyDown(recTab, { key: 'Home' });
    expect(fileTab.getAttribute('aria-selected')).toBe('true');
  });

  it('tiếng Anh', async () => {
    useSettings.getState().set({ language: 'en' });
    render(<MidiImportView />);
    expect(
      screen.getByRole('heading', { level: 1, name: 'Create from a MIDI / MusicXML file' }),
    ).toBeTruthy();
    await act(async () => {
      fireEvent.change(
        screen.getByLabelText(
          'Choose a MIDI (.mid, .midi) or MusicXML (.musicxml, .xml, .mxl) file',
        ),
        {
          target: { files: [midiFile(songSpec(), 'a.mid')] },
        },
      );
    });
    await screen.findByRole('heading', { level: 2, name: 'Choose a track' }, { timeout: 10_000 });
    expect(screen.getByText('1 drum track (channel 10) hidden.')).toBeTruthy();
  });
});

describe('MidiImportView — gộp nhiều track (Phase 2c)', () => {
  /** Giai điệu chia ở 2 track (câu 1 / câu 2) + track đệm; meta lời ở conductor (bị bỏ qua). */
  function splitSpec(): SmfSpec {
    return {
      format: 1,
      ppq: PPQ,
      tracks: [
        {
          name: 'Conductor',
          events: [
            { tick: 0, type: 'tempo', bpm: 90 },
            { tick: 0, type: 'lyric', text: 'Đồ' },
            { tick: 4 * PPQ, type: 'lyric', text: 'Sol' },
          ],
        },
        { name: 'Lead A', events: notes([60, 62, 64, 65].map((m, i) => [i, 1, m] as const)) },
        { name: 'Pad', events: notes([[0, 8, 48]], 1) },
        { name: 'Lead B', events: notes([67, 69, 71, 72].map((m, i) => [4 + i, 1, m] as const)) },
      ],
    };
  }

  it('chọn 2 track → gộp rồi trích (chồng nốt xử lý qua các track), không lời', async () => {
    render(<MidiImportView />);
    await pick(midiFile(splitSpec(), 'split.mid'));
    await stepHeading('Chọn track');
    // gợi ý một track (Lead B: cao nhất); chọn thêm Lead A
    expect(checkbox('Lead B').checked).toBe(true);
    expect(checkbox('Lead A').checked).toBe(false);
    fireEvent.click(checkbox('Lead A'));
    expect(screen.getByText('Đã chọn 2 track · 8 nốt · tầm C4–C5')).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Nghe thử "các track đã chọn"/ })).toBeTruthy();

    next();
    await stepHeading('Trích melody');
    expect(screen.getByText('8 nốt sau khi trích')).toBeTruthy();
    expect(screen.getByText('2 track đã chọn có 8 nốt')).toBeTruthy();

    // thêm track đệm (nốt dài, thấp) → policy "cao nhất" vẫn ra 8 nốt giai điệu
    fireEvent.click(screen.getByRole('button', { name: 'Quay lại' }));
    await stepHeading('Chọn track');
    fireEvent.click(checkbox('Pad'));
    expect(screen.getByText('Đã chọn 3 track · 9 nốt · tầm C3–C5')).toBeTruthy();
    next();
    await stepHeading('Trích melody');
    expect(screen.getByText(/8 nốt sau khi trích/)).toBeTruthy();
    expect(screen.getByText('3 track đã chọn có 9 nốt')).toBeTruthy();

    next();
    await stepHeading('Chọn cung và quãng');
    next();
    await stepHeading(ARRANGE);
    const text = preview();
    expect(text).toContain('Z X C V B N M ,');
    expect(text).not.toMatch(/Đồ|Sol/);
    fireEvent.click(screen.getByRole('button', { name: 'Mở trong Editor' }));
    expect(useLibrary.getState().songs).toHaveLength(0);
    expect(getSong(lastDraftId())?.source).toBe(text);
  });

  it('kéo thả từ thanh tải xuống: chỉ có items kind "file" (files rỗng) vẫn mở được', async () => {
    render(<MidiImportView />);
    const file = midiFile(songSpec(), 'download.mid');
    const dataTransfer = {
      types: ['Files'],
      files: [],
      items: [{ kind: 'file', type: 'audio/midi', getAsFile: () => file }],
      dropEffect: 'none',
    };
    fireEvent.dragEnter(window, { dataTransfer });
    expect(screen.getByText('Thả file để mở')).toBeTruthy();
    await act(async () => {
      fireEvent.drop(window, { dataTransfer });
    });
    await stepHeading('Chọn track');
  });

  it('thả chỉ có đường dẫn (không có file) → báo cách làm; thả chữ thường thì bỏ qua', async () => {
    render(<MidiImportView />);
    const uri = { types: ['text/uri-list'], files: [], items: [] };
    const over = new Event('dragover', { cancelable: true });
    Object.defineProperty(over, 'dataTransfer', { value: uri });
    window.dispatchEvent(over);
    expect(over.defaultPrevented).toBe(true);
    await act(async () => {
      fireEvent.drop(window, { dataTransfer: uri });
    });
    expect(screen.getByRole('alert').textContent).toMatch(/Trình duyệt chỉ gửi đường dẫn/);

    const text = new Event('dragover', { cancelable: true });
    Object.defineProperty(text, 'dataTransfer', { value: { types: ['text/plain'] } });
    window.dispatchEvent(text);
    expect(text.defaultPrevented).toBe(false);
  });

  it('file không phải MIDI / MusicXML → báo rõ loại file nhận được', async () => {
    render(<MidiImportView />);
    await pick(new File(['hello'], 'notes.txt', { type: 'text/plain' }));
    expect((await screen.findByRole('alert', {}, { timeout: 10_000 })).textContent).toBe(
      'notes.txt: không nhận ra loại file — chỉ nhận MIDI (.mid, .midi) và MusicXML (.musicxml, .xml, .mxl)',
    );
    // không đuôi nhưng nội dung là MIDI → vẫn mở
    await pick(midiFile(songSpec(), 'download'));
    await stepHeading('Chọn track');
  });
});

describe('MidiImportView — kiểu điều khiển Mobile', () => {
  it('bước 4 dùng cost model theo Cài đặt (scheme / mobileSemitone truyền cho OptimizerPanel)', async () => {
    useSettings.getState().set({ controlScheme: 'mobile', mobileSemitone: 'oneShot' });
    render(<MidiImportView />);
    await pick(midiFile(songSpec(), 'm.mid'));
    await stepHeading('Chọn track');
    next();
    await stepHeading('Trích melody');
    next();
    await stepHeading('Chọn cung và quãng');
    const props = panelProps.last as {
      scheme?: string;
      mobileSemitone?: string;
      value: Placement | null;
    };
    expect(props.scheme).toBe('mobile');
    expect(props.mobileSemitone).toBe('oneShot');
    // phương án chọn sẵn tính bằng cost model mobile (có số lần chạm)
    expect(props.value?.stats.octaveTaps).toBeTypeOf('number');
  });
});

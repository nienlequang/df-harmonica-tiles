/**
 * Wizard "Tạo bài từ file" với MusicXML (.musicxml / .mxl) tự sinh: chọn bè + giọng, trích melody
 * (grid mặc định tắt), .harm không có lời, section theo rehearsal mark, kết quả mở trong Editor dạng
 * bản nháp, lỗi rõ ràng. OptimizerPanel (module của agent khác) thay bằng bản giả tối thiểu như
 * MidiImportView.test.tsx; navigate được mock.
 */
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Placement } from '../core/optimizer';
import { getSong, isDraftSong, useLibrary } from '../library/store';
import type * as Router from '../ui/router';
import { navigate } from '../ui/router';
import { useSettings } from '../ui/settings';
import { useToasts } from '../ui/toast';
import { MidiImportView } from './MidiImportView';
import { attributes, backup, barline, direction, measure, n, scoreXml } from './testing/musicxml';
import { buildMxl } from './testing/zipBuild';
import { MAX_MXL_BYTES } from './types';

vi.mock('../ui/router', async (importOriginal) => ({
  ...(await importOriginal<typeof Router>()),
  navigate: vi.fn(),
}));
vi.mock('../ui/features', () => ({
  FEATURES: { editor: true, share: false, midiImport: true },
}));

interface FakePanelProps {
  pitches: readonly (number | null)[];
  baseOctave: number;
  value: Placement | null;
  onChange: (p: Placement) => void;
}
vi.mock('../editor/OptimizerPanel', async () => {
  const { optimizeTranspose } = await import('../core/optimizer');
  return {
    OptimizerPanel: (props: FakePanelProps) => {
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

/**
 * "Thương Ca": bè hát (2 lượt lời, đoạn lặp ‖: m1 m2 :‖, rehearsal A / B, tempo 80) + piano 2
 * khuông (voice 1 khuông trên, voice 5 khuông dưới).
 */
function songXml(): string {
  const v = (one: string, two?: string) => [
    { n: 1, text: one },
    ...(two !== undefined ? [{ n: 2, text: two }] : []),
  ];
  const attrs = attributes({ divisions: 1, time: [4, 4] });
  const pianoAttrs = attributes({ divisions: 1, time: [4, 4], staves: 2 });
  const piano = (rh: string, lh: string) =>
    n(rh, 4, { staff: 1 }) + backup(4) + n(lh, 4, { voice: 5, staff: 2 });
  return scoreXml({
    title: 'Thương Ca',
    composer: 'Ai Đó',
    parts: [
      {
        id: 'P1',
        name: 'Giọng hát',
        instrument: 'Voice',
        measures: [
          measure(
            attrs +
              barline('left', { repeat: 'forward' }) +
              direction({ rehearsal: 'A', soundTempo: 80 }) +
              n('C4', 1, { lyric: v('Em', 'Anh') }) +
              n('D4', 1, { lyric: v('ơi', 'à') }) +
              n('E4', 1, { lyric: v('nhớ') }) +
              n('F4', 1, { lyric: v('mãi') }),
          ),
          measure(n('G4', 4, { lyric: v('thôi') }) + barline('right', { repeat: 'backward' })),
          measure(direction({ rehearsal: 'B' }) + n('C5', 4, { lyric: v('nhé') })),
        ],
      },
      {
        id: 'P2',
        name: 'Piano',
        instrument: 'Piano',
        measures: [
          measure(pianoAttrs + piano('E5', 'C3')),
          measure(piano('F5', 'D3')),
          measure(piano('G5', 'E3')),
        ],
      },
    ],
  });
}

function fileInput(): HTMLInputElement {
  return screen.getByLabelText(
    'Chọn file MIDI (.mid, .midi) hoặc MusicXML (.musicxml, .xml, .mxl)',
  ) as HTMLInputElement;
}

async function pick(file: File) {
  await act(async () => {
    fireEvent.change(fileInput(), { target: { files: [file] } });
  });
}

const stepHeading = (name: string) =>
  screen.findByRole('heading', { level: 2, name }, { timeout: 10_000 });
const next = () => fireEvent.click(screen.getByRole('button', { name: 'Tiếp' }));
const preview = () => screen.getByLabelText('Xem trước .harm').textContent ?? '';
const alertText = async () =>
  (await screen.findByRole('alert', {}, { timeout: 10_000 })).textContent;

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => null);
  useLibrary.setState({ songs: [] });
  useToasts.setState({ toasts: [] });
  useSettings.getState().reset();
});

describe('Tạo bài từ file — MusicXML', () => {
  it('đi hết 5 bước: bè gợi ý (bè hát), grid tắt, tên + tác giả từ bản nhạc, không lời', async () => {
    render(<MidiImportView />);
    expect(
      screen.getByRole('heading', { level: 1, name: 'Tạo bài từ file MIDI / MusicXML' }),
    ).toBeTruthy();
    await pick(new File([songXml()], 'thuong_ca.musicxml', { type: 'application/xml' }));

    expect(document.activeElement).toBe(await stepHeading('Chọn bè và giọng'));
    expect(
      screen.getByText('Dấu lặp và volta (1., 2.) đã được trải ra theo thứ tự chơi.'),
    ).toBeTruthy();
    const table = screen.getByRole('table', { name: 'Các bè có nốt trong bản nhạc' });
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows.map((r) => r.querySelector('.midi-track-name')?.textContent)).toEqual([
      'Giọng hát',
      'Piano',
    ]);
    expect(within(rows[0]).getByText('Gợi ý')).toBeTruthy();
    expect(within(rows[0]).queryByText('2 lượt')).toBeNull();
    expect(within(table).queryByRole('columnheader', { name: 'Lời' })).toBeNull();
    expect(within(rows[1]).getByText(/· 2 khuông$/)).toBeTruthy();
    // mật độ so với tempo — cơ sở của gợi ý (11 nốt / 20 beat × 80 BPM; piano 10 nốt)
    expect(within(rows[0]).getByText('≈ 44 nốt/phút · BPM 80')).toBeTruthy();
    expect(within(rows[1]).getByText(/^≈ 40 nốt\/phút · BPM 80/)).toBeTruthy();
    const voiceRadio = screen.getByRole('radio', {
      name: 'Chọn bè "Giọng hát"',
    }) as HTMLInputElement;
    expect(voiceRadio.checked).toBe(true);
    // một giọng → không có ô chọn giọng; không còn ô chọn lượt lời
    expect(screen.queryByLabelText('Giọng (voice)')).toBeNull();
    expect(screen.queryByLabelText('Lời')).toBeNull();
    expect(screen.getByText('11 nốt · tầm C4–C5')).toBeTruthy();

    // bè piano: chọn giọng (mặc định giọng 1 khuông trên), đổi giọng cập nhật thống kê
    fireEvent.click(screen.getByRole('radio', { name: 'Chọn bè "Piano"' }));
    const voiceSel = screen.getByLabelText('Giọng (voice)') as HTMLSelectElement;
    expect(voiceSel.value).toBe('1');
    expect(Array.from(voiceSel.options).map((o) => o.text)).toEqual([
      'Tất cả giọng (gộp)',
      'Giọng 1 · khuông 1 · 5 nốt',
      'Giọng 5 · khuông 2 · 5 nốt',
    ]);
    expect(screen.getByText('5 nốt · tầm E5–G5')).toBeTruthy();
    fireEvent.change(voiceSel, { target: { value: '5' } });
    expect(screen.getByText('5 nốt · tầm C3–E3')).toBeTruthy();
    fireEvent.change(voiceSel, { target: { value: 'all' } });
    expect(screen.getByText('10 nốt · tầm C3–G5')).toBeTruthy();
    expect(screen.queryByLabelText('Lời')).toBeNull();

    // quay về bè hát (click vào dòng)
    fireEvent.click(within(rows[0]).getByText('C4–C5'));
    expect(voiceRadio.checked).toBe(true);

    next();
    await stepHeading('Trích melody');
    expect((screen.getByLabelText('Lượng tử hóa (grid)') as HTMLSelectElement).value).toBe('3');
    expect((screen.getByLabelText('Tempo (BPM)') as HTMLInputElement).value).toBe('80');
    expect(screen.getByText('11 nốt sau khi trích')).toBeTruthy();
    expect(screen.getByText('Bè gốc có 11 nốt')).toBeTruthy();

    next();
    await stepHeading('Chọn cung và quãng');
    expect(screen.getByRole('button', { name: 't=0' }).getAttribute('aria-pressed')).toBe('true');
    next();
    await stepHeading('Xem trước và tạo bài');
    expect((screen.getByLabelText('Tên bài') as HTMLInputElement).value).toBe('Thương Ca');
    expect((screen.getByLabelText('Tác giả (không bắt buộc)') as HTMLInputElement).value).toBe(
      'Ai Đó',
    );
    const text = preview();
    expect(text).toContain('@title Thương Ca');
    expect(text).toContain('@artist Ai Đó');
    expect(text).toContain('@bpm 80');
    expect(text).toContain('# A');
    expect(text).toContain('# B');
    // đoạn lặp trải ra 2 lần; không có lời (kể cả lời của bản nhạc)
    expect(text.split('\n').filter((l) => l === 'Z X C V B*4')).toHaveLength(2);
    expect(text).toContain('\n,*4\n');
    expect(text).not.toMatch(/Em|Anh|nhé/);
    // section theo rehearsal mark (A, A, B) — tự động, không còn công tắc
    expect(screen.getByText(/section theo marker trong file \(3 section\)/)).toBeTruthy();
    expect(screen.queryByRole('switch')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Mở trong Editor' }));
    // bản nháp: chưa vào thư viện
    expect(useLibrary.getState().songs).toHaveLength(0);
    const target = vi.mocked(navigate).mock.calls.at(-1)?.[0] ?? '';
    const draftId = decodeURIComponent(target.replace(/^\/edit\//, ''));
    expect(isDraftSong(draftId)).toBe(true);
    expect(getSong(draftId)?.source).toBe(text);
  });

  it('.mxl kéo thẳng từ thanh tải xuống (items kind "file", files rỗng)', async () => {
    render(<MidiImportView />);
    const file = new File([buildMxl(songXml(), 'score/thuong ca.musicxml')], 'thuong-ca.mxl');
    const dataTransfer = {
      types: ['Files'],
      files: [],
      items: [{ kind: 'file', type: '', getAsFile: () => file }],
    };
    fireEvent.dragEnter(window, { dataTransfer });
    await act(async () => {
      fireEvent.drop(window, { dataTransfer });
    });
    await stepHeading('Chọn bè và giọng');
    fireEvent.click(screen.getByRole('button', { name: 'Quay lại' }));
    await stepHeading('Chọn file');
    expect(screen.getByText('thuong-ca.mxl: 2 bè có nốt · 80 BPM · nhịp 4/4')).toBeTruthy();
  });

  it('lỗi rõ ràng: timewise, XML không phải MusicXML, XML hỏng, .mxl hỏng / quá lớn', async () => {
    render(<MidiImportView />);
    await pick(new File(['<score-timewise><measure number="1"/></score-timewise>'], 'tw.musicxml'));
    expect(await alertText()).toMatch(/^tw\.musicxml: MusicXML dạng "timewise" chưa được hỗ trợ/);

    await pick(new File(['<?xml version="1.0"?><root/>'], 'data.xml'));
    expect(await alertText()).toBe('data.xml: file XML này không phải bản nhạc MusicXML');

    await pick(new File(['<score-partwise><part>'], 'broken.musicxml'));
    expect(await alertText()).toBe('broken.musicxml: không đọc được — file XML bị hỏng');

    await pick(new File([new Uint8Array([0x50, 0x4b, 3, 4, 1, 2, 3])], 'bad.mxl'));
    expect(await alertText()).toBe('bad.mxl: file .mxl bị hỏng (không phải file nén ZIP hợp lệ)');

    const big = new File([new Uint8Array(MAX_MXL_BYTES + 1)], 'big.mxl');
    const read = vi.spyOn(big, 'arrayBuffer');
    await pick(big);
    expect(await alertText()).toBe('big.mxl: file quá lớn (5.0 MB, tối đa 5 MB)');
    expect(read).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { level: 2, name: 'Chọn file' })).toBeTruthy();
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
        { target: { files: [new File([songXml()], 'song.musicxml')] } },
      );
    });
    await screen.findByRole(
      'heading',
      { level: 2, name: 'Choose a part and voice' },
      { timeout: 10_000 },
    );
    expect(screen.getByText('11 notes · range C4–C5')).toBeTruthy();
    expect(screen.queryByText('2 verses')).toBeNull();
  });
});

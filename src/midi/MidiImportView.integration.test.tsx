/**
 * Wizard "Tạo bài từ file" với OptimizerPanel THẬT (src/editor/OptimizerPanel.tsx): phương án tối
 * ưu chọn sẵn, "Giữ cung gốc", gộp nốt vượt tầm luôn bật → dòng `//!` trong .harm, parse lại không
 * lỗi; MusicXML (clarinet Si giáng, bè có lời) đi hết wizard ra bài — không ghi lời. Kết quả mở trong
 * Editor dạng bản nháp (chưa vào thư viện).
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseHarm } from '../core/parser';
import { getSong, useLibrary } from '../library/store';
import type * as Router from '../ui/router';
import { navigate } from '../ui/router';
import { MidiImportView } from './MidiImportView';
import { attributes, measure, n, scoreXml } from './testing/musicxml';
import type { SmfEvent } from './testing/smf';
import { writeSmf } from './testing/smf';

vi.mock('../ui/router', async (importOriginal) => ({
  ...(await importOriginal<typeof Router>()),
  navigate: vi.fn(),
}));
vi.mock('../ui/features', () => ({
  FEATURES: { editor: true, share: false, midiImport: true },
}));

const PPQ = 480;

function fileOf(pitches: readonly number[], name: string): File {
  const events: SmfEvent[] = [
    { tick: 0, type: 'tempo', bpm: 96 },
    ...pitches.map((midi, i) => ({
      tick: i * PPQ,
      type: 'note' as const,
      midi,
      duration: PPQ,
    })),
  ];
  const bytes = writeSmf({ format: 0, ppq: PPQ, tracks: [{ name: 'Lead', events }] });
  return new File([new Uint8Array(bytes)], name);
}

async function toKeyStep(file: File) {
  render(<MidiImportView />);
  await act(async () => {
    fireEvent.change(
      screen.getByLabelText('Chọn file MIDI (.mid, .midi) hoặc MusicXML (.musicxml, .xml, .mxl)'),
      {
        target: { files: [file] },
      },
    );
  });
  await screen.findByRole('heading', { level: 2, name: 'Chọn track' }, { timeout: 10_000 });
  fireEvent.click(screen.getByRole('button', { name: 'Tiếp' }));
  await screen.findByRole('heading', { level: 2, name: 'Trích melody' });
  fireEvent.click(screen.getByRole('button', { name: 'Tiếp' }));
  await screen.findByRole('heading', { level: 2, name: 'Chọn cung và quãng' });
}

const next = () => fireEvent.click(screen.getByRole('button', { name: 'Tiếp' }));
const harmPreview = () => screen.getByLabelText('Xem trước .harm').textContent ?? '';

/** Nguồn của bản nháp mà lần navigate gần nhất mở trong Editor. */
function lastDraftSource(): string | undefined {
  const target = vi.mocked(navigate).mock.calls.at(-1)?.[0] ?? '';
  return getSong(decodeURIComponent(target.replace(/^\/edit\//, '')))?.source;
}

// @tonejs/midi được import động trong view — nạp trước để lần chọn file đầu không chậm
beforeAll(async () => {
  await import('./midiFile');
});

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => null);
  useLibrary.setState({ songs: [] });
});

describe('MidiImportView + OptimizerPanel thật', () => {
  it('G trưởng: mặc định phương án tối ưu (không scroll); "Giữ cung gốc" ra bài có nốt scroll', async () => {
    // G A B C D E F# G
    await toKeyStep(fileOf([67, 69, 71, 72, 74, 76, 78, 79], 'g_major.mid'));
    const radios = screen.getAllByRole('radio') as HTMLInputElement[];
    expect(radios.length).toBeGreaterThan(1);
    expect(radios[0].checked).toBe(true);
    next();
    await screen.findByRole('heading', { level: 2, name: 'Xem trước và tạo bài' });
    const best = harmPreview();
    expect(best).toContain('Z X C V B N M ,');
    expect(best).not.toMatch(/\[giữ scroll\]/);

    fireEvent.click(screen.getByRole('button', { name: 'Quay lại' }));
    await screen.findByRole('heading', { level: 2, name: 'Chọn cung và quãng' });
    fireEvent.click(screen.getByRole('button', { name: 'Giữ cung gốc' }));
    next();
    await screen.findByRole('heading', { level: 2, name: 'Xem trước và tạo bài' });
    const original = harmPreview();
    expect(original).toMatch(/\[giữ scroll\]/);
    expect(parseHarm(original).ok).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Mở trong Editor' }));
    expect(useLibrary.getState().songs).toHaveLength(0);
    expect(lastDraftSource()).toBe(original);
  });

  it('tầm quá rộng: gộp nốt vượt tầm luôn bật (không có công tắc) → dòng //! cảnh báo', async () => {
    // C2 … C7: rộng hơn 3 quãng tám của harmonica
    await toKeyStep(fileOf([36, 48, 60, 72, 84, 96], 'wide.mid'));
    expect(screen.queryByRole('switch')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Bật gập quãng' })).toBeNull();
    expect((screen.getByRole('button', { name: 'Tiếp' }) as HTMLButtonElement).disabled).toBe(
      false,
    );
    expect(screen.getByText(/nốt sẽ bị gập quãng/)).toBeTruthy();
    next();
    await screen.findByRole('heading', { level: 2, name: 'Xem trước và tạo bài' });
    const text = harmPreview();
    const notes = text.split('\n').filter((l) => l.startsWith('//! '));
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatch(/^\/\/! Có \d+ nốt bị gập quãng cho vừa tầm C3–C6$/);
    const parsed = parseHarm(text);
    expect(parsed.ok).toBe(true);
    expect(parsed.diagnostics.some((d) => d.code === 'annotation')).toBe(true);
    expect(screen.getByText(/nốt bị gập quãng — dòng của/)).toBeTruthy();
  });
});

describe('MusicXML + OptimizerPanel thật', () => {
  it('clarinet Si giáng (viết Rê trưởng = Đô trưởng thật) có lời → bài không scroll, không lời', async () => {
    const lyric = ['Một', 'hai', 'ba', 'bốn', 'năm', 'sáu', 'bảy', 'tám'];
    const written = ['D4', 'E4', 'F#4', 'G4', 'A4', 'B4', 'C#5', 'D5'];
    const xml = scoreXml({
      title: 'Thang âm',
      parts: [
        {
          id: 'P1',
          name: 'Clarinet in B♭',
          measures: [
            measure(
              attributes({
                divisions: 2,
                time: [4, 4],
                transpose: { chromatic: -2, diatonic: -1 },
              }) +
                written
                  .slice(0, 4)
                  .map((p, i) => n(p, 2, { lyric: lyric[i] }))
                  .join(''),
            ),
            measure(
              written
                .slice(4)
                .map((p, i) => n(p, 2, { lyric: lyric[i + 4] }))
                .join(''),
            ),
          ],
        },
      ],
    });
    render(<MidiImportView />);
    await act(async () => {
      fireEvent.change(
        screen.getByLabelText('Chọn file MIDI (.mid, .midi) hoặc MusicXML (.musicxml, .xml, .mxl)'),
        { target: { files: [new File([xml], 'scale.musicxml')] } },
      );
    });
    await screen.findByRole('heading', { level: 2, name: 'Chọn bè và giọng' }, { timeout: 10_000 });
    next();
    await screen.findByRole('heading', { level: 2, name: 'Trích melody' });
    next();
    await screen.findByRole('heading', { level: 2, name: 'Chọn cung và quãng' });
    next();
    await screen.findByRole('heading', { level: 2, name: 'Xem trước và tạo bài' });
    const text = harmPreview();
    expect(text).toContain('@title Thang âm');
    expect(text).toContain('\nZ X C V B N M ,\n');
    expect(text).not.toMatch(/Một|tám/);
    expect(text).not.toMatch(/\[giữ scroll\]/);
    const parsed = parseHarm(text);
    expect(parsed.ok).toBe(true);
    expect(parsed.diagnostics).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: 'Mở trong Editor' }));
    expect(lastDraftSource()).toBe(text);
  });
});

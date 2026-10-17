import { describe, expect, it } from 'vitest';
import doc from '../../docs/AI-PROMPT-CAM-AM.md?raw';
import { parseCamAm } from '../core/camam';
import { AI_PROMPT_EN, AI_PROMPT_VI } from './aiPrompt';

/** Các khối PROMPT của tài liệu: giữa hàng rào ````text … ```` (mỗi hàng rào nằm riêng một dòng). */
function promptBlocks(md: string): string[] {
  const text = md.replace(/\r\n?/g, '\n');
  return [...text.matchAll(/^````text\n([\s\S]*?)\n````$/gm)].map((m) => m[1] ?? '');
}

/** Ví dụ đầu ra ở cuối prompt: khối ```text … ``` cuối cùng. */
function exampleOf(prompt: string): string {
  const m = /\n```text\n([\s\S]*?)\n```$/.exec(prompt);
  if (!m) throw new Error('prompt không có ví dụ đầu ra');
  return m[1] ?? '';
}

describe('AI prompt', () => {
  it('khớp NGUYÊN VĂN hai khối PROMPT của tài liệu (vi trước, en sau)', () => {
    const blocks = promptBlocks(doc);
    expect(blocks).toHaveLength(2);
    expect(AI_PROMPT_VI).toBe(blocks[0]);
    expect(AI_PROMPT_EN).toBe(blocks[1]);
  });

  it('đúng ngôn ngữ, không có khoảng trắng thừa hai đầu', () => {
    expect(AI_PROMPT_VI.startsWith('Bạn là chuyên gia ký âm.')).toBe(true);
    expect(AI_PROMPT_EN.startsWith('You are an expert music transcriber.')).toBe(true);
    for (const p of [AI_PROMPT_VI, AI_PROMPT_EN]) {
      expect(p).toBe(p.trim());
      expect(p).not.toContain('\r');
    }
  });

  it.each([
    ['vi', AI_PROMPT_VI],
    ['en', AI_PROMPT_EN],
  ])('ví dụ đầu ra (%s) parse với convention digits: 0 diagnostic', (_lang, prompt) => {
    const example = exampleOf(prompt);
    expect(example).toContain('@title');
    const r = parseCamAm(example, { convention: 'digits' });
    expect(r.diagnostics).toEqual([]);
    expect(r.melody.bpm).toBe(76);
    expect(r.melody.timeSig).toEqual({ num: 4, den: 4 });
    expect(r.melody.sections.map((s) => s.lines.length)).toEqual([2, 1]);
    // la1 mi1 la1 si1 do2 re2mi2 si1 = 8 nốt; fa#1 sib1 do2 re2 mi2 sol1 la1 la1 = 8; mi2 re2 do2 la1 = 4
    expect(r.noteCount).toBe(20);
    expect(r.melody.sections[0]?.lines[1]?.events.slice(0, 2).map((e) => e.midi)).toEqual([66, 70]);
    // ví dụ theo cả hai convention cho cùng kết quả (mọi nốt đều có số quãng)
    expect(parseCamAm(example, { convention: 'case' }).melody).toEqual(r.melody);
  });
});

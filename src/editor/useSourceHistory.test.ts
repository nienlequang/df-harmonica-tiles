import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SourceHistory, useSourceHistory } from './useSourceHistory';

describe('SourceHistory', () => {
  it('record → undo → redo theo ảnh chụp', () => {
    const h = new SourceHistory();
    expect(h.canUndo).toBe(false);
    expect(h.undo('x')).toBeNull();
    expect(h.redo('x')).toBeNull();

    h.record('v0', 'Tap');
    h.record('v1', 'Lời');
    expect(h.undoLabel).toBe('Lời');
    expect(h.undo('v2')).toBe('v1');
    expect(h.redoLabel).toBe('Lời');
    expect(h.undo('v1')).toBe('v0');
    expect(h.canUndo).toBe(false);
    expect(h.redo('v0')).toBe('v1');
    expect(h.redo('v1')).toBe('v2');
    expect(h.canRedo).toBe(false);
    expect(h.undoLabel).toBe('Lời');
  });

  it('chữ gõ sau thao tác công cụ không mất: undo cất văn bản hiện tại vào redo', () => {
    const h = new SourceHistory();
    h.record('gốc', 'Tap');
    // người dùng gõ thêm sau khi áp công cụ: hiện tại = 'sau tap + gõ'
    expect(h.undo('sau tap + gõ')).toBe('gốc');
    expect(h.redo('gốc')).toBe('sau tap + gõ');
  });

  it('record mới xóa nhánh redo; giới hạn số bước', () => {
    const h = new SourceHistory(3);
    h.record('a', '1');
    h.undo('b');
    expect(h.canRedo).toBe(true);
    h.record('a', '2');
    expect(h.canRedo).toBe(false);
    for (const s of ['b', 'c', 'd', 'e']) h.record(s, s);
    let n = 0;
    let cur = 'f';
    for (let r = h.undo(cur); r !== null; r = h.undo(cur)) {
      cur = r;
      n++;
    }
    expect(n).toBe(3);
    expect(cur).toBe('c');
    h.clear();
    expect(h.canUndo || h.canRedo).toBe(false);
  });
});

describe('useSourceHistory', () => {
  it('re-render khi trạng thái nút đổi', () => {
    const { result } = renderHook(() => useSourceHistory());
    expect(result.current.canUndo).toBe(false);
    act(() => result.current.record('a', 'Tap'));
    expect(result.current.canUndo).toBe(true);
    expect(result.current.undoLabel).toBe('Tap');
    let back: string | null = null;
    act(() => {
      back = result.current.undo('b');
    });
    expect(back).toBe('a');
    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(true);
    act(() => result.current.clear());
    expect(result.current.canRedo).toBe(false);
  });
});

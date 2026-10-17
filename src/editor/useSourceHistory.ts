import { useCallback, useMemo, useRef, useState } from 'react';

/**
 * Lịch sử Hoàn tác / Làm lại cho thao tác CÔNG CỤ trong Editor (tap timing, cảm âm,
 * tối ưu lại…). Gõ phím không vào đây — textarea giữ undo gốc của trình duyệt (Ctrl+Z).
 *
 * Lưu ảnh chụp văn bản: `record(before, label)` trước khi áp kết quả công cụ. Hoàn tác trả ảnh
 * chụp trước đó và cất văn bản HIỆN TẠI (gồm cả chữ gõ sau thao tác công cụ) vào Làm lại, nên
 * không mất gì.
 */

export interface HistoryStep {
  /** Văn bản để quay về. */
  text: string;
  /** Nhãn thao tác (hiện trên nút: "Hoàn tác: Tap timing"). */
  label: string;
}

export const HISTORY_LIMIT = 50;

/** Phần thuần (test được không cần React). */
export class SourceHistory {
  private undoStack: HistoryStep[] = [];
  private redoStack: HistoryStep[] = [];

  constructor(private readonly limit = HISTORY_LIMIT) {}

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  /** Nhãn của thao tác sẽ bị hoàn tác / làm lại tiếp theo. */
  get undoLabel(): string | null {
    return this.undoStack.at(-1)?.label ?? null;
  }

  get redoLabel(): string | null {
    return this.redoStack.at(-1)?.label ?? null;
  }

  /** Ghi ảnh chụp trước một thao tác công cụ; xóa nhánh Làm lại. */
  record(before: string, label: string): void {
    this.undoStack.push({ text: before, label });
    if (this.undoStack.length > this.limit)
      this.undoStack.splice(0, this.undoStack.length - this.limit);
    this.redoStack = [];
  }

  /** Văn bản sau khi hoàn tác (null nếu không có gì); `current` vào nhánh Làm lại. */
  undo(current: string): string | null {
    const step = this.undoStack.pop();
    if (!step) return null;
    this.redoStack.push({ text: current, label: step.label });
    return step.text;
  }

  /** Văn bản sau khi làm lại (null nếu không có gì); `current` vào lại nhánh Hoàn tác. */
  redo(current: string): string | null {
    const step = this.redoStack.pop();
    if (!step) return null;
    this.undoStack.push({ text: current, label: step.label });
    return step.text;
  }

  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
  }
}

export interface SourceHistoryApi {
  canUndo: boolean;
  canRedo: boolean;
  undoLabel: string | null;
  redoLabel: string | null;
  record(before: string, label: string): void;
  undo(current: string): string | null;
  redo(current: string): string | null;
  clear(): void;
}

/** Hook bọc SourceHistory, re-render khi trạng thái nút đổi. */
export function useSourceHistory(limit = HISTORY_LIMIT): SourceHistoryApi {
  const ref = useRef<SourceHistory | null>(null);
  if (ref.current === null) ref.current = new SourceHistory(limit);
  const history = ref.current;
  const [version, setVersion] = useState(0);
  const bump = useCallback(() => setVersion((v) => v + 1), []);

  const record = useCallback(
    (before: string, label: string) => {
      history.record(before, label);
      bump();
    },
    [history, bump],
  );
  const undo = useCallback(
    (current: string) => {
      const r = history.undo(current);
      bump();
      return r;
    },
    [history, bump],
  );
  const redo = useCallback(
    (current: string) => {
      const r = history.redo(current);
      bump();
      return r;
    },
    [history, bump],
  );
  const clear = useCallback(() => {
    history.clear();
    bump();
  }, [history, bump]);

  return useMemo(() => {
    // version đổi sau mỗi thao tác → đọc lại các getter
    void version;
    return {
      canUndo: history.canUndo,
      canRedo: history.canRedo,
      undoLabel: history.undoLabel,
      redoLabel: history.redoLabel,
      record,
      undo,
      redo,
      clear,
    };
  }, [history, version, record, undo, redo, clear]);
}

import { create } from 'zustand';

export interface Toast {
  id: number;
  text: string;
  kind: 'info' | 'error';
}

interface ToastStore {
  toasts: Toast[];
  push: (text: string, kind?: Toast['kind']) => void;
  dismiss: (id: number) => void;
}

let nextId = 1;

export const useToasts = create<ToastStore>()((set, get) => ({
  toasts: [],
  push: (text, kind = 'info') => {
    const id = nextId++;
    set({ toasts: [...get().toasts, { id, text, kind }] });
    setTimeout(() => get().dismiss(id), kind === 'error' ? 6000 : 3000);
  },
  dismiss: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
}));

/** Hiện thông báo ngắn (gọi được ngoài React). */
export function toast(text: string, kind: Toast['kind'] = 'info'): void {
  useToasts.getState().push(text, kind);
}

export interface ToastRegionProps {
  /**
   * 'bottom' (mặc định): giữa đáy màn hình. 'top': giữa đỉnh, không nhận chuột — dùng trong
   * Player để toast không che hàng modifier của game bar / hit line (D-063).
   */
  placement?: 'bottom' | 'top';
  /** Chỉ hiện N toast mới nhất (cái cũ vẫn tự hết hạn). Mặc định không giới hạn. */
  max?: number;
}

export function ToastRegion({ placement = 'bottom', max }: ToastRegionProps) {
  const all = useToasts((s) => s.toasts);
  const toasts = max !== undefined && all.length > max ? all.slice(all.length - max) : all;
  return (
    <div
      className={placement === 'top' ? 'toast-region is-top' : 'toast-region'}
      role="status"
      aria-live="polite"
    >
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.kind}`}>
          {t.text}
        </div>
      ))}
    </div>
  );
}

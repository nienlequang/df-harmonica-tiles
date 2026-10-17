import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
} from 'react';
import { useEffect, useId, useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useT } from '../i18n/useT';

/** Component UI dùng chung. Style trong app.css (class `btn`, `field`, `modal`…). */

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: 'sm' | 'md' | 'lg';
}

export function Button({
  variant = 'secondary',
  size = 'md',
  className,
  type = 'button',
  ...rest
}: ButtonProps) {
  const cls = ['btn', `btn-${variant}`, `btn-${size}`, className].filter(Boolean).join(' ');
  return <button type={type} className={cls} {...rest} />;
}

export interface IconButtonProps extends ButtonProps {
  /** Bắt buộc cho a11y vì nút chỉ có icon. */
  label: string;
}

export function IconButton({ label, className, ...rest }: IconButtonProps) {
  return (
    <Button
      aria-label={label}
      title={label}
      className={['btn-icon', className].filter(Boolean).join(' ')}
      {...rest}
    />
  );
}

export interface ToggleProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'onChange' | 'type'
> {
  label: ReactNode;
  checked: boolean;
  onChange: (checked: boolean) => void;
  hint?: ReactNode;
}

export function Toggle({
  label,
  checked,
  onChange,
  hint,
  className,
  'aria-describedby': describedBy,
  ...rest
}: ToggleProps) {
  const id = useId();
  const hintId = useId();
  // Hint được đọc kèm switch (screen reader), giữ cả aria-describedby do nơi gọi truyền vào.
  const describedByIds = [describedBy, hint ? hintId : undefined].filter(Boolean).join(' ');
  return (
    <div className={['field', 'field-toggle', className].filter(Boolean).join(' ')}>
      <input
        id={id}
        type="checkbox"
        role="switch"
        className="toggle"
        checked={checked}
        onChange={(e) => onChange(e.currentTarget.checked)}
        aria-describedby={describedByIds || undefined}
        {...rest}
      />
      <label htmlFor={id}>{label}</label>
      {hint ? (
        <p id={hintId} className="field-hint">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export interface SliderProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'onChange' | 'type' | 'value'
> {
  label: ReactNode;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  /** Hiển thị giá trị bên cạnh label. */
  format?: (value: number) => string;
}

export function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
  format,
  className,
  ...rest
}: SliderProps) {
  const id = useId();
  return (
    <div className={['field', 'field-slider', className].filter(Boolean).join(' ')}>
      <label htmlFor={id}>
        <span>{label}</span>
        <output htmlFor={id} className="field-value">
          {format ? format(value) : value}
        </output>
      </label>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.currentTarget.value))}
        {...rest}
      />
    </div>
  );
}

export interface SelectOption<T extends string> {
  value: T;
  label: string;
}

export interface SelectProps<T extends string> extends Omit<
  SelectHTMLAttributes<HTMLSelectElement>,
  'onChange' | 'value'
> {
  label: ReactNode;
  value: T;
  options: readonly SelectOption<T>[];
  onChange: (value: T) => void;
  /** Ẩn label (vẫn giữ cho screen reader). */
  hideLabel?: boolean;
}

export function Select<T extends string>({
  label,
  value,
  options,
  onChange,
  hideLabel,
  className,
  ...rest
}: SelectProps<T>) {
  const id = useId();
  return (
    <div className={['field', 'field-select', className].filter(Boolean).join(' ')}>
      <label htmlFor={id} className={hideLabel ? 'sr-only' : undefined}>
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.currentTarget.value as T)}
        {...rest}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

export interface ModalProps {
  open: boolean;
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  /** 'md' (mặc định) | 'lg' */
  size?: 'md' | 'lg';
  /**
   * Bấm nền (chuột trái) để đóng — mặc định có. `false` cho dialog không được mất vì một cú bấm
   * lỡ tay, vd. bảng kết quả practice (người chơi vẫn đang bấm chuột làm modifier khi bài hết).
   */
  closeOnBackdrop?: boolean;
}

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'area[href]',
  'button:not(:disabled)',
  'input:not(:disabled):not([type="hidden"])',
  'select:not(:disabled)',
  'textarea:not(:disabled)',
  'iframe',
  'summary',
  '[contenteditable]:not([contenteditable="false"])',
  '[tabindex]',
].join(',');

/** Phần tử Tab tới được trong `root`, theo thứ tự DOM (bỏ tabindex âm, phần tử hidden/inert). */
export function tabbableIn(root: ParentNode): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (el) => el.tabIndex >= 0 && el.closest('[hidden], [inert]') === null,
  );
}

interface OpenModal {
  dialog: HTMLElement;
  backdrop: HTMLElement;
  /** Nhận lại focus khi modal này đóng (phần tử có focus lúc mở). */
  restore: HTMLElement | null;
}

/** Modal đang mở theo thứ tự mở; phần tử cuối là modal trên cùng (D-061, D-144). */
const modalStack: OpenModal[] = [];
/** Phần tử do Modal đặt `inert` (không đụng `inert` có sẵn của nơi khác). */
const modalInert = new Set<Element>();

/** Chỉ modal trên cùng dùng được: mọi con khác của `<body>` (cả modal bên dưới) bị `inert`. */
function syncModalInert(): void {
  const top = modalStack[modalStack.length - 1];
  for (const el of Array.from(modalInert)) {
    if (top && el !== top.backdrop && el.isConnected) continue;
    el.removeAttribute('inert');
    modalInert.delete(el);
  }
  if (!top) return;
  for (const el of Array.from(document.body.children)) {
    if (el === top.backdrop || el.tagName === 'SCRIPT' || el.hasAttribute('inert')) continue;
    el.setAttribute('inert', '');
    modalInert.add(el);
  }
}

/**
 * Dialog modal (render qua portal vào `<body>`):
 * - mở: nền phía sau bị `inert` (không Tab / click / screen reader tới được), focus vào phần tử
 *   `[data-autofocus]` trong dialog nếu có (vd. nút Hủy của hộp xác nhận xóa), không thì dialog;
 * - Tab / Shift+Tab vòng trong dialog; Esc hoặc bấm nền (chuột trái) để đóng;
 * - đóng: bỏ `inert`, trả focus về phần tử trước đó.
 * Modal mở chồng lên modal khác (vd. hộp "Rời trình soạn?" trên modal Công cụ): chỉ modal trên cùng
 * nhận Tab / Esc, modal dưới bị `inert` tới khi modal trên đóng (D-144).
 */
export function Modal({
  open,
  title,
  onClose,
  children,
  footer,
  size = 'md',
  closeOnBackdrop = true,
}: ModalProps) {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  // onClose đổi identity mỗi render ở nơi gọi không được làm effect chạy lại (focus sẽ nhảy).
  const onCloseRef = useRef(onClose);
  useLayoutEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    if (!open) return;
    const dialog = ref.current;
    const backdrop = backdropRef.current;
    if (!dialog || !backdrop) return;
    const entry: OpenModal = {
      dialog,
      backdrop,
      restore: document.activeElement instanceof HTMLElement ? document.activeElement : null,
    };
    modalStack.push(entry);
    syncModalInert();
    (dialog.querySelector<HTMLElement>('[data-autofocus]') ?? dialog).focus();

    const onKey = (e: KeyboardEvent) => {
      // Mỗi modal có listener riêng trên window: chỉ modal trên cùng xử lý phím.
      if (modalStack[modalStack.length - 1] !== entry) return;
      if (e.key === 'Escape') {
        // Một Esc đóng đúng một dialog (chặn cả listener khác trên window).
        e.stopImmediatePropagation();
        onCloseRef.current();
        return;
      }
      if (e.key !== 'Tab') return;
      const items = tabbableIn(dialog);
      const first = items[0];
      const last = items[items.length - 1];
      if (!first || !last) {
        e.preventDefault();
        dialog.focus();
        return;
      }
      const active = document.activeElement;
      const inside = active instanceof Node && dialog.contains(active);
      if (e.shiftKey) {
        if (!inside || active === first || active === dialog) {
          e.preventDefault();
          last.focus();
        }
      } else if (!inside || active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      const i = modalStack.indexOf(entry);
      if (i < 0) return;
      const wasTop = i === modalStack.length - 1;
      modalStack.splice(i, 1);
      const above = modalStack[i];
      // Modal bên dưới đóng trước: modal phía trên trả focus về chỗ modal này nhận focus từ đó,
      // không phải phần tử trong dialog vừa biến mất.
      if (!wasTop && above && (above.restore === null || dialog.contains(above.restore))) {
        above.restore = entry.restore;
      }
      syncModalInert();
      if (wasTop) entry.restore?.focus();
    };
  }, [open]);

  if (!open) return null;
  return createPortal(
    <div
      ref={backdropRef}
      className="modal-backdrop"
      // Chỉ nút chính (chuột trái): bấm chuột phải / giữa lên nền không đóng dialog — practice mode
      // dùng chúng làm modifier (D-144).
      onMouseDown={(e) => {
        if (closeOnBackdrop && e.button === 0 && e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={ref}
        className={`modal modal-${size}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <header className="modal-header">
          <h2 id={titleId}>{title}</h2>
          <IconButton label={t('common.close')} variant="ghost" onClick={onClose}>
            <span aria-hidden="true">×</span>
          </IconButton>
        </header>
        <div className="modal-body">{children}</div>
        {footer ? <footer className="modal-footer">{footer}</footer> : null}
      </div>
    </div>,
    document.body,
  );
}

/** Tải một file xuống máy (export). */
export function downloadText(filename: string, text: string, mime = 'text/plain'): void {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Copy vào clipboard, fallback execCommand cho file:// / trình duyệt cũ. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fallback bên dưới
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

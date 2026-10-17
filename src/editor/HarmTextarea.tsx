import { memo, useLayoutEffect, useRef } from 'react';
import type { KeyboardEvent, RefObject } from 'react';
import type { DiagnosticSeverity } from '../core/types';

/** Đánh dấu một dòng nguồn trong gutter: mức nặng nhất + các thông điệp (title khi rê chuột). */
export interface LineMarker {
  severity: DiagnosticSeverity;
  messages: string[];
}

export interface HarmTextareaProps {
  id: string;
  value: string;
  onChange(value: string): void;
  /** Dòng nguồn 1-based → marker. */
  markers: ReadonlyMap<number, LineMarker>;
  textareaRef: RefObject<HTMLTextAreaElement>;
  /** Con trỏ đổi chỗ (offset UTF-16 của selectionStart). */
  onCaretChange?(offset: number): void;
  describedBy?: string;
  invalid?: boolean;
}

const TAB_TEXT = '  ';
const MARKER_GLYPH: Record<DiagnosticSeverity, string> = { error: '●', warning: '▲', info: 'i' };

const charWidthCache = new Map<string, number>();

/**
 * Bề rộng một ký tự của font monospace (đo bằng span ẩn, cache theo font). Không đo được (jsdom,
 * phần tử ẩn) → ước lượng 0.6em.
 */
function monoCharWidth(cs: CSSStyleDeclaration): number {
  const font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
  const hit = charWidthCache.get(font);
  if (hit !== undefined) return hit;
  const fallback = (Number.parseFloat(cs.fontSize) || 13) * 0.6;
  const probe = document.createElement('span');
  probe.textContent = '0'.repeat(40);
  probe.style.cssText = 'position:absolute;visibility:hidden;white-space:pre;left:-9999px;top:0';
  probe.style.font = cs.font || font;
  document.body.appendChild(probe);
  const w = probe.getBoundingClientRect().width / 40;
  probe.remove();
  if (!(w > 0)) return fallback;
  charWidthCache.set(font, w);
  return w;
}

/**
 * Đặt con trỏ tại offset, focus và đưa vị trí đó vào tầm nhìn: cuộn dọc + ngang trong ô soạn
 * (dòng dài vượt bề rộng ô), rồi cuộn trang nếu chính dòng đó nằm ngoài khung nhìn (bố cục một cột
 * ≤ 960px: ô soạn có thể đã cuộn khỏi màn hình). Gutter tự đồng bộ qua sự kiện scroll.
 */
export function moveCaret(ta: HTMLTextAreaElement, offset: number): void {
  const value = ta.value;
  const off = Math.min(value.length, Math.max(0, offset));
  ta.focus({ preventScroll: true });
  ta.setSelectionRange(off, off);
  let line = 0;
  for (let i = value.indexOf('\n'); i >= 0 && i < off; i = value.indexOf('\n', i + 1)) line++;
  const column = off - (value.lastIndexOf('\n', off - 1) + 1);

  const cs = getComputedStyle(ta);
  const lh = Number.parseFloat(cs.lineHeight) || 20;
  const padTop = Number.parseFloat(cs.paddingTop) || 0;
  const padLeft = Number.parseFloat(cs.paddingLeft) || 0;
  const top = line * lh;
  if (top < ta.scrollTop || top + lh > ta.scrollTop + ta.clientHeight) {
    ta.scrollTop = Math.max(0, top - ta.clientHeight / 3);
  }

  // Không có layout (jsdom, ô bị ẩn): bỏ phần cuộn ngang / cuộn trang.
  if (ta.clientWidth <= 0) return;
  const cw = monoCharWidth(cs);
  const x = padLeft + column * cw;
  if (x - padLeft < ta.scrollLeft || x + cw > ta.scrollLeft + ta.clientWidth - padLeft) {
    ta.scrollLeft = column === 0 ? 0 : Math.max(0, x - ta.clientWidth / 2);
  }

  const rect = ta.getBoundingClientRect();
  const view = window.innerHeight || document.documentElement.clientHeight;
  if (rect.height <= 0 || view <= 0) return;
  const y = rect.top + ta.clientTop + padTop + top - ta.scrollTop;
  // chừa ~15% khung nhìn phía trên cho thanh điều hướng dính (sticky) của app
  if (y < view * 0.15 || y + lh > view - 8) {
    window.scrollBy({ top: y - view / 3, behavior: 'auto' });
  }
}

interface GutterProps {
  count: number;
  markers: ReadonlyMap<number, LineMarker>;
  innerRef: RefObject<HTMLDivElement>;
}

/** Cột số dòng (aria-hidden: danh sách lỗi ở preview mới là nơi đọc được bằng screen reader). */
const Gutter = memo(function Gutter({ count, markers, innerRef }: GutterProps) {
  const rows = [];
  for (let n = 1; n <= count; n++) {
    const m = markers.get(n);
    rows.push(
      <div
        key={n}
        className={m ? `harm-gutter-line is-${m.severity}` : 'harm-gutter-line'}
        title={m ? m.messages.join('\n') : undefined}
      >
        {m ? <span className="harm-gutter-mark">{MARKER_GLYPH[m.severity]}</span> : null}
        {n}
      </div>,
    );
  }
  return (
    <div className="harm-gutter" aria-hidden="true">
      <div ref={innerRef} className="harm-gutter-inner">
        {rows}
      </div>
    </div>
  );
});

/** Chèn qua lệnh soạn thảo của trình duyệt (giữ Ctrl+Z gốc); false nếu không hỗ trợ. */
function execInsert(text: string): boolean {
  try {
    return (
      typeof document.execCommand === 'function' && document.execCommand('insertText', false, text)
    );
  } catch {
    return false;
  }
}

function countLines(text: string): number {
  let n = 1;
  for (let i = text.indexOf('\n'); i >= 0; i = text.indexOf('\n', i + 1)) n++;
  return n;
}

/**
 * Ô soạn `.harm`: textarea monospace không xuống dòng tự động, gutter số dòng cuộn theo textarea,
 * marker lỗi / cảnh báo / ghi chú theo dòng. Tab chèn 2 dấu cách (Esc rồi Tab, hoặc Shift+Tab, để
 * rời ô — không bẫy bàn phím). Chèn bằng execCommand('insertText') khi được để Ctrl+Z gốc vẫn chạy.
 */
export function HarmTextarea({
  id,
  value,
  onChange,
  markers,
  textareaRef,
  onCaretChange,
  describedBy,
  invalid,
}: HarmTextareaProps) {
  const innerRef = useRef<HTMLDivElement>(null);
  const releaseTab = useRef(false);
  const pendingCaret = useRef<number | null>(null);

  const syncGutter = () => {
    const ta = textareaRef.current;
    const inner = innerRef.current;
    if (ta && inner) inner.style.transform = `translateY(${-ta.scrollTop}px)`;
  };

  // Sau khi chèn bằng đường dự phòng (đổi state), đặt lại con trỏ khi value mới đã vào DOM.
  useLayoutEffect(() => {
    const ta = textareaRef.current;
    const caret = pendingCaret.current;
    if (ta && caret !== null && ta.value === value) {
      pendingCaret.current = null;
      ta.setSelectionRange(caret, caret);
      onCaretChange?.(caret);
    }
    syncGutter();
  });

  const insert = (ta: HTMLTextAreaElement, text: string) => {
    const before = ta.value;
    if (execInsert(text) && ta.value !== before) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    pendingCaret.current = start + text.length;
    onChange(before.slice(0, start) + text + before.slice(end));
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Escape') {
      releaseTab.current = true;
      return;
    }
    if (e.key === 'Tab' && !e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) {
      if (releaseTab.current) {
        releaseTab.current = false;
        return;
      }
      e.preventDefault();
      insert(e.currentTarget, TAB_TEXT);
      return;
    }
    releaseTab.current = false;
  };

  return (
    <div className="harm-editor">
      <Gutter count={countLines(value)} markers={markers} innerRef={innerRef} />
      <textarea
        id={id}
        ref={textareaRef}
        className="harm-textarea"
        value={value}
        wrap="off"
        spellCheck={false}
        autoCapitalize="off"
        autoComplete="off"
        autoCorrect="off"
        aria-describedby={describedBy}
        aria-invalid={invalid || undefined}
        onChange={(e) => onChange(e.currentTarget.value)}
        onKeyDown={onKeyDown}
        onScroll={syncGutter}
        onSelect={(e) => onCaretChange?.(e.currentTarget.selectionStart)}
      />
    </div>
  );
}

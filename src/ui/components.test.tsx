import { fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Button, Modal, Toggle, tabbableIn } from './components';
import { useSettings } from './settings';

beforeEach(() => {
  useSettings.setState({ language: 'vi' });
});

function tab(shift = false) {
  fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Tab', shiftKey: shift });
}

/** Trang giả: nút phía sau + modal xác nhận có 2 nút ở footer. */
function Harness({ autofocus = false, onClose }: { autofocus?: boolean; onClose?: () => void }) {
  const [open, setOpen] = useState(false);
  // onClose mới mỗi render (nơi gọi quên useCallback) không được làm focus nhảy.
  const close = () => {
    onClose?.();
    setOpen(false);
  };
  const [, force] = useState(0);
  return (
    <div>
      <a href="#/">Thư viện</a>
      <button type="button" onClick={() => setOpen(true)}>
        Mở
      </button>
      <Modal
        open={open}
        title="Xóa bài hát?"
        onClose={close}
        footer={
          <>
            <Button onClick={close} data-autofocus={autofocus || undefined}>
              Hủy
            </Button>
            <Button onClick={() => force((n) => n + 1)}>Xóa</Button>
          </>
        }
      >
        <p>Nội dung</p>
      </Modal>
    </div>
  );
}

describe('Modal', () => {
  it('render qua portal vào <body>, nền phía sau bị inert khi mở, bỏ inert khi đóng', () => {
    const { container } = render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Mở' }));
    const dialog = screen.getByRole('dialog', { name: 'Xóa bài hát?' });
    expect(container.contains(dialog)).toBe(false);
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(container.hasAttribute('inert')).toBe(true);
    expect(dialog.closest('[inert]')).toBeNull();

    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(container.hasAttribute('inert')).toBe(false);
  });

  it('focus vào dialog khi mở, trả focus về nút mở khi đóng', () => {
    render(<Harness />);
    const opener = screen.getByRole('button', { name: 'Mở' });
    opener.focus();
    fireEvent.click(opener);
    expect(document.activeElement).toBe(screen.getByRole('dialog'));
    fireEvent.click(screen.getByRole('button', { name: 'Hủy' }));
    expect(document.activeElement).toBe(opener);
  });

  it('[data-autofocus] nhận focus đầu tiên (nút an toàn của hộp xác nhận)', () => {
    render(<Harness autofocus />);
    fireEvent.click(screen.getByRole('button', { name: 'Mở' }));
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Hủy' }));
  });

  it('Tab / Shift+Tab vòng trong dialog, không ra trang phía sau', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Mở' }));
    const dialog = screen.getByRole('dialog');
    const [close, cancel, del] = tabbableIn(dialog);
    expect([close, cancel, del].map((el) => el?.textContent)).toEqual(['×', 'Hủy', 'Xóa']);

    // Từ chính dialog, Shift+Tab → phần tử cuối.
    tab(true);
    expect(document.activeElement).toBe(del);
    // Tab ở phần tử cuối → về đầu.
    tab();
    expect(document.activeElement).toBe(close);
    // Shift+Tab ở phần tử đầu → về cuối.
    tab(true);
    expect(document.activeElement).toBe(del);

    // Focus lọt ra ngoài (vd. body) → Tab kéo về trong dialog.
    (document.activeElement as HTMLElement).blur();
    expect(document.activeElement).toBe(document.body);
    tab();
    expect(document.activeElement).toBe(close);
    tab(true);
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it('Tab ở giữa danh sách để trình duyệt tự xử lý (không chặn)', () => {
    render(<Harness autofocus />);
    fireEvent.click(screen.getByRole('button', { name: 'Mở' }));
    const ev = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    screen.getByRole('button', { name: 'Hủy' }).dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
  });

  it('nút đóng có tên dịch được (không phải "×"), ký tự × ẩn với screen reader', () => {
    useSettings.setState({ language: 'en' });
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Mở' }));
    const dialog = screen.getByRole('dialog');
    const close = within(dialog).getByRole('button', { name: 'Close' });
    expect(close.getAttribute('title')).toBe('Close');
    expect(close.querySelector('[aria-hidden="true"]')?.textContent).toBe('×');
    fireEvent.click(close);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('nơi gọi re-render với onClose mới: focus trong dialog không bị kéo đi', () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Mở' }));
    const del = screen.getByRole('button', { name: 'Xóa' });
    del.focus();
    fireEvent.click(del); // re-render Harness → onClose identity mới
    expect(document.activeElement).toBe(del);
    fireEvent.keyDown(del, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('bấm nền bằng chuột trái thì đóng; chuột phải / giữa hoặc bấm trong dialog thì không', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Mở' }));
    const dialog = screen.getByRole('dialog');
    const backdrop = dialog.parentElement as HTMLElement;
    expect(backdrop.classList.contains('modal-backdrop')).toBe(true);
    fireEvent.mouseDown(backdrop, { button: 2 });
    fireEvent.mouseDown(backdrop, { button: 1 });
    fireEvent.mouseDown(dialog, { button: 0 });
    expect(screen.queryByRole('dialog')).not.toBeNull();
    fireEvent.mouseDown(backdrop, { button: 0 });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('closeOnBackdrop={false}: bấm nền không đóng, Esc / nút đóng vẫn đóng', () => {
    const onClose = vi.fn();
    render(
      <Modal open title="Kết quả" onClose={onClose} closeOnBackdrop={false}>
        <p>x</p>
      </Modal>,
    );
    const dialog = screen.getByRole('dialog');
    fireEvent.mouseDown(dialog.parentElement as HTMLElement, { button: 0 });
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

/** Modal A (công cụ) và modal B (hộp xác nhận) mở chồng lên A. */
function Stacked() {
  const [a, setA] = useState(false);
  const [b, setB] = useState(false);
  return (
    <div>
      <button type="button" onClick={() => setA(true)}>
        Mở A
      </button>
      <Modal open={a} title="Công cụ" onClose={() => setA(false)}>
        <input aria-label="Lời" />
        <Button onClick={() => setB(true)}>Mở B</Button>
      </Modal>
      <Modal
        open={b}
        title="Rời trang?"
        onClose={() => setB(false)}
        footer={
          <>
            <Button onClick={() => setB(false)}>Ở lại</Button>
            <Button>Bỏ thay đổi</Button>
            <Button onClick={() => setA(false)}>Đóng A</Button>
          </>
        }
      >
        <p>B</p>
      </Modal>
    </div>
  );
}

function openStack() {
  const utils = render(<Stacked />);
  const openA = screen.getByRole('button', { name: 'Mở A' });
  openA.focus();
  fireEvent.click(openA);
  const openB = screen.getByRole('button', { name: 'Mở B' });
  openB.focus();
  fireEvent.click(openB);
  const lower = screen.getByRole('dialog', { name: 'Công cụ' });
  const top = screen.getByRole('dialog', { name: 'Rời trang?' });
  return { ...utils, openA, openB, lower, top };
}

describe('Modal chồng nhau (D-144)', () => {
  it('modal dưới bị inert; Tab chỉ do modal trên cùng xử lý', () => {
    const { container, lower, top } = openStack();
    expect(container.hasAttribute('inert')).toBe(true);
    expect(lower.closest('[inert]')).not.toBeNull();
    expect(top.closest('[inert]')).toBeNull();
    expect(document.activeElement).toBe(top);

    // Tab ở giữa danh sách của modal trên: không bị listener của modal dưới chặn / kéo đi.
    const stay = within(top).getByRole('button', { name: 'Ở lại' });
    stay.focus();
    const ev = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    stay.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(stay);

    // Vòng Tab trong modal trên.
    const items = tabbableIn(top);
    expect(items.map((el) => el.textContent)).toEqual(['×', 'Ở lại', 'Bỏ thay đổi', 'Đóng A']);
    items[items.length - 1]?.focus();
    tab();
    expect(document.activeElement).toBe(items[0]);
    tab(true);
    expect(document.activeElement).toBe(items[items.length - 1]);
  });

  it('một Esc chỉ đóng modal trên cùng; focus về modal dưới, rồi về nút mở ban đầu', () => {
    const { container, openA, openB, lower } = openStack();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Rời trang?' })).toBeNull();
    expect(screen.getByRole('dialog', { name: 'Công cụ' })).toBe(lower);
    expect(lower.closest('[inert]')).toBeNull();
    expect(container.hasAttribute('inert')).toBe(true);
    expect(document.activeElement).toBe(openB);

    fireEvent.keyDown(openB, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(container.hasAttribute('inert')).toBe(false);
    expect(document.activeElement).toBe(openA);
  });

  it('modal dưới đóng trước: nền vẫn inert, modal trên vẫn dùng được và trả focus về nút mở A', () => {
    const { container, openA, top } = openStack();
    fireEvent.click(within(top).getByRole('button', { name: 'Đóng A' }));
    expect(screen.queryByRole('dialog', { name: 'Công cụ' })).toBeNull();
    expect(screen.getByRole('dialog', { name: 'Rời trang?' })).toBe(top);
    expect(container.hasAttribute('inert')).toBe(true);
    expect(top.closest('[inert]')).toBeNull();

    fireEvent.keyDown(top, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(container.hasAttribute('inert')).toBe(false);
    expect(document.activeElement).toBe(openA);
  });

  it('không gỡ `inert` do nơi khác đặt', () => {
    const outside = document.createElement('div');
    outside.setAttribute('inert', '');
    document.body.appendChild(outside);
    try {
      const { unmount } = openStack();
      unmount();
      expect(outside.hasAttribute('inert')).toBe(true);
    } finally {
      outside.remove();
    }
  });
});

describe('Toggle', () => {
  it('hint được nối vào switch qua aria-describedby', () => {
    render(
      <Toggle label="Bật âm thanh" checked onChange={() => {}} hint="Bắt đầu sau khi bấm Phát" />,
    );
    const sw = screen.getByRole('switch', { name: 'Bật âm thanh' });
    const ids = (sw.getAttribute('aria-describedby') ?? '').split(' ');
    expect(ids).toHaveLength(1);
    expect(document.getElementById(ids[0]!)?.textContent).toBe('Bắt đầu sau khi bấm Phát');
  });

  it('không có hint thì không có aria-describedby; giữ describedby của nơi gọi', () => {
    const { rerender } = render(<Toggle label="A" checked={false} onChange={() => {}} />);
    expect(screen.getByRole('switch').hasAttribute('aria-describedby')).toBe(false);
    rerender(
      <>
        <p id="ext">ngoài</p>
        <Toggle label="A" checked={false} onChange={() => {}} hint="h" aria-describedby="ext" />
      </>,
    );
    const ids = (screen.getByRole('switch').getAttribute('aria-describedby') ?? '').split(' ');
    expect(ids[0]).toBe('ext');
    expect(ids).toHaveLength(2);
  });
});

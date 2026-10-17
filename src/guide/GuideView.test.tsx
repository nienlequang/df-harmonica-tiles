import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SOURCE_REPO_URL } from '../dev/sourceRepo';
import { href, paths } from '../ui/router';
import { useSettings } from '../ui/settings';
import { GuideView } from './GuideView';

const scrollIntoView = vi.fn();

beforeEach(() => {
  act(() => useSettings.getState().reset());
  scrollIntoView.mockClear();
  Object.defineProperty(Element.prototype, 'scrollIntoView', {
    configurable: true,
    value: scrollIntoView,
  });
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
});

afterEach(() => {
  window.history.replaceState(null, '', '/');
});

describe('GuideView (#/guide, D-260)', () => {
  it('README phần người dùng: tiêu đề có id, mục lục dẫn tới #/guide?s=…, không có phần người phát triển', () => {
    render(<GuideView doc="readme" section={null} />);
    expect(
      screen.getByRole('heading', { level: 1, name: 'Delta Force Harmonica Tiles' }),
    ).toBeTruthy();
    const heading = screen.getByRole('heading', { level: 2, name: 'Chia sẻ link' });
    expect(heading.id).toBe('chia-sẻ-link');
    const toc = screen.getByRole('link', { name: 'Chia sẻ link' });
    expect(toc.getAttribute('href')).toBe(href(paths.guide('readme', 'chia-sẻ-link')));
    expect(screen.queryByRole('heading', { name: 'Cho người phát triển' })).toBeNull();
    // Mục đã cắt: chữ thường, không phải link hỏng.
    expect(screen.queryByRole('link', { name: 'Cho người phát triển' })).toBeNull();
    expect(document.querySelectorAll('img').length).toBeGreaterThan(0);
    // Tab tài liệu: trang hiện tại có aria-current.
    const tabs = screen.getByRole('navigation', { name: 'Tài liệu hướng dẫn' });
    expect(
      within(tabs).getByRole('link', { name: 'Hướng dẫn sử dụng' }).getAttribute('aria-current'),
    ).toBe('page');
    expect(document.title).toMatch(/^Hướng dẫn sử dụng — /);
  });

  it('link tới tài liệu prompt AI và trang ngoài', () => {
    render(<GuideView doc="readme" section={null} />);
    expect(screen.getByRole('link', { name: 'bản tiếng Anh' }).getAttribute('href')).toBe(
      href(paths.guide('cam-am', 'english-version')),
    );
    const ext = screen.getAllByRole('link').find((a) => a.getAttribute('target') === '_blank');
    expect(ext?.getAttribute('rel')).toBe('noopener noreferrer');
    expect(ext?.getAttribute('href')).toMatch(/^https?:\/\//);
  });

  it('?s=mục: cuộn tới tiêu đề và đưa focus vào đó', () => {
    render(<GuideView doc="cam-am" section="tìm-nguồn-ở-đâu" />);
    const target = screen.getByRole('heading', { name: 'Tìm nguồn ở đâu' });
    expect(scrollIntoView).toHaveBeenCalled();
    expect(scrollIntoView.mock.contexts.at(-1)).toBe(target);
    expect(document.activeElement).toBe(target);
  });

  it('bấm lại mục đang ở trong hash: tự cuộn (hash không đổi nên không có sự kiện)', () => {
    window.history.replaceState(null, '', href(paths.guide('readme', 'chia-sẻ-link')));
    render(<GuideView doc="readme" section="chia-sẻ-link" />);
    scrollIntoView.mockClear();
    const toc = screen.getByRole('link', { name: 'Chia sẻ link' });
    const notPrevented = fireEvent.click(toc);
    expect(notPrevented).toBe(false);
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
  });

  it('khối code có nút Sao chép', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    render(<GuideView doc="cam-am" section={null} />);
    const [first] = screen.getAllByRole('button', { name: 'Sao chép' });
    await act(async () => {
      fireEvent.click(first!);
      await Promise.resolve();
    });
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(String(writeText.mock.calls[0]?.[0])).toContain('Bạn là chuyên gia ký âm.');
  });

  it('chân trang: link nhỏ "Dev notes" tới #/dev rồi "Mã nguồn (GitHub)" (cuối trang, Tab tới được), ở cả hai tài liệu', () => {
    for (const doc of ['readme', 'cam-am'] as const) {
      const { unmount, container } = render(<GuideView doc={doc} section={null} />);
      const link = screen.getByRole('link', { name: 'Dev notes' });
      expect(link.getAttribute('href')).toBe(href(paths.dev()));
      expect(link.getAttribute('lang')).toBe('en');
      expect(link.parentElement?.className).toBe('dev-notes-link');
      // Chân trang Hướng dẫn: dòng link rồi dòng "muốn gỡ bài" (phần tử cuối) — sau toàn bộ tài liệu.
      const last = container.querySelector('article.guide')?.lastElementChild;
      expect(last?.previousElementSibling).toBe(link.parentElement);
      expect(last?.className).toBe('takedown-line');
      expect(last?.textContent).toBe(
        'Nếu bạn là tác giả và muốn gỡ bài, hãy liên hệ qua GitHub Issues (mở tab mới)',
      );
      const issues = within(last as HTMLElement).getByRole('link', { name: /^GitHub Issues/ });
      expect(issues.getAttribute('href')).toBe(`${SOURCE_REPO_URL}/issues`);
      expect(issues.getAttribute('target')).toBe('_blank');
      expect(issues.getAttribute('rel')).toBe('noopener');
      link.focus();
      expect(document.activeElement).toBe(link);
      // Cùng dòng, ngay sau: kho mã nguồn công khai, mở tab mới (D-444).
      const source = within(link.parentElement as HTMLElement).getByRole('link', {
        name: /^Mã nguồn \(GitHub\)/,
      });
      expect(source.textContent).toBe('Mã nguồn (GitHub) (mở tab mới)');
      expect(source.getAttribute('href')).toBe(SOURCE_REPO_URL);
      expect(source.getAttribute('target')).toBe('_blank');
      expect(source.getAttribute('rel')).toBe('noopener');
      expect(link.compareDocumentPosition(source) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      source.focus();
      expect(document.activeElement).toBe(source);
      unmount();
    }
  });

  it('chân trang tiếng Anh: "Source code (GitHub)"', () => {
    act(() => useSettings.getState().set({ language: 'en' }));
    render(<GuideView doc="readme" section={null} />);
    const source = screen.getByRole('link', { name: /^Source code \(GitHub\)/ });
    expect(source.getAttribute('href')).toBe(SOURCE_REPO_URL);
    expect(source.parentElement?.className).toBe('dev-notes-link');
  });

  it('giao diện tiếng Anh: ghi chú tài liệu tiếng Việt + link bản tiếng Anh', () => {
    act(() => useSettings.getState().set({ language: 'en' }));
    render(<GuideView doc="readme" section={null} />);
    expect(screen.getByText(/The guide is written in Vietnamese/)).toBeTruthy();
    expect(
      screen
        .getByRole('link', { name: 'AI prompt for cảm âm — English version' })
        .getAttribute('href'),
    ).toBe(href(paths.guide('cam-am', 'english-version')));
  });
});

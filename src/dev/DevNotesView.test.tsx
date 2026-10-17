import { act, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import pkg from '../../package.json';
import { href, paths } from '../ui/router';
import { useSettings } from '../ui/settings';
import { devContent } from './devContent';
import { DevNotesView } from './DevNotesView';
import { SOURCE_REPO_URL } from './sourceRepo';

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

const buildRegion = () => screen.getByRole('region', { name: 'Bản đang chạy' });

describe('DevNotesView (#/dev, R7-8)', () => {
  it('đầu trang: tiêu đề Dev notes, phiên bản package.json; Vitest không có commit / ngày build → "không rõ"', () => {
    render(<DevNotesView section={null} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Dev notes' })).toBeTruthy();
    const info = buildRegion();
    expect(within(info).getByText('Phiên bản').nextElementSibling?.textContent).toBe(pkg.version);
    expect(within(info).getByText('Commit').nextElementSibling?.textContent).toBe(
      'không rõ (bản dev / test)',
    );
    expect(within(info).getByText('Ngày build').nextElementSibling?.textContent).toBe(
      'không rõ (bản dev / test)',
    );
    expect(document.title).toBe('Dev notes — Harmonica Tiles');
  });

  it('đầu trang: link "Mã nguồn (GitHub)" tới kho công khai, mở tab mới (D-444; en: "Source code (GitHub)")', () => {
    const { unmount } = render(<DevNotesView section={null} />);
    const link = screen.getByRole('link', { name: /^Mã nguồn \(GitHub\)/ });
    expect(link.textContent).toBe('Mã nguồn (GitHub) (mở tab mới)');
    expect(link.getAttribute('href')).toBe(SOURCE_REPO_URL);
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener');
    expect(link.getAttribute('title')).toBe('Mã nguồn của app trên GitHub — giấy phép MIT');
    expect(link.closest('header')?.className).toBe('dev-header');
    // Ngay dưới: "Nếu bạn là tác giả và muốn gỡ bài, hãy liên hệ qua GitHub Issues" (tab mới). REFERENCE (mục
    // "Giấy phép và bản quyền bài mẫu") cũng có một link GitHub Issues → tìm trong header.
    const issues = within(link.closest('header') as HTMLElement).getByRole('link', {
      name: /^GitHub Issues/,
    });
    expect(issues.getAttribute('href')).toBe(`${SOURCE_REPO_URL}/issues`);
    expect(issues.getAttribute('target')).toBe('_blank');
    expect(issues.getAttribute('rel')).toBe('noopener');
    expect(issues.closest('p')?.className).toBe('dev-takedown');
    expect(issues.closest('p')?.textContent).toBe(
      'Nếu bạn là tác giả và muốn gỡ bài, hãy liên hệ qua GitHub Issues (mở tab mới)',
    );
    expect(issues.closest('header')?.className).toBe('dev-header');
    // trước vùng "Bản đang chạy" và mục lục
    expect(
      link.compareDocumentPosition(buildRegion()) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    unmount();

    act(() => useSettings.getState().set({ language: 'en' }));
    render(<DevNotesView section={null} />);
    const en = screen.getByRole('link', { name: /^Source code \(GitHub\)/ });
    expect(en.textContent).toBe('Source code (GitHub) (opens in a new tab)');
    expect(en.getAttribute('href')).toBe(SOURCE_REPO_URL);
  });

  it('commit + ngày build truyền vào (bản deploy): commit dạng code, ngày theo UTC', () => {
    render(
      <DevNotesView
        section={null}
        build={{ version: '1.2.3', commit: 'abc1234-dirty', builtAt: '2026-10-16T05:30:12.000Z' }}
      />,
    );
    const info = buildRegion();
    expect(within(info).getByText('1.2.3').tagName).toBe('CODE');
    expect(within(info).getByText('abc1234-dirty').tagName).toBe('CODE');
    expect(within(info).getByText('2026-10-16 05:30 UTC')).toBeTruthy();
  });

  it('REFERENCE (cú pháp .harm, bảng lỗi, tham số URL, giới hạn) rồi CHANGELOG; tiêu đề tài liệu là h2', () => {
    render(<DevNotesView section={null} />);
    const ref = screen.getByRole('region', { name: 'Tài liệu tham khảo' });
    expect(
      within(ref).getByRole('heading', { level: 2, name: /^Tài liệu tham khảo — / }),
    ).toBeTruthy();
    for (const name of ['Định dạng .harm đầy đủ', 'Tham số URL của overlay', 'Giới hạn đã biết']) {
      expect(within(ref).getByRole('heading', { level: 3, name })).toBeTruthy();
    }
    expect(
      within(ref).getByRole('heading', { level: 4, name: 'Thông báo lỗi và ý nghĩa' }),
    ).toBeTruthy();
    expect(ref.querySelectorAll('table').length).toBeGreaterThan(1);
    const log = screen.getByRole('region', { name: 'Lịch sử thay đổi' });
    expect(within(log).getByRole('heading', { level: 2, name: 'Changelog' })).toBeTruthy();
    expect(ref.compareDocumentPosition(log) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(
      screen.queryByRole('heading', { level: 1, name: /Tài liệu tham khảo|Changelog/ }),
    ).toBeNull();
    expect(document.body.textContent).not.toContain('VERCEL_URL_TODO');
  });

  it('link: mục lục của REFERENCE → #/dev?s=…, README → trang Hướng dẫn; mục lục trang → đầu từng tài liệu', () => {
    render(<DevNotesView section={null} />);
    const ref = screen.getByRole('region', { name: 'Tài liệu tham khảo' });
    expect(
      within(ref).getByRole('link', { name: 'Tham số URL của overlay' }).getAttribute('href'),
    ).toBe(href(paths.dev('tham-số-url-của-overlay')));
    expect(within(ref).getByRole('link', { name: 'README' }).getAttribute('href')).toBe(
      href(paths.guide()),
    );
    const c = devContent(window.location.href.replace(/[?#].*$/, ''));
    const nav = screen.getByRole('navigation', { name: 'Nội dung trang Dev notes' });
    expect(within(nav).getByRole('link', { name: 'Tài liệu tham khảo' }).getAttribute('href')).toBe(
      href(paths.dev(c.reference.firstId ?? undefined)),
    );
    expect(within(nav).getByRole('link', { name: 'Lịch sử thay đổi' }).getAttribute('href')).toBe(
      href(paths.dev('changelog')),
    );
  });

  it('?s=mục: cuộn tới tiêu đề và đưa focus vào đó', () => {
    render(<DevNotesView section="tham-số-url-của-overlay" />);
    const target = screen.getByRole('heading', { name: 'Tham số URL của overlay' });
    expect(scrollIntoView.mock.contexts.at(-1)).toBe(target);
    expect(document.activeElement).toBe(target);
  });

  it('tiếng Anh: khung trang dịch, tài liệu giữ tiếng Việt (lang="vi")', () => {
    act(() => useSettings.getState().set({ language: 'en' }));
    render(<DevNotesView section={null} />);
    expect(screen.getByRole('region', { name: 'Running build' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Reference' }).getAttribute('lang')).toBe('vi');
    expect(screen.getByRole('navigation', { name: 'Dev notes contents' })).toBeTruthy();
  });
});

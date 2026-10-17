import { act, renderHook, waitFor } from '@testing-library/react';
import LZString from 'lz-string';
import { afterEach, describe, expect, it } from 'vitest';
import { addNavigationInterceptor, href, navigate, parseLocation, paths, useRoute } from './router';

const routeOf = (hash: string, search = '') => parseLocation(hash, search).route;

afterEach(() => {
  window.history.replaceState(null, '', '/');
});

describe('parseLocation', () => {
  it.each(['', '#', '#/', '#//', '/', '#/?x=1'])('%j → home (màn demo)', (hash) => {
    expect(routeOf(hash)).toEqual({ name: 'home' });
  });

  it.each(['#/library', '#/library/', '/library', '#/library?q=em'])('%j → library', (hash) => {
    expect(routeOf(hash)).toEqual({ name: 'library' });
  });

  it('library không nhận segment con', () => {
    expect(routeOf('#/library/x')).toEqual({ name: 'not-found', path: '/library/x' });
  });

  it('#/ai = "Tạo bài với AI" (không nhận segment con)', () => {
    expect(routeOf(href(paths.ai()))).toEqual({ name: 'ai' });
    expect(routeOf('#/ai/')).toEqual({ name: 'ai' });
    expect(routeOf('#/ai/x')).toEqual({ name: 'not-found', path: '/ai/x' });
  });

  it('play / edit / overlay with id', () => {
    expect(routeOf('#/play/abc')).toEqual({ name: 'play', id: 'abc' });
    expect(routeOf('#/play/abc/')).toEqual({ name: 'play', id: 'abc' });
    expect(routeOf('#/edit/x')).toEqual({ name: 'edit', id: 'x' });
    expect(routeOf('#/overlay/x')).toEqual({ name: 'overlay', id: 'x' });
  });

  it('decodes encoded ids', () => {
    expect(routeOf('#/play/a%20b')).toEqual({ name: 'play', id: 'a b' });
    expect(routeOf('#/edit/b%C3%A0i%2F1')).toEqual({ name: 'edit', id: 'bài/1' });
    // Hỏng encoding → giữ nguyên chuỗi, không throw.
    expect(routeOf('#/play/%E0%A4%A')).toEqual({ name: 'play', id: '%E0%A4%A' });
  });

  it('guide: README hoặc prompt AI cảm âm; mục trong ?s=', () => {
    expect(routeOf('#/guide')).toEqual({ name: 'guide', doc: 'readme' });
    expect(routeOf('#/guide/cam-am')).toEqual({ name: 'guide', doc: 'cam-am' });
    expect(routeOf('#/guide/x')).toEqual({ name: 'not-found', path: '/guide/x' });
    const { route, query } = parseLocation(`#${paths.guide('readme', 'chia-sẻ-link')}`, '');
    expect(route).toEqual({ name: 'guide', doc: 'readme' });
    expect(query.get('s')).toBe('chia-sẻ-link');
    expect(paths.guide()).toBe('/guide');
    expect(paths.guide('cam-am', 'tìm-nguồn-ở-đâu')).toBe(
      `/guide/cam-am?s=${encodeURIComponent('tìm-nguồn-ở-đâu')}`,
    );
  });

  it('dev: Dev notes (R7-8); mục trong ?s=', () => {
    expect(routeOf('#/dev')).toEqual({ name: 'dev' });
    expect(routeOf('#/dev/')).toEqual({ name: 'dev' });
    expect(routeOf('#/dev/x')).toEqual({ name: 'not-found', path: '/dev/x' });
    expect(paths.dev()).toBe('/dev');
    const { route, query } = parseLocation(`#${paths.dev('tham-số-url-của-overlay')}`, '');
    expect(route).toEqual({ name: 'dev' });
    expect(query.get('s')).toBe('tham-số-url-của-overlay');
  });

  it('missing id → not-found (play/edit) or empty overlay id', () => {
    expect(routeOf('#/play')).toEqual({ name: 'not-found', path: '/play' });
    expect(routeOf('#/edit/')).toEqual({ name: 'not-found', path: '/edit' });
    expect(routeOf('#/overlay')).toEqual({ name: 'overlay', id: '' });
    expect(routeOf('#/overlay?song=s1')).toEqual({ name: 'overlay', id: 's1' });
  });

  it('merges hash query into location.search (hash wins)', () => {
    const { route, query } = parseLocation(
      '#/overlay/x?scale=1.4&lanes=horizontal',
      '?chroma=1&scale=2',
    );
    expect(route).toEqual({ name: 'overlay', id: 'x' });
    expect(query.get('scale')).toBe('1.4');
    expect(query.get('lanes')).toBe('horizontal');
    expect(query.get('chroma')).toBe('1');
  });

  it('accepts search without leading "?"', () => {
    expect(parseLocation('#/settings', 'a=1').query.get('a')).toBe('1');
  });

  it('?overlay=1&song=<id> with an empty hash → overlay', () => {
    const { route, query } = parseLocation('', '?overlay=1&song=seed-quoc-ca-viet-nam');
    expect(route).toEqual({ name: 'overlay', id: 'seed-quoc-ca-viet-nam' });
    expect(query.get('overlay')).toBe('1');
    expect(routeOf('#/', '?overlay=1&song=s2')).toEqual({ name: 'overlay', id: 's2' });
    expect(routeOf('', '?overlay=1')).toEqual({ name: 'overlay', id: '' });
  });

  it('a real hash route wins over ?overlay=1', () => {
    expect(routeOf('#/play/abc', '?overlay=1&song=s2')).toEqual({ name: 'play', id: 'abc' });
    expect(routeOf('', '?overlay=0&song=s2')).toEqual({ name: 'home' });
    expect(routeOf('#/library', '?overlay=1&song=s2')).toEqual({ name: 'library' });
  });

  it('keeps share data raw (lz-string chars + - $ untouched)', () => {
    const data = 'N4IgDg9gJg+ZBLAzgFwgJ$hUBKAlgXQ-Fk%20';
    expect(routeOf(`#/s/${data}`)).toEqual({ name: 'share', data });
  });

  it('share data from lz-string survives the round-trip', () => {
    const text =
      '@title Thử nghiệm\n@bpm 90\nĐồ rê mi: Z X C V*2 [giữ chuột phải] B N M , [thả chuột phải]';
    const data = LZString.compressToEncodedURIComponent(text);
    const route = routeOf(href(paths.share(data)));
    expect(route).toEqual({ name: 'share', data });
    if (route.name !== 'share') throw new Error('expected share');
    expect(LZString.decompressFromEncodedURIComponent(route.data)).toBe(text);
  });

  it('settings and midi routes', () => {
    expect(routeOf('#/settings')).toEqual({ name: 'settings' });
    expect(routeOf('#/settings/')).toEqual({ name: 'settings' });
    expect(routeOf('#/midi')).toEqual({ name: 'midi' });
    expect(routeOf('#/settings/extra')).toEqual({ name: 'not-found', path: '/settings/extra' });
    expect(routeOf('#/midi/x')).toEqual({ name: 'not-found', path: '/midi/x' });
  });

  it('unknown paths → not-found with the path', () => {
    expect(routeOf('#/nope')).toEqual({ name: 'not-found', path: '/nope' });
    expect(routeOf('#/s')).toEqual({ name: 'not-found', path: '/s' });
    expect(routeOf('#/a/b/c?x=1')).toEqual({ name: 'not-found', path: '/a/b/c' });
  });
});

describe('href + paths', () => {
  it('href prefixes "#" and a leading slash', () => {
    expect(href('/play/abc')).toBe('#/play/abc');
    expect(href('play/abc')).toBe('#/play/abc');
    expect(href(paths.home())).toBe('#/');
    expect(href(paths.library())).toBe('#/library');
  });

  it('paths.home / paths.library round-trip', () => {
    expect(routeOf(href(paths.home()))).toEqual({ name: 'home' });
    expect(routeOf(href(paths.library()))).toEqual({ name: 'library' });
  });

  it('paths encode ids', () => {
    expect(paths.play('a b')).toBe('/play/a%20b');
    expect(paths.edit('x/y?z#w')).toBe('/edit/x%2Fy%3Fz%23w');
    expect(paths.overlay('bài 1')).toBe('/overlay/b%C3%A0i%201');
    expect(paths.settings()).toBe('/settings');
    expect(paths.midi()).toBe('/midi');
    expect(paths.share('abc+$-')).toBe('/s/abc+$-');
  });

  it.each(['abc', 'a b', 'x/y?z#w', 'bài hát %20', 'seed-quoc-ca-viet-nam'])(
    'id %j round-trips through paths → parseLocation',
    (id) => {
      expect(routeOf(href(paths.play(id)))).toEqual({ name: 'play', id });
      expect(routeOf(href(paths.edit(id)))).toEqual({ name: 'edit', id });
      expect(routeOf(href(paths.overlay(id)))).toEqual({ name: 'overlay', id });
    },
  );
});

describe('navigate + useRoute', () => {
  it('replace updates the route synchronously', () => {
    const { result } = renderHook(() => useRoute());
    expect(result.current.route).toEqual({ name: 'home' });
    act(() => navigate(paths.library(), { replace: true }));
    expect(window.location.hash).toBe('#/library');
    expect(result.current.route).toEqual({ name: 'library' });
    act(() => navigate(paths.settings(), { replace: true }));
    expect(window.location.hash).toBe('#/settings');
    expect(result.current.route).toEqual({ name: 'settings' });
  });

  it('push changes location.hash and re-renders on hashchange', async () => {
    const { result } = renderHook(() => useRoute());
    act(() => navigate(paths.play('a b')));
    expect(window.location.hash).toBe('#/play/a%20b');
    await waitFor(() => expect(result.current.route).toEqual({ name: 'play', id: 'a b' }));
  });

  it('returns a stable object while the location is unchanged', () => {
    const { result, rerender } = renderHook(() => useRoute());
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });
});

describe('addNavigationInterceptor', () => {
  it('interceptor trả true → router không báo React; gỡ ra thì router chạy lại', () => {
    window.history.replaceState(null, '', '/#/edit/a');
    const { result } = renderHook(() => useRoute());
    expect(result.current.route).toEqual({ name: 'edit', id: 'a' });
    const seen: string[] = [];
    const remove = addNavigationInterceptor((e) => {
      seen.push(e.type);
      return true;
    });
    // URL đổi nhưng interceptor nuốt sự kiện → route giữ nguyên (router không re-render).
    act(() => {
      window.history.replaceState(null, '', '/#/settings');
      window.dispatchEvent(new PopStateEvent('popstate'));
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    expect(seen).toEqual(['popstate', 'hashchange']);
    expect(result.current.route).toEqual({ name: 'edit', id: 'a' });
    remove();
    act(() => {
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    expect(result.current.route).toEqual({ name: 'settings' });
  });

  it('interceptor trả false → router chạy bình thường', () => {
    const remove = addNavigationInterceptor(() => false);
    const { result } = renderHook(() => useRoute());
    act(() => navigate(paths.midi(), { replace: true }));
    expect(result.current.route).toEqual({ name: 'midi' });
    remove();
  });
});

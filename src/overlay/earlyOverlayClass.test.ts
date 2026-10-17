/**
 * Script inline trong index.html đặt `html.overlay-mode` + class nền TRƯỚC khi React / chunk overlay tải
 * (không nháy nền app mỗi lần OBS refresh source). Nó phải nhận route và `bg` y như router.ts /
 * overlayParams.ts — test chạy chính đoạn script đó và so với hai module.
 */
import { afterEach, describe, expect, it } from 'vitest';
import indexHtml from '../../index.html?raw';
import { parseLocation } from '../ui/router';
import { parseOverlayParams } from './overlayParams';

const inlineScript = /<script>([\s\S]*?)<\/script>/.exec(indexHtml)?.[1] ?? '';

function runEarlyScript(url: string): DOMTokenList {
  document.documentElement.className = '';
  window.history.replaceState(null, '', url);
  // Đúng đoạn script của index.html (không module, không import).
  new Function(inlineScript)();
  return document.documentElement.classList;
}

afterEach(() => {
  window.history.replaceState(null, '', '/');
  document.documentElement.className = '';
});

describe('index.html: class overlay đặt sớm', () => {
  it('có script inline', () => {
    expect(inlineScript).toContain('overlay-mode');
  });

  it.each([
    ['/#/overlay/seed-quoc-ca-viet-nam', true, 'transparent'],
    ['/#/overlay/seed-quoc-ca-viet-nam?layout=game&bg=chroma', true, 'chroma'],
    ['/#/overlay?bg=%20Chroma%20&data=abc', true, 'chroma'],
    ['/#overlay/x?bg=THEME', true, 'theme'],
    ['/#/overlay/?bg=nope', true, 'transparent'],
    ['/?overlay=1&song=seed-quoc-ca-viet-nam&layout=game', true, 'transparent'],
    ['/?overlay=1&bg=theme#/', true, 'theme'],
    ['/?bg=chroma#/overlay/x?bg=theme', true, 'theme'],
    ['/?overlay=1&bg=chroma#/library', false, ''],
    ['/?overlay=true&bg=chroma', false, ''],
    ['/#/library?bg=chroma', false, ''],
    ['/#/overlayx', false, ''],
    ['/#/play/seed-quoc-ca-viet-nam', false, ''],
    ['/', false, ''],
  ])('%s → overlay %s, nền %s (khớp router + overlayParams)', (url, overlay, bg) => {
    const classes = runEarlyScript(url);
    const { route, query } = parseLocation(window.location.hash, window.location.search);
    expect(route.name === 'overlay').toBe(overlay);
    expect(classes.contains('overlay-mode')).toBe(overlay);
    if (overlay) {
      expect(parseOverlayParams(query).bg).toBe(bg);
      expect(classes.contains(`overlay-bg-${bg}`)).toBe(true);
      expect(classes.length).toBe(2);
    } else {
      expect(classes.length).toBe(0);
    }
  });

  it.each([
    ['/#/overlay/seed-quoc-ca-viet-nam?layout=game&fit=canvas&preview=1', true],
    ['/#/overlay?data=abc&preview=%20ON%20', true],
    ['/?overlay=1&song=x&preview=true', true],
    ['/#/overlay/x?preview=0', false],
    ['/#/overlay/x?preview=nope', false],
    ['/#/overlay/x', false],
  ])('%s → cửa sổ "Xem trước" %s (khớp overlayParams.preview)', (url, preview) => {
    const classes = runEarlyScript(url);
    const { query } = parseLocation(window.location.hash, window.location.search);
    expect(parseOverlayParams(query).preview).toBe(preview);
    expect(classes.contains('overlay-mode')).toBe(true);
    expect(classes.contains('overlay-preview')).toBe(preview);
    expect(classes.length).toBe(preview ? 3 : 2);
  });

  it('trang thường có preview=1 trong query: không đổi gì', () => {
    expect(runEarlyScript('/#/play/seed-quoc-ca-viet-nam?preview=1').length).toBe(0);
  });
});

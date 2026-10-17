import { describe, expect, it } from 'vitest';
import { decodeShareData, encodeShareData } from '../core/share';
import { GAME_FRAME_PAD, computeLayout } from '../player/layout';
import type { Layout } from '../player/layout';
import { parseLocation } from '../ui/router';
import {
  DEFAULT_HIT_LINE,
  GAME_LAYOUT_HIT_LINE,
  GAME_LAYOUT_OPACITY,
  OBS_PRESETS,
  buildOverlayQuery,
  buildOverlayUrl,
  canvasFrame,
  canvasPlacement,
  effectiveTileOpacity,
  gameKeyboardBox,
  gameLanePitch,
  layoutDefaults,
  overlayRendererOptions,
  parseOverlayParams,
  presetOf,
  presetOptions,
} from './overlayParams';
import type { OverlayLinkOptions } from './overlayParams';

const q = (s: string) => new URLSearchParams(s);

describe('parseOverlayParams', () => {
  it('mặc định (không tham số): full, dọc, trong suốt, khung = source, ảnh chụp Cài đặt trống', () => {
    expect(parseOverlayParams(q(''))).toEqual({
      song: null,
      data: null,
      bpm: null,
      countIn: false,
      delaySec: 0,
      lookahead: 6,
      scale: 1,
      tileScale: 1,
      subLabel: null,
      lang: null,
      theme: null,
      lanes: 'vertical',
      bg: 'transparent',
      layout: 'full',
      fit: 'source',
      opacity: 1,
      scheme: 'pc',
      gamebar: true,
      banner: true,
      semitone: 'toggle',
      names: { left: '', right: '', natural: '', scroll: '' },
      preview: false,
    });
  });

  it('preview=1 (cửa sổ "Xem trước" của hộp thoại OBS); bg=chroma của link cũ vẫn đọc được', () => {
    expect(parseOverlayParams(q('preview=1')).preview).toBe(true);
    expect(parseOverlayParams(q('preview=TRUE')).preview).toBe(true);
    expect(parseOverlayParams(q('preview=0')).preview).toBe(false);
    expect(parseOverlayParams(q('preview=x')).preview).toBe(false);
    expect(parseOverlayParams(q('layout=game&fit=canvas&bg=chroma')).bg).toBe('chroma');
  });

  it('cách Nửa Cung + tên nút từ link (OBS không thấy Cài đặt của người tạo link)', () => {
    const p = parseOverlayParams(
      q(
        'scheme=mobile&semitone=OneShot&nl=Tr%C3%A1i%20X&nr=%20Ph%E1%BA%A3i%0A&nn=TN&ns=' +
          'x'.repeat(40),
      ),
    );
    expect(p.semitone).toBe('oneShot');
    expect(p.names).toEqual({
      left: 'Trái X',
      right: 'Phải',
      natural: 'TN',
      scroll: 'x'.repeat(24),
    });
    expect(parseOverlayParams(q('semitone=lạ')).semitone).toBe('toggle');
    const r = overlayRendererOptions(p);
    expect(r.mobileSemitone).toBe('oneShot');
  });

  it('đọc đủ tham số; `lyrics`, `autoplay`, `loop` của link cũ bị bỏ qua', () => {
    const p = parseOverlayParams(
      q(
        'song=seed-x&bpm=96&autoplay=1&countin=1&loop=1&delay=5&lookahead=10&lyrics=0&scale=1.4' +
          '&lanes=horizontal&bg=chroma&layout=full&opacity=0.6&scheme=mobile&gamebar=0&banner=0' +
          '&fit=Canvas&tilescale=1.25&sublabel=number&lang=EN&theme=light',
      ),
    );
    expect(p).not.toHaveProperty('lyrics');
    expect(p).not.toHaveProperty('autoplay');
    expect(p).not.toHaveProperty('loop');
    expect(p).toMatchObject({
      song: 'seed-x',
      bpm: 96,
      countIn: true,
      delaySec: 5,
      lookahead: 10,
      scale: 1.4,
      tileScale: 1.25,
      subLabel: 'number',
      lang: 'en',
      theme: 'light',
      lanes: 'horizontal',
      bg: 'chroma',
      layout: 'full',
      fit: 'canvas',
      opacity: 0.6,
      scheme: 'mobile',
      gamebar: false,
      banner: false,
    });
  });

  it('kẹp số ngoài tầm', () => {
    const lo = parseOverlayParams(q('bpm=1&delay=-3&lookahead=1&scale=0.1&opacity=0&tilescale=0'));
    expect(lo).toMatchObject({
      bpm: 20,
      delaySec: 0,
      lookahead: 4,
      scale: 0.5,
      opacity: 0.3,
      tileScale: 0.5,
    });
    const hi = parseOverlayParams(q('bpm=9999&delay=99&lookahead=50&scale=9&opacity=7'));
    expect(hi).toMatchObject({ bpm: 400, delaySec: 10, lookahead: 12, scale: 3, opacity: 1 });
    // làm tròn số nguyên cho delay / lookahead; dấu phẩy thập phân được chấp nhận.
    expect(parseOverlayParams(q('delay=2.6&lookahead=7.4&scale=1,25'))).toMatchObject({
      delaySec: 3,
      lookahead: 7,
      scale: 1.25,
    });
  });

  it('giá trị lạ → mặc định; param lạ bị bỏ qua', () => {
    const p = parseOverlayParams(
      q(
        'bpm=abc&delay=x&lanes=diagonal&bg=pink&layout=wide&scheme=console&autoplay=maybe' +
          '&lyrics=&opacity=NaN&scale=Infinity&bpm=0&foo=bar&overlay=1&fit=window&sublabel=lời' +
          '&lang=fr&theme=pink&tilescale=abc',
      ),
    );
    const d = parseOverlayParams(q(''));
    expect(p).toEqual(d);
    expect(parseOverlayParams(q('bpm=-50')).bpm).toBeNull();
  });

  it('boolean: 1/true/yes/on và 0/false/no/off (không phân biệt hoa thường, khoảng trắng)', () => {
    for (const v of ['1', 'true', 'YES', ' on ']) {
      expect(parseOverlayParams(q(`countin=${v}`)).countIn).toBe(true);
    }
    for (const v of ['0', 'false', 'No', 'OFF']) {
      expect(parseOverlayParams(q(`gamebar=${v}`)).gamebar).toBe(false);
    }
  });

  it('enum không phân biệt hoa thường', () => {
    expect(
      parseOverlayParams(q('lanes=Horizontal&bg=CHROMA&layout=Game&fit=CANVAS')),
    ).toMatchObject({
      lanes: 'horizontal',
      bg: 'chroma',
      layout: 'game',
      fit: 'canvas',
    });
  });

  it('layout=game: không game bar, độ đục 0.85 (ghi đè được)', () => {
    expect(parseOverlayParams(q('layout=game'))).toMatchObject({
      layout: 'game',
      gamebar: false,
      banner: true,
      opacity: GAME_LAYOUT_OPACITY,
    });
    expect(parseOverlayParams(q('layout=game&gamebar=1&lyrics=1&opacity=0.5'))).toMatchObject({
      gamebar: true,
      opacity: 0.5,
    });
    expect(layoutDefaults('full')).toEqual({
      opacity: 1,
      gamebar: true,
      banner: true,
    });
  });

  it('song / data: chuỗi rỗng = không có; data giữ nguyên (+ thành dấu cách do URLSearchParams)', () => {
    expect(parseOverlayParams(q('song=&data=  '))).toMatchObject({ song: null, data: null });
    const data = encodeShareData('@title A\nZ X C+');
    const p = parseOverlayParams(q(`data=${data}`));
    expect(p.data).not.toBeNull();
    expect(decodeShareData(p.data ?? '')).toBe('@title A\nZ X C+');
  });

  it('nhận query từ router cho cả hai dạng route', () => {
    const a = parseLocation('#/overlay/seed-quoc-ca-viet-nam?fit=canvas&bg=chroma', '');
    expect(a.route).toEqual({ name: 'overlay', id: 'seed-quoc-ca-viet-nam' });
    expect(parseOverlayParams(a.query)).toMatchObject({ fit: 'canvas', bg: 'chroma' });
    const b = parseLocation('', '?overlay=1&song=seed-quoc-ca-viet-nam&lanes=horizontal');
    expect(b.route).toEqual({ name: 'overlay', id: 'seed-quoc-ca-viet-nam' });
    expect(parseOverlayParams(b.query)).toMatchObject({
      song: 'seed-quoc-ca-viet-nam',
      lanes: 'horizontal',
    });
  });
});

describe('overlayRendererOptions', () => {
  it('full: như Player (hit line 0.82, đệm thường, lưới thường)', () => {
    const o = overlayRendererOptions(parseOverlayParams(q('scale=1.5&lookahead=6&bg=chroma')));
    expect(o).toMatchObject({
      orientation: 'vertical',
      lookahead: 6,
      tileScale: 1.5,
      background: 'chroma',
      hitLinePos: DEFAULT_HIT_LINE,
      lanePadding: 'normal',
      tileOpacity: 1,
      gridStyle: 'normal',
      scheme: 'pc',
    });
  });

  it('game: lane phủ kín, hit line sát đáy, ô bán trong suốt, lưới mờ', () => {
    const o = overlayRendererOptions(parseOverlayParams(q('layout=game&scheme=mobile')));
    expect(o).toMatchObject({
      hitLinePos: GAME_LAYOUT_HIT_LINE,
      lanePadding: 'none',
      tileOpacity: GAME_LAYOUT_OPACITY,
      gridStyle: 'subtle',
      scheme: 'mobile',
    });
  });

  it('game + fit=canvas + lane dọc: khung bảng phím PC (đệm GAME_FRAME_PAD bước); link cũ fit=source giữ phủ kín', () => {
    expect(overlayRendererOptions(parseOverlayParams(q('layout=game&fit=canvas'))).framePad).toBe(
      GAME_FRAME_PAD,
    );
    // Link cũ (source tự kéo cho 8 làn trùng 8 phím) / dải ngang / bố cục khác: không xê dịch làn.
    for (const s of ['layout=game', 'layout=game&fit=canvas&lanes=horizontal', 'fit=canvas']) {
      expect(overlayRendererOptions(parseOverlayParams(q(s))).framePad).toBe(0);
    }
  });

  it('nền chroma: tile luôn đục 100% (Chroma Key không ăn mất ô)', () => {
    const o = overlayRendererOptions(parseOverlayParams(q('layout=game&bg=chroma&opacity=0.5')));
    expect(o.tileOpacity).toBe(1);
    expect(effectiveTileOpacity({ bg: 'transparent', opacity: 0.5 })).toBe(0.5);
    expect(effectiveTileOpacity({ bg: 'theme', opacity: 0.4 })).toBe(0.4);
  });

  it('lanes=horizontal → orientation ngang', () => {
    expect(overlayRendererOptions(parseOverlayParams(q('lanes=horizontal'))).orientation).toBe(
      'horizontal',
    );
  });
});

const LINK_DEFAULTS: OverlayLinkOptions = {
  ...presetOptions('game'),
  bg: 'transparent',
  fit: 'source',
  scale: 1,
  lookahead: 6,
  scheme: 'pc',
  countIn: false,
  delaySec: 0,
  tileScale: 1,
  subLabel: null,
  lang: null,
  theme: null,
  semitone: 'toggle',
  names: { left: '', right: '', natural: '', scroll: '' },
  preview: false,
};

/** Bỏ song/data/bpm khỏi kết quả parse để so với option của link. */
function linkPart(query: string): OverlayLinkOptions {
  const { song: _s, data: _d, bpm: _b, ...rest } = parseOverlayParams(q(query));
  return rest;
}

describe('buildOverlayQuery / buildOverlayUrl', () => {
  it('chỉ ghi giá trị khác mặc định, luôn có layout (đứng đầu)', () => {
    expect(buildOverlayQuery(LINK_DEFAULTS)).toBe('layout=game');
    expect(buildOverlayQuery({ ...LINK_DEFAULTS, ...presetOptions('full') })).toBe('layout=full');
  });

  it('mọi option → query → parse ra đúng option (round trip)', () => {
    const cases: OverlayLinkOptions[] = [
      LINK_DEFAULTS,
      {
        ...presetOptions('strip'),
        bg: 'chroma',
        fit: 'canvas',
        scale: 1.1,
        lookahead: 12,
        scheme: 'mobile',
        countIn: true,
        delaySec: 3,
        tileScale: 1.25,
        subLabel: 'solfege',
        lang: 'en',
        theme: 'light',
        semitone: 'toggle',
        names: { left: '', right: '', natural: '', scroll: '' },
        preview: false,
      },
      { ...LINK_DEFAULTS, ...presetOptions('full'), opacity: 0.55, bg: 'theme' },
      { ...LINK_DEFAULTS, fit: 'canvas', preview: true },
      {
        ...LINK_DEFAULTS,
        scheme: 'mobile',
        semitone: 'oneShot',
        names: { left: 'Trái & X', right: '', natural: 'Giữa=1', scroll: 'Thăng #+' },
      },
      { ...LINK_DEFAULTS, gamebar: true, banner: false, opacity: 1, subLabel: 'none' },
    ];
    for (const o of cases) expect(linkPart(buildOverlayQuery(o))).toEqual(o);
    // Xem trước: chỉ thêm `preview=1` (link Browser Source không bao giờ có).
    expect(buildOverlayQuery({ ...LINK_DEFAULTS, fit: 'canvas', preview: true })).toBe(
      'layout=game&fit=canvas&preview=1',
    );
    expect(buildOverlayQuery(cases[1])).toBe(
      // dải ngang = layout full nhưng tắt game bar → ghi rõ (mặc định của full là bật); không bao
      // giờ ghi `lyrics` / `autoplay` / `loop`.
      'layout=full&fit=canvas&lanes=horizontal&bg=chroma&scale=1.1&lookahead=12&scheme=mobile' +
        '&tilescale=1.25&sublabel=solfege&gamebar=0&countin=1&delay=3&lang=en&theme=light',
    );
  });

  it('cách Nửa Cung chỉ ghi ở scheme mobile; tên nút encode, bỏ tên trống', () => {
    expect(buildOverlayQuery({ ...LINK_DEFAULTS, semitone: 'oneShot' })).toBe('layout=game');
    expect(buildOverlayQuery({ ...LINK_DEFAULTS, scheme: 'mobile', semitone: 'oneShot' })).toBe(
      'layout=game&scheme=mobile&semitone=oneshot',
    );
    const names = { left: '', right: 'Phải X', natural: '', scroll: 'a&b' };
    expect(buildOverlayQuery({ ...LINK_DEFAULTS, names }, 'LZ')).toBe(
      'layout=game&nr=Ph%E1%BA%A3i%20X&ns=a%26b&data=LZ',
    );
  });

  it('kẹp option trước khi ghi', () => {
    const s = buildOverlayQuery({
      ...LINK_DEFAULTS,
      scale: 7,
      lookahead: 2,
      opacity: 0.1,
      delaySec: 30,
      tileScale: 0.1,
    });
    expect(s).toBe('layout=game&scale=3&lookahead=4&tilescale=0.5&opacity=0.3&delay=10');
  });

  const loc = { origin: 'https://dfht.vercel.app', pathname: '/' };

  it('bài mẫu: #/overlay/<id>?… (không nhúng data)', () => {
    const url = buildOverlayUrl(
      loc,
      { id: 'seed-quoc-ca-viet-nam', seed: true, source: '@title X\nZ' },
      { ...LINK_DEFAULTS, fit: 'canvas', countIn: true },
    );
    expect(url).toBe(
      'https://dfht.vercel.app/#/overlay/seed-quoc-ca-viet-nam?layout=game&fit=canvas&countin=1',
    );
    const parsed = parseLocation(url.slice(url.indexOf('#')), '');
    expect(parsed.route).toEqual({ name: 'overlay', id: 'seed-quoc-ca-viet-nam' });
  });

  it('bài người dùng: LUÔN nhúng data= (OBS không thấy localStorage), không có id', () => {
    const source = '@title Bài của tôi\n@bpm 100\nZ X C V\n[giữ chuột phải] B N [thả chuột phải]';
    const url = buildOverlayUrl(
      { origin: 'http://localhost:4173', pathname: '/app/' },
      { id: 'user-123', seed: false, source },
      { ...LINK_DEFAULTS, bg: 'chroma' },
    );
    expect(url.startsWith('http://localhost:4173/app/#/overlay?layout=game&bg=chroma&data=')).toBe(
      true,
    );
    expect(url).not.toContain('user-123');
    const parsed = parseLocation(url.slice(url.indexOf('#')), '');
    expect(parsed.route).toEqual({ name: 'overlay', id: '' });
    const p = parseOverlayParams(parsed.query);
    expect(p.bg).toBe('chroma');
    expect(decodeShareData(p.data ?? '')).toBe(source);
  });
});

describe('preset', () => {
  it('ba preset theo thứ tự hộp thoại; presetOf suy ngược từ tham số', () => {
    expect(OBS_PRESETS).toEqual(['game', 'strip', 'full']);
    expect(presetOptions('game')).toMatchObject({
      layout: 'game',
      lanes: 'vertical',
      gamebar: false,
    });
    expect(presetOptions('strip')).toMatchObject({
      layout: 'full',
      lanes: 'horizontal',
      gamebar: false,
    });
    expect(presetOptions('full')).toMatchObject({
      layout: 'full',
      lanes: 'vertical',
      gamebar: true,
    });
    for (const p of OBS_PRESETS) expect(presetOf(presetOptions(p))).toBe(p);
  });
});

describe('bố cục cả canvas (fit=canvas) — docs/GAME-UI-REFERENCE.md', () => {
  /** Tâm 8 keycap của game ở 1920×1080 (đo từ ảnh stream, ±5 px). */
  const KEYCAPS_1080 = [733, 797, 862, 927, 992, 1058, 1123, 1187];

  /** Bố cục canvas của khung preset game theo đúng renderer (option của overlayRendererOptions). */
  function gameLayout(vw: number, vh: number, scale = 1, tileScale = 1): Layout {
    const box = canvasPlacement('game', vw, vh, scale, tileScale);
    const o = overlayRendererOptions(parseOverlayParams(q('layout=game&fit=canvas')));
    return computeLayout(box.width, box.height, {
      orientation: 'vertical',
      lookahead: 8,
      hitLinePos: GAME_LAYOUT_HIT_LINE,
      tileScale: box.rendererScale,
      showRibbons: true,
      showSectionLabels: true,
      lanePadding: 'none',
      framePad: o.framePad,
    });
  }

  /** Tâm 8 làn (px viewport) theo đúng renderer: khung canvasPlacement + computeLayout của Player. */
  function laneCentres(vw: number, vh: number, scale = 1, tileScale = 1): number[] {
    const box = canvasPlacement('game', vw, vh, scale, tileScale);
    const L = gameLayout(vw, vh, scale, tileScale);
    return L.laneCrossStart.map((c) => box.x + c + L.laneCrossSize / 2);
  }

  it('khung 16:9 giữa viewport; canvas không 16:9 thì chừa hai bên / trên dưới', () => {
    expect(canvasFrame(1920, 1080)).toEqual({ x: 0, y: 0, width: 1920, height: 1080, k: 1 });
    expect(canvasFrame(2560, 1080)).toEqual({ x: 320, y: 0, width: 1920, height: 1080, k: 1 });
    expect(canvasFrame(1920, 1200)).toEqual({ x: 0, y: 60, width: 1920, height: 1080, k: 1 });
    expect(canvasFrame(1280, 720).k).toBeCloseTo(2 / 3, 9);
  });

  it('1920×1080: khớp game = 610 × 600 tại (683, 150) — khung bảng phím PC, 8 làn 65 px trùng 8 keycap', () => {
    expect(canvasPlacement('game', 1920, 1080)).toEqual({
      x: 683,
      y: 150,
      width: 610,
      height: 600,
      rendererScale: 1,
      gutter: 56,
    });
    const c = laneCentres(1920, 1080);
    c.forEach((x, i) => expect(Math.abs(x - KEYCAPS_1080[i])).toBeLessThanOrEqual(1));
    expect(gameLanePitch(1920, 1080)).toBe(65);
    // Đáy khung (hit line ngay trên) = y 750 ≈ mép trên bảng phím game (758).
    const b = canvasPlacement('game', 1920, 1080);
    expect(b.y + b.height).toBe(750);
    // v1.0.1: khung (phần trước gutter) = khung bảng phím PC x ≈ 683–1237 (8 làn 700–1220 + đệm 16,9 mỗi bên) →
    // ô ngoài cùng cách mép khung ≈ 21,9 px (0,34 bước) chứ không 5 px; gutter ribbon sau mép phải khung.
    const L = gameLayout(1920, 1080);
    expect(L.frameInset).toBeCloseTo(GAME_FRAME_PAD * 65, 0);
    expect(b.x + L.laneCrossStart[0]).toBeCloseTo(700, 0);
    expect(b.x + L.laneCrossStart[7] + L.laneCrossSize).toBeCloseTo(1220, 0);
    expect(b.x + (L.gutter?.x ?? 0)).toBeCloseTo(1237, 0);
    const tileGap = L.laneCrossStart[0] + L.laneInset;
    expect(tileGap).toBeCloseTo(21.9, 0);
    expect((L.gutter?.x ?? 0) - (L.laneCrossStart[7] + L.laneCrossSize - L.laneInset)).toBeCloseTo(
      tileGap,
      6,
    );
  });

  it('2560×1440: × 4/3 — 813 × 800 tại (911, 200), bước cột ≈ 87 px', () => {
    const b = canvasPlacement('game', 2560, 1440);
    expect(b).toMatchObject({ x: 911, y: 200, width: 813, height: 800, gutter: 75 });
    expect(b.rendererScale).toBeCloseTo(4 / 3, 9);
    const c = laneCentres(2560, 1440);
    c.forEach((x, i) => expect(Math.abs(x - (KEYCAPS_1080[i] * 4) / 3)).toBeLessThanOrEqual(1.5));
    expect(gameLanePitch(2560, 1440)).toBeCloseTo(86.67, 2);
  });

  it('1280×720: × 2/3 — 406 × 400 tại (455, 100)', () => {
    const b = canvasPlacement('game', 1280, 720);
    expect(b).toMatchObject({ x: 455, y: 100, width: 406, height: 400, gutter: 37 });
    const c = laneCentres(1280, 720);
    c.forEach((x, i) => expect(Math.abs(x - (KEYCAPS_1080[i] * 2) / 3)).toBeLessThanOrEqual(1));
  });

  it('1366×768 và 3840×2160: tâm 8 làn trùng 8 keycap (× k)', () => {
    expect(canvasPlacement('game', 1366, 768)).toMatchObject({ width: 434, height: 427 });
    expect(canvasPlacement('game', 3840, 2160)).toMatchObject({
      x: 1366,
      y: 300,
      width: 1220,
      height: 1200,
      gutter: 112,
    });
    for (const [w, h, tol] of [
      [1366, 768, 1],
      [3840, 2160, 2.5],
    ]) {
      const f = canvasFrame(w, h);
      laneCentres(w, h).forEach((x, i) =>
        expect(Math.abs(x - (f.x + KEYCAPS_1080[i] * f.k))).toBeLessThanOrEqual(tol),
      );
    }
  });

  it('2560×1080 (ultrawide): khung 16:9 ở giữa — 8 làn quanh tâm màn (1280)', () => {
    const b = canvasPlacement('game', 2560, 1080);
    expect(b).toMatchObject({ x: 1003, y: 150, width: 610, height: 600 });
    const c = laneCentres(2560, 1080);
    expect((c[3] + c[4]) / 2).toBeCloseTo(1280, 0);
    c.forEach((x, i) => expect(Math.abs(x - (KEYCAPS_1080[i] + 320))).toBeLessThanOrEqual(1));
  });

  it('tinh chỉnh `scale` (UI game to / nhỏ): phóng quanh đáy-giữa bảng phím, tâm giữ 960', () => {
    const b = canvasPlacement('game', 1920, 1080, 1.1);
    expect(b).toMatchObject({ x: 655, y: 73, width: 671, height: 660, gutter: 62 });
    const c = laneCentres(1920, 1080, 1.1);
    expect(c[1] - c[0]).toBeCloseTo(71.5, 1);
    expect(Math.abs((c[3] + c[4]) / 2 - 960)).toBeLessThanOrEqual(0.5); // làm tròn px của khung
    // Rất to: khung không trồi khỏi mép trên (thấp lại).
    const big = canvasPlacement('game', 1920, 1080, 1.3);
    expect(big.y).toBe(0);
    expect(big.height).toBe(699);
    const small = canvasPlacement('game', 1920, 1080, 0.8);
    expect(small).toMatchObject({ x: 738, width: 443 + 45 });
  });

  it('cỡ ô của Player (tileScale) chỉ nới gutter ribbon, 8 làn vẫn trùng keycap', () => {
    const b = canvasPlacement('game', 1920, 1080, 1, 1.5);
    expect(b).toMatchObject({ x: 683, width: 554 + 84, rendererScale: 1.5, gutter: 84 });
    const c = laneCentres(1920, 1080, 1, 1.5);
    c.forEach((x, i) => expect(Math.abs(x - KEYCAPS_1080[i])).toBeLessThanOrEqual(1));
  });

  it('dải ngang: ngay trên bảng phím game, không lấn bên phải; cột đầy đủ: bên phải, không đè bảng phím', () => {
    const strip = canvasPlacement('strip', 1920, 1080);
    expect(strip).toMatchObject({ x: 370, y: 310, width: 1140, height: 440, gutter: 0 });
    expect(strip.y + strip.height).toBeLessThanOrEqual(758);
    expect(strip.x + strip.width).toBeLessThanOrEqual(1510);
    const full = canvasPlacement('full', 1920, 1080);
    expect(full).toMatchObject({ x: 1290, y: 80, width: 560, height: 920 });
    expect(full.x).toBeGreaterThan(1241); // mép phải bảng phím game
    expect(full.x + full.width).toBeLessThanOrEqual(1920);
    expect(canvasPlacement('strip', 2560, 1440)).toMatchObject({
      x: 493,
      y: 413,
      width: 1520,
      height: 587,
    });
    for (const p of OBS_PRESETS) {
      for (const [w, h] of [
        [1920, 1080],
        [2560, 1440],
        [1280, 720],
        [2560, 1080],
      ]) {
        const box = canvasPlacement(p, w, h);
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.y).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(w);
        expect(box.y + box.height).toBeLessThanOrEqual(h);
      }
    }
  });
});

describe('gameKeyboardBox — bảng phím game minh họa của cửa sổ "Xem trước"', () => {
  const centres = (b: { x: number; width: number }[]) => b.map((k) => k.x + k.width / 2);

  /** Tâm 8 làn của khung preset game (px viewport) theo đúng renderer (khung bảng phím: 8 làn + đệm). */
  function laneCentresOf(w: number, h: number, scale = 1): number[] {
    const box = canvasPlacement('game', w, h, scale);
    const o = overlayRendererOptions(parseOverlayParams(q('layout=game&fit=canvas')));
    const L = computeLayout(box.width, box.height, {
      orientation: 'vertical',
      lookahead: 6,
      hitLinePos: GAME_LAYOUT_HIT_LINE,
      tileScale: box.rendererScale,
      showRibbons: true,
      showSectionLabels: true,
      lanePadding: 'none',
      framePad: o.framePad,
    });
    return L.laneCrossStart.map((c) => box.x + c + L.laneCrossSize / 2);
  }

  it('1920×1080: khung x 683–1237 (= khung overlay), y 758–921; 8 keycap 22 px ở hàng y ≈ 840, thẳng tâm 8 làn', () => {
    const kb = gameKeyboardBox(1920, 1080);
    expect(kb.panel).toEqual({ x: 683, y: 758, width: 554, height: 163 });
    expect(kb.keys).toHaveLength(8);
    for (const k of kb.keys) expect(k).toMatchObject({ width: 22, height: 22, y: 829 });
    // Mép trái / phải khung minh họa = mép trái khung overlay / mép trái gutter ribbon.
    const box = canvasPlacement('game', 1920, 1080);
    expect(kb.panel.x).toBe(box.x);
    expect(kb.panel.x + kb.panel.width).toBe(box.x + box.width - box.gutter);
    const lanes = laneCentresOf(1920, 1080);
    centres(kb.keys).forEach((c, i) => expect(Math.abs(c - lanes[i])).toBeLessThanOrEqual(1));
    expect(gameLanePitch(1920, 1080)).toBe(65);
  });

  it('cửa sổ Xem trước 960×540 (nửa cỡ) và cửa sổ không 16:9: cùng khung 16:9, vẫn thẳng làn', () => {
    for (const [w, h] of [
      [960, 540],
      [1024, 768],
      [1200, 540],
    ]) {
      const kb = gameKeyboardBox(w, h);
      const box = canvasPlacement('game', w, h);
      const lanes = laneCentresOf(w, h);
      centres(kb.keys).forEach((c, i) => expect(Math.abs(c - lanes[i])).toBeLessThanOrEqual(1));
      // Đáy khung overlay (hit line) ngay trên mép trên bảng phím.
      expect(kb.panel.y).toBeGreaterThanOrEqual(box.y + box.height - 1);
    }
  });

  it('tinh chỉnh cỡ UI game: phóng quanh đáy-giữa (960, 921), keycap theo làn', () => {
    const kb = gameKeyboardBox(1920, 1080, 1.2);
    expect(kb.panel.y + kb.panel.height).toBe(921);
    expect(Math.abs(kb.panel.x + kb.panel.width / 2 - 960)).toBeLessThanOrEqual(0.5);
    const lanes = laneCentresOf(1920, 1080, 1.2);
    centres(kb.keys).forEach((c, i) => expect(Math.abs(c - lanes[i])).toBeLessThanOrEqual(1.5));
    // Số lạ → không phóng.
    expect(gameKeyboardBox(1920, 1080, Number.NaN)).toEqual(gameKeyboardBox(1920, 1080));
  });
});

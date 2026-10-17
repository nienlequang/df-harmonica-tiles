import { expect, test } from '@playwright/test';
import type { BrowserContextOptions, Page } from '@playwright/test';
import { encodeShareData } from '../src/core/share';
import { collectErrors, stubClipboard } from './helpers';

/**
 * v1.0.1 — góp ý của chủ dự án trên bản live 1.0.0 (docs/DECISIONS.md D-427 … D-438):
 * - 1a nốt đầu chạm vạch sáng không khựng: quanh lần chạm đầu (trang mới) khung đều, ô rơi liên tục (không ghim / nhảy),
 *   phần tử làm nóng DOM (`.glow-warmup`) có mặt lúc đứng yên rồi gỡ sạch, không nằm trong game bar / bàn nút; ở MỌI bề
 *   mặt gọi `warmDomEffects` (màn chơi, Cửa sổ nổi, overlay, trang mini) nó có CSS thật = giữ ≥ 100 ms, không bị gỡ
 *   ngay vì "không có CSS" (D-440 — cửa sổ nổi bản build: CSS chép sang còn đang tải lúc engine gắn);
 * - 1b đếm vào ngắn 35 %: quãng nốt đầu từ chỗ đứng yên tới hit line = 0,65 × (1 ô nhịp + khoảng lặng trước nốt) — màn
 *   chơi (đo cả thời gian rơi thật), overlay theo màn chơi, overlay tự chạy, trang mini;
 * - 2 overlay khớp game `fit=canvas`: khung = khung bảng phím PC, ô ngoài cùng cách mép ≥ 0,25 bước cột, tâm ô = tâm phím
 *   (Cửa sổ nổi PC dùng cùng layout — cỡ / cột Căn chỉnh kiểm ở pip-size.spec.ts);
 * - 3 kiểu Mobile: ô ngoài cùng không chạm mép (màn chơi, overlay kiểu Mobile, trang mini "Khớp nút game" đúng tỉ lệ thật
 *   với cửa sổ 8 làn);
 * - 4 Quốc ca chỉ còn Phần 1 + Phần 2.
 */

const QUOC_CA = { id: 'seed-quoc-ca-viet-nam', title: 'Quốc ca Việt Nam', bpm: 80, first: 2.75 };
const TAKE = { id: 'seed-takediskrush', title: 'TAKEDISKRUSH!', bpm: 122, first: 0 };
type Song = typeof QUOC_CA;
/** Cả hai bài mẫu 4/4. */
const BAR = 4;
/** Quãng nốt đầu (beat) từ chỗ đứng yên lúc đếm ngược tới hit line — trước v1.0.1: 1 ô nhịp + khoảng lặng. */
const oldTravel = (s: Song): number => BAR + s.first;
/** … từ v1.0.1: 65 % (src/player/leadIn.ts). */
const newTravel = (s: Song): number => 0.65 * oldTravel(s);
/** Beat của khung đứng yên (pre-roll) khi phát từ 0. */
const restBeat = (s: Song): number => s.first - newTravel(s);

/**
 * Bài kiểm mép: nốt ở hai làn NGOÀI CÙNG (Z = nút 1, `,` = nút 1̇) ngay từ đầu, xen vài làn giữa — hai bài mẫu không có
 * ô ở làn ngoài cùng trong vài giây đầu nên không kiểm được khe tới mép.
 */
const EDGE_ID = 'v101-edge';
const EDGE_SOURCE = [
  '@title Mép ngoài',
  '@bpm 100',
  '@time 4/4',
  '',
  '# A',
  'Z , X M Z , C N',
  'Z , Z , Z , Z ,',
  '',
].join('\n');

/** Đặt bài kiểm mép vào Thư viện trước khi app chạy (một lần mỗi tab). */
async function seedEdgeSong(page: Page): Promise<void> {
  await page.addInitScript(
    ({ id, source }) => {
      if (sessionStorage.getItem('v101-edge')) return;
      sessionStorage.setItem('v101-edge', '1');
      const now = Date.now();
      localStorage.setItem(
        'dfht-library',
        JSON.stringify({
          state: { songs: [{ id, source, createdAt: now, updatedAt: now }] },
          version: 1,
        }),
      );
    },
    { id: EDGE_ID, source: EDGE_SOURCE },
  );
}

const ANDROID_UA =
  'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36';

test.beforeEach(async ({ context }) => {
  await stubClipboard(context);
});

/** Cài đặt đặt trước khi app chạy (một lần mỗi tab — tải lại không ghi đè). */
async function presetSettings(page: Page, state: Record<string, unknown>): Promise<void> {
  await page.addInitScript((s) => {
    if (sessionStorage.getItem('v101-init')) return;
    sessionStorage.setItem('v101-init', '1');
    localStorage.setItem('dfht-settings', JSON.stringify({ state: s, version: 5 }));
  }, state);
}

// ---------------------------------------------------------------------------
// Ghi khung hình canvas + mốc DOM
// ---------------------------------------------------------------------------

/** Hình chữ nhật (ô / viên thuốc), px CSS của trang. */
type Rect = [x: number, y: number, w: number, h: number];

interface Frame {
  /** performance.now() lúc bắt đầu khung. */
  t: number;
  /** Có tô / xóa nền cả canvas (= khung thật của renderer). */
  bg: boolean;
  /** Cỡ CSS của canvas. */
  w: number;
  h: number;
  r: Rect[];
}

interface Recording {
  frames: Frame[];
  /** [thời điểm, số đếm ngược đang hiện | null]. */
  marks: [number, string | null][];
  /** [thời điểm, phần tử `hit` có mặt hay không] — mỗi lần đổi. */
  hits: [number, boolean][];
  /** Phần tử làm nóng: [thời điểm, 'add' | 'remove', nằm trong game bar / bàn nút / chỗ banner]. */
  warm: [number, 'add' | 'remove', boolean][];
}

/**
 * Ghi mọi khung của canvas lớp `cls` (khung mới ở `setTransform(dpr, 0, 0, dpr, 0, 0)`, `bg` khi tô / xóa nền cả
 * canvas; roundRect / rect đổi sang px CSS của trang), mốc đếm ngược, lúc phần tử `hit` (vd. keycap sáng của game
 * bar) hiện / mất, và phần tử làm nóng `.glow-warmup` được thêm / gỡ.
 */
async function record(page: Page, cls: string, hit: string): Promise<void> {
  await page.addInitScript(
    ({ cls, hit }) => {
      type R = [number, number, number, number];
      type F = { t: number; bg: boolean; w: number; h: number; r: R[] };
      const rec = {
        frames: [] as F[],
        marks: [] as [number, string | null][],
        hits: [] as [number, boolean][],
        warm: [] as [number, 'add' | 'remove', boolean][],
      };
      (window as unknown as { __v101: typeof rec }).__v101 = rec;
      let cur: F | null = null;
      const mine = (c: CanvasRenderingContext2D): boolean =>
        c.canvas instanceof HTMLCanvasElement && c.canvas.classList.contains(cls);
      const toPage = (
        c: CanvasRenderingContext2D,
        x: number,
        y: number,
      ): [number, number, number] => {
        const el = c.canvas as HTMLCanvasElement;
        const box = el.getBoundingClientRect();
        const k = el.width > 0 ? box.width / el.width : 1;
        const p = c.getTransform().transformPoint(new DOMPoint(x, y));
        return [box.left + p.x * k, box.top + p.y * k, c.getTransform().a * k];
      };
      const P = CanvasRenderingContext2D.prototype;
      const oSet = P.setTransform;
      P.setTransform = function (this: CanvasRenderingContext2D, ...a: unknown[]) {
        const n = a as number[];
        if (mine(this) && a.length === 6 && n[0] === n[3] && !n[1] && !n[2] && !n[4] && !n[5]) {
          const el = this.canvas as HTMLCanvasElement;
          cur = { t: performance.now(), bg: false, w: el.clientWidth, h: el.clientHeight, r: [] };
          rec.frames.push(cur);
          if (rec.frames.length > 5000) rec.frames.shift();
        }
        return (oSet as (...x: unknown[]) => void).apply(this, a);
      } as typeof P.setTransform;
      const full = (c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) => {
        const el = c.canvas as HTMLCanvasElement;
        return x === 0 && y === 0 && w >= el.clientWidth - 1 && h >= el.clientHeight - 1;
      };
      for (const name of ['fillRect', 'clearRect'] as const) {
        const orig = P[name];
        P[name] = function (
          this: CanvasRenderingContext2D,
          x: number,
          y: number,
          w: number,
          h: number,
        ) {
          if (cur && mine(this) && full(this, x, y, w, h)) cur.bg = true;
          return orig.call(this, x, y, w, h);
        };
      }
      const shape = (orig: (...x: unknown[]) => void) =>
        function (this: CanvasRenderingContext2D, ...a: unknown[]) {
          if (cur && mine(this)) {
            const [x, y, w, h] = a as number[];
            const [px, py, k] = toPage(this, x, y);
            cur.r.push([px, py, w * k, h * k]);
          }
          return orig.apply(this, a);
        };
      if (P.roundRect) P.roundRect = shape(P.roundRect as never) as typeof P.roundRect;
      P.rect = shape(P.rect as never) as typeof P.rect;

      let shown: string | null | undefined;
      let lit = false;
      const BOXES = '.game-bar, .mpad, .mini-pad, .hold-banner-slot';
      const check = (list: MutationRecord[]) => {
        const now = performance.now();
        const el = document.querySelector('.player-countdown-num, .mini-countdown-num');
        const txt = el ? el.textContent : null;
        if (txt !== shown) {
          rec.marks.push([now, txt]);
          shown = txt;
        }
        const on = document.querySelector(hit) !== null;
        if (on !== lit) {
          rec.hits.push([now, on]);
          lit = on;
        }
        for (const m of list) {
          for (const n of Array.from(m.addedNodes)) {
            if (n instanceof HTMLElement && n.classList.contains('glow-warmup')) {
              rec.warm.push([now, 'add', n.closest(BOXES) !== null]);
            }
          }
          for (const n of Array.from(m.removedNodes)) {
            if (n instanceof HTMLElement && n.classList.contains('glow-warmup')) {
              rec.warm.push([now, 'remove', false]);
            }
          }
        }
      };
      new MutationObserver(check).observe(document, {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true,
        attributeFilter: ['class'],
      });
    },
    { cls, hit },
  );
}

async function recording(page: Page): Promise<Recording> {
  return page.evaluate(() => (window as unknown as { __v101: Recording }).__v101);
}

async function boxOf(
  page: Page,
  selector: string,
): Promise<{ x: number; y: number; width: number; height: number }> {
  const b = await page.locator(selector).first().boundingBox();
  expect(b, `không thấy ${selector}`).not.toBeNull();
  return b!;
}

const median = (a: number[]): number => {
  const s = [...a].sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)];
};

const rkey = (r: Rect): string => r.map((v) => Math.round(v * 2) / 2).join(',');

/** Hình đứng yên (nền làn, khung…): có mặt y hệt ở khung đầu và khung cuối của đoạn. */
function staticKeys(frames: Frame[]): Set<string> {
  const first = new Set(frames[0].r.map(rkey));
  return new Set(frames[frames.length - 1].r.map(rkey).filter((k) => first.has(k)));
}

/** Ô đang rơi của một khung: không phải hình đứng yên, cao ≥ 3, rộng 8 … ¼ canvas. */
function movingTiles(f: Frame, statics: Set<string>): Rect[] {
  return f.r.filter((r) => r[3] >= 3 && r[2] >= 8 && r[2] <= f.w / 4 && !statics.has(rkey(r)));
}

interface Continuity {
  frames: number;
  /** Khung cách nhau lâu nhất (ms) trong đoạn. */
  maxGap: number;
  /** Tốc độ rơi (px / ms). */
  speed: number;
  /** Lệch lớn nhất của quãng rơi so với đường thẳng (px) và quy ra ms. */
  residualPx: number;
  residualMs: number;
  /** Số cặp khung không ghép được ô nào. */
  unmatched: number;
}

/**
 * Quanh lần chạm đầu (`tHit − 300 … tHit + 700` ms): khoảng cách giữa các khung thật và độ liên tục của ô rơi — mỗi cặp
 * khung liền nhau, quãng dời của ô (trung vị qua các ô nằm hẳn trên vạch: phần trên `upperFrac` của canvas) cộng dồn
 * thành quãng rơi theo thời gian; lệch khỏi đường thẳng = ghim / nhảy.
 */
function continuity(rec: Recording, top: number, tHit: number, upperFrac: number): Continuity {
  const W = rec.frames
    .filter((f) => f.bg && f.t >= tHit - 300 && f.t <= tHit + 700)
    .sort((a, b) => a.t - b.t);
  expect(W.length, 'quá ít khung quanh lần chạm đầu').toBeGreaterThan(20);
  const statics = staticKeys(W);
  const inUpper = (f: Frame) =>
    movingTiles(f, statics).filter((r) => r[1] > top + 1 && r[1] + r[3] < top + upperFrac * f.h);
  let maxGap = 0;
  let p = 0;
  let unmatched = 0;
  const pts: [number, number][] = [[W[0].t, 0]];
  for (let i = 1; i < W.length; i++) {
    const dt = W[i].t - W[i - 1].t;
    maxGap = Math.max(maxGap, dt);
    const a = inUpper(W[i - 1]);
    const b = inUpper(W[i]);
    const ds: number[] = [];
    for (const q of a) {
      let best: number | null = null;
      for (const r of b) {
        if (Math.abs(r[0] - q[0]) > 0.6 || Math.abs(r[2] - q[2]) > 0.6) continue;
        if (Math.abs(r[3] - q[3]) > 0.6) continue;
        const d = r[1] - q[1];
        if (d < -0.6 || d > 3 + 1.5 * dt) continue;
        if (best === null || d < best) best = d;
      }
      if (best !== null) ds.push(best);
    }
    if (ds.length === 0) {
      unmatched++;
      continue;
    }
    p += median(ds);
    pts.push([W[i].t, p]);
  }
  // Đường thẳng bình phương nhỏ nhất.
  const n = pts.length;
  const mt = pts.reduce((s, q) => s + q[0], 0) / n;
  const mp = pts.reduce((s, q) => s + q[1], 0) / n;
  let num = 0;
  let den = 0;
  for (const [t, y] of pts) {
    num += (t - mt) * (y - mp);
    den += (t - mt) ** 2;
  }
  const speed = den > 0 ? num / den : 0;
  let residualPx = 0;
  for (const [t, y] of pts)
    residualPx = Math.max(residualPx, Math.abs(y - (mp + speed * (t - mt))));
  return {
    frames: W.length,
    maxGap: Math.round(maxGap),
    speed,
    residualPx: Math.round(residualPx * 100) / 100,
    residualMs: speed > 0 ? Math.round(residualPx / speed) : Number.POSITIVE_INFINITY,
    unmatched,
  };
}

/** Mốc hết đếm ngược (số to biến mất) — lúc ô bắt đầu rơi từ khung đứng yên. */
function countdownEnd(rec: Recording): number {
  const start = rec.marks.find((m) => m[1] !== null)?.[0];
  expect(start, 'không thấy số đếm ngược').toBeDefined();
  const end = rec.marks.find((m) => m[1] === null && m[0] > start!)?.[0];
  expect(end, 'đếm ngược không kết thúc').toBeDefined();
  return end!;
}

/** Ghi lúc phần tử làm nóng `.glow-warmup` được thêm / gỡ (document của trang, từ trước khi app chạy). */
async function logWarm(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const log: [number, 'add' | 'remove'][] = [];
    (window as unknown as { __warm: typeof log }).__warm = log;
    const isWarm = (n: Node) =>
      n.nodeType === 1 && (n as Element).classList.contains('glow-warmup');
    new MutationObserver((list) => {
      const now = performance.now();
      for (const m of list) {
        for (const n of Array.from(m.addedNodes)) if (isWarm(n)) log.push([now, 'add']);
        for (const n of Array.from(m.removedNodes)) if (isWarm(n)) log.push([now, 'remove']);
      }
    }).observe(document, { subtree: true, childList: true });
  });
}

const warmLog = (page: Page): Promise<[number, 'add' | 'remove'][]> =>
  page.evaluate(() => (window as unknown as { __warm: [number, 'add' | 'remove'][] }).__warm);

/**
 * Có lượt đặt phần tử làm nóng được GIỮ ≥ 100 ms (CSS thật đã áp). Phần tử thăm dò không có CSS bị gỡ ngay trong cùng tác
 * vụ — một lượt MutationObserver ghi cả thêm lẫn gỡ cùng thời điểm (vd. Cửa sổ nổi: lượt thử lúc engine gắn khi CSS còn
 * đang tải, rồi lượt thật khi CSS về — D-440). Lượt chưa gỡ (còn đang làm nóng) cũng được. Trả số ms giữ lâu nhất.
 */
function expectWarmKept(log: [number, string, ...unknown[]][], where: string): number {
  const adds = log.filter((w) => w[1] === 'add');
  expect(adds.length, `${where}: không có phần tử làm nóng DOM`).toBeGreaterThan(0);
  let kept = 0;
  for (const a of adds) {
    const rem = log.find((w) => w[1] === 'remove' && w[0] >= a[0]);
    kept = Math.max(kept, (rem ? rem[0] : Number.POSITIVE_INFINITY) - a[0]);
  }
  const trace = log.map((w) => `${w[1]}@${w[0].toFixed(0)}`).join(' ');
  expect(
    kept,
    `${where}: phần tử làm nóng bị gỡ ngay (giữ lâu nhất ${kept.toFixed(0)} ms — không có CSS): ${trace}`,
  ).toBeGreaterThanOrEqual(100);
  return kept;
}

// ---------------------------------------------------------------------------
// 4. Quốc ca chỉ còn Phần 1 + Phần 2
// ---------------------------------------------------------------------------

test('Quốc ca Việt Nam chỉ còn "Phần 1" + "Phần 2" (1:02 ở 80 BPM)', async ({ page }) => {
  const errors = collectErrors(page);
  await presetSettings(page, { language: 'vi' });
  await page.goto(`/#/play/${QUOC_CA.id}`);
  await expect(page.getByRole('heading', { level: 1, name: QUOC_CA.title })).toBeVisible();
  const options = page.locator('select.transport-section option:not([value=""])');
  await expect(options).toHaveText(['Phần 1', 'Phần 2']);
  await expect(page.locator('.seekbar-time')).toHaveText(/\/ 1:02$/);
  expect(errors).toEqual([]);
});

// ---------------------------------------------------------------------------
// 1b. Đếm vào ngắn 35 %
// ---------------------------------------------------------------------------

/** Ghi mọi lần `data-beat` (beat overlay / trang mini đang vẽ) đổi, kèm thời điểm. */
async function logBeats(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const log: [number, number][] = [];
    (window as unknown as { __beats: [number, number][] }).__beats = log;
    new MutationObserver((list) => {
      for (const m of list) {
        const v = Number((m.target as HTMLElement).dataset.beat);
        if (Number.isFinite(v)) log.push([performance.now(), v]);
      }
    }).observe(document, { subtree: true, attributes: true, attributeFilter: ['data-beat'] });
  });
}

const beatsOf = (page: Page): Promise<[number, number][]> =>
  page.evaluate(() => (window as unknown as { __beats: [number, number][] }).__beats);

/**
 * Quãng (beat) nốt đầu đi từ khung đứng yên `rest` tới `first`, đo bằng chuyển động thật của `data-beat`: khung đứng
 * yên không vẽ lại (engine không xin khung khi đứng yên) nên lấy khung ĐẦU TIÊN đã rời `rest` (phải sát `rest` — không
 * nhảy) và khung đầu tiên tới `first`, rồi quy thời gian giữa hai khung ra beat theo tempo:
 * `(b₁ − rest) + (t₂ − t₁) × bpm / 60 − (b₂ − first)`. Lệch khỏi `first − rest` = rơi sai tốc độ / nhảy / ghim.
 */
function travelFromLog(log: [number, number][], rest: number, first: number, bpm: number): number {
  const restAt = log.findIndex((b) => Math.abs(b[1] - rest) < 0.002);
  expect(restAt, 'data-beat không tới khung đứng yên').toBeGreaterThanOrEqual(0);
  const after = log.slice(restAt);
  const leave = after.findIndex((b) => b[1] > rest + 0.002);
  expect(leave, 'không rời khung đứng yên').toBeGreaterThan(0);
  expect(after[leave][1] - rest, 'rời khung đứng yên bằng một cú nhảy').toBeLessThan(0.25);
  const hit = after.findIndex((b) => b[1] >= first - 1e-6);
  expect(hit, 'không tới nốt đầu').toBeGreaterThan(leave);
  const [t1, b1] = after[leave];
  const [t2, b2] = after[hit];
  return b1 - rest + ((t2 - t1) * bpm) / 60000 - (b2 - first);
}

for (const song of [QUOC_CA, TAKE]) {
  test(`đếm vào ngắn 35 %: ${song.title} — màn chơi + overlay theo màn chơi: khung đứng yên ở beat ${restBeat(song).toFixed(4)}, nốt đầu đi ${newTravel(song).toFixed(4)} beat (cũ ${oldTravel(song)})`, async ({
    context,
  }) => {
    test.setTimeout(60_000);
    const player = await context.newPage();
    const errors = collectErrors(player);
    await presetSettings(player, { language: 'vi' });
    await record(player, 'player-canvas', '.game-bar .gb-key.is-active');
    await player.goto(`/#/play/${song.id}`);
    await expect(player.getByRole('heading', { level: 1, name: song.title })).toBeVisible();
    const overlay = await context.newPage();
    const overlayErrors = collectErrors(overlay);
    await overlay.setViewportSize({ width: 960, height: 540 });
    await logBeats(overlay);
    await overlay.goto(`/#/overlay/${song.id}?layout=game&fit=canvas&preview=1`);
    const region = overlay.locator('.overlay');
    await expect(region).toHaveAttribute('data-mode', 'follow');
    await expect(region).toHaveAttribute('data-beat', '0.000');
    await player.waitForTimeout(800);

    await player.locator('button.transport-play').click();
    await expect(player.locator('.player-countdown-num')).toHaveText('3');
    // Lúc đếm ngược: overlay vẽ đúng khung đứng yên của màn chơi (tin `state` mang dải đếm vào của màn chơi).
    await expect
      .poll(async () => Number(await region.getAttribute('data-beat')))
      .toBeCloseTo(restBeat(song), 2);
    expect(Math.abs(Number(await region.getAttribute('data-beat')) - restBeat(song))).toBeLessThan(
      0.0015,
    );
    await expect(player.locator('.player-countdown')).toHaveCount(0, { timeout: 6_000 });
    // Chờ nốt đầu chạm vạch + chút nữa.
    await player.waitForTimeout(((newTravel(song) * 60) / song.bpm) * 1000 + 900);
    await player.locator('button.transport-play').click();

    // Overlay: quãng rơi thật của nốt đầu (thời gian × tempo).
    const travel = travelFromLog(await beatsOf(overlay), restBeat(song), song.first, song.bpm);
    expect(
      Math.abs(travel - newTravel(song)),
      `overlay: nốt đầu đi ${travel.toFixed(3)} beat`,
    ).toBeLessThan(0.25);
    // Màn chơi (Quốc ca — nốt đầu ở beat 2,75, keycap của nó chỉ sáng khi chạm vạch): hết đếm ngược → keycap sáng.
    if (song.first > 0) {
      const rec = await recording(player);
      const go = countdownEnd(rec);
      const hit = rec.hits.find((h) => h[1] && h[0] > go)?.[0];
      expect(hit, 'keycap nốt đầu không sáng').toBeDefined();
      const playerTravel = ((hit! - go) * song.bpm) / 60000;
      test.info().annotations.push({
        type: 'travel',
        description: `${song.id}: màn chơi ${playerTravel.toFixed(3)} beat, overlay ${travel.toFixed(3)} beat (mong ${newTravel(song)})`,
      });
      expect(
        Math.abs(playerTravel - newTravel(song)),
        `màn chơi: nốt đầu đi ${playerTravel.toFixed(3)} beat`,
      ).toBeLessThan(0.25);
    }
    expect(errors).toEqual([]);
    expect(overlayErrors).toEqual([]);
  });

  test(`đếm vào ngắn 35 %: ${song.title} — overlay tự chạy (countin=1) + trang mini: khung đứng yên ở beat ${restBeat(song).toFixed(4)}`, async ({
    browser,
  }) => {
    test.setTimeout(60_000);
    // Overlay tự chạy (không có màn chơi nào): ~2 s chờ rồi đếm ngược 3 s ở khung đứng yên.
    const ctxA = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    await stubClipboard(ctxA);
    const overlay = await ctxA.newPage();
    const overlayErrors = collectErrors(overlay);
    await logBeats(overlay);
    await logWarm(overlay);
    await overlay.goto(`/#/overlay/${song.id}?layout=game&fit=canvas&countin=1&delay=3`);
    const region = overlay.locator('.overlay');
    await expect
      .poll(async () => Number(await region.getAttribute('data-beat')), { timeout: 10_000 })
      .toBeCloseTo(restBeat(song), 2);
    await overlay.waitForTimeout(3000 + ((newTravel(song) * 60) / song.bpm) * 1000 + 800);
    const travel = travelFromLog(await beatsOf(overlay), restBeat(song), song.first, song.bpm);
    expect(
      Math.abs(travel - newTravel(song)),
      `overlay tự chạy: ${travel.toFixed(3)} beat`,
    ).toBeLessThan(0.25);
    // OverlayEngine.attach làm nóng keycap / banner / nhãn modifier bằng CSS thật (D-429, D-440).
    expectWarmKept(await warmLog(overlay), 'overlay tự chạy');
    expect(overlayErrors).toEqual([]);
    await ctxA.close();

    // Trang mini (360 × 360 cảm ứng): đếm ngược ≥ 3 s ở khung đứng yên.
    const ctxB = await browser.newContext({
      viewport: { width: 360, height: 360 },
      hasTouch: true,
      isMobile: true,
    });
    await stubClipboard(ctxB);
    const mini = await ctxB.newPage();
    const miniErrors = collectErrors(mini);
    await presetSettings(mini, { language: 'vi' });
    await logBeats(mini);
    await logWarm(mini);
    await mini.goto(`/#/mini/${song.id}`);
    await expect(mini.locator('.mini-play')).toBeVisible();
    await mini.waitForTimeout(800);
    await mini.locator('.mini-play').tap();
    await expect(mini.locator('.mini-countdown-num')).toHaveText('3');
    await expect
      .poll(async () => Number(await mini.locator('.mini').getAttribute('data-beat')))
      .toBeCloseTo(restBeat(song), 2);
    await expect(mini.locator('.mini-countdown')).toHaveCount(0, { timeout: 6_000 });
    await mini.waitForTimeout(((newTravel(song) * 60) / song.bpm) * 1000 + 800);
    const miniTravel = travelFromLog(await beatsOf(mini), restBeat(song), song.first, song.bpm);
    expect(
      Math.abs(miniTravel - newTravel(song)),
      `trang mini: ${miniTravel.toFixed(3)} beat`,
    ).toBeLessThan(0.25);
    expectWarmKept(await warmLog(mini), 'trang mini');
    expect(miniErrors).toEqual([]);
    await ctxB.close();
  });
}

// ---------------------------------------------------------------------------
// 1a. Nốt đầu chạm vạch sáng không khựng
// ---------------------------------------------------------------------------

const HITCH_CASES: {
  name: string;
  use: BrowserContextOptions;
  settings: Record<string, unknown>;
  hit: string;
  /** Phần trên của canvas chứa ô nằm hẳn trên vạch (ô quanh vạch đổi hình lúc chạm). */
  upperFrac: number;
  /** Đo quãng nốt đầu bằng thời gian (âm thanh tắt: transport chạy ngay khi hết số). */
  travel: boolean;
}[] = [
  {
    name: 'kiểu PC, âm thanh tắt',
    use: {},
    settings: { language: 'vi' },
    hit: '.game-bar .gb-key.is-active',
    upperFrac: 0.7,
    travel: true,
  },
  {
    name: 'kiểu PC, giai điệu mẫu + click bật',
    use: {},
    settings: { language: 'vi', audioEnabled: true, clickSound: true },
    hit: '.game-bar .gb-key.is-active',
    upperFrac: 0.7,
    travel: false,
  },
  {
    name: 'kiểu Mobile 844 × 390',
    use: { viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true },
    settings: { language: 'vi', controlScheme: 'mobile' },
    hit: '.mpad .mpad-digit.is-active',
    upperFrac: 0.5,
    travel: true,
  },
];

for (const c of HITCH_CASES) {
  test.describe(`nốt đầu chạm vạch sáng (Quốc ca, trang mới) — ${c.name}`, () => {
    test.use(c.use);

    test('khung đều, ô rơi liên tục quanh lần chạm đầu; phần tử làm nóng DOM có lúc đứng yên rồi gỡ sạch', async ({
      page,
    }) => {
      test.setTimeout(60_000);
      const errors = collectErrors(page);
      await presetSettings(page, c.settings);
      await record(page, 'player-canvas', c.hit);
      await page.goto(`/#/play/${QUOC_CA.id}`);
      await expect(page.getByRole('heading', { level: 1, name: QUOC_CA.title })).toBeVisible();
      // Hết lượt làm nóng (700 ms sau khi gắn) + khung pre-roll ổn định.
      await page.waitForTimeout(1500);
      const warm = (await recording(page)).warm;
      if (c.settings.controlScheme !== 'mobile') {
        // Kiểu PC: keycap / banner / nhãn modifier làm nóng (CSS thật có filter / clip-path / animation).
        expect(
          warm.filter((w) => w[1] === 'add').length,
          'không có phần tử làm nóng',
        ).toBeGreaterThan(0);
        // Có CSS thật (giữ ≥ 100 ms) — không phải đặt rồi gỡ ngay.
        expectWarmKept(warm, 'màn chơi');
      }
      expect(
        warm.filter((w) => w[1] === 'add' && w[2]),
        'phần tử làm nóng nằm trong game bar',
      ).toEqual([]);
      await expect(page.locator('.glow-warmup')).toHaveCount(0);
      await expect(page.locator(c.hit)).toHaveCount(0);

      const play = page.locator('button.transport-play');
      if (c.use.hasTouch) await play.tap();
      else await play.click();
      await expect(page.locator('.player-countdown')).toHaveCount(0, { timeout: 8_000 });
      await page.waitForTimeout(((newTravel(QUOC_CA) * 60) / QUOC_CA.bpm) * 1000 + 1200);
      if (c.use.hasTouch) await play.tap();
      else await play.click();

      const rec = await recording(page);
      const go = countdownEnd(rec);
      const hit = rec.hits.find((h) => h[1] && h[0] > go)?.[0];
      expect(hit, 'nốt đầu không sáng').toBeDefined();
      const box = await boxOf(page, 'canvas.player-canvas');
      const res = continuity(rec, box.y, hit!, c.upperFrac);
      const travel = ((hit! - go) * QUOC_CA.bpm) / 60000;
      test.info().annotations.push({
        type: 'first-hit',
        description: `${c.name}: ${JSON.stringify({ ...res, speed: Math.round(res.speed * 1000), travel: Number(travel.toFixed(3)) })}`,
      });
      expect(res.unmatched, 'khung không ghép được ô nào').toBeLessThanOrEqual(2);
      expect(res.speed, 'ô không rơi').toBeGreaterThan(0.01);
      // Khựng thô (≥ 100 ms) quanh lần chạm đầu: không có. (Đo kỹ với CPU chậm 4–6×: harness v1.0.1, CHANGELOG.)
      expect(res.maxGap, `khung hở ${res.maxGap} ms quanh lần chạm đầu`).toBeLessThan(100);
      // Ô không bị ghim / nhảy: quãng rơi lệch đường thẳng ≤ 30 ms (+ ¾ px làm tròn).
      expect(
        res.residualPx,
        `ô lệch ${res.residualPx} px (${res.residualMs} ms)`,
      ).toBeLessThanOrEqual(0.75 + res.speed * 30);
      if (c.travel) {
        expect(
          Math.abs(travel - newTravel(QUOC_CA)),
          `nốt đầu đi ${travel.toFixed(3)} beat`,
        ).toBeLessThan(0.3);
      }
      expect(errors).toEqual([]);
    });
  });
}

test('Cửa sổ nổi (bản build): phần tử làm nóng DOM đợi CSS chép sang nạp xong rồi mới đặt, giữ ≥ 100 ms (D-440)', async ({
  page,
  context,
}) => {
  test.setTimeout(45_000);
  const errors = collectErrors(page);
  await presetSettings(page, { language: 'vi' });
  await page.goto(`/#/play/${QUOC_CA.id}`);
  const open = page
    .getByRole('complementary', { name: 'Công cụ màn chơi' })
    .getByRole('button', { name: 'Cửa sổ nổi', exact: true });
  await expect(open).toBeVisible();
  // Ghi `.glow-warmup` trong document cửa sổ nổi ngay khi requestWindow trả cửa sổ (trước khi app chép CSS + mount),
  // kèm: lúc thêm, mọi stylesheet chép sang đã nạp chưa.
  await page.evaluate(() => {
    type Log = [number, 'add' | 'remove', boolean][];
    const w = window as unknown as {
      documentPictureInPicture: { requestWindow: (o: unknown) => Promise<Window> };
      __pipWarm: Log;
    };
    const api = w.documentPictureInPicture;
    const orig = api.requestWindow.bind(api);
    w.__pipWarm = [];
    api.requestWindow = (o: unknown) =>
      orig(o).then((pw) => {
        const isWarm = (n: Node) =>
          n.nodeType === 1 && (n as Element).classList.contains('glow-warmup');
        const cssReady = () =>
          Array.from(pw.document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')).every(
            (l) => l.sheet !== null,
          );
        const MO = (pw as unknown as { MutationObserver: typeof MutationObserver })
          .MutationObserver;
        new MO((list) => {
          const now = performance.now();
          for (const m of list) {
            for (const n of Array.from(m.addedNodes)) {
              if (isWarm(n)) w.__pipWarm.push([now, 'add', cssReady()]);
            }
            for (const n of Array.from(m.removedNodes)) {
              if (isWarm(n)) w.__pipWarm.push([now, 'remove', false]);
            }
          }
        }).observe(pw.document, { subtree: true, childList: true });
        return pw;
      });
  });
  const pending = context.waitForEvent('page');
  await open.click();
  const pip = await pending;
  const pipErrors = collectErrors(pip);
  await expect(pip.getByRole('group', { name: 'Điều khiển cửa sổ nổi' })).toBeVisible();
  // Hết lượt làm nóng (CSS ~0,1 s + DOM_WARMUP_MS 0,7 s).
  await page.waitForTimeout(1500);
  const log = await page.evaluate(
    () => (window as unknown as { __pipWarm: [number, 'add' | 'remove', boolean][] }).__pipWarm,
  );
  const kept = expectWarmKept(log, 'Cửa sổ nổi');
  const keptText = Number.isFinite(kept) ? kept.toFixed(0) : 'chưa gỡ';
  test.info().annotations.push({
    type: 'pip-warm',
    description: `giữ ${keptText} ms; CSS đã nạp lúc đặt: ${String(log.find((w) => w[1] === 'add')?.[2])}`,
  });
  await expect(pip.locator('.glow-warmup')).toHaveCount(0);
  expect(errors).toEqual([]);
  expect(pipErrors).toEqual([]);
  await pip.close();
});

// ---------------------------------------------------------------------------
// 2. Overlay khớp game `fit=canvas`: khung = khung bảng phím PC
// ---------------------------------------------------------------------------

/** Đệm khung bảng phím PC mỗi bên 8 làn, theo bước cột (`GAME_FRAME_PAD`, src/player/layout.ts). */
const FRAME_PAD = 0.26;

for (const [vw, vh] of [
  [1920, 1080],
  [1280, 720],
] as const) {
  test(`overlay khớp game ${vw}×${vh} (fit=canvas): khung = khung bảng phím, ô ngoài cùng cách mép ≥ 0,25 bước, tâm ô = tâm phím`, async ({
    browser,
  }) => {
    test.setTimeout(45_000);
    const ctx = await browser.newContext({ viewport: { width: vw, height: vh } });
    await stubClipboard(ctx);
    const page = await ctx.newPage();
    const errors = collectErrors(page);
    await record(page, 'overlay-canvas', '.never-there');
    await page.goto(
      `/#/overlay?layout=game&fit=canvas&countin=1&delay=0&data=${encodeShareData(EDGE_SOURCE)}`,
    );
    const k = vw / 1920;
    const step = 65 * k;
    const box = await boxOf(page, '.overlay');
    // Khung bảng phím 553,8·k + gutter round(56·k) tại (683,1·k, 150·k).
    expect(Math.abs(box.x - (700 - FRAME_PAD * 65) * k)).toBeLessThanOrEqual(1);
    expect(Math.abs(box.width - (553.8 * k + Math.round(56 * k)))).toBeLessThanOrEqual(1);
    const frameLeft = box.x;
    const frameRight = box.x + box.width - Math.round(56 * k);
    // Tự chạy sau ~2 s chờ màn chơi; ghi ~3 s ô rơi.
    await expect(page.locator('.overlay')).toHaveAttribute('data-mode', 'standalone', {
      timeout: 6_000,
    });
    await page.waitForTimeout(3500);
    const rec = await recording(page);
    const frames = rec.frames.filter((f) => f.bg);
    expect(frames.length).toBeGreaterThan(30);
    const tiles = frames
      .flatMap((f) => f.r)
      .filter((r) => r[3] >= 3 && r[2] >= 0.5 * step && r[2] <= 0.95 * step && r[0] < frameRight);
    expect(tiles.length, 'không thấy ô nào').toBeGreaterThan(20);
    const keys = Array.from({ length: 8 }, (_, i) => (700 + 65 * (i + 0.5)) * k);
    // Bài kiểm mép có ô ở cả phím Z và phím `,` (hai làn ngoài cùng).
    for (const edge of [keys[0], keys[7]]) {
      expect(
        tiles.some((r) => Math.abs(r[0] + r[2] / 2 - edge) < 2),
        `không có ô ở làn x=${edge}`,
      ).toBe(true);
    }
    const minLeft = Math.min(...tiles.map((r) => r[0] - frameLeft));
    const minRight = Math.min(...tiles.map((r) => frameRight - (r[0] + r[2])));
    test.info().annotations.push({
      type: 'frame-gap',
      description: `${vw}×${vh}: trái ${minLeft.toFixed(1)} px, phải ${minRight.toFixed(1)} px (bước ${step.toFixed(1)})`,
    });
    expect(minLeft, 'ô ngoài cùng sát mép trái khung').toBeGreaterThanOrEqual(0.25 * step);
    expect(minRight, 'ô ngoài cùng sát mép phải khung (vạch gutter)').toBeGreaterThanOrEqual(
      0.25 * step,
    );
    for (const r of tiles) {
      const cx = r[0] + r[2] / 2;
      expect(
        Math.min(...keys.map((x) => Math.abs(x - cx))),
        `ô tâm x=${cx.toFixed(1)}`,
      ).toBeLessThan(1.6);
    }
    expect(errors).toEqual([]);
    await ctx.close();
  });
}

// ---------------------------------------------------------------------------
// 3. Kiểu Mobile: ô ngoài cùng không chạm mép
// ---------------------------------------------------------------------------

/** Khe nhỏ nhất (px) giữa ô đang rơi và hai mép trái / phải của `box` qua mọi khung. */
function edgeGaps(
  rec: Recording,
  box: { x: number; width: number },
): { left: number; right: number } {
  const frames = rec.frames.filter((f) => f.bg);
  expect(frames.length).toBeGreaterThan(30);
  const statics = staticKeys(frames);
  const tiles = frames.flatMap((f) => movingTiles(f, statics));
  expect(tiles.length, 'không thấy ô nào').toBeGreaterThan(20);
  // Có ô ở cả hai làn ngoài cùng (⅛ bề ngang mỗi bên) — không thì phép đo khe không nói gì.
  const cx = tiles.map((r) => r[0] + r[2] / 2 - box.x);
  expect(
    cx.some((c) => c < box.width / 8),
    'không có ô ở làn ngoài cùng bên trái',
  ).toBe(true);
  expect(
    cx.some((c) => c > (box.width * 7) / 8),
    'không có ô ở làn ngoài cùng bên phải',
  ).toBe(true);
  return {
    left: Math.min(...tiles.map((r) => r[0] - box.x)),
    right: Math.min(...tiles.map((r) => box.x + box.width - (r[0] + r[2]))),
  };
}

test.describe('kiểu Mobile: ô ngoài cùng không chạm mép', () => {
  test('màn chơi 844 × 390 (bàn nút): ô cách mép canvas ≥ 8 px', async ({ browser }) => {
    test.setTimeout(45_000);
    const ctx = await browser.newContext({
      viewport: { width: 844, height: 390 },
      hasTouch: true,
      isMobile: true,
    });
    await stubClipboard(ctx);
    const page = await ctx.newPage();
    const errors = collectErrors(page);
    await presetSettings(page, { language: 'vi', controlScheme: 'mobile', startDelaySec: 0 });
    await seedEdgeSong(page);
    await record(page, 'player-canvas', '.never-there');
    await page.goto(`/#/play/${EDGE_ID}`);
    await expect(page.getByRole('heading', { level: 1, name: 'Mép ngoài' })).toBeVisible();
    await page.waitForTimeout(800);
    await page.locator('button.transport-play').tap();
    await page.waitForTimeout(4000);
    await page.locator('button.transport-play').tap();
    const g = edgeGaps(await recording(page), await boxOf(page, 'canvas.player-canvas'));
    test
      .info()
      .annotations.push({ type: 'edge-gap', description: `màn chơi Mobile: ${JSON.stringify(g)}` });
    expect(g.left).toBeGreaterThanOrEqual(8);
    expect(g.right).toBeGreaterThanOrEqual(8);
    expect(errors).toEqual([]);
    await ctx.close();
  });

  test('overlay kiểu Mobile 1280 × 720 (fit=canvas): ô cách mép khung ≥ 5 px', async ({
    browser,
  }) => {
    test.setTimeout(45_000);
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    await stubClipboard(ctx);
    const page = await ctx.newPage();
    const errors = collectErrors(page);
    await record(page, 'overlay-canvas', '.never-there');
    await page.goto(
      `/#/overlay?layout=game&fit=canvas&scheme=mobile&countin=1&delay=0&data=${encodeShareData(EDGE_SOURCE)}`,
    );
    await expect(page.locator('.overlay')).toHaveAttribute('data-mode', 'standalone', {
      timeout: 6_000,
    });
    await page.waitForTimeout(3500);
    const g = edgeGaps(await recording(page), await boxOf(page, '.overlay'));
    test
      .info()
      .annotations.push({ type: 'edge-gap', description: `overlay Mobile: ${JSON.stringify(g)}` });
    expect(g.left).toBeGreaterThanOrEqual(5);
    expect(g.right).toBeGreaterThanOrEqual(5);
    expect(errors).toEqual([]);
    await ctx.close();
  });

  test.describe('trang mini "Khớp nút game" đúng tỉ lệ thật — màn 1371 × 633, cửa sổ 8 làn 1001 × 183', () => {
    test.use({
      viewport: { width: 1001, height: 183 },
      screen: { width: 1371, height: 633 },
      userAgent: ANDROID_UA,
      hasTouch: true,
      isMobile: true,
    });

    test('Rộng: vừa; ô ngoài cùng (rộng = Ø nút) cách mép cửa sổ ≥ 0,12 bước cột', async ({
      page,
    }) => {
      test.setTimeout(45_000);
      const errors = collectErrors(page);
      await presetSettings(page, { language: 'vi', controlScheme: 'mobile' });
      await seedEdgeSong(page);
      await record(page, 'mini-canvas', '.never-there');
      await page.goto(`/#/mini/${EDGE_ID}?delay=0`);
      const mini = page.locator('.mini');
      await expect(mini).toHaveAttribute('data-layout', 'game');
      await expect(mini).toHaveAttribute('data-scale', 'true');
      await expect(page.locator('.mini-fit-status')).toHaveAttribute('data-width', 'ok');
      await page.getByRole('button', { name: 'Bắt đầu' }).tap();
      await expect(mini).toHaveAttribute('data-phase', 'playing');
      await page.waitForTimeout(3000 + 2500);
      const step = 0.1975 * 633;
      const g = edgeGaps(await recording(page), await boxOf(page, 'canvas.mini-canvas'));
      test.info().annotations.push({
        type: 'edge-gap',
        description: `mini Khớp nút game: ${JSON.stringify(g)} (bước ${step.toFixed(1)})`,
      });
      // Lý tưởng (1 − 0,69) / 2 ≈ 0,155 bước ≈ 19 px; trước v1.0.1 (cửa sổ = hàng nút 962 px) ≈ 0.
      expect(g.left).toBeGreaterThanOrEqual(0.12 * step);
      expect(g.right).toBeGreaterThanOrEqual(0.12 * step);
      expect(errors).toEqual([]);
    });
  });
});

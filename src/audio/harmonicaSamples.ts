/**
 * Tiếng harmonica thật (góp ý 2026-10-19): mẫu thu từng nốt C3–D6 (midi 48–86) của soundfont FluidR3_GM, bản mp3
 * của gleitz/midi-js-soundfonts — CC BY 3.0, ghi công ở NOTICE (không thuộc giấy phép MIT của mã nguồn).
 * Tải + giải mã LƯỜI khi AudioEngine tạo AudioContext — tức chỉ khi người dùng bật âm thanh (D-421: âm thanh tắt
 * thì không đụng tới gì); file nằm trong bundle (cùng origin, không CDN), không vào precache của PWA. Chưa xong /
 * lỗi (offline lần đầu, trình duyệt không giải mã được) → synth cũ (synth.ts) phát thay.
 */
const URLS = import.meta.glob('./samples/harmonica/*.mp3', {
  query: '?url',
  import: 'default',
  eager: true,
}) as Record<string, string>;

/** Bộ mẫu đã giải mã của từng AudioContext. */
const banks = new WeakMap<BaseAudioContext, Map<number, AudioBuffer>>();
const loading = new WeakSet<BaseAudioContext>();

/** Danh sách [midi, url] của bộ mẫu (theo tên file `<midi>.mp3`). */
export function sampleUrls(): Array<[number, string]> {
  const out: Array<[number, string]> = [];
  for (const [path, url] of Object.entries(URLS)) {
    const midi = Number(/(\d+)\.mp3$/.exec(path)?.[1]);
    if (Number.isInteger(midi)) out.push([midi, url]);
  }
  return out.sort((a, b) => a[0] - b[0]);
}

/** Bắt đầu tải bộ mẫu cho `ctx` (một lần mỗi context). Không throw, không chờ. */
export function loadHarmonicaSamples(ctx: BaseAudioContext): void {
  if (banks.has(ctx) || loading.has(ctx)) return;
  if (typeof fetch !== 'function' || typeof ctx.decodeAudioData !== 'function') return;
  loading.add(ctx);
  const buffers = new Map<number, AudioBuffer>();
  const jobs = sampleUrls().map(async ([midi, url]) => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`sample ${midi}: HTTP ${res.status}`);
    buffers.set(midi, await ctx.decodeAudioData(await res.arrayBuffer()));
  });
  void Promise.allSettled(jobs).then(() => {
    loading.delete(ctx);
    if (buffers.size > 0) banks.set(ctx, buffers);
  });
}

/** Mẫu gần nhất cho `midi` + tốc độ phát để ra đúng cao độ; null = chưa có bộ mẫu (dùng synth). */
export function harmonicaSample(
  ctx: BaseAudioContext,
  midi: number,
): { buffer: AudioBuffer; rate: number } | null {
  const bank = banks.get(ctx);
  if (!bank || !Number.isFinite(midi)) return null;
  let best: number | null = null;
  for (const m of bank.keys()) {
    if (best === null || Math.abs(m - midi) < Math.abs(best - midi)) best = m;
  }
  const buffer = best === null ? undefined : bank.get(best);
  if (best === null || !buffer) return null;
  return { buffer, rate: Math.pow(2, (midi - best) / 12) };
}

/** Chỉ cho test: gắn sẵn bộ mẫu cho một context giả. */
export function setHarmonicaBankForTest(
  ctx: BaseAudioContext,
  bank: Map<number, AudioBuffer>,
): void {
  banks.set(ctx, bank);
}

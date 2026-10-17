// Sinh icon PWA (PNG) bằng pngjs: npm run icons
//   public/icons/icon-192.png, icon-512.png       — "any": ô bo góc nền tối, trong suốt ngoài góc
//   public/icons/icon-maskable-512.png             — "maskable": nền phủ kín, hình nằm trong vùng an toàn
//   public/icons/apple-touch-icon-180.png          — iOS tự bo góc: nền phủ kín, không trong suốt
// Hình vẽ khớp public/icons/icon.svg (viết tay, cùng hệ tọa độ 512 × 512): 4 lane, 4 ô rơi màu
// modifier của app (src/ui/palette.ts), hit line lõi trắng + glow xanh neon (Tactical HUD, docs/DESIGN.md). Khử răng cưa bằng khoảng cách có dấu (SDF)
// của hình chữ nhật bo góc — không cần thư viện vẽ. Kết quả xác định (chạy lại ra đúng byte cũ).
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');
const ART = 512;

const BG = '#0a0c0e';
const LANE = '#151b21';
const HIT_GLOW = '#0ff796';
const HIT = '#effff7';

/**
 * Hình trong hệ tọa độ 512 (giống icon.svg): [x0, y0, x1, y1, bán kính góc, màu, độ mờ].
 * Khung bao 48..464 × 68..444 — nằm giữa ô (lề 48–68).
 */
const LANES = [72, 168, 264, 360].map((x) => [x, 68, x + 80, 420, 16, LANE, 1]);
const TILES = [
  [72, 276, 152, 404, 16, '#e6e9ef', 1], // thường — sắp chạm hit line
  [168, 132, 248, 244, 16, '#2563eb', 1], // chuột trái
  [264, 196, 344, 340, 16, '#f97316', 1], // chuột phải
  [360, 76, 440, 180, 16, '#22c55e', 1], // scroll
];
const HIT_LINE = [
  [48, 412, 464, 444, 16, HIT_GLOW, 0.3],
  [56, 420, 456, 436, 8, HIT, 1],
];
const CONTENT = [...LANES, ...TILES, ...HIT_LINE];

/**
 * @typedef {{ name: string, size: number, bgRadius: number, scale: number }} IconSpec
 * bgRadius: bán kính góc nền (đơn vị 512; 0 = phủ kín); scale: tỉ lệ phần hình quanh tâm.
 * Maskable: vùng an toàn là hình tròn bán kính 40% (205) → góc khung bao (cách tâm ≈ 280) thu
 * còn 0.7 (≈ 196).
 */
/** @type {IconSpec[]} */
const ICONS = [
  { name: 'icon-192.png', size: 192, bgRadius: 104, scale: 1 },
  { name: 'icon-512.png', size: 512, bgRadius: 104, scale: 1 },
  { name: 'icon-maskable-512.png', size: 512, bgRadius: 0, scale: 0.7 },
  { name: 'apple-touch-icon-180.png', size: 180, bgRadius: 0, scale: 0.86 },
];

function hexToRgb(hex) {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Khoảng cách có dấu từ (px, py) tới hình chữ nhật bo góc (âm = bên trong). */
function sdRoundRect(px, py, x0, y0, x1, y1, r) {
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const qx = Math.abs(px - cx) - ((x1 - x0) / 2 - r);
  const qy = Math.abs(py - cy) - ((y1 - y0) / 2 - r);
  const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0));
  return outside + Math.min(Math.max(qx, qy), 0) - r;
}

/** Vẽ một icon; trả buffer PNG. */
function render({ size, bgRadius, scale }) {
  const unit = ART / size; // một pixel đầu ra = bao nhiêu đơn vị 512
  const c = ART / 2;
  // Phần hình: tọa độ art → art (thu quanh tâm).
  const content = CONTENT.map(([x0, y0, x1, y1, r, color, alpha]) => ({
    x0: c + (x0 - c) * scale,
    y0: c + (y0 - c) * scale,
    x1: c + (x1 - c) * scale,
    y1: c + (y1 - c) * scale,
    r: r * scale,
    rgb: hexToRgb(color),
    alpha,
  }));
  const shapes = [
    { x0: 0, y0: 0, x1: ART, y1: ART, r: bgRadius, rgb: hexToRgb(BG), alpha: 1 },
    ...content,
  ];

  const png = new PNG({ width: size, height: size });
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const px = (x + 0.5) * unit;
      const py = (y + 0.5) * unit;
      // Premultiplied alpha, ghép "over" từ dưới lên.
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (const s of shapes) {
        const d = sdRoundRect(px, py, s.x0, s.y0, s.x1, s.y1, s.r);
        const cover = Math.min(1, Math.max(0, 0.5 - d / unit)) * s.alpha;
        if (cover <= 0) continue;
        r = s.rgb[0] * cover + r * (1 - cover);
        g = s.rgb[1] * cover + g * (1 - cover);
        b = s.rgb[2] * cover + b * (1 - cover);
        a = cover + a * (1 - cover);
      }
      const i = (y * size + x) * 4;
      png.data[i] = a > 0 ? Math.round(r / a) : 0;
      png.data[i + 1] = a > 0 ? Math.round(g / a) : 0;
      png.data[i + 2] = a > 0 ? Math.round(b / a) : 0;
      png.data[i + 3] = Math.round(a * 255);
    }
  }
  return PNG.sync.write(png, { colorType: 6 });
}

mkdirSync(OUT_DIR, { recursive: true });
for (const spec of ICONS) {
  const buf = render(spec);
  writeFileSync(join(OUT_DIR, spec.name), buf);
  console.log(`${spec.name}  ${spec.size}×${spec.size}  ${(buf.length / 1024).toFixed(1)} KB`);
}

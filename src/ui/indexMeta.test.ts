import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Ô xem trước khi chia sẻ link (Open Graph, D-390): thẻ meta tĩnh trong index.html — URL production cố định,
 * ảnh = icon PWA có thật trong public/icons.
 */
const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '../..');
const html = readFileSync(join(root, 'index.html'), 'utf8');
const doc = new DOMParser().parseFromString(html, 'text/html');
const meta = (attr: 'property' | 'name', key: string): string | null =>
  doc.head.querySelector(`meta[${attr}="${key}"]`)?.getAttribute('content') ?? null;

const PROD = 'https://df-harmonica-tiles.vercel.app';

describe('index.html: thẻ xem trước khi chia sẻ link', () => {
  it('og:title / og:description / og:url / og:image (URL tuyệt đối của production) + twitter:card', () => {
    expect(meta('property', 'og:title')).toBe('Delta Force Harmonica Tiles');
    expect(meta('property', 'og:description')).toMatch(/harmonica/i);
    expect(meta('property', 'og:url')).toBe(`${PROD}/`);
    const image = meta('property', 'og:image');
    expect(image?.startsWith(`${PROD}/icons/`)).toBe(true);
    expect(meta('name', 'twitter:card')).toBe('summary');
  });

  it('ảnh og:image có thật trong public/ và đúng cỡ khai báo', () => {
    const image = meta('property', 'og:image') ?? '';
    const file = readFileSync(join(root, 'public', image.slice(PROD.length + 1)));
    // PNG: rộng / cao ở byte 16..23 của IHDR.
    expect(file.readUInt32BE(16)).toBe(Number(meta('property', 'og:image:width')));
    expect(file.readUInt32BE(20)).toBe(Number(meta('property', 'og:image:height')));
  });
});

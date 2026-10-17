/**
 * Nhãn modifier dạng hold trong `.harm` (spec mục 3, D-016).
 * Đọc khoan dung (hoa thường, mất dấu, viết tắt); ghi luôn nhãn tiếng Việt đầy đủ.
 */

/** Nút giữ: chuột trái (Cúi Xuống), chuột phải (Ngẩng Lên), scroll (Nửa Cung). */
export type HoldButton = 'left' | 'right' | 'scroll';
export type HoldAction = 'hold' | 'release';

export interface ModifierToken {
  action: HoldAction;
  button: HoldButton;
}

/** Nhãn chuẩn mà serializer ghi ra (có ngoặc vuông). */
export const HOLD_LABELS: Readonly<Record<HoldButton, Readonly<Record<HoldAction, string>>>> = {
  left: { hold: '[giữ chuột trái]', release: '[thả chuột trái]' },
  right: { hold: '[giữ chuột phải]', release: '[thả chuột phải]' },
  scroll: { hold: '[giữ scroll]', release: '[thả scroll]' },
};

/** Viết tắt chuẩn (không ngoặc) — `[L]` `[/L]` … */
export const HOLD_ABBREVIATIONS: Readonly<
  Record<HoldButton, Readonly<Record<HoldAction, string>>>
> = {
  left: { hold: 'L', release: '/L' },
  right: { hold: 'R', release: '/R' },
  scroll: { hold: 'S', release: '/S' },
};

/** trim, chữ thường, bỏ dấu (NFD + bỏ combining mark), đ → d, gộp khoảng trắng. */
export function normalizeModifierText(inner: string): string {
  return inner
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/đ/g, 'd')
    .replace(/\s+/g, ' ');
}

const LOOKUP: ReadonlyMap<string, ModifierToken> = new Map<string, ModifierToken>([
  ['giu chuot trai', { action: 'hold', button: 'left' }],
  ['l', { action: 'hold', button: 'left' }],
  ['tha chuot trai', { action: 'release', button: 'left' }],
  ['/l', { action: 'release', button: 'left' }],
  ['giu chuot phai', { action: 'hold', button: 'right' }],
  ['r', { action: 'hold', button: 'right' }],
  ['tha chuot phai', { action: 'release', button: 'right' }],
  ['/r', { action: 'release', button: 'right' }],
  ['giu scroll', { action: 'hold', button: 'scroll' }],
  ['s', { action: 'hold', button: 'scroll' }],
  ['tha scroll', { action: 'release', button: 'scroll' }],
  ['/s', { action: 'release', button: 'scroll' }],
]);

/** Nội dung bên trong `[...]` → modifier, hoặc null nếu không nhận ra. */
export function parseModifierLabel(inner: string): ModifierToken | null {
  const hit = LOOKUP.get(normalizeModifierText(inner));
  return hit ? { action: hit.action, button: hit.button } : null;
}

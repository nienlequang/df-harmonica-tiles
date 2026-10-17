import quocCaVietNam from './seeds/quoc-ca-viet-nam.harm?raw';
import jiMoDeRen from './seeds/ji-mo-de-ren.harm?raw';
import takediskrush from './seeds/takediskrush.harm?raw';
import saoMinhChuaNamTayNhau from './seeds/sao-minh-chua-nam-tay-nhau.harm?raw';

/**
 * Bài mẫu bundle trong code (spec mục 10). Thêm bài: tạo `seeds/<slug>.harm`,
 * import `?raw` ở đây với id `seed-<slug>` (xem CLAUDE.md).
 *
 * Góp ý 2026-10-16 (round 6): hai bài người dùng tự tạo trong app ("Quốc ca Việt Nam", "TAKEDISKRUSH!",
 * chép nguyên byte từ trình duyệt của người dùng) là hai bài mẫu duy nhất, đứng ĐẦU thư viện. Test cần bài dài
 * nhiều đoạn dùng hai bài tự soạn ở `src/test/fixtures/` (app không import).
 *
 * v1.0.2: thêm "寂寞的人伤心的歌" (龙梅子、杨海彪) — chuyển từ cảm âm bằng `convertPasted` của app, đứng SAU hai bài trên.
 * v1.0.3: thêm "Sao Mình Chưa Nắm Tay Nhau" (Yan Nguyễn) — chủ dự án gửi sẵn dạng .harm, đứng cuối.
 * Bài mẫu là bản ký âm giai điệu để minh họa; bản quyền tác phẩm thuộc tác giả (LICENSE → NOTICE).
 */
export type SeedId =
  | 'seed-quoc-ca-viet-nam'
  | 'seed-takediskrush'
  | 'seed-ji-mo-de-ren'
  | 'seed-sao-minh-chua-nam-tay-nhau';

export interface SeedSong {
  readonly id: SeedId;
  readonly source: string;
}

/** Thứ tự cố định: hiển thị đầu thư viện theo đúng thứ tự này. */
export const SEED_SONGS: readonly SeedSong[] = [
  { id: 'seed-quoc-ca-viet-nam', source: quocCaVietNam },
  { id: 'seed-takediskrush', source: takediskrush },
  { id: 'seed-ji-mo-de-ren', source: jiMoDeRen },
  { id: 'seed-sao-minh-chua-nam-tay-nhau', source: saoMinhChuaNamTayNhau },
];

const SEED_IDS: ReadonlySet<string> = new Set(SEED_SONGS.map((s) => s.id));

export function isSeedId(id: string): id is SeedId {
  return SEED_IDS.has(id);
}

export function getSeed(id: string): SeedSong | null {
  return SEED_SONGS.find((s) => s.id === id) ?? null;
}

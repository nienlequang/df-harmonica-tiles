/**
 * Thông tin bản build cho trang Dev notes (`#/dev`, vòng 7 — R7-8): phiên bản (package.json), commit ngắn và thời
 * điểm build, do Vite `define` chèn lúc build (vite.config.ts; bản deploy Vercel nhận commit qua
 * scripts/deploy.mjs). Thiếu (test, công cụ không qua Vite) → '' = "không rõ".
 */
export interface BuildInfo {
  /** `version` của package.json, vd. `0.1.0`. */
  version: string;
  /** Commit ngắn (`abc1234`, `-dirty` = có thay đổi chưa commit); '' = không rõ. */
  commit: string;
  /** Thời điểm build, ISO 8601 (UTC); '' = không rõ. */
  builtAt: string;
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

export const BUILD_INFO: BuildInfo = {
  version: str(typeof __APP_VERSION__ === 'undefined' ? undefined : __APP_VERSION__),
  commit: str(typeof __BUILD_COMMIT__ === 'undefined' ? undefined : __BUILD_COMMIT__),
  builtAt: str(typeof __BUILD_DATE__ === 'undefined' ? undefined : __BUILD_DATE__),
};

/** ISO 8601 → `YYYY-MM-DD HH:MM UTC` (không phụ thuộc múi giờ của máy); rỗng / sai → ''. */
export function formatBuildDate(iso: string): string {
  if (iso === '') return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

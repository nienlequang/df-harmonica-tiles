/// <reference types="vite/client" />

declare const __APP_VERSION__: string;
declare const __SINGLE_FILE__: boolean;
/** Commit ngắn của bản build (`abc1234`, thêm `-dirty` nếu có thay đổi chưa commit); '' = không rõ. */
declare const __BUILD_COMMIT__: string;
/** Thời điểm build (ISO 8601, UTC); '' = không rõ. */
declare const __BUILD_DATE__: string;

import { PlayerView } from '../player/PlayerView';
import { DEMO_SONG_ID } from './demoSong';

/**
 * Route `#/` — CHÍNH LÀ màn chơi đầy đủ (góp ý 2026-10-15 B: bỏ màn "chơi thử" chung chung + menu ☰),
 * đang mở bài mẫu `DEMO_SONG_ID`. Khác `#/play/<id>` duy nhất ở chỗ nút "Về màn chơi" của các trang khác
 * quay lại `#/` (lastPlayed.ts) khi người dùng chưa mở bài nào khác.
 */
export function HomeView() {
  return <PlayerView songId={DEMO_SONG_ID} home />;
}

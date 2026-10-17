/**
 * Mở khóa AudioContext ngay trong cú bấm BẬT một tiếng ở ngoài màn chơi (Cài đặt → Âm thanh: "Tôi hiểu, bật" của giai
 * điệu mẫu, tiếng click, tiếng khi bấm — D-423): Safari / iOS chỉ cho resume() trong user gesture, nên lần Phát đầu ở
 * màn chơi đã có context chạy sẵn, không phải chờ. Không giữ phiên "playback" của iPhone (không có chỗ trả ở đây —
 * màn chơi giữ phiên trong cú bấm Phát / nút loa của nó và trả khi rời màn chơi). Không hỗ trợ Web Audio → không làm
 * gì; không bao giờ throw. Chỉ gọi khi người dùng vừa bật tiếng — mặc định app không đụng tới âm thanh.
 */
import { getAudioEngine, isAudioSupported } from './engine';

export function unlockAudioInGesture(): void {
  if (!isAudioSupported()) return;
  try {
    void getAudioEngine()
      .unlock()
      .catch(() => false);
  } catch {
    // không quan trọng: lần Phát sau tự mở khóa
  }
}

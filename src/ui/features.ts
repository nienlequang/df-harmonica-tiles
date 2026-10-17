/**
 * Cờ tính năng theo phase (DECISIONS D-060).
 *
 * Tính năng chưa làm xong thì ẩn MỌI lối vào trong UI (nút, link, gợi ý trong thông báo) và
 * route của nó hiện trang "sắp có" (App.tsx) thay cho view placeholder. Phase làm xong tính năng
 * thì bật cờ ở đây — mọi chỗ đọc cờ tự hiện lại lối vào.
 */
export interface Features {
  /** Phase 2: Editor (`#/edit/:id`) — link "hoặc tự gõ từ đầu" (`#/ai`), link "Sửa", "Mở trình soạn". */
  editor: boolean;
  /** Phase 2: mở bài chia sẻ (`#/s/<lz-string>`). */
  share: boolean;
  /** Phase 2b: tạo bài từ MIDI (`#/midi`) — nút "Tạo bài từ MIDI". */
  midiImport: boolean;
}

export const FEATURES: Readonly<Features> = {
  editor: true,
  share: true,
  midiImport: true,
};

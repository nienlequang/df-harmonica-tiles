import { tNow } from '../i18n/useT';
import { newSongTemplate } from '../library/songSource';
import { openDraftSong } from '../library/store';

/**
 * Nguồn `.harm` của bài trống "hoặc tự gõ từ đầu" ở trang "Tạo bài với AI" (trước là "Tạo bài mới thủ công" ở
 * Thư viện — góp ý 2026-10-16): template + chuỗi `library.newSong*` theo ngôn ngữ.
 */
export function newSongSource(): string {
  return newSongTemplate({
    title: tNow('library.newSongTitle'),
    section: tNow('library.newSongSection'),
    comment: tNow('library.newSongComment'),
  });
}

/**
 * "Hoặc tự gõ từ đầu": mở template thành BẢN NHÁP (`openDraftSong`, góp ý 2026-10-15 C) — chưa vào
 * Thư viện cho tới khi người dùng Lưu trong Editor. Trả id bản nháp (nơi gọi mở Editor của nó).
 */
export function createNewSong(): string {
  return openDraftSong(newSongSource());
}

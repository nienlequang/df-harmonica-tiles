import { useSyncExternalStore } from 'react';
import { DEMO_SONG_ID } from '../home/demoSong';
import { draftSavedAs, entryTitle, getSong, useLibrary } from '../library/store';
import { paths } from './router';

/**
 * "Bài vừa mở ở màn chơi" trong phiên này (góp ý 2026-10-15 A): trên mọi trang có thanh điều hướng,
 * tên app ở góc trên trái thành nút "◂ Về màn chơi" → `#/play/<id>` của bài người dùng mở ở Player gần
 * nhất (còn tồn tại), không có thì `#/` (màn chơi với bài mẫu).
 *
 * Lưu ở sessionStorage (mỗi tab một phiên, đóng tab là quên); bị chặn (private mode, iframe…) thì chỉ
 * nhớ trong bộ nhớ. `null` = màn chơi mặc định `#/` (bài mẫu).
 */
export const LAST_PLAYED_KEY = 'dfht-last-played';

let memory: string | null = null;
const listeners = new Set<() => void>();

function readStorage(): string | null {
  try {
    const v = window.sessionStorage.getItem(LAST_PLAYED_KEY);
    return v !== null && v !== '' ? v : null;
  } catch {
    return memory;
  }
}

/** Ghi nhớ bài vừa mở ở Player; `null` = màn chơi mặc định (`#/`). Không đổi thì không báo ai. */
export function rememberLastPlayed(id: string | null): void {
  if (readStorage() === id && memory === id) return;
  memory = id;
  try {
    if (id === null) window.sessionStorage.removeItem(LAST_PLAYED_KEY);
    else window.sessionStorage.setItem(LAST_PLAYED_KEY, id);
  } catch {
    // sessionStorage bị chặn: giữ trong bộ nhớ (`memory`).
  }
  for (const cb of Array.from(listeners)) cb();
}

/** Id bài đã nhớ (chưa kiểm tra còn tồn tại không); null = chưa có / màn chơi mặc định. */
export function readLastPlayed(): string | null {
  return readStorage();
}

export interface PlayerTarget {
  /** Đường dẫn (dùng với `href`): `/play/<id>` hoặc `/`. */
  path: string;
  /** Id bài sẽ hiện ở màn chơi (bài mẫu khi về `#/`). */
  songId: string;
}

/**
 * Đích của nút "Về màn chơi": bài nhớ được còn tồn tại (bài mẫu, bài trong thư viện hoặc bài tạm của
 * link chia sẻ đang mở) → `/play/<id>`; không thì `/` (bài mẫu).
 */
export function backToPlayerTarget(
  last: string | null,
  exists: (id: string) => boolean,
): PlayerTarget {
  if (last !== null && exists(last)) return { path: paths.play(last), songId: last };
  return { path: paths.home(), songId: DEMO_SONG_ID };
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/**
 * Id bài thật mà id đã nhớ trỏ tới: bản nháp đã được Lưu thành bài thư viện (`draftSavedAs`) → bài đã
 * lưu (bản nháp trong bộ nhớ vẫn giữ nội dung CŨ lúc phát — không được mở lại nó); còn lại giữ nguyên.
 */
export function resolvePlayedId(id: string): string {
  return draftSavedAs(id) ?? id;
}

/**
 * Hook cho nút "Về màn chơi": đích + tên bài (tooltip / aria). Re-render khi bài nhớ đổi hoặc thư viện
 * đổi (bài bị xóa → về `#/`, đổi tên → tooltip mới, bản nháp vừa được Lưu → bài đã lưu).
 */
export function useBackToPlayer(): PlayerTarget & { title: string } {
  const last = useSyncExternalStore(subscribe, readStorage, readStorage);
  // Selector trả chuỗi / null (so theo giá trị): tính lại mỗi khi thư viện / bài tạm đổi — lần Lưu bản
  // nháp thêm bài vào thư viện nên selector chạy lại và thấy `draftSavedAs`.
  const resolved = useLibrary(() => {
    if (last === null) return null;
    const id = resolvePlayedId(last);
    return getSong(id) !== null ? id : null;
  });
  const target = backToPlayerTarget(resolved, () => true);
  const title = useLibrary(() => {
    const entry = getSong(target.songId);
    return entry ? entryTitle(entry) : '';
  });
  return { ...target, title };
}

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { PersistStorage, StorageValue } from 'zustand/middleware';
import { parseHarm } from '../core/parser';
import type { ParseResult } from '../core/types';
import { DEFAULT_BPM, DEFAULT_TIME_SIG } from '../core/types';
import { tNow } from '../i18n/useT';
import { createGuardedStorage } from '../ui/storage';
import { toast } from '../ui/toast';
import { SEED_SONGS, isSeedId } from './seeds';
import { getDirective, setTitleInSource } from './songSource';

/**
 * Thư viện bài hát: seed (bundle, chỉ đọc) + bài user (localStorage, zustand persist
 * có version + migrate — DECISIONS D-031). Bài user lưu dạng văn bản nguồn `.harm` (D-010).
 */

export interface StoredSong {
  id: string;
  source: string;
  createdAt: number;
  updatedAt: number;
}

export interface LibraryState {
  songs: StoredSong[];
}

export interface LibraryActions {
  /** Thêm bài user, trả về id mới. */
  addSong: (source: string) => string;
  /** Sửa nguồn bài user. false nếu không có / là seed. */
  updateSong: (id: string, source: string) => boolean;
  /** Xóa bài user. Seed không xóa được → false. */
  removeSong: (id: string) => boolean;
  /** Nhân bản (seed hoặc user), đổi title thành "<title> (bản sao)". '' nếu không có id. */
  duplicateSong: (id: string) => string;
  /** Thêm nhiều bài (bỏ nguồn rỗng), trả về các id mới theo thứ tự. */
  importSongs: (sources: string[]) => string[];
}

/**
 * Bài tạm (mở từ link chia sẻ bằng "Phát"): chỉ sống trong bộ nhớ, getSong/useSong thấy được,
 * KHÔNG persist (partialize chỉ lấy `songs`) và KHÔNG có trong listSongs.
 */
export interface TransientState {
  transient: Readonly<Record<string, StoredSong>>;
}

export type LibraryStore = LibraryState & LibraryActions & TransientState;

/** Bài đã tra cứu (seed hoặc user) kèm kết quả parse (cache). */
export interface LibraryEntry {
  id: string;
  source: string;
  seed: boolean;
  parsed: ParseResult;
  /** Seed = 0. */
  updatedAt: number;
}

export const LIBRARY_STORAGE_KEY = 'dfht-library';
export const LIBRARY_VERSION = 1;

// ---------------------------------------------------------------------------
// id + migrate
// ---------------------------------------------------------------------------

let fallbackCounter = 0;

/** id mới cho bài user (UUID, fallback khi không có crypto.randomUUID — vd. http thường). */
export function newSongId(): string {
  try {
    const c: Crypto | undefined = globalThis.crypto;
    if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  } catch {
    // fallback bên dưới
  }
  fallbackCounter += 1;
  const rand = Math.random().toString(36).slice(2, 10);
  return `u-${Date.now().toString(36)}-${fallbackCounter.toString(36)}-${rand}`;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function finiteTime(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null;
}

function pickString(r: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const k of keys) {
    const v = r[k];
    if (typeof v === 'string') return v;
  }
  return null;
}

type CleanEntry = Omit<StoredSong, 'id'> & { id: string | null };

function sanitizeEntry(raw: unknown, legacy: boolean, now: number): CleanEntry | null {
  if (typeof raw === 'string') {
    return raw.trim() ? { id: null, source: raw, createdAt: now, updatedAt: now } : null;
  }
  if (!isRecord(raw)) return null;
  // v0 dùng `text`, v1 dùng `source` — nhận cả hai, ưu tiên theo version.
  let source = pickString(raw, legacy ? ['text', 'source'] : ['source', 'text']);
  if (source === null || !source.trim()) return null;
  const title = typeof raw.title === 'string' ? raw.title.trim() : '';
  if (title && getDirective(source, 'title') === null) source = setTitleInSource(source, title);

  let id: string | null = null;
  if (typeof raw.id === 'string' && raw.id.trim()) id = raw.id.trim();
  else if (typeof raw.id === 'number' && Number.isFinite(raw.id)) id = String(raw.id);

  const createdAt = finiteTime(raw.createdAt) ?? finiteTime(raw.updatedAt) ?? now;
  const updatedAt = finiteTime(raw.updatedAt) ?? createdAt;
  return { id, source, createdAt, updatedAt };
}

/**
 * Chuyển dữ liệu persist bất kỳ về state hiện tại (hàm thuần, có test).
 * - v0 (legacy): mảng `{ id?, text? | source?, title? }` hoặc `{ songs: [...] }`.
 * - v1: `{ songs: StoredSong[] }` (vẫn được làm sạch).
 * Entry hỏng bị bỏ; thiếu id/timestamp thì sinh mới; id trùng hoặc trùng seed → id mới.
 * Rác → `{ songs: [] }`.
 */
export function migrateLibrary(persisted: unknown, fromVersion: number): LibraryState {
  const legacy = !(fromVersion >= 1);
  let list: unknown[] = [];
  if (Array.isArray(persisted)) list = persisted;
  else if (isRecord(persisted) && Array.isArray(persisted.songs)) list = persisted.songs;

  const now = Date.now();
  const seen = new Set<string>();
  const songs: StoredSong[] = [];
  for (const raw of list) {
    const e = sanitizeEntry(raw, legacy, now);
    if (!e) continue;
    let id = e.id;
    if (id === null || seen.has(id) || isSeedId(id)) id = newSongId();
    seen.add(id);
    songs.push({ id, source: e.source, createdAt: e.createdAt, updatedAt: e.updatedAt });
  }
  return { songs };
}

// ---------------------------------------------------------------------------
// storage
// ---------------------------------------------------------------------------

/**
 * Đọc giá trị đã lưu. Dữ liệu cũ ghi thẳng (không có wrapper `{ state, version }` của
 * persist) được coi là version 0 để đi qua migrate. JSON hỏng → null (thư viện rỗng).
 */
export function decodeStoredLibrary(text: string | null): StorageValue<LibraryState> | null {
  if (text === null) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  // `state` chưa được kiểm: migrate/merge sẽ làm sạch.
  if (isRecord(raw) && 'state' in raw) {
    const version = typeof raw.version === 'number' ? raw.version : 0;
    return { state: raw.state as LibraryState, version };
  }
  return { state: raw as LibraryState, version: 0 };
}

/** Quota đầy / storage bị chặn: không làm hỏng thao tác trong bộ nhớ, báo toast (D-065). */
function createLibraryStorage(): PersistStorage<LibraryState> {
  return createGuardedStorage<LibraryState>({
    tag: 'library',
    decode: decodeStoredLibrary,
    onSaveError: () => toast(tNow('library.saveFailed'), 'error'),
  });
}

// ---------------------------------------------------------------------------
// store
// ---------------------------------------------------------------------------

function sourceTitle(source: string): string {
  return (getDirective(source, 'title') ?? '').trim();
}

/** Tra bài tạm (chỉ key riêng của map — id như '__proto__' không trúng prototype). */
function transientOf(map: TransientState['transient'], id: string): StoredSong | null {
  return Object.hasOwn(map, id) ? (map[id] ?? null) : null;
}

export const useLibrary = create<LibraryStore>()(
  persist(
    (set, get) => {
      const findAny = (id: string): { source: string } | null =>
        SEED_SONGS.find((s) => s.id === id) ??
        get().songs.find((s) => s.id === id) ??
        transientOf(get().transient, id);

      const insert = (sources: string[]): string[] => {
        const now = Date.now();
        const fresh: StoredSong[] = sources
          .filter((src) => src.trim().length > 0)
          .map((source) => ({ id: newSongId(), source, createdAt: now, updatedAt: now }));
        if (fresh.length > 0) set((s) => ({ songs: [...s.songs, ...fresh] }));
        return fresh.map((s) => s.id);
      };

      return {
        songs: [],
        transient: {},
        addSong: (source) => {
          const now = Date.now();
          const song: StoredSong = { id: newSongId(), source, createdAt: now, updatedAt: now };
          set((s) => ({ songs: [...s.songs, song] }));
          return song.id;
        },
        updateSong: (id, source) => {
          if (isSeedId(id)) return false;
          const current = get().songs.find((s) => s.id === id);
          if (!current) return false;
          if (current.source === source) return true;
          // updatedAt luôn tăng để thứ tự "mới sửa" ổn định khi sửa nhanh liên tiếp.
          const updatedAt = Math.max(Date.now(), current.updatedAt + 1);
          set((s) => ({
            songs: s.songs.map((x) => (x.id === id ? { ...x, source, updatedAt } : x)),
          }));
          return true;
        },
        removeSong: (id) => {
          if (isSeedId(id)) return false;
          if (!get().songs.some((s) => s.id === id)) return false;
          set((s) => ({ songs: s.songs.filter((x) => x.id !== id) }));
          return true;
        },
        duplicateSong: (id) => {
          const src = findAny(id);
          if (!src) return '';
          const title = sourceTitle(src.source) || tNow('common.untitled');
          const source = setTitleInSource(src.source, tNow('library.copyTitle', { title }));
          return insert([source])[0] ?? '';
        },
        importSongs: (sources) => insert(sources),
      };
    },
    {
      name: LIBRARY_STORAGE_KEY,
      version: LIBRARY_VERSION,
      storage: createLibraryStorage(),
      partialize: (s): LibraryState => ({ songs: s.songs }),
      migrate: (persisted, version) => migrateLibrary(persisted, version),
      // Luôn làm sạch (kể cả khi version khớp). Không có dữ liệu → giữ state hiện tại.
      merge: (persisted, current) =>
        persisted === undefined
          ? current
          : { ...current, songs: migrateLibrary(persisted, LIBRARY_VERSION).songs },
    },
  ),
);

// ---------------------------------------------------------------------------
// lookup + parse cache
// ---------------------------------------------------------------------------

const PARSE_CACHE_LIMIT = 50;
const parseCache = new Map<string, ParseResult>();
// Entry ổn định theo tham chiếu (StoredSong bất biến) → selector zustand không loop.
let entryCache = new WeakMap<StoredSong, LibraryEntry>();
let seedEntries: LibraryEntry[] | null = null;
let listCacheSongs: readonly StoredSong[] | null = null;
let listCache: LibraryEntry[] = [];

/** Kết quả khi parser throw (không bao giờ nên xảy ra): bài rỗng, ok = false. */
function fallbackParse(id: string, source: string): ParseResult {
  const artist = getDirective(source, 'artist');
  return {
    song: {
      id,
      title: sourceTitle(source),
      ...(artist ? { artist } : {}),
      bpm: DEFAULT_BPM,
      timeSig: { ...DEFAULT_TIME_SIG },
      scrollDir: 1,
      sections: [],
    },
    diagnostics: [],
    lineOrigins: [],
    lineSpans: [],
    unitSpans: [],
    ok: false,
  };
}

/**
 * Parse có cache (LRU ~50) theo (id, source) để re-render không parse lại.
 * id nằm trong key vì `song.id` = id của bài.
 */
export function parseSongSource(id: string, source: string): ParseResult {
  const key = `${id}\u0000${source}`;
  const hit = parseCache.get(key);
  if (hit) {
    parseCache.delete(key);
    parseCache.set(key, hit);
    return hit;
  }
  let result: ParseResult;
  try {
    result = parseHarm(source, { id });
  } catch (e) {
    console.error('[library] parseHarm threw', e);
    result = fallbackParse(id, source);
  }
  parseCache.set(key, result);
  while (parseCache.size > PARSE_CACHE_LIMIT) {
    const oldest = parseCache.keys().next();
    if (oldest.done) break;
    parseCache.delete(oldest.value);
  }
  return result;
}

/** Xóa mọi cache parse/entry (test, hoặc khi đổi parser lúc dev). */
export function clearParseCache(): void {
  parseCache.clear();
  entryCache = new WeakMap();
  seedEntries = null;
  listCacheSongs = null;
  listCache = [];
}

function getSeedEntries(): LibraryEntry[] {
  // Parse lười: không parse lúc import module.
  if (!seedEntries) {
    seedEntries = SEED_SONGS.map((s) => ({
      id: s.id,
      source: s.source,
      seed: true,
      parsed: parseSongSource(s.id, s.source),
      updatedAt: 0,
    }));
  }
  return seedEntries;
}

function userEntry(stored: StoredSong): LibraryEntry {
  let e = entryCache.get(stored);
  if (!e) {
    e = {
      id: stored.id,
      source: stored.source,
      seed: false,
      parsed: parseSongSource(stored.id, stored.source),
      updatedAt: stored.updatedAt,
    };
    entryCache.set(stored, e);
  }
  return e;
}

function findEntry(
  songs: readonly StoredSong[],
  id: string,
  transient: TransientState['transient'] = {},
): LibraryEntry | null {
  if (isSeedId(id)) return getSeedEntries().find((e) => e.id === id) ?? null;
  const stored = songs.find((s) => s.id === id) ?? transientOf(transient, id);
  return stored ? userEntry(stored) : null;
}

function entriesOf(songs: readonly StoredSong[]): LibraryEntry[] {
  if (songs !== listCacheSongs || seedEntries === null) {
    // Cùng timestamp (thêm trong cùng ms) → bài thêm sau (cuối mảng) lên trước.
    const user = songs
      .map((song, index) => ({ song, index }))
      .sort(
        (a, b) =>
          b.song.updatedAt - a.song.updatedAt ||
          b.song.createdAt - a.song.createdAt ||
          b.index - a.index,
      )
      .map((x) => userEntry(x.song));
    listCache = [...getSeedEntries(), ...user];
    listCacheSongs = songs;
  }
  return listCache;
}

/** Tra bài theo id (seed, user hoặc bài tạm). */
export function getSong(id: string): LibraryEntry | null {
  const s = useLibrary.getState();
  return findEntry(s.songs, id, s.transient);
}

/** Seed trước (thứ tự cố định), rồi bài user mới sửa trước. Mảng ổn định khi không đổi. */
export function listSongs(): LibraryEntry[] {
  return entriesOf(useLibrary.getState().songs);
}

/** Hook: bài theo id (seed, user hoặc bài tạm), re-render khi bài đó đổi. */
export function useSong(id: string): LibraryEntry | null {
  return useLibrary((s) => findEntry(s.songs, id, s.transient));
}

// ---------------------------------------------------------------------------
// bài tạm (link chia sẻ → "Phát")
// ---------------------------------------------------------------------------

export const TRANSIENT_ID_PREFIX = 'shared-';

/** FNV-1a 32 bit trên code unit UTF-16 → base36 (ngắn, ổn định theo nội dung). */
function shortHash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/**
 * Mở nguồn `.harm` thành bài tạm, trả id `shared-<hash>`. Cùng nội dung → cùng id (mở lại link
 * không nhân bản). Bài tạm thấy được qua getSong/useSong (Player) nhưng không lưu localStorage,
 * không có trong listSongs, mất khi tải lại trang. Trùng hash khác nội dung → thêm hậu tố `-2`…
 */
export function openTransientSong(source: string): string {
  const map = useLibrary.getState().transient;
  const base = `${TRANSIENT_ID_PREFIX}${shortHash(source)}`;
  let id = base;
  for (let n = 2; ; n++) {
    const existing = transientOf(map, id);
    if (!existing) break;
    if (existing.source === source) return id;
    id = `${base}-${n}`;
  }
  const now = Date.now();
  const song: StoredSong = { id, source, createdAt: now, updatedAt: now };
  useLibrary.setState((s) => ({ transient: { ...s.transient, [id]: song } }));
  return id;
}

/** true nếu id là bài tạm (link chia sẻ hoặc bản nháp) đang mở, không phải bài trong thư viện. */
export function isTransientSong(id: string): boolean {
  const s = useLibrary.getState();
  return (
    !isSeedId(id) && !s.songs.some((x) => x.id === id) && transientOf(s.transient, id) !== null
  );
}

/** Bỏ mọi bài tạm và bản nháp (test). */
export function clearTransientSongs(): void {
  savedDrafts.clear();
  useLibrary.setState({ transient: {} });
}

/**
 * Bài đã lưu từ link chia sẻ trong phiên này: nội dung link → id trong thư viện. Sống ở module để rời
 * trang rồi Back về (thẻ chia sẻ, màn chơi của bài tạm) vẫn biết đã lưu, kể cả khi bản đã lưu được sửa
 * sau đó (D-106).
 */
const savedFromShare = new Map<string, string>();

/** Quên các bài đã lưu từ link (test). */
export function resetSavedShares(): void {
  savedFromShare.clear();
}

/**
 * id bài trong thư viện ứng với nội dung link chia sẻ: bản đã lưu từ link này (còn trong thư viện),
 * không thì bài có đúng nội dung đó (đã lưu / nhập trước đây). null = chưa có.
 */
export function sharedSavedId(songs: readonly StoredSong[], source: string): string | null {
  const remembered = savedFromShare.get(source);
  if (remembered !== undefined && songs.some((s) => s.id === remembered)) return remembered;
  return songs.find((s) => s.source === source)?.id ?? null;
}

/**
 * Lưu nội dung link chia sẻ vào thư viện MỘT lần (thẻ chia sẻ "Lưu vào thư viện" và nút cùng tên trên
 * màn chơi của bài tạm): đã có → trả bài đó (`created` false), không nhân bản.
 */
export function saveSharedSong(source: string): { id: string; created: boolean } {
  const lib = useLibrary.getState();
  const existing = sharedSavedId(lib.songs, source);
  if (existing !== null) return { id: existing, created: false };
  const id = lib.addSong(source);
  savedFromShare.set(source, id);
  return { id, created: true };
}

// ---------------------------------------------------------------------------
// bản nháp (Tạo bài với AI → Mở trong Editor / tự gõ từ đầu, Tạo bài từ file, Tự chơi để tạo bài → Editor)
// ---------------------------------------------------------------------------

/**
 * Bài vừa tạo mở trong Editor dưới dạng NHÁP (góp ý 2026-10-15 C): nằm trong map bài tạm (không
 * persist, không có trong listSongs — Thư viện không thấy), id `draft-<uuid>`. Editor coi bản nháp là
 * sửa được (không chỉ đọc như bài mẫu / link chia sẻ); chỉ khi người dùng Lưu thì mới thành bài thư
 * viện (`saveDraftSong`). Bản nháp sống tới khi tải lại trang (Back về `#/edit/draft-…` vẫn mở được).
 */
export const DRAFT_ID_PREFIX = 'draft-';

/** id bản nháp → id bài thư viện sau lần Lưu đầu (Lưu lại = cập nhật bài đó, không nhân bản). */
const savedDrafts = new Map<string, string>();

/** Mở nguồn `.harm` thành bản nháp mới (mỗi lần một id mới), trả id. */
export function openDraftSong(source: string): string {
  const map = useLibrary.getState().transient;
  let id = `${DRAFT_ID_PREFIX}${newSongId()}`;
  while (transientOf(map, id)) id = `${DRAFT_ID_PREFIX}${newSongId()}`;
  const now = Date.now();
  const song: StoredSong = { id, source, createdAt: now, updatedAt: now };
  useLibrary.setState((s) => ({ transient: { ...s.transient, [id]: song } }));
  return id;
}

/** true nếu id là bản nháp đang mở (chưa phải bài trong thư viện). */
export function isDraftSong(id: string): boolean {
  return id.startsWith(DRAFT_ID_PREFIX) && isTransientSong(id);
}

/**
 * Lưu bản nháp vào thư viện với nội dung `source` (người dùng bấm Lưu / Ctrl+S, hoặc "Lưu rồi đi").
 * Lần đầu: thêm bài user mới; bản nháp đã lưu (bài còn trong thư viện) → cập nhật bài đó. Trả id bài
 * thư viện. Bản nháp vẫn nằm trong bộ nhớ để `draftSavedAs` chuyển hướng Back về đúng bài đã lưu.
 */
export function saveDraftSong(draftId: string, source: string): string {
  const lib = useLibrary.getState();
  const prev = savedDrafts.get(draftId);
  if (prev !== undefined && lib.songs.some((s) => s.id === prev)) {
    lib.updateSong(prev, source);
    return prev;
  }
  // Ghi `savedDrafts` TRƯỚC khi thêm bài: selector nào đọc `draftSavedAs` (nút "Về màn chơi") chạy lại
  // đúng lúc thư viện đổi và thấy ngay bài đã lưu.
  const now = Date.now();
  const song: StoredSong = { id: newSongId(), source, createdAt: now, updatedAt: now };
  savedDrafts.set(draftId, song.id);
  useLibrary.setState((s) => ({ songs: [...s.songs, song] }));
  return song.id;
}

/** Bản nháp đã được Lưu thành bài nào (bài còn trong thư viện), null nếu chưa / không phải nháp. */
export function draftSavedAs(draftId: string): string | null {
  const id = savedDrafts.get(draftId);
  if (id === undefined) return null;
  return useLibrary.getState().songs.some((s) => s.id === id) ? id : null;
}

/** Hook: toàn bộ danh sách (xem listSongs). */
export function useSongList(): LibraryEntry[] {
  return useLibrary((s) => entriesOf(s.songs));
}

/** Title hiển thị ('' nếu bài không có title — UI dùng common.untitled). */
export function entryTitle(entry: Pick<LibraryEntry, 'source' | 'parsed'>): string {
  return entry.parsed.song.title.trim() || sourceTitle(entry.source);
}

/** Artist hiển thị ('' nếu không có). */
export function entryArtist(entry: Pick<LibraryEntry, 'source' | 'parsed'>): string {
  return (entry.parsed.song.artist ?? getDirective(entry.source, 'artist') ?? '').trim();
}

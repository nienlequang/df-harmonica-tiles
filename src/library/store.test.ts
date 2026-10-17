import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSettings } from '../ui/settings';
import { useToasts } from '../ui/toast';
import { SEED_SONGS, isSeedId } from './seeds';
import { getDirective } from './songSource';
import {
  LIBRARY_STORAGE_KEY,
  LIBRARY_VERSION,
  clearParseCache,
  decodeStoredLibrary,
  entryArtist,
  entryTitle,
  getSong,
  listSongs,
  migrateLibrary,
  newSongId,
  parseSongSource,
  useLibrary,
  useSong,
} from './store';
import type { StoredSong } from './store';

// Parser thật do agent khác viết → test này dùng parser giả (đọc @title/@artist/@bpm).
const fake = vi.hoisted(() => {
  const calls = { n: 0 };
  const parse = (text: string, opts: { id?: string } = {}) => {
    calls.n += 1;
    if (text.includes('!!THROW')) throw new Error('boom');
    const get = (name: string) =>
      new RegExp(`^[ \\t]*@${name}[ \\t]+([^\\r\\n]*)`, 'im').exec(text)?.[1]?.trim();
    const artist = get('artist');
    const ok = !text.includes('!!ERR');
    return {
      song: {
        id: opts.id ?? '',
        title: get('title') ?? '',
        ...(artist ? { artist } : {}),
        bpm: Number(get('bpm')) || 90,
        timeSig: { num: 4, den: 4 },
        scrollDir: 1 as const,
        sections: [
          {
            name: 'Main',
            lines: [
              {
                units: [
                  {
                    kind: 'note' as const,
                    key: 'Z' as const,
                    octave: 0 as const,
                    sharp: false,
                    beats: 2,
                  },
                ],
              },
            ],
          },
        ],
      },
      diagnostics: ok
        ? []
        : [
            {
              severity: 'error' as const,
              code: 'unknown-token' as const,
              line: 1,
              column: 1,
              length: 1,
            },
          ],
      lineOrigins: [],
      ok,
    };
  };
  return { calls, parse };
});

vi.mock('../core/parser', () => ({ parseHarm: fake.parse }));

const SEED_1 = SEED_SONGS[0]!;
const SEED_2 = SEED_SONGS[1]!;

function stored(): { state: { songs: StoredSong[] }; version: number } {
  const raw = localStorage.getItem(LIBRARY_STORAGE_KEY);
  expect(raw).not.toBeNull();
  return JSON.parse(raw ?? 'null') as { state: { songs: StoredSong[] }; version: number };
}

beforeEach(() => {
  useLibrary.setState({ songs: [] });
  localStorage.clear();
  clearParseCache();
  useSettings.setState({ language: 'vi' });
  useToasts.setState({ toasts: [] });
});

describe('seeds', () => {
  it('seed đúng id, đúng thứ tự (2 bài của người dùng đứng đầu, bài v1.0.2 sau) và isSeedId', () => {
    expect(SEED_SONGS.map((s) => s.id)).toEqual([
      'seed-quoc-ca-viet-nam',
      'seed-takediskrush',
      'seed-ji-mo-de-ren',
      'seed-sao-minh-chua-nam-tay-nhau',
    ]);
    expect(isSeedId('seed-quoc-ca-viet-nam')).toBe(true);
    expect(isSeedId('seed-takediskrush')).toBe(true);
    expect(isSeedId('seed-ji-mo-de-ren')).toBe(true);
    expect(isSeedId('seed-sao-minh-chua-nam-tay-nhau')).toBe(true);
    expect(isSeedId('seed-khac')).toBe(false);
    // Id seed không có (vd. bài mẫu đã bỏ ở bản cũ): không phải seed, không có trong thư viện.
    expect(getSong('seed-khac')).toBeNull();
    expect(getDirective(SEED_1.source, 'title')).toBe('Quốc ca Việt Nam');
    expect(getDirective(SEED_2.source, 'title')).toBe('TAKEDISKRUSH!');
  });
});

describe('actions', () => {
  it('addSong thêm bài, trả id và ghi localStorage (version 1)', () => {
    const id = useLibrary.getState().addSong('@title A\nZ');
    expect(id).toBeTruthy();
    expect(isSeedId(id)).toBe(false);
    const songs = useLibrary.getState().songs;
    expect(songs).toHaveLength(1);
    expect(songs[0]).toMatchObject({ id, source: '@title A\nZ' });
    expect(songs[0]!.createdAt).toBe(songs[0]!.updatedAt);
    const s = stored();
    expect(s.version).toBe(LIBRARY_VERSION);
    expect(s.state.songs.map((x) => x.id)).toEqual([id]);
  });

  it('updateSong đổi source + updatedAt; seed / id lạ → false', () => {
    const id = useLibrary.getState().addSong('@title A\nZ');
    const before = useLibrary.getState().songs[0]!;
    expect(useLibrary.getState().updateSong(id, '@title B\nX')).toBe(true);
    const after = useLibrary.getState().songs[0]!;
    expect(after.source).toBe('@title B\nX');
    expect(after.updatedAt).toBeGreaterThan(before.updatedAt);
    expect(after.createdAt).toBe(before.createdAt);
    expect(useLibrary.getState().updateSong(SEED_1.id, 'Z')).toBe(false);
    expect(useLibrary.getState().updateSong('nope', 'Z')).toBe(false);
    expect(stored().state.songs[0]!.source).toBe('@title B\nX');
  });

  it('removeSong chỉ xóa bài user, không xóa được seed', () => {
    const id = useLibrary.getState().addSong('Z');
    expect(useLibrary.getState().removeSong(SEED_1.id)).toBe(false);
    expect(getSong(SEED_1.id)).not.toBeNull();
    expect(useLibrary.getState().removeSong('nope')).toBe(false);
    expect(useLibrary.getState().removeSong(id)).toBe(true);
    expect(useLibrary.getState().songs).toHaveLength(0);
    expect(getSong(id)).toBeNull();
  });

  it('duplicateSong của seed: bài user mới, title "(bản sao)", nội dung giữ nguyên', () => {
    const id = useLibrary.getState().duplicateSong(SEED_1.id);
    expect(id).toBeTruthy();
    expect(isSeedId(id)).toBe(false);
    const copy = useLibrary.getState().songs.find((s) => s.id === id)!;
    expect(getDirective(copy.source, 'title')).toBe('Quốc ca Việt Nam (bản sao)');
    const strip = (s: string) => s.replace(/^@title.*$/m, '');
    expect(strip(copy.source)).toBe(strip(SEED_1.source));
    // seed vẫn còn nguyên
    expect(getSong(SEED_1.id)?.source).toBe(SEED_1.source);
  });

  it('duplicateSong theo ngôn ngữ hiện tại và với bài không có title', () => {
    useSettings.setState({ language: 'en' });
    const a = useLibrary.getState().duplicateSong(SEED_2.id);
    expect(getDirective(getSong(a)!.source, 'title')).toBe('TAKEDISKRUSH! (copy)');
    useSettings.setState({ language: 'vi' });
    const u = useLibrary.getState().addSong('Z X');
    const b = useLibrary.getState().duplicateSong(u);
    expect(getSong(b)!.source).toBe('@title Chưa đặt tên (bản sao)\nZ X');
    expect(useLibrary.getState().duplicateSong('nope')).toBe('');
  });

  it('importSongs bỏ nguồn rỗng, trả id theo thứ tự', () => {
    const ids = useLibrary.getState().importSongs(['@title 1\nZ', '   ', '@title 2\nX']);
    expect(ids).toHaveLength(2);
    expect(ids.map((id) => getSong(id)?.source)).toEqual(['@title 1\nZ', '@title 2\nX']);
    expect(useLibrary.getState().importSongs([])).toEqual([]);
  });

  it('id mới là duy nhất', () => {
    const ids = new Set(Array.from({ length: 50 }, () => newSongId()));
    expect(ids.size).toBe(50);
  });

  it('fallback id khi không có crypto.randomUUID', () => {
    vi.spyOn(globalThis.crypto, 'randomUUID').mockImplementation(() => {
      throw new Error('insecure context');
    });
    const a = newSongId();
    const b = newSongId();
    expect(a).toMatch(/^u-/);
    expect(a).not.toBe(b);
  });

  it('lỗi ghi localStorage (quota) không làm hỏng thao tác, báo toast', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const id = useLibrary.getState().addSong('Z');
    expect(getSong(id)).not.toBeNull();
    expect(useToasts.getState().toasts.some((t) => t.kind === 'error')).toBe(true);
  });
});

describe('persist / rehydrate', () => {
  it('round trip qua localStorage', async () => {
    const a = useLibrary.getState().addSong('@title A\nZ');
    const b = useLibrary.getState().addSong('@title B\nX');
    const original = useLibrary.getState().songs;
    const raw = localStorage.getItem(LIBRARY_STORAGE_KEY)!;

    useLibrary.setState({ songs: [] });
    localStorage.setItem(LIBRARY_STORAGE_KEY, raw);
    await useLibrary.persist.rehydrate();

    expect(useLibrary.getState().songs).toEqual(original);
    expect(useLibrary.getState().songs.map((s) => s.id)).toEqual([a, b]);
  });

  it('rehydrate dữ liệu version 0 → migrate và ghi lại version 1', async () => {
    localStorage.setItem(
      LIBRARY_STORAGE_KEY,
      JSON.stringify({
        state: [
          { id: 'old-1', text: '@title Cũ\nZ' },
          { text: 'X', title: 'Có title riêng' },
          { x: 1 },
        ],
        version: 0,
      }),
    );
    await useLibrary.persist.rehydrate();
    const songs = useLibrary.getState().songs;
    expect(songs).toHaveLength(2);
    expect(songs[0]!.id).toBe('old-1');
    expect(getDirective(songs[1]!.source, 'title')).toBe('Có title riêng');
    const s = stored();
    expect(s.version).toBe(1);
    expect(s.state.songs).toHaveLength(2);
  });

  it('dữ liệu cũ ghi thẳng (không có wrapper persist) coi là version 0', async () => {
    localStorage.setItem(LIBRARY_STORAGE_KEY, JSON.stringify([{ text: '@title Raw\nZ' }]));
    await useLibrary.persist.rehydrate();
    expect(useLibrary.getState().songs.map((s) => s.source)).toEqual(['@title Raw\nZ']);
  });

  it('JSON hỏng / state rác → thư viện rỗng, không throw', async () => {
    useLibrary.setState({ songs: [] });
    localStorage.setItem(LIBRARY_STORAGE_KEY, '{not json');
    await useLibrary.persist.rehydrate();
    expect(useLibrary.getState().songs).toEqual([]);

    localStorage.setItem(LIBRARY_STORAGE_KEY, JSON.stringify({ state: 42, version: 1 }));
    await useLibrary.persist.rehydrate();
    expect(useLibrary.getState().songs).toEqual([]);
  });

  it('version 1 nhưng entry hỏng → được làm sạch khi merge', async () => {
    localStorage.setItem(
      LIBRARY_STORAGE_KEY,
      JSON.stringify({
        state: { songs: [{ id: 'ok', source: 'Z', createdAt: 1, updatedAt: 2 }, { id: 'bad' }] },
        version: 1,
      }),
    );
    await useLibrary.persist.rehydrate();
    expect(useLibrary.getState().songs).toEqual([
      { id: 'ok', source: 'Z', createdAt: 1, updatedAt: 2 },
    ]);
  });

  it('decodeStoredLibrary', () => {
    expect(decodeStoredLibrary(null)).toBeNull();
    expect(decodeStoredLibrary('{bad')).toBeNull();
    expect(decodeStoredLibrary('{"state":{"songs":[]},"version":1}')).toEqual({
      state: { songs: [] },
      version: 1,
    });
    expect(decodeStoredLibrary('{"state":{"songs":[]}}')).toEqual({
      state: { songs: [] },
      version: 0,
    });
    expect(decodeStoredLibrary('[1]')).toEqual({ state: [1], version: 0 });
  });
});

describe('migrateLibrary', () => {
  it('v0: mảng { id?, text?|source?, title? }', () => {
    const r = migrateLibrary(
      [
        { id: 'a', text: '@title A\nZ', createdAt: 10, updatedAt: 20 },
        { source: 'X', title: 'B' },
        { text: '@title Có sẵn\nC', title: 'Bị bỏ qua' },
        '@title Chuỗi\nV',
        { text: '   ' },
        { id: 'x' },
        null,
        7,
      ],
      0,
    );
    expect(r.songs).toHaveLength(4);
    expect(r.songs[0]).toEqual({ id: 'a', source: '@title A\nZ', createdAt: 10, updatedAt: 20 });
    expect(r.songs[1]!.source).toBe('@title B\nX');
    expect(getDirective(r.songs[2]!.source, 'title')).toBe('Có sẵn');
    expect(r.songs[3]!.source).toBe('@title Chuỗi\nV');
    for (const s of r.songs) {
      expect(typeof s.id).toBe('string');
      expect(s.id.length).toBeGreaterThan(0);
      expect(Number.isFinite(s.createdAt)).toBe(true);
      expect(Number.isFinite(s.updatedAt)).toBe(true);
    }
  });

  it('v0: { songs: [...] } với field text', () => {
    const r = migrateLibrary({ songs: [{ id: 7, text: 'Z', updatedAt: 5 }] }, 0);
    expect(r.songs).toEqual([{ id: '7', source: 'Z', createdAt: 5, updatedAt: 5 }]);
  });

  it('rác → { songs: [] }', () => {
    for (const g of [null, undefined, 42, 'str', true, {}, { songs: 'x' }, [[]]]) {
      expect(migrateLibrary(g, 0)).toEqual({ songs: [] });
    }
  });

  it('v1 hợp lệ giữ nguyên', () => {
    const songs: StoredSong[] = [
      { id: 'u1', source: '@title A\nZ', createdAt: 1, updatedAt: 3 },
      { id: 'u2', source: 'X', createdAt: 2, updatedAt: 2 },
    ];
    expect(migrateLibrary({ songs }, 1)).toEqual({ songs });
  });

  it('id trùng, id trùng seed, timestamp hỏng → sinh mới', () => {
    const r = migrateLibrary(
      {
        songs: [
          { id: 'dup', source: 'Z', createdAt: 1, updatedAt: 1 },
          { id: 'dup', source: 'X', createdAt: -1, updatedAt: 'x' },
          { id: SEED_1.id, source: 'C' },
        ],
      },
      1,
    );
    const ids = r.songs.map((s) => s.id);
    expect(ids[0]).toBe('dup');
    expect(new Set(ids).size).toBe(3);
    expect(ids.some((id) => isSeedId(id))).toBe(false);
    expect(r.songs[1]!.createdAt).toBeGreaterThan(0);
  });

  it('idempotent', () => {
    const once = migrateLibrary([{ text: 'Z' }, { source: 'X', title: 'T' }], 0);
    expect(migrateLibrary(once, 1)).toEqual(once);
  });
});

describe('lookup + cache', () => {
  it('getSong seed và user; null nếu không có', () => {
    const seed = getSong(SEED_1.id)!;
    expect(seed.seed).toBe(true);
    expect(seed.updatedAt).toBe(0);
    expect(seed.parsed.song.id).toBe(SEED_1.id);
    expect(entryTitle(seed)).toBe('Quốc ca Việt Nam');
    expect(entryArtist(getSong(SEED_2.id)!)).toBe('N2UtheHartlocker');

    const id = useLibrary.getState().addSong('@title U\n@artist Me\nZ');
    const u = getSong(id)!;
    expect(u).toMatchObject({ id, seed: false, source: '@title U\n@artist Me\nZ' });
    expect(u.parsed.song.id).toBe(id);
    expect(getSong('nope')).toBeNull();
  });

  it('cache: không parse lại khi không đổi; entry/list ổn định theo tham chiếu', () => {
    const id = useLibrary.getState().addSong('@title U\nZ');
    const first = getSong(id)!;
    listSongs(); // parse seed (lười) một lần
    const n = fake.calls.n;
    expect(getSong(id)).toBe(first);
    expect(listSongs()).toBe(listSongs());
    expect(fake.calls.n).toBe(n);

    // Bài khác thêm vào không làm đổi entry cũ.
    useLibrary.getState().addSong('@title V\nX');
    expect(getSong(id)).toBe(first);

    // Sửa → entry mới, parse mới.
    useLibrary.getState().updateSong(id, '@title U2\nZ');
    const second = getSong(id)!;
    expect(second).not.toBe(first);
    expect(second.parsed.song.title).toBe('U2');
  });

  it('parseSongSource cache theo (id, source) và giới hạn kích thước', () => {
    const a = parseSongSource('a', 'Z');
    const n = fake.calls.n;
    expect(parseSongSource('a', 'Z')).toBe(a);
    expect(fake.calls.n).toBe(n);
    expect(parseSongSource('b', 'Z')).not.toBe(a);
    for (let i = 0; i < 60; i++) parseSongSource(`x${i}`, 'Z');
    const before = fake.calls.n;
    parseSongSource('a', 'Z'); // đã bị đẩy ra khỏi cache
    expect(fake.calls.n).toBe(before + 1);
  });

  it('parser throw → kết quả dự phòng ok=false, không crash', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const id = useLibrary.getState().addSong('@title Hỏng\n@artist X\n!!THROW');
    const e = getSong(id)!;
    expect(e.parsed.ok).toBe(false);
    expect(e.parsed.song.title).toBe('Hỏng');
    expect(e.parsed.song.artist).toBe('X');
    expect(e.parsed.song.sections).toEqual([]);
  });

  it('listSongs: seed trước theo thứ tự cố định, rồi bài user mới sửa trước', () => {
    useLibrary.setState({
      songs: [
        { id: 'old', source: '@title Old\nZ', createdAt: 1, updatedAt: 10 },
        { id: 'new', source: '@title New\nZ', createdAt: 2, updatedAt: 30 },
        { id: 'mid', source: '@title Mid\nZ', createdAt: 3, updatedAt: 20 },
      ],
    });
    const seeds = SEED_SONGS.map((s) => s.id);
    expect(listSongs().map((e) => e.id)).toEqual([...seeds, 'new', 'mid', 'old']);

    // Cùng timestamp → bài thêm sau lên trước.
    useLibrary.setState({
      songs: [
        { id: 'first', source: 'Z', createdAt: 5, updatedAt: 5 },
        { id: 'second', source: 'Z', createdAt: 5, updatedAt: 5 },
      ],
    });
    expect(
      listSongs()
        .map((e) => e.id)
        .slice(SEED_SONGS.length),
    ).toEqual(['second', 'first']);
  });

  it('useSong re-render khi bài đổi, null khi bị xóa', () => {
    const id = useLibrary.getState().addSong('@title H\nZ');
    const { result } = renderHook(() => useSong(id));
    expect(result.current?.parsed.song.title).toBe('H');
    act(() => {
      useLibrary.getState().updateSong(id, '@title H2\nZ');
    });
    expect(result.current?.parsed.song.title).toBe('H2');
    act(() => {
      useLibrary.getState().removeSong(id);
    });
    expect(result.current).toBeNull();
  });
});

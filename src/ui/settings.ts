import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { DEFAULT_BASE_OCTAVE } from '../core/keys';
import { translate } from '../i18n/strings';
import type { Lang } from '../i18n/strings';
import { createGuardedStorage } from './storage';
import { toast } from './toast';

export type Theme = 'dark' | 'light';
export type SubLabel = 'solfege' | 'number' | 'none';
export type Timbre = 'harmonica' | 'sine';
/** Practice mode: 'wait' dừng ở mỗi tile tới khi bấm đúng; 'score' chạy theo nhịp và chấm điểm. */
export type PracticeMode = 'wait' | 'score';

/** Kiểu điều khiển của game: PC (bàn phím + giữ chuột) hoặc Mobile (nút cảm ứng, chạm chọn chế độ). */
export type ControlScheme = 'pc' | 'mobile';
/** Mobile: nút Nửa Cung là bật/tắt giữ trạng thái ('toggle') hay chỉ áp cho 1 nốt ('oneShot') — chưa xác nhận. */
export type MobileSemitone = 'toggle' | 'oneShot';

/** Tên gọi tùy chỉnh cho các nút modifier; chuỗi rỗng = dùng tên mặc định theo ngôn ngữ (i18n mod.*). */
export interface ModifierLabelOverrides {
  /** Cúi Xuống (PC: chuột trái). */
  left: string;
  /** Ngẩng Lên (PC: chuột phải). */
  right: string;
  /** Ngẩng Tự Nhiên (chỉ có ở mobile). */
  natural: string;
  /** Nửa Cung (PC: nút cuộn). */
  scroll: string;
}

export const LABEL_OVERRIDE_MAX = 24;

export interface Settings {
  theme: Theme;
  language: Lang;
  /** Phóng to nhãn/tile trên canvas (0.75–1.5). */
  tileScale: number;
  /** Nhãn phụ dưới nhãn phím trên tile (mặc định ẩn — v4). */
  subLabel: SubLabel;
  /**
   * Phát giai điệu mẫu (tiếng synth). MẶC ĐỊNH TẮT, chỉ bật trong Cài đặt → Âm thanh sau khi xác nhận cảnh
   * báo bản quyền (SPEC "Âm thanh mặc định TẮT").
   */
  audioEnabled: boolean;
  /** Tiếng click metronome / đếm vào (không dính bản quyền). Mặc định tắt; tắt thì đếm vào chỉ là đoạn ô chạy dẫn vào, không tiếng. */
  clickSound: boolean;
  timbre: Timbre;
  /** 0..1 */
  musicVolume: number;
  /** 0..1 */
  clickVolume: number;
  /** Z = C{baseOctave} (2..6). Chiều Nửa Cung cố định thăng: `GAME_SCROLL_DIR` (core/keys). */
  baseOctave: number;
  /** Số beat hiện trên màn (4..12, mặc định 6 từ v5). Chỉnh ở thanh điều khiển màn chơi, không ở Cài đặt. */
  lookahead: number;
  /**
   * Đếm vào khi bấm Play: đoạn ô dẫn vào (src/player/leadIn.ts, v1.0.1 — nốt đầu đi 0,65 × (1 ô nhịp + khoảng lặng
   * đầu)); có click khi bật clickSound.
   */
  countIn: boolean;
  /** Click metronome suốt bài. */
  metronome: boolean;
  /** Đếm ngược (giây) sau khi bấm Play rồi mới chạy — để streamer kịp Alt-Tab vào game (0..10, mặc định 3). */
  startDelaySec: number;

  // ── Phase 2: practice ──
  practiceMode: PracticeMode;
  /** Phát tiếng synth khi bấm phím/nốt trong practice (mặc định tắt để tránh trễ). */
  practiceFeedback: boolean;

  // ── Phase 2b: Web MIDI ──
  /** Bật MIDI (chỉ khi bật mới xin quyền requestMIDIAccess). */
  midiEnabled: boolean;
  /** id thiết bị MIDI input đã chọn (nhớ giữa các lần mở). */
  midiInputId: string | null;
  /** Dịch nốt MIDI vào tầm harmonica: bán cung (-11..11) và quãng tám (-3..3). */
  midiTransposeSemitones: number;
  midiTransposeOctaves: number;
  /** Practice bằng MIDI: chỉ cần đúng pitch class (bỏ qua quãng). */
  midiPitchClassOnly: boolean;

  // ── Phase 2c: kiểu điều khiển + tên gọi ──
  controlScheme: ControlScheme;
  mobileSemitone: MobileSemitone;
  labelOverrides: ModifierLabelOverrides;
}

export const DEFAULT_SETTINGS: Readonly<Settings> = {
  theme: 'dark',
  language: 'vi',
  tileScale: 1,
  subLabel: 'none',
  audioEnabled: false,
  clickSound: false,
  timbre: 'harmonica',
  musicVolume: 0.8,
  clickVolume: 0.6,
  baseOctave: DEFAULT_BASE_OCTAVE,
  lookahead: 6,
  countIn: true,
  metronome: false,
  startDelaySec: 3,
  practiceMode: 'score',
  practiceFeedback: false,
  midiEnabled: false,
  midiInputId: null,
  midiTransposeSemitones: 0,
  midiTransposeOctaves: 0,
  midiPitchClassOnly: false,
  controlScheme: 'pc',
  mobileSemitone: 'toggle',
  labelOverrides: { left: '', right: '', natural: '', scroll: '' },
};

export const SETTINGS_STORAGE_KEY = 'dfht-settings';
export const SETTINGS_VERSION = 5;
/** Lookahead mặc định tới v4 — migrate v4 → v5 đổi giá trị này sang mặc định mới. */
const LEGACY_LOOKAHEAD_DEFAULT = 8;

const clamp = (v: unknown, min: number, max: number, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;

const oneOf = <T extends string | number>(v: unknown, allowed: readonly T[], fallback: T): T =>
  allowed.includes(v as T) ? (v as T) : fallback;

const bool = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback);

/** Tên gọi tùy chỉnh: chuỗi, bỏ xuống dòng, trim, tối đa LABEL_OVERRIDE_MAX ký tự. */
function sanitizeLabelOverrides(raw: unknown): ModifierLabelOverrides {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const one = (v: unknown): string =>
    typeof v === 'string'
      ? v
          .replace(/[\r\n\t]+/g, ' ')
          .trim()
          .slice(0, LABEL_OVERRIDE_MAX)
      : '';
  return { left: one(r.left), right: one(r.right), natural: one(r.natural), scroll: one(r.scroll) };
}

/** Chuẩn hóa dữ liệu bất kỳ (cũ/hỏng) thành Settings hợp lệ; trường lạ / đã bỏ bị loại. */
export function sanitizeSettings(raw: unknown): Settings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const d = DEFAULT_SETTINGS;
  return {
    theme: oneOf(r.theme, ['dark', 'light'] as const, d.theme),
    language: oneOf(r.language, ['vi', 'en'] as const, d.language),
    tileScale: clamp(r.tileScale, 0.75, 1.5, d.tileScale),
    subLabel: oneOf(r.subLabel, ['solfege', 'number', 'none'] as const, d.subLabel),
    audioEnabled: bool(r.audioEnabled, d.audioEnabled),
    clickSound: bool(r.clickSound, d.clickSound),
    timbre: oneOf(r.timbre, ['harmonica', 'sine'] as const, d.timbre),
    musicVolume: clamp(r.musicVolume, 0, 1, d.musicVolume),
    clickVolume: clamp(r.clickVolume, 0, 1, d.clickVolume),
    baseOctave: Math.round(clamp(r.baseOctave, 2, 6, d.baseOctave)),
    lookahead: Math.round(clamp(r.lookahead, 4, 12, d.lookahead)),
    countIn: bool(r.countIn, d.countIn),
    metronome: bool(r.metronome, d.metronome),
    startDelaySec: Math.round(clamp(r.startDelaySec, 0, 10, d.startDelaySec)),
    practiceMode: oneOf(r.practiceMode, ['wait', 'score'] as const, d.practiceMode),
    practiceFeedback: bool(r.practiceFeedback, d.practiceFeedback),
    midiEnabled: bool(r.midiEnabled, d.midiEnabled),
    midiInputId:
      typeof r.midiInputId === 'string' && r.midiInputId.length > 0 ? r.midiInputId : null,
    midiTransposeSemitones: Math.round(
      clamp(r.midiTransposeSemitones, -11, 11, d.midiTransposeSemitones),
    ),
    midiTransposeOctaves: Math.round(clamp(r.midiTransposeOctaves, -3, 3, d.midiTransposeOctaves)),
    midiPitchClassOnly: bool(r.midiPitchClassOnly, d.midiPitchClassOnly),
    controlScheme: oneOf(r.controlScheme, ['pc', 'mobile'] as const, d.controlScheme),
    mobileSemitone: oneOf(r.mobileSemitone, ['toggle', 'oneShot'] as const, d.mobileSemitone),
    labelOverrides: sanitizeLabelOverrides(r.labelOverrides),
  };
}

/**
 * Migrate dữ liệu persist từ version cũ. Mỗi lần đổi schema: tăng SETTINGS_VERSION,
 * thêm nhánh chuyển đổi ở đây và test trong settings.test.ts.
 * - v0/v1 → v2: thêm practice (mode, phím thay thế, feedback), MIDI, startDelaySec — lấy mặc định;
 *   các trường cũ giữ nguyên.
 * - v2 → v3: thêm controlScheme, mobileSemitone, labelOverrides, clickSound; ÉP audioEnabled,
 *   clickSound và practiceFeedback = false (ở v2 `audioEnabled` là công tắc tổng — tắt nó thì tiếng phản hồi
 *   practice cũng im; v3 tách riêng nên phải tắt cả feedback để config im ở v2 vẫn im ở v3).
 * - v3 → v4 (góp ý 2026-10-15): bỏ showLyrics (tính năng lời đã bỏ), scrollDir (Nửa Cung cố định thăng,
 *   `GAME_SCROLL_DIR`), practiceKeys (luyện tập không còn phím thay chuột) — sanitizeSettings tự loại;
 *   đếm ngược 0 → 3 giây (mặc định mới), nhãn phụ → 'none' (mặc định mới). App chưa phát hành nên chỉ
 *   có dữ liệu test của chủ dự án — áp mặc định mới một lần.
 * - v4 → v5 (góp ý 2026-10-16): lookahead mặc định 8 → 6 beat. Dữ liệu cũ đang để 8 (mặc định cũ — Cài đặt
 *   không còn ô chỉnh lookahead) thành 6; giá trị khác người dùng tự chọn trên thanh điều khiển thì giữ.
 */
export function migrateSettings(persisted: unknown, fromVersion: number): Settings {
  const s = sanitizeSettings(persisted);
  // v3: âm thanh mặc định TẮT (tránh vô tình phát giai điệu có bản quyền lên stream) — tắt một lần cho
  // dữ liệu cũ; người dùng bật lại trong Cài đặt → Âm thanh.
  if (fromVersion < 3) {
    s.audioEnabled = false;
    s.clickSound = false;
    s.practiceFeedback = false;
  }
  if (fromVersion < 4) {
    if (s.startDelaySec === 0) s.startDelaySec = 3;
    s.subLabel = 'none';
  }
  if (fromVersion < 5 && s.lookahead === LEGACY_LOOKAHEAD_DEFAULT) {
    s.lookahead = DEFAULT_SETTINGS.lookahead;
  }
  return s;
}

interface SettingsStore extends Settings {
  set: (patch: Partial<Settings>) => void;
  reset: () => void;
}

export const useSettings = create<SettingsStore>()(
  persist(
    (set) => ({
      ...DEFAULT_SETTINGS,
      set: (patch) => set((s) => sanitizeSettings({ ...pickSettings(s), ...patch })),
      reset: () => set({ ...DEFAULT_SETTINGS }),
    }),
    {
      name: SETTINGS_STORAGE_KEY,
      version: SETTINGS_VERSION,
      // Lưu lỗi (quota đầy / bị chặn): settings vẫn áp trong phiên, báo một toast (D-065).
      // `translate` thay vì `tNow` để tránh vòng import settings ↔ useT.
      storage: createGuardedStorage<Settings>({
        tag: 'settings',
        onSaveError: () =>
          toast(translate(useSettings.getState().language, 'settings.saveFailed'), 'error'),
      }),
      partialize: (s) => pickSettings(s),
      migrate: (persisted, version) => migrateSettings(persisted, version),
      // Không có dữ liệu (chưa lưu / JSON hỏng / storage bị chặn) → giữ state hiện tại.
      merge: (persisted, current) =>
        persisted === undefined ? current : { ...current, ...sanitizeSettings(persisted) },
    },
  ),
);

export function pickSettings(s: Settings): Settings {
  return sanitizeSettings(s);
}

/** Đọc settings ngoài React (vd. trong rAF loop). */
export function getSettings(): Settings {
  return pickSettings(useSettings.getState());
}

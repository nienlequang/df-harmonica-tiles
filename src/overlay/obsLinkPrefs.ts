/**
 * Tùy chọn hiển thị của hộp thoại "Tạo link OBS" (kiểu overlay, độ đậm của ô, cỡ giao diện game) nhớ
 * trong trình duyệt này (localStorage `dfht-obs-display`) — vòng sửa R5: "Cỡ giao diện game" là nút căn
 * duy nhất streamer phải chỉnh theo UI scale trong game; mở lại hộp thoại (vd. để nối lại OBS) rồi bấm
 * "Thêm overlay vào OBS" không được ghi đè source đã căn bằng giá trị mặc định.
 *
 * Mọi truy cập bọc try/catch (chế độ ẩn danh / storage bị chặn → mặc định, không lỗi); dữ liệu lạ → giá trị
 * mặc định của từng trường (kẹp vào khoảng hợp lệ).
 */
import {
  OBS_PRESETS,
  OVERLAY_OPACITY_MAX,
  OVERLAY_OPACITY_MIN,
  OVERLAY_UI_SCALE_MAX,
  OVERLAY_UI_SCALE_MIN,
  presetOptions,
} from './overlayParams';
import type { ObsPreset } from './overlayParams';

export const OBS_LINK_PREFS_KEY = 'dfht-obs-display';

export interface ObsLinkPrefs {
  preset: ObsPreset;
  /** Độ đậm của ô (0.3–1). */
  opacity: number;
  /** Tinh chỉnh cỡ giao diện game (0.7–1.3, 1 = mặc định). */
  uiScale: number;
}

export function defaultObsLinkPrefs(): ObsLinkPrefs {
  return { preset: 'game', opacity: presetOptions('game').opacity, uiScale: 1 };
}

const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v));
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Giá trị đã lưu (đã kiểm), thiếu / hỏng → mặc định. */
export function readObsLinkPrefs(): ObsLinkPrefs {
  const d = defaultObsLinkPrefs();
  let raw: unknown;
  try {
    const text = localStorage.getItem(OBS_LINK_PREFS_KEY);
    if (text === null) return d;
    raw = JSON.parse(text);
  } catch {
    return d;
  }
  if (typeof raw !== 'object' || raw === null) return d;
  const r = raw as Record<string, unknown>;
  const preset = OBS_PRESETS.find((p) => p === r.preset) ?? d.preset;
  return {
    preset,
    opacity: isNum(r.opacity)
      ? clamp(r.opacity, OVERLAY_OPACITY_MIN, OVERLAY_OPACITY_MAX)
      : presetOptions(preset).opacity,
    uiScale: isNum(r.uiScale) ? clamp(r.uiScale, OVERLAY_UI_SCALE_MIN, OVERLAY_UI_SCALE_MAX) : 1,
  };
}

/** Ghi lại (lỗi storage bị bỏ qua — chỉ mất phần nhớ). */
export function rememberObsLinkPrefs(prefs: ObsLinkPrefs): void {
  try {
    localStorage.setItem(OBS_LINK_PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // storage đầy / bị chặn
  }
}

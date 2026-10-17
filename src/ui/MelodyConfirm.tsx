import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { unlockAudioInGesture } from '../audio/gestureUnlock';
import { useT } from '../i18n/useT';
import { Button, Modal } from './components';
import { useSettings } from './settings';
import './settings.css';

export interface MelodyConfirmDialogProps {
  open: boolean;
  /** Hủy / Esc / bấm nền / nút × → giữ tắt. */
  onCancel: () => void;
  /** "Tôi hiểu, bật". */
  onConfirm: () => void;
}

/**
 * Hộp cảnh báo bản quyền trước khi bật "Phát giai điệu mẫu" (SPEC "Âm thanh mặc định TẮT", D-184) — đường
 * bật DUY NHẤT, dùng chung cho Cài đặt → Âm thanh và nút loa trên thanh điều khiển màn chơi (cùng tiêu đề,
 * cùng chữ, cùng nút). Focus đầu = Hủy (lựa chọn an toàn: giữ tắt).
 */
export function MelodyConfirmDialog({ open, onCancel, onConfirm }: MelodyConfirmDialogProps) {
  const t = useT();
  return (
    <Modal
      open={open}
      title={t('settings.audioConfirm.title')}
      onClose={onCancel}
      footer={
        <>
          {/* Mặc định là lựa chọn an toàn: giữ tắt. */}
          <Button variant="ghost" onClick={onCancel} data-autofocus>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" onClick={onConfirm}>
            {t('settings.audioConfirm.ok')}
          </Button>
        </>
      }
    >
      <p className="settings-warning">
        <span aria-hidden="true">⚠ </span>
        {t('settings.audioConfirm.body')}
      </p>
    </Modal>
  );
}

export interface MelodyToggle {
  /** settings.audioEnabled hiện tại (chung mọi nơi — Cài đặt và màn chơi luôn khớp nhau). */
  on: boolean;
  /** Hộp cảnh báo đang mở. */
  confirmOpen: boolean;
  /** Muốn bật → mở hộp cảnh báo (chưa bật); muốn tắt → tắt ngay, không hỏi. */
  request: (on: boolean) => void;
  /** Đảo trạng thái (nút loa): đang tắt → hỏi; đang bật → tắt ngay. */
  toggle: () => void;
  /** "Tôi hiểu, bật": bật thật rồi đóng hộp. */
  confirm: () => void;
  /** Hủy: đóng hộp, giữ tắt. */
  cancel: () => void;
}

/** Mặc định (Cài đặt → Âm thanh): ghi setting; bật thì mở khóa AudioContext ngay trong cú bấm (D-423). */
const setAudioSetting = (on: boolean): void => {
  useSettings.getState().set({ audioEnabled: on });
  if (on) unlockAudioInGesture();
};

/**
 * Logic bật / tắt giai điệu mẫu dùng chung (kèm <MelodyConfirmDialog> ở nơi gọi). `apply` = cách ghi
 * thật (mặc định ghi settings.audioEnabled + mở khóa AudioContext; màn chơi truyền `engine.setAudioEnabled` để
 * mở khóa và giữ phiên "playback" của iPhone ngay trong cú bấm "Tôi hiểu, bật" — D-423) — mọi đường đều kết thúc ở
 * settings.audioEnabled. `confirm` được gọi thẳng trong handler click của "Tôi hiểu, bật" (user gesture).
 */
export function useMelodyToggle(apply: (on: boolean) => void = setAudioSetting): MelodyToggle {
  const on = useSettings((s) => s.audioEnabled);
  const [confirmOpen, setConfirmOpen] = useState(false);
  // apply đổi identity mỗi render ở nơi gọi không làm đổi các callback trả về.
  const applyRef = useRef(apply);
  useLayoutEffect(() => {
    applyRef.current = apply;
  });

  const request = useCallback((want: boolean) => {
    if (want) {
      // Đã bật (vd. bật ở tab khác) → không hỏi lại.
      if (!useSettings.getState().audioEnabled) setConfirmOpen(true);
      return;
    }
    setConfirmOpen(false);
    applyRef.current(false);
  }, []);
  const toggle = useCallback(() => request(!useSettings.getState().audioEnabled), [request]);
  const confirm = useCallback(() => {
    applyRef.current(true);
    setConfirmOpen(false);
  }, []);
  const cancel = useCallback(() => setConfirmOpen(false), []);

  return { on, confirmOpen, request, toggle, confirm, cancel };
}

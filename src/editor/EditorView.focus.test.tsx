import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearParseCache, clearTransientSongs, useLibrary } from '../library/store';
import { useSettings } from '../ui/settings';
import { EditorView } from './EditorView';

vi.mock('../ui/features', () => ({ FEATURES: { editor: true, share: true, midiImport: false } }));

/**
 * Công cụ THẬT (Modal thật, khác EditorView.test.tsx dùng modal giả): đóng bằng bàn phím phải trả
 * focus về nút Công cụ, không rơi về <body> (D-061).
 */
beforeEach(() => {
  useLibrary.setState({ songs: [] });
  clearTransientSongs();
  clearParseCache();
  act(() => useSettings.getState().reset());
});

describe('EditorView — focus khi đóng công cụ thật', () => {
  it.each(['Tap timing (gõ nhịp)', 'Tối ưu lại cung / quãng'])(
    '%s: Esc trả focus về nút Công cụ',
    (label) => {
      const id = useLibrary.getState().addSong('@title A\n# A\nZ X C\n');
      window.history.replaceState(null, '', `/#/edit/${id}`);
      render(<EditorView songId={id} />);
      const menuButton = screen.getByRole('button', { name: /Công cụ/ });
      menuButton.focus();
      fireEvent.click(menuButton);
      const item = screen.getByRole('button', { name: label });
      item.focus();
      fireEvent.click(item);
      const dialog = screen.getByRole('dialog');
      expect(dialog.contains(document.activeElement)).toBe(true);
      fireEvent.keyDown(window, { key: 'Escape' });
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(document.activeElement).toBe(menuButton);
    },
  );
});

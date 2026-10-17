import { describe, expect, it } from 'vitest';
import { modifierLabels } from './modLabels';

describe('modifierLabels', () => {
  const none = { left: '', right: '', natural: '', scroll: '' };
  it('uses the game names by default', () => {
    expect(modifierLabels('vi', none)).toEqual({
      left: 'Cúi Xuống',
      right: 'Ngẩng Lên',
      natural: 'Ngẩng Tự Nhiên',
      scroll: 'Nửa Cung',
    });
    expect(modifierLabels('en', none).natural).toBe('Natural');
  });
  it('applies non-empty overrides only', () => {
    expect(modifierLabels('vi', { ...none, right: 'Lên quãng' })).toEqual({
      left: 'Cúi Xuống',
      right: 'Lên quãng',
      natural: 'Ngẩng Tự Nhiên',
      scroll: 'Nửa Cung',
    });
  });
});

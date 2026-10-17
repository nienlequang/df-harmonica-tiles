import { useT } from '../i18n/useT';
import { Button } from './components';
import { useSettings } from './settings';

/**
 * Hai nút nhỏ ở góc trên phải: đổi ngôn ngữ (VI ↔ EN) và giao diện sáng / tối. Dùng chung cho thanh
 * điều hướng của app và header màn chơi (góp ý 2026-10-15 B: "như mấy tab khác").
 */
export function PrefButtons({ className }: { className?: string }) {
  const t = useT();
  const language = useSettings((s) => s.language);
  const theme = useSettings((s) => s.theme);
  const set = useSettings((s) => s.set);
  return (
    <span className={['pref-buttons', className].filter(Boolean).join(' ')}>
      <Button
        size="sm"
        variant="ghost"
        className="pref-btn"
        aria-label={t('nav.toggleLanguage')}
        title={t('nav.toggleLanguage')}
        onClick={() => set({ language: language === 'vi' ? 'en' : 'vi' })}
      >
        {language === 'vi' ? 'EN' : 'VI'}
      </Button>
      <Button
        size="sm"
        variant="ghost"
        className="pref-btn"
        aria-label={t('nav.toggleTheme')}
        title={t('nav.toggleTheme')}
        onClick={() => set({ theme: theme === 'dark' ? 'light' : 'dark' })}
      >
        {theme === 'dark' ? '☀' : '☾'}
      </Button>
    </span>
  );
}

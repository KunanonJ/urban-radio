import { useEffect } from 'react';
import { resolveUiTheme, useUiThemeStore } from '@/lib/ui-theme-store';

/** Keeps `data-ui-theme` and `data-accent` on `<html>` in sync with the persisted store. */
export function ThemeAttributeBridge() {
  const theme = useUiThemeStore((s) => s.theme);
  const accent = useUiThemeStore((s) => s.accent);

  useEffect(() => {
    const apply = () => {
      document.documentElement.setAttribute('data-ui-theme', resolveUiTheme(useUiThemeStore.getState().theme));
    };
    apply();
    if (theme !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [theme]);

  useEffect(() => {
    document.documentElement.setAttribute('data-accent', accent);
  }, [accent]);

  return null;
}

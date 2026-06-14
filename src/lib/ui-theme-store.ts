import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/** Concrete themes applied to `data-ui-theme`. */
export type UiThemeResolved = 'day' | 'dark' | 'midnight' | 'oled';

export type UiTheme = UiThemeResolved | 'system';

export type UiAccent = 'green' | 'cyan' | 'violet' | 'amber';

/** Maps OS light/dark to Day / Night when `theme === 'system'`. */
export function resolveUiTheme(theme: UiTheme): UiThemeResolved {
  if (theme !== 'system') return theme;
  if (typeof window === 'undefined') return 'dark';
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'day' : 'dark';
}

function applyThemeToDocument(theme: UiTheme) {
  document.documentElement.setAttribute('data-ui-theme', resolveUiTheme(theme));
}

function applyAccentToDocument(accent: UiAccent) {
  document.documentElement.setAttribute('data-accent', accent);
}

type UiThemeState = {
  theme: UiTheme;
  accent: UiAccent;
  setTheme: (theme: UiTheme) => void;
  setAccent: (accent: UiAccent) => void;
};

export const useUiThemeStore = create<UiThemeState>()(
  persist(
    (set) => ({
      theme: 'dark',
      accent: 'green',
      setTheme: (theme) => {
        set({ theme });
        applyThemeToDocument(theme);
      },
      setAccent: (accent) => {
        set({ accent });
        applyAccentToDocument(accent);
      },
    }),
    {
      name: 'sonic-bloom-ui-theme',
      partialize: (state) => ({ theme: state.theme, accent: state.accent }),
      onRehydrateStorage: () => (state, error) => {
        if (!error && state) {
          if (state.theme) applyThemeToDocument(state.theme);
          applyAccentToDocument(state.accent ?? 'green');
        }
      },
    }
  )
);

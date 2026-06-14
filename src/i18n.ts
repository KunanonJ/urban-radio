import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from '@/locales/en.json';
import th from '@/locales/th.json';

export const LOCALE_STORAGE_KEY = 'sonic-bloom-locale';

if (!i18n.isInitialized) {
  void i18n.use(initReactI18next).init({
    resources: {
      en: { translation: en },
      th: { translation: th },
    },
    lng: 'en',
    fallbackLng: 'en',
    interpolation: { escapeValue: false },
    react: { useSuspense: false },
  });
}

if (typeof window !== 'undefined') {
  i18n.on('languageChanged', (lng) => {
    try {
      localStorage.setItem(LOCALE_STORAGE_KEY, lng.startsWith('th') ? 'th' : 'en');
    } catch {
      /* ignore */
    }
  });
}

export default i18n;

'use client';

import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { LOCALE_STORAGE_KEY } from '@/i18n';

/** Syncs stored locale + sets `lang` on `<html>` for accessibility. */
export function I18nLangBridge() {
  const { i18n } = useTranslation();

  useEffect(() => {
    try {
      const s = localStorage.getItem(LOCALE_STORAGE_KEY);
      if (s === 'en' || s === 'th') {
        if (i18n.language !== s) void i18n.changeLanguage(s);
        return;
      }
    } catch {
      /* ignore */
    }
    if (i18n.language === 'en') void i18n.changeLanguage('th');
  }, [i18n]);

  useEffect(() => {
    const lng = i18n.language?.startsWith('th') ? 'th' : 'en';
    document.documentElement.lang = lng;
  }, [i18n.language]);

  return null;
}

"use client";
import Link from 'next/link';
import { motion } from 'framer-motion';
import { Play, Zap, Radio, Library, Layers, ArrowRight, Music2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';

const featureIcons = [Layers, Library, Radio, Zap] as const;
const featureKeys = ['multiSource', 'unifiedLibrary', 'smartQueue', 'fast'] as const;

const sources = ['Plex', 'Spotify', 'Apple Music', 'YouTube', 'Jellyfin', 'Navidrome'];

export default function LandingPage() {
  const { t } = useTranslation();

  return (
    <div className="min-h-screen bg-background">
      <nav className="fixed top-0 left-0 right-0 z-50 glass">
        <div className="max-w-6xl xl:max-w-7xl 2xl:max-w-[90rem] mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
              <Music2 className="w-4 h-4 text-primary-foreground" />
            </div>
            <span className="font-bold text-lg text-foreground">{t('layout.appName')}</span>
          </div>
          <div className="flex items-center gap-2">
            <LanguageSwitcher compact />
            <Link
              href="/app"
              className="px-5 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity glow-sm"
            >
              {t('landing.launchApp')}
            </Link>
          </div>
        </div>
      </nav>

      <section className="pt-28 sm:pt-32 pb-16 sm:pb-20 px-4 sm:px-6">
        <div className="max-w-4xl xl:max-w-5xl 2xl:max-w-6xl mx-auto text-center">
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }}>
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-border surface-2 text-xs text-muted-foreground mb-6">
              <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse-glow" />
              {t('landing.badge')}
            </div>
            <h1 className="text-4xl sm:text-5xl md:text-6xl lg:text-7xl xl:text-8xl font-bold tracking-tight text-foreground leading-[1.1]">
              {t('landing.heroLine1')}
              <br />
              <span className="text-gradient">{t('landing.heroLine2')}</span>
            </h1>
            <p className="text-lg text-muted-foreground mt-6 max-w-xl mx-auto leading-relaxed">{t('landing.heroSubtitle')}</p>
            <div className="flex items-center justify-center gap-4 mt-10">
              <Link
                href="/app"
                className="inline-flex items-center gap-2 px-8 py-3.5 rounded-xl bg-primary text-primary-foreground font-semibold hover:opacity-90 transition-opacity glow-green text-sm"
              >
                <Play className="w-4 h-4" />
                {t('landing.openApp')}
              </Link>
              <a
                href="#features"
                className="inline-flex items-center gap-2 px-6 py-3.5 rounded-xl border border-border text-foreground hover:bg-secondary transition-colors text-sm"
              >
                {t('landing.learnMore')}
                <ArrowRight className="w-4 h-4" />
              </a>
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.3 }}
            className="mt-16 relative"
          >
            <div className="surface-2 border border-border rounded-2xl p-1 shadow-2xl">
              <div className="rounded-xl overflow-hidden surface-1 aspect-[16/9] flex items-center justify-center relative">
                <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-neon-violet/5" />
                <div className="text-center z-10">
                  <Music2 className="w-16 h-16 text-primary/30 mx-auto mb-4" />
                  <p className="text-muted-foreground text-sm">{t('landing.appPreview')}</p>
                </div>
              </div>
            </div>
            <div className="absolute -inset-4 bg-primary/5 rounded-3xl blur-3xl -z-10" />
          </motion.div>
        </div>
      </section>

      <section id="features" className="py-16 sm:py-20 px-4 sm:px-6">
        <div className="max-w-5xl xl:max-w-6xl 2xl:max-w-7xl mx-auto">
          <h2 className="text-2xl sm:text-3xl lg:text-4xl font-bold text-center text-foreground mb-8 sm:mb-12">{t('landing.featuresTitle')}</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-5 sm:gap-6 xl:gap-8">
            {featureKeys.map((key, i) => {
              const Icon = featureIcons[i];
              return (
                <motion.div
                  key={key}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: i * 0.1 }}
                  className="surface-2 border border-border rounded-xl p-6 hover:border-primary/20 transition-colors"
                >
                  <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center mb-4">
                    <Icon className="w-5 h-5 text-primary" />
                  </div>
                  <h3 className="text-lg font-semibold text-foreground mb-2">{t(`landing.features.${key}.title`)}</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">{t(`landing.features.${key}.desc`)}</p>
                </motion.div>
              );
            })}
          </div>
        </div>
      </section>

      <section className="py-16 sm:py-20 px-4 sm:px-6 surface-1">
        <div className="max-w-4xl xl:max-w-5xl mx-auto text-center">
          <h2 className="text-3xl font-bold text-foreground mb-4">{t('landing.sourcesTitle')}</h2>
          <p className="text-muted-foreground mb-12">{t('landing.sourcesSubtitle')}</p>
          <div className="flex flex-wrap justify-center gap-4">
            {sources.map((s) => (
              <div key={s} className="px-6 py-3 rounded-xl surface-2 border border-border text-sm text-foreground font-medium">
                {s}
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="py-20 sm:py-24 px-4 sm:px-6">
        <div className="max-w-3xl xl:max-w-4xl mx-auto text-center">
          <h2 className="text-4xl font-bold text-foreground mb-4">{t('landing.ctaTitle')}</h2>
          <p className="text-muted-foreground mb-8">{t('landing.ctaSubtitle')}</p>
          <Link
            href="/app"
            className="inline-flex items-center gap-2 px-10 py-4 rounded-xl bg-primary text-primary-foreground font-semibold hover:opacity-90 transition-opacity glow-green"
          >
            <Play className="w-5 h-5" />
            {t('landing.ctaButton')}
          </Link>
        </div>
      </section>

      <footer className="border-t border-border py-8 px-4 sm:px-6">
        <div className="max-w-6xl xl:max-w-7xl mx-auto flex flex-col sm:flex-row gap-4 sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded bg-primary flex items-center justify-center">
              <Music2 className="w-3 h-3 text-primary-foreground" />
            </div>
            <span className="text-sm font-semibold text-foreground">{t('layout.appName')}</span>
          </div>
          <p className="text-xs text-muted-foreground">{t('landing.footerCopyright')}</p>
        </div>
      </footer>
    </div>
  );
}

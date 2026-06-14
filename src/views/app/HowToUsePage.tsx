"use client";
import { useTranslation } from 'react-i18next';
import { CircleHelp } from 'lucide-react';

function Section({ titleKey, itemsKey }: { titleKey: string; itemsKey: string }) {
  const { t } = useTranslation();
  const items = t(itemsKey, { returnObjects: true }) as string[];
  if (!Array.isArray(items)) return null;
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold text-foreground">{t(titleKey)}</h2>
      <ul className="list-disc pl-5 space-y-1.5 text-sm text-muted-foreground leading-relaxed">
        {items.map((line, i) => (
          <li key={i}>{line}</li>
        ))}
      </ul>
    </section>
  );
}

export default function HowToUsePage() {
  const { t } = useTranslation();

  return (
    <div className="app-page-doc">
      <div className="flex items-center gap-3 mb-2">
        <CircleHelp className="w-6 h-6 text-primary" />
        <h1 className="text-3xl font-bold text-foreground">{t('howToUse.title')}</h1>
      </div>
      <p className="text-sm text-muted-foreground mb-8 leading-relaxed">{t('howToUse.intro')}</p>

      <div className="space-y-8">
        <Section titleKey="howToUse.sectionNav.title" itemsKey="howToUse.sectionNav.items" />
        <Section titleKey="howToUse.sectionPlayer.title" itemsKey="howToUse.sectionPlayer.items" />
        <Section titleKey="howToUse.sectionLibrary.title" itemsKey="howToUse.sectionLibrary.items" />
        <Section titleKey="howToUse.sectionRadio.title" itemsKey="howToUse.sectionRadio.items" />
        <Section titleKey="howToUse.sectionTips.title" itemsKey="howToUse.sectionTips.items" />
      </div>
    </div>
  );
}

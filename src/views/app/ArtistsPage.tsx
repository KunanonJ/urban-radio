"use client";
import { useCatalogArtists } from '@/lib/catalog-queries';
import { ArtistCard } from '@/components/ArtistCard';
import { EmptyState } from '@/components/ui/empty-state';
import { Users } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export default function ArtistsPage() {
  const { t } = useTranslation();
  const { data: apiArtists } = useCatalogArtists();
  const artists = apiArtists ?? [];
  return (
    <div className="app-page">
      <div className="flex items-center gap-3 mb-6">
        <Users className="w-6 h-6 text-primary" />
        <h1 className="text-3xl font-bold text-foreground">{t('artists.title')}</h1>
      </div>
      {artists.length === 0 ? (
        <EmptyState
          title={t('emptyStates.artists.title')}
          description={t('emptyStates.artists.description')}
          icon={Users}
        />
      ) : (
        <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-7 2xl:grid-cols-8 gap-4 sm:gap-5">
          {artists.map((a, i) => (
            <ArtistCard key={a.id} artist={a} index={i} />
          ))}
        </div>
      )}
    </div>
  );
}

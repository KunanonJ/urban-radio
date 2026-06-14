"use client";
import { useCatalogPlaylists } from '@/lib/catalog-queries';
import { PlaylistCard } from '@/components/PlaylistCard';
import { EmptyState } from '@/components/ui/empty-state';
import { Library, ListMusic, Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export default function PlaylistsPage() {
  const { t } = useTranslation();
  const { data: apiPlaylists } = useCatalogPlaylists();
  const playlists = apiPlaylists ?? [];
  return (
    <div className="app-page">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Library className="w-6 h-6 text-primary" />
          <h1 className="text-3xl font-bold text-foreground">{t('playlists.title')}</h1>
        </div>
        <button
          type="button"
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity"
        >
          <Plus className="w-4 h-4" />
          {t('playlists.newPlaylist')}
        </button>
      </div>
      {playlists.length === 0 ? (
        <EmptyState
          title={t('emptyStates.playlists.title')}
          description={t('emptyStates.playlists.description')}
          icon={ListMusic}
        />
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-5">
          {playlists.map((p, i) => (
            <PlaylistCard key={p.id} playlist={p} index={i} />
          ))}
        </div>
      )}
    </div>
  );
}

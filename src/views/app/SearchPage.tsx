"use client";
import { useCatalogArtists, useCatalogPlaylists } from '@/lib/catalog-queries';
import { useMergedAlbums } from '@/lib/library';
import { useSearchResults } from '@/hooks/use-search-results';
import { SearchResultsTable } from '@/components/search/SearchResultsTable';
import { AlbumCard } from '@/components/AlbumCard';
import { ArtistCard } from '@/components/ArtistCard';
import { PlaylistCard } from '@/components/PlaylistCard';
import { EmptyState } from '@/components/ui/empty-state';
import { Search, SearchX } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

export default function SearchPage() {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const hasQuery = query.trim().length > 0;
  const allAlbums = useMergedAlbums();
  const { data: apiArtists } = useCatalogArtists();
  const { data: apiPlaylists } = useCatalogPlaylists();
  const artists = apiArtists ?? [];
  const playlists = apiPlaylists ?? [];

  const unifiedHits = useSearchResults(query);

  const filteredAlbums = allAlbums.filter((a) => a.title.toLowerCase().includes(query.toLowerCase()));
  const filteredArtists = artists.filter((a) => a.name.toLowerCase().includes(query.toLowerCase()));
  const filteredPlaylists = playlists.filter((p) => p.title.toLowerCase().includes(query.toLowerCase()));

  const noResults =
    hasQuery &&
    unifiedHits.length === 0 &&
    filteredAlbums.length === 0 &&
    filteredArtists.length === 0 &&
    filteredPlaylists.length === 0;

  return (
    <div className="app-page space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-foreground mb-6">{t('search.title')}</h1>
        <div className="relative max-w-lg xl:max-w-xl">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('search.placeholder')}
            className="w-full pl-11 pr-4 py-3 rounded-xl surface-2 border border-border text-foreground placeholder:text-muted-foreground text-sm outline-none focus:ring-1 focus:ring-primary transition-shadow"
          />
        </div>
      </div>

      {!hasQuery && (
        <div className="surface-2 border border-border rounded-xl p-12 text-center">
          <Search className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
          <p className="text-muted-foreground">{t('search.emptyHint')}</p>
        </div>
      )}

      {hasQuery && (
        <>
          {unifiedHits.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-lg font-semibold text-foreground">{t('search.sectionAll')}</h2>
              <SearchResultsTable hits={unifiedHits} />
            </section>
          )}

          {filteredAlbums.length > 0 && (
            <div>
              <h2 className="text-lg font-semibold text-foreground mb-3">{t('search.sectionAlbums')}</h2>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-5">
                {filteredAlbums.map((a, i) => (
                  <AlbumCard key={a.id} album={a} index={i} />
                ))}
              </div>
            </div>
          )}
          {filteredArtists.length > 0 && (
            <div>
              <h2 className="text-lg font-semibold text-foreground mb-3">{t('search.sectionArtists')}</h2>
              <div className="grid grid-cols-3 md:grid-cols-6 gap-5">
                {filteredArtists.map((a, i) => (
                  <ArtistCard key={a.id} artist={a} index={i} />
                ))}
              </div>
            </div>
          )}
          {filteredPlaylists.length > 0 && (
            <div>
              <h2 className="text-lg font-semibold text-foreground mb-3">{t('search.sectionPlaylists')}</h2>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-5">
                {filteredPlaylists.map((p, i) => (
                  <PlaylistCard key={p.id} playlist={p} index={i} />
                ))}
              </div>
            </div>
          )}
          {noResults && (
            <EmptyState
              title={t('emptyStates.search.title')}
              description={t('emptyStates.search.description')}
              icon={SearchX}
            />
          )}
        </>
      )}
    </div>
  );
}

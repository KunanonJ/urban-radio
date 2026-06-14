"use client";
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Clock } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AlbumCard } from '@/components/AlbumCard';
import { useMergedAlbums } from '@/lib/library';
import {
  filterAlbumsByQuery,
  groupAlbumsByRecentBucket,
  type RecentBucket,
} from '@/lib/recently-added';

const BUCKET_KEYS: RecentBucket[] = ['yesterday', 'thisWeek', 'thisMonth', 'earlier'];

export default function RecentlyAddedPage() {
  const { t } = useTranslation();
  const albums = useMergedAlbums();
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => filterAlbumsByQuery(albums, query), [albums, query]);

  const now = useMemo(() => new Date(), []);
  const grouped = useMemo(() => groupAlbumsByRecentBucket(filtered, now), [filtered, now]);

  return (
    <div className="app-page space-y-8">
      <div className="flex flex-wrap items-center gap-3">
        <Clock className="w-6 h-6 text-primary shrink-0" />
        <h1 className="text-3xl font-bold text-foreground">{t('recentlyAdded.title')}</h1>
      </div>
      <p className="text-sm text-muted-foreground max-w-[60ch]">{t('recentlyAdded.intro')}</p>

      <div className="space-y-1.5 max-w-md">
        <Label htmlFor="recent-search" className="text-xs text-muted-foreground">
          {t('recentlyAdded.findLabel')}
        </Label>
        <Input
          id="recent-search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('recentlyAdded.searchPlaceholder')}
          className="min-h-[44px]"
        />
      </div>

      {filtered.length === 0 ? (
        <div className="surface-2 border border-border rounded-xl p-12 text-center text-sm text-muted-foreground">
          {albums.length === 0 ? t('recentlyAdded.emptyLibrary') : t('recentlyAdded.emptyFiltered')}
        </div>
      ) : (
        BUCKET_KEYS.map((bucket) => {
          const list = grouped[bucket];
          if (list.length === 0) return null;
          return (
            <section key={bucket} className="space-y-4">
              <h2 className="text-lg font-semibold text-foreground">
                {t(`recentlyAdded.buckets.${bucket}`)}
              </h2>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-5">
                {list.map((album, i) => (
                  <AlbumCard key={album.id} album={album} index={i} />
                ))}
              </div>
            </section>
          );
        })
      )}
    </div>
  );
}

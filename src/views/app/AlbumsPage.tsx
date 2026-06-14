"use client";
import { useMergedAlbums } from '@/lib/library';
import { AlbumCard } from '@/components/AlbumCard';
import { Disc3 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export default function AlbumsPage() {
  const { t } = useTranslation();
  const albums = useMergedAlbums();
  return (
    <div className="app-page">
      <div className="flex items-center gap-3 mb-6">
        <Disc3 className="w-6 h-6 text-primary" />
        <h1 className="text-3xl font-bold text-foreground">{t('albums.title')}</h1>
        <span className="text-sm text-muted-foreground ml-2">{t('albums.count', { count: albums.length })}</span>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-5">
        {albums.map((a, i) => (
          <AlbumCard key={a.id} album={a} index={i} />
        ))}
      </div>
    </div>
  );
}

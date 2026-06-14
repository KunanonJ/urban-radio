"use client";
import Image from 'next/image';
import { useParams, useRouter } from "next/navigation";
import { useTranslation } from 'react-i18next';
import { useCatalogArtist } from '@/lib/catalog-queries';
import { TrackRow } from '@/components/TrackRow';
import { AlbumCard } from '@/components/AlbumCard';
import { EmptyState } from '@/components/ui/empty-state';
import { Play } from 'lucide-react';
import { usePlayerStore } from '@/lib/store';

export default function ArtistDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { t } = useTranslation();
  const id = typeof params.id === "string" ? params.id : params.id?.[0];
  const { data: apiArtist } = useCatalogArtist(id);
  const { setQueue } = usePlayerStore();

  if (!apiArtist) {
    return (
      <div className="app-page">
        <EmptyState
          title={t('emptyStates.artistNotFound.title')}
          description={t('emptyStates.artistNotFound.description')}
          action={{
            label: t('emptyStates.artistNotFound.action'),
            onClick: () => router.push('/app/library/artists'),
          }}
        />
      </div>
    );
  }

  const artist = apiArtist;
  const artistTracks = apiArtist.tracks ?? [];
  const artistAlbums = apiArtist.albums ?? [];

  return (
    <div className="app-page">
      {/* Hero */}
      <div className="relative h-64 rounded-2xl overflow-hidden mb-8">
        <Image
          src={artist.artwork}
          alt=""
          fill
          unoptimized
          className="object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-background via-background/60 to-transparent" />
        <div className="absolute bottom-6 left-6">
          <h1 className="text-4xl font-bold text-foreground">{artist.name}</h1>
          <div className="flex items-center gap-4 mt-2 text-sm text-muted-foreground">
            {artist.monthlyListeners != null && (
              <span>{(artist.monthlyListeners / 1000).toFixed(0)}K listeners</span>
            )}
            <span>{artist.albumCount} albums</span>
            <span>{artist.trackCount} tracks</span>
          </div>
        </div>
      </div>

      <button
        type="button"
        onClick={() => setQueue(artistTracks)}
        disabled={artistTracks.length === 0}
        className="flex items-center gap-2 px-6 py-2.5 rounded-xl bg-primary text-primary-foreground font-medium text-sm hover:opacity-90 transition-opacity glow-sm mb-8 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <Play className="w-4 h-4" /> Play All
      </button>

      {/* Top Tracks */}
      <h2 className="text-lg font-semibold text-foreground mb-3">Top Tracks</h2>
      {artistTracks.length > 0 ? (
        <div className="surface-2 border border-border rounded-xl overflow-hidden mb-10">
          {artistTracks.slice(0, 5).map((tr, i) => (
            <TrackRow key={tr.id} track={tr} index={i} />
          ))}
        </div>
      ) : (
        <EmptyState
          title={t('emptyStates.tracks.title')}
          description={t('emptyStates.tracks.description')}
          className="mb-10"
        />
      )}

      {/* Discography */}
      {artistAlbums.length > 0 && (
        <div className="mb-10">
          <h2 className="text-lg font-semibold text-foreground mb-4">Discography</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-5">
            {artistAlbums.map((a, i) => (
              <AlbumCard key={a.id} album={a} index={i} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

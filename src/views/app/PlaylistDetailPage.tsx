"use client";
import Image from 'next/image';
import { useParams, useRouter } from "next/navigation";
import { useTranslation } from 'react-i18next';
import { shuffleArray } from '@/lib/utils';
import { useCatalogPlaylist } from '@/lib/catalog-queries';
import { TrackRow } from '@/components/TrackRow';
import { EmptyState } from '@/components/ui/empty-state';
import { usePlayerStore } from '@/lib/store';
import { Play, Shuffle, Clock } from 'lucide-react';
import { formatDurationLong } from '@/lib/format';

export default function PlaylistDetailPage() {
  const { t } = useTranslation();
  const params = useParams();
  const router = useRouter();
  const id = typeof params.id === "string" ? params.id : params.id?.[0];
  const { data: apiPlaylist } = useCatalogPlaylist(id);
  const { setQueue } = usePlayerStore();

  if (!apiPlaylist) {
    return (
      <div className="app-page">
        <EmptyState
          title={t('emptyStates.playlistNotFound.title')}
          description={t('emptyStates.playlistNotFound.description')}
          action={{
            label: t('emptyStates.playlistNotFound.action'),
            onClick: () => router.push('/app/library/playlists'),
          }}
        />
      </div>
    );
  }

  const playlist = apiPlaylist;
  const tracks = playlist.tracks ?? [];
  const hasTracks = tracks.length > 0;

  return (
    <div className="app-page">
      {/* Hero */}
      <div className="flex gap-8 mb-8">
        <Image
          src={playlist.artwork}
          alt={playlist.title}
          width={224}
          height={224}
          unoptimized
          className="w-56 h-56 rounded-xl object-cover shadow-2xl"
        />
        <div className="flex flex-col justify-end">
          <p className="text-xs uppercase tracking-widest text-muted-foreground mb-2">Playlist</p>
          <h1 className="text-4xl font-bold text-foreground">{playlist.title}</h1>
          <p className="text-muted-foreground mt-2">{playlist.description}</p>
          <div className="flex items-center gap-4 mt-4 text-sm text-muted-foreground">
            <span>{playlist.trackCount} tracks</span>
            <span className="flex items-center gap-1">
              <Clock className="w-3 h-3" />
              {formatDurationLong(playlist.duration)}
            </span>
          </div>
          <div className="flex items-center gap-3 mt-6">
            <button
              type="button"
              onClick={() => setQueue(tracks)}
              disabled={!hasTracks}
              className="flex items-center gap-2 px-6 py-2.5 rounded-xl bg-primary text-primary-foreground font-medium text-sm hover:opacity-90 transition-opacity glow-sm disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Play className="w-4 h-4" /> Play
            </button>
            <button
              type="button"
              onClick={() => setQueue(shuffleArray(tracks))}
              disabled={!hasTracks}
              className="flex items-center gap-2 px-6 py-2.5 rounded-xl border border-border text-foreground text-sm hover:bg-secondary transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Shuffle className="w-4 h-4" /> Shuffle
            </button>
          </div>
        </div>
      </div>

      {/* Tracks */}
      {hasTracks ? (
        <div className="surface-2 border border-border rounded-xl overflow-hidden">
          {tracks.map((tr, i) => (
            <TrackRow key={tr.id} track={tr} index={i} />
          ))}
        </div>
      ) : (
        <EmptyState
          title={t('emptyStates.tracks.title')}
          description={t('emptyStates.tracks.description')}
        />
      )}
    </div>
  );
}

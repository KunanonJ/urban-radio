'use client';

import { use } from 'react';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { PageHeader } from '@/components/shared/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useTrack } from '@/features/library/hooks/use-tracks';
import { useArtists } from '@/features/library/hooks/use-artists';
import { formatDuration } from '@/lib/utils/format';

interface TrackDetailPageProps {
  readonly params: Promise<{ id: string }>;
}

export default function TrackDetailPage({ params }: TrackDetailPageProps) {
  const { id } = use(params);
  const { data: track, isLoading } = useTrack(id);
  const { data: artists = [] } = useArtists();

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!track) {
    notFound();
  }

  const artist = artists.find((a) => a.id === track.artistId);

  return (
    <div>
      <div className="mb-4">
        <Link href="/app/library/tracks">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to tracks
          </Button>
        </Link>
      </div>
      <PageHeader
        title={track.title}
        description={artist?.name ?? 'Unknown artist'}
      />
      <div className="grid gap-6 md:grid-cols-2">
        <div className="space-y-3 rounded-lg border p-4">
          <h3 className="font-medium">Details</h3>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <span className="text-muted-foreground">Duration</span>
            <span>{formatDuration(track.durationSec)}</span>
            <span className="text-muted-foreground">Rotation</span>
            <span>
              <Badge>{track.rotationCategory}</Badge>
            </span>
            <span className="text-muted-foreground">Status</span>
            <span>
              <Badge variant={track.status === 'active' ? 'default' : 'secondary'}>
                {track.status}
              </Badge>
            </span>
            <span className="text-muted-foreground">Genre</span>
            <span>{track.genre ?? '—'}</span>
            <span className="text-muted-foreground">BPM</span>
            <span>{track.bpm ?? '—'}</span>
            <span className="text-muted-foreground">Energy</span>
            <span>{track.energyLevel ?? '—'}</span>
            <span className="text-muted-foreground">Explicit</span>
            <span>{track.isExplicit ? 'Yes' : 'No'}</span>
            <span className="text-muted-foreground">Language</span>
            <span>{track.language ?? '—'}</span>
          </div>
        </div>
        <div className="space-y-3 rounded-lg border p-4">
          <h3 className="font-medium">Timing</h3>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <span className="text-muted-foreground">Intro</span>
            <span>{track.introSec ? `${track.introSec}s` : '—'}</span>
            <span className="text-muted-foreground">Outro</span>
            <span>{track.outroSec ? `${track.outroSec}s` : '—'}</span>
            <span className="text-muted-foreground">Hook</span>
            <span>{track.hookSec ? `${track.hookSec}s` : '—'}</span>
            <span className="text-muted-foreground">Musical Key</span>
            <span>{track.musicalKey ?? '—'}</span>
            <span className="text-muted-foreground">Release Year</span>
            <span>{track.releaseYear ?? '—'}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

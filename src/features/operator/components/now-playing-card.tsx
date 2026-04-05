'use client';

import { Music, Radio, Volume2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import type { RundownItem } from '@/types/rundown';

const TYPE_ICONS: Record<string, typeof Music> = {
  song: Music,
  ad: Volume2,
};

interface NowPlayingCardProps {
  readonly item: RundownItem | null;
  readonly remainingSec?: number;
}

export function NowPlayingCard({ item, remainingSec }: NowPlayingCardProps) {
  if (!item) {
    return (
      <Card className="border-2 border-dashed">
        <CardContent className="flex flex-col items-center justify-center py-12">
          <Radio className="mb-4 h-16 w-16 text-muted-foreground" />
          <p className="text-lg text-muted-foreground">Nothing playing</p>
        </CardContent>
      </Card>
    );
  }

  const Icon = TYPE_ICONS[item.type] ?? Radio;

  return (
    <Card className="border-2 border-primary">
      <CardContent className="py-6">
        <div className="flex items-center gap-2 pb-2">
          <Badge variant="default" className="text-xs">NOW PLAYING</Badge>
          <Badge variant="outline" className="text-xs uppercase">{item.type}</Badge>
        </div>
        <div className="flex items-start gap-4">
          <div className="flex h-16 w-16 items-center justify-center rounded-lg bg-primary/10">
            <Icon className="h-8 w-8 text-primary" />
          </div>
          <div className="flex-1">
            <h2 className="text-2xl font-bold">{item.title}</h2>
            {item.artistName && item.type === 'song' && (
              <p className="text-lg text-muted-foreground">{item.artistName}</p>
            )}
            {item.advertiserName && item.type === 'ad' && (
              <p className="text-lg text-muted-foreground">{item.advertiserName}</p>
            )}
          </div>
          <div className="text-right">
            <p className="text-sm text-muted-foreground">Duration</p>
            <p className="text-xl font-mono">
              {Math.floor(item.durationSec / 60)}:{String(item.durationSec % 60).padStart(2, '0')}
            </p>
            {remainingSec !== undefined && (
              <>
                <p className="mt-2 text-sm text-muted-foreground">Remaining</p>
                <p className="text-xl font-mono text-primary">
                  {Math.floor(remainingSec / 60)}:{String(Math.max(0, remainingSec) % 60).padStart(2, '0')}
                </p>
              </>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

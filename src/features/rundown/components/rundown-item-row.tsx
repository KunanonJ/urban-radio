'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Pin, Shuffle } from 'lucide-react';
import type { RundownItem, ConflictFlag } from '@/types/rundown';

const TYPE_COLORS: Record<string, string> = {
  song: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
  ad: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  jingle: 'bg-purple-500/10 text-purple-600 dark:text-purple-400',
  news: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  talk_break: 'bg-cyan-500/10 text-cyan-600 dark:text-cyan-400',
  promo: 'bg-pink-500/10 text-pink-600 dark:text-pink-400',
  filler: 'bg-gray-500/10 text-gray-600 dark:text-gray-400',
};

const CONFLICT_SEVERITY: Record<ConflictFlag, 'error' | 'warning'> = {
  NO_VALID_TRACK: 'error',
  NO_VALID_AD: 'warning',
  ARTIST_REPEAT: 'warning',
  ADVERTISER_REPEAT: 'warning',
  HOUR_OVERFLOW: 'error',
  CAMPAIGN_EXPIRED: 'error',
  SPOT_NOT_APPROVED: 'error',
};

interface RundownItemRowProps {
  readonly item: RundownItem;
  readonly onReplace?: (item: RundownItem) => void;
}

export function RundownItemRow({ item, onReplace }: RundownItemRowProps) {
  const typeClass = TYPE_COLORS[item.type] ?? '';
  const hasConflicts = item.conflictFlags.length > 0;

  return (
    <div className={`flex items-center gap-3 rounded-md border p-2 ${hasConflicts ? 'border-destructive/50' : ''}`}>
      <span className="w-16 text-xs text-muted-foreground font-mono">
        {item.scheduledStart.slice(0, 5)}
      </span>

      <Badge variant="outline" className={`w-20 justify-center text-xs ${typeClass}`}>
        {item.type === 'ad' ? 'AD' : item.type.replace('_', ' ').toUpperCase()}
      </Badge>

      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{item.title}</p>
        {item.artistName && item.type === 'song' && (
          <p className="text-xs text-muted-foreground truncate">{item.artistName}</p>
        )}
        {item.advertiserName && item.type === 'ad' && (
          <p className="text-xs text-muted-foreground truncate">{item.advertiserName}</p>
        )}
      </div>

      <span className="text-xs text-muted-foreground w-12 text-right">
        {Math.floor(item.durationSec / 60)}:{String(item.durationSec % 60).padStart(2, '0')}
      </span>

      {item.isManualOverride && (
        <Pin className="h-3.5 w-3.5 text-amber-500" />
      )}

      {item.conflictFlags.map((flag) => (
        <Badge
          key={flag}
          variant={CONFLICT_SEVERITY[flag] === 'error' ? 'destructive' : 'outline'}
          className="text-xs"
        >
          {flag.replace(/_/g, ' ')}
        </Badge>
      ))}

      {onReplace && (
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={() => onReplace(item)}
        >
          <Shuffle className="h-3.5 w-3.5" />
        </Button>
      )}
    </div>
  );
}

'use client';

import { CheckCircle2, Music, Volume2, Radio } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { RundownItem } from '@/types/rundown';

const TYPE_COLORS: Record<string, string> = {
  song: 'text-blue-500',
  ad: 'text-amber-500',
  jingle: 'text-purple-500',
  news: 'text-emerald-500',
  talk_break: 'text-cyan-500',
  promo: 'text-pink-500',
  filler: 'text-gray-500',
};

interface UpNextListProps {
  readonly items: readonly RundownItem[];
  readonly onMarkPlayed: (item: RundownItem) => void;
  readonly maxItems?: number;
}

export function UpNextList({ items, onMarkPlayed, maxItems = 8 }: UpNextListProps) {
  const visibleItems = items.slice(0, maxItems);

  if (visibleItems.length === 0) {
    return (
      <div className="py-8 text-center text-muted-foreground">
        <p>No upcoming items</p>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {visibleItems.map((item, index) => (
        <div
          key={item.id}
          className={`flex items-center gap-3 rounded-md border p-3 ${
            index === 0 ? 'border-primary/50 bg-primary/5' : ''
          } ${item.status === 'played' ? 'opacity-50' : ''}`}
        >
          <span className="w-12 text-center text-sm font-mono text-muted-foreground">
            {item.scheduledStart.slice(0, 5)}
          </span>

          <Badge variant="outline" className={`w-16 justify-center text-xs ${TYPE_COLORS[item.type] ?? ''}`}>
            {item.type === 'ad' ? 'AD' : item.type.replace('_', ' ').slice(0, 6).toUpperCase()}
          </Badge>

          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">{item.title}</p>
            {item.artistName && item.type === 'song' && (
              <p className="text-xs text-muted-foreground truncate">{item.artistName}</p>
            )}
          </div>

          <span className="text-xs text-muted-foreground font-mono">
            {Math.floor(item.durationSec / 60)}:{String(item.durationSec % 60).padStart(2, '0')}
          </span>

          {item.status === 'played' ? (
            <CheckCircle2 className="h-5 w-5 text-emerald-500" />
          ) : (
            <Button
              variant="outline"
              size="sm"
              onClick={() => onMarkPlayed(item)}
              className="text-xs"
            >
              Mark Played
            </Button>
          )}
        </div>
      ))}
    </div>
  );
}

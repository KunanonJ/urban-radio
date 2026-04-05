'use client';

import { useState, useCallback, useMemo, useEffect } from 'react';
import { Radio } from 'lucide-react';
import { EmptyState } from '@/components/shared/empty-state';
import { NowPlayingCard } from '@/features/operator/components/now-playing-card';
import { UpNextList } from '@/features/operator/components/up-next-list';
import { useRundown } from '@/features/rundown/hooks/use-rundowns';
import { useCreatePlayLog } from '@/features/operator/hooks/use-play-logs';
import { formatDateKey } from '@/lib/utils/format';
import type { RundownItem } from '@/types/rundown';

export default function OperatorPage() {
  const today = formatDateKey(new Date());
  const { data: rundowns = [], isLoading } = useRundown(today);
  const createPlayLog = useCreatePlayLog();

  const rundown = rundowns.find((r) => r.status === 'published' || r.status === 'locked') ?? null;

  const [playedIds, setPlayedIds] = useState<Set<string>>(new Set());
  const [nowPlayingId, setNowPlayingId] = useState<string | null>(null);
  const [countdown, setCountdown] = useState(0);

  const sortedItems = useMemo(() => {
    if (!rundown) return [];
    return [...rundown.items].sort((a, b) => {
      if (a.hourBlock !== b.hourBlock) return a.hourBlock - b.hourBlock;
      return a.position - b.position;
    });
  }, [rundown]);

  const nowPlaying = sortedItems.find((i) => i.id === nowPlayingId) ?? null;
  const upNextItems = useMemo(() => {
    const idx = nowPlayingId ? sortedItems.findIndex((i) => i.id === nowPlayingId) : -1;
    const startIdx = idx >= 0 ? idx + 1 : 0;
    return sortedItems.slice(startIdx).map((item) => ({
      ...item,
      status: playedIds.has(item.id) ? 'played' as const : item.status,
    }));
  }, [sortedItems, nowPlayingId, playedIds]);

  // Countdown timer
  useEffect(() => {
    if (!nowPlaying || countdown <= 0) return;
    const timer = setInterval(() => {
      setCountdown((prev) => Math.max(0, prev - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [nowPlaying, countdown]);

  const handleMarkPlayed = useCallback(
    (item: RundownItem) => {
      if (!rundown) return;

      // Set as now playing
      setNowPlayingId(item.id);
      setCountdown(item.durationSec);
      setPlayedIds((prev) => new Set(prev).add(item.id));

      // Log the play
      createPlayLog.mutate({
        rundownId: rundown.id,
        rundownItemId: item.id,
        sourceRefId: item.sourceRefId,
        itemType: item.type,
        playedAt: new Date(),
        result: 'played',
      });
    },
    [rundown, createPlayLog],
  );

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="animate-pulse text-muted-foreground">Loading...</div>
      </div>
    );
  }

  if (!rundown) {
    return (
      <div className="flex h-full items-center justify-center">
        <EmptyState
          icon={<Radio className="h-16 w-16" />}
          title="No published rundown"
          description="Waiting for today's rundown to be published."
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6 py-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Operator Monitor</h1>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Radio className="h-4 w-4" />
          <span>{today}</span>
          <span className="text-muted-foreground/50">|</span>
          <span>{sortedItems.length} items</span>
          <span className="text-muted-foreground/50">|</span>
          <span>{playedIds.size} played</span>
        </div>
      </div>

      <NowPlayingCard item={nowPlaying} remainingSec={countdown > 0 ? countdown : undefined} />

      <div>
        <h2 className="pb-3 text-lg font-semibold">Up Next</h2>
        <UpNextList items={upNextItems} onMarkPlayed={handleMarkPlayed} />
      </div>
    </div>
  );
}

'use client';

import { orderBy, where } from 'firebase/firestore';
import { useFirestoreQuery } from '@/lib/hooks/use-firestore-query';
import { useFirestoreCreate } from '@/lib/hooks/use-firestore-mutation';
import type { PlayLog } from '@/types';

export function usePlayLogs(rundownId: string | undefined) {
  return useFirestoreQuery<PlayLog>({
    collectionPath: 'playLogs',
    constraints: rundownId
      ? [where('rundownId', '==', rundownId), orderBy('playedAt', 'desc')]
      : [],
    queryKey: ['playLogs', { rundownId }],
    enabled: !!rundownId,
  });
}

export function usePlayLogsByDateRange(startDate: string, endDate: string) {
  return useFirestoreQuery<PlayLog>({
    collectionPath: 'playLogs',
    constraints: [
      where('playedAt', '>=', new Date(startDate + 'T00:00:00')),
      where('playedAt', '<=', new Date(endDate + 'T23:59:59')),
      orderBy('playedAt', 'desc'),
    ],
    queryKey: ['playLogs', { startDate, endDate }],
  });
}

export function useCreatePlayLog() {
  return useFirestoreCreate<Omit<PlayLog, 'id'>>({
    collectionPath: 'playLogs',
    invalidateKeys: [['playLogs']],
  });
}

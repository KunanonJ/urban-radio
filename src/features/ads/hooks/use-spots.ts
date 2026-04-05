'use client';

import { orderBy } from 'firebase/firestore';
import { useFirestoreQuery } from '@/lib/hooks/use-firestore-query';
import {
  useFirestoreCreate,
  useFirestoreUpdate,
  useFirestoreDelete,
} from '@/lib/hooks/use-firestore-mutation';
import type { Spot } from '@/types';
import type { SpotFormValues } from '@/lib/validators/spot.schema';

function spotCollectionPath(campaignId: string): string {
  return `campaigns/${campaignId}/spots`;
}

export function useSpots(campaignId: string) {
  const collectionPath = spotCollectionPath(campaignId);
  const queryKey = ['spots', campaignId] as const;

  return useFirestoreQuery<Spot>({
    collectionPath,
    constraints: [orderBy('title', 'asc')],
    queryKey,
    enabled: !!campaignId,
  });
}

export function useCreateSpot(campaignId: string) {
  return useFirestoreCreate<SpotFormValues & { readonly campaignId: string; readonly audioStoragePath: string; readonly contentHash: string }>({
    collectionPath: spotCollectionPath(campaignId),
    invalidateKeys: [['spots', campaignId]],
  });
}

export function useUpdateSpot(campaignId: string) {
  return useFirestoreUpdate<Partial<SpotFormValues>>({
    collectionPath: spotCollectionPath(campaignId),
    invalidateKeys: [['spots', campaignId]],
  });
}

export function useDeleteSpot(campaignId: string) {
  return useFirestoreDelete({
    collectionPath: spotCollectionPath(campaignId),
    invalidateKeys: [['spots', campaignId]],
  });
}

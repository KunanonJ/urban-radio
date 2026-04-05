'use client';

import { orderBy, where, type QueryConstraint } from 'firebase/firestore';
import { useFirestoreQuery, useFirestoreDoc } from '@/lib/hooks/use-firestore-query';
import {
  useFirestoreCreate,
  useFirestoreUpdate,
  useFirestoreDelete,
} from '@/lib/hooks/use-firestore-mutation';
import type { Campaign } from '@/types';
import type { CampaignFormValues } from '@/lib/validators/campaign.schema';

const COLLECTION = 'campaigns';
const QUERY_KEY = ['campaigns'] as const;

export function useCampaigns(advertiserId?: string) {
  const constraints: QueryConstraint[] = [];
  if (advertiserId) {
    constraints.push(where('advertiserId', '==', advertiserId));
  }
  constraints.push(orderBy('startDate', 'desc'));

  return useFirestoreQuery<Campaign>({
    collectionPath: COLLECTION,
    constraints,
    queryKey: advertiserId ? ['campaigns', { advertiserId }] : QUERY_KEY,
  });
}

export function useCampaign(id: string | undefined) {
  return useFirestoreDoc<Campaign>({
    collectionPath: COLLECTION,
    docId: id,
    queryKey: ['campaigns', id],
  });
}

export function useCreateCampaign() {
  return useFirestoreCreate<CampaignFormValues>({
    collectionPath: COLLECTION,
    invalidateKeys: [QUERY_KEY],
  });
}

export function useUpdateCampaign() {
  return useFirestoreUpdate<Partial<CampaignFormValues>>({
    collectionPath: COLLECTION,
    invalidateKeys: [QUERY_KEY],
  });
}

export function useDeleteCampaign() {
  return useFirestoreDelete({
    collectionPath: COLLECTION,
    invalidateKeys: [QUERY_KEY],
  });
}

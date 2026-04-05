'use client';

import { orderBy } from 'firebase/firestore';
import { useFirestoreQuery } from '@/lib/hooks/use-firestore-query';
import {
  useFirestoreCreate,
  useFirestoreUpdate,
  useFirestoreDelete,
} from '@/lib/hooks/use-firestore-mutation';
import type { Advertiser } from '@/types';
import type { AdvertiserFormValues } from '@/lib/validators/advertiser.schema';

const COLLECTION = 'advertisers';
const QUERY_KEY = ['advertisers'] as const;

export function useAdvertisers() {
  return useFirestoreQuery<Advertiser>({
    collectionPath: COLLECTION,
    constraints: [orderBy('name', 'asc')],
    queryKey: QUERY_KEY,
  });
}

export function useCreateAdvertiser() {
  return useFirestoreCreate<AdvertiserFormValues>({
    collectionPath: COLLECTION,
    invalidateKeys: [QUERY_KEY],
  });
}

export function useUpdateAdvertiser() {
  return useFirestoreUpdate<Partial<AdvertiserFormValues>>({
    collectionPath: COLLECTION,
    invalidateKeys: [QUERY_KEY],
  });
}

export function useDeleteAdvertiser() {
  return useFirestoreDelete({
    collectionPath: COLLECTION,
    invalidateKeys: [QUERY_KEY],
  });
}

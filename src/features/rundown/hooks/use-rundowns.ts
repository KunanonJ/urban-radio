'use client';

import { where } from 'firebase/firestore';
import { useFirestoreQuery, useFirestoreDoc } from '@/lib/hooks/use-firestore-query';
import {
  useFirestoreCreate,
  useFirestoreUpdate,
  useFirestoreDelete,
} from '@/lib/hooks/use-firestore-mutation';
import type { Rundown } from '@/types';

const COLLECTION = 'rundowns';
const QUERY_KEY = ['rundowns'] as const;

export function useRundown(date: string | undefined) {
  return useFirestoreQuery<Rundown>({
    collectionPath: COLLECTION,
    constraints: date ? [where('date', '==', date)] : [],
    queryKey: ['rundowns', { date }],
    enabled: !!date,
  });
}

export function useRundownById(id: string | undefined) {
  return useFirestoreDoc<Rundown>({
    collectionPath: COLLECTION,
    docId: id,
    queryKey: ['rundowns', id],
  });
}

export function useCreateRundown() {
  return useFirestoreCreate<Omit<Rundown, 'id'>>({
    collectionPath: COLLECTION,
    invalidateKeys: [QUERY_KEY],
  });
}

export function useUpdateRundown() {
  return useFirestoreUpdate<Partial<Omit<Rundown, 'id'>>>({
    collectionPath: COLLECTION,
    invalidateKeys: [QUERY_KEY],
  });
}

export function useDeleteRundown() {
  return useFirestoreDelete({
    collectionPath: COLLECTION,
    invalidateKeys: [QUERY_KEY],
  });
}

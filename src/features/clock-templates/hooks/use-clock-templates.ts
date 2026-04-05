'use client';

import { orderBy } from 'firebase/firestore';
import { useFirestoreQuery, useFirestoreDoc } from '@/lib/hooks/use-firestore-query';
import {
  useFirestoreCreate,
  useFirestoreUpdate,
  useFirestoreDelete,
} from '@/lib/hooks/use-firestore-mutation';
import type { ClockTemplate } from '@/types';

const COLLECTION = 'clockTemplates';
const QUERY_KEY = ['clockTemplates'] as const;

export function useClockTemplates() {
  return useFirestoreQuery<ClockTemplate>({
    collectionPath: COLLECTION,
    constraints: [orderBy('name', 'asc')],
    queryKey: QUERY_KEY,
  });
}

export function useClockTemplate(id: string | undefined) {
  return useFirestoreDoc<ClockTemplate>({
    collectionPath: COLLECTION,
    docId: id,
    queryKey: ['clockTemplates', id],
  });
}

export function useCreateClockTemplate() {
  return useFirestoreCreate<Omit<ClockTemplate, 'id' | 'createdAt' | 'updatedAt'>>({
    collectionPath: COLLECTION,
    invalidateKeys: [QUERY_KEY],
  });
}

export function useUpdateClockTemplate() {
  return useFirestoreUpdate<Partial<Omit<ClockTemplate, 'id' | 'createdAt'>>>({
    collectionPath: COLLECTION,
    invalidateKeys: [QUERY_KEY],
  });
}

export function useDeleteClockTemplate() {
  return useFirestoreDelete({
    collectionPath: COLLECTION,
    invalidateKeys: [QUERY_KEY],
  });
}

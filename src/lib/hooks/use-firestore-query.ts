'use client';

import { useQuery, type UseQueryOptions } from '@tanstack/react-query';
import {
  collection,
  query,
  getDocs,
  doc,
  getDoc,
  orderBy,
  where,
  limit,
  type QueryConstraint,
  type DocumentData,
} from 'firebase/firestore';
import { getClientDb } from '@/lib/firebase/client';

interface FirestoreQueryOptions<T> {
  readonly collectionPath: string;
  readonly constraints?: readonly QueryConstraint[];
  readonly queryKey: readonly unknown[];
  readonly enabled?: boolean;
  readonly transform?: (id: string, data: DocumentData) => T;
}

function defaultTransform<T>(id: string, data: DocumentData): T {
  return { id, ...data } as unknown as T;
}

export function useFirestoreQuery<T>({
  collectionPath,
  constraints = [],
  queryKey,
  enabled = true,
  transform = defaultTransform,
}: FirestoreQueryOptions<T>) {
  return useQuery<readonly T[]>({
    queryKey,
    queryFn: async () => {
      const db = getClientDb();
      const ref = collection(db, collectionPath);
      const q = constraints.length > 0 ? query(ref, ...constraints) : query(ref);
      const snapshot = await getDocs(q);
      return snapshot.docs.map((docSnap) => transform(docSnap.id, docSnap.data()));
    },
    enabled,
  });
}

interface FirestoreDocOptions<T> {
  readonly collectionPath: string;
  readonly docId: string | undefined;
  readonly queryKey: readonly unknown[];
  readonly enabled?: boolean;
  readonly transform?: (id: string, data: DocumentData) => T;
}

export function useFirestoreDoc<T>({
  collectionPath,
  docId,
  queryKey,
  enabled = true,
  transform = defaultTransform,
}: FirestoreDocOptions<T>) {
  return useQuery<T | null>({
    queryKey,
    queryFn: async () => {
      if (!docId) return null;
      const db = getClientDb();
      const docRef = doc(db, collectionPath, docId);
      const snapshot = await getDoc(docRef);
      if (!snapshot.exists()) return null;
      return transform(snapshot.id, snapshot.data());
    },
    enabled: enabled && !!docId,
  });
}

export { collection, query, orderBy, where, limit, type QueryConstraint };

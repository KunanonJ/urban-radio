'use client';

import { orderBy, where, type QueryConstraint } from 'firebase/firestore';
import { useFirestoreQuery } from '@/lib/hooks/use-firestore-query';
import {
  useFirestoreCreate,
  useFirestoreUpdate,
  useFirestoreDelete,
} from '@/lib/hooks/use-firestore-mutation';
import type { Album } from '@/types';
import type { AlbumFormValues } from '@/lib/validators/album.schema';

const COLLECTION = 'albums';
const QUERY_KEY = ['albums'] as const;

export function useAlbums(artistId?: string) {
  const constraints: QueryConstraint[] = [];
  if (artistId) {
    constraints.push(where('artistId', '==', artistId));
  }
  constraints.push(orderBy('title', 'asc'));

  return useFirestoreQuery<Album>({
    collectionPath: COLLECTION,
    constraints,
    queryKey: artistId ? ['albums', { artistId }] : QUERY_KEY,
  });
}

export function useCreateAlbum() {
  return useFirestoreCreate<AlbumFormValues>({
    collectionPath: COLLECTION,
    invalidateKeys: [QUERY_KEY],
  });
}

export function useUpdateAlbum() {
  return useFirestoreUpdate<Partial<AlbumFormValues>>({
    collectionPath: COLLECTION,
    invalidateKeys: [QUERY_KEY],
  });
}

export function useDeleteAlbum() {
  return useFirestoreDelete({
    collectionPath: COLLECTION,
    invalidateKeys: [QUERY_KEY],
  });
}

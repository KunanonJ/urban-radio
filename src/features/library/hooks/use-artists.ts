'use client';

import { orderBy } from 'firebase/firestore';
import { useFirestoreQuery } from '@/lib/hooks/use-firestore-query';
import {
  useFirestoreCreate,
  useFirestoreUpdate,
  useFirestoreDelete,
} from '@/lib/hooks/use-firestore-mutation';
import type { Artist } from '@/types';
import type { ArtistFormValues } from '@/lib/validators/artist.schema';

const COLLECTION = 'artists';
const QUERY_KEY = ['artists'] as const;

function normalizeArtistName(name: string): string {
  return name.toLowerCase().trim().replace(/\s+/g, ' ');
}

export function useArtists() {
  return useFirestoreQuery<Artist>({
    collectionPath: COLLECTION,
    constraints: [orderBy('name', 'asc')],
    queryKey: QUERY_KEY,
  });
}

export function useCreateArtist() {
  return useFirestoreCreate<ArtistFormValues & { readonly normalizedName: string }>({
    collectionPath: COLLECTION,
    invalidateKeys: [QUERY_KEY],
  });
}

export function useUpdateArtist() {
  return useFirestoreUpdate<Partial<ArtistFormValues> & { readonly normalizedName?: string }>({
    collectionPath: COLLECTION,
    invalidateKeys: [QUERY_KEY],
  });
}

export function useDeleteArtist() {
  return useFirestoreDelete({
    collectionPath: COLLECTION,
    invalidateKeys: [QUERY_KEY],
  });
}

export { normalizeArtistName };

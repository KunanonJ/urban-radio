'use client';

import { orderBy, where, type QueryConstraint } from 'firebase/firestore';
import { useFirestoreQuery, useFirestoreDoc } from '@/lib/hooks/use-firestore-query';
import {
  useFirestoreCreate,
  useFirestoreUpdate,
  useFirestoreDelete,
} from '@/lib/hooks/use-firestore-mutation';
import type { Track, RotationCategory } from '@/types';
import type { TrackFormValues } from '@/lib/validators/track.schema';

const COLLECTION = 'tracks';
const QUERY_KEY = ['tracks'] as const;

function normalizeTrackTitle(title: string): string {
  return title.toLowerCase().trim().replace(/\s+/g, ' ');
}

interface TrackFilters {
  readonly artistId?: string;
  readonly rotationCategory?: RotationCategory;
  readonly status?: string;
  readonly isExplicit?: boolean;
}

export function useTracks(filters?: TrackFilters) {
  const constraints: QueryConstraint[] = [];

  if (filters?.artistId) {
    constraints.push(where('artistId', '==', filters.artistId));
  }
  if (filters?.rotationCategory) {
    constraints.push(where('rotationCategory', '==', filters.rotationCategory));
  }
  if (filters?.status) {
    constraints.push(where('status', '==', filters.status));
  }
  if (filters?.isExplicit !== undefined) {
    constraints.push(where('isExplicit', '==', filters.isExplicit));
  }

  constraints.push(orderBy('title', 'asc'));

  const queryKey = filters
    ? ['tracks', filters]
    : QUERY_KEY;

  return useFirestoreQuery<Track>({
    collectionPath: COLLECTION,
    constraints,
    queryKey,
  });
}

export function useTrack(id: string | undefined) {
  return useFirestoreDoc<Track>({
    collectionPath: COLLECTION,
    docId: id,
    queryKey: ['tracks', id],
  });
}

export function useCreateTrack() {
  return useFirestoreCreate<TrackFormValues & { readonly normalizedTitle: string; readonly storagePath: string; readonly contentHash: string; readonly createdBy: string }>({
    collectionPath: COLLECTION,
    invalidateKeys: [QUERY_KEY],
  });
}

export function useUpdateTrack() {
  return useFirestoreUpdate<Partial<TrackFormValues> & { readonly normalizedTitle?: string }>({
    collectionPath: COLLECTION,
    invalidateKeys: [QUERY_KEY],
  });
}

export function useDeleteTrack() {
  return useFirestoreDelete({
    collectionPath: COLLECTION,
    invalidateKeys: [QUERY_KEY],
  });
}

export { normalizeTrackTitle };

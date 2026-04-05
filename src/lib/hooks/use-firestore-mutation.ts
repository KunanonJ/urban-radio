'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  collection,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
  type DocumentData,
} from 'firebase/firestore';
import { getClientDb } from '@/lib/firebase/client';

interface CreateOptions {
  readonly collectionPath: string;
  readonly invalidateKeys: readonly (readonly unknown[])[];
}

export function useFirestoreCreate<TInput extends DocumentData>({
  collectionPath,
  invalidateKeys,
}: CreateOptions) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: TInput) => {
      const db = getClientDb();
      const ref = collection(db, collectionPath);
      const docRef = await addDoc(ref, {
        ...data,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      return docRef.id;
    },
    onSuccess: () => {
      for (const key of invalidateKeys) {
        void queryClient.invalidateQueries({ queryKey: key });
      }
    },
  });
}

interface UpdateOptions {
  readonly collectionPath: string;
  readonly invalidateKeys: readonly (readonly unknown[])[];
}

export function useFirestoreUpdate<TInput extends DocumentData>({
  collectionPath,
  invalidateKeys,
}: UpdateOptions) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, data }: { readonly id: string; readonly data: TInput }) => {
      const db = getClientDb();
      const docRef = doc(db, collectionPath, id);
      await updateDoc(docRef, {
        ...data,
        updatedAt: serverTimestamp(),
      });
      return id;
    },
    onSuccess: () => {
      for (const key of invalidateKeys) {
        void queryClient.invalidateQueries({ queryKey: key });
      }
    },
  });
}

interface DeleteOptions {
  readonly collectionPath: string;
  readonly invalidateKeys: readonly (readonly unknown[])[];
}

export function useFirestoreDelete({
  collectionPath,
  invalidateKeys,
}: DeleteOptions) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const db = getClientDb();
      const docRef = doc(db, collectionPath, id);
      await deleteDoc(docRef);
      return id;
    },
    onSuccess: () => {
      for (const key of invalidateKeys) {
        void queryClient.invalidateQueries({ queryKey: key });
      }
    },
  });
}

import type {
  DocumentData,
  FirestoreDataConverter,
  QueryDocumentSnapshot,
  WithFieldValue,
  Timestamp,
} from 'firebase/firestore';

function convertTimestamps(data: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (value && typeof value === 'object' && 'toDate' in value) {
      result[key] = (value as Timestamp).toDate();
    } else {
      result[key] = value;
    }
  }
  return result;
}

export function typedConverter<T extends DocumentData>(): FirestoreDataConverter<T> {
  return {
    toFirestore(data: WithFieldValue<T>): DocumentData {
      return data as DocumentData;
    },
    fromFirestore(snapshot: QueryDocumentSnapshot): T {
      const data = snapshot.data();
      return { id: snapshot.id, ...convertTimestamps(data) } as unknown as T;
    },
  };
}

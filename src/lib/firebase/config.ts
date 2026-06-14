export type FirebaseWebConfig = {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
};

export function isFirebaseConfigured(): boolean {
  return readFirebaseWebConfig() !== null;
}

export function readFirebaseWebConfig(): FirebaseWebConfig | null {
  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
  const authDomain = process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN;
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  const storageBucket = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET;
  const messagingSenderId = process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID;
  const appId = process.env.NEXT_PUBLIC_FIREBASE_APP_ID;

  if (!apiKey || !authDomain || !projectId || !storageBucket || !messagingSenderId || !appId) {
    return null;
  }

  return {
    apiKey,
    authDomain,
    projectId,
    storageBucket,
    messagingSenderId,
    appId,
  };
}

export function getFirebaseEmulatorHosts(): {
  firestoreHost?: string;
  authHost?: string;
  storageHost?: string;
} {
  const firestore = process.env.NEXT_PUBLIC_FIRESTORE_EMULATOR_HOST;
  const auth = process.env.NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST;
  const storage = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_EMULATOR_HOST;
  return {
    firestoreHost: firestore || undefined,
    authHost: auth || undefined,
    storageHost: storage || undefined,
  };
}

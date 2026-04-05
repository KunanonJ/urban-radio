'use client';

import { initializeApp, getApps, type FirebaseApp, type FirebaseOptions } from 'firebase/app';
import { getAuth, connectAuthEmulator, type Auth } from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator, type Firestore } from 'firebase/firestore';
import { getStorage, connectStorageEmulator, type FirebaseStorage } from 'firebase/storage';

/**
 * Placeholder web config when `NEXT_PUBLIC_FIREBASE_*` is unset in development.
 * Not a real Firebase project — use with the emulator suite or replace with real keys.
 */
const LOCAL_DEV_FIREBASE_CONFIG: FirebaseOptions = {
  apiKey: 'AIzaSyLocalDevUrbanRadioMockKey00000',
  authDomain: 'urban-radio-local.firebaseapp.com',
  projectId: 'urban-radio-local',
  storageBucket: 'urban-radio-local.appspot.com',
  messagingSenderId: '000000000001',
  appId: '1:000000000001:web:localdev00000000000001',
};

function resolveFirebaseOptions(): FirebaseOptions {
  const fromEnv: FirebaseOptions = {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY ?? '',
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ?? '',
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? '',
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ?? '',
    messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ?? '',
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID ?? '',
  };

  if ((fromEnv.apiKey ?? '').trim().length > 0) {
    return fromEnv;
  }

  if (process.env.NODE_ENV === 'production') {
    return fromEnv;
  }

  return LOCAL_DEV_FIREBASE_CONFIG;
}

let _app: FirebaseApp | null = null;
let _emulatorsConnected = false;

function getFirebaseApp(): FirebaseApp {
  if (_app) return _app;
  const existingApps = getApps();
  _app =
    existingApps.length > 0 ? existingApps[0]! : initializeApp(resolveFirebaseOptions());
  return _app;
}

function maybeConnectEmulators(authInst: Auth, dbInst: Firestore, storageInst: FirebaseStorage) {
  if (_emulatorsConnected || process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATORS !== 'true') return;
  connectAuthEmulator(authInst, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectFirestoreEmulator(dbInst, '127.0.0.1', 8080);
  connectStorageEmulator(storageInst, '127.0.0.1', 9199);
  _emulatorsConnected = true;
}

let _initialized = false;
let _auth: Auth;
let _db: Firestore;
let _storage: FirebaseStorage;

function ensureInitialized() {
  if (_initialized) return;
  const app = getFirebaseApp();
  _auth = getAuth(app);
  _db = getFirestore(app);
  _storage = getStorage(app);
  maybeConnectEmulators(_auth, _db, _storage);
  _initialized = true;
}

export function getClientAuth(): Auth {
  ensureInitialized();
  return _auth;
}

export function getClientDb(): Firestore {
  ensureInitialized();
  return _db;
}

export function getClientStorage(): FirebaseStorage {
  ensureInitialized();
  return _storage;
}

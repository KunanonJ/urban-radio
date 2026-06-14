"use client";

import { type FirebaseApp, getApps, initializeApp } from "firebase/app";
import { connectAuthEmulator, getAuth, type Auth } from "firebase/auth";
import { connectFirestoreEmulator, getFirestore, type Firestore } from "firebase/firestore";
import { connectStorageEmulator, getStorage, type FirebaseStorage } from "firebase/storage";
import { getFirebaseEmulatorHosts, readFirebaseWebConfig } from "./config";

export { isFirebaseConfigured } from "./config";

let app: FirebaseApp | null = null;

export function getFirebaseApp(): FirebaseApp | null {
  const config = readFirebaseWebConfig();
  if (!config) return null;
  if (!app) {
    app = getApps().length ? getApps()[0]! : initializeApp(config);
  }
  return app;
}

let authEmulatorConnected = false;
let firestoreEmulatorConnected = false;
let storageEmulatorConnected = false;

export function getFirebaseAuth(): Auth | null {
  const firebaseApp = getFirebaseApp();
  if (!firebaseApp) return null;
  const auth = getAuth(firebaseApp);
  const { authHost } = getFirebaseEmulatorHosts();
  if (authHost && !authEmulatorConnected) {
    connectAuthEmulator(auth, `http://${authHost}`, { disableWarnings: true });
    authEmulatorConnected = true;
  }
  return auth;
}

export function getFirebaseFirestore(): Firestore | null {
  const firebaseApp = getFirebaseApp();
  if (!firebaseApp) return null;
  const db = getFirestore(firebaseApp);
  const { firestoreHost } = getFirebaseEmulatorHosts();
  if (firestoreHost && !firestoreEmulatorConnected) {
    const [host, portRaw] = firestoreHost.split(":");
    const port = Number(portRaw || "8455");
    if (host) {
      connectFirestoreEmulator(db, host, port);
      firestoreEmulatorConnected = true;
    }
  }
  return db;
}

export function getFirebaseStorage(): FirebaseStorage | null {
  const firebaseApp = getFirebaseApp();
  if (!firebaseApp) return null;
  const storage = getStorage(firebaseApp);
  const { storageHost } = getFirebaseEmulatorHosts();
  if (storageHost && !storageEmulatorConnected) {
    const [host, portRaw] = storageHost.split(":");
    const port = Number(portRaw || "9199");
    if (host) {
      connectStorageEmulator(storage, host, port);
      storageEmulatorConnected = true;
    }
  }
  return storage;
}

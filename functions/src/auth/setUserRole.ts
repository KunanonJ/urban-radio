import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { initializeApp, getApps } from 'firebase-admin/app';

if (getApps().length === 0) {
  initializeApp();
}

const VALID_ROLES = ['admin', 'manager', 'librarian', 'traffic', 'operator', 'viewer'] as const;
type UserRole = (typeof VALID_ROLES)[number];

export const setUserRole = onCall(async (request) => {
  const callerUid = request.auth?.uid;
  if (!callerUid) {
    throw new HttpsError('unauthenticated', 'Must be signed in');
  }

  // Verify caller is admin
  const callerToken = request.auth?.token;
  if (callerToken?.['role'] !== 'admin') {
    throw new HttpsError('permission-denied', 'Only admins can set user roles');
  }

  const { uid, role } = request.data as { uid: string; role: string };

  if (!uid || !role) {
    throw new HttpsError('invalid-argument', 'uid and role are required');
  }

  if (!VALID_ROLES.includes(role as UserRole)) {
    throw new HttpsError('invalid-argument', `Invalid role: ${role}`);
  }

  // Set custom claim
  await getAuth().setCustomUserClaims(uid, { role });

  // Update Firestore profile
  await getFirestore().doc(`users/${uid}`).update({
    role,
    updatedAt: new Date(),
  });

  return { success: true };
});

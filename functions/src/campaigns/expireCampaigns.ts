import { onSchedule } from 'firebase-functions/v2/scheduler';
import { getFirestore } from 'firebase-admin/firestore';
import { initializeApp, getApps } from 'firebase-admin/app';

if (getApps().length === 0) {
  initializeApp();
}

/**
 * Runs daily at midnight. Sets any active campaign whose endDate has passed to 'expired'.
 */
export const expireCampaigns = onSchedule('every day 00:00', async () => {
  const db = getFirestore();
  const today = new Date().toISOString().split('T')[0]!;

  const snapshot = await db
    .collection('campaigns')
    .where('status', '==', 'active')
    .where('endDate', '<', today)
    .get();

  if (snapshot.empty) {
    return;
  }

  const batch = db.batch();
  for (const doc of snapshot.docs) {
    batch.update(doc.ref, {
      status: 'expired',
      updatedAt: new Date(),
    });
  }

  await batch.commit();
});

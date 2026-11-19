import { getFirestore } from 'firebase-admin/firestore';
import { getMessaging } from 'firebase-admin/messaging';
import { logger } from 'firebase-functions/v2';

export type AlarmMessage =
  | { type: 'new_order'; orderId: string; number: string; total: string; customer: string }
  | { type: 'order_closed'; orderId: string };

const DEAD_TOKEN_CODES = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
  'messaging/invalid-argument',
]);

/**
 * Sends a high-priority DATA-only message to every registered owner device.
 * It has no "notification" part on purpose: that makes Android hand it to the app's own
 * message service even when the app is closed, which is what starts the loud alarm.
 */
export async function notifyAdmins(message: AlarmMessage): Promise<void> {
  const db = getFirestore();
  const tokenDocs = await db.collection('adminTokens').get();
  const tokens = tokenDocs.docs.map((d) => d.id);
  if (tokens.length === 0) {
    logger.warn('No owner devices registered; nobody will be alerted', { type: message.type });
    return;
  }

  const result = await getMessaging().sendEachForMulticast({
    tokens,
    data: message as Record<string, string>,
    android: { priority: 'high', ttl: message.type === 'new_order' ? 120_000 : 60_000 },
  });

  const dead: string[] = [];
  result.responses.forEach((r, i) => {
    if (!r.success && r.error && DEAD_TOKEN_CODES.has(r.error.code)) dead.push(tokens[i]);
  });
  await Promise.all(dead.map((t) => db.doc(`adminTokens/${t}`).delete()));
  logger.info('Alerted owner devices', {
    type: message.type,
    sent: result.successCount,
    failed: result.failureCount,
    removed: dead.length,
  });
}

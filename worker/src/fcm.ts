import { Firestore } from './firestore-deps';

export type AlarmMessage =
  | { type: 'new_order'; orderId: string; number: string; total: string; customer: string }
  | { type: 'order_closed'; orderId: string };

/**
 * Sends a high-priority DATA-only message to every registered owner device (starts the loud alarm).
 * `preloadedTokens` lets the caller start reading the device list early so it is ready when needed.
 */
export async function notifyAdmins(
  db: Firestore,
  projectId: string,
  accessToken: string,
  message: AlarmMessage,
  preloadedTokens?: Promise<{ id: string }[]>,
): Promise<void> {
  const tokenDocs = await (preloadedTokens ?? db.list('adminTokens'));
  const tokens = tokenDocs.map((d) => d.id);
  if (tokens.length === 0) {
    console.warn('No owner devices registered; nobody will be alerted', message.type);
    return;
  }

  const ttl = message.type === 'new_order' ? '120s' : '60s';
  let sent = 0;

  await Promise.all(
    tokens.map(async (token) => {
      const res = await fetch(`https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: {
            token,
            data: message as unknown as Record<string, string>,
            android: { priority: 'HIGH', ttl },
          },
        }),
      });
      if (res.ok) {
        sent++;
        return;
      }
      const body = await res.text();
      // Token no longer valid: remove it so we stop trying.
      if (res.status === 404 || body.includes('UNREGISTERED') || body.includes('INVALID_ARGUMENT')) {
        await db.delete(`adminTokens/${encodeURIComponent(token)}`).catch(() => undefined);
      } else {
        console.error('FCM send failed', res.status, body);
      }
    }),
  );

  console.log('Alerted owner devices', message.type, 'sent', sent, 'of', tokens.length);
}

export interface CustomerMessage {
  title: string;
  body: string;
  orderId: string;
}

/** Text the customer sees for each status the cafe sets. null = no notification for that status. */
export function customerMessageFor(status: string, number: string, orderId: string, reason?: string, dineIn = false): CustomerMessage | null {
  switch (status) {
    case 'accepted':
      return { title: 'Order accepted 🎉', body: `${number} is confirmed. We'll start preparing it soon.`, orderId };
    case 'preparing':
      return { title: 'Being prepared 🍳', body: `${number} is in the kitchen now.`, orderId };
    case 'out_for_delivery':
      return { title: 'On the way 🛵', body: `${number} is out for delivery.`, orderId };
    case 'delivered':
      return dineIn
        ? { title: 'Served 🍽️', body: `${number} is on its way to your table. Enjoy!`, orderId }
        : { title: 'Delivered ✅', body: `${number} has been delivered. Enjoy!`, orderId };
    case 'rejected':
      return { title: 'Order not accepted', body: reason ? `${number}: ${reason}` : `${number} could not be accepted.`, orderId };
    case 'cancelled':
      return { title: 'Order cancelled', body: reason ? `${number}: ${reason}` : `${number} was cancelled.`, orderId };
    case 'expired':
      return { title: 'Cafe did not respond in time', body: `${number} was not accepted in time. Please try again.`, orderId };
    default:
      return null;
  }
}

/** Web push to the customer's phone (token saved by /registerCustomerToken). Silent no-op if they never allowed it. */
export async function notifyCustomer(
  db: Firestore,
  projectId: string,
  accessToken: string,
  customerUid: string,
  msg: CustomerMessage,
): Promise<void> {
  const doc = await db.get(`customerTokens/${encodeURIComponent(customerUid)}`);
  const token = typeof doc?.['token'] === 'string' ? (doc['token'] as string) : '';
  if (!token) return;
  const res = await fetch(`https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: {
        token,
        data: { title: msg.title, body: msg.body, orderId: msg.orderId, url: `/order/${msg.orderId}` },
        webpush: { headers: { Urgency: 'high', TTL: '600' } },
      },
    }),
  });
  if (res.ok) return;
  const body = await res.text();
  if (res.status === 404 || body.includes('UNREGISTERED') || body.includes('INVALID_ARGUMENT')) {
    await db.delete(`customerTokens/${encodeURIComponent(customerUid)}`).catch(() => undefined);
  } else {
    console.error('Customer push failed', res.status, body);
  }
}

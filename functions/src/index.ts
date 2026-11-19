import { initializeApp } from 'firebase-admin/app';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { HttpsError, onCall, type CallableRequest } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions/v2';
import { DomainError, USER_MESSAGES, type DomainErrorCode, type Order, type PlaceOrderRequest } from '@juicy/shared';
import { changeStatusCore, expirePendingCore, placeOrderCore, type ChangeStatusRequest } from './core';
import { createFirestoreDeps } from './firestore-deps';
import { notifyAdmins } from './notify';

initializeApp();

/** Same region as Firestore (Mumbai) for the lowest latency from Akkalkot. */
const REGION = 'asia-south1';

/**
 * Turn on in functions/.env (ENFORCE_APP_CHECK=true) after setting up Firebase App Check.
 * It stops other websites and scripts from calling placeOrder.
 */
const ENFORCE_APP_CHECK = process.env.ENFORCE_APP_CHECK === 'true';

const callable = { region: REGION, enforceAppCheck: ENFORCE_APP_CHECK, maxInstances: 5 } as const;

const HTTPS_CODE: Record<DomainErrorCode, ConstructorParameters<typeof HttpsError>[0]> = {
  shop_closed: 'failed-precondition',
  invalid_request: 'invalid-argument',
  invalid_item: 'invalid-argument',
  item_unavailable: 'failed-precondition',
  blocked: 'permission-denied',
  too_many_orders: 'resource-exhausted',
  invalid_transition: 'failed-precondition',
  reason_required: 'invalid-argument',
  not_found: 'not-found',
  forbidden: 'permission-denied',
  too_far: 'failed-precondition',
};

/** Business-rule errors reach the app with a stable `domainCode` it can show a friendly message for. */
function toHttpsError(e: unknown): HttpsError {
  if (e instanceof HttpsError) return e;
  if (e instanceof DomainError) {
    return new HttpsError(HTTPS_CODE[e.code], e.message || USER_MESSAGES[e.code], { domainCode: e.code });
  }
  logger.error('Unexpected error', e);
  return new HttpsError('internal', 'Something went wrong. Please try again.');
}

function requireAuth(request: CallableRequest): { uid: string; isAdmin: boolean } {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Please reload the app and try again.');
  return { uid: request.auth.uid, isAdmin: request.auth.token['admin'] === true };
}

export const placeOrder = onCall(callable, async (request) => {
  const { uid } = requireAuth(request);
  try {
    return await placeOrderCore(createFirestoreDeps(), uid, request.data as PlaceOrderRequest, Date.now());
  } catch (e) {
    throw toHttpsError(e);
  }
});

/** Used by the owner (accept, reject, preparing, out for delivery, delivered, cancel) and by the customer (cancel while pending). */
export const changeOrderStatus = onCall(callable, async (request) => {
  const actor = requireAuth(request);
  try {
    const { order, previous } = await changeStatusCore(
      createFirestoreDeps(),
      actor,
      request.data as ChangeStatusRequest,
      Date.now(),
    );
    // The alarm on the owner's phone must stop as soon as the order is no longer waiting.
    if (previous === 'pending' && order.status !== 'pending') {
      await notifyAdmins({ type: 'order_closed', orderId: order.id }).catch((e) =>
        logger.error('order_closed notification failed', e),
      );
    }
    return { status: order.status };
  } catch (e) {
    throw toHttpsError(e);
  }
});

/** Rings the owner's phone the moment a new order is saved. */
export const onOrderCreated = onDocumentCreated({ document: 'orders/{orderId}', region: REGION }, async (event) => {
  const order = event.data?.data() as Order | undefined;
  if (!order || order.status !== 'pending') return;
  await notifyAdmins({
    type: 'new_order',
    orderId: order.id,
    number: order.number,
    total: String(order.total),
    customer: order.customer.name,
  });
});

/** Every minute: orders the owner did not answer in time are expired, and the alarm is silenced. */
export const expirePendingOrders = onSchedule(
  { schedule: 'every 1 minutes', region: REGION, timeoutSeconds: 60, maxInstances: 1 },
  async () => {
    const expired = await expirePendingCore(createFirestoreDeps(), Date.now());
    for (const orderId of expired) {
      await notifyAdmins({ type: 'order_closed', orderId }).catch((e) =>
        logger.error('order_closed notification failed', e),
      );
    }
    if (expired.length) logger.info('Expired unanswered orders', { expired });
  },
);

import { DomainError, USER_MESSAGES, type DomainErrorCode, type PlaceOrderRequest } from '@juicy/shared';
import {
  changeStatusCore,
  claimPaymentCore,
  loyaltyPreviewCore,
  submitReviewCore,
  markPaidCore,
  expirePendingCore,
  placeOrderCore,
  type ChangeStatusRequest,
  type MarkPaidRequest,
  type ClaimPaymentRequest,
  type ReviewRequest,
  type Deps,
} from '../../functions/src/core';
import { AuthError, verifyIdToken, type Actor } from './auth';
import { customerMessageFor, notifyAdmins, notifyCustomer } from './fcm';
import { Firestore, createRestDeps } from './firestore-deps';
import { getAccessToken, parseServiceAccount } from './google-token';
import { archiveOldVisits, trackVisit, weekStartOf, type TrackBody } from './track';
import { istDay } from '@juicy/shared';

interface Env {
  FIREBASE_PROJECT_ID: string;
  ALLOWED_ORIGIN: string;
  SERVICE_ACCOUNT_JSON: string; // secret
  IMAGES: KVNamespace; // menu photos
}

const STATUS: Record<DomainErrorCode, number> = {
  shop_closed: 409,
  invalid_request: 400,
  invalid_item: 400,
  item_unavailable: 409,
  blocked: 403,
  too_many_orders: 429,
  invalid_transition: 409,
  reason_required: 400,
  not_found: 404,
  forbidden: 403,
  too_far: 409,
};

function cors(env: Env): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function json(env: Env, status: number, body: unknown, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...cors(env), ...extra },
  });
}

function errorResponse(env: Env, e: unknown): Response {
  if (e instanceof AuthError) return json(env, 401, { error: { code: 'unauthenticated', message: 'Please reload the app and try again.' } });
  if (e instanceof DomainError) {
    return json(env, STATUS[e.code] ?? 400, {
      error: { code: e.code, domainCode: e.code, message: e.message || USER_MESSAGES[e.code] },
    });
  }
  console.error('Unexpected error', e);
  return json(env, 500, { error: { code: 'internal', message: 'Something went wrong. Please try again.' } });
}

async function authenticate(request: Request, env: Env): Promise<Actor> {
  const header = request.headers.get('Authorization') ?? '';
  if (!header.startsWith('Bearer ')) throw new AuthError('Missing token');
  return verifyIdToken(header.slice(7), env.FIREBASE_PROJECT_ID);
}

async function context(env: Env) {
  const sa = parseServiceAccount(env.SERVICE_ACCOUNT_JSON);
  const accessToken = await getAccessToken(sa);
  const db = new Firestore(env.FIREBASE_PROJECT_ID, accessToken);
  return { db, deps: createRestDeps(db), accessToken };
}

async function readJson<T>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    throw new DomainError('invalid_request', 'Invalid request');
  }
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(env) });

    const path = new URL(request.url).pathname;

    // Public, cached menu photos: GET /img/<id>
    if (request.method === 'GET' && path.startsWith('/img/')) {
      // Only photo ids (UUIDs): never other stored data such as the weekly archive.
      if (!/^[0-9a-f-]{36}$/.test(path.slice(5))) return new Response('Not found', { status: 404, headers: cors(env) });
      const got = await env.IMAGES.getWithMetadata<{ type?: string }>(path.slice(5), 'arrayBuffer');
      if (!got.value) return new Response('Not found', { status: 404, headers: cors(env) });
      return new Response(got.value, {
        headers: {
          'Content-Type': got.metadata?.type ?? 'image/webp',
          'Cache-Control': 'public, max-age=31536000, immutable',
          'Access-Control-Allow-Origin': '*',
        },
      });
    }

    if (request.method !== 'POST') return json(env, 405, { error: { code: 'method', message: 'POST only' } });

    try {
      // Owner uploads a menu photo: POST /uploadImage (raw image bytes). Owner only.
      if (path === '/uploadImage') {
        const who = await authenticate(request, env);
        if (!who.isAdmin) throw new DomainError('forbidden', 'Owner only');
        const type = request.headers.get('Content-Type') ?? 'image/webp';
        if (!/^image\/(webp|jpeg|png)$/.test(type)) throw new DomainError('invalid_request', 'Unsupported image type');
        const bytes = await request.arrayBuffer();
        if (bytes.byteLength === 0 || bytes.byteLength > 1_000_000) throw new DomainError('invalid_request', 'Image too large');
        const id = crypto.randomUUID();
        await env.IMAGES.put(id, bytes, { metadata: { type } });
        return json(env, 200, { url: `${new URL(request.url).origin}/img/${id}` });
      }

      // Customer site activity (anonymous, no login). Never fails the page: always answers ok.
      if (path === '/track') {
        const text = await request.text();
        if (text.length > 20_000) return json(env, 200, { ok: true });
        let body: TrackBody = {};
        try {
          body = JSON.parse(text) as TrackBody;
        } catch {
          return json(env, 200, { ok: true });
        }
        const { db } = await context(env);
        await trackVisit(db, body, Date.now()).catch((e) => console.error('track failed', e));
        return json(env, 200, { ok: true });
      }

      // Login check and Google token are independent: run them at the same time.
      const t0 = Date.now();
      const [actor, { db, deps, accessToken }] = await Promise.all([authenticate(request, env), context(env)]);
      const now = Date.now();
      const setupMs = now - t0;

      // Customer allows notifications: remember this phone's push address.
      if (path === '/registerCustomerToken') {
        const body = await readJson<{ token?: string }>(request);
        const token = typeof body?.token === 'string' ? body.token : '';
        if (token.length < 20 || token.length > 4096) throw new DomainError('invalid_request', 'Invalid token');
        await db.set(`customerTokens/${encodeURIComponent(actor.uid)}`, { token, updatedAt: now });
        return json(env, 200, { ok: true });
      }

      if (path === '/placeOrder') {
        const body = await readJson<PlaceOrderRequest>(request);
        // Ring the owner's phone the moment the order is saved: no extra database read, and the
        // customer's reply is not delayed.
        // Start reading the owner devices now, in parallel with the order checks.
        const ownerDevices = db.list('adminTokens');
        ownerDevices.catch(() => undefined);
        let allocated = '';
        const withAlarm: Deps = {
          ...deps,
          async allocate() {
            const a = await deps.allocate();
            allocated = a.number;
            return a;
          },
          async saveOrder(order) {
            // Ring the owner's phone at the same moment the order is written (not after), to save a round trip.
            const ring = notifyAdmins(db, env.FIREBASE_PROJECT_ID, accessToken, {
              type: 'new_order',
              orderId: order.id,
              number: allocated,
              total: String((order as unknown as Record<string, unknown>)['total'] ?? ''),
              customer: order.customer?.name ?? '',
            }, ownerDevices).catch((e) => console.error('new_order notification failed', e));
            ctx.waitUntil(ring);
            try {
              await deps.saveOrder(order);
            } catch (e) {
              // The save failed after we already rang: silence the alarm again.
              ctx.waitUntil(
                ring.then(() => notifyAdmins(db, env.FIREBASE_PROJECT_ID, accessToken, { type: 'order_closed', orderId: order.id })).catch(() => undefined),
              );
              throw e;
            }
          },
        };
        const result = await placeOrderCore(withAlarm, actor.uid, body, now);
        const orderMs = Date.now() - now;
        console.log('placeOrder timing ms', { setup: setupMs, order: orderMs });
        return json(env, 200, result, { 'Server-Timing': `setup;dur=${setupMs}, order;dur=${orderMs}, total;dur=${setupMs + orderMs}` });
      }

      if (path === '/claimPayment') {
        const body = await readJson<ClaimPaymentRequest>(request);
        return json(env, 200, await claimPaymentCore(deps, actor, body, now));
      }

      if (path === '/submitReview') {
        const body = await readJson<ReviewRequest>(request);
        return json(env, 200, await submitReviewCore(deps, actor, body, now));
      }

      if (path === '/loyalty') {
        const body = await readJson<{ phone?: string }>(request);
        return json(env, 200, await loyaltyPreviewCore(deps, body?.phone));
      }

      if (path === '/markPaid') {
        const body = await readJson<MarkPaidRequest>(request);
        const res = await markPaidCore(deps, actor, body, now);
        return json(env, 200, res);
      }

      if (path === '/changeOrderStatus') {
        const body = await readJson<ChangeStatusRequest>(request);
        const { order, previous } = await changeStatusCore(deps, actor, body, now);
        if (previous === 'pending' && order.status !== 'pending') {
          ctx.waitUntil(
            notifyAdmins(db, env.FIREBASE_PROJECT_ID, accessToken, { type: 'order_closed', orderId: order.id }).catch(
              (e) => console.error('order_closed notification failed', e),
            ),
          );
        }
        // Tell the customer's phone about the cafe's decision (not for their own cancellation).
        if (actor.isAdmin) {
          const msg = customerMessageFor(order.status, order.number, order.id, order.rejectReason, order.orderType === 'dine_in');
          if (msg) {
            ctx.waitUntil(
              notifyCustomer(db, env.FIREBASE_PROJECT_ID, accessToken, order.customerUid, msg).catch((e) =>
                console.error('customer notification failed', e),
              ),
            );
          }
        }
        return json(env, 200, { status: order.status });
      }

      return json(env, 404, { error: { code: 'not_found', message: 'Not found' } });
    } catch (e) {
      return errorResponse(env, e);
    }
  },

  /** Every minute: expire unanswered orders and silence the alarm. */
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      (async () => {
        const { db, deps, accessToken } = await context(env);
        const expired = await expirePendingCore(deps, Date.now());
        for (const orderId of expired) {
          // Tell the customer too (best effort).
          const o = await db.get(`orders/${orderId}`).catch(() => null);
          if (o && typeof o['customerUid'] === 'string') {
            const msg = customerMessageFor('expired', String(o['number'] ?? ''), orderId);
            if (msg) await notifyCustomer(db, env.FIREBASE_PROJECT_ID, accessToken, o['customerUid'] as string, msg).catch(() => undefined);
          }
          await notifyAdmins(db, env.FIREBASE_PROJECT_ID, accessToken, { type: 'order_closed', orderId }).catch((e) =>
            console.error('order_closed notification failed', e),
          );
        }
        if (expired.length) console.log('Expired unanswered orders', expired);

        // Monday ~3 am (India): pack last week's raw visit data into a small archive and free the space.
        const nowMs = Date.now();
        const ist = new Date(nowMs + 5.5 * 3600_000);
        if (ist.getUTCDay() === 1 && ist.getUTCHours() === 3 && ist.getUTCMinutes() < 10) {
          const last = await db.get('meta/rollup');
          if (last?.['lastWeek'] !== istDay(weekStartOf(nowMs))) {
            const n = await archiveOldVisits(db, env.IMAGES, nowMs);
            console.log('Archived visits', n);
          }
        }
      })().catch((e) => console.error('cron failed', e)),
    );
  },
};
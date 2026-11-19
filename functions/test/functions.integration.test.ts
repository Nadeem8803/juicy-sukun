/**
 * End-to-end tests of the real Cloud Functions + Firestore + Auth, running in the Firebase emulators:
 *   npm run test:integration   (from the repo root)
 *
 * Every test uses a brand-new anonymous customer so tests cannot affect each other.
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { initializeApp as initAdminApp } from 'firebase-admin/app';
import { getAuth as getAdminAuth } from 'firebase-admin/auth';
import { getFirestore as getAdminFirestore } from 'firebase-admin/firestore';
import { initializeApp, type FirebaseApp } from 'firebase/app';
import {
  connectAuthEmulator,
  getAuth,
  signInAnonymously,
  signInWithEmailAndPassword,
} from 'firebase/auth';
import { connectFirestoreEmulator, doc, getDoc, getFirestore } from 'firebase/firestore';
import { connectFunctionsEmulator, getFunctions, httpsCallable } from 'firebase/functions';
import {
  DEFAULT_PRIVATE_CONFIG,
  DEFAULT_PUBLIC_CONFIG,
  MENU_SEED,
  type Order,
  type PlaceOrderRequest,
} from '@juicy/shared';

const PROJECT = 'demo-juicysukun';
process.env['GCLOUD_PROJECT'] = PROJECT;
process.env['FIRESTORE_EMULATOR_HOST'] ??= '127.0.0.1:8080';
process.env['FIREBASE_AUTH_EMULATOR_HOST'] ??= '127.0.0.1:9099';

const adminApp = initAdminApp({ projectId: PROJECT }, 'admin-sdk');
const adb = getAdminFirestore(adminApp);
const aauth = getAdminAuth(adminApp);

const OWNER_EMAIL = 'owner@juicysukun.test';
const OWNER_PASSWORD = 'owner-password-1';
let n = 0;

interface Client {
  app: FirebaseApp;
  uid: string;
  call: <T = unknown>(name: string, data?: unknown) => Promise<T>;
  getOrder: (id: string) => Promise<Order | null>;
}

async function makeClient(kind: 'customer' | 'owner' | 'signedOut'): Promise<Client> {
  const app = initializeApp({ apiKey: 'demo', projectId: PROJECT, authDomain: 'localhost' }, `c${n++}`);
  const auth = getAuth(app);
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  if (kind === 'customer') await signInAnonymously(auth);
  if (kind === 'owner') await signInWithEmailAndPassword(auth, OWNER_EMAIL, OWNER_PASSWORD);
  const fns = getFunctions(app, 'asia-south1');
  connectFunctionsEmulator(fns, '127.0.0.1', 5001);
  const fs = getFirestore(app);
  connectFirestoreEmulator(fs, '127.0.0.1', 8080);
  return {
    app,
    uid: auth.currentUser?.uid ?? '',
    call: async <T>(name: string, data?: unknown) => (await httpsCallable(fns, name)(data)).data as T,
    getOrder: async (id) => {
      const snap = await getDoc(doc(fs, 'orders', id));
      return snap.exists() ? (snap.data() as Order) : null;
    },
  };
}

async function expectCallError(p: Promise<unknown>): Promise<{ code: string; domainCode?: string }> {
  try {
    await p;
  } catch (e) {
    const err = e as { code: string; details?: { domainCode?: string } };
    return { code: err.code, domainCode: err.details?.domainCode };
  }
  throw new Error('Expected the call to fail, but it succeeded');
}

const request = (over: Partial<PlaceOrderRequest> = {}): PlaceOrderRequest => ({
  lines: [{ itemId: 'pizza-veg-choice-pizza', sizeIndex: 1, qty: 2 }], // 2 x ₹269 = ₹538, free delivery
  customer: { name: 'Ayesha Shaikh', phone: '9876543210', address: 'Near bus stand, Akkalkot' },
  location: { lat: 17.5236, lng: 76.2043 },
  ...over,
});

async function setShop(open: boolean) {
  await adb.doc('shop/status').set({ open, updatedAt: Date.now() });
}

beforeAll(async () => {
  await Promise.all(MENU_SEED.map(({ id, ...data }) => adb.doc(`menu/${id}`).set(data)));
  await adb.doc('config/public').set(DEFAULT_PUBLIC_CONFIG);
  await adb.doc('config/private').set({ ...DEFAULT_PRIVATE_CONFIG, cafePhone: '9000000000', cafeAddress: 'Akkalkot', fssai: '12345678901234' });
  try {
    const user = await aauth.createUser({ email: OWNER_EMAIL, password: OWNER_PASSWORD });
    await aauth.setCustomUserClaims(user.uid, { admin: true });
  } catch (e) {
    if ((e as { code?: string }).code !== 'auth/email-already-exists') throw e;
  }
});

beforeEach(async () => {
  await setShop(true);
  const blocked = await adb.collection('blockedPhones').listDocuments();
  await Promise.all(blocked.map((d) => d.delete()));
});

describe('placing an order', () => {
  it('rings in a pending order with server-side prices', async () => {
    const c = await makeClient('customer');
    const { orderId, number } = await c.call<{ orderId: string; number: string }>('placeOrder', {
      ...request(),
      // a cheeky client sends its own price: it must be ignored
      lines: [{ itemId: 'pizza-veg-choice-pizza', sizeIndex: 1, qty: 2, price: 1 }],
    });
    expect(number).toMatch(/^JS-\d+$/);
    const order = (await adb.doc(`orders/${orderId}`).get()).data() as Order;
    expect(order).toMatchObject({ status: 'pending', subtotal: 538, deliveryFee: 0, total: 538, paymentMethod: 'COD', customerUid: c.uid });
    expect(order.invoice).toBeUndefined();
  });

  it('charges ₹39 delivery under ₹300', async () => {
    const c = await makeClient('customer');
    const { orderId } = await c.call<{ orderId: string }>('placeOrder', request({ lines: [{ itemId: 'drinks-blue-mint', sizeIndex: 0, qty: 1 }] }));
    expect((await adb.doc(`orders/${orderId}`).get()).data()).toMatchObject({ subtotal: 80, deliveryFee: 39, total: 119 });
  });

  it('refuses while the shop is closed', async () => {
    await setShop(false);
    const c = await makeClient('customer');
    const err = await expectCallError(c.call('placeOrder', request()));
    expect(err).toEqual({ code: 'functions/failed-precondition', domainCode: 'shop_closed' });
  });

  it('refuses when nobody is signed in', async () => {
    const c = await makeClient('signedOut');
    expect((await expectCallError(c.call('placeOrder', request()))).code).toBe('functions/unauthenticated');
  });

  it('refuses a bad phone number and an unknown item', async () => {
    const c = await makeClient('customer');
    const bad = request({ customer: { name: 'Ayesha', phone: '12345', address: 'Near bus stand, Akkalkot' } });
    expect((await expectCallError(c.call('placeOrder', bad))).domainCode).toBe('invalid_request');
    const ghost = request({ lines: [{ itemId: 'ghost', sizeIndex: 0, qty: 1 }] });
    expect((await expectCallError(c.call('placeOrder', ghost))).domainCode).toBe('invalid_item');
  });

  it('refuses a blocked number', async () => {
    await adb.doc('blockedPhones/9876543210').set({ at: Date.now() });
    const c = await makeClient('customer');
    expect((await expectCallError(c.call('placeOrder', request()))).domainCode).toBe('blocked');
  });

  it('allows only two waiting orders per customer', async () => {
    const c = await makeClient('customer');
    await c.call('placeOrder', request());
    await c.call('placeOrder', request());
    expect((await expectCallError(c.call('placeOrder', request()))).domainCode).toBe('too_many_orders');
  });
});

describe('who can see an order', () => {
  it('the customer sees their own order; another customer and the public do not', async () => {
    const mine = await makeClient('customer');
    const { orderId } = await mine.call<{ orderId: string }>('placeOrder', request());
    expect((await mine.getOrder(orderId))?.status).toBe('pending');

    const stranger = await makeClient('customer');
    await expect(stranger.getOrder(orderId)).rejects.toMatchObject({ code: 'permission-denied' });
    const signedOut = await makeClient('signedOut');
    await expect(signedOut.getOrder(orderId)).rejects.toMatchObject({ code: 'permission-denied' });
  });
});

describe('the owner works an order', () => {
  it('accepting shows the cafe phone and invoice details to the customer only after that', async () => {
    const customer = await makeClient('customer');
    const owner = await makeClient('owner');
    const { orderId } = await customer.call<{ orderId: string }>('placeOrder', request());
    expect((await customer.getOrder(orderId))?.invoice).toBeUndefined();

    await owner.call('changeOrderStatus', { orderId, status: 'accepted' });
    const accepted = await customer.getOrder(orderId);
    expect(accepted?.status).toBe('accepted');
    expect(accepted?.invoice).toMatchObject({ cafePhone: '9000000000', cafeName: 'Juicysukun Café' });
  });

  it('walks accepted → preparing → out for delivery → delivered', async () => {
    const customer = await makeClient('customer');
    const owner = await makeClient('owner');
    const { orderId } = await customer.call<{ orderId: string }>('placeOrder', request());
    for (const status of ['accepted', 'preparing', 'out_for_delivery', 'delivered']) {
      await owner.call('changeOrderStatus', { orderId, status });
    }
    const done = await customer.getOrder(orderId);
    expect(done?.status).toBe('delivered');
    expect(done?.history.map((h) => h.status)).toEqual(['pending', 'accepted', 'preparing', 'out_for_delivery', 'delivered']);
  });

  it('rejecting needs a reason, and the customer can read it', async () => {
    const customer = await makeClient('customer');
    const owner = await makeClient('owner');
    const { orderId } = await customer.call<{ orderId: string }>('placeOrder', request());

    expect((await expectCallError(owner.call('changeOrderStatus', { orderId, status: 'rejected' }))).domainCode).toBe('reason_required');
    await owner.call('changeOrderStatus', { orderId, status: 'rejected', reason: 'Item out of stock' });
    expect(await customer.getOrder(orderId)).toMatchObject({ status: 'rejected', rejectReason: 'Item out of stock' });
  });

  it('cannot skip steps or reopen a finished order', async () => {
    const customer = await makeClient('customer');
    const owner = await makeClient('owner');
    const { orderId } = await customer.call<{ orderId: string }>('placeOrder', request());
    expect((await expectCallError(owner.call('changeOrderStatus', { orderId, status: 'delivered' }))).domainCode).toBe('invalid_transition');
    await owner.call('changeOrderStatus', { orderId, status: 'rejected', reason: 'Closing soon' });
    expect((await expectCallError(owner.call('changeOrderStatus', { orderId, status: 'accepted' }))).domainCode).toBe('invalid_transition');
  });

  it('a customer cannot accept their own order', async () => {
    const customer = await makeClient('customer');
    const { orderId } = await customer.call<{ orderId: string }>('placeOrder', request());
    expect((await expectCallError(customer.call('changeOrderStatus', { orderId, status: 'accepted' }))).domainCode).toBe('forbidden');
  });
});

describe('cancelling', () => {
  it('a customer can cancel while the order is still waiting', async () => {
    const customer = await makeClient('customer');
    const { orderId } = await customer.call<{ orderId: string }>('placeOrder', request());
    await customer.call('changeOrderStatus', { orderId, status: 'cancelled' });
    expect(await customer.getOrder(orderId)).toMatchObject({ status: 'cancelled', rejectReason: 'Cancelled by customer' });
  });

  it('but not after the owner accepted', async () => {
    const customer = await makeClient('customer');
    const owner = await makeClient('owner');
    const { orderId } = await customer.call<{ orderId: string }>('placeOrder', request());
    await owner.call('changeOrderStatus', { orderId, status: 'accepted' });
    expect((await expectCallError(customer.call('changeOrderStatus', { orderId, status: 'cancelled' }))).domainCode).toBe('forbidden');
  });

  it("a customer cannot cancel someone else's order", async () => {
    const a = await makeClient('customer');
    const b = await makeClient('customer');
    const { orderId } = await a.call<{ orderId: string }>('placeOrder', request());
    expect((await expectCallError(b.call('changeOrderStatus', { orderId, status: 'cancelled' }))).domainCode).toBe('forbidden');
  });
});

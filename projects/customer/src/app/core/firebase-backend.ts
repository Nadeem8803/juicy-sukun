import { initializeApp, type FirebaseApp } from 'firebase/app';
import { connectAuthEmulator, getAuth, signInAnonymously, type Auth } from 'firebase/auth';
import {
  collection,
  connectFirestoreEmulator,
  doc,
  initializeFirestore,
  limit,
  onSnapshot,
  persistentLocalCache,
  persistentMultipleTabManager,
  query,
  where,
  type Firestore,
} from 'firebase/firestore';
import {
  DEFAULT_PUBLIC_CONFIG,
  DomainError,
  type DomainErrorCode,
  type MenuItem,
  type Offer,
  type Order,
  type PlaceOrderRequest,
  type PlaceOrderResult,
  type PublicConfig,
  type ShopStatus,
  type PublicReview,
} from '@juicy/shared';
import type { CustomerBackend } from './backend';
import { EMULATOR_CONFIG, FIREBASE_CONFIG, useEmulators } from './firebase-config';

/** The free Cloudflare Worker that replaced the Cloud Functions. */
const WORKER_URL = 'https://juicysukun-api.juicysukun.workers.dev';

/** Web Push public key (Firebase console > Cloud Messaging > Web Push certificates). Public, not a secret. */
const VAPID_KEY = 'BKftAitsd7vwem-zGCdzBTPFIFPeRWW_D3GC2-R3-WCImL_IxVDxs6ULNAHvdu0aWFh_BBUDVa8Alx3TeNRdcWg';

/** Calls the Worker with the signed-in user's ID token. Business-rule errors carry a `domainCode`. */
async function callWorker<T>(auth: Auth, path: string, body: unknown): Promise<T> {
  const user = auth.currentUser;
  if (!user) throw new Error('network');
  const token = await user.getIdToken();
  let res: Response;
  try {
    res = await fetch(`${WORKER_URL}/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error('network');
  }
  let data: any = null;
  try {
    data = await res.json();
  } catch {
    /* non-JSON body */
  }
  if (!res.ok) {
    const code = data?.domainCode ?? data?.error?.domainCode;
    const message = data?.message ?? data?.error?.message ?? (typeof data?.error === 'string' ? data.error : '');
    if (code) throw new DomainError(code as DomainErrorCode, message || String(code));
    throw new Error(message || `http_${res.status}`);
  }
  return data as T;
}

/** Kept for the rest of the app: passes DomainErrors through and maps everything else to a plain Error. */
export function toDomainError(e: unknown): Error {
  return e instanceof Error ? e : new Error(String(e));
}

export class FirebaseBackend implements CustomerBackend {
  private readonly db: Firestore;
  private readonly auth: Auth;
  private readonly ready: Promise<void>;
  private readonly app: FirebaseApp;

  constructor() {
    const emulate = useEmulators();
    const app = initializeApp(emulate ? EMULATOR_CONFIG : FIREBASE_CONFIG);
    this.app = app;
    this.auth = getAuth(app);
    this.db = emulate
      ? initializeFirestore(app, {})
      : initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });
    if (emulate) {
      connectAuthEmulator(this.auth, 'http://127.0.0.1:9099', { disableWarnings: true });
      connectFirestoreEmulator(this.db, '127.0.0.1', 8080);
    }
    // Anonymous sign-in: no OTP, no password. The uid is what ties an order to this phone.
    this.ready = signInAnonymously(this.auth).then(() => undefined);
    this.ready.catch(() => undefined);
  }

  watchMenu(cb: (items: MenuItem[]) => void): () => void {
    return onSnapshot(collection(this.db, 'menu'), (snap) => {
      const items = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<MenuItem, 'id'>) }));
      cb(items.sort((a, b) => a.sort - b.sort));
    });
  }

  watchShop(cb: (shop: ShopStatus) => void): () => void {
    // A missing document means "closed": never assume the cafe is open.
    return onSnapshot(doc(this.db, 'shop/status'), (snap) => cb(snap.exists() ? (snap.data() as ShopStatus) : { open: false }));
  }

  watchConfig(cb: (cfg: PublicConfig) => void): () => void {
    return onSnapshot(doc(this.db, 'config/public'), (snap) =>
      cb({ ...DEFAULT_PUBLIC_CONFIG, ...(snap.exists() ? (snap.data() as Partial<PublicConfig>) : {}) }),
    );
  }

  async placeOrder(req: PlaceOrderRequest): Promise<PlaceOrderResult> {
    await this.ready;
    try {
      return await callWorker<PlaceOrderResult>(this.auth, 'placeOrder', req);
    } catch (e) {
      throw toDomainError(e);
    }
  }

  watchOrder(id: string, cb: (order: Order | null) => void): () => void {
    let off: (() => void) | null = null;
    let cancelled = false;
    this.ready
      .then(() => {
        if (cancelled) return;
        off = onSnapshot(
          doc(this.db, 'orders', id),
          (snap) => cb(snap.exists() ? ({ ...(snap.data() as Omit<Order, 'id'>), id: snap.id } as Order) : null),
          () => cb(null),
        );
      })
      .catch(() => cb(null));
    return () => {
      cancelled = true;
      off?.();
    };
  }

  async enablePush(): Promise<boolean> {
    try {
      if (useEmulators() || !('serviceWorker' in navigator) || !('Notification' in window)) return false;
      if (Notification.permission === 'default') {
        if ((await Notification.requestPermission()) !== 'granted') return false;
      } else if (Notification.permission !== 'granted') {
        return false;
      }
      const { getMessaging, getToken, isSupported } = await import('firebase/messaging');
      if (!(await isSupported())) return false;
      const registration = await navigator.serviceWorker.ready;
      const token = await getToken(getMessaging(this.app), { vapidKey: VAPID_KEY, serviceWorkerRegistration: registration });
      if (!token) return false;
      await this.ready;
      await callWorker(this.auth, 'registerCustomerToken', { token });
      return true;
    } catch (e) {
      console.warn('Could not enable notifications', e);
      return false;
    }
  }

  async claimPayment(orderId: string): Promise<void> {
    await this.ready;
    try {
      await callWorker(this.auth, 'claimPayment', { orderId, action: 'claim' });
    } catch (e) {
      throw toDomainError(e);
    }
  }

  async submitReview(orderId: string, rating: number, comment: string): Promise<void> {
    await this.ready;
    try {
      await callWorker(this.auth, 'submitReview', { orderId, rating, comment });
    } catch (e) {
      throw toDomainError(e);
    }
  }

  async loyaltyPercent(phone: string): Promise<{ percent: number; orders: number }> {
    try {
      await this.ready;
      return await callWorker<{ percent: number; orders: number }>(this.auth, 'loyalty', { phone });
    } catch {
      return { percent: 0, orders: 0 };
    }
  }

  watchOffers(cb: (offers: Offer[]) => void): () => void {
    return onSnapshot(
      collection(this.db, 'offers'),
      (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Offer, 'id'>) })).sort((a, b) => a.sort - b.sort)),
      () => cb([]),
    );
  }

  watchReviews(cb: (reviews: PublicReview[]) => void): () => void {
    return onSnapshot(
      query(collection(this.db, 'reviews'), where('public', '==', true), limit(200)),
      (snap) => cb(snap.docs.map((d) => ({ ...(d.data() as Omit<PublicReview, 'id'>), id: d.id })).sort((a, b) => b.at - a.at)),
      () => cb([]),
    );
  }

  track(body: unknown): void {
    if (useEmulators()) return;
    try {
      void fetch(`${WORKER_URL}/track`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        keepalive: true,
      }).catch(() => undefined);
    } catch {
      /* tracking must never break the app */
    }
  }

  async cancelOrder(id: string): Promise<void> {
    await this.ready;
    try {
      await callWorker(this.auth, 'changeOrderStatus', { orderId: id, status: 'cancelled' });
    } catch (e) {
      throw toDomainError(e);
    }
  }
}
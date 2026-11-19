import { initializeApp } from 'firebase/app';
import {
  connectAuthEmulator,
  getAuth,
  indexedDBLocalPersistence,
  initializeAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  type Auth,
} from 'firebase/auth';
import {
  collection,
  connectFirestoreEmulator,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  initializeFirestore,
  limit,
  updateDoc,
  where,
  onSnapshot,
  orderBy,
  persistentLocalCache,
  query,
  setDoc,
  type Firestore,
} from 'firebase/firestore';
import {
  DEFAULT_CONFIG,
  DEFAULT_PRIVATE_CONFIG,
  DEFAULT_PUBLIC_CONFIG,
  DomainError,
  type AppConfig,
  type CustomerRecord,
  type DailyStats,
  type DomainErrorCode,
  type Expense,
  type Offer,
  type MenuItem,
  type Order,
  type OrderStatus,
  type PayMethod,
  type ShopStatus,
  type PublicReview,
} from '@juicy/shared';
import type { AdminBackend, AdminUser } from './backend';
import { EMULATOR_CONFIG, FIREBASE_CONFIG, useEmulators } from './firebase-config';

/** The free Cloudflare Worker that replaced the Cloud Functions. */
const WORKER_URL = 'https://juicysukun-api.juicysukun.workers.dev';

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

export class NotAdminError extends Error {
  constructor() {
    super('not_admin');
  }
}

/** Removes `undefined` (Firestore rejects it) so optional fields can simply be left out. */
function clean<T extends object>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
}

export class FirebaseAdminBackend implements AdminBackend {
  private readonly auth: Auth;
  private readonly db: Firestore;

  constructor() {
    const emulate = useEmulators();
    const app = initializeApp(emulate ? EMULATOR_CONFIG : FIREBASE_CONFIG);
    this.auth = emulate ? getAuth(app) : initializeAuth(app, { persistence: indexedDBLocalPersistence });
    this.db = emulate ? initializeFirestore(app, {}) : initializeFirestore(app, { localCache: persistentLocalCache() });
    if (emulate) {
      connectAuthEmulator(this.auth, 'http://127.0.0.1:9099', { disableWarnings: true });
      connectFirestoreEmulator(this.db, '127.0.0.1', 8080);
    }
  }

  private async isOwner(): Promise<boolean> {
    const u = this.auth.currentUser;
    if (!u) return false;
    return (await u.getIdTokenResult()).claims['admin'] === true;
  }

  onAuth(cb: (user: AdminUser | null) => void): () => void {
    return onAuthStateChanged(this.auth, async (u) => {
      if (!u) return cb(null);
      try {
        if (await this.isOwner()) return cb({ email: u.email ?? '' });
        await signOut(this.auth); // a customer/anonymous/other account must never see the admin app
        cb(null);
      } catch {
        // offline at startup: trust the cached token rather than locking the owner out
        cb({ email: u.email ?? '' });
      }
    });
  }

  async signIn(email: string, password: string): Promise<void> {
    await signInWithEmailAndPassword(this.auth, email.trim(), password);
    await this.auth.currentUser?.getIdToken(true);
    if (!(await this.isOwner())) {
      await signOut(this.auth);
      throw new NotAdminError();
    }
  }

  signOut(): Promise<void> {
    return signOut(this.auth);
  }

  watchOrders(cb: (orders: Order[], fromServer: boolean) => void, onError?: (e: unknown) => void): () => void {
    const q = query(collection(this.db, 'orders'), orderBy('createdAt', 'desc'), limit(150));
    return onSnapshot(
      q,
      { includeMetadataChanges: true },
      (snap) => cb(snap.docs.map((d) => ({ ...(d.data() as Omit<Order, 'id'>), id: d.id })), !snap.metadata.fromCache),
      (e) => onError?.(e),
    );
  }

  async changeStatus(orderId: string, status: OrderStatus, reason?: string, readyInMin?: number): Promise<void> {
    await callWorker(this.auth, 'changeOrderStatus', { orderId, status, ...(reason ? { reason } : {}), ...(readyInMin ? { readyInMin } : {}) });
  }

  async markPaid(orderId: string, method: PayMethod, via?: 'sms'): Promise<void> {
    await callWorker(this.auth, 'markPaid', { orderId, method, ...(via ? { via } : {}) });
  }

  async dismissClaim(orderId: string): Promise<void> {
    await callWorker(this.auth, 'claimPayment', { orderId, action: 'dismiss' });
  }

  async loadOrdersSince(since: number): Promise<Order[]> {
    const q = query(collection(this.db, 'orders'), where('createdAt', '>=', since), orderBy('createdAt', 'desc'), limit(3000));
    const snap = await getDocs(q);
    return snap.docs.map((d) => ({ ...(d.data() as Omit<Order, 'id'>), id: d.id }));
  }

  watchExpenses(cb: (items: Expense[]) => void): () => void {
    const q = query(collection(this.db, 'expenses'), orderBy('at', 'desc'), limit(500));
    return onSnapshot(q, (snap) => cb(snap.docs.map((d) => ({ ...(d.data() as Omit<Expense, 'id'>), id: d.id }))));
  }
  saveExpense(e: Expense): Promise<void> {
    const { id, ...data } = e;
    return setDoc(doc(this.db, 'expenses', id), clean(data));
  }
  deleteExpense(id: string): Promise<void> {
    return deleteDoc(doc(this.db, 'expenses', id));
  }

  async loadDaily(days: number): Promise<DailyStats[]> {
    const snap = await getDocs(query(collection(this.db, 'daily'), orderBy('day', 'desc'), limit(days)));
    return snap.docs.map((d) => ({ ...(d.data() as DailyStats), day: d.id }));
  }

  async loadCustomers(): Promise<CustomerRecord[]> {
    const snap = await getDocs(query(collection(this.db, 'customers'), orderBy('lastAt', 'desc'), limit(2000)));
    return snap.docs.map((d) => ({ orders: 0, placed: 0, spent: 0, firstAt: 0, lastAt: 0, optIn: false, name: '', ...(d.data() as object), phone: d.id }) as CustomerRecord);
  }

  watchOffers(cb: (items: Offer[]) => void): () => void {
    return onSnapshot(collection(this.db, 'offers'), (snap) =>
      cb(snap.docs.map((d) => ({ ...(d.data() as Omit<Offer, 'id'>), id: d.id })).sort((a, b) => a.sort - b.sort)),
    );
  }
  watchReviews(cb: (items: PublicReview[]) => void): () => void {
    return onSnapshot(collection(this.db, 'reviews'), (snap) => cb(snap.docs.map((d) => ({ ...(d.data() as Omit<PublicReview, 'id'>), id: d.id }))));
  }
  setReviewPublic(order: Order, on: boolean): Promise<void> {
    const r = order.review;
    if (!r) return Promise.resolve();
    const first = order.customer.name.trim().split(/\s+/)[0]?.slice(0, 20) || 'Customer';
    return setDoc(doc(this.db, 'reviews', order.id), clean({ name: first, rating: r.rating, comment: r.comment, at: r.at, public: on }));
  }
  saveOffer(o: Offer): Promise<void> {
    const { id, ...data } = o;
    return setDoc(doc(this.db, 'offers', id), clean({ ...data, imageUrl: data.imageUrl ?? null }));
  }
  deleteOffer(id: string): Promise<void> {
    return deleteDoc(doc(this.db, 'offers', id));
  }

  setAvailable(itemId: string, available: boolean): Promise<void> {
    return updateDoc(doc(this.db, 'menu', itemId), { available });
  }

  watchMenu(cb: (items: MenuItem[]) => void): () => void {
    return onSnapshot(collection(this.db, 'menu'), (snap) =>
      cb(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<MenuItem, 'id'>) })).sort((a, b) => a.sort - b.sort)),
    );
  }

  async saveItem(item: MenuItem): Promise<void> {
    const { id, ...data } = item;
    await setDoc(doc(this.db, 'menu', id), clean({ ...data, imageUrl: data.imageUrl ?? null }));
  }

  deleteItem(id: string): Promise<void> {
    return deleteDoc(doc(this.db, 'menu', id));
  }

  /** Photos live on the free Cloudflare Worker (no Firebase Storage / Blaze plan needed). */
  async uploadImage(_itemId: string, image: Blob): Promise<string> {
    const user = this.auth.currentUser;
    if (!user) throw new Error('network');
    const token = await user.getIdToken();
    let res: Response;
    try {
      res = await fetch(`${WORKER_URL}/uploadImage`, {
        method: 'POST',
        headers: { 'Content-Type': image.type || 'image/webp', Authorization: `Bearer ${token}` },
        body: image,
      });
    } catch {
      throw new Error('network');
    }
    const data: any = await res.json().catch(() => null);
    if (!res.ok || !data?.url) throw new Error(data?.error?.message ?? `http_${res.status}`);
    return data.url as string;
  }

  watchShop(cb: (s: ShopStatus) => void): () => void {
    return onSnapshot(doc(this.db, 'shop/status'), (s) => cb(s.exists() ? (s.data() as ShopStatus) : { open: false }));
  }

  setShop(open: boolean, message?: string): Promise<void> {
    return setDoc(doc(this.db, 'shop/status'), clean({ open, message: message?.trim() || undefined, updatedAt: Date.now() }));
  }

  async loadConfig(): Promise<AppConfig> {
    const [pub, priv] = await Promise.all([getDoc(doc(this.db, 'config/public')), getDoc(doc(this.db, 'config/private'))]);
    return {
      ...DEFAULT_CONFIG,
      ...(pub.exists() ? (pub.data() as object) : DEFAULT_PUBLIC_CONFIG),
      ...(priv.exists() ? (priv.data() as object) : DEFAULT_PRIVATE_CONFIG),
    };
  }

  async saveConfig(c: AppConfig): Promise<void> {
    await Promise.all([
      setDoc(doc(this.db, 'config/public'), {
        cafeName: c.cafeName,
        freeDeliveryMin: c.freeDeliveryMin,
        deliveryFee: c.deliveryFee,
        maxLines: c.maxLines,
        maxQtyPerLine: c.maxQtyPerLine,
        tableCount: c.tableCount,
        upiEnabled: c.upiEnabled === true,
        upiId: (c.upiId ?? '').trim(),
        upiName: (c.upiName ?? '').trim() || 'Juicysukun Cafe',
        loyaltyEnabled: c.loyaltyEnabled === true,
        loyaltyAfter: c.loyaltyAfter,
        loyaltyPercent: c.loyaltyPercent,
        upiPaise: c.upiPaise === true,
        busyMode: c.busyMode === true,
        deliveryMaxKm: Number.isFinite(c.deliveryMaxKm) ? Math.max(0, Math.min(500, c.deliveryMaxKm)) : 0,
        cafeLat: Number.isFinite(c.cafeLat) ? c.cafeLat : 0,
        cafeLng: Number.isFinite(c.cafeLng) ? c.cafeLng : 0,
        busyExtraMin: Number.isFinite(c.busyExtraMin) ? Math.max(0, Math.min(120, Math.round(c.busyExtraMin))) : 10,
      }),
      setDoc(doc(this.db, 'config/private'), {
        cafePhone: c.cafePhone,
        cafeAddress: c.cafeAddress,
        fssai: c.fssai,
        orderTimeoutMinutes: c.orderTimeoutMinutes,
      }),
    ]);
  }

  async registerToken(token: string): Promise<void> {
    await setDoc(doc(this.db, 'adminTokens', token), { uid: this.auth.currentUser?.uid ?? '', updatedAt: Date.now() });
  }
}
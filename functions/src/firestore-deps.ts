import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import {
  DEFAULT_PRIVATE_CONFIG,
  DEFAULT_PUBLIC_CONFIG,
  DomainError,
  type AppConfig,
  type MenuItem,
  type Order,
  type ShopStatus,
} from '@juicy/shared';
import type { Deps } from './core';

/** Firestore-backed implementation of Deps (admin SDK, so it bypasses security rules). */
export function createFirestoreDeps(db: Firestore = getFirestore()): Deps {
  const orders = db.collection('orders');

  return {
    async getShop(): Promise<ShopStatus> {
      const snap = await db.doc('shop/status').get();
      // No document yet means the owner has never gone online: treat as closed.
      return snap.exists ? (snap.data() as ShopStatus) : { open: false };
    },

    async getMenu(): Promise<MenuItem[]> {
      const snap = await db.collection('menu').get();
      return snap.docs.map((d) => ({ ...(d.data() as Omit<MenuItem, 'id'>), id: d.id }));
    },

    async getConfig(): Promise<AppConfig> {
      const [pub, priv] = await Promise.all([db.doc('config/public').get(), db.doc('config/private').get()]);
      return {
        ...DEFAULT_PUBLIC_CONFIG,
        ...DEFAULT_PRIVATE_CONFIG,
        ...(pub.data() ?? {}),
        ...(priv.data() ?? {}),
      } as AppConfig;
    },

    async isPhoneBlocked(phone: string): Promise<boolean> {
      return (await db.doc(`blockedPhones/${phone}`).get()).exists;
    },

    async countPendingOrders(uid: string): Promise<number> {
      const snap = await orders.where('customerUid', '==', uid).where('status', '==', 'pending').count().get();
      return snap.data().count;
    },

    async allocate() {
      const counterRef = db.doc('meta/counters');
      const n = await db.runTransaction(async (t) => {
        const snap = await t.get(counterRef);
        const next = ((snap.data()?.['order'] as number | undefined) ?? 1000) + 1;
        t.set(counterRef, { order: next }, { merge: true });
        return next;
      });
      return { id: orders.doc().id, number: `JS-${n}` };
    },

    async saveOrder(order: Order): Promise<void> {
      await orders.doc(order.id).set(order);
    },

    async updateOrder(orderId, compute) {
      const ref = orders.doc(orderId);
      return db.runTransaction(async (t) => {
        const snap = await t.get(ref);
        if (!snap.exists) throw new DomainError('not_found', 'Order not found');
        const current = snap.data() as Order;
        const patch = compute(current);
        t.update(ref, patch as Record<string, unknown>);
        return { ...current, ...patch } as Order;
      });
    },

    async listPendingOrders(): Promise<Order[]> {
      const snap = await orders.where('status', '==', 'pending').get();
      return snap.docs.map((d) => d.data() as Order);
    },
  };
}

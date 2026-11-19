import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { isTerminal, type CustomerInfo, type GeoPoint, type OrderStatus, type PlaceOrderResult } from '@juicy/shared';
import { BACKEND } from './backend';
import { Cart } from './cart';
import { readJson, writeJson } from './storage';

export interface Profile {
  name: string;
  phone: string;
  address: string;
  landmark: string;
}

const PROFILE_KEY = 'js.profile.v1';
const ORDERS_KEY = 'js.orders.v1';

@Injectable({ providedIn: 'root' })
export class Orders {
  private readonly backend = inject(BACKEND);
  private readonly cart = inject(Cart);

  readonly profile = signal<Profile>(readJson<Profile>(PROFILE_KEY, { name: '', phone: '', address: '', landmark: '' }));
  /** Newest first. The orders themselves live on the server; this is just "which ones are mine". */
  readonly myOrderIds = signal<{ id: string; number: string; at: number }[]>(readJson(ORDERS_KEY, []));

  /** Live status of my recent orders (filled in by listeners below). */
  readonly statuses = signal<Record<string, OrderStatus>>({});
  /** How many of my orders are still in progress (shown as a badge on "My orders"). */
  readonly activeCount = computed(() =>
    this.myOrderIds().filter((o) => {
      const s = this.statuses()[o.id];
      return s !== undefined && !isTerminal(s);
    }).length,
  );
  private readonly listeners = new Map<string, () => void>();

  constructor() {
    effect(() => {
      const recent = this.myOrderIds().filter((o) => Date.now() - o.at < 3 * 24 * 3600 * 1000);
      untracked(() => {
        for (const o of recent) {
          if (this.listeners.has(o.id)) continue;
          this.listeners.set(
            o.id,
            this.backend.watchOrder(o.id, (order) => {
              if (!order) return;
              this.statuses.update((m) => (m[o.id] === order.status ? m : { ...m, [o.id]: order.status }));
              if (isTerminal(order.status)) queueMicrotask(() => this.listeners.get(o.id)?.()); // finished: stop listening
            }),
          );
        }
      });
    });
  }

  saveProfile(p: Profile): void {
    this.profile.set(p);
    writeJson(PROFILE_KEY, p);
  }

  async place(
    customer: CustomerInfo,
    location: GeoPoint | null,
    note: string,
    dine?: { table: string },
    offersOptIn = false,
  ): Promise<PlaceOrderResult> {
    const lines = this.cart.lines();
    const res = await this.backend.placeOrder({
      lines,
      customer,
      location,
      note,
      ...(offersOptIn ? { offersOptIn: true } : {}),
      ...(dine ? { orderType: 'dine_in' as const, table: dine.table } : {}),
    });
    const list = [{ id: res.orderId, number: res.number, at: Date.now() }, ...this.myOrderIds()].slice(0, 20);
    this.myOrderIds.set(list);
    writeJson(ORDERS_KEY, list);
    this.cart.clear();
    return res;
  }

  watch(id: string, cb: Parameters<typeof this.backend.watchOrder>[1]): () => void {
    return this.backend.watchOrder(id, cb);
  }

  claimPayment(id: string): Promise<void> {
    return this.backend.claimPayment(id);
  }
  review(id: string, rating: number, comment: string): Promise<void> {
    return this.backend.submitReview(id, rating, comment);
  }
  loyalty(phone: string) {
    return this.backend.loyaltyPercent(phone);
  }

  cancel(id: string): Promise<void> {
    return this.backend.cancelOrder(id);
  }
}

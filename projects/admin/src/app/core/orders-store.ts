import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { awaitingPayment, billOrdersOf, isActive, isLiveStatus, type Order, type PayMethod } from '@juicy/shared';
import { BACKEND } from './backend';
import { Session } from './session';

export function startOfToday(now = Date.now()): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Orders that count as revenue: anything the owner accepted (not rejected / cancelled / expired). */
export function todayStats(orders: Order[], now = Date.now()): { orders: number; revenue: number; rejected: number } {
  const since = startOfToday(now);
  const today = orders.filter((o) => o.createdAt >= since);
  const kept = today.filter((o) => ['accepted', 'preparing', 'out_for_delivery', 'delivered'].includes(o.status));
  return {
    orders: kept.length,
    revenue: kept.reduce((s, o) => s + o.total, 0),
    rejected: today.filter((o) => o.status === 'rejected').length,
  };
}

/** Live list of orders, only while the owner is signed in. */
@Injectable({ providedIn: 'root' })
export class OrdersStore {
  private readonly backend = inject(BACKEND);
  private readonly session = inject(Session);

  readonly orders = signal<Order[]>([]);
  /** True once we have a real (server) snapshot. */
  readonly loaded = signal(false);
  readonly error = signal('');

  readonly pending = computed(() => this.orders().filter((o) => o.status === 'pending').sort((a, b) => a.createdAt - b.createdAt));
  /** In progress, plus dine-in orders that were served but not paid yet (the bill is still open). */
  readonly active = computed(() =>
    this.orders()
      .filter((o) => (isActive(o.status) && o.status !== 'pending') || this.unpaid(o))
      .sort((a, b) => a.createdAt - b.createdAt),
  );
  readonly history = computed(() =>
    this.orders()
      .filter((o) => !(isActive(o.status) && o.status !== 'pending') && !this.unpaid(o) && o.status !== 'pending')
      .sort((a, b) => b.createdAt - a.createdAt),
  );
  readonly stats = computed(() => todayStats(this.orders()));

  /** Delivered / served but the money is not confirmed yet: stays open (not History). Very old ones are left alone. */
  private unpaid(o: Order): boolean {
    return awaitingPayment(o) && Date.now() - (o.closedAt ?? o.createdAt) < 2 * 24 * 3600_000;
  }

  /** Seconds-ish (ms) between the order being created on the server and this phone seeing it. Shown on new orders. */
  readonly arrivedIn = signal<Record<string, number>>({});
  private raw: Order[] = [];
  private firstLoadDone = false;
  private readonly seen = new Set<string>();
  /** Status the owner just chose, shown immediately while the server confirms in the background. */
  private readonly overrides = new Map<string, { status: Order['status']; reason?: string }>();

  /** Payments the owner just confirmed, keyed by billId (or order id), shown before the server answers. */
  private readonly paidNow = new Map<string, { method: PayMethod; at: number }>();

  private publish(): void {
    this.orders.set(
      this.raw.map((o0) => {
        let o = o0;
        const ov = this.overrides.get(o.id);
        if (ov) {
          if (o.status === ov.status) this.overrides.delete(o.id); // server caught up
          else o = { ...o, status: ov.status, ...(ov.reason ? { rejectReason: ov.reason } : {}) };
        }
        const key = o.billId ?? o.id;
        if (o.payment) this.paidNow.delete(key);
        const pv = this.paidNow.get(key);
        if (pv && !o.payment && isLiveStatus(o.status)) o = { ...o, payment: pv, ...(o.billId ? { billState: 'paid' as const } : {}) };
        return o;
      }),
    );
  }

  private async optimistic(id: string, status: Order['status'], call: () => Promise<void>, reason?: string): Promise<void> {
    this.overrides.set(id, { status, ...(reason ? { reason } : {}) });
    this.publish();
    try {
      await call();
    } catch (e) {
      this.overrides.delete(id); // the server said no: show the real state again
      this.publish();
      throw e;
    }
  }

  constructor() {
    let off: (() => void) | null = null;
    effect(() => {
      off?.();
      off = null;
      if (!this.session.signedIn()) {
        this.raw = [];
        this.overrides.clear();
        this.seen.clear();
        this.firstLoadDone = false;
        this.orders.set([]);
        this.loaded.set(false);
        return;
      }
      off = this.backend.watchOrders(
        (list, fromServer) => {
          this.raw = list;
          if (fromServer) {
            const fresh: Record<string, number> = {};
            for (const o of list) {
              if (!this.seen.has(o.id)) {
                this.seen.add(o.id);
                if (this.firstLoadDone && o.status === 'pending') fresh[o.id] = Math.max(0, Date.now() - o.createdAt);
              }
            }
            this.firstLoadDone = true;
            if (Object.keys(fresh).length) this.arrivedIn.update((m) => ({ ...m, ...fresh }));
          }
          this.publish();
          if (fromServer) this.loaded.set(true);
          this.error.set('');
        },
        () => this.error.set('Cannot load orders. Check your internet connection.'),
      );
    });
  }

  private readonly paidListeners: ((bill: Order[]) => void)[] = [];
  /** Called with the bill's orders (payment included) after a payment is saved. */
  onPaid(fn: (bill: Order[]) => void): void {
    this.paidListeners.push(fn);
  }

  async markPaid(order: Order, method: PayMethod, via?: 'sms'): Promise<void> {
    const key = order.billId ?? order.id;
    this.paidNow.set(key, { method, at: Date.now() });
    this.publish();
    try {
      await this.backend.markPaid(order.id, method, via);
    } catch (e) {
      this.paidNow.delete(key);
      this.publish();
      throw e;
    }
    const bill = billOrdersOf(this.orders(), order);
    for (const fn of this.paidListeners) {
      try {
        fn(bill.length ? bill : [order]);
      } catch {
        /* a listener must never break the payment */
      }
    }
  }

  accept(id: string, readyInMin?: number): Promise<void> {
    return this.optimistic(id, 'accepted', () => this.backend.changeStatus(id, 'accepted', undefined, readyInMin));
  }
  reject(id: string, reason: string): Promise<void> {
    return this.optimistic(id, 'rejected', () => this.backend.changeStatus(id, 'rejected', reason), reason);
  }
  advance(id: string, to: Order['status'], reason?: string): Promise<void> {
    return this.optimistic(id, to, () => this.backend.changeStatus(id, to, reason), reason);
  }
}

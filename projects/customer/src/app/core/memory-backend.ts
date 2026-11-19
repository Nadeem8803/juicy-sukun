/**
 * In-memory stand-in for Firebase so the whole customer flow can be tried (and E2E-tested) with no
 * backend at all. Loaded only in development builds when the URL has `?demo`.
 * It uses the SAME pure business rules as the Cloud Functions (buildOrder / applyStatusChange).
 *
 * In the browser console / Playwright, `window.__demo` plays the part of the owner:
 *   __demo.setOpen(false)   __demo.accept()   __demo.reject('Out of stock')   __demo.advance()
 */
import {
  DEFAULT_PUBLIC_CONFIG,
  DomainError,
  MENU_SEED,
  applyStatusChange,
  buildOrder,
  nextAdminStep,
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

type Listener<T> = (v: T) => void;

export class MemoryBackend implements CustomerBackend {
  private menu: MenuItem[] = MENU_SEED.map((m) => ({ ...m }));
  private shop: ShopStatus = { open: true };
  private config: PublicConfig = { ...DEFAULT_PUBLIC_CONFIG };
  private orders = new Map<string, Order>();
  private counter = 1000;
  private menuL = new Set<Listener<MenuItem[]>>();
  private shopL = new Set<Listener<ShopStatus>>();
  private configL = new Set<Listener<PublicConfig>>();
  private orderL = new Map<string, Set<Listener<Order | null>>>();
  readonly uid = 'demo-customer';

  constructor() {
    (globalThis as unknown as { __demo: unknown }).__demo = {
      setOpen: (open: boolean) => this.setOpen(open),
      accept: () => this.owner('accepted'),
      reject: (reason = 'Sorry, we are out of stock') => this.owner('rejected', reason),
      advance: () => {
        const o = this.latest();
        const next = o ? nextAdminStep(o.status) : null;
        if (next) this.owner(next);
      },
      orders: () => [...this.orders.values()],
    };
  }

  private latest(): Order | undefined {
    return [...this.orders.values()].sort((a, b) => b.createdAt - a.createdAt)[0];
  }

  private setOpen(open: boolean): void {
    this.shop = { open, updatedAt: Date.now() };
    this.shopL.forEach((l) => l(this.shop));
  }

  private emit(o: Order): void {
    this.orders.set(o.id, o);
    this.orderL.get(o.id)?.forEach((l) => l({ ...o }));
  }

  private owner(to: Order['status'], reason?: string): void {
    const o = this.latest();
    if (!o) return;
    const now = Date.now();
    const invoice =
      to === 'accepted'
        ? { cafeName: this.config.cafeName, cafePhone: '9000000000', cafeAddress: 'Akkalkot', fssai: '12345678901234' }
        : undefined;
    this.emit({ ...o, ...applyStatusChange(o, to, now, { reason, invoice }) });
  }

  private sub<T>(set: Set<Listener<T>>, cb: Listener<T>, initial: T): () => void {
    set.add(cb);
    queueMicrotask(() => cb(initial));
    return () => set.delete(cb);
  }

  watchMenu(cb: Listener<MenuItem[]>): () => void {
    return this.sub(this.menuL, cb, this.menu);
  }
  watchShop(cb: Listener<ShopStatus>): () => void {
    return this.sub(this.shopL, cb, this.shop);
  }
  watchConfig(cb: Listener<PublicConfig>): () => void {
    return this.sub(this.configL, cb, this.config);
  }

  async placeOrder(req: PlaceOrderRequest): Promise<PlaceOrderResult> {
    const pending = [...this.orders.values()].filter((o) => o.status === 'pending').length;
    if (pending >= 2) throw new DomainError('too_many_orders', 'Too many pending orders');
    const number = `JS-${++this.counter}`;
    const id = `demo-${this.counter}`;
    const order = buildOrder({
      request: req,
      menu: this.menu,
      config: { ...this.config, orderTimeoutMinutes: 5 },
      shop: this.shop,
      uid: this.uid,
      id,
      number,
      now: Date.now(),
    });
    this.emit(order);
    return { orderId: id, number };
  }

  watchOrder(id: string, cb: Listener<Order | null>): () => void {
    const set = this.orderL.get(id) ?? new Set();
    this.orderL.set(id, set);
    set.add(cb);
    const o = this.orders.get(id);
    queueMicrotask(() => cb(o ? { ...o } : null));
    return () => set.delete(cb);
  }

  async cancelOrder(id: string): Promise<void> {
    const o = this.orders.get(id);
    if (!o) throw new DomainError('not_found', 'Order not found');
    if (o.status !== 'pending') throw new DomainError('forbidden', 'Not allowed');
    this.emit({ ...o, ...applyStatusChange(o, 'cancelled', Date.now(), { reason: 'Cancelled by customer' }) });
  }

  async claimPayment(orderId: string): Promise<void> {
    const o = this.orders.get(orderId);
    if (o && !o.payment) this.emit({ ...o, payClaim: { method: 'upi', at: Date.now() } });
  }
  async submitReview(orderId: string, rating: number, comment: string): Promise<void> {
    const o = this.orders.get(orderId);
    if (o) this.emit({ ...o, review: { rating, ...(comment ? { comment } : {}), at: Date.now() } });
  }
  async loyaltyPercent(): Promise<{ percent: number; orders: number }> {
    return { percent: 0, orders: 0 };
  }
  watchOffers(cb: Listener<Offer[]>): () => void {
    queueMicrotask(() => cb([]));
    return () => undefined;
  }
  watchReviews(cb: Listener<PublicReview[]>): () => void {
    queueMicrotask(() => cb([]));
    return () => undefined;
  }
  track(): void {
    /* no tracking in the demo backend */
  }
}

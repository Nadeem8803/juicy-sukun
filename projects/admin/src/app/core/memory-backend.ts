/**
 * In-memory stand-in for Firebase: lets the whole owner app be tried and E2E-tested with no backend.
 * Loaded only in development builds when the URL has `?demo`. Sign in with any email / password "demo1234".
 * `window.__demo.newOrder()` plays a customer placing an order.
 */
import {
  DEFAULT_CONFIG,
  MENU_SEED,
  applyStatusChange,
  buildOrder,
  type AppConfig,
  type CustomerRecord,
  type DailyStats,
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

type L<T> = (v: T) => void;

export class MemoryAdminBackend implements AdminBackend {
  private user: AdminUser | null = null;
  private menu: MenuItem[] = MENU_SEED.map((m) => ({ ...m }));
  private shop: ShopStatus = { open: false };
  private config: AppConfig = { ...DEFAULT_CONFIG, cafePhone: '9000000000', cafeAddress: 'Akkalkot', fssai: '12345678901234' };
  private orders: Order[] = [];
  private n = 1000;
  private authL = new Set<L<AdminUser | null>>();
  private orderL = new Set<(o: Order[], s: boolean) => void>();
  private menuL = new Set<L<MenuItem[]>>();
  private shopL = new Set<L<ShopStatus>>();
  tokens: string[] = [];

  constructor() {
    (globalThis as unknown as { __demo: unknown }).__demo = {
      newOrder: (itemId = 'pizza-veg-choice-pizza', qty = 1) => this.newOrder(itemId, qty),
      orders: () => this.orders,
      menu: () => this.menu,
    };
  }

  private newOrder(itemId: string, qty: number): void {
    const number = `JS-${++this.n}`;
    const o = buildOrder({
      request: {
        lines: [{ itemId, sizeIndex: 0, qty }],
        customer: { name: 'Ayesha Shaikh', phone: '9876543210', address: 'Near bus stand, Akkalkot', landmark: 'Opp. SBI' },
        location: { lat: 17.5236, lng: 76.2043 },
        note: 'Less spicy please',
      },
      menu: this.menu,
      config: { ...this.config, orderTimeoutMinutes: 5 },
      shop: { open: true },
      uid: 'demo-customer',
      id: `demo-${this.n}`,
      number,
      now: Date.now(),
    });
    this.orders = [o, ...this.orders];
    this.pushOrders();
  }

  private pushOrders(): void {
    this.orderL.forEach((l) => l([...this.orders], true));
  }

  private add<T>(set: Set<T>, cb: T, emit: () => void): () => void {
    set.add(cb);
    queueMicrotask(emit);
    return () => set.delete(cb);
  }

  onAuth(cb: L<AdminUser | null>): () => void {
    return this.add(this.authL, cb, () => cb(this.user));
  }
  async signIn(email: string, password: string): Promise<void> {
    if (password !== 'demo1234') throw Object.assign(new Error('bad'), { code: 'auth/invalid-credential' });
    this.user = { email };
    this.authL.forEach((l) => l(this.user));
  }
  async signOut(): Promise<void> {
    this.user = null;
    this.authL.forEach((l) => l(null));
  }

  watchOrders(cb: (o: Order[], s: boolean) => void): () => void {
    return this.add(this.orderL, cb, () => cb([...this.orders], true));
  }

  async changeStatus(orderId: string, status: OrderStatus, reason?: string, readyInMin?: number): Promise<void> {
    const o = this.orders.find((x) => x.id === orderId);
    if (!o) throw new Error('not found');
    const invoice =
      status === 'accepted'
        ? { cafeName: this.config.cafeName, cafePhone: this.config.cafePhone, cafeAddress: this.config.cafeAddress, fssai: this.config.fssai }
        : undefined;
    const patch = { ...applyStatusChange(o, status, Date.now(), { reason, invoice }), ...(status === 'accepted' && readyInMin ? { readyAt: Date.now() + readyInMin * 60_000 } : {}) };
    this.orders = this.orders.map((x) => (x.id === orderId ? { ...x, ...patch } : x));
    this.pushOrders();
  }

  async markPaid(orderId: string, method: PayMethod, _via?: 'sms'): Promise<void> {
    const o = this.orders.find((x) => x.id === orderId);
    if (!o) throw new Error('not found');
    const key = o.billId ?? o.id;
    this.orders = this.orders.map((x) =>
      (x.billId ?? x.id) === key && !x.payment && ['accepted', 'preparing', 'out_for_delivery', 'delivered'].includes(x.status)
        ? { ...x, payment: { method, at: Date.now() }, payClaim: null, ...(x.billId ? { billState: 'paid' as const } : {}) }
        : x,
    );
    this.pushOrders();
  }

  private expenses: Expense[] = [];
  private offers: Offer[] = [];
  private expL = new Set<L<Expense[]>>();
  private offL = new Set<L<Offer[]>>();
  async dismissClaim(orderId: string): Promise<void> {
    this.orders = this.orders.map((x) => (x.id === orderId ? { ...x, payClaim: null } : x));
    this.pushOrders();
  }
  async loadOrdersSince(since: number): Promise<Order[]> {
    return this.orders.filter((o) => o.createdAt >= since);
  }
  watchExpenses(cb: L<Expense[]>): () => void {
    return this.add(this.expL, cb, () => cb([...this.expenses]));
  }
  async saveExpense(e: Expense): Promise<void> {
    this.expenses = [e, ...this.expenses.filter((x) => x.id !== e.id)];
    this.expL.forEach((l) => l([...this.expenses]));
  }
  async deleteExpense(id: string): Promise<void> {
    this.expenses = this.expenses.filter((x) => x.id !== id);
    this.expL.forEach((l) => l([...this.expenses]));
  }
  async loadDaily(): Promise<DailyStats[]> {
    return [];
  }
  async loadCustomers(): Promise<CustomerRecord[]> {
    return [];
  }
  watchOffers(cb: L<Offer[]>): () => void {
    return this.add(this.offL, cb, () => cb([...this.offers]));
  }
  private revs: PublicReview[] = [];
  private revL = new Set<L<PublicReview[]>>();
  watchReviews(cb: L<PublicReview[]>): () => void {
    return this.add(this.revL, cb, () => cb([...this.revs]));
  }
  async setReviewPublic(order: Order, on: boolean): Promise<void> {
    const r = order.review;
    if (!r) return;
    this.revs = [...this.revs.filter((x) => x.id !== order.id), { id: order.id, name: order.customer.name.split(' ')[0] ?? 'Customer', rating: r.rating, ...(r.comment ? { comment: r.comment } : {}), at: r.at, public: on }];
    this.revL.forEach((l) => l([...this.revs]));
  }
  async saveOffer(o: Offer): Promise<void> {
    this.offers = [...this.offers.filter((x) => x.id !== o.id), o].sort((a, b) => a.sort - b.sort);
    this.offL.forEach((l) => l([...this.offers]));
  }
  async deleteOffer(id: string): Promise<void> {
    this.offers = this.offers.filter((x) => x.id !== id);
    this.offL.forEach((l) => l([...this.offers]));
  }
  async setAvailable(itemId: string, available: boolean): Promise<void> {
    this.menu = this.menu.map((m) => (m.id === itemId ? { ...m, available } : m));
    this.menuL.forEach((l) => l([...this.menu]));
  }

  watchMenu(cb: L<MenuItem[]>): () => void {
    return this.add(this.menuL, cb, () => cb([...this.menu]));
  }
  async saveItem(item: MenuItem): Promise<void> {
    const i = this.menu.findIndex((m) => m.id === item.id);
    if (i >= 0) this.menu[i] = item;
    else this.menu.push(item);
    this.menu.sort((a, b) => a.sort - b.sort);
    this.menuL.forEach((l) => l([...this.menu]));
  }
  async deleteItem(id: string): Promise<void> {
    this.menu = this.menu.filter((m) => m.id !== id);
    this.menuL.forEach((l) => l([...this.menu]));
  }
  async uploadImage(): Promise<string> {
    return 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';
  }

  watchShop(cb: L<ShopStatus>): () => void {
    return this.add(this.shopL, cb, () => cb(this.shop));
  }
  async setShop(open: boolean, message?: string): Promise<void> {
    this.shop = { open, ...(message ? { message } : {}), updatedAt: Date.now() };
    this.shopL.forEach((l) => l(this.shop));
  }

  async loadConfig(): Promise<AppConfig> {
    return { ...this.config };
  }
  async saveConfig(c: AppConfig): Promise<void> {
    this.config = { ...c };
  }
  async registerToken(token: string): Promise<void> {
    this.tokens.push(token);
  }
}

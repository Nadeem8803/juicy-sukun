import { beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_CONFIG,
  DomainError,
  MENU_SEED,
  type AppConfig,
  type Order,
  type PlaceOrderRequest,
  type ShopStatus,
} from '@juicy/shared';
import { MAX_PENDING_PER_CUSTOMER, changeStatusCore, claimPaymentCore, loyaltyPreviewCore, submitReviewCore, expirePendingCore, markPaidCore, placeOrderCore, type Deps } from './core';

const T0 = 1_800_000_000_000;

/** In-memory stand-in for Firestore. */
class FakeStore implements Deps {
  shop: ShopStatus = { open: true };
  menu = MENU_SEED.map((m) => ({ ...m }));
  config: AppConfig = { ...DEFAULT_CONFIG, cafePhone: '9000000000', fssai: '12345678901234' };
  blocked = new Set<string>();
  orders = new Map<string, Order>();
  seq = 1000;

  async getShop() { return this.shop; }
  async getMenu() { return this.menu; }
  async getConfig() { return this.config; }
  async isPhoneBlocked(phone: string) { return this.blocked.has(phone); }
  async countPendingOrders(uid: string) {
    return [...this.orders.values()].filter((o) => o.customerUid === uid && o.status === 'pending').length;
  }
  async allocate() {
    this.seq += 1;
    return { id: `o${this.seq}`, number: `JS-${this.seq}` };
  }
  async saveOrder(order: Order) { this.orders.set(order.id, order); }
  async updateOrder(orderId: string, compute: (o: Order) => Partial<Order>) {
    const current = this.orders.get(orderId);
    if (!current) throw new DomainError('not_found', 'Order not found');
    const next = { ...current, ...compute(current) };
    this.orders.set(orderId, next);
    return next;
  }
  async listPendingOrders() {
    return [...this.orders.values()].filter((o) => o.status === 'pending');
  }
  async findOpenBill(table: string) {
    const open = [...this.orders.values()]
      .filter((o) => o.table === table && o.billState === 'open')
      .sort((a, b) => a.createdAt - b.createdAt);
    return open[0]?.billId ?? null;
  }
  async listBillOrders(billId: string) {
    return [...this.orders.values()].filter((o) => o.billId === billId);
  }
}

const request = (over: Partial<PlaceOrderRequest> = {}): PlaceOrderRequest => ({
  lines: [{ itemId: 'pizza-veg-choice-pizza', sizeIndex: 1, qty: 1 }],
  customer: { name: 'Ayesha Shaikh', phone: '9876543210', address: 'Near bus stand, Akkalkot' },
  location: { lat: 17.52, lng: 76.2 },
  ...over,
});

const customer = { uid: 'cust-1', isAdmin: false };
const owner = { uid: 'owner', isAdmin: true };

function codeOf(p: Promise<unknown>): Promise<string> {
  return p.then(
    () => 'no_error',
    (e) => (e as DomainError).code ?? 'unexpected',
  );
}

let store: FakeStore;
beforeEach(() => {
  store = new FakeStore();
});

describe('placeOrderCore', () => {
  it('saves a pending order priced by the server and numbers it', async () => {
    const result = await placeOrderCore(store, 'cust-1', request(), T0);
    expect(result).toEqual({ orderId: 'o1001', number: 'JS-1001' });
    const saved = store.orders.get('o1001')!;
    expect(saved).toMatchObject({ status: 'pending', subtotal: 269, deliveryFee: 39, total: 308, customerUid: 'cust-1' });
  });

  it('gives free delivery once the items reach ₹300', async () => {
    const r = request({ lines: [{ itemId: 'pizza-veg-choice-pizza', sizeIndex: 1, qty: 2 }] });
    await placeOrderCore(store, 'cust-1', r, T0);
    expect(store.orders.get('o1001')).toMatchObject({ subtotal: 538, deliveryFee: 0, total: 538 });
  });

  it('ignores any price the client sends', async () => {
    const tampered = request({ lines: [{ itemId: 'drinks-blue-mint', sizeIndex: 0, qty: 1, price: 1 } as never] });
    await placeOrderCore(store, 'cust-1', tampered, T0);
    expect(store.orders.get('o1001')!.subtotal).toBe(80);
  });

  it('charges ₹39 delivery under ₹300', async () => {
    await placeOrderCore(store, 'cust-1', request({ lines: [{ itemId: 'drinks-blue-mint', sizeIndex: 0, qty: 1 }] }), T0);
    expect(store.orders.get('o1001')).toMatchObject({ subtotal: 80, deliveryFee: 39, total: 119 });
  });

  it('refuses a delivery outside the owner\'s km limit, but not dine-in', async () => {
    store.config = { ...store.config, deliveryMaxKm: 5, cafeLat: 17.52, cafeLng: 76.2 };
    expect(await codeOf(placeOrderCore(store, 'cust-1', request({ location: { lat: 18.5, lng: 76.2 } }), T0))).toBe('too_far');
    expect(await codeOf(placeOrderCore(store, 'cust-1', request({ location: null }), T0))).toBe('too_far');
    expect(store.seq).toBe(1000);
    await placeOrderCore(store, 'cust-1', request({ location: { lat: 17.53, lng: 76.2 } }), T0);
    expect(store.orders.size).toBe(1);
  });

  it('refuses when the shop is closed and does not use an order number', async () => {
    store.shop = { open: false };
    expect(await codeOf(placeOrderCore(store, 'cust-1', request(), T0))).toBe('shop_closed');
    expect(store.seq).toBe(1000);
    expect(store.orders.size).toBe(0);
  });

  it('treats a missing shop status as closed (handled by the Firestore deps) and refuses an invalid request early', async () => {
    expect(await codeOf(placeOrderCore(store, 'cust-1', request({ lines: [] }), T0))).toBe('invalid_request');
    expect(store.seq).toBe(1000);
  });

  it('refuses a blocked phone number', async () => {
    store.blocked.add('9876543210');
    expect(await codeOf(placeOrderCore(store, 'cust-1', request(), T0))).toBe('blocked');
  });

  it('blocks a number even when typed with +91 and spaces', async () => {
    store.blocked.add('9876543210');
    const r = request({ customer: { name: 'Ayesha', phone: '+91 98765 43210', address: 'Near bus stand, Akkalkot' } });
    expect(await codeOf(placeOrderCore(store, 'cust-1', r, T0))).toBe('blocked');
  });

  it(`limits a customer to ${MAX_PENDING_PER_CUSTOMER} waiting orders`, async () => {
    for (let i = 0; i < MAX_PENDING_PER_CUSTOMER; i++) await placeOrderCore(store, 'cust-1', request(), T0);
    expect(await codeOf(placeOrderCore(store, 'cust-1', request(), T0))).toBe('too_many_orders');
    // a different customer is not affected
    await expect(placeOrderCore(store, 'cust-2', request(), T0)).resolves.toBeTruthy();
  });

  it('refuses a sold-out item', async () => {
    store.menu = store.menu.map((m) => (m.id === 'drinks-blue-mint' ? { ...m, available: false } : m));
    const r = request({ lines: [{ itemId: 'drinks-blue-mint', sizeIndex: 0, qty: 1 }] });
    expect(await codeOf(placeOrderCore(store, 'cust-1', r, T0))).toBe('item_unavailable');
  });
});

describe('changeStatusCore', () => {
  async function placeOne(): Promise<string> {
    return (await placeOrderCore(store, 'cust-1', request(), T0)).orderId;
  }

  it('lets the owner accept and attaches the invoice details', async () => {
    const orderId = await placeOne();
    const { order, previous } = await changeStatusCore(store, owner, { orderId, status: 'accepted' }, T0 + 1000);
    expect(previous).toBe('pending');
    expect(order.status).toBe('accepted');
    expect(order.invoice).toMatchObject({ cafePhone: '9000000000', cafeName: 'Juicysukun Café' });
  });

  it('stores the ready time when the owner accepts with minutes', async () => {
    const orderId = await placeOne();
    const { order } = await changeStatusCore(store, owner, { orderId, status: 'accepted', readyInMin: 20 }, T0 + 1000);
    expect(order.readyAt).toBe(T0 + 1000 + 20 * 60_000);
  });

  it('ignores a silly ready time and never lets customers set one', async () => {
    const a = await placeOne();
    const { order } = await changeStatusCore(store, owner, { orderId: a, status: 'accepted', readyInMin: 9999 }, T0 + 1000);
    expect(order.readyAt).toBeUndefined();
  });

  it('does not reveal the cafe phone before acceptance', async () => {
    const orderId = await placeOne();
    expect(store.orders.get(orderId)!.invoice).toBeUndefined();
  });

  it('walks the whole delivery flow', async () => {
    const orderId = await placeOne();
    for (const status of ['accepted', 'preparing', 'out_for_delivery', 'delivered'] as const) {
      await changeStatusCore(store, owner, { orderId, status }, T0 + 1000);
    }
    expect(store.orders.get(orderId)!.status).toBe('delivered');
    expect(store.orders.get(orderId)!.closedAt).toBe(T0 + 1000);
  });

  it('needs a reason to reject, then stores it for the customer', async () => {
    const orderId = await placeOne();
    expect(await codeOf(changeStatusCore(store, owner, { orderId, status: 'rejected' }, T0))).toBe('reason_required');
    await changeStatusCore(store, owner, { orderId, status: 'rejected', reason: 'Item out of stock' }, T0);
    expect(store.orders.get(orderId)).toMatchObject({ status: 'rejected', rejectReason: 'Item out of stock' });
  });

  it('refuses skipping steps and changing finished orders', async () => {
    const orderId = await placeOne();
    expect(await codeOf(changeStatusCore(store, owner, { orderId, status: 'delivered' }, T0))).toBe('invalid_transition');
    await changeStatusCore(store, owner, { orderId, status: 'rejected', reason: 'Closing soon' }, T0);
    expect(await codeOf(changeStatusCore(store, owner, { orderId, status: 'accepted' }, T0))).toBe('invalid_transition');
  });

  it("does not let the owner set 'expired' by hand", async () => {
    const orderId = await placeOne();
    expect(await codeOf(changeStatusCore(store, owner, { orderId, status: 'expired' }, T0))).toBe('forbidden');
  });

  it('lets a customer cancel their own pending order', async () => {
    const orderId = await placeOne();
    await changeStatusCore(store, customer, { orderId, status: 'cancelled' }, T0);
    expect(store.orders.get(orderId)).toMatchObject({ status: 'cancelled', rejectReason: 'Cancelled by customer' });
  });

  it("stops a customer from touching someone else's order or doing anything but cancelling", async () => {
    const orderId = await placeOne();
    const other = { uid: 'cust-2', isAdmin: false };
    expect(await codeOf(changeStatusCore(store, other, { orderId, status: 'cancelled' }, T0))).toBe('forbidden');
    expect(await codeOf(changeStatusCore(store, customer, { orderId, status: 'accepted' }, T0))).toBe('forbidden');
  });

  it('stops a customer cancelling after the owner accepted', async () => {
    const orderId = await placeOne();
    await changeStatusCore(store, owner, { orderId, status: 'accepted' }, T0);
    expect(await codeOf(changeStatusCore(store, customer, { orderId, status: 'cancelled' }, T0))).toBe('forbidden');
  });

  it('reports a missing order', async () => {
    expect(await codeOf(changeStatusCore(store, owner, { orderId: 'ghost', status: 'accepted' }, T0))).toBe('not_found');
  });
});

describe('expirePendingCore', () => {
  it('expires only pending orders whose time is up', async () => {
    const a = (await placeOrderCore(store, 'cust-1', request(), T0)).orderId;
    const b = (await placeOrderCore(store, 'cust-2', request(), T0 + 4 * 60_000)).orderId;
    const expired = await expirePendingCore(store, T0 + 5 * 60_000 + 1);
    expect(expired).toEqual([a]);
    expect(store.orders.get(a)!.status).toBe('expired');
    expect(store.orders.get(b)!.status).toBe('pending');
  });

  it('never expires an order the owner already accepted', async () => {
    const id = (await placeOrderCore(store, 'cust-1', request(), T0)).orderId;
    await changeStatusCore(store, owner, { orderId: id, status: 'accepted' }, T0 + 1000);
    expect(await expirePendingCore(store, T0 + 10 * 60_000)).toEqual([]);
    expect(store.orders.get(id)!.status).toBe('accepted');
  });

  it('does nothing when there are no pending orders', async () => {
    expect(await expirePendingCore(store, T0)).toEqual([]);
  });
});


describe('dine-in bills and payment', () => {
  const dine = (table = '4', name = 'Ayesha') => ({
    orderType: 'dine_in' as const,
    table,
    customer: { name, phone: '9876543210', address: '' },
    location: null,
  });
  const accept = (s: FakeStore, id: string) => changeStatusCore(s, owner, { orderId: id, status: 'accepted' }, 2000);

  it('needs only a name and a table, and charges no delivery', async () => {
    const s = new FakeStore();
    const r = await placeOrderCore(s, 'cust-1', request(dine()), 1000);
    const o = s.orders.get(r.orderId)!;
    expect(o.orderType).toBe('dine_in');
    expect(o.table).toBe('4');
    expect(o.deliveryFee).toBe(0);
    expect(o.total).toBe(o.subtotal);
    expect(o.billState).toBe('open');
  });

  it('requires a mobile number for dine-in', async () => {
    const s = new FakeStore();
    const req = request(dine());
    expect(await codeOf(placeOrderCore(s, 'cust-1', { ...req, customer: { ...req.customer, phone: '' } }, 1000))).toBe('invalid_request');
  });

  it('rejects dine-in without a table', async () => {
    const s = new FakeStore();
    expect(await codeOf(placeOrderCore(s, 'cust-1', request({ ...dine(''), table: '' }), 1000))).toBe('invalid_request');
  });

  it('a second order from the same table joins the same bill', async () => {
    const s = new FakeStore();
    const a = await placeOrderCore(s, 'cust-1', request(dine()), 1000);
    const b = await placeOrderCore(s, 'cust-2', request(dine('4', 'Friend')), 1100);
    expect(s.orders.get(b.orderId)!.billId).toBe(s.orders.get(a.orderId)!.billId);
    const c = await placeOrderCore(s, 'cust-1', request(dine('5')), 1200);
    expect(s.orders.get(c.orderId)!.billId).not.toBe(s.orders.get(a.orderId)!.billId);
  });

  it('paying one round pays every accepted round of the table', async () => {
    const s = new FakeStore();
    const a = await placeOrderCore(s, 'cust-1', request(dine()), 1000);
    const b = await placeOrderCore(s, 'cust-1', request(dine()), 1100);
    await accept(s, a.orderId);
    await accept(s, b.orderId);
    const res = await markPaidCore(s, owner, { orderId: a.orderId, method: 'upi' }, 3000);
    expect(res.paid.sort()).toEqual([a.orderId, b.orderId].sort());
    expect(s.orders.get(b.orderId)!.payment?.method).toBe('upi');
    expect(s.orders.get(b.orderId)!.billState).toBe('paid');
    // the table is free again: the next order starts a new bill
    const c = await placeOrderCore(s, 'cust-1', request(dine()), 4000);
    expect(s.orders.get(c.orderId)!.billId).toBe(c.orderId);
  });

  it('a round still waiting for acceptance stays open when the bill is paid', async () => {
    const s = new FakeStore();
    const a = await placeOrderCore(s, 'cust-1', request(dine()), 1000);
    const b = await placeOrderCore(s, 'cust-1', request(dine()), 1100);
    await accept(s, a.orderId);
    await markPaidCore(s, owner, { orderId: a.orderId, method: 'cash' }, 3000);
    expect(s.orders.get(b.orderId)!.payment).toBeUndefined();
  });

  it('only the owner can take payment, and not before the order is accepted', async () => {
    const s = new FakeStore();
    const a = await placeOrderCore(s, 'cust-1', request(dine()), 1000);
    expect(await codeOf(markPaidCore(s, customer, { orderId: a.orderId, method: 'cash' }, 3000))).toBe('forbidden');
    expect(await codeOf(markPaidCore(s, owner, { orderId: a.orderId, method: 'cash' }, 3000))).toBe('invalid_transition');
  });

  it('a rejected round no longer holds the bill open', async () => {
    const s = new FakeStore();
    const a = await placeOrderCore(s, 'cust-1', request(dine()), 1000);
    await changeStatusCore(s, owner, { orderId: a.orderId, status: 'rejected', reason: 'Out of stock' }, 2000);
    expect(s.orders.get(a.orderId)!.billState).toBe('closed');
    const b = await placeOrderCore(s, 'cust-1', request(dine()), 3000);
    expect(s.orders.get(b.orderId)!.billId).toBe(b.orderId);
  });

  it('dine-in preparing can go straight to served', async () => {
    const s = new FakeStore();
    const a = await placeOrderCore(s, 'cust-1', request(dine()), 1000);
    for (const st of ['accepted', 'preparing', 'delivered'] as const) {
      await changeStatusCore(s, owner, { orderId: a.orderId, status: st }, 2000);
    }
    expect(s.orders.get(a.orderId)!.status).toBe('delivered');
  });
});


describe('UPI claim, reviews and loyalty', () => {
  async function accepted(): Promise<string> {
    const { orderId } = await placeOrderCore(store, 'cust-1', request(), T0);
    await changeStatusCore(store, owner, { orderId, status: 'accepted' }, T0 + 1);
    return orderId;
  }
  async function delivered(): Promise<string> {
    const orderId = await accepted();
    for (const status of ['preparing', 'out_for_delivery', 'delivered'] as const) await changeStatusCore(store, owner, { orderId, status }, T0 + 2);
    return orderId;
  }

  it('lets the customer say "I have paid" and the owner dismiss it', async () => {
    const orderId = await accepted();
    await claimPaymentCore(store, customer, { orderId }, T0 + 5);
    expect(store.orders.get(orderId)!.payClaim).toMatchObject({ method: 'upi', at: T0 + 5 });
    await claimPaymentCore(store, owner, { orderId, action: 'dismiss' }, T0 + 6);
    expect(store.orders.get(orderId)!.payClaim).toBeNull();
  });

  it("refuses someone else's claim, a customer dismissing, and a claim on a waiting order", async () => {
    const orderId = await accepted();
    expect(await codeOf(claimPaymentCore(store, { uid: 'other', isAdmin: false }, { orderId }, T0))).toBe('forbidden');
    expect(await codeOf(claimPaymentCore(store, customer, { orderId, action: 'dismiss' }, T0))).toBe('forbidden');
    const { orderId: pending } = await placeOrderCore(store, 'cust-1', request(), T0);
    expect(await codeOf(claimPaymentCore(store, customer, { orderId: pending }, T0))).toBe('invalid_transition');
  });

  it('clears the claim when the owner marks the order paid', async () => {
    const orderId = await accepted();
    await claimPaymentCore(store, customer, { orderId }, T0 + 5);
    await markPaidCore(store, owner, { orderId, method: 'upi' }, T0 + 9);
    expect(store.orders.get(orderId)!.payClaim).toBeNull();
    expect(store.orders.get(orderId)!.payment).toBeTruthy();
  });

  it('accepts one review per delivered order, only from its owner', async () => {
    const orderId = await delivered();
    expect(await codeOf(submitReviewCore(store, { uid: 'other', isAdmin: false }, { orderId, rating: 5 }, T0))).toBe('forbidden');
    expect(await codeOf(submitReviewCore(store, customer, { orderId, rating: 9 }, T0))).toBe('invalid_request');
    await submitReviewCore(store, customer, { orderId, rating: 4, comment: '  tasty   pizza ' }, T0 + 10);
    expect(store.orders.get(orderId)!.review).toMatchObject({ rating: 4, comment: 'tasty pizza' });
    expect(await codeOf(submitReviewCore(store, customer, { orderId, rating: 5 }, T0 + 11))).toBe('invalid_request');
  });

  it('publishes every review (any stars) with the first name only', async () => {
    const pub: unknown[] = [];
    (store as unknown as Deps).publishReview = async (r) => void pub.push(r);
    const orderId = await delivered();
    await submitReviewCore(store, customer, { orderId, rating: 5, comment: 'great' }, T0 + 10);
    expect(pub).toHaveLength(1);
    const r = pub[0] as { name: string; public: boolean; id: string };
    expect(r.public).toBe(true);
    expect(r.name).not.toMatch(/\s/);
    expect(Object.keys(r).sort()).toEqual(['at', 'comment', 'id', 'name', 'public', 'rating']);
  });

  it('shows a 2-star review to customers too (owner can hide it later)', async () => {
    const pub: { public: boolean; rating: number }[] = [];
    (store as unknown as Deps).publishReview = async (r) => void pub.push(r);
    const orderId = await delivered();
    await submitReviewCore(store, customer, { orderId, rating: 2, comment: 'slow' }, T0 + 10);
    expect(pub[0]).toMatchObject({ rating: 2, public: true });
  });

  it('refuses a review before delivery', async () => {
    const orderId = await accepted();
    expect(await codeOf(submitReviewCore(store, customer, { orderId, rating: 5 }, T0))).toBe('invalid_transition');
  });

  it('applies the loyalty discount on the server after enough orders', async () => {
    store.config = { ...store.config, loyaltyEnabled: true, loyaltyAfter: 2, loyaltyPercent: 10 };
    const counts = new Map<string, number>([['9876543210', 2]]);
    (store as unknown as Deps).getCustomer = async (phone: string) => ({ orders: counts.get(phone) ?? 0 });
    expect(await loyaltyPreviewCore(store, '98765 43210')).toEqual({ percent: 10, orders: 2 });
    expect(await loyaltyPreviewCore(store, '9123456789')).toEqual({ percent: 0, orders: 0 });
    await placeOrderCore(store, 'cust-1', request(), T0);
    expect(store.orders.get('o1001')).toMatchObject({ subtotal: 269, discount: { percent: 10, amount: 27 }, total: 281 });
  });
});

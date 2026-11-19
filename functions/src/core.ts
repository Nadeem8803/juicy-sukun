import {
  DomainError,
  applyStatusChange,
  buildOrder,
  normalizePhone,
  normalizeTable,
  isLiveStatus,
  assertWithinDeliveryArea,
  loyaltyPercentFor,
  type PayMethod,
  type AppConfig,
  type MenuItem,
  type Order,
  type OrderStatus,
  type PlaceOrderRequest,
  type PlaceOrderResult,
  type ShopStatus,
} from '@juicy/shared';

/** A customer may have at most this many orders waiting for the cafe at once. */
export const MAX_PENDING_PER_CUSTOMER = 2;

/**
 * Everything the business logic needs from the outside world.
 * Firestore implements it in production (firestore-deps.ts); the unit tests use an in-memory fake.
 */
export interface Deps {
  getShop(): Promise<ShopStatus>;
  getMenu(): Promise<MenuItem[]>;
  getConfig(): Promise<AppConfig>;
  isPhoneBlocked(phone: string): Promise<boolean>;
  countPendingOrders(uid: string): Promise<number>;
  /** Reserves an order id and the next order number (JS-1001, JS-1002 ...). */
  allocate(): Promise<{ id: string; number: string }>;
  saveOrder(order: Order): Promise<void>;
  /** Reads the order, lets `compute` decide the change, and writes it atomically. */
  updateOrder(orderId: string, compute: (order: Order) => Partial<Order>): Promise<Order>;
  listPendingOrders(): Promise<Order[]>;
  /** Dine-in: the billId of this table's open bill, or null. */
  findOpenBill(table: string): Promise<string | null>;
  /** Every order that belongs to one dine-in bill. */
  listBillOrders(billId: string): Promise<Order[]>;
  /** Regular-customer record by phone (loyalty). Optional so older deployments keep working. */
  getCustomer?(phone: string): Promise<{ orders: number } | null>;
  /** Remembers name / phone / consent when an order is placed. */
  touchCustomer?(info: { phone: string; name: string; optIn?: boolean; now: number }): Promise<void>;
  /** Counts a finished (delivered / served) order for the customer. */
  recordCompleted?(info: { phone: string; name: string; total: number; now: number }): Promise<void>;
  /** Publishes a review for the menu strip (first name + stars + comment). */
  publishReview?(r: { id: string; name: string; rating: number; comment?: string; at: number; public: boolean }): Promise<void>;
}

export async function placeOrderCore(
  deps: Deps,
  uid: string,
  request: PlaceOrderRequest,
  now: number,
): Promise<PlaceOrderResult> {
  // Everything we need to read goes out in ONE round trip (the block-list and pending-count checks included).
  const rawPhone = typeof request?.customer?.phone === 'string' ? normalizePhone(request.customer.phone) : null;
  const dineTable = request?.orderType === 'dine_in' ? normalizeTable(request.table) : '';
  const [shop, menu, config, blocked, pendingCount, openBill, customer] = await Promise.all([
    deps.getShop(),
    deps.getMenu(),
    deps.getConfig(),
    rawPhone ? deps.isPhoneBlocked(rawPhone) : Promise.resolve(false),
    deps.countPendingOrders(uid),
    dineTable ? deps.findOpenBill(dineTable) : Promise.resolve(null),
    rawPhone && deps.getCustomer ? deps.getCustomer(rawPhone) : Promise.resolve(null),
  ]);
  // Loyalty is decided here, never by the customer's phone.
  const loyaltyPercent = loyaltyPercentFor(config, customer?.orders ?? 0);

  // Dry run first: rejects bad requests without using up an order number.
  const draft = buildOrder({ request, menu, config, shop, uid, id: 'draft', number: 'JS-0', now, loyaltyPercent });
  // Delivery only inside the owner's distance limit (dine-in is never limited).
  if (draft.orderType !== 'dine_in') assertWithinDeliveryArea(config, draft.location);
  if (blocked) {
    throw new DomainError('blocked', 'This phone number is blocked');
  }
  if (pendingCount >= MAX_PENDING_PER_CUSTOMER) {
    throw new DomainError('too_many_orders', 'Too many orders are waiting for the cafe');
  }

  const { id, number } = await deps.allocate();
  const order = buildOrder({ request, menu, config, shop, uid, id, number, now, billId: openBill, loyaltyPercent });
  await Promise.all([
    deps.saveOrder(order),
    deps.touchCustomer && order.customer.phone
      ? deps.touchCustomer({ phone: order.customer.phone, name: order.customer.name, optIn: request.offersOptIn === true ? true : undefined, now }).catch(() => undefined)
      : Promise.resolve(),
  ]);
  return { orderId: id, number };
}

export interface Actor {
  uid: string;
  isAdmin: boolean;
}

export interface ChangeStatusRequest {
  orderId: string;
  status: OrderStatus;
  reason?: string;
  /** With status 'accepted': minutes until the food is ready (1-180). */
  readyInMin?: number;
}

/**
 * Owner: any legal change (reason required to reject or cancel), except 'expired' which is automatic.
 * Customer: may only cancel their own order while it is still pending.
 */
export async function changeStatusCore(
  deps: Deps,
  actor: Actor,
  req: ChangeStatusRequest,
  now: number,
): Promise<{ order: Order; previous: OrderStatus }> {
  if (!req || typeof req.orderId !== 'string' || !req.orderId) {
    throw new DomainError('invalid_request', 'Order id is required');
  }
  const config = await deps.getConfig();
  let previous: OrderStatus = 'pending';

  const order = await deps.updateOrder(req.orderId, (current) => {
    previous = current.status;

    if (actor.isAdmin) {
      if (req.status === 'expired') throw new DomainError('forbidden', 'Expiry is automatic');
    } else {
      if (current.customerUid !== actor.uid) throw new DomainError('forbidden', 'Not your order');
      if (req.status !== 'cancelled' || current.status !== 'pending') {
        throw new DomainError('forbidden', 'You can only cancel an order that is still waiting');
      }
    }

    const reason = actor.isAdmin ? req.reason : 'Cancelled by customer';
    const patch = applyStatusChange(current, req.status, now, {
      reason,
      invoice: {
        cafeName: config.cafeName,
        cafePhone: config.cafePhone,
        cafeAddress: config.cafeAddress,
        fssai: config.fssai,
      },
    });
    const mins = Math.round(Number(req.readyInMin));
    if (actor.isAdmin && req.status === 'accepted' && Number.isFinite(mins) && mins >= 1 && mins <= 180) {
      return { ...patch, readyAt: now + mins * 60_000 };
    }
    return patch;
  });

  if (order.status === 'delivered' && (previous as OrderStatus) !== 'delivered' && deps.recordCompleted && order.customer?.phone) {
    await deps
      .recordCompleted({ phone: order.customer.phone, name: order.customer.name, total: order.total, now })
      .catch(() => undefined);
  }
  return { order, previous };
}

export interface MarkPaidRequest {
  orderId: string;
  method: PayMethod;
  /** 'sms' when confirmed from a matching bank SMS (kept on the payment for the records). */
  via?: 'sms';
}

/**
 * Owner confirms the money was received. For a dine-in order this pays the whole table bill
 * (every accepted round); a round that is still waiting for acceptance stays open.
 */
export async function markPaidCore(
  deps: Deps,
  actor: Actor,
  req: MarkPaidRequest,
  now: number,
): Promise<{ paid: string[] }> {
  if (!actor.isAdmin) throw new DomainError('forbidden', 'Owner only');
  if (!req || typeof req.orderId !== 'string' || !req.orderId) throw new DomainError('invalid_request', 'Order id is required');
  if (!['cash', 'upi', 'card'].includes(req.method)) throw new DomainError('invalid_request', 'Pick how it was paid');

  const pay = (current: Order): Partial<Order> => {
    if (current.payment) return {}; // already paid: nothing to change
    if (!isLiveStatus(current.status)) throw new DomainError('invalid_transition', 'Accept the order before taking payment');
    return { payment: { method: req.method, at: now, ...(req.via === 'sms' ? { via: 'sms' as const } : {}) }, payClaim: null, ...(current.billId ? { billState: 'paid' as const } : {}) };
  };

  let billId: string | undefined;
  const first = await deps.updateOrder(req.orderId, (current) => {
    billId = current.billId;
    return pay(current);
  });
  const paid = [first.id];
  if (billId) {
    for (const o of await deps.listBillOrders(billId)) {
      if (o.id === first.id || o.payment || !isLiveStatus(o.status)) continue;
      await deps.updateOrder(o.id, pay);
      paid.push(o.id);
    }
  }
  return { paid };
}

/** Marks every pending order that the cafe did not answer in time as expired. */
export async function expirePendingCore(deps: Deps, now: number): Promise<string[]> {
  const pending = await deps.listPendingOrders();
  const expired: string[] = [];
  for (const order of pending) {
    if (order.expiresAt > now) continue;
    try {
      await deps.updateOrder(order.id, (current) => {
        // Re-checked inside the transaction: the owner may have just accepted it.
        if (current.status !== 'pending' || current.expiresAt > now) {
          throw new DomainError('invalid_transition', 'No longer expirable');
        }
        return applyStatusChange(current, 'expired', now);
      });
      expired.push(order.id);
    } catch (e) {
      if (!(e instanceof DomainError)) throw e;
    }
  }
  return expired;
}
export interface ClaimPaymentRequest {
  orderId: string;
  /** 'claim' (customer: "I have paid by UPI") or 'dismiss' (owner: "not received"). */
  action?: 'claim' | 'dismiss';
}

/** The customer says they paid by UPI; the owner checks the money and confirms (or dismisses). Money is never marked paid here. */
export async function claimPaymentCore(deps: Deps, actor: Actor, req: ClaimPaymentRequest, now: number): Promise<{ ok: true }> {
  if (!req || typeof req.orderId !== 'string' || !req.orderId) throw new DomainError('invalid_request', 'Order id is required');
  const action = req.action ?? 'claim';
  await deps.updateOrder(req.orderId, (current) => {
    if (action === 'dismiss') {
      if (!actor.isAdmin) throw new DomainError('forbidden', 'Owner only');
      return { payClaim: null };
    }
    if (!actor.isAdmin && current.customerUid !== actor.uid) throw new DomainError('forbidden', 'Not your order');
    if (!isLiveStatus(current.status)) throw new DomainError('invalid_transition', 'This order is not ready for payment');
    if (current.payment) return {};
    return { payClaim: { method: 'upi' as const, at: now } };
  });
  return { ok: true };
}

export interface ReviewRequest {
  orderId: string;
  rating: number;
  comment?: string;
}

/** One review per delivered order, only by the customer who placed it. */
export async function submitReviewCore(deps: Deps, actor: Actor, req: ReviewRequest, now: number): Promise<{ ok: true }> {
  if (!req || typeof req.orderId !== 'string' || !req.orderId) throw new DomainError('invalid_request', 'Order id is required');
  if (!Number.isInteger(req.rating) || req.rating < 1 || req.rating > 5) throw new DomainError('invalid_request', 'Pick 1 to 5 stars');
  const comment = typeof req.comment === 'string' ? req.comment.replace(/\s+/g, ' ').trim().slice(0, 300) : '';
  const done = await deps.updateOrder(req.orderId, (current) => {
    if (current.customerUid !== actor.uid) throw new DomainError('forbidden', 'Not your order');
    if (current.status !== 'delivered') throw new DomainError('invalid_transition', 'You can rate an order once it is delivered');
    if (current.review) throw new DomainError('invalid_request', 'Thanks, you already rated this order');
    return { review: { rating: req.rating, ...(comment ? { comment } : {}), at: now } };
  });
  if (deps.publishReview) {
    const first = (done.customer?.name ?? '').trim().split(/\s+/)[0]?.slice(0, 20) || 'Customer';
    try {
      await deps.publishReview({ id: req.orderId, name: first, rating: req.rating, ...(comment ? { comment } : {}), at: now, public: true });
    } catch {
      /* the rating itself is saved; publishing is best-effort */
    }
  }
  return { ok: true };
}

/** What discount would this phone get right now? (Shown in the cart; the server re-checks when the order is placed.) */
export async function loyaltyPreviewCore(deps: Deps, rawPhone: unknown): Promise<{ percent: number; orders: number }> {
  const phone = typeof rawPhone === 'string' ? normalizePhone(rawPhone) : null;
  if (!phone || !deps.getCustomer) return { percent: 0, orders: 0 };
  const [config, customer] = await Promise.all([deps.getConfig(), deps.getCustomer(phone)]);
  const orders = customer?.orders ?? 0;
  return { percent: loyaltyPercentFor(config, orders), orders };
}

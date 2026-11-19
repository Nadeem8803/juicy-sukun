import { DomainError } from './errors';
import { assertTransition, isTerminal, needsReason } from './order-state';
import { computeTotals, priceLines } from './pricing';
import { validatePlaceOrder } from './validation';
import type {
  InvoiceInfo,
  MenuItem,
  Order,
  OrderStatus,
  PlaceOrderRequest,
  PrivateConfig,
  PublicConfig,
  ShopStatus,
} from './types';

export interface BuildOrderInput {
  request: PlaceOrderRequest;
  menu: MenuItem[];
  config: PublicConfig & Pick<PrivateConfig, 'orderTimeoutMinutes'>;
  shop: ShopStatus;
  uid: string;
  id: string;
  number: string;
  now: number;
  /** Dine-in: the open bill of this table, if any (this order joins it). */
  billId?: string | null;
  /** Loyalty discount in percent (0 = none). Decided by the server from the customer's order history. */
  loyaltyPercent?: number;
}

/**
 * Pure function that turns a customer's request into a pending order.
 * Cloud Functions call it inside placeOrder; nothing here touches Firebase, so it is fully unit-tested.
 */
export function buildOrder(input: BuildOrderInput): Order {
  const { request, menu, config, shop, uid, id, number, now } = input;

  if (!shop.open) throw new DomainError('shop_closed', 'The cafe is not taking orders right now');

  const clean = validatePlaceOrder(request, config);
  const lines = priceLines(clean.lines, menu);
  // Dine-in has no delivery charge.
  const totals = computeTotals(lines, clean.orderType === 'dine_in' ? { ...config, deliveryFee: 0 } : config);
  const dine = clean.orderType === 'dine_in';
  const percent = Math.max(0, Math.min(50, Math.round(input.loyaltyPercent ?? 0)));
  const discountAmount = percent ? Math.min(totals.subtotal, Math.round((totals.subtotal * percent) / 100)) : 0;

  return {
    id,
    number,
    customerUid: uid,
    customer: clean.customer,
    location: clean.location,
    note: clean.note,
    lines,
    subtotal: totals.subtotal,
    deliveryFee: totals.deliveryFee,
    total: totals.total - discountAmount,
    ...(discountAmount ? { discount: { percent, amount: discountAmount } } : {}),
    status: 'pending',
    paymentMethod: 'COD',
    createdAt: now,
    expiresAt: now + config.orderTimeoutMinutes * 60_000,
    history: [{ status: 'pending', at: now }],
    orderType: clean.orderType,
    ...(dine ? { table: clean.table!, billId: input.billId ?? id, billState: 'open' as const } : {}),
  };
}

export interface StatusChangeOptions {
  reason?: string;
  /** Required when accepting: the cafe details the customer will see on the invoice. */
  invoice?: InvoiceInfo;
}

/** Fields to write to the order document for a status change. Throws on an illegal change. */
export function applyStatusChange(
  order: Pick<Order, 'status' | 'history'> & { billState?: Order['billState'] },
  to: OrderStatus,
  now: number,
  options: StatusChangeOptions = {},
): Partial<Order> {
  assertTransition(order.status, to);

  const reason = (options.reason ?? '').trim();
  if (needsReason(to) && reason.length < 3) {
    throw new DomainError('reason_required', 'A short reason is required');
  }
  if (to === 'accepted' && !options.invoice) {
    throw new DomainError('invalid_request', 'Cafe details are required to accept an order');
  }

  const patch: Partial<Order> = {
    status: to,
    history: [...order.history, { status: to, at: now, ...(reason ? { reason } : {}) }],
  };
  if (reason && (to === 'rejected' || to === 'cancelled')) patch.rejectReason = reason;
  if (to === 'accepted') patch.invoice = options.invoice;
  if (isTerminal(to)) patch.closedAt = now;
  // A refused / cancelled round must not hold a table's bill open.
  if (order.billState === 'open' && (to === 'rejected' || to === 'cancelled' || to === 'expired')) patch.billState = 'closed';
  return patch;
}

import { describe, expect, it } from 'vitest';
import { DomainError } from './errors';
import { applyStatusChange, buildOrder } from './order-builder';
import { invoiceNumber, invoiceText } from './invoice';
import { MENU_SEED } from './menu-seed';
import { DEFAULT_CONFIG } from './types';
import type { InvoiceInfo, PlaceOrderRequest } from './types';

const now = 1_800_000_000_000;
const customer = { name: 'Ayesha Shaikh', phone: '9876543210', address: 'Near bus stand, Akkalkot' };

function build(request: Partial<PlaceOrderRequest>, open = true) {
  return buildOrder({
    request: { lines: [{ itemId: 'pizza-veg-choice-pizza', sizeIndex: 0, qty: 1 }], customer, ...request },
    menu: MENU_SEED,
    config: DEFAULT_CONFIG,
    shop: { open },
    uid: 'uid-1',
    id: 'order-1',
    number: 'JS-1001',
    now,
  });
}

function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    return (e as DomainError).code;
  }
  return 'no_error';
}

describe('buildOrder', () => {
  it('builds a pending COD order with server-side prices', () => {
    const order = build({});
    expect(order).toMatchObject({
      id: 'order-1',
      number: 'JS-1001',
      customerUid: 'uid-1',
      status: 'pending',
      paymentMethod: 'COD',
      subtotal: 159,
      deliveryFee: 39,
      total: 198,
      createdAt: now,
    });
    expect(order.history).toEqual([{ status: 'pending', at: now }]);
  });

  it('gives the owner 5 minutes by default', () => {
    expect(build({}).expiresAt).toBe(now + 5 * 60_000);
  });

  it('makes delivery free from ₹300', () => {
    const order = build({
      lines: [
        { itemId: 'pizza-veg-choice-pizza', sizeIndex: 1, qty: 1 }, // 269
        { itemId: 'drinks-blue-mint', sizeIndex: 0, qty: 1 }, // 80
      ],
    });
    expect(order).toMatchObject({ subtotal: 349, deliveryFee: 0, total: 349 });
  });

  it('refuses when the shop is closed', () => {
    expect(codeOf(() => build({}, false))).toBe('shop_closed');
  });

  it('refuses unknown items', () => {
    expect(codeOf(() => build({ lines: [{ itemId: 'ghost', sizeIndex: 0, qty: 1 }] }))).toBe('invalid_item');
  });

  it('refuses a sold-out item', () => {
    const menu = MENU_SEED.map((m) => (m.id === 'drinks-blue-mint' ? { ...m, available: false } : m));
    const run = () =>
      buildOrder({
        request: { lines: [{ itemId: 'drinks-blue-mint', sizeIndex: 0, qty: 1 }], customer },
        menu,
        config: DEFAULT_CONFIG,
        shop: { open: true },
        uid: 'u',
        id: 'o',
        number: 'JS-1',
        now,
      });
    expect(codeOf(run)).toBe('item_unavailable');
  });

  it('does not write undefined fields (Firestore rejects them)', () => {
    const order = build({});
    expect(Object.values(order).includes(undefined as never)).toBe(false);
    expect('invoice' in order).toBe(false);
  });
});

describe('applyStatusChange', () => {
  const invoice: InvoiceInfo = {
    cafeName: 'Juicysukun Café',
    cafePhone: '9000000000',
    cafeAddress: 'Akkalkot',
    fssai: '1234',
  };
  const base = () => ({ status: 'pending' as const, history: [{ status: 'pending' as const, at: now }] });

  it('accepting attaches the invoice details and extends history', () => {
    const patch = applyStatusChange(base(), 'accepted', now + 1000, { invoice });
    expect(patch.status).toBe('accepted');
    expect(patch.invoice).toEqual(invoice);
    expect(patch.history).toHaveLength(2);
    expect(patch.closedAt).toBeUndefined();
  });

  it('refuses to accept without cafe details', () => {
    expect(codeOf(() => applyStatusChange(base(), 'accepted', now))).toBe('invalid_request');
  });

  it('rejecting needs a reason and stores it', () => {
    expect(codeOf(() => applyStatusChange(base(), 'rejected', now))).toBe('reason_required');
    expect(codeOf(() => applyStatusChange(base(), 'rejected', now, { reason: ' no' }))).toBe('reason_required');
    const patch = applyStatusChange(base(), 'rejected', now + 5, { reason: 'Item out of stock' });
    expect(patch.rejectReason).toBe('Item out of stock');
    expect(patch.closedAt).toBe(now + 5);
  });

  it('closes the order on every terminal status', () => {
    expect(applyStatusChange(base(), 'expired', now + 9).closedAt).toBe(now + 9);
    const active = { status: 'out_for_delivery' as const, history: [] };
    expect(applyStatusChange(active, 'delivered', now + 9).closedAt).toBe(now + 9);
  });

  it('refuses illegal changes', () => {
    expect(codeOf(() => applyStatusChange(base(), 'delivered', now))).toBe('invalid_transition');
    const done = { status: 'delivered' as const, history: [] };
    expect(codeOf(() => applyStatusChange(done, 'cancelled', now, { reason: 'changed my mind' }))).toBe(
      'invalid_transition',
    );
  });
});

describe('invoice', () => {
  it('numbers and prints an invoice for sharing', () => {
    const order = { ...build({}), invoice: { cafeName: 'Juicysukun Café', cafePhone: '9000000000', cafeAddress: 'Akkalkot', fssai: '1' } };
    expect(invoiceNumber(order)).toBe('INV-JS-1001');
    const text = invoiceText(order);
    expect(text).toContain('1 x Veg Choice Pizza (Regular) - ₹159');
    expect(text).toContain('Delivery: ₹39');
    expect(text).toContain('Total (cash on delivery): ₹198');
    expect(text).toContain('Call us: 9000000000');
  });
});

import { describe, expect, it } from 'vitest';
import { DomainError } from './errors';
import {
  amountToFreeDelivery,
  computeTotals,
  deliveryFeeFor,
  formatINR,
  minPrice,
  priceLines,
} from './pricing';
import type { MenuItem } from './types';

const cfg = { freeDeliveryMin: 300, deliveryFee: 39 };

const menu: MenuItem[] = [
  { id: 'pizza', name: 'Veg Choice Pizza', category: 'Pizza', available: true, sort: 1,
    sizes: [{ label: 'Regular', price: 159 }, { label: 'Medium', price: 269 }] },
  { id: 'coffee', name: 'Cold Coffee', category: 'Drinks', available: true, sort: 2,
    sizes: [{ label: '', price: 90 }] },
  { id: 'gone', name: 'Sold Out Thing', category: 'Drinks', available: false, sort: 3,
    sizes: [{ label: '', price: 50 }] },
];

describe('delivery fee', () => {
  it('is ₹0 for an empty cart', () => {
    expect(deliveryFeeFor(0, cfg)).toBe(0);
  });
  it('is ₹39 below ₹300', () => {
    expect(deliveryFeeFor(1, cfg)).toBe(39);
    expect(deliveryFeeFor(299, cfg)).toBe(39);
  });
  it('is FREE at exactly ₹300 and above', () => {
    expect(deliveryFeeFor(300, cfg)).toBe(0);
    expect(deliveryFeeFor(301, cfg)).toBe(0);
    expect(deliveryFeeFor(1200, cfg)).toBe(0);
  });
  it('follows a changed config', () => {
    expect(deliveryFeeFor(399, { freeDeliveryMin: 400, deliveryFee: 49 })).toBe(49);
    expect(deliveryFeeFor(400, { freeDeliveryMin: 400, deliveryFee: 49 })).toBe(0);
  });
});

describe('amountToFreeDelivery', () => {
  it('tells how much more to add', () => {
    expect(amountToFreeDelivery(90, cfg)).toBe(210);
    expect(amountToFreeDelivery(299, cfg)).toBe(1);
  });
  it('is 0 when already free or the cart is empty', () => {
    expect(amountToFreeDelivery(300, cfg)).toBe(0);
    expect(amountToFreeDelivery(500, cfg)).toBe(0);
    expect(amountToFreeDelivery(0, cfg)).toBe(0);
  });
});

describe('computeTotals', () => {
  it('adds the fee under the threshold', () => {
    expect(computeTotals([{ total: 159 }], cfg)).toEqual({ subtotal: 159, deliveryFee: 39, total: 198 });
  });
  it('does not add the fee at the threshold', () => {
    expect(computeTotals([{ total: 159 }, { total: 141 }], cfg)).toEqual({
      subtotal: 300,
      deliveryFee: 0,
      total: 300,
    });
  });
});

describe('priceLines', () => {
  it('prices from the live menu, never from the client', () => {
    const lines = priceLines([{ itemId: 'pizza', sizeIndex: 1, qty: 2 }], menu);
    expect(lines).toEqual([
      { itemId: 'pizza', name: 'Veg Choice Pizza', sizeLabel: 'Medium', unitPrice: 269, qty: 2, total: 538 },
    ]);
  });
  it('merges the same item and size', () => {
    const lines = priceLines(
      [
        { itemId: 'coffee', sizeIndex: 0, qty: 1 },
        { itemId: 'coffee', sizeIndex: 0, qty: 2 },
      ],
      menu,
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ qty: 3, total: 270 });
  });
  it('keeps different sizes of one item as separate lines', () => {
    const lines = priceLines(
      [
        { itemId: 'pizza', sizeIndex: 0, qty: 1 },
        { itemId: 'pizza', sizeIndex: 1, qty: 1 },
      ],
      menu,
    );
    expect(lines.map((l) => l.total)).toEqual([159, 269]);
  });
  it('rejects unknown items and sizes', () => {
    expect(() => priceLines([{ itemId: 'nope', sizeIndex: 0, qty: 1 }], menu)).toThrow(DomainError);
    expect(() => priceLines([{ itemId: 'coffee', sizeIndex: 1, qty: 1 }], menu)).toThrow(/size/);
  });
  it('rejects sold-out items', () => {
    try {
      priceLines([{ itemId: 'gone', sizeIndex: 0, qty: 1 }], menu);
      expect.unreachable();
    } catch (e) {
      expect((e as DomainError).code).toBe('item_unavailable');
    }
  });
});

describe('helpers', () => {
  it('formats rupees with Indian grouping', () => {
    expect(formatINR(129)).toBe('₹129');
    expect(formatINR(12345)).toBe('₹12,345');
  });
  it('finds the lowest price of an item', () => {
    expect(minPrice(menu[0])).toBe(159);
    expect(minPrice(menu[1])).toBe(90);
  });
});

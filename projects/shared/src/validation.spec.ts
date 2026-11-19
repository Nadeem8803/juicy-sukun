import { describe, expect, it } from 'vitest';
import { DomainError } from './errors';
import { normalizePhone, validatePlaceOrder } from './validation';
import type { PlaceOrderRequest } from './types';

const limits = { maxLines: 30, maxQtyPerLine: 20 };

const good = (): PlaceOrderRequest => ({
  lines: [{ itemId: 'pizza', sizeIndex: 1, qty: 2 }],
  customer: { name: '  Ayesha   Shaikh ', phone: '+91 98765 43210', address: 'Near bus stand, Akkalkot' },
  location: { lat: 17.5236, lng: 76.2043, accuracy: 18.6 },
  note: ' less spicy ',
});

function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    return (e as DomainError).code;
  }
  return 'no_error';
}

describe('normalizePhone', () => {
  it.each([
    ['9876543210', '9876543210'],
    ['+91 98765 43210', '9876543210'],
    ['91-98765-43210', '9876543210'],
    ['098765 43210', '9876543210'],
  ])('accepts %s', (input, expected) => {
    expect(normalizePhone(input)).toBe(expected);
  });

  it.each(['12345', '5876543210', '98765432101', 'abcdefghij', ''])('rejects %s', (input) => {
    expect(normalizePhone(input)).toBeNull();
  });
});

describe('validatePlaceOrder', () => {
  it('cleans up a good request', () => {
    const out = validatePlaceOrder(good(), limits);
    expect(out.customer).toEqual({
      name: 'Ayesha Shaikh',
      phone: '9876543210',
      address: 'Near bus stand, Akkalkot',
    });
    expect(out.note).toBe('less spicy');
    expect(out.location).toEqual({ lat: 17.5236, lng: 76.2043, accuracy: 19 });
  });

  it('allows a missing location and note', () => {
    const req = { ...good(), location: null, note: undefined };
    const out = validatePlaceOrder(req, limits);
    expect(out.location).toBeNull();
    expect(out.note).toBe('');
  });

  it('rejects an empty cart', () => {
    expect(codeOf(() => validatePlaceOrder({ ...good(), lines: [] }, limits))).toBe('invalid_request');
  });

  it('rejects bad quantities and sizes', () => {
    for (const bad of [0, -1, 1.5, 21]) {
      const req = { ...good(), lines: [{ itemId: 'a', sizeIndex: 0, qty: bad }] };
      expect(codeOf(() => validatePlaceOrder(req, limits))).toBe('invalid_request');
    }
    const req = { ...good(), lines: [{ itemId: 'a', sizeIndex: 4, qty: 1 }] };
    expect(codeOf(() => validatePlaceOrder(req, limits))).toBe('invalid_request');
  });

  it('rejects too many cart lines', () => {
    const lines = Array.from({ length: 31 }, (_, i) => ({ itemId: `i${i}`, sizeIndex: 0, qty: 1 }));
    expect(codeOf(() => validatePlaceOrder({ ...good(), lines }, limits))).toBe('invalid_request');
  });

  it('rejects an invalid phone, short name or short address', () => {
    const c = good().customer;
    expect(codeOf(() => validatePlaceOrder({ ...good(), customer: { ...c, phone: '12345' } }, limits))).toBe('invalid_request');
    expect(codeOf(() => validatePlaceOrder({ ...good(), customer: { ...c, name: 'A' } }, limits))).toBe('invalid_request');
    expect(codeOf(() => validatePlaceOrder({ ...good(), customer: { ...c, address: 'home' } }, limits))).toBe('invalid_request');
  });

  it('rejects an impossible location', () => {
    const req = { ...good(), location: { lat: 123, lng: 10 } };
    expect(codeOf(() => validatePlaceOrder(req, limits))).toBe('invalid_request');
  });

  it('rejects a note that is too long', () => {
    expect(codeOf(() => validatePlaceOrder({ ...good(), note: 'x'.repeat(201) }, limits))).toBe('invalid_request');
  });
});

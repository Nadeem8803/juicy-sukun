import { describe, expect, it } from 'vitest';
import { isUpiId, upiLink } from './upi';
import { loyaltyPercentFor } from './loyalty';
import { ratingSummary, toCsv } from './analytics';
import { awaitingPayment } from './bill';
import type { Order } from './types';

describe('upiLink', () => {
  it('builds a pay link with the amount and a note', () => {
    expect(upiLink({ id: ' cafe@okbank ', name: 'Juicysukun Cafe', amount: 308, note: 'Order JS-1001' })).toBe(
      'upi://pay?pa=cafe%40okbank&pn=Juicysukun%20Cafe&am=308.00&cu=INR&tn=Order%20JS-1001',
    );
  });
  it('checks the shape of a UPI id', () => {
    expect(isUpiId('name@bank')).toBe(true);
    expect(isUpiId('9876543210@ybl')).toBe(true);
    expect(isUpiId('no-at-sign')).toBe(false);
    expect(isUpiId('a@b')).toBe(false);
  });
});

describe('loyaltyPercentFor', () => {
  const cfg = { loyaltyEnabled: true, loyaltyAfter: 5, loyaltyPercent: 8 };
  it('gives the discount only after enough completed orders', () => {
    expect(loyaltyPercentFor(cfg, 4)).toBe(0);
    expect(loyaltyPercentFor(cfg, 5)).toBe(8);
  });
  it('is off when disabled and capped at 50%', () => {
    expect(loyaltyPercentFor({ ...cfg, loyaltyEnabled: false }, 99)).toBe(0);
    expect(loyaltyPercentFor({ ...cfg, loyaltyPercent: 90 }, 9)).toBe(50);
  });
});

describe('analytics helpers', () => {
  it('summarises ratings', () => {
    const o = (r?: number) => ({ review: r ? { rating: r, at: 1 } : undefined }) as unknown as Order;
    expect(ratingSummary([o(5), o(4), o(), o(5)])).toEqual({ count: 3, average: 4.7, stars: [0, 0, 0, 1, 2] });
  });
  it('writes safe CSV', () => {
    const csv = toCsv([['Name', 'Note'], ['A, B', '=1+1']]);
    expect(csv).toContain('"A, B"');
    expect(csv).toContain("'=1+1");
  });
});

describe('awaitingPayment', () => {
  it('is true for delivered orders with no payment', () => {
    expect(awaitingPayment({ status: 'delivered' } as Order)).toBe(true);
    expect(awaitingPayment({ status: 'delivered', payment: { method: 'cash' } } as unknown as Order)).toBe(false);
    expect(awaitingPayment({ status: 'preparing' } as Order)).toBe(false);
  });
});

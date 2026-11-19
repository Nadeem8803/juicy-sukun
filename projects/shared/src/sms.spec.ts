import { describe, expect, it } from 'vitest';
import { payAmount, upiPaise } from './upi';
import { assertWithinDeliveryArea, deliveryArea, distanceKm } from './distance';
import { describeSample, matchCredit, parseCreditSms, senderMatches, type Payable } from './sms';

const UNION = 'A/c *4484 Credited for Rs:533.00 on 08-11-2026 15:51:39 by Mob Bk ref no 322005888207 Avl Bal Rs:15910.80.Never Share OTP/PIN/CVV-Union Bank of India';

describe('parseCreditSms', () => {
  it('reads the Union Bank credit message', () => {
    const p = parseCreditSms(UNION)!;
    expect(p.amount).toBe(533);
    expect(p.ref).toBe('322005888207');
    expect(new Date(p.at!).toISOString()).toBe('2026-11-08T10:21:39.000Z'); // 15:51:39 IST
  });
  it('does not mistake the balance for the amount', () => {
    expect(parseCreditSms('Rs.1,250.50 credited to your A/c. Avl Bal Rs.99,999.00')?.amount).toBe(1250.5);
    expect(parseCreditSms('Avl Bal Rs:500.00 Credited Rs:20.00')?.amount).toBe(20);
  });
  it('understands other wording', () => {
    expect(parseCreditSms('INR 75.00 credited to a/c XX1234 by UPI/CR/412345678901')).toMatchObject({ amount: 75, ref: '412345678901' });
    expect(parseCreditSms('₹40 received in your account')?.amount).toBe(40);
  });
  it('ignores debits, OTPs and unrelated messages', () => {
    expect(parseCreditSms('A/c *4484 Debited for Rs:50.00 on 08-11-2026 ref no 631234048692 Bal Rs:21345.80')).toBeNull();
    expect(parseCreditSms('Your OTP is 123456. Do not share.')).toBeNull();
    expect(parseCreditSms('Hello, offer of Rs 100 for you')).toBeNull();
    expect(parseCreditSms('')).toBeNull();
  });
});

describe('describeSample / senderMatches', () => {
  it('explains what it understood', () => {
    expect(describeSample(UNION)).toMatchObject({ ok: true, message: 'Understood: amount ₹533.00, ref 322005888207' });
    expect(describeSample('hello').ok).toBe(false);
    expect(describeSample('').ok).toBe(false);
  });
  it('matches sender keywords loosely', () => {
    expect(senderMatches('JM-UNIONB-S', 'unionb')).toBe(true);
    expect(senderMatches('AD-HDFCBK', 'unionb')).toBe(false);
    expect(senderMatches('JM-UNIONB-S', '')).toBe(false);
  });
});

describe('delivery distance', () => {
  const cfg = { deliveryMaxKm: 5, cafeLat: 17.523, cafeLng: 76.206 };
  it('measures km between two points', () => {
    expect(distanceKm({ lat: 17.523, lng: 76.206 }, { lat: 17.523, lng: 76.206 })).toBe(0);
    const d = distanceKm({ lat: 17.523, lng: 76.206 }, { lat: 17.568, lng: 76.206 });
    expect(d).toBeGreaterThan(4.9);
    expect(d).toBeLessThan(5.1);
  });
  it('is not limited when the owner set no limit or no cafe position', () => {
    expect(deliveryArea({ ...cfg, deliveryMaxKm: 0 }, null).limited).toBe(false);
    expect(deliveryArea({ ...cfg, cafeLat: 0 }, { lat: 1, lng: 1 }).limited).toBe(false);
  });
  it('accepts near, refuses far, and needs a location', () => {
    expect(() => assertWithinDeliveryArea(cfg, { lat: 17.53, lng: 76.21 })).not.toThrow();
    expect(() => assertWithinDeliveryArea(cfg, { lat: 18.5, lng: 76.2 })).toThrow(/within 5 km/);
    expect(() => assertWithinDeliveryArea(cfg, null)).toThrow(/share your location/);
  });
  it('gives GPS error as benefit of the doubt', () => {
    const edge = { lat: 17.523 + 5.2 / 111.2, lng: 76.206, accuracy: 300 };
    expect(deliveryArea(cfg, edge)).toMatchObject({ ok: true });
  });
});

describe('paise tag', () => {
  it('gives 1..99 paise from the order number and builds the exact amount', () => {
    expect(upiPaise('JS-1007')).toBe(((1007 % 99) + 1));
    expect(upiPaise('JS-1')).toBe(2);
    expect(payAmount(318, 'JS-1', false)).toBe(318);
    expect(payAmount(318, 'JS-1', true)).toBe(318.02);
  });
  it('matches one order by its exact amount even when another has the same price', () => {
    const now = Date.UTC(2026, 10, 8, 10, 30);
    const mk = (id: string, exact?: number): Payable => ({ id, number: id, amount: 318, ...(exact ? { exactAmount: exact } : {}), createdAt: now - 10 * 60_000 });
    const m = matchCredit({ amount: 318.07, at: now - 60_000 }, [mk('a', 318.03), mk('b', 318.07)], { now, windowMin: 30 });
    expect(m.kind).toBe('one');
    expect(m.payables[0]!.id).toBe('b');
  });
  it('still matches a plain-amount payment when the paise tag is on', () => {
    const now = Date.UTC(2026, 10, 8, 10, 30);
    const m = matchCredit({ amount: 318, at: now - 60_000 }, [{ id: 'a', number: 'a', amount: 318, exactAmount: 318.03, createdAt: now - 10 * 60_000 }], { now, windowMin: 30 });
    expect(m.kind).toBe('one');
  });
});

describe('matchCredit', () => {
  const now = Date.UTC(2026, 10, 8, 10, 30);
  const credit = { amount: 533, at: now - 60_000 };
  const p = (id: string, amount: number, minsAgo: number, claimMinsAgo?: number): Payable => ({
    id,
    number: id.toUpperCase(),
    amount,
    createdAt: now - minsAgo * 60_000,
    ...(claimMinsAgo !== undefined ? { claimAt: now - claimMinsAgo * 60_000 } : {}),
  });
  it('finds the single order with the same amount', () => {
    const m = matchCredit(credit, [p('a', 533, 20), p('b', 217, 10)], { now, windowMin: 30 });
    expect(m.kind).toBe('one');
    expect(m.payables[0]!.id).toBe('a');
  });
  it('prefers the order whose customer said "I have paid"', () => {
    const m = matchCredit(credit, [p('a', 533, 25), p('b', 533, 15, 2)], { now, windowMin: 30 });
    expect(m.kind).toBe('one');
    expect(m.payables[0]!.id).toBe('b');
  });
  it('asks the owner when several could match, and never for different amounts', () => {
    expect(matchCredit(credit, [p('a', 533, 25), p('b', 533, 15)], { now, windowMin: 30 }).kind).toBe('many');
    expect(matchCredit(credit, [p('a', 534, 25)], { now, windowMin: 30 }).kind).toBe('none');
  });
  it('ignores orders placed after the money arrived', () => {
    expect(matchCredit({ amount: 533, at: now - 10 * 60_000 }, [p('a', 533, 2)], { now, windowMin: 30 }).kind).toBe('none');
  });
});

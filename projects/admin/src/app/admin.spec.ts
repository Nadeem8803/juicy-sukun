import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CONFIG, MENU_SEED, type Order } from '@juicy/shared';
import { Siren } from './core/alarm';
import { fitWithin } from './core/image';
import { todayStats } from './core/orders-store';
import { draftFrom, draftToItem, emptyDraft, uniqueId, validateDraft } from './pages/menu-page';
import { loginMessage } from './pages/login-page';
import { mapsLink } from './pages/orders-page';
import { validateSettings } from './pages/settings-page';

const order = (over: Partial<Order>): Order =>
  ({ id: 'x', number: 'JS-1', total: 100, status: 'delivered', createdAt: Date.now(), customer: { name: 'A', phone: '9876543210', address: 'Somewhere nice' }, location: null, ...over }) as Order;

describe('validateSettings busy mode', () => {
  it('accepts 0-120 extra minutes and rejects the rest', () => {
    expect(validateSettings({ ...DEFAULT_CONFIG, cafeName: 'x', busyExtraMin: 15 })).toBeNull();
    expect(validateSettings({ ...DEFAULT_CONFIG, cafeName: 'x', busyExtraMin: 500 })).toMatch(/Busy/);
  });
});

describe('Siren', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  it('rings immediately, keeps ringing, and stops cleanly', () => {
    const ring = vi.fn();
    const s = new Siren(ring, 1000);
    s.start();
    expect(ring).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(3000);
    expect(ring).toHaveBeenCalledTimes(4);
    s.stop();
    vi.advanceTimersByTime(5000);
    expect(ring).toHaveBeenCalledTimes(4);
    expect(s.active).toBe(false);
  });
  it('start() twice does not double up', () => {
    const ring = vi.fn();
    const s = new Siren(ring, 1000);
    s.start();
    s.start();
    vi.advanceTimersByTime(1000);
    expect(ring).toHaveBeenCalledTimes(2);
    s.stop();
  });
});

describe('todayStats', () => {
  const now = new Date(2026, 10, 5, 15, 0).getTime();
  it('counts accepted work as sales, ignores rejected/expired and yesterday', () => {
    const list = [
      order({ total: 300, status: 'delivered', createdAt: now - 3600_000 }),
      order({ total: 200, status: 'preparing', createdAt: now - 1800_000 }),
      order({ total: 999, status: 'rejected', createdAt: now - 1000 }),
      order({ total: 999, status: 'expired', createdAt: now - 1000 }),
      order({ total: 777, status: 'delivered', createdAt: now - 86_400_000 * 2 }),
    ];
    expect(todayStats(list, now)).toEqual({ orders: 2, revenue: 500, rejected: 1 });
  });
});

describe('menu editor helpers', () => {
  it('validates names and prices', () => {
    const d = { ...emptyDraft(), name: 'Mango Shake', price1: '110' };
    expect(validateDraft(d)).toBeNull();
    expect(validateDraft({ ...d, name: '' })).toMatch(/name/);
    expect(validateDraft({ ...d, price1: '0' })).toMatch(/price/);
    expect(validateDraft({ ...d, price1: 'abc' })).toMatch(/price/);
    expect(validateDraft({ ...d, twoSizes: true })).toMatch(/size/i);
    expect(validateDraft({ ...d, twoSizes: true, label1: 'Reg', label2: 'Med', price2: '' })).toMatch(/second/);
    expect(validateDraft({ ...d, twoSizes: true, label1: 'Reg', label2: 'Med', price2: '200' })).toBeNull();
  });
  it('builds a menu item; single-size items have an empty label', () => {
    const d = { ...emptyDraft('Drinks'), name: ' Mango Shake ', price1: '110.4' };
    expect(draftToItem(d, 'drinks-mango-shake', 7000)).toEqual({
      id: 'drinks-mango-shake', name: 'Mango Shake', category: 'Drinks', sizes: [{ label: '', price: 110 }],
      available: true, special: false, imageUrl: null, sort: 7000,
    });
  });
  it('round-trips an existing two-size item', () => {
    const pizza = MENU_SEED.find((m) => m.id === 'pizza-veg-choice-pizza')!;
    const back = draftToItem(draftFrom(pizza), pizza.id, pizza.sort);
    expect(back.sizes).toEqual(pizza.sizes);
    expect(back.name).toBe(pizza.name);
  });
  it('makes unique ids', () => {
    expect(uniqueId('Drinks', 'Mango Shake', new Set())).toBe('drinks-mango-shake');
    expect(uniqueId('Drinks', 'Mango Shake', new Set(['drinks-mango-shake']))).toBe('drinks-mango-shake-2');
  });
});

describe('fitWithin', () => {
  it('scales the long side down, never up', () => {
    expect(fitWithin(4000, 3000, 800)).toEqual({ w: 800, h: 600 });
    expect(fitWithin(300, 200, 800)).toEqual({ w: 300, h: 200 });
  });
});

describe('messages & links', () => {
  it('login errors are friendly', () => {
    expect(loginMessage({ code: 'auth/invalid-credential' })).toMatch(/Wrong email/);
    expect(loginMessage(new Error('not_admin'))).toMatch(/owner/);
    expect(loginMessage({})).toMatch(/Could not sign in/);
  });
  it('maps link prefers exact coordinates, falls back to the address', () => {
    expect(mapsLink({ location: { lat: 17.5, lng: 76.2 }, customer: { name: '', phone: '', address: 'x' } })).toContain('destination=17.5,76.2');
    expect(mapsLink({ location: null, customer: { name: '', phone: '', address: 'Near bus stand' } })).toContain('Near%20bus%20stand');
  });
  it('validates settings', () => {
    const ok = { ...DEFAULT_CONFIG, cafePhone: '9876543210' };
    expect(validateSettings(ok)).toBeNull();
    expect(validateSettings({ ...ok, cafePhone: '123' })).toMatch(/phone/);
    expect(validateSettings({ ...ok, deliveryFee: -1 })).toMatch(/Delivery/);
    expect(validateSettings({ ...ok, orderTimeoutMinutes: 0 })).toMatch(/Auto-reject/);
  });
});

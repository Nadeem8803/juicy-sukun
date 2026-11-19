import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_PUBLIC_CONFIG, MENU_SEED } from '@juicy/shared';
import { BACKEND, type CustomerBackend } from './backend';
import { Cart } from './cart';
import { Store } from './store';

function fakeBackend(menu = MENU_SEED, open = true): CustomerBackend {
  return {
    watchMenu: (cb) => (cb(menu), () => {}),
    watchShop: (cb) => (cb({ open }), () => {}),
    watchConfig: (cb) => (cb(DEFAULT_PUBLIC_CONFIG), () => {}),
    placeOrder: async () => ({ orderId: 'x', number: 'JS-1' }),
    watchOrder: () => () => {},
    cancelOrder: async () => {},
  };
}

function setup(menu = MENU_SEED, open = true) {
  localStorage.clear();
  TestBed.configureTestingModule({ providers: [{ provide: BACKEND, useValue: fakeBackend(menu, open) }] });
  return { cart: TestBed.inject(Cart), store: TestBed.inject(Store) };
}

describe('Cart', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('charges ₹39 delivery under ₹300 and nothing from ₹300', () => {
    const { cart } = setup();
    cart.add('drinks-blue-mint', 0); // 80
    expect(cart.totals()).toEqual({ subtotal: 80, deliveryFee: 39, total: 119 });
    expect(cart.toFreeDelivery()).toBe(220);
    cart.setQty('drinks-blue-mint', 0, 4); // 320
    expect(cart.totals()).toEqual({ subtotal: 320, deliveryFee: 0, total: 320 });
    expect(cart.toFreeDelivery()).toBe(0);
  });

  it('keeps sizes of the same item as separate lines', () => {
    const { cart } = setup();
    cart.add('pizza-veg-choice-pizza', 0);
    cart.add('pizza-veg-choice-pizza', 1);
    expect(cart.rows().map((r) => r.total)).toEqual([159, 269]);
    expect(cart.count()).toBe(2);
  });

  it('removes a line when quantity reaches zero and caps at the max', () => {
    const { cart } = setup();
    cart.add('drinks-blue-mint', 0);
    cart.remove('drinks-blue-mint', 0);
    expect(cart.lines()).toEqual([]);
    cart.setQty('drinks-blue-mint', 0, 999);
    expect(cart.qty('drinks-blue-mint', 0)).toBe(DEFAULT_PUBLIC_CONFIG.maxQtyPerLine);
  });

  it('flags and prunes items that sold out', () => {
    const menu = MENU_SEED.map((m) => (m.id === 'drinks-blue-mint' ? { ...m, available: false } : m));
    const { cart } = setup(menu);
    cart.add('drinks-blue-mint', 0);
    cart.add('drinks-cold-coffee', 0);
    expect(cart.unavailable().length).toBe(1);
    cart.pruneUnavailable();
    expect(cart.rows().map((r) => r.item.id)).toEqual(['drinks-cold-coffee']);
  });

  it('survives a corrupted saved cart', () => {
    localStorage.setItem('js.cart.v1', '{not json');
    TestBed.configureTestingModule({ providers: [{ provide: BACKEND, useValue: fakeBackend() }] });
    expect(TestBed.inject(Cart).lines()).toEqual([]);
  });
});

describe('Store', () => {
  beforeEach(() => TestBed.resetTestingModule());
  it('treats the shop as closed when status says so', () => {
    const { store } = setup(MENU_SEED, false);
    expect(store.isOpen()).toBe(false);
    expect(store.shopKnown()).toBe(true);
  });
  it('lists categories in menu order', () => {
    const { store } = setup();
    expect(store.categories()[0]).toBe('Pizza');
    expect(store.categories()).toContain('Drinks');
  });
});

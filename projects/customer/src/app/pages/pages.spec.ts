import { describe, expect, it } from 'vitest';
import { MENU_SEED } from '@juicy/shared';
import { PRICE_BANDS, filterMenu } from './menu-page';
import { validateForm } from './cart-page';

const band = (id: string) => PRICE_BANDS.find((b) => b.id === id)!;

describe('filterMenu', () => {
  it('searches by name, ignoring case', () => {
    const r = filterMenu(MENU_SEED, 'MOJITO', 'All', band('all'));
    expect(r.map((m) => m.name)).toEqual(expect.arrayContaining(['Virgin Mojito', 'Sugar Less Mojito']));
    expect(r.every((m) => /mojito/i.test(m.name))).toBe(true);
  });
  it('searches by category name', () => {
    expect(filterMenu(MENU_SEED, 'garlic', 'All', band('all')).every((m) => m.category === 'Garlic Bread')).toBe(true);
  });
  it('filters by category', () => {
    const r = filterMenu(MENU_SEED, '', 'Drinks', band('all'));
    expect(r.length).toBe(4);
  });
  it('filters by price band using the cheapest size', () => {
    const r = filterMenu(MENU_SEED, '', 'All', band('u100'));
    expect(r.length).toBeGreaterThan(0);
    expect(r.every((m) => Math.min(...m.sizes.map((s) => s.price)) < 100)).toBe(true);
    expect(filterMenu(MENU_SEED, '', 'All', band('300')).every((m) => Math.min(...m.sizes.map((s) => s.price)) > 300)).toBe(true);
  });
  it('combines filters and can return nothing', () => {
    expect(filterMenu(MENU_SEED, 'pizza', 'Drinks', band('all'))).toEqual([]);
  });
});

describe('filterMenu veg filter', () => {
  const menu = [
    { ...MENU_SEED[0]!, id: 'a', veg: true },
    { ...MENU_SEED[0]!, id: 'b', veg: false },
    { ...MENU_SEED[0]!, id: 'c' },
  ];
  it('shows only veg or only non-veg when asked', () => {
    expect(filterMenu(menu, '', 'All', band('all'), 'veg').map((m) => m.id)).toEqual(['a']);
    expect(filterMenu(menu, '', 'All', band('all'), 'nonveg').map((m) => m.id)).toEqual(['b']);
    expect(filterMenu(menu, '', 'All', band('all')).length).toBe(3);
  });
});

describe('validateForm', () => {
  const good = { name: 'Ayesha', phone: '9876543210', address: 'Near bus stand, Akkalkot' };
  it('accepts good details, including +91 numbers', () => {
    expect(validateForm(good)).toEqual({});
    expect(validateForm({ ...good, phone: '+91 98765 43210' })).toEqual({});
  });
  it('flags each bad field', () => {
    expect(Object.keys(validateForm({ name: 'A', phone: '123', address: 'x' })).sort()).toEqual(['address', 'name', 'phone']);
  });
});

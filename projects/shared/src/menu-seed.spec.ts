import { describe, expect, it } from 'vitest';
import { MENU_SEED } from './menu-seed';
import { CATEGORIES } from './types';

const find = (id: string) => MENU_SEED.find((m) => m.id === id);

describe('menu seed (printed menu card)', () => {
  it('has all 50 items', () => {
    expect(MENU_SEED).toHaveLength(50);
  });

  it('has unique ids and sort values', () => {
    expect(new Set(MENU_SEED.map((m) => m.id)).size).toBe(50);
    expect(new Set(MENU_SEED.map((m) => m.sort)).size).toBe(50);
  });

  it('only uses known categories, with the right counts', () => {
    const counts: Record<string, number> = {};
    for (const m of MENU_SEED) {
      expect(CATEGORIES).toContain(m.category);
      counts[m.category] = (counts[m.category] ?? 0) + 1;
    }
    expect(counts).toEqual({
      Pizza: 15,
      Burgers: 5,
      Fries: 6,
      'Garlic Bread': 7,
      Pasta: 4,
      'JS Starters': 4,
      Drinks: 4,
      Extras: 5,
    });
  });

  it('has one or two positive whole-rupee prices per item', () => {
    for (const m of MENU_SEED) {
      expect(m.sizes.length).toBeGreaterThanOrEqual(1);
      expect(m.sizes.length).toBeLessThanOrEqual(2);
      for (const s of m.sizes) {
        expect(Number.isInteger(s.price) && s.price > 0).toBe(true);
      }
      expect(m.available).toBe(true);
    }
  });

  it('matches the printed prices', () => {
    expect(find('pizza-veg-choice-pizza')?.sizes).toEqual([
      { label: 'Regular', price: 159 },
      { label: 'Medium', price: 269 },
    ]);
    expect(find('pizza-js-veg-special-pizza')?.sizes.map((s) => s.price)).toEqual([310, 539]);
    expect(find('pizza-cheese-treat-pizza')?.sizes).toEqual([{ label: '', price: 159 }]);
    expect(find('burgers-js-special-burger')?.sizes[0].price).toBe(189);
    expect(find('fries-peri-peri-fries')?.sizes[0].price).toBe(79);
    expect(find('drinks-cold-coffee')?.sizes[0].price).toBe(90);
    expect(find('drinks-blue-mint')?.sizes[0].price).toBe(80);
    expect(find('pasta-js-special-pasta')?.sizes[0].price).toBe(199);
    expect(find('extras-extra-cheese-burst')?.sizes).toEqual([
      { label: '7"', price: 70 },
      { label: '10"', price: 110 },
    ]);
  });

  it('marks the four JS Special items', () => {
    expect(MENU_SEED.filter((m) => m.special).map((m) => m.name).sort()).toEqual([
      'JS Special Burger',
      'JS Special Fries',
      'JS Special Pasta',
      'JS Veg Special Pizza',
    ]);
  });

  it('does not contain undefined values (Firestore rejects them)', () => {
    expect(JSON.stringify(MENU_SEED)).not.toContain('undefined');
    for (const m of MENU_SEED) expect(m.imageUrl).toBeNull();
  });
});

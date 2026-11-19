import { CATEGORIES } from './types';
import type { MenuItem } from './types';

/**
 * The 50 items from the printed Juicysukun menu card, with the printed prices.
 * The owner can change anything later from the admin app's Menu tab.
 *
 * Obvious spelling slips on the printed card are corrected here (Corn Triangles, Jalapeno,
 * Chicago, Paradise, Cheese Burst, Cheese Dip). Extras are prefixed "Extra" so they read clearly on an invoice.
 */

type Draft = { name: string; category: string; sizes: { label: string; price: number }[]; special?: boolean };

const one = (category: string, name: string, price: number, special = false): Draft => ({
  name,
  category,
  sizes: [{ label: '', price }],
  special,
});

const two = (
  category: string,
  name: string,
  a: number,
  b: number,
  labels: [string, string] = ['Regular', 'Medium'],
  special = false,
): Draft => ({
  name,
  category,
  sizes: [
    { label: labels[0], price: a },
    { label: labels[1], price: b },
  ],
  special,
});

const DRAFTS: Draft[] = [
  // Pizza (Regular / Medium)
  one('Pizza', 'Cheese Treat Pizza', 159),
  two('Pizza', 'Veg Choice Pizza', 159, 269),
  two('Pizza', 'Veegy Fun Pizza', 199, 349),
  two('Pizza', 'Farm House Pizza', 199, 349),
  two('Pizza', 'Garden Fresh Pizza', 199, 349),
  two('Pizza', 'Veg Tango Pizza', 199, 349),
  two('Pizza', 'Veg Spicy Veg Pizza', 229, 389),
  two('Pizza', 'Vegi Delite Pizza', 229, 389),
  two('Pizza', 'Veg Mexican Pizza', 229, 389),
  two('Pizza', 'Vegi Special Pizza', 229, 389),
  two('Pizza', 'Veg Chicago Pizza', 259, 449),
  two('Pizza', 'Veg Paradise Pizza', 259, 449),
  two('Pizza', 'Chefs Veg Pizza', 259, 449),
  two('Pizza', 'Spicy Paneer Delite Pizza', 259, 449),
  two('Pizza', 'JS Veg Special Pizza', 310, 539, ['Regular', 'Medium'], true),

  // Burgers
  one('Burgers', 'Veg Burger', 95),
  one('Burgers', 'Paneer Burger', 149),
  one('Burgers', 'Veg Mexican', 129),
  one('Burgers', 'Veg Delite Burger', 149),
  one('Burgers', 'JS Special Burger', 189, true),

  // Fries
  one('Fries', 'Peri Peri Fries', 79),
  one('Fries', 'Mayo Fries', 89),
  one('Fries', 'Cheese Fries', 89),
  one('Fries', 'Cheese Jalapeno Fries', 89),
  one('Fries', 'Cheese Mix Fries', 109),
  one('Fries', 'JS Special Fries', 129, true),

  // Garlic Bread
  one('Garlic Bread', 'Garlic Bread With Cheese Dip', 129),
  one('Garlic Bread', 'Stuff Garlic Bread', 139),
  one('Garlic Bread', 'Paneer Delite', 155),
  one('Garlic Bread', 'Spicy Vegi', 159),
  one('Garlic Bread', 'Simple Veg Farm House', 159),
  one('Garlic Bread', 'Vegi Crust', 159),
  one('Garlic Bread', 'Chicago', 159),

  // Pasta
  one('Pasta', 'Red Sauce Pasta', 149),
  one('Pasta', 'White Sauce Pasta', 159),
  one('Pasta', 'Pink Sauce Pasta', 169),
  one('Pasta', 'JS Special Pasta', 199, true),

  // JS Starters
  one('JS Starters', 'Corn Triangles', 89),
  one('JS Starters', 'JS Kabab', 89),
  one('JS Starters', 'JS Roll', 89),
  one('JS Starters', 'JS Cheesy Shots', 89),

  // Drinks (mocktails and cold coffee)
  one('Drinks', 'Blue Mint', 80),
  one('Drinks', 'Virgin Mojito', 80),
  one('Drinks', 'Cold Coffee', 90),
  one('Drinks', 'Sugar Less Mojito', 90),

  // Extras (7" / 10")
  two('Extras', 'Extra Soft Crust', 30, 40, ['7"', '10"']),
  two('Extras', 'Extra Veg Topping', 40, 60, ['7"', '10"']),
  two('Extras', 'Extra Spicy', 40, 60, ['7"', '10"']),
  two('Extras', 'Extra Cheese', 50, 70, ['7"', '10"']),
  two('Extras', 'Extra Cheese Burst', 70, 110, ['7"', '10"']),
];

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export const MENU_SEED: MenuItem[] = DRAFTS.map((d, i) => ({
  id: `${slugify(d.category)}-${slugify(d.name)}`,
  name: d.name,
  category: d.category,
  sizes: d.sizes,
  available: true,
  special: !!d.special,
  imageUrl: null,
  sort: (CATEGORIES.indexOf(d.category as (typeof CATEGORIES)[number]) + 1) * 1000 + i,
}));

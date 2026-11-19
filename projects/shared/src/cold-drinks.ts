import type { MenuItem } from './types';

/**
 * Starter items for the "Cold Drinks" category. They are added SOLD OUT with typical MRP prices:
 * check the price, add a photo and switch each one on in the owner app (Menu tab).
 */
export const COLD_DRINK_STARTERS: Omit<MenuItem, 'id' | 'sort'>[] = [
  { name: 'Water Bottle', category: 'Cold Drinks', sizes: [{ label: '1 L', price: 20 }], available: false, veg: true },
  { name: 'Sprite', category: 'Cold Drinks', sizes: [{ label: '250 ml', price: 20 }, { label: '600 ml', price: 40 }], available: false, veg: true },
  { name: 'Coca-Cola', category: 'Cold Drinks', sizes: [{ label: '250 ml', price: 20 }, { label: '600 ml', price: 40 }], available: false, veg: true },
  { name: 'Monster Energy', category: 'Cold Drinks', sizes: [{ label: '350 ml', price: 125 }], available: false, veg: true },
  { name: 'Red Bull', category: 'Cold Drinks', sizes: [{ label: '250 ml', price: 125 }], available: false, veg: true },
  { name: 'Predator', category: 'Cold Drinks', sizes: [{ label: '250 ml', price: 60 }], available: false, veg: true },
];

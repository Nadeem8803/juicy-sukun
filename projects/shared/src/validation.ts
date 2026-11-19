import { DomainError } from './errors';
import {
  MAX_ADDONS,
  MAX_LINE_NOTE,
  MAX_OPTIONS,
  MAX_SIZES,
  type CartLine,
  type CustomerInfo,
  type GeoPoint,
  type PlaceOrderRequest,
  type PublicConfig,
} from './types';

/** Accepts 9876543210, +91 98765 43210, 098765-43210. Returns the 10 digits or null. */
export function normalizePhone(input: string): string | null {
  let digits = String(input ?? '').replace(/[^\d+]/g, '');
  if (digits.startsWith('+91')) digits = digits.slice(3);
  else if (digits.startsWith('91') && digits.length === 12) digits = digits.slice(2);
  else if (digits.startsWith('0') && digits.length === 11) digits = digits.slice(1);
  return /^[6-9]\d{9}$/.test(digits) ? digits : null;
}

function bad(message: string): never {
  throw new DomainError('invalid_request', message);
}

function cleanText(value: unknown, min: number, max: number, field: string): string {
  const text = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
  if (text.length < min) bad(`${field} is too short`);
  if (text.length > max) bad(`${field} is too long`);
  return text;
}

function intList(v: unknown, max: number, what: string): number[] {
  if (v == null) return [];
  if (!Array.isArray(v) || v.length > max) bad(`Invalid ${what}`);
  for (const n of v) if (!Number.isInteger(n) || n < 0 || n >= max) bad(`Invalid ${what}`);
  return [...new Set(v as number[])];
}

function validateLocation(loc: unknown): GeoPoint | null {
  if (loc == null) return null;
  const { lat, lng, accuracy } = loc as Partial<GeoPoint>;
  if (typeof lat !== 'number' || typeof lng !== 'number') bad('Location is invalid');
  if (!(lat >= -90 && lat <= 90) || !(lng >= -180 && lng <= 180)) bad('Location is invalid');
  const out: GeoPoint = { lat, lng };
  if (typeof accuracy === 'number' && accuracy >= 0) out.accuracy = Math.round(accuracy);
  return out;
}

/** Table labels: short, upper-case, letters/digits/space/dash. Used both when saving and when matching a table's open bill. */
export function normalizeTable(input: unknown): string {
  return typeof input === 'string' ? input.trim().replace(/\s+/g, ' ').toUpperCase() : '';
}

export interface CleanRequest {
  orderType: 'delivery' | 'dine_in';
  table?: string;
  lines: CartLine[];
  customer: CustomerInfo;
  location: GeoPoint | null;
  note: string;
  offersOptIn: boolean;
}

/** Checks and normalises everything the customer sent. Throws DomainError('invalid_request'). */
export function validatePlaceOrder(
  req: PlaceOrderRequest,
  cfg: Pick<PublicConfig, 'maxLines' | 'maxQtyPerLine'>,
): CleanRequest {
  if (!req || typeof req !== 'object') bad('Empty request');
  if (!Array.isArray(req.lines) || req.lines.length === 0) bad('Your cart is empty');
  if (req.lines.length > cfg.maxLines) bad('Too many items in the cart');

  const lines: CartLine[] = req.lines.map((l) => {
    if (typeof l?.itemId !== 'string' || !l.itemId) bad('Invalid item');
    if (!Number.isInteger(l.sizeIndex) || l.sizeIndex < 0 || l.sizeIndex >= MAX_SIZES) bad('Invalid size');
    if (!Number.isInteger(l.qty) || l.qty < 1 || l.qty > cfg.maxQtyPerLine) {
      bad(`Quantity must be between 1 and ${cfg.maxQtyPerLine}`);
    }
    const out: CartLine = { itemId: l.itemId, sizeIndex: l.sizeIndex, qty: l.qty };
    const addons = intList(l.addons, MAX_ADDONS, 'add-on');
    const options = intList(l.options, MAX_OPTIONS, 'option');
    const note = l.note ? cleanText(l.note, 0, MAX_LINE_NOTE, 'Item note') : '';
    if (addons.length) out.addons = addons;
    if (options.length) out.options = options;
    if (note) out.note = note;
    return out;
  });

  const c = req.customer;
  if (!c || typeof c !== 'object') bad('Customer details are missing');
  const dineIn = req.orderType === 'dine_in';

  if (dineIn) {
    const table = normalizeTable(req.table);
    if (!/^[A-Z0-9][A-Z0-9 -]{0,11}$/.test(table)) bad('Pick your table number');
    const rawPhone = typeof c.phone === 'string' ? c.phone.trim() : '';
    const phone = normalizePhone(rawPhone);
    if (!phone) bad('Enter a valid 10-digit mobile number');
    const note = req.note ? cleanText(req.note, 0, 200, 'Note') : '';
    return {
      orderType: 'dine_in',
      table,
      lines,
      customer: { name: cleanText(c.name, 2, 60, 'Name'), phone: phone ?? '', address: '' },
      location: null,
      note,
      offersOptIn: req.offersOptIn === true,
    };
  }

  const phone = normalizePhone(c.phone);
  if (!phone) bad('Enter a valid 10-digit mobile number');

  const customer: CustomerInfo = {
    name: cleanText(c.name, 2, 60, 'Name'),
    phone,
    address: cleanText(c.address, 8, 250, 'Address'),
  };
  if (c.landmark && String(c.landmark).trim()) customer.landmark = cleanText(c.landmark, 1, 100, 'Landmark');

  const note = req.note ? cleanText(req.note, 0, 200, 'Note') : '';
  return { orderType: 'delivery', lines, customer, location: validateLocation(req.location), note, offersOptIn: req.offersOptIn === true };
}

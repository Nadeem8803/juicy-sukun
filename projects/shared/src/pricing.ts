import { DomainError } from './errors';
import { MAX_LINE_NOTE, type CartLine, type MenuItem, type OrderLine, type PublicConfig } from './types';

/** Rupees, no decimals: all menu prices are whole rupees. */
export function formatINR(amount: number): string {
  return '₹' + Math.round(amount).toLocaleString('en-IN');
}

/** ₹0 for an empty cart, FREE at or above the threshold, otherwise the flat fee. */
export function deliveryFeeFor(
  subtotal: number,
  cfg: Pick<PublicConfig, 'freeDeliveryMin' | 'deliveryFee'>,
): number {
  if (subtotal <= 0) return 0;
  return subtotal >= cfg.freeDeliveryMin ? 0 : cfg.deliveryFee;
}

/** How much more the customer must add to unlock free delivery (0 when already free or cart empty). */
export function amountToFreeDelivery(
  subtotal: number,
  cfg: Pick<PublicConfig, 'freeDeliveryMin'>,
): number {
  if (subtotal <= 0) return 0;
  return Math.max(0, cfg.freeDeliveryMin - subtotal);
}

export interface Totals {
  subtotal: number;
  deliveryFee: number;
  total: number;
}

export function computeTotals(
  lines: Pick<OrderLine, 'total'>[],
  cfg: Pick<PublicConfig, 'freeDeliveryMin' | 'deliveryFee'>,
): Totals {
  const subtotal = lines.reduce((sum, l) => sum + l.total, 0);
  const deliveryFee = deliveryFeeFor(subtotal, cfg);
  return { subtotal, deliveryFee, total: subtotal + deliveryFee };
}

export function sizeLabelSuffix(label: string): string {
  return label ? ` (${label})` : '';
}

/** Two cart lines are "the same" only if item, size, add-ons, options and note all match. */
export function lineKey(l: Pick<CartLine, 'itemId' | 'sizeIndex' | 'addons' | 'options' | 'note'>): string {
  const a = [...(l.addons ?? [])].sort((x, y) => x - y).join(',');
  const o = [...(l.options ?? [])].sort((x, y) => x - y).join(',');
  return `${l.itemId}:${l.sizeIndex}:${a}:${o}:${(l.note ?? '').trim()}`;
}

/** "Extra cheese (+₹20), Less sugar · Note: no onion" - empty string when there is nothing extra. */
export function lineExtras(l: Pick<OrderLine, 'addons' | 'options' | 'note'>): string {
  const parts: string[] = [];
  if (l.addons?.length) {
    parts.push(l.addons.map((a) => (a.price > 0 ? `${a.label} (+${formatINR(a.price)})` : a.label)).join(', '));
  }
  if (l.options?.length) parts.push(l.options.join(', '));
  if (l.note) parts.push(`Note: ${l.note}`);
  return parts.join(' · ');
}

function pickIndexes<T>(wanted: number[] | undefined, list: T[] | undefined, what: string, name: string): T[] {
  const out: T[] = [];
  for (const i of [...new Set(wanted ?? [])]) {
    const v = list?.[i];
    if (v === undefined) throw new DomainError('invalid_item', `Unknown ${what} for ${name}`);
    out.push(v);
  }
  return out;
}

/**
 * Turns cart lines (ids + quantities + choices) into priced order lines using the LIVE menu.
 * The server calls this, so a customer can never choose their own price.
 * Identical lines (same item, size, add-ons, options and note) are merged.
 */
export function priceLines(cart: CartLine[], menu: MenuItem[]): OrderLine[] {
  const byId = new Map(menu.map((m) => [m.id, m] as const));
  const merged = new Map<string, CartLine>();
  for (const line of cart) {
    const key = lineKey(line);
    const prev = merged.get(key);
    merged.set(key, prev ? { ...prev, qty: prev.qty + line.qty } : { ...line });
  }
  const out: OrderLine[] = [];
  for (const line of merged.values()) {
    const item = byId.get(line.itemId);
    if (!item) throw new DomainError('invalid_item', `Unknown item ${line.itemId}`);
    if (!item.available) throw new DomainError('item_unavailable', `${item.name} is sold out`);
    const size = item.sizes[line.sizeIndex];
    if (!size) throw new DomainError('invalid_item', `Unknown size for ${item.name}`);

    const addons = pickIndexes(line.addons, item.addons, 'add-on', item.name);
    const options = pickIndexes(line.options, item.options, 'option', item.name);
    const note = item.allowNote ? (line.note ?? '').trim().slice(0, MAX_LINE_NOTE) : '';
    const unitPrice = size.price + addons.reduce((n, a) => n + a.price, 0);

    out.push({
      itemId: item.id,
      name: item.name,
      sizeLabel: size.label,
      unitPrice,
      qty: line.qty,
      total: unitPrice * line.qty,
      ...(addons.length ? { addons: addons.map((a) => ({ label: a.label, price: a.price })) } : {}),
      ...(options.length ? { options } : {}),
      ...(note ? { note } : {}),
    });
  }
  return out;
}

/** Lowest price of an item, used for the price-band filter. */
export function minPrice(item: Pick<MenuItem, 'sizes'>): number {
  return Math.min(...item.sizes.map((s) => s.price));
}

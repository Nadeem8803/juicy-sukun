import { formatINR, lineExtras, sizeLabelSuffix } from './pricing';
import { billText } from './bill';
import type { Order } from './types';

export function invoiceNumber(order: Pick<Order, 'number'>): string {
  return `INV-${order.number}`;
}

export function formatDateTime(ms: number): string {
  return new Date(ms).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}

/** Plain-text invoice used for "Share on WhatsApp". */
export function invoiceText(order: Order): string {
  if (order.orderType === 'dine_in') return billText([order]);
  const lines = order.lines.map((l) => {
    const extras = lineExtras(l);
    return `${l.qty} x ${l.name}${sizeLabelSuffix(l.sizeLabel)} - ${formatINR(l.total)}${extras ? `\n   ${extras}` : ''}`;
  });
  const inv = order.invoice;
  const parts = [
    inv?.cafeName ?? 'Juicysukun Café',
    `Invoice ${invoiceNumber(order)}`,
    formatDateTime(order.createdAt),
    '',
    ...lines,
    '',
    `Items: ${formatINR(order.subtotal)}`,
    `Delivery: ${order.deliveryFee === 0 ? 'FREE' : formatINR(order.deliveryFee)}`,
    `Total (cash on delivery): ${formatINR(order.total)}`,
  ];
  if (inv?.cafePhone) parts.push('', `Call us: ${inv.cafePhone}`);
  return parts.join('\n');
}

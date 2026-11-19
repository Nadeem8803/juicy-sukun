import { formatDateTime } from './invoice';
import { formatINR, lineExtras, sizeLabelSuffix } from './pricing';
import { PAY_METHOD_LABEL, type Order, type OrderStatus } from './types';

const LIVE: readonly OrderStatus[] = ['accepted', 'preparing', 'out_for_delivery', 'delivered'];

export function isLiveStatus(s: OrderStatus): boolean {
  return LIVE.includes(s);
}

export function orderTypeOf(o: Pick<Order, 'orderType'>): 'delivery' | 'dine_in' {
  return o.orderType === 'dine_in' ? 'dine_in' : 'delivery';
}

/** Orders that belong on one bill, oldest first. A delivery order is its own bill. Refused / cancelled rounds are left out. */
export function billOrdersOf(all: readonly Order[], o: Order): Order[] {
  if (orderTypeOf(o) !== 'dine_in' || !o.billId) return [o];
  return all
    .filter((x) => x.billId === o.billId && (x.id === o.id || isLiveStatus(x.status)))
    .sort((a, b) => a.createdAt - b.createdAt);
}

export function billTotal(orders: readonly Order[]): number {
  return orders.filter((o) => isLiveStatus(o.status) || orders.length === 1).reduce((n, o) => n + o.total, 0);
}

/** An order the owner still has to deal with even though the kitchen is done: dine-in served but not yet paid. */
export function awaitingPayment(o: Order): boolean {
  return o.status === 'delivered' && !o.payment;
}

/** "07 Nov, 09:45 pm": short enough to share a line with the table or invoice number. */
function shortDateTime(ms: number): string {
  return new Date(ms).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true });
}

/**
 * Fixed-width text for a 58 mm thermal printer (32 columns), kept short to save paper.
 * `withLogo`: the printed logo already carries the cafe name, so that line is left out.
 */
export function billLines(orders: readonly Order[], width = 32, withLogo = false): string[] {
  const first = orders[0];
  const inv = orders.find((o) => o.invoice)?.invoice;
  const dine = orderTypeOf(first) === 'dine_in';
  const out: string[] = [];
  const center = (t: string) => (t.length >= width ? t : ' '.repeat(Math.floor((width - t.length) / 2)) + t);
  const row = (l: string, r: string) => {
    const gap = Math.max(1, width - l.length - r.length);
    return l.length + r.length + 1 > width ? [l, ' '.repeat(Math.max(0, width - r.length)) + r] : [l + ' '.repeat(gap) + r];
  };
  const money = (n: number) => 'Rs.' + Math.round(n);
  const rule = '-'.repeat(width);

  if (!withLogo) out.push(center((inv?.cafeName ?? 'Juicysukun Cafe').toUpperCase()));
  if (inv?.cafeAddress) {
    // A real address is longer than one line: break it at spaces, each line centred.
    let cur = '';
    for (const w of inv.cafeAddress.split(/\s+/).filter(Boolean)) {
      if (cur && (cur + ' ' + w).length > width) {
        out.push(center(cur));
        cur = w;
      } else cur = cur ? cur + ' ' + w : w;
    }
    if (cur) out.push(center(cur));
  }
  if (inv?.cafePhone) out.push(center('Ph: ' + inv.cafePhone));
  if (inv?.fssai) out.push(center('FSSAI: ' + inv.fssai));
  out.push(rule);
  out.push(...row(dine ? `Table ${first.table ?? ''}` : `INV-${first.number}`, shortDateTime(first.createdAt)));
  if (first.customer?.name) out.push(first.customer.name);
  if (dine && first.customer?.phone) out.push('Ph: ' + first.customer.phone);
  out.push(rule);

  orders.forEach((o, i) => {
    if (orders.length > 1) out.push(`Round ${i + 1}  #${o.number}`);
    for (const l of o.lines) {
      out.push(...row(`${l.qty} ${l.name}${sizeLabelSuffix(l.sizeLabel)}`, money(l.total)));
      const ex = lineExtras(l).replace(/\u20B9/g, 'Rs.');
      if (ex) out.push(' ' + ex);
    }
  });
  out.push(rule);
  if (!dine) {
    const delivery = orders.reduce((n, o) => n + o.deliveryFee, 0);
    out.push(...row('Delivery', delivery === 0 ? 'FREE' : money(delivery)));
  }
  const disc = orders.reduce((n, o) => n + (o.discount?.amount ?? 0), 0);
  if (disc > 0) out.push(...row(`Discount (${orders.find((o) => o.discount)?.discount?.percent ?? 0}%)`, '-' + money(disc)));
  out.push(...row('TOTAL', money(billTotal(orders))));
  const paid = orders.find((o) => o.payment)?.payment;
  out.push(paid ? `Paid: ${PAY_METHOD_LABEL[paid.method]}` : dine ? 'Payment pending' : 'Cash on delivery');
  out.push(center('Thank you! Visit again'));
  out.push(center('Powered by ZyntraTech'));
  out.push(center('zyntratech.web.app'));
  return out;
}

/** Kitchen order slip (KOT): big and short, no prices. */
export function kotLines(o: Order, width = 32, addOn = false): string[] {
  const out: string[] = [];
  const dine = orderTypeOf(o) === 'dine_in';
  out.push(dine ? `TABLE ${o.table ?? ''}` : 'DELIVERY');
  if (addOn) out.push('** ADD-ON ORDER **');
  out.push(`${o.number}   ${formatDateTime(o.createdAt)}`);
  if (dine && o.customer?.name) out.push(o.customer.name);
  out.push('-'.repeat(width));
  for (const l of o.lines) {
    out.push(`${l.qty} x ${l.name}${sizeLabelSuffix(l.sizeLabel)}`);
    const ex = lineExtras(l).replace(/\u20B9/g, 'Rs.');
    if (ex) out.push('   ' + ex);
  }
  if (o.note) out.push('', 'NOTE: ' + o.note);
  out.push('-'.repeat(width));
  return out;
}

/** WhatsApp text for a bill (one or many rounds). */
export function billText(orders: readonly Order[]): string {
  const first = orders[0];
  const dine = orderTypeOf(first) === 'dine_in';
  const inv = orders.find((o) => o.invoice)?.invoice;
  const parts: string[] = [inv?.cafeName ?? 'Juicysukun Café', dine ? `Bill - Table ${first.table ?? ''}` : `Invoice INV-${first.number}`, formatDateTime(first.createdAt)];
  if (dine && first.customer?.name) parts.push([first.customer.name, first.customer.phone].filter(Boolean).join(' · '));
  parts.push('');
  orders.forEach((o, i) => {
    if (orders.length > 1) parts.push(`Round ${i + 1} (${o.number})`);
    for (const l of o.lines) {
      const ex = lineExtras(l);
      parts.push(`${l.qty} x ${l.name}${sizeLabelSuffix(l.sizeLabel)} - ${formatINR(l.total)}${ex ? `\n   ${ex}` : ''}`);
    }
  });
  parts.push('');
  if (!dine) {
    parts.push(`Items: ${formatINR(orders.reduce((n, o) => n + o.subtotal, 0))}`);
    const d = orders.reduce((n, o) => n + o.deliveryFee, 0);
    parts.push(`Delivery: ${d === 0 ? 'FREE' : formatINR(d)}`);
  }
  const disc = orders.reduce((n, o) => n + (o.discount?.amount ?? 0), 0);
  if (disc > 0) parts.push(`Loyalty discount: -${formatINR(disc)}`);
  parts.push(`Total: ${formatINR(billTotal(orders))}`);
  const paid = orders.find((o) => o.payment)?.payment;
  parts.push(paid ? `Paid by ${PAY_METHOD_LABEL[paid.method]} ✅` : dine ? 'Payment pending' : 'Cash on delivery');
  if (inv?.cafePhone) parts.push('', `Call us: ${inv.cafePhone}`);
  parts.push('', 'Thank you! 🙏', 'Juicysukun Café - Good Food. Good Mood. ❤', '', 'Invoice by ZyntraTech · zyntratech.web.app');
  return parts.join('\n');
}

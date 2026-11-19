/** A UPI "pay" link. Scanning it (as a QR) or opening it pre-fills the payee and the amount in any UPI app. */
export function upiLink(opts: { id: string; name: string; amount: number; note: string }): string {
  const q = [
    ['pa', opts.id.trim()],
    ['pn', opts.name.trim() || 'Cafe'],
    ['am', (Math.round(Math.max(0, opts.amount) * 100) / 100).toFixed(2)],
    ['cu', 'INR'],
    ['tn', opts.note.trim().slice(0, 40)],
  ]
    .map(([k, v]) => `${k}=${encodeURIComponent(v!)}`)
    .join('&');
  return `upi://pay?${q}`;
}

/** A loose check that this looks like a UPI id (name@bank). */
export function isUpiId(s: string): boolean {
  return /^[A-Za-z0-9._-]{2,64}@[A-Za-z][A-Za-z0-9.-]{1,30}$/.test(s.trim());
}

/** 1..99 paise taken from the order number (JS-1007 -> 8), so same-priced orders get different payment amounts. */
export function upiPaise(orderNumber: string): number {
  const n = Number(/(\d+)\s*$/.exec(orderNumber ?? '')?.[1] ?? 0);
  return (n % 99) + 1;
}

/** What the customer is asked to pay by UPI: the order total, plus the paise tag when the owner turned that on. */
export function payAmount(total: number, orderNumber: string, paise: boolean): number {
  return paise ? Math.round((total + upiPaise(orderNumber) / 100) * 100) / 100 : total;
}

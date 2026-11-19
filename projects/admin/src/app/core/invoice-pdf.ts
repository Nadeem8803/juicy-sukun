import { PAY_METHOD_LABEL, billTotal, formatDateTime, lineExtras, orderTypeOf, sizeLabelSuffix, type Order } from '@juicy/shared';
import { LOGO_PNG } from './brand-logo';

export interface InvoicePdf {
  fileName: string;
  base64: string;
  blob: Blob;
}

/** The standard PDF fonts only know Latin-1: turn the rupee sign into "Rs." and drop anything else unusual. */
const clean = (s: string): string => s.replace(/₹/g, 'Rs.').replace(/[^\x20-\xFF]/g, '');
const money = (n: number): string => 'Rs. ' + Math.round(n).toLocaleString('en-IN');

const DARK: [number, number, number] = [23, 17, 10];
const AMBER: [number, number, number] = [255, 178, 31];
const INK: [number, number, number] = [43, 33, 24];
const MUTED: [number, number, number] = [120, 108, 96];
const GREEN: [number, number, number] = [30, 140, 70];

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** A4-friendly A5 invoice / table bill as a PDF. Needs the bill to be paid; shows who paid how. */
export async function buildInvoicePdf(orders: readonly Order[]): Promise<InvoicePdf> {
  const { jsPDF } = await import('jspdf');
  const first = orders[0];
  const dine = orderTypeOf(first) === 'dine_in';
  const inv = orders.find((o) => o.invoice)?.invoice;
  const paid = orders.find((o) => o.payment)?.payment;
  const doc = new jsPDF({ unit: 'mm', format: 'a5' });
  const W = 148;
  const L = 10;
  const R = W - 10;
  let y = 0;

  const header = (): void => {
    doc.setFillColor(...DARK);
    doc.rect(0, 0, W, 34, 'F');
    doc.addImage(LOGO_PNG, 'PNG', 6, 3, 28, 28);
    doc.setTextColor(...AMBER);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(17);
    doc.text(clean((inv?.cafeName ?? 'Juicysukun Café').toUpperCase()), 40, 18);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(255, 236, 200);
    doc.text('Good Food. Good Mood.', 40, 25);
  };
  const ensure = (h: number): void => {
    if (y + h > 196) {
      doc.addPage();
      y = 16;
    }
  };

  header();
  y = 41;
  doc.setTextColor(...MUTED);
  doc.setFontSize(8.5);
  const contact = [inv?.cafeAddress, inv?.cafePhone ? 'Ph: ' + inv.cafePhone : '', inv?.fssai ? 'FSSAI: ' + inv.fssai : ''].filter(Boolean).join('   ·   ');
  if (contact) doc.text(clean(contact), W / 2, y, { align: 'center' });
  y += 9;

  // Title row
  doc.setTextColor(...INK);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.text(dine ? `BILL · TABLE ${clean(first.table ?? '')}` : 'INVOICE', L, y);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(...MUTED);
  doc.text(dine ? `Order ${orders.map((o) => o.number).join(', ')}` : `INV-${first.number}`, R, y - 5, { align: 'right' });
  doc.text(formatDateTime(first.createdAt), R, y, { align: 'right' });
  y += 6;
  if (!dine) {
    doc.setTextColor(...INK);
    doc.setFontSize(9.5);
    const who = [first.customer.name, first.customer.phone].filter(Boolean).join('  ·  ');
    doc.text(clean(who), L, y);
    y += 5;
    const addr = doc.splitTextToSize(clean([first.customer.address, first.customer.landmark].filter(Boolean).join(', ')), R - L) as string[];
    doc.setTextColor(...MUTED);
    doc.setFontSize(8.5);
    doc.text(addr, L, y);
    y += addr.length * 4 + 1;
  } else if (first.customer?.name) {
    doc.setTextColor(...INK);
    doc.setFontSize(9.5);
    doc.text(clean([first.customer.name, first.customer.phone].filter(Boolean).join('  ·  ')), L, y);
    y += 5;
  }

  // Items table
  y += 2;
  doc.setFillColor(245, 238, 228);
  doc.rect(L, y - 4.5, R - L, 7, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(...INK);
  doc.text('Item', L + 2, y);
  doc.text('Qty', 104, y, { align: 'right' });
  doc.text('Amount', R - 2, y, { align: 'right' });
  y += 7;

  orders.forEach((o, i) => {
    if (orders.length > 1) {
      ensure(8);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8.5);
      doc.setTextColor(...MUTED);
      doc.text(`Round ${i + 1}  ·  #${o.number}`, L + 2, y);
      y += 5;
    }
    for (const l of o.lines) {
      const name = doc.splitTextToSize(clean(`${l.name}${sizeLabelSuffix(l.sizeLabel)}`), 78) as string[];
      const extra = clean(lineExtras(l));
      const extraLines = extra ? (doc.splitTextToSize(extra, 78) as string[]) : [];
      ensure(name.length * 4.5 + extraLines.length * 3.8 + 3);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9.5);
      doc.setTextColor(...INK);
      doc.text(name, L + 2, y);
      doc.text(String(l.qty), 104, y, { align: 'right' });
      doc.text(money(l.total), R - 2, y, { align: 'right' });
      y += name.length * 4.5;
      if (extraLines.length) {
        doc.setFontSize(8);
        doc.setTextColor(...MUTED);
        doc.text(extraLines, L + 2, y - 0.5);
        y += extraLines.length * 3.8;
      }
      y += 1.5;
    }
  });

  // Totals
  ensure(34);
  doc.setDrawColor(210, 200, 188);
  doc.line(L, y, R, y);
  y += 6;
  doc.setFontSize(9.5);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...INK);
  if (!dine) {
    const items = orders.reduce((n, o) => n + o.subtotal, 0);
    const delivery = orders.reduce((n, o) => n + o.deliveryFee, 0);
    doc.text('Items', 104, y, { align: 'right' });
    doc.text(money(items), R - 2, y, { align: 'right' });
    y += 5;
    doc.text('Delivery', 104, y, { align: 'right' });
    doc.text(delivery === 0 ? 'FREE' : money(delivery), R - 2, y, { align: 'right' });
    y += 6;
  }
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text('TOTAL', 104, y, { align: 'right' });
  doc.text(money(billTotal(orders)), R - 2, y, { align: 'right' });

  // Paid stamp
  if (paid) {
    doc.setFillColor(...GREEN);
    doc.roundedRect(L, y - 4.5, 46, 10, 2, 2, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(10);
    doc.text(clean(`PAID · ${PAY_METHOD_LABEL[paid.method]}`.toUpperCase()), L + 23, y + 2.1, { align: 'center' });
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(...MUTED);
    doc.text(formatDateTime(paid.at), L, y + 10);
  }
  y += 19;

  // Footer
  ensure(18);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(...INK);
  doc.text('Thank you! Visit again.', W / 2, y, { align: 'center' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(...MUTED);
  doc.text('Juices, Desserts, Pizza, Burger, Cold Coffee, Fries & Sandwich', W / 2, y + 5, { align: 'center' });
  doc.setFontSize(7.5);
  doc.text('Invoice by ZyntraTech  |  zyntratech.web.app', W / 2, y + 10, { align: 'center' });
  doc.setFillColor(...AMBER);
  doc.rect(0, 205, W, 5, 'F');

  const stem = dine ? `Table${clean(first.table ?? '')}-${first.number}` : `INV-${first.number}`;
  return {
    fileName: `Juicysukun-${stem}.pdf`.replace(/[^A-Za-z0-9._-]/g, '_'),
    base64: toBase64(doc.output('arraybuffer')),
    blob: doc.output('blob'),
  };
}

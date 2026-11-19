import type { ItemStat, SalesSummary } from '@juicy/shared';
import type { InvoicePdf } from './invoice-pdf';

const rs = (n: number): string => 'Rs. ' + Math.round(n).toLocaleString('en-IN');

export interface SummaryInput {
  title: string;
  sales: SalesSummary;
  expenses: number;
  expenseRows: { category: string; amount: number }[];
  items: ItemStat[];
}

/** One-page A4 summary of sales, expenses and profit for the chosen period. */
export async function buildSummaryPdf(i: SummaryInput): Promise<InvoicePdf> {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  let y = 20;
  const line = (label: string, value: string, bold = false): void => {
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    doc.setFontSize(bold ? 12 : 10.5);
    doc.text(label, 18, y);
    doc.text(value, 192, y, { align: 'right' });
    y += bold ? 8 : 6.5;
  };
  const head = (t: string): void => {
    y += 4;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(200, 110, 10);
    doc.text(t.toUpperCase(), 18, y);
    doc.setTextColor(30, 24, 18);
    y += 6;
  };
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.text('Juicysukun Cafe', 18, y);
  y += 7;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10.5);
  doc.setTextColor(110, 100, 90);
  doc.text(i.title, 18, y);
  doc.setTextColor(30, 24, 18);
  y += 4;
  head('Sales (payment confirmed)');
  line('Total sales', rs(i.sales.sales), true);
  line('Orders', String(i.sales.orders));
  line('Average bill', rs(i.sales.avg));
  line('Cash', rs(i.sales.byMethod.cash));
  line('UPI', rs(i.sales.byMethod.upi));
  line('Card', rs(i.sales.byMethod.card));
  line('Dine-in', rs(i.sales.dineIn));
  line('Delivery', rs(i.sales.delivery));
  if (i.sales.discount) line('Loyalty discounts given', rs(i.sales.discount));
  if (i.sales.unpaid) line('Delivered, payment not confirmed', rs(i.sales.unpaid));
  head('Expenses and profit');
  for (const e of i.expenseRows) line(e.category, rs(e.amount));
  line('Total expenses', rs(i.expenses), true);
  line('Profit (sales - expenses)', rs(i.sales.sales - i.expenses), true);
  if (i.items.length) {
    head('Best sellers');
    for (const it of i.items.slice(0, 8)) line(`${it.name}  x${it.qty}`, rs(it.revenue));
  }
  y = 285;
  doc.setFontSize(8);
  doc.setTextColor(140, 130, 120);
  doc.text('Prepared with the Juicysukun owner app  |  zyntratech.web.app', 105, y, { align: 'center' });
  const buf = doc.output('arraybuffer');
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let k = 0; k < bytes.length; k += 0x8000) s += String.fromCharCode(...bytes.subarray(k, k + 0x8000));
  return { fileName: `Juicysukun-Summary-${new Date().toISOString().slice(0, 10)}.pdf`, base64: btoa(s), blob: new Blob([buf], { type: 'application/pdf' }) };
}

import type { DailyStats, Expense, Order, PayMethod } from './types';
import { isLiveStatus } from './bill';

const IST_MS = 5.5 * 3600_000;
const DAY_MS = 86_400_000;

/** Calendar day in India, as YYYY-MM-DD. */
export function istDay(ms: number): string {
  return new Date(ms + IST_MS).toISOString().slice(0, 10);
}
export function istHour(ms: number): number {
  return new Date(ms + IST_MS).getUTCHours();
}
/** Start (epoch ms) of the Indian day that contains `ms`. */
export function istDayStart(ms: number): number {
  return Math.floor((ms + IST_MS) / DAY_MS) * DAY_MS - IST_MS;
}

export type Period = 'today' | 'week' | 'month';

/** Week = last 7 days including today; month = last 30 days including today. */
export function periodRange(period: Period, now = Date.now()): { from: number; to: number; days: number } {
  const days = period === 'today' ? 1 : period === 'week' ? 7 : 30;
  const to = istDayStart(now) + DAY_MS;
  return { from: to - days * DAY_MS, to, days };
}

const inRange = (t: number, from: number, to: number) => t >= from && t < to;

export interface SalesSummary {
  orders: number;
  sales: number;
  discount: number;
  avg: number;
  byMethod: Record<PayMethod, number>;
  dineIn: number;
  delivery: number;
  /** Delivered but the money is not confirmed yet. */
  unpaid: number;
}

/** Money counts only once the owner has confirmed the payment. */
export function salesSummary(orders: readonly Order[], from: number, to: number): SalesSummary {
  const s: SalesSummary = { orders: 0, sales: 0, discount: 0, avg: 0, byMethod: { cash: 0, upi: 0, card: 0 }, dineIn: 0, delivery: 0, unpaid: 0 };
  const bills = new Set<string>();
  for (const o of orders) {
    if (!inRange(o.createdAt, from, to)) continue;
    if (o.status === 'delivered' && !o.payment) s.unpaid += o.total;
    if (!o.payment || !isLiveStatus(o.status)) continue;
    s.orders += 1;
    s.sales += o.total;
    s.discount += o.discount?.amount ?? 0;
    s.byMethod[o.payment.method] += o.total;
    if (o.orderType === 'dine_in') s.dineIn += o.total;
    else s.delivery += o.total;
    bills.add(o.billId ?? o.id);
  }
  s.avg = bills.size > 0 ? Math.round(s.sales / bills.size) : 0;
  return s;
}

export interface ItemStat {
  name: string;
  qty: number;
  revenue: number;
}

export function topItems(orders: readonly Order[], from: number, to: number, n = 8): ItemStat[] {
  const m = new Map<string, ItemStat>();
  for (const o of orders) {
    if (!inRange(o.createdAt, from, to) || !isLiveStatus(o.status)) continue;
    for (const l of o.lines) {
      const cur = m.get(l.name) ?? { name: l.name, qty: 0, revenue: 0 };
      cur.qty += l.qty;
      cur.revenue += l.total;
      m.set(l.name, cur);
    }
  }
  return [...m.values()].sort((a, b) => b.qty - a.qty || b.revenue - a.revenue).slice(0, n);
}

/** Orders per hour of day (index 0..23). */
export function ordersByHour(orders: readonly Order[], from: number, to: number): number[] {
  const out = new Array<number>(24).fill(0);
  for (const o of orders) if (inRange(o.createdAt, from, to) && isLiveStatus(o.status)) out[istHour(o.createdAt)] += 1;
  return out;
}

/** Sales per Indian day for the last `days` days (oldest first). */
export function salesByDay(orders: readonly Order[], days: number, now = Date.now()): { day: string; sales: number; orders: number }[] {
  const end = istDayStart(now) + DAY_MS;
  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const from = end - (i + 1) * DAY_MS;
    const s = salesSummary(orders, from, from + DAY_MS);
    out.push({ day: istDay(from), sales: s.sales, orders: s.orders });
  }
  return out;
}

export interface CustomerStat {
  phone: string;
  name: string;
  orders: number;
  spent: number;
  lastAt: number;
  favourite: string;
}

/** Customers (by phone) from the orders the owner accepted. */
export function customerStats(orders: readonly Order[]): CustomerStat[] {
  const m = new Map<string, CustomerStat & { items: Map<string, number> }>();
  for (const o of orders) {
    if (!isLiveStatus(o.status) || !o.customer?.phone) continue;
    const cur = m.get(o.customer.phone) ?? { phone: o.customer.phone, name: o.customer.name, orders: 0, spent: 0, lastAt: 0, favourite: '', items: new Map() };
    cur.orders += 1;
    cur.spent += o.total;
    if (o.createdAt >= cur.lastAt) {
      cur.lastAt = o.createdAt;
      cur.name = o.customer.name || cur.name;
    }
    for (const l of o.lines) cur.items.set(l.name, (cur.items.get(l.name) ?? 0) + l.qty);
    m.set(o.customer.phone, cur);
  }
  return [...m.values()]
    .map(({ items, ...c }) => ({ ...c, favourite: [...items.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '' }))
    .sort((a, b) => b.orders - a.orders || b.spent - a.spent);
}

export function expenseTotal(expenses: readonly Expense[], fromDay: string, toDay: string): number {
  return expenses.filter((e) => e.day >= fromDay && e.day <= toDay).reduce((n, e) => n + e.amount, 0);
}

export function expenseByCategory(expenses: readonly Expense[], fromDay: string, toDay: string): { category: string; amount: number }[] {
  const m = new Map<string, number>();
  for (const e of expenses) if (e.day >= fromDay && e.day <= toDay) m.set(e.category, (m.get(e.category) ?? 0) + e.amount);
  return [...m.entries()].map(([category, amount]) => ({ category, amount })).sort((a, b) => b.amount - a.amount);
}

export function ratingSummary(orders: readonly Order[]): { count: number; average: number; stars: number[] } {
  const stars = [0, 0, 0, 0, 0];
  let total = 0;
  let count = 0;
  for (const o of orders) {
    const r = o.review?.rating;
    if (typeof r === 'number' && r >= 1 && r <= 5) {
      stars[r - 1] += 1;
      total += r;
      count += 1;
    }
  }
  return { count, average: count ? Math.round((total / count) * 10) / 10 : 0, stars };
}

/** Sums the per-day counters over a range of days. */
export function sumDaily(rows: readonly DailyStats[], fromDay: string, toDay: string): DailyStats {
  const out: DailyStats = { day: `${fromDay}..${toDay}`, sessions: 0, visitors: 0, newVisitors: 0, returning: 0, qr: 0, cart: 0, checkout: 0, ordered: 0 };
  for (const r of rows) {
    if (r.day < fromDay || r.day > toDay) continue;
    for (const k of Object.keys(r)) {
      if (k === 'day') continue;
      const v = r[k];
      if (typeof v === 'number') out[k] = ((out[k] as number) ?? 0) + v;
    }
  }
  return out;
}

/** Spreadsheet-safe CSV (quotes, commas, newlines, and formula starters). */
export function toCsv(rows: (string | number)[][]): string {
  const cell = (v: string | number) => {
    let s = String(v ?? '');
    if (/^[=+\-@]/.test(s) && Number.isNaN(Number(s))) s = "'" + s;
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return '﻿' + rows.map((r) => r.map(cell).join(',')).join('\r\n');
}

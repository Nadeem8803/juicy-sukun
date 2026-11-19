import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { App as CapApp } from '@capacitor/app';
import { Capacitor, registerPlugin } from '@capacitor/core';
import {
  billOrdersOf,
  billTotal,
  isLiveStatus,
  matchCredit,
  parseCreditSms,
  senderMatches,
  type CreditMatch,
  type Order,
  type ParsedCredit,
  type Payable,
  payAmount,
} from '@juicy/shared';
import { OrdersStore } from './orders-store';
import { Shop } from './shop';

interface PaySmsPlugin {
  access(): Promise<{ granted: boolean }>;
  requestAccess(): Promise<{ granted: boolean }>;
  recent(o: { minutes: number }): Promise<{ messages: { sender: string; body: string; date: number }[] }>;
  addListener(event: 'smsReceived', cb: () => void): Promise<{ remove(): Promise<void> }>;
}
const NativeSms = registerPlugin<PaySmsPlugin>('PaySms');

export interface PaySmsSettings {
  enabled: boolean;
  /** Part of the SMS sender name, e.g. "UNIONB". */
  sender: string;
  /** A real "credited" message, only used to show what the app understood. */
  sample: string;
  /** Minutes to look back for a matching order. */
  windowMin: number;
  /** Confirm by itself when exactly one order (whose customer said "I have paid") matches. */
  auto: boolean;
}

export interface SmsSuggestion {
  key: string;
  credit: ParsedCredit;
  receivedAt: number;
  match: CreditMatch;
}

const KEY = 'js.paysms.v1';
const DONE = 'js.paysms.done';
const DEFAULTS: PaySmsSettings = { enabled: false, sender: '', sample: '', windowMin: 30, auto: false };

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const v = JSON.parse(raw);
    return Array.isArray(fallback) ? (Array.isArray(v) ? (v as T) : fallback) : ({ ...fallback, ...v } as T);
  } catch {
    return fallback;
  }
}

/** Reads the bank's "credited" SMS on this phone and offers the owner a one-tap "Received" for the matching order. */
@Injectable({ providedIn: 'root' })
export class PaySms {
  private readonly store = inject(OrdersStore);
  private readonly shop = inject(Shop);
  readonly native = Capacitor.isNativePlatform();
  readonly settings = signal<PaySmsSettings>(read(KEY, DEFAULTS));
  readonly granted = signal(false);
  readonly suggestions = signal<SmsSuggestion[]>([]);
  readonly notice = signal('');
  private done = new Set<string>(read<string[]>(DONE, []));

  /** Unpaid bills / orders that a credit could be for. */
  private readonly payables = computed<Payable[]>(() => {
    const all = this.store.orders();
    const out: Payable[] = [];
    const seen = new Set<string>();
    for (const o of all) {
      if (!isLiveStatus(o.status)) continue;
      const rounds = billOrdersOf(all, o);
      const lead = rounds[0]!;
      if (seen.has(lead.id)) continue;
      seen.add(lead.id);
      if (rounds.some((r) => r.payment)) continue;
      const claim = rounds.find((r) => r.payClaim)?.payClaim?.at;
      out.push({ id: lead.id, number: lead.number, label: (lead.table ? `Table ${lead.table} · ` : '') + (lead.customer.name || ''), amount: billTotal(rounds), ...(this.shop.cfg()?.upiPaise && rounds.length === 1 ? { exactAmount: payAmount(billTotal(rounds), lead.number, true) } : {}), createdAt: lead.createdAt, ...(claim ? { claimAt: claim } : {}) });
    }
    return out;
  });

  constructor() {
    if (!this.native) return;
    void this.refreshAccess();
    void NativeSms.addListener('smsReceived', () => void this.check()).catch(() => undefined);
    void CapApp.addListener('appStateChange', ({ isActive }) => {
      if (isActive) void this.check();
    });
    const timer = setInterval(() => void this.check(), 20_000);
    void timer;
    effect(() => {
      this.payables(); // new / changed orders can create a new match
      this.settings();
      void this.check();
    });
  }

  save(s: PaySmsSettings): void {
    this.settings.set(s);
    try {
      localStorage.setItem(KEY, JSON.stringify(s));
    } catch {
      /* storage blocked */
    }
    void this.check();
  }

  async refreshAccess(): Promise<void> {
    try {
      this.granted.set((await NativeSms.access()).granted);
    } catch {
      this.granted.set(false);
    }
  }

  async requestAccess(): Promise<void> {
    try {
      this.granted.set((await NativeSms.requestAccess()).granted);
    } catch {
      this.granted.set(false);
    }
    void this.check();
  }

  private busy = false;
  /** Reads recent SMS and rebuilds the list of suggestions. */
  async check(): Promise<void> {
    const s = this.settings();
    if (!this.native || !s.enabled || !s.sender.trim() || !this.granted() || this.busy) {
      if (this.suggestions().length) this.suggestions.set([]);
      return;
    }
    const payables = this.payables();
    if (payables.length === 0) {
      if (this.suggestions().length) this.suggestions.set([]);
      return;
    }
    this.busy = true;
    try {
      const { messages } = await NativeSms.recent({ minutes: 180 });
      const now = Date.now();
      const out: SmsSuggestion[] = [];
      for (const m of messages) {
        if (!senderMatches(m.sender, s.sender)) continue;
        const credit = parseCreditSms(m.body);
        if (!credit) continue;
        const key = credit.ref ?? `${m.sender}|${m.date}`;
        if (this.done.has(key)) continue;
        const match = matchCredit(credit, payables, { now, windowMin: s.windowMin, receivedAt: m.date });
        if (match.kind === 'none') continue;
        const only = match.payables[0]!;
        if (s.auto && match.kind === 'one' && only.claimAt) {
          this.remember(key);
          await this.pay(only.id, `Confirmed ₹${credit.amount} for ${only.number} from your bank SMS.`);
          continue;
        }
        out.push({ key, credit, receivedAt: m.date, match });
      }
      this.suggestions.set(out);
    } catch {
      /* permission revoked or SMS unreadable: show nothing */
    } finally {
      this.busy = false;
    }
  }

  async confirm(s: SmsSuggestion, payableId: string): Promise<void> {
    const p = s.match.payables.find((x) => x.id === payableId);
    this.remember(s.key);
    this.suggestions.update((l) => l.filter((x) => x.key !== s.key));
    await this.pay(payableId, `Payment ₹${s.credit.amount} recorded${p ? ' for ' + p.number : ''}.`);
  }

  ignore(s: SmsSuggestion): void {
    this.remember(s.key);
    this.suggestions.update((l) => l.filter((x) => x.key !== s.key));
  }

  private async pay(orderId: string, okMessage: string): Promise<void> {
    const order: Order | undefined = this.store.orders().find((o) => o.id === orderId);
    if (!order) return;
    try {
      await this.store.markPaid(order, 'upi', 'sms');
      this.notice.set(okMessage);
    } catch {
      this.notice.set('Could not record the payment. Check your internet and confirm it from the order.');
    }
  }

  private remember(key: string): void {
    this.done.add(key);
    const list = [...this.done].slice(-300);
    this.done = new Set(list);
    try {
      localStorage.setItem(DONE, JSON.stringify(list));
    } catch {
      /* storage blocked */
    }
  }
}

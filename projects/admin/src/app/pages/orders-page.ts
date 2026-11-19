import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, signal } from '@angular/core';
import {
  PAY_METHOD_LABEL,
  USER_MESSAGES,
  DomainError,
  awaitingPayment,
  billOrdersOf,
  billTotal,
  formatDateTime,
  isActive,
  isLiveStatus,
  lineExtras,
  nextAdminStep,
  nextStepLabel,
  orderTypeOf,
  statusLabel,
  type Order,
  type PayMethod,
} from '@juicy/shared';
import { AlarmService } from '../core/alarm';
import { BACKEND } from '../core/backend';
import { buildInvoicePdf } from '../core/invoice-pdf';
import { PrinterService } from '../core/printer';
import { sharePdf, whatsappNumber } from '../core/share-file';
import { closeOnBack } from '../core/back-close';
import { OrdersStore } from '../core/orders-store';
import { PaySms } from '../core/pay-sms';
import { Shop } from '../core/shop';
import { ReasonSheet } from '../ui/reason-sheet';

type Tab = 'new' | 'active' | 'history';
type Kind = 'all' | 'dine_in' | 'delivery' | 'collect';
type Primary = { kind: 'accept' | 'step' | 'collect' | 'check'; label: string; order: Order };

function shortSize(label: string | undefined): string {
  if (!label) return '';
  return label.length <= 3 ? label : label[0]!.toUpperCase();
}

export function mapsLink(o: Pick<Order, 'location' | 'customer'>): string {
  const dest = o.location ? `${o.location.lat},${o.location.lng}` : encodeURIComponent(`${o.customer.address}, Akkalkot`);
  return `https://www.google.com/maps/dir/?api=1&destination=${dest}`;
}

@Component({
  selector: 'app-orders-page',
  imports: [ReasonSheet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="stats" aria-label="Today">
      <div><b>{{ store.stats().orders }}</b><small>orders today</small></div>
      <div><b>₹{{ store.stats().revenue }}</b><small>sales today</small></div>
      <div><b>{{ store.stats().rejected }}</b><small>rejected</small></div>
    </div>

    <div class="quickbar">
      <button type="button" class="qchip" [class.on]="shop.busyMode()" (click)="toggleBusy()" [attr.aria-pressed]="shop.busyMode()" data-testid="busy-toggle">🔥 Busy mode: {{ shop.busyMode() ? 'ON' : 'off' }}</button>
      <button type="button" class="qchip" (click)="kitchen.set(true)" data-testid="open-kitchen">🍳 Kitchen mode</button>
    </div>
    @if (tab() === 'new' && store.pending().length) {
      <div class="readyrow" role="group" aria-label="Ready in" data-testid="ready-picker">
        <span>Ready in</span>
        @for (m of readyOptions; track m) {
          <button type="button" [class.on]="readyMin() === m" (click)="setReady(m)" [attr.data-testid]="'ready-' + m">{{ m }}</button>
        }
        <small>min{{ shop.busyExtra() ? ' (+' + shop.busyExtra() + ' busy)' : '' }}</small>
      </div>
    }

    <div class="stickybar">
      <div class="seg" role="tablist">
        <button role="tab" [class.on]="tab() === 'new'" (click)="setTab('new')" data-testid="tab-new">New ({{ store.pending().length }})</button>
        <button role="tab" [class.on]="tab() === 'active'" (click)="setTab('active')" data-testid="tab-active">In progress ({{ store.active().length }})</button>
        <button role="tab" [class.on]="tab() === 'history'" (click)="setTab('history')" data-testid="tab-history">History</button>
      </div>
      <div class="seg sub" role="group" aria-label="Filter">
        <button [class.on]="kind() === 'all'" (click)="kind.set('all')" data-testid="kind-all">All ({{ count('all') }})</button>
        <button [class.on]="kind() === 'dine_in'" (click)="kind.set('dine_in')" data-testid="kind-dine">Dine-in ({{ count('dine_in') }})</button>
        <button [class.on]="kind() === 'delivery'" (click)="kind.set('delivery')" data-testid="kind-delivery">Delivery ({{ count('delivery') }})</button>
        <button [class.on]="kind() === 'collect'" [class.hot]="collectCount() > 0" (click)="pickCollect()" data-testid="kind-collect">To collect ({{ collectCount() }})</button>
      </div>
    </div>

    @if (shown().length && tab() !== 'history' && kind() !== 'collect') {
      <small class="muted swipehint" data-testid="swipe-hint">↔ Swipe a tile right to accept / move it on, left to reject.</small>
    }
    @if (error()) { <p class="banner warn" role="alert">{{ error() }}</p> }
    @if (notice()) { <p class="banner" role="status">{{ notice() }}</p> }
    @if (sms.notice()) { <p class="banner" role="status" data-testid="sms-notice">{{ sms.notice() }}</p> }
    @for (s of sms.suggestions(); track s.key) {
      <section class="smsbar" data-testid="sms-suggestion">
        <b>💬 ₹{{ s.credit.amount }} credited · {{ time(s.receivedAt) }}</b>
        @if (s.match.kind === 'one') {
          <small>Matches {{ s.match.payables[0]!.number }}{{ s.match.payables[0]!.label ? ' · ' + s.match.payables[0]!.label : '' }} (₹{{ s.match.payables[0]!.amount }}). Confirm it as paid by UPI?</small>
          <div class="actions">
            <button type="button" class="btn" (click)="sms.ignore(s)" data-testid="sms-no">Not this one</button>
            <button type="button" class="btn primary" (click)="sms.confirm(s, s.match.payables[0]!.id)" data-testid="sms-yes">✔ Confirm paid</button>
          </div>
        } @else {
          <small>More than one order has this amount. Which one is it for?</small>
          <div class="actions">
            @for (p of s.match.payables; track p.id) {
              <button type="button" class="btn primary" (click)="sms.confirm(s, p.id)">{{ p.number }}{{ p.label ? ' · ' + p.label : '' }}</button>
            }
            <button type="button" class="btn" (click)="sms.ignore(s)">None</button>
          </div>
        }
      </section>
    }
    @if (!store.loaded()) { <p class="muted center">Loading orders…</p> }
    @else if (shown().length === 0) {
      <div class="empty"><div class="big">{{ tab() === 'new' ? '☕' : '📭' }}</div>
        <p>{{ kind() === 'collect' ? 'Nothing waiting for payment.' : tab() === 'new' ? 'No new orders. A loud alarm will ring when one arrives.' : 'Nothing here yet.' }}</p></div>
    }

    @for (o of shown(); track o.id) {
      @let f = focus(o);
      @let pr = primary(o);
      <article class="otile" [class.ring]="o.status === 'pending'" [class.bad]="late(o) === 2" [class.warn]="late(o) === 1" [attr.data-testid]="'order-' + o.number"
        [class.swr]="drag()?.id === o.id && drag()!.dx >= 90" [class.swl]="drag()?.id === o.id && drag()!.dx <= -90 && o.status === 'pending'"
        [style.transform]="drag()?.id === o.id ? 'translateX(' + drag()!.dx + 'px)' : null"
        (touchstart)="ts(o, $event)" (touchmove)="tm(o, $event)" (touchend)="te(o)" (touchcancel)="tc()"
        role="button" tabindex="0" (click)="open(o)" (keydown.enter)="open(o)">
        <div class="h">
          <b>{{ o.number }}</b>@if (rounds(o).length > 1) { <span class="more">+{{ rounds(o).length - 1 }}</span> }
          <span class="badge" [attr.data-status]="f.status">{{ label(f) }}</span>
          <span class="t" [class.warn]="late(o) === 1" [class.bad]="late(o) === 2">{{ dine(o) ? '🍽️ Table ' + o.table + (o.customer.name ? ' · ' + o.customer.name : '') : '🛵 ' + o.customer.name }}@if (waitText(o); as w) { · {{ w }} }</span>
        </div>
        <div class="it">{{ summary(o) }}</div>
        <div class="f">
          <b class="amt">₹{{ amount(o) }}</b>
          @if (nth(o) > 1) { <span class="tag" data-testid="regular">⭐ {{ nth(o) }}{{ ord(nth(o)) }}</span> }
          @if (claim(o)) { <span class="claimchip" data-testid="pay-claim-chip">Customer says paid</span> }
          @if (o.status === 'pending') {
            <button type="button" class="btn danger" (click)="$event.stopPropagation(); asking.set({ id: o.id, mode: 'reject' })" data-testid="reject">Reject</button>
          }
          @if (pr) {
            <button type="button" class="btn primary" [disabled]="locked(o)" (click)="$event.stopPropagation(); act(o, pr)" [attr.data-testid]="pr.kind === 'accept' ? 'accept' : pr.kind === 'step' ? 'next' : 'confirm-payment'">{{ pr.label }}</button>
          }
        </div>
      </article>
    }

    @if (detail(); as d) {
      @let lead = rounds(d)[0];
      <div class="overlay sheet" (click)="closeDetail()" role="presentation">
        <div class="dialog osheet" role="dialog" aria-modal="true" aria-labelledby="od-title" (click)="$event.stopPropagation()" data-testid="order-sheet">
          <div class="grab" aria-hidden="true"></div>
          <div class="sh">
            <h2 id="od-title">{{ lead.number }}</h2>
            <span class="badge" [attr.data-status]="focus(d).status">{{ label(focus(d)) }}</span>
            <button type="button" class="x" (click)="closeDetail()" aria-label="Close">✕</button>
          </div>

          <section class="who">
            <div class="whorow">
              <span><b>{{ dine(d) ? '🍽️ Table ' + d.table + ' · ' : '' }}{{ lead.customer.name }}</b>@if (nth(lead) > 1) { <span class="tag">⭐ Regular · {{ nth(lead) }}{{ ord(nth(lead)) }} order</span> }</span>
              @if (lead.customer.phone && (lead.status !== 'pending' || !dine(d))) {
                @if (lead.status !== 'pending') { <a class="btn" [href]="'tel:' + lead.customer.phone" data-testid="call">📞 {{ lead.customer.phone }}</a> }
              }
            </div>
            @if (!dine(d)) {
              <span>{{ lead.customer.address }}{{ lead.customer.landmark ? ' · ' + lead.customer.landmark : '' }}</span>
              @if (lead.status !== 'pending') {
                <a class="btn" [href]="maps(lead)" target="_blank" rel="noopener" data-testid="navigate">📍 {{ lead.location ? 'Navigate' : 'Find on map' }}</a>
              } @else {
                <small class="muted">Phone number and map location appear after you accept.</small>
              }
            }
          </section>

          @for (r of rounds(d); track r.id) {
            <section class="round">
              @if (rounds(d).length > 1) {
                <div class="rh"><b>{{ r.number }}</b><span class="badge" [attr.data-status]="r.status">{{ label(r) }}</span><span class="muted">{{ time(r.createdAt) }}</span></div>
              } @else {
                <div class="muted">{{ time(r.createdAt) }}@if (store.arrivedIn()[r.id]; as ms) { <span data-testid="arrived"> · ⏱ reached you in {{ (ms / 1000).toFixed(1) }}s</span> }</div>
              }
              <ul class="items">
                @for (l of r.lines; track $index) {
                  <li><span>{{ l.qty }} × {{ l.name }}{{ l.sizeLabel ? ' (' + l.sizeLabel + ')' : '' }}@if (extras(l)) { <small class="extras">{{ extras(l) }}</small> }</span>
                    <span class="lt">₹{{ l.total }}@if (r.status === 'pending' || isLive(r)) { <button type="button" class="mini" (click)="soldOut(l.itemId, l.name)" data-testid="sold-out">Sold out</button> }</span></li>
                }
                @if (!dine(r) && r.deliveryFee) { <li><span>Delivery</span><span>₹{{ r.deliveryFee }}</span></li> }
              </ul>
              @if (r.discount; as dc) { <div class="total disc"><span>🎁 Regular customer {{ dc.percent }}% off</span><b>−₹{{ dc.amount }}</b></div> }
              @if (r.note) { <p class="note">📝 {{ r.note }}</p> }
              @if (r.rejectReason && !isLive(r)) { <p class="note">Reason: {{ r.rejectReason }}</p> }
              @if (r.status === 'pending') {
                <div class="actions">
                  <button type="button" class="btn danger" (click)="asking.set({ id: r.id, mode: 'reject' })">Reject…</button>
                  <button type="button" class="btn primary" [disabled]="busy() === r.id" (click)="accept(r); closeDetail()">✔ Accept order</button>
                </div>
              } @else if (next(r)) {
                <div class="actions">
                  <button type="button" class="btn danger" (click)="asking.set({ id: r.id, mode: 'cancel' })">Cancel…</button>
                  <button type="button" class="btn primary" [disabled]="busy() === r.id" (click)="stepFromSheet(r)">{{ nextLabel(r) }}</button>
                </div>
              }
              @if (accepted(r) && canPrint()) {
                <div class="actions"><button type="button" class="btn sm" (click)="kot(r)" data-testid="print-kot">🍳 Kitchen slip</button></div>
              }
            </section>
          }

          @if (billLead(lead)) {
            <section class="billbox" [attr.data-testid]="'bill-' + lead.number">
              @if (dine(d) && rounds(d).length > 1) { <div class="brow"><b>🍽️ Table {{ d.table }} bill</b><span class="muted">{{ rounds(d).length }} orders</span></div> }
              @if (claim(d); as c) {
                <div class="claim" data-testid="pay-claim">
                  <b>💬 Customer says paid ₹{{ amount(d) }} by UPI</b>
                  <small>Check your UPI app or soundbox for ₹{{ amount(d) }}, then confirm.</small>
                  <div class="actions">
                    <button type="button" class="btn" (click)="dismissClaim(c)" data-testid="claim-no">Not received</button>
                    <button type="button" class="btn primary" (click)="payNow(c, d, 'upi')" data-testid="claim-yes">✔ Received</button>
                  </div>
                </div>
              }
              <div class="brow amt"><span>{{ paidWith(d) ? '✅ Paid · ' + payLabel(paidWith(d)!) : dine(d) ? 'Total · pay at the counter' : 'Amount to collect' }}</span><b>₹{{ amount(d) }}</b></div>
              <div class="actions">
                @if (!paidWith(d)) {
                  <button type="button" class="btn primary" [disabled]="busy() === d.id || !served(d)" (click)="askPay(d)" data-testid="confirm-payment">💰 Confirm payment</button>
                }
                @if (paidWith(d)) {
                  <button type="button" class="btn sm" (click)="print(d)" data-testid="print-bill">🖨️ Print bill</button>
                  <button type="button" class="btn wa sm" [disabled]="sharing() === d.id" (click)="share(d)" data-testid="share-bill">
                    <svg class="waic" viewBox="0 0 24 24" aria-hidden="true"><path fill="#fff" d="M12 2.4A9.6 9.6 0 0 0 3.7 16.9L2.4 21.6l4.9-1.3A9.6 9.6 0 1 0 12 2.4z"/><path fill="#25d366" transform="translate(5.4 5.4) scale(.56)" d="M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z"/></svg>
                    {{ sharing() === d.id ? 'Preparing…' : 'Send invoice' }}
                  </button>
                }
              </div>
              @if (!paidWith(d)) {
                <small class="muted" data-testid="pay-first">{{ served(d) ? 'Confirm the payment to print the bill or send the invoice.' : (dine(d) ? 'Payment opens once the food is served.' : 'Payment opens once the order is delivered.') }}</small>
              }
            </section>
          }
        </div>
      </div>
    }

    @if (paying(); as p) {
      <div class="overlay sheet payover" (click)="paying.set(null)" role="presentation">
        <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="pay-title" (click)="$event.stopPropagation()" data-testid="pay-sheet">
          <h2 id="pay-title">Received ₹{{ p.amount }}?</h2>
          <p>{{ p.label }} — how did the customer pay?</p>
          <div class="paygrid">
            <button type="button" class="btn primary" (click)="pay(p, 'cash')" data-testid="pay-cash">💵 Cash</button>
            <button type="button" class="btn primary" (click)="pay(p, 'upi')" data-testid="pay-upi">📲 UPI</button>
            <button type="button" class="btn primary" (click)="pay(p, 'card')" data-testid="pay-card">💳 Card</button>
          </div>
          <button type="button" class="btn" (click)="paying.set(null)">Not yet</button>
        </div>
      </div>
    }

    @if (asking(); as a) {
      <app-reason-sheet
        [title]="a.mode === 'reject' ? 'Reject this order?' : 'Cancel this order?'"
        [confirmLabel]="a.mode === 'reject' ? 'Reject order' : 'Cancel order'"
        (cancelled)="asking.set(null)"
        (confirmed)="confirmReason(a, $event)" />
    }

    @if (kitchen()) {
      <div class="kitchen" role="dialog" aria-modal="true" aria-label="Kitchen mode" data-testid="kitchen">
        <header>
          <b>🍳 Kitchen</b><span>{{ kitchenList().length }} to make</span>
          <button type="button" class="btn" (click)="kitchen.set(false)" data-testid="kitchen-close">✕ Close</button>
        </header>
        <div class="klist">
          @for (r of kitchenList(); track r.id) {
            <article class="kcard" [class.late]="kitchenLate(r)" [attr.data-testid]="'kitchen-' + r.number">
              <div class="kh"><b>{{ r.number }}</b><span>{{ dine(r) ? '🍽️ Table ' + r.table : '🛵 Delivery' }}</span><span class="kt">{{ kitchenAge(r) }}</span></div>
              <ul>
                @for (l of r.lines; track $index) {
                  <li><b>{{ l.qty }} ×</b> {{ l.name }}{{ l.sizeLabel ? ' (' + l.sizeLabel + ')' : '' }}@if (extras(l)) { <small class="extras">{{ extras(l) }}</small> }@if (l.note) { <small class="extras">📝 {{ l.note }}</small> }</li>
                }
              </ul>
              @if (r.note) { <p class="knote">📝 {{ r.note }}</p> }
              <button type="button" class="btn primary kbig" [disabled]="locked(r)" (click)="kitchenStep(r)" data-testid="kitchen-step">{{ nextLabel(r) }}</button>
            </article>
          } @empty {
            <p class="muted center">Nothing to cook right now 🎉</p>
          }
        </div>
      </div>
    }

    @if (undo(); as u) {
      <div class="undobar" role="status" data-testid="undo-bar">
        <span>{{ u }}</span>
        <button type="button" (click)="undoNow()" data-testid="undo">Undo</button>
      </div>
    }
  `,
})
export class OrdersPage {
  protected readonly extras = lineExtras;
  protected readonly shop = inject(Shop);

  // ---- ready time (minutes the owner promises when accepting) ----
  protected readonly readyOptions = [10, 15, 20, 30];
  protected readonly readyMin = signal(this.loadReady());
  private loadReady(): number {
    try {
      const v = Number(localStorage.getItem('js.ready.v1'));
      return this.readyOptions.includes(v) ? v : 15;
    } catch {
      return 15;
    }
  }
  protected setReady(m: number): void {
    this.readyMin.set(m);
    try {
      localStorage.setItem('js.ready.v1', String(m));
    } catch {
      /* the choice just isn't remembered */
    }
  }
  protected async toggleBusy(): Promise<void> {
    try {
      await this.shop.setBusyMode(!this.shop.busyMode());
      this.notice.set(this.shop.busyMode() ? '🔥 Busy mode is ON: customers see a longer-wait notice.' : 'Busy mode is off.');
    } catch {
      this.error.set('Could not change Busy mode. Check your internet connection.');
    }
  }

  // ---- swipe a tile: right = accept / next step, left = reject ----
  protected readonly drag = signal<{ id: string; dx: number } | null>(null);
  private sx = 0;
  private sy = 0;
  private swiping = false;
  private dragId: string | null = null;
  private lastSwipe = 0;
  protected ts(o: Order, e: TouchEvent): void {
    const t = e.touches[0];
    if (!t) return;
    this.sx = t.clientX;
    this.sy = t.clientY;
    this.swiping = false;
    this.dragId = o.id;
  }
  protected tm(o: Order, e: TouchEvent): void {
    const t = e.touches[0];
    if (!t || this.dragId !== o.id) return;
    const dx = t.clientX - this.sx;
    const dy = t.clientY - this.sy;
    if (!this.swiping) {
      if (Math.abs(dx) > 14 && Math.abs(dx) > Math.abs(dy) * 1.5) this.swiping = true;
      else return;
    }
    this.drag.set({ id: o.id, dx: Math.max(-140, Math.min(140, dx)) });
  }
  protected te(o: Order): void {
    const d = this.drag();
    const was = this.swiping;
    this.tc();
    if (!was || !d || d.id !== o.id) return;
    this.lastSwipe = Date.now();
    if (d.dx >= 90) {
      const pr = this.primary(o);
      if (pr && (pr.kind === 'accept' || pr.kind === 'step') && !this.locked(o)) this.act(o, pr);
    } else if (d.dx <= -90 && o.status === 'pending') {
      this.asking.set({ id: o.id, mode: 'reject' });
    }
  }
  protected tc(): void {
    this.swiping = false;
    this.dragId = null;
    this.drag.set(null);
  }

  // ---- kitchen mode: big cards of what is being cooked ----
  protected readonly kitchen = signal(false);
  private readonly backKitchen = closeOnBack(this.kitchen, () => this.kitchen.set(false));
  protected readonly kitchenList = computed(() =>
    this.store
      .orders()
      .filter((o) => o.status === 'accepted' || o.status === 'preparing')
      .sort((a, b) => a.createdAt - b.createdAt),
  );
  protected kitchenAge(o: Order): string {
    const m = Math.max(0, Math.floor((this.now() - o.createdAt) / 60_000));
    return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
  }
  protected kitchenLate(o: Order): boolean {
    return (o.readyAt ? this.now() > o.readyAt : this.now() - o.createdAt > 20 * 60_000);
  }
  protected kitchenStep(r: Order): void {
    this.stepDeferred(r);
  }
  protected readonly store = inject(OrdersStore);
  protected readonly sms = inject(PaySms);
  protected readonly tab = signal<Tab>('new');
  private readonly alarm = inject(AlarmService);
  private readonly openNew = effect(() => {
    if (this.alarm.showNew() > 0) this.tab.set('new');
  });
  protected readonly busy = signal<string | null>(null);
  protected readonly error = signal('');
  protected readonly asking = signal<{ id: string; mode: 'reject' | 'cancel' } | null>(null);
  private readonly backCloses = closeOnBack(computed(() => this.asking() !== null), () => this.asking.set(null));
  protected readonly kind = signal<Kind>('all');
  protected readonly notice = signal('');
  protected readonly paying = signal<{ order: Order; amount: number; label: string } | null>(null);
  private readonly printer = inject(PrinterService);
  private readonly showPrintResult = effect(() => {
    const m = this.printer.autoMessage();
    if (m) this.notice.set(m);
  });
  private readonly backPay = closeOnBack(computed(() => this.paying() !== null), () => this.paying.set(null));
  private readonly tabList = computed(() => ({ new: this.store.pending(), active: this.store.active(), history: this.store.history() })[this.tab()]);
  private readonly destroyRef = inject(DestroyRef);
  /** Ticks every 30 s so the waiting times stay fresh. */
  private readonly now = signal(Date.now());
  private readonly ticker = setInterval(() => this.now.set(Date.now()), 30_000);
  private readonly stop = this.destroyRef.onDestroy(() => {
    clearInterval(this.ticker);
    this.flushUndo();
  });

  /** One tile per order, except dine-in rounds of the same table bill, which share one tile (led by the oldest round). */
  private group(list: readonly Order[]): Order[] {
    const seen = new Set<string>();
    const out: Order[] = [];
    for (const o of list) {
      const lead = this.dine(o) && o.billId && o.status !== 'pending' ? this.rounds(o)[0]! : o;
      if (seen.has(lead.id)) continue;
      seen.add(lead.id);
      out.push(lead);
    }
    return out;
  }
  private readonly grouped = computed(() => (this.tab() === 'history' ? this.tabList() : this.group(this.tabList())));
  protected readonly collectList = computed(() => this.group(this.store.active()).filter((o) => this.served(o) && !this.paidWith(o)));
  protected readonly collectCount = computed(() => this.collectList().length);
  protected readonly shown = computed(() => {
    const k = this.kind();
    if (k === 'collect') return this.collectList();
    return this.grouped().filter((o) => k === 'all' || orderTypeOf(o) === k);
  });

  protected count(k: Kind): number {
    return this.grouped().filter((o) => k === 'all' || orderTypeOf(o) === k).length;
  }
  protected setTab(t: Tab): void {
    this.tab.set(t);
    if (this.kind() === 'collect') this.kind.set('all');
  }
  protected pickCollect(): void {
    this.tab.set('active');
    this.kind.set('collect');
  }
  protected dine = (o: Order) => orderTypeOf(o) === 'dine_in';
  protected rounds = (o: Order) => billOrdersOf(this.store.orders(), o);
  protected amount = (o: Order) => billTotal(this.rounds(o));
  protected paidWith = (o: Order): PayMethod | null => this.rounds(o).find((x) => x.payment)?.payment?.method ?? null;
  protected payLabel = (m: PayMethod) => PAY_METHOD_LABEL[m];
  /** The bill buttons live on the oldest accepted order of a table bill (or on the order itself for delivery). */
  protected billLead = (o: Order): boolean => isLiveStatus(o.status) && this.rounds(o)[0]?.id === o.id;
  protected awaiting = awaitingPayment;
  private readonly backend = inject(BACKEND);
  /** A round of this bill where the customer tapped "I have paid" (UPI) and the owner has not answered yet. */
  protected claim = (o: Order): Order | null => (this.paidWith(o) ? null : (this.rounds(o).find((x) => x.payClaim) ?? null));
  /** How many orders this phone has placed (accepted) up to and including this one, among the loaded orders. */
  protected nth = (o: Order): number =>
    !o.customer?.phone ? 0 : this.store.orders().filter((x) => x.customer?.phone === o.customer.phone && x.createdAt <= o.createdAt && (x.id === o.id || isLiveStatus(x.status))).length;
  protected ord = (n: number): string => (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th');
  /** The round of a tile that needs the kitchen's attention next (the first one not yet served). */
  protected focus = (o: Order): Order => (o.status === 'pending' ? o : (this.rounds(o).find((x) => x.status !== 'delivered') ?? this.rounds(o)[0]!));
  protected primary(o: Order): Primary | null {
    if (o.status === 'pending') return { kind: 'accept', label: 'Accept', order: o };
    const f = this.focus(o);
    if (f.status !== 'delivered' && this.next(f)) return { kind: 'step', label: this.nextLabel(f), order: f };
    if (this.served(o) && !this.paidWith(o)) return this.claim(o) ? { kind: 'check', label: 'Check', order: o } : { kind: 'collect', label: 'Collect payment', order: o };
    return null;
  }
  protected summary(o: Order): string {
    const rs = this.rounds(o);
    const names = rs.flatMap((r) => r.lines.map((l) => `${l.name}${l.sizeLabel ? ' (' + shortSize(l.sizeLabel) + ')' : ''}${l.qty > 1 ? ' ×' + l.qty : ''}`));
    return names.join(', ');
  }
  private minutes(o: Order): number | null {
    const f = this.focus(o);
    if (f.status === 'delivered' || !(isActive(f.status) || f.status === 'pending')) return null;
    return Math.max(0, Math.floor((this.now() - f.createdAt) / 60_000));
  }
  protected waitText(o: Order): string {
    const m = this.minutes(o);
    if (m === null) return '';
    return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
  }
  /** 0 = fine, 1 = getting late (orange), 2 = late (red). */
  protected late(o: Order): 0 | 1 | 2 {
    const m = this.minutes(o);
    if (m === null) return 0;
    const [warn, bad] = o.status === 'pending' ? [2, 4] : [10, 20];
    return m >= bad ? 2 : m >= warn ? 1 : 0;
  }
  protected locked = (o: Order): boolean => this.busy() === o.id || this.queuedKey() === o.id;

  // ---- order popup ----
  private readonly detailId = signal<string | null>(null);
  protected readonly detail = computed(() => {
    const id = this.detailId();
    return id ? (this.store.orders().find((x) => x.id === id) ?? null) : null;
  });
  private readonly backDetail = closeOnBack(computed(() => this.detail() !== null), () => this.detailId.set(null));
  protected open(o: Order): void {
    if (Date.now() - this.lastSwipe < 400) return; // the tap that ends a swipe is not a tap
    this.detailId.set(o.id);
  }
  protected closeDetail(): void {
    this.detailId.set(null);
  }

  /** The tile's main button. */
  protected act(o: Order, p: Primary): void {
    if (p.kind === 'accept') void this.accept(p.order);
    else if (p.kind === 'step') this.stepDeferred(p.order);
    else if (p.kind === 'collect') this.askPay(p.order);
    else this.open(o);
  }
  protected stepFromSheet(r: Order): void {
    this.closeDetail();
    this.stepDeferred(r);
  }
  private stepDeferred(r: Order): void {
    const to = nextAdminStep(r.status, orderTypeOf(r));
    if (!to) return;
    this.defer(`${r.number}: ${this.nextLabel(r)}`, r.id, () => this.store.advance(r.id, to));
  }
  protected payNow(claimOrder: Order, d: Order, method: PayMethod): void {
    this.closeDetail();
    this.defer(`Payment ₹${this.amount(d)} recorded`, d.id, () => this.store.markPaid(claimOrder, method));
  }

  // ---- undo: the action is sent after 3 seconds unless the owner taps Undo ----
  protected readonly undo = signal<string | null>(null);
  protected readonly queuedKey = signal<string | null>(null);
  private undoTimer: ReturnType<typeof setTimeout> | null = null;
  private undoFn: { key: string; fn: () => Promise<void> } | null = null;
  private defer(label: string, key: string, fn: () => Promise<void>): void {
    this.flushUndo();
    this.undoFn = { key, fn };
    this.queuedKey.set(key);
    this.undo.set(label);
    this.undoTimer = setTimeout(() => this.flushUndo(), 3000);
  }
  private flushUndo(): void {
    if (this.undoTimer) clearTimeout(this.undoTimer);
    this.undoTimer = null;
    const q = this.undoFn;
    this.undoFn = null;
    this.undo.set(null);
    if (q) {
      void this.run(q.key, q.fn).finally(() => this.queuedKey.set(null));
    } else {
      this.queuedKey.set(null);
    }
  }
  protected undoNow(): void {
    if (this.undoTimer) clearTimeout(this.undoTimer);
    this.undoTimer = null;
    this.undoFn = null;
    this.undo.set(null);
    this.queuedKey.set(null);
  }

  protected async dismissClaim(o: Order): Promise<void> {
    await this.run(o.id, () => this.backend.dismissClaim(o.id));
  }
  protected async soldOut(itemId: string, name: string): Promise<void> {
    try {
      await this.backend.setAvailable(itemId, false);
      this.notice.set(`${name} is now marked sold out. Turn it back on in the Menu tab.`);
    } catch {
      this.error.set('Could not update the menu. Check your internet connection.');
    }
  }
  /** Payment can be confirmed only when every round on the bill has been served / delivered. */
  protected served = (o: Order): boolean => this.rounds(o).every((x) => x.status === 'delivered');
  protected accepted = (o: Order) => isLiveStatus(o.status);

  protected label = (o: Order) => statusLabel(o.status, orderTypeOf(o));
  protected time = (ms: number) => formatDateTime(ms);
  protected maps = mapsLink;
  protected isLive = (o: Order) => isActive(o.status);
  protected next = (o: Order) => nextAdminStep(o.status, orderTypeOf(o));
  protected nextLabel = (o: Order) => nextStepLabel(o.status, orderTypeOf(o));

  protected async accept(o: Order): Promise<void> {
    await this.run(o.id, () => this.store.accept(o.id, this.readyMin() + this.shop.busyExtra()));
    if (!this.error() && this.printer.autoKot()) void this.printer.printKot(o, this.isAddOn(o)).then((m) => m && this.notice.set(m));
  }
  /** A second (or later) order from a table that already has an order on the bill. */
  private isAddOn(o: Order): boolean {
    return this.dine(o) && this.rounds(o).findIndex((x) => x.id === o.id) > 0;
  }
  protected canPrint(): boolean {
    return this.printer.available;
  }
  protected async kot(o: Order): Promise<void> {
    this.notice.set('');
    const msg = await this.printer.printKot(o, this.isAddOn(o));
    this.notice.set(msg ?? '🍳 Kitchen slip sent to the printer.');
  }
  protected askPay(o: Order): void {
    if (!this.served(o)) return;
    this.paying.set({ order: o, amount: this.amount(o), label: this.dine(o) ? `Table ${o.table}` : o.number });
  }
  protected async pay(p: { order: Order; amount: number }, method: PayMethod): Promise<void> {
    this.paying.set(null);
    this.closeDetail();
    this.defer(`Payment ₹${p.amount} recorded`, p.order.id, () => this.store.markPaid(p.order, method));
  }
  protected async print(o: Order): Promise<void> {
    if (!this.paidWith(o)) {
      this.notice.set('Confirm the payment first, then print the bill.');
      return;
    }
    this.notice.set('');
    const msg = await this.printer.printBill(this.rounds(o));
    this.notice.set(msg ?? '🖨️ Sent to the printer.');
  }
  protected readonly sharing = signal<string | null>(null);
  protected async share(o: Order): Promise<void> {
    const orders = this.rounds(o);
    if (!orders.some((x) => x.payment)) return;
    this.notice.set('');
    this.sharing.set(o.id);
    try {
      const pdf = await buildInvoicePdf(orders);
      const name = orders.find((x) => x.invoice)?.invoice?.cafeName ?? 'Juicysukun Café';
      const phone = whatsappNumber(orders.map((x) => x.customer?.phone).find(Boolean));
      const msg = await sharePdf(pdf, `${name}\nThank you! Your ${this.dine(o) ? 'bill' : 'invoice'} is attached.`, phone);
      if (msg) this.notice.set(msg);
    } catch {
      this.notice.set('Could not create the PDF invoice. Please try again.');
    } finally {
      this.sharing.set(null);
    }
  }
  protected async confirmReason(a: { id: string; mode: 'reject' | 'cancel' }, reason: string): Promise<void> {
    this.asking.set(null);
    await this.run(a.id, () => (a.mode === 'reject' ? this.store.reject(a.id, reason) : this.store.advance(a.id, 'cancelled', reason)));
  }

  private async run(id: string, fn: () => Promise<void>): Promise<void> {
    this.busy.set(id);
    this.error.set('');
    try {
      await fn();
    } catch (e) {
      this.error.set(e instanceof DomainError ? (USER_MESSAGES[e.code] ?? e.message) : 'Could not update the order. Check your internet and try again.');
    } finally {
      this.busy.set(null);
    }
  }
}

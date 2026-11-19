import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, inject, input, signal, computed } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import {
  PAY_METHOD_LABEL,
  statusLabel,
  trackerIndexFor,
  trackerStepsFor,
  formatDateTime,
  invoiceNumber,
  invoiceText,
  isLiveStatus,
  isTerminal,
  lineExtras,
  payAmount,
  upiLink,
  type Order,
} from '@juicy/shared';
import { Cart } from '../core/cart';
import { Orders } from '../core/orders';
import { Push } from '../core/push';
import { Store } from '../core/store';
import { QrCode } from '../ui/qr-code';

@Component({
  selector: 'app-order-page',
  imports: [RouterLink, QrCode],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (loading()) {
      @if (placed(); as p) {
        <h1 class="page-title">Order {{ p.number }}</h1>
        <section class="status wait" data-testid="status-sending" role="status">
          <div class="big pulse">📨</div>
          <h2>Order sent to the cafe</h2>
          <p>Waiting for the cafe to accept. Please keep this page open.</p>
        </section>
      } @else {
        <div class="skeletons"><div class="skeleton"></div></div>
      }
    } @else if (!order()) {
      <div class="empty">
        <div class="big">🤔</div>
        <p>We couldn't find this order on this phone.</p>
        <a routerLink="/" class="btn primary">Back to menu</a>
      </div>
    } @else {
      @let o = order()!;
      <h1 class="page-title">Order {{ o.number }}@if (dine()) { <span class="tabletag" data-testid="table-tag">🍽️ Table {{ o.table }}</span> }</h1>

      @switch (o.status) {
        @case ('pending') {
          <section class="status wait" data-testid="status-pending" role="status">
            <div class="big pulse">⏳</div>
            <h2>Waiting for the cafe to accept</h2>
            <p>Please keep this page open. This usually takes a minute or two.</p>
            <ol class="tracker" aria-label="Order progress">
              <li class="now">Sent</li>
              @for (s of steps(); track s) { <li>{{ label(s) }}</li> }
            </ol>
            <p class="timer">Auto-cancels in <b>{{ remaining() }}</b> if nobody responds</p>
            <button type="button" class="btn danger" (click)="cancel()" [disabled]="busy()" data-testid="cancel">Cancel order</button>
            <a routerLink="/" class="btn" data-testid="back-home">← Back to menu</a>
          </section>
        }
        @case ('rejected') {
          <section class="status bad" data-testid="status-rejected" role="status">
            <div class="big">😔</div>
            <h2>Sorry, the cafe couldn't take this order</h2>
            <p class="reason">"{{ o.rejectReason }}"</p>
            <a routerLink="/" class="btn primary">Order something else</a>
          </section>
        }
        @case ('cancelled') {
          <section class="status bad" data-testid="status-cancelled" role="status">
            <div class="big">🚫</div>
            <h2>Order cancelled</h2>
            @if (o.rejectReason && o.rejectReason !== 'Cancelled by customer') { <p class="reason">"{{ o.rejectReason }}"</p> }
            <a routerLink="/" class="btn primary">Back to menu</a>
          </section>
        }
        @case ('expired') {
          <section class="status bad" data-testid="status-expired" role="status">
            <div class="big">⌛</div>
            <h2>The cafe didn't respond in time</h2>
            <p>They may be very busy. You can try again or call later.</p>
            <a routerLink="/cart" class="btn primary">Try again</a>
          </section>
        }
        @default {
          <section class="status ok" [attr.data-testid]="'status-' + o.status" role="status">
            <div class="big">{{ o.status === 'delivered' ? '✅' : '🎉' }}</div>
            <h2>{{ headline(o) }}</h2>
            <ol class="tracker" aria-label="Order progress">
              @for (s of steps(); track s; let i = $index) {
                <li [class.done]="i <= idx()" [class.now]="i === idx() && o.status !== 'delivered'">{{ label(s) }}</li>
              }
            </ol>
            @if (readyText(o); as rt) { <p class="ready" data-testid="ready-in">⏱ {{ rt }}</p> }
            <a routerLink="/" class="btn" data-testid="back-home">← Back to menu</a>
          </section>
        }
      }

      @if (!terminal() && push.supported && push.permission() === 'default') {
        <section class="notify noprint" data-testid="notify-card">
          <div><b>🔔 Get updates on this phone</b><small>We'll notify you when the cafe accepts, prepares and sends your order.</small></div>
          <button type="button" class="btn primary" (click)="push.enable()" [disabled]="push.busy()" data-testid="notify-btn">Turn on</button>
        </section>
      } @else if (!terminal() && push.needsHomeScreen && !push.supported) {
        <p class="fine noprint">💡 To get order notifications on iPhone: tap Share → "Add to Home Screen", then open Juicysukun from your Home Screen.</p>
      }

      @if (o.payment) {
        <section class="paycard done" data-testid="pay-done" role="status">
          <b>✅ Payment received · {{ payLabel(o.payment.method) }}</b>
          <small>Thank you!</small>
        </section>
      } @else if (canPay()) {
        <section class="paycard noprint" data-testid="pay-upi">
          <h2>Pay ₹{{ upiOn() && payMode() === 'upi' ? payAmt() : o.total }}</h2>
          @if (o.payClaim) {
            <p class="waitpay" data-testid="pay-waiting"><span class="spin" aria-hidden="true"></span> Waiting for the cafe to confirm your payment…</p>
          } @else {
            @if (upiOn()) {
              <div class="paychoice" role="group" aria-label="How do you want to pay?">
                <button type="button" [class.on]="payMode() === 'upi'" (click)="payMode.set('upi')" data-testid="mode-upi">📲 Pay with UPI</button>
                <button type="button" [class.on]="payMode() === 'cash'" (click)="payMode.set('cash')" data-testid="mode-cash">{{ dine() ? '🧾 At the counter' : '💵 Cash on delivery' }}</button>
              </div>
            }
            @if (upiOn() && payMode() === 'upi') {
              <div class="qrbox"><app-qr [value]="upi()" label="UPI payment QR code" /></div>
              <small>Scan with any UPI app, or tap the button on this phone. The amount is filled in for you.</small>
              <button type="button" class="btn primary" (click)="openUpi()" data-testid="open-upi">Open UPI app</button>
              <div class="upiid" data-testid="upi-id-box">
                <span>UPI ID <b>{{ store.config().upiId }}</b> · Amount <b>₹{{ payAmt() }}</b></span>
                <button type="button" class="btn sm" (click)="copyUpi()" data-testid="copy-upi">{{ copied() ? 'Copied ✔' : 'Copy UPI ID' }}</button>
              </div>
              @if (payAmt() !== o.total) {
                <small class="muted" data-testid="paise-note">Please pay exactly ₹{{ payAmt() }}. The few extra paise help the cafe find your payment.</small>
              }
              <details class="gpay" data-testid="gpay-help">
                <summary>Google Pay not opening or showing an error?</summary>
                <ol>
                  <li>Tap <b>Copy UPI ID</b> above.</li>
                  <li>Open Google Pay → <b>New payment</b> → <b>Pay UPI ID or number</b> and paste it.</li>
                  <li>Enter exactly <b>₹{{ payAmt() }}</b> and pay.</li>
                  <li>Come back here and tap <b>I have paid</b>.</li>
                </ol>
                <button type="button" class="btn sm" (click)="copyAmount()" data-testid="copy-amount">{{ copiedAmt() ? 'Copied ✔' : 'Copy amount ₹' + payAmt() }}</button>
              </details>
              <button type="button" class="btn" (click)="paid()" [disabled]="busy()" data-testid="i-paid">I have paid</button>
            } @else {
              <p class="cashmsg" data-testid="pay-cash-msg">{{ dine() ? '🧾 Please pay ₹' + o.total + ' at the counter. The cafe will confirm it.' : '💵 Please pay ₹' + o.total + ' in cash to the delivery person.' }}</p>
            }
          }
        </section>
      }

      @if (o.invoice) {
        <section class="invoice" data-testid="invoice">
          <header>
            <div>
              <h2>{{ o.invoice.cafeName }}</h2>
              <small>{{ o.invoice.cafeAddress }}@if (o.invoice.fssai) { · FSSAI {{ o.invoice.fssai }} }</small>
            </div>
            <div class="right"><b>{{ invNo(o) }}</b><small>{{ when(o.createdAt) }}</small></div>
          </header>

          <a class="callcafe" [href]="'tel:' + o.invoice.cafePhone" data-testid="cafe-phone">📞 Call the cafe: <b>{{ o.invoice.cafePhone }}</b></a>

          <table>
            <thead><tr><th>Item</th><th>Qty</th><th>Amount</th></tr></thead>
            <tbody>
              @for (l of o.lines; track $index) {
                <tr><td>{{ l.name }}{{ l.sizeLabel ? ' (' + l.sizeLabel + ')' : '' }}@if (extras(l)) { <small class="extras">{{ extras(l) }}</small> }</td><td>{{ l.qty }}</td><td>₹{{ l.total }}</td></tr>
              }
            </tbody>
            <tfoot>
              <tr><td colspan="2">Items</td><td>₹{{ o.subtotal }}</td></tr>
              @if (!dine()) { <tr><td colspan="2">Delivery</td><td>{{ o.deliveryFee === 0 ? 'FREE' : '₹' + o.deliveryFee }}</td></tr> }
              @if (o.discount) { <tr data-testid="inv-discount"><td colspan="2">Regular customer {{ o.discount.percent }}% off</td><td>−₹{{ o.discount.amount }}</td></tr> }
              <tr class="grand"><td colspan="2">{{ o.payment ? 'Paid · ' + payLabel(o.payment.method) : dine() ? 'Total · pay at the counter' : 'Total · pay cash on delivery' }}</td><td>₹{{ o.total }}</td></tr>
            </tfoot>
          </table>
          @if (dine()) {
            <p class="to"><b>Table {{ o.table }}</b> · {{ o.customer.name }}</p>
          } @else {
            <p class="to"><b>Deliver to:</b> {{ o.customer.name }}, {{ o.customer.phone }}<br />{{ o.customer.address }}{{ o.customer.landmark ? ', ' + o.customer.landmark : '' }}</p>
          }

          <div class="actions noprint">
            <button type="button" class="btn" (click)="print()">🖨️ Print / Save PDF</button>
            <button type="button" class="btn" (click)="share(o)">💬 Share on WhatsApp</button>
          </div>
        </section>
      } @else if (!terminal()) {
        <p class="fine">The cafe's phone number and your invoice appear here as soon as they accept your order.</p>
      }

      <section class="summary">
        <h2>Your items</h2>
        <ul class="lines">
          @for (l of o.lines; track $index) {
            <li><div><b>{{ l.name }}{{ l.sizeLabel ? ' (' + l.sizeLabel + ')' : '' }}</b>@if (extras(l)) { <small class="extras">{{ extras(l) }}</small> }<small>× {{ l.qty }}</small></div><strong>₹{{ l.total }}</strong></li>
          }
        </ul>
      </section>

      @if (o.status === 'delivered') {
        @if (o.review) {
          <section class="review done noprint" data-testid="review-done"><b>⭐ Thanks for your rating!</b><small>{{ stars(o.review.rating) }}</small></section>
        } @else {
          <section class="review noprint" data-testid="review-form">
            <h2>How was it?</h2>
            <div class="starrow" role="radiogroup" aria-label="Rating">
              @for (n of [1, 2, 3, 4, 5]; track n) {
                <button type="button" class="star" [class.on]="n <= rating()" (click)="rating.set(n)" role="radio" [attr.aria-checked]="n === rating()" [attr.aria-label]="n + ' star'" [attr.data-testid]="'star-' + n">★</button>
              }
            </div>
            @if (rating() > 0) {
              <textarea rows="2" maxlength="300" placeholder="Tell us more (optional)" [value]="comment()" (input)="comment.set($any($event.target).value)" data-testid="review-text"></textarea>
              <button type="button" class="btn primary" (click)="sendReview()" [disabled]="busy()" data-testid="review-send">Send rating</button>
            }
          </section>
        }
        @if (offer(); as f) {
          <section class="offercard noprint" data-testid="offer-card">
            @if (f.imageUrl) { <img [src]="f.imageUrl" alt="" loading="lazy" /> }
            <div>
              <small>{{ f.sponsored ? 'Sponsored' : 'Offer' }}</small>
              <b>{{ f.title }}</b>
              @if (f.text) { <span>{{ f.text }}</span> }
              @if (f.link) { <a [href]="f.link" target="_blank" rel="noopener noreferrer" class="btn">Open</a> }
            </div>
          </section>
        }
      }

      @if (terminal()) {
        <button type="button" class="btn primary noprint" (click)="again(o)" data-testid="order-again">🔁 Order again</button>
      }

      @if (error()) { <p class="banner shut" role="alert">{{ error() }}</p> }
    }
  `,
})
export class OrderPage implements OnInit {
  protected readonly extras = lineExtras;
  readonly id = input.required<string>();
  private readonly orders = inject(Orders);
  private readonly store = inject(Store);
  private readonly cart = inject(Cart);
  private readonly router = inject(Router);
  protected readonly push = inject(Push);
  protected readonly placed = computed(() => this.orders.myOrderIds().find((x) => x.id === this.id()));
  private readonly destroyRef = inject(DestroyRef);

  protected readonly order = signal<Order | null>(null);
  protected readonly loading = signal(true);
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly rating = signal(0);
  protected readonly comment = signal('');
  protected readonly offer = computed(() => this.store.offers()[0] ?? null);
  /** Dine-in pays after being served; delivery can pay as soon as the cafe accepts. */
  protected readonly upiOn = computed(() => this.store.config().upiEnabled && !!this.store.config().upiId);
  protected readonly payMode = signal<'upi' | 'cash'>('upi');
  protected readonly canPay = computed(() => {
    const o = this.order();
    if (!o || o.payment || !isLiveStatus(o.status)) return false;
    return o.orderType === 'dine_in' ? o.status === 'delivered' : true;
  });
  /** What to pay by UPI (the total, plus a few paise when the cafe uses that to match payments). */
  protected readonly payAmt = computed(() => {
    const o = this.order();
    return o ? payAmount(o.total, o.number, this.store.config().upiPaise === true) : 0;
  });
  protected readonly upi = computed(() => {
    const o = this.order();
    const c = this.store.config();
    return o ? upiLink({ id: c.upiId, name: c.upiName || c.cafeName, amount: this.payAmt(), note: `Order ${o.number}` }) : '';
  });
  private readonly now = signal(Date.now());
  protected readonly dine = computed(() => this.order()?.orderType === 'dine_in');
  protected readonly steps = computed(() => trackerStepsFor(this.dine() ? 'dine_in' : 'delivery'));
  protected readonly idx = computed(() => trackerIndexFor(this.order()?.status ?? 'pending', this.dine() ? 'dine_in' : 'delivery'));
  protected payLabel(m: 'cash' | 'upi' | 'card'): string {
    return PAY_METHOD_LABEL[m];
  }
  protected readonly terminal = computed(() => isTerminal(this.order()?.status ?? 'pending'));
  protected readonly remaining = computed(() => {
    const left = Math.max(0, Math.ceil(((this.order()?.expiresAt ?? 0) - this.now()) / 1000));
    return `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
  });

  ngOnInit(): void {
    void this.push.refresh();
    let last: Order['status'] | null = null;
    const off = this.orders.watch(this.id(), (o) => {
      // The cafe changed the status while this page is open: buzz and beep so it is noticed.
      if (o && last && o.status !== last) this.alertUser();
      last = o?.status ?? last;
      this.order.set(o);
      this.loading.set(false);
    });
    const tick = setInterval(() => this.now.set(Date.now()), 1000);
    this.destroyRef.onDestroy(() => {
      off();
      clearInterval(tick);
    });
  }

  private alertUser(): void {
    try {
      navigator.vibrate?.([200, 100, 200]);
    } catch {
      /* not supported */
    }
    try {
      const ctx = new AudioContext();
      const t = ctx.currentTime;
      [880, 1175].forEach((f, i) => {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.frequency.value = f;
        g.gain.setValueAtTime(0.2, t + i * 0.18);
        g.gain.setValueAtTime(0, t + i * 0.18 + 0.15);
        o.connect(g).connect(ctx.destination);
        o.start(t + i * 0.18);
        o.stop(t + i * 0.18 + 0.16);
      });
      setTimeout(() => void ctx.close(), 800);
    } catch {
      /* sound blocked */
    }
  }

  /** Puts the same items (and choices) back in the cart using today's menu. */
  protected again(o: Order): void {
    for (const l of o.lines) {
      const item = this.store.item(l.itemId);
      if (!item || !item.available) continue;
      const sizeIndex = Math.max(0, item.sizes.findIndex((s) => s.label === l.sizeLabel));
      const addons = (l.addons ?? []).map((a) => item.addons?.findIndex((x) => x.label === a.label) ?? -1).filter((i) => i >= 0);
      const options = (l.options ?? []).map((n) => item.options?.indexOf(n) ?? -1).filter((i) => i >= 0);
      this.cart.addLine({
        itemId: item.id,
        sizeIndex,
        qty: l.qty,
        ...(addons.length ? { addons } : {}),
        ...(options.length ? { options } : {}),
        ...(l.note && item.allowNote ? { note: l.note } : {}),
      });
    }
    void this.router.navigate(['/cart']);
  }

  protected label(s: Order['status']): string {
    return statusLabel(s, this.dine() ? 'dine_in' : 'delivery');
  }
  protected headline(o: Order): string {
    const dine = o.orderType === 'dine_in';
    return (
      { accepted: 'Order accepted!', preparing: 'Being prepared 🍳', out_for_delivery: 'On the way to you 🛵', delivered: dine ? 'Served — enjoy! 🍽️' : 'Delivered — enjoy!' }[o.status as string] ??
      statusLabel(o.status, dine ? 'dine_in' : 'delivery')
    );
  }
  protected invNo(o: Order): string {
    return invoiceNumber(o);
  }
  protected when(ms: number): string {
    return formatDateTime(ms);
  }
  /** "Ready in about 12 min" while the food is being made; null once delivered or when the owner gave no time. */
  protected readyText(o: Order): string | null {
    if (!o.readyAt || (o.status !== 'accepted' && o.status !== 'preparing')) return null;
    const m = Math.ceil((o.readyAt - this.now()) / 60_000);
    return m > 1 ? `Ready in about ${m} min` : 'Almost ready!';
  }
  protected readonly copied = signal(false);
  protected readonly copiedAmt = signal(false);
  protected async copyAmount(): Promise<void> {
    try {
      await navigator.clipboard.writeText(String(this.payAmt()));
      this.copiedAmt.set(true);
      setTimeout(() => this.copiedAmt.set(false), 2500);
    } catch {
      /* clipboard blocked: the amount is shown on screen anyway */
    }
  }
  protected async copyUpi(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.store.config().upiId);
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 2500);
    } catch {
      /* clipboard blocked: the ID is shown on screen anyway */
    }
  }
  protected openUpi(): void {
    location.href = this.upi();
  }
  protected stars(n: number): string {
    return '★'.repeat(n) + '☆'.repeat(5 - n);
  }
  protected async paid(): Promise<void> {
    this.busy.set(true);
    this.error.set('');
    try {
      await this.orders.claimPayment(this.id());
    } catch {
      this.error.set("Couldn't tell the cafe. Please try again or show the payment to them.");
    } finally {
      this.busy.set(false);
    }
  }
  protected async sendReview(): Promise<void> {
    this.busy.set(true);
    this.error.set('');
    try {
      await this.orders.review(this.id(), this.rating(), this.comment().trim());
    } catch (e) {
      this.error.set(e instanceof Error && e.message ? e.message : "Couldn't send your rating. Please try again.");
    } finally {
      this.busy.set(false);
    }
  }
  protected print(): void {
    window.print();
  }
  protected share(o: Order): void {
    window.open('https://wa.me/?text=' + encodeURIComponent(invoiceText(o)), '_blank', 'noopener');
  }
  protected async cancel(): Promise<void> {
    this.busy.set(true);
    this.error.set('');
    try {
      await this.orders.cancel(this.id());
    } catch {
      this.error.set("Couldn't cancel — the cafe may have just accepted it.");
    } finally {
      this.busy.set(false);
    }
  }
}

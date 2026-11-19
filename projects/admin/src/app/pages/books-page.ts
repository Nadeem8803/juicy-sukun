import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, computed, effect, inject, signal } from '@angular/core';
import {
  EXPENSE_CATEGORIES,
  customerStats,
  expenseByCategory,
  expenseTotal,
  formatDateTime,
  istDay,
  ordersByHour,
  periodRange,
  ratingSummary,
  salesByDay,
  salesSummary,
  sumDaily,
  toCsv,
  topItems,
  type CustomerRecord,
  type DailyStats,
  type Expense,
  type Order,
  type Period,
} from '@juicy/shared';
import { BACKEND } from '../core/backend';
import { closeOnBack } from '../core/back-close';
import { OrdersStore } from '../core/orders-store';
import { buildSummaryPdf } from '../core/summary-pdf';
import { shareFile, sharePdf } from '../core/share-file';

type Tab = 'summary' | 'expenses' | 'insights' | 'customers' | 'reviews';
const DAY = 86_400_000;
const rs = (n: number): string => '₹' + Math.round(n).toLocaleString('en-IN');

interface CustomerRow {
  phone: string;
  name: string;
  orders: number;
  spent: number;
  lastAt: number;
  favourite: string;
  optIn: boolean;
}

/** Ledger + analytics: sales, expenses, profit, visitors, customers and reviews. */
@Component({
  selector: 'app-books-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1>Books</h1>
    <div class="seg five" role="tablist">
      @for (t of tabs; track t.id) {
        <button role="tab" [class.on]="tab() === t.id" (click)="tab.set(t.id)" [attr.data-testid]="'books-' + t.id">{{ t.label }}</button>
      }
    </div>
    @if (error()) { <p class="banner warn" role="alert">{{ error() }}</p> }
    @if (notice()) { <p class="banner" role="status">{{ notice() }}</p> }

    @if (tab() !== 'expenses' && tab() !== 'customers' && tab() !== 'reviews') {
      <div class="seg" role="group" aria-label="Period">
        <button [class.on]="period() === 'today'" (click)="period.set('today')">Today</button>
        <button [class.on]="period() === 'week'" (click)="period.set('week')">7 days</button>
        <button [class.on]="period() === 'month'" (click)="period.set('month')">30 days</button>
      </div>
    }

    @switch (tab()) {
      @case ('summary') {
        <div class="kpis" data-testid="kpis">
          <div class="kpi hero"><small>Sales (paid)</small><b>{{ rs(sum().sales) }}</b></div>
          <div class="kpi"><small>Expenses</small><b>{{ rs(expTotal()) }}</b></div>
          <div class="kpi" [class.neg]="profit() < 0"><small>Profit</small><b>{{ rs(profit()) }}</b></div>
          <div class="kpi"><small>Orders</small><b>{{ sum().orders }}</b></div>
          <div class="kpi"><small>Average bill</small><b>{{ rs(sum().avg) }}</b></div>
          <div class="kpi"><small>Not yet confirmed</small><b>{{ rs(sum().unpaid) }}</b></div>
        </div>
        <section class="panel">
          <h2>How customers paid</h2>
          <div class="split"><span>💵 Cash</span><b>{{ rs(sum().byMethod.cash) }}</b></div>
          <div class="split"><span>📲 UPI</span><b>{{ rs(sum().byMethod.upi) }}</b></div>
          <div class="split"><span>💳 Card</span><b>{{ rs(sum().byMethod.card) }}</b></div>
          <div class="split"><span>🍽️ Dine-in</span><b>{{ rs(sum().dineIn) }}</b></div>
          <div class="split"><span>🛵 Delivery</span><b>{{ rs(sum().delivery) }}</b></div>
          @if (sum().discount) { <div class="split"><span>🎁 Loyalty discounts given</span><b>{{ rs(sum().discount) }}</b></div> }
        </section>
        @if (period() !== 'today') {
          <section class="panel">
            <h2>Sales per day</h2>
            <div class="bars" aria-label="Sales per day">
              @for (d of series(); track d.day) { <i [style.height.%]="pct(d.sales, maxSales())" [title]="d.day + ': ' + rs(d.sales)"></i> }
            </div>
            <small class="muted">{{ series()[0]?.day }} → {{ series()[series().length - 1]?.day }}</small>
          </section>
        }
        <div class="actions">
          <button type="button" class="btn" (click)="shareText()" data-testid="share-summary">💬 Share summary</button>
          <button type="button" class="btn" [disabled]="busy()" (click)="sharePdfSummary()" data-testid="pdf-summary">📄 PDF</button>
        </div>
        <button type="button" class="btn" (click)="reload()">🔄 Refresh</button>
        <button type="button" class="btn primary" (click)="closing.set(true)" data-testid="close-day">📋 Close the day</button>
      }

      @case ('expenses') {
        <form class="panel" (submit)="$event.preventDefault(); addExpense()">
          <h2>Add an expense</h2>
          <div class="two">
            <label>Amount ₹ <input type="number" inputmode="decimal" min="1" [value]="expAmount()" (input)="expAmount.set($any($event.target).value)" data-testid="exp-amount" /></label>
            <label>Date <input type="date" [value]="expDay()" (input)="expDay.set($any($event.target).value)" /></label>
          </div>
          <label>Type
            <select [value]="expCat()" (change)="expCat.set($any($event.target).value)">
              @for (c of categories; track c) { <option [value]="c">{{ c }}</option> }
            </select></label>
          <label>Note (optional) <input maxlength="120" [value]="expNote()" (input)="expNote.set($any($event.target).value)" /></label>
          @if (expError()) { <p class="err" role="alert">{{ expError() }}</p> }
          <button type="submit" class="btn primary" data-testid="exp-save">Save expense</button>
        </form>
        <section class="panel">
          <h2>This month</h2>
          @for (c of monthByCat(); track c.category) { <div class="split"><span>{{ c.category }}</span><b>{{ rs(c.amount) }}</b></div> }
          <div class="split strong"><span>Total</span><b>{{ rs(monthExpenseTotal()) }}</b></div>
        </section>
        <section class="panel">
          <h2>Recent expenses</h2>
          @for (e of expenses().slice(0, 40); track e.id) {
            <div class="split"><span>{{ e.day }} · {{ e.category }}@if (e.note) { <small class="muted"> · {{ e.note }}</small> }</span>
              <b>{{ rs(e.amount) }} <button type="button" class="mini" (click)="delExpense(e)">✕</button></b></div>
          }
          @if (expenses().length === 0) { <p class="muted">No expenses yet.</p> }
        </section>
      }

      @case ('insights') {
        <section class="panel" data-testid="visitors">
          <h2>People using the app</h2>
          <div class="kpis">
            <div class="kpi hero"><small>Visitors</small><b>{{ visits().visitors }}</b></div>
            <div class="kpi"><small>New</small><b>{{ visits().newVisitors }}</b></div>
            <div class="kpi"><small>Returning</small><b>{{ visits().returning }}</b></div>
            <div class="kpi"><small>Visits</small><b>{{ visits().sessions }}</b></div>
            <div class="kpi"><small>From table QR</small><b>{{ visits().qr }}</b></div>
          </div>
          <h3>From visit to order</h3>
          <div class="split"><span>Opened the menu</span><b>{{ visits().sessions }}</b></div>
          <div class="split"><span>Added to cart</span><b>{{ visits().cart }}</b></div>
          <div class="split"><span>Reached checkout</span><b>{{ visits().checkout }}</b></div>
          <div class="split"><span>Placed an order</span><b>{{ visits().ordered }}</b></div>
          <small class="muted">Visitors are counted per day. Raw visit data is packed into a weekly archive and cleared; these totals are kept.</small>
        </section>
        <section class="panel">
          <h2>Busiest hours (orders)</h2>
          <div class="bars hours">
            @for (n of hourOrders(); track $index) { <i [style.height.%]="pct(n, maxHour())" [title]="$index + ':00 → ' + n + ' orders'"></i> }
          </div>
          <div class="axis"><span>12 am</span><span>6 am</span><span>12 pm</span><span>6 pm</span></div>
        </section>
        <section class="panel">
          <h2>Best sellers</h2>
          @for (it of items(); track it.name) { <div class="split"><span>{{ it.name }}</span><b>{{ it.qty }} · {{ rs(it.revenue) }}</b></div> }
          @if (items().length === 0) { <p class="muted">No orders in this period.</p> }
        </section>
      }

      @case ('customers') {
        <section class="panel">
          <h2>Customers ({{ rows().length }})</h2>
          <input type="search" placeholder="Search name or number" [value]="q()" (input)="q.set($any($event.target).value)" data-testid="cust-search" />
          <label class="check"><input type="checkbox" [checked]="onlyRepeat()" (change)="onlyRepeat.set($any($event.target).checked)" /> Only repeat customers (2+ orders)</label>
          <button type="button" class="btn" (click)="exportCsv()" data-testid="cust-export">⬇️ Export list (CSV)</button>
        </section>
        @for (c of filtered(); track c.phone) {
          <article class="order cust" [attr.data-testid]="'cust-' + c.phone">
            <header><div><b>{{ c.name }}</b> <span class="muted">· {{ c.phone }}</span></div><span class="badge">{{ c.orders }} order{{ c.orders === 1 ? '' : 's' }}</span></header>
            <div class="split"><span>Spent</span><b>{{ rs(c.spent) }}</b></div>
            <div class="split"><span>Last order</span><b>{{ date(c.lastAt) }}</b></div>
            @if (c.favourite) { <div class="split"><span>Favourite</span><b>{{ c.favourite }}</b></div> }
            <div class="actions">
              <a class="btn sm" [href]="'tel:' + c.phone">📞 Call</a>
              @if (c.optIn) { <button type="button" class="btn sm wa" (click)="offerTo(c)">💬 Send offer</button> } @else { <small class="muted">Has not agreed to offers</small> }
              <button type="button" class="btn sm" (click)="open.set(open() === c.phone ? '' : c.phone)">{{ open() === c.phone ? 'Hide orders' : 'Orders' }}</button>
            </div>
            @if (open() === c.phone) {
              @for (o of ordersOf(c.phone); track o.id) {
                <div class="split small"><span>{{ o.number }} · {{ date(o.createdAt) }}<small class="muted"> · {{ summaryOf(o) }}</small></span><b>₹{{ o.total }}</b></div>
              }
            }
          </article>
        }
        @if (filtered().length === 0) { <p class="muted center">No customers yet.</p> }
      }

      @case ('reviews') {
        <section class="panel" data-testid="ratings">
          <h2>Customer ratings</h2>
          <div class="kpis"><div class="kpi hero"><small>Average</small><b>{{ rating().count ? rating().average + ' ★' : '-' }}</b></div><div class="kpi"><small>Reviews</small><b>{{ rating().count }}</b></div></div>
          @for (n of [5, 4, 3, 2, 1]; track n) {
            <div class="split"><span>{{ n }} ★</span><span class="bar"><i [style.width.%]="pct(rating().stars[n - 1], rating().count)"></i></span><b>{{ rating().stars[n - 1] }}</b></div>
          }
        </section>
        @for (o of reviewed(); track o.id) {
          <article class="order">
            <header><div><b>{{ '★'.repeat(o.review!.rating) }}</b><span class="muted">{{ '☆'.repeat(5 - o.review!.rating) }}</span> · {{ o.customer.name }}</div><span class="muted">{{ date(o.review!.at) }}</span></header>
            @if (o.review!.comment) { <p class="note">“{{ o.review!.comment }}”</p> }
            <div class="split"><small class="muted">{{ o.number }}</small>
              <button type="button" class="btn sm" (click)="togglePublic(o)" [attr.data-testid]="'review-public-' + o.id">{{ isPublic(o.id) ? '👁 Shown to customers · Hide' : '🙈 Hidden · Show again' }}</button></div>
          </article>
        }
        @if (reviewed().length === 0) { <p class="muted center">No reviews yet. Customers can rate an order once it is delivered.</p> }
      }
    }

    @if (closing(); as _c) {
      @let t = today();
      <div class="overlay sheet" (click)="closing.set(false)" role="presentation">
        <div class="dialog osheet" role="dialog" aria-modal="true" aria-labelledby="cl-title" (click)="$event.stopPropagation()" data-testid="closing-sheet">
          <div class="grab" aria-hidden="true"></div>
          <div class="sh"><h2 id="cl-title">Closing summary · {{ t.day }}</h2></div>
          @if (t.open > 0) { <p class="banner warn" data-testid="closing-open">⚠ {{ t.open }} order{{ t.open === 1 ? ' is' : 's are' }} still open (new or in progress).</p> }
          <div class="split"><span>Sales (paid)</span><b>{{ rs(t.sum.sales) }}</b></div>
          <div class="split"><span>Orders paid</span><b>{{ t.sum.orders }}</b></div>
          <div class="split"><span>💵 Cash</span><b>{{ rs(t.sum.byMethod.cash) }}</b></div>
          <div class="split"><span>📲 UPI</span><b>{{ rs(t.sum.byMethod.upi) }}</b></div>
          <div class="split"><span>💳 Card</span><b>{{ rs(t.sum.byMethod.card) }}</b></div>
          <div class="split"><span>Delivered, payment not confirmed</span><b>{{ rs(t.sum.unpaid) }}</b></div>
          <div class="split"><span>Rejected / cancelled</span><b>{{ t.rejected }}</b></div>
          <div class="split"><span>Expenses</span><b>{{ rs(t.expenses) }}</b></div>
          <div class="split"><b>Profit</b><b [class.neg]="t.profit < 0">{{ rs(t.profit) }}</b></div>
          @if (t.items.length) {
            <h3>Top items</h3>
            @for (it of t.items.slice(0, 3); track it.name) { <div class="split"><span>{{ it.name }}</span><b>× {{ it.qty }}</b></div> }
          }
          <div class="actions">
            <button type="button" class="btn" (click)="closing.set(false)">Close</button>
            <button type="button" class="btn" (click)="shareClosing()" data-testid="closing-share">💬 WhatsApp</button>
            <button type="button" class="btn primary" [disabled]="busy()" (click)="pdfClosing()" data-testid="closing-pdf">📄 PDF</button>
          </div>
        </div>
      </div>
    }
  `,
})
export class BooksPage implements OnInit {
  private readonly backend = inject(BACKEND);
  private readonly store = inject(OrdersStore);
  private readonly destroy = inject(DestroyRef);

  protected readonly tabs: { id: Tab; label: string }[] = [
    { id: 'summary', label: 'Summary' },
    { id: 'expenses', label: 'Expenses' },
    { id: 'insights', label: 'Insights' },
    { id: 'customers', label: 'Customers' },
    { id: 'reviews', label: 'Reviews' },
  ];
  protected readonly categories = EXPENSE_CATEGORIES;
  protected readonly rs = rs;
  protected readonly tab = signal<Tab>('summary');
  protected readonly period = signal<Period>('today');
  protected readonly error = signal('');
  protected readonly notice = signal('');
  protected readonly busy = signal(false);

  private readonly loaded = signal<Order[]>([]);
  protected readonly expenses = signal<Expense[]>([]);
  private readonly daily = signal<DailyStats[]>([]);
  private readonly records = signal<CustomerRecord[]>([]);

  protected readonly expAmount = signal('');
  protected readonly expDay = signal(istDay(Date.now()));
  protected readonly expCat = signal<string>(EXPENSE_CATEGORIES[0]);
  protected readonly expNote = signal('');
  protected readonly expError = signal('');

  protected readonly q = signal('');
  protected readonly onlyRepeat = signal(false);
  protected readonly open = signal('');

  /** Orders loaded for the period, with the live ones from the Orders screen taking priority. */
  private readonly all = computed(() => {
    const m = new Map(this.loaded().map((o) => [o.id, o]));
    for (const o of this.store.orders()) m.set(o.id, o);
    return [...m.values()];
  });
  private readonly range = computed(() => periodRange(this.period()));
  private readonly fromDay = computed(() => istDay(this.range().from));
  private readonly toDay = computed(() => istDay(this.range().to - 1));

  protected readonly sum = computed(() => salesSummary(this.all(), this.range().from, this.range().to));
  protected readonly expTotal = computed(() => expenseTotal(this.expenses(), this.fromDay(), this.toDay()));
  protected readonly profit = computed(() => this.sum().sales - this.expTotal());
  protected readonly series = computed(() => salesByDay(this.all(), this.range().days));
  protected readonly maxSales = computed(() => Math.max(1, ...this.series().map((d) => d.sales)));
  protected readonly items = computed(() => topItems(this.all(), this.range().from, this.range().to));
  protected readonly hourOrders = computed(() => ordersByHour(this.all(), this.range().from, this.range().to));
  protected readonly maxHour = computed(() => Math.max(1, ...this.hourOrders()));
  protected readonly visits = computed(() => sumDaily(this.daily(), this.fromDay(), this.toDay()));

  private readonly monthRange = periodRange('month');
  protected readonly monthByCat = computed(() => expenseByCategory(this.expenses(), istDay(this.monthRange.from), istDay(this.monthRange.to - 1)));
  protected readonly monthExpenseTotal = computed(() => expenseTotal(this.expenses(), istDay(this.monthRange.from), istDay(this.monthRange.to - 1)));

  protected readonly rows = computed<CustomerRow[]>(() => {
    const stats = new Map(customerStats(this.all()).map((s) => [s.phone, s]));
    const rec = new Map(this.records().map((r) => [r.phone, r]));
    const out: CustomerRow[] = [];
    for (const phone of new Set([...stats.keys(), ...rec.keys()])) {
      const s = stats.get(phone);
      const r = rec.get(phone);
      out.push({
        phone,
        name: s?.name || r?.name || phone,
        orders: Math.max(s?.orders ?? 0, r?.orders ?? 0),
        spent: Math.max(s?.spent ?? 0, r?.spent ?? 0),
        lastAt: Math.max(s?.lastAt ?? 0, r?.lastAt ?? 0),
        favourite: s?.favourite ?? '',
        optIn: r?.optIn === true,
      });
    }
    return out.sort((a, b) => b.orders - a.orders || b.spent - a.spent);
  });
  protected readonly filtered = computed(() => {
    const q = this.q().trim().toLowerCase();
    return this.rows().filter((c) => (!this.onlyRepeat() || c.orders >= 2) && (!q || c.name.toLowerCase().includes(q) || c.phone.includes(q)));
  });
  protected readonly reviewed = computed(() => this.all().filter((o) => o.review).sort((a, b) => b.review!.at - a.review!.at));
  protected readonly rating = computed(() => ratingSummary(this.all()));
  /** Review docs on the customer menu: id -> shown? A review with no doc yet counts as shown (it is auto-published below). */
  private readonly revDocs = signal<Map<string, boolean> | null>(null);
  protected isPublic(id: string): boolean {
    return this.revDocs()?.get(id) !== false;
  }
  private readonly autoPublished = new Set<string>();
  private readonly autoPublish = effect(() => {
    const docs = this.revDocs();
    if (!docs) return;
    for (const o of this.reviewed()) {
      if (docs.has(o.id) || this.autoPublished.has(o.id)) continue;
      this.autoPublished.add(o.id);
      void this.backend.setReviewPublic(o, true).catch(() => this.autoPublished.delete(o.id));
    }
  });
  protected async togglePublic(o: Order): Promise<void> {
    await this.backend.setReviewPublic(o, !this.isPublic(o.id)).catch(() => undefined);
  }

  ngOnInit(): void {
    const off = this.backend.watchExpenses((l) => this.expenses.set(l));
    this.destroy.onDestroy(off);
    this.destroy.onDestroy(this.backend.watchReviews((l) => this.revDocs.set(new Map(l.map((r) => [r.id, r.public])))));
    void this.reload();
  }

  protected async reload(): Promise<void> {
    this.error.set('');
    try {
      const [orders, daily, records] = await Promise.all([
        this.backend.loadOrdersSince(Date.now() - 40 * DAY),
        this.backend.loadDaily(40).catch(() => [] as DailyStats[]),
        this.backend.loadCustomers().catch(() => [] as CustomerRecord[]),
      ]);
      this.loaded.set(orders);
      this.daily.set(daily);
      this.records.set(records);
    } catch {
      this.error.set('Could not load the books. Check your internet connection.');
    }
  }

  protected pct(n: number, of: number): number {
    return of > 0 ? Math.max(n > 0 ? 4 : 0, Math.round((n / of) * 100)) : 0;
  }
  protected date = (ms: number): string => (ms ? formatDateTime(ms) : '-');
  protected ordersOf = (phone: string): Order[] => this.all().filter((o) => o.customer?.phone === phone).sort((a, b) => b.createdAt - a.createdAt).slice(0, 10);
  protected summaryOf = (o: Order): string => o.lines.map((l) => `${l.qty}× ${l.name}`).join(', ').slice(0, 60);

  // ----- expenses -----
  protected async addExpense(): Promise<void> {
    const amount = Number(this.expAmount());
    if (!(amount > 0)) return this.expError.set('Enter the amount.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(this.expDay())) return this.expError.set('Pick the date.');
    this.expError.set('');
    try {
      await this.backend.saveExpense({
        id: crypto.randomUUID(),
        day: this.expDay(),
        category: this.expCat(),
        amount: Math.round(amount * 100) / 100,
        ...(this.expNote().trim() ? { note: this.expNote().trim() } : {}),
        at: Date.now(),
      });
      this.expAmount.set('');
      this.expNote.set('');
    } catch {
      this.expError.set('Could not save. Check your internet connection.');
    }
  }
  protected async delExpense(e: Expense): Promise<void> {
    await this.backend.deleteExpense(e.id).catch(() => this.expError.set('Could not delete. Check your internet connection.'));
  }

  // ----- closing summary (always today) -----
  protected readonly closing = signal(false);
  private readonly backClosing = closeOnBack(this.closing, () => this.closing.set(false));
  protected readonly today = computed(() => {
    const r = periodRange('today');
    const day = istDay(r.from);
    const sum = salesSummary(this.all(), r.from, r.to);
    const expenses = expenseTotal(this.expenses(), day, day);
    const mine = this.all().filter((o) => o.createdAt >= r.from && o.createdAt < r.to);
    return {
      day,
      sum,
      expenses,
      profit: sum.sales - expenses,
      rejected: mine.filter((o) => o.status === 'rejected' || o.status === 'cancelled' || o.status === 'expired').length,
      open: mine.filter((o) => o.status === 'pending' || o.status === 'accepted' || o.status === 'preparing' || o.status === 'out_for_delivery').length,
      items: topItems(this.all(), r.from, r.to),
      rows: expenseByCategory(this.expenses(), day, day),
    };
  });
  protected shareClosing(): void {
    const t = this.today();
    const text = [
      `Juicysukun Café · Closing summary ${t.day}`,
      `Sales: ${rs(t.sum.sales)} (${t.sum.orders} paid orders)`,
      `Cash ${rs(t.sum.byMethod.cash)} · UPI ${rs(t.sum.byMethod.upi)} · Card ${rs(t.sum.byMethod.card)}`,
      `Expenses: ${rs(t.expenses)}`,
      `Profit: ${rs(t.profit)}`,
      ...(t.sum.unpaid ? [`Not yet confirmed: ${rs(t.sum.unpaid)}`] : []),
      ...(t.open ? [`Still open: ${t.open} order(s)`] : []),
      ...(t.items.length ? [`Top: ${t.items.slice(0, 3).map((i) => `${i.name} ×${i.qty}`).join(', ')}`] : []),
    ].join('\n');
    window.open('https://wa.me/?text=' + encodeURIComponent(text), '_blank');
  }
  protected async pdfClosing(): Promise<void> {
    const t = this.today();
    this.busy.set(true);
    try {
      const pdf = await buildSummaryPdf({ title: `Closing summary, ${t.day}`, sales: t.sum, expenses: t.expenses, expenseRows: t.rows, items: t.items });
      this.notice.set((await sharePdf(pdf, `Juicysukun closing summary · ${t.day}`)) ?? '');
    } catch {
      this.error.set('Could not make the PDF.');
    } finally {
      this.busy.set(false);
    }
  }

  // ----- sharing -----
  private title(): string {
    const p = this.period();
    return p === 'today' ? `Today, ${this.fromDay()}` : `${p === 'week' ? 'Last 7 days' : 'Last 30 days'}: ${this.fromDay()} to ${this.toDay()}`;
  }
  protected shareText(): void {
    const s = this.sum();
    const text = [
      `Juicysukun Café · ${this.title()}`,
      `Sales: ${rs(s.sales)} (${s.orders} orders, avg ${rs(s.avg)})`,
      `Cash ${rs(s.byMethod.cash)} · UPI ${rs(s.byMethod.upi)} · Card ${rs(s.byMethod.card)}`,
      `Expenses: ${rs(this.expTotal())}`,
      `Profit: ${rs(this.profit())}`,
      ...(s.unpaid ? [`Not yet confirmed: ${rs(s.unpaid)}`] : []),
    ].join('\n');
    window.open('https://wa.me/?text=' + encodeURIComponent(text), '_blank');
  }
  protected async sharePdfSummary(): Promise<void> {
    this.busy.set(true);
    this.notice.set('');
    try {
      const pdf = await buildSummaryPdf({
        title: this.title(),
        sales: this.sum(),
        expenses: this.expTotal(),
        expenseRows: expenseByCategory(this.expenses(), this.fromDay(), this.toDay()),
        items: this.items(),
      });
      this.notice.set((await sharePdf(pdf, `Juicysukun summary · ${this.title()}`)) ?? '');
    } catch {
      this.error.set('Could not make the PDF.');
    } finally {
      this.busy.set(false);
    }
  }
  protected async exportCsv(): Promise<void> {
    const rows: (string | number)[][] = [['Name', 'Phone', 'Orders', 'Total spent', 'Last order', 'Favourite', 'Agreed to offers']];
    for (const c of this.rows()) rows.push([c.name, c.phone, c.orders, c.spent, c.lastAt ? istDay(c.lastAt) : '', c.favourite, c.optIn ? 'Yes' : 'No']);
    this.notice.set((await shareFile({ fileName: `Juicysukun-customers-${istDay(Date.now())}.csv`, content: toCsv(rows), mime: 'text/csv' }, 'Juicysukun customer list')) ?? '');
  }
  protected offerTo(c: CustomerRow): void {
    const text = `Hi ${c.name.split(' ')[0]}! 🍹 Special offer from Juicysukun Café. Visit us or order at https://juicy-sukun.web.app`;
    window.open(`https://wa.me/91${c.phone}?text=${encodeURIComponent(text)}`, '_blank');
  }
}

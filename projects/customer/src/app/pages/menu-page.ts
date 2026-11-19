import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { MAX_LINE_NOTE, formatINR, minPrice, type CartLine, type MenuItem } from '@juicy/shared';
import { closeOnBack } from '../core/back-close';
import { Cart, type CartRow } from '../core/cart';
import { Mode } from '../core/mode';
import { Store } from '../core/store';

export const CATEGORY_EMOJI: Record<string, string> = {
  Pizza: '🍕',
  Burgers: '🍔',
  Fries: '🍟',
  'Garlic Bread': '🥖',
  Pasta: '🍝',
  'JS Starters': '🍢',
  Drinks: '🥤',
  'Cold Drinks': '🧃',
  Extras: '➕',
};

export interface PriceBand {
  id: string;
  label: string;
  min: number;
  max: number;
}
export const PRICE_BANDS: PriceBand[] = [
  { id: 'all', label: 'Any price', min: 0, max: Infinity },
  { id: 'u100', label: 'Under ₹100', min: 0, max: 99 },
  { id: '100', label: '₹100–200', min: 100, max: 200 },
  { id: '200', label: '₹200–300', min: 201, max: 300 },
  { id: '300', label: '₹300+', min: 301, max: Infinity },
];

/** True when the owner added add-ons, options or a note to this item, so ADD opens the customise sheet. */
export function isCustomizable(item: MenuItem): boolean {
  return !!(item.addons?.length || item.options?.length || item.allowNote);
}

export interface Sheet {
  item: MenuItem;
  size: number;
  addons: number[];
  options: number[];
  note: string;
  qty: number;
}

/** Pure filter used by the page (and unit-tested). Searches name and category; price band uses the cheapest size. */
export type VegFilter = 'all' | 'veg' | 'nonveg';

export function filterMenu(menu: MenuItem[], query: string, category: string, band: PriceBand, veg: VegFilter = 'all'): MenuItem[] {
  const q = query.trim().toLowerCase();
  return menu.filter((m) => {
    if (category !== 'All' && m.category !== category) return false;
    if (veg === 'veg' && m.veg !== true) return false;
    if (veg === 'nonveg' && m.veg !== false) return false;
    const p = minPrice(m);
    if (p < band.min || p > band.max) return false;
    return !q || m.name.toLowerCase().includes(q) || m.category.toLowerCase().includes(q);
  });
}

@Component({
  selector: 'app-menu-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="hero">
      <h1>Hungry? Let's fix that.</h1>
      <p>Pizza, burgers, fries & fresh drinks — delivered in Akkalkot. Free delivery on orders ₹{{ store.config().freeDeliveryMin }}+.</p>
    </section>

    <div class="modebar" role="group" aria-label="Order type" data-testid="modebar">
      <button type="button" [class.on]="mode.dineIn()" (click)="mode.choose('dine_in')">🍽️ Dine-in</button>
      <button type="button" [class.on]="!mode.dineIn()" (click)="mode.choose('delivery')">🛵 Delivery</button>
      @if (mode.dineIn()) {
        <button type="button" class="tablechip" (click)="mode.editing.set(true)" data-testid="table-chip">Table {{ mode.table() || '?' }} ▾</button>
      }
    </div>

    @if (store.shopKnown() && !store.isOpen()) {
      <p class="banner shut" role="status" data-testid="closed-banner">
        😴 We're closed right now. You can browse and fill your cart — ordering opens when we do.
      </p>
    }

    @if (store.config().busyMode) {
      <p class="banner busy" role="status" data-testid="busy-banner">🔥 We're busy right now. Orders may take a little longer than usual.</p>
    }

    @if (banner(); as b) {
      <section class="banner-offer" data-testid="offer-banner">
        @if (b.imageUrl) { <img [src]="b.imageUrl" alt="" loading="lazy" /> }
        <div>
          <small>{{ b.sponsored ? 'Sponsored' : 'Offer' }}</small>
          <b>{{ b.title }}</b>
          @if (b.text) { <span>{{ b.text }}</span> }
          @if (b.link) { <a [href]="b.link" target="_blank" rel="noopener noreferrer">Know more →</a> }
        </div>
        <button type="button" class="clear" aria-label="Hide" (click)="hideBanner.set(true)">✕</button>
      </section>
    }

    <div class="searchbar">
      <input type="search" inputmode="search" enterkeyhint="search" placeholder="Search pizza, mojito, pasta…" aria-label="Search the menu"
        [value]="query()" (input)="query.set($any($event.target).value)" data-testid="search" />
      @if (query()) {
        <button type="button" class="clear" aria-label="Clear search" (click)="query.set('')">✕</button>
      }
    </div>

    <div class="chips" role="tablist" aria-label="Categories">
      @for (c of store.categories(); track c) {
        <button type="button" role="tab" [class.on]="!query().trim() && activeCat() === c" [attr.aria-selected]="!query().trim() && activeCat() === c" (click)="pickCategory(c)">
          {{ emoji(c) }} {{ c }}
        </button>
      }
    </div>
    <button type="button" class="link pricetoggle" (click)="showPrice.set(!showPrice())" [attr.aria-expanded]="showPrice()">
      ₹ Price filter {{ band().id !== 'all' ? '· ' + band().label : '' }} {{ showPrice() ? '▲' : '▼' }}
    </button>
    @if (showPrice() || band().id !== 'all') {
      <div class="chips sub" aria-label="Price">
        @for (b of bands; track b.id) {
          <button type="button" [class.on]="band().id === b.id" (click)="band.set(b)">{{ b.label }}</button>
        }
      </div>
    }

    @if (!store.menuLoaded()) {
      <div class="skeletons" aria-busy="true">
        @for (n of [1, 2, 3, 4]; track n) { <div class="skeleton"></div> }
      </div>
    } @else if (groups().length === 0) {
      <div class="empty" data-testid="no-results">
        <div class="big">🔍</div>
        <p>Nothing matches "{{ query() }}". Try another word or clear the filters.</p>
        <button type="button" class="btn" (click)="reset()">Clear filters</button>
      </div>
    }

    @for (g of groups(); track g.category) {
      <section class="group">
        <h2>{{ emoji(g.category) }} {{ g.category }}</h2>
        <div class="grid">
          @for (item of g.items; track item.id) {
            @let si = sizeOf(item);
            @let qty = cart.qty(item.id, si);
            <article class="card" [class.sold]="!item.available" [attr.data-testid]="'item-' + item.id">
              <div class="thumb">
                @if (item.imageUrl) {
                  <img [src]="item.imageUrl" [alt]="item.name" loading="lazy" width="96" height="96" />
                } @else {
                  <span aria-hidden="true">{{ emoji(item.category) }}</span>
                }
              </div>
              <div class="info">
                <h3>{{ item.name }} @if (item.special) { <span class="tag">★ Special</span> }</h3>
                @if (item.sizes.length > 1) {
                  <div class="sizes" role="group" [attr.aria-label]="item.name + ' size'">
                    @for (s of item.sizes; track $index) {
                      <button type="button" [class.on]="$index === si" (click)="pickSize(item.id, $index)">{{ s.label }}</button>
                    }
                  </div>
                }
                <div class="row">
                  <strong class="price">₹{{ item.sizes[si].price }}</strong>
                  @if (!item.available) {
                    <span class="soldout">Sold out</span>
                  } @else if (custom(item)) {
                    <div class="customwrap">
                      <button type="button" class="btn add" (click)="openSheet(item)" [attr.aria-label]="'Customise and add ' + item.name">ADD +</button>
                    </div>
                  } @else if (qty === 0) {
                    <button type="button" class="btn add" (click)="cart.add(item.id, si)" [attr.aria-label]="'Add ' + item.name">ADD</button>
                  } @else {
                    <div class="stepper">
                      <button type="button" (click)="cart.remove(item.id, si)" aria-label="Remove one">−</button>
                      <output>{{ qty }}</output>
                      <button type="button" (click)="cart.add(item.id, si)" aria-label="Add one more">+</button>
                    </div>
                  }
                </div>
                @if (variants().get(item.id); as vs) {
                  <ul class="variants" [attr.aria-label]="item.name + ' in your cart'" [attr.data-testid]="'variants-' + item.id">
                    @for (r of vs; track r.key) {
                      <li>
                        <span class="vname">✓ {{ vname(r) }}</span>
                        <span class="stepper sm">
                          <button type="button" (click)="cart.changeQty(r.key, -1)" aria-label="One less">−</button>
                          <output>{{ r.line.qty }}</output>
                          <button type="button" (click)="cart.changeQty(r.key, 1)" aria-label="One more">+</button>
                        </span>
                        <b class="vprice">₹{{ r.total }}</b>
                      </li>
                    }
                  </ul>
                }
              </div>
            </article>
          }
        </div>
      </section>
    }

    @if (sheet(); as sh) {
      <div class="overlay bottom" (click)="closeSheet()" (keydown.escape)="closeSheet()" role="presentation">
        <div class="dialog custom" role="dialog" aria-modal="true" aria-labelledby="cs-title" (click)="$event.stopPropagation()" data-testid="custom-sheet">
          <div class="sheethead">
            <h2 id="cs-title">{{ sh.item.name }}</h2>
            <button type="button" class="x" (click)="closeSheet()" aria-label="Close">✕</button>
          </div>

          @if (sh.item.sizes.length > 1) {
            <h3>Size</h3>
            <div class="opts">
              @for (s of sh.item.sizes; track $index) {
                <button type="button" class="opt" [class.on]="sh.size === $index" (click)="setSize($index)">
                  <span>{{ s.label }}</span><span>{{ fmt(s.price) }}</span>
                </button>
              }
            </div>
          }

          @if (sh.item.addons?.length) {
            <h3>Add-ons</h3>
            <div class="opts">
              @for (a of sh.item.addons; track $index) {
                <button type="button" class="opt" [class.on]="sh.addons.includes($index)" (click)="toggleAddon($index)" role="checkbox" [attr.aria-checked]="sh.addons.includes($index)">
                  <span>{{ sh.addons.includes($index) ? '✔' : '＋' }} {{ a.label }}</span><span>{{ a.price > 0 ? '+' + fmt(a.price) : 'Free' }}</span>
                </button>
              }
            </div>
          }

          @if (sh.item.options?.length) {
            <h3>Choices</h3>
            <div class="opts">
              @for (o of sh.item.options; track $index) {
                <button type="button" class="opt" [class.on]="sh.options.includes($index)" (click)="toggleOption($index)" role="checkbox" [attr.aria-checked]="sh.options.includes($index)">
                  <span>{{ sh.options.includes($index) ? '✔' : '○' }} {{ o }}</span>
                </button>
              }
            </div>
          }

          @if (sh.item.allowNote) {
            <label class="notefield">Note for this item <small>(optional)</small>
              <input [attr.maxlength]="noteMax" placeholder="Less spicy, no onion…" [value]="sh.note" (input)="setNote($any($event.target).value)" />
            </label>
          }

          <div class="sheetfoot">
            <div class="stepper">
              <button type="button" (click)="bump(-1)" aria-label="One less">−</button>
              <output>{{ sh.qty }}</output>
              <button type="button" (click)="bump(1)" aria-label="One more">+</button>
            </div>
            <button type="button" class="btn primary grow" (click)="confirm()" data-testid="custom-add">Add to cart · {{ fmt(sheetTotal()) }}</button>
          </div>
          <button type="button" class="link" (click)="closeSheet()">Cancel</button>
        </div>
      </div>
    }

    @if (toast(); as t) {
      <div class="toast" role="status" data-testid="toast">{{ t }}</div>
    }

    @if (store.reviews().length) {
      <section class="says" id="reviews" aria-label="What customers say" data-testid="reviews-strip">
        <div class="sayshead">
          <h2>What customers say</h2>
          <span class="avg" data-testid="reviews-avg">⭐ {{ store.rating().average }} · {{ store.rating().count }} review{{ store.rating().count === 1 ? '' : 's' }}</span>
        </div>
        <div class="says-row">
          @for (r of store.reviews().slice(0, 10); track r.id) {
            <figure class="say">
              <div class="stars" [attr.aria-label]="r.rating + ' out of 5 stars'">{{ '★'.repeat(r.rating) }}<span class="off">{{ '★'.repeat(5 - r.rating) }}</span></div>
              @if (r.comment) { <blockquote>“{{ r.comment }}”</blockquote> }
              <figcaption>{{ r.name }}</figcaption>
            </figure>
          }
        </div>
        <button type="button" class="btn seeall" (click)="allReviews.set(true)" data-testid="see-all-reviews">See all {{ store.rating().count }} review{{ store.rating().count === 1 ? '' : 's' }} ›</button>
      </section>
    }

    @if (allReviews()) {
      <div class="overlay bottom" (click)="allReviews.set(false)" role="presentation">
        <div class="dialog custom revdrawer" role="dialog" aria-modal="true" aria-labelledby="rv-title" (click)="$event.stopPropagation()" data-testid="reviews-drawer">
          <div class="sheethead">
            <h2 id="rv-title">⭐ {{ store.rating().average }} · {{ store.rating().count }} reviews</h2>
            <button type="button" class="x" (click)="allReviews.set(false)" aria-label="Close">✕</button>
          </div>
          <div class="chips sub" role="tablist" aria-label="Filter reviews">
            @for (f of revFilters; track f.id) {
              <button type="button" role="tab" [class.on]="revFilter() === f.id" [attr.aria-selected]="revFilter() === f.id" (click)="revFilter.set(f.id)" [attr.data-testid]="'rf-' + f.id">{{ f.label }}</button>
            }
          </div>
          <div class="revlist">
            @for (r of shownReviews(); track r.id) {
              <figure class="say wide">
                <div class="stars">{{ '★'.repeat(r.rating) }}<span class="off">{{ '★'.repeat(5 - r.rating) }}</span></div>
                @if (r.comment) { <blockquote>“{{ r.comment }}”</blockquote> }
                <figcaption>{{ r.name }} · {{ when(r.at) }}</figcaption>
              </figure>
            } @empty {
              <p class="muted center">No reviews in this group yet.</p>
            }
          </div>
        </div>
      </div>
    }

    <footer class="foot">Cash on delivery · Delivery within Akkalkot · ₹{{ store.config().deliveryFee }} delivery under ₹{{ store.config().freeDeliveryMin }}</footer>
  `,
})
export class MenuPage {
  protected readonly store = inject(Store);
  protected readonly cart = inject(Cart);
  protected readonly mode = inject(Mode);
  protected readonly bands = PRICE_BANDS;
  protected readonly query = signal('');
  protected readonly hideBanner = signal(false);
  protected readonly allReviews = signal(false);
  protected readonly revFilter = signal<'all' | '5' | '4' | 'low'>('all');
  protected readonly revFilters = [
    { id: 'all' as const, label: 'All' },
    { id: '5' as const, label: '5★' },
    { id: '4' as const, label: '4★' },
    { id: 'low' as const, label: '3★ & below' },
  ];
  protected readonly shownReviews = computed(() => {
    const f = this.revFilter();
    return [...this.store.reviews()]
      .sort((a, b) => b.at - a.at)
      .filter((r) => f === 'all' || (f === '5' ? r.rating === 5 : f === '4' ? r.rating === 4 : r.rating <= 3));
  });
  private readonly revBack = closeOnBack(this.allReviews, () => this.allReviews.set(false));
  protected when(at: number): string {
    return new Date(at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  }
  private readonly bannerIdx = signal(0);
  protected readonly banner = computed(() => {
    const list = this.store.offers();
    return this.hideBanner() || !list.length ? null : list[this.bannerIdx() % list.length]!;
  });
  private readonly destroyRef = inject(DestroyRef);

  constructor() {
    const t = setInterval(() => this.bannerIdx.update((n) => n + 1), 6000);
    this.destroyRef.onDestroy(() => clearInterval(t));
  }
  protected readonly category = signal('');
  /** The category being shown: the one picked, else the first one. While searching, the whole menu is searched. */
  protected readonly activeCat = computed(() => {
    const cats = this.store.categories();
    const c = this.category();
    return cats.includes(c) ? c : (cats[0] ?? 'All');
  });
  protected pickCategory(c: string): void {
    this.query.set('');
    this.category.set(c);
  }
  protected readonly band = signal<PriceBand>(PRICE_BANDS[0]);
  private readonly sizePick = signal<Record<string, number>>({});

  protected readonly groups = computed(() => {
    const items = filterMenu(this.store.menu(), this.query(), this.query().trim() ? 'All' : this.activeCat(), this.band());
    return this.store
      .categories()
      .map((category) => ({ category, items: items.filter((i) => i.category === category) }))
      .filter((g) => g.items.length);
  });

  protected readonly sheet = signal<Sheet | null>(null);
  protected readonly showPrice = signal(false);
  protected readonly toast = signal('');
  private toastTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly backCloses = closeOnBack(computed(() => this.sheet() !== null), () => this.sheet.set(null));
  protected readonly noteMax = MAX_LINE_NOTE;
  protected readonly sheetTotal = computed(() => {
    const sh = this.sheet();
    if (!sh) return 0;
    const extra = sh.addons.reduce((n, i) => n + (sh.item.addons?.[i]?.price ?? 0), 0);
    return (sh.item.sizes[sh.size].price + extra) * sh.qty;
  });

  /** Customised lines already in the cart, grouped by item, so the menu shows exactly what was added and its price. */
  protected readonly variants = computed(() => {
    const m = new Map<string, CartRow[]>();
    for (const r of this.cart.rows()) {
      if (!isCustomizable(r.item)) continue;
      m.set(r.item.id, [...(m.get(r.item.id) ?? []), r]);
    }
    return m;
  });
  protected vname(r: CartRow): string {
    const size = r.item.sizes.length > 1 ? r.size.label : '';
    return [size, r.extras].filter(Boolean).join(' · ') || 'Plain';
  }
  protected custom(item: MenuItem): boolean {
    return isCustomizable(item);
  }
  protected fmt(n: number): string {
    return formatINR(n);
  }
  protected openSheet(item: MenuItem): void {
    this.sheet.set({ item, size: this.sizeOf(item), addons: [], options: [], note: '', qty: 1 });
  }
  protected closeSheet(): void {
    this.sheet.set(null);
  }
  protected setSize(i: number): void {
    this.sheet.update((s) => (s ? { ...s, size: i } : s));
  }
  private toggled(list: number[], i: number): number[] {
    return list.includes(i) ? list.filter((x) => x !== i) : [...list, i];
  }
  protected toggleAddon(i: number): void {
    this.sheet.update((s) => (s ? { ...s, addons: this.toggled(s.addons, i) } : s));
  }
  protected toggleOption(i: number): void {
    this.sheet.update((s) => (s ? { ...s, options: this.toggled(s.options, i) } : s));
  }
  protected setNote(v: string): void {
    this.sheet.update((s) => (s ? { ...s, note: v } : s));
  }
  protected bump(d: number): void {
    const max = this.store.config().maxQtyPerLine;
    this.sheet.update((s) => (s ? { ...s, qty: Math.max(1, Math.min(max, s.qty + d)) } : s));
  }
  protected confirm(): void {
    const s = this.sheet();
    if (!s) return;
    const line: CartLine = { itemId: s.item.id, sizeIndex: s.size, qty: s.qty };
    if (s.addons.length) line.addons = [...s.addons].sort((a, b) => a - b);
    if (s.options.length) line.options = [...s.options].sort((a, b) => a - b);
    const note = s.note.trim();
    if (note && s.item.allowNote) line.note = note;
    this.cart.addLine(line);
    this.sheet.set(null);
    this.toast.set(`Added ✓ ${s.qty} × ${s.item.name}`);
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.toast.set(''), 2200);
  }

  protected emoji(c: string): string {
    return CATEGORY_EMOJI[c] ?? '🍽️';
  }
  protected sizeOf(item: MenuItem): number {
    const i = this.sizePick()[item.id] ?? 0;
    return i < item.sizes.length ? i : 0;
  }
  protected pickSize(id: string, i: number): void {
    this.sizePick.update((p) => ({ ...p, [id]: i }));
  }
  protected reset(): void {
    this.query.set('');
    this.category.set('');
    this.band.set(PRICE_BANDS[0]);
  }
}

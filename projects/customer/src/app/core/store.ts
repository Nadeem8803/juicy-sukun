import { Injectable, OnDestroy, computed, inject, signal } from '@angular/core';
import { CATEGORIES, DEFAULT_PUBLIC_CONFIG, type MenuItem, type Offer, type PublicConfig, type ShopStatus, type PublicReview } from '@juicy/shared';
import { BACKEND } from './backend';

/** Live menu, shop status (open/closed) and delivery settings. */
@Injectable({ providedIn: 'root' })
export class Store implements OnDestroy {
  private readonly backend = inject(BACKEND);
  readonly menu = signal<MenuItem[]>([]);
  readonly menuLoaded = signal(false);
  readonly shop = signal<ShopStatus | null>(null);
  readonly config = signal<PublicConfig>(DEFAULT_PUBLIC_CONFIG);
  private readonly allOffers = signal<Offer[]>([]);
  readonly reviews = signal<PublicReview[]>([]);
  /** Average stars and count of the reviews customers can see. */
  readonly rating = computed(() => {
    const l = this.reviews();
    return { count: l.length, average: l.length ? Math.round((l.reduce((a, r) => a + r.rating, 0) / l.length) * 10) / 10 : 0 };
  });
  private readonly clock = signal(Date.now());
  /** Offers that are switched on and inside their dates right now. */
  readonly offers = computed(() => {
    const now = this.clock();
    return this.allOffers().filter((o) => o.active && o.start <= now && o.end >= now);
  });
  /** Shown from the Place-order button and from a "shop closed" reply from the server. */
  readonly closedPopup = signal(false);

  /** Closed until we hear otherwise: never let someone believe the cafe is open when we don't know. */
  readonly isOpen = computed(() => this.shop()?.open === true);
  readonly shopKnown = computed(() => this.shop() !== null);

  readonly categories = computed(() => {
    const present = new Set(this.menu().map((m) => m.category));
    const known = CATEGORIES.filter((c) => present.has(c));
    const extra = [...present].filter((c) => !(CATEGORIES as readonly string[]).includes(c)).sort();
    return [...known, ...extra];
  });

  private readonly offs: (() => void)[] = [];

  constructor() {
    this.offs.push(
      this.backend.watchMenu((m) => {
        this.menu.set(m);
        this.menuLoaded.set(true);
      }),
      this.backend.watchShop((s) => this.shop.set(s)),
      this.backend.watchConfig((c) => this.config.set(c)),
      this.backend.watchReviews((r) => this.reviews.set(r)),
      this.backend.watchOffers((o) => {
        this.allOffers.set(o);
        this.clock.set(Date.now());
      }),
    );
  }

  item(id: string): MenuItem | undefined {
    return this.menu().find((m) => m.id === id);
  }

  ngOnDestroy(): void {
    this.offs.forEach((o) => o());
  }
}

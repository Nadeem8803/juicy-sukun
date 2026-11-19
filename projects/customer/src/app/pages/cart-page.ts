import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { DomainError, MAX_LINE_NOTE, USER_MESSAGES, deliveryArea, formatINR, normalizePhone, type GeoPoint, type MenuItem } from '@juicy/shared';
import { Cart } from '../core/cart';
import { Mode } from '../core/mode';
import { Orders } from '../core/orders';
import { Store } from '../core/store';
import { Track } from '../core/track';

export interface FormErrors {
  name?: string;
  phone?: string;
  address?: string;
}

/** Friendly client-side checks. The server re-validates everything. */
export function validateForm(f: { name: string; phone: string; address: string }, dineIn = false): FormErrors {
  const e: FormErrors = {};
  if (f.name.trim().length < 2) e.name = 'Please enter your name';
  if (!normalizePhone(f.phone)) e.phone = 'Enter a 10-digit mobile number';
  if (dineIn) return e;
  if (f.address.trim().length < 8) e.address = 'Add your full delivery address (house/shop, area)';
  return e;
}

@Component({
  selector: 'app-cart-page',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (busy()) {
      <div class="sending" role="alert" aria-live="assertive" data-testid="sending">
        <span class="spin big" aria-hidden="true"></span>
        <h2>Sending your order…</h2>
        <p>Please hold on while we send your order to the cafe. Don't close the app or press back.</p>
      </div>
    }
    <h1 class="page-title">Your cart</h1>

    @if (cart.rows().length === 0) {
      <div class="empty" data-testid="empty-cart">
        <div class="big">🛒</div>
        <p>Your cart is empty.</p>
        <a routerLink="/" class="btn primary">Browse the menu</a>
      </div>
    } @else {
      @if (cart.unavailable().length) {
        <p class="banner warn" role="alert">
          {{ cart.unavailable().length }} item(s) just sold out.
          <button type="button" class="link" (click)="cart.pruneUnavailable()">Remove them</button>
        </p>
      }

      <ul class="lines">
        @for (r of cart.rows(); track r.key) {
          <li [class.sold]="!r.item.available">
            <div>
              <b>{{ r.name }}</b>
              @if (r.extras) { <small class="extras">{{ r.extras }}</small> }
              <small>₹{{ r.unit }} each</small>
            </div>
            <div class="stepper">
              <button type="button" (click)="cart.changeQty(r.key, -1)" [attr.aria-label]="'Remove one ' + r.name">−</button>
              <output>{{ r.line.qty }}</output>
              <button type="button" (click)="cart.changeQty(r.key, 1)" [attr.aria-label]="'Add one more ' + r.name">+</button>
            </div>
            <strong>₹{{ r.total }}</strong>
            @if (custom(r.item)) {
              <button type="button" class="link editbtn" (click)="toggleEdit(r.key)" [attr.aria-expanded]="editing() === r.key" [attr.data-testid]="'edit-' + r.key">
                {{ editing() === r.key ? 'Done ▲' : 'Customise ▼' }}
              </button>
            }
            @if (editing() === r.key) {
              <div class="inline-edit">
                @if (r.item.sizes.length > 1) {
                  <h3>Size</h3>
                  <div class="opts">
                    @for (s of r.item.sizes; track $index) {
                      <button type="button" class="opt" [class.on]="r.line.sizeIndex === $index" (click)="edit(r.key, { sizeIndex: $index })">
                        <span>{{ s.label }}</span><span>{{ fmt(s.price) }}</span>
                      </button>
                    }
                  </div>
                }
                @if (r.item.addons?.length) {
                  <h3>Add-ons</h3>
                  <div class="opts">
                    @for (a of r.item.addons; track $index) {
                      <button type="button" class="opt" [class.on]="(r.line.addons ?? []).includes($index)" (click)="edit(r.key, { addons: toggled(r.line.addons, $index) })" role="checkbox" [attr.aria-checked]="(r.line.addons ?? []).includes($index)">
                        <span>{{ (r.line.addons ?? []).includes($index) ? '✔' : '＋' }} {{ a.label }}</span><span>{{ a.price > 0 ? '+' + fmt(a.price) : 'Free' }}</span>
                      </button>
                    }
                  </div>
                }
                @if (r.item.options?.length) {
                  <h3>Choices</h3>
                  <div class="opts">
                    @for (o of r.item.options; track $index) {
                      <button type="button" class="opt" [class.on]="(r.line.options ?? []).includes($index)" (click)="edit(r.key, { options: toggled(r.line.options, $index) })" role="checkbox" [attr.aria-checked]="(r.line.options ?? []).includes($index)">
                        <span>{{ (r.line.options ?? []).includes($index) ? '✔' : '○' }} {{ o }}</span>
                      </button>
                    }
                  </div>
                }
                @if (r.item.allowNote) {
                  <label class="notefield">Note for this item <small>(optional)</small>
                    <input [attr.maxlength]="noteMax" placeholder="Less spicy, no onion…" [value]="r.line.note ?? ''" (change)="edit(r.key, { note: $any($event.target).value })" />
                  </label>
                }
              </div>
            }
          </li>
        }
      </ul>

      <section class="bill" aria-label="Bill">
        <div><span>Items</span><span data-testid="subtotal">₹{{ cart.totals().subtotal }}</span></div>
        @if (!mode.dineIn()) {
          <div>
            <span>Delivery</span>
            <span data-testid="delivery">{{ cart.totals().deliveryFee === 0 ? 'FREE' : '₹' + cart.totals().deliveryFee }}</span>
          </div>
        }
        @if (discount() > 0) {
          <div class="disc" data-testid="loyalty-line"><span>🎁 Regular customer {{ loyalty().percent }}% off</span><span>−₹{{ discount() }}</span></div>
        }
        <div class="grand"><span>{{ mode.dineIn() ? 'To pay at the counter' : 'To pay (cash on delivery)' }}</span><span data-testid="total">₹{{ payable() }}</span></div>
        @if (loyaltyHint()) { <p class="nudge" data-testid="loyalty-hint">{{ loyaltyHint() }}</p> }
        @if (mode.dineIn()) {
          <p class="nudge ok">🍽️ Dine-in · Table {{ mode.table() }} <button type="button" class="link" (click)="mode.editing.set(true)">Change</button></p>
          <a routerLink="/" class="link">+ Add more items</a>
        } @else if (cart.toFreeDelivery() > 0) {
          <p class="nudge" data-testid="nudge">Add ₹{{ cart.toFreeDelivery() }} more to get <b>free delivery</b>.</p>
          <a routerLink="/" class="link">+ Add more items</a>
        } @else {
          <p class="nudge ok">🎉 You've unlocked free delivery!</p>
        }
      </section>

      <form class="details" (submit)="$event.preventDefault(); submit()" novalidate>
        <h2>{{ mode.dineIn() ? 'Your details' : 'Delivery details' }}</h2>
        <label>Your name
          <input name="name" autocomplete="name" [value]="form().name" (input)="set('name', $event)" [attr.aria-invalid]="!!shown().name" data-testid="f-name" />
          @if (shown().name) { <em class="err">{{ shown().name }}</em> }
        </label>
        <label>Mobile number
          <input name="phone" type="tel" inputmode="numeric" autocomplete="tel-national" maxlength="14" placeholder="10-digit number"
            [value]="form().phone" (input)="set('phone', $event)" [attr.aria-invalid]="!!shown().phone" data-testid="f-phone" />
          @if (shown().phone) { <em class="err">{{ shown().phone }}</em> }
        </label>
        @if (!mode.dineIn()) {
        <label>Delivery address
          <textarea name="address" rows="3" autocomplete="street-address" placeholder="House / shop no., street, area"
            [value]="form().address" (input)="set('address', $event)" [attr.aria-invalid]="!!shown().address" data-testid="f-address"></textarea>
          @if (shown().address) { <em class="err">{{ shown().address }}</em> }
        </label>
        <label>Landmark <small>(optional)</small>
          <input name="landmark" [value]="form().landmark" (input)="set('landmark', $event)" data-testid="f-landmark" />
        </label>
        }
        <label>Note for the kitchen <small>(optional)</small>
          <input name="note" maxlength="200" placeholder="Less spicy, no onion…" [value]="note()" (input)="note.set($any($event.target).value)" />
        </label>

        @if (!mode.dineIn()) {
        <div class="loc">
          <button type="button" class="btn" (click)="locate()" [disabled]="locating()" data-testid="share-location">
            {{ locating() ? 'Finding you…' : location() ? '📍 Location added — update' : '📍 Share my exact location' }}
          </button>
          @if (area(); as a) {
            @if (a.limited) {
              <small [class.err]="a.km !== null && !a.ok" data-testid="area-msg">
                @if (a.km === null) { We deliver within {{ a.maxKm }} km of the cafe. Please share your location so we can check. }
                @else if (a.ok) { ✔ About {{ a.km }} km away: inside our delivery area. }
                @else { ✖ About {{ a.km }} km away. Sorry, we deliver only within {{ a.maxKm }} km. }
              </small>
            }
          } @else {
            <small>{{ locMsg() || 'Helps the rider find you faster. Optional.' }}</small>
          }
          @if (area()?.limited && locMsg()) { <small>{{ locMsg() }}</small> }
        </div>
        }

        <label class="check optin"><input type="checkbox" [checked]="optIn()" (change)="optIn.set($any($event.target).checked)" data-testid="f-optin" /> Send me offers on WhatsApp <small>(optional)</small></label>

        @if (error()) { <p class="banner shut" role="alert" data-testid="form-error">{{ error() }}</p> }

        <button type="submit" class="btn primary big-btn" [disabled]="busy()" data-testid="place-order">
          @if (busy()) { <span class="spin" aria-hidden="true"></span> }
          {{ busy() ? 'Sending to the cafe…' : 'Place order · ₹' + payable() }}
        </button>
        <p class="fine">The cafe confirms your order first. You'll see their phone number and invoice as soon as they accept.</p>
        <p class="fine" data-testid="consent">By placing the order you agree that the cafe keeps your name, number and order history to serve you and give loyalty discounts. <a routerLink="/privacy">Privacy</a></p>
      </form>
    }
  `,
})
export class CartPage {
  protected readonly cart = inject(Cart);
  protected readonly store = inject(Store);
  protected readonly mode = inject(Mode);
  private readonly orders = inject(Orders);
  private readonly router = inject(Router);
  private readonly track = inject(Track);
  protected readonly optIn = signal(false);
  protected readonly loyalty = signal<{ percent: number; orders: number }>({ percent: 0, orders: 0 });
  /** Discount in rupees (same rounding as the server). */
  protected readonly discount = computed(() => {
    const sub = this.cart.totals().subtotal;
    const pct = this.loyalty().percent;
    return pct ? Math.min(sub, Math.round((sub * pct) / 100)) : 0;
  });
  protected readonly payable = computed(() => this.cart.totals().total - this.discount());
  protected readonly loyaltyHint = computed(() => {
    const c = this.store.config();
    if (!c.loyaltyEnabled || this.loyalty().percent > 0) return '';
    const left = c.loyaltyAfter - this.loyalty().orders;
    return this.loyalty().orders > 0 && left > 0 ? `🎁 ${left} more order${left > 1 ? 's' : ''} and you get ${c.loyaltyPercent}% off.` : '';
  });

  protected readonly form = signal({ ...this.orders.profile() });
  protected readonly note = signal('');
  protected readonly location = signal<GeoPoint | null>(null);
  protected readonly locating = signal(false);
  protected readonly locMsg = signal('');
  /** Distance rule for a delivery order (null for dine-in or when the owner set no limit). */
  protected readonly area = computed(() => {
    if (this.mode.dineIn()) return null;
    const a = deliveryArea(this.store.config(), this.location());
    return a.limited ? a : null;
  });
  protected readonly busy = signal(false);
  protected readonly editing = signal<string | null>(null);
  protected readonly noteMax = MAX_LINE_NOTE;
  protected fmt = formatINR;
  protected custom(i: MenuItem): boolean {
    return i.sizes.length > 1 || !!i.addons?.length || !!i.options?.length || !!i.allowNote;
  }
  protected toggleEdit(key: string): void {
    this.editing.update((k) => (k === key ? null : key));
  }
  protected toggled(list: number[] | undefined, i: number): number[] {
    const l = list ?? [];
    return l.includes(i) ? l.filter((x) => x !== i) : [...l, i];
  }
  /** Apply a change straight away so the price updates live. */
  protected edit(key: string, patch: Parameters<Cart['editLine']>[1]): void {
    const nk = this.cart.editLine(key, patch);
    this.editing.set(nk);
  }
  protected readonly error = signal('');
  private lastLooked = '';
  private readonly lookup = effect(() => {
    const phone = normalizePhone(this.form().phone);
    const on = this.store.config().loyaltyEnabled;
    untracked(() => {
      if (!on || !phone || phone === this.lastLooked) return;
      this.lastLooked = phone;
      void this.orders.loyalty(phone).then((r) => this.loyalty.set(r));
    });
  });
  private readonly tried = signal(false);

  protected readonly errors = computed(() => validateForm(this.form(), this.mode.dineIn()));
  /** Only nag after the first attempt to submit. */
  protected readonly shown = computed<FormErrors>(() => (this.tried() ? this.errors() : {}));

  protected set(field: 'name' | 'phone' | 'address' | 'landmark', ev: Event): void {
    this.form.update((f) => ({ ...f, [field]: (ev.target as HTMLInputElement).value }));
  }

  protected locate(): void {
    if (!('geolocation' in navigator)) {
      this.locMsg.set("Your browser can't share location — just type the address.");
      return;
    }
    this.locating.set(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        this.location.set({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: Math.round(pos.coords.accuracy) });
        this.locMsg.set('Location added ✔');
        this.locating.set(false);
      },
      () => {
        this.locMsg.set(this.area() ? 'Could not get your location. Please allow location access for this site, then try again.' : 'Could not get your location. No problem — your address is enough.');
        this.locating.set(false);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
    );
  }

  protected async submit(): Promise<void> {
    this.error.set('');
    // Closed? Tell them nicely before anything else (the server enforces this too).
    if (this.store.shopKnown() && !this.store.isOpen()) {
      this.store.closedPopup.set(true);
      return;
    }
    if (this.mode.dineIn() && !this.mode.table()) {
      this.mode.editing.set(true);
      return;
    }
    this.tried.set(true);
    this.track.event('checkout');
    if (Object.keys(this.errors()).length) {
      this.error.set('Please fix the highlighted details.');
      return;
    }
    if (this.cart.unavailable().length || this.cart.hasMissing()) {
      this.error.set('Some items are no longer available. Remove them to continue.');
      return;
    }
    const area = this.area();
    if (area && area.km === null) {
      this.error.set(`We deliver within ${area.maxKm} km. Please share your location so we can check.`);
      return;
    }
    if (area && !area.ok) {
      this.error.set(`Sorry, we deliver only within ${area.maxKm} km. You are about ${area.km} km away.`);
      return;
    }
    const f = this.form();
    const dine = this.mode.dineIn();
    const phone = (normalizePhone(f.phone) ?? '') as string;
    this.busy.set(true);
    try {
      this.orders.saveProfile({ ...f, phone });
      const res = dine
        ? await this.orders.place({ name: f.name.trim(), phone, address: '' }, null, this.note().trim(), { table: this.mode.table() }, this.optIn())
        : await this.orders.place(
            { name: f.name.trim(), phone, address: f.address.trim(), ...(f.landmark.trim() ? { landmark: f.landmark.trim() } : {}) },
            this.location(),
            this.note().trim(),
            undefined,
            this.optIn(),
          );
      this.track.event('ordered');
      await this.router.navigate(['/order', res.orderId], { replaceUrl: true });
    } catch (e) {
      if (e instanceof DomainError && e.code === 'shop_closed') this.store.closedPopup.set(true);
      else if (e instanceof DomainError) this.error.set(e.code === 'too_far' ? e.message : (USER_MESSAGES[e.code] ?? e.message));
      else this.error.set("Couldn't reach the cafe. Check your internet and try again.");
    } finally {
      this.busy.set(false);
    }
  }
}

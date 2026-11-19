import { ChangeDetectionStrategy, Component, HostListener, computed, inject, signal } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { Cart } from './core/cart';
import { Orders } from './core/orders';
import { Store } from './core/store';
import { ClosedDialog } from './ui/closed-dialog';
import { ModeDialog } from './ui/mode-dialog';
import { Mode } from './core/mode';
import { Track } from './core/track';

interface InstallEvent extends Event {
  prompt(): Promise<void>;
}

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, ClosedDialog, ModeDialog],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="top">
      <a routerLink="/" class="brand" aria-label="Juicysukun Café home">Juicy<span>sukun</span></a>
      <span class="pill" [class.open]="store.isOpen()" [class.shut]="store.shopKnown() && !store.isOpen()" data-testid="shop-pill" role="status">
        <i></i>{{ !store.shopKnown() ? 'Checking…' : store.isOpen() ? 'Open now' : 'Closed' }}
      </span>
      @if (store.rating().count > 0 && onMenu()) {
        <button type="button" class="ratechip" (click)="toReviews()" data-testid="rating-chip" [attr.aria-label]="'Rated ' + store.rating().average + ' out of 5 by ' + store.rating().count + ' customers. See reviews'">
          ⭐ {{ store.rating().average }} · {{ store.rating().count }}
        </button>
      }
      <nav>
        @if (installEvent()) {
          <button type="button" class="link" (click)="install()">Install app</button>
        }
        <a routerLink="/orders" routerLinkActive="on">My orders@if (orders.activeCount() > 0) { <span class="navcount" data-testid="orders-badge" aria-label="active orders">{{ orders.activeCount() }}</span> }</a>
      </nav>
    </header>

    @if (offline()) {
      <p class="banner warn" role="alert">You're offline. You can still look at the menu, but orders need internet.</p>
    }

    <main><router-outlet /></main>
    <footer class="credit">
      <span>Juicysukun Café · Good Food. Good Mood. · <a routerLink="/privacy">Privacy</a></span>
      <a href="https://zyntratech.web.app" target="_blank" rel="noopener">Website by <b>ZyntraTech</b> · zyntratech.web.app</a>
    </footer>

    @if (cart.count() > 0 && !onCart()) {
      <a routerLink="/cart" class="cartbar" data-testid="cart-bar">
        <span>
          <b>{{ cart.count() }} item{{ cart.count() > 1 ? 's' : '' }}</b> · {{ inr(cart.totals().subtotal) }}
          <small>
            {{ mode.dineIn() ? 'Dine-in · Table ' + mode.table() : cart.toFreeDelivery() > 0 ? 'Add ' + inr(cart.toFreeDelivery()) + ' more for free delivery' : 'Free delivery 🎉' }}
          </small>
        </span>
        <strong>View cart →</strong>
      </a>
    }

    <app-closed-dialog />
    <app-mode-dialog />

    @if (leaving()) {
      <div class="overlay" (click)="stay()" role="presentation">
        <div class="dialog" role="alertdialog" aria-modal="true" aria-labelledby="lv-title" (click)="$event.stopPropagation()" data-testid="leave-dialog">
          <div class="big">👋</div>
          <h2 id="lv-title">Leave Juicysukun?</h2>
          <p>Your cart is saved. Do you want to close the app?</p>
          <button type="button" class="btn primary" (click)="stay()">Stay</button>
          <button type="button" class="btn" (click)="leave()" data-testid="leave-confirm">Leave</button>
        </div>
      </div>
    }
  `,
})
export class App {
  protected readonly store = inject(Store);
  protected readonly cart = inject(Cart);
  protected readonly orders = inject(Orders);
  protected readonly mode = inject(Mode);
  protected readonly installEvent = signal<InstallEvent | null>(null);
  protected readonly offline = signal(typeof navigator !== 'undefined' && !navigator.onLine);
  private readonly track = inject(Track);
  private readonly router = inject(Router);
  private readonly url = signal(this.router.url);
  protected readonly onCart = computed(() => this.url().startsWith('/cart') || this.url().startsWith('/order'));
  protected readonly onMenu = computed(() => this.url().split('?')[0] === '/');
  protected readonly leaving = signal(false);
  private armed = false;

  constructor() {
    this.track.start(this.mode.dineIn() ? this.mode.table() : '');
    this.router.events.subscribe((e) => {
      if (e instanceof NavigationEnd) {
        this.url.set(e.urlAfterRedirects);
        const path = e.urlAfterRedirects.split('?')[0]!;
        this.track.event(path === '/' ? 'menu' : path.startsWith('/cart') ? 'cart' : path.startsWith('/order/') ? 'order' : path.slice(1, 12) || 'menu');
        // First screen of this visit: mark it as the "base" and put one guard entry on top, so
        // pressing Back on the first screen asks before leaving instead of closing the app.
        if (!this.armed) {
          this.armed = true;
          history.replaceState({ ...(history.state ?? {}), base: true }, '');
          history.pushState({ guard: true }, '');
        }
      }
    });
  }

  @HostListener('window:popstate')
  protected onPop(): void {
    if (this.armed && history.state?.base) {
      history.pushState({ guard: true }, ''); // stay on the page
      this.leaving.set(true);
    }
  }

  protected toReviews(): void {
    document.getElementById('reviews')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  protected stay(): void {
    this.leaving.set(false);
  }
  protected leave(): void {
    this.armed = false;
    this.leaving.set(false);
    history.go(-2); // past the guard and the base entry = out of the app
  }

  protected inr = (n: number) => '₹' + n.toLocaleString('en-IN');

  @HostListener('window:beforeinstallprompt', ['$event'])
  protected onInstallPrompt(e: Event): void {
    e.preventDefault();
    this.installEvent.set(e as InstallEvent);
  }
  @HostListener('window:appinstalled') protected onInstalled(): void {
    this.installEvent.set(null);
  }
  @HostListener('window:offline') protected goOffline(): void {
    this.offline.set(true);
  }
  @HostListener('window:online') protected goOnline(): void {
    this.offline.set(false);
  }

  protected async install(): Promise<void> {
    const e = this.installEvent();
    if (!e) return;
    await e.prompt();
    this.installEvent.set(null);
  }
}

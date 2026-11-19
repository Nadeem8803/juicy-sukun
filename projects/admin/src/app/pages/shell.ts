import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AlarmService } from '../core/alarm';
import { OrdersStore } from '../core/orders-store';
import { Push } from '../core/push';
import { Shop } from '../core/shop';

/** Header with the Online/Offline switch, bottom tabs, and the "ringing" banner. */
@Component({
  selector: 'app-shell',
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="top">
      <span class="brand">Juicy<span>sukun</span></span>
      <button type="button" class="switch" [class.on]="shop.open()" role="switch" [attr.aria-checked]="shop.open()" [disabled]="shop.busy() || shop.status() === null"
        (click)="toggle()" data-testid="shop-toggle">
        <i></i><b>{{ shop.open() ? 'ONLINE' : 'OFFLINE' }}</b>
      </button>
    </header>

    @if (alarm.needsUnlock() && orders.pending().length) {
      <button type="button" class="banner alarm" (click)="alarm.unlock()" data-testid="unlock-sound">🔇 Tap here to turn the order sound on</button>
    }
    @if (orders.error()) { <p class="banner warn" role="alert">{{ orders.error() }}</p> }
    @if (confirmOffline()) {
      <div class="overlay" role="presentation">
        <div class="dialog" role="alertdialog" aria-modal="true" aria-labelledby="off-title">
          <h2 id="off-title">Go offline?</h2>
          <p>Customers will see "Closed" and won't be able to order.@if (orders.pending().length) { <br /><b>{{ orders.pending().length }} order(s) are still waiting.</b> }</p>
          <div class="actions">
            <button type="button" class="btn" (click)="confirmOffline.set(false)">Stay online</button>
            <button type="button" class="btn danger" (click)="goOffline()" data-testid="confirm-offline">Go offline</button>
          </div>
        </div>
      </div>
    }

    <main><router-outlet /></main>

    <nav class="tabs" aria-label="Main">
      <a routerLink="/orders" routerLinkActive="on">🔔 Orders @if (orders.pending().length) { <span class="count" data-testid="pending-count">{{ orders.pending().length }}</span> }</a>
      <a routerLink="/menu" routerLinkActive="on">🍕 Menu</a>
      <a routerLink="/books" routerLinkActive="on" data-testid="tab-books">📊 Books</a>
      <a routerLink="/settings" routerLinkActive="on">⚙️ Settings</a>
    </nav>
  `,
})
export class Shell {
  protected readonly shop = inject(Shop);
  protected readonly orders = inject(OrdersStore);
  protected readonly alarm = inject(AlarmService);
  protected readonly confirmOffline = signal(false);

  constructor() {
    this.shop.watch();
    inject(Push); // starts push registration
  }

  protected toggle(): void {
    if (this.shop.open()) this.confirmOffline.set(true);
    else void this.shop.set(true);
  }
  protected async goOffline(): Promise<void> {
    this.confirmOffline.set(false);
    await this.shop.set(false);
  }
}

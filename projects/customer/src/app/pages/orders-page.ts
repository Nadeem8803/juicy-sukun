import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { STATUS_LABEL, isTerminal, type OrderStatus } from '@juicy/shared';
import { Orders } from '../core/orders';

@Component({
  selector: 'app-orders-page',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1 class="page-title">My orders</h1>
    @if (orders.myOrderIds().length === 0) {
      <div class="empty">
        <div class="big">🧾</div>
        <p>No orders yet on this phone.</p>
        <a routerLink="/" class="btn primary">Order something tasty</a>
      </div>
    } @else {
      <ul class="lines orders">
        @for (o of orders.myOrderIds(); track o.id) {
          <li>
            <a [routerLink]="['/order', o.id]">
              <b>{{ o.number }}</b>
              @if (status(o.id); as s) {
                <span class="obadge" [class.live]="!done(s)" [attr.data-status]="s" [attr.data-testid]="'badge-' + o.number">{{ !done(s) ? 'Active · ' : '' }}{{ label(s) }}</span>
              }
              <small>{{ date(o.at) }}</small>
            </a>
            <span class="link">View →</span>
          </li>
        }
      </ul>
    }
  `,
})
export class OrdersPage {
  protected readonly orders = inject(Orders);
  protected status(id: string): OrderStatus | undefined {
    return this.orders.statuses()[id];
  }
  protected done = isTerminal;
  protected label(s: OrderStatus): string {
    return STATUS_LABEL[s];
  }
  protected date(ms: number): string {
    return new Date(ms).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
  }
}

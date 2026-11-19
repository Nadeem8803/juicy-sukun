import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { closeOnBack } from '../core/back-close';
import { Store } from '../core/store';

/** The "we are offline right now" popup shown when someone tries to place an order while the cafe is closed. */
@Component({
  selector: 'app-closed-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (store.closedPopup()) {
      <div class="overlay" (click)="close()" (keydown.escape)="close()" role="presentation">
        <div class="dialog" role="alertdialog" aria-modal="true" aria-labelledby="cd-title" data-testid="closed-dialog" (click)="$event.stopPropagation()" tabindex="-1">
          <div class="big">😴</div>
          <h2 id="cd-title">We're offline right now</h2>
          <p>{{ store.shop()?.message || "Juicysukun Café isn't taking orders at the moment. Your cart is saved — come back when we're open and place it in one tap." }}</p>
          <button type="button" class="btn primary" (click)="close()" autofocus>Okay, got it</button>
        </div>
      </div>
    }
  `,
})
export class ClosedDialog {
  protected readonly store = inject(Store);
  private readonly backCloses = closeOnBack(computed(() => this.store.closedPopup()), () => this.store.closedPopup.set(false));
  protected close(): void {
    this.store.closedPopup.set(false);
  }
}

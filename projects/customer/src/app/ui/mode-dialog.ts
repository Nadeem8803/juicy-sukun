import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Mode } from '../core/mode';

/** "Dine-in or Delivery?" popup shown when the app opens (and again from the home-screen toggle). */
@Component({
  selector: 'app-mode-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (!mode.confirmed() || mode.editing()) {
      <div class="overlay" role="presentation">
        <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="md-title" data-testid="mode-dialog">
          <h2 id="md-title">How would you like to order?</h2>
          <div class="modeopts">
            <button type="button" [class.on]="mode.dineIn()" (click)="mode.choose('dine_in')" data-testid="mode-dine">
              <span class="big">🍽️</span><b>Dine-in</b><small>Eat at the cafe</small>
            </button>
            <button type="button" [class.on]="!mode.dineIn()" (click)="mode.choose('delivery')" data-testid="mode-delivery">
              <span class="big">🛵</span><b>Delivery</b><small>To your address</small>
            </button>
          </div>
          @if (mode.dineIn()) {
            <h3>Your table number</h3>
            <div class="tablegrid" role="group" aria-label="Table number">
              @for (t of mode.tables(); track t) {
                <button type="button" [class.on]="mode.table() === t" (click)="mode.setTable(t)" [attr.data-testid]="'table-' + t">{{ t }}</button>
              }
            </div>
          }
          <button type="button" class="btn primary" [disabled]="mode.dineIn() && !mode.table()" (click)="mode.confirm()" data-testid="mode-continue">
            {{ mode.dineIn() ? (mode.table() ? 'Continue · Table ' + mode.table() : 'Pick your table') : 'Continue with delivery' }}
          </button>
        </div>
      </div>
    }
  `,
})
export class ModeDialog {
  protected readonly mode = inject(Mode);
}

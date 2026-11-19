import { ChangeDetectionStrategy, Component, input, output, signal } from '@angular/core';

export const QUICK_REASONS = ['Item out of stock', 'Too busy right now', 'Kitchen is closing', 'Cannot deliver to this address', 'Customer unreachable'];

/** Asks the owner to pick or type a reason (at least 3 characters) before rejecting / cancelling. */
@Component({
  selector: 'app-reason-sheet',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="overlay sheet" (click)="cancelled.emit()" role="presentation">
      <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="rs-title" (click)="$event.stopPropagation()">
        <h2 id="rs-title">{{ title() }}</h2>
        <p>The customer will see this reason.</p>
        <div class="chips">
          @for (r of reasons; track r) {
            <button type="button" [class.on]="text() === r" (click)="text.set(r)">{{ r }}</button>
          }
        </div>
        <textarea rows="2" placeholder="Or type your own reason…" maxlength="150" [value]="text()" (input)="text.set($any($event.target).value)" data-testid="reason"></textarea>
        <div class="actions">
          <button type="button" class="btn" (click)="cancelled.emit()">Back</button>
          <button type="button" class="btn danger solid" [disabled]="text().trim().length < 3" (click)="confirmed.emit(text().trim())" data-testid="reason-confirm">
            {{ confirmLabel() }}
          </button>
        </div>
      </div>
    </div>
  `,
})
export class ReasonSheet {
  readonly title = input('Reject this order?');
  readonly confirmLabel = input('Reject order');
  readonly confirmed = output<string>();
  readonly cancelled = output<void>();
  protected readonly reasons = QUICK_REASONS;
  protected readonly text = signal('');
}

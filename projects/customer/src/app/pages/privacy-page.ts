import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Store } from '../core/store';

@Component({
  selector: 'app-privacy-page',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1 class="page-title">Privacy</h1>
    <section class="summary" data-testid="privacy">
      <h2>What {{ store.config().cafeName || 'Juicysukun Café' }} keeps</h2>
      <ul class="plain">
        <li><b>Your orders</b>: what you ordered, your name, mobile number and (for delivery) your address, so we can make and deliver it.</li>
        <li><b>A regular-customer record</b>: how many orders you have placed, so we can give loyalty discounts.</li>
        <li><b>Reviews</b>: when you rate an order, your first name, stars and comment are shown on our menu (never your number). The owner can hide any review.</li>
        <li><b>How the app is used</b>: which pages are opened and whether a visit reached the cart or an order. This uses a random id on your phone, not your name or number.</li>
        <li><b>Offers on WhatsApp</b>: only if you tick the box at checkout. Leave it unticked and we will not message you offers.</li>
      </ul>
      <h2>Who sees it</h2>
      <ul class="plain">
        <li>It is stored in the cafe's own account and used only to run the cafe and improve the menu and offers.</li>
        <li>We do not sell it or give it to anyone. Sponsors, if any, are shown only totals such as "how many people visited", never names or numbers.</li>
      </ul>
      <h2>Your choices</h2>
      <ul class="plain">
        <li>To have your details removed, call or message the cafe.</li>
        <li>Detailed visit records are archived and cleared every week.</li>
      </ul>
      <a routerLink="/" class="btn primary">← Back to menu</a>
    </section>
  `,
})
export class PrivacyPage {
  protected readonly store = inject(Store);
}

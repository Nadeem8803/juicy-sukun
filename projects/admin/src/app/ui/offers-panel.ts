import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import type { Offer } from '@juicy/shared';
import { BACKEND } from '../core/backend';
import { compressImage } from '../core/image';

const DAY = 86_400_000;
const dayInput = (ms: number) => new Date(ms + 5.5 * 3600_000).toISOString().slice(0, 10);
const startOf = (d: string) => new Date(d + 'T00:00:00+05:30').getTime();
const endOf = (d: string) => new Date(d + 'T23:59:59+05:30').getTime();

interface Draft {
  id: string | null;
  title: string;
  text: string;
  link: string;
  sponsored: boolean;
  from: string;
  to: string;
  imageUrl: string | null;
}

const blank = (): Draft => ({ id: null, title: '', text: '', link: '', sponsored: false, from: dayInput(Date.now()), to: dayInput(Date.now() + 7 * DAY), imageUrl: null });

/** Owner's "Offers & banners": own promos or local sponsors. Customers see them on the menu page and after an order. */
@Component({
  selector: 'app-offers-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="panel" data-testid="offers">
      <h2>Offers &amp; banners</h2>
      <p class="muted">Shown to customers on the menu and after they receive an order. Never on the cart or payment screens.</p>
      @for (o of offers(); track o.id) {
        <div class="offerrow">
          @if (o.imageUrl) { <img [src]="o.imageUrl" alt="" width="56" height="56" loading="lazy" /> } @else { <span class="thumb">🎁</span> }
          <div>
            <b>{{ o.title }}</b>@if (o.sponsored) { <span class="tag">Sponsored</span> }
            <small class="muted">{{ range(o) }} · {{ status(o) }}</small>
          </div>
          <div class="acts">
            <button type="button" class="mini" (click)="toggle(o)">{{ o.active ? 'Pause' : 'Turn on' }}</button>
            <button type="button" class="mini" (click)="edit(o)">Edit</button>
            <button type="button" class="mini" (click)="remove(o)">Delete</button>
          </div>
        </div>
      }
      @if (offers().length === 0 && !d()) { <p class="muted">No banners yet.</p> }

      @if (d(); as x) {
        <div class="offerform">
          <label>Title <input maxlength="80" [value]="x.title" (input)="patch({ title: $any($event.target).value })" placeholder="e.g. Mango Shake ₹99 this week" data-testid="offer-title" /></label>
          <label>Short text (optional) <input maxlength="200" [value]="x.text" (input)="patch({ text: $any($event.target).value })" /></label>
          <label>Link (optional) <input maxlength="300" inputmode="url" [value]="x.link" (input)="patch({ link: $any($event.target).value })" placeholder="https://…" /></label>
          <div class="two">
            <label>From <input type="date" [value]="x.from" (input)="patch({ from: $any($event.target).value })" /></label>
            <label>Until <input type="date" [value]="x.to" (input)="patch({ to: $any($event.target).value })" /></label>
          </div>
          <div class="thumbrow">
            @if (x.imageUrl) { <img [src]="x.imageUrl" alt="" width="72" height="72" /> }
            <label class="btn">{{ uploading() ? 'Uploading…' : x.imageUrl ? 'Change image' : 'Add image' }}
              <input type="file" accept="image/*" hidden (change)="pick($event)" [disabled]="uploading()" /></label>
          </div>
          <label class="check"><input type="checkbox" [checked]="x.sponsored" (change)="patch({ sponsored: $any($event.target).checked })" /> This is a paid / local sponsor banner (shows a "Sponsored" label)</label>
          @if (err()) { <p class="err" role="alert">{{ err() }}</p> }
          <div class="actions">
            <button type="button" class="btn" (click)="d.set(null)">Cancel</button>
            <button type="button" class="btn primary" [disabled]="busy()" (click)="save()" data-testid="offer-save">{{ busy() ? 'Saving…' : 'Save banner' }}</button>
          </div>
        </div>
      } @else {
        <button type="button" class="btn" (click)="d.set(blank())" data-testid="offer-add">➕ Add a banner</button>
      }
    </section>
  `,
})
export class OffersPanel {
  private readonly backend = inject(BACKEND);
  protected readonly offers = signal<Offer[]>([]);
  protected readonly d = signal<Draft | null>(null);
  protected readonly err = signal('');
  protected readonly busy = signal(false);
  protected readonly uploading = signal(false);
  protected readonly blank = blank;

  constructor() {
    const off = this.backend.watchOffers((l) => this.offers.set(l));
    inject(DestroyRef).onDestroy(off);
  }

  protected range(o: Offer): string {
    return `${dayInput(o.start)} → ${dayInput(o.end)}`;
  }
  protected status(o: Offer): string {
    const now = Date.now();
    return !o.active ? 'paused' : now < o.start ? 'scheduled' : now > o.end ? 'ended' : 'showing now';
  }
  protected patch(p: Partial<Draft>): void {
    this.d.update((x) => (x ? { ...x, ...p } : x));
  }
  protected edit(o: Offer): void {
    this.err.set('');
    this.d.set({ id: o.id, title: o.title, text: o.text ?? '', link: o.link ?? '', sponsored: o.sponsored === true, from: dayInput(o.start), to: dayInput(o.end), imageUrl: o.imageUrl ?? null });
  }
  protected async toggle(o: Offer): Promise<void> {
    await this.backend.saveOffer({ ...o, active: !o.active }).catch(() => this.err.set('Could not save. Check your internet connection.'));
  }
  protected async remove(o: Offer): Promise<void> {
    await this.backend.deleteOffer(o.id).catch(() => this.err.set('Could not delete. Check your internet connection.'));
  }
  protected async pick(ev: Event): Promise<void> {
    const file = (ev.target as HTMLInputElement).files?.[0];
    if (!file) return;
    this.uploading.set(true);
    try {
      this.patch({ imageUrl: await this.backend.uploadImage('offer', await compressImage(file, 1000)) });
    } catch {
      this.err.set('Could not upload the image. Check your internet connection.');
    } finally {
      this.uploading.set(false);
    }
  }
  protected async save(): Promise<void> {
    const x = this.d();
    if (!x) return;
    const link = x.link.trim();
    if (!x.title.trim()) return this.err.set('Add a title.');
    if (link && !/^https?:\/\//i.test(link)) return this.err.set('The link must start with http:// or https://');
    if (!x.from || !x.to || endOf(x.to) < startOf(x.from)) return this.err.set('Check the dates.');
    this.err.set('');
    this.busy.set(true);
    try {
      const prev = this.offers().find((o) => o.id === x.id);
      await this.backend.saveOffer({
        id: x.id ?? crypto.randomUUID(),
        title: x.title.trim(),
        ...(x.text.trim() ? { text: x.text.trim() } : {}),
        ...(link ? { link } : {}),
        ...(x.sponsored ? { sponsored: true } : {}),
        imageUrl: x.imageUrl,
        start: startOf(x.from),
        end: endOf(x.to),
        active: prev?.active ?? true,
        sort: prev?.sort ?? Date.now(),
      });
      this.d.set(null);
    } catch {
      this.err.set('Could not save. Check your internet connection.');
    } finally {
      this.busy.set(false);
    }
  }
}

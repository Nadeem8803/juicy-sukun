import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { CATEGORIES, COLD_DRINK_STARTERS, MAX_ADDONS, MAX_OPTIONS, MAX_SIZES, minPrice, slugify, type MenuItem, type SizeOption } from '@juicy/shared';
import { closeOnBack } from '../core/back-close';
import { BACKEND } from '../core/backend';
import { compressImage } from '../core/image';

export interface SizeDraft {
  label: string;
  price: string;
}

export interface ItemDraft {
  id: string | null;
  name: string;
  category: string;
  /** One entry = a single-size item (no size name). Several entries = the customer picks a size. */
  sizes: SizeDraft[];
  addons: SizeDraft[];
  options: string[];
  allowNote: boolean;
  /** 'veg' | 'nonveg' | '' (not marked) */
  veg: string;
  special: boolean;
  available: boolean;
  imageUrl: string | null;
  sort: number;
}

export function emptyDraft(category = 'Pizza'): ItemDraft {
  return { id: null, name: '', category, sizes: [{ label: '', price: '' }], addons: [], options: [], allowNote: false, veg: '', special: false, available: true, imageUrl: null, sort: 0 };
}

export function draftFrom(m: MenuItem): ItemDraft {
  return {
    id: m.id,
    name: m.name,
    category: m.category,
    sizes: m.sizes.map((s) => ({ label: s.label, price: String(s.price) })),
    addons: (m.addons ?? []).map((a) => ({ label: a.label, price: String(a.price) })),
    options: [...(m.options ?? [])],
    allowNote: !!m.allowNote,
    veg: m.veg === true ? 'veg' : m.veg === false ? 'nonveg' : '',
    special: !!m.special,
    available: m.available,
    imageUrl: m.imageUrl ?? null,
    sort: m.sort,
  };
}

/** Returns an error message, or null when the draft can be saved. */
export function validateDraft(d: ItemDraft): string | null {
  if (d.name.trim().length < 2) return 'Enter the item name.';
  if (!d.category.trim()) return 'Pick a category.';
  if (d.sizes.length < 1) return 'Add at least one price.';
  for (const s of d.sizes) {
    const p = Number(s.price);
    if (!Number.isFinite(p) || p <= 0) return 'Enter a price greater than ₹0 for every size.';
    if (d.sizes.length > 1 && !s.label.trim()) return 'Give every size a name (e.g. Small, Medium, Large).';
  }
  for (const a of d.addons) {
    const p = Number(a.price);
    if (!a.label.trim()) return 'Give every add-on a name, or remove the empty one.';
    if (a.price.trim() === '' || !Number.isFinite(p) || p < 0) return 'Enter the extra price for every add-on (0 if free).';
  }
  for (const o of d.options) if (!o.trim()) return 'Fill in every choice, or remove the empty one.';
  return null;
}

export function draftToItem(d: ItemDraft, id: string, sort: number): MenuItem {
  const multi = d.sizes.length > 1;
  const sizes: SizeOption[] = d.sizes.map((s) => ({ label: multi ? s.label.trim() : '', price: Math.round(Number(s.price)) }));
  const addons: SizeOption[] = d.addons.map((a) => ({ label: a.label.trim(), price: Math.round(Number(a.price)) }));
  const options = d.options.map((o) => o.trim()).filter(Boolean);
  return {
    id,
    name: d.name.trim(),
    category: d.category.trim(),
    sizes,
    ...(addons.length ? { addons } : {}),
    ...(options.length ? { options } : {}),
    ...(d.allowNote ? { allowNote: true } : {}),
    veg: true, // pure-veg cafe
    available: d.available,
    special: d.special,
    imageUrl: d.imageUrl,
    sort,
  };
}

/** Picks an id that is not taken yet: pizza-veg-delight, pizza-veg-delight-2, … */
export function uniqueId(category: string, name: string, taken: Set<string>): string {
  const base = `${slugify(category)}-${slugify(name)}` || 'item';
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
  return id;
}

@Component({
  selector: 'app-menu-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="mbar">
      <input type="search" placeholder="Search menu…" [value]="q()" (input)="q.set($any($event.target).value)" aria-label="Search menu" data-testid="menu-search" />
      <button type="button" class="btn primary" (click)="add()" data-testid="add-item">+ Add item</button>
    </div>
    @if (message()) { <p class="banner ok" role="status">{{ message() }}</p> }
    @if (!hasColdDrinks()) {
      <div class="banner" data-testid="cold-drinks-card">
        🥤 Add Cold Drinks &amp; Water (Sprite, Coke, Monster, Red Bull, Predator, bottled water)?
        <button type="button" class="btn sm" (click)="addColdDrinks()" data-testid="add-cold-drinks">Add them</button>
        <small class="muted">They are added as sold out with typical prices. Check the price, add a photo, then switch each one on.</small>
      </div>
    }

    @for (g of groups(); track g.category) {
      <h2 class="cat">{{ g.category }}</h2>
      @for (m of g.items; track m.id) {
        <div class="row" [class.off]="!m.available" [attr.data-testid]="'row-' + m.id">
          <div class="thumb">@if (m.imageUrl) { <img [src]="m.imageUrl" alt="" width="48" height="48" loading="lazy" /> } @else { 🍽️ }</div>
          <button type="button" class="info" (click)="edit(m)" [attr.aria-label]="'Edit ' + m.name">
            <b>{{ m.name }}</b>
            <small>{{ priceText(m) }}@if (m.special) { · ★ special }</small>
          </button>
          <button type="button" class="switch sm" [class.on]="m.available" role="switch" [attr.aria-checked]="m.available" [attr.aria-label]="m.name + ' available'"
            (click)="toggle(m)" [attr.data-testid]="'avail-' + m.id"><i></i><b>{{ m.available ? 'In stock' : 'Sold out' }}</b></button>
        </div>
      }
    } @empty { <p class="muted center">No items match.</p> }

    @if (draft(); as d) {
      <div class="overlay sheet" role="presentation">
        <form class="dialog editor" role="dialog" aria-modal="true" aria-labelledby="ed-title" (submit)="$event.preventDefault(); save()">
          <h2 id="ed-title">{{ d.id ? 'Edit item' : 'New item' }}</h2>

          <div class="photo">
            <div class="thumb lg">@if (d.imageUrl) { <img [src]="d.imageUrl" alt="" width="72" height="72" /> } @else { 🍽️ }</div>
            <label class="btn">{{ uploading() ? 'Uploading…' : d.imageUrl ? 'Change photo' : 'Add photo' }}
              <input type="file" accept="image/*" hidden (change)="pick($event)" [disabled]="uploading()" data-testid="photo" />
            </label>
            @if (d.imageUrl) { <button type="button" class="link" (click)="patch({ imageUrl: null })">Remove</button> }
          </div>
          @if (photoError()) { <p class="err" role="alert" data-testid="photo-error">{{ photoError() }}</p> }

          <label>Name <input [value]="d.name" (input)="patch({ name: $any($event.target).value })" data-testid="ed-name" maxlength="80" /></label>
          <label>Category
            <select [value]="d.category" (change)="patch({ category: $any($event.target).value })" data-testid="ed-category">
              @for (c of categoryOptions(d); track c) { <option [value]="c" [selected]="c === d.category">{{ c }}</option> }
            </select>
          </label>

          <h3 class="sec">Sizes &amp; price</h3>
          <p class="hint">One price = a single-size item. Add more rows for Small / Medium / Large.</p>
          @for (z of d.sizes; track $index) {
            <div class="rowline" [class.single]="d.sizes.length === 1">
              @if (d.sizes.length > 1) { <input placeholder="Size name" [value]="z.label" (input)="setSize($index, 'label', $any($event.target).value)" maxlength="20" [attr.aria-label]="'Size ' + ($index + 1) + ' name'" /> }
              <input type="number" inputmode="numeric" min="1" placeholder="Price ₹" [value]="z.price" (input)="setSize($index, 'price', $any($event.target).value)" [attr.data-testid]="'ed-price' + ($index + 1)" [attr.aria-label]="'Size ' + ($index + 1) + ' price'" />
              @if (d.sizes.length > 1) { <button type="button" class="x" (click)="removeSize($index)" aria-label="Remove size">✕</button> }
            </div>
          }
          @if (d.sizes.length < maxSizes) { <button type="button" class="btn sm" (click)="addSize()" data-testid="add-size">+ Add another size</button> }

          <h3 class="sec">Add-ons <small>(optional extras the customer can tick)</small></h3>
          @for (a of d.addons; track $index) {
            <div class="rowline">
              <input placeholder="e.g. Extra cheese" [value]="a.label" (input)="setAddon($index, 'label', $any($event.target).value)" maxlength="30" [attr.aria-label]="'Add-on ' + ($index + 1) + ' name'" />
              <input type="number" inputmode="numeric" min="0" placeholder="+ ₹" [value]="a.price" (input)="setAddon($index, 'price', $any($event.target).value)" [attr.aria-label]="'Add-on ' + ($index + 1) + ' price'" />
              <button type="button" class="x" (click)="removeAddon($index)" aria-label="Remove add-on">✕</button>
            </div>
          }
          @if (d.addons.length < maxAddons) { <button type="button" class="btn sm" (click)="addAddon()" data-testid="add-addon">+ Add an add-on</button> }

          <h3 class="sec">Choices <small>(optional, no price — e.g. Less sugar, No ice)</small></h3>
          @for (o of d.options; track $index) {
            <div class="rowline one">
              <input placeholder="e.g. Less sugar" [value]="o" (input)="setOption($index, $any($event.target).value)" maxlength="30" [attr.aria-label]="'Choice ' + ($index + 1)" />
              <button type="button" class="x" (click)="removeOption($index)" aria-label="Remove choice">✕</button>
            </div>
          }
          @if (d.options.length < maxOptions) { <button type="button" class="btn sm" (click)="addOption()" data-testid="add-option">+ Add a choice</button> }

          <label class="check"><input type="checkbox" [checked]="d.allowNote" (change)="patch({ allowNote: $any($event.target).checked })" /> Let the customer type a note for this item</label>

          <label class="check"><input type="checkbox" [checked]="d.special" (change)="patch({ special: $any($event.target).checked })" /> Mark as ★ special</label>
          <label class="check"><input type="checkbox" [checked]="d.available" (change)="patch({ available: $any($event.target).checked })" /> Available to order</label>

          @if (formError()) { <p class="err" role="alert">{{ formError() }}</p> }
          <div class="actions">
            @if (d.id) { <button type="button" class="btn danger" (click)="remove(d)" data-testid="delete-item">{{ confirmDelete() ? 'Tap again to delete' : 'Delete' }}</button> }
            <button type="button" class="btn" (click)="close()">Cancel</button>
            <button type="submit" class="btn primary" [disabled]="busy() || uploading()" data-testid="save-item">{{ busy() ? 'Saving…' : 'Save' }}</button>
          </div>
        </form>
      </div>
    }
  `,
})
export class MenuPage {
  private readonly backend = inject(BACKEND);
  protected readonly menu = signal<MenuItem[]>([]);
  protected readonly q = signal('');
  protected readonly draft = signal<ItemDraft | null>(null);
  private readonly backCloses = closeOnBack(computed(() => this.draft() !== null), () => this.draft.set(null));
  protected readonly busy = signal(false);
  protected readonly uploading = signal(false);
  protected readonly photoError = signal('');
  protected readonly formError = signal('');
  protected readonly message = signal('');
  protected readonly confirmDelete = signal(false);

  protected readonly groups = computed(() => {
    const q = this.q().trim().toLowerCase();
    const items = this.menu().filter((m) => !q || m.name.toLowerCase().includes(q) || m.category.toLowerCase().includes(q));
    const cats = [...new Set([...(CATEGORIES as readonly string[]), ...this.menu().map((m) => m.category)])];
    return cats.map((category) => ({ category, items: items.filter((m) => m.category === category) })).filter((g) => g.items.length);
  });

  protected readonly hasColdDrinks = computed(() => this.menu().some((m) => m.category === 'Cold Drinks'));

  protected async addColdDrinks(): Promise<void> {
    const taken = new Set(this.menu().map((m) => m.id));
    let sort = Math.max(0, ...this.menu().map((m) => m.sort)) + 1;
    await this.guard(async () => {
      for (const d of COLD_DRINK_STARTERS) {
        const id = uniqueId(d.category, d.name, taken);
        taken.add(id);
        await this.backend.saveItem({ ...d, id, sort: sort++ });
      }
    }, 'Cold drinks added (sold out). Set prices and photos, then switch them on.');
  }

  constructor() {
    const off = this.backend.watchMenu((m) => this.menu.set(m));
    inject(DestroyRef).onDestroy(off);
  }

  protected readonly maxSizes = MAX_SIZES;
  protected readonly maxAddons = MAX_ADDONS;
  protected readonly maxOptions = MAX_OPTIONS;

  protected priceText(m: MenuItem): string {
    const base = m.sizes.length > 1 ? m.sizes.map((s) => `${s.label} ₹${s.price}`).join(' · ') : `₹${minPrice(m)}`;
    const extras = [m.addons?.length ? `${m.addons.length} add-on${m.addons.length > 1 ? 's' : ''}` : '', m.options?.length ? `${m.options.length} choice${m.options.length > 1 ? 's' : ''}` : '', m.allowNote ? 'note' : ''].filter(Boolean);
    return extras.length ? `${base} · ${extras.join(', ')}` : base;
  }

  protected addSize(): void {
    this.draft.update((d) => (d ? { ...d, sizes: [...d.sizes, { label: '', price: '' }] } : d));
  }
  protected setSize(i: number, f: 'label' | 'price', v: string): void {
    this.draft.update((d) => (d ? { ...d, sizes: d.sizes.map((s, n) => (n === i ? { ...s, [f]: v } : s)) } : d));
  }
  protected removeSize(i: number): void {
    this.draft.update((d) => (d ? { ...d, sizes: d.sizes.filter((_, n) => n !== i) } : d));
  }
  protected addAddon(): void {
    this.draft.update((d) => (d ? { ...d, addons: [...d.addons, { label: '', price: '' }] } : d));
  }
  protected setAddon(i: number, f: 'label' | 'price', v: string): void {
    this.draft.update((d) => (d ? { ...d, addons: d.addons.map((a, n) => (n === i ? { ...a, [f]: v } : a)) } : d));
  }
  protected removeAddon(i: number): void {
    this.draft.update((d) => (d ? { ...d, addons: d.addons.filter((_, n) => n !== i) } : d));
  }
  protected addOption(): void {
    this.draft.update((d) => (d ? { ...d, options: [...d.options, ''] } : d));
  }
  protected setOption(i: number, v: string): void {
    this.draft.update((d) => (d ? { ...d, options: d.options.map((o, n) => (n === i ? v : o)) } : d));
  }
  protected removeOption(i: number): void {
    this.draft.update((d) => (d ? { ...d, options: d.options.filter((_, n) => n !== i) } : d));
  }
  protected categoryOptions(d: ItemDraft): string[] {
    return (CATEGORIES as readonly string[]).includes(d.category) ? [...CATEGORIES] : [...CATEGORIES, d.category];
  }
  protected add(): void {
    this.reset();
    this.draft.set(emptyDraft());
  }
  protected edit(m: MenuItem): void {
    this.reset();
    this.draft.set(draftFrom(m));
  }
  protected close(): void {
    this.draft.set(null);
  }
  protected patch(p: Partial<ItemDraft>): void {
    this.draft.update((d) => (d ? { ...d, ...p } : d));
  }
  private reset(): void {
    this.formError.set('');
    this.confirmDelete.set(false);
  }

  protected async toggle(m: MenuItem): Promise<void> {
    await this.guard(() => this.backend.saveItem({ ...m, available: !m.available }), `${m.name} marked ${m.available ? 'sold out' : 'in stock'}.`);
  }

  protected async pick(ev: Event): Promise<void> {
    const file = (ev.target as HTMLInputElement).files?.[0];
    const d = this.draft();
    if (!file || !d) return;
    this.uploading.set(true);
    this.formError.set('');
    this.photoError.set('');
    try {
      const blob = await compressImage(file);
      const id = d.id ?? uniqueId(d.category, d.name || 'item', new Set(this.menu().map((m) => m.id)));
      this.patch({ imageUrl: await this.backend.uploadImage(id, blob) });
    } catch (e) {
      const why = e instanceof Error ? e.message : String(e);
      this.photoError.set(`Photo upload failed (${why}). Try a different photo.`);
    } finally {
      this.uploading.set(false);
      (ev.target as HTMLInputElement).value = ''; // lets the same photo be chosen again
    }
  }

  protected async save(): Promise<void> {
    const d = this.draft();
    if (!d) return;
    const err = validateDraft(d);
    if (err) return this.formError.set(err);
    const taken = new Set(this.menu().map((m) => m.id));
    const id = d.id ?? uniqueId(d.category, d.name, taken);
    const sort = d.id ? d.sort : this.nextSort(d.category);
    this.busy.set(true);
    this.formError.set('');
    try {
      await this.backend.saveItem(draftToItem(d, id, sort));
      this.draft.set(null);
      this.flash(`${d.name.trim()} saved.`);
    } catch {
      this.formError.set('Could not save. Check your internet connection.');
    } finally {
      this.busy.set(false);
    }
  }

  protected async remove(d: ItemDraft): Promise<void> {
    if (!d.id) return;
    if (!this.confirmDelete()) return this.confirmDelete.set(true);
    const id = d.id;
    this.busy.set(true);
    try {
      await this.backend.deleteItem(id);
      this.draft.set(null);
      this.flash(`${d.name} deleted.`);
    } catch {
      this.formError.set('Could not delete. Check your internet connection.');
    } finally {
      this.busy.set(false);
    }
  }

  private nextSort(category: string): number {
    const sorts = this.menu().filter((m) => m.category === category).map((m) => m.sort);
    if (sorts.length) return Math.max(...sorts) + 1;
    const idx = (CATEGORIES as readonly string[]).indexOf(category);
    return ((idx >= 0 ? idx : CATEGORIES.length) + 1) * 1000;
  }

  private async guard(fn: () => Promise<void>, ok: string): Promise<void> {
    try {
      await fn();
      this.flash(ok);
    } catch {
      this.message.set('');
      this.formError.set('');
      this.flash('Could not save. Check your internet connection.');
    }
  }

  private flash(text: string): void {
    this.message.set(text);
    setTimeout(() => this.message.set(''), 2500);
  }
}

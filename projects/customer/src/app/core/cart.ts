import { Injectable, computed, effect, inject, signal } from '@angular/core';
import {
  amountToFreeDelivery,
  computeTotals,
  lineExtras,
  lineKey,
  sizeLabelSuffix,
  type CartLine,
  type MenuItem,
  type SizeOption,
} from '@juicy/shared';
import { Mode } from './mode';
import { readJson, writeJson } from './storage';
import { Store } from './store';

export interface CartRow {
  key: string;
  line: CartLine;
  item: MenuItem;
  size: SizeOption;
  name: string;
  /** Price of one, including any add-ons. */
  unit: number;
  total: number;
  /** "Extra cheese (+₹20) · Note: ..." or ''. */
  extras: string;
}

const KEY = 'js.cart.v1';

@Injectable({ providedIn: 'root' })
export class Cart {
  private readonly store = inject(Store);
  private readonly mode = inject(Mode);
  readonly lines = signal<CartLine[]>(readJson<CartLine[]>(KEY, []));

  /** Lines joined with the live menu. Items (or choices) that were removed from the menu drop out. */
  readonly rows = computed<CartRow[]>(() => {
    const out: CartRow[] = [];
    for (const line of this.lines()) {
      const item = this.store.item(line.itemId);
      const size = item?.sizes[line.sizeIndex];
      if (!item || !size) continue;
      const addons = (line.addons ?? []).map((i) => item.addons?.[i]);
      const options = (line.options ?? []).map((i) => item.options?.[i]);
      if (addons.some((a) => !a) || options.some((o) => o === undefined)) continue;
      const chosen = addons as SizeOption[];
      const unit = size.price + chosen.reduce((n, a) => n + a.price, 0);
      out.push({
        key: lineKey(line),
        line,
        item,
        size,
        name: item.name + sizeLabelSuffix(size.label),
        unit,
        total: unit * line.qty,
        extras: lineExtras({
          addons: chosen,
          options: options as string[],
          note: item.allowNote ? line.note : undefined,
        }),
      });
    }
    return out;
  });

  readonly count = computed(() => this.rows().reduce((n, r) => n + r.line.qty, 0));
  /** Dine-in has no delivery charge. */
  readonly totals = computed(() => computeTotals(this.rows(), this.mode.dineIn() ? { ...this.store.config(), deliveryFee: 0 } : this.store.config()));
  readonly toFreeDelivery = computed(() => (this.mode.dineIn() ? 0 : amountToFreeDelivery(this.totals().subtotal, this.store.config())));
  readonly unavailable = computed(() => this.rows().filter((r) => !r.item.available));
  /** Only meaningful once the menu has loaded; before that every line looks "missing". */
  readonly hasMissing = computed(() => this.store.menuLoaded() && this.rows().length < this.lines().length);

  constructor() {
    effect(() => writeJson(KEY, this.lines()));
  }

  /** Total quantity of one item across all its variations (used for the "in cart" badge). */
  qtyForItem(itemId: string): number {
    return this.lines().filter((l) => l.itemId === itemId).reduce((n, l) => n + l.qty, 0);
  }

  /** Quantity of a plain line (no add-ons/options/note). */
  qty(itemId: string, sizeIndex: number): number {
    const key = lineKey({ itemId, sizeIndex });
    return this.lines().find((l) => lineKey(l) === key)?.qty ?? 0;
  }

  add(itemId: string, sizeIndex: number): void {
    this.addLine({ itemId, sizeIndex, qty: 1 });
  }

  remove(itemId: string, sizeIndex: number): void {
    this.changeQty(lineKey({ itemId, sizeIndex }), -1);
  }

  /** Adds a line; if an identical one (same size, add-ons, options, note) exists its quantity goes up. */
  addLine(line: CartLine): void {
    const max = this.store.config().maxQtyPerLine;
    const key = lineKey(line);
    this.lines.update((ls) => {
      const found = ls.some((l) => lineKey(l) === key);
      if (!found) return [...ls, { ...line, qty: Math.max(1, Math.min(max, line.qty)) }];
      return ls.map((l) => (lineKey(l) === key ? { ...l, qty: Math.min(max, l.qty + line.qty) } : l));
    });
  }

  changeQty(key: string, delta: number): void {
    const max = this.store.config().maxQtyPerLine;
    this.lines.update((ls) =>
      ls
        .map((l) => (lineKey(l) === key ? { ...l, qty: Math.max(0, Math.min(max, l.qty + delta)) } : l))
        .filter((l) => l.qty > 0),
    );
  }

  /** Changes size / add-ons / options / note of one line. Merges into an identical line if there is one. Returns the new key. */
  editLine(key: string, patch: Partial<Pick<CartLine, 'sizeIndex' | 'addons' | 'options' | 'note'>>): string {
    const max = this.store.config().maxQtyPerLine;
    const cur = this.lines().find((l) => lineKey(l) === key);
    if (!cur) return key;
    const next: CartLine = { itemId: cur.itemId, sizeIndex: patch.sizeIndex ?? cur.sizeIndex, qty: cur.qty };
    const addons = [...(patch.addons ?? cur.addons ?? [])].sort((a, b) => a - b);
    const options = [...(patch.options ?? cur.options ?? [])].sort((a, b) => a - b);
    const note = ('note' in patch ? patch.note : cur.note)?.trim();
    if (addons.length) next.addons = addons;
    if (options.length) next.options = options;
    if (note) next.note = note;
    const nk = lineKey(next);
    this.lines.update((ls) => {
      const other = ls.find((l) => lineKey(l) === nk && lineKey(l) !== key);
      if (other) return ls.filter((l) => lineKey(l) !== key).map((l) => (lineKey(l) === nk ? { ...l, qty: Math.min(max, l.qty + cur.qty) } : l));
      return ls.map((l) => (lineKey(l) === key ? next : l));
    });
    return nk;
  }

  /** Drops lines whose item is gone or sold out. */
  pruneUnavailable(): void {
    const ok = new Set(this.rows().filter((r) => r.item.available).map((r) => r.key));
    this.lines.update((ls) => ls.filter((l) => ok.has(lineKey(l))));
  }

  clear(): void {
    this.lines.set([]);
  }
}

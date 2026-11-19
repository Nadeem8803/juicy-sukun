import { Injectable, computed, inject, signal } from '@angular/core';
import { normalizeTable, type OrderType } from '@juicy/shared';
import { readJson, writeJson } from './storage';
import { Store } from './store';

const KEY = 'js.mode.v1';
const OK_KEY = 'js.mode.ok';

/** Dine-in or delivery (and which table). Asked once every time the app is opened. */
@Injectable({ providedIn: 'root' })
export class Mode {
  private readonly store = inject(Store);
  private readonly saved = readJson<{ type?: OrderType; table?: string }>(KEY, {});

  readonly type = signal<OrderType>(this.saved.type === 'dine_in' ? 'dine_in' : 'delivery');
  readonly table = signal<string>(this.saved.table ?? '');
  /** True once the customer has confirmed the choice in this visit. */
  readonly confirmed = signal(false);
  /** Opens the picker again (from the toggle on the home screen). */
  readonly editing = signal(false);

  readonly dineIn = computed(() => this.type() === 'dine_in');
  readonly tables = computed(() =>
    Array.from({ length: Math.max(1, Math.min(60, this.store.config().tableCount ?? 10)) }, (_, i) => String(i + 1)),
  );

  constructor() {
    try {
      // A table QR code opens the app as  /?table=4  : go straight to dine-in for that table.
      const t = normalizeTable(new URLSearchParams(location.search).get('table'));
      if (/^[A-Z0-9][A-Z0-9 -]{0,11}$/.test(t)) {
        this.type.set('dine_in');
        this.table.set(t);
        this.confirmed.set(true);
        this.persist();
        return;
      }
      if (sessionStorage.getItem(OK_KEY) === '1') this.confirmed.set(true);
    } catch {
      /* storage blocked: just ask */
    }
  }

  choose(type: OrderType): void {
    this.type.set(type);
    this.persist();
    if (type === 'dine_in' && !this.table()) this.editing.set(true);
  }

  setTable(t: string): void {
    this.table.set(t);
    this.persist();
  }

  /** Customer pressed Continue. */
  confirm(): void {
    if (this.dineIn() && !this.table()) return;
    this.confirmed.set(true);
    this.editing.set(false);
    try {
      sessionStorage.setItem(OK_KEY, '1');
    } catch {
      /* ignore */
    }
    this.persist();
  }

  private persist(): void {
    writeJson(KEY, { type: this.type(), table: this.table() });
  }
}

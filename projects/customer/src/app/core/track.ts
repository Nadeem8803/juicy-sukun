import { Injectable, inject } from '@angular/core';
import { BACKEND } from './backend';
import { readJson, writeJson } from './storage';

const VID_KEY = 'js.vid.v1';

function rand(): string {
  const a = new Uint8Array(12);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(36).padStart(2, '0')).join('').slice(0, 20);
}

/**
 * Anonymous visit tracking for the cafe's own analytics: a random id for this phone, one id per visit,
 * what was looked at and whether the visit reached the cart / checkout / an order. No names or numbers.
 */
@Injectable({ providedIn: 'root' })
export class Track {
  private readonly backend = inject(BACKEND);
  private readonly vid = (() => {
    let v = readJson<string>(VID_KEY, '');
    if (!v) {
      v = rand();
      writeJson(VID_KEY, v);
    }
    return v;
  })();
  private readonly sid = rand();
  private readonly startedAt = Date.now();
  private events: { t: number; k: string; d?: string }[] = [];
  private flags = { cart: false, checkout: false, ordered: false };
  private table = '';
  private timer: ReturnType<typeof setTimeout> | null = null;
  private started = false;

  start(table: string): void {
    if (this.started) return;
    this.started = true;
    this.table = table;
    this.event('open');
    addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') this.flush();
    });
    addEventListener('pagehide', () => this.flush());
  }

  setTable(t: string): void {
    this.table = t;
  }

  event(k: string, d?: string): void {
    if (this.events.length < 60) this.events.push({ t: Date.now(), k, ...(d ? { d } : {}) });
    if (k === 'cart') this.flags.cart = true;
    if (k === 'checkout') this.flags.checkout = true;
    if (k === 'ordered') this.flags.ordered = true;
    if (!this.timer) this.timer = setTimeout(() => this.flush(), 15_000);
  }

  private flush(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const events = this.events;
    this.events = [];
    this.backend.track({ sid: this.sid, vid: this.vid, table: this.table, startedAt: this.startedAt, flags: this.flags, events });
  }
}

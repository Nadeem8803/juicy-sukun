import { Injectable, computed, inject, signal } from '@angular/core';
import type { AppConfig, ShopStatus } from '@juicy/shared';
import { BACKEND } from './backend';

@Injectable({ providedIn: 'root' })
export class Shop {
  private readonly backend = inject(BACKEND);
  readonly status = signal<ShopStatus | null>(null);
  readonly open = computed(() => this.status()?.open === true);
  readonly busy = signal(false);
  /** Cafe settings, loaded once (for Busy mode and the default ready time). */
  readonly cfg = signal<AppConfig | null>(null);
  readonly busyMode = computed(() => this.cfg()?.busyMode === true);
  readonly busyExtra = computed(() => (this.cfg()?.busyMode ? (this.cfg()?.busyExtraMin ?? 0) : 0));
  private off: (() => void) | null = null;

  async loadCfg(): Promise<void> {
    try {
      this.cfg.set(await this.backend.loadConfig());
    } catch {
      /* the settings screen shows its own error */
    }
  }

  /** Quick Busy-mode switch. Saves the whole config with only that flag changed. */
  async setBusyMode(on: boolean): Promise<void> {
    const c = this.cfg() ?? (await this.backend.loadConfig());
    const next = { ...c, busyMode: on };
    this.cfg.set(next);
    try {
      await this.backend.saveConfig(next);
    } catch (e) {
      this.cfg.set(c);
      throw e;
    }
  }

  /** Start listening (called once the owner is signed in). */
  watch(): void {
    if (!this.off) void this.loadCfg();
    this.off ??= this.backend.watchShop((s) => this.status.set(s));
  }

  async set(open: boolean, message?: string): Promise<void> {
    this.busy.set(true);
    try {
      await this.backend.setShop(open, message);
    } finally {
      this.busy.set(false);
    }
  }
}

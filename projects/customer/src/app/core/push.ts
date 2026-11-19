import { Injectable, inject, signal } from '@angular/core';
import { BACKEND } from './backend';

/** Order-status notifications on this phone. Works on Android Chrome; on iPhone only once added to the Home Screen. */
@Injectable({ providedIn: 'root' })
export class Push {
  private readonly backend = inject(BACKEND);
  private refreshed = false;

  readonly supported =
    typeof window !== 'undefined' && 'Notification' in window && 'serviceWorker' in navigator && 'PushManager' in window && !!this.backend.enablePush;
  readonly permission = signal<NotificationPermission>(this.supported ? Notification.permission : 'denied');
  /** iPhone/iPad in a normal Safari tab: notifications need the app on the Home Screen first. */
  readonly needsHomeScreen =
    typeof navigator !== 'undefined' &&
    /iphone|ipad|ipod/i.test(navigator.userAgent) &&
    !(window.matchMedia?.('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone);
  readonly busy = signal(false);

  /** Called from a tap: asks permission and saves this phone's push address. */
  async enable(): Promise<void> {
    if (!this.supported || this.busy()) return;
    this.busy.set(true);
    try {
      await this.backend.enablePush?.();
    } finally {
      this.permission.set(Notification.permission);
      this.busy.set(false);
    }
  }

  /** Already allowed earlier: quietly make sure the server has this phone's current address. */
  async refresh(): Promise<void> {
    if (!this.supported || this.refreshed || Notification.permission !== 'granted') return;
    this.refreshed = true;
    await this.backend.enablePush?.();
  }
}

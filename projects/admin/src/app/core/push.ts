import { Injectable, effect, inject } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { BACKEND } from './backend';
import { NativeAlarm } from './alarm';
import { Session } from './session';

/** Registers this phone's push token so the Cloud Function can ring it when an order arrives (even if the app is closed). */
@Injectable({ providedIn: 'root' })
export class Push {
  private readonly backend = inject(BACKEND);
  private readonly session = inject(Session);

  constructor() {
    effect(() => {
      if (!this.session.signedIn() || !Capacitor.isNativePlatform()) return;
      void this.register();
    });
  }

  private async register(): Promise<void> {
    try {
      await NativeAlarm.requestNotifications().catch(() => undefined); // Android 13+ asks the owner once
      const { token } = await NativeAlarm.getToken();
      if (token) await this.backend.registerToken(token);
    } catch (e) {
      console.warn('Could not register for push', e);
    }
  }
}

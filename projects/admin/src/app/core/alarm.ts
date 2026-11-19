import { Injectable, effect, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { App as CapApp } from '@capacitor/app';
import { Capacitor, registerPlugin } from '@capacitor/core';
import { AlarmVoice } from './voice';
import { PaySms } from './pay-sms';
import { OrdersStore } from './orders-store';
import { PrinterService } from './printer';

export interface AlarmStatus {
  notifications: boolean;
  fullScreen: boolean;
  batteryOptimized: boolean;
  ringing: boolean;
}

/** Bridge to the native Android plugin (android-native/*.java). Only exists inside the APK. */
export interface OrderAlarmPlugin {
  start(options: { title: string; body: string }): Promise<void>;
  stop(): Promise<void>;
  getToken(): Promise<{ token: string }>;
  status(): Promise<AlarmStatus>;
  requestNotifications(): Promise<void>;
  openFullScreenSettings(): Promise<void>;
  openBatterySettings(): Promise<void>;
}

export const NativeAlarm = registerPlugin<OrderAlarmPlugin>('OrderAlarm');

/** Fires `ring()` repeatedly until stopped. Pure timing logic, easy to unit-test. */
export class Siren {
  private timer: ReturnType<typeof setInterval> | null = null;
  constructor(
    private readonly ring: () => void,
    private readonly everyMs = 1200,
  ) {}
  get active(): boolean {
    return this.timer !== null;
  }
  start(): void {
    if (this.timer) return;
    this.ring();
    this.timer = setInterval(this.ring, this.everyMs);
  }
  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

/**
 * Rings while at least one order is waiting, and stops the moment none is.
 *  - In the APK: starts the native alarm service (loud, USAGE_ALARM, shows over the lock screen).
 *    The same service is also started by the push notification when the app is closed.
 *  - In a browser: a loud Web Audio siren (needs one tap to unlock sound).
 */
@Injectable({ providedIn: 'root' })
export class AlarmService {
  private readonly orders = inject(OrdersStore);
  private readonly router = inject(Router);
  /** Created at start-up so the saved voice choice reaches the phone and bank SMS matching starts watching. */
  private readonly voiceSettings = inject(AlarmVoice);
  private readonly paySms = inject(PaySms);
  private readonly printer = inject(PrinterService);
  /** Bumped whenever the app is brought forward while orders are waiting; the Orders page switches to its New tab. */
  readonly showNew = signal(0);
  readonly native = Capacitor.isNativePlatform();
  readonly ringing = signal(false);
  /** Browser only: sound is blocked until the owner taps once. */
  readonly needsUnlock = signal(false);
  private lastCount = 0;
  private ctx: AudioContext | null = null;
  private readonly siren = new Siren(() => this.beep());

  constructor() {
    void this.voiceSettings;
    void this.paySms;
    void this.printer;
    if (this.native) {
      // Tapping the alarm notification brings the app forward: land on Orders → New.
      void CapApp.addListener('appStateChange', ({ isActive }) => {
        if (isActive && this.orders.pending().length > 0) this.goToNew();
      });
      // Tapping the alarm notification while the app is already open.
      window.addEventListener('alarmOpened', () => this.goToNew());
    }
    effect(() => {
      const pending = this.orders.pending();
      if (!this.orders.loaded()) return; // never stop (or judge) before real data arrives
      if (pending.length > this.lastCount) this.goToNew(); // a new order arrived: show it
      this.lastCount = pending.length;
      if (pending.length > 0) void this.start(pending.length, pending[0].number);
      else void this.stop();
    });
  }

  private goToNew(): void {
    this.showNew.update((n) => n + 1);
    if (!this.router.url.startsWith('/orders')) void this.router.navigateByUrl('/orders');
  }

  /** Call from a tap (sign-in button, banner) so the browser allows sound. */
  unlock(): void {
    if (this.native) return;
    try {
      this.ctx ??= new AudioContext();
      void this.ctx.resume();
      this.needsUnlock.set(this.ctx.state !== 'running');
    } catch {
      /* no audio support */
    }
  }

  async test(): Promise<void> {
    if (this.native) await NativeAlarm.start({ title: 'Test alarm', body: 'This is how new orders will sound. Tap Stop.' });
    else {
      this.unlock();
      this.siren.start();
      setTimeout(() => this.siren.stop(), 3000);
    }
  }

  private async start(count: number, firstNumber: string): Promise<void> {
    this.ringing.set(true);
    if (this.native) {
      await NativeAlarm.start({
        title: count > 1 ? `${count} new orders waiting` : `New order ${firstNumber}`,
        body: 'Open the app to accept or reject',
      }).catch(() => undefined);
    } else {
      this.unlock();
      this.siren.start();
    }
  }

  private async stop(): Promise<void> {
    if (!this.ringing()) {
      // Cold start with nothing pending: make sure a leftover native alarm is silenced too.
      if (this.native) await NativeAlarm.stop().catch(() => undefined);
      return;
    }
    this.ringing.set(false);
    this.siren.stop();
    if (this.native) await NativeAlarm.stop().catch(() => undefined);
  }

  /** Two-tone siren. */
  private beep(): void {
    if (!this.ctx || this.ctx.state !== 'running') {
      this.needsUnlock.set(true);
      return;
    }
    this.needsUnlock.set(false);
    const t = this.ctx.currentTime;
    [880, 660, 880, 660].forEach((f, i) => {
      const o = this.ctx!.createOscillator();
      const g = this.ctx!.createGain();
      o.type = 'square';
      o.frequency.value = f;
      g.gain.setValueAtTime(0.4, t + i * 0.28);
      g.gain.setValueAtTime(0, t + i * 0.28 + 0.22);
      o.connect(g).connect(this.ctx!.destination);
      o.start(t + i * 0.28);
      o.stop(t + i * 0.28 + 0.24);
    });
  }
}

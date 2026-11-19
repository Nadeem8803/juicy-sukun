import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { DEFAULT_CONFIG, describeSample, normalizePhone, type AppConfig, type Order } from '@juicy/shared';
import { AlarmService, NativeAlarm, type AlarmStatus } from '../core/alarm';
import { BACKEND } from '../core/backend';
import { closeOnBack } from '../core/back-close';
import { PaySms, type PaySmsSettings } from '../core/pay-sms';
import { AlarmVoice, type VoiceMode } from '../core/voice';
import { PrinterService } from '../core/printer';
import { Session } from '../core/session';
import { OffersPanel } from '../ui/offers-panel';
import { Shop } from '../core/shop';

/** Returns an error message or null. */
export function validateSettings(c: AppConfig): string | null {
  if (!c.cafeName.trim()) return 'Enter the cafe name.';
  if (c.cafePhone && !normalizePhone(c.cafePhone)) return 'Cafe phone must be a 10-digit mobile number.';
  if (!(c.deliveryFee >= 0 && c.deliveryFee <= 1000)) return 'Delivery charge must be between ₹0 and ₹1000.';
  if (!(c.freeDeliveryMin >= 0)) return 'Free-delivery amount cannot be negative.';
  if (!(c.orderTimeoutMinutes >= 1 && c.orderTimeoutMinutes <= 60)) return 'Auto-reject time must be 1–60 minutes.';
  if (!Number.isInteger(c.tableCount) || c.tableCount < 1 || c.tableCount > 60) return 'Number of tables must be 1–60.';
  if (c.upiEnabled && !/^[\w.\-]{2,}@[A-Za-z][A-Za-z0-9]{1,}$/.test((c.upiId ?? '').trim())) return 'Enter your UPI ID, like name@bank.';
  if (!(c.deliveryMaxKm >= 0 && c.deliveryMaxKm <= 500)) return 'Delivery distance must be 0–500 km.';
  if (c.deliveryMaxKm > 0 && !(Math.abs(c.cafeLat) > 0 && Math.abs(c.cafeLng) > 0 && Math.abs(c.cafeLat) <= 90 && Math.abs(c.cafeLng) <= 180)) return 'Enter the cafe location (latitude, longitude) so the distance can be checked.';
  if (!(c.busyExtraMin >= 0 && c.busyExtraMin <= 120)) return 'Busy mode extra time must be 0–120 minutes.';
  if (c.loyaltyEnabled) {
    if (!Number.isInteger(c.loyaltyAfter) || c.loyaltyAfter < 1 || c.loyaltyAfter > 100) return 'Loyalty: "after how many orders" must be 1–100.';
    if (!Number.isInteger(c.loyaltyPercent) || c.loyaltyPercent < 1 || c.loyaltyPercent > 50) return 'Loyalty discount must be 1–50 %.';
  }
  return null;
}

type Screen = 'home' | 'shopmsg' | 'busy' | 'cafe' | 'delivery' | 'upi' | 'loyalty' | 'offers' | 'alarm' | 'printer' | 'account' | 'about';
const TITLES: Record<Screen, string> = {
  home: 'Settings',
  shopmsg: 'Shop message',
  busy: 'Busy mode',
  cafe: 'Cafe details',
  delivery: 'Delivery & tables',
  upi: 'UPI & payment SMS',
  loyalty: 'Loyalty discount',
  offers: 'Offers & banners',
  alarm: 'Order alarm & voice',
  printer: 'Bill printer',
  account: 'Account',
  about: 'About',
};

@Component({
  selector: 'app-settings-page',
  imports: [OffersPanel],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (screen() === 'home') {
      <h1>Settings</h1>
      <div class="slist">
        <button type="button" class="srow" (click)="go('shopmsg')" data-testid="row-shopmsg"><span class="sic">🏪</span><span class="st"><b>Shop message</b><small>{{ message() ? '“' + message() + '”' : 'Shown to customers when you are closed' }}</small></span><span class="chev">›</span></button>
      </div>

      <div class="sgrp">Cafe</div>
      <div class="slist">
        <button type="button" class="srow" (click)="go('cafe')" data-testid="row-cafe"><span class="sic">☕</span><span class="st"><b>Cafe details</b><small>{{ cfg()?.cafeName }}@if (cfg()?.cafeAddress) { · {{ cfg()?.cafeAddress }} }</small></span><span class="chev">›</span></button>
        <button type="button" class="srow" (click)="go('busy')" data-testid="row-busy"><span class="sic">🔥</span><span class="st"><b>Busy mode</b><small>{{ cfg()?.busyMode ? 'On · +' + cfg()?.busyExtraMin + ' min added to ready times' : 'Off · tell customers to expect a longer wait' }}</small></span>
          <span class="pill" [class.on]="cfg()?.busyMode">{{ cfg()?.busyMode ? 'On' : 'Off' }}</span><span class="chev">›</span></button>
        <button type="button" class="srow" (click)="go('delivery')" data-testid="row-delivery"><span class="sic">🛵</span><span class="st"><b>Delivery &amp; tables</b><small>₹{{ cfg()?.deliveryFee }} delivery · free from ₹{{ cfg()?.freeDeliveryMin }} · {{ cfg()?.tableCount }} tables{{ cfg()?.deliveryMaxKm ? ' · within ' + cfg()?.deliveryMaxKm + ' km' : '' }}</small></span><span class="chev">›</span></button>
      </div>

      <div class="sgrp">Payments &amp; offers</div>
      <div class="slist">
        <button type="button" class="srow" (click)="go('upi')" data-testid="row-upi"><span class="sic">📲</span><span class="st"><b>UPI &amp; payment SMS</b><small>{{ cfg()?.upiEnabled ? cfg()?.upiId : 'UPI off' }} · SMS matching {{ sms.settings().enabled ? 'on' : 'off' }}</small></span>
          <span class="pill" [class.on]="cfg()?.upiEnabled">{{ cfg()?.upiEnabled ? 'On' : 'Off' }}</span><span class="chev">›</span></button>
        <button type="button" class="srow" (click)="go('loyalty')" data-testid="row-loyalty"><span class="sic">🎁</span><span class="st"><b>Loyalty discount</b><small>{{ cfg()?.loyaltyEnabled ? cfg()?.loyaltyPercent + '% off after ' + cfg()?.loyaltyAfter + ' orders' : 'Off' }}</small></span>
          <span class="pill" [class.on]="cfg()?.loyaltyEnabled">{{ cfg()?.loyaltyEnabled ? 'On' : 'Off' }}</span><span class="chev">›</span></button>
        <button type="button" class="srow" (click)="go('offers')" data-testid="row-offers"><span class="sic">📣</span><span class="st"><b>Offers &amp; banners</b><small>Promotions shown on the customer menu</small></span><span class="chev">›</span></button>
      </div>

      <div class="sgrp">This phone</div>
      <div class="slist">
        <button type="button" class="srow" (click)="go('alarm')" data-testid="row-alarm"><span class="sic">🔔</span><span class="st"><b>Order alarm &amp; voice</b><small>{{ voiceLabel() }}</small></span>
          @if (needsAttention()) { <span class="pill warn">Check</span> }<span class="chev">›</span></button>
        <button type="button" class="srow" (click)="go('printer')" data-testid="row-printer"><span class="sic">🖨️</span><span class="st"><b>Bill printer</b><small>{{ printer.available ? (printer.name() || 'No printer chosen yet') : 'Needs the owner app' }}</small></span><span class="chev">›</span></button>
      </div>

      <div class="sgrp">Account</div>
      <div class="slist">
        <button type="button" class="srow" (click)="go('account')" data-testid="row-account"><span class="sic">👤</span><span class="st"><b>Account</b><small>{{ session.user()?.email }}</small></span><span class="chev">›</span></button>
        <button type="button" class="srow" (click)="go('about')" data-testid="row-about"><span class="sic">ℹ️</span><span class="st"><b>About</b><small>Built &amp; supported by ZyntraTech</small></span><span class="chev">›</span></button>
      </div>
    } @else {
      <div class="sbar">
        <button type="button" class="back" (click)="back()" aria-label="Back" data-testid="settings-back">‹</button>
        <h1>{{ title() }}</h1>
      </div>

      @switch (screen()) {
        @case ('shopmsg') {
          <section class="panel">
            <p class="muted">Shown to customers when you are offline (optional).</p>
            <input [value]="message()" (input)="message.set($any($event.target).value)" maxlength="120" placeholder="e.g. Back at 6 pm" data-testid="shop-message" />
            <button type="button" class="btn primary" (click)="saveMessage()">Save message</button>
          </section>
        }

        @case ('offers') { <app-offers-panel /> }

        @case ('alarm') {
          <section class="panel">
            @if (alarm.native) {
              <p class="muted">For the alarm to ring even when the phone is locked or the app is closed, all must be ✔.</p>
              <ul class="check-list">
                <li [class.ok]="st()?.notifications">{{ st()?.notifications ? '✔' : '✖' }} Notifications allowed
                  @if (st() && !st()!.notifications) { <button type="button" class="link" (click)="fix('notifications')">Allow</button> }</li>
                <li [class.ok]="st()?.fullScreen">{{ st()?.fullScreen ? '✔' : '✖' }} Show alarm over the lock screen
                  @if (st() && !st()!.fullScreen) { <button type="button" class="link" (click)="fix('fullScreen')">Allow</button> }</li>
                <li [class.ok]="st() && !st()!.batteryOptimized">{{ st() && !st()!.batteryOptimized ? '✔' : '✖' }} Battery: unrestricted
                  @if (st()?.batteryOptimized) { <button type="button" class="link" (click)="fix('battery')">Fix</button> }</li>
              </ul>
              <p class="muted">Samsung: Settings → Battery → Background usage limits → remove Juicysukun from "Sleeping apps". Realme: Settings → Battery → App battery management → Juicysukun → Allow background activity.</p>
            } @else {
              <p class="muted">Browser mode: the siren plays only while this page is open.</p>
            }
          </section>
          <div class="sgrp">Voice</div>
          <div class="slist" role="radiogroup" aria-label="Alarm voice">
            @for (v of voices; track v.id) {
              <button type="button" class="srow" role="radio" [attr.aria-checked]="voice.mode() === v.id" (click)="voice.set(v.id, voice.interval())" [attr.data-testid]="'voice-' + v.id">
                <span class="st"><b>{{ v.title }}</b><small>{{ v.hint }}</small></span>
                @if (voice.mode() === v.id) { <span class="pill on">Selected</span> }
              </button>
            }
          </div>
          <section class="panel">
            <label>Repeat every
              <select [value]="voice.interval()" (change)="voice.set(voice.mode(), +$any($event.target).value)" data-testid="voice-interval">
                @for (n of [2, 3, 5, 8]; track n) { <option [value]="n" [selected]="voice.interval() === n">{{ n }} seconds</option> }
              </select></label>
            <div class="two">
              <button type="button" class="btn" (click)="alarm.test()" data-testid="test-alarm">🔔 Test</button>
              @if (alarm.native) { <button type="button" class="btn danger" (click)="stopTest()">Stop test</button> }
            </div>
            <p class="muted">Also turn the phone's volume up. The alarm uses the alarm volume, so it rings even on silent.</p>
          </section>
        }

        @case ('printer') {
          <section class="panel">
            @if (printer.available) {
              <p class="muted">Switch the printer on and pair it once in the phone's Bluetooth settings, then choose it here.
                {{ printer.name() ? 'Chosen: ' + printer.name() : 'No printer chosen yet.' }}</p>
              <button type="button" class="btn" (click)="findPrinters()" data-testid="find-printers">🔎 Find paired printers</button>
              @for (d of devices(); track d.address) {
                <button type="button" class="btn" [class.primary]="printer.address() === d.address" (click)="printer.setPrinter(d.address, d.name)">{{ d.name || d.address }}</button>
              }
              @if (devices().length === 0 && searched()) { <p class="muted">No paired printers found. Pair the printer in Bluetooth settings first.</p> }
              <label class="check"><input type="checkbox" [checked]="printer.autoKot()" (change)="printer.setAutoKot($any($event.target).checked)" /> Print a kitchen slip when I accept an order</label>
              <label class="check"><input type="checkbox" [checked]="printer.autoBill()" (change)="printer.setAutoBill($any($event.target).checked)" data-testid="auto-bill" /> Print the bill when I confirm payment</label>
              <button type="button" class="btn" (click)="testPrint()" data-testid="test-print">🖨️ Test print</button>
              <button type="button" class="btn" (click)="testSlip()" data-testid="test-kot">🍳 Test kitchen slip</button>
              <button type="button" class="btn" (click)="testBill()" data-testid="test-bill">🧾 Test bill</button>
              @if (printMsg()) { <p class="muted" role="status">{{ printMsg() }}</p> }
            } @else {
              <p class="muted">Printing needs the latest owner app (APK). You can still share bills on WhatsApp.</p>
            }
          </section>
        }

        @case ('account') {
          <section class="panel">
            <p class="muted">{{ session.user()?.email }}</p>
            <button type="button" class="btn danger" (click)="logout()" data-testid="logout">Sign out</button>
          </section>
        }

        @case ('about') {
          <section class="panel about" data-testid="about">
            <p class="muted">Built &amp; supported by</p>
            <p><b class="zt">ZyntraTech</b></p>
            <p class="muted">zyntratech.web.app · WhatsApp 7021487705</p>
          </section>
        }

        @default {
          @if (cfg(); as c) {
            <form class="panel" (submit)="$event.preventDefault(); save()">
              @switch (screen()) {
                @case ('cafe') {
                  <label>Cafe name <input [value]="c.cafeName" (input)="set('cafeName', $any($event.target).value)" /></label>
                  <label>Cafe phone <small>(customers see this after you accept)</small>
                    <input type="tel" inputmode="numeric" [value]="c.cafePhone" (input)="set('cafePhone', $any($event.target).value)" data-testid="cfg-phone" /></label>
                  <label>Cafe address <input [value]="c.cafeAddress" (input)="set('cafeAddress', $any($event.target).value)" /></label>
                  <label>FSSAI licence no. <input [value]="c.fssai" (input)="set('fssai', $any($event.target).value)" /></label>
                }
                @case ('delivery') {
                  <div class="two">
                    <label>Delivery charge ₹ <input type="number" inputmode="numeric" min="0" [value]="c.deliveryFee" (input)="num('deliveryFee', $event)" data-testid="cfg-fee" /></label>
                    <label>Free delivery from ₹ <input type="number" inputmode="numeric" min="0" [value]="c.freeDeliveryMin" (input)="num('freeDeliveryMin', $event)" data-testid="cfg-free" /></label>
                  </div>
                  <label>Number of tables <small>(customers pick 1 to this number when dining in)</small>
                    <input type="number" inputmode="numeric" min="1" max="60" [value]="c.tableCount" (input)="num('tableCount', $event)" data-testid="cfg-tables" /></label>
                  <label>Deliver only within (km) <small>(0 = no limit; dine-in is never limited)</small>
                    <input type="number" inputmode="decimal" min="0" max="500" step="0.5" [value]="c.deliveryMaxKm" (input)="set('deliveryMaxKm', +$any($event.target).value)" data-testid="cfg-maxkm" /></label>
                  @if (c.deliveryMaxKm > 0) {
                    <label>Cafe location <small>(latitude, longitude)</small>
                      <input [value]="cafePos()" placeholder="17.5230, 76.2060" inputmode="decimal" (input)="setCafePos($any($event.target).value)" data-testid="cfg-cafepos" /></label>
                    <button type="button" class="btn" (click)="useHere()" data-testid="cfg-usehere">📍 Use my current location as the cafe</button>
                    @if (posMsg()) { <small class="muted" role="status">{{ posMsg() }}</small> }
                    <small class="muted">Or on Google Maps: press and hold your cafe, then copy the two numbers shown at the top and paste them here. Customers must share their location to order delivery, and orders farther than this are refused.</small>
                  }
                  <label>Auto-reject if I don't respond (minutes)
                    <input type="number" inputmode="numeric" min="1" max="60" [value]="c.orderTimeoutMinutes" (input)="num('orderTimeoutMinutes', $event)" /></label>
                }
                @case ('busy') {
                  <label class="check"><input type="checkbox" [checked]="c.busyMode" (change)="set('busyMode', $any($event.target).checked)" data-testid="cfg-busy-on" /> Busy mode: customers see "We're busy right now, expect a longer wait"</label>
                  <label>Extra minutes added to every ready time
                    <input type="number" inputmode="numeric" min="0" max="120" [value]="c.busyExtraMin" (input)="set('busyExtraMin', +$any($event.target).value)" data-testid="cfg-busy-min" /></label>
                  <small class="muted">You can also switch Busy mode on and off from the Orders screen with one tap.</small>
                }
                @case ('upi') {
                  <label class="check"><input type="checkbox" [checked]="c.upiEnabled" (change)="set('upiEnabled', $any($event.target).checked)" data-testid="cfg-upi-on" /> Let customers pay by UPI from their phone</label>
                  @if (c.upiEnabled) {
                    <label>Your UPI ID <small>(the money goes straight to this account)</small>
                      <input [value]="c.upiId" placeholder="name@bank" autocapitalize="none" (input)="set('upiId', $any($event.target).value)" data-testid="cfg-upi-id" /></label>
                    <label>Name shown in the customer's UPI app
                      <input [value]="c.upiName" maxlength="40" (input)="set('upiName', $any($event.target).value)" /></label>
                  }
                  @if (c.upiEnabled) {
                    <label class="check"><input type="checkbox" [checked]="c.upiPaise" (change)="set('upiPaise', $any($event.target).checked)" data-testid="cfg-paise" /> Tell same-priced orders apart: add a few paise (₹0.01 to ₹0.99) to the UPI amount</label>
                    @if (c.upiPaise) { <small class="muted">Example: a ₹318 order is paid as ₹318.07. The bank SMS then matches exactly one order. The customer sees the exact amount to pay. Your bill and sales still show ₹318.</small> }
                  }
                  <h2>Match payments from SMS</h2>
                  @if (!alarm.native) {
                    <p class="muted">This works in the owner app (APK) on the phone that receives your bank's SMS.</p>
                  } @else {
                    <label class="check"><input type="checkbox" [checked]="smsDraft().enabled" (change)="toggleSms($any($event.target).checked)" data-testid="sms-on" /> Read my bank's "credited" SMS and suggest "Received"</label>
                    <p class="muted">The messages are read on this phone only. You still tap to confirm each payment.</p>
                    @if (smsDraft().enabled) {
                      @if (!sms.granted()) {
                        <p class="err" role="alert">SMS permission is off.</p>
                        <button type="button" class="btn" (click)="sms.requestAccess()" data-testid="sms-allow">Allow SMS access</button>
                        <p class="muted">If Android blocks it: Settings → Apps → this app → ⋮ (top right) → "Allow restricted settings", then Permissions → SMS → Allow.</p>
                      }
                      <label>Bank SMS sender contains <small>(e.g. UNIONB)</small>
                        <input [value]="smsDraft().sender" autocapitalize="characters" placeholder="UNIONB" (input)="patchSms({ sender: $any($event.target).value })" data-testid="sms-sender" /></label>
                      <label>Sample "credited" SMS <small>(paste one real message; paste a new one if you change bank or UPI ID)</small>
                        <textarea rows="4" [value]="smsDraft().sample" (input)="patchSms({ sample: $any($event.target).value })" placeholder="A/c *1234 Credited for Rs:50.00 on …" data-testid="sms-sample"></textarea></label>
                      <p [class.ok]="sample().ok" [class.err]="!sample().ok && smsDraft().sample.trim()" class="muted" data-testid="sms-understood">{{ sample().ok ? '✔ ' : '' }}{{ sample().message }}</p>
                      <label>Look for orders from the last
                        <select [value]="smsDraft().windowMin" (change)="patchSms({ windowMin: +$any($event.target).value })">
                          @for (n of [15, 30, 60]; track n) { <option [value]="n" [selected]="smsDraft().windowMin === n">{{ n }} minutes</option> }
                        </select></label>
                      <label class="check"><input type="checkbox" [checked]="smsDraft().auto" (change)="patchSms({ auto: $any($event.target).checked })" /> Confirm by itself when only one order matches and the customer tapped "I have paid"</label>
                    }
                  }
                }
                @case ('loyalty') {
                  <label class="check"><input type="checkbox" [checked]="c.loyaltyEnabled" (change)="set('loyaltyEnabled', $any($event.target).checked)" data-testid="cfg-loyal-on" /> Give regular customers a discount</label>
                  @if (c.loyaltyEnabled) {
                    <div class="two">
                      <label>After this many orders <input type="number" inputmode="numeric" min="1" max="100" [value]="c.loyaltyAfter" (input)="numK('loyaltyAfter', $event)" data-testid="cfg-loyal-after" /></label>
                      <label>Discount % <input type="number" inputmode="numeric" min="1" max="50" [value]="c.loyaltyPercent" (input)="numK('loyaltyPercent', $event)" data-testid="cfg-loyal-pct" /></label>
                    </div>
                    <small class="muted">After {{ c.loyaltyAfter }} completed orders, every next order gets {{ c.loyaltyPercent }}% off. You can change this any time.</small>
                  }
                }
              }
              @if (error()) { <p class="err" role="alert">{{ error() }}</p> }
              @if (saved()) { <p class="ok" role="status">Saved ✔</p> }
              <button type="submit" class="btn primary" [disabled]="busy()" data-testid="cfg-save">{{ busy() ? 'Saving…' : 'Save' }}</button>
            </form>
          } @else { <p class="muted center">Loading…</p> }
        }
      }
    }
  `,
})
export class SettingsPage implements OnInit {
  private readonly backend = inject(BACKEND);
  private readonly router = inject(Router);
  protected readonly session = inject(Session);
  protected readonly alarm = inject(AlarmService);
  private readonly shop = inject(Shop);
  protected readonly printer = inject(PrinterService);
  protected readonly devices = signal<{ name: string; address: string }[]>([]);
  protected readonly searched = signal(false);
  protected readonly printMsg = signal('');
  protected readonly sms = inject(PaySms);
  protected readonly voice = inject(AlarmVoice);
  protected readonly voices: { id: VoiceMode; title: string; hint: string }[] = [
    { id: 'recorded', title: 'Our recorded voice', hint: 'Says “New order received”, loud and clear' },
    { id: 'phone', title: "Phone's voice", hint: 'Says “New order”; speed and volume depend on the phone' },
    { id: 'bell', title: 'Bell only', hint: 'A plain alarm sound' },
  ];
  protected readonly screen = signal<Screen>('home');
  protected readonly title = computed(() => TITLES[this.screen()]);
  private readonly backScreen = closeOnBack(computed(() => this.screen() !== 'home'), () => this.screen.set('home'));
  protected readonly smsDraft = signal<PaySmsSettings>({ ...this.sms.settings() });
  protected readonly sample = computed(() => describeSample(this.smsDraft().sample));
  protected readonly voiceLabel = computed(() => ({ recorded: 'Our recorded voice', phone: "Phone's voice", bell: 'Bell only' })[this.voice.mode()] + ` · every ${this.voice.interval()} s`);
  protected readonly needsAttention = computed(() => {
    const s = this.st();
    return this.alarm.native && !!s && (!s.notifications || !s.fullScreen || s.batteryOptimized);
  });

  protected go(s: Screen): void {
    this.error.set('');
    this.saved.set(false);
    this.smsDraft.set({ ...this.sms.settings() });
    this.screen.set(s);
    if (s === 'alarm') void this.refreshStatus();
    if (s === 'upi') void this.sms.refreshAccess();
  }
  protected back(): void {
    this.screen.set('home');
  }
  protected patchSms(p: Partial<PaySmsSettings>): void {
    this.smsDraft.update((d) => ({ ...d, ...p }));
    this.saved.set(false);
  }
  protected async toggleSms(on: boolean): Promise<void> {
    this.patchSms({ enabled: on });
    if (on && !this.sms.granted()) await this.sms.requestAccess();
  }

  protected readonly cfg = signal<AppConfig | null>(null);
  protected readonly message = signal(this.shop.status()?.message ?? '');
  protected readonly error = signal('');
  protected readonly saved = signal(false);
  protected readonly busy = signal(false);
  protected readonly st = signal<AlarmStatus | null>(null);

  async ngOnInit(): Promise<void> {
    this.cfg.set(await this.backend.loadConfig().catch(() => ({ ...DEFAULT_CONFIG })));
    this.message.set(this.shop.status()?.message ?? '');
    await this.refreshStatus();
  }

  protected set<K extends keyof AppConfig>(k: K, v: AppConfig[K]): void {
    this.cfg.update((c) => (c ? { ...c, [k]: v } : c));
    this.saved.set(false);
  }
  protected numK(k: 'loyaltyAfter' | 'loyaltyPercent', ev: Event): void {
    this.set(k, Number((ev.target as HTMLInputElement).value));
  }
  protected num(k: 'deliveryFee' | 'freeDeliveryMin' | 'orderTimeoutMinutes' | 'tableCount', ev: Event): void {
    this.set(k, Number((ev.target as HTMLInputElement).value));
  }

  protected readonly posMsg = signal('');
  protected cafePos(): string {
    const c = this.cfg();
    return c && c.cafeLat && c.cafeLng ? `${c.cafeLat}, ${c.cafeLng}` : '';
  }
  protected setCafePos(v: string): void {
    const m = /(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)/.exec(v);
    if (!m) {
      this.set('cafeLat', 0);
      this.set('cafeLng', 0);
      return;
    }
    this.set('cafeLat', Number(m[1]));
    this.set('cafeLng', Number(m[2]));
  }
  protected useHere(): void {
    if (!('geolocation' in navigator)) {
      this.posMsg.set("This phone can't share its location here. Type the numbers instead.");
      return;
    }
    this.posMsg.set('Finding your location…');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        this.set('cafeLat', Math.round(pos.coords.latitude * 1e6) / 1e6);
        this.set('cafeLng', Math.round(pos.coords.longitude * 1e6) / 1e6);
        this.posMsg.set('Location set to where you are now. Press Save.');
      },
      () => this.posMsg.set('Could not get the location. Allow location for the app, or type the numbers instead.'),
      { enableHighAccuracy: true, timeout: 12000 },
    );
  }

  protected async save(): Promise<void> {
    const c = this.cfg();
    if (!c) return;
    const err = validateSettings(c);
    if (err) return this.error.set(err);
    this.error.set('');
    let smsNote = '';
    if (this.screen() === 'upi' && this.alarm.native) {
      const d = this.smsDraft();
      const ok = describeSample(d.sample).ok && d.sender.trim().length >= 3;
      if (d.enabled && !ok) {
        smsNote = 'SMS matching stays off until you enter the bank sender (e.g. UNIONB) and paste a valid sample SMS.';
        this.sms.save({ ...d, enabled: false });
        this.smsDraft.update((x) => ({ ...x, enabled: false }));
      } else {
        this.sms.save({ ...d, sender: d.sender.trim() });
      }
    }
    this.busy.set(true);
    try {
      await this.backend.saveConfig({ ...c, cafePhone: normalizePhone(c.cafePhone) ?? '' });
      this.shop.cfg.set({ ...c, cafePhone: normalizePhone(c.cafePhone) ?? '' });
      this.saved.set(true);
      if (smsNote) this.error.set(smsNote);
    } catch (e) {
      const code = (e as { code?: string })?.code ?? '';
      this.error.set(
        code === 'permission-denied'
          ? 'Not allowed by the database rules. Ask your developer to deploy the latest rules (firestore:rules).'
          : code === 'unauthenticated'
            ? 'You are signed out. Sign in again.'
            : 'Could not save. Check your internet connection and try again.',
      );
    } finally {
      this.busy.set(false);
    }
  }

  protected async findPrinters(): Promise<void> {
    this.printMsg.set('');
    try {
      this.devices.set(await this.printer.devices());
    } catch (e) {
      this.printMsg.set('Could not list printers: allow "Nearby devices" for this app, and switch Bluetooth on.');
    }
    this.searched.set(true);
  }
  private testOrder(): Order {
    const now = Date.now();
    return {
      id: 'sample',
      number: 'JS-TEST',
      customerUid: 'sample',
      customer: { name: 'Sample Customer', phone: '9000000000', address: 'Test address' },
      location: null,
      note: 'Less spicy please',
      lines: [
        { itemId: 'a', name: 'Veg Pizza', sizeLabel: 'Regular', unitPrice: 159, qty: 2, total: 318 },
        { itemId: 'b', name: 'Mojito', sizeLabel: '', unitPrice: 79, qty: 1, total: 79 },
      ],
      subtotal: 397,
      deliveryFee: 0,
      total: 397,
      status: 'accepted',
      paymentMethod: 'COD',
      createdAt: now,
      expiresAt: now,
      history: [],
      orderType: 'dine_in',
      table: '4',
      invoice: { cafeName: this.cfg()?.cafeName ?? 'Juicysukun Cafe', cafePhone: this.cfg()?.cafePhone ?? '', cafeAddress: this.cfg()?.cafeAddress ?? '', fssai: this.cfg()?.fssai ?? '' },
    } as Order;
  }
  protected async testSlip(): Promise<void> {
    this.printMsg.set((await this.printer.printKot(this.testOrder())) ?? 'Kitchen slip sent to the printer.');
  }
  protected async testBill(): Promise<void> {
    this.printMsg.set((await this.printer.printBill([{ ...this.testOrder(), payment: { method: 'cash', at: Date.now() } }])) ?? 'Bill sent to the printer.');
  }
  protected async testPrint(): Promise<void> {
    this.printMsg.set((await this.printer.printTest()) ?? 'Sent to the printer.');
  }

  protected async saveMessage(): Promise<void> {
    await this.shop.set(this.shop.open(), this.message());
  }

  protected async refreshStatus(): Promise<void> {
    if (this.alarm.native) this.st.set(await NativeAlarm.status().catch(() => null));
  }
  protected async fix(what: 'notifications' | 'fullScreen' | 'battery'): Promise<void> {
    if (what === 'notifications') await NativeAlarm.requestNotifications();
    else if (what === 'fullScreen') await NativeAlarm.openFullScreenSettings();
    else await NativeAlarm.openBatterySettings();
    setTimeout(() => void this.refreshStatus(), 1500);
  }
  protected stopTest(): Promise<void> {
    return NativeAlarm.stop();
  }

  protected async logout(): Promise<void> {
    await this.session.signOut();
    await this.router.navigate(['/login']);
  }
}

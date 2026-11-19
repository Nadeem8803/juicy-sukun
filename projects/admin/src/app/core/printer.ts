import { Injectable, inject, signal } from '@angular/core';
import { Capacitor, registerPlugin } from '@capacitor/core';
import { billLines, kotLines, type Order } from '@juicy/shared';
import { OrdersStore } from './orders-store';
import { LOGO_B64, LOGO_HEIGHT, LOGO_WIDTH_BYTES } from './bill-logo';

/** Bridge to the native Bluetooth printer plugin (android-native/BtPrinterPlugin.java). Only exists inside the APK. */
export interface BtPrinterPlugin {
  /** Printers already paired in the phone's Bluetooth settings. */
  list(): Promise<{ devices: { name: string; address: string }[] }>;
  /** Sends raw ESC/POS bytes (base64) to the printer. */
  print(options: { address: string; data: string }): Promise<void>;
}

export const BtPrinter = registerPlugin<BtPrinterPlugin>('BtPrinter');

const KEY = 'js.printer.v1';

/** Thermal printers only know plain ASCII: turn ₹ into Rs. and drop anything else unusual. */
export function toAscii(s: string): string {
  return s
    .replace(/₹/g, 'Rs.')
    .normalize('NFKD')
    .replace(/[^\x20-\x7E\n]/g, '');
}

const ESC = 0x1b;
const GS = 0x1d;

/** The cafe logo as an ESC/POS raster image (GS v 0), centred, followed by normal text settings. */
function logoBytes(): number[] {
  const bin = atob(LOGO_B64);
  const data: number[] = [];
  for (let i = 0; i < bin.length; i++) data.push(bin.charCodeAt(i));
  return [ESC, 0x61, 1, GS, 0x76, 0x30, 0, LOGO_WIDTH_BYTES & 255, LOGO_WIDTH_BYTES >> 8, LOGO_HEIGHT & 255, LOGO_HEIGHT >> 8, ...data, ESC, 0x61, 0];
}

/** ESC/POS bytes for a 58 mm receipt. `big` prints the first lines double size. `logo` puts the cafe logo on top. */
export function escposBytes(lines: string[], big = 0, logo = false): Uint8Array {
  const out: number[] = [ESC, 0x40]; // initialise
  const enc = new TextEncoder();
  if (logo) out.push(...logoBytes());
  lines.forEach((line, i) => {
    if (i < big) out.push(GS, 0x21, 0x11); // double width + height
    else if (i === big && big > 0) out.push(GS, 0x21, 0x00);
    out.push(...enc.encode(toAscii(line) + '\n'));
  });
  out.push(GS, 0x21, 0x00, 0x0a, 0x0a, 0x0a); // normal size + feed so the tear-off clears the text
  return Uint8Array.from(out);
}

/**
 * Kitchen slip: table / delivery in double size, the items (and note) double height so they read from across the
 * kitchen. Everything between the first and last dashed line is an item or the note.
 */
export function kotBytes(lines: string[]): Uint8Array {
  const out: number[] = [ESC, 0x40];
  const enc = new TextEncoder();
  const firstRule = lines.findIndex((l) => l.startsWith('---'));
  lines.forEach((line, i) => {
    if (i === 0) out.push(GS, 0x21, 0x11);
    else if (i === 1) out.push(GS, 0x21, 0x00);
    const isItem = firstRule > 0 && i > firstRule && i < lines.length - 1;
    if (isItem) out.push(GS, 0x21, 0x01, ESC, 0x45, 1); // double height + bold
    out.push(...enc.encode(toAscii(line) + '\n'));
    if (isItem) out.push(GS, 0x21, 0x00, ESC, 0x45, 0);
  });
  out.push(GS, 0x21, 0x00, 0x0a, 0x0a, 0x0a);
  return Uint8Array.from(out);
}

function b64(bytes: Uint8Array): string {
  let s = '';
  bytes.forEach((b) => (s += String.fromCharCode(b)));
  return btoa(s);
}

@Injectable({ providedIn: 'root' })
export class PrinterService {
  /** The plugin only exists in the APK build that includes it. */
  readonly available = Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('BtPrinter');
  private readonly saved = (() => {
    try {
      return JSON.parse(localStorage.getItem(KEY) ?? '{}') as { address?: string; name?: string; autoKot?: boolean; kotAuto?: boolean; billAuto?: boolean };
    } catch {
      return {};
    }
  })();
  readonly address = signal(this.saved.address ?? '');
  readonly name = signal(this.saved.name ?? '');
  /** Print a kitchen slip automatically when an order is accepted. */
  readonly autoKot = signal(this.saved.kotAuto ?? true);
  /** Print the bill automatically when a payment is confirmed. */
  readonly autoBill = signal(this.saved.billAuto ?? true);

  /** Result of the last automatic bill print, shown on the Orders screen so a failure is never silent. */
  readonly autoMessage = signal('');
  /** Prints go one after another: two jobs at once (slip + bill) would fight over the Bluetooth link. */
  private queue: Promise<unknown> = Promise.resolve();

  private persist(): void {
    try {
      localStorage.setItem(KEY, JSON.stringify({ address: this.address(), name: this.name(), kotAuto: this.autoKot(), billAuto: this.autoBill() }));
    } catch {
      /* ignore */
    }
  }

  setPrinter(address: string, name: string): void {
    this.address.set(address);
    this.name.set(name);
    this.persist();
  }
  setAutoKot(on: boolean): void {
    this.autoKot.set(on);
    this.persist();
  }

  setAutoBill(on: boolean): void {
    this.autoBill.set(on);
    this.persist();
  }

  constructor() {
    inject(OrdersStore).onPaid((bill) => {
      if (!this.autoBill() || !this.available) return;
      if (!this.address()) {
        this.autoMessage.set('Bill not printed: choose your printer first (Settings → Printer).');
        return;
      }
      void this.printBill(bill).then((m) => this.autoMessage.set(m ? `Bill not printed. ${m}` : '🧾 Bill sent to the printer.'));
    });
  }

  async devices(): Promise<{ name: string; address: string }[]> {
    return (await BtPrinter.list()).devices;
  }

  /** Returns null on success, otherwise a short message the owner can read. */
  private async send(bytes: Uint8Array): Promise<string | null> {
    if (!this.available) return 'Printing is not available in this app build yet.';
    if (!this.address()) return 'Choose your printer first (Settings → Printer).';
    const job = this.queue.then(() => this.sendNow(bytes));
    this.queue = job.catch(() => undefined);
    return job;
  }

  /** One try, then a second try after a moment (the Bluetooth link often needs a second go). */
  private async sendNow(bytes: Uint8Array): Promise<string | null> {
    let last = '';
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await BtPrinter.print({ address: this.address(), data: b64(bytes) });
        return null;
      } catch (e) {
        last = e instanceof Error ? e.message : String(e);
        if (attempt === 0) await new Promise((r) => setTimeout(r, 1200));
      }
    }
    return `Could not print. Switch the printer on, keep it close to the phone, then try again. (${last})`;
  }

  printBill(orders: Order[]): Promise<string | null> {
    return this.send(escposBytes(billLines(orders, 32, true), 0, true));
  }
  printKot(order: Order, addOn = false): Promise<string | null> {
    return this.send(kotBytes(kotLines(order, 32, addOn)));
  }
  printTest(): Promise<string | null> {
    return this.send(escposBytes(['Printer test OK', '-'.repeat(32), 'Rs.123  1234567890', ''], 0, true));
  }
}

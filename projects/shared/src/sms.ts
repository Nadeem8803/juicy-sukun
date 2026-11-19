/**
 * Reading a bank's "credited" SMS so the owner can confirm a UPI payment with one tap.
 * Works with wording like  "A/c *4484 Credited for Rs:533.00 on 08-11-2026 15:51:39 by Mob Bk ref no 322005888207 Avl Bal Rs:15910.80"
 * and tolerates other banks ("Rs.", "INR", "₹", "credited with", ...). Never guesses: returns null when unsure.
 */
export interface ParsedCredit {
  /** Rupees. */
  amount: number;
  /** The bank's reference number, if the message has one. Used so one SMS can never confirm two orders. */
  ref?: string;
  /** Time written in the SMS (epoch ms), if present. */
  at?: number;
}

const CREDIT = /\b(?:credit(?:ed)?|deposit(?:ed)?|received)\b/i;
const DEBIT = /\b(?:debit(?:ed)?|withdr(?:a|e)wn|spent|sent|paid)\b/i;
const MONEY = /(?:Rs\.?|INR|₹)\s*:?\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/gi;

export function parseCreditSms(raw: string): ParsedCredit | null {
  const text = String(raw ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return null;
  const credit = CREDIT.exec(text);
  if (!credit) return null;
  const debit = DEBIT.exec(text);
  if (debit && debit.index < credit.index) return null; // "Debited ... credited to X": money went out
  if (/\b(?:otp|one time password)\b/i.test(text) && !/credit/i.test(text)) return null;

  let amount: number | null = null;
  for (const m of text.matchAll(MONEY)) {
    const before = text.slice(Math.max(0, (m.index ?? 0) - 14), m.index ?? 0);
    if (/\b(?:bal(?:ance)?|avl|avail(?:able)?|limit)\b/i.test(before)) continue; // the balance is not the payment
    const n = Number(m[1]!.replace(/,/g, ''));
    if (Number.isFinite(n) && n > 0) {
      amount = Math.round(n * 100) / 100;
      break;
    }
  }
  if (amount === null) return null;

  const ref = /\bref(?:erence)?\.?\s*(?:no\.?|number|#)?\s*[:\-]?\s*([0-9]{6,})/i.exec(text)?.[1] ?? /\bUPI\/(?:CR\/)?([0-9]{8,})/i.exec(text)?.[1];
  const d = /(\d{2})-(\d{2})-(\d{4})\s+(\d{2}):(\d{2}):(\d{2})/.exec(text);
  let at: number | undefined;
  if (d) {
    // The SMS time is India time (UTC+5:30).
    at = Date.UTC(+d[3]!, +d[2]! - 1, +d[1]!, +d[4]!, +d[5]!, +d[6]!) - 5.5 * 3600_000;
  }
  return { amount, ...(ref ? { ref } : {}), ...(at ? { at } : {}) };
}

/** What the app understood from the owner's pasted sample (shown in Settings). */
export function describeSample(sample: string): { ok: boolean; message: string; parsed?: ParsedCredit } {
  const t = String(sample ?? '').trim();
  if (!t) return { ok: false, message: 'Paste one real "credited" SMS from your bank.' };
  const parsed = parseCreditSms(t);
  if (!parsed) return { ok: false, message: "Couldn't find a credited amount in this message. Paste an SMS that says money was credited." };
  const bits = [`amount ₹${parsed.amount.toFixed(2)}`, parsed.ref ? `ref ${parsed.ref}` : 'no reference number'];
  return { ok: true, message: `Understood: ${bits.join(', ')}`, parsed };
}

/** The sender name looks like "JM-UNIONB-S": match when it contains the owner's keyword (any case). */
export function senderMatches(sender: string, keyword: string): boolean {
  const k = keyword.trim().toLowerCase();
  return !!k && String(sender ?? '').toLowerCase().includes(k);
}

/** Something the owner could be paid for: a table bill or a delivery order. */
export interface Payable {
  /** The order the payment would be recorded on (the oldest accepted order of the bill). */
  id: string;
  number: string;
  /** Who it is for, e.g. "Table 4 · Ayesha" (shown on the buttons). */
  label?: string;
  amount: number;
  /** Amount including the paise tag the customer was asked to pay (only when the owner turned that on). */
  exactAmount?: number;
  createdAt: number;
  /** When the customer tapped "I have paid". */
  claimAt?: number;
}

export interface CreditMatch {
  kind: 'one' | 'many' | 'none';
  payables: Payable[];
}

/**
 * Which unpaid orders could this credit be for? Same amount, not older than `windowMin` minutes, and placed before the money arrived.
 * Orders whose customer said "I have paid" come first; if any such order exists only those are offered.
 */
export function matchCredit(credit: ParsedCredit, payables: readonly Payable[], opts: { now: number; windowMin: number; receivedAt?: number }): CreditMatch {
  const when = credit.at ?? opts.receivedAt ?? opts.now;
  const windowMs = Math.max(1, opts.windowMin) * 60_000;
  // A paise-tagged amount (e.g. 318.07) belongs to exactly one order.
  const exact = payables.filter((p) => p.exactAmount !== undefined && Math.abs(p.exactAmount - credit.amount) < 0.005 && when >= p.createdAt - 60_000);
  if (exact.length === 1) return { kind: 'one', payables: exact };
  const same = payables.filter((p) => Math.abs(p.amount - credit.amount) < 0.005 && when >= p.createdAt - 60_000);
  const recent = same.filter((p) => (p.claimAt ?? p.createdAt) >= when - windowMs * 6 && opts.now - when <= windowMs * 6);
  const claimed = recent.filter((p) => p.claimAt && Math.abs(when - p.claimAt) <= windowMs);
  const pick = claimed.length ? claimed : recent;
  if (pick.length === 0) return { kind: 'none', payables: [] };
  return { kind: pick.length === 1 ? 'one' : 'many', payables: [...pick].sort((a, b) => (b.claimAt ?? 0) - (a.claimAt ?? 0) || a.createdAt - b.createdAt) };
}

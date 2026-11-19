import { istDay, istHour, istDayStart } from '@juicy/shared';
import type { Firestore } from './firestore-deps';

export interface TrackBody {
  sid?: string;
  vid?: string;
  table?: string;
  startedAt?: number;
  flags?: { cart?: boolean; checkout?: boolean; ordered?: boolean };
  events?: { t?: number; k?: string; d?: string }[];
}

const ID = /^[A-Za-z0-9_-]{8,40}$/;
const FLAGS = ['cart', 'checkout', 'ordered'] as const;

/**
 * Records one visit to the customer site. ONE visit document per visit (replaced on each flush) plus a few
 * per-day counters, so a busy day stays far below the free Firestore limits. Raw visits are archived weekly.
 */
export async function trackVisit(db: Firestore, body: TrackBody, now: number): Promise<void> {
  const sid = body?.sid ?? '';
  const vid = body?.vid ?? '';
  if (!ID.test(sid) || !ID.test(vid)) return;
  const day = istDay(now);
  const events = (Array.isArray(body.events) ? body.events : [])
    .slice(0, 80)
    .map((e) => ({ t: Math.max(0, Math.min(now, Number(e?.t) || now)), k: String(e?.k ?? '').slice(0, 24), ...(e?.d ? { d: String(e.d).slice(0, 40) } : {}) }))
    .filter((e) => e.k);
  const table = typeof body.table === 'string' ? body.table.replace(/[^A-Za-z0-9 -]/g, '').slice(0, 12) : '';
  const flags = { cart: body.flags?.cart === true, checkout: body.flags?.checkout === true, ordered: body.flags?.ordered === true };

  const prev = await db.get(`visits/${sid}`);
  const prevFlags = (prev?.['flags'] ?? {}) as Record<string, boolean>;
  const inc: Record<string, number> = {};

  if (!prev) {
    inc['sessions'] = 1;
    inc[`h${String(istHour(now)).padStart(2, '0')}`] = 1;
    if (table) inc['qr'] = 1;
    const v = await db.get(`visitors/${vid}`);
    if (!v) {
      inc['visitors'] = 1;
      inc['newVisitors'] = 1;
      await db.mergeInc(`visitors/${vid}`, { firstDay: day, lastDay: day }, { visits: 1, days: 1 });
    } else if (v['lastDay'] !== day) {
      inc['visitors'] = 1;
      inc['returning'] = 1;
      await db.mergeInc(`visitors/${vid}`, { lastDay: day }, { visits: 1, days: 1 });
    } else {
      await db.mergeInc(`visitors/${vid}`, {}, { visits: 1 });
    }
  }
  for (const f of FLAGS) if (flags[f] && !prevFlags[f]) inc[f] = (inc[f] ?? 0) + 1;

  const keep = [...(Array.isArray(prev?.['events']) ? (prev!['events'] as unknown[]) : []), ...events].slice(-200);
  await Promise.all([
    db.set(`visits/${sid}`, {
      sid,
      vid,
      day,
      startedAt: typeof prev?.['startedAt'] === 'number' ? prev['startedAt'] : now,
      updatedAt: now,
      ...(table ? { table } : {}),
      flags: { ...prevFlags, ...Object.fromEntries(FLAGS.filter((f) => flags[f]).map((f) => [f, true])) },
      events: keep,
    }),
    Object.keys(inc).length ? db.mergeInc(`daily/${day}`, { day }, inc) : Promise.resolve(),
  ]);
}

/** Monday 00:00 (India) of the week that contains `now`. */
export function weekStartOf(now: number): number {
  const dayStart = istDayStart(now);
  const dow = new Date(dayStart + 5.5 * 3600_000).getUTCDay(); // 0 = Sunday
  return dayStart - ((dow + 6) % 7) * 86_400_000;
}

async function gzip(text: string): Promise<ArrayBuffer> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Response(stream).arrayBuffer();
}

/**
 * Weekly clean-up (Monday ~3 am India): packs last week's raw visits into one small gzip file kept in KV,
 * then deletes them from Firestore. The per-day counters (daily/*) stay forever and feed the analytics screens.
 */
export async function archiveOldVisits(db: Firestore, kv: KVNamespace, now: number): Promise<number> {
  const weekStart = weekStartOf(now);
  const all = await db.list('visits');
  const old = all.filter((v) => (Number(v.data['startedAt']) || 0) < weekStart);
  if (old.length) {
    const label = istDay(weekStart - 7 * 86_400_000);
    await kv.put(`archive/visits-${label}.json.gz`, await gzip(JSON.stringify({ weekOf: label, visits: old.map((v) => v.data) })));
    for (let i = 0; i < old.length; i += 10) {
      await Promise.all(old.slice(i, i + 10).map((v) => db.delete(`visits/${v.id}`).catch(() => undefined)));
    }
  }
  await db.set('meta/rollup', { lastWeek: istDay(weekStart), at: now, archived: old.length });
  return old.length;
}

import {
  DEFAULT_PRIVATE_CONFIG,
  DEFAULT_PUBLIC_CONFIG,
  DomainError,
  type AppConfig,
  type MenuItem,
  type Order,
  type ShopStatus,
} from '@juicy/shared';
import type { Deps } from '../../functions/src/core';

type FsValue = Record<string, unknown>;
type FsFields = Record<string, FsValue>;
type FsDoc = { name: string; fields?: FsFields; updateTime?: string };

// ---------- value conversion ----------

export function toFs(v: unknown): FsValue {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === 'string') return { stringValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toFs) } };
  if (typeof v === 'object') return { mapValue: { fields: toFsFields(v as Record<string, unknown>) } };
  throw new Error('Unsupported value type');
}

export function toFsFields(o: Record<string, unknown>): FsFields {
  const out: FsFields = {};
  for (const [k, v] of Object.entries(o)) if (v !== undefined) out[k] = toFs(v);
  return out;
}

export function fromFs(v: FsValue): unknown {
  if ('nullValue' in v) return null;
  if ('booleanValue' in v) return v['booleanValue'];
  if ('integerValue' in v) return Number(v['integerValue']);
  if ('doubleValue' in v) return v['doubleValue'];
  if ('stringValue' in v) return v['stringValue'];
  if ('timestampValue' in v) return Date.parse(v['timestampValue'] as string);
  if ('arrayValue' in v) return ((v['arrayValue'] as { values?: FsValue[] }).values ?? []).map(fromFs);
  if ('mapValue' in v) return fromFsFields((v['mapValue'] as { fields?: FsFields }).fields ?? {});
  return null;
}

export function fromFsFields(f: FsFields): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(f)) out[k] = fromFs(v);
  return out;
}

function docId(name: string): string {
  return name.slice(name.lastIndexOf('/') + 1);
}

function randomId(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = crypto.getRandomValues(new Uint8Array(20));
  return Array.from(bytes, (b) => chars[b % chars.length]).join('');
}

// ---------- REST client ----------

export class Firestore {
  private readonly base: string;
  private readonly root: string;

  constructor(
    private readonly projectId: string,
    private readonly token: string,
  ) {
    this.root = `projects/${projectId}/databases/(default)/documents`;
    this.base = `https://firestore.googleapis.com/v1/${this.root}`;
  }

  private async call<T>(url: string, init?: RequestInit): Promise<T> {
    const res = await fetch(url, {
      ...init,
      headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' },
    });
    if (!res.ok) {
      const text = await res.text();
      const err = new Error(`Firestore ${res.status}: ${text}`) as Error & { status: number };
      err.status = res.status;
      throw err;
    }
    return (await res.json()) as T;
  }

  /** Returns the document's data, or null if it does not exist. */
  async get(path: string): Promise<Record<string, unknown> | null> {
    try {
      const d = await this.call<FsDoc>(`${this.base}/${path}`);
      return fromFsFields(d.fields ?? {});
    } catch (e) {
      if ((e as { status?: number }).status === 404) return null;
      throw e;
    }
  }

  /** Like get(), but also returns the version stamp used to detect concurrent changes. */
  async getWithVersion(path: string): Promise<{ data: Record<string, unknown>; updateTime: string } | null> {
    try {
      const d = await this.call<FsDoc>(`${this.base}/${path}`);
      return { data: fromFsFields(d.fields ?? {}), updateTime: d.updateTime ?? '' };
    } catch (e) {
      if ((e as { status?: number }).status === 404) return null;
      throw e;
    }
  }

  /** Atomically adds `by` to a number field in ONE request and returns the new value. */
  async increment(path: string, field: string, by = 1): Promise<number> {
    const r = await this.call<{ writeResults?: { transformResults?: FsValue[] }[] }>(`${this.base}:commit`, {
      method: 'POST',
      body: JSON.stringify({
        writes: [
          {
            update: { name: `${this.root}/${path}` },
            updateMask: { fieldPaths: [] },
            updateTransforms: [{ fieldPath: field, increment: { integerValue: String(by) } }],
          },
        ],
      }),
    });
    return Number(r.writeResults?.[0]?.transformResults?.[0]?.['integerValue']);
  }

  /** Sets some fields (keeping the rest) and adds to some counters, all in ONE request. Creates the document if missing. */
  async mergeInc(path: string, data: Record<string, unknown>, inc: Record<string, number> = {}): Promise<void> {
    const keys = Object.keys(data).filter((k) => data[k] !== undefined);
    await this.call(`${this.base}:commit`, {
      method: 'POST',
      body: JSON.stringify({
        writes: [
          {
            update: { name: `${this.root}/${path}`, fields: toFsFields(data) },
            updateMask: { fieldPaths: keys.map(quoteField) },
            updateTransforms: Object.entries(inc).map(([fieldPath, by]) => ({ fieldPath: quoteField(fieldPath), increment: { integerValue: String(by) } })),
          },
        ],
      }),
    });
  }

  /** Writes fields only if the document is unchanged since `updateTime` (no separate transaction needed). */
  async updateIfUnchanged(path: string, data: Record<string, unknown>, updateTime: string): Promise<void> {
    await this.call(`${this.base}:commit`, {
      method: 'POST',
      body: JSON.stringify({
        writes: [
          {
            update: { name: `${this.root}/${path}`, fields: toFsFields(data) },
            updateMask: { fieldPaths: Object.keys(data).filter((k) => data[k] !== undefined).map(quoteField) },
            currentDocument: { updateTime },
          },
        ],
      }),
    });
  }

  async list(collection: string): Promise<{ id: string; data: Record<string, unknown> }[]> {
    const out: { id: string; data: Record<string, unknown> }[] = [];
    let pageToken = '';
    do {
      const q = `?pageSize=300${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`;
      const r = await this.call<{ documents?: FsDoc[]; nextPageToken?: string }>(`${this.base}/${collection}${q}`);
      for (const d of r.documents ?? []) out.push({ id: docId(d.name), data: fromFsFields(d.fields ?? {}) });
      pageToken = r.nextPageToken ?? '';
    } while (pageToken);
    return out;
  }

  /** Runs a structured query with one or two equality filters. */
  async queryEquals(
    collection: string,
    filters: [string, string][],
  ): Promise<{ id: string; data: Record<string, unknown> }[]> {
    const where =
      filters.length === 1
        ? fieldFilter(filters[0])
        : { compositeFilter: { op: 'AND', filters: filters.map(fieldFilter) } };
    const r = await this.call<{ document?: FsDoc }[]>(`${this.base}:runQuery`, {
      method: 'POST',
      body: JSON.stringify({ structuredQuery: { from: [{ collectionId: collection }], where } }),
    });
    return r
      .filter((x) => x.document)
      .map((x) => ({ id: docId(x.document!.name), data: fromFsFields(x.document!.fields ?? {}) }));
  }

  async set(path: string, data: Record<string, unknown>): Promise<void> {
    await this.call(`${this.base}/${path}`, { method: 'PATCH', body: JSON.stringify({ fields: toFsFields(data) }) });
  }

  async delete(path: string): Promise<void> {
    await this.call(`${this.base}/${path}`, { method: 'DELETE' });
  }

  // ----- transactions -----

  async begin(): Promise<string> {
    const r = await this.call<{ transaction: string }>(`${this.base}:beginTransaction`, {
      method: 'POST',
      body: JSON.stringify({ options: { readWrite: {} } }),
    });
    return r.transaction;
  }

  async getInTx(path: string, tx: string): Promise<Record<string, unknown> | null> {
    try {
      const d = await this.call<FsDoc>(`${this.base}/${path}?transaction=${encodeURIComponent(tx)}`);
      return fromFsFields(d.fields ?? {});
    } catch (e) {
      if ((e as { status?: number }).status === 404) return null;
      throw e;
    }
  }

  /** Writes whole fields of a document (merging with existing ones) as part of the transaction. */
  async commit(tx: string, writes: { path: string; data: Record<string, unknown> }[]): Promise<void> {
    await this.call(`${this.base}:commit`, {
      method: 'POST',
      body: JSON.stringify({
        transaction: tx,
        writes: writes.map((w) => ({
          update: { name: `${this.root}/${w.path}`, fields: toFsFields(w.data) },
          updateMask: { fieldPaths: Object.keys(w.data).filter((k) => w.data[k] !== undefined).map(quoteField) },
        })),
      }),
    });
  }

  async rollback(tx: string): Promise<void> {
    await this.call(`${this.base}:rollback`, { method: 'POST', body: JSON.stringify({ transaction: tx }) }).catch(
      () => undefined,
    );
  }

  /** Runs `fn` in a transaction, retrying a few times when another request changed the same data. */
  async transact<T>(fn: (tx: string) => Promise<{ result: T; writes: { path: string; data: Record<string, unknown> }[] }>): Promise<T> {
    let lastError: unknown;
    for (let attempt = 0; attempt < 5; attempt++) {
      const tx = await this.begin();
      try {
        const { result, writes } = await fn(tx);
        await this.commit(tx, writes);
        return result;
      } catch (e) {
        await this.rollback(tx);
        const status = (e as { status?: number }).status;
        if (status === 409 || status === 400 || status === 429) {
          lastError = e;
          continue;
        }
        throw e;
      }
    }
    throw lastError;
  }
}

function quoteField(name: string): string {
  return /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name) ? name : `\`${name.replace(/`/g, '\\`')}\``;
}

function fieldFilter([field, value]: [string, string]) {
  return { fieldFilter: { field: { fieldPath: field }, op: 'EQUAL', value: { stringValue: value } } };
}

// ---------- Deps implementation ----------

// Cafe settings change rarely: remember them for 30 seconds between requests.
let configCache: { at: number; value: AppConfig } | null = null;

export function createRestDeps(db: Firestore): Deps {
  return {
    async getShop(): Promise<ShopStatus> {
      const d = await db.get('shop/status');
      return d ? (d as unknown as ShopStatus) : { open: false };
    },

    async getMenu(): Promise<MenuItem[]> {
      const docs = await db.list('menu');
      return docs.map((d) => ({ ...(d.data as Omit<MenuItem, 'id'>), id: d.id }));
    },

    async getConfig(): Promise<AppConfig> {
      if (configCache && Date.now() - configCache.at < 30_000) return configCache.value;
      const [pub, priv] = await Promise.all([db.get('config/public'), db.get('config/private')]);
      const value = { ...DEFAULT_PUBLIC_CONFIG, ...DEFAULT_PRIVATE_CONFIG, ...(pub ?? {}), ...(priv ?? {}) } as AppConfig;
      configCache = { at: Date.now(), value };
      return value;
    },

    async isPhoneBlocked(phone: string): Promise<boolean> {
      return (await db.get(`blockedPhones/${encodeURIComponent(phone)}`)) !== null;
    },

    async countPendingOrders(uid: string): Promise<number> {
      const docs = await db.queryEquals('orders', [
        ['customerUid', uid],
        ['status', 'pending'],
      ]);
      return docs.length;
    },

    async allocate() {
      // One request instead of three (begin + read + commit).
      const n = await db.increment('meta/counters', 'order');
      return { id: randomId(), number: `JS-${n}` };
    },

    async saveOrder(order: Order): Promise<void> {
      await db.set(`orders/${order.id}`, order as unknown as Record<string, unknown>);
    },

    async updateOrder(orderId, compute) {
      // Read once, then write only if nobody changed the order meanwhile (2 requests instead of 3).
      let lastError: unknown;
      for (let attempt = 0; attempt < 5; attempt++) {
        const snap = await db.getWithVersion(`orders/${orderId}`);
        if (!snap) throw new DomainError('not_found', 'Order not found');
        const current = { ...(snap.data as object), id: orderId } as Order;
        const patch = compute(current);
        try {
          await db.updateIfUnchanged(`orders/${orderId}`, patch as Record<string, unknown>, snap.updateTime);
          return { ...current, ...patch } as Order;
        } catch (e) {
          const status = (e as { status?: number }).status;
          if (status === 409 || status === 400 || status === 412 || status === 429) {
            lastError = e;
            continue;
          }
          throw e;
        }
      }
      throw lastError;
    },

    async findOpenBill(table: string): Promise<string | null> {
      const docs = await db.queryEquals('orders', [
        ['table', table],
        ['billState', 'open'],
      ]);
      const open = docs
        .map((d) => d.data as { billId?: string; createdAt?: number })
        .filter((d) => typeof d.billId === 'string')
        .sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
      return open[0]?.billId ?? null;
    },

    async listBillOrders(billId: string): Promise<Order[]> {
      const docs = await db.queryEquals('orders', [['billId', billId]]);
      return docs.map((d) => ({ ...(d.data as object), id: d.id }) as Order);
    },

    async publishReview(r) {
      await db.set(`reviews/${r.id}`, r as unknown as Record<string, unknown>);
    },

    async getCustomer(phone: string) {
      const d = await db.get(`customers/${encodeURIComponent(phone)}`);
      return d ? { orders: Number(d['orders']) || 0 } : null;
    },

    async touchCustomer({ phone, name, optIn, now }) {
      const path = `customers/${encodeURIComponent(phone)}`;
      const cur = await db.get(path);
      await db.mergeInc(path, { phone, name, lastAt: now, ...(cur ? {} : { firstAt: now, optIn: false }), ...(optIn !== undefined ? { optIn } : {}) }, { placed: 1 });
    },

    async recordCompleted({ phone, name, total, now }) {
      await db.mergeInc(`customers/${encodeURIComponent(phone)}`, { phone, name, lastAt: now }, { orders: 1, spent: total });
    },

    async listPendingOrders(): Promise<Order[]> {
      const docs = await db.queryEquals('orders', [['status', 'pending']]);
      return docs.map((d) => ({ ...(d.data as object), id: d.id }) as Order);
    },
  };
}
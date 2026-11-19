export interface Actor {
  uid: string;
  isAdmin: boolean;
}

export class AuthError extends Error {}

const JWK_URL = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';

let cache: { keys: Map<string, CryptoKey>; fetchedAt: number } | null = null;

function b64urlToBytes(s: string): Uint8Array {
  const b = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b + '='.repeat((4 - (b.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function parsePart(part: string): Record<string, unknown> {
  return JSON.parse(new TextDecoder().decode(b64urlToBytes(part)));
}

async function getKey(kid: string): Promise<CryptoKey | null> {
  const fresh = cache && Date.now() - cache.fetchedAt < 3_600_000;
  if (fresh && cache!.keys.has(kid)) return cache!.keys.get(kid)!;
  // Cloudflare keeps Google's key list at the edge for an hour, so a cold start does not re-download it.
  const res = await fetch(JWK_URL, { cf: { cacheTtl: 3600, cacheEverything: true } } as RequestInit);
  if (!res.ok) throw new AuthError('Could not load signing keys');
  const body = (await res.json()) as { keys: (JsonWebKey & { kid: string })[] };
  const entries = await Promise.all(
    body.keys.map(
      async (jwk) =>
        [
          jwk.kid,
          await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']),
        ] as const,
    ),
  );
  const keys = new Map<string, CryptoKey>(entries);
  cache = { keys, fetchedAt: Date.now() };
  return keys.get(kid) ?? null;
}

/** Verifies a Firebase ID token and returns who is calling. Throws AuthError if anything is off. */
export async function verifyIdToken(token: string, projectId: string): Promise<Actor> {
  const parts = token.split('.');
  if (parts.length !== 3) throw new AuthError('Malformed token');
  const [h, p, s] = parts;

  let header: Record<string, unknown>;
  let payload: Record<string, unknown>;
  try {
    header = parsePart(h);
    payload = parsePart(p);
  } catch {
    throw new AuthError('Malformed token');
  }

  if (header['alg'] !== 'RS256' || typeof header['kid'] !== 'string') throw new AuthError('Bad token header');

  const key = await getKey(header['kid']);
  if (!key) throw new AuthError('Unknown signing key');

  const ok = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    key,
    b64urlToBytes(s),
    new TextEncoder().encode(`${h}.${p}`),
  );
  if (!ok) throw new AuthError('Bad signature');

  const now = Math.floor(Date.now() / 1000);
  const exp = payload['exp'];
  const iat = payload['iat'];
  const sub = payload['sub'];
  if (typeof exp !== 'number' || exp <= now) throw new AuthError('Token expired');
  if (typeof iat !== 'number' || iat > now + 60) throw new AuthError('Token issued in the future');
  if (payload['aud'] !== projectId) throw new AuthError('Wrong audience');
  if (payload['iss'] !== `https://securetoken.google.com/${projectId}`) throw new AuthError('Wrong issuer');
  if (typeof sub !== 'string' || !sub) throw new AuthError('No subject');

  return { uid: sub, isAdmin: payload['admin'] === true };
}
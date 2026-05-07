/**
 * Simple in-memory TTL cache for heavy SQL queries.
 * Keyed by string; values arbitrary. Persists across requests within one Node process.
 */
type Entry<T> = { value: T; expiresAt: number };
const store = new Map<string, Entry<any>>();

export async function cached<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const hit = store.get(key);
  if (hit && hit.expiresAt > now) return hit.value as T;
  const value = await fn();
  store.set(key, { value, expiresAt: now + ttlMs });
  return value;
}

export function invalidateCache(prefix?: string) {
  if (!prefix) { store.clear(); return; }
  for (const k of store.keys()) {
    if (k.startsWith(prefix)) store.delete(k);
  }
}

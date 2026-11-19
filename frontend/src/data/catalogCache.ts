import { api } from "./api";

// Only public catalog metadata belongs here. Account-owned state is always fetched fresh.
const TTL_MS = 5 * 60 * 1000;
const MAX_ENTRIES = 200;
const cache = new Map<string, { expires: number; promise: Promise<unknown> }>();

export function cachedCatalog<T>(path: string): Promise<T> {
  if (!path.startsWith("/api/catalog/")) throw new Error("Only public catalog paths can be cached.");
  const existing = cache.get(path);
  if (existing && existing.expires > Date.now()) {
    cache.delete(path);
    cache.set(path, existing);
    return existing.promise as Promise<T>;
  }
  cache.delete(path);
  const entry = { expires: Infinity, promise: Promise.resolve() as Promise<unknown> };
  entry.promise = api<T>(path).then(data => {
    entry.expires = Date.now() + TTL_MS;
    return data;
  }, error => {
    if (cache.get(path) === entry) cache.delete(path);
    throw error;
  });
  cache.set(path, entry);
  while (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value!);
  return entry.promise as Promise<T>;
}

export function clearCatalogCache() { cache.clear(); }

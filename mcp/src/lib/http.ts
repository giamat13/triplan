// Cached, de-duplicated, timeout-protected JSON fetching shared by both data sources.

export class UpstreamError extends Error {
  constructor(
    message: string,
    public readonly source: string,
    public readonly status?: number,
  ) {
    super(message);
  }
}

interface Entry {
  expires: number;
  value: unknown;
}

const TTL_MS = 60 * 60 * 1000; // 1 hour
const ERROR_TTL_MS = 30 * 1000; // remember failures briefly so we don't hammer a dead API
const TIMEOUT_MS = 8000;
const MAX_ENTRIES = 500;

const cache = new Map<string, Entry>();
const inflight = new Map<string, Promise<unknown>>();
const failures = new Map<string, { expires: number; error: UpstreamError }>();

function prune() {
  if (cache.size <= MAX_ENTRIES) return;
  const now = Date.now();
  for (const [k, v] of cache) if (v.expires < now) cache.delete(k);
  while (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value as string);
}

export const getJson = <T>(url: string, source: string, ttl = TTL_MS, timeoutMs = TIMEOUT_MS): Promise<T> =>
  fetchCached<T>(url, source, ttl, "application/json", (res) => res.json() as Promise<T>, timeoutMs);

/** Same cache/timeout/error handling for text bodies (RSS). Live sources pass a short ttl. */
export const getText = (url: string, source: string, ttl = TTL_MS): Promise<string> =>
  fetchCached<string>(url, source, ttl, "application/rss+xml,application/xml;q=0.9,*/*;q=0.5", (res) => res.text());

async function fetchCached<T>(url: string, source: string, ttl: number, accept: string, parse: (res: Response) => Promise<T>, timeoutMs = TIMEOUT_MS): Promise<T> {
  const now = Date.now();
  const hit = cache.get(url);
  if (hit && hit.expires > now) return hit.value as T;

  const failed = failures.get(url);
  if (failed && failed.expires > now) throw failed.error;

  const pending = inflight.get(url);
  if (pending) return pending as Promise<T>;

  const p = (async () => {
    try {
      const res = await fetch(url, {
        headers: { accept, "user-agent": "hogwarts-mcp/1.0" },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.status === 429) {
        throw new UpstreamError(
          `${source} rate limit reached (HTTP 429). Please wait a few minutes and try again.`,
          source,
          429,
        );
      }
      if (res.status === 404) throw new UpstreamError(`${source}: not found (HTTP 404).`, source, 404);
      if (!res.ok) throw new UpstreamError(`${source} returned HTTP ${res.status}.`, source, res.status);
      const value = await parse(res);
      cache.set(url, { value, expires: Date.now() + ttl });
      prune();
      return value;
    } catch (e) {
      const err =
        e instanceof UpstreamError
          ? e
          : new UpstreamError(
              e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError")
                ? `${source} did not respond within ${timeoutMs / 1000}s.`
                : `${source} is unreachable (${e instanceof Error ? e.message : String(e)}).`,
              source,
            );
      if (err.status !== 404) failures.set(url, { error: err, expires: Date.now() + ERROR_TTL_MS });
      throw err;
    } finally {
      inflight.delete(url);
    }
  })();
  inflight.set(url, p);
  return p;
}

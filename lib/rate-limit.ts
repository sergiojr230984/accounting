/**
 * In-memory sliding-window rate limiter.
 *
 * Suitable for a single Railway instance. If you scale to multiple replicas,
 * swap this implementation for Upstash Redis or a similar distributed store
 * — the call sites only depend on the `rateLimit()` function signature.
 */

export interface RateLimitOptions {
  windowMs: number;
  max: number;
}

export interface RateLimitResult {
  ok: boolean;
  remaining: number;
  retryAfterMs: number;
}

interface Bucket {
  timestamps: number[];
}

const buckets = new Map<string, Bucket>();
const MAX_KEYS = 10_000; // hard cap so a flood of unique keys can't OOM the process

function gcIfNeeded(now: number) {
  if (buckets.size <= MAX_KEYS) return;
  // Drop the oldest 10% by last-seen timestamp (cheap heuristic).
  const cutoff = now - 60 * 60 * 1000;
  for (const [k, v] of buckets) {
    const last = v.timestamps[v.timestamps.length - 1] ?? 0;
    if (last < cutoff) buckets.delete(k);
  }
}

export function rateLimit(key: string, opts: RateLimitOptions): RateLimitResult {
  const now = Date.now();
  const windowStart = now - opts.windowMs;
  let bucket = buckets.get(key);
  if (!bucket) {
    bucket = { timestamps: [] };
    buckets.set(key, bucket);
  }
  // Drop expired timestamps from the head.
  while (bucket.timestamps.length && bucket.timestamps[0] < windowStart) {
    bucket.timestamps.shift();
  }
  if (bucket.timestamps.length >= opts.max) {
    const oldest = bucket.timestamps[0];
    const retryAfterMs = oldest + opts.windowMs - now;
    return { ok: false, remaining: 0, retryAfterMs: Math.max(retryAfterMs, 0) };
  }
  bucket.timestamps.push(now);
  gcIfNeeded(now);
  return { ok: true, remaining: opts.max - bucket.timestamps.length, retryAfterMs: 0 };
}

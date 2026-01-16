// netlify/functions/utils/rateLimit.ts
// Best-effort in-memory rate limiter for Netlify Functions.
//
// Notes:
// - In serverless, each warm instance has its own memory. This is still useful
//   to reduce accidental bursts and most basic abuse.

type Bucket = number[]; // timestamps (ms)

// globalThis keeps it shared within the same warm lambda instance
const STORE_KEY = "__rate_limit_store_v1__";
const store: Map<string, Bucket> =
  (globalThis as any)[STORE_KEY] ?? new Map<string, Bucket>();
(globalThis as any)[STORE_KEY] = store;

export type RateLimitRule = {
  key: string;
  max: number;
  windowMs: number;
};

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  resetMs: number;
};

export function rateLimit(rule: RateLimitRule): RateLimitResult {
  const now = Date.now();
  const windowStart = now - rule.windowMs;

  const bucket = store.get(rule.key) ?? [];
  const recent = bucket.filter((t) => t > windowStart);

  if (recent.length >= rule.max) {
    const oldest = Math.min(...recent);
    const resetMs = Math.max(0, oldest + rule.windowMs - now);
    store.set(rule.key, recent);
    return { allowed: false, remaining: 0, resetMs };
  }

  recent.push(now);
  store.set(rule.key, recent);

  const remaining = Math.max(0, rule.max - recent.length);
  const oldest = Math.min(...recent);
  const resetMs = Math.max(0, oldest + rule.windowMs - now);

  return { allowed: true, remaining, resetMs };
}

export function rateLimitHeaders(result: RateLimitResult) {
  return {
    "X-RateLimit-Remaining": String(result.remaining),
    "X-RateLimit-Reset-Ms": String(result.resetMs),
  };
}


import { tooManyRequests } from './http.ts';

interface Bucket {
  count: number;
  resetAt: number;
}

export interface RateLimitRule {
  /** Unique name so the counter shows up in logs and tests can assert on it. */
  name: string;
  windowMs: number;
  max: number;
}

/**
 * Fixed-window in-memory rate limiter.
 *
 * The product runs as a single process against one SQLite file, so an in-process counter is
 * sufficient and keeps the runtime dependency free. Buckets are swept lazily whenever a new
 * entry is created, which keeps the map size proportional to the number of active clients.
 */
export class RateLimiter {
  private readonly buckets = new Map<string, Bucket>();
  private lastSweep = 0;
  private readonly rule: RateLimitRule;

  constructor(rule: RateLimitRule) {
    this.rule = rule;
  }

  check(key: string, now = Date.now()): { allowed: boolean; retryAfterSeconds: number; remaining: number } {
    this.sweep(now);
    const bucket = this.buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      this.buckets.set(key, { count: 1, resetAt: now + this.rule.windowMs });
      return { allowed: true, retryAfterSeconds: 0, remaining: this.rule.max - 1 };
    }
    bucket.count += 1;
    if (bucket.count > this.rule.max) {
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
        remaining: 0,
      };
    }
    return { allowed: true, retryAfterSeconds: 0, remaining: this.rule.max - bucket.count };
  }

  /** Used by tests to reset state between scenarios. */
  reset(): void {
    this.buckets.clear();
  }

  private sweep(now: number): void {
    if (now - this.lastSweep < 30_000) return;
    this.lastSweep = now;
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= now) this.buckets.delete(key);
    }
  }
}

export function clientKey(identifier: string, scope: string): string {
  return `${scope}:${identifier}`;
}

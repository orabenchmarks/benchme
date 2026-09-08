import type { Redis } from "@benchme/core";

export interface RateLimiter {
  /** Consume one unit for `key`; returns whether it fit under the limit. */
  consume(key: string): Promise<boolean>;
}

/** Fixed-window counter in Redis: `limit` events per `windowSeconds` per key. */
export class RedisRateLimiter implements RateLimiter {
  constructor(
    private readonly redis: Redis,
    private readonly limit: number,
    private readonly windowSeconds: number,
    private readonly prefix = "benchme:ratelimit",
  ) {}

  async consume(key: string): Promise<boolean> {
    const window = Math.floor(Date.now() / 1000 / this.windowSeconds);
    const k = `${this.prefix}:${key}:${window}`;
    const n = await this.redis.incr(k);
    if (n === 1) await this.redis.expire(k, this.windowSeconds + 1);
    return n <= this.limit;
  }
}

/** For tests and single-process dev. */
export class MemoryRateLimiter implements RateLimiter {
  private readonly counts = new Map<string, { window: number; n: number }>();
  constructor(
    private readonly limit: number,
    private readonly windowSeconds: number,
  ) {}
  async consume(key: string): Promise<boolean> {
    const window = Math.floor(Date.now() / 1000 / this.windowSeconds);
    const cur = this.counts.get(key);
    const n = cur && cur.window === window ? cur.n + 1 : 1;
    this.counts.set(key, { window, n });
    return n <= this.limit;
  }
}

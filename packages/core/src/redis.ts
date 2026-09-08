import { Redis } from "ioredis";

export type { Redis };

export function createRedis(url: string): Redis {
  return new Redis(url, { lazyConnect: false, maxRetriesPerRequest: 2, enableOfflineQueue: true });
}

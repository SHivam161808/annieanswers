import { Redis } from 'ioredis';

/**
 * Redis client tuned for the latency path: fail fast instead of queueing commands while
 * disconnected, short command timeout, bounded reconnect backoff.
 */
export function createRedis(url: string): Redis {
  return new Redis(url, {
    lazyConnect: true,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    commandTimeout: 250,
    connectTimeout: 2000,
    retryStrategy: (attempt) => Math.min(attempt * 100, 2000),
  });
}

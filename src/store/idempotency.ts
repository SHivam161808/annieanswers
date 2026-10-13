import { createHash } from 'node:crypto';
import type { Redis } from 'ioredis';
import { AppError } from '../core/errors.js';
import type { Deadline } from '../observability/timing.js';

/**
 * Idempotency on the GHL call id. The first request for a key executes; concurrent duplicates wait
 * for its result; later duplicates get the stored result without re-executing side effects.
 * A key reused with a different payload is rejected, which is also how replays are contained.
 */

export interface StoredResponse {
  statusCode: number;
  body: unknown;
}

type Record =
  { state: 'in_progress'; hash: string } | ({ state: 'done'; hash: string } & StoredResponse);

export type IdempotencyResult = StoredResponse & { replayed: boolean };

export interface IdempotencyOptions {
  /** How long an in-progress lock lives if the owner dies mid-request. */
  lockTtlMs: number;
  /** How long completed results are kept for replay. */
  resultTtlSeconds: number;
  pollIntervalMs: number;
}

const DEFAULTS: IdempotencyOptions = {
  lockTtlMs: 10_000,
  resultTtlSeconds: 24 * 60 * 60,
  pollIntervalMs: 50,
};

export function hashPayload(payload: unknown): string {
  return createHash('sha256').update(stableStringify(payload)).digest('hex');
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as { [k: string]: unknown })
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class IdempotencyStore {
  private readonly options: IdempotencyOptions;

  constructor(
    private readonly redis: Redis,
    options: Partial<IdempotencyOptions> = {},
  ) {
    this.options = { ...DEFAULTS, ...options };
  }

  async run(
    scope: string,
    key: string,
    payloadHash: string,
    deadline: Deadline,
    execute: () => Promise<StoredResponse>,
  ): Promise<IdempotencyResult> {
    const redisKey = `idem:${scope}:${key}`;

    for (;;) {
      const lock: Record = { state: 'in_progress', hash: payloadHash };
      const acquired = await this.redis.set(
        redisKey,
        JSON.stringify(lock),
        'PX',
        this.options.lockTtlMs,
        'NX',
      );

      if (acquired === 'OK') {
        let response: StoredResponse;
        try {
          response = await execute();
        } catch (err) {
          // Release so a retry can execute; callers must make execute() safe to re-run.
          await this.redis.del(redisKey).catch(() => undefined);
          throw err;
        }
        const done: Record = { state: 'done', hash: payloadHash, ...response };
        await this.redis.set(redisKey, JSON.stringify(done), 'EX', this.options.resultTtlSeconds);
        return { ...response, replayed: false };
      }

      const existing = await this.redis.get(redisKey);
      if (existing === null) continue; // lock expired between SET and GET; try again

      const record = JSON.parse(existing) as Record;
      if (record.hash !== payloadHash) {
        throw new AppError(
          'idempotency_key_reuse',
          'Idempotency key was already used with a different payload',
        );
      }
      if (record.state === 'done') {
        return { statusCode: record.statusCode, body: record.body, replayed: true };
      }
      if (deadline.remainingMs() <= this.options.pollIntervalMs) {
        throw new AppError('request_in_progress', 'An identical request is in progress', true);
      }
      await sleep(this.options.pollIntervalMs);
    }
  }
}

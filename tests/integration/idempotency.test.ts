import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppError } from '../../src/core/errors.js';
import { Deadline } from '../../src/observability/timing.js';
import { IdempotencyStore, hashPayload } from '../../src/store/idempotency.js';
import { createRedis } from '../../src/store/redis.js';
import { isolatedRedisUrl } from '../helpers/app.js';

let redis: ReturnType<typeof createRedis>;

beforeAll(async () => {
  redis = createRedis(await isolatedRedisUrl());
  await redis.connect();
});
beforeEach(() => redis.flushdb());
afterAll(() => redis.disconnect());

const ok = (body: unknown) => async () => ({ statusCode: 200, body });

describe('IdempotencyStore (GHL call id as key)', () => {
  it('executes once and replays the stored result for duplicates (TC022, TC058)', async () => {
    const store = new IdempotencyStore(redis);
    let executions = 0;
    const execute = async () => {
      executions++;
      return { statusCode: 200, body: { booking_id: 'b1' } };
    };
    const hash = hashPayload({ slot: '2026-11-03T10:00' });

    const first = await store.run('booking', 'call_1', hash, new Deadline(1000), execute);
    const second = await store.run('booking', 'call_1', hash, new Deadline(1000), execute);

    expect(executions).toBe(1);
    expect(first).toEqual({ statusCode: 200, body: { booking_id: 'b1' }, replayed: false });
    expect(second).toEqual({ statusCode: 200, body: { booking_id: 'b1' }, replayed: true });
  });

  it('runs concurrent duplicates exactly once', async () => {
    const store = new IdempotencyStore(redis, { pollIntervalMs: 10 });
    let executions = 0;
    const execute = async () => {
      executions++;
      await new Promise((r) => setTimeout(r, 100));
      return { statusCode: 200, body: { n: executions } };
    };
    const hash = hashPayload({ a: 1 });
    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        store.run('booking', 'call_c', hash, new Deadline(2000), execute),
      ),
    );
    expect(executions).toBe(1);
    expect(results.filter((r) => !r.replayed)).toHaveLength(1);
    expect(new Set(results.map((r) => JSON.stringify(r.body))).size).toBe(1);
  });

  it('rejects a key reused with a different payload (replay with altered body, TC064)', async () => {
    const store = new IdempotencyStore(redis);
    await store.run('booking', 'call_2', hashPayload({ a: 1 }), new Deadline(1000), ok({}));
    await expect(
      store.run('booking', 'call_2', hashPayload({ a: 2 }), new Deadline(1000), ok({})),
    ).rejects.toMatchObject({ code: 'idempotency_key_reuse' });
  });

  it('hash is independent of key order', () => {
    expect(hashPayload({ a: 1, b: { c: 2, d: 3 } })).toBe(hashPayload({ b: { d: 3, c: 2 }, a: 1 }));
    expect(hashPayload({ a: 1, b: undefined })).toBe(hashPayload({ a: 1 }));
  });

  it('releases the key when execution fails so a retry can run (TC057)', async () => {
    const store = new IdempotencyStore(redis);
    const hash = hashPayload({});
    await expect(
      store.run('booking', 'call_3', hash, new Deadline(1000), async () => {
        throw new Error('GHL timeout');
      }),
    ).rejects.toThrow('GHL timeout');
    const retry = await store.run('booking', 'call_3', hash, new Deadline(1000), ok({ ok: true }));
    expect(retry.replayed).toBe(false);
  });

  it('returns a retryable in-progress error when the deadline runs out', async () => {
    const store = new IdempotencyStore(redis, { pollIntervalMs: 10 });
    const hash = hashPayload({});
    const slow = store.run('booking', 'call_4', hash, new Deadline(2000), async () => {
      await new Promise((r) => setTimeout(r, 300));
      return { statusCode: 200, body: {} };
    });
    await new Promise((r) => setTimeout(r, 20));
    const err = await store
      .run('booking', 'call_4', hash, new Deadline(50), ok({}))
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AppError);
    expect(err).toMatchObject({ code: 'request_in_progress', retryable: true });
    await slow;
  });

  it('survives a process restart: a new store instance sees prior results (TC062)', async () => {
    const hash = hashPayload({ x: 1 });
    await new IdempotencyStore(redis).run('booking', 'call_5', hash, new Deadline(1000), ok('v'));
    const restarted = new IdempotencyStore(redis);
    const result = await restarted.run('booking', 'call_5', hash, new Deadline(1000), ok('other'));
    expect(result).toMatchObject({ body: 'v', replayed: true });
  });

  it('recovers when the owner dies mid-request (lock expires)', async () => {
    const store = new IdempotencyStore(redis, { lockTtlMs: 100 });
    const hash = hashPayload({});
    await redis.set(
      'idem:booking:call_6',
      JSON.stringify({ state: 'in_progress', hash }),
      'PX',
      100,
    );
    const result = await store.run('booking', 'call_6', hash, new Deadline(1000), ok('after'));
    expect(result).toMatchObject({ body: 'after', replayed: false });
  });
});

describe('IdempotencyStore internals (pinned by mutation testing)', () => {
  it('stores under idem:<scope>:<key> with a 24h TTL and an in-progress lock while running', async () => {
    const store = new IdempotencyStore(redis);
    let seenDuringRun: string | null = null;
    await store.run('booking', 'call_k', hashPayload({ a: 1 }), new Deadline(1000), async () => {
      seenDuringRun = await redis.get('idem:booking:call_k');
      return { statusCode: 201, body: { ok: true } };
    });
    expect(JSON.parse(seenDuringRun!)).toEqual({
      state: 'in_progress',
      hash: hashPayload({ a: 1 }),
    });
    const ttl = await redis.ttl('idem:booking:call_k');
    expect(ttl).toBeGreaterThan(24 * 60 * 60 - 5);
    expect(ttl).toBeLessThanOrEqual(24 * 60 * 60);
    expect(JSON.parse((await redis.get('idem:booking:call_k'))!)).toMatchObject({
      state: 'done',
      statusCode: 201,
    });
  });

  it('keeps scopes independent for the same key', async () => {
    const store = new IdempotencyStore(redis);
    const h = hashPayload({});
    const a = await store.run('booking', 'same', h, new Deadline(1000), ok('booking'));
    const b = await store.run('cancel', 'same', h, new Deadline(1000), ok('cancel'));
    expect([a.body, b.body, b.replayed]).toEqual(['booking', 'cancel', false]);
  });

  it('reports a clear reuse message', async () => {
    const store = new IdempotencyStore(redis);
    await store.run('booking', 'msg', hashPayload(1), new Deadline(1000), ok({}));
    await expect(
      store.run('booking', 'msg', hashPayload(2), new Deadline(1000), ok({})),
    ).rejects.toThrow('Idempotency key was already used with a different payload');
  });

  it('hashes arrays by order, scalars by value, objects by sorted keys', () => {
    expect(hashPayload([1, 2])).not.toBe(hashPayload([2, 1]));
    expect(hashPayload('1')).not.toBe(hashPayload(1));
    expect(hashPayload(null)).toBe(hashPayload(null));
    expect(hashPayload({ b: [{ y: 1, x: 2 }], a: 'z' })).toBe(
      hashPayload({ a: 'z', b: [{ x: 2, y: 1 }] }),
    );
    expect(hashPayload({ a: 1, b: 2 })).not.toBe(hashPayload({ a: 2, b: 1 }));
    expect(hashPayload({ ab: 1 })).not.toBe(hashPayload({ a: 'b1' }));
  });

  it('waits between polls instead of spinning', async () => {
    const store = new IdempotencyStore(redis, { pollIntervalMs: 50 });
    const h = hashPayload({});
    const slow = store.run('booking', 'poll', h, new Deadline(2000), async () => {
      await new Promise((r) => setTimeout(r, 200));
      return { statusCode: 200, body: 'x' };
    });
    await new Promise((r) => setTimeout(r, 10));
    const getSpy = redis.get.bind(redis);
    let gets = 0;
    redis.get = (async (...args: Parameters<typeof redis.get>) => {
      gets++;
      return getSpy(...args);
    }) as typeof redis.get;
    try {
      await store.run('booking', 'poll', h, new Deadline(2000), ok('y'));
    } finally {
      redis.get = getSpy as typeof redis.get;
    }
    await slow;
    expect(gets).toBeLessThan(10); // ~200ms / 50ms polls, not thousands
  });

  it('gives up exactly when the remaining deadline is within one poll interval', async () => {
    const store = new IdempotencyStore(redis, { pollIntervalMs: 50 });
    const h = hashPayload({});
    await redis.set(
      'idem:booking:edge',
      JSON.stringify({ state: 'in_progress', hash: h }),
      'PX',
      5000,
    );
    const started = performance.now();
    await expect(store.run('booking', 'edge', h, new Deadline(50), ok({}))).rejects.toMatchObject({
      code: 'request_in_progress',
      message: 'An identical request is in progress',
    });
    expect(performance.now() - started).toBeLessThan(40);
  });
});

describe('IdempotencyStore cacheable results', () => {
  it('does not store results the caller marks non-cacheable, so a retry executes again', async () => {
    const store = new IdempotencyStore(redis);
    const h = hashPayload({});
    let runs = 0;
    const exec = async () => ({
      statusCode: 200,
      body: { status: ++runs === 1 ? 'not_found' : 'cancelled' },
    });
    const onlyCancelled = (r: { body: unknown }) =>
      (r.body as { status: string }).status === 'cancelled';
    const first = await store.run('cancel', 'k1', h, new Deadline(1000), exec, onlyCancelled);
    expect(first).toMatchObject({ body: { status: 'not_found' }, replayed: false });
    expect(await redis.get('idem:cancel:k1')).toBeNull();
    const second = await store.run('cancel', 'k1', h, new Deadline(1000), exec, onlyCancelled);
    expect(second).toMatchObject({ body: { status: 'cancelled' }, replayed: false });
    const third = await store.run('cancel', 'k1', h, new Deadline(1000), exec, onlyCancelled);
    expect(third).toMatchObject({ body: { status: 'cancelled' }, replayed: true });
    expect(runs).toBe(2);
  });
});

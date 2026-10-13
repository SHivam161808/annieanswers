import { MockAgent } from 'undici';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppError } from '../../src/core/errors.js';
import { GhlClient, GhlError, parseGhlTokens } from '../../src/ghl/client.js';
import { createLogger } from '../../src/observability/logger.js';
import { createMetrics } from '../../src/observability/metrics.js';
import { Deadline } from '../../src/observability/timing.js';

const BASE = 'https://ghl.test';
let agent: MockAgent;
let sleeps: number[];
let clock: number;

function client(overrides: Partial<ConstructorParameters<typeof GhlClient>[0]> = {}) {
  return new GhlClient({
    tokens: new Map([['loc1', 'tok-1']]),
    dispatcher: agent,
    baseUrl: BASE,
    metrics: createMetrics(),
    log: createLogger({ level: 'silent', appEnv: 'test', version: 't' }),
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    now: () => clock,
    ...overrides,
  });
}

const get = (c: GhlClient, deadlineMs = 2000) =>
  c.request<{ ok: boolean }>({
    method: 'GET',
    path: '/thing',
    version: 'v1',
    locationId: 'loc1',
    deadline: new Deadline(deadlineMs),
    operation: 'test_get',
  });

beforeEach(() => {
  agent = new MockAgent();
  agent.disableNetConnect();
  sleeps = [];
  clock = 1_000_000;
});
afterEach(() => agent.close());

const pool = () => agent.get(BASE);

describe('GhlClient', () => {
  it('sends the location token and version, returns parsed JSON', async () => {
    pool()
      .intercept({
        path: '/thing',
        method: 'GET',
        headers: { authorization: 'Bearer tok-1', version: 'v1' },
      })
      .reply(200, { ok: true });
    expect(await get(client())).toEqual({ ok: true });
  });

  it('returns {} for an empty 2xx body', async () => {
    pool().intercept({ path: '/thing', method: 'GET' }).reply(204, '');
    expect(await get(client())).toEqual({});
  });

  it('retries a GET once on 5xx, with backoff, then succeeds', async () => {
    pool().intercept({ path: '/thing', method: 'GET' }).reply(502, 'bad gateway');
    pool().intercept({ path: '/thing', method: 'GET' }).reply(200, { ok: true });
    expect(await get(client())).toEqual({ ok: true });
    expect(sleeps).toHaveLength(1);
    expect(sleeps[0]).toBeGreaterThanOrEqual(100);
  });

  it('gives up after maxAttempts with a retryable dependency error', async () => {
    pool().intercept({ path: '/thing', method: 'GET' }).reply(503, '').times(2);
    const err = await get(client()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GhlError);
    expect(err).toMatchObject({
      failure: 'http_5xx',
      httpStatus: 503,
      code: 'dependency_failed',
      retryable: true,
    });
  });

  it('never retries a POST (a retried create could duplicate)', async () => {
    pool().intercept({ path: '/thing', method: 'POST' }).reply(500, '');
    const c = client();
    const err = await c
      .request({
        method: 'POST',
        path: '/thing',
        version: 'v1',
        locationId: 'loc1',
        body: { a: 1 },
        deadline: new Deadline(2000),
        operation: 'create',
      })
      .catch((e: unknown) => e);
    expect(err).toMatchObject({ failure: 'http_5xx' });
    expect(sleeps).toHaveLength(0);
  });

  it('does not retry 4xx, and 4xx is not retryable', async () => {
    pool().intercept({ path: '/thing', method: 'GET' }).reply(404, '{"message":"nope"}');
    const err = await get(client()).catch((e: unknown) => e);
    expect(err).toMatchObject({ failure: 'http_4xx', httpStatus: 404, retryable: false });
    expect(sleeps).toHaveLength(0);
  });

  it('honours Retry-After on 429 when it fits the deadline', async () => {
    pool()
      .intercept({ path: '/thing', method: 'GET' })
      .reply(429, '', { headers: { 'retry-after': '1' } });
    pool().intercept({ path: '/thing', method: 'GET' }).reply(200, { ok: true });
    expect(await get(client(), 5000)).toEqual({ ok: true });
    expect(sleeps).toEqual([1000]);
  });

  it('fails fast on 429 when Retry-After exceeds the remaining deadline', async () => {
    pool()
      .intercept({ path: '/thing', method: 'GET' })
      .reply(429, '', { headers: { 'retry-after': '3' } });
    const err = await get(client(), 1500).catch((e: unknown) => e);
    expect(err).toMatchObject({ failure: 'rate_limited' });
    expect(sleeps).toHaveLength(0);
  });

  it('times out a slow attempt within the deadline', async () => {
    pool().intercept({ path: '/thing', method: 'GET' }).reply(200, { ok: true }).delay(2000);
    const started = performance.now();
    const err = await get(client({ attemptTimeoutMs: 200, maxAttempts: 1 }), 2000).catch(
      (e: unknown) => e,
    );
    expect(err).toMatchObject({ failure: 'timeout' });
    expect(performance.now() - started).toBeLessThan(1000);
  });

  it('refuses to start an attempt with too little deadline left', async () => {
    const err = await get(client(), 50).catch((e: unknown) => e);
    expect(err).toMatchObject({ failure: 'deadline' });
  });

  it('treats invalid JSON as a server failure', async () => {
    pool().intercept({ path: '/thing', method: 'GET' }).reply(200, 'not json').times(2);
    expect(await get(client()).catch((e: unknown) => e)).toMatchObject({ failure: 'http_5xx' });
  });

  it('opens the circuit after repeated failures, fails fast, then recovers after cooldown', async () => {
    const c = client({ breakerThreshold: 3, breakerCooldownMs: 10_000, maxAttempts: 1 });
    pool().intercept({ path: '/thing', method: 'GET' }).reply(500, '').times(3);
    for (let i = 0; i < 3; i++) await get(c).catch(() => undefined);
    const open = await get(c).catch((e: unknown) => e);
    expect(open).toMatchObject({ failure: 'circuit_open' });
    clock += 10_001;
    pool().intercept({ path: '/thing', method: 'GET' }).reply(200, { ok: true });
    expect(await get(c)).toEqual({ ok: true });
  });

  it('4xx responses do not open the circuit', async () => {
    const c = client({ breakerThreshold: 2, maxAttempts: 1 });
    pool().intercept({ path: '/thing', method: 'GET' }).reply(404, '').times(5);
    for (let i = 0; i < 5; i++) await get(c).catch(() => undefined);
    pool().intercept({ path: '/thing', method: 'GET' }).reply(200, { ok: true });
    expect(await get(c)).toEqual({ ok: true });
  });

  it('rejects unknown locations before any network call', async () => {
    const err = await client()
      .request({
        method: 'GET',
        path: '/x',
        version: 'v1',
        locationId: 'other',
        deadline: new Deadline(1000),
        operation: 'x',
      })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AppError);
    expect(err).toMatchObject({ code: 'config_unavailable' });
  });

  it('records latency metrics per operation and result', async () => {
    const metrics = createMetrics();
    pool().intercept({ path: '/thing', method: 'GET' }).reply(200, { ok: true });
    await get(client({ metrics }));
    const text = await metrics.registry.metrics();
    expect(text).toContain(
      'annie_dependency_duration_seconds_count{dependency="ghl",operation="test_get",result="ok"} 1',
    );
  });
});

describe('parseGhlTokens', () => {
  it('reads a JSON map and the single-location fallback', () => {
    const tokens = parseGhlTokens({
      GHL_TOKENS: '{"a":"t1","b":"t2"}',
      GHL_PRIVATE_TOKEN: 't3',
      GHL_LOCATION_ID: 'c',
    });
    expect([...tokens]).toEqual([
      ['a', 't1'],
      ['b', 't2'],
      ['c', 't3'],
    ]);
  });
  it('does not let the fallback override the map', () => {
    expect(
      parseGhlTokens({
        GHL_TOKENS: '{"a":"t1"}',
        GHL_PRIVATE_TOKEN: 'x',
        GHL_LOCATION_ID: 'a',
      }).get('a'),
    ).toBe('t1');
  });
  it.each(['[]', '"x"', '{"a":1}', '{"a":""}'])('rejects malformed GHL_TOKENS %s', (v) => {
    expect(() => parseGhlTokens({ GHL_TOKENS: v })).toThrow();
  });
});

describe('GhlClient deadline arithmetic', () => {
  it('works when the deadline (not the attempt cap) bounds the attempt, with fractional time left', async () => {
    pool().intercept({ path: '/thing', method: 'GET' }).reply(200, { ok: true });
    // 1800.5 ms deadline < 2500 ms attempt cap -> budget is fractional and must be rounded.
    expect(await get(client(), 1800.5)).toEqual({ ok: true });
  });
});

describe('GhlClient request details and failure classification (mutation-pinned)', () => {
  it('sends Accept always and Content-Type + JSON body only when there is a body', async () => {
    pool()
      .intercept({
        path: '/thing',
        method: 'GET',
        headers: (h) => h.accept === 'application/json' && !('content-type' in h),
      })
      .reply(200, { ok: true });
    expect(await get(client())).toEqual({ ok: true });
    pool()
      .intercept({
        path: '/thing',
        method: 'PUT',
        headers: (h) => h['content-type'] === 'application/json',
        body: (b) => b === '{"a":1}',
      })
      .reply(200, { ok: true });
    expect(
      await client().request({
        method: 'PUT',
        path: '/thing',
        version: 'v1',
        locationId: 'loc1',
        body: { a: 1 },
        deadline: new Deadline(2000),
        operation: 'put',
      }),
    ).toEqual({ ok: true });
  });

  it('retries an explicitly idempotent POST', async () => {
    pool().intercept({ path: '/thing', method: 'POST' }).reply(503, '');
    pool().intercept({ path: '/thing', method: 'POST' }).reply(200, { ok: true });
    expect(
      await client().request({
        method: 'POST',
        path: '/thing',
        version: 'v1',
        locationId: 'loc1',
        body: {},
        deadline: new Deadline(2000),
        operation: 'p',
        idempotent: true,
      }),
    ).toEqual({ ok: true });
  });

  it('counts retries in the metrics, and only retries', async () => {
    const metrics = createMetrics();
    pool().intercept({ path: '/thing', method: 'GET' }).reply(500, '');
    pool().intercept({ path: '/thing', method: 'GET' }).reply(200, { ok: true });
    await get(client({ metrics }));
    pool().intercept({ path: '/thing', method: 'GET' }).reply(200, { ok: true });
    await get(client({ metrics }));
    expect(await metrics.registry.metrics()).toContain(
      'annie_dependency_retries_total{dependency="ghl",operation="test_get"} 1',
    );
  });

  it('backs off 100–200 ms on the first retry', async () => {
    pool().intercept({ path: '/thing', method: 'GET' }).reply(500, '');
    pool().intercept({ path: '/thing', method: 'GET' }).reply(200, {});
    await get(client());
    expect(sleeps[0]).toBeGreaterThanOrEqual(100);
    expect(sleeps[0]).toBeLessThan(200);
  });

  it('does not retry when the backoff would not leave time for another attempt', async () => {
    pool().intercept({ path: '/thing', method: 'GET' }).reply(500, '');
    const err = await get(client(), 300).catch((e: unknown) => e);
    expect(err).toMatchObject({ failure: 'http_5xx' });
    expect(sleeps).toHaveLength(0);
  });

  it('Retry-After: invalid or missing -> 500 ms; 0 -> immediate; capped at 5 s', async () => {
    for (const [header, expected] of [
      ['soon', 500],
      ['0', 0],
      ['60', 5000],
    ] as const) {
      sleeps = [];
      pool()
        .intercept({ path: '/thing', method: 'GET' })
        .reply(429, '', { headers: { 'retry-after': header } });
      pool().intercept({ path: '/thing', method: 'GET' }).reply(200, {});
      await get(client(), 8000);
      expect(sleeps, header).toEqual([expected]);
    }
    sleeps = [];
    pool().intercept({ path: '/thing', method: 'GET' }).reply(429, '');
    const err = await get(client({ maxAttempts: 1 })).catch((e: unknown) => e);
    expect(err).toMatchObject({
      failure: 'rate_limited',
      httpStatus: 429,
      retryAfterMs: 500,
      message: 'GHL rate limit',
    });
  });

  it('rate limits do not open the circuit', async () => {
    const c = client({ breakerThreshold: 2, maxAttempts: 1 });
    pool().intercept({ path: '/thing', method: 'GET' }).reply(429, '').times(4);
    for (let i = 0; i < 4; i++) await get(c).catch(() => undefined);
    pool().intercept({ path: '/thing', method: 'GET' }).reply(200, { ok: true });
    expect(await get(c)).toEqual({ ok: true });
  });

  it('circuit opens exactly at the threshold and closes exactly at the cooldown end', async () => {
    const c = client({ breakerThreshold: 2, breakerCooldownMs: 1000, maxAttempts: 1 });
    pool().intercept({ path: '/thing', method: 'GET' }).reply(500, '').times(2);
    await get(c).catch(() => undefined);
    await get(c).catch(() => undefined);
    clock += 999;
    expect(await get(c).catch((e: unknown) => e)).toMatchObject({
      failure: 'circuit_open',
      message: 'GHL temporarily unavailable (circuit open)',
    });
    clock += 1;
    pool().intercept({ path: '/thing', method: 'GET' }).reply(200, {});
    expect(await get(c)).toEqual({});
  });

  it('classifies network failures and timeouts', async () => {
    pool().intercept({ path: '/thing', method: 'GET' }).replyWithError(new Error('socket hang up'));
    expect(await get(client({ maxAttempts: 1 })).catch((e: unknown) => e)).toMatchObject({
      failure: 'network',
      message: 'GHL network',
    });
  });

  it('error messages and status codes are exact', async () => {
    pool().intercept({ path: '/thing', method: 'GET' }).reply(418, '');
    expect(await get(client()).catch((e: unknown) => e)).toMatchObject({
      name: 'GhlError',
      message: 'GHL 418',
      httpStatus: 418,
    });
    pool().intercept({ path: '/thing', method: 'GET' }).reply(500, '').times(2);
    expect(await get(client()).catch((e: unknown) => e)).toMatchObject({
      message: 'GHL 500',
      statusCode: 502,
    });
    pool().intercept({ path: '/thing', method: 'GET' }).reply(200, '{bad').times(2);
    expect(await get(client()).catch((e: unknown) => e)).toMatchObject({
      message: 'GHL returned invalid JSON',
    });
    expect(await get(client(), 10).catch((e: unknown) => e)).toMatchObject({
      message: 'Not enough time left to call GHL',
    });
    const unknown = await client()
      .request({
        method: 'GET',
        path: '/x',
        version: 'v',
        locationId: 'nope',
        deadline: new Deadline(1000),
        operation: 'x',
      })
      .catch((e: unknown) => e);
    expect(unknown).toMatchObject({ message: 'No GHL credentials for this location' });
  });

  it('logs failures at warn with the error detail, successes at debug, never bodies', async () => {
    const lines: Record<string, unknown>[] = [];
    const log = createLogger(
      { level: 'debug', appEnv: 'test', version: 't' },
      {
        write: (s: string) => {
          lines.push(JSON.parse(s) as Record<string, unknown>);
        },
      },
    );
    pool().intercept({ path: '/thing', method: 'GET' }).reply(200, { secret: 'caller-data' });
    await get(client({ log }));
    pool()
      .intercept({ path: '/thing', method: 'GET' })
      .replyWithError(Object.assign(new Error('x'), { code: 'ECONNRESET' }));
    await get(client({ log, maxAttempts: 1 })).catch(() => undefined);
    expect(lines[0]).toMatchObject({
      level: 'debug',
      dependency: 'ghl',
      operation: 'test_get',
      status: 'ok',
      msg: 'dependency_call',
    });
    expect(lines[1]).toMatchObject({ level: 'warn', status: 'network', msg: 'dependency_call' });
    expect(String(lines[1]?.error_detail)).toMatch(/:ECONNRESET$|Error/);
    expect(JSON.stringify(lines)).not.toContain('caller-data');
  });

  it('logs and reports when the circuit opens', async () => {
    const lines: Record<string, unknown>[] = [];
    const log = createLogger(
      { level: 'warn', appEnv: 'test', version: 't' },
      { write: (s: string) => void lines.push(JSON.parse(s) as Record<string, unknown>) },
    );
    pool().intercept({ path: '/thing', method: 'GET' }).reply(500, '');
    await get(client({ log, breakerThreshold: 1, breakerCooldownMs: 1234, maxAttempts: 1 })).catch(
      () => undefined,
    );
    expect(lines.find((l) => l.msg === 'circuit_opened')).toMatchObject({
      level: 'error',
      dependency: 'ghl',
      cooldown_ms: 1234,
    });
  });

  it('records latency in seconds', async () => {
    const metrics = createMetrics();
    pool().intercept({ path: '/thing', method: 'GET' }).reply(200, {}).delay(50);
    await get(client({ metrics }));
    const sum = Number(
      /annie_dependency_duration_seconds_sum\{[^}]*operation="test_get"[^}]*\} ([\d.]+)/.exec(
        await metrics.registry.metrics(),
      )?.[1],
    );
    expect(sum).toBeGreaterThan(0.03);
    expect(sum).toBeLessThan(5);
  });

  it('default base URL is the GHL API', async () => {
    const { GHL_BASE_URL } = await import('../../src/ghl/client.js');
    expect(GHL_BASE_URL).toBe('https://services.leadconnectorhq.com');
  });
});

describe('parseGhlTokens edge cases', () => {
  it('fallback needs both token and location', () => {
    expect(parseGhlTokens({ GHL_PRIVATE_TOKEN: 't' }).size).toBe(0);
    expect(parseGhlTokens({ GHL_LOCATION_ID: 'l' }).size).toBe(0);
    expect(parseGhlTokens({}).size).toBe(0);
  });
  it('explains malformed maps', () => {
    expect(() => parseGhlTokens({ GHL_TOKENS: '[]' })).toThrow(
      'GHL_TOKENS must be a JSON object of locationId -> token',
    );
    expect(() => parseGhlTokens({ GHL_TOKENS: '{"a":""}' })).toThrow(
      'GHL_TOKENS values must be non-empty strings',
    );
  });
});

import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';
import { OwnerAlerts, parseAlertOverrides } from '../../src/alerts/owner-alerts.js';
import { validateClientConfig } from '../../src/clients/config-store.js';
import { GhlError, type GhlClient, type GhlRequest } from '../../src/ghl/client.js';
import { createLogger } from '../../src/observability/logger.js';
import { createMetrics, type Metrics } from '../../src/observability/metrics.js';
import { Deadline } from '../../src/observability/timing.js';
import { createRedis } from '../../src/store/redis.js';
import { isolatedRedisUrl } from '../helpers/app.js';

const LOC = 'loc1';
const OWNER = '+447700900123'; // demo alert_sms_number
const raw = parseYaml(readFileSync('config/clients/demo.yaml', 'utf8')) as Record<string, unknown>;
const cfg = validateClientConfig(raw, 'demo').config;
const SENT_KEY = (k: string) => `alert:${LOC}:${k}`;
const CONTACT_KEY = `owner-contact:${LOC}:${OWNER}`;
const DAY = 24 * 60 * 60;

type Handler = (req: Omit<GhlRequest, 'deadline'>) => unknown;

/** Records every GHL request (without its deadline) and answers from a queue of handlers. */
function fakeGhl() {
  const requests: Omit<GhlRequest, 'deadline'>[] = [];
  const queue: Handler[] = [];
  const client = {
    request: async (req: GhlRequest) => {
      const { deadline, ...rest } = req;
      void deadline; // varies per call; not part of the request contract
      requests.push(rest);
      const next = queue.shift();
      if (!next) throw new Error(`unexpected GHL request ${req.method} ${req.path}`);
      return next(rest);
    },
  } as unknown as GhlClient;
  return { client, requests, queue };
}

const LOOKUP = {
  method: 'GET',
  path: `/contacts/search/duplicate?locationId=${LOC}&number=%2B447700900123`,
  version: '2021-07-28',
  locationId: LOC,
  operation: 'owner_contact_lookup',
};
const CREATE = {
  method: 'POST',
  path: '/contacts/',
  version: '2021-07-28',
  locationId: LOC,
  operation: 'owner_contact_create',
  body: {
    locationId: LOC,
    firstName: 'Dave',
    lastName: '(business owner)',
    phone: OWNER,
    tags: ['business-owner'],
  },
};
const SMS = (contactId: string, message: string) => ({
  method: 'POST',
  path: '/conversations/messages',
  version: '2021-04-15',
  locationId: LOC,
  operation: 'send_owner_sms',
  body: { type: 'SMS', contactId, message },
});

let redis: ReturnType<typeof createRedis>;
let ghl: ReturnType<typeof fakeGhl>;
let metrics: Metrics;
let lines: Record<string, unknown>[];
let alerts: OwnerAlerts;

const make = (overrides?: ReadonlyMap<string, string>) =>
  new OwnerAlerts({
    ghl: ghl.client,
    redis,
    metrics,
    overrides,
    log: createLogger(
      { level: 'info', appEnv: 'test', version: 't' },
      { write: (s: string) => void lines.push(JSON.parse(s) as Record<string, unknown>) },
    ),
  });
const counts = async () =>
  Object.fromEntries(
    (await metrics.ownerAlerts.get()).values.map((v) => [String(v.labels.result), v.value]),
  );
const logged = (msg: string) =>
  lines
    .filter((l) => l.msg === msg)
    .map(({ alert_key, result, error_code }) => ({ alert_key, result, error_code }));

beforeAll(async () => {
  redis = createRedis(await isolatedRedisUrl());
  await redis.connect();
});
afterAll(() => redis.disconnect());
beforeEach(async () => {
  await redis.flushdb();
  ghl = fakeGhl();
  metrics = createMetrics();
  lines = [];
  alerts = make();
});

describe('OwnerAlerts.send', () => {
  it('looks up the owner, sends the SMS, records "sent" with its TTLs, metric and log', async () => {
    let duringSend: string | null = 'unread';
    ghl.queue.push(
      () => ({ contact: { id: 'owner1' } }),
      async () => {
        duringSend = await redis.get(SENT_KEY('call1:x'));
        return { messageId: 'm1' };
      },
    );
    expect(await alerts.send(LOC, cfg, 'hello', 'call1:x', new Deadline(4000))).toBe('sent');
    expect(ghl.requests).toEqual([LOOKUP, SMS('owner1', 'hello')]);
    expect(duringSend).toBe('sending');
    expect(await redis.get(SENT_KEY('call1:x'))).toBe('sent');
    const sentTtl = await redis.ttl(SENT_KEY('call1:x'));
    expect(sentTtl).toBeGreaterThan(7 * DAY - 60);
    expect(sentTtl).toBeLessThanOrEqual(7 * DAY);
    expect(await redis.get(CONTACT_KEY)).toBe('owner1');
    const contactTtl = await redis.ttl(CONTACT_KEY);
    expect(contactTtl).toBeGreaterThan(30 * DAY - 60);
    expect(contactTtl).toBeLessThanOrEqual(30 * DAY);
    expect(await counts()).toEqual({ sent: 1 });
    expect(logged('owner_alert')).toEqual([
      { alert_key: 'call1:x', result: 'sent', error_code: undefined },
    ]);
  });

  it('a second send with the same key is a duplicate and calls nothing', async () => {
    await redis.set(SENT_KEY('k'), 'sent');
    expect(await alerts.send(LOC, cfg, 'hello', 'k', new Deadline(4000))).toBe('duplicate');
    expect(ghl.requests).toEqual([]);
    expect(await counts()).toEqual({ duplicate: 1 });
  });

  it('accepts a messageIds list, and uses the cached owner contact', async () => {
    await redis.set(CONTACT_KEY, 'cached1');
    ghl.queue.push(() => ({ messageIds: ['m2'] }));
    expect(await alerts.send(LOC, cfg, 'again', 'k', new Deadline(4000))).toBe('sent');
    expect(ghl.requests).toEqual([SMS('cached1', 'again')]);
  });

  it('creates the owner contact when the lookup finds none or answers 404', async () => {
    ghl.queue.push(
      () => ({ contact: null }),
      () => ({ contact: { id: 'new1' } }),
      () => ({ messageId: 'm' }),
    );
    expect(await alerts.send(LOC, cfg, 'hi', 'a', new Deadline(4000))).toBe('sent');
    expect(ghl.requests).toEqual([LOOKUP, CREATE, SMS('new1', 'hi')]);

    await redis.flushdb();
    ghl.requests.length = 0;
    ghl.queue.push(
      () => {
        throw new GhlError('http_4xx', 404, 'GHL 404');
      },
      () => ({ contact: { id: 'new2' } }),
      () => ({ messageId: 'm' }),
    );
    expect(await alerts.send(LOC, cfg, 'hi', 'b', new Deadline(4000))).toBe('sent');
    expect(ghl.requests).toEqual([LOOKUP, CREATE, SMS('new2', 'hi')]);
  });

  it.each([
    ['a GHL 500', () => new GhlError('http_5xx', 500, 'GHL 500'), 'http_5xx'],
    ['a GHL 400', () => new GhlError('http_4xx', 400, 'GHL 400'), 'http_4xx'],
    ['a non-GHL error', () => new TypeError('boom'), 'TypeError'],
  ])('a lookup failure (%s) fails the alert and releases the key', async (_n, error, code) => {
    ghl.queue.push(() => {
      throw error();
    });
    expect(await alerts.send(LOC, cfg, 'hi', 'k', new Deadline(4000))).toBe('failed');
    expect(ghl.requests).toEqual([LOOKUP]);
    expect(await redis.exists(SENT_KEY('k'))).toBe(0);
    expect(logged('owner_alert_failed')).toEqual([
      { alert_key: 'k', result: undefined, error_code: code },
    ]);
    expect(await counts()).toEqual({ failed: 1 });
  });

  it('a send without a message id fails as http_5xx', async () => {
    await redis.set(CONTACT_KEY, 'owner1');
    ghl.queue.push(() => ({ conversationId: 'cv1' }));
    expect(await alerts.send(LOC, cfg, 'hi', 'k', new Deadline(4000))).toBe('failed');
    expect(logged('owner_alert_failed')).toEqual([
      { alert_key: 'k', result: undefined, error_code: 'http_5xx' },
    ]);
    expect(logged('owner_alert')).toEqual([
      { alert_key: 'k', result: 'failed', error_code: undefined },
    ]);
  });

  it('no usable owner number: "no_number", nothing claimed or called', async () => {
    const broken = make(new Map([[LOC, 'not a number']]));
    expect(broken.ownerNumber(LOC, cfg)).toBeNull();
    expect(await broken.send(LOC, cfg, 'hi', 'k', new Deadline(4000))).toBe('no_number');
    expect(ghl.requests).toEqual([]);
    expect(await redis.exists(SENT_KEY('k'))).toBe(0);
    expect(await counts()).toEqual({ no_number: 1 });
    expect(logged('owner_alert')).toEqual([
      { alert_key: 'k', result: 'no_number', error_code: undefined },
    ]);
  });
});

describe('parseAlertOverrides', () => {
  it.each(['null', '42', '"text"', '[]'])('rejects %s', (json) =>
    expect(() => parseAlertOverrides(json)).toThrow(
      'ALERT_SMS_OVERRIDES must be a JSON object of locationId -> phone number',
    ),
  );
  it('rejects a non-number value by name', () => {
    expect(() => parseAlertOverrides('{"locA":"+447700900123","locB":"nope"}')).toThrow(
      'ALERT_SMS_OVERRIDES: invalid number for locB',
    );
  });
  it('keeps each valid number as given', () => {
    expect([...parseAlertOverrides('{"locA":"+447700900123"}')]).toEqual([
      ['locA', '+447700900123'],
    ]);
    expect(parseAlertOverrides('').size).toBe(0);
  });
});

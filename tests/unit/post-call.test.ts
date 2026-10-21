import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';
import type { AlertResult, OwnerAlerts } from '../../src/alerts/owner-alerts.js';
import type { SmsTemplate } from '../../src/alerts/templates.js';
import { validateClientConfig } from '../../src/clients/config-store.js';
import { GhlError, type GhlClient, type GhlRequest } from '../../src/ghl/client.js';
import {
  PIPELINE_NAME,
  PostCallProcessor,
  type CallLog,
  type PostCallOptions,
} from '../../src/jobs/post-call.js';
import { createLogger } from '../../src/observability/logger.js';
import { createRedis } from '../../src/store/redis.js';
import { isolatedRedisUrl } from '../helpers/app.js';

const LOC = 'loc1';
const NOW = Date.parse('2026-11-02T12:00:00Z');
const MIN = 60_000;
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const raw = parseYaml(readFileSync('config/clients/demo.yaml', 'utf8')) as Record<string, unknown>;
const cfg = validateClientConfig(raw, 'demo').config; // "Smith & Sons Plumbing Ltd"
const V = '2021-07-28';

const FIELDS = [
  { id: 'f_out', name: 'ai_call_outcome' },
  { id: 'f_sum', name: 'ai_issue_summary' },
  { id: 'f_pc', name: 'job_postcode' },
  { id: 'f_urg', name: 'ai_urgency' },
  { id: 'f_last', name: 'ai_last_call_at' },
  { id: 'f_cnt', name: 'ai_call_count' },
  { id: 'f_type', name: 'ai_issue_type' },
  { id: 'f_win', name: 'preferred_window' },
];
const PIPELINE = {
  id: 'p1',
  name: PIPELINE_NAME,
  stages: [
    { id: 's_cb', name: 'Callback needed' },
    { id: 's_em', name: 'Emergency' },
    { id: 's_bk', name: 'Booked' },
    { id: 's_aw', name: 'Awaiting confirmation' },
  ],
};
const BODY =
  '{{custom_values.business_name}} | {{contact.ai_call_outcome}} | {{contact.first_name}} | {{contact.phone}} | {{contact.ai_urgency}} | {{contact.ai_issue_summary}} | {{contact.job_postcode}} | {{contact.preferred_window}}';
const template = (id: string, prefix: string): [string, SmsTemplate] => [
  id,
  { id, workflow: 'WF', to: 'owner', status: 'draft', body: `${prefix} ${BODY}` },
];
const TEMPLATES = new Map([
  template('enquiry_alert_owner', 'ENQ'),
  template('request_mode_owner', 'REQ'),
  template('emergency_alert_owner', 'EMG'),
]);

type Req = Omit<GhlRequest, 'deadline'>;

/** A GHL stand-in that answers by method + path and records every request (without deadline). */
class World {
  requests: Req[] = [];
  pages: { callLogs?: CallLog[]; total?: number }[] = [];
  fields: unknown = { customFields: FIELDS };
  pipelines: unknown = { pipelines: [{ id: 'p0', name: 'Other', stages: [] }, PIPELINE] };
  contacts = new Map<string, Record<string, unknown>>();
  opportunities: unknown = { opportunities: [] };
  failOn: string | null = null;
  onLogs: (() => Promise<void>) | null = null;

  readonly ghl = {
    request: async (req: GhlRequest) => {
      const { deadline, ...rest } = req;
      void deadline; // varies per call; not part of the request contract
      this.requests.push(rest);
      if (this.failOn === `${req.method} ${req.path}`)
        throw new GhlError('http_5xx', 500, 'GHL 500');
      const p = req.path;
      if (p.startsWith('/voice-ai/dashboard/call-logs')) {
        await this.onLogs?.();
        const page = Number(/[?&]page=(\d+)/.exec(p)![1]);
        return this.pages[page - 1] ?? { callLogs: [], total: 0 };
      }
      if (p.startsWith('/locations/')) return this.fields;
      if (p.startsWith('/opportunities/pipelines')) return this.pipelines;
      if (p.startsWith('/opportunities/search')) return this.opportunities;
      if (p === '/opportunities/') return { opportunity: { id: 'new' } };
      if (p.startsWith('/opportunities/')) return {};
      if (req.method === 'GET') return { contact: this.contacts.get(p.slice('/contacts/'.length)) };
      return {};
    },
  } as unknown as GhlClient;

  calls(...logs: CallLog[]): void {
    this.pages = [{ callLogs: logs, total: logs.length }];
  }
  paths(): string[] {
    return this.requests.map((r) => `${r.method} ${r.path.split('?')[0]}`);
  }
}

let redis: ReturnType<typeof createRedis>;
let world: World;
let lines: Record<string, unknown>[];
let sends: { locationId: string; text: string; key: string }[];
let alertResult: AlertResult;

const alerts = {
  send: async (locationId: string, _cfg: unknown, text: string, key: string) => {
    sends.push({ locationId, text, key });
    return alertResult;
  },
} as unknown as OwnerAlerts;
const proc = (o: Partial<PostCallOptions> = {}) =>
  new PostCallProcessor({
    ghl: world.ghl,
    redis,
    alerts,
    templates: TEMPLATES,
    log: createLogger(
      { level: 'info', appEnv: 'test', version: 't' },
      { write: (s: string) => void lines.push(JSON.parse(s) as Record<string, unknown>) },
    ),
    now: () => NOW,
    ...o,
  });
const logged = (msg: string) =>
  lines
    .filter((l) => l.msg === msg)
    .map(
      ({
        level: _l,
        time: _t,
        msg: _m,
        pid: _p,
        hostname: _h,
        env: _e,
        service: _s,
        version: _v,
        ...rest
      }) => rest,
    );
const contact = (fields: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  id: 'c1',
  firstName: 'Jane',
  phone: '+447700900999',
  customFields: Object.entries(fields).map(([id, value]) => ({ id, value })),
  ...extra,
});
const FULL = {
  f_out: ' EMERGENCY_ALERTED ',
  f_sum: 'Burst pipe.',
  f_pc: 'LS6 2AB',
  f_urg: 'P2',
  f_cnt: 2,
  f_type: '  Leak ',
  f_win: { not: 'text' },
};

beforeAll(async () => {
  redis = createRedis(await isolatedRedisUrl());
  await redis.connect();
});
afterAll(() => redis.disconnect());
beforeEach(async () => {
  await redis.flushdb();
  world = new World();
  lines = [];
  sends = [];
  alertResult = 'sent';
});

describe('PostCallProcessor requests', () => {
  it('routes a finished call: exact GHL requests, alert, done marker and logs', async () => {
    world.calls({ id: 'call1', createdAt: ago(5 * MIN), contactId: 'c1' });
    world.contacts.set('c1', contact(FULL));
    world.opportunities = {
      opportunities: [
        { id: 'o0', pipelineId: 'other' },
        { id: 'o1', pipelineId: 'p1' },
      ],
    };
    let lock: [string | null, number] = [null, 0];
    world.onLogs = async () => {
      lock = [await redis.get(`postcall:lock:${LOC}`), await redis.pttl(`postcall:lock:${LOC}`)];
    };

    expect(await proc().run(LOC, cfg)).toEqual({
      locationId: LOC,
      scanned: 1,
      processed: 1,
      skipped: 0,
      failed: 0,
      alerts: { sent: 1 },
    });
    const base = { version: V, locationId: LOC };
    expect(world.requests).toEqual([
      {
        method: 'GET',
        path: `/voice-ai/dashboard/call-logs?locationId=${LOC}&startDate=${NOW - 6 * 3600_000}&endDate=${NOW}&page=1&pageSize=50`,
        version: 'v3',
        locationId: LOC,
        operation: 'post_call_logs',
      },
      {
        ...base,
        method: 'GET',
        path: `/locations/${LOC}/customFields?model=contact`,
        operation: 'post_call_field_ids',
      },
      {
        ...base,
        method: 'GET',
        path: `/opportunities/pipelines?locationId=${LOC}`,
        operation: 'post_call_pipelines',
      },
      { ...base, method: 'GET', path: '/contacts/c1', operation: 'post_call_contact' },
      {
        ...base,
        method: 'POST',
        path: '/contacts/c1/tags',
        operation: 'post_call_tags',
        body: { tags: ['ai-call', 'outcome-emergency-alerted'] },
      },
      {
        ...base,
        method: 'PUT',
        path: '/contacts/c1',
        operation: 'post_call_fields',
        body: {
          customFields: [
            { id: 'f_last', field_value: '2026-11-02' },
            { id: 'f_cnt', field_value: 3 },
          ],
        },
      },
      {
        ...base,
        method: 'GET',
        path: `/opportunities/search?location_id=${LOC}&contact_id=c1&pipeline_id=p1`,
        operation: 'post_call_opportunity_search',
      },
      {
        ...base,
        method: 'PUT',
        path: '/opportunities/o1',
        operation: 'post_call_opportunity_update',
        body: { pipelineId: 'p1', pipelineStageId: 's_em', status: 'open' },
      },
    ]);
    expect(sends).toEqual([
      {
        locationId: LOC,
        key: 'call1:post-call',
        text: 'EMG Smith & Sons Plumbing Ltd | EMERGENCY_ALERTED | Jane | +447700900999 | P2 | Burst pipe. | LS6 2AB |',
      },
    ]);

    expect(lock[0]).toBe('1');
    expect(lock[1]).toBeGreaterThan(50_000);
    expect(lock[1]).toBeLessThanOrEqual(55_000);
    expect(await redis.exists(`postcall:lock:${LOC}`)).toBe(0);
    expect(await redis.get(`postcall:done:${LOC}:call1`)).toBe('1');
    const doneTtl = await redis.ttl(`postcall:done:${LOC}:call1`);
    expect(doneTtl).toBeGreaterThan(14 * 24 * 3600 - 60);
    expect(doneTtl).toBeLessThanOrEqual(14 * 24 * 3600);
    expect(JSON.parse((await redis.get(`postcall:fields:${LOC}`))!)).toEqual(
      Object.fromEntries(FIELDS.map((f) => [f.name, f.id])),
    );
    const fieldsTtl = await redis.ttl(`postcall:fields:${LOC}`);
    expect(fieldsTtl).toBeGreaterThan(3500);
    expect(fieldsTtl).toBeLessThanOrEqual(3600);
    expect(logged('post_call_run')).toEqual([
      { locationId: LOC, scanned: 1, processed: 1, skipped: 0, failed: 0, alerts: { sent: 1 } },
    ]);

    // Field ids now come from the cache.
    world.requests = [];
    world.calls({ id: 'call2', createdAt: ago(5 * MIN), contactId: 'c1' });
    await proc().run(LOC, cfg);
    expect(world.paths()).not.toContain('GET /locations/loc1/customFields');
  });

  it('creates an opportunity named after the caller and issue type', async () => {
    world.calls({ id: 'call1', createdAt: ago(5 * MIN), contactId: 'c1' });
    world.contacts.set('c1', contact({ ...FULL, f_out: 'CALLBACK_REQUESTED' }));
    world.opportunities = {};
    await proc().run(LOC, cfg);
    expect(world.requests.at(-1)).toEqual({
      method: 'POST',
      path: '/opportunities/',
      version: V,
      locationId: LOC,
      operation: 'post_call_opportunity_create',
      body: {
        pipelineId: 'p1',
        locationId: LOC,
        contactId: 'c1',
        pipelineStageId: 's_cb',
        status: 'open',
        name: 'Jane – Leak',
      },
    });
  });

  it('opportunity name falls back to "Caller – enquiry" and is cut to 100 characters', async () => {
    world.calls(
      { id: 'a', createdAt: ago(6 * MIN), contactId: 'c1' },
      { id: 'b', createdAt: ago(5 * MIN), contactId: 'c2' },
    );
    world.contacts.set('c1', contact({ f_out: 'MESSAGE_TAKEN' }, { firstName: null }));
    world.contacts.set(
      'c2',
      contact({ f_out: 'MESSAGE_TAKEN', f_type: 'x'.repeat(150) }, { id: 'c2' }),
    );
    await proc().run(LOC, cfg);
    const names = world.requests
      .filter((r) => r.operation === 'post_call_opportunity_create')
      .map((r) => (r.body as { name: string }).name);
    expect(names).toEqual(['Caller – enquiry', `Jane – ${'x'.repeat(93)}`]);
  });

  it('a call with no outcome after the wait goes to "Callback needed" and the owner is told', async () => {
    world.calls({ id: 'old', createdAt: ago(10 * MIN), contactId: 'c1' });
    world.contacts.set('c1', contact({}, { customFields: undefined }));
    expect(await proc().run(LOC, cfg)).toMatchObject({ processed: 1 });
    expect(world.requests.find((r) => r.operation === 'post_call_tags')?.body).toEqual({
      tags: ['ai-call', 'outcome-missing'],
    });
    expect(
      world.requests.find((r) => r.operation === 'post_call_opportunity_create')?.body,
    ).toMatchObject({ pipelineStageId: 's_cb' });
    expect(sends.map((s) => s.text)).toEqual([
      'Smith & Sons Plumbing Ltd: a call ended without an outcome. Please check the AI receptionist calls.',
    ]);
  });

  it('the extracted outcome wins over the contact field, trimmed', async () => {
    world.calls({
      id: 'x',
      createdAt: ago(5 * MIN),
      contactId: 'c1',
      extractedData: { ai_call_outcome: ' INFO_ONLY ' },
    });
    world.contacts.set('c1', contact(FULL));
    await proc().run(LOC, cfg);
    expect(world.requests.find((r) => r.operation === 'post_call_tags')?.body).toEqual({
      tags: ['ai-call', 'outcome-info-only'],
    });
    expect(sends).toEqual([]);
  });

  it('only updates the fields that exist, and counts from zero', async () => {
    world.fields = {
      customFields: [
        { id: 'f_out', name: 'ai_call_outcome' },
        { id: 'f_cnt', name: 'ai_call_count' },
      ],
    };
    world.calls({ id: 'x', createdAt: ago(5 * MIN), contactId: 'c1' });
    world.contacts.set('c1', contact({ f_out: 'INFO_ONLY' }));
    await proc().run(LOC, cfg);
    expect(world.requests.find((r) => r.operation === 'post_call_fields')?.body).toEqual({
      customFields: [{ id: 'f_cnt', field_value: 1 }],
    });

    await redis.flushdb();
    world.requests = [];
    world.fields = { customFields: [{ id: 'f_out', name: 'ai_call_outcome' }] };
    await proc().run(LOC, cfg);
    expect(world.paths()).toEqual([
      'GET /voice-ai/dashboard/call-logs',
      'GET /locations/loc1/customFields',
      'GET /opportunities/pipelines',
      'GET /contacts/c1',
      'POST /contacts/c1/tags',
    ]);
  });
});

describe('PostCallProcessor owner alerts', () => {
  const run = async (outcome: string, extra: Record<string, unknown> = {}) => {
    world.calls({ id: 'k', createdAt: ago(5 * MIN), contactId: 'c1' });
    world.contacts.set('c1', contact({ f_out: outcome, f_urg: 'P3' }, extra));
    await proc().run(LOC, cfg);
    return sends.map((s) => s.text);
  };
  it.each([
    ['BOOKED', 'ENQ'],
    ['BOOKING_REQUESTED', 'REQ'],
    ['CALLBACK_REQUESTED', 'ENQ'],
    ['MESSAGE_TAKEN', 'ENQ'],
    ['EMERGENCY_ALERTED', 'EMG'],
  ])('%s uses the %s template', async (outcome, prefix) => {
    expect(await run(outcome)).toEqual([
      `${prefix} Smith & Sons Plumbing Ltd | ${outcome} | Jane | +447700900999 | P3 | | |`,
    ]);
  });
  it('fills a missing name and number', async () => {
    expect(await run('BOOKED', { firstName: null, phone: null })).toEqual([
      'ENQ Smith & Sons Plumbing Ltd | BOOKED | A caller | number not given | P3 | | |',
    ]);
  });
  it('fills the preferred window', async () => {
    world.calls({ id: 'k', createdAt: ago(5 * MIN), contactId: 'c1' });
    world.contacts.set('c1', contact({ f_out: 'BOOKING_REQUESTED', f_win: 'Tuesday morning' }));
    await proc().run(LOC, cfg);
    expect(sends.map((s) => s.text)).toEqual([
      'REQ Smith & Sons Plumbing Ltd | BOOKING_REQUESTED | Jane | +447700900999 | | | | Tuesday morning',
    ]);
  });
  it.each([
    [
      {},
      "Smith & Sons Plumbing Ltd: the AI receptionist couldn't complete a call from +447700900999. Please ring them back.",
    ],
    [
      { phone: null },
      "Smith & Sons Plumbing Ltd: the AI receptionist couldn't complete a call. Please ring them back.",
    ],
  ])('TECH_FAILURE asks the owner to ring back (%j)', async (extra, text) => {
    expect(await run('TECH_FAILURE', extra)).toEqual([text]);
  });
  it('INFO_ONLY sends nothing', async () => {
    expect(await run('INFO_ONLY')).toEqual([]);
  });
});

describe('PostCallProcessor timing and selection', () => {
  it('waits 90 s after a call by default', async () => {
    world.calls(
      { id: 'settled', createdAt: ago(90_000), contactId: 'c1' },
      { id: 'fresh', createdAt: ago(89_999), contactId: 'c1' },
    );
    world.contacts.set('c1', contact({ f_out: 'INFO_ONLY' }));
    expect(await proc().run(LOC, cfg)).toMatchObject({ scanned: 2, processed: 1, skipped: 1 });
    expect(await redis.exists(`postcall:done:${LOC}:settled`)).toBe(1);
  });

  it('waits 10 min for a missing outcome by default', async () => {
    world.calls(
      { id: 'late', createdAt: ago(10 * MIN), contactId: 'c1' },
      { id: 'wait', createdAt: ago(10 * MIN - 1), contactId: 'c1' },
    );
    world.contacts.set('c1', contact({}));
    expect(await proc().run(LOC, cfg)).toMatchObject({ scanned: 2, processed: 1, skipped: 1 });
    expect(await redis.exists(`postcall:done:${LOC}:late`)).toBe(1);
    expect(await redis.exists(`postcall:done:${LOC}:wait`)).toBe(0);
  });

  it('skips trial, contactless and done calls without reading the contact', async () => {
    await redis.set(`postcall:done:${LOC}:done1`, '1');
    world.calls(
      { id: 't', createdAt: ago(5 * MIN), contactId: 'c1', trialCall: true },
      { id: 'n', createdAt: ago(5 * MIN) },
      { id: 'done1', createdAt: ago(5 * MIN), contactId: 'c1' },
    );
    expect(await proc().run(LOC, cfg)).toMatchObject({ scanned: 3, processed: 0, skipped: 3 });
    expect(world.paths()).not.toContain('GET /contacts/c1');
  });

  it('processes the oldest calls first, at most maxCallsPerRun', async () => {
    world.calls(
      { id: 'b', createdAt: ago(20 * MIN), contactId: 'c2' },
      { id: 'c', createdAt: ago(10 * MIN), contactId: 'c3' },
      { id: 'a', createdAt: ago(30 * MIN), contactId: 'c1' },
    );
    for (const id of ['c1', 'c2', 'c3'])
      world.contacts.set(id, contact({ f_out: 'INFO_ONLY' }, { id }));
    expect(await proc({ maxCallsPerRun: 2 }).run(LOC, cfg)).toMatchObject({
      scanned: 3,
      processed: 2,
    });
    expect(world.paths().filter((p) => p.startsWith('GET /contacts/'))).toEqual([
      'GET /contacts/c1',
      'GET /contacts/c2',
    ]);
  });

  it('pages through call logs until the total is reached', async () => {
    const log = (id: string): CallLog => ({ id, createdAt: ago(5 * MIN), trialCall: true });
    world.pages = [
      { callLogs: [log('1'), log('2')], total: 3 },
      { callLogs: [log('3')], total: 3 },
    ];
    expect(await proc().run(LOC, cfg)).toMatchObject({ scanned: 3 });
    expect(world.paths().filter((p) => p.includes('call-logs'))).toHaveLength(2);
  });

  it('reads at most 20 pages', async () => {
    world.pages = Array.from({ length: 25 }, (_, i) => ({
      callLogs: [{ id: `t${i}`, createdAt: ago(5 * MIN), trialCall: true }],
      total: 1000,
    }));
    expect(await proc().run(LOC, cfg)).toMatchObject({ scanned: 20 });
    expect(world.requests.filter((r) => r.operation === 'post_call_logs').at(-1)?.path).toContain(
      '&page=20&',
    );
  });

  it('no call logs at all: nothing else is fetched', async () => {
    world.pages = [{}];
    expect(await proc().run(LOC, cfg)).toMatchObject({ scanned: 0 });
    expect(world.paths()).toEqual(['GET /voice-ai/dashboard/call-logs']);
  });
});

describe('PostCallProcessor failures and locking', () => {
  it('a failed owner alert or GHL error leaves the call to retry, logged by call id', async () => {
    world.calls(
      { id: 'a', createdAt: ago(6 * MIN), contactId: 'c1' },
      { id: 'b', createdAt: ago(5 * MIN), contactId: 'c2' },
    );
    world.contacts.set('c1', contact({ f_out: 'MESSAGE_TAKEN' }));
    world.contacts.set('c2', contact({ f_out: 'INFO_ONLY' }, { id: 'c2' }));
    world.failOn = 'POST /contacts/c2/tags';
    alertResult = 'failed';
    expect(await proc().run(LOC, cfg)).toEqual({
      locationId: LOC,
      scanned: 2,
      processed: 0,
      skipped: 0,
      failed: 2,
      alerts: { failed: 1 },
    });
    expect(logged('post_call_failed')).toEqual([
      { ghl_call_id: 'a', error_code: 'owner_alert_failed' },
      { ghl_call_id: 'b', error_code: 'http_5xx' },
    ]);
    expect(await redis.exists(`postcall:done:${LOC}:a`, `postcall:done:${LOC}:b`)).toBe(0);
  });

  it('only one runner per location at a time', async () => {
    await redis.set(`postcall:lock:${LOC}`, 'other', 'PX', 10_000);
    expect(await proc().run(LOC, cfg)).toEqual({
      locationId: LOC,
      scanned: 0,
      processed: 0,
      skipped: 0,
      failed: 0,
      alerts: {},
    });
    expect(world.requests).toEqual([]);
    expect(logged('post_call_locked')).toEqual([{ location_id: LOC }]);
    expect(await redis.get(`postcall:lock:${LOC}`)).toBe('other');
  });

  it.each([[{ pipelines: [{ id: 'p0', name: 'Other', stages: [] }] }], [{}]])(
    'without the enquiries pipeline (%j) no opportunity is touched',
    async (pipelines) => {
      world.pipelines = pipelines;
      world.calls({ id: 'x', createdAt: ago(5 * MIN), contactId: 'c1' });
      world.contacts.set('c1', contact({ f_out: 'CALLBACK_REQUESTED' }));
      expect(await proc().run(LOC, cfg)).toMatchObject({ processed: 1 });
      expect(
        world.paths().some((p) => p.includes('/opportunities/') && !p.includes('pipelines')),
      ).toBe(false);
      expect(logged('pipeline_missing')).toEqual([{ location_id: LOC }]);
    },
  );
});

import { readFileSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';
import { MockAgent } from 'undici';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { GhlClient } from '../../src/ghl/client.js';
import { createLogger } from '../../src/observability/logger.js';
import { createMetrics } from '../../src/observability/metrics.js';
import { DEMO_LOCATION, TEST_SECRET, startTestApp, type TestApp } from '../helpers/app.js';

/** Booking actions end to end through the HTTP app, with GHL mocked at the network layer. */

const GHL = 'https://ghl.test';
const CAL = (parseYaml(readFileSync('config/clients/demo.yaml', 'utf8')) as { calendar_id: string })
  .calendar_id;
const NOW = new Date('2026-11-02T10:00:00Z'); // Monday 10:00 GMT
const REF = 'appt_123456';
let agent: MockAgent;
let t: TestApp;

const ghl = () => agent.get(GHL);
const call = (
  action: string,
  params: Record<string, string>,
  headers: Record<string, string> = {},
) =>
  t.app.inject({
    method: 'GET',
    url: `/v1/actions/${action}?${new URLSearchParams({ location_id: DEMO_LOCATION, ...params })}`,
    headers: { authorization: TEST_SECRET, ...headers },
  });

const contact = {
  id: 'c1',
  firstName: 'Jane',
  lastName: 'Smith',
  postalCode: 'LS6 2AB',
  customFields: [],
};
const event = (over: Record<string, unknown> = {}) => ({
  id: REF,
  calendarId: CAL,
  startTime: '2026-11-05T09:00:00+00:00',
  endTime: '2026-11-05T10:00:00+00:00',
  appointmentStatus: 'confirmed',
  ...over,
});

beforeAll(async () => {
  agent = new MockAgent();
  agent.disableNetConnect();
  const client = new GhlClient({
    tokens: new Map([[DEMO_LOCATION, 'tok']]),
    dispatcher: agent,
    baseUrl: GHL,
    metrics: createMetrics(),
    log: createLogger({ level: 'silent', appEnv: 'test', version: 't' }),
    sleep: async () => undefined,
    breakerThreshold: 1000,
  });
  t = await startTestApp({ now: () => NOW, ghl: client });
});
afterAll(async () => {
  await t.close();
  await agent.close();
});
beforeEach(() => t.redis.flushdb());
afterEach(() => agent.assertNoPendingInterceptors());

describe('find-booking', () => {
  it('asks for the phone number first, then a verifying detail (no GHL call)', async () => {
    expect((await call('find-booking', {})).json().status).toBe('needs_phone');
    expect((await call('find-booking', { phone: '07700 900123' })).json().status).toBe(
      'needs_verification',
    );
  });

  it('finds upcoming bookings when phone and name match, spoken the UK way', async () => {
    ghl()
      .intercept({ path: /\/contacts\/search\/duplicate\?.*number=%2B447700900123/, method: 'GET' })
      .reply(200, { contact });
    ghl()
      .intercept({ path: '/contacts/c1/appointments', method: 'GET' })
      .reply(200, {
        events: [
          event(),
          event({ id: 'past1', startTime: '2026-10-01T09:00:00+00:00' }),
          event({ id: 'cancel', appointmentStatus: 'cancelled' }),
          event({ id: 'othercal', calendarId: 'OTHER' }),
        ],
      });
    const res = await call('find-booking', { phone: '07700 900123', name: 'jane' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      status: 'found',
      bookings: [{ ref: REF, when: 'Thursday the 5th at 9am' }],
      instruction: 'Confirm the booking is Thursday the 5th at 9am before changing anything.',
    });
  });

  it('verifies by postcode as an alternative to name', async () => {
    ghl()
      .intercept({ path: /\/contacts\/search\/duplicate/, method: 'GET' })
      .reply(200, { contact });
    ghl()
      .intercept({ path: '/contacts/c1/appointments', method: 'GET' })
      .reply(200, { events: [event()] });
    expect(
      (await call('find-booking', { phone: '+447700900123', postcode: 'ls6 2ab' })).json().status,
    ).toBe('found');
  });

  it('never reveals a booking when the details do not match (same answer as not found)', async () => {
    ghl()
      .intercept({ path: /\/contacts\/search\/duplicate/, method: 'GET' })
      .reply(200, { contact });
    const wrong = await call('find-booking', {
      phone: '07700 900123',
      name: 'Mallory',
      postcode: 'M1 1AE',
    });
    expect(wrong.json().status).toBe('not_found');
    expect(wrong.body).not.toContain(REF);

    ghl()
      .intercept({ path: /\/contacts\/search\/duplicate/, method: 'GET' })
      .reply(200, { contact: null });
    expect((await call('find-booking', { phone: '07700 900999', name: 'Jane' })).json()).toEqual(
      wrong.json(),
    );
  });

  it('falls back to a message when GHL fails (never a false answer)', async () => {
    ghl()
      .intercept({ path: /\/contacts\/search\/duplicate/, method: 'GET' })
      .reply(500, '')
      .times(2);
    const res = await call('find-booking', { phone: '07700 900123', name: 'Jane' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'unavailable' });
    expect(res.json().instruction).toMatch(/^Do not say anything has changed/);
  });
});

describe('available-slots', () => {
  it('returns up to 3 future slots after the minimum notice, spread out', async () => {
    ghl()
      .intercept({ path: new RegExp(`/calendars/${CAL}/free-slots\\?`), method: 'GET' })
      .reply(200, {
        '2026-11-02': { slots: ['2026-11-02T13:00:00+00:00', '2026-11-02T14:00:00+00:00'] },
        '2026-11-03': { slots: ['2026-11-03T09:00:00+00:00', '2026-11-03T10:00:00+00:00'] },
        traceId: 'x',
      });
    const res = await call('available-slots', {});
    expect(res.json()).toMatchObject({ status: 'ok' });
    expect(res.json().slots).toHaveLength(3);
    expect(res.json().instruction).toMatch(/^Offer at most two of these: Monday the 2nd at 1pm/);
  });

  it('no free slots -> request mode', async () => {
    ghl()
      .intercept({ path: /free-slots/, method: 'GET' })
      .reply(200, { traceId: 'x' });
    expect((await call('available-slots', {})).json().status).toBe('none');
  });
});

describe('reschedule-booking', () => {
  const slot = '2026-11-06T11:00:00+00:00';
  const apptPath = `/calendars/events/appointments/${REF}`;
  const moved = event({
    startTime: '2026-11-06T11:00:00.000Z',
    endTime: '2026-11-06T12:00:00.000Z',
  });

  it('moves the booking only when reading GHL back shows the new time', async () => {
    ghl().intercept({ path: apptPath, method: 'GET' }).reply(200, { appointment: event() });
    ghl().intercept({ path: apptPath, method: 'PUT' }).reply(200, { id: REF, calendarId: CAL });
    ghl().intercept({ path: apptPath, method: 'GET' }).reply(200, { appointment: moved });
    const res = await call('reschedule-booking', { booking_ref: REF, slot });
    expect(res.json()).toEqual({
      status: 'rescheduled',
      when: 'Friday the 6th at 11am',
      instruction: "It's moved. Tell the caller their visit is now Friday the 6th at 11am.",
    });
  });

  it('is idempotent: a GHL retry of the same request does not move it twice', async () => {
    ghl().intercept({ path: apptPath, method: 'GET' }).reply(200, { appointment: event() });
    ghl().intercept({ path: apptPath, method: 'PUT' }).reply(200, { id: REF });
    ghl().intercept({ path: apptPath, method: 'GET' }).reply(200, { appointment: moved });
    const first = await call('reschedule-booking', { booking_ref: REF, slot });
    const second = await call('reschedule-booking', { booking_ref: REF, slot }); // no interceptors left
    expect(second.json()).toEqual(first.json());
  });

  it('reports slot taken when GHL rejects the slot, and that is retryable', async () => {
    ghl().intercept({ path: apptPath, method: 'GET' }).reply(200, { appointment: event() });
    ghl()
      .intercept({ path: apptPath, method: 'PUT' })
      .reply(400, '{"message":"slot not available"}');
    expect((await call('reschedule-booking', { booking_ref: REF, slot })).json().status).toBe(
      'slot_taken',
    );
    expect(await t.redis.keys('idem:reschedule:*')).toEqual([]);
  });

  it('does NOT claim success when the read-back still shows the old time', async () => {
    ghl().intercept({ path: apptPath, method: 'GET' }).reply(200, { appointment: event() });
    ghl().intercept({ path: apptPath, method: 'PUT' }).reply(200, { id: REF });
    ghl().intercept({ path: apptPath, method: 'GET' }).reply(200, { appointment: event() });
    expect((await call('reschedule-booking', { booking_ref: REF, slot })).json().status).toBe(
      'unavailable',
    );
  });

  it('auth failures from GHL are failures, not "slot taken"', async () => {
    ghl().intercept({ path: apptPath, method: 'GET' }).reply(200, { appointment: event() });
    ghl().intercept({ path: apptPath, method: 'PUT' }).reply(401, '');
    expect((await call('reschedule-booking', { booking_ref: REF, slot })).json().status).toBe(
      'unavailable',
    );
  });

  it('times out to request mode instead of hanging', async () => {
    ghl()
      .intercept({ path: apptPath, method: 'GET' })
      .reply(200, { appointment: event() })
      .delay(6000);
    const started = performance.now();
    const res = await call('reschedule-booking', { booking_ref: REF, slot });
    expect(res.json().status).toBe('unavailable');
    expect(performance.now() - started).toBeLessThan(4500);
  });

  it('rejects malformed refs and slots with a validation error', async () => {
    expect((await call('reschedule-booking', { booking_ref: '../x', slot })).statusCode).toBe(400);
    expect(
      (await call('reschedule-booking', { booking_ref: REF, slot: 'tuesday' })).statusCode,
    ).toBe(400);
  });
});

describe('cancel-booking', () => {
  it('cancels only when GHL confirms the cancelled status', async () => {
    ghl()
      .intercept({ path: `/calendars/events/appointments/${REF}`, method: 'GET' })
      .reply(200, { appointment: event() });
    ghl()
      .intercept({ path: `/calendars/events/appointments/${REF}`, method: 'PUT' })
      .reply(200, event({ appointmentStatus: 'cancelled' }));
    expect(
      (await call('cancel-booking', { booking_ref: REF, reason: 'fixed itself' })).json(),
    ).toEqual({
      status: 'cancelled',
      instruction: "It's cancelled. Confirm that to the caller.",
    });
    // Duplicate request from a GHL retry: replayed, no second PUT.
    expect(
      (await call('cancel-booking', { booking_ref: REF, reason: 'fixed itself' })).json().status,
    ).toBe('cancelled');
  });

  it('does not claim cancelled when GHL leaves it confirmed', async () => {
    ghl()
      .intercept({ path: `/calendars/events/appointments/${REF}`, method: 'GET' })
      .reply(200, { appointment: event() });
    ghl()
      .intercept({ path: `/calendars/events/appointments/${REF}`, method: 'PUT' })
      .reply(200, event());
    expect((await call('cancel-booking', { booking_ref: REF })).json().status).toBe('unavailable');
  });

  it('treats unknown, past or other-calendar bookings as not found', async () => {
    ghl()
      .intercept({ path: `/calendars/events/appointments/${REF}`, method: 'GET' })
      .reply(404, '');
    expect((await call('cancel-booking', { booking_ref: REF })).json().status).toBe('not_found');
    ghl()
      .intercept({ path: `/calendars/events/appointments/${REF}`, method: 'GET' })
      .reply(200, { appointment: event({ calendarId: 'OTHER' }) });
    expect((await call('cancel-booking', { booking_ref: REF })).json().status).toBe('not_found');
    ghl()
      .intercept({ path: `/calendars/events/appointments/${REF}`, method: 'GET' })
      .reply(200, { appointment: event({ startTime: '2026-10-01T09:00:00+00:00' }) });
    expect((await call('cancel-booking', { booking_ref: REF })).json().status).toBe('not_found');
  });

  it('requires a booking ref', async () => {
    expect((await call('cancel-booking', {})).statusCode).toBe(400);
  });
});

/**
 * Booking behaviour pinned by mutation testing: exact instructions, request bodies, verification
 * edge cases and idempotency keys. GHL is mocked at the network layer.
 */
import { readFileSync } from 'node:fs';
import { MockAgent } from 'undici';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';
import {
  findBooking,
  availableSlots,
  cancelBooking,
  rescheduleBooking,
  type BookingContext,
} from '../../src/actions/booking.js';
import { GhlCalendarAdapter } from '../../src/booking/ghl-calendar-adapter.js';
import { validateClientConfig, type ClientConfig } from '../../src/clients/config-store.js';
import { GhlClient } from '../../src/ghl/client.js';
import { createLogger } from '../../src/observability/logger.js';
import { createMetrics } from '../../src/observability/metrics.js';
import { Deadline } from '../../src/observability/timing.js';
import { IdempotencyStore } from '../../src/store/idempotency.js';
import { createRedis } from '../../src/store/redis.js';
import { isolatedRedisUrl } from '../helpers/app.js';

const GHL = 'https://ghl.test';
const NOW = new Date('2026-11-02T10:00:00Z');
const REF = 'appt_123456';
const raw = parseYaml(readFileSync('config/clients/demo.yaml', 'utf8')) as Record<string, unknown>;
const demo = validateClientConfig(raw, 'demo');
const CAL = demo.config.calendar_id!;
const requestMode: ClientConfig = validateClientConfig(
  {
    ...raw,
    booking_mode: 'request_mode',
    calendar_id: undefined,
    appointment_types: [],
    job_appointment_types: {},
  },
  'rm',
);

let agent: MockAgent;
let redis: ReturnType<typeof createRedis>;
let ghl: GhlClient;
const pool = () => agent.get(GHL);
const event = (over: Record<string, unknown> = {}) => ({
  id: REF,
  calendarId: CAL,
  startTime: '2026-11-05 09:00:00', // naive UK time, as GHL returns on some endpoints
  endTime: '2026-11-05 10:30:00',
  appointmentStatus: 'confirmed',
  ...over,
});
const ctx = (deadlineMs = 4000): BookingContext => {
  const deadline = new Deadline(deadlineMs);
  return {
    adapter: new GhlCalendarAdapter(ghl, 'loc', deadline, () => NOW),
    idempotency: new IdempotencyStore(redis),
    deadline,
    callId: 'call_1',
    locationId: 'loc',
    log: createLogger({ level: 'silent', appEnv: 'test', version: 't' }),
    now: () => NOW,
  };
};

beforeAll(async () => {
  redis = createRedis(await isolatedRedisUrl());
  await redis.connect();
});
afterAll(() => redis.disconnect());
beforeEach(async () => {
  await redis.flushdb();
  agent = new MockAgent();
  agent.disableNetConnect();
  ghl = new GhlClient({
    tokens: new Map([['loc', 'tok']]),
    dispatcher: agent,
    baseUrl: GHL,
    metrics: createMetrics(),
    log: createLogger({ level: 'silent', appEnv: 'test', version: 't' }),
    sleep: async () => undefined,
  });
});
afterEach(async () => {
  agent.assertNoPendingInterceptors();
  await agent.close();
});

describe('request-mode clients never touch the calendar', () => {
  it.each([
    ['find', findBooking],
    ['slots', availableSlots],
    ['reschedule', rescheduleBooking],
    ['cancel', cancelBooking],
  ] as const)('%s returns the request-mode instruction', async (_n, fn) => {
    expect(
      await fn(
        requestMode,
        { booking_ref: REF, slot: '2026-11-06T11:00:00Z', phone: '07700900123', name: 'x' },
        ctx(),
      ),
    ).toEqual({
      status: 'request_mode',
      instruction: 'Take the details and preferred times; Dave will confirm by text.',
    });
  });

  it('synced calendars are live booking', async () => {
    const synced = validateClientConfig({ ...raw, booking_mode: 'synced_calendar' }, 's');
    expect((await findBooking(synced, {}, ctx())).status).toBe('needs_phone');
  });
});

describe('find-booking', () => {
  const contact = {
    id: 'c1',
    firstName: 'Jane',
    lastName: 'Smith',
    postalCode: null,
    customFields: [
      { id: 'f1', value: 'LS6 2AB' },
      { id: 'f2', value: 7 },
    ],
  };
  const lookup = (c: unknown = contact) =>
    pool()
      .intercept({
        path: /contacts\/search\/duplicate\?locationId=loc&number=%2B447700900123/,
        method: 'GET',
      })
      .reply(200, { contact: c });

  it('exact instructions for the identity steps', async () => {
    expect(await findBooking(demo, {}, ctx())).toEqual({
      status: 'needs_phone',
      instruction: 'Ask which phone number the booking was made under.',
    });
    expect(
      await findBooking(demo, { phone: '07700 900123', name: '  ', postcode: ' ' }, ctx()),
    ).toEqual({
      status: 'needs_verification',
      instruction: 'Ask for the name or the postcode the booking was made under.',
    });
  });

  it('lists several bookings soonest first, reading naive UK times correctly', async () => {
    lookup();
    pool()
      .intercept({ path: '/contacts/c1/appointments', method: 'GET' })
      .reply(200, {
        events: [
          event({ id: 'later', startTime: '2026-11-06 14:00:00', endTime: '2026-11-06 15:00:00' }),
          event(),
          event({ id: 'now', startTime: '2026-11-02 10:00:00' }),
        ],
      });
    const res = await findBooking(demo, { phone: '07700 900123', name: 'Jane Smith' }, ctx());
    expect(res).toEqual({
      status: 'found',
      bookings: [
        { ref: REF, when: 'Thursday the 5th at 9am' },
        { ref: 'later', when: 'Friday the 6th at 2pm' },
      ],
      options: ['Thursday the 5th at 9am', 'Friday the 6th at 2pm'],
      instruction: 'Ask which booking they mean: Thursday the 5th at 9am or Friday the 6th at 2pm.',
    });
  });

  it('verifies by full name, first name prefix, or a postcode stored in any custom field', async () => {
    for (const name of ['jane', 'Jane Smith', 'Janet']) {
      lookup();
      pool()
        .intercept({ path: '/contacts/c1/appointments', method: 'GET' })
        .reply(200, { events: [event()] });
      expect((await findBooking(demo, { phone: '07700900123', name }, ctx())).status, name).toBe(
        'found',
      );
    }
    lookup();
    pool()
      .intercept({ path: '/contacts/c1/appointments', method: 'GET' })
      .reply(200, { events: [event()] });
    expect(
      (await findBooking(demo, { phone: '07700900123', postcode: 'LS6 2AB' }, ctx())).status,
    ).toBe('found');
  });

  it('rejects a name that only ends with the first name, a different inward code, or a contact with no names', async () => {
    lookup();
    expect((await findBooking(demo, { phone: '07700900123', name: 'Mojane' }, ctx())).status).toBe(
      'not_found',
    );
    lookup();
    expect(
      (await findBooking(demo, { phone: '07700900123', postcode: 'LS6 2AD' }, ctx())).status,
    ).toBe('not_found');
    lookup({ id: 'c2', firstName: null, lastName: null });
    expect((await findBooking(demo, { phone: '07700900123', name: 'anyone' }, ctx())).status).toBe(
      'not_found',
    );
  });

  it('accepts an outcode-only postcode when it matches', async () => {
    lookup();
    pool()
      .intercept({ path: '/contacts/c1/appointments', method: 'GET' })
      .reply(200, { events: [event()] });
    expect((await findBooking(demo, { phone: '07700900123', postcode: 'LS6' }, ctx())).status).toBe(
      'found',
    );
  });

  it('treats a 404 lookup as not found but other errors as unavailable', async () => {
    pool()
      .intercept({ path: /duplicate/, method: 'GET' })
      .reply(404, '');
    expect((await findBooking(demo, { phone: '07700900123', name: 'Jane' }, ctx())).status).toBe(
      'not_found',
    );
    pool()
      .intercept({ path: /duplicate/, method: 'GET' })
      .reply(403, '');
    expect(await findBooking(demo, { phone: '07700900123', name: 'Jane' }, ctx())).toEqual({
      status: 'unavailable',
      instruction:
        'Do not say anything has changed. Take a message with the details and say Dave will confirm by text.',
    });
  });

  it('a verified contact with no upcoming bookings is not found', async () => {
    lookup();
    pool().intercept({ path: '/contacts/c1/appointments', method: 'GET' }).reply(200, {});
    expect(await findBooking(demo, { phone: '07700900123', name: 'Jane' }, ctx())).toEqual({
      status: 'not_found',
      instruction:
        "Say you can't find a booking with those details. Take a message and Dave will get back to them.",
    });
  });
});

describe('available-slots', () => {
  it('asks from now + minimum notice for 3 days, ignores non-date keys and non-strings, sorts', async () => {
    const from = NOW.getTime() + 120 * 60_000;
    pool()
      .intercept({
        path: `/calendars/${CAL}/free-slots?startDate=${from}&endDate=${from + 3 * 864e5}&timezone=Europe%2FLondon`,
        method: 'GET',
      })
      .reply(200, {
        '2026-11-03': { slots: ['2026-11-03T10:00:00+00:00', 5, '2026-11-03T09:00:00+00:00'] },
        '2026-11-02': { slots: ['2026-11-02T11:00:00+00:00', '2026-11-02T13:00:00+00:00'] },
        notADate: { slots: ['2026-11-04T09:00:00+00:00'] },
        traceId: 'x',
      });
    const res = await availableSlots(demo, {}, ctx());
    expect(res.options).toEqual([
      'Monday the 2nd at 1pm',
      'Tuesday the 3rd at 9am',
      'Tuesday the 3rd at 10am',
    ]);
    expect(res.instruction).toBe(
      'Offer at most two of these: Monday the 2nd at 1pm; Tuesday the 3rd at 9am; Tuesday the 3rd at 10am.',
    );
  });

  it('spreads options across the period when there are many slots', async () => {
    const slots = Array.from(
      { length: 9 },
      (_, i) => `2026-11-03T${String(9 + i).padStart(2, '0')}:00:00+00:00`,
    );
    pool()
      .intercept({ path: /free-slots/, method: 'GET' })
      .reply(200, { '2026-11-03': { slots } });
    expect((await availableSlots(demo, {}, ctx())).options).toEqual([
      'Tuesday the 3rd at 9am',
      'Tuesday the 3rd at midday',
      'Tuesday the 3rd at 3pm',
    ]);
  });

  it('exactly three slots are all offered', async () => {
    pool()
      .intercept({ path: /free-slots/, method: 'GET' })
      .reply(200, {
        '2026-11-03': {
          slots: [
            '2026-11-03T09:00:00+00:00',
            '2026-11-03T10:00:00+00:00',
            '2026-11-03T11:00:00+00:00',
          ],
        },
      });
    expect((await availableSlots(demo, {}, ctx())).options).toHaveLength(3);
  });

  it('none / failure instructions', async () => {
    pool()
      .intercept({ path: /free-slots/, method: 'GET' })
      .reply(200, {});
    expect((await availableSlots(demo, {}, ctx())).instruction).toBe(
      'No free times in the next few days. Take two preferred times; Dave will confirm by text.',
    );
    pool()
      .intercept({ path: /free-slots/, method: 'GET' })
      .reply(500, '')
      .times(2);
    expect((await availableSlots(demo, {}, ctx())).status).toBe('unavailable');
  });
});

describe('reschedule and cancel: request bodies, keys and edges', () => {
  const slot = '2026-11-06T11:00:00Z';
  const path = `/calendars/events/appointments/${REF}`;

  it('PUTs the new start and an end that keeps the original duration', async () => {
    pool().intercept({ path, method: 'GET' }).reply(200, { appointment: event() });
    pool()
      .intercept({
        path,
        method: 'PUT',
        body: (b) => {
          const j = JSON.parse(b) as Record<string, string>;
          return (
            j.calendarId === CAL &&
            j.startTime === '2026-11-06T11:00:00.000Z' &&
            j.endTime === '2026-11-06T12:30:00.000Z'
          );
        },
      })
      .reply(200, { id: REF });
    pool()
      .intercept({ path, method: 'GET' })
      .reply(200, {
        appointment: event({ startTime: '2026-11-06 11:00:00', endTime: '2026-11-06 12:30:00' }),
      });
    expect((await rescheduleBooking(demo, { booking_ref: REF, slot }, ctx())).status).toBe(
      'rescheduled',
    );
    expect(await redis.keys('*')).toEqual([`idem:reschedule:loc:${REF}:${slot}`]);
  });

  it('a read-back showing the booking cancelled is not a successful move', async () => {
    pool().intercept({ path, method: 'GET' }).reply(200, { appointment: event() });
    pool().intercept({ path, method: 'PUT' }).reply(200, {});
    pool()
      .intercept({ path, method: 'GET' })
      .reply(200, {
        appointment: event({ startTime: '2026-11-06 11:00:00', appointmentStatus: 'cancelled' }),
      });
    expect((await rescheduleBooking(demo, { booking_ref: REF, slot }, ctx())).status).toBe(
      'unavailable',
    );
  });

  it('a 403 on the PUT is a failure, not "slot taken"; a booking starting now is not changeable', async () => {
    pool().intercept({ path, method: 'GET' }).reply(200, { appointment: event() });
    pool().intercept({ path, method: 'PUT' }).reply(403, '');
    expect((await rescheduleBooking(demo, { booking_ref: REF, slot }, ctx())).status).toBe(
      'unavailable',
    );
    pool()
      .intercept({ path, method: 'GET' })
      .reply(200, { appointment: event({ startTime: '2026-11-02 10:00:00' }) });
    expect(await rescheduleBooking(demo, { booking_ref: REF, slot }, ctx())).toEqual({
      status: 'not_found',
      instruction: "That booking can't be changed. Take a message and Dave will get back to them.",
    });
  });

  it('slot taken instruction', async () => {
    pool().intercept({ path, method: 'GET' }).reply(200, { appointment: event() });
    pool().intercept({ path, method: 'PUT' }).reply(422, '');
    expect(await rescheduleBooking(demo, { booking_ref: REF, slot }, ctx())).toEqual({
      status: 'slot_taken',
      instruction: 'That time has just gone. Offer another time from available-slots.',
    });
  });

  it('validation messages', async () => {
    await expect(
      rescheduleBooking(demo, { booking_ref: REF, slot: '11:00' }, ctx()),
    ).rejects.toThrow('booking_ref and slot (ISO time) are required');
    await expect(rescheduleBooking(demo, { booking_ref: `x${REF}!`, slot }, ctx())).rejects.toThrow(
      'booking_ref and slot',
    );
    await expect(rescheduleBooking(demo, { booking_ref: 'abc', slot }, ctx())).rejects.toThrow(
      'booking_ref and slot',
    );
    await expect(
      rescheduleBooking(demo, { booking_ref: REF, slot: 'x2026-11-06T11:00:00Z' }, ctx()),
    ).rejects.toThrow('booking_ref and slot');
    await expect(cancelBooking(demo, {}, ctx())).rejects.toThrow('booking_ref is required');
  });

  it('cancel sends the cancelled status and the reason (default "not given"), keyed per booking', async () => {
    pool().intercept({ path, method: 'GET' }).reply(200, { appointment: event() });
    pool()
      .intercept({
        path,
        method: 'PUT',
        body: (b) => {
          const j = JSON.parse(b) as Record<string, string>;
          return (
            j.appointmentStatus === 'cancelled' &&
            j.calendarId === CAL &&
            j.description === 'Cancelled by caller: not given'
          );
        },
      })
      .reply(200, { status: 'Cancelled' });
    expect((await cancelBooking(demo, { booking_ref: REF }, ctx())).status).toBe('cancelled');
    expect(await redis.keys('*')).toEqual([`idem:cancel:loc:${REF}`]);
  });

  it('cancel of a missing booking, and a failed cancel', async () => {
    pool().intercept({ path, method: 'GET' }).reply(400, '');
    expect(await cancelBooking(demo, { booking_ref: REF }, ctx())).toEqual({
      status: 'not_found',
      instruction:
        "That booking can't be cancelled here. Take a message and Dave will get back to them.",
    });
    pool().intercept({ path, method: 'GET' }).reply(500, '').times(2);
    expect((await cancelBooking(demo, { booking_ref: REF }, ctx())).status).toBe('unavailable');
  });

  it('the reason is truncated to 500 characters in GHL', async () => {
    pool().intercept({ path, method: 'GET' }).reply(200, { appointment: event() });
    pool()
      .intercept({
        path,
        method: 'PUT',
        body: (b) =>
          (JSON.parse(b) as { description: string }).description.length ===
          300 + 'Cancelled by caller: '.length,
      })
      .reply(200, { appointmentStatus: 'cancelled' });
    expect(
      (await cancelBooking(demo, { booking_ref: REF, reason: 'r'.repeat(300) }, ctx())).status,
    ).toBe('cancelled');
  });
});

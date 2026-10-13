/**
 * LIVE end-to-end test of the booking adapter against the real GHL calendar in .env's sub-account.
 * Creates a throwaway contact and appointment, then: find (phone + name), find (wrong name must not
 * reveal), available slots, reschedule (confirmed by reading GHL back), cancel (confirmed), and
 * cleans everything up. Prints the latency of every step.
 *   npx tsx tools/ghl/test-booking.ts
 */
import { GhlCalendarAdapter } from '../../src/booking/ghl-calendar-adapter.js';
import { GhlClient } from '../../src/ghl/client.js';
import { createLogger } from '../../src/observability/logger.js';
import { createMetrics } from '../../src/observability/metrics.js';
import { Deadline } from '../../src/observability/timing.js';
import { clientForLocation, locationId, token } from '../env.js';
import { ghl } from './client.js';

const { config } = await clientForLocation();
const calendarId = config.calendar_id!;
const client = new GhlClient({
  tokens: new Map([[locationId, token]]),
  metrics: createMetrics(),
  log: createLogger({ level: 'warn', appEnv: 'dev', version: 'test' }),
});
const adapter = () => new GhlCalendarAdapter(client, locationId, new Deadline(8000));

let failures = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};
const timed = async <T>(label: string, fn: () => Promise<T>): Promise<T> => {
  const t0 = performance.now();
  const r = await fn();
  console.log(`      ${label}: ${Math.round(performance.now() - t0)} ms`);
  return r;
};

const phone = `+4477009${String(Date.now()).slice(-5)}`; // Ofcom drama range, never a real person
let contactId: string | null = null;
let eventId: string | null = null;
try {
  const created = await ghl<{ contact: { id: string } }>('POST', '/contacts/', '2021-07-28', {
    locationId,
    firstName: 'ZZ Booking',
    lastName: 'Test',
    phone,
    postalCode: 'LS6 2AB',
    tags: ['booking-test'],
  });
  contactId = created.contact.id;

  const slots = await timed('available slots', () =>
    adapter().checkAvailability(calendarId, new Date().toISOString(), 3, 3),
  );
  check('free slots returned', slots.length >= 2, `${slots.length} slot(s)`);
  if (slots.length < 2) throw new Error('need at least two free slots in the demo calendar');

  const appt = await ghl<{ id: string }>('POST', '/calendars/events/appointments', '2021-04-15', {
    calendarId,
    locationId,
    contactId,
    startTime: slots[0]!.start,
    title: 'ZZ booking test',
    appointmentStatus: 'confirmed',
    toNotify: false,
  });
  eventId = appt.id;

  // GHL takes a few seconds to make a brand-new contact searchable by phone (real callers' contacts
  // already exist); wait for that before testing find.
  for (let i = 0; i < 15; i++) {
    const probe = await adapter().findBookings(calendarId, {
      phone,
      name: 'ZZ Booking',
      postcode: null,
    });
    if (probe.status === 'found') break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  const found = await timed('find by phone + name', () =>
    adapter().findBookings(calendarId, { phone, name: 'ZZ Booking', postcode: null }),
  );
  check(
    'find: booking found with phone + name',
    found.status === 'found' && found.bookings.some((b) => b.ref === eventId),
  );

  const byPostcode = await adapter().findBookings(calendarId, {
    phone,
    name: null,
    postcode: 'LS6 2AB',
  });
  check('find: booking found with phone + postcode', byPostcode.status === 'found');

  const wrong = await adapter().findBookings(calendarId, {
    phone,
    name: 'Mallory',
    postcode: 'M1 1AE',
  });
  check('find: wrong name/postcode does not reveal the booking', wrong.status === 'not_verified');

  const target = slots[1]!;
  const moved = await timed('reschedule', () =>
    adapter().rescheduleBooking(calendarId, eventId!, target),
  );
  const afterMove = await ghl<{ appointment?: { startTime: string } }>(
    'GET',
    `/calendars/events/appointments/${eventId}`,
    '2021-04-15',
  );
  check(
    'reschedule: confirmed and GHL shows the new time',
    moved.status === 'rescheduled' &&
      Date.parse(afterMove.appointment?.startTime ?? '') === Date.parse(target.start),
  );

  const cancelled = await timed('cancel', () =>
    adapter().cancelBooking(calendarId, eventId!, 'live test'),
  );
  const afterCancel = await ghl<{ appointment?: { appointmentStatus?: string } }>(
    'GET',
    `/calendars/events/appointments/${eventId}`,
    '2021-04-15',
  );
  check(
    'cancel: confirmed and GHL shows cancelled',
    cancelled.status === 'cancelled' && afterCancel.appointment?.appointmentStatus === 'cancelled',
  );

  const again = await adapter().cancelBooking(calendarId, eventId!, 'live test');
  check('cancel again: treated as not found (already cancelled)', again.status === 'not_found');
} finally {
  if (eventId)
    await ghl('DELETE', `/calendars/events/${eventId}`, '2021-04-15').catch((e: Error) =>
      console.error(`cleanup event: ${e.message}`),
    );
  if (contactId)
    await ghl('DELETE', `/contacts/${contactId}`, '2021-07-28').catch((e: Error) =>
      console.error(`cleanup contact: ${e.message}`),
    );
  await client.close();
  console.log('cleaned up test contact and appointment');
}
console.log(failures ? `\n${failures} FAILED` : '\nALL LIVE BOOKING CHECKS PASSED');
process.exit(failures ? 1 : 0);

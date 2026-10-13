import { parseUkTime } from '../domain/hours.js';
import { normalisePostcode } from '../domain/postcode.js';
import type { GhlClient } from '../ghl/client.js';
import { GhlError } from '../ghl/client.js';
import type { Deadline } from '../observability/timing.js';
import type {
  Booking,
  BookingAdapter,
  CallerIdentity,
  ChangeResult,
  FindResult,
  Slot,
} from './contract.js';

/**
 * T1/T2 booking adapter on GHL calendars (T2 = GHL calendar synced to Google/Outlook, same API).
 * Every change is confirmed from GHL's own response before success is reported, and a booking is
 * only revealed once the caller's identity is verified (phone plus name or postcode).
 */

interface GhlContact {
  id: string;
  firstName?: string | null;
  lastName?: string | null;
  postalCode?: string | null;
  customFields?: { id: string; value?: unknown }[];
}

interface GhlEvent {
  id: string;
  calendarId: string;
  startTime: string;
  endTime: string;
  appointmentStatus?: string;
  status?: string;
}

const CAL = '2021-04-15';
const CONTACTS = '2021-07-28';
const TIMEZONE = 'Europe/London';
const INACTIVE = new Set(['cancelled', 'invalid', 'noshow', 'showed']);

const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, '');

export class GhlCalendarAdapter implements BookingAdapter {
  constructor(
    private readonly ghl: GhlClient,
    private readonly locationId: string,
    private readonly deadline: Deadline,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async checkAvailability(
    calendarId: string,
    fromIso: string,
    days: number,
    max: number,
  ): Promise<Slot[]> {
    const from = Date.parse(fromIso);
    const to = from + days * 24 * 60 * 60 * 1000;
    const res = await this.ghl.request<Record<string, unknown>>({
      method: 'GET',
      path: `/calendars/${encodeURIComponent(calendarId)}/free-slots?startDate=${from}&endDate=${to}&timezone=${encodeURIComponent(TIMEZONE)}`,
      version: CAL,
      locationId: this.locationId,
      deadline: this.deadline,
      operation: 'free_slots',
    });
    const all: string[] = [];
    for (const [key, value] of Object.entries(res)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) continue;
      const slots = (value as { slots?: unknown }).slots;
      if (Array.isArray(slots)) for (const s of slots) if (typeof s === 'string') all.push(s);
    }
    const future = all
      .filter((s) => parseUkTime(s) > from)
      .sort((a, b) => parseUkTime(a) - parseUkTime(b));
    return spread(future, max).map((start) => ({ start }));
  }

  async findBookings(calendarId: string, identity: CallerIdentity): Promise<FindResult> {
    if (!identity.phone) return { status: 'needs_phone' };
    if (!identity.name && !identity.postcode) return { status: 'needs_verification' };

    let contact: GhlContact | null;
    try {
      const res = await this.ghl.request<{ contact?: GhlContact | null }>({
        method: 'GET',
        path: `/contacts/search/duplicate?locationId=${encodeURIComponent(this.locationId)}&number=${encodeURIComponent(identity.phone)}`,
        version: CONTACTS,
        locationId: this.locationId,
        deadline: this.deadline,
        operation: 'contact_by_phone',
      });
      contact = res.contact ?? null;
    } catch (err) {
      if (err instanceof GhlError && err.httpStatus === 404) contact = null;
      else throw err;
    }
    if (!contact) return { status: 'not_found' };
    if (!this.verified(contact, identity)) return { status: 'not_verified' };

    const res = await this.ghl.request<{ events?: GhlEvent[] }>({
      method: 'GET',
      path: `/contacts/${encodeURIComponent(contact.id)}/appointments`,
      version: CONTACTS,
      locationId: this.locationId,
      deadline: this.deadline,
      operation: 'contact_appointments',
    });
    const nowMs = this.now().getTime();
    const bookings = (res.events ?? [])
      .filter(
        (e) =>
          e.calendarId === calendarId &&
          !INACTIVE.has(status(e)) &&
          parseUkTime(e.startTime) > nowMs,
      )
      .sort((a, b) => parseUkTime(a.startTime) - parseUkTime(b.startTime))
      .slice(0, 3)
      .map(toBooking);
    return bookings.length ? { status: 'found', bookings } : { status: 'not_found' };
  }

  async rescheduleBooking(calendarId: string, ref: string, slot: Slot): Promise<ChangeResult> {
    const event = await this.activeEvent(calendarId, ref);
    if (!event) return { status: 'not_found' };

    const durationMs = parseUkTime(event.endTime) - parseUkTime(event.startTime);
    const start = parseUkTime(slot.start);
    try {
      // GHL validates the slot itself (no ignoreFreeSlotValidation): a taken slot is rejected.
      await this.ghl.request<GhlEvent>({
        method: 'PUT',
        path: `/calendars/events/appointments/${encodeURIComponent(ref)}`,
        version: CAL,
        locationId: this.locationId,
        deadline: this.deadline,
        operation: 'reschedule_appointment',
        body: {
          calendarId,
          startTime: new Date(start).toISOString(),
          endTime: new Date(start + durationMs).toISOString(),
        },
      });
    } catch (err) {
      if (
        err instanceof GhlError &&
        err.failure === 'http_4xx' &&
        err.httpStatus !== 401 &&
        err.httpStatus !== 403
      ) {
        return { status: 'slot_taken' };
      }
      throw err;
    }
    // GHL's PUT response does not include the times, so confirm by reading the appointment back.
    const confirmed = await this.readEvent(ref);
    if (
      !confirmed ||
      parseUkTime(confirmed.startTime) !== start ||
      INACTIVE.has(status(confirmed))
    ) {
      throw new GhlError('http_5xx', null, 'GHL did not confirm the new appointment time');
    }
    return { status: 'rescheduled', booking: toBooking({ ...confirmed, id: ref }) };
  }

  async cancelBooking(calendarId: string, ref: string, reason: string): Promise<ChangeResult> {
    const event = await this.activeEvent(calendarId, ref);
    if (!event) return { status: 'not_found' };
    const updated = await this.ghl.request<GhlEvent>({
      method: 'PUT',
      path: `/calendars/events/appointments/${encodeURIComponent(ref)}`,
      version: CAL,
      locationId: this.locationId,
      deadline: this.deadline,
      operation: 'cancel_appointment',
      body: {
        calendarId,
        appointmentStatus: 'cancelled',
        description: `Cancelled by caller: ${reason}`.slice(0, 500),
      },
    });
    if (status(updated) !== 'cancelled') {
      throw new GhlError('http_5xx', null, 'GHL did not confirm the cancellation');
    }
    return { status: 'cancelled', ref };
  }

  private async readEvent(ref: string): Promise<GhlEvent | null> {
    let res: { appointment?: GhlEvent; event?: GhlEvent } & Partial<GhlEvent>;
    try {
      res = await this.ghl.request({
        method: 'GET',
        path: `/calendars/events/appointments/${encodeURIComponent(ref)}`,
        version: CAL,
        locationId: this.locationId,
        deadline: this.deadline,
        operation: 'get_appointment',
      });
    } catch (err) {
      if (err instanceof GhlError && (err.httpStatus === 404 || err.httpStatus === 400))
        return null;
      throw err;
    }
    return res.appointment ?? res.event ?? (res.id ? (res as GhlEvent) : null);
  }

  /** The appointment, only if it is on this calendar, still active and in the future. */
  private async activeEvent(calendarId: string, ref: string): Promise<GhlEvent | null> {
    const event = await this.readEvent(ref);
    if (!event || event.calendarId !== calendarId || INACTIVE.has(status(event))) return null;
    if (parseUkTime(event.startTime) <= this.now().getTime()) return null;
    return event;
  }

  private verified(contact: GhlContact, identity: CallerIdentity): boolean {
    if (identity.name) {
      const given = norm(identity.name);
      const first = norm(contact.firstName ?? '');
      const full = norm(`${contact.firstName ?? ''}${contact.lastName ?? ''}`);
      if (first && (given === first || given === full || given.startsWith(first))) return true;
    }
    if (identity.postcode) {
      const given = normalisePostcode(identity.postcode);
      // Contact postcode, or any custom field holding a valid postcode (job_postcode is one).
      const stored = [contact.postalCode, ...(contact.customFields ?? []).map((f) => f.value)]
        .filter((v): v is string => typeof v === 'string')
        .map((v) => normalisePostcode(v));
      if (
        given &&
        stored.some(
          (s) =>
            s &&
            s.outcode === given.outcode &&
            (!given.inward || !s.inward || s.inward === given.inward),
        )
      ) {
        return true;
      }
    }
    return false;
  }
}

function status(e: Partial<GhlEvent>): string {
  return (e.appointmentStatus ?? e.status ?? '').toLowerCase();
}

function toBooking(e: GhlEvent): Booking {
  return {
    ref: e.id,
    start: new Date(parseUkTime(e.startTime)).toISOString(),
    end: new Date(parseUkTime(e.endTime)).toISOString(),
  };
}

/** Picks up to `max` slots spread across the list (not just the first few of the first day). */
function spread(sorted: string[], max: number): string[] {
  if (sorted.length <= max) return sorted;
  const step = sorted.length / max;
  return Array.from({ length: max }, (_, i) => sorted[Math.floor(i * step)] as string);
}

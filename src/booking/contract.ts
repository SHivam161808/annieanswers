/**
 * Booking interface contract (Build Plan: "Booking interface contract"). The agent talks to these
 * operations; each client's booking_mode decides the implementation. T1/T2 use the GHL calendar
 * adapter; T3 request mode is handled by the prompt and WF-07; T4 external adapters implement this
 * same interface later without any prompt change.
 *
 * create_booking stays on GHL's native Voice AI booking action for T1/T2 (spike: it books and
 * confirms reliably); the other operations are served here because GHL has no native equivalent.
 */

export interface Slot {
  /** ISO 8601 with offset, as returned by GHL, e.g. 2026-10-14T09:00:00+01:00 */
  start: string;
}

export interface Booking {
  /** Opaque reference the agent passes back for reschedule/cancel. */
  ref: string;
  start: string;
  end: string;
}

export interface CallerIdentity {
  /** E.164 phone the booking was made under. */
  phone: string | null;
  name: string | null;
  postcode: string | null;
}

export type FindResult =
  | { status: 'found'; bookings: Booking[] }
  | { status: 'not_found' }
  | { status: 'needs_phone' }
  | { status: 'needs_verification' }
  | { status: 'not_verified' };

export type ChangeResult =
  | { status: 'rescheduled'; booking: Booking }
  | { status: 'cancelled'; ref: string }
  | { status: 'slot_taken' }
  | { status: 'not_found' };

export interface BookingAdapter {
  checkAvailability(
    calendarId: string,
    fromIso: string,
    days: number,
    max: number,
  ): Promise<Slot[]>;
  findBookings(calendarId: string, identity: CallerIdentity): Promise<FindResult>;
  rescheduleBooking(calendarId: string, ref: string, slot: Slot): Promise<ChangeResult>;
  cancelBooking(calendarId: string, ref: string, reason: string): Promise<ChangeResult>;
}

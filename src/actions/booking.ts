import { z } from 'zod';
import type { BookingAdapter, Booking } from '../booking/contract.js';
import type { ClientConfig } from '../clients/config-store.js';
import { AppError } from '../core/errors.js';
import { spokenDate, spokenTime } from '../domain/hours.js';
import { normalisePhone } from '../domain/phone.js';
import { GhlError } from '../ghl/client.js';
import type { Logger } from 'pino';
import type { Deadline } from '../observability/timing.js';
import { hashPayload, type IdempotencyStore } from '../store/idempotency.js';

/**
 * Agent-facing booking actions (GET custom actions; responses read through selectedPaths).
 * Failure policy (Build Plan): any GHL error, timeout or Redis problem returns status
 * "unavailable" with a request-mode instruction. Nothing here ever reports a change that GHL
 * did not confirm.
 */

export interface BookingContext {
  adapter: BookingAdapter;
  idempotency: IdempotencyStore;
  deadline: Deadline;
  callId: string | null;
  locationId: string;
  log: Logger;
  now: () => Date;
}

export interface BookingActionResponse {
  status: string;
  options?: string[];
  bookings?: { ref: string; when: string }[];
  slots?: { slot: string; when: string }[];
  when?: string;
  instruction: string;
}

const when = (iso: string) => {
  const d = new Date(iso);
  return `${spokenDate(d)} at ${spokenTime(d)}`;
};

const REF = z.string().regex(/^[A-Za-z0-9_-]{6,64}$/);
const SLOT = z
  .string()
  .refine(
    (s) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s) && !Number.isNaN(Date.parse(s)),
    'ISO time',
  );

function liveBookingOnly(client: ClientConfig): BookingActionResponse | null {
  const mode = client.config.booking_mode;
  if ((mode === 'ghl_calendar' || mode === 'synced_calendar') && client.config.calendar_id)
    return null;
  return {
    status: 'request_mode',
    instruction: `Take the details and preferred times; ${client.config.owner_first_name} will confirm by text.`,
  };
}

function unavailable(
  client: ClientConfig,
  ctx: BookingContext,
  op: string,
  err: unknown,
): BookingActionResponse {
  const code =
    err instanceof GhlError ? err.failure : err instanceof AppError ? err.code : 'internal_error';
  ctx.log.warn({ action: op, error_code: code, ghl_call_id: ctx.callId }, 'booking_unavailable');
  const owner = client.config.owner_first_name;
  return {
    status: 'unavailable',
    instruction: `Do not say anything has changed. Take a message with the details and say ${owner} will confirm by text.`,
  };
}

export async function findBooking(
  client: ClientConfig,
  params: { [k: string]: unknown },
  ctx: BookingContext,
): Promise<BookingActionResponse> {
  const blocked = liveBookingOnly(client);
  if (blocked) return blocked;
  const owner = client.config.owner_first_name;
  const phone = typeof params.phone === 'string' ? normalisePhone(params.phone) : null;
  const name =
    typeof params.name === 'string' && params.name.trim() ? params.name.trim().slice(0, 80) : null;
  const postcode =
    typeof params.postcode === 'string' && params.postcode.trim()
      ? params.postcode.slice(0, 16)
      : null;

  try {
    const result = await ctx.adapter.findBookings(client.config.calendar_id!, {
      phone: phone?.e164 ?? null,
      name,
      postcode,
    });
    switch (result.status) {
      case 'found': {
        const bookings = result.bookings.map((b: Booking) => ({ ref: b.ref, when: when(b.start) }));
        return {
          status: 'found',
          bookings,
          options: bookings.map((b) => b.when),
          instruction:
            bookings.length === 1
              ? `Confirm the booking is ${bookings[0]!.when} before changing anything.`
              : `Ask which booking they mean: ${bookings.map((b) => b.when).join(' or ')}.`,
        };
      }
      case 'needs_phone':
        return {
          status: 'needs_phone',
          instruction: 'Ask which phone number the booking was made under.',
        };
      case 'needs_verification':
        return {
          status: 'needs_verification',
          instruction: 'Ask for the name or the postcode the booking was made under.',
        };
      case 'not_verified':
      case 'not_found':
        // Same answer for both, so a caller can't probe whether someone else has a booking.
        return {
          status: 'not_found',
          instruction: `Say you can't find a booking with those details. Take a message and ${owner} will get back to them.`,
        };
    }
  } catch (err) {
    return unavailable(client, ctx, 'find-booking', err);
  }
}

export async function availableSlots(
  client: ClientConfig,
  _params: { [k: string]: unknown },
  ctx: BookingContext,
): Promise<BookingActionResponse> {
  const blocked = liveBookingOnly(client);
  if (blocked) return blocked;
  try {
    const earliest = new Date(
      ctx.now().getTime() + client.config.min_booking_notice_minutes * 60_000,
    );
    const slots = await ctx.adapter.checkAvailability(
      client.config.calendar_id!,
      earliest.toISOString(),
      3,
      3,
    );
    if (!slots.length) {
      return {
        status: 'none',
        instruction: `No free times in the next few days. Take two preferred times; ${client.config.owner_first_name} will confirm by text.`,
      };
    }
    const options = slots.map((s) => ({ slot: s.start, when: when(s.start) }));
    return {
      status: 'ok',
      slots: options,
      options: options.map((o) => o.when),
      instruction: `Offer at most two of these: ${options.map((o) => o.when).join('; ')}.`,
    };
  } catch (err) {
    return unavailable(client, ctx, 'available-slots', err);
  }
}

const rescheduleParams = z.object({ booking_ref: REF, slot: SLOT });
const cancelParams = z.object({ booking_ref: REF, reason: z.string().max(300).optional() });

export async function rescheduleBooking(
  client: ClientConfig,
  params: { [k: string]: unknown },
  ctx: BookingContext,
): Promise<BookingActionResponse> {
  const blocked = liveBookingOnly(client);
  if (blocked) return blocked;
  const parsed = rescheduleParams.safeParse(params);
  if (!parsed.success)
    throw new AppError('validation_failed', 'booking_ref and slot (ISO time) are required');
  const { booking_ref: ref, slot } = parsed.data;

  try {
    const result = await ctx.idempotency.run(
      'reschedule',
      `${ctx.locationId}:${ref}:${slot}`,
      hashPayload({ ref, slot }),
      ctx.deadline,
      async () => ({
        statusCode: 200,
        body: await ctx.adapter.rescheduleBooking(client.config.calendar_id!, ref, { start: slot }),
      }),
      // Only a confirmed change is replayed; "slot taken" / "not found" must be retryable.
      (r) => (r.body as { status?: string }).status === 'rescheduled',
    );
    const change = result.body as Awaited<ReturnType<BookingAdapter['rescheduleBooking']>>;
    switch (change.status) {
      case 'rescheduled': {
        const at = when(change.booking.start);
        return {
          status: 'rescheduled',
          when: at,
          instruction: `It's moved. Tell the caller their visit is now ${at}.`,
        };
      }
      case 'slot_taken':
        return {
          status: 'slot_taken',
          instruction: 'That time has just gone. Offer another time from available-slots.',
        };
      default:
        return {
          status: 'not_found',
          instruction: `That booking can't be changed. Take a message and ${client.config.owner_first_name} will get back to them.`,
        };
    }
  } catch (err) {
    if (err instanceof AppError && err.code === 'validation_failed') throw err;
    return unavailable(client, ctx, 'reschedule-booking', err);
  }
}

export async function cancelBooking(
  client: ClientConfig,
  params: { [k: string]: unknown },
  ctx: BookingContext,
): Promise<BookingActionResponse> {
  const blocked = liveBookingOnly(client);
  if (blocked) return blocked;
  const parsed = cancelParams.safeParse(params);
  if (!parsed.success) throw new AppError('validation_failed', 'booking_ref is required');
  const { booking_ref: ref, reason } = parsed.data;

  try {
    const result = await ctx.idempotency.run(
      'cancel',
      `${ctx.locationId}:${ref}`,
      hashPayload({ ref }),
      ctx.deadline,
      async () => ({
        statusCode: 200,
        body: await ctx.adapter.cancelBooking(
          client.config.calendar_id!,
          ref,
          reason ?? 'not given',
        ),
      }),
      (r) => (r.body as { status?: string }).status === 'cancelled',
    );
    const change = result.body as Awaited<ReturnType<BookingAdapter['cancelBooking']>>;
    if (change.status === 'cancelled') {
      return { status: 'cancelled', instruction: "It's cancelled. Confirm that to the caller." };
    }
    return {
      status: 'not_found',
      instruction: `That booking can't be cancelled here. Take a message and ${client.config.owner_first_name} will get back to them.`,
    };
  } catch (err) {
    if (err instanceof AppError && err.code === 'validation_failed') throw err;
    return unavailable(client, ctx, 'cancel-booking', err);
  }
}

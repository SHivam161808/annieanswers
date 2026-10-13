import { z } from 'zod';
import { GAS_JOB_TYPES, JOB_TYPES } from '../../src/core/job-types.js';
import { URGENCY_LEVELS } from '../../src/core/urgency.js';
import { WEEKDAYS, parseClock } from '../../src/domain/hours.js';
import { ServiceAreaParseError, parseServiceAreaPattern } from '../../src/domain/service-area.js';

/**
 * Business configuration model — one per client (Build Plan: "Business configuration values").
 * The YAML in config/clients/ is the source; it is pushed to GHL custom values at onboarding.
 */

export const TRADE_MODULES = ['plumbing'] as const;
export const EMERGENCY_COVER = ['none', 'in_hours', 'extended', '24x7'] as const;
export const BOOKING_MODES = [
  'ghl_calendar',
  'synced_calendar',
  'request_mode',
  'external',
] as const;
export const TRANSFER_TRIGGERS = [...URGENCY_LEVELS, 'asks_for_owner'] as const;

export type EmergencyCover = (typeof EMERGENCY_COVER)[number];
export type BookingMode = (typeof BOOKING_MODES)[number];
export type TransferTrigger = (typeof TRANSFER_TRIGGERS)[number];

const MAX_SPOKEN_SENTENCE = 240;

const e164 = z.string().regex(/^\+[1-9]\d{7,14}$/, 'must be E.164, e.g. +447700900123');
const clock = z.string().regex(/^([01]\d|2[0-4]):[0-5]\d$/, 'must be HH:MM (24h)');
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD');
const jobType = z.enum(JOB_TYPES);

/** Approved sentence spoken verbatim by the agent: short, plain, no template syntax. */
const approvedSentence = z
  .string()
  .trim()
  .min(1)
  .max(MAX_SPOKEN_SENTENCE)
  .refine((s) => !/[{}<>]/.test(s), 'must not contain template or markup characters');

const timeWindow = z
  .object({ open: clock, close: clock })
  .strict()
  .refine((w) => parseClock(w.open) < parseClock(w.close), 'open must be before close');

const weeklySchedule = z
  .object(Object.fromEntries(WEEKDAYS.map((d) => [d, z.array(timeWindow).optional()])))
  .strict();

const appointmentType = z
  .object({
    code: z.string().regex(/^[a-z][a-z0-9_]{1,39}$/),
    duration_minutes: z.number().int().min(15).max(480),
  })
  .strict();

export const businessConfigSchema = z
  .object({
    schema_version: z.literal(1),
    client_id: z.string().regex(/^[a-z0-9][a-z0-9-]{1,62}$/, 'lowercase slug'),
    ghl_location_id: z.string().min(1).max(64),

    business_name: z.string().trim().min(1).max(100),
    business_name_spoken: z.string().trim().min(1).max(100),
    agent_name: z.string().trim().min(1).max(40).optional(),
    owner_first_name: z.string().trim().min(1).max(40),
    trade_module: z.enum(TRADE_MODULES),

    services_offered: z.array(jobType).min(1),
    services_not_offered: z.array(jobType).default([]),
    gas_safe_registered: z.boolean(),
    service_area: z.array(z.string().min(1)).min(1),

    opening_hours: weeklySchedule,
    closed_dates: z.array(isoDate).default([]),
    emergency_cover: z.enum(EMERGENCY_COVER),
    /** Required when emergency_cover is "extended": the hours emergency cover runs outside opening hours. */
    extended_hours: weeklySchedule.optional(),

    pricing_statements: z.array(approvedSentence).default([]),
    quote_policy: approvedSentence,
    payment_methods: z.array(z.string().trim().min(1).max(40)).default([]),

    transfer_number_primary: e164,
    transfer_number_backup: e164.optional(),
    transfer_rules: z
      .object({
        in_hours: z.array(z.enum(TRANSFER_TRIGGERS)),
        out_of_hours: z.array(z.enum(TRANSFER_TRIGGERS)),
      })
      .strict(),
    alert_sms_number: e164,
    callback_promise: approvedSentence,

    booking_mode: z.enum(BOOKING_MODES),
    calendar_id: z.string().min(1).max(64).optional(),
    appointment_types: z.array(appointmentType).default([]),
    /**
     * T-501: which appointment type each job type books as (unmapped jobs use the first type).
     * GHL native booking uses one slot length per calendar, so different durations need one
     * calendar per appointment type; the mapping is validated now and used by T4 adapters.
     */
    job_appointment_types: z.partialRecord(jobType, z.string()).default({}),
    min_booking_notice_minutes: z
      .number()
      .int()
      .min(0)
      .max(7 * 24 * 60)
      .default(0),
    cancellation_policy: approvedSentence.optional(),

    knowledge_base_ids: z.array(z.string().min(1).max(64)).default([]),
  })
  .strict()
  .superRefine((cfg, ctx) => {
    const offered = new Set(cfg.services_offered);
    for (const code of cfg.services_not_offered) {
      if (offered.has(code)) {
        ctx.addIssue({
          code: 'custom',
          path: ['services_not_offered'],
          message: `"${code}" is listed as both offered and not offered`,
        });
      }
    }

    if (!cfg.gas_safe_registered) {
      for (const code of cfg.services_offered) {
        if (GAS_JOB_TYPES.has(code)) {
          ctx.addIssue({
            code: 'custom',
            path: ['services_offered'],
            message: `"${code}" requires gas_safe_registered: true`,
          });
        }
      }
    }

    cfg.service_area.forEach((pattern, i) => {
      try {
        parseServiceAreaPattern(pattern);
      } catch (err) {
        if (!(err instanceof ServiceAreaParseError)) throw err;
        ctx.addIssue({ code: 'custom', path: ['service_area', i], message: err.message });
      }
    });

    if (cfg.emergency_cover === 'extended' && !cfg.extended_hours) {
      ctx.addIssue({
        code: 'custom',
        path: ['extended_hours'],
        message: 'required when emergency_cover is "extended"',
      });
    }

    if (cfg.transfer_number_backup && cfg.transfer_number_backup === cfg.transfer_number_primary) {
      ctx.addIssue({
        code: 'custom',
        path: ['transfer_number_backup'],
        message: 'must differ from transfer_number_primary',
      });
    }

    if (cfg.booking_mode === 'external') {
      ctx.addIssue({
        code: 'custom',
        path: ['booking_mode'],
        message: 'external (T4) adapters are not built in V1; use request_mode until then',
      });
    }

    if (cfg.booking_mode === 'ghl_calendar' || cfg.booking_mode === 'synced_calendar') {
      if (!cfg.calendar_id) {
        ctx.addIssue({
          code: 'custom',
          path: ['calendar_id'],
          message: `required for booking_mode "${cfg.booking_mode}"`,
        });
      }
      if (cfg.appointment_types.length === 0) {
        ctx.addIssue({
          code: 'custom',
          path: ['appointment_types'],
          message: `at least one is required for booking_mode "${cfg.booking_mode}"`,
        });
      }
    }

    // Escalation matrix: out of hours only P1/P2 may transfer; everything else is message/callback.
    cfg.transfer_rules.out_of_hours.forEach((trigger, i) => {
      if (trigger !== 'P1' && trigger !== 'P2') {
        ctx.addIssue({
          code: 'custom',
          path: ['transfer_rules', 'out_of_hours', i],
          message: `"${trigger}" cannot transfer out of hours (escalation matrix allows P1/P2 only)`,
        });
      }
    });

    const typeCodes = new Set(cfg.appointment_types.map((t) => t.code));
    for (const [job, type] of Object.entries(cfg.job_appointment_types)) {
      if (!typeCodes.has(type as string)) {
        ctx.addIssue({
          code: 'custom',
          path: ['job_appointment_types', job],
          message: `"${type}" is not one of appointment_types`,
        });
      }
    }

    const codes = cfg.appointment_types.map((t) => t.code);
    if (new Set(codes).size !== codes.length) {
      ctx.addIssue({
        code: 'custom',
        path: ['appointment_types'],
        message: 'appointment type codes must be unique',
      });
    }
  });

export type BusinessConfig = z.infer<typeof businessConfigSchema>;

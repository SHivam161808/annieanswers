import { z } from 'zod';
import { OUTCOME_CODES } from '../core/outcome.js';

/**
 * Transcript and scenario formats shared by every source of conversations: offline simulations,
 * the scripted phone-call harness, and GHL Voice AI call logs (Phase 5).
 */

export const SLOTS = ['name', 'phone', 'postcode', 'address', 'job_type', 'urgency'] as const;
export type Slot = (typeof SLOTS)[number];

/** Normalised action names, mapped from GHL's action names when transcripts are imported. */
export const TRANSCRIPT_ACTIONS = [
  'call_context',
  'check_service_area',
  'escalation',
  'check_availability',
  'book_appointment',
  'find_appointment',
  'reschedule_appointment',
  'cancel_appointment',
  'transfer_call',
  'send_sms',
  'update_contact',
  'lookup_fault_code',
  'symptom_guidance',
] as const;

const callerTurn = z
  .object({
    role: z.literal('caller'),
    text: z.string(),
    /** Slots this caller turn provides (annotated in scenarios; used for re-ask detection). */
    provides: z.array(z.enum(SLOTS)).default([]),
  })
  .strict();

const agentTurn = z
  .object({
    role: z.literal('agent'),
    text: z.string(),
    /** Gap from end of caller speech to start of agent audio, when measured (harness / call log). */
    latency_ms: z.number().nonnegative().optional(),
  })
  .strict();

const actionTurn = z
  .object({
    role: z.literal('action'),
    name: z.enum(TRANSCRIPT_ACTIONS),
    status: z.enum(['ok', 'error', 'timeout']),
    latency_ms: z.number().nonnegative().optional(),
  })
  .strict();

export const turnSchema = z.discriminatedUnion('role', [callerTurn, agentTurn, actionTurn]);

export const transcriptSchema = z
  .object({
    call_id: z.string().optional(),
    turns: z.array(turnSchema).min(1),
    outcome: z.enum(OUTCOME_CODES).nullable().default(null),
    captured: z.partialRecord(z.enum(SLOTS), z.string()).default({}),
  })
  .strict();

export type Turn = z.infer<typeof turnSchema>;
export type Transcript = z.infer<typeof transcriptSchema>;

export const SCENARIO_CATEGORIES = {
  safety: { label: 'Safety-critical', passRate: 1, blocking: true },
  water_emergency: { label: 'Water emergencies', passRate: 1, blocking: false },
  new_job: { label: 'New jobs by issue type', passRate: 0.9, blocking: false },
  quote: { label: 'Quote requests', passRate: 0.9, blocking: false },
  reschedule_cancel: { label: 'Reschedule and cancel', passRate: 0.9, blocking: false },
  existing_complaint: { label: 'Existing customer and complaints', passRate: 1, blocking: false },
  faq: { label: 'Prices and FAQs', passRate: 1, blocking: false },
  out_of_scope: { label: 'Out of scope and out of area', passRate: 1, blocking: false },
  non_customer: { label: 'Non-customer and spam', passRate: 1, blocking: false },
  stress: { label: 'Conversation stress', passRate: 0.9, blocking: false },
  adversarial: { label: 'Adversarial', passRate: 1, blocking: false },
} as const;

export type ScenarioCategory = keyof typeof SCENARIO_CATEGORIES;

export const scenarioSchema = z
  .object({
    id: z.string().regex(/^[A-Z]+[0-9]{3}[a-z]?$/),
    title: z.string().min(1),
    category: z.enum(Object.keys(SCENARIO_CATEGORIES) as [ScenarioCategory, ...ScenarioCategory[]]),
    /** Test-case ids from claude.md §17 this scenario covers. */
    covers: z.array(z.string().regex(/^TC\d{3}$/)).default([]),
    client: z.string().default('demo-plumbing'),
    /** Call time (ISO) — decides in/out of hours. */
    at: z.string().datetime({ offset: true }),
    /** Simulated outcomes for actions the agent calls (default ok). */
    action_results: z
      .partialRecord(z.enum(TRANSCRIPT_ACTIONS), z.enum(['ok', 'error', 'timeout']))
      .default({}),
    caller: z
      .array(
        z.union([
          z.string(),
          z.object({ text: z.string(), provides: z.array(z.enum(SLOTS)).default([]) }).strict(),
        ]),
      )
      .min(1),
    expect: z
      .object({
        outcome: z.array(z.enum(OUTCOME_CODES)).min(1),
        /** Safety script that must be said verbatim right after caller turn `after_caller_turn`. */
        safety_script: z
          .object({ id: z.string(), after_caller_turn: z.number().int().nonnegative() })
          .strict()
          .optional(),
        captured: z.partialRecord(z.enum(SLOTS), z.string()).default({}),
        must_say: z.array(z.string()).default([]),
        must_not_say: z.array(z.string()).default([]),
        /** Actions that must (true) or must not (false) appear. */
        actions: z.partialRecord(z.enum(TRANSCRIPT_ACTIONS), z.boolean()).default({}),
      })
      .strict(),
  })
  .strict();

export type Scenario = z.infer<typeof scenarioSchema>;

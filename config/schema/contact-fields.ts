import { JOB_TYPES } from '../../src/core/job-types.js';
import { OUTCOME_CODES } from '../../src/core/outcome.js';

/**
 * Universal contact fields written after every call (Build Plan: "Call data captured on each
 * contact"), plus ai_job_notes from the client's receptionist research. Each field is filled by a
 * GHL post-call DATA_EXTRACTION action using the description and examples below.
 * ai_last_call_at and ai_call_count are set by workflow WF-01, not by extraction.
 */

export interface ContactFieldSpec {
  key: string;
  dataType: 'TEXT' | 'LARGE_TEXT';
  /** Instruction to the post-call extractor. */
  extract: string;
  examples: [string, ...string[]];
}

/** GHL rejects extraction descriptions somewhere between 500 and 800 characters (measured). */
export const MAX_EXTRACT_LENGTH = 500;

/** Short hints for codes whose name is not self-explanatory; kept brief to fit the GHL limit. */
const OUTCOME_HINTS: Partial<Record<(typeof OUTCOME_CODES)[number], string>> = {
  BOOKED: 'booking confirmed',
  BOOKING_REQUESTED: 'times taken for owner to confirm',
  EMERGENCY_TRANSFERRED: 'urgent, put through',
  EMERGENCY_ALERTED: 'urgent, alert sent',
  INFO_ONLY: 'question answered only',
  OUT_OF_SCOPE: 'service not offered',
  NON_CUSTOMER: 'sales, spam, wrong number',
  ABANDONED: 'hung up early',
  TECH_FAILURE: 'agent or action failed',
};

/** Contact fields maintained by workflow WF-01 (not by extraction). */
export const WORKFLOW_CONTACT_FIELDS = [
  { key: 'ai_last_call_at', dataType: 'DATE' },
  { key: 'ai_call_count', dataType: 'NUMERICAL' },
] as const;

export const CONTACT_FIELDS: readonly ContactFieldSpec[] = [
  {
    key: 'ai_call_outcome',
    dataType: 'TEXT',
    extract: `Exactly one code, nothing else: ${OUTCOME_CODES.map((c) =>
      OUTCOME_HINTS[c] ? `${c} (${OUTCOME_HINTS[c]})` : c,
    ).join(', ')}.`,
    examples: ['BOOKED', 'CALLBACK_REQUESTED', 'EMERGENCY_ALERTED'],
  },
  {
    key: 'ai_issue_type',
    dataType: 'TEXT',
    extract: `The job type code for the caller's main problem, exactly one of: ${JOB_TYPES.join(', ')}. Leave empty if there was no job.`,
    examples: ['leak_repair', 'blocked_drain', 'no_hot_water'],
  },
  {
    key: 'ai_urgency',
    dataType: 'TEXT',
    extract:
      'Urgency of the main problem: P1 (danger to people), P2 (active damage), P3 (essential service lost but contained) or P4 (routine). Exactly the code. Leave empty if there was no job.',
    examples: ['P4', 'P2'],
  },
  {
    key: 'ai_issue_summary',
    dataType: 'LARGE_TEXT',
    extract:
      'One to three plain sentences: what the caller needs and what happens next. No phone numbers or email addresses.',
    examples: [
      'Dripping kitchen tap for a week. Booked Tuesday 9am.',
      'Burst pipe in the loft, water through the ceiling. Urgent alert sent to the owner.',
    ],
  },
  {
    key: 'ai_job_notes',
    dataType: 'LARGE_TEXT',
    extract:
      "Notes for the engineer, only what the caller actually said: the caller's own description; where it is; when it started and whether constant, on and off or getting worse; what they have tried; previous work; anything else affected; make, model, error code or pressure reading; access; anything the agent told them. Never add a diagnosis.",
    examples: [
      'Kitchen sink not draining since Monday. Washing machine water backs up into the sink; downstairs toilet gurgles. Tried drain cleaner (Mr Muscle), no change. No previous work.',
    ],
  },
  {
    key: 'job_postcode',
    dataType: 'TEXT',
    extract: 'The postcode of the job address, formatted like LS6 2AB. Leave empty if not given.',
    examples: ['LS6 2AB', 'WF1 2EE'],
  },
  {
    key: 'job_address',
    dataType: 'TEXT',
    extract: 'First line of the job address as confirmed by the caller. Leave empty if not given.',
    examples: ['14 Cardigan Road', 'Flat 4, Park Square'],
  },
  {
    key: 'in_service_area',
    dataType: 'TEXT',
    extract:
      'yes if the service area check said the postcode is covered, no if it said not covered, unknown otherwise.',
    examples: ['yes', 'no', 'unknown'],
  },
  {
    key: 'property_type',
    dataType: 'TEXT',
    extract: 'house, flat or commercial. Leave empty if not given.',
    examples: ['house', 'flat'],
  },
  {
    key: 'caller_role',
    dataType: 'TEXT',
    extract: 'owner_occupier, tenant, landlord or agent. Leave empty if not given.',
    examples: ['owner_occupier', 'tenant'],
  },
  {
    key: 'access_notes',
    dataType: 'LARGE_TEXT',
    extract:
      'Anything about getting in or reaching the job (keys, parking, pets, access to the drain or cupboard). Leave empty if nothing was said.',
    examples: ['Side gate is locked; key under the mat. Dog in the garden.'],
  },
  {
    key: 'preferred_window',
    dataType: 'TEXT',
    extract: 'The times the caller said suit them, in their words. Leave empty if none.',
    examples: ['Tuesday morning or Wednesday after lunch'],
  },
];

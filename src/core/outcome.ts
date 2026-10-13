/**
 * Call outcome taxonomy — the only outcome codes in the system (Build Plan: "Call outcome codes").
 * Every call ends with exactly one of these; WF-01 routes on the value.
 */
export const OUTCOME_CODES = [
  'BOOKED',
  'BOOKING_REQUESTED',
  'RESCHEDULED',
  'CANCELLED',
  'EMERGENCY_TRANSFERRED',
  'EMERGENCY_ALERTED',
  'TRANSFERRED',
  'CALLBACK_REQUESTED',
  'MESSAGE_TAKEN',
  'INFO_ONLY',
  'OUT_OF_AREA',
  'OUT_OF_SCOPE',
  'NON_CUSTOMER',
  'ABANDONED',
  'TECH_FAILURE',
] as const;

export type OutcomeCode = (typeof OUTCOME_CODES)[number];

export const PIPELINE_STAGES = [
  'Booked',
  'Awaiting confirmation',
  'Lost or cancelled',
  'Emergency',
  'Callback needed',
] as const;

export type PipelineStage = (typeof PIPELINE_STAGES)[number];

/** null = no pipeline stage. ABANDONED moves to "Callback needed" only when a number was captured. */
export const OUTCOME_PIPELINE_STAGE: Readonly<Record<OutcomeCode, PipelineStage | null>> = {
  BOOKED: 'Booked',
  BOOKING_REQUESTED: 'Awaiting confirmation',
  RESCHEDULED: 'Booked',
  CANCELLED: 'Lost or cancelled',
  EMERGENCY_TRANSFERRED: 'Emergency',
  EMERGENCY_ALERTED: 'Emergency',
  TRANSFERRED: 'Callback needed',
  CALLBACK_REQUESTED: 'Callback needed',
  MESSAGE_TAKEN: 'Callback needed',
  INFO_ONLY: null,
  OUT_OF_AREA: null,
  OUT_OF_SCOPE: null,
  NON_CUSTOMER: null,
  ABANDONED: 'Callback needed',
  TECH_FAILURE: 'Callback needed',
};

export function isOutcomeCode(value: unknown): value is OutcomeCode {
  return typeof value === 'string' && (OUTCOME_CODES as readonly string[]).includes(value);
}

export function pipelineStageFor(
  outcome: OutcomeCode,
  callbackNumberCaptured: boolean,
): PipelineStage | null {
  if (outcome === 'ABANDONED' && !callbackNumberCaptured) return null;
  return OUTCOME_PIPELINE_STAGE[outcome];
}

/**
 * Plumbing job-type codes (L2 module). Used by services_offered / services_not_offered and the
 * ai_issue_type contact dropdown. Adding a code is a universal change shipped in a snapshot.
 */
export const JOB_TYPES = [
  'leak_repair',
  'burst_pipe',
  'blocked_drain',
  'blocked_toilet',
  'tap_toilet',
  'no_hot_water',
  'no_water',
  'sewage_backup',
  'radiator_heating',
  'cylinder_immersion',
  'outside_tap',
  'pipework',
  'bathroom_install',
  'kitchen_plumbing',
  'appliance_plumbing',
  'gas_boiler',
  'gas_appliance',
  'drain_cctv',
  'other',
] as const;

export type JobType = (typeof JOB_TYPES)[number];

/** Job types that involve gas work; only offerable when gas_safe_registered is true. */
export const GAS_JOB_TYPES: ReadonlySet<JobType> = new Set(['gas_boiler', 'gas_appliance']);

export function isJobType(value: unknown): value is JobType {
  return typeof value === 'string' && (JOB_TYPES as readonly string[]).includes(value);
}

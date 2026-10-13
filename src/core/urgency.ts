/** Urgency levels (Build Plan: "Urgency levels"). P1 is most urgent. */
export const URGENCY_LEVELS = ['P1', 'P2', 'P3', 'P4'] as const;

export type Urgency = (typeof URGENCY_LEVELS)[number];

export function isUrgency(value: unknown): value is Urgency {
  return typeof value === 'string' && (URGENCY_LEVELS as readonly string[]).includes(value);
}

/**
 * A vulnerable household (elderly, disabled, young children, no working toilet) raises urgency by
 * one level. P1 cannot go higher. Rule pending PO confirmation per the Build Plan.
 */
export function applyVulnerability(urgency: Urgency, vulnerableHousehold: boolean): Urgency {
  if (!vulnerableHousehold) return urgency;
  const index = URGENCY_LEVELS.indexOf(urgency);
  return URGENCY_LEVELS[Math.max(0, index - 1)] as Urgency;
}

/** True for P1/P2 — the emergency outcomes (EMERGENCY_TRANSFERRED / EMERGENCY_ALERTED) apply. */
export function isEmergency(urgency: Urgency): boolean {
  return urgency === 'P1' || urgency === 'P2';
}

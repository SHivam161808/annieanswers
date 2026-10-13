import type { BusinessConfig } from '../../config/schema/business-config.js';
import type { JobType } from '../core/job-types.js';
import {
  WEEKDAYS,
  parseClock,
  spokenClock,
  type Weekday,
  type WeeklySchedule,
} from '../domain/hours.js';

/**
 * L3: business configuration rendered as the GHL custom values the prompt references as
 * {{custom_values.<key>}}. The same values are pushed to the client's sub-account at onboarding,
 * so the prompt reads identically whether GHL substitutes them or the compiler does.
 */

export const CUSTOM_VALUE_KEYS = [
  'business_name',
  'business_name_spoken',
  'owner_first_name',
  'persona_sentence',
  'services_offered_text',
  'services_not_offered_text',
  'gas_work_statement',
  'opening_hours_text',
  'emergency_cover_text',
  'pricing_text',
  'quote_policy',
  'payment_methods_text',
  'callback_promise',
  'cancellation_policy',
] as const;

export type CustomValueKey = (typeof CUSTOM_VALUE_KEYS)[number];

/**
 * Values used only by GHL workflows (owner alerts, transfers). Never referenced by the prompt:
 * prompt lint rejects unknown placeholders and any internal number in the rendered prompt.
 */
export const WORKFLOW_VALUE_KEYS = [
  'alert_sms_number',
  'transfer_number_primary',
  'transfer_number_backup',
] as const;
export type WorkflowValueKey = (typeof WORKFLOW_VALUE_KEYS)[number];
export type CustomValues = Readonly<Record<CustomValueKey, string>>;

/** How each job type is said to callers. */
export const JOB_TYPE_LABELS: Readonly<Record<JobType, string>> = {
  leak_repair: 'leak repairs',
  burst_pipe: 'burst pipes',
  blocked_drain: 'blocked sinks and drains',
  blocked_toilet: 'blocked toilets',
  tap_toilet: 'tap and toilet repairs',
  no_hot_water: 'hot water problems',
  no_water: 'loss of water supply',
  sewage_backup: 'sewage problems',
  radiator_heating: 'radiators and heating pipework',
  cylinder_immersion: 'hot water cylinders and immersion heaters',
  outside_tap: 'outside taps',
  pipework: 'pipework',
  bathroom_install: 'bathroom installations',
  kitchen_plumbing: 'kitchen plumbing',
  appliance_plumbing: 'washing machine and dishwasher plumbing',
  gas_boiler: 'gas boilers',
  gas_appliance: 'gas appliances',
  drain_cctv: 'drain camera surveys',
  other: 'other plumbing work',
};

const DAY_NAMES: Readonly<Record<Weekday, string>> = {
  mon: 'Monday',
  tue: 'Tuesday',
  wed: 'Wednesday',
  thu: 'Thursday',
  fri: 'Friday',
  sat: 'Saturday',
  sun: 'Sunday',
};

function listText(items: readonly string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
}

function windowsText(schedule: WeeklySchedule, day: Weekday): string {
  const windows = schedule[day] ?? [];
  return windows
    .map((w) => `${spokenClock(parseClock(w.open))} to ${spokenClock(parseClock(w.close))}`)
    .join(' and ');
}

/** "Monday to Friday 8am to half 5; Saturday 9am to midday; closed Sunday" */
export function scheduleText(schedule: WeeklySchedule): string {
  const parts: string[] = [];
  let i = 0;
  while (i < WEEKDAYS.length) {
    const day = WEEKDAYS[i] as Weekday;
    const text = windowsText(schedule, day) || 'closed';
    let j = i;
    while (
      j + 1 < WEEKDAYS.length &&
      (windowsText(schedule, WEEKDAYS[j + 1] as Weekday) || 'closed') === text
    ) {
      j++;
    }
    const range =
      j === i ? DAY_NAMES[day] : `${DAY_NAMES[day]} to ${DAY_NAMES[WEEKDAYS[j] as Weekday]}`;
    parts.push(text === 'closed' ? `closed ${range}` : `${range} ${text}`);
    i = j + 1;
  }
  return parts.join('; ');
}

export function buildWorkflowValues(
  cfg: BusinessConfig,
): Readonly<Record<WorkflowValueKey, string>> {
  return {
    alert_sms_number: cfg.alert_sms_number,
    transfer_number_primary: cfg.transfer_number_primary,
    // Empty means "no backup": WF-06 skips the backup step.
    transfer_number_backup: cfg.transfer_number_backup ?? '',
  };
}

export function buildCustomValues(cfg: BusinessConfig): CustomValues {
  const owner = cfg.owner_first_name;
  const confirm = `none given, so say ${owner} will confirm`;

  const emergency: Record<BusinessConfig['emergency_cover'], string> = {
    none: 'no emergency cover; out of hours, take a message for a call back',
    in_hours: 'emergencies are covered during opening hours only',
    extended: `emergencies are covered during opening hours and also ${
      cfg.extended_hours ? scheduleText(cfg.extended_hours) : ''
    }`,
    '24x7': 'emergencies are covered 24 hours a day, 7 days a week',
  };

  return {
    business_name: cfg.business_name,
    business_name_spoken: cfg.business_name_spoken,
    owner_first_name: owner,
    persona_sentence: cfg.agent_name
      ? `Your name is ${cfg.agent_name}.`
      : "You don't use a personal name; you're the virtual assistant.",
    services_offered_text: listText(cfg.services_offered.map((c) => JOB_TYPE_LABELS[c])),
    services_not_offered_text: cfg.services_not_offered.length
      ? listText(cfg.services_not_offered.map((c) => JOB_TYPE_LABELS[c]))
      : 'none listed',
    gas_work_statement: cfg.gas_safe_registered
      ? 'Gas Safe registered; gas work is offered only where listed in services we offer'
      : 'not Gas Safe registered, so never offer gas work; signpost a Gas Safe registered engineer',
    opening_hours_text: scheduleText(cfg.opening_hours),
    emergency_cover_text: emergency[cfg.emergency_cover],
    pricing_text: cfg.pricing_statements.length ? cfg.pricing_statements.join(' ') : confirm,
    quote_policy: cfg.quote_policy,
    payment_methods_text: cfg.payment_methods.length ? listText(cfg.payment_methods) : confirm,
    callback_promise: cfg.callback_promise,
    cancellation_policy: cfg.cancellation_policy ?? 'no set policy',
  };
}

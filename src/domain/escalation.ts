import type { OutcomeCode } from '../core/outcome.js';
import { isWithinSchedule, type WeeklySchedule } from './hours.js';

/**
 * Escalation matrix (Build Plan: "Escalation matrix"), evaluated deterministically so the agent
 * never has to reason about time zones, cover rules or transfer rules itself.
 */

export const ESCALATION_TRIGGERS = [
  'P1',
  'P2',
  'P3',
  'P4',
  'asks_for_owner',
  'complaint',
  'agent_stuck',
] as const;
export type EscalationTrigger = (typeof ESCALATION_TRIGGERS)[number];

export type EscalationAction =
  | 'transfer'
  | 'offer_transfer'
  | 'emergency_alert'
  | 'urgent_alert'
  | 'message'
  | 'offer_callback'
  | 'book';

export type TransferTarget = 'primary' | 'backup';
export type BookingPriority = 'emergency' | 'next_available' | 'normal';

export interface EscalationDecision {
  trigger: EscalationTrigger;
  in_hours: boolean;
  emergency_cover_active: boolean;
  /** P1: the fixed, approved safety script must be delivered before anything else. */
  safety_script_first: boolean;
  action: EscalationAction;
  transfer_targets: TransferTarget[];
  if_transfer_fails: Exclude<EscalationAction, 'transfer' | 'offer_transfer'> | null;
  booking_priority: BookingPriority | null;
  /** Outcome when the action completes as planned; null when the booking result decides it. */
  outcome: OutcomeCode | null;
  outcome_if_transfer_fails: OutcomeCode | null;
}

export interface EscalationConfig {
  opening_hours: WeeklySchedule;
  closed_dates: readonly string[];
  emergency_cover: 'none' | 'in_hours' | 'extended' | '24x7';
  extended_hours?: WeeklySchedule | undefined;
  transfer_number_backup?: string | undefined;
  transfer_rules: {
    in_hours: readonly string[];
    out_of_hours: readonly string[];
  };
}

export function isEmergencyCoverActive(
  cover: EscalationConfig['emergency_cover'],
  inHours: boolean,
  extendedHours: WeeklySchedule | undefined,
  instant: Date,
): boolean {
  switch (cover) {
    case 'none':
      return false;
    case 'in_hours':
      return inHours;
    case 'extended':
      return inHours || (extendedHours ? isWithinSchedule(extendedHours, instant) : false);
    case '24x7':
      return true;
  }
}

export function decideEscalation(
  config: EscalationConfig,
  trigger: EscalationTrigger,
  instant: Date,
): EscalationDecision {
  const inHours = isWithinSchedule(config.opening_hours, instant, config.closed_dates);
  const coverActive = isEmergencyCoverActive(
    config.emergency_cover,
    inHours,
    config.extended_hours,
    instant,
  );
  const rules = inHours ? config.transfer_rules.in_hours : config.transfer_rules.out_of_hours;
  const targets: TransferTarget[] = config.transfer_number_backup
    ? ['primary', 'backup']
    : ['primary'];

  const base = {
    trigger,
    in_hours: inHours,
    emergency_cover_active: coverActive,
    safety_script_first: trigger === 'P1',
    transfer_targets: [] as TransferTarget[],
    if_transfer_fails: null,
    booking_priority: null,
    outcome: null,
    outcome_if_transfer_fails: null,
  } satisfies Omit<EscalationDecision, 'action'>;

  const transferAllowed = rules.includes(trigger);

  switch (trigger) {
    case 'P1':
    case 'P2': {
      const alert = trigger === 'P1' ? 'emergency_alert' : 'urgent_alert';
      // Out of hours without cover: P1 gets the safety script then a callback message;
      // P2 gets the first available slot (no isolation advice until UK-plumber validated).
      if (!inHours && !coverActive) {
        return trigger === 'P1'
          ? { ...base, action: 'message', outcome: 'CALLBACK_REQUESTED' }
          : { ...base, action: 'book', booking_priority: 'next_available' };
      }
      if (transferAllowed) {
        return {
          ...base,
          action: 'transfer',
          transfer_targets: targets,
          if_transfer_fails: alert,
          booking_priority: trigger === 'P2' ? 'emergency' : null,
          outcome: 'EMERGENCY_TRANSFERRED',
          outcome_if_transfer_fails: 'EMERGENCY_ALERTED',
        };
      }
      return {
        ...base,
        action: alert,
        booking_priority: trigger === 'P2' ? 'emergency' : null,
        outcome: 'EMERGENCY_ALERTED',
      };
    }
    case 'P3':
    case 'P4': {
      const priority: BookingPriority = trigger === 'P3' ? 'next_available' : 'normal';
      if (transferAllowed) {
        return {
          ...base,
          action: 'transfer',
          transfer_targets: targets,
          if_transfer_fails: 'book',
          booking_priority: priority,
          outcome: 'TRANSFERRED',
        };
      }
      return { ...base, action: 'book', booking_priority: priority };
    }
    case 'asks_for_owner':
      if (inHours && transferAllowed) {
        return {
          ...base,
          action: 'transfer',
          transfer_targets: targets,
          if_transfer_fails: 'message',
          outcome: 'TRANSFERRED',
          outcome_if_transfer_fails: 'MESSAGE_TAKEN',
        };
      }
      return {
        ...base,
        action: 'message',
        outcome: inHours ? 'MESSAGE_TAKEN' : 'CALLBACK_REQUESTED',
      };
    case 'complaint':
      return { ...base, action: 'message', outcome: 'MESSAGE_TAKEN' };
    case 'agent_stuck':
      if (inHours) {
        return {
          ...base,
          action: 'offer_transfer',
          transfer_targets: targets,
          if_transfer_fails: 'offer_callback',
          outcome: 'TRANSFERRED',
          outcome_if_transfer_fails: 'CALLBACK_REQUESTED',
        };
      }
      return { ...base, action: 'offer_callback', outcome: 'CALLBACK_REQUESTED' };
  }
}

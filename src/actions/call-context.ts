import type { ClientConfig } from '../clients/config-store.js';
import { isEmergencyCoverActive } from '../domain/escalation.js';
import { isWithinSchedule, spokenDate, spokenTime } from '../domain/hours.js';

export interface CallContextResponse {
  in_hours: boolean;
  emergency_cover_active: boolean;
  today: string;
  time_now: string;
  can_book_live: boolean;
}

/** Facts the agent needs at the start of a call, computed in Europe/London. */
export function callContext(client: ClientConfig, now: Date): CallContextResponse {
  const cfg = client.config;
  const inHours = isWithinSchedule(cfg.opening_hours, now, cfg.closed_dates);
  return {
    in_hours: inHours,
    emergency_cover_active: isEmergencyCoverActive(
      cfg.emergency_cover,
      inHours,
      cfg.extended_hours,
      now,
    ),
    today: spokenDate(now),
    time_now: spokenTime(now),
    can_book_live: cfg.booking_mode === 'ghl_calendar' || cfg.booking_mode === 'synced_calendar',
  };
}

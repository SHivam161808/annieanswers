/**
 * Working-hours evaluation in Europe/London. Uses Intl so BST/GMT transitions (e.g. clocks going
 * back on 25 October 2026) are handled by the platform tz database, never by fixed offsets.
 */

export const BUSINESS_TIMEZONE = 'Europe/London';

export const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export interface TimeWindow {
  /** "HH:MM", 24h, local time */
  open: string;
  /** "HH:MM", 24h, local time; "24:00" allowed for end of day */
  close: string;
}

export type WeeklySchedule = Readonly<Partial<Record<Weekday, readonly TimeWindow[]>>>;

export interface LocalTime {
  weekday: Weekday;
  /** Minutes since local midnight */
  minutes: number;
  /** Local calendar date "YYYY-MM-DD" */
  date: string;
  dayOfMonth: number;
}

const formatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: BUSINESS_TIMEZONE,
  weekday: 'short',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

const SHORT_WEEKDAY: Readonly<Record<string, Weekday>> = {
  Mon: 'mon',
  Tue: 'tue',
  Wed: 'wed',
  Thu: 'thu',
  Fri: 'fri',
  Sat: 'sat',
  Sun: 'sun',
};

export function toLocalTime(instant: Date): LocalTime {
  const parts: Record<string, string> = {};
  for (const part of formatter.formatToParts(instant)) parts[part.type] = part.value;
  const weekday = SHORT_WEEKDAY[parts.weekday ?? ''];
  if (!weekday) throw new Error(`Unexpected weekday from Intl: ${parts.weekday}`);
  return {
    weekday,
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
    date: `${parts.year}-${parts.month}-${parts.day}`,
    dayOfMonth: Number(parts.day),
  };
}

export function parseClock(value: string): number {
  const match = /^([01]\d|2[0-4]):([0-5]\d)$/.exec(value);
  if (!match) throw new Error(`Invalid time "${value}"`);
  const minutes = Number(match[1]) * 60 + Number(match[2]);
  if (minutes > 24 * 60) throw new Error(`Invalid time "${value}"`);
  return minutes;
}

export function isWithinSchedule(
  schedule: WeeklySchedule,
  instant: Date,
  closedDates: readonly string[] = [],
): boolean {
  const local = toLocalTime(instant);
  if (closedDates.includes(local.date)) return false;
  const windows = schedule[local.weekday] ?? [];
  return windows.some(
    (w) => local.minutes >= parseClock(w.open) && local.minutes < parseClock(w.close),
  );
}

const LONG_WEEKDAY: Readonly<Record<Weekday, string>> = {
  mon: 'Monday',
  tue: 'Tuesday',
  wed: 'Wednesday',
  thu: 'Thursday',
  fri: 'Friday',
  sat: 'Saturday',
  sun: 'Sunday',
};

function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

/** UK spoken date, e.g. "Tuesday the 14th". */
export function spokenDate(instant: Date): string {
  const local = toLocalTime(instant);
  return `${LONG_WEEKDAY[local.weekday]} the ${ordinal(local.dayOfMonth)}`;
}

/** UK spoken time, e.g. "half ten", "quarter past two", "9am", "2:40pm". */
export function spokenTime(instant: Date): string {
  return spokenClock(toLocalTime(instant).minutes);
}

/** UK spoken form of minutes since midnight, e.g. 630 -> "half 10". */
export function spokenClock(minutes: number): string {
  if (minutes === 24 * 60) return 'midnight';
  const h24 = Math.floor(minutes / 60);
  const m = minutes % 60;
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  const next12 = (h24 + 1) % 12 === 0 ? 12 : (h24 + 1) % 12;
  if (h24 === 12 && m === 0) return 'midday';
  if (m === 0) return `${h12}${h24 < 12 ? 'am' : 'pm'}`;
  if (m === 30) return `half ${h12}`;
  if (m === 15) return `quarter past ${h12}`;
  if (m === 45) return `quarter to ${next12}`;
  return `${h12}:${String(m).padStart(2, '0')}${h24 < 12 ? 'am' : 'pm'}`;
}

const ZONED = /([zZ]|[+-]\d{2}:?\d{2})$/;
const NAIVE = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?$/;

/** Offset of Europe/London from UTC at an instant, in minutes (0 for GMT, 60 for BST). */
function londonOffsetMinutes(instantMs: number): number {
  const local = toLocalTime(new Date(instantMs));
  const [y, m, d] = local.date.split('-').map(Number) as [number, number, number];
  const wallAsUtc = Date.UTC(y, m - 1, d, Math.floor(local.minutes / 60), local.minutes % 60);
  const flooredInstant = Math.floor(instantMs / 60_000) * 60_000;
  return Math.round((wallAsUtc - flooredInstant) / 60_000);
}

/**
 * Parses a GHL time. GHL returns ISO-with-offset on some endpoints and naive UK wall-clock time
 * ("2026-10-13 13:00:00") on others (e.g. contact appointments). Naive times are interpreted in
 * Europe/London, never in the server's own timezone. For the repeated hour when clocks go back,
 * the first (BST) occurrence is used; a time in the skipped spring hour is moved forward.
 * Returns epoch ms, or NaN if unparseable.
 */
export function parseUkTime(value: string): number {
  if (typeof value !== 'string') return Number.NaN;
  if (ZONED.test(value)) return Date.parse(value);
  const m = NAIVE.exec(value.trim());
  if (!m) return Number.NaN;
  const [, y, mo, d, h, mi, s] = m;
  const wallAsUtc = Date.UTC(
    Number(y),
    Number(mo) - 1,
    Number(d),
    Number(h),
    Number(mi),
    Number(s ?? 0),
  );
  // Try BST first (earlier instant), then GMT; keep the one whose London wall time matches.
  for (const offset of [60, 0]) {
    const candidate = wallAsUtc - offset * 60_000;
    if (londonOffsetMinutes(candidate) === offset) return candidate;
  }
  return wallAsUtc - 60 * 60_000; // skipped hour (spring forward): resolve forward
}

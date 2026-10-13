import type { BusinessConfig } from '../../config/schema/business-config.js';
import { normalisePostcode } from '../domain/postcode.js';
import type { EmergencyNumber, SafetyScript } from '../prompt/sources.js';
import type { Scenario, Slot, Transcript, Turn } from './schema.js';

/**
 * Deterministic conversation scoring against the Build Plan rubric and claude.md §18. Works on any
 * transcript (simulation, phone harness, GHL call log), so the same rules gate every source.
 */

export const MAX_AVG_WORDS = 25;
export const MAX_SENTENCES = 2;

export const BANNED_PHRASES = [
  /\bawesome\b/i,
  /\babsolutely\b/i,
  /\bgreat question\b/i,
  /\bI understand your frustration\b/i,
  /\bcertainly\b/i,
];

/** Agent questions that ask for a slot. A question that repeats the value back is a confirmation. */
const SLOT_ASK: Readonly<Record<Slot, RegExp | null>> = {
  name: /\b(your|the) name\b|\bwho am I speaking\b|\bwho's calling\b/i,
  phone: /\b(phone|contact|callback|mobile|best) number\b/i,
  postcode: /\bpostcode\b/i,
  address: /\baddress\b|\bfirst line\b|\bhouse number\b/i,
  job_type: null,
  urgency: null,
};

const BOOKING_CLAIMS: ReadonlyArray<{ pattern: RegExp; action: string }> = [
  {
    pattern: /\b(you'?re|you are|that'?s|I'?ve|it'?s)\s+(now\s+|all\s+)?booked\b/i,
    action: 'book_appointment',
  },
  {
    pattern: /\b(appointment|booking|visit)\s+(is\s+)?(confirmed|booked)\b/i,
    action: 'book_appointment',
  },
  {
    pattern: /\b(that'?s|it'?s|I'?ve|appointment is|it has been)\s+(now\s+)?(moved|rescheduled)\b/i,
    action: 'reschedule_appointment',
  },
  {
    pattern: /\b(that'?s|it'?s|I'?ve|appointment is|it has been)\s+(now\s+)?cancelled\b/i,
    action: 'cancel_appointment',
  },
];

const PHONE_LIKE = /(?:\+?\d[\d\s-]{6,}\d)|\b999\b/g;
const PRICE_LIKE = /£\s?\d+(?:\.\d{2})?|\b\d+\s?(?:pounds|quid)\b/gi;

export interface Check {
  id: string;
  passed: boolean;
  detail?: string;
}

export interface ScoreResult {
  scenarioId: string | null;
  passed: boolean;
  checks: Check[];
  metrics: {
    agentTurns: number;
    avgWords: number;
    maxWords: number;
    reasks: number;
    medianLatencyMs: number | null;
    p90LatencyMs: number | null;
  };
}

export interface ScoringContext {
  config: BusinessConfig;
  safetyScripts: ReadonlyMap<string, SafetyScript>;
  emergencyNumbers: readonly EmergencyNumber[];
  /** The client's rendered welcome message; fixed wording, exempt from the length rules. */
  greeting: string;
}

const words = (text: string) => text.split(/\s+/).filter((w) => /[A-Za-z0-9]/.test(w)).length;
const norm = (text: string) =>
  text
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[^a-z0-9' ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

function sentences(text: string): number {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => /[A-Za-z]/.test(s)).length;
}

/** Nearest-rank percentile: the smallest value with at least p of the values at or below it. */
export function percentile(values: readonly number[], p: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)] as number;
}

function slotValueMatches(slot: Slot, expected: string, actual: string | undefined): boolean {
  if (actual === undefined) return false;
  if (slot === 'postcode') {
    return normalisePostcode(expected)?.postcode === normalisePostcode(actual)?.postcode;
  }
  if (slot === 'phone')
    return expected.replace(/\D/g, '').slice(-10) === actual.replace(/\D/g, '').slice(-10);
  return norm(expected) === norm(actual);
}

export function scoreTranscript(
  transcript: Transcript,
  ctx: ScoringContext,
  scenario?: Scenario,
): ScoreResult {
  const checks: Check[] = [];
  const check = (id: string, passed: boolean, detail?: string) =>
    checks.push(detail === undefined ? { id, passed } : { id, passed, detail });

  const scriptTexts = [...ctx.safetyScripts.values()].map((s) => norm(s.text));
  const isFixedWording = (text: string) =>
    norm(text) === norm(ctx.greeting) || scriptTexts.some((s) => norm(text).includes(s));
  const agentTurns = transcript.turns.filter(
    (t): t is Extract<Turn, { role: 'agent' }> => t.role === 'agent',
  );
  const conversational = agentTurns.filter((t) => !isFixedWording(t.text));

  // Concise responses (greeting and safety scripts are exempt: fixed, approved wording).
  const wordCounts = conversational.map((t) => words(t.text));
  const avgWords = wordCounts.length
    ? wordCounts.reduce((a, b) => a + b, 0) / wordCounts.length
    : 0;
  check('avg-words', avgWords <= MAX_AVG_WORDS, `average ${avgWords.toFixed(1)} words`);
  const long = conversational.filter((t) => sentences(t.text) > MAX_SENTENCES);
  check('max-two-sentences', long.length === 0, long.length ? `"${long[0]!.text}"` : undefined);

  // UK receptionist register.
  const banned = agentTurns.find((t) => BANNED_PHRASES.some((p) => p.test(t.text)));
  check('register', !banned, banned ? `"${banned.text}"` : undefined);

  // No fabricated numbers: only registered emergency numbers may be spoken.
  const allowedDigits = new Set(ctx.emergencyNumbers.map((n) => n.digits));
  const badNumber = agentTurns
    .flatMap((t) => t.text.match(PHONE_LIKE) ?? [])
    .map((m) => m.replace(/\D/g, ''))
    .find((d) => !allowedDigits.has(d));
  check('no-invented-numbers', badNumber === undefined, badNumber);

  // No invented prices: any price spoken must come from an approved pricing statement.
  const approvedPrices = norm(ctx.config.pricing_statements.join(' '));
  const badPrice = agentTurns
    .flatMap((t) => t.text.match(PRICE_LIKE) ?? [])
    .find((p) => !approvedPrices.includes(norm(p)));
  check('no-invented-prices', badPrice === undefined, badPrice);

  // Never claim a booking change unless the matching action succeeded earlier in the call.
  const succeeded = new Set<string>();
  let falseClaim: string | undefined;
  for (const turn of transcript.turns) {
    if (turn.role === 'action' && turn.status === 'ok') succeeded.add(turn.name);
    if (turn.role === 'agent') {
      for (const claim of BOOKING_CLAIMS) {
        if (claim.pattern.test(turn.text) && !succeeded.has(claim.action)) falseClaim ??= turn.text;
      }
    }
  }
  check('no-false-booking-claim', falseClaim === undefined, falseClaim);

  // Never re-ask a slot the caller already gave (confirmations that repeat the value are fine).
  const known = new Map<Slot, string>();
  let reasks = 0;
  let firstReask: string | undefined;
  for (const turn of transcript.turns) {
    if (turn.role === 'caller') for (const slot of turn.provides) known.set(slot, turn.text);
    if (turn.role === 'agent' && turn.text.includes('?')) {
      for (const [slot, givenIn] of known) {
        const pattern = SLOT_ASK[slot];
        if (!pattern || !pattern.test(turn.text)) continue;
        const isConfirmation =
          (slot === 'postcode' && /\b[A-Z]{1,2}\s?\d/.test(turn.text)) ||
          norm(turn.text).includes(norm(givenIn).slice(0, 12));
        if (!isConfirmation) {
          reasks++;
          firstReask ??= turn.text;
        }
      }
    }
  }
  check('no-reasks', reasks === 0, firstReask);

  if (scenario) {
    const exp = scenario.expect;
    check(
      'outcome',
      transcript.outcome !== null && exp.outcome.includes(transcript.outcome),
      `got ${transcript.outcome ?? 'none'}, expected ${exp.outcome.join(' | ')}`,
    );

    if (exp.safety_script) {
      const script = ctx.safetyScripts.get(exp.safety_script.id);
      const callerIdx = transcript.turns
        .map((t, i) => (t.role === 'caller' ? i : -1))
        .filter((i) => i >= 0)[exp.safety_script.after_caller_turn];
      const nextAgent =
        callerIdx === undefined
          ? undefined
          : transcript.turns.slice(callerIdx + 1).find((t) => t.role === 'agent');
      const verbatim =
        script !== undefined &&
        nextAgent?.role === 'agent' &&
        norm(nextAgent.text).includes(norm(script.text));
      check(
        'safety-script-verbatim',
        verbatim,
        script ? undefined : `unknown script ${exp.safety_script.id}`,
      );
    }

    for (const [slot, expected] of Object.entries(exp.captured) as [Slot, string][]) {
      check(
        `captured-${slot}`,
        slotValueMatches(slot, expected, transcript.captured[slot]),
        `expected ${slot}`,
      );
    }

    const agentText = agentTurns.map((t) => t.text).join('\n');
    for (const pattern of exp.must_say) {
      check(`must-say`, new RegExp(pattern, 'i').test(agentText), pattern);
    }
    for (const pattern of exp.must_not_say) {
      check(`must-not-say`, !new RegExp(pattern, 'i').test(agentText), pattern);
    }

    const called = new Set(transcript.turns.filter((t) => t.role === 'action').map((t) => t.name));
    for (const [action, required] of Object.entries(exp.actions)) {
      check(
        `action-${action}`,
        called.has(action as never) === required,
        required ? 'missing' : 'must not be called',
      );
    }
  }

  const latencies = agentTurns.map((t) => t.latency_ms).filter((v): v is number => v !== undefined);
  return {
    scenarioId: scenario?.id ?? null,
    passed: checks.every((c) => c.passed),
    checks,
    metrics: {
      agentTurns: agentTurns.length,
      avgWords: Math.round(avgWords * 10) / 10,
      maxWords: Math.max(0, ...wordCounts),
      reasks,
      medianLatencyMs: percentile(latencies, 0.5),
      p90LatencyMs: percentile(latencies, 0.9),
    },
  };
}

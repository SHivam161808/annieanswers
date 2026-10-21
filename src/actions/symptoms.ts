import type { Logger } from 'pino';
import type { ClientConfig } from '../clients/config-store.js';
import { matchSymptom, type SymptomLibrary } from '../knowledge/symptoms.js';

/**
 * symptom_guidance action. Once the caller has described the problem, tells the agent which
 * questions are worth asking, what it may tentatively explain (never a diagnosis), which signs
 * raise urgency and how to qualify the booking. Unmatched descriptions are logged as gaps
 * (family only — never the caller's words).
 */

export interface SymptomResponse {
  status: 'found' | 'general' | 'not_found';
  presentation?: string;
  job_type?: string;
  instruction: string;
}

const str = (v: unknown, max: number) =>
  typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null;

const list = (items: string[]) => items.map((q) => `"${q}"`).join(' / ');

export function symptomGuidanceAction(
  _client: ClientConfig,
  params: { [k: string]: unknown },
  library: SymptomLibrary,
  log: Logger,
): SymptomResponse {
  const match = matchSymptom(library, {
    problem: str(params.problem, 300),
    family: str(params.family, 30),
  });

  if (match.status === 'not_found') {
    log.info({ symptom_gap: true, family: str(params.family, 30) }, 'symptom_not_covered');
    return {
      status: 'not_found',
      instruction:
        'No specific guidance. Use the problem-family questions you already have, never guess the cause, and carry on towards booking.',
    };
  }
  if (match.status === 'general') {
    log.info({ symptom_gap: true, family: match.family }, 'symptom_not_covered');
    return {
      status: 'general',
      instruction: `Ask, one at a time, only what you don't know yet: ${list(match.questions)}. Don't guess the cause; carry on towards booking.`,
    };
  }

  const p = match.presentation;
  const parts = [`Ask, one at a time, only what you don't know yet: ${list(p.ask_first)}.`];
  if (p.may_explain.length) {
    parts.push(
      `After the answers, if it fits, you may say one of these, as a possibility only: ${p.may_explain
        .map((e) => `if ${e.when.charAt(0).toLowerCase()}${e.when.slice(1)}: "${e.say}"`)
        .join('; ')}. Never present it as the confirmed cause; the engineer confirms on the visit.`,
    );
  } else {
    parts.push("Don't suggest a cause; the engineer will check it on the visit.");
  }
  if (p.urgent_if.length) {
    parts.push(
      `Urgency: ${p.urgent_if.map((u) => `${u.sign} = ${u.level}`).join('; ')}; otherwise ${p.booking.default_urgency}. Call escalation for P1–P3.`,
    );
  }
  parts.push(
    `Note for the engineer: ${p.engineer_notes.join(', ')}.`,
    p.booking.visit === 'assessment'
      ? `Then offer a visit to take a look at it (job type ${p.booking.job_type}).`
      : `Then offer to book the repair (job type ${p.booking.job_type}).`,
  );
  if (p.booking.note) parts.push(p.booking.note);
  return {
    status: 'found',
    presentation: p.name,
    job_type: p.booking.job_type,
    instruction: parts.join(' '),
  };
}

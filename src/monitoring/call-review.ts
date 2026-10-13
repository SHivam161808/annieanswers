import { isOutcomeCode, type OutcomeCode } from '../core/outcome.js';
import type { Transcript } from '../conversation/schema.js';
import { percentile, scoreTranscript, type ScoringContext } from '../conversation/scorer.js';

/**
 * Daily call review (T-1001), latency baseline (T-403) and alert rules (T-1004), as pure functions
 * over GHL Voice AI call logs. No caller data leaves this module: reports and alerts carry call
 * ids, counts, codes and timings only.
 */

export interface GhlCallLog {
  id: string;
  createdAt: string;
  duration?: number;
  transcript?: string;
  trialCall?: boolean;
  contactId?: string;
  executedCallActions?: {
    actionName?: string;
    actionType?: string;
    triggerReceivedAt?: string;
    executedAt?: string;
  }[];
}

export interface ReviewedCall {
  callId: string;
  createdAt: string;
  durationS: number;
  trial: boolean;
  outcome: OutcomeCode | null;
  actionLatencies: { action: string; ms: number }[];
  failedChecks: string[];
  avgWords: number;
}

export interface ReviewReport {
  from: string;
  to: string;
  calls: number;
  liveCalls: number;
  outcomes: Partial<Record<OutcomeCode | 'MISSING', number>>;
  outcomeCoverage: number;
  actionLatency: { action: string; count: number; p50: number; p90: number; max: number }[];
  avgDurationS: number;
  avgAgentWords: number;
  flagged: { callId: string; reasons: string[] }[];
  alerts: string[];
}

/** Checks that make a call a defect, not just a style note. */
const CRITICAL_CHECKS = new Set([
  'no-false-booking-claim',
  'no-invented-numbers',
  'no-invented-prices',
]);

export interface AlertThresholds {
  /** ABANDONED share of live calls that triggers an alert. */
  abandonedRate: number;
  /** Action latency p90 (ms) that triggers an alert. */
  actionP90Ms: number;
  minCallsForRates: number;
}

export const DEFAULT_THRESHOLDS: AlertThresholds = {
  abandonedRate: 0.25,
  actionP90Ms: 2500,
  minCallsForRates: 4,
};

/** "human: …\nbot: …" -> turns. Lines without a speaker continue the previous turn. */
export function parseGhlTranscript(text: string | undefined): Transcript['turns'] {
  const turns: Transcript['turns'] = [];
  for (const raw of (text ?? '').split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const m = /^(human|bot|user|assistant|agent)\s*:\s*(.*)$/i.exec(line);
    if (m) {
      const role = /^(bot|assistant|agent)$/i.test(m[1] as string) ? 'agent' : 'caller';
      turns.push(
        role === 'agent'
          ? { role, text: m[2] as string }
          : { role, text: m[2] as string, provides: [] },
      );
    } else if (turns.length) {
      const last = turns[turns.length - 1]!;
      if (last.role !== 'action') last.text = `${last.text} ${line}`;
    }
  }
  return turns;
}

export function reviewCall(
  log: GhlCallLog,
  outcome: string | null,
  ctx: ScoringContext,
): ReviewedCall {
  const turns = parseGhlTranscript(log.transcript);
  const score = turns.length
    ? scoreTranscript({ turns, outcome: null, captured: {} }, ctx)
    : { checks: [], metrics: { avgWords: 0 } };
  const actionLatencies = (log.executedCallActions ?? [])
    .map((a) => ({
      action: a.actionName || a.actionType || 'unknown',
      ms: Date.parse(a.executedAt ?? '') - Date.parse(a.triggerReceivedAt ?? ''),
    }))
    .filter((a) => Number.isFinite(a.ms) && a.ms >= 0);
  return {
    callId: log.id,
    createdAt: log.createdAt,
    durationS: log.duration ?? 0,
    trial: Boolean(log.trialCall),
    outcome: isOutcomeCode(outcome) ? outcome : null,
    actionLatencies,
    failedChecks: score.checks.filter((c) => !c.passed).map((c) => c.id),
    avgWords: score.metrics.avgWords,
  };
}

export function buildReport(
  calls: ReviewedCall[],
  window: { from: string; to: string },
  thresholds: AlertThresholds = DEFAULT_THRESHOLDS,
): ReviewReport {
  const live = calls.filter((c) => !c.trial);
  const outcomes: ReviewReport['outcomes'] = {};
  for (const c of calls) {
    const key = c.outcome ?? 'MISSING';
    outcomes[key] = (outcomes[key] ?? 0) + 1;
  }

  const byAction = new Map<string, number[]>();
  for (const c of calls)
    for (const a of c.actionLatencies)
      byAction.set(a.action, [...(byAction.get(a.action) ?? []), a.ms]);
  const actionLatency = [...byAction]
    .map(([action, ms]) => ({
      action,
      count: ms.length,
      p50: percentile(ms, 0.5) ?? 0,
      p90: percentile(ms, 0.9) ?? 0,
      max: Math.max(...ms),
    }))
    .sort((a, b) => b.p90 - a.p90);

  const flagged = calls
    .map((c) => ({
      callId: c.callId,
      reasons: [
        ...(c.outcome ? [] : ['missing-outcome']),
        ...c.failedChecks.filter((x) => CRITICAL_CHECKS.has(x)),
      ],
    }))
    .filter((f) => f.reasons.length);

  const alerts: string[] = [];
  const techFailures = calls.filter((c) => c.outcome === 'TECH_FAILURE').length;
  if (techFailures) alerts.push(`${techFailures} call(s) ended in TECH_FAILURE`);
  const missing = outcomes.MISSING ?? 0;
  if (missing) alerts.push(`${missing} call(s) have no outcome code (target: 100% logged)`);
  const critical = flagged.filter((f) => f.reasons.some((r) => CRITICAL_CHECKS.has(r))).length;
  if (critical)
    alerts.push(
      `${critical} call(s) failed a critical conversation check (false claim / invented number or price)`,
    );
  if (live.length >= thresholds.minCallsForRates) {
    const abandoned = live.filter((c) => c.outcome === 'ABANDONED').length / live.length;
    if (abandoned > thresholds.abandonedRate) {
      alerts.push(
        `ABANDONED spike: ${Math.round(abandoned * 100)}% of live calls (threshold ${thresholds.abandonedRate * 100}%)`,
      );
    }
  }
  for (const a of actionLatency) {
    if (a.count >= 3 && a.p90 > thresholds.actionP90Ms) {
      alerts.push(`Action ${a.action} p90 latency ${a.p90} ms over ${thresholds.actionP90Ms} ms`);
    }
  }

  const avg = (xs: number[]) =>
    xs.length ? Math.round((xs.reduce((s, x) => s + x, 0) / xs.length) * 10) / 10 : 0;
  return {
    ...window,
    calls: calls.length,
    liveCalls: live.length,
    outcomes,
    outcomeCoverage: calls.length ? (calls.length - missing) / calls.length : 1,
    actionLatency,
    avgDurationS: avg(calls.map((c) => c.durationS)),
    avgAgentWords: avg(calls.filter((c) => c.avgWords > 0).map((c) => c.avgWords)),
    flagged,
    alerts,
  };
}

export function renderReport(r: ReviewReport): string {
  const lines = [
    `# Call review ${r.from.slice(0, 10)} → ${r.to.slice(0, 10)}`,
    '',
    `Calls: **${r.calls}** (${r.liveCalls} live) · outcome coverage **${Math.round(r.outcomeCoverage * 100)}%** · avg duration ${r.avgDurationS}s · avg agent turn ${r.avgAgentWords} words`,
    '',
    '## Alerts',
    ...(r.alerts.length ? r.alerts.map((a) => `- ⚠ ${a}`) : ['- none']),
    '',
    '## Outcomes',
    '| Outcome | Calls |',
    '| --- | --- |',
    ...Object.entries(r.outcomes).map(([k, v]) => `| ${k} | ${v} |`),
    '',
    '## Action latency (GHL trigger → executed)',
    '| Action | Count | p50 ms | p90 ms | max ms |',
    '| --- | --- | --- | --- | --- |',
    ...r.actionLatency.map((a) => `| ${a.action} | ${a.count} | ${a.p50} | ${a.p90} | ${a.max} |`),
    '',
    '## Calls to review',
    ...(r.flagged.length
      ? r.flagged.map((f) => `- ${f.callId}: ${f.reasons.join(', ')}`)
      : ['- none']),
    '',
  ];
  return lines.join('\n');
}

/** Slack/Teams-compatible incoming-webhook payload; ids and counts only. */
export function alertPayload(r: ReviewReport, label: string): { text: string } {
  return {
    text: [
      `*AI receptionist alert — ${label}* (${r.from.slice(0, 16)} → ${r.to.slice(0, 16)})`,
      ...r.alerts.map((a) => `• ${a}`),
    ].join('\n'),
  };
}

import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { validateClientConfig } from '../../src/clients/config-store.js';
import type { ScoringContext } from '../../src/conversation/scorer.js';
import {
  alertPayload,
  buildReport,
  parseGhlTranscript,
  renderReport,
  reviewCall,
  type GhlCallLog,
  type ReviewedCall,
} from '../../src/monitoring/call-review.js';
import { buildCustomValues } from '../../src/prompt/custom-values.js';
import { renderPrompt } from '../../src/prompt/render.js';
import { loadPromptSources } from '../../src/prompt/sources.js';

let ctx: ScoringContext;
beforeAll(async () => {
  const config = validateClientConfig(
    parse(readFileSync('config/clients/demo.yaml', 'utf8')),
    'demo',
  ).config;
  const sources = await loadPromptSources('plumbing');
  ctx = {
    config,
    safetyScripts: sources.safetyScripts,
    emergencyNumbers: sources.emergencyNumbers,
    greeting: renderPrompt(sources, 'rendered', buildCustomValues(config)).greeting,
  };
});

const log = (over: Partial<GhlCallLog> = {}): GhlCallLog => ({
  id: 'call1',
  createdAt: '2026-11-02T10:00:00Z',
  duration: 120,
  transcript: "human:My tap's dripping.\nbot:Right, a dripping tap. What's the postcode there?",
  executedCallActions: [
    {
      actionName: 'check_service_area',
      triggerReceivedAt: '2026-11-02T10:00:10.000Z',
      executedAt: '2026-11-02T10:00:10.600Z',
    },
  ],
  ...over,
});

const reviewed = (over: Partial<ReviewedCall>): ReviewedCall => ({
  callId: 'c',
  createdAt: '2026-11-02T10:00:00Z',
  durationS: 60,
  trial: false,
  outcome: 'BOOKED',
  actionLatencies: [],
  failedChecks: [],
  avgWords: 10,
  ...over,
});

describe('parseGhlTranscript', () => {
  it('maps human/bot lines to caller/agent turns and joins continuation lines', () => {
    const turns = parseGhlTranscript(
      'human:Hello?\nbot:Let me just check\nwe cover that area.\nhuman: Thanks',
    );
    expect(turns).toEqual([
      { role: 'caller', text: 'Hello?', provides: [] },
      { role: 'agent', text: 'Let me just check we cover that area.' },
      { role: 'caller', text: 'Thanks', provides: [] },
    ]);
  });
  it('tolerates empty or missing transcripts', () => {
    expect(parseGhlTranscript(undefined)).toEqual([]);
    expect(parseGhlTranscript('\n\n')).toEqual([]);
  });
});

describe('reviewCall', () => {
  it('measures action latency from GHL timestamps and validates the outcome', () => {
    const r = reviewCall(log(), 'BOOKED', ctx);
    expect(r).toMatchObject({
      callId: 'call1',
      outcome: 'BOOKED',
      actionLatencies: [{ action: 'check_service_area', ms: 600 }],
    });
    expect(reviewCall(log(), 'booked-ish', ctx).outcome).toBeNull();
  });

  it('flags a false booking claim and an invented number', () => {
    const r = reviewCall(
      log({ transcript: "human:Book me in.\nbot:You're booked in. Ring us on 0113 496 0000." }),
      'BOOKED',
      ctx,
    );
    expect(r.failedChecks).toEqual(
      expect.arrayContaining(['no-false-booking-claim', 'no-invented-numbers']),
    );
  });

  it('ignores actions with missing or negative timings', () => {
    const r = reviewCall(
      log({
        executedCallActions: [
          { actionName: 'x' },
          {
            actionName: 'y',
            triggerReceivedAt: '2026-11-02T10:00:02Z',
            executedAt: '2026-11-02T10:00:01Z',
          },
        ],
      }),
      null,
      ctx,
    );
    expect(r.actionLatencies).toEqual([]);
  });
});

describe('buildReport and alerts', () => {
  it('reports outcome coverage, latency percentiles and no alerts on a clean day', () => {
    const calls = [1, 2, 3, 4].map((i) =>
      reviewed({ callId: `c${i}`, actionLatencies: [{ action: 'book', ms: i * 100 }] }),
    );
    const r = buildReport(calls, { from: 'a', to: 'b' });
    expect(r).toMatchObject({ calls: 4, outcomeCoverage: 1, alerts: [], flagged: [] });
    expect(r.actionLatency).toEqual([{ action: 'book', count: 4, p50: 200, p90: 400, max: 400 }]);
  });

  it('alerts on TECH_FAILURE, missing outcomes and critical conversation failures', () => {
    const r = buildReport(
      [
        reviewed({ callId: 'tf', outcome: 'TECH_FAILURE' }),
        reviewed({ callId: 'mo', outcome: null }),
        reviewed({ callId: 'fc', failedChecks: ['no-false-booking-claim', 'avg-words'] }),
      ],
      { from: 'a', to: 'b' },
    );
    expect(r.alerts).toEqual([
      '1 call(s) ended in TECH_FAILURE',
      '1 call(s) have no outcome code (target: 100% logged)',
      '1 call(s) failed a critical conversation check (false claim / invented number or price)',
    ]);
    expect(r.flagged).toEqual([
      { callId: 'mo', reasons: ['missing-outcome'] },
      { callId: 'fc', reasons: ['no-false-booking-claim'] },
    ]);
  });

  it('alerts on an ABANDONED spike only with enough live calls, ignoring trial calls', () => {
    const many = [...Array(4)].map((_, i) =>
      reviewed({ callId: `a${i}`, outcome: i < 2 ? 'ABANDONED' : 'BOOKED' }),
    );
    expect(buildReport(many, { from: 'a', to: 'b' }).alerts).toEqual([
      'ABANDONED spike: 50% of live calls (threshold 25%)',
    ]);
    expect(buildReport(many.slice(0, 2), { from: 'a', to: 'b' }).alerts).toEqual([]);
    const trials = many.map((c) => ({ ...c, trial: true }));
    expect(buildReport(trials, { from: 'a', to: 'b' }).alerts).toEqual([]);
  });

  it('alerts when an action p90 exceeds 2.5 s (with at least 3 samples)', () => {
    const calls = [800, 900, 3000].map((ms, i) =>
      reviewed({ callId: `l${i}`, actionLatencies: [{ action: 'reschedule_booking', ms }] }),
    );
    expect(buildReport(calls, { from: 'a', to: 'b' }).alerts).toEqual([
      'Action reschedule_booking p90 latency 3000 ms over 2500 ms',
    ]);
  });

  it('report and alert payload contain ids and counts, never transcripts', () => {
    const r = buildReport([reviewed({ callId: 'secret-free', outcome: null })], {
      from: '2026-11-02T00:00:00Z',
      to: '2026-11-03T00:00:00Z',
    });
    const md = renderReport(r);
    expect(md).toContain('secret-free: missing-outcome');
    expect(alertPayload(r, 'demo-plumbing').text).toContain(
      '*AI receptionist alert — demo-plumbing*',
    );
    expect(JSON.stringify(r)).not.toMatch(/transcript|human:|bot:/);
  });
});

describe('call review: exact behaviour (mutation-pinned)', () => {
  it('parses role aliases, trims, skips blank lines, ignores leading noise', () => {
    expect(
      parseGhlTranscript(
        '  \nnoise before any speaker\nUSER: hi \nassistant : hello\nagent:ok\nbot:\n',
      ),
    ).toEqual([
      { role: 'caller', text: 'hi', provides: [] },
      { role: 'agent', text: 'hello' },
      { role: 'agent', text: 'ok' },
      { role: 'agent', text: '' },
    ]);
    expect(parseGhlTranscript('botanist: not a speaker')).toEqual([]);
  });

  it('labels actions by name, then type, then "unknown"; zero-ms actions count', () => {
    const r = reviewCall(
      log({
        executedCallActions: [
          {
            actionType: 'APPOINTMENT_BOOKING',
            triggerReceivedAt: '2026-11-02T10:00:00Z',
            executedAt: '2026-11-02T10:00:00Z',
          },
          { triggerReceivedAt: '2026-11-02T10:00:00Z', executedAt: '2026-11-02T10:00:01Z' },
        ],
      }),
      null,
      ctx,
    );
    expect(r.actionLatencies).toEqual([
      { action: 'APPOINTMENT_BOOKING', ms: 0 },
      { action: 'unknown', ms: 1000 },
    ]);
  });

  it('handles calls with no transcript, no actions and no duration', () => {
    expect(reviewCall({ id: 'x', createdAt: 'c' }, 'INFO_ONLY', ctx)).toEqual({
      callId: 'x',
      createdAt: 'c',
      durationS: 0,
      trial: false,
      outcome: 'INFO_ONLY',
      actionLatencies: [],
      failedChecks: [],
      avgWords: 0,
    });
  });

  it('averages, coverage and latency ordering are exact', () => {
    const r = buildReport(
      [
        reviewed({
          callId: 'a',
          durationS: 60,
          avgWords: 10,
          actionLatencies: [
            { action: 'slow', ms: 900 },
            { action: 'fast', ms: 100 },
          ],
        }),
        reviewed({ callId: 'b', durationS: 121, avgWords: 0, outcome: null }),
        reviewed({ callId: 'c', durationS: 30, avgWords: 21 }),
      ],
      { from: 'a', to: 'b' },
    );
    expect(r.avgDurationS).toBe(70.3);
    expect(r.avgAgentWords).toBe(15.5);
    expect(r.outcomeCoverage).toBeCloseTo(2 / 3);
    expect(r.actionLatency.map((a) => a.action)).toEqual(['slow', 'fast']);
    expect(buildReport([], { from: 'a', to: 'b' })).toMatchObject({
      calls: 0,
      outcomeCoverage: 1,
      avgDurationS: 0,
      avgAgentWords: 0,
    });
  });

  it('style-only failures are not flagged; invented prices are critical', () => {
    const r = buildReport(
      [
        reviewed({ failedChecks: ['avg-words', 'register'] }),
        reviewed({ callId: 'p', failedChecks: ['no-invented-prices', 'no-invented-numbers'] }),
      ],
      { from: 'a', to: 'b' },
    );
    expect(r.flagged).toEqual([
      { callId: 'p', reasons: ['no-invented-prices', 'no-invented-numbers'] },
    ]);
  });

  it('threshold boundaries: exactly 25% abandoned and exactly 2500 ms p90 do not alert', () => {
    const calls = [reviewed({ outcome: 'ABANDONED' }), reviewed({}), reviewed({}), reviewed({})];
    expect(buildReport(calls, { from: 'a', to: 'b' }).alerts).toEqual([]);
    const lat = [1, 2, 3].map((i) =>
      reviewed({ callId: `${i}`, actionLatencies: [{ action: 'x', ms: 2500 }] }),
    );
    expect(buildReport(lat, { from: 'a', to: 'b' }).alerts).toEqual([]);
    const two = [1, 2].map((i) =>
      reviewed({ callId: `${i}`, actionLatencies: [{ action: 'x', ms: 9000 }] }),
    );
    expect(buildReport(two, { from: 'a', to: 'b' }).alerts).toEqual([]);
  });

  it('renders the full report exactly', () => {
    const r = buildReport(
      [
        reviewed({
          callId: 'c1',
          durationS: 40,
          avgWords: 12,
          actionLatencies: [{ action: 'book', ms: 700 }],
        }),
        reviewed({ callId: 'c2', outcome: null, durationS: 20, avgWords: 0 }),
      ],
      { from: '2026-11-02T00:00:00.000Z', to: '2026-11-03T00:00:00.000Z' },
    );
    expect(renderReport(r)).toBe(
      [
        '# Call review 2026-11-02 → 2026-11-03',
        '',
        'Calls: **2** (2 live) · outcome coverage **50%** · avg duration 30s · avg agent turn 12 words',
        '',
        '## Alerts',
        '- ⚠ 1 call(s) have no outcome code (target: 100% logged)',
        '',
        '## Outcomes',
        '| Outcome | Calls |',
        '| --- | --- |',
        '| BOOKED | 1 |',
        '| MISSING | 1 |',
        '',
        '## Action latency (GHL trigger → executed)',
        '| Action | Count | p50 ms | p90 ms | max ms |',
        '| --- | --- | --- | --- | --- |',
        '| book | 1 | 700 | 700 | 700 |',
        '',
        '## Calls to review',
        '- c2: missing-outcome',
        '',
      ].join('\n'),
    );
    expect(renderReport(buildReport([reviewed({})], { from: 'a', to: 'b' }))).toContain(
      '## Alerts\n- none\n',
    );
    expect(renderReport(buildReport([reviewed({})], { from: 'a', to: 'b' }))).toContain(
      '## Calls to review\n- none\n',
    );
  });

  it('alert payload is exact', () => {
    const r = buildReport([reviewed({ outcome: 'TECH_FAILURE' })], {
      from: '2026-11-02T00:00:00.000Z',
      to: '2026-11-03T00:00:00.000Z',
    });
    expect(alertPayload(r, 'demo')).toEqual({
      text: '*AI receptionist alert — demo* (2026-11-02T00:00 → 2026-11-03T00:00)\n• 1 call(s) ended in TECH_FAILURE',
    });
  });
});

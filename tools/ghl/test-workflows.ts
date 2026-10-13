/**
 * End-to-end test of WF-01 Outcome router against the live sub-account.
 * For each outcome code: creates a throwaway contact (no phone or email, so nothing is sent to a
 * customer), sets ai_call_outcome, enrols it in WF-01, waits for the router, then checks the tag
 * and pipeline stage. Test contacts are deleted afterwards.
 *   npx tsx tools/ghl/test-workflows.ts
 */
import { OUTCOME_CODES, OUTCOME_PIPELINE_STAGE, type OutcomeCode } from '../../src/core/outcome.js';
import { findWorkflow, ghl, listWorkflows, loadState, locationId } from './client.js';

const PIPELINE = 'AI Receptionist Enquiries';
const WAIT_MS = 4 * 60_000; // WF-01 waits 2 minutes before routing
// Codes that make the router alert the owner are skipped by default to avoid real SMS.
const OWNER_ALERTING: ReadonlySet<OutcomeCode> = new Set([
  'BOOKED',
  'BOOKING_REQUESTED',
  'CALLBACK_REQUESTED',
  'MESSAGE_TAKEN',
  'EMERGENCY_ALERTED',
  'TECH_FAILURE',
]);
const includeAlerts = process.argv.includes('--include-alerts');
const codes = OUTCOME_CODES.filter((c) => includeAlerts || !OWNER_ALERTING.has(c));

const state = await loadState();
const router = findWorkflow(await listWorkflows(), 'WF-01');
if (!router) {
  console.error('WF-01 Outcome router not found — build it first (docs/ghl/workflows.md)');
  process.exit(1);
}
const outcomeFieldId = state.contactFieldIds.ai_call_outcome;
if (!outcomeFieldId) throw new Error('ai_call_outcome field id missing — run provisioning first');

const pipelines = await ghl<{
  pipelines: { id: string; name: string; stages: { id: string; name: string }[] }[];
}>('GET', `/opportunities/pipelines?locationId=${locationId}`, '2021-07-28');
const pipeline = pipelines.pipelines.find((p) => p.name === PIPELINE);
if (!pipeline) {
  console.error(`Pipeline "${PIPELINE}" not found — create it first (docs/ghl/workflows.md)`);
  process.exit(1);
}

const created: { code: OutcomeCode; contactId: string }[] = [];
const runId = Date.now().toString(36);
try {
  for (const code of codes) {
    const res = await ghl<{ contact: { id: string } }>('POST', '/contacts/', '2021-07-28', {
      locationId,
      firstName: 'ZZ Workflow Test',
      lastName: `${code} ${runId}`,
      tags: ['workflow-test'],
      customFields: [{ id: outcomeFieldId, field_value: code }],
    });
    created.push({ code, contactId: res.contact.id });
    await ghl('POST', `/contacts/${res.contact.id}/workflow/${router.id}`, '2021-07-28', {});
  }
  console.log(
    `enrolled ${created.length} test contacts in ${router.name}; waiting ${WAIT_MS / 60_000} min…`,
  );
  await new Promise((r) => setTimeout(r, WAIT_MS));

  let failures = 0;
  for (const { code, contactId } of created) {
    const contact = await ghl<{ contact: { tags: string[] } }>(
      'GET',
      `/contacts/${contactId}`,
      '2021-07-28',
    );
    const expectedTag = `outcome-${code.toLowerCase().replaceAll('_', '-')}`;
    const tagOk =
      contact.contact.tags.includes(expectedTag) && contact.contact.tags.includes('ai-call');

    const opps = await ghl<{ opportunities: { pipelineId: string; pipelineStageId: string }[] }>(
      'GET',
      `/opportunities/search?location_id=${locationId}&contact_id=${contactId}`,
      '2021-07-28',
    );
    const opp = opps.opportunities.find((o) => o.pipelineId === pipeline.id);
    const stageName = opp
      ? (pipeline.stages.find((s) => s.id === opp.pipelineStageId)?.name ?? '?')
      : null;
    // Test contacts have no phone, so ABANDONED must not create an opportunity.
    const expectedStage = code === 'ABANDONED' ? null : OUTCOME_PIPELINE_STAGE[code];
    const stageOk = stageName === expectedStage;

    if (!tagOk || !stageOk) failures++;
    console.log(
      `${tagOk && stageOk ? 'ok  ' : 'FAIL'}  ${code.padEnd(22)} tag ${tagOk ? 'ok' : `missing ${expectedTag}`}; stage ${stageName ?? 'none'} (expected ${expectedStage ?? 'none'})`,
    );
  }
  console.log(failures ? `\n${failures} FAILED` : '\nALL ROUTES CORRECT');
  process.exitCode = failures ? 1 : 0;
} finally {
  for (const { contactId } of created) {
    await ghl('DELETE', `/contacts/${contactId}`, '2021-07-28').catch((e: Error) =>
      console.error(`cleanup: ${e.message}`),
    );
  }
  console.log(`cleaned up ${created.length} test contacts`);
}

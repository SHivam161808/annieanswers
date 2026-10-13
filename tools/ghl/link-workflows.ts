/**
 * Connects the hand-built workflows to the Voice AI agent (idempotent):
 *   - WF-01 Outcome router runs when every call ends (agent callEndWorkflowIds)
 *   - WF-06 Emergency escalation becomes the mid-call action `alert_owner_urgent`
 *   npx tsx tools/ghl/link-workflows.ts
 */
import { findWorkflow, ghl, listWorkflows, loadState, locationId } from './client.js';

const state = await loadState();
const workflows = await listWorkflows();
console.log(
  `found ${workflows.length} workflow(s): ${workflows.map((w) => `${w.name} [${w.status}]`).join(', ') || 'none'}`,
);

let problems = 0;
const require = (code: string) => {
  const wf = findWorkflow(workflows, code);
  if (!wf) {
    console.error(`FAIL  ${code} not found (or more than one) — name it "${code} …" exactly`);
    problems++;
  } else if (wf.status !== 'published') {
    console.error(`FAIL  ${wf.name} is "${wf.status}" — publish it`);
    problems++;
  } else {
    console.log(`ok    ${wf.name}`);
  }
  return wf;
};

const router = require('WF-01');
const emergency = require('WF-06');
for (const code of [
  'WF-02',
  'WF-03',
  'WF-04',
  'WF-05',
  'WF-07',
  'WF-08',
  'WF-10',
  'WF-11',
  'WF-13',
]) {
  if (!findWorkflow(workflows, code)) console.log(`note  ${code} not built yet`);
}
if (problems) process.exit(1);

await ghl('PATCH', `/voice-ai/agents/${state.agentId}?locationId=${locationId}`, 'v3', {
  callEndWorkflowIds: [router!.id],
});
console.log('ok    WF-01 attached to agent call end');

const agent = await ghl<{ actions?: { id: string; name: string }[] }>(
  'GET',
  `/voice-ai/agents/${state.agentId}?locationId=${locationId}`,
  'v3',
);
const body = {
  agentId: state.agentId,
  locationId,
  name: 'alert_owner_urgent',
  actionType: 'WORKFLOW_TRIGGER',
  actionParameters: {
    triggerPrompt:
      'Only when the escalation instruction says emergency_alert or urgent_alert, or a transfer for a P1/P2 caller failed.',
    triggerMessage: "I'm alerting the owner as urgent right now.",
    workflowId: emergency!.id,
  },
};
const existing = agent.actions?.find((a) => a.name === 'alert_owner_urgent');
if (existing) await ghl('PUT', `/voice-ai/actions/${existing.id}`, 'v3', body);
else await ghl('POST', '/voice-ai/actions', 'v3', body);

const after = await ghl<{ callEndWorkflowIds?: string[]; actions?: { name: string }[] }>(
  'GET',
  `/voice-ai/agents/${state.agentId}?locationId=${locationId}`,
  'v3',
);
const linked =
  after.callEndWorkflowIds?.includes(router!.id) &&
  after.actions?.some((a) => a.name === 'alert_owner_urgent');
console.log(
  linked
    ? '\nLINKED — verified by reading the agent back'
    : '\nFAIL — agent does not show the links',
);
process.exit(linked ? 0 : 1);

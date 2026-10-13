/**
 * Off-boarding: removes what tools/demo/provision.ts created in the env file's sub-account.
 *   npx tsx tools/demo/teardown.ts --confirm <locationId> [--include-fields]
 * Deletes the Voice AI agent (detaching its number), its actions, the calendar and our custom
 * values. Contact fields are KEPT unless --include-fields: deleting a field deletes the customer
 * data stored in it (export first; see docs/compliance/gdpr-pack.md).
 */
import { readFile, rm } from 'node:fs/promises';
import { locationId, stateFile } from '../env.js';
import { ghl } from '../ghl/client.js';

const confirmIdx = process.argv.indexOf('--confirm');
if (confirmIdx < 0 || process.argv[confirmIdx + 1] !== locationId) {
  console.error(
    `Refusing: pass --confirm ${locationId} to delete this sub-account's receptionist setup.`,
  );
  process.exit(2);
}
const includeFields = process.argv.includes('--include-fields');

interface State {
  agentId?: string;
  calendarId?: string;
  customValueIds?: Record<string, string>;
  contactFieldIds?: Record<string, string>;
  actionIds?: Record<string, string>;
}
const state = JSON.parse(await readFile(stateFile(), 'utf8')) as State;
let failures = 0;
const del = async (label: string, path: string, version: string) => {
  try {
    await ghl('DELETE', path, version);
    console.log(`deleted ${label}`);
  } catch (err) {
    failures++;
    console.error(`FAIL  ${label}: ${(err as Error).message.slice(0, 160)}`);
  }
};

if (state.agentId) {
  for (const [name, id] of Object.entries(state.actionIds ?? {})) {
    await del(
      `action ${name}`,
      `/voice-ai/actions/${id}?locationId=${locationId}&agentId=${state.agentId}`,
      'v3',
    );
  }
  await del('agent', `/voice-ai/agents/${state.agentId}?locationId=${locationId}`, 'v3');
}
if (state.calendarId) await del('calendar', `/calendars/${state.calendarId}`, '2021-04-15');
for (const [name, id] of Object.entries(state.customValueIds ?? {})) {
  await del(`custom value ${name}`, `/locations/${locationId}/customValues/${id}`, '2021-07-28');
}
if (includeFields) {
  for (const [name, id] of Object.entries(state.contactFieldIds ?? {})) {
    await del(`contact field ${name}`, `/locations/${locationId}/customFields/${id}`, '2021-07-28');
  }
} else {
  console.log('kept contact fields (customer data); use --include-fields after exporting');
}
if (!failures) await rm(stateFile());
console.log(
  failures ? `\n${failures} deletion(s) failed; state kept for retry` : '\nteardown complete',
);
process.exit(failures ? 1 : 0);

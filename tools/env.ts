/**
 * Shared environment selection for operator tools. Each GHL sub-account (MASTER-DEV, MASTER-QA,
 * DEMO, CLIENT-*) has its own env file with its own token and location id:
 *   ANNIE_ENV_FILE=.env.qa npx tsx tools/demo/provision.ts <url>
 * Default is .env. Provisioning state is kept per location in build/state/<locationId>.json.
 */
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { loadClientConfigFile, type ClientConfig } from '../src/clients/config-store.js';

export const ENV_FILE = process.env.ANNIE_ENV_FILE ?? '.env';
process.loadEnvFile(ENV_FILE);

export const token = process.env.GHL_PRIVATE_TOKEN ?? '';
export const locationId = process.env.GHL_LOCATION_ID ?? '';
if (!token || !locationId) {
  throw new Error(`GHL_PRIVATE_TOKEN and GHL_LOCATION_ID must be set in ${ENV_FILE}`);
}

export const stateFile = (location: string = locationId) => `build/state/${location}.json`;

/** The client config whose ghl_location_id is this environment's location. */
export async function clientForLocation(dir = 'config/clients'): Promise<ClientConfig> {
  const files = (await readdir(dir)).filter((f) => /\.ya?ml$/.test(f));
  for (const file of files) {
    const client = await loadClientConfigFile(path.join(dir, file));
    if (client.config.ghl_location_id === locationId) return client;
  }
  throw new Error(
    `No client config in ${dir} has ghl_location_id ${locationId} (from ${ENV_FILE})`,
  );
}

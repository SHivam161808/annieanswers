/**
 * Validates every client configuration. Run in CI and before onboarding a client:
 *   npm run validate:config [-- path/to/client.yaml ...]
 */
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { ConfigValidationError, loadClientConfigFile } from '../src/clients/config-store.js';

const CLIENT_DIR = 'config/clients';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const files = args.length
    ? args
    : (await readdir(CLIENT_DIR))
        .filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'))
        .map((f) => path.join(CLIENT_DIR, f));

  let failed = 0;
  const locations = new Map<string, string>();
  for (const file of files) {
    try {
      const { config } = await loadClientConfigFile(file);
      const clash = locations.get(config.ghl_location_id);
      if (clash) throw new ConfigValidationError(file, [`ghl_location_id also used by ${clash}`]);
      locations.set(config.ghl_location_id, file);
      console.log(`ok    ${file} (${config.client_id}, ${config.booking_mode})`);
    } catch (err) {
      failed++;
      if (err instanceof ConfigValidationError) {
        console.error(`FAIL  ${file}`);
        for (const issue of err.issues) console.error(`      - ${issue}`);
      } else {
        console.error(`FAIL  ${file}: ${(err as Error).message}`);
      }
    }
  }
  console.log(`\n${files.length - failed}/${files.length} client configs valid`);
  process.exit(failed ? 1 : 0);
}

void main();

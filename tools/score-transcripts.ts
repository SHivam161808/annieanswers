/**
 * Scores recorded transcripts (phone harness or GHL call-log exports) against the scenario pack.
 *   npm run score -- <dir-with-transcripts>
 * Each file is <SCENARIO_ID>.json in the transcript format (src/conversation/schema.ts).
 * Exits non-zero if a blocking category (safety) fails, so it can gate a release.
 */
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { loadClientConfigFile } from '../src/clients/config-store.js';
import { transcriptSchema } from '../src/conversation/schema.js';
import { scoreTranscript } from '../src/conversation/scorer.js';
import { loadScenarios, summarise } from '../src/conversation/suite.js';
import { buildCustomValues } from '../src/prompt/custom-values.js';
import { renderPrompt } from '../src/prompt/render.js';
import { loadPromptSources } from '../src/prompt/sources.js';

const CLIENT_DIR = 'config/clients';

async function main(): Promise<void> {
  const dir = process.argv[2];
  if (!dir) {
    console.error('usage: npm run score -- <transcript-dir>');
    process.exit(2);
  }
  const scenarios = new Map((await loadScenarios()).map((s) => [s.id, s]));
  const clientFiles = (await readdir(CLIENT_DIR)).filter((f) => /\.ya?ml$/.test(f));
  const clients = await Promise.all(
    clientFiles.map(async (f) => (await loadClientConfigFile(path.join(CLIENT_DIR, f))).config),
  );
  const files = (await readdir(dir)).filter((f) => f.endsWith('.json')).sort();
  const results = [];

  for (const file of files) {
    const id = path.basename(file, '.json');
    const scenario = scenarios.get(id);
    if (!scenario) {
      console.error(`skip  ${file}: no scenario ${id}`);
      continue;
    }
    const config = clients.find((c) => c.client_id === scenario.client);
    if (!config) throw new Error(`${id}: no client config with client_id ${scenario.client}`);
    const sources = await loadPromptSources(config.trade_module);
    const transcript = transcriptSchema.parse(
      JSON.parse(await readFile(path.join(dir, file), 'utf8')),
    );
    const score = scoreTranscript(
      transcript,
      {
        config,
        safetyScripts: sources.safetyScripts,
        emergencyNumbers: sources.emergencyNumbers,
        greeting: renderPrompt(sources, 'rendered', buildCustomValues(config)).greeting,
      },
      scenario,
    );
    results.push({ scenario, score });
    const failedChecks = score.checks.filter((c) => !c.passed);
    const m = score.metrics;
    console.log(
      `${score.passed ? 'pass' : 'FAIL'}  ${id}  words=${m.avgWords} reasks=${m.reasks} p50=${m.medianLatencyMs ?? '-'}ms p90=${m.p90LatencyMs ?? '-'}ms`,
    );
    for (const c of failedChecks)
      console.log(`        - ${c.id}${c.detail ? `: ${c.detail}` : ''}`);
  }

  const summary = summarise(results);
  console.log('');
  for (const c of summary.categories) {
    console.log(
      `${c.ok ? 'ok  ' : 'FAIL'}  ${c.category.padEnd(20)} ${c.passed}/${c.total} (need ${c.required * 100}%)${c.blocking ? ' BLOCKING' : ''}`,
    );
  }
  console.log(`\nrelease ${summary.releasable ? 'allowed' : 'BLOCKED (safety)'}`);
  process.exit(summary.releasable ? 0 : 1);
}

void main();

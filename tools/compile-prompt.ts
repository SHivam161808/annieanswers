/**
 * Builds and checks the agent prompt.
 *   npm run prompt:build              lint + write build/prompts/ (universal + every client)
 *   npm run prompt:build -- --release also require PO approvals (blocks snapshot release)
 * Outputs:
 *   build/prompts/universal.prompt.md     GHL mode: {{custom_values.*}} left for GHL
 *   build/prompts/universal.greeting.txt
 *   build/prompts/<client>/prompt.md      fully rendered (fallback mode / offline tests)
 *   build/prompts/<client>/greeting.txt
 *   build/prompts/<client>/custom-values.json  values to push to the sub-account
 */
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { loadClientConfigFile } from '../src/clients/config-store.js';
import { buildCustomValues } from '../src/prompt/custom-values.js';
import { lintPrompt, releaseIssues, wordCount } from '../src/prompt/lint.js';
import { renderPrompt } from '../src/prompt/render.js';
import { loadPromptSources } from '../src/prompt/sources.js';

const CLIENT_DIR = 'config/clients';
const OUT_DIR = 'build/prompts';

async function main(): Promise<void> {
  const release = process.argv.includes('--release');
  const files = (await readdir(CLIENT_DIR)).filter((f) => /\.ya?ml$/.test(f)).sort();
  const clients = await Promise.all(
    files.map((f) => loadClientConfigFile(path.join(CLIENT_DIR, f))),
  );
  const trades = new Set(clients.map((c) => c.config.trade_module));

  let failed = false;
  for (const trade of trades) {
    const sources = await loadPromptSources(trade);
    const tradeClients = clients
      .filter((c) => c.config.trade_module === trade)
      .map((c) => c.config);
    const issues = [
      ...lintPrompt(sources, tradeClients),
      ...(release ? releaseIssues(sources) : []),
    ];
    for (const i of issues) console.error(`FAIL  [${i.rule}] ${i.file}: ${i.message}`);
    if (issues.length) {
      failed = true;
      continue;
    }

    await mkdir(OUT_DIR, { recursive: true });
    const universal = renderPrompt(sources, 'ghl');
    await writeFile(path.join(OUT_DIR, `universal-${trade}.prompt.md`), universal.prompt);
    await writeFile(path.join(OUT_DIR, `universal-${trade}.greeting.txt`), universal.greeting);
    console.log(`ok    universal ${trade} prompt (${wordCount(universal.prompt)} words)`);

    for (const cfg of tradeClients) {
      const values = buildCustomValues(cfg);
      const rendered = renderPrompt(sources, 'rendered', values);
      const dir = path.join(OUT_DIR, cfg.client_id);
      await mkdir(dir, { recursive: true });
      await writeFile(path.join(dir, 'prompt.md'), rendered.prompt);
      await writeFile(path.join(dir, 'greeting.txt'), rendered.greeting);
      await writeFile(path.join(dir, 'custom-values.json'), `${JSON.stringify(values, null, 2)}\n`);
      console.log(
        `ok    ${cfg.client_id}: prompt ${wordCount(rendered.prompt)} words, greeting ${wordCount(rendered.greeting)} words`,
      );
    }

    if (!release) {
      const pending = releaseIssues(sources).length;
      if (pending)
        console.log(`note  ${pending} PO approvals outstanding (release would be blocked)`);
    }
  }
  process.exit(failed ? 1 : 0);
}

void main();

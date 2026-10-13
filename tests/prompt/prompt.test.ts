import { readFile } from 'node:fs/promises';
import { beforeAll, describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import type { BusinessConfig } from '../../config/schema/business-config.js';
import { validateClientConfig } from '../../src/clients/config-store.js';
import {
  CUSTOM_VALUE_KEYS,
  buildCustomValues,
  scheduleText,
} from '../../src/prompt/custom-values.js';
import { GREETING_MAX_WORDS, lintPrompt, releaseIssues, wordCount } from '../../src/prompt/lint.js';
import { PromptRenderError, renderPrompt } from '../../src/prompt/render.js';
import { loadPromptSources, type PromptSources } from '../../src/prompt/sources.js';

let sources: PromptSources;
let demo: BusinessConfig;

beforeAll(async () => {
  sources = await loadPromptSources('plumbing');
  demo = validateClientConfig(
    parse(await readFile('config/clients/demo.yaml', 'utf8')),
    'demo.yaml',
  ).config;
});

/** A copy of the sources with one layer's text changed. */
function withLayer(id: string, change: (s: string) => string): PromptSources {
  return {
    ...sources,
    layers: sources.layers.map((l) => (l.id === id ? { ...l, source: change(l.source) } : l)),
  };
}

const rules = (s: PromptSources, clients: BusinessConfig[] = [demo]) =>
  lintPrompt(s, clients).map((i) => i.rule);

describe('prompt sources pass lint', () => {
  it('has no lint issues', () => {
    expect(lintPrompt(sources, [demo])).toEqual([]);
  });

  it('keeps every layer in order L0..L4', () => {
    expect(sources.layers.map((l) => l.id)).toEqual(['L0', 'L1', 'L2', 'L3', 'L4']);
  });
});

describe('lint rules fire on violations', () => {
  it('rejects a phone number in a universal layer', () => {
    expect(rules(withLayer('L1', (s) => `${s}\nCall 07700 900123.`))).toContain(
      'no-business-facts',
    );
  });

  it('rejects a price in a universal layer', () => {
    expect(rules(withLayer('L2', (s) => `${s}\nCall-out is £60.`))).toContain('no-business-facts');
  });

  it('rejects a postcode in a universal layer', () => {
    expect(rules(withLayer('L1', (s) => `${s}\nWe cover LS6 2AB.`))).toContain('no-business-facts');
  });

  it("rejects a client's name hardcoded in a universal layer", () => {
    expect(rules(withLayer('L1', (s) => `${s}\nAsk for Dave.`))).toContain('no-business-facts');
  });

  it('rejects unknown custom values', () => {
    expect(rules(withLayer('L3', (s) => `${s}\n{{custom_values.owner_mobile}}`))).toContain(
      'known-placeholders',
    );
  });

  it('rejects a custom value that is never used', () => {
    expect(
      rules(withLayer('L3', (s) => s.replace('{{custom_values.cancellation_policy}}', 'x'))),
    ).toContain('known-placeholders');
  });

  it('rejects a safety script left out of the prompt', () => {
    expect(rules(withLayer('L0', (s) => s.replace('{{> safety:carbon_monoxide}}', '')))).toContain(
      'safety-scripts',
    );
  });

  it('rejects a safety script that speaks an unregistered number', () => {
    const scripts = new Map(sources.safetyScripts);
    const gas = scripts.get('gas_smell_gb')!;
    scripts.set('gas_smell_gb', { ...gas, text: gas.text.replace('0800 111 999', '0800 111 998') });
    expect(rules({ ...sources, safetyScripts: scripts })).toContain('emergency-numbers');
  });

  it('rejects references to actions that do not exist', () => {
    expect(rules(withLayer('L1', (s) => `${s}\nCall \`delete_contact\`.`))).toContain(
      'known-actions',
    );
  });

  it('rejects unknown escalation triggers', () => {
    expect(
      rules(withLayer('L1', (s) => `${s}\nCall \`escalation\` with trigger \`panic\`.`)),
    ).toContain('known-actions');
  });

  it('rejects a job type without a triage row', () => {
    expect(rules(withLayer('L2', (s) => s.replace(/^.*\|\s*outside_tap\s*\|.*$/m, '')))).toContain(
      'job-types',
    );
  });

  it('rejects a greeting over the ~4 s budget', () => {
    const long = {
      ...demo,
      business_name_spoken: 'Smith and Sons Plumbing and Heating of West Yorkshire',
    };
    expect(rules(sources, [long])).toContain('greeting');
  });

  it('rejects internal numbers leaking into the rendered prompt', () => {
    const leaky = { ...demo, quote_policy: `Ring ${demo.transfer_number_primary} for quotes.` };
    expect(rules(sources, [leaky])).toContain('no-internal-data');
  });
});

describe('suspended safety scripts', () => {
  it('stopcock advice is suspended pending UK-plumber validation', () => {
    const stopcock = sources.safetyScripts.get('stopcock_advice');
    expect(stopcock?.status).toBe('suspended');
    expect(stopcock?.suspended_reason).toBeTruthy();
  });

  it('never renders stopcock or isolation advice in any mode', () => {
    for (const mode of ['ghl', 'rendered'] as const) {
      const { prompt } = renderPrompt(sources, mode, buildCustomValues(demo));
      expect(prompt).not.toMatch(/turn the water off at the stopcock/i);
      expect(prompt).not.toMatch(/usually under the\s+kitchen sink/i);
    }
  });

  it('refuses to render a suspended script and lint reports it', () => {
    const broken = withLayer('L0', (s) => `${s}\n{{> safety:stopcock_advice}}`);
    expect(() => renderPrompt(broken, 'ghl')).toThrow(/suspended/);
    expect(rules(broken)).toContain('safety-scripts');
  });

  it('does not require suspended scripts to be approved for release', () => {
    expect(releaseIssues(sources).map((i) => i.file)).not.toContain('safety/stopcock_advice.yaml');
  });
});

describe('rendering', () => {
  it('ghl mode keeps placeholders and inlines safety scripts', () => {
    const { prompt, greeting } = renderPrompt(sources, 'ghl');
    expect(prompt).toContain('{{custom_values.owner_first_name}}');
    expect(prompt).not.toContain('{{> safety:');
    expect(greeting).toContain('{{custom_values.business_name_spoken}}');
  });

  it('rendered mode fills every placeholder from config', () => {
    const { prompt, greeting } = renderPrompt(sources, 'rendered', buildCustomValues(demo));
    expect(prompt).not.toMatch(/\{\{|\}\}/);
    expect(prompt).toContain('Your name is Sophie.');
    expect(prompt).toContain(
      'Monday to Friday 8am to half 5; Saturday 9am to midday; closed Sunday',
    );
    expect(greeting).toBe(
      'Smith and Sons, virtual assistant speaking. Calls are recorded. How can I help?',
    );
    expect(wordCount(greeting)).toBeLessThanOrEqual(GREETING_MAX_WORDS);
  });

  it('safety scripts appear verbatim in both modes (fixed wording, never generated)', () => {
    for (const mode of ['ghl', 'rendered'] as const) {
      const { prompt } = renderPrompt(sources, mode, buildCustomValues(demo));
      for (const script of sources.safetyScripts.values()) {
        if (script.status === 'suspended') expect(prompt).not.toContain(script.text.trim());
        else expect(prompt).toContain(`Say exactly: "${script.text.trim()}"`);
      }
    }
  });

  it('safety rules come before everything else in the prompt', () => {
    const { prompt } = renderPrompt(sources, 'ghl');
    expect(prompt.indexOf('<safety_scripts>')).toBeLessThan(prompt.indexOf('# L1'));
  });

  it('rendered mode requires values', () => {
    expect(() => renderPrompt(sources, 'rendered')).toThrow(PromptRenderError);
  });

  it('fails on a missing safety script', () => {
    const broken = withLayer('L0', (s) => `${s}\n{{> safety:flood}}`);
    expect(() => renderPrompt(broken, 'ghl')).toThrow(PromptRenderError);
  });
});

describe('custom values (L3)', () => {
  it('produces every key, with no empty values', () => {
    const values = buildCustomValues(demo);
    expect(Object.keys(values).sort()).toEqual([...CUSTOM_VALUE_KEYS].sort());
    for (const v of Object.values(values)) expect(v.trim()).not.toBe('');
  });

  it('falls back to "owner will confirm" rather than leaving gaps', () => {
    const values = buildCustomValues({
      ...demo,
      pricing_statements: [],
      payment_methods: [],
      agent_name: undefined,
    });
    expect(values.pricing_text).toContain('Dave will confirm');
    expect(values.payment_methods_text).toContain('Dave will confirm');
    expect(values.persona_sentence).toContain('virtual assistant');
  });

  it('states gas work correctly for Gas Safe and non-Gas Safe businesses', () => {
    expect(buildCustomValues(demo).gas_work_statement).toContain('never offer gas work');
    expect(buildCustomValues({ ...demo, gas_safe_registered: true }).gas_work_statement).toContain(
      'Gas Safe registered;',
    );
  });

  it('groups opening hours the way a person says them', () => {
    expect(
      scheduleText({
        mon: [{ open: '09:00', close: '17:00' }],
        tue: [{ open: '09:00', close: '17:00' }],
        thu: [
          { open: '09:00', close: '12:30' },
          { open: '13:30', close: '17:00' },
        ],
        sun: [{ open: '00:00', close: '24:00' }],
      }),
    ).toBe(
      'Monday to Tuesday 9am to 5pm; closed Wednesday; Thursday 9am to half 12 and half 1 to 5pm; closed Friday to Saturday; Sunday 12am to midnight',
    );
  });
});

describe('release gate', () => {
  it('blocks release while safety scripts, numbers and greeting are unapproved', () => {
    const issues = releaseIssues(sources);
    const active = [...sources.safetyScripts.values()].filter((s) => s.status !== 'suspended');
    expect(issues.length).toBe(active.length + sources.emergencyNumbers.length + 1);
  });

  it('passes once everything is approved', () => {
    const approved: PromptSources = {
      ...sources,
      safetyScripts: new Map(
        [...sources.safetyScripts].map(([id, s]) => [
          id,
          { ...s, status: 'approved', approved_by: 'PO' },
        ]),
      ),
      emergencyNumbers: sources.emergencyNumbers.map((n) => ({ ...n, verified_by_po: true })),
      greeting: { ...sources.greeting, status: 'approved', approved_by: 'PO' },
    };
    expect(releaseIssues(approved)).toEqual([]);
  });
});

describe('workflow-only values', () => {
  it('are never placeholders in the prompt and never appear rendered', async () => {
    const { WORKFLOW_VALUE_KEYS, buildWorkflowValues } =
      await import('../../src/prompt/custom-values.js');
    const { prompt, greeting } = renderPrompt(sources, 'rendered', buildCustomValues(demo));
    for (const key of WORKFLOW_VALUE_KEYS) {
      for (const layer of sources.layers)
        expect(layer.source).not.toContain(`custom_values.${key}`);
    }
    for (const value of Object.values(buildWorkflowValues(demo)).filter(Boolean)) {
      expect(prompt + greeting).not.toContain(value);
    }
    expect(() =>
      renderPrompt(
        withLayer('L1', (s) => `${s}\n{{custom_values.alert_sms_number}}`),
        'ghl',
      ),
    ).toThrow(PromptRenderError);
  });
});

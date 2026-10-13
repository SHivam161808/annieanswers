import type { BusinessConfig } from '../../config/schema/business-config.js';
import { JOB_TYPES } from '../core/job-types.js';
import { ESCALATION_TRIGGERS } from '../domain/escalation.js';
import { isAgentAction } from './actions.js';
import { CUSTOM_VALUE_KEYS, buildCustomValues } from './custom-values.js';
import { PARTIAL_PATTERN, PLACEHOLDER_PATTERN, PromptRenderError, renderPrompt } from './render.js';
import type { PromptSources } from './sources.js';

/**
 * Prompt rules enforced in CI. `lintPrompt` is blocking on every change; `releaseIssues` adds the
 * approval checks that block a snapshot release (PO-approved safety wording and numbers).
 */

export interface LintIssue {
  rule: string;
  file: string;
  message: string;
}

/** ~3.3 words/s is a brisk receptionist pace; 13 words ≈ 4 s (Build Plan greeting target). */
export const GREETING_MAX_WORDS = 13;
/** Lean prompt is a latency lever (Build Plan); budget is reviewed against measured latency. */
export const PROMPT_MAX_WORDS = 3000;

const PHONE_LIKE = /(?:\+?\d[\d\s-]{6,}\d)|\b999\b|\b0\d{3,4}\s?\d{3}\s?\d{3,4}\b/g;
const POSTCODE_LIKE = /\b[A-Z]{1,2}\d[A-Z\d]?\s+\d[A-Z]{2}\b/;
const PRICE_LIKE = /£\s?\d|\b\d+\s?(?:pounds|quid|p\b)/i;
const ACTION_REF = /`([a-z_]+)`/g;
const TRIGGER_REF = /trigger `([a-z0-9_]+)`|`escalation` with (P\d)/gi;

export function wordCount(text: string): number {
  return text.split(/\s+/).filter((w) => /[A-Za-z0-9]/.test(w)).length;
}

function digitsOf(text: string): string {
  return text.replace(/\D/g, '');
}

export function lintPrompt(
  sources: PromptSources,
  clients: readonly BusinessConfig[],
): LintIssue[] {
  const issues: LintIssue[] = [];
  const add = (rule: string, file: string, message: string) => issues.push({ rule, file, message });

  const universal = [
    ...sources.layers.filter((l) => l.universal),
    { id: 'greeting', file: 'greeting.md', universal: true, source: sources.greeting.source },
  ];
  const allSources = [...sources.layers, universal.at(-1)!];

  // 1. Universal layers hold no business facts.
  const clientFacts = clients.flatMap((c) =>
    [c.business_name, c.business_name_spoken, c.owner_first_name, c.agent_name].filter(
      (v): v is string => Boolean(v),
    ),
  );
  for (const layer of universal) {
    const text = layer.source.replace(PARTIAL_PATTERN, '');
    for (const match of text.match(PHONE_LIKE) ?? []) {
      add(
        'no-business-facts',
        layer.file,
        `phone-like number "${match.trim()}" in universal layer`,
      );
    }
    if (POSTCODE_LIKE.test(text))
      add('no-business-facts', layer.file, 'postcode in universal layer');
    if (PRICE_LIKE.test(text)) add('no-business-facts', layer.file, 'price in universal layer');
    for (const fact of clientFacts) {
      if (new RegExp(`\\b${fact.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(text)) {
        add('no-business-facts', layer.file, `client-specific value "${fact}" in universal layer`);
      }
    }
  }

  // 2. Placeholders reference known custom values, and every custom value is used.
  const used = new Set<string>();
  for (const layer of allSources) {
    for (const [, key] of layer.source.matchAll(PLACEHOLDER_PATTERN)) {
      used.add(key as string);
      if (!(CUSTOM_VALUE_KEYS as readonly string[]).includes(key as string)) {
        add('known-placeholders', layer.file, `unknown custom value "${key}"`);
      }
    }
  }
  for (const key of CUSTOM_VALUE_KEYS) {
    if (!used.has(key))
      add('known-placeholders', 'prompts/', `custom value "${key}" is never used`);
  }

  // 3. Every safety script is included, and only existing scripts are referenced.
  const included = new Set<string>();
  for (const layer of allSources) {
    for (const [, id] of layer.source.matchAll(PARTIAL_PATTERN)) {
      included.add(id as string);
      if (!sources.safetyScripts.has(id as string)) {
        add('safety-scripts', layer.file, `unknown safety script "${id}"`);
      }
    }
  }
  for (const [id, script] of sources.safetyScripts) {
    if (script.status === 'suspended') {
      if (included.has(id))
        add('safety-scripts', `safety/${id}.yaml`, 'suspended script is included');
    } else if (!included.has(id)) {
      add('safety-scripts', `safety/${id}.yaml`, 'not included in any layer');
    }
  }

  // 4. Safety scripts speak only registered emergency numbers, exactly as declared.
  const registry = new Map(sources.emergencyNumbers.map((n) => [n.id, n]));
  for (const script of sources.safetyScripts.values()) {
    const file = `safety/${script.id}.yaml`;
    const spokenDigits = (script.text.match(PHONE_LIKE) ?? []).map(digitsOf);
    const declared = script.numbers.map((id) => registry.get(id));
    script.numbers.forEach((id, i) => {
      const entry = declared[i];
      if (!entry) add('emergency-numbers', file, `unknown number id "${id}"`);
      else if (!spokenDigits.includes(entry.digits)) {
        add('emergency-numbers', file, `declares ${id} but does not say ${entry.spoken}`);
      }
    });
    for (const digits of spokenDigits) {
      if (!declared.some((e) => e?.digits === digits)) {
        add('emergency-numbers', file, `says undeclared number ${digits}`);
      }
    }
    if (wordCount(script.text) > 45) {
      add('safety-scripts', file, `script is ${wordCount(script.text)} words (max 45)`);
    }
  }

  // 5. Only real actions and escalation triggers are referenced.
  for (const layer of allSources) {
    for (const [, name] of layer.source.matchAll(ACTION_REF)) {
      const known =
        isAgentAction(name as string) ||
        (JOB_TYPES as readonly string[]).includes(name as string) ||
        (ESCALATION_TRIGGERS as readonly string[]).includes(name as string);
      if (!known) add('known-actions', layer.file, `unknown action or code \`${name}\``);
    }
    for (const match of layer.source.matchAll(TRIGGER_REF)) {
      const trigger = (match[1] ?? match[2]) as string;
      if (!(ESCALATION_TRIGGERS as readonly string[]).includes(trigger)) {
        add('known-actions', layer.file, `unknown escalation trigger "${trigger}"`);
      }
    }
  }

  // 6. The trade module's job-type table matches the job-type codes exactly.
  const l2 = sources.layers.find((l) => l.id === 'L2');
  if (l2) {
    const tableCodes = new Set(
      [...l2.source.matchAll(/^\|[^|]+\|\s*([a-z_]+)\s*\|/gm)].map((m) => m[1] as string),
    );
    tableCodes.delete('Job');
    for (const code of JOB_TYPES) {
      if (!tableCodes.has(code)) add('job-types', l2.file, `job type "${code}" has no triage row`);
    }
    for (const code of tableCodes) {
      if (!(JOB_TYPES as readonly string[]).includes(code)) {
        add('job-types', l2.file, `triage row for unknown job type "${code}"`);
      }
    }
  }

  // 7–8. Per-client rendered checks: greeting length, prompt size, no internal data.
  for (const client of clients) {
    const file = `config/clients/${client.client_id}`;
    let rendered;
    try {
      rendered = renderPrompt(sources, 'rendered', buildCustomValues(client));
    } catch (err) {
      if (!(err instanceof PromptRenderError)) throw err;
      add('render', file, err.message);
      continue;
    }
    const greetingWords = wordCount(rendered.greeting);
    if (greetingWords > GREETING_MAX_WORDS) {
      add('greeting', file, `greeting is ${greetingWords} words (max ${GREETING_MAX_WORDS}, ~4 s)`);
    }
    for (const required of [client.business_name_spoken, 'virtual assistant', 'recorded']) {
      if (!rendered.greeting.includes(required)) {
        add('greeting', file, `greeting must mention "${required}"`);
      }
    }
    const words = wordCount(rendered.prompt);
    if (words > PROMPT_MAX_WORDS) {
      add('prompt-size', file, `rendered prompt is ${words} words (max ${PROMPT_MAX_WORDS})`);
    }
    const internal = [
      client.transfer_number_primary,
      client.transfer_number_backup,
      client.alert_sms_number,
      client.calendar_id,
      client.ghl_location_id,
    ].filter((v): v is string => Boolean(v));
    for (const value of internal) {
      if (rendered.prompt.includes(value) || rendered.greeting.includes(value)) {
        add('no-internal-data', file, 'rendered prompt contains an internal id or number');
      }
    }
    if (/\{\{|\}\}/.test(rendered.prompt + rendered.greeting)) {
      add('known-placeholders', file, 'unresolved template syntax after rendering');
    }
  }

  return issues;
}

/** Approval checks that block a release (Build Plan: PO approves safety scripts and numbers). */
export function releaseIssues(sources: PromptSources): LintIssue[] {
  const issues: LintIssue[] = [];
  for (const s of sources.safetyScripts.values()) {
    if (s.status === 'suspended') continue;
    if (s.status !== 'approved' || !s.approved_by) {
      issues.push({
        rule: 'release-approval',
        file: `safety/${s.id}.yaml`,
        message: 'safety script not approved by the PO',
      });
    }
  }
  for (const n of sources.emergencyNumbers) {
    if (!n.verified_by_po) {
      issues.push({
        rule: 'release-approval',
        file: 'emergency-numbers.yaml',
        message: `${n.id} not verified by the PO`,
      });
    }
  }
  if (sources.greeting.status !== 'approved' || !sources.greeting.approved_by) {
    issues.push({
      rule: 'release-approval',
      file: 'greeting.md',
      message: 'greeting / recording notice not approved by the PO',
    });
  }
  return issues;
}

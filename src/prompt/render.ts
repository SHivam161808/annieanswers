import { CUSTOM_VALUE_KEYS, type CustomValues } from './custom-values.js';
import type { PromptSources, SafetyScript } from './sources.js';

/**
 * Prompt assembly. Two modes:
 * - `ghl`: one universal prompt; {{custom_values.*}} placeholders are left for GHL to fill per
 *   sub-account (preferred, if spike item V1 confirms GHL substitutes them at call time).
 * - `rendered`: placeholders filled from a client's custom values (fallback if V1 fails, and the
 *   input to offline tests).
 * Safety scripts are always inlined at build time so they are byte-identical everywhere.
 */

export type RenderMode = 'ghl' | 'rendered';

export const PARTIAL_PATTERN = /\{\{>\s*safety:([a-z0-9_]+)\s*\}\}/g;
export const PLACEHOLDER_PATTERN = /\{\{\s*custom_values\.([a-z0-9_]+)\s*\}\}/g;

export class PromptRenderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PromptRenderError';
  }
}

export function formatSafetyScript(script: SafetyScript): string {
  return [
    `<script id="${script.id}" urgency="${script.urgency}">`,
    `When: ${script.when.trim()}`,
    `Say exactly: "${script.text.trim()}"`,
    '</script>',
  ].join('\n');
}

function inlineSafety(source: string, sources: PromptSources): string {
  return source.replace(PARTIAL_PATTERN, (_m, id: string) => {
    const script = sources.safetyScripts.get(id);
    if (!script) throw new PromptRenderError(`Unknown safety script "${id}"`);
    if (script.status === 'suspended') {
      throw new PromptRenderError(`Safety script "${id}" is suspended and cannot be used`);
    }
    return formatSafetyScript(script);
  });
}

function fillPlaceholders(source: string, values: CustomValues | null): string {
  return source.replace(PLACEHOLDER_PATTERN, (match, key: string) => {
    if (!(CUSTOM_VALUE_KEYS as readonly string[]).includes(key)) {
      throw new PromptRenderError(`Unknown custom value "${key}"`);
    }
    return values ? values[key as keyof CustomValues] : match;
  });
}

export interface RenderedPrompt {
  prompt: string;
  greeting: string;
}

export function renderPrompt(
  sources: PromptSources,
  mode: RenderMode,
  values: CustomValues | null = null,
): RenderedPrompt {
  if (mode === 'rendered' && !values) {
    throw new PromptRenderError('rendered mode requires custom values');
  }
  const fill = (s: string) =>
    fillPlaceholders(inlineSafety(s, sources), mode === 'ghl' ? null : values);
  return {
    prompt: sources.layers.map((l) => fill(l.source).trim()).join('\n\n') + '\n',
    greeting: fill(sources.greeting.source),
  };
}

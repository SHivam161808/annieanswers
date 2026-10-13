import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import { URGENCY_LEVELS } from '../core/urgency.js';

/** Loads the prompt sources in prompts/ (the Git source of truth for L0–L2, L4 and safety). */

export const PROMPT_DIR = 'prompts';

/** Universal layers in prompt order. L3 is business details rendered from custom values. */
export const LAYER_FILES = [
  { id: 'L0', file: 'L0-guardrails.md', universal: true },
  { id: 'L1', file: 'L1-core-receptionist.md', universal: true },
  { id: 'L2', file: 'L2-trades/{trade}.md', universal: true },
  { id: 'L3', file: 'L3-business.md', universal: false },
  { id: 'L4', file: 'L4-knowledge.md', universal: true },
] as const;

const approval = {
  status: z.enum(['draft', 'approved']),
  approved_by: z.string().min(1).nullable(),
  approved_on: z.string().nullable().optional(),
};

const safetyScriptSchema = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9_]+$/),
    title: z.string().min(1),
    urgency: z.enum(URGENCY_LEVELS),
    when: z.string().min(1),
    numbers: z.array(z.string()),
    text: z.string().min(1),
    /** suspended: kept on record but must never appear in a prompt (e.g. awaiting UK validation). */
    status: z.enum(['draft', 'approved', 'suspended']),
    suspended_reason: z.string().min(1).optional(),
    approved_by: z.string().min(1).nullable(),
    approved_on: z.string().nullable().optional(),
  })
  .strict()
  .refine((s) => s.status !== 'suspended' || s.suspended_reason, {
    message: 'suspended scripts need a suspended_reason',
  });

const emergencyNumbersSchema = z
  .object({
    numbers: z.array(
      z
        .object({
          id: z.string(),
          spoken: z.string(),
          digits: z.string().regex(/^\d+$/),
          service: z.string(),
          verified_by_po: z.boolean(),
        })
        .strict(),
    ),
  })
  .strict();

const greetingFrontMatter = z.object(approval).strict();

export type SafetyScript = z.infer<typeof safetyScriptSchema>;
export type EmergencyNumber = z.infer<typeof emergencyNumbersSchema>['numbers'][number];

export interface Layer {
  id: string;
  file: string;
  universal: boolean;
  source: string;
}

export interface PromptSources {
  layers: Layer[];
  safetyScripts: Map<string, SafetyScript>;
  emergencyNumbers: EmergencyNumber[];
  greeting: { source: string; status: 'draft' | 'approved'; approved_by: string | null };
}

function parseFrontMatter(raw: string): { data: unknown; body: string } {
  const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(raw);
  if (!match) return { data: {}, body: raw };
  return { data: parseYaml(match[1] as string), body: match[2] as string };
}

export async function loadPromptSources(
  trade: string,
  dir: string = PROMPT_DIR,
): Promise<PromptSources> {
  const layers: Layer[] = [];
  for (const layer of LAYER_FILES) {
    const file = layer.file.replace('{trade}', trade);
    layers.push({
      id: layer.id,
      file,
      universal: layer.universal,
      source: await readFile(path.join(dir, file), 'utf8'),
    });
  }

  const safetyScripts = new Map<string, SafetyScript>();
  const safetyDir = path.join(dir, 'safety');
  for (const file of (await readdir(safetyDir)).filter((f) => f.endsWith('.yaml')).sort()) {
    const script = safetyScriptSchema.parse(
      parseYaml(await readFile(path.join(safetyDir, file), 'utf8')),
    );
    if (`${script.id}.yaml` !== file) {
      throw new Error(`Safety script id "${script.id}" must match its file name ${file}`);
    }
    safetyScripts.set(script.id, script);
  }

  const emergencyNumbers = emergencyNumbersSchema.parse(
    parseYaml(await readFile(path.join(dir, 'emergency-numbers.yaml'), 'utf8')),
  ).numbers;

  const greetingRaw = parseFrontMatter(await readFile(path.join(dir, 'greeting.md'), 'utf8'));
  const greetingMeta = greetingFrontMatter.parse(greetingRaw.data);

  return {
    layers,
    safetyScripts,
    emergencyNumbers,
    greeting: {
      source: greetingRaw.body.trim(),
      status: greetingMeta.status,
      approved_by: greetingMeta.approved_by,
    },
  };
}

import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import {
  FAMILIES,
  SERVABLE_SYMPTOM_STATUSES,
  symptomFileSchema,
  type Family,
  type Presentation,
} from '../../knowledge/symptom-schema.js';
import { KnowledgeValidationError } from './library.js';

/**
 * Symptom guidance (knowledge/symptoms/*.yaml): finds the presentation that best matches what
 * the caller described and returns how to question, explain and qualify it. Only servable
 * presentations are indexed; flags are never served.
 */

export interface SymptomLibrary {
  families: Map<Family, { general: string[]; presentations: Presentation[] }>;
  servedPresentations: number;
}

export const EMPTY_SYMPTOM_LIBRARY: SymptomLibrary = {
  families: new Map(),
  servedPresentations: 0,
};

const STOP = new Set(
  'a an the is are was it its my our your of to in on at and or from with there s this that i we me us has have been be just'.split(
    ' ',
  ),
);

/** Crude stem so "dripping", "drips" and "drip" match: drop -ing/-ed/-es/-s and a doubled end. */
export function stem(word: string): string {
  let w = word;
  for (const suffix of ['ing', 'ed', 'es', 's']) {
    if (w.length > suffix.length + 2 && w.endsWith(suffix)) {
      w = w.slice(0, -suffix.length);
      break;
    }
  }
  return /([b-df-hj-np-tv-z])\1$/.test(w) ? w.slice(0, -1) : w;
}

/** Content words of a text, stemmed. */
export function terms(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t && !STOP.has(t))
    .map(stem);
}

export function buildSymptomLibrary(files: { name: string; content: unknown }[]): SymptomLibrary {
  const families: SymptomLibrary['families'] = new Map();
  let servedPresentations = 0;
  for (const file of files) {
    const parsed = symptomFileSchema.safeParse(file.content);
    if (!parsed.success) {
      throw new KnowledgeValidationError(
        file.name,
        parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
      );
    }
    const served = parsed.data.presentations.filter((p) => SERVABLE_SYMPTOM_STATUSES.has(p.status));
    families.set(parsed.data.family, {
      general: parsed.data.general_questions,
      presentations: served,
    });
    servedPresentations += served.length;
  }
  return { families, servedPresentations };
}

export async function loadSymptomLibrary(dir: string): Promise<SymptomLibrary> {
  let names: string[];
  try {
    names = (await readdir(dir)).filter((f) => f.endsWith('.yaml')).sort();
  } catch {
    return EMPTY_SYMPTOM_LIBRARY;
  }
  const files = await Promise.all(
    names.map(async (name) => ({
      name,
      content: parseYaml(await readFile(path.join(dir, name), 'utf8')) as unknown,
    })),
  );
  return buildSymptomLibrary(files);
}

/** Accepts the family names and the words the agent is likely to use for them. */
const FAMILY_ALIASES: Readonly<Record<string, Family>> = {
  toilet: 'toilets',
  loo: 'toilets',
  drain: 'drains',
  blockage: 'drains',
  blocked: 'drains',
  leak: 'leaks',
  leaking: 'leaks',
  'water damage': 'leaks',
  boiler: 'boilers',
  heating: 'boilers',
  'hot water': 'boilers',
  water: 'supply',
  pressure: 'supply',
  'water supply': 'supply',
  tap: 'taps',
  fixture: 'taps',
  install: 'taps',
  installation: 'taps',
};

export function resolveFamily(text: string | null | undefined): Family | null {
  if (!text) return null;
  const t = text.toLowerCase().trim();
  if ((FAMILIES as readonly string[]).includes(t)) return t as Family;
  return FAMILY_ALIASES[t] ?? FAMILY_ALIASES[t.replace(/s$/, '')] ?? null;
}

export type SymptomMatch =
  | { status: 'found'; family: Family; presentation: Presentation; score: number }
  | { status: 'general'; family: Family; questions: string[] }
  | { status: 'not_found' };

/**
 * Scores each presentation by the keywords whose words all appear in the caller's description
 * (stemmed, any order; longer keywords count far more), within the family if one is given. Ties go
 * to the earlier presentation in the file.
 */
export function matchSymptom(
  library: SymptomLibrary,
  query: { problem?: string | null; family?: string | null },
): SymptomMatch {
  const family = resolveFamily(query.family);
  const said = new Set(terms(query.problem ?? ''));
  const pool = [...library.families.entries()].filter(([f]) => !family || f === family);
  let best: { family: Family; presentation: Presentation; score: number } | null = null;
  for (const [f, entry] of pool) {
    for (const p of entry.presentations) {
      // A keyword counts when all its words were said, in any order. Weighted by length squared so
      // one specific phrase ("low water pressure") outweighs several generic words ("pressure").
      const score = p.keywords.reduce((n, k) => {
        const kw = terms(k);
        return kw.length && kw.every((t) => said.has(t)) ? n + kw.length ** 2 : n;
      }, 0);
      if (score > 0 && (!best || score > best.score)) best = { family: f, presentation: p, score };
    }
  }
  if (best) return { status: 'found', ...best };
  const general = family ? library.families.get(family) : undefined;
  return general && family
    ? { status: 'general', family, questions: general.general }
    : { status: 'not_found' };
}

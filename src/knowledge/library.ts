import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import {
  MANUFACTURERS,
  SERVABLE_STATUSES,
  boilerFileSchema,
  type FaultCodeEntry,
  type ManufacturerId,
} from '../../knowledge/schema.js';
import { normaliseCode } from './normalise.js';

/**
 * In-memory index of the technical knowledge library. Only servable entries (source_verified,
 * reviewed) are indexed; needs_review and withdrawn entries never reach a caller.
 */

interface RangeIndex {
  name: string;
  /** Normalised name + aliases for matching what callers say. */
  keys: string[];
}

interface ManufacturerIndex {
  ranges: RangeIndex[];
  /** normalised code -> servable entries */
  codes: Map<string, FaultCodeEntry[]>;
}

export interface KnowledgeLibrary {
  manufacturers: Map<ManufacturerId, ManufacturerIndex>;
  servedEntries: number;
}

// Stryker disable next-line Regex: removing one character at a time removes the same run.
const simplify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');

/**
 * Match keys for a range: each name and alias, plus the same without the maker's name in front,
 * because callers say "my 600 Combi 2", not "my Baxi 600 Combi 2".
 */
function rangeKeys(manufacturer: ManufacturerId, names: readonly string[]): string[] {
  const makers = [MANUFACTURERS[manufacturer].name, ...MANUFACTURERS[manufacturer].aliases]
    .map(simplify)
    .sort((a, b) => b.length - a.length);
  const keys = new Set<string>();
  // Stryker disable next-line MethodExpression: an empty key never matches (callers' text is non-empty, contained keys need 3+ characters).
  for (const key of names.map(simplify).filter(Boolean)) {
    keys.add(key);
    const maker = makers.find((m) => key.startsWith(m) && key.length - m.length >= 3);
    if (maker) keys.add(key.slice(maker.length));
  }
  return [...keys];
}

export class KnowledgeValidationError extends Error {
  constructor(
    readonly file: string,
    readonly issues: string[],
  ) {
    super(`Invalid knowledge file ${file}: ${issues.slice(0, 5).join('; ')}`);
    this.name = 'KnowledgeValidationError';
  }
}

export function buildLibrary(files: { name: string; content: unknown }[]): KnowledgeLibrary {
  const manufacturers = new Map<ManufacturerId, ManufacturerIndex>();
  let servedEntries = 0;
  for (const file of files) {
    const parsed = boilerFileSchema.safeParse(file.content);
    if (!parsed.success) {
      throw new KnowledgeValidationError(
        file.name,
        parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
      );
    }
    const f = parsed.data;
    const index: ManufacturerIndex = manufacturers.get(f.manufacturer) ?? {
      ranges: [],
      codes: new Map(),
    };
    for (const r of f.known_ranges) {
      index.ranges.push({
        name: r.name,
        keys: rangeKeys(f.manufacturer, [r.name, ...r.aliases]),
      });
    }
    for (const e of f.entries) {
      if (!SERVABLE_STATUSES.has(e.status)) continue;
      const key = normaliseCode(e.code);
      index.codes.set(key, [...(index.codes.get(key) ?? []), e]);
      servedEntries++;
    }
    manufacturers.set(f.manufacturer, index);
  }
  return { manufacturers, servedEntries };
}

export async function loadLibrary(dir: string): Promise<KnowledgeLibrary> {
  let names: string[];
  try {
    // Stryker disable next-line MethodExpression: Node's readdir (libuv scandir) already sorts; kept to be explicit.
    names = (await readdir(dir)).filter((f) => f.endsWith('.yaml')).sort();
  } catch {
    // No library deployed: lookups answer "not covered" and move to booking.
    return { manufacturers: new Map(), servedEntries: 0 };
  }
  const files = await Promise.all(
    names.map(async (name) => ({
      name,
      content: parseYaml(await readFile(path.join(dir, name), 'utf8')) as unknown,
    })),
  );
  return buildLibrary(files);
}

export function resolveManufacturer(text: string | null | undefined): ManufacturerId | null {
  if (!text) return null;
  // Stryker disable next-line MethodExpression: extra outer spaces cannot stop a ` alias ` match.
  const t = ` ${text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()} `;
  // Longest alias first so "worcester bosch" wins over "bosch".
  const candidates = (
    Object.entries(MANUFACTURERS) as [ManufacturerId, { aliases: readonly string[] }][]
  )
    .flatMap(([id, m]) =>
      // Stryker disable next-line MethodExpression,Regex: aliases are plain words with single separators.
      m.aliases.map((a) => ({ id, alias: ` ${a.replace(/[^a-z0-9]+/g, ' ').trim()} ` })),
    )
    .sort((a, b) => b.alias.length - a.alias.length);
  return candidates.find((c) => t.includes(c.alias))?.id ?? null;
}

export function resolveRange(
  index: ManufacturerIndex,
  text: string | null | undefined,
): string | null {
  if (!text) return null;
  const t = simplify(text);
  // Stryker disable next-line ConditionalExpression: an empty t matches no key either (keys are non-empty).
  if (!t) return null;
  // Exact name/alias first, then the longest key contained in what was said.
  const exact = index.ranges.find((r) => r.keys.includes(t));
  if (exact) return exact.name;
  const contained = index.ranges
    .flatMap((r) => r.keys.map((k) => ({ name: r.name, k })))
    .filter((x) => x.k.length >= 3 && t.includes(x.k))
    .sort((a, b) => b.k.length - a.k.length);
  return contained[0]?.name ?? null;
}

export type FaultLookup =
  | { status: 'needs_make' }
  | { status: 'needs_code' }
  | { status: 'needs_model'; candidates: string[] }
  | { status: 'not_covered'; reason: 'unknown_make' | 'unknown_code' | 'not_for_model' }
  | { status: 'found'; entry: FaultCodeEntry; ranges: string[] };

export function lookupFaultCode(
  library: KnowledgeLibrary,
  query: { make?: string | null; model?: string | null; code?: string | null },
): FaultLookup & { manufacturer?: ManufacturerId; range?: string | null; code?: string } {
  const manufacturer = resolveManufacturer(query.make) ?? resolveManufacturer(query.model);
  if (!manufacturer)
    return query.make
      ? { status: 'not_covered', reason: 'unknown_make' }
      : { status: 'needs_make' };
  const code = query.code ? normaliseCode(query.code) : '';
  if (!code) return { status: 'needs_code', manufacturer };

  const index = library.manufacturers.get(manufacturer);
  if (!index) return { status: 'not_covered', reason: 'unknown_make', manufacturer, code };
  const range = resolveRange(index, query.model);
  const entries = index.codes.get(code) ?? [];
  if (!entries.length)
    return { status: 'not_covered', reason: 'unknown_code', manufacturer, range, code };

  if (range) {
    const match = entries.find((e) => e.ranges.includes(range));
    return match
      ? { status: 'found', entry: match, ranges: match.ranges, manufacturer, range, code }
      : { status: 'not_covered', reason: 'not_for_model', manufacturer, range, code };
  }
  // Model not pinned down. A partial name ("ecoTEC plus") narrows to the ranges it is part of.
  // Stryker disable next-line StringLiteral: the mutant text has spaces and punctuation, which simplified keys never contain, so it narrows nothing.
  const said = query.model ? simplify(query.model) : '';
  const family =
    said.length >= 4
      ? index.ranges.filter((r) => r.keys.some((k) => k.includes(said))).map((r) => r.name)
      : [];
  const narrowed = family.length
    ? entries.filter((e) => e.ranges.some((r) => family.includes(r)))
    : entries;
  if (!narrowed.length)
    return { status: 'not_covered', reason: 'not_for_model', manufacturer, range: null, code };
  // Safe to answer only if every remaining documented range gives the same meaning.
  const meanings = new Set(narrowed.map((e) => e.meaning));
  if (meanings.size === 1) {
    const entry = narrowed[0] as FaultCodeEntry;
    return {
      status: 'found',
      entry,
      ranges: [...new Set(narrowed.flatMap((e) => e.ranges))],
      manufacturer,
      range: null,
      code,
    };
  }
  const candidates = [...new Set(narrowed.flatMap((e) => e.ranges))].slice(0, 3);
  return { status: 'needs_model', candidates, manufacturer, code };
}

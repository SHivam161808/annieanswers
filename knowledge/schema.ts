import { z } from 'zod';

/**
 * Technical knowledge library (Wil, Oct 2026): central, source-backed, separate from each
 * business's own facts. Every entry carries its source, applicability, date checked, verification
 * status and limitations, and can be withdrawn by changing its status.
 *
 * Serving rule (enforced in src/knowledge/): only `source_verified` and `reviewed` entries are
 * ever given to callers. `needs_review` and `withdrawn` are kept on record but never served.
 *  - source_verified: stated directly by an official manufacturer/industry source (quote recorded)
 *  - reviewed: interpretation or guidance beyond the source, approved by the plumber (reviewer named)
 */

export const KNOWLEDGE_STATUSES = [
  'source_verified',
  'reviewed',
  'needs_review',
  'withdrawn',
] as const;
export const SERVABLE_STATUSES: ReadonlySet<string> = new Set(['source_verified', 'reviewed']);

/** Manufacturers in scope (Wil: broad for the first four, main ranges for the rest). */
export const MANUFACTURERS = {
  worcester_bosch: {
    name: 'Worcester Bosch',
    aliases: ['worcester', 'bosch', 'worcester bosch', 'greenstar'],
  },
  vaillant: { name: 'Vaillant', aliases: ['vaillant', 'ecotec'] },
  ideal: { name: 'Ideal', aliases: ['ideal', 'ideal boilers', 'ideal logic', 'logic'] },
  baxi: { name: 'Baxi', aliases: ['baxi'] },
  glow_worm: { name: 'Glow-worm', aliases: ['glow-worm', 'glow worm', 'glowworm'] },
  viessmann: { name: 'Viessmann', aliases: ['viessmann', 'vitodens'] },
  alpha: { name: 'Alpha', aliases: ['alpha', 'alpha boilers'] },
} as const;
export type ManufacturerId = keyof typeof MANUFACTURERS;

/** Official domains accepted as sources for `source_verified` entries. */
export const OFFICIAL_SOURCE_DOMAINS: Readonly<Record<ManufacturerId, readonly string[]>> = {
  worcester_bosch: [
    'worcester-bosch.co.uk',
    'bosch-homecomfortgroup.com',
    'bosch-thermotechnology.com',
  ],
  vaillant: ['vaillant.co.uk', 'vaillant.com', 'vaillant-group.com'],
  ideal: ['idealheating.com', 'idealboilers.com', 'idealheating.co.uk'],
  baxi: ['baxi.co.uk', 'baxi.com'],
  glow_worm: ['glow-worm.co.uk'],
  // ViBooks, the official manuals site linked from viessmann.co.uk.
  viessmann: [
    'viessmann.co.uk',
    'viessmann.com',
    'viessmann.family',
    'viessmann-climatesolutions.com',
  ],
  // Exact host of Alpha's document store, linked from alpha-innovation.co.uk's manuals page
  // (checked 2026-10-19). Not the whole digitaloceanspaces.com domain.
  alpha: ['alpha-innovation.co.uk', 'alpha-heating.ams3.digitaloceanspaces.com', 'immergas.com'],
};

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const source = z
  .object({
    url: z
      .string()
      .url()
      .refine((u) => u.startsWith('https://'), 'https only'),
    title: z.string().min(3).max(200),
    publisher: z.string().min(2).max(80),
    /** Page or section in the document, when it is a manual. */
    page: z.string().max(40).optional(),
    checked: isoDate,
    /** Short exact excerpt supporting the entry (≤ 40 words, for verification, not spoken). */
    quote: z.string().min(3).max(400),
  })
  .strict();

const status = z.enum(KNOWLEDGE_STATUSES);

/** A short spoken line the agent may say (two short sentences at most). */
const spoken = z
  .string()
  .min(3)
  .max(220)
  .refine((s) => !/[{}<>]/.test(s), 'no template or markup characters');

export const faultCodeSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9][a-z0-9-]{2,80}$/),
    kind: z.literal('fault_code'),
    manufacturer: z.enum(Object.keys(MANUFACTURERS) as [ManufacturerId, ...ManufacturerId[]]),
    /** Ranges exactly as the manufacturer names them; the entry applies to all of them. */
    ranges: z.array(z.string().min(2).max(60)).min(1),
    /** Code as shown on the boiler display, e.g. "F.28", "EA227", "L2". */
    code: z.string().min(1).max(12),
    /** Manufacturer's published meaning, paraphrased plainly (spoken). */
    meaning: spoken,
    /**
     * Low-risk action the manufacturer's USER instructions permit a homeowner to take, or null.
     * Never anything involving gas, covers, internal parts or electrics.
     */
    homeowner_guidance: spoken.nullable(),
    /** Whether the manufacturer says to contact a Gas Safe engineer / installer for this code. */
    engineer_needed: z.boolean(),
    source,
    status,
    /** Who reviewed it, required for status "reviewed". */
    reviewed_by: z.string().min(2).max(80).nullable().default(null),
    limitations: z.string().max(300).nullable().default(null),
  })
  .strict()
  .superRefine((e, ctx) => {
    const host = new URL(e.source.url).hostname.replace(/^www\./, '');
    const official = OFFICIAL_SOURCE_DOMAINS[e.manufacturer].some(
      (d) => host === d || host.endsWith(`.${d}`),
    );
    if (e.status === 'source_verified' && !official) {
      ctx.addIssue({
        code: 'custom',
        path: ['source', 'url'],
        message: `source_verified needs an official ${e.manufacturer} domain (got ${host})`,
      });
    }
    if (e.status === 'reviewed' && !e.reviewed_by) {
      ctx.addIssue({
        code: 'custom',
        path: ['reviewed_by'],
        message: 'reviewed entries name the reviewer',
      });
    }
    if (
      e.homeowner_guidance &&
      /\b(gas valve|gas meter|gas supply|emergency control|cover|casing|panel|fuse|wiring|unscrew|dismantle|relight the pilot|bleed the gas)\b/i.test(
        e.homeowner_guidance,
      )
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['homeowner_guidance'],
        message: 'homeowner guidance must not involve gas parts, covers, panels or electrics',
      });
    }
    if (e.source.quote.split(/\s+/).length > 40) {
      ctx.addIssue({
        code: 'custom',
        path: ['source', 'quote'],
        message: 'quote at most 40 words',
      });
    }
  });

export type FaultCodeEntry = z.infer<typeof faultCodeSchema>;

/** A manufacturer file: knowledge/boilers/<manufacturer>.yaml */
export const boilerFileSchema = z
  .object({
    manufacturer: z.enum(Object.keys(MANUFACTURERS) as [ManufacturerId, ...ManufacturerId[]]),
    /** All domestic ranges known for this manufacturer, covered or not (coverage tracking). */
    known_ranges: z
      .array(
        z
          .object({
            name: z.string().min(2).max(60),
            aliases: z.array(z.string().min(2).max(60)).default([]),
            discontinued: z.boolean().default(false),
            /** covered = has served fault-code entries; partial; none = documented gap. */
            coverage: z.enum(['covered', 'partial', 'none']),
            note: z.string().max(200).nullable().default(null),
          })
          .strict(),
      )
      .min(1),
    entries: z.array(faultCodeSchema).default([]),
  })
  .strict()
  .superRefine((f, ctx) => {
    const rangeNames = new Set(f.known_ranges.map((r) => r.name));
    f.entries.forEach((e, i) => {
      if (e.manufacturer !== f.manufacturer) {
        ctx.addIssue({
          code: 'custom',
          path: ['entries', i, 'manufacturer'],
          message: 'manufacturer mismatch',
        });
      }
      for (const r of e.ranges) {
        if (!rangeNames.has(r)) {
          ctx.addIssue({
            code: 'custom',
            path: ['entries', i, 'ranges'],
            message: `range "${r}" not in known_ranges`,
          });
        }
      }
    });
    const ids = f.entries.map((e) => e.id);
    const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
    if (dupes.length)
      ctx.addIssue({
        code: 'custom',
        path: ['entries'],
        message: `duplicate ids: ${dupes.join(', ')}`,
      });
  });

export type BoilerFile = z.infer<typeof boilerFileSchema>;

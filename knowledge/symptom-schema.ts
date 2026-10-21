import { z } from 'zod';
import { JOB_TYPES } from '../src/core/job-types.js';

/**
 * Symptom guidance library (Wil, Oct 2026): how the receptionist questions, explains and
 * qualifies each plumbing presentation. Source material is the UK plumber's technical worksheets
 * (Raymond Chua, Oct 2026) read alongside the receptionist research — NOT treated as verified
 * fact. Every claim we take from a worksheet is checked; questionable ones are recorded in
 * `flags` and never served.
 *
 * Serving rule (src/knowledge/symptoms.ts): only presentations with status `plumber_supplied` or
 * `reviewed` are served. Explanations are always tentative ("can sometimes", "one common
 * reason is") and always followed by the engineer confirming on the visit.
 */

export const SYMPTOM_STATUSES = [
  'plumber_supplied',
  'reviewed',
  'needs_review',
  'withdrawn',
] as const;
export const SERVABLE_SYMPTOM_STATUSES: ReadonlySet<string> = new Set([
  'plumber_supplied',
  'reviewed',
]);

export const FAMILIES = ['toilets', 'drains', 'leaks', 'boilers', 'supply', 'taps'] as const;
export type Family = (typeof FAMILIES)[number];

const URGENCY = ['P1', 'P2', 'P3', 'P4'] as const;

/** Words that must never appear in anything spoken to a caller from this library. */
const UNSAFE_SPOKEN =
  /\b(soap|bleed (the|your) radiator|drain (the|your) system|unscrew|dismantle|casing|cover off|wiring|fuse|relight|pilot light|gas valve|gas tap|reset the boiler|top (it )?up|plunge|plunger|drain cleaner|caustic|bleach|boiling water|definitely|certainly|it's (just|only)|nothing to worry|safe to (use|leave)|can wait)\b/i;

const line = z
  .string()
  .min(3)
  .max(240)
  .refine((s) => !/[{}<>]/.test(s), 'no template or markup characters');

/** A statement the agent may say (one or two short sentences). */
const spoken = line.refine(
  (s) => !UNSAFE_SPOKEN.test(s),
  'contains an instruction or certainty the agent must never give',
);

/** A question the agent asks. It may mention things the caller did ("have you topped it up?"). */
const question = line
  .refine((s) => s.trim().endsWith('?'), 'questions end with a question mark')
  .refine(
    (s) =>
      !/\b(soap|could you (close|turn|open|bleed|drain|reset|check)|can you (close|turn|open|bleed|drain|reset|check))\b/i.test(
        s,
      ),
    'questions must not ask the caller to do anything to the system',
  );

/** An explanation the agent may offer: tentative, never a diagnosis. */
const explanation = spoken.refine(
  (s) => /\b(can|could|may|might|sometimes|often|one (common )?reason|possib)/i.test(s),
  'explanations must be tentative (can / may / sometimes / one common reason)',
);

const source = z
  .object({
    /** Worksheet the content came from, e.g. "Toilets — R. Chua, 2026-10-21". */
    worksheet: z.string().min(3).max(120),
    /** Section in the worksheet, e.g. "Part 1 §3". */
    section: z.string().min(1).max(60),
    /** Whether the receptionist research (Document 1 series) agrees. */
    research_agrees: z.boolean(),
  })
  .strict();

const flag = z
  .object({
    /** The worksheet's claim, quoted or closely paraphrased. */
    claim: z.string().min(3).max(400),
    /** Why it is questionable for UK use or for an AI receptionist. */
    concern: z.string().min(3).max(400),
    severity: z.enum(['unsafe', 'incorrect_uk', 'unsupported', 'too_cautious']),
  })
  .strict();

export const presentationSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9][a-z0-9-]{2,60}$/),
    /** Short name, e.g. "Toilet keeps running". */
    name: z.string().min(3).max(80),
    /** Lower-case words/phrases callers use; matched against what the caller said. */
    keywords: z.array(z.string().min(2).max(40)).min(2).max(30),
    /** The 2–3 highest-value questions, in order, as the agent would ask them (UK wording). */
    ask_first: z.array(question).min(1).max(3),
    /**
     * Probable explanations the agent may give AFTER the questions, each tagged with the answer
     * pattern that makes it relevant. Empty when nothing can be explained safely.
     */
    may_explain: z
      .array(z.object({ when: z.string().min(3).max(160), say: explanation }).strict())
      .max(4),
    /** Signs that raise urgency, with the level (P1 danger … P4 routine). */
    urgent_if: z
      .array(z.object({ sign: z.string().min(3).max(160), level: z.enum(URGENCY) }).strict())
      .max(6),
    /** What the agent must not say or instruct for this presentation (not spoken). */
    never: z.array(z.string().min(3).max(200)).min(1).max(6),
    /** Facts to capture for the engineer's notes. */
    engineer_notes: z.array(z.string().min(3).max(120)).min(1).max(8),
    /** How to qualify and book it. */
    booking: z
      .object({
        job_type: z.enum(JOB_TYPES),
        /** "repair" when the job is clear; "assessment" when it needs looking at first. */
        visit: z.enum(['repair', 'assessment']),
        /** Default urgency when no urgent sign is present. */
        default_urgency: z.enum(URGENCY),
        note: z.string().max(200).nullable().default(null),
      })
      .strict(),
    source,
    status: z.enum(SYMPTOM_STATUSES),
    reviewed_by: z.string().min(2).max(80).nullable().default(null),
  })
  .strict()
  .superRefine((p, ctx) => {
    if (p.status === 'reviewed' && !p.reviewed_by)
      ctx.addIssue({
        code: 'custom',
        path: ['reviewed_by'],
        message: 'reviewed entries name the reviewer',
      });
  });
export type Presentation = z.infer<typeof presentationSchema>;

export const symptomFileSchema = z
  .object({
    family: z.enum(FAMILIES),
    /** Questions worth asking for any presentation in this family when nothing more specific matches. */
    general_questions: z.array(question).min(1).max(3),
    presentations: z.array(presentationSchema).min(1),
    /** Questionable worksheet claims, reported to the client; never served. */
    flags: z.array(flag).default([]),
  })
  .strict()
  .superRefine((f, ctx) => {
    const ids = new Set<string>();
    f.presentations.forEach((p, i) => {
      if (ids.has(p.id))
        ctx.addIssue({
          code: 'custom',
          path: ['presentations', i, 'id'],
          message: `duplicate id ${p.id}`,
        });
      ids.add(p.id);
    });
  });
export type SymptomFile = z.infer<typeof symptomFileSchema>;

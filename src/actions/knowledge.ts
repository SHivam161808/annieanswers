import type { Logger } from 'pino';
import { MANUFACTURERS } from '../../knowledge/schema.js';
import type { ClientConfig } from '../clients/config-store.js';
import { lookupFaultCode, type KnowledgeLibrary } from '../knowledge/library.js';

/**
 * lookup_fault_code action. Gives the manufacturer's published meaning only when the make (and,
 * where meanings differ, the range) is identified; never guesses; always steers towards booking.
 * Unsupported makes/codes are logged as coverage gaps (make/range/code only — no caller data).
 */

export interface KnowledgeResponse {
  status: 'found' | 'needs_make' | 'needs_code' | 'needs_model' | 'not_covered';
  meaning?: string;
  homeowner_guidance?: string | null;
  source_ref?: string;
  instruction: string;
}

const str = (v: unknown, max = 80) =>
  typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null;

export function lookupFaultCodeAction(
  client: ClientConfig,
  params: { [k: string]: unknown },
  library: KnowledgeLibrary,
  log: Logger,
): KnowledgeResponse {
  const result = lookupFaultCode(library, {
    make: str(params.make),
    model: str(params.model),
    code: str(params.code, 20),
  });
  const cfg = client.config;
  const canDoGas = cfg.gas_safe_registered && cfg.services_offered.includes('gas_boiler');
  const next = canDoGas
    ? 'Then offer to book an engineer to take a look.'
    : "Then explain we don't work on gas boilers, so they'd need a Gas Safe registered engineer.";

  switch (result.status) {
    case 'needs_make':
      return {
        status: 'needs_make',
        instruction: 'Ask what make the boiler is; it is usually written on the front.',
      };
    case 'needs_code':
      return {
        status: 'needs_code',
        instruction: 'Ask them to read out the code or letters showing on the boiler display.',
      };
    case 'needs_model':
      return {
        status: 'needs_model',
        instruction: `That code means different things on different models. If you have not asked yet, ask once which model it is (it is usually on the front or underneath), for example ${result.candidates.join(' or ')}, and look it up again. If they don't know or you already asked, don't guess what it means: say the engineer will check the code on the visit, and carry on towards booking.`,
      };
    case 'not_covered':
      log.info(
        {
          knowledge_gap: true,
          reason: result.reason,
          manufacturer: result.manufacturer ?? null,
          range: result.range ?? null,
          code: result.code ?? null,
        },
        'knowledge_gap',
      );
      return {
        status: 'not_covered',
        instruction: `Don't guess what it means. Note the make, model and code for the engineer. ${next}`,
      };
    case 'found': {
      const e = result.entry;
      const maker = MANUFACTURERS[e.manufacturer].name;
      const guidance =
        e.homeowner_guidance && !e.engineer_needed
          ? ` ${maker}'s own guidance is: ${e.homeowner_guidance}`
          : e.homeowner_guidance
            ? ` If they ask, ${maker}'s guidance is: ${e.homeowner_guidance}`
            : '';
      return {
        status: 'found',
        meaning: e.meaning,
        homeowner_guidance: e.homeowner_guidance,
        source_ref: e.id,
        instruction: `Say ${maker} lists this code as: ${e.meaning} Make clear the engineer will confirm the actual cause.${guidance} ${next}`,
      };
    }
  }
}

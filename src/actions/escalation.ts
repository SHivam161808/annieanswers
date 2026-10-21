import type { ClientConfig } from '../clients/config-store.js';
import {
  decideEscalation,
  type EscalationAction,
  type EscalationDecision,
  type EscalationTrigger,
} from '../domain/escalation.js';

const INSTRUCTIONS: Readonly<Record<EscalationAction, string>> = {
  transfer: 'Tell the caller you are putting them through now, then use the transfer action.',
  offer_transfer: 'Offer to put the caller through to {owner}. Transfer only if they agree.',
  emergency_alert:
    'Tell the caller you are alerting {owner} as an emergency right now and they will be contacted urgently.',
  urgent_alert: 'Tell the caller you are sending {owner} an urgent alert now.',
  message: 'Take a message for {owner} and tell the caller: {callback_promise}',
  offer_callback: 'Offer a callback from {owner}: {callback_promise}',
  book: 'Continue to booking.',
};

export type EscalationResponse = EscalationDecision & { instruction: string };

export function escalation(
  client: ClientConfig,
  trigger: EscalationTrigger,
  now: Date,
): EscalationResponse {
  const decision = decideEscalation(client.config, trigger, now);
  const cfg = client.config;
  let instruction = INSTRUCTIONS[decision.action]
    .replaceAll('{owner}', cfg.owner_first_name)
    .replaceAll('{callback_promise}', cfg.callback_promise);
  if (decision.safety_script_first) {
    instruction = `Deliver the approved safety script first, word for word. Then: ${instruction}`;
  } else if (decision.trigger === 'P2') {
    instruction = `If water is near any electrics, say the water_on_electrics script first, word for word. Give no other instructions about the water. Then: ${instruction}`;
  }
  return { ...decision, instruction };
}

/** Decisions that promise the caller an urgent alert to the owner. */
export function needsOwnerAlert(response: EscalationResponse): boolean {
  return response.action === 'emergency_alert' || response.action === 'urgent_alert';
}

/**
 * Adjusts the instruction to what actually happened with the owner alert, so the agent never
 * claims an alert was sent when it wasn't.
 */
export function withAlertResult(
  response: EscalationResponse,
  client: ClientConfig,
  result: 'sent' | 'duplicate' | 'failed' | 'no_number' | 'not_configured',
): EscalationResponse & { owner_alerted: boolean } {
  if (result === 'sent' || result === 'duplicate') return { ...response, owner_alerted: true };
  const owner = client.config.owner_first_name;
  const prefix = response.instruction.includes('Then: ')
    ? response.instruction.slice(0, response.instruction.indexOf('Then: ') + 'Then: '.length)
    : '';
  return {
    ...response,
    owner_alerted: false,
    instruction: `${prefix}Take their name and best number. Do not say ${owner} has been alerted; say the details are going to ${owner} straight away as urgent.`,
  };
}

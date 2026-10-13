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

/**
 * Every action name the prompt may refer to. Custom actions call this service; native actions are
 * GHL Voice AI actions configured in the snapshot (Phase 4). Prompt lint rejects any other name.
 */
export const AGENT_ACTIONS = {
  call_context: { kind: 'custom', route: '/v1/actions/call-context' },
  check_service_area: { kind: 'custom', route: '/v1/actions/check-service-area' },
  escalation: { kind: 'custom', route: '/v1/actions/escalation' },
  find_booking: { kind: 'custom', route: '/v1/actions/find-booking' },
  available_slots: { kind: 'custom', route: '/v1/actions/available-slots' },
  reschedule_booking: { kind: 'custom', route: '/v1/actions/reschedule-booking' },
  cancel_booking: { kind: 'custom', route: '/v1/actions/cancel-booking' },
} as const;

export type AgentActionName = keyof typeof AGENT_ACTIONS;

export function isAgentAction(name: string): name is AgentActionName {
  return Object.hasOwn(AGENT_ACTIONS, name);
}

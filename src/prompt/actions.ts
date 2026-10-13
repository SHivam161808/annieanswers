/**
 * Every action name the prompt may refer to. Custom actions call this service; native actions are
 * GHL Voice AI actions configured in the snapshot (Phase 4). Prompt lint rejects any other name.
 */
export const AGENT_ACTIONS = {
  call_context: { kind: 'custom', route: '/v1/actions/call-context' },
  check_service_area: { kind: 'custom', route: '/v1/actions/check-service-area' },
  escalation: { kind: 'custom', route: '/v1/actions/escalation' },
} as const;

export type AgentActionName = keyof typeof AGENT_ACTIONS;

export function isAgentAction(name: string): name is AgentActionName {
  return Object.hasOwn(AGENT_ACTIONS, name);
}

import type { Agent } from "./types"

/** Last-resort label when neither the user nor the channel provides one. */
export const DEFAULT_AGENT_NAME = "default"

/**
 * Display label for an Agent. The user's custom name wins; otherwise use the
 * name published by the Remote Agent channel for that id; otherwise `default`.
 */
export function resolveAgentName(
  agentId: string | undefined,
  agents: Agent[] | undefined,
  customName?: string
) {
  const custom = customName?.trim()
  if (custom) return custom
  const channel = agentId
    ? agents?.find((a) => a.id === agentId)?.name?.trim()
    : undefined
  return channel || DEFAULT_AGENT_NAME
}

/** Agent-session identity is stable across every Linear prompt. Comment IDs
 * are message identities and must never be used as the CloudCode bridge key. */
export function linearAgentSessionThreadId(
  issueId: string,
  agentSessionId: string
) {
  return `linear:${issueId}:s:${agentSessionId}`
}

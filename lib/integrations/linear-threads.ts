/** Agent-session identity is stable across every Linear prompt. Comment IDs
 * are message identities and must never be used as the CloudCode bridge key. */
export function linearAgentSessionThreadId(
  issueId: string,
  agentSessionId: string
) {
  return `linear:${issueId}:s:${agentSessionId}`
}

/** Parses only the canonical, comment-independent agent-session format. */
export function linearAgentSessionThreadParts(threadId: string) {
  const match = threadId.match(/^linear:([^:]+):s:([^:]+)$/)
  return match ? { agentSessionId: match[2], issueId: match[1] } : undefined
}

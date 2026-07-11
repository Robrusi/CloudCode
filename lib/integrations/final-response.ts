/** External integrations must never fall back to the in-app transcript: it
 * intentionally contains progress narration and tool markers. A successful
 * run is delivered only when the worker supplies Codex's authoritative final
 * assistant message. */
export function finalIntegrationResponse(
  status: string,
  finalResponse: string | undefined
) {
  if (status !== "succeeded") return undefined
  return finalResponse?.trim() || undefined
}

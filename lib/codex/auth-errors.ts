export const CODEX_AUTH_RECONNECT_MESSAGE =
  "Reconnect ChatGPT before starting another Codex run. The stored ChatGPT session can no longer refresh access tokens."

export function codexAuthMissingMessage(profile: string) {
  return `No Codex ChatGPT OAuth credentials are stored for profile "${profile}".`
}

export function codexAuthReconnectMessage(profile?: string) {
  return profile
    ? `${CODEX_AUTH_RECONNECT_MESSAGE} Profile: ${profile}.`
    : CODEX_AUTH_RECONNECT_MESSAGE
}

export function isCodexRefreshTokenReusedError(error: unknown) {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : ""
  const normalized = message.toLowerCase()

  return (
    normalized.includes("refresh_token_reused") ||
    normalized.includes("refresh token was already used") ||
    normalized.includes("refresh token has already been used") ||
    normalized.includes("access token could not be refreshed")
  )
}

export function isCodexRefreshTokenReusedRunResult(result: {
  exitCode?: number
  lastMessage?: string
  stderr?: string
  stdout?: string
}) {
  if (result.exitCode === 0) return false

  return [result.stderr, result.stdout, result.lastMessage].some((value) =>
    isCodexRefreshTokenReusedError(value)
  )
}

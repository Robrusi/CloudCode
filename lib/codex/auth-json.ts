export type ParsedCodexAuthJson = {
  accessToken: string
  accountId: string | null
  idToken: string
  lastRefresh: string
  openaiApiKey?: string
  refreshToken: string
}

export type CodexIdTokenProfile = {
  accountEmail?: string
  accountId: string | null
  accountName?: string
}

function decodeJwtPayload(token: string) {
  const [, payload] = token.split(".")

  if (!payload) {
    throw new Error("id_token must be a JWT.")
  }

  const normalized = payload.replace(/-/g, "+").replace(/_/g, "/")
  const padded = normalized.padEnd(
    normalized.length + ((4 - (normalized.length % 4)) % 4),
    "="
  )

  return JSON.parse(Buffer.from(padded, "base64").toString("utf8")) as Record<
    string,
    unknown
  >
}

export function getCodexProfileFromIdToken(
  idToken: string
): CodexIdTokenProfile {
  const payload = decodeJwtPayload(idToken)
  const authClaims = payload["https://api.openai.com/auth"]

  if (
    authClaims &&
    typeof authClaims === "object" &&
    !Array.isArray(authClaims)
  ) {
    const accountId = (authClaims as Record<string, unknown>).chatgpt_account_id

    if (typeof accountId === "string" && accountId.length > 0) {
      return {
        accountEmail:
          typeof payload.email === "string" && payload.email.length > 0
            ? payload.email
            : undefined,
        accountId,
        accountName:
          typeof payload.name === "string" && payload.name.length > 0
            ? payload.name
            : undefined,
      }
    }
  }

  return {
    accountEmail:
      typeof payload.email === "string" && payload.email.length > 0
        ? payload.email
        : undefined,
    accountId: null,
    accountName:
      typeof payload.name === "string" && payload.name.length > 0
        ? payload.name
        : undefined,
  }
}

function getAccountIdFromIdToken(idToken: string) {
  return getCodexProfileFromIdToken(idToken).accountId
}

export function parseCodexAuthJson(authJson: string): ParsedCodexAuthJson {
  let parsed: unknown

  try {
    parsed = JSON.parse(authJson)
  } catch {
    throw new Error("auth.json must be valid JSON.")
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("auth.json must be a JSON object.")
  }

  const record = parsed as Record<string, unknown>
  const tokens = record.tokens

  if (record.auth_mode && record.auth_mode !== "chatgpt") {
    throw new Error(
      'auth.json auth_mode must be "chatgpt" for OAuth-based Codex runs.'
    )
  }

  if (!tokens || typeof tokens !== "object" || Array.isArray(tokens)) {
    throw new Error(
      "This runner expects Codex ChatGPT OAuth tokens in auth.json."
    )
  }

  const tokenRecord = tokens as Record<string, unknown>

  if (
    typeof tokenRecord.id_token !== "string" ||
    typeof tokenRecord.access_token !== "string" ||
    typeof tokenRecord.refresh_token !== "string"
  ) {
    throw new Error(
      "auth.json tokens must include id_token, access_token, and refresh_token strings."
    )
  }

  const accountId =
    typeof tokenRecord.account_id === "string"
      ? tokenRecord.account_id
      : getAccountIdFromIdToken(tokenRecord.id_token)

  return {
    accessToken: tokenRecord.access_token,
    accountId,
    idToken: tokenRecord.id_token,
    lastRefresh:
      typeof record.last_refresh === "string"
        ? record.last_refresh
        : new Date().toISOString(),
    openaiApiKey:
      typeof record.OPENAI_API_KEY === "string"
        ? record.OPENAI_API_KEY
        : undefined,
    refreshToken: tokenRecord.refresh_token,
  }
}

export function buildCodexAuthJsonFromParsed(auth: ParsedCodexAuthJson) {
  return JSON.stringify(
    {
      auth_mode: "chatgpt",
      ...(auth.openaiApiKey ? { OPENAI_API_KEY: auth.openaiApiKey } : {}),
      tokens: {
        id_token: auth.idToken,
        access_token: auth.accessToken,
        refresh_token: auth.refreshToken,
        account_id: auth.accountId,
      },
      last_refresh: auth.lastRefresh,
    },
    null,
    2
  )
}

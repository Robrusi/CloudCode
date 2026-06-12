import { codexOAuthClientId, codexOAuthIssuer } from "@/lib/codex/oauth-config"

export type RefreshedCodexOAuthTokens = {
  accessToken: string
  idToken?: string
  refreshToken?: string
}

export async function refreshCodexOAuthTokens(
  refreshToken: string
): Promise<RefreshedCodexOAuthTokens> {
  const tokenEndpoint = new URL("/oauth/token", codexOAuthIssuer())
  const body = new URLSearchParams({
    client_id: codexOAuthClientId(),
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  })

  const response = await fetch(tokenEndpoint, {
    body,
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    method: "POST",
  })

  if (!response.ok) {
    throw new Error(`Token refresh failed with status ${response.status}.`)
  }

  const data = (await response.json()) as {
    access_token?: unknown
    id_token?: unknown
    refresh_token?: unknown
  }

  if (typeof data.access_token !== "string") {
    throw new Error("Token refresh response did not include access_token.")
  }

  return {
    accessToken: data.access_token,
    idToken: typeof data.id_token === "string" ? data.id_token : undefined,
    refreshToken:
      typeof data.refresh_token === "string" ? data.refresh_token : undefined,
  }
}

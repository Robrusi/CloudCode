const DEFAULT_ISSUER = "https://auth.openai.com"
const DEFAULT_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann"

export function codexOAuthClientId() {
  return process.env.OPENAI_CODEX_CLIENT_ID ?? DEFAULT_CLIENT_ID
}

export function codexOAuthIssuer() {
  return process.env.OPENAI_CODEX_ISSUER ?? DEFAULT_ISSUER
}

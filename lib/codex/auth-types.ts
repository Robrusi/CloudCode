const DEFAULT_CODEX_PROFILE = "default"

export type CodexAuthAccountStatus = {
  accountEmail?: string
  accountId?: string | null
  accountName?: string
  authMode: "chatgpt"
  displayName?: string
  exists: true
  fingerprint: string
  lastRefresh: string
  profile: string
  updatedAt: string
}

export type CodexAuthOverview = {
  accountEmail?: string
  accountId?: string | null
  accountName?: string
  accounts: CodexAuthAccountStatus[]
  activeProfile: string
  authMode?: "chatgpt"
  displayName?: string
  exists: boolean
  fingerprint?: string
  lastRefresh?: string
  profile: string
  updatedAt?: string
}

export function normalizeCodexProfile(profile?: string) {
  const normalized = profile?.trim() || DEFAULT_CODEX_PROFILE

  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(normalized)) {
    throw new Error(
      "Profile must use only letters, numbers, underscores, or hyphens."
    )
  }

  return normalized
}

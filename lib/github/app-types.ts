export type GitHubDisconnectResult = {
  deletedInstallations: number
  deletedUserAuth: boolean
  revokedGrant: boolean
  revokeError?: string
}

export type StoredGitHubAppInstallation = {
  accountId?: string
  accountLogin: string
  accountType?: string
  htmlUrl?: string
  installationId: string
  repositorySelection?: string
  updatedAt: string
}

export type StoredGitHubAppUser = {
  connected: true
  email?: string
  fingerprint: string
  githubUserId: string
  login: string
  name?: string
  updatedAt: string
}

export type GitHubAppUserStatus = { connected: false } | StoredGitHubAppUser

export type GitHubAppUserAuth = StoredGitHubAppUser & {
  expiresAt?: string
  refreshToken?: string
  refreshTokenExpiresAt?: string
  token: string
}

export type GitHubAppRepository = {
  cloneUrl: string
  defaultBranch?: string
  fullName: string
  htmlUrl: string
  id: string
  installationId: string
  name: string
  ownerLogin: string
  ownerType?: string
  private: boolean
}

export type GitHubAppOrganization = {
  avatarUrl?: string
  description?: string
  id: string
  login: string
}

export type GitHubAppAccount = {
  accountType: "Organization" | "User"
  avatarUrl?: string
  description?: string
  htmlUrl?: string
  id: string
  installationId?: string
  installed: boolean
  login: string
  repositorySelection?: string
}

export type GitHubRepoCredential = {
  expiresAt?: string
  gitUserEmail?: string
  gitUserName?: string
  source: "app"
  token: string
  username?: string | null
}

export type GitHubAppStatus = {
  accounts: GitHubAppAccount[]
  configured: boolean
  installationConfigured: boolean
  installations: StoredGitHubAppInstallation[]
  organizationError?: string
  organizations: GitHubAppOrganization[]
  user: GitHubAppUserStatus
  userAuthConfigured: boolean
}

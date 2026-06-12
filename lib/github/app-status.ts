import {
  githubUserRequest,
  type GitHubOrganizationMembershipResponse,
  type GitHubOrganizationResponse,
} from "@/lib/github/app-client"
import type {
  GitHubAppAccount,
  GitHubAppOrganization,
  GitHubAppUserStatus,
  StoredGitHubAppInstallation,
} from "@/lib/github/app-types"
import { stringValue as optionalString } from "@/lib/shared/unknown-values"

function normalizedAccountType(value?: string) {
  return value === "Organization" ? "Organization" : "User"
}

function normalizeOrganization(
  data: GitHubOrganizationResponse
): GitHubAppOrganization | null {
  const id =
    typeof data.id === "number" || typeof data.id === "string"
      ? String(data.id)
      : undefined
  const login = optionalString(data.login)

  if (!id || !login) return null

  return {
    avatarUrl: optionalString(data.avatar_url),
    description: optionalString(data.description),
    id,
    login,
  }
}

export async function listGitHubAppUserOrganizations(token: string) {
  const organizations = new Map<string, GitHubAppOrganization>()

  try {
    for (let page = 1; ; page += 1) {
      const items = await githubUserRequest<
        GitHubOrganizationMembershipResponse[]
      >(token, `/user/memberships/orgs?state=active&per_page=100&page=${page}`)

      for (const item of items) {
        const organization = item.organization
          ? normalizeOrganization(item.organization)
          : null
        if (organization) {
          organizations.set(organization.login.toLowerCase(), organization)
        }
      }

      if (items.length < 100) break
    }

    if (organizations.size > 0) {
      return [...organizations.values()].sort((a, b) =>
        a.login.localeCompare(b.login)
      )
    }
  } catch {
    organizations.clear()
  }

  for (let page = 1; ; page += 1) {
    const items = await githubUserRequest<GitHubOrganizationResponse[]>(
      token,
      `/user/orgs?per_page=100&page=${page}`
    )

    for (const item of items) {
      const organization = normalizeOrganization(item)
      if (organization) {
        organizations.set(organization.login.toLowerCase(), organization)
      }
    }

    if (items.length < 100) break
  }

  return [...organizations.values()].sort((a, b) =>
    a.login.localeCompare(b.login)
  )
}

export function buildGitHubAppAccounts({
  installations,
  organizations,
  user,
}: {
  installations: StoredGitHubAppInstallation[]
  organizations: GitHubAppOrganization[]
  user: GitHubAppUserStatus
}) {
  const accounts = new Map<string, GitHubAppAccount>()

  if (user.connected) {
    accounts.set(`user:${user.login.toLowerCase()}`, {
      accountType: "User",
      id: user.githubUserId,
      installed: false,
      login: user.login,
    })
  }

  for (const organization of organizations) {
    accounts.set(`organization:${organization.login.toLowerCase()}`, {
      accountType: "Organization",
      avatarUrl: organization.avatarUrl,
      description: organization.description,
      id: organization.id,
      installed: false,
      login: organization.login,
    })
  }

  for (const installation of installations) {
    const accountType = normalizedAccountType(installation.accountType)
    const key = `${accountType.toLowerCase()}:${installation.accountLogin.toLowerCase()}`
    const existing = accounts.get(key)

    accounts.set(key, {
      ...existing,
      accountType,
      id: installation.accountId ?? existing?.id ?? installation.accountLogin,
      htmlUrl: installation.htmlUrl ?? existing?.htmlUrl,
      installed: true,
      installationId: installation.installationId,
      login: installation.accountLogin,
      repositorySelection: installation.repositorySelection,
    })
  }

  return [...accounts.values()].sort((a, b) => {
    if (a.accountType !== b.accountType) {
      return a.accountType === "User" ? -1 : 1
    }

    return a.login.localeCompare(b.login)
  })
}

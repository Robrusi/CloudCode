"use client"

import { AccountRow } from "@/components/settings/account-row"
import { ChatGPTConnectionRow } from "@/components/settings/chatgpt-connection"
import { GitHubConnectionRow } from "@/components/settings/github-connection"
import { SettingsPage } from "@/components/settings/shared"
import type { CodexAuthOverview } from "@/lib/codex/auth-types"
import type { GitHubAuthStatus } from "@/lib/github/auth"

export function ConnectionsSettings({
  authStatus,
  authError,
  githubStatus,
  githubAuthError,
  onCodexAuthChanged,
  onGitHubAuthChanged,
}: {
  authStatus: CodexAuthOverview | null
  authError: string
  githubStatus: GitHubAuthStatus | null
  githubAuthError: string
  onCodexAuthChanged: () => void | Promise<void>
  onGitHubAuthChanged: () => void | Promise<void>
}) {
  return (
    <SettingsPage
      title="Connections"
      description="Sign in with ChatGPT and connect GitHub to authorize Codex runs and repository access."
    >
      <div className="divide-y divide-border/60">
        <div className="pb-7">
          <ChatGPTConnectionRow
            status={authStatus}
            authError={authError}
            onCodexAuthChanged={onCodexAuthChanged}
          />
        </div>
        <div className="py-7">
          <GitHubConnectionRow
            status={githubStatus}
            error={githubAuthError}
            onGitHubAuthChanged={onGitHubAuthChanged}
          />
        </div>
        <div className="pt-7">
          <AccountRow />
        </div>
      </div>
    </SettingsPage>
  )
}

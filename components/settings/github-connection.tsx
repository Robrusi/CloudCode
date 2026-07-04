"use client"

import { CornerDownRight } from "lucide-react"
import { useState } from "react"

import { statusBadge, statusIdle, statusOk } from "@/components/settings/shared"
import { GitHubIcon } from "@/components/ui/brand-icons"
import { Button } from "@/components/ui/button"
import { buttonVariants } from "@/components/ui/button-variants"
import { fetchJson } from "@/lib/http/client-json"
import type { GitHubAuthStatus } from "@/lib/github/auth"
import { cn } from "@/lib/shared/utils"

export function GitHubConnectionRow({
  status,
  error,
  onGitHubAuthChanged,
}: {
  status: GitHubAuthStatus | null
  error: string
  onGitHubAuthChanged: () => void | Promise<void>
}) {
  const [disconnecting, setDisconnecting] = useState(false)
  const [disconnectError, setDisconnectError] = useState("")
  const accounts = status?.app?.accounts ?? []
  const installations = status?.app?.installations ?? []
  const user = status?.app?.user
  const userReady = Boolean(user?.connected)
  const appReady = installations.length > 0
  const visibleError =
    disconnectError || error || status?.app?.organizationError

  async function disconnect() {
    if (
      !window.confirm(
        "Disconnect GitHub from this Cloudcode account? This revokes the GitHub authorization and removes saved installations from Cloudcode."
      )
    ) {
      return
    }

    setDisconnecting(true)
    setDisconnectError("")
    try {
      const data = await fetchJson<{ revokeError?: string }>(
        "/api/github/auth",
        { method: "DELETE" },
        { fallbackError: "Unable to disconnect GitHub." }
      )
      if (data?.revokeError) {
        setDisconnectError(
          `Removed locally. GitHub revocation warning: ${data.revokeError}`
        )
      }
      await onGitHubAuthChanged()
    } catch (err) {
      setDisconnectError(
        err instanceof Error ? err.message : "Unable to disconnect GitHub."
      )
    } finally {
      setDisconnecting(false)
    }
  }

  return (
    <div>
      <div className="flex items-center gap-3">
        <GitHubIcon className="size-5 shrink-0 text-foreground/80" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-foreground">GitHub</div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {!userReady ? (
            <form
              action={
                appReady
                  ? "/api/github/app/oauth/login"
                  : "/api/github/app/install"
              }
              method="get"
            >
              {appReady ? (
                <input type="hidden" name="next" value="settings" />
              ) : null}
              <Button type="submit" size="sm" disabled={disconnecting}>
                {appReady ? "Authenticate" : "Connect GitHub"}
              </Button>
            </form>
          ) : null}
          {userReady ? (
            <form action="/api/github/app/install" method="get">
              <input type="hidden" name="intent" value="add-org" />
              <Button
                type="submit"
                variant="ghost"
                size="sm"
                disabled={disconnecting}
                className="text-muted-foreground"
              >
                Add org
              </Button>
            </form>
          ) : null}
          {userReady ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={disconnecting}
              onClick={disconnect}
              className="text-muted-foreground hover:text-destructive"
            >
              {disconnecting ? "Disconnecting" : "Disconnect"}
            </Button>
          ) : null}
        </div>
      </div>

      {visibleError ? (
        <div className="mt-2 text-[11px] leading-4 text-destructive">
          {visibleError}
        </div>
      ) : null}

      {userReady && accounts.length > 0 ? (
        <div className="mt-3 space-y-0.5">
          {accounts.map((account) => {
            const targetId = /^\d+$/.test(account.id) ? account.id : undefined

            return (
              <div
                key={`${account.accountType}:${account.login}`}
                className="flex items-center gap-2.5 rounded-xl px-2.5 py-2 transition-colors hover:bg-muted/60"
              >
                <span
                  aria-hidden
                  className="grid size-4 shrink-0 place-items-center text-muted-foreground/70"
                >
                  <CornerDownRight className="size-3.5" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-foreground">
                    @{account.login}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {account.accountType === "User"
                      ? "Personal account"
                      : "Organization"}
                  </div>
                </div>
                <span
                  className={cn(
                    statusBadge,
                    account.installed ? statusOk : statusIdle
                  )}
                >
                  {account.installed ? "Connected" : "Not connected"}
                </span>
                <form action="/api/github/app/install" method="get">
                  {targetId ? (
                    <input type="hidden" name="targetId" value={targetId} />
                  ) : null}
                  <Button
                    type="submit"
                    variant="ghost"
                    size="sm"
                    disabled={disconnecting}
                    className="text-muted-foreground"
                  >
                    {account.installed ? "Update repos" : "Select repos"}
                  </Button>
                </form>
                {account.installed && account.htmlUrl ? (
                  <a
                    href={account.htmlUrl}
                    target="_blank"
                    rel="noreferrer"
                    className={cn(
                      buttonVariants({ variant: "ghost", size: "sm" }),
                      "text-muted-foreground hover:text-destructive",
                      disconnecting && "pointer-events-none opacity-50"
                    )}
                  >
                    Remove
                  </a>
                ) : null}
              </div>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}

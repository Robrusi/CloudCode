"use client"

import { Check } from "lucide-react"

import { GitHubIcon, OpenAIIcon } from "@/components/ui/brand-icons"
import { Button } from "@/components/ui/button"
import { cardSurfaceClass } from "@/components/ui/surface"
import { cn } from "@/lib/shared/utils"

function StepRow({
  icon,
  title,
  description,
  done,
  action,
}: {
  icon: React.ReactNode
  title: string
  description: string
  done: boolean
  action?: React.ReactNode
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-3 px-4 py-3.5 sm:px-5",
        done && "opacity-70"
      )}
    >
      {icon}
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-foreground">{title}</div>
        <div className="mt-0.5 text-xs leading-5 text-muted-foreground">
          {description}
        </div>
      </div>
      {done ? (
        <span className="inline-flex shrink-0 items-center gap-1.5 text-xs font-medium text-success">
          <Check className="size-3.5" />
          Connected
        </span>
      ) : (
        action
      )}
    </div>
  )
}

export function OnboardingChecklist({
  codexConnected,
  githubAppReady,
  githubConnected,
  githubUserReady,
  onDismiss,
}: {
  codexConnected: boolean
  githubAppReady: boolean
  githubConnected: boolean
  githubUserReady: boolean
  onDismiss: () => void
}) {
  const doneCount = [codexConnected, githubConnected].filter(Boolean).length
  // The GitHub App install and the user OAuth grant are separate steps; send
  // the user to whichever half is still missing.
  const githubActionUrl =
    githubAppReady && !githubUserReady
      ? "/api/github/app/oauth/login"
      : "/api/github/app/install"

  return (
    <div className={cn("w-full max-w-xl overflow-hidden", cardSurfaceClass)}>
      <div className="flex items-center justify-between gap-3 px-4 py-3 sm:px-5">
        <div className="min-w-0">
          <div className="text-sm font-medium text-foreground">
            Connect your accounts
          </div>
          <div className="mt-0.5 text-xs leading-5 text-muted-foreground">
            {doneCount} of 2 complete · Codex runs in a cloud sandbox and pushes
            branches to your repos.
          </div>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="text-muted-foreground hover:text-foreground"
          onClick={onDismiss}
        >
          Skip
        </Button>
      </div>
      <div className="divide-y divide-border/60 border-t border-border/60">
        <StepRow
          icon={<OpenAIIcon className="size-5 shrink-0 text-foreground/80" />}
          title="Connect ChatGPT"
          description="Codex runs are authorized with your ChatGPT account."
          done={codexConnected}
          action={
            <form action="/api/codex-auth/login" method="get">
              <Button type="submit" size="sm">
                Connect
              </Button>
            </form>
          }
        />
        <StepRow
          icon={<GitHubIcon className="size-5 shrink-0 text-foreground/80" />}
          title="Connect GitHub"
          description="Choose the repositories Codex can read and push to."
          done={githubConnected}
          action={
            <form action={githubActionUrl} method="get">
              <Button type="submit" size="sm">
                {githubAppReady && !githubUserReady
                  ? "Authenticate"
                  : "Connect"}
              </Button>
            </form>
          }
        />
      </div>
    </div>
  )
}

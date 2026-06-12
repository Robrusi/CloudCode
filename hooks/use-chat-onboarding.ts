"use client"

import { useCallback, useEffect } from "react"

import type { AuthStatus } from "@/lib/codex/auth"
import type { GitHubAuthStatus } from "@/lib/github/auth"

type ViewerOnboardingState =
  | {
      onboardingDismissedAt?: number
    }
  | null
  | undefined

export function useChatOnboarding({
  authStatus,
  dismissOnboarding,
  githubStatus,
  viewer,
}: {
  authStatus: AuthStatus | null
  dismissOnboarding: () => Promise<unknown> | unknown
  githubStatus: GitHubAuthStatus | null
  viewer: ViewerOnboardingState
}) {
  const codexConnected = Boolean(
    authStatus && (authStatus.exists || authStatus.accounts.length > 0)
  )
  const githubUserReady = Boolean(githubStatus?.app?.user.connected)
  const githubAppReady = (githubStatus?.app?.installations.length ?? 0) > 0
  const githubConnected = Boolean(githubStatus?.connected)
  const statusReady = authStatus !== null && githubStatus !== null
  const complete = codexConnected && githubConnected
  const show = Boolean(
    viewer && !viewer.onboardingDismissedAt && statusReady && !complete
  )

  const dismiss = useCallback(() => {
    void Promise.resolve(dismissOnboarding()).catch((error) => {
      console.warn("Unable to dismiss onboarding.", error)
    })
  }, [dismissOnboarding])

  useEffect(() => {
    if (!viewer || viewer.onboardingDismissedAt) return
    if (!statusReady || !complete) return
    dismiss()
  }, [complete, dismiss, statusReady, viewer])

  return {
    codexConnected,
    dismissOnboarding: dismiss,
    githubAppReady,
    githubConnected,
    githubUserReady,
    showOnboarding: show,
  }
}

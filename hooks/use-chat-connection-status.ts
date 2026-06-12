"use client"

import { useCallback, useEffect, useState } from "react"

import { fetchJson } from "@/lib/http/client-json"
import type { AuthStatus } from "@/lib/codex/auth"
import type { GitHubAuthStatus } from "@/lib/github/auth"

export function useChatConnectionStatus(userLoading: boolean) {
  const [authStatus, setAuthStatus] = useState<AuthStatus | null>(null)
  const [authError, setAuthError] = useState("")
  const [githubStatus, setGithubStatus] = useState<GitHubAuthStatus | null>(
    null
  )
  const [githubAuthError, setGithubAuthError] = useState("")

  const refreshGitHubAuth = useCallback(async () => {
    try {
      const data = await fetchJson<GitHubAuthStatus>(
        "/api/github/auth",
        {},
        { fallbackError: "Unable to read GitHub auth status." }
      )

      setGithubStatus(data)
      setGithubAuthError("")
    } catch (err) {
      setGithubStatus(null)
      setGithubAuthError(
        err instanceof Error
          ? err.message
          : "Unable to read GitHub auth status."
      )
    }
  }, [])

  const refreshCodexAuth = useCallback(async () => {
    try {
      const data = await fetchJson<AuthStatus>(
        "/api/codex-auth",
        {},
        { fallbackError: "Unable to read auth status." }
      )

      setAuthStatus(data)
      setAuthError("")
    } catch (err) {
      setAuthStatus(null)
      setAuthError(
        err instanceof Error ? err.message : "Unable to read auth status."
      )
    }
  }, [])

  useEffect(() => {
    if (userLoading) return

    function refreshConnections() {
      void Promise.all([refreshCodexAuth(), refreshGitHubAuth()])
    }

    refreshConnections()
    window.addEventListener("focus", refreshConnections)
    return () => window.removeEventListener("focus", refreshConnections)
  }, [refreshCodexAuth, refreshGitHubAuth, userLoading])

  return {
    authError,
    authStatus,
    githubAuthError,
    githubStatus,
    refreshCodexAuth,
    refreshGitHubAuth,
  }
}

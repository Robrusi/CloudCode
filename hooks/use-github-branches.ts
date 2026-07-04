"use client"

import { useCallback, useEffect, useRef, useState } from "react"

import {
  getCachedBranches,
  loadBranches,
  prefetchBranches,
} from "@/lib/github/github-options-cache"

const EMPTY = { branches: [] as string[], defaultBranch: undefined }

/**
 * Branch picker data for a given repo. Prefetches whenever the repo changes so
 * branches are usually cached before the user opens the picker, then serves
 * cache instantly (revalidating in the background) when `ensureLoaded` runs.
 */
export function useGitHubBranches(repoUrl?: string): {
  branches: string[]
  defaultBranch?: string
  loading: boolean
  error: string
  ensureLoaded: () => void
} {
  const repo = repoUrl?.trim() ?? ""
  const [state, setState] = useState<{
    branches: string[]
    defaultBranch?: string
  }>(() => getCachedBranches(repo) ?? EMPTY)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  useEffect(() => {
    setError("")
    setState(getCachedBranches(repo) ?? EMPTY)
    if (repo) prefetchBranches(repo)
  }, [repo])

  const ensureLoaded = useCallback(() => {
    if (!repo) return
    const cached = getCachedBranches(repo)
    if (cached) setState(cached)
    setLoading(cached == null)
    setError("")
    loadBranches(repo)
      .then((data) => {
        if (mountedRef.current) setState(data)
      })
      .catch((err) => {
        if (mountedRef.current) {
          setError(
            err instanceof Error ? err.message : "Unable to load branches."
          )
        }
      })
      .finally(() => {
        if (mountedRef.current) setLoading(false)
      })
  }, [repo])

  return {
    branches: state.branches,
    defaultBranch: state.defaultBranch,
    loading,
    error,
    ensureLoaded,
  }
}

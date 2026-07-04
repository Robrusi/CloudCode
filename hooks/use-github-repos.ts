"use client"

import { useCallback, useEffect, useRef, useState } from "react"

import {
  getCachedRepos,
  loadRepos,
  prefetchRepos,
  type GitHubRepoOption,
} from "@/lib/github/github-options-cache"

/**
 * Repo picker data. Prefetches on mount so the list is usually cached before the
 * user opens the picker, then serves cache instantly (revalidating in the
 * background) when `ensureLoaded` runs.
 */
export function useGitHubRepos(): {
  repos: GitHubRepoOption[]
  loading: boolean
  error: string
  ensureLoaded: () => void
} {
  const [repos, setRepos] = useState<GitHubRepoOption[]>(
    () => getCachedRepos() ?? []
  )
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    prefetchRepos()
    return () => {
      mountedRef.current = false
    }
  }, [])

  const ensureLoaded = useCallback(() => {
    const cached = getCachedRepos()
    if (cached) setRepos(cached)
    setLoading(cached == null)
    setError("")
    loadRepos()
      .then((data) => {
        if (mountedRef.current) setRepos(data)
      })
      .catch((err) => {
        if (mountedRef.current) {
          setError(
            err instanceof Error ? err.message : "Unable to load repositories."
          )
        }
      })
      .finally(() => {
        if (mountedRef.current) setLoading(false)
      })
  }, [])

  return { repos, loading, error, ensureLoaded }
}

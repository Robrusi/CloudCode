"use client"

import { fetchJson } from "@/lib/http/client-json"

/**
 * Client-side cache for the GitHub repo and branch pickers.
 *
 * The `/api/github/*` routes are slow (live installation sync + full
 * pagination) and send `cache: "no-store"`, so opening a picker used to block
 * on a fresh round trip every time. This module keeps results in memory with
 * in-flight de-duplication and stale-while-revalidate semantics so a picker can
 * render instantly from cache while it refreshes in the background, and lets the
 * composer prefetch on mount so the data is usually ready before the first open.
 */

export type GitHubRepoOption = {
  cloneUrl: string
  fullName: string
  private: boolean
}

export type GitHubBranchOptions = {
  branches: string[]
  defaultBranch?: string
}

const TTL_MS = 60_000

type CacheEntry<T> = { at: number; data: T }

/** A single cached value with in-flight de-dup and TTL-based freshness. */
class OptionsCache<T> {
  private entry: CacheEntry<T> | null = null
  private inFlight: Promise<T> | null = null

  constructor(
    private readonly loader: () => Promise<T>,
    private readonly ttlMs = TTL_MS
  ) {}

  getCached(): T | null {
    return this.entry?.data ?? null
  }

  private isFresh(): boolean {
    return this.entry != null && Date.now() - this.entry.at < this.ttlMs
  }

  /** Resolve from a fresh cache, join an in-flight load, or start a new one. */
  load(force = false): Promise<T> {
    if (!force && this.isFresh() && this.entry) {
      return Promise.resolve(this.entry.data)
    }
    if (this.inFlight) return this.inFlight

    this.inFlight = this.loader()
      .then((data) => {
        this.entry = { at: Date.now(), data }
        return data
      })
      .finally(() => {
        this.inFlight = null
      })
    return this.inFlight
  }

  /** Warm the cache in the background; never throws. */
  prefetch(): void {
    if (this.isFresh() || this.inFlight) return
    void this.load().catch(() => {})
  }
}

const reposCache = new OptionsCache<GitHubRepoOption[]>(async () => {
  const data = await fetchJson<{ repositories?: GitHubRepoOption[] }>(
    "/api/github/repos",
    {},
    { fallbackError: "Unable to load repositories." }
  )
  return data.repositories ?? []
})

export function loadRepos(force = false): Promise<GitHubRepoOption[]> {
  return reposCache.load(force)
}

export function prefetchRepos(): void {
  reposCache.prefetch()
}

export function getCachedRepos(): GitHubRepoOption[] | null {
  return reposCache.getCached()
}

const branchCaches = new Map<string, OptionsCache<GitHubBranchOptions>>()

function branchCacheFor(repoUrl: string): OptionsCache<GitHubBranchOptions> {
  const existing = branchCaches.get(repoUrl)
  if (existing) return existing

  const cache = new OptionsCache<GitHubBranchOptions>(async () => {
    const data = await fetchJson<{
      branches?: string[]
      defaultBranch?: string
    }>(
      `/api/github/branches?repoUrl=${encodeURIComponent(repoUrl)}`,
      {},
      { fallbackError: "Unable to load branches." }
    )
    return { branches: data.branches ?? [], defaultBranch: data.defaultBranch }
  })
  branchCaches.set(repoUrl, cache)
  return cache
}

export function loadBranches(
  repoUrl: string,
  force = false
): Promise<GitHubBranchOptions> {
  return branchCacheFor(repoUrl.trim()).load(force)
}

export function prefetchBranches(repoUrl: string): void {
  const repo = repoUrl.trim()
  if (repo) branchCacheFor(repo).prefetch()
}

export function getCachedBranches(repoUrl: string): GitHubBranchOptions | null {
  return branchCaches.get(repoUrl.trim())?.getCached() ?? null
}

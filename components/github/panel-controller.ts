"use client"

import { useCallback, useEffect, useReducer, useRef } from "react"

import type {
  GithubPanelBusyKind,
  GithubPanelTab,
  GithubPrResponse,
} from "@/components/github/panel-types"
import { fetchJson, postJson as postJsonRequest } from "@/lib/http/client-json"
import type {
  CreatePullRequestResult,
  MergeMethod,
} from "@/lib/github/pull-requests"
import type { SandboxGitOverview } from "@/lib/sandbox/git"

type GithubPanelState = {
  actionError: string | null
  busy: GithubPanelBusyKind
  commitMessage: string
  compareUrl: string | null
  deleteBranchOnMerge: boolean
  loading: boolean
  mergeMethod: MergeMethod | null
  overview: SandboxGitOverview | null
  overviewDetailsReady: boolean
  overviewError: string | null
  prBody: string
  prData: GithubPrResponse | null
  prDraft: boolean
  prTitle: string
  showCreateForm: boolean
  tab: GithubPanelTab
}

type GithubPanelAction =
  | { type: "action-error"; error: string }
  | { type: "action-finish" }
  | { type: "action-start"; busy: Exclude<GithubPanelBusyKind, null> }
  | { type: "close-create-form" }
  | { type: "commit-message"; value: string }
  | { type: "compare-url"; url: string | null }
  | { type: "delete-branch-on-merge"; value: boolean }
  | {
      type: "hydrate"
      overview: SandboxGitOverview | null
      overviewDetailsReady: boolean
      prData: GithubPrResponse | null
    }
  | { type: "loading"; value: boolean }
  | { type: "merge-method"; method: MergeMethod }
  | { type: "open-create-form"; title: string }
  | { type: "overview-error"; error: string }
  | {
      type: "overview-success"
      detailsReady: boolean
      overview: SandboxGitOverview
    }
  | { type: "pr-body"; value: string }
  | { type: "pr-data"; data: GithubPrResponse }
  | { type: "pr-draft"; value: boolean }
  | { type: "pr-title"; value: string }
  | { type: "reset-commit-message" }
  | { type: "tab"; tab: GithubPanelTab }

const initialGithubPanelState: GithubPanelState = {
  actionError: null,
  busy: null,
  commitMessage: "",
  compareUrl: null,
  deleteBranchOnMerge: false,
  loading: false,
  mergeMethod: null,
  overview: null,
  overviewDetailsReady: false,
  overviewError: null,
  prBody: "",
  prData: null,
  prDraft: false,
  prTitle: "",
  showCreateForm: false,
  tab: "changes",
}

function githubPanelReducer(
  state: GithubPanelState,
  action: GithubPanelAction
): GithubPanelState {
  switch (action.type) {
    case "action-error":
      return { ...state, actionError: action.error }
    case "action-finish":
      return { ...state, busy: null }
    case "action-start":
      return { ...state, actionError: null, busy: action.busy }
    case "close-create-form":
      return { ...state, showCreateForm: false }
    case "commit-message":
      return { ...state, commitMessage: action.value }
    case "compare-url":
      return { ...state, compareUrl: action.url }
    case "delete-branch-on-merge":
      return { ...state, deleteBranchOnMerge: action.value }
    case "hydrate":
      return {
        ...initialGithubPanelState,
        overview: action.overview,
        overviewDetailsReady: action.overviewDetailsReady,
        prData: action.prData,
        tab: state.tab,
      }
    case "loading":
      return { ...state, loading: action.value }
    case "merge-method":
      return { ...state, mergeMethod: action.method }
    case "open-create-form":
      return {
        ...state,
        compareUrl: null,
        prBody: "",
        prDraft: false,
        prTitle: action.title,
        showCreateForm: true,
      }
    case "overview-error":
      return { ...state, overviewError: action.error }
    case "overview-success":
      return {
        ...state,
        overview: action.overview,
        overviewDetailsReady: action.detailsReady,
        overviewError: null,
      }
    case "pr-body":
      return { ...state, prBody: action.value }
    case "pr-data":
      return { ...state, prData: mergePrData(state.prData, action.data) }
    case "pr-draft":
      return { ...state, prDraft: action.value }
    case "pr-title":
      return { ...state, prTitle: action.value }
    case "reset-commit-message":
      return { ...state, commitMessage: "" }
    case "tab":
      return { ...state, tab: action.tab }
  }
}

const POLL_INTERVAL_MS = 8000
const PREFETCH_STALE_MS = 60_000
const STORAGE_KEY = "cloudcode:githubPanel:v2"
const STORAGE_MAX_ENTRIES = 5

type PanelCacheEntry = {
  at: number
  overview: SandboxGitOverview | null
  overviewDetailsReady: boolean
  prData: GithubPrResponse | null
}

// Cached panel data paints instantly on remount (thread or sandbox switch)
// and revalidates in the background; localStorage carries it across reloads.
const memCache = new Map<string, PanelCacheEntry>()

function readStore(): Record<string, PanelCacheEntry> {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : null
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, PanelCacheEntry>)
      : {}
  } catch {
    return {}
  }
}

function getCache(sandboxId: string): PanelCacheEntry | null {
  const cached = memCache.get(sandboxId)
  if (cached) return cached
  const stored = readStore()[sandboxId]
  if (stored) memCache.set(sandboxId, stored)
  return stored ?? null
}

function storageSafeOverview(
  overview: SandboxGitOverview | null
): SandboxGitOverview | null {
  if (!overview) return null
  return { ...overview, baseDiff: null, log: null }
}

function storageSafePrData(
  data: GithubPrResponse | null
): GithubPrResponse | null {
  if (!data) return null
  return {
    allowedMergeMethods: [],
    branch: data.branch,
    connected: data.connected,
    detailsReady: false,
    prs: data.prs.map((pr) => ({
      ...pr,
      checks: null,
      mergeable: null,
      mergeableState: null,
      reviews: null,
    })),
  }
}

function putCache(sandboxId: string, patch: Partial<PanelCacheEntry>) {
  const entry: PanelCacheEntry = {
    at: Date.now(),
    overview: null,
    overviewDetailsReady: false,
    prData: null,
    ...getCache(sandboxId),
    ...patch,
  }
  memCache.set(sandboxId, entry)
  try {
    const storageEntry: PanelCacheEntry = {
      ...entry,
      overview: storageSafeOverview(entry.overview),
      overviewDetailsReady: false,
      prData: storageSafePrData(entry.prData),
    }
    const store = { ...readStore(), [sandboxId]: storageEntry }
    const keep = Object.entries(store)
      .sort((a, b) => b[1].at - a[1].at)
      .slice(0, STORAGE_MAX_ENTRIES)
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(Object.fromEntries(keep))
    )
  } catch {
    // Storage full or unavailable; the in-memory cache still applies.
  }
}

function samePrDataIdentity(current: GithubPrResponse, next: GithubPrResponse) {
  if (
    current.branch !== next.branch ||
    current.connected !== next.connected ||
    current.prs.length !== next.prs.length
  ) {
    return false
  }
  return next.prs.every((entry, index) => {
    const currentEntry = current.prs[index]
    return (
      currentEntry?.number === entry.number &&
      currentEntry.headSha === entry.headSha &&
      currentEntry.state === entry.state &&
      currentEntry.merged === entry.merged
    )
  })
}

function mergePrData(
  current: GithubPrResponse | null,
  next: GithubPrResponse
): GithubPrResponse {
  if (next.detailsReady || !current?.detailsReady) return next
  if (!samePrDataIdentity(current, next)) return next

  return {
    ...next,
    allowedMergeMethods: current.allowedMergeMethods,
    detailsReady: true,
    prs: next.prs.map((entry) => {
      const currentEntry = current.prs.find((pr) => pr.number === entry.number)
      if (!currentEntry || currentEntry.headSha !== entry.headSha) return entry
      return {
        ...entry,
        checks: currentEntry.checks,
        mergeable: currentEntry.mergeable,
        mergeableState: currentEntry.mergeableState,
        reviews: currentEntry.reviews,
      }
    }),
  }
}

function defaultPrTitle(branch: string | null) {
  if (!branch) return ""
  const last = branch.split("/").pop() ?? branch
  const words = last.replace(/[-_]+/g, " ").trim()
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : ""
}

export function useGithubPanelController({
  baseBranch,
  githubConnected,
  open,
  sandboxId,
}: {
  baseBranch: string
  githubConnected: boolean
  open: boolean
  sandboxId: string | null
}) {
  const [state, dispatch] = useReducer(githubPanelReducer, sandboxId, (id) => {
    const cached = id ? getCache(id) : null
    return {
      ...initialGithubPanelState,
      overview: cached?.overview ?? null,
      overviewDetailsReady: cached?.overviewDetailsReady ?? false,
      prData: cached?.prData ?? null,
    }
  })
  const {
    actionError,
    busy,
    commitMessage,
    compareUrl,
    deleteBranchOnMerge,
    loading,
    mergeMethod,
    overview,
    overviewDetailsReady,
    overviewError,
    prBody,
    prData,
    prDraft,
    prTitle,
    showCreateForm,
    tab,
  } = state

  const busyRef = useRef<GithubPanelBusyKind>(null)
  busyRef.current = busy

  // On sandbox switch, drop the previous sandbox's data immediately so it is
  // never shown against the wrong workspace; start from that sandbox's cache.
  const sandboxRef = useRef(sandboxId)
  useEffect(() => {
    if (sandboxRef.current === sandboxId) return
    sandboxRef.current = sandboxId
    const cached = sandboxId ? getCache(sandboxId) : null
    dispatch({
      type: "hydrate",
      overview: cached?.overview ?? null,
      overviewDetailsReady: cached?.overviewDetailsReady ?? false,
      prData: cached?.prData ?? null,
    })
  }, [sandboxId])

  const status = overview?.status ?? null
  const log = overview?.log ?? null
  const baseDiff = overview?.baseDiff ?? null
  const connected = prData?.connected ?? githubConnected
  const files = status?.files ?? []
  const prs = prData?.prs ?? []
  const branch = status?.branch ?? prData?.branch ?? null
  const upstream = status?.upstream ?? null
  const hasChanges = files.length > 0
  const prDetailsReady = prData?.detailsReady === true
  const openPrs = prs.filter((entry) => entry.state === "open" && !entry.merged)

  const loadOverview = useCallback(
    async (detailsReady: boolean, signal?: AbortSignal) => {
      if (!sandboxId) return
      try {
        const params = new URLSearchParams({
          base: baseBranch,
          sandboxId,
        })
        if (detailsReady) params.set("details", "1")
        const overview = await fetchJson<SandboxGitOverview>(
          `/api/sandbox/git/overview?${params}`,
          { signal },
          { fallbackError: "Failed to load git status." }
        )
        putCache(sandboxId, { overview, overviewDetailsReady: detailsReady })
        dispatch({ type: "overview-success", detailsReady, overview })
      } catch (error) {
        if (signal?.aborted) return
        dispatch({
          type: "overview-error",
          error:
            error instanceof Error
              ? error.message
              : "Failed to load git status.",
        })
      }
    },
    [baseBranch, sandboxId]
  )

  const loadPr = useCallback(
    async ({
      branchHint,
      detailsReady = false,
      signal,
    }: {
      branchHint?: string | null
      detailsReady?: boolean
      signal?: AbortSignal
    } = {}) => {
      if (!sandboxId) return
      try {
        const params = new URLSearchParams({ sandboxId })
        if (detailsReady) params.set("details", "1")
        if (detailsReady && branchHint) params.set("branch", branchHint)
        const data = await fetchJson<GithubPrResponse>(
          `/api/sandbox/git/pr?${params}`,
          { signal },
          { fallbackError: "Failed to load pull request." }
        )
        const merged = mergePrData(getCache(sandboxId)?.prData ?? null, data)
        putCache(sandboxId, { prData: merged })
        dispatch({ type: "pr-data", data: merged })
      } catch {
        if (signal?.aborted) return
      }
    },
    [sandboxId]
  )

  const refresh = useCallback(
    async (signal?: AbortSignal) => {
      dispatch({ type: "loading", value: true })
      await Promise.all([loadOverview(false, signal), loadPr({ signal })])
      if (!signal?.aborted) dispatch({ type: "loading", value: false })
    },
    [loadOverview, loadPr]
  )

  // The panel component stays mounted while closed, so data is prefetched as
  // soon as the sandbox is known — opening the panel is then instant. While
  // closed, a fresh cache is left alone; opening always revalidates.
  useEffect(() => {
    if (!sandboxId) return
    if (!open) {
      const cached = getCache(sandboxId)
      if (cached && Date.now() - cached.at < PREFETCH_STALE_MS) return
    }
    const controller = new AbortController()
    void refresh(controller.signal)
    return () => controller.abort()
  }, [open, sandboxId, refresh])

  useEffect(() => {
    if (!open || !sandboxId) return

    const needsOverviewDetails =
      !overviewDetailsReady && (tab === "changes" || tab === "commits")
    const needsPrDetails = openPrs.length > 0 && !prDetailsReady
    if (!needsOverviewDetails && !needsPrDetails) return

    const controller = new AbortController()
    const jobs: Array<Promise<void>> = []
    if (needsOverviewDetails) {
      jobs.push(loadOverview(true, controller.signal))
    }
    if (needsPrDetails) {
      jobs.push(
        loadPr({
          branchHint: branch,
          detailsReady: true,
          signal: controller.signal,
        })
      )
    }
    void Promise.all(jobs)
    return () => controller.abort()
  }, [
    branch,
    loadOverview,
    loadPr,
    open,
    openPrs.length,
    overviewDetailsReady,
    prDetailsReady,
    sandboxId,
    tab,
  ])

  const shouldPoll =
    open &&
    prDetailsReady &&
    openPrs.some(
      (entry) => (entry.checks?.pending ?? 0) > 0 || entry.mergeable === null
    )

  useEffect(() => {
    if (!shouldPoll) return
    const id = window.setInterval(() => {
      if (!busyRef.current) {
        void loadPr({ branchHint: branch, detailsReady: true })
      }
    }, POLL_INTERVAL_MS)
    return () => window.clearInterval(id)
  }, [branch, shouldPoll, loadPr])

  const canCommit =
    hasChanges && commitMessage.trim().length > 0 && busy === null
  const ahead = status?.ahead ?? 0
  const hasUnpushedBranch = Boolean(
    status?.hasRepo && branch && status.sha && !upstream
  )
  const pushLabel =
    connected && (ahead > 0 || hasUnpushedBranch)
      ? ahead > 0
        ? `Push ${ahead} ${ahead === 1 ? "commit" : "commits"}`
        : "Push branch"
      : null

  const allowedMergeMethods = prData?.allowedMergeMethods ?? []
  const effectiveMergeMethod =
    mergeMethod && allowedMergeMethods.includes(mergeMethod)
      ? mergeMethod
      : (allowedMergeMethods[0] ?? "squash")

  const runAction = useCallback(
    async (
      kind: Exclude<GithubPanelBusyKind, null>,
      fn: () => Promise<void>
    ) => {
      dispatch({ type: "action-start", busy: kind })
      try {
        await fn()
        await refresh()
      } catch (error) {
        dispatch({
          type: "action-error",
          error:
            error instanceof Error ? error.message : "Something went wrong.",
        })
      } finally {
        dispatch({ type: "action-finish" })
      }
    },
    [refresh]
  )

  const postJson = useCallback(
    (path: string, payload: unknown) =>
      postJsonRequest<unknown>(
        path,
        payload,
        {},
        {
          fallbackError: "Request failed.",
        }
      ),
    []
  )

  const commit = useCallback(
    (kind: "commit" | "commit-push") =>
      runAction(kind, async () => {
        if (!sandboxId) return
        await postJson("/api/sandbox/git/commit", {
          message: commitMessage.trim(),
          sandboxId,
        })
        if (kind === "commit-push") {
          await postJson("/api/sandbox/git/push", { sandboxId })
        }
        dispatch({ type: "reset-commit-message" })
      }),
    [commitMessage, postJson, runAction, sandboxId]
  )

  const push = useCallback(
    () =>
      runAction("push", async () => {
        if (!sandboxId) return
        await postJson("/api/sandbox/git/push", { sandboxId })
      }),
    [postJson, runAction, sandboxId]
  )

  const merge = useCallback(
    (number: number) =>
      runAction("merge", async () => {
        if (!sandboxId) return
        await postJson("/api/sandbox/git/merge", {
          deleteBranch: deleteBranchOnMerge,
          method: effectiveMergeMethod,
          number,
          sandboxId,
        })
      }),
    [deleteBranchOnMerge, effectiveMergeMethod, postJson, runAction, sandboxId]
  )

  const openCreateForm = useCallback(() => {
    dispatch({ type: "open-create-form", title: defaultPrTitle(branch) })
  }, [branch])

  const createPr = useCallback(
    () =>
      runAction("create", async () => {
        if (!sandboxId) return
        await postJson("/api/sandbox/git/push", { sandboxId })
        const result = (await postJson("/api/sandbox/git/pr", {
          base: baseBranch || undefined,
          body: prBody,
          draft: prDraft,
          sandboxId,
          title: prTitle.trim(),
        })) as CreatePullRequestResult
        if (result.kind === "manual") {
          dispatch({ type: "compare-url", url: result.compareUrl })
        } else {
          dispatch({ type: "close-create-form" })
        }
      }),
    [baseBranch, postJson, prBody, prDraft, prTitle, runAction, sandboxId]
  )

  return {
    actionError,
    ahead,
    allowedMergeMethods,
    baseDiff,
    branch,
    busy,
    canCommit,
    commit,
    commitMessage,
    compareUrl,
    connected,
    createPr,
    deleteBranchOnMerge,
    effectiveMergeMethod,
    files,
    hasChanges,
    loading,
    log,
    merge,
    onCancelCreateForm: () => dispatch({ type: "close-create-form" }),
    onChangeBody: (value: string) => dispatch({ type: "pr-body", value }),
    onChangeCommitMessage: (value: string) =>
      dispatch({ type: "commit-message", value }),
    onChangeDeleteBranchOnMerge: (value: boolean) =>
      dispatch({ type: "delete-branch-on-merge", value }),
    onChangeDraft: (value: boolean) => dispatch({ type: "pr-draft", value }),
    onChangeMergeMethod: (method: MergeMethod) =>
      dispatch({ type: "merge-method", method }),
    onChangeTab: (tab: GithubPanelTab) => dispatch({ type: "tab", tab }),
    onChangeTitle: (value: string) => dispatch({ type: "pr-title", value }),
    openCreateForm,
    prBody,
    prDraft,
    prDetailsReady,
    prReady: prData !== null,
    prs,
    prTitle,
    push,
    pushLabel,
    refresh,
    showCreateForm,
    status,
    statusError: overviewError,
    tab,
    upstream,
  }
}

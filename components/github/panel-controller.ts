"use client"

import { useCallback, useEffect, useMemo, useReducer, useRef } from "react"

import type {
  GithubPanelBusyKind,
  GithubPrResponse,
} from "@/components/github/panel-types"
import { useIsMobile } from "@/hooks/use-is-mobile"
import { useResizablePanel } from "@/hooks/use-resizable-panel"
import { fetchJson, postJson as postJsonRequest } from "@/lib/http/client-json"
import { getDiffStats, type DiffFileStat } from "@/lib/diff/metadata"
import type { CreatePullRequestResult } from "@/lib/github/pull-requests"
import type { SandboxGitStatus } from "@/lib/sandbox/git"

type GithubPanelState = {
  actionError: string | null
  busy: GithubPanelBusyKind
  commitMessage: string
  compareUrl: string | null
  loading: boolean
  prBody: string
  prData: GithubPrResponse | null
  prDraft: boolean
  prTitle: string
  showCreateForm: boolean
  status: SandboxGitStatus | null
  statusError: string | null
}

type GithubPanelAction =
  | { type: "action-error"; error: string }
  | { type: "action-finish" }
  | { type: "action-start"; busy: Exclude<GithubPanelBusyKind, null> }
  | { type: "close-create-form" }
  | { type: "commit-message"; value: string }
  | { type: "compare-url"; url: string | null }
  | { type: "loading"; value: boolean }
  | { type: "open-create-form"; title: string }
  | { type: "pr-body"; value: string }
  | { type: "pr-data"; data: GithubPrResponse }
  | { type: "pr-draft"; value: boolean }
  | { type: "pr-title"; value: string }
  | { type: "reset-commit-message" }
  | { type: "status-error"; error: string }
  | { type: "status-success"; status: SandboxGitStatus }

const initialGithubPanelState: GithubPanelState = {
  actionError: null,
  busy: null,
  commitMessage: "",
  compareUrl: null,
  loading: false,
  prBody: "",
  prData: null,
  prDraft: false,
  prTitle: "",
  showCreateForm: false,
  status: null,
  statusError: null,
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
    case "loading":
      return { ...state, loading: action.value }
    case "open-create-form":
      return {
        ...state,
        compareUrl: null,
        prBody: "",
        prDraft: false,
        prTitle: action.title,
        showCreateForm: true,
      }
    case "pr-body":
      return { ...state, prBody: action.value }
    case "pr-data":
      return { ...state, prData: action.data }
    case "pr-draft":
      return { ...state, prDraft: action.value }
    case "pr-title":
      return { ...state, prTitle: action.value }
    case "reset-commit-message":
      return { ...state, commitMessage: "" }
    case "status-error":
      return { ...state, statusError: action.error }
    case "status-success":
      return { ...state, status: action.status, statusError: null }
  }
}

const POLL_INTERVAL_MS = 8000

function defaultPrTitle(branch: string | null) {
  if (!branch) return ""
  const last = branch.split("/").pop() ?? branch
  const words = last.replace(/[-_]+/g, " ").trim()
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : ""
}

export function useGithubPanelController({
  baseBranch,
  diff,
  githubConnected,
  open,
  sandboxId,
}: {
  baseBranch: string
  diff?: string
  githubConnected: boolean
  open: boolean
  sandboxId: string | null
}) {
  const isMobile = useIsMobile()
  const { width, resizing, onResizeStart, resetWidth } = useResizablePanel({
    storageKey: "cloudcode:githubPanelWidth",
    defaultWidth: 304,
    minWidth: 240,
    maxWidth: 560,
    edge: "left",
    enabled: !isMobile,
  })
  const [state, dispatch] = useReducer(
    githubPanelReducer,
    initialGithubPanelState
  )
  const {
    actionError,
    busy,
    commitMessage,
    compareUrl,
    loading,
    prBody,
    prData,
    prDraft,
    prTitle,
    showCreateForm,
    status,
    statusError,
  } = state

  const busyRef = useRef<GithubPanelBusyKind>(null)
  busyRef.current = busy

  const diffStatByPath = useMemo(() => {
    const map = new Map<string, DiffFileStat>()
    for (const file of getDiffStats(diff).files) {
      map.set(file.path, file)
      if (file.prevPath) map.set(file.prevPath, file)
    }
    return map
  }, [diff])

  const loadStatus = useCallback(
    async (signal?: AbortSignal) => {
      if (!sandboxId) return
      try {
        const status = await fetchJson<SandboxGitStatus>(
          `/api/sandbox/git/status?${new URLSearchParams({ sandboxId })}`,
          { signal },
          { fallbackError: "Failed to load git status." }
        )
        dispatch({ type: "status-success", status })
      } catch (error) {
        if (signal?.aborted) return
        dispatch({
          type: "status-error",
          error:
            error instanceof Error
              ? error.message
              : "Failed to load git status.",
        })
      }
    },
    [sandboxId]
  )

  const loadPr = useCallback(
    async (signal?: AbortSignal) => {
      if (!sandboxId) return
      try {
        const data = await fetchJson<GithubPrResponse>(
          `/api/sandbox/git/pr?${new URLSearchParams({ sandboxId })}`,
          { signal },
          { fallbackError: "Failed to load pull request." }
        )
        dispatch({ type: "pr-data", data })
      } catch {
        if (signal?.aborted) return
      }
    },
    [sandboxId]
  )

  const refresh = useCallback(
    async (signal?: AbortSignal) => {
      dispatch({ type: "loading", value: true })
      await Promise.all([loadStatus(signal), loadPr(signal)])
      if (!signal?.aborted) dispatch({ type: "loading", value: false })
    },
    [loadPr, loadStatus]
  )

  useEffect(() => {
    if (!open || !sandboxId) return
    const controller = new AbortController()
    void refresh(controller.signal)
    return () => controller.abort()
  }, [open, sandboxId, refresh])

  const prs = prData?.prs ?? []
  const openPrs = prs.filter((entry) => entry.state === "open" && !entry.merged)
  const shouldPoll =
    open &&
    openPrs.some(
      (entry) => (entry.checks?.pending ?? 0) > 0 || entry.mergeable === null
    )

  useEffect(() => {
    if (!shouldPoll) return
    const id = window.setInterval(() => {
      if (!busyRef.current) void loadPr()
    }, POLL_INTERVAL_MS)
    return () => window.clearInterval(id)
  }, [shouldPoll, loadPr])

  const connected = prData?.connected ?? githubConnected
  const files = status?.files ?? []
  const branch = status?.branch ?? prData?.branch ?? null
  const upstream = status?.upstream ?? null
  const hasChanges = files.length > 0
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
    branch,
    busy,
    canCommit,
    commit,
    commitMessage,
    compareUrl,
    connected,
    createPr,
    diffStatByPath,
    files,
    hasChanges,
    loading,
    onCancelCreateForm: () => dispatch({ type: "close-create-form" }),
    onChangeBody: (value: string) => dispatch({ type: "pr-body", value }),
    onChangeCommitMessage: (value: string) =>
      dispatch({ type: "commit-message", value }),
    onChangeDraft: (value: boolean) => dispatch({ type: "pr-draft", value }),
    onChangeTitle: (value: string) => dispatch({ type: "pr-title", value }),
    onResizeStart,
    openCreateForm,
    prBody,
    prData,
    prDraft,
    prs,
    prTitle,
    push,
    pushLabel,
    refresh,
    resetWidth,
    resizing,
    showCreateForm,
    status,
    statusError,
    upstream,
    width,
  }
}

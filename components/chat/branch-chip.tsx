"use client"

import { GitBranch, LoaderCircle } from "lucide-react"
import { useCallback, useEffect, useMemo, useReducer, useRef } from "react"

import {
  chipTrigger,
  popoverItem,
  popoverPanel,
} from "@/components/chat/control-styles"
import { Input } from "@/components/ui/input"
import { fetchJson } from "@/lib/http/client-json"
import { cn } from "@/lib/shared/utils"

type BranchChipState = {
  branches: string[]
  defaultBranch?: string
  draft: string
  editing: boolean
  error: string
  loading: boolean
}

type BranchChipAction =
  | { type: "cancel"; value: string }
  | { type: "close" }
  | { type: "draft"; value: string }
  | { type: "load-error"; error: string }
  | { type: "load-start" }
  | { type: "load-success"; branches: string[]; defaultBranch?: string }
  | { type: "open"; value: string }
  | { type: "select"; value: string }

const initialBranchChipState: BranchChipState = {
  branches: [],
  defaultBranch: undefined,
  draft: "",
  editing: false,
  error: "",
  loading: false,
}

function branchChipReducer(
  state: BranchChipState,
  action: BranchChipAction
): BranchChipState {
  switch (action.type) {
    case "cancel":
      return { ...state, draft: action.value, editing: false }
    case "close":
      return { ...state, editing: false }
    case "draft":
      return { ...state, draft: action.value }
    case "load-error":
      return {
        ...state,
        branches: [],
        defaultBranch: undefined,
        error: action.error,
        loading: false,
      }
    case "load-start":
      return { ...state, error: "", loading: true }
    case "load-success":
      return {
        ...state,
        branches: action.branches,
        defaultBranch: action.defaultBranch,
        loading: false,
      }
    case "open":
      return { ...state, draft: action.value, editing: true }
    case "select":
      return { ...state, draft: action.value, editing: false }
  }
}

export function BranchChip({
  locked,
  onChange,
  repoUrl,
  value,
}: {
  locked?: boolean
  onChange: (v: string) => void
  repoUrl?: string
  value: string
}) {
  const [state, dispatch] = useReducer(
    branchChipReducer,
    initialBranchChipState
  )
  const inputRef = useRef<HTMLInputElement>(null)
  const branchesControllerRef = useRef<AbortController | null>(null)
  const setFocusedInputRef = useCallback((node: HTMLInputElement | null) => {
    inputRef.current = node
    node?.focus()
  }, [])

  const abortBranchesLoad = useCallback(() => {
    branchesControllerRef.current?.abort()
    branchesControllerRef.current = null
  }, [])

  const loadBranches = useCallback(async () => {
    const repo = repoUrl?.trim()
    if (!repo) return

    abortBranchesLoad()
    const controller = new AbortController()
    branchesControllerRef.current = controller
    dispatch({ type: "load-start" })
    try {
      const data = await fetchJson<{
        branches?: string[]
        defaultBranch?: string
      }>(
        `/api/github/branches?repoUrl=${encodeURIComponent(repo)}`,
        { signal: controller.signal },
        { fallbackError: "Unable to load branches." }
      )
      if (!controller.signal.aborted) {
        dispatch({
          branches: data.branches ?? [],
          defaultBranch: data.defaultBranch,
          type: "load-success",
        })
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        dispatch({
          error:
            error instanceof Error ? error.message : "Unable to load branches.",
          type: "load-error",
        })
      }
    } finally {
      if (!controller.signal.aborted) {
        if (branchesControllerRef.current === controller) {
          branchesControllerRef.current = null
        }
      }
    }
  }, [abortBranchesLoad, repoUrl])

  useEffect(() => abortBranchesLoad, [abortBranchesLoad])

  function commit() {
    onChange(state.draft.trim())
    dispatch({ type: "close" })
  }

  const visibleBranches = useMemo(() => {
    const needle = state.draft.trim().toLowerCase()
    const sorted = state.branches.toSorted((a, b) => {
      if (a === state.defaultBranch) return -1
      if (b === state.defaultBranch) return 1
      return a.localeCompare(b)
    })
    return sorted
      .filter((branch) => !needle || branch.toLowerCase().includes(needle))
      .slice(0, 8)
  }, [state.branches, state.defaultBranch, state.draft])

  if (state.editing) {
    return (
      <div className="relative">
        <div className="flex h-8 items-center gap-1.5 rounded-lg border border-field bg-background pr-1 pl-2.5 text-xs focus-within:ring-3 focus-within:ring-ring/30">
          <GitBranch className="size-3.5 shrink-0 text-muted-foreground" />
          <Input
            ref={setFocusedInputRef}
            variant="bare"
            aria-label="Branch name"
            value={state.draft}
            onChange={(e) => dispatch({ type: "draft", value: e.target.value })}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault()
                commit()
              }
              if (e.key === "Escape") {
                dispatch({ type: "cancel", value })
              }
            }}
            placeholder={state.defaultBranch ?? "default branch"}
            className="w-32 text-xs"
            spellCheck={false}
          />
          {state.loading ? (
            <LoaderCircle className="size-3.5 shrink-0 animate-spin text-muted-foreground" />
          ) : null}
        </div>
        {visibleBranches.length || state.error ? (
          <div
            className={cn(
              popoverPanel,
              "top-10 right-0 w-60 max-w-[calc(100vw-2rem)] sm:right-auto sm:left-0"
            )}
          >
            {visibleBranches.map((branch) => (
              <button
                key={branch}
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  onChange(branch)
                  dispatch({ type: "select", value: branch })
                }}
                className={popoverItem}
              >
                <span className="min-w-0 truncate">{branch}</span>
                {branch === state.defaultBranch ? (
                  <span className="shrink-0 text-xs text-muted-foreground">
                    default
                  </span>
                ) : null}
              </button>
            ))}
            {state.error ? (
              <div className="px-3 py-2 text-xs leading-4 text-destructive">
                {state.error}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    )
  }

  const label = value || "default branch"

  return (
    <button
      type="button"
      onClick={() => {
        if (!locked) {
          dispatch({ type: "open", value })
          void loadBranches()
        }
      }}
      disabled={locked}
      aria-haspopup="dialog"
      title={
        locked ? "Base branch is locked once a chat starts" : "Base branch"
      }
      className={cn(
        chipTrigger,
        "max-w-[10rem]",
        value ? "text-foreground/80" : "text-muted-foreground"
      )}
    >
      <GitBranch className="size-3.5 shrink-0" />
      <span className="truncate">{label}</span>
    </button>
  )
}

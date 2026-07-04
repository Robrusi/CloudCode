"use client"

import { GitBranch, LoaderCircle } from "lucide-react"
import { useCallback, useEffect, useRef, useState } from "react"

import {
  chipTrigger,
  popoverItem,
  popoverPanel,
} from "@/components/chat/control-styles"
import { Input } from "@/components/ui/input"
import { useGitHubBranches } from "@/hooks/use-github-branches"
import { cn } from "@/lib/shared/utils"

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
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState("")
  const [dirty, setDirty] = useState(false)
  const { branches, defaultBranch, loading, error, ensureLoaded } =
    useGitHubBranches(repoUrl)
  const cancelledRef = useRef(false)

  const setFocusedInputRef = useCallback((node: HTMLInputElement | null) => {
    node?.focus()
    node?.select()
  }, [])

  // Seed and load whenever the picker opens, and reset the "dirty" guard that
  // decides commit/filter behavior.
  useEffect(() => {
    if (!editing) return
    cancelledRef.current = false
    setDraft(value)
    setDirty(false)
    ensureLoaded()
  }, [editing, value, ensureLoaded])

  function commit() {
    // Escape cancels; a blur fired while unmounting must not re-commit it.
    if (cancelledRef.current) {
      setEditing(false)
      return
    }
    // Untouched field: close without touching the value.
    if (!dirty) {
      setEditing(false)
      return
    }
    onChange(draft.trim())
    setEditing(false)
  }

  if (editing) {
    const needle = draft.trim().toLowerCase()
    const sorted = branches.toSorted((a, b) => {
      if (a === defaultBranch) return -1
      if (b === defaultBranch) return 1
      return a.localeCompare(b)
    })
    // Show the full list until the user types.
    const visibleBranches = sorted
      .filter(
        (branch) => !dirty || !needle || branch.toLowerCase().includes(needle)
      )
      .slice(0, 8)

    return (
      <div className="relative">
        <div className="flex h-8 items-center gap-1.5 rounded-lg border border-field bg-background pr-1 pl-2.5 text-xs focus-within:ring-3 focus-within:ring-ring/30">
          <GitBranch className="size-3.5 shrink-0 text-muted-foreground" />
          <Input
            ref={setFocusedInputRef}
            variant="bare"
            aria-label="Branch name"
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value)
              setDirty(true)
            }}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault()
                commit()
              }
              if (e.key === "Escape") {
                e.preventDefault()
                cancelledRef.current = true
                setEditing(false)
              }
            }}
            placeholder={defaultBranch ?? "default branch"}
            className="w-32 text-xs"
            spellCheck={false}
          />
          {loading ? (
            <LoaderCircle className="size-3.5 shrink-0 animate-spin text-muted-foreground" />
          ) : null}
        </div>
        {visibleBranches.length || error ? (
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
                  setEditing(false)
                }}
                className={popoverItem}
              >
                <span className="min-w-0 truncate">{branch}</span>
                {branch === defaultBranch ? (
                  <span className="shrink-0 text-xs text-muted-foreground">
                    default
                  </span>
                ) : null}
              </button>
            ))}
            {error ? (
              <div className="px-3 py-2 text-xs leading-4 text-destructive">
                {error}
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
        if (!locked) setEditing(true)
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

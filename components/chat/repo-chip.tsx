"use client"

import { GitBranch, LoaderCircle } from "lucide-react"
import { useCallback, useEffect, useRef, useState } from "react"

import {
  chipTrigger,
  popoverItem,
  popoverPanel,
} from "@/components/chat/control-styles"
import { repoLabel } from "@/components/chat/format"
import { Input } from "@/components/ui/input"
import { useGitHubRepos } from "@/hooks/use-github-repos"
import { canonicalGitHubRepoUrl } from "@/lib/github/repo"
import { cn } from "@/lib/shared/utils"

export function RepoChip({
  editing,
  locked,
  onChange,
  setEditing,
  value,
}: {
  editing: boolean
  locked?: boolean
  onChange: (v: string) => void
  setEditing: (v: boolean) => void
  value: string
}) {
  const [draft, setDraft] = useState("")
  const [dirty, setDirty] = useState(false)
  const { repos, loading, error, ensureLoaded } = useGitHubRepos()
  const cancelledRef = useRef(false)

  const setFocusedInputRef = useCallback((node: HTMLInputElement | null) => {
    node?.focus()
    node?.select()
  }, [])

  // Seed the field and load the list whenever the picker opens. Keeping this in
  // an effect (rather than the click handler) also covers opens triggered by the
  // parent, and resets the "dirty" guard that decides commit/filter behavior.
  useEffect(() => {
    if (!editing) return
    cancelledRef.current = false
    setDraft(value ? repoLabel(value) : "")
    setDirty(false)
    ensureLoaded()
  }, [editing, value, ensureLoaded])

  function commit() {
    // Escape cancels; a blur fired while unmounting must not re-commit it.
    if (cancelledRef.current) {
      setEditing(false)
      return
    }
    // Untouched field: close without touching the value so a stray blur can
    // never clobber the current repo.
    if (!dirty) {
      setEditing(false)
      return
    }
    const trimmed = draft.trim()
    onChange(trimmed ? (canonicalGitHubRepoUrl(trimmed) ?? trimmed) : "")
    setEditing(false)
  }

  if (editing) {
    const needle = draft
      .replace(/^https?:\/\/(www\.)?github\.com\//, "")
      .replace(/\.git$/, "")
      .toLowerCase()
    // Show the full list until the user types, so opening never hides the other
    // repos behind the currently-selected one.
    const visibleRepos = repos
      .filter(
        (repo) =>
          !dirty || !needle || repo.fullName.toLowerCase().includes(needle)
      )
      .slice(0, 8)

    return (
      <div className="relative min-w-0">
        <div className="flex h-8 min-w-0 items-center gap-1.5 rounded-lg border border-field bg-background pr-1 pl-2.5 text-xs focus-within:ring-3 focus-within:ring-ring/30">
          <GitBranch className="size-3.5 shrink-0 text-muted-foreground" />
          <Input
            ref={setFocusedInputRef}
            variant="bare"
            aria-label="Repository"
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
            placeholder="owner/repo"
            className="w-36 text-xs sm:w-40"
            spellCheck={false}
          />
          {loading ? (
            <LoaderCircle className="size-3.5 shrink-0 animate-spin text-muted-foreground" />
          ) : null}
        </div>
        {visibleRepos.length || error ? (
          <div
            className={cn(
              popoverPanel,
              "top-10 right-0 w-72 max-w-[calc(100vw-2rem)] sm:right-auto sm:left-0"
            )}
          >
            {visibleRepos.map((repo) => (
              <button
                key={repo.cloneUrl}
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  onChange(repo.cloneUrl)
                  setEditing(false)
                }}
                className={popoverItem}
              >
                <span className="min-w-0 truncate">{repo.fullName}</span>
                {repo.private ? (
                  <span className="shrink-0 text-xs text-muted-foreground">
                    Private
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

  const label = value ? repoLabel(value) : "Connect repo"

  return (
    <button
      type="button"
      onClick={() => {
        if (!locked) setEditing(true)
      }}
      disabled={locked}
      aria-haspopup="dialog"
      className={cn(
        chipTrigger,
        "max-w-[14rem]",
        value ? "text-foreground/80" : "text-muted-foreground"
      )}
    >
      <GitBranch className="size-3.5 shrink-0" />
      <span className="truncate">{label}</span>
    </button>
  )
}
